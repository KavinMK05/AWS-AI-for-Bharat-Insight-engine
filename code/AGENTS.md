# AGENTS.md — The Insight Engine

This file provides guidance for agentic coding tools operating in this repository.
The project is a greenfield TypeScript/AWS monorepo. Refer to `IMPLEMENTATION_PLAN.md`
for the full architecture and phase-by-phase task breakdown.

---

## Project Overview

**The Insight Engine** is an event-driven AI content pipeline built on AWS.

- **Backend:** TypeScript/Node.js AWS Lambda functions (no Express — raw handlers)
- **Frontend:** Next.js (App Router) approval dashboard (`apps/dashboard`)
- **Infrastructure:** Terraform (HCL), module-based, in `infra/`
- **AI/LLM:** AWS Bedrock — Claude Sonnet (scoring + generation), Titan Embeddings (dedup)
- **Databases:** DynamoDB (operational) + RDS PostgreSQL 15 (analytical/FTS)
- **Messaging:** SQS queues, SNS alerts, EventBridge scheduled triggers
- **Auth:** AWS Cognito (JWT via API Gateway v2 authoriser)
- **Package Manager:** `pnpm` with workspaces

---

## Repository Structure

```
insight-engine/
├── infra/                    # Terraform — all AWS resource definitions
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── backend.tf            # Remote state: S3 + DynamoDB locking
│   ├── terraform.tfvars.example
│   └── modules/              # One module per AWS concern
│       ├── dynamodb/ rds/ lambda/ vpc/ sqs/ eventbridge/
│       ├── api_gateway/ s3/ ssm/ cognito/ sns/ cloudwatch/ bedrock/
├── packages/
│   ├── core/                 # Shared types, DB clients, config loader, logger
│   ├── watchtower/           # Ingestion Lambda (EventBridge → RSS/arXiv/Twitter)
│   ├── analyst/              # Scoring + hot take Lambda (SQS-triggered)
│   ├── ghostwriter/          # Content generation Lambda (SQS-triggered)
│   ├── gatekeeper/           # Approval API Lambda (HTTP API)
│   └── publisher/            # Social publishing Lambda (SQS-triggered)
├── apps/
│   └── dashboard/            # Next.js approval UI
├── scripts/
│   ├── teardown.sh           # Full terraform destroy with safety prompts
│   ├── pause.sh              # Stop costly resources (EventBridge, RDS)
│   └── resume.sh             # Resume paused resources
├── .github/
│   └── workflows/
│       ├── ci.yml            # Lint + typecheck + test + terraform validate/plan
│       └── deploy.yml        # Build + zip + aws lambda update-function-code
├── package.json              # Root pnpm workspace
└── IMPLEMENTATION_PLAN.md
```

---

## Build / Lint / Test Commands

> These commands are defined at the root `package.json` level and run across all
> workspace packages recursively via `pnpm -r`.

| Command | Description |
|---|---|
| `pnpm -r build` | Compile all TypeScript packages (zero-error target) |
| `pnpm lint` | Run ESLint across all packages |
| `pnpm typecheck` | Run `tsc --noEmit` across all packages |
| `pnpm test` | Run all test suites |
| `pnpm -r lint` | Lint all packages individually |

### Running a Single Test

```bash
# Run all tests in a specific package
pnpm --filter @insight-engine/analyst test

# Run a specific test file (Jest assumed)
pnpm --filter @insight-engine/analyst test -- --testPathPattern=scoring.test.ts

# Run a single test by name
pnpm --filter @insight-engine/analyst test -- --testNamePattern="applies recency decay"
```

### Terraform Commands

```bash
# All Terraform commands run from infra/
cd infra
terraform init
terraform validate
terraform plan -var-file=terraform.tfvars
terraform apply -var-file=terraform.tfvars
terraform destroy -var-file=terraform.tfvars
```

### CI Pipeline (GitHub Actions)

`ci.yml` runs on every PR: `pnpm lint` → `pnpm typecheck` → `pnpm test` →
`terraform validate` → `terraform plan` (plan posted as PR comment).

