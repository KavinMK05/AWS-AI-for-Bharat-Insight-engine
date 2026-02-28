# The Insight Engine — Implementation Plan

**Stack:** TypeScript/Node.js · AWS Bedrock · Next.js · AWS Lambda · DynamoDB + RDS (PostgreSQL) · Terraform · Real social publishing

---

## How Infrastructure & Code Deployments Work

> **New to Terraform? Read this first.**
>
> Terraform is a tool that creates and manages cloud infrastructure by reading `.tf` config files.
> You run `terraform apply` and it figures out what AWS resources to create, update, or delete.
>
> In this project we use a split-responsibility model:
>
> | Tool | Responsible for |
> |---|---|
> | **Terraform** | Creating AWS resources: databases, queues, Lambda function shells, IAM roles, API Gateway, etc. |
> | **GitHub Actions (CI/CD)** | Building the TypeScript code, zipping it, and uploading it into the Lambda shells Terraform created |
>
> This means `terraform apply` never needs to run just because you changed a line of application code.
> It only needs to run when cloud infrastructure changes (new table, new queue, new environment variable, etc.).
> Application code updates are deployed in seconds via `aws lambda update-function-code` in CI.

---

## Repository Structure

```
insight-engine/
├── infra/                          # All Terraform code lives here
│   ├── main.tf
│   ├── variables.tf
│   ├── outputs.tf
│   ├── backend.tf                  # Remote state: S3 + DynamoDB locking
│   ├── terraform.tfvars.example    # Reference file — no real secrets ever committed
│   └── modules/
│       ├── dynamodb/
│       ├── rds/                    # Skeleton in Phase 1 (gated by enable_rds)
│       ├── lambda/
│       ├── vpc/                    # Skeleton in Phase 1 (gated by enable_vpc)
│       ├── sqs/
│       ├── eventbridge/
│       ├── api_gateway/
│       ├── s3/
│       ├── ssm/
│       ├── cognito/
│       ├── sns/
│       ├── cloudwatch/
│       └── bedrock/
├── packages/
│   ├── core/                       # Shared types, DB clients, config loader, logger
│   ├── watchtower/                 # Ingestion Lambda
│   ├── analyst/                    # Scoring + hot take Lambda
│   ├── ghostwriter/                # Content generation Lambda
│   ├── gatekeeper/                 # Approval API Lambda
│   └── publisher/                  # Social publishing Lambda
├── apps/
│   └── dashboard/                  # Next.js approval UI
├── scripts/
│   ├── teardown.sh                 # Full terraform destroy with safety prompts
│   ├── pause.sh                    # Stop costly resources (EventBridge, RDS)
│   └── resume.sh                   # Resume paused resources
├── .github/
│   └── workflows/
│       ├── ci.yml                  # Lint, type-check, test on every PR
│       └── deploy.yml              # Build + deploy Lambda code on merge to main
├── package.json                    # Root pnpm workspace
└── IMPLEMENTATION_PLAN.md
```

---

## Phase 1: Project Scaffolding & Infrastructure Baseline

**Goal:** Establish the monorepo, provision all AWS infrastructure with Terraform, and create the shared TypeScript foundations every subsequent phase builds on.

### 1.1 — Monorepo Setup

- [ ] Install `pnpm` and initialise a workspace with `pnpm-workspace.yaml` listing all `packages/*` and `apps/*`
- [ ] Create `tsconfig.base.json` at root with `strict: true`, `moduleResolution: bundler`, and path aliases for `@insight-engine/*` packages
- [ ] Each package gets its own `tsconfig.json` that extends the base
- [ ] Configure ESLint (with `@typescript-eslint`) and Prettier with a single root config shared across all packages
- [ ] Add root-level `package.json` scripts: `build`, `lint`, `test`, `typecheck`

### 1.2 — Terraform: Remote State Bootstrap

> **Why remote state?** By default Terraform stores a record of what it has created (the "state file") on your local disk. If you lose it or work in a team, things break. We store it in S3 instead, with a DynamoDB table used as a lock so two people can't run `terraform apply` simultaneously.

- [ ] Manually create (once, outside Terraform) a bootstrap S3 bucket and DynamoDB table for state storage — these cannot manage themselves
- [ ] Write `infra/backend.tf` pointing to that S3 bucket and DynamoDB table
- [ ] Write `infra/variables.tf` with input variables: `environment` (dev/prod), `aws_region`, `relevance_threshold`, `digest_schedule`, `monitoring_interval`, plus cost-control toggles: `enable_vpc` (default `false`), `enable_rds` (default `false`), `enable_cloudwatch_dashboard` (default `true`)
- [ ] Write `infra/terraform.tfvars.example` as a committed reference; actual `.tfvars` files are gitignored

### 1.3 — Terraform: Core Infrastructure Modules

Write a Terraform module for each concern below. Each module lives in `infra/modules/<name>/` with its own `main.tf`, `variables.tf`, and `outputs.tf`.

- [ ] **`vpc` module** — **Skeleton only in Phase 1** (gated by `var.enable_vpc`, default `false`). When enabled (Phase 8+): VPC with public and private subnets across 2 AZs; NAT Gateway in the public subnet; Lambda security group (allows all outbound); RDS security group (allows inbound on port 5432 from Lambda SG only). In Phase 1, Lambdas run outside VPC with direct internet access — no NAT Gateway cost (~$32/month saved)
- [ ] **`dynamodb` module** — Create tables:
  - `ContentItems` (PK: `id`, GSI on `sourceUrl` for dedup, GSI on `ingestedAt` for recency queries)
  - `HotTakes` (PK: `id`, GSI on `contentItemId`)
  - `DraftContent` (PK: `id`, GSI on `status` + `createdAt` for digest queries)
  - `PublishingQueue` (PK: `id`, GSI on `platform` + `status`)
  - `Metrics` (PK: `date`, SK: `metricName`)
  - Enable DynamoDB Streams on `DraftContent` and `ContentItems` (needed for Phase 8 RDS sync)
- [ ] **`rds` module** — **Skeleton only in Phase 1** (gated by `var.enable_rds`, default `false`). When enabled (Phase 8+): PostgreSQL 15 `db.t3.micro` instance in a private subnet; security group allowing inbound only from Lambda SG; automated backups enabled; store connection string in SSM. Saves ~$12-15/month when disabled
- [ ] **`sqs` module** — Three queues with Dead Letter Queues (DLQ) attached:
  - `ingestion-queue` → Analyst Lambda (triggered after Watchtower stores a ContentItem)
  - `generation-queue` → Ghostwriter Lambda (triggered after Analyst stores a HotTake)
  - `publish-queue` → Publisher Lambda (triggered after Gatekeeper approves a DraftContent)
  - Platforms supported: Twitter/X and LinkedIn only
