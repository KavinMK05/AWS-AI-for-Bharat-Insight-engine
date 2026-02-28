# Watchtower schedule — triggers content ingestion
resource "aws_cloudwatch_event_rule" "watchtower" {
  name                = "${var.prefix}-watchtower-schedule"
  description         = "Triggers Watchtower Lambda on monitoring interval"
  schedule_expression = var.monitoring_interval

  tags = { Name = "${var.prefix}-watchtower-schedule" }
}

resource "aws_cloudwatch_event_target" "watchtower" {
  rule      = aws_cloudwatch_event_rule.watchtower.name
  target_id = "watchtower-lambda"
  arn       = var.watchtower_lambda_arn
}

resource "aws_lambda_permission" "watchtower_eventbridge" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = var.watchtower_lambda_arn
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.watchtower.arn
}

# Digest schedule — triggers digest compilation
resource "aws_cloudwatch_event_rule" "digest" {
  name                = "${var.prefix}-digest-schedule"
  description         = "Triggers digest compilation on configured schedule"
  schedule_expression = var.digest_schedule

  tags = { Name = "${var.prefix}-digest-schedule" }
}
