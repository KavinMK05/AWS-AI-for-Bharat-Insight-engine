variable "function_name" {
  type = string
}
variable "handler" {
  type    = string
  default = "dist/index.handler"
}
variable "runtime" {
  type    = string
  default = "nodejs20.x"
}
variable "timeout" {
  type    = number
  default = 60
}
variable "memory_size" {
  type    = number
  default = 256
}
variable "environment_variables" {
  type    = map(string)
  default = {}
}
variable "iam_policy_arns" {
  type    = list(string)
  default = []
}
variable "s3_bucket" {
  type    = string
  default = ""
}
variable "vpc_config" {
  type = object({
    subnet_ids         = list(string)
    security_group_ids = list(string)
  })
  default = null
}