`deploy.yml` runs on merge to `main`: build each Lambda package, zip output,
upload to S3, run `aws lambda update-function-code` per function.

---

## TypeScript Configuration

- Root `tsconfig.base.json` with `strict: true`, `moduleResolution: bundler`
- Each package has its own `tsconfig.json` that extends the base
- Path aliases: `@insight-engine/core`, `@insight-engine/watchtower`, etc.
- `strict: true` is non-negotiable — no `any` without an explicit comment justifying it
- All Lambda handlers must export a typed handler matching the AWS SDK event type
- Lambda runtime: `nodejs20.x`
- Test framework: `vitest` (native ESM support, fast, TypeScript-first)

---

## Code Style

### Formatting

- **Prettier** — single root config; enforced in CI
- **ESLint** with `@typescript-eslint` — single root config; zero warnings allowed
- No trailing whitespace; files end with a newline
- 2-space indentation

### Imports

1. Node built-ins first
2. AWS SDK packages (`@aws-sdk/*`)
3. Third-party packages
4. Internal packages (`@insight-engine/*`)
5. Relative imports last

Do **not** mix default and named imports from the same module on one line.
Use named imports from `@insight-engine/core` for all shared types and utilities.

### Naming Conventions

| Construct | Convention | Example |
|---|---|---|
| TypeScript interfaces/types | PascalCase | `ContentItem`, `HotTake`, `PersonaFile` |
| Functions, variables | camelCase | `loadPersona`, `relevanceScore` |
| Lambda handlers | camelCase export `handler` | `export const handler: Handler = ...` |
| DynamoDB table names | PascalCase | `ContentItems`, `DraftContent` |
| RDS table/column names | snake_case | `content_items`, `ingested_at` |
| Lambda function names (AWS) | kebab-case | `insight-engine-dev-watchtower` |
| SQS queue names | kebab-case | `ingestion-queue`, `publish-queue` |
| Environment variables | SCREAMING_SNAKE_CASE | `RELEVANCE_THRESHOLD` |
| SSM parameter paths | kebab-case path segments | `/insight-engine/dev/twitter-client-id` |
| CloudWatch metric names | PascalCase | `ContentItemsIngested`, `HotTakesGenerated` |
| Terraform modules | snake_case | `api_gateway`, `cloudwatch` |
| Status enum strings | lowercase with underscores | `'pending_approval'`, `'published'` |

### Types

- Prefer `interface` over `type` for object shapes; use `type` for unions/aliases
- Use `zod` for runtime validation of external data (persona files, API responses)
- Never use `as any` — use type guards or `unknown` with narrowing
- All shared interfaces live in `packages/core/src/types.ts`

---

## Error Handling

Follow these patterns consistently across all Lambda packages:

1. **Per-source isolation (Watchtower):** Wrap each data source (RSS, arXiv,
   Twitter) in its own `try/catch`. Log `{ component, source, error }` and
   continue. One broken feed must never crash the Lambda.

2. **Bedrock API failures (Analyst/Ghostwriter):** On any Bedrock error, log it,
   set `relevanceScore` to 0, and return without re-throwing. No hot take is
   generated. Never surface Bedrock errors to the SQS retry mechanism.

3. **SQS permanent failures (Publisher):** After 3 retries are exhausted, do NOT
   throw from the handler (which would cause another SQS retry). Instead, update
   the item status to `'failed'` in DynamoDB and publish an SNS admin alert.

4. **Transient vs. permanent retry logic:** Retry platform API calls (Twitter,
   LinkedIn) up to 3 times with exponential backoff (1s, 2s, 4s). Only
   retry on 5xx or network timeout. Never retry 4xx auth errors — except
   on 401 Unauthorized, attempt one OAuth token refresh before marking as
   permanent failure.

