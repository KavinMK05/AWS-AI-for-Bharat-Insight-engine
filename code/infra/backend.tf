terraform {
  backend "s3" {
    bucket         = "insight-engine-terraform-state-123456789012"
    key            = "state/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "insight-engine-terraform-locks"
    encrypt        = true
  }
}