- [ ] **`s3` module** — Two buckets: `persona-files` (private, versioning enabled) and `lambda-deployments` (private, holds zipped Lambda code)
- [ ] **`ssm` module** — Create SSM Parameter Store entries as placeholders; values are set manually or by a secrets manager pipeline, never by Terraform. Required parameters:
    - `/insight-engine/{env}/twitter-client-id` — Twitter/X OAuth 2.0 Client ID (from X Developer Console)
    - `/insight-engine/{env}/twitter-client-secret` — Twitter/X OAuth 2.0 Client Secret (confidential client)
    - `/insight-engine/{env}/twitter-access-token` — Twitter/X OAuth 2.0 access token (obtained via Authorization Code Flow with PKCE)
    - `/insight-engine/{env}/twitter-refresh-token` — Twitter/X OAuth 2.0 refresh token (requires `offline.access` scope)
    - `/insight-engine/{env}/linkedin-client-id` — LinkedIn OAuth 2.0 Client ID (from LinkedIn Developer Portal)
    - `/insight-engine/{env}/linkedin-client-secret` — LinkedIn OAuth 2.0 Client Secret
    - `/insight-engine/{env}/linkedin-access-token` — LinkedIn OAuth 2.0 access token (obtained via 3-legged OAuth flow)
    - `/insight-engine/{env}/linkedin-refresh-token` — LinkedIn OAuth 2.0 refresh token (available to approved MDP partners)
- [ ] **`eventbridge` module** — Scheduled rules: hourly (Watchtower), configurable digest (Gatekeeper digest Lambda)
- [ ] **`sns` module** — Admin alert topic; subscription created for admin email address
- [ ] **`lambda` module** — A reusable module that accepts `function_name`, `handler`, `runtime` (default `nodejs20.x`), `environment_variables`, `iam_policy_arns`, and optional `vpc_config` (subnet IDs + security group IDs); creates the Lambda with a placeholder zip, the execution role, and CloudWatch log group. In Phase 1, no Lambdas use `vpc_config` (they run outside VPC). In Phase 8+, Lambdas that access RDS (Analyst, Ghostwriter, Publisher, Sync) **must** pass `vpc_config` pointing to the private subnets and the Lambda security group
- [ ] **`api_gateway` module** — HTTP API (API Gateway v2) with routes for `/api/*` and `/health`; JWT authoriser pointing to Cognito
- [ ] **`cognito` module** — User pool + app client for dashboard authentication
- [ ] **`cloudwatch` module** — Log groups per Lambda, custom metrics namespace `InsightEngine`, alarms for error rate > 5%. CloudWatch Dashboard is gated by `var.enable_cloudwatch_dashboard` (default `true`, saves ~$3/month when disabled)
- [ ] **`bedrock` module** — IAM policy granting `bedrock:InvokeModel` for the specified model IDs; attached to Analyst and Ghostwriter Lambda roles

### 1.4 — Shared Core Package (`packages/core`)

- [ ] Define all shared TypeScript interfaces:
  - `ContentItem`, `RelevanceScore`, `HotTake`, `DraftContent`, `ApprovalDigest`, `PublishingQueueItem`, `PersonaFile`, `OAuthTokenSet`
- [ ] Implement DynamoDB client wrapper (using AWS SDK v3 `@aws-sdk/client-dynamodb` + `@aws-sdk/lib-dynamodb`)
- [ ] Scaffold RDS client wrapper interface and types (implementation deferred to Phase 8 when `enable_rds` is turned on; `pg` and `pg-pool` dependencies are not installed in Phase 1)
- [ ] Implement config loader: reads from env vars → SSM Parameter Store fallback; validates all required fields at startup; throws a descriptive named error for each missing/invalid value
- [ ] Implement structured logger: outputs `{ timestamp, level, component, message, errorDetails? }` as JSON to stdout (CloudWatch picks this up automatically)
- [ ] Scaffold `OAuthTokenManager` in `packages/core/src/oauth.ts`:
  - `OAuthTokenSet` interface: `{ accessToken, refreshToken, expiresAt, platform }`
  - `loadTokens(platform: 'twitter' | 'linkedin'): Promise<OAuthTokenSet>` — reads tokens from SSM; caches in memory
  - `getValidAccessToken(platform): Promise<string>` — returns cached token if not expired (with 5-minute buffer); otherwise calls `refreshAccessToken`
  - `refreshAccessToken(platform): Promise<OAuthTokenSet>` — **scaffold with documented TODOs** for the actual HTTP calls to platform token endpoints. The method signatures, SSM write-back logic, and error handling structure are implemented; the HTTP POST calls to `api.x.com` and `linkedin.com` are left as TODOs with correct URLs, payload shapes, and expected response formats documented in comments. Full implementation in Phase 7.
  - On refresh failure (401/400 from token endpoint): log error, publish SNS alert, throw `OAuthRefreshError` so the Publisher can mark the item as `'failed'`

### 1.5 — Secrets Management for Public Repository

> **This repository is public** (hackathon submission). All secrets must be kept
> out of the codebase entirely. The following rules apply:

- [ ] **GitHub Actions Secrets** — Configure the following repository secrets in GitHub (Settings → Secrets and variables → Actions). These are encrypted at rest, masked in logs, and never exposed in the public repo:
  - `AWS_ACCESS_KEY_ID` — IAM user access key for CI/CD deployments
  - `AWS_SECRET_ACCESS_KEY` — IAM user secret key for CI/CD deployments
  - `AWS_REGION` — Target AWS region (e.g. `ap-south-1`)
  - `AWS_ACCOUNT_ID` — AWS account ID (used for Lambda function ARNs in deploy)
- [ ] **AWS SSM Parameter Store** — All application secrets (OAuth tokens, DB credentials) live exclusively in AWS SSM as `SecureString`. They are never referenced in source code, environment variables, or Terraform state. Lambdas read them at runtime via the AWS SDK:
  - `/insight-engine/{env}/twitter-client-id`
  - `/insight-engine/{env}/twitter-client-secret`
  - `/insight-engine/{env}/twitter-access-token`
  - `/insight-engine/{env}/twitter-refresh-token`
  - `/insight-engine/{env}/linkedin-client-id`
  - `/insight-engine/{env}/linkedin-client-secret`
  - `/insight-engine/{env}/linkedin-access-token`
  - `/insight-engine/{env}/linkedin-refresh-token`
  - `/insight-engine/{env}/rds-connection-string`
