output "api_id" {
  value = aws_apigatewayv2_api.main.id
}

output "api_url" {
  value = aws_apigatewayv2_stage.default.invoke_url
}

output "api_execution_arn" {
  value = aws_apigatewayv2_api.main.execution_arn
}
