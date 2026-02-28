#!/usr/bin/env bash
# resume.sh — Resume paused resources
# Usage: ./scripts/resume.sh <environment>

set -euo pipefail

ENV="${1:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="insight-engine-${ENV}"

if [ -z "$ENV" ]; then
  echo "Usage: $0 <environment>"
  echo "  e.g. $0 dev"
  exit 1
fi

echo "============================================"
echo "  INSIGHT ENGINE — RESUME ($ENV)"
echo "============================================"
echo ""

# 1. Re-enable EventBridge rules
echo "Re-enabling EventBridge scheduled rules..."
RULES=$(aws events list-rules --name-prefix "$PREFIX" --query 'Rules[].Name' --output text 2>/dev/null || echo "")

if [ -n "$RULES" ]; then
  for RULE in $RULES; do
    echo "  Enabling: $RULE"
    aws events enable-rule --name "$RULE"
  done
  echo "EventBridge rules re-enabled."
else
  echo "  No EventBridge rules found for prefix '$PREFIX'."
fi

# 2. Start RDS instance if it exists and is stopped
echo ""
echo "Checking for stopped RDS instances..."
RDS_ID="${PREFIX}-postgres"
RDS_STATUS=$(aws rds describe-db-instances --db-instance-identifier "$RDS_ID" --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "not-found")

if [ "$RDS_STATUS" = "stopped" ]; then
  echo "  Starting RDS instance: $RDS_ID"
  aws rds start-db-instance --db-instance-identifier "$RDS_ID"
  echo "  RDS instance start initiated."
elif [ "$RDS_STATUS" = "not-found" ]; then
  echo "  No RDS instance found (RDS is disabled)."
else
  echo "  RDS instance status: $RDS_STATUS (no action needed)"
fi

echo ""
echo "============================================"
echo "  Resume complete for '$ENV' environment."
echo "============================================"
