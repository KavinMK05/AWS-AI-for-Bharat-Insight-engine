output "alarm_arns" {
  value = aws_cloudwatch_metric_alarm.lambda_errors[*].arn
}

output "dashboard_name" {
  value = var.enable_cloudwatch_dashboard ? aws_cloudwatch_dashboard.main[0].dashboard_name : ""
}
