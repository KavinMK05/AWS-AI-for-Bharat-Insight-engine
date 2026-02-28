# SSM Parameter Store — Placeholder entries only.
# Real secret values are set manually via AWS CLI or Console after terraform apply.
# Values are NEVER set by Terraform to keep them out of state files.

locals {
  prefix = "/insight-engine/${var.environment}"
  parameters = [
    "twitter-client-id",
    "twitter-client-secret",
    "twitter-access-token",
    "twitter-refresh-token",
    "linkedin-client-id",
    "linkedin-client-secret",
    "linkedin-access-token",
    "linkedin-refresh-token",
    "rds-connection-string",
  ]
}

resource "aws_ssm_parameter" "secrets" {
  for_each = toset(local.parameters)

  name  = "${local.prefix}/${each.value}"
  type  = "SecureString"
  value = "PLACEHOLDER_SET_VIA_AWS_CLI"

  lifecycle {
    ignore_changes = [value]
  }

  tags = {
    Name        = each.value
    Environment = var.environment
  }
}

# IAM Policies
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_iam_policy" "read" {
  name = "insight-engine-${var.environment}-ssm-read"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "ssm:GetParameter",
        "ssm:GetParameters",
        "ssm:GetParametersByPath",
      ]
      Resource = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter${local.prefix}/*"
    }]
  })
}

resource "aws_iam_policy" "write" {
  name = "insight-engine-${var.environment}-ssm-write"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["ssm:PutParameter"]
      Resource = "arn:aws:ssm:${data.aws_region.current.name}:${data.aws_caller_identity.current.account_id}:parameter${local.prefix}/*"
    }]
  })
}
