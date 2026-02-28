#!/usr/bin/env bash
# teardown.sh — Full terraform destroy with safety prompts
# Usage: ./scripts/teardown.sh <environment>
# Example: ./scripts/teardown.sh dev

set -euo pipefail

ENV="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$SCRIPT_DIR/../infra"

if [ -z "$ENV" ]; then
  echo "Usage: $0 <environment>"
  echo "  e.g. $0 dev"
  exit 1
fi

if [ "$ENV" != "dev" ] && [ "$ENV" != "prod" ]; then
  echo "Error: environment must be 'dev' or 'prod', got '$ENV'"
  exit 1
fi

echo "============================================"
echo "  INSIGHT ENGINE — TEARDOWN ($ENV)"
echo "============================================"
echo ""
echo "WARNING: This will DESTROY all AWS resources"
echo "in the '$ENV' environment, including:"
echo "  - DynamoDB tables (ALL DATA WILL BE LOST)"
echo "  - SQS queues"
echo "  - S3 buckets"
echo "  - Lambda functions"
echo "  - API Gateway"
echo "  - Cognito User Pool"
echo "  - CloudWatch logs and alarms"
echo "  - SSM parameters"
echo "  - SNS topics"
echo ""

read -p "Are you sure you want to destroy the '$ENV' environment? (yes/no): " CONFIRM
if [ "$CONFIRM" != "yes" ]; then
  echo "Aborted."
  exit 0
fi

if [ "$ENV" = "prod" ]; then
  echo ""
  echo "⚠️  PRODUCTION ENVIRONMENT DETECTED"
  read -p "Type 'DESTROY PROD' to confirm: " CONFIRM_PROD
  if [ "$CONFIRM_PROD" != "DESTROY PROD" ]; then
    echo "Aborted."
    exit 0
  fi
fi

echo ""
echo "Running terraform destroy..."
cd "$INFRA_DIR"
terraform destroy \
  -var="environment=$ENV" \
  -auto-approve

echo ""
echo "============================================"
echo "  Teardown complete for '$ENV' environment."
echo "============================================"
