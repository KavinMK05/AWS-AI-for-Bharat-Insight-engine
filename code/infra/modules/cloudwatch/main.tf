# Error rate alarms for each Lambda
resource "aws_cloudwatch_metric_alarm" "lambda_errors" {
  count               = length(var.lambda_function_names)
  alarm_name          = "${var.prefix}-${var.lambda_function_names[count.index]}-error-rate"
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods  = 2
  threshold           = 5
  alarm_description   = "Error rate > 5% for ${var.lambda_function_names[count.index]}"
  alarm_actions       = [var.sns_alert_topic_arn]

  metric_query {
    id          = "error_rate"
    expression  = "(errors / invocations) * 100"
    label       = "Error Rate %"
    return_data = true
  }

  metric_query {
    id = "errors"
    metric {
      metric_name = "Errors"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = var.lambda_function_names[count.index] }
    }
  }

  metric_query {
    id = "invocations"
    metric {
      metric_name = "Invocations"
      namespace   = "AWS/Lambda"
      period      = 300
      stat        = "Sum"
      dimensions  = { FunctionName = var.lambda_function_names[count.index] }
    }
  }

  tags = { Name = "${var.prefix}-${var.lambda_function_names[count.index]}-error-alarm" }
}

# Optional CloudWatch Dashboard
resource "aws_cloudwatch_dashboard" "main" {
  count          = var.enable_cloudwatch_dashboard ? 1 : 0
  dashboard_name = "${var.prefix}-dashboard"

  dashboard_body = jsonencode({
    widgets = [
      {
        type   = "metric"
        x      = 0
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Lambda Invocations"
          metrics = [for fn in var.lambda_function_names : ["AWS/Lambda", "Invocations", "FunctionName", fn]]
          period  = 300
          stat    = "Sum"
          region  = "ap-south-1"
        }
      },
      {
        type   = "metric"
        x      = 12
        y      = 0
        width  = 12
        height = 6
        properties = {
          title   = "Lambda Errors"
          metrics = [for fn in var.lambda_function_names : ["AWS/Lambda", "Errors", "FunctionName", fn]]
          period  = 300
          stat    = "Sum"
          region  = "ap-south-1"
        }
      },
      {
        type   = "metric"
        x      = 0
        y      = 6
        width  = 24
        height = 6
        properties = {
          title = "Custom Metrics — InsightEngine"
          metrics = [
            ["InsightEngine", "ContentItemsIngested"],
            ["InsightEngine", "HotTakesGenerated"],
            ["InsightEngine", "DraftContentCreated"],
            ["InsightEngine", "PostsPublished"],
          ]
          period = 300
          stat   = "Sum"
          region = "ap-south-1"
        }
      }
    ]
  })
}