5. **OAuth token refresh (Publisher):** Both Twitter/X and LinkedIn use OAuth
   2.0 tokens that expire. The `OAuthTokenManager` in `packages/core`
   handles automatic refresh. On refresh failure (revoked or expired refresh
   token), log the error, publish an SNS admin alert, and mark the publish
   item as `'failed'`. The operator must manually re-authorize via the
   platform's OAuth consent flow. Never store tokens in environment
   variables — always in SSM as `SecureString`.

5. **Config loader fail-fast:** Validate all required config at Lambda cold-start.
   Throw a descriptive named error for each missing/invalid value — never proceed
   with partial config.

6. **Structured logging only:** Use the logger from `@insight-engine/core`.
   Never use bare `console.log`. Every log entry must include:
   `{ timestamp, level, component, message, errorDetails? }` as JSON.

7. **Health endpoint:** `GET /health` always returns HTTP 200 — even when
   components are degraded. Never return 500 from a health check.

---

## Architecture Principles

- **Single-responsibility Lambdas:** Each Lambda owns exactly one pipeline stage.
  Do not add cross-stage logic to an existing Lambda — create or extend the
  appropriate package.
- **Shared `core` package:** All DynamoDB clients, RDS clients, config loading,
  structured logging, and TypeScript interfaces live in `packages/core`. Import
  from there; do not duplicate these in individual packages.
- **Least-privilege IAM:** Every Lambda has its own execution role with only the
  permissions it needs. No wildcard `*` actions. All secrets in SSM as
  `SecureString` — never in environment variables as plaintext.
- **No auto-publishing:** Content is never published without human approval via
  the Gatekeeper dashboard. The `'approved'` status in DynamoDB is the only gate
  that triggers the Publisher.
- **Deduplication:** Check DynamoDB `ContentItems` GSI on `sourceUrl` before
  storing any new item. If a match exists, set `isDuplicate: true` and skip
  further processing.
- **No VPC by default:** In Phase 1, all Lambdas run outside VPC. VPC and RDS
  are gated by Terraform toggle variables (`enable_vpc`, `enable_rds`) and
  activated in Phase 8 when history/search features are implemented. The RDS
  client in `packages/core` is scaffolded with interfaces only until then.
- **Terraform owns infra; CI owns code:** `terraform apply` is never triggered
  by application code changes. Lambda code is updated via
  `aws lambda update-function-code` in `deploy.yml` only.

---

## Cost Control

> Phase 1 runs with VPC and RDS **disabled by default** to minimize idle costs.
> Lambdas run outside VPC with direct internet access.

### Terraform toggle variables

| Variable | Default | Effect when disabled | Monthly savings |
|---|---|---|---|
| `enable_vpc` | `false` | Skips VPC, NAT Gateway, subnets | ~$32 |
| `enable_rds` | `false` | Skips RDS PostgreSQL instance | ~$12-15 |
| `enable_cloudwatch_dashboard` | `true` | Skips CloudWatch Dashboard when set to `false` | ~$3 |

### Scripts

| Script | Usage | Description |
|---|---|---|
| `scripts/teardown.sh <env>` | `./scripts/teardown.sh dev` | Full `terraform destroy` with safety prompts |
| `scripts/pause.sh <env> [--full]` | `./scripts/pause.sh dev` | Disable EventBridge rules; optionally stop RDS and remove NAT GW |
| `scripts/resume.sh <env>` | `./scripts/resume.sh dev` | Re-enable EventBridge rules; start RDS; recreate NAT GW if needed |

### Estimated idle costs (Phase 1 defaults)

With VPC and RDS disabled: **~$0-3/month**. DynamoDB, SQS, Lambda, API Gateway,
Cognito, and EventBridge all charge per-request or have free tiers that cover
hackathon-scale usage.

### Phase 8 upgrade path

Set `enable_vpc = true` and `enable_rds = true` in `terraform.tfvars`, then
run `terraform apply`. All module wiring is pre-built; only the expensive
resources are conditionally created.

---

## Secrets and Configuration

> **This repository is public** (hackathon submission). Extra care is required to
> ensure no secrets are ever committed, logged, or exposed in CI output.

