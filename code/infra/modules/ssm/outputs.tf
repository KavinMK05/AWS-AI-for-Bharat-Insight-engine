output "parameter_arns" {
  value = { for k, v in aws_ssm_parameter.secrets : k => v.arn }
}

output "read_policy_arn" {
  value = aws_iam_policy.read.arn
}

output "write_policy_arn" {
  value = aws_iam_policy.write.arn
}
