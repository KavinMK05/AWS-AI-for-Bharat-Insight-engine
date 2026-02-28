variable "environment" {
  type = string
}
variable "prefix" {
  type = string
}
variable "master_password" {
  type      = string
  sensitive = true
}
variable "vpc_id" {
  type = string
}
variable "private_subnet_ids" {
  type = list(string)
}
variable "lambda_sg_id" {
  type = string
}
