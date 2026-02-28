output "table_names" {
  value = {
    content_items    = aws_dynamodb_table.content_items.name
    hot_takes        = aws_dynamodb_table.hot_takes.name
    draft_content    = aws_dynamodb_table.draft_content.name
    publishing_queue = aws_dynamodb_table.publishing_queue.name
    metrics          = aws_dynamodb_table.metrics.name
  }
}

output "table_arns" {
  value = {
    content_items    = aws_dynamodb_table.content_items.arn
    hot_takes        = aws_dynamodb_table.hot_takes.arn
    draft_content    = aws_dynamodb_table.draft_content.arn
    publishing_queue = aws_dynamodb_table.publishing_queue.arn
    metrics          = aws_dynamodb_table.metrics.arn
  }
}

output "content_items_stream_arn" {
  value = aws_dynamodb_table.content_items.stream_arn
}

output "draft_content_stream_arn" {
  value = aws_dynamodb_table.draft_content.stream_arn
}

output "read_write_policy_arn" {
  value = aws_iam_policy.dynamodb_read_write.arn
}
