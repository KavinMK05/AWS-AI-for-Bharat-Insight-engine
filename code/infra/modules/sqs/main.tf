# Dead Letter Queues
resource "aws_sqs_queue" "ingestion_dlq" {
  name                       = "${var.prefix}-ingestion-queue-dlq"
  message_retention_seconds  = 1209600 # 14 days

  tags = { Name = "${var.prefix}-ingestion-queue-dlq" }
}

resource "aws_sqs_queue" "generation_dlq" {
  name                       = "${var.prefix}-generation-queue-dlq"
  message_retention_seconds  = 1209600

  tags = { Name = "${var.prefix}-generation-queue-dlq" }
}

resource "aws_sqs_queue" "publish_dlq" {
  name                       = "${var.prefix}-publish-queue-dlq"
  message_retention_seconds  = 1209600

  tags = { Name = "${var.prefix}-publish-queue-dlq" }
}

# Main Queues
resource "aws_sqs_queue" "ingestion" {
  name                       = "${var.prefix}-ingestion-queue"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 345600 # 4 days

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.ingestion_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Name = "${var.prefix}-ingestion-queue" }
}

resource "aws_sqs_queue" "generation" {
  name                       = "${var.prefix}-generation-queue"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 345600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.generation_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Name = "${var.prefix}-generation-queue" }
}

resource "aws_sqs_queue" "publish" {
  name                       = "${var.prefix}-publish-queue"
  visibility_timeout_seconds = 300
  message_retention_seconds  = 345600

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.publish_dlq.arn
    maxReceiveCount     = 3
  })

  tags = { Name = "${var.prefix}-publish-queue" }
}

# IAM Policies
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_iam_policy" "send_message" {
  name = "${var.prefix}-sqs-send-message"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["sqs:SendMessage"]
      Resource = [
        aws_sqs_queue.ingestion.arn,
        aws_sqs_queue.generation.arn,
        aws_sqs_queue.publish.arn,
      ]
    }]
  })
}

resource "aws_iam_policy" "receive_message" {
  name = "${var.prefix}-sqs-receive-message"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "sqs:ReceiveMessage",
        "sqs:DeleteMessage",
        "sqs:ChangeMessageVisibility",
        "sqs:GetQueueAttributes",
        "sqs:GetQueueUrl",
      ]
      Resource = [
        aws_sqs_queue.ingestion.arn,
        aws_sqs_queue.generation.arn,
        aws_sqs_queue.publish.arn,
      ]
    }]
  })
}
