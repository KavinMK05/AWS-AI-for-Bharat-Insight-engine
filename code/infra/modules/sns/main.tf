resource "aws_sns_topic" "admin_alerts" {
  name = "${var.prefix}-admin-alerts"
  tags = { Name = "${var.prefix}-admin-alerts" }
}

resource "aws_sns_topic_subscription" "admin_email" {
  count     = var.admin_email != "" ? 1 : 0
  topic_arn = aws_sns_topic.admin_alerts.arn
  protocol  = "email"
  endpoint  = var.admin_email
}

resource "aws_iam_policy" "publish" {
  name = "${var.prefix}-sns-publish"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["sns:Publish"]
      Resource = [aws_sns_topic.admin_alerts.arn]
    }]
  })
}
