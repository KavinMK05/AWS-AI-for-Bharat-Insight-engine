terraform {
  required_version = ">= 1.5.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region

  default_tags {
    tags = {
      Project     = "insight-engine"
      Environment = var.environment
      ManagedBy   = "terraform"
    }
  }
}

locals {
  prefix = "insight-engine-${var.environment}"
}

# --- VPC (skeleton — disabled by default) ---
module "vpc" {
  source      = "./modules/vpc"
  count       = var.enable_vpc ? 1 : 0
  environment = var.environment
  aws_region  = var.aws_region
}

# --- DynamoDB Tables ---
module "dynamodb" {
  source      = "./modules/dynamodb"
  environment = var.environment
  prefix      = local.prefix
}

# --- RDS PostgreSQL (publicly accessible — no VPC needed) ---
module "rds" {
  source          = "./modules/rds"
  count           = var.enable_rds ? 1 : 0
  environment     = var.environment
  prefix          = local.prefix
  master_password = var.rds_master_password
}

# --- SQS Queues ---
module "sqs" {
  source      = "./modules/sqs"
  environment = var.environment
  prefix      = local.prefix
}

# --- S3 Buckets ---
module "s3" {
  source      = "./modules/s3"
  environment = var.environment
  prefix      = local.prefix
}

# --- SSM Parameters ---
module "ssm" {
  source      = "./modules/ssm"
  environment = var.environment
}

# --- EventBridge ---
module "eventbridge" {
  source               = "./modules/eventbridge"
  environment          = var.environment
  prefix               = local.prefix
  monitoring_interval  = var.monitoring_interval
  digest_schedule      = var.digest_schedule
  watchtower_lambda_arn = module.lambda_watchtower.function_arn
}

# --- SNS ---
module "sns" {
  source      = "./modules/sns"
  environment = var.environment
  prefix      = local.prefix
  admin_email = var.admin_email
}

# --- Cognito ---
module "cognito" {
  source      = "./modules/cognito"
  environment = var.environment
  prefix      = local.prefix
}

# --- Bedrock IAM ---
module "bedrock" {
  source      = "./modules/bedrock"
  environment = var.environment
  prefix      = local.prefix
}

# --- Lambda Functions ---
module "lambda_watchtower" {
  source        = "./modules/lambda"
  function_name = "${local.prefix}-watchtower"
  handler       = "dist/index.handler"
  runtime       = "nodejs20.x"
  environment_variables = {
    ENVIRONMENT          = var.environment
    INGESTION_QUEUE_URL  = module.sqs.queue_urls["ingestion"]
    PERSONA_FILES_BUCKET = module.s3.bucket_names["persona_files"]
    TABLE_PREFIX         = "${local.prefix}-"
    RSS_FEED_URLS        = var.rss_feed_urls
    ARXIV_CATEGORIES     = var.arxiv_categories
    ARXIV_MAX_RESULTS    = var.arxiv_max_results
  }
  iam_policy_arns = [
    module.dynamodb.read_write_policy_arn,
    module.sqs.send_message_policy_arn,
    module.s3.read_policy_arn,
  ]
  s3_bucket = module.s3.bucket_names["lambda_deployments"]
}

module "lambda_analyst" {
  source        = "./modules/lambda"
  function_name = "${local.prefix}-analyst"
  handler       = "dist/index.handler"
  runtime       = "nodejs20.x"
  environment_variables = {
    ENVIRONMENT          = var.environment
    GENERATION_QUEUE_URL = module.sqs.queue_urls["generation"]
    PERSONA_FILES_BUCKET = module.s3.bucket_names["persona_files"]
    TABLE_PREFIX         = "${local.prefix}-"
    RELEVANCE_THRESHOLD  = tostring(var.relevance_threshold)
  }
  iam_policy_arns = [
    module.dynamodb.read_write_policy_arn,
    module.sqs.send_message_policy_arn,
    module.s3.read_policy_arn,
    module.bedrock.invoke_model_policy_arn,
  ]
  s3_bucket = module.s3.bucket_names["lambda_deployments"]
}

module "lambda_ghostwriter" {
  source        = "./modules/lambda"
  function_name = "${local.prefix}-ghostwriter"
  handler       = "dist/index.handler"
  runtime       = "nodejs20.x"
  environment_variables = {
    ENVIRONMENT          = var.environment
    PERSONA_FILES_BUCKET = module.s3.bucket_names["persona_files"]
    TABLE_PREFIX         = "${local.prefix}-"
  }
  iam_policy_arns = [
    module.dynamodb.read_write_policy_arn,
    module.s3.read_policy_arn,
    module.bedrock.invoke_model_policy_arn,
  ]
  s3_bucket = module.s3.bucket_names["lambda_deployments"]
}

