output "bucket_names" {
  value = {
    persona_files      = aws_s3_bucket.persona_files.id
    lambda_deployments = aws_s3_bucket.lambda_deployments.id
  }
}

output "bucket_arns" {
  value = {
    persona_files      = aws_s3_bucket.persona_files.arn
    lambda_deployments = aws_s3_bucket.lambda_deployments.arn
  }
}

output "read_policy_arn" {
  value = aws_iam_policy.read.arn
}

output "write_persona_policy_arn" {
  value = aws_iam_policy.write_persona.arn
}