### Where secrets live

| Secret type | Storage | Who sets the value |
|---|---|---|
| AWS credentials for CI/CD | GitHub Actions Secrets | Operator (repo Settings → Secrets) |
| OAuth tokens (Twitter, LinkedIn) | AWS SSM Parameter Store (`SecureString`) | Operator (manual OAuth flow → `aws ssm put-parameter`) |
| RDS master password | Terraform variable via `TF_VAR_rds_master_password` env var (only needed when `enable_rds = true`) | Operator (local machine or GitHub Actions Secret) |
| All other app secrets | AWS SSM Parameter Store (`SecureString`) | Operator or `OAuthTokenManager` (auto-refresh) |

### GitHub Actions Secrets (required for CI/CD)

These are configured in GitHub repo Settings → Secrets and variables → Actions.
They are encrypted at rest, masked with `***` in logs, and invisible even to repo admins after entry.

- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `AWS_ACCOUNT_ID`

### SSM Parameter Store paths

- Path convention: `/insight-engine/{env}/{secret-name}`
- OAuth tokens for Twitter/X and LinkedIn are stored in SSM and managed by the `OAuthTokenManager` in `packages/core`:
  - `/insight-engine/{env}/twitter-client-id`
  - `/insight-engine/{env}/twitter-client-secret`
  - `/insight-engine/{env}/twitter-access-token`
  - `/insight-engine/{env}/twitter-refresh-token`
  - `/insight-engine/{env}/linkedin-client-id`
  - `/insight-engine/{env}/linkedin-client-secret`
  - `/insight-engine/{env}/linkedin-access-token`
  - `/insight-engine/{env}/linkedin-refresh-token`
  - `/insight-engine/{env}/rds-connection-string`
- The `OAuthTokenManager` automatically refreshes expired tokens and writes new values back to SSM. If a refresh token is revoked, it publishes an SNS admin alert

### What is safe to commit (and what is not)

| File | Committed? | Reason |
|---|---|---|
| `terraform.tfvars.example` | Yes | Placeholder values only |
| `.env.example` | Yes | Documents required vars, no real values |
| `persona.example.json` | Yes | No credentials |
| `.github/workflows/*.yml` | Yes | References secret **names**, not values |
| `terraform.tfvars` | **No** — gitignored | Contains real Terraform variable values |
| `.env` / `.env.*` | **No** — gitignored | Contains real env vars |
| `*.tfstate` / `*.tfstate.*` | **No** — gitignored | May contain resource details and ARNs |
| `.terraform/` | **No** — gitignored | Provider cache |

### Rules for agents and contributors

1. **Never hardcode** any API key, token, password, or secret in source code, Terraform files, or workflow YAML
2. **Never commit** `terraform.tfvars`, `.env`, or state files — the `.gitignore` blocks these
3. **Never log secrets** — the structured logger must never include token values in `errorDetails`
4. **Terraform SSM module** creates parameter paths as empty placeholders only; real values are set manually after `terraform apply`
5. **CI workflows** inject AWS credentials via `aws-actions/configure-aws-credentials` using GitHub Actions Secrets
6. **Terraform plan output** posted as PR comments must be reviewed to ensure no secrets leak in resource attributes
7. The config loader in `packages/core` reads env vars first, then falls back to SSM
8. `PersonaFile` is loaded from the `persona-files` S3 bucket at Lambda runtime — it contains no secrets

---

## Testing Guidelines

- Unit tests live alongside source files: `src/scoring.ts` → `src/scoring.test.ts`
- Test framework: `vitest` (native ESM support, fast, TypeScript-first)
- Mock all AWS SDK calls in unit tests — never hit real AWS in unit tests
- Integration tests (arXiv public API, etc.) are tagged and run separately
- Use `pnpm --filter <package> test` to run tests for a single package
- Every Lambda handler should have at least: happy-path test, error-path test,
  and an input validation test
- Config loader must have: valid config → typed object; missing required var → named error