- [ ] **`.gitignore` enforcement** — The following files are gitignored and must never be committed:
  - `terraform.tfvars` (real Terraform variable values)
  - `.env` / `.env.*` (local environment files)
  - `*.tfstate` / `*.tfstate.*` (Terraform state files contain resource details)
  - `.terraform/` (Terraform provider cache)
- [ ] **Only example/placeholder files are committed:**
  - `terraform.tfvars.example` — placeholder values, no real secrets
  - `.env.example` — documents required env vars without real values
  - `persona.example.json` — safe, contains no credentials
- [ ] **Terraform SSM module** — The `infra/modules/ssm` module creates SSM parameter paths as empty placeholders only. Real secret values are set manually via the AWS CLI or Console after `terraform apply`, never by Terraform itself. This ensures secrets never appear in Terraform state or plan output.
- [ ] **RDS credentials** — The RDS master password is set via a Terraform variable that reads from a `TF_VAR_rds_master_password` environment variable on the operator's machine (or GitHub Actions Secret for CI). It is never hardcoded in `.tf` files or committed to the repo.

### 1.6 — CI/CD Pipelines

- [ ] `ci.yml`: triggers on every PR → runs `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `terraform validate` + `terraform plan` (plan output posted as PR comment). AWS credentials are injected from GitHub Actions Secrets using `aws-actions/configure-aws-credentials`. Terraform plan output must be reviewed to ensure no secrets are leaked in resource attributes.
- [ ] `deploy.yml`: triggers on merge to `main` → builds each Lambda package, zips the output, uploads to the `lambda-deployments` S3 bucket, runs `aws lambda update-function-code` for each function. AWS credentials are injected from GitHub Actions Secrets — never hardcoded in the workflow YAML. Terraform `apply` is a separate manual or environment-gated step.

### 1.7 — Cost Control & AWS Teardown Scripts

> **Estimated idle cost with Phase 1 defaults:** ~$0-3/month (DynamoDB, SQS, Lambda, API Gateway, Cognito, EventBridge all have generous free tiers or charge per-request only). The only potential fixed cost is CloudWatch Dashboard (~$3/month if enabled).

- [ ] **`scripts/teardown.sh`** — Runs `terraform destroy` with environment argument and safety confirmation prompts. Usage: `./scripts/teardown.sh dev`. Extra confirmation required for `prod`.
- [ ] **`scripts/pause.sh`** — Disables EventBridge scheduled rules (stops Watchtower and digest Lambda invocations). When RDS is enabled (Phase 8+), also stops the RDS instance. Usage: `./scripts/pause.sh dev` or `./scripts/pause.sh dev --full` (full also removes NAT Gateway if VPC is enabled).
- [ ] **`scripts/resume.sh`** — Re-enables EventBridge rules. When RDS is enabled, starts the RDS instance. If NAT Gateway was removed, runs a targeted `terraform apply` to recreate it. Usage: `./scripts/resume.sh dev`.
- [ ] **Cost-control toggle variables** in `infra/variables.tf`:
  - `enable_vpc` (default `false`) — skips VPC, NAT Gateway, subnets (~$32/month saved)
  - `enable_rds` (default `false`) — skips RDS PostgreSQL instance (~$12-15/month saved)
  - `enable_cloudwatch_dashboard` (default `true`) — skips CloudWatch Dashboard (~$3/month saved)
  - These toggles use `count` conditionals in the respective Terraform modules
- [ ] **Phase 8 upgrade path:** When RDS/history features are needed, set `enable_vpc = true` and `enable_rds = true` in `terraform.tfvars` and run `terraform apply`. All module wiring is pre-built; only the resources themselves are conditionally created.

> **Note:** AWS auto-starts stopped RDS instances after 7 days. If using pause/resume with RDS, re-run `pause.sh` weekly or use `terraform destroy` for extended idle periods.

### Validation — Phase 1

- [ ] `pnpm -r build` compiles all packages with zero TypeScript errors
- [ ] `pnpm -r lint` passes with zero warnings
- [ ] `terraform init` completes; state is confirmed stored in the remote S3 bucket
- [ ] `terraform validate` passes on the full `infra/` directory
- [ ] `terraform plan` produces a valid plan showing all resources; zero errors
- [ ] `terraform apply` (dev environment) completes; all DynamoDB tables, SQS queues, S3 buckets, Lambda shells, and API Gateway are visible in the AWS console (VPC and RDS are skipped by default; CloudWatch Dashboard is optional)
- [ ] Config loader unit test: valid config object is returned; removing a required env var throws an error naming exactly which variable is missing
- [ ] `terraform destroy` cleanly removes all resources with no orphaned dependencies
- [ ] `scripts/teardown.sh dev` prompts for confirmation and runs `terraform destroy` successfully
- [ ] `scripts/pause.sh dev` disables all EventBridge rules; Lambda invocations stop
- [ ] `scripts/resume.sh dev` re-enables EventBridge rules; scheduled Lambda invocations resume

---

## Phase 2: Persona Configuration System

**Goal:** Define, validate, and load the `PersonaFile` that drives tone, filtering, and content generation across all components.

### Todos

- [ ] Design the `PersonaFile` JSON schema with all required fields:
  ```json
  {
    "tone": "formal | casual | technical | humorous",
    "expertise_topics": ["string"],
    "heroes": [{ "name": "string", "description": "string" }],
    "enemies": [{ "name": "string", "description": "string" }],
    "platform_preferences": {
      "twitter":  { "max_thread_length": 10, "hashtags": true, "emoji": false },
      "linkedin": { "hashtags": true, "emoji": false }
    },
    "relevance_threshold": 60,
    "digest_schedule": "daily | twice-daily | weekly",
    "monitoring_interval": "hourly | every-6h | daily"
  }
  ```
- [ ] Implement schema validation using `zod` in `packages/core`; every field has a descriptive error message
- [ ] Write a `loadPersona(source: 'S3' | 'local', path: string)` function: fetches the file, parses JSON, runs zod validation, returns a typed `PersonaFile`
- [ ] Create `persona.example.json` at repo root as the starter reference file
- [ ] Add Terraform resource in `infra/modules/s3` to upload `persona.example.json` to the persona bucket on `terraform apply`
- [ ] Unit tests: valid persona → typed object returned; missing `tone` → zod error names the field; invalid `relevance_threshold` (> 100) → zod error with range message; invalid platform enum → zod error

### Validation — Phase 2

- [ ] Load `persona.example.json` from disk → no errors, typed `PersonaFile` object returned with correct field values
- [ ] Delete the `tone` field → loader throws with message referencing `tone` specifically
- [ ] Set `relevance_threshold: 150` → loader throws with a range validation message
- [ ] All 4 unit tests pass in CI

---

## Phase 3: Watchtower — Content Ingestion

**Goal:** Monitor RSS feeds, arXiv, and Twitter/X; extract metadata; deduplicate; persist `ContentItem` records; and enqueue items for scoring.

### Todos

- [ ] Implement `packages/watchtower` Lambda handler with three source monitors:
  - **RSS**: use `rss-parser`; fetch from a configurable list of feed URLs stored in the persona file or SSM; extract `title`, `author`, `publicationDate`, `sourceUrl`, `summary`
  - **arXiv**: call `http://export.arxiv.org/api/query` with configurable `categories` and `max_results`; parse Atom XML into `ContentItem` shape using `fast-xml-parser`
  - **Twitter/X**: use Twitter API v2 search endpoint; search for terms derived from `persona.expertise_topics`; extract tweet text, author, and URL
