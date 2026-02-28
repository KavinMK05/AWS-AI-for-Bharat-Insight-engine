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
