output "topic_arn" {
  value = aws_sns_topic.admin_alerts.arn
}

output "topic_name" {
  value = aws_sns_topic.admin_alerts.name
}

output "publish_policy_arn" {
  value = aws_iam_policy.publish.arn
}
