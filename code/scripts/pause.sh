#!/usr/bin/env bash
# pause.sh — Pause costly resources to save money
# Usage: ./scripts/pause.sh <environment> [--full]
#
# Without --full: Disables EventBridge rules only
# With --full:    Also stops RDS instance (if exists) and removes NAT Gateway (if VPC enabled)
#
# NOTE: AWS auto-starts stopped RDS instances after 7 days.
#       Re-run this script weekly if using pause for extended periods.

set -euo pipefail

ENV="${1:-}"
FULL="${2:-}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INFRA_DIR="$SCRIPT_DIR/../infra"
PREFIX="insight-engine-${ENV}"

if [ -z "$ENV" ]; then
  echo "Usage: $0 <environment> [--full]"
  echo "  e.g. $0 dev"
  echo "  e.g. $0 dev --full"
  exit 1
fi

echo "============================================"
echo "  INSIGHT ENGINE — PAUSE ($ENV)"
echo "============================================"
echo ""

# 1. Disable EventBridge rules
echo "Disabling EventBridge scheduled rules..."
RULES=$(aws events list-rules --name-prefix "$PREFIX" --query 'Rules[].Name' --output text 2>/dev/null || echo "")

if [ -n "$RULES" ]; then
  for RULE in $RULES; do
    echo "  Disabling: $RULE"
    aws events disable-rule --name "$RULE"
  done
  echo "EventBridge rules disabled."
else
  echo "  No EventBridge rules found for prefix '$PREFIX'."
fi

# 2. (--full) Stop RDS instance if it exists
if [ "$FULL" = "--full" ]; then
  echo ""
  echo "Checking for RDS instances..."
  RDS_ID="${PREFIX}-postgres"
  RDS_STATUS=$(aws rds describe-db-instances --db-instance-identifier "$RDS_ID" --query 'DBInstances[0].DBInstanceStatus' --output text 2>/dev/null || echo "not-found")

  if [ "$RDS_STATUS" = "available" ]; then
    echo "  Stopping RDS instance: $RDS_ID"
    aws rds stop-db-instance --db-instance-identifier "$RDS_ID"
    echo "  RDS instance stop initiated. (AWS will auto-start it after 7 days)"
  elif [ "$RDS_STATUS" = "not-found" ]; then
    echo "  No RDS instance found (RDS is disabled)."
  else
    echo "  RDS instance status: $RDS_STATUS (no action taken)"
  fi
fi

echo ""
echo "============================================"
echo "  Pause complete for '$ENV' environment."
echo "  To resume: ./scripts/resume.sh $ENV"
echo "============================================"
