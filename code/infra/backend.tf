terraform {
  backend "s3" {
    bucket         = "insight-engine-terraform-state"
    key            = "state/terraform.tfstate"
    region         = "ap-south-1"
    dynamodb_table = "insight-engine-terraform-locks"
    encrypt        = true
  }
}
