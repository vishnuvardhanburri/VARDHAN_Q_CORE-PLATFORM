terraform {
  required_version = ">= 1.7.0"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.aws_region
  default_tags {
    tags = {
      Product     = "Vardhan-Q-Core"
      Environment = "staging"
      ManagedBy   = "Terraform"
    }
  }
}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 2)
}

resource "aws_vpc" "staging" {
  cidr_block           = var.vpc_cidr
  enable_dns_support   = true
  enable_dns_hostnames = true
  tags = { Name = "qcore-staging-vpc" }
}

resource "aws_internet_gateway" "staging" {
  vpc_id = aws_vpc.staging.id
  tags   = { Name = "qcore-staging-igw" }
}

resource "aws_subnet" "public" {
  count                   = 2
  vpc_id                  = aws_vpc.staging.id
  cidr_block              = cidrsubnet(var.vpc_cidr, 4, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = false
  tags = { Name = "qcore-staging-public-${count.index + 1}" }
}

resource "aws_subnet" "private" {
  count             = 2
  vpc_id            = aws_vpc.staging.id
  cidr_block        = cidrsubnet(var.vpc_cidr, 4, count.index + 4)
  availability_zone = local.azs[count.index]
  tags = { Name = "qcore-staging-private-${count.index + 1}" }
}

resource "aws_eip" "nat" {
  domain = "vpc"
  tags   = { Name = "qcore-staging-nat-eip" }
}

resource "aws_nat_gateway" "staging" {
  allocation_id = aws_eip.nat.id
  subnet_id     = aws_subnet.public[0].id
  depends_on    = [aws_internet_gateway.staging]
  tags          = { Name = "qcore-staging-nat" }
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.staging.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.staging.id
  }
  tags = { Name = "qcore-staging-public-rt" }
}

resource "aws_route_table_association" "public" {
  count          = 2
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public.id
}

resource "aws_route_table" "private" {
  vpc_id = aws_vpc.staging.id
  route {
    cidr_block     = "0.0.0.0/0"
    nat_gateway_id = aws_nat_gateway.staging.id
  }
  tags = { Name = "qcore-staging-private-rt" }
}

resource "aws_route_table_association" "private" {
  count          = 2
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private.id
}

resource "aws_security_group" "alb" {
  name        = "qcore-staging-alb"
  description = "HTTPS ingress to Q-Core staging"
  vpc_id      = aws_vpc.staging.id
  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = var.allowed_client_cidrs
  }
  ingress {
    description = "HTTP for redirect only"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.allowed_client_cidrs
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "qcore-staging-alb-sg" }
}

resource "aws_security_group" "tasks" {
  name        = "qcore-staging-tasks"
  description = "Only the ALB can reach Q-Core tasks"
  vpc_id      = aws_vpc.staging.id
  ingress {
    from_port       = 8080
    to_port         = 8080
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
  tags = { Name = "qcore-staging-tasks-sg" }
}

resource "aws_security_group" "db" {
  name        = "qcore-staging-postgres"
  description = "PostgreSQL accepts traffic only from Q-Core tasks"
  vpc_id      = aws_vpc.staging.id
  ingress {
    from_port       = 5432
    to_port         = 5432
    protocol        = "tcp"
    security_groups = [aws_security_group.tasks.id]
  }
  tags = { Name = "qcore-staging-db-sg" }
}

resource "aws_db_subnet_group" "staging" {
  name       = "qcore-staging-db-subnets"
  subnet_ids = aws_subnet.private[*].id
}

resource "aws_db_instance" "staging" {
  identifier                  = "qcore-staging-postgres"
  engine                      = "postgres"
  engine_version              = var.postgres_engine_version
  instance_class              = var.postgres_instance_class
  allocated_storage           = 50
  max_allocated_storage       = 100
  storage_type                = "gp3"
  storage_encrypted           = true
  db_name                     = var.postgres_db_name
  username                    = var.postgres_master_username
  manage_master_user_password = true
  multi_az                    = var.postgres_multi_az
  db_subnet_group_name        = aws_db_subnet_group.staging.name
  vpc_security_group_ids      = [aws_security_group.db.id]
  publicly_accessible         = false
  backup_retention_period     = 7
  deletion_protection         = true
  auto_minor_version_upgrade  = true
  apply_immediately           = false
  skip_final_snapshot         = false
  final_snapshot_identifier   = "qcore-staging-final"
  tags                        = { Name = "qcore-staging-postgres" }
}

resource "aws_lb" "staging" {
  name               = "qcore-staging-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets            = aws_subnet.public[*].id
  drop_invalid_header_fields = true
  tags = { Name = "qcore-staging-alb" }
}

resource "aws_lb_target_group" "api" {
  name        = "qcore-staging-api"
  port        = 8080
  protocol    = "HTTP"
  vpc_id      = aws_vpc.staging.id
  target_type = "ip"
  health_check {
    enabled             = true
    path                = "/api/v1/platform/health"
    matcher             = "200-299"
    interval            = 20
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_target_group" "web" {
  name        = "qcore-staging-web"
  port        = 3000
  protocol    = "HTTP"
  vpc_id      = aws_vpc.staging.id
  target_type = "ip"
  health_check {
    enabled             = true
    path                = "/"
    matcher             = "200-399"
    interval            = 20
    timeout             = 5
    healthy_threshold   = 2
    unhealthy_threshold = 3
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.staging.arn
  port              = 443
  protocol          = "HTTPS"
  certificate_arn   = var.acm_certificate_arn
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.web.arn
  }
}

resource "aws_lb_listener_rule" "api" {
  listener_arn = aws_lb_listener.https.arn
  priority     = 10
  condition {
    path_pattern { values = ["/api/*"] }
  }
  action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.api.arn
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.staging.arn
  port              = 80
  protocol          = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_ecs_cluster" "staging" {
  name = "qcore-staging"
  setting { name = "containerInsights", value = "enabled" }
}

resource "aws_iam_role" "task_execution" {
  name = "qcore-staging-ecs-execution"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = { Service = "ecs-tasks.amazonaws.com" }
      Action = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy_attachment" "task_execution" {
  role       = aws_iam_role.task_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "read_runtime_secrets" {
  name = "qcore-staging-read-secrets"
  role = aws_iam_role.task_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["secretsmanager:GetSecretValue"]
      Resource = [var.database_url_secret_arn, var.admin_password_secret_arn]
    }]
  })
}

resource "aws_ecs_task_definition" "api" {
  family                   = "qcore-staging-api"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.api_task_cpu)
  memory                   = tostring(var.api_task_memory)
  execution_role_arn       = aws_iam_role.task_execution.arn
  container_definitions = jsonencode([{
    name      = "control-plane"
    image     = var.api_image
    essential = true
    portMappings = [{ containerPort = 8080, hostPort = 8080, protocol = "tcp" }]
    environment = [
      { name = "VARDHAN_ENV", value = "production" },
      { name = "VARDHAN_CONTROL_PLANE_ADDR", value = "0.0.0.0:8080" },
      { name = "VARDHAN_TLS_TERMINATION", value = "ingress" },
      { name = "VARDHAN_NODE_ID", value = "staging-task" },
      { name = "DATABASE_URL", value = "" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = var.database_url_secret_arn },
      { name = "VARDHAN_ADMIN_PASSWORD", valueFrom = var.admin_password_secret_arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.api.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "control-plane"
      }
    }
  }])
}

resource "aws_ecs_task_definition" "web" {
  family                   = "qcore-staging-web"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.web_task_cpu)
  memory                   = tostring(var.web_task_memory)
  execution_role_arn       = aws_iam_role.task_execution.arn
  container_definitions = jsonencode([{
    name      = "intelligence-plane"
    image     = var.web_image
    essential = true
    portMappings = [{ containerPort = 3000, hostPort = 3000, protocol = "tcp" }]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        "awslogs-group"         = aws_cloudwatch_log_group.web.name
        "awslogs-region"        = var.aws_region
        "awslogs-stream-prefix" = "intelligence-plane"
      }
    }
  }])
}

resource "aws_cloudwatch_log_group" "api" {
  name              = "/qcore/staging/control-plane"
  retention_in_days = 30
}

resource "aws_cloudwatch_log_group" "web" {
  name              = "/qcore/staging/intelligence-plane"
  retention_in_days = 30
}

resource "aws_ecs_service" "api" {
  name            = "qcore-staging-api"
  cluster         = aws_ecs_cluster.staging.id
  task_definition = aws_ecs_task_definition.api.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  platform_version = "LATEST"
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.api.arn
    container_name   = "control-plane"
    container_port   = 8080
  }
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  depends_on = [aws_lb_listener.https, aws_iam_role_policy_attachment.task_execution, aws_iam_role_policy.read_runtime_secrets]
}

resource "aws_ecs_service" "web" {
  name            = "qcore-staging-web"
  cluster         = aws_ecs_cluster.staging.id
  task_definition = aws_ecs_task_definition.web.arn
  desired_count   = 2
  launch_type     = "FARGATE"
  platform_version = "LATEST"
  network_configuration {
    subnets          = aws_subnet.private[*].id
    security_groups  = [aws_security_group.tasks.id]
    assign_public_ip = false
  }
  load_balancer {
    target_group_arn = aws_lb_target_group.web.arn
    container_name   = "intelligence-plane"
    container_port   = 3000
  }
  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
  depends_on = [aws_lb_listener.https, aws_iam_role_policy_attachment.task_execution]
}
