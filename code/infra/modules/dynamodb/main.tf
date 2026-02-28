resource "aws_dynamodb_table" "content_items" {
  name         = "${var.prefix}-ContentItems"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "sourceUrl"
    type = "S"
  }

  attribute {
    name = "ingestedAt"
    type = "S"
  }

  global_secondary_index {
    name            = "sourceUrl-index"
    hash_key        = "sourceUrl"
    projection_type = "ALL"
  }

  global_secondary_index {
    name            = "ingestedAt-index"
    hash_key        = "ingestedAt"
    projection_type = "ALL"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  tags = {
    Name = "${var.prefix}-ContentItems"
  }
}

resource "aws_dynamodb_table" "hot_takes" {
  name         = "${var.prefix}-HotTakes"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "contentItemId"
    type = "S"
  }

  global_secondary_index {
    name            = "contentItemId-index"
    hash_key        = "contentItemId"
    projection_type = "ALL"
  }

  tags = {
    Name = "${var.prefix}-HotTakes"
  }
}

resource "aws_dynamodb_table" "draft_content" {
  name         = "${var.prefix}-DraftContent"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  attribute {
    name = "createdAt"
    type = "S"
  }

  global_secondary_index {
    name            = "status-createdAt-index"
    hash_key        = "status"
    range_key       = "createdAt"
    projection_type = "ALL"
  }

  stream_enabled   = true
  stream_view_type = "NEW_AND_OLD_IMAGES"

  tags = {
    Name = "${var.prefix}-DraftContent"
  }
}

resource "aws_dynamodb_table" "publishing_queue" {
  name         = "${var.prefix}-PublishingQueue"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "id"

  attribute {
    name = "id"
    type = "S"
  }

  attribute {
    name = "platform"
    type = "S"
  }

  attribute {
    name = "status"
    type = "S"
  }

  global_secondary_index {
    name            = "platform-status-index"
    hash_key        = "platform"
    range_key       = "status"
    projection_type = "ALL"
  }

  tags = {
    Name = "${var.prefix}-PublishingQueue"
  }
}

resource "aws_dynamodb_table" "metrics" {
  name         = "${var.prefix}-Metrics"
  billing_mode = "PAY_PER_REQUEST"
  hash_key     = "date"
  range_key    = "metricName"

  attribute {
    name = "date"
    type = "S"
  }

  attribute {
    name = "metricName"
    type = "S"
  }

  tags = {
    Name = "${var.prefix}-Metrics"
  }
}

# IAM Policy for Lambda read/write access to all tables
data "aws_caller_identity" "current" {}
data "aws_region" "current" {}

resource "aws_iam_policy" "dynamodb_read_write" {
  name = "${var.prefix}-dynamodb-read-write"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "dynamodb:GetItem",
          "dynamodb:PutItem",
          "dynamodb:UpdateItem",
          "dynamodb:DeleteItem",
          "dynamodb:Query",
          "dynamodb:Scan",
          "dynamodb:BatchGetItem",
          "dynamodb:BatchWriteItem",
          "dynamodb:DescribeTable",
        ]
        Resource = [
          aws_dynamodb_table.content_items.arn,
          "${aws_dynamodb_table.content_items.arn}/index/*",
          aws_dynamodb_table.hot_takes.arn,
          "${aws_dynamodb_table.hot_takes.arn}/index/*",
          aws_dynamodb_table.draft_content.arn,
          "${aws_dynamodb_table.draft_content.arn}/index/*",
          aws_dynamodb_table.publishing_queue.arn,
          "${aws_dynamodb_table.publishing_queue.arn}/index/*",
          aws_dynamodb_table.metrics.arn,
          "${aws_dynamodb_table.metrics.arn}/index/*",
        ]
      }
    ]
  })
}