- [ ] Wrap each source monitor in an independent `try/catch`; on failure log `{ component: 'Watchtower', source, error }` and continue to the next source — a single broken feed must never crash the Lambda
- [ ] Implement deduplication: before storing, query DynamoDB `ContentItems` GSI on `sourceUrl`; if a match exists set `isDuplicate: true` and skip further processing
- [ ] Persist each new `ContentItem` to DynamoDB with fields: `id` (UUID), `title`, `author`, `publicationDate`, `sourceUrl`, `fullText`, `source`, `ingestedAt`, `isDuplicate`
- [ ] After storing, publish the `id` to SQS `ingestion-queue` for the Analyst to pick up
- [ ] Add Terraform EventBridge rule in `infra/modules/eventbridge` targeting this Lambda on the configured `monitoring_interval`
- [ ] Unit tests: RSS parser produces correct `ContentItem` shape; arXiv parser handles multi-author entries; dedup logic returns `isDuplicate: true` for a known URL; SQS publish is called after storage
- [ ] Integration test against the arXiv public API with a known category (e.g. `cs.AI`)

### Validation — Phase 3

- [ ] Invoke the Watchtower Lambda manually from the AWS console → at least one `ContentItem` record appears in DynamoDB within 30 seconds
- [ ] At least one item `id` appears in the `ingestion-queue` SQS queue
- [ ] Introduce an invalid RSS URL in config → Lambda logs the error for that source and still processes remaining sources; no Lambda crash; CloudWatch shows the error log entry
- [ ] Invoke the Lambda twice with the same sources → second run produces no new DynamoDB records; duplicate items have `isDuplicate: true`
- [ ] All unit tests pass; integration test returns at least one parsed arXiv item

---

## Phase 4: Analyst — Relevance Scoring & Hot Take Generation

**Goal:** Score each `ContentItem` against the persona using AWS Bedrock; filter low-relevance items; generate `HotTake` variations for high-scoring items.

### Todos

- [ ] Implement `packages/analyst` as an SQS-triggered Lambda (batch size 1 for predictable error handling):
  - Read `contentItemId` from the SQS message
  - Fetch the `ContentItem` from DynamoDB
  - Load the `PersonaFile` from S3

- [ ] Implement scoring via AWS Bedrock (Claude Sonnet via `@aws-sdk/client-bedrock-runtime`):
  - Construct a prompt that provides the article summary, the persona's `expertise_topics`, and asks for a score 0–100 with reasoning
  - Apply recency decay: items older than 72 hours have their raw score multiplied by `0.7`
  - Parse the integer score from the model response with a fallback to 0 on parse failure
  - On any Bedrock API error: log the error, set score to 0, do not generate a hot take

- [ ] Implement threshold filter: if `score < persona.relevance_threshold`, update DynamoDB item with `relevanceScore` and `status: 'filtered'`; do not proceed to hot take generation

- [ ] Implement trend detection: query the last 48 hours of `ContentItems` from DynamoDB; cluster by topic overlap with the current item; if 3 or more recent items share the same topic cluster, set `isTrending: true` on the current item

- [ ] Implement `HotTake` generation via Bedrock for items that pass the threshold:
  - Prompt includes: persona tone, expertise, heroes/enemies list, article summary
  - Request exactly 2 variations in a single structured prompt (JSON array response)
  - Validate each variation is between 50–300 words; if not, re-prompt once with a corrective instruction specifying the required word count
  - Store each variation as a separate `HotTake` record in DynamoDB with `id`, `contentItemId`, `text`, `wordCount`, `variationIndex`, `createdAt`

- [ ] After storing `HotTake` records, publish each `hotTakeId` to SQS `generation-queue` for the Ghostwriter

- [ ] Unit tests: scoring prompt construction; recency decay calculation; threshold filter logic; word count validation; variation re-prompt logic; error → score 0 behaviour

### Validation — Phase 4

- [ ] Post a `ContentItem` ID to the `ingestion-queue` for a clearly on-topic article → two `HotTake` records appear in DynamoDB; both have `wordCount` between 50 and 300
- [ ] Both `hotTakeId` values appear in the `generation-queue` SQS queue
- [ ] Post an item clearly outside the persona's topics → `relevanceScore` is below threshold; no `HotTake` records created; DynamoDB item shows `status: 'filtered'`
- [ ] Mock Bedrock to return a 500 error → `relevanceScore` is 0 in DynamoDB; CloudWatch log shows `component: 'Analyst'`, `level: 'error'`; Lambda does not crash; SQS message is not retried to DLQ
- [ ] Insert 3 items with overlapping topics into DynamoDB (backdated within 48h) then process a 4th matching item → 4th item has `isTrending: true`

---

## Phase 5: Ghostwriter — Platform-Specific Content Generation

**Goal:** Transform each `HotTake` into Twitter thread and LinkedIn post drafts using AWS Bedrock; enforce format constraints; persist as `DraftContent`.

### Todos

- [ ] Implement `packages/ghostwriter` as an SQS-triggered Lambda (`generation-queue`):
  - Read `hotTakeId` from the SQS message
  - Fetch the `HotTake` and its parent `ContentItem` from DynamoDB
  - Load the `PersonaFile` from S3

