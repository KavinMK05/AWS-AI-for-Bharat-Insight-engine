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
variable "allowed_cidr_blocks" {
  description = "CIDR blocks allowed to access the RDS instance on port 5432"
  type        = list(string)
  default     = ["0.0.0.0/0"]
}
