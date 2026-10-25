output "alb_dns_name" {
  description = "Public ALB hostname. Configure the approved DNS name as an alias to this hostname."
  value       = aws_lb.staging.dns_name
}

output "rds_endpoint" {
  description = "Private PostgreSQL endpoint; do not expose publicly."
  value       = aws_db_instance.staging.address
}

output "rds_master_secret_arn" {
  description = "RDS-managed master credential secret ARN. Use only for DBA/bootstrap, not application traffic."
  value       = aws_db_instance.staging.master_user_secret[0].secret_arn
  sensitive   = true
}

output "ecs_cluster_name" {
  value = aws_ecs_cluster.staging.name
}

output "api_service_name" {
  value = aws_ecs_service.api.name
}

output "web_service_name" {
  value = aws_ecs_service.web.name
}