- [ ] Implement two Bedrock-powered generators, each as a separate function:
  - **Twitter/X generator**:
    - Prompt: transform the hot take into a numbered Twitter thread; each tweet ≤ 280 characters; apply hashtags and emoji per persona preferences; final tweet includes source URL
    - Parse response into `string[]` (array of tweets)
    - Validate: every tweet ≤ 280 characters; if any tweet exceeds the limit, re-prompt once with the offending tweet highlighted
  - **LinkedIn generator**:
    - Prompt: professional LinkedIn post; 1300–2000 characters; include persona hashtags if enabled; end with source attribution
    - Validate: character count between 1300 and 2000; re-prompt once if outside range

- [ ] Apply `PersonaFile.platform_preferences` to every generator before prompting

- [ ] Create a `DraftContent` record in DynamoDB for each platform: `id`, `hotTakeId`, `contentItemId`, `platform` (`twitter` | `linkedin`), `content` (JSON string), `status: 'pending_approval'`, `createdAt`

- [ ] Unit tests: tweet length validation and re-prompt trigger; LinkedIn character count bounds; source attribution present in both outputs; persona preferences applied (hashtags, emoji)

### Validation — Phase 5

- [ ] Post a `hotTakeId` to the `generation-queue` → 2 `DraftContent` records appear in DynamoDB (one per platform) with `status: 'pending_approval'`
- [ ] Twitter draft: no individual tweet exceeds 280 characters; tweets are numbered (e.g. `1/`, `2/`); source URL is in the final tweet
- [ ] LinkedIn draft: `content.length` is between 1300 and 2000 characters
- [ ] Persona preference test: set `emoji: false` in persona → no emoji characters appear in any draft; set `hashtags: false` → no `#` tokens in LinkedIn or Twitter output

---

## Phase 6: Gatekeeper — Human Approval Interface

**Goal:** Build the Next.js dashboard and Lambda API backend for compiling digests, reviewing drafts, and routing approvals/rejections to the publishing queue.

### 6.1 — API Lambda (`packages/gatekeeper`)

- [ ] Implement the following API handlers (deployed as a single Lambda behind API Gateway HTTP API):
  - `GET /api/digest` — query DynamoDB `DraftContent` GSI for all items with `status: 'pending_approval'`; group by `contentItemId`; enrich each group with the parent `ContentItem` and `HotTake`; return as `ApprovalDigest[]`
  - `POST /api/approve` — body: `{ draftContentId }` → update status to `'approved'`; write a new `PublishingQueueItem` to DynamoDB `PublishingQueue`; publish `publishingQueueItemId` to SQS `publish-queue`
  - `POST /api/reject` — body: `{ draftContentId }` → update status to `'rejected'`
  - `POST /api/edit-approve` — body: `{ draftContentId, editedContent }` → store edited content; update status to `'approved'`; write to `PublishingQueue`; publish to SQS `publish-queue`
  - `GET /health` — returns component status (see Phase 9)

- [ ] All routes protected by Cognito JWT authoriser (configured in API Gateway via Terraform)

### 6.2 — Digest Compilation Lambda

- [ ] Implement a separate EventBridge-triggered Lambda that runs on the `digest_schedule` from the persona:
  - Queries DynamoDB for all `pending_approval` drafts since the last digest
  - Sends an HTML email via AWS SES: summary table with item count and a "Review Digest" link to the dashboard
  - Logs digest compilation metrics to CloudWatch

### 6.3 — Next.js Dashboard (`apps/dashboard`)

- [ ] Implement App Router pages:
  - `/` — redirect to `/digest`
  - `/digest` — list view: card per `ContentItem` showing title, source, relevance score, number of drafts pending; each card links to the detail view
  - `/digest/[contentItemId]` — detail view: original article summary, hot take text, and two side-by-side panels (Twitter thread preview, LinkedIn preview); each panel has Approve, Reject, and Edit buttons
  - `/history` — searchable table (Phase 8)

- [ ] Implement client-side state: optimistic UI updates on approve/reject (item fades out); error toast on API failure

- [ ] Authenticate via Cognito hosted UI; store JWT in `httpOnly` cookie; middleware checks token on every route

- [ ] Deploy to Vercel (simplest for Next.js) or as a Lambda@Edge function; Terraform outputs the API Gateway base URL as an env var injected into the Next.js build

- [ ] Unit tests: API route handlers with mocked DynamoDB; React component tests for digest card and detail view using `@testing-library/react`

### Validation — Phase 6

- [ ] Open `/digest` in a browser → all pending draft items are listed; each shows the source title and platform badges
- [ ] Click a digest item → detail view shows the original article summary, hot take, and both platform draft previews
- [ ] Approve a Twitter draft → status updates to `'approved'` in DynamoDB; a `PublishingQueueItem` record appears in DynamoDB; the item disappears from the digest list on refresh
- [ ] Reject a LinkedIn draft → status updates to `'rejected'`; item no longer appears in the pending digest
- [ ] Edit a LinkedIn draft, change the text, and save → edited content is stored in DynamoDB; original `HotTake` text is unchanged; status is `'approved'`
- [ ] Trigger the digest Lambda manually → SES send log appears in CloudWatch (or email arrives); log shows correct item count
- [ ] Access `/digest` without a valid JWT → redirected to Cognito login page

---

## Phase 7: Publisher — Social Media Publishing

**Goal:** Publish approved content to Twitter/X and LinkedIn; authenticate via OAuth 2.0; enforce rate limits; retry on failure; notify on permanent failure.

### Todos

- [ ] Implement `packages/publisher` as an SQS-triggered Lambda (`publish-queue`):
  - Read `publishingQueueItemId` from SQS message
  - Fetch `PublishingQueueItem` from DynamoDB; fetch the associated `DraftContent`
  - Load platform OAuth credentials from SSM Parameter Store at Lambda initialisation (outside the handler, so credentials are cached across warm invocations)

