resource "aws_s3_bucket" "persona_files" {
  bucket = "${var.prefix}-persona-files"
  tags   = { Name = "${var.prefix}-persona-files" }
}

resource "aws_s3_bucket_versioning" "persona_files" {
  bucket = aws_s3_bucket.persona_files.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_public_access_block" "persona_files" {
  bucket                  = aws_s3_bucket.persona_files.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket" "lambda_deployments" {
  bucket = "${var.prefix}-lambda-deployments"
  tags   = { Name = "${var.prefix}-lambda-deployments" }
}

resource "aws_s3_bucket_public_access_block" "lambda_deployments" {
  bucket                  = aws_s3_bucket.lambda_deployments.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# Upload the default persona file to the persona-files bucket.
# Lambdas load this at runtime. Operators can replace it with a custom
# persona via the AWS CLI or Console without redeploying infrastructure.
resource "aws_s3_object" "persona_example" {
  bucket       = aws_s3_bucket.persona_files.id
  key          = "persona.json"
  source       = "${path.module}/../../../persona.example.json"
  content_type = "application/json"
  etag         = filemd5("${path.module}/../../../persona.example.json")
}

# IAM Policy for read access
resource "aws_iam_policy" "read" {
  name = "${var.prefix}-s3-read"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:ListBucket"]
      Resource = [
        aws_s3_bucket.persona_files.arn,
        "${aws_s3_bucket.persona_files.arn}/*",
        aws_s3_bucket.lambda_deployments.arn,
        "${aws_s3_bucket.lambda_deployments.arn}/*",
      ]
    }]
  })
}

# IAM Policy for write access to persona files (used by dashboard settings API)
resource "aws_iam_policy" "write_persona" {
  name = "${var.prefix}-s3-write-persona"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:PutObject"]
      Resource = [
        "${aws_s3_bucket.persona_files.arn}/persona.json",
      ]
    }]
  })
}
