output "dynamodb_table_names" {
  description = "Names of all DynamoDB tables"
  value       = module.dynamodb.table_names
}

output "sqs_queue_urls" {
  description = "URLs of all SQS queues"
  value       = module.sqs.queue_urls
}

output "s3_bucket_names" {
  description = "Names of all S3 buckets"
  value       = module.s3.bucket_names
}

output "api_gateway_url" {
  description = "Base URL of the HTTP API"
  value       = module.api_gateway.api_url
}

output "cognito_user_pool_id" {
  description = "Cognito User Pool ID"
  value       = module.cognito.user_pool_id
}

output "cognito_client_id" {
  description = "Cognito App Client ID"
  value       = module.cognito.client_id
}

output "lambda_function_names" {
  description = "Names of all Lambda functions"
  value = {
    watchtower  = module.lambda_watchtower.function_name
    analyst     = module.lambda_analyst.function_name
    ghostwriter = module.lambda_ghostwriter.function_name
    gatekeeper  = module.lambda_gatekeeper.function_name
    publisher   = module.lambda_publisher.function_name
  }
}

output "sns_admin_topic_arn" {
  description = "ARN of the admin alerts SNS topic"
  value       = module.sns.topic_arn
}

output "sync_lambda_function_name" {
  description = "Name of the DynamoDB Streams sync Lambda (Phase 8)"
  value       = var.enable_rds ? module.lambda_sync[0].function_name : null
}

output "rds_endpoint" {
  description = "RDS PostgreSQL endpoint (Phase 8)"
  value       = var.enable_rds ? module.rds[0].endpoint : null
}
