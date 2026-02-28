output "watchtower_rule_arn" {
  value = aws_cloudwatch_event_rule.watchtower.arn
}

output "watchtower_rule_name" {
  value = aws_cloudwatch_event_rule.watchtower.name
}

output "digest_rule_arn" {
  value = aws_cloudwatch_event_rule.digest.arn
}

output "digest_rule_name" {
  value = aws_cloudwatch_event_rule.digest.name
}
