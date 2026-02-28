variable "environment" {
  type = string
}
variable "prefix" {
  type = string
}
variable "lambda_function_names" {
  type = list(string)
}
variable "sns_alert_topic_arn" {
  type = string
}
variable "enable_cloudwatch_dashboard" {
  type    = bool
  default = true
}