- [ ] Implement Twitter/X OAuth 2.0 authentication (Authorization Code Flow with PKCE):
  - **App type:** Confidential client (Web App / Automated App) registered in the [X Developer Console](https://console.x.com)
  - **Required scopes:** `tweet.read`, `tweet.write`, `users.read`, `offline.access`
    - `tweet.write` — required for `POST /2/tweets`
    - `offline.access` — required to obtain a refresh token for unattended token renewal
  - **Initial token acquisition:** One-time manual flow — direct the operator to the authorize URL:
    ```
    https://x.com/i/oauth2/authorize?response_type=code&client_id={CLIENT_ID}
      &redirect_uri={CALLBACK_URL}&scope=tweet.read%20tweet.write%20users.read%20offline.access
      &state={RANDOM}&code_challenge={CHALLENGE}&code_challenge_method=S256
    ```
    Exchange the returned authorization code for an access token + refresh token via `POST https://api.x.com/2/oauth2/token` (grant_type=authorization_code)
  - **Token lifetimes:** Access token = 2 hours; refresh token = indefinite (as long as `offline.access` scope was granted)
  - **Token refresh:** Before each publish attempt, check if the access token is expired; if so, call `POST https://api.x.com/2/oauth2/token` with `grant_type=refresh_token` and the stored refresh token; persist the new access token and refresh token back to SSM
  - **SSM parameters:**
    - `/insight-engine/{env}/twitter-client-id`
    - `/insight-engine/{env}/twitter-client-secret` (SecureString)
    - `/insight-engine/{env}/twitter-access-token` (SecureString)
    - `/insight-engine/{env}/twitter-refresh-token` (SecureString)
  - **Auth header:** All Twitter API calls use `Authorization: Bearer {access_token}`

- [ ] Implement LinkedIn OAuth 2.0 authentication (3-Legged Authorization Code Flow):
  - **App setup:** Register in the [LinkedIn Developer Portal](https://www.linkedin.com/developers/apps); configure redirect URL; request the required product access (Marketing Developer Platform for Posts API)
  - **Required scopes:** `w_member_social` (post on behalf of a member) or `w_organization_social` (post on behalf of an organization page)
    - For organization posting, the authenticated member must have ADMINISTRATOR or CONTENT_ADMIN role on the company page
  - **Initial token acquisition:** One-time manual flow — direct the operator to:
    ```
    https://www.linkedin.com/oauth/v2/authorization?response_type=code
      &client_id={CLIENT_ID}&redirect_uri={CALLBACK_URL}
      &scope=w_member_social&state={RANDOM}
    ```
    Exchange the returned authorization code for an access token via `POST https://www.linkedin.com/oauth/v2/accessToken` (grant_type=authorization_code, Content-Type: x-www-form-urlencoded)
  - **Token lifetimes:** Access token = 60 days; refresh token = 365 days (available to approved MDP partners only)
  - **Token refresh:** Before each publish attempt, check if the access token is expired; if so, call `POST https://www.linkedin.com/oauth/v2/accessToken` with `grant_type=refresh_token`, `refresh_token`, `client_id`, and `client_secret`; persist the new access token back to SSM
  - **SSM parameters:**
    - `/insight-engine/{env}/linkedin-client-id`
    - `/insight-engine/{env}/linkedin-client-secret` (SecureString)
    - `/insight-engine/{env}/linkedin-access-token` (SecureString)
    - `/insight-engine/{env}/linkedin-refresh-token` (SecureString)
  - **Auth header:** All LinkedIn API calls use `Authorization: Bearer {access_token}` plus required headers `X-Restli-Protocol-Version: 2.0.0` and `Linkedin-Version: {YYYYMM}`

- [ ] Implement OAuth token manager in `packages/core`:
  - `OAuthTokenManager` class that handles token loading, expiry checking, refresh, and SSM persistence for both platforms
  - On cold start, load tokens from SSM; cache in memory for warm invocations
  - Before each API call, check token expiry; if expired or within a 5-minute buffer, refresh proactively
  - On refresh failure (e.g. refresh token revoked), log error with `{ component: 'Publisher', platform, error }` and publish SNS admin alert — operator must re-authorize manually
  - Unit tests: token expiry detection; refresh flow with mocked HTTP responses; SSM write on refresh; refresh failure triggers SNS alert

- [ ] Implement rate limit enforcement:
  - Before publishing, query DynamoDB `PublishingQueue` GSI for the most recent `published` item on the same `platform`
  - If `lastPublishedAt` is less than 1 hour ago, delay by publishing the SQS message back with a visibility timeout set to the remaining wait time

- [ ] Implement platform publishers:
  - **Twitter/X**: authenticate with OAuth 2.0 Bearer token; use `POST https://api.x.com/2/tweets` to post each tweet in the thread sequentially (each subsequent tweet uses `reply.in_reply_to_tweet_id` to chain); store each tweet ID; use the first tweet's ID as `platformPostId`
  - **LinkedIn**: authenticate with OAuth 2.0 Bearer token; use `POST https://api.linkedin.com/rest/posts` with headers `X-Restli-Protocol-Version: 2.0.0` and `Linkedin-Version: {YYYYMM}`; set `author` to the member or organization URN, `visibility: PUBLIC`, `distribution.feedDistribution: MAIN_FEED`, `lifecycleState: PUBLISHED`; store the returned `x-restli-id` header value as `platformPostId`

- [ ] Implement retry logic: wrap each platform API call in a retry loop; up to 3 attempts; delays of 1s, 2s, 4s (exponential backoff); catch only transient errors (5xx, network timeout); do not retry 4xx auth errors — on 401 Unauthorized, attempt one token refresh before marking as permanent failure

- [ ] On permanent failure (3 retries exhausted):
  - Update `PublishingQueueItem` status to `'failed'` in DynamoDB
  - Publish an alert to the SNS admin topic with the item ID, platform, and error message
  - Do NOT throw from the Lambda handler (prevents unnecessary SQS retry loops for known permanent failures)

- [ ] On success:
  - Update `PublishingQueueItem` with `status: 'published'`, `publishedAt`, `platformPostUrl`
  - Write the published post record to RDS PostgreSQL `published_posts` table (id, platform, content snippet, url, publishedAt, contentItemId)

- [ ] Unit tests: OAuth token refresh flow; rate limit check logic; retry loop with mock 500 responses; 401 triggers token refresh then retry; exponential backoff timing; permanent failure → SNS publish called; success → DynamoDB and RDS updated

### Validation — Phase 7

- [ ] Approve a Twitter draft in the dashboard → tweet thread appears live on the configured Twitter account within 2 minutes; `PublishingQueueItem` shows `status: 'published'` and tweet URLs in DynamoDB
- [ ] Approve a LinkedIn draft → post appears on the test LinkedIn account; DynamoDB record updated with `platformPostId` returned from LinkedIn Posts API
- [ ] Mock the Twitter API to return HTTP 500: Lambda retries 3 times (verify via CloudWatch logs showing 3 attempts); after final failure, SNS alert is sent; DynamoDB item shows `status: 'failed'`
- [ ] Approve two Twitter items within 1 hour → second item's SQS message is re-queued with a visibility delay; first item is published; second item is published after the 1-hour window
- [ ] Set a deliberately expired Twitter access token in SSM → Publisher automatically refreshes the token via the refresh token flow, publishes successfully, and writes the new access token back to SSM
- [ ] Set an invalid/revoked refresh token in SSM → Publisher logs `{ component: 'Publisher', platform: 'twitter', error }`, publishes an SNS admin alert, and marks the item as `'failed'` — no crash
- [ ] Set a deliberately expired LinkedIn access token in SSM → Publisher refreshes via the LinkedIn refresh token endpoint, publishes successfully, and persists the new token to SSM

---

## Phase 8: History, Search & Duplicate Detection

**Goal:** Provide a queryable content history across all pipeline stages and flag near-duplicate ingested items using semantic embeddings.

### Todos

- [ ] Design and apply RDS PostgreSQL schema (use `node-pg-migrate` for versioned migrations):
  ```sql
  content_items   (id, title, source_url, ingested_at, relevance_score, is_duplicate, fts_vector tsvector)
  hot_takes       (id, content_item_id FK, text, word_count, variation_index, created_at)
  draft_content   (id, hot_take_id FK, platform, status, created_at)
  published_posts (id, draft_content_id FK, platform, platform_url, published_at, content_item_id FK)
  embeddings      (id, content_item_id FK, vector float8[], created_at)
  ```
  - Add GIN index on `fts_vector` for full-text search
  - Add index on `published_posts.platform` and `published_posts.published_at`

- [ ] Implement DynamoDB Streams sync Lambda:
  - Triggered by DynamoDB Streams on `ContentItems` and `DraftContent` tables
  - On INSERT or MODIFY events, upsert the record into the corresponding RDS table
  - Update `fts_vector` column using PostgreSQL `to_tsvector('english', title || ' ' || content_snippet)`

- [ ] Implement semantic duplicate detection in the Watchtower (called before storing a new `ContentItem`):
  - Generate an embedding for the new item's text using AWS Bedrock Titan Embeddings model (`amazon.titan-embed-text-v1`)
  - Query RDS `embeddings` table for the 500 most recent vectors
  - Compute cosine similarity between the new vector and each stored vector
  - If any similarity score > 0.85, set `isDuplicate: true` and log the matching `contentItemId`
  - Store the new embedding in RDS `embeddings` table regardless of duplicate status

- [ ] Implement `GET /api/history` Lambda handler with query params:
  - `?topic=<string>` — full-text search on `fts_vector`
  - `?platform=<twitter|linkedin>` — filter by platform
  - `?from=<ISO date>&to=<ISO date>` — date range on `published_at`
  - Returns paginated results (default 20 per page) with `total`, `page`, `results[]`

- [ ] Add `/history` page to the Next.js dashboard:
  - Search bar + platform dropdown + date range picker
  - Results table: title, platform, published date, link to platform post
  - Client-side pagination

- [ ] Unit tests: cosine similarity function; full-text search query construction; date range filter; DynamoDB Streams event handler for INSERT vs MODIFY

### Validation — Phase 8

- [ ] Ingest two articles from the same story (different URLs, same key sentences) → second item has `isDuplicate: true` in DynamoDB; CloudWatch log shows the matching `contentItemId`
- [ ] `GET /api/history?topic=machine+learning` → returns only items whose `fts_vector` matches the search term
- [ ] `GET /api/history?platform=twitter` → returns only Twitter published posts- [ ] `GET /api/history?from=2026-01-01&to=2026-01-31` → returns only items within that date range; items outside the range are absent
- [ ] Open `/history` in the dashboard → published posts load with correct titles, platforms, dates, and working platform links

---

## Phase 9: Error Handling, Monitoring & Health Check

**Goal:** Implement structured logging, custom CloudWatch metrics, admin alerting, and a `/health` endpoint across all components.

### Todos

- [ ] Extend the `logger` in `packages/core` to include `component` and optional `errorDetails` fields; ensure every Lambda imports and uses this logger exclusively (no bare `console.log` calls)

- [ ] Implement a `metrics` module in `packages/core`:
  - Wraps AWS SDK `PutMetricData` to emit custom CloudWatch metrics under namespace `InsightEngine`
  - Metric names: `ContentItemsIngested`, `HotTakesGenerated`, `DraftContentCreated`, `PostsPublished`, `ApprovalRate`
  - Called at the end of each Lambda handler with the count for that invocation

- [ ] Add CloudWatch Alarms (via Terraform `cloudwatch` module):
  - Lambda error rate > 5% on any function → SNS admin alert
  - DynamoDB throttled requests > 10 in 5 minutes → SNS admin alert
  - RDS connection failure (custom metric emitted by sync Lambda) → SNS admin alert

- [ ] Implement `GET /health` API route in the Gatekeeper Lambda:
  ```json
  {
    "status": "healthy | degraded",
    "timestamp": "ISO8601",
    "components": {
      "dynamodb": "healthy | unhealthy",
      "rds": "healthy | unhealthy",
      "bedrock": "healthy | unhealthy",
      "sqs": "healthy | unhealthy"
    }
  }
  ```
  - DynamoDB: attempt a `DescribeTable` call
  - RDS: attempt a `SELECT 1` query with a 2-second timeout
  - Bedrock: attempt a `ListFoundationModels` call
  - SQS: attempt a `GetQueueAttributes` call
  - Overall `status` is `'degraded'` if any component is `'unhealthy'`

- [ ] Create a CloudWatch Dashboard (via Terraform) with widgets for: Lambda invocation counts, Lambda error rates, DynamoDB read/write capacity, SQS queue depth, custom `InsightEngine` metrics

- [ ] Unit tests: `GET /health` returns correct shape; unhealthy component returns `'degraded'` overall status; metrics module emits correct metric names and values

### Validation — Phase 9

- [ ] `GET /health` with all services running → `{ status: 'healthy' }` with all components green; HTTP 200
- [ ] Set DynamoDB endpoint to an invalid URL in env → `GET /health` returns `{ status: 'degraded', components: { dynamodb: 'unhealthy' } }`; other components still report correctly; HTTP 200 (health check itself does not 500)
- [ ] Trigger a scoring failure intentionally → CloudWatch log entry contains `{ component: 'Analyst', level: 'error', errorDetails: { ... } }` with a timestamp
- [ ] Open the CloudWatch Dashboard → all widgets display non-zero data for `ContentItemsIngested` and `HotTakesGenerated`
- [ ] Trigger Lambda error rate > 5% (deploy a broken handler temporarily) → SNS notification received within 5 minutes

---

## Phase 10: End-to-End Integration & Deployment Hardening

**Goal:** Wire all pipeline stages together, run a full end-to-end smoke test, harden security, and finalise deployment configuration.

### 10.1 — Full Pipeline Wiring

Confirm all event flow connections are active and correctly configured in Terraform:

```
EventBridge (hourly)
  → Watchtower Lambda
    → DynamoDB ContentItems
    → SQS ingestion-queue
      → Analyst Lambda
        → DynamoDB HotTakes
        → SQS generation-queue
          → Ghostwriter Lambda
            → DynamoDB DraftContent

EventBridge (digest schedule)
  → Gatekeeper Digest Lambda
    → SES email + Dashboard update

Dashboard Approve action
  → API Gateway → Gatekeeper Lambda
    → DynamoDB PublishingQueue
    → SQS publish-queue
      → Publisher Lambda
        → Twitter / LinkedIn APIs
        → RDS published_posts
        → DynamoDB PublishingQueue (status: published)

DynamoDB Streams (ContentItems, DraftContent)
  → Sync Lambda
    → RDS (full-text search + history)
```

### 10.2 — Security Hardening

- [ ] Audit all Lambda IAM roles: each role must have only the permissions it needs (principle of least privilege); no wildcard `*` actions on DynamoDB or S3
- [ ] Confirm all secrets are in SSM Parameter Store with `SecureString` type; no API keys in environment variables, Terraform state, or source code
- [ ] RDS instance is in a private subnet with no public endpoint; only the Lambda security group has inbound access
- [ ] S3 buckets have `BlockPublicAccess` enabled; bucket policies deny non-HTTPS requests
- [ ] API Gateway has request throttling configured (e.g. 100 req/s burst limit)
- [ ] Enable AWS CloudTrail for all API calls in the account

### 10.3 — Configuration & Deployment Modes

- [ ] Verify `terraform.tfvars` supports `environment = "dev"` and `environment = "prod"` with separate DynamoDB table prefixes, separate SQS queues, and separate Cognito user pools
- [ ] Document the local development mode: run `serverless-offline` or `sam local` for Lambda testing; use LocalStack for DynamoDB/SQS/S3; connect to a local PostgreSQL instance
- [ ] Confirm EventBridge intervals are driven by the `monitoring_interval` Terraform variable and persona file value respectively, not hardcoded
- [ ] Validate all configuration values at Lambda cold-start via the `core` config loader; any invalid value halts startup with a descriptive error

### 10.4 — Load & Smoke Testing

- [ ] Load test: use a script to ingest 100 `ContentItem` events simultaneously into the `ingestion-queue`; verify all 100 items are processed, no DLQ messages accumulate, and DynamoDB item counts are correct
- [ ] Smoke test script: a single shell/TypeScript script that triggers the full pipeline and asserts each stage completed successfully (checks DynamoDB record counts at each stage)

### Validation — Phase 10 (Full End-to-End)

- [ ] Trigger the Watchtower Lambda → within 5 minutes, `HotTake` records exist in DynamoDB for items scoring above the relevance threshold
- [ ] Open the dashboard → at least one `DraftContent` item is visible in the digest with correct source metadata
- [ ] Approve a Twitter draft in the dashboard → within 2 minutes the tweet thread is live on the configured Twitter account; `PublishingQueueItem` in DynamoDB shows `status: 'published'` with tweet URLs
- [ ] `GET /health` returns `{ status: 'healthy' }` for all components
- [ ] `GET /api/history?platform=twitter` returns the newly published tweet with its live URL and correct timestamp- [ ] CloudWatch Dashboard shows non-zero metric values for all five `InsightEngine` custom metrics
- [ ] Load test: 100 items ingested → 100 DynamoDB records created; SQS DLQ is empty; no Lambda errors in CloudWatch
- [ ] `terraform destroy` on the dev environment removes all resources cleanly

---

## Summary Table

| Phase | Component | Key Technologies |
|---|---|---|
| 1 | Scaffolding & Infra | pnpm workspaces, TypeScript, Terraform (with cost toggles), CDK-free AWS, GitHub Actions, vitest |
| 2 | Persona Config | `zod`, S3, JSON Schema |
| 3 | Watchtower (Ingestion) | Lambda, `rss-parser`, arXiv API, Twitter API v2, DynamoDB, SQS |
| 4 | Analyst (Scoring + Hot Takes) | Lambda, AWS Bedrock (Claude), DynamoDB, SQS |
| 5 | Ghostwriter (Content Gen) | Lambda, AWS Bedrock (Claude), DynamoDB, SQS |
| 6 | Gatekeeper (Approval UI) | Next.js App Router, Lambda, API Gateway, Cognito, SES |
| 7 | Publisher (Social APIs) | Lambda, SQS, SNS, SSM, Twitter API v2, LinkedIn Posts API (/rest/posts) |
| 8 | History & Search | RDS PostgreSQL, DynamoDB Streams, Bedrock Titan Embeddings, full-text search |
| 9 | Monitoring & Health | CloudWatch Logs/Metrics/Alarms/Dashboard, SNS, structured logging |
| 10 | E2E Integration | All of the above, LocalStack (dev), load testing |

---

## Terraform Quick Reference

> Cheat sheet for running Terraform day-to-day.

```bash
# First time setup (run once)
cd infra
terraform init

# Preview what will change (safe — makes no changes)
terraform plan -var-file="dev.tfvars"

# Apply changes to dev environment
terraform apply -var-file="dev.tfvars"

# Apply changes to prod environment
terraform apply -var-file="prod.tfvars"

# Tear down dev environment (destructive!)
terraform destroy -var-file="dev.tfvars"

# See what Terraform currently knows about your infrastructure
terraform show

# List all managed resources
terraform state list
```

```bash
# Deploy Lambda code only (no Terraform needed — runs in CI automatically)
pnpm -r build
cd packages/watchtower && zip -r ../../dist/watchtower.zip dist/
aws lambda update-function-code \
  --function-name insight-engine-dev-watchtower \
  --zip-file fileb://dist/watchtower.zip
```