module "lambda_gatekeeper" {
  source        = "./modules/lambda"
  function_name = "${local.prefix}-gatekeeper"
  handler       = "dist/index.handler"
  runtime       = "nodejs20.x"
  environment_variables = {
    ENVIRONMENT         = var.environment
    PUBLISH_QUEUE_URL   = module.sqs.queue_urls["publish"]
    TABLE_PREFIX        = "${local.prefix}-"
    ADMIN_ALERTS_TOPIC_ARN = module.sns.topic_arn
  }
  iam_policy_arns = [
    module.dynamodb.read_write_policy_arn,
    module.sqs.send_message_policy_arn,
    module.ssm.read_policy_arn,
  ]
  s3_bucket = module.s3.bucket_names["lambda_deployments"]
}

module "lambda_publisher" {
  source        = "./modules/lambda"
  function_name = "${local.prefix}-publisher"
  handler       = "dist/index.handler"
  runtime       = "nodejs20.x"
  environment_variables = {
    ENVIRONMENT            = var.environment
    TABLE_PREFIX           = "${local.prefix}-"
    PUBLISH_QUEUE_URL      = module.sqs.queue_urls["publish"]
    ADMIN_ALERTS_TOPIC_ARN = module.sns.topic_arn
    LINKEDIN_AUTHOR_URN    = var.linkedin_author_urn
  }
  iam_policy_arns = [
    module.dynamodb.read_write_policy_arn,
    module.sqs.receive_message_policy_arn,
    module.ssm.read_policy_arn,
    module.ssm.write_policy_arn,
    module.sns.publish_policy_arn,
  ]
  s3_bucket = module.s3.bucket_names["lambda_deployments"]
}

# --- API Gateway ---
module "api_gateway" {
  source                = "./modules/api_gateway"
  environment           = var.environment
  prefix                = local.prefix
  gatekeeper_lambda_arn = module.lambda_gatekeeper.function_arn
  gatekeeper_invoke_arn = module.lambda_gatekeeper.invoke_arn
  cognito_user_pool_arn = module.cognito.user_pool_arn
  cognito_client_id     = module.cognito.client_id
}

# --- CloudWatch ---
module "cloudwatch" {
  source      = "./modules/cloudwatch"
  environment = var.environment
  prefix      = local.prefix
  lambda_function_names = [
    module.lambda_watchtower.function_name,
    module.lambda_analyst.function_name,
    module.lambda_ghostwriter.function_name,
    module.lambda_gatekeeper.function_name,
    module.lambda_publisher.function_name,
  ]
  sns_alert_topic_arn         = module.sns.topic_arn
  enable_cloudwatch_dashboard = var.enable_cloudwatch_dashboard
}

# --- SQS Event Source Mappings ---
resource "aws_lambda_event_source_mapping" "ingestion_to_analyst" {
  event_source_arn = module.sqs.queue_arns["ingestion"]
  function_name    = module.lambda_analyst.function_arn
  batch_size       = 1
  enabled          = true
}

resource "aws_lambda_event_source_mapping" "generation_to_ghostwriter" {
  event_source_arn = module.sqs.queue_arns["generation"]
  function_name    = module.lambda_ghostwriter.function_arn
  batch_size       = 1
  enabled          = true
}

resource "aws_lambda_event_source_mapping" "publish_to_publisher" {
  event_source_arn = module.sqs.queue_arns["publish"]
  function_name    = module.lambda_publisher.function_arn
  batch_size       = 1
  enabled          = true
}

# --- Sync Lambda (Phase 8 — gated by enable_rds) ---
module "lambda_sync" {
  source        = "./modules/lambda"
  count         = var.enable_rds ? 1 : 0
  function_name = "${local.prefix}-sync"
  handler       = "dist/index.handler"
  runtime       = "nodejs20.x"
  timeout       = 120
  environment_variables = {
    ENVIRONMENT          = var.environment
    TABLE_PREFIX         = "${local.prefix}-"
    RDS_CONNECTION_STRING = var.enable_rds ? module.rds[0].connection_string : ""
  }
  iam_policy_arns = [
    module.dynamodb.read_write_policy_arn,
    module.dynamodb.stream_read_policy_arn,
  ]
  s3_bucket = module.s3.bucket_names["lambda_deployments"]
}

# DynamoDB Streams → Sync Lambda (Phase 8)
resource "aws_lambda_event_source_mapping" "content_items_to_sync" {
  count             = var.enable_rds ? 1 : 0
  event_source_arn  = module.dynamodb.content_items_stream_arn
  function_name     = module.lambda_sync[0].function_arn
  starting_position = "LATEST"
  batch_size        = 10
  enabled           = true
}

resource "aws_lambda_event_source_mapping" "draft_content_to_sync" {
  count             = var.enable_rds ? 1 : 0
  event_source_arn  = module.dynamodb.draft_content_stream_arn
  function_name     = module.lambda_sync[0].function_arn
  starting_position = "LATEST"
  batch_size        = 10
  enabled           = true
}
