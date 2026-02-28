output "endpoint" {
  value = aws_db_instance.main.endpoint
}

output "connection_string" {
  value     = "postgresql://insightengine:${var.master_password}@${aws_db_instance.main.endpoint}/insightengine"
  sensitive = true
}
