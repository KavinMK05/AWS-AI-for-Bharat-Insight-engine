# IAM Policy for Bedrock InvokeModel
# Grants access to Claude Sonnet, Titan Embeddings, and Minimax models
resource "aws_iam_policy" "invoke_model" {
  name = "${var.prefix}-bedrock-invoke-model"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = [
        "bedrock:InvokeModel",
        "bedrock:InvokeModelWithResponseStream",
      ]
      Resource = [
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-sonnet-*",
        "arn:aws:bedrock:*::foundation-model/anthropic.claude-3-5-sonnet-*",
        "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v1",
        "arn:aws:bedrock:*::foundation-model/amazon.titan-embed-text-v2*",
        "arn:aws:bedrock:*::foundation-model/openai.gpt-oss-safeguard-120b" # <-- Added this line
      ]
    }]
  })
}