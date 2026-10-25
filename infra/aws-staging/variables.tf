variable "aws_region" {
  description = "AWS region for staging."
  type        = string
  default     = "ap-south-1"
}

variable "vpc_cidr" {
  type        = string
  description = "Non-overlapping CIDR reserved for Q-Core staging."
  default     = "10.84.0.0/16"
}

variable "allowed_client_cidrs" {
  description = "CIDRs permitted to reach the public ALB. Use office/VPN egress CIDRs, not 0.0.0.0/0, for restricted evaluation."
  type        = list(string)
  default     = []
}

variable "acm_certificate_arn" {
  description = "Issued ACM certificate ARN in the selected region; certificate must cover the staging hostname."
  type        = string
}

variable "api_image" {
  description = "Immutable ECR image URI including sha256 digest for control-plane API."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.api_image))
    error_message = "api_image must be pinned to an immutable @sha256 digest."
  }
}

variable "web_image" {
  description = "Immutable ECR image URI including sha256 digest for intelligence-plane web."
  type        = string
  validation {
    condition     = can(regex("@sha256:[0-9a-f]{64}$", var.web_image))
    error_message = "web_image must be pinned to an immutable @sha256 digest."
  }
}

variable "database_url_secret_arn" {
  description = "Secrets Manager ARN whose SecretString is a least-privilege PostgreSQL DATABASE_URL for the private RDS endpoint."
  type        = string
  sensitive   = true
}

variable "admin_password_secret_arn" {
  description = "Secrets Manager ARN whose SecretString is VARDHAN_ADMIN_PASSWORD."
  type        = string
  sensitive   = true
}

variable "postgres_db_name" {
  type    = string
  default = "vardhan_control_plane"
}

variable "postgres_master_username" {
  type    = string
  default = "qcore_admin"
}

variable "postgres_engine_version" {
  description = "Supported PostgreSQL major/minor version in ap-south-1; verify availability before apply."
  type        = string
  default     = "16.4"
}

variable "postgres_instance_class" {
  type    = string
  default = "db.t4g.medium"
}

variable "postgres_multi_az" {
  description = "Enable Multi-AZ for staging resilience tests; incurs additional cost."
  type        = bool
  default     = false
}

variable "api_task_cpu" {
  type    = number
  default = 1024
}

variable "api_task_memory" {
  type    = number
  default = 2048
}

variable "web_task_cpu" {
  type    = number
  default = 512
}

variable "web_task_memory" {
  type    = number
  default = 1024
}
