variable "environment" {
  description = "Deployment environment (dev/prod)"
  type        = string
  default     = "dev"
  validation {
    condition     = contains(["dev", "prod"], var.environment)
    error_message = "Environment must be 'dev' or 'prod'."
  }
}

variable "aws_region" {
  description = "AWS region for all resources"
  type        = string
  default     = "ap-south-1"
}

variable "relevance_threshold" {
  description = "Minimum relevance score (0-100) for content to proceed"
  type        = number
  default     = 60
  validation {
    condition     = var.relevance_threshold >= 0 && var.relevance_threshold <= 100
    error_message = "Relevance threshold must be between 0 and 100."
  }
}

variable "digest_schedule" {
  description = "Cron expression for digest compilation"
  type        = string
  default     = "rate(1 day)"
}

variable "monitoring_interval" {
  description = "Cron expression for Watchtower content monitoring"
  type        = string
  default     = "rate(1 hour)"
}

variable "admin_email" {
  description = "Email address for admin alert notifications"
  type        = string
  default     = ""
}

variable "enable_vpc" {
  description = "Enable VPC, NAT Gateway, and private subnets. Saves ~$32/month when false."
  type        = bool
  default     = false
}

variable "enable_rds" {
  description = "Enable RDS PostgreSQL instance. Saves ~$12-15/month when false."
  type        = bool
  default     = false
}

variable "enable_cloudwatch_dashboard" {
  description = "Enable CloudWatch Dashboard. Saves ~$3/month when false."
  type        = bool
  default     = true
}

variable "rds_master_password" {
  description = "Master password for RDS PostgreSQL (only used when enable_rds = true). Set via TF_VAR_rds_master_password env var."
  type        = string
  default     = ""
  sensitive   = true
}
