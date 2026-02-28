output "queue_urls" {
  value = {
    ingestion  = aws_sqs_queue.ingestion.url
    generation = aws_sqs_queue.generation.url
    publish    = aws_sqs_queue.publish.url
  }
}

output "queue_arns" {
  value = {
    ingestion  = aws_sqs_queue.ingestion.arn
    generation = aws_sqs_queue.generation.arn
    publish    = aws_sqs_queue.publish.arn
  }
}

output "dlq_arns" {
  value = {
    ingestion  = aws_sqs_queue.ingestion_dlq.arn
    generation = aws_sqs_queue.generation_dlq.arn
    publish    = aws_sqs_queue.publish_dlq.arn
  }
}

output "send_message_policy_arn" {
  value = aws_iam_policy.send_message.arn
}

output "receive_message_policy_arn" {
  value = aws_iam_policy.receive_message.arn
}
