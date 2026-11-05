output "app_url" {
  description = "Open this in your browser"
  value       = "https://${local.public_host}"
}

output "load_balancer_dns" {
  description = "If your DNS is not on Route 53: create a CNAME from the domain to this name"
  value       = aws_lb.app.dns_name
}

output "certificate_validation_records" {
  description = "If your DNS is not on Route 53: create these CNAME records so the HTTPS certificate is issued"
  value       = [for o in flatten(aws_acm_certificate.app[*].domain_validation_options) : { name = o.resource_record_name, type = o.resource_record_type, value = o.resource_record_value }]
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "ecs_cluster" {
  value = aws_ecs_cluster.main.name
}

output "ecs_service" {
  value = aws_ecs_service.app.name
}

output "app_secret_name" {
  description = "Secrets Manager entry holding the app secrets (add the AI and WhatsApp keys here)"
  value       = aws_secretsmanager_secret.app.name
}

output "superadmin_password" {
  description = "First-login password of the GMS platform admin. Read with: terraform output -raw superadmin_password"
  value       = random_password.superadmin.result
  sensitive   = true
}
