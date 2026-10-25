# Q-Core AWS staging bootstrap (ap-south-1)

**Status: design/bootstrap instructions only. No AWS resources have been provisioned.**

## Target architecture

- AWS region: `ap-south-1` (Mumbai).
- Dedicated non-production AWS account or isolated staging account; no production/payment-rail connectivity.
- VPC across 2 Availability Zones, public subnets for an internet-facing Application Load Balancer, private subnets for ECS tasks and RDS.
- ECS Fargate control-plane service with desired count 2, deployed from an immutable ECR image digest.
- RDS PostgreSQL in private subnets, encryption at rest, automated backups, deletion protection disabled only for explicitly disposable staging and with a documented teardown.
- HTTPS listener using an ACM certificate for a domain controlled by Vardhan. HTTP redirects to HTTPS. The database and application ports are not public.
- CloudWatch logs/alarms; task execution IAM role; Secrets Manager for runtime secrets; GitHub Actions OIDC role for deployments (no long-lived AWS access keys in GitHub).
- Separate security groups: ALB to application port only; application to PostgreSQL 5432 only; no direct public task/database ingress.

## Important application-image constraint

The repository's `docker-compose.enterprise.yml` builds the control-plane and intelligence-plane images locally. ECS cannot run those image references until the images are built and pushed to ECR. The application also expects a valid `DATABASE_URL`, `VARDHAN_ADMIN_PASSWORD`, and the product's required runtime configuration. Confirm image build targets, migrations, health response shape, and startup key-provider behavior before creating ECS services. Do not use `latest` as the deployed release identity; pin a digest.

## Bootstrap sequence

1. Create/choose a dedicated AWS account and enable MFA for human administrators. Confirm billing alerts and an owner for teardown.
2. Select a DNS name under a domain Vardhan controls (for example, a dedicated staging subdomain). Create/validate an ACM certificate in `ap-south-1`. Do not proceed with a public HTTPS listener until the certificate is issued.
3. Configure Terraform remote state **before** applying infrastructure: dedicated S3 bucket with versioning, SSE-KMS encryption, public access blocked and tightly scoped IAM; use native S3 state locking if supported by the installed Terraform version. Do not commit state files or plan files.
4. Build and test the production container image locally/CI, create ECR repositories, scan images, and push immutable tags/digests.
5. Configure runtime secrets in Secrets Manager. The application `DATABASE_URL` secret must contain a PostgreSQL connection string that reaches the private RDS endpoint, and the admin password must be a generated high-entropy value. Do not paste secrets into chat or commit them.
6. Apply network/database/compute infrastructure with the minimum required IAM permissions. Keep tasks private; only the ALB is public. Restrict SSH/SSM access and avoid opening database ingress.
7. Run deployment smoke tests, then the remote acceptance suite in `docs/STAGING_ACCEPTANCE_PLAN.md`. Save sanitized logs, task definitions, image digests, DB engine details, TLS handshake output and test results as evidence.
8. Tear down disposable resources after acceptance unless the staging owner explicitly approves ongoing use. Retain evidence separately from ephemeral infrastructure.

## Required inputs before apply

- AWS account ID and confirmation the account is dedicated/approved for non-production.
- Permission to create VPC/subnets/routes/NAT or VPC endpoints, security groups, ALB/listeners/target groups, ECS cluster/services/task definitions, ECR repositories, RDS PostgreSQL/subnet group/parameter group, Secrets Manager references, CloudWatch logs/alarms, IAM roles/policies and ACM/DNS records if applicable.
- ACM certificate ARN in `ap-south-1` for a domain controlled by Vardhan.
- DNS zone/record management authority, or an operator to add the ALB alias record.
- Immutable ECR image URI/digest for each deployed service and confirmation of required ports/health endpoints.
- Secret ARNs for `DATABASE_URL` and `VARDHAN_ADMIN_PASSWORD`, with least-privilege read access for the ECS task role. Keep secret values out of Terraform variables/state where possible.
- Budget owner and spending limit. NAT gateways, ALB, ECS and RDS incur ongoing charges.
- A chosen real KMS/HSM integration and test key only if the first staging milestone includes hardware/cloud key-protection acceptance. AWS KMS is available in-region; it does not itself establish FIPS validation of Q-Core.

## IAM access model (preferred)

Use GitHub Actions OIDC with a narrowly scoped role trusted only by this repository and the staging deployment environment/branch. Human bootstrap access should be temporary, MFA-protected and limited to infrastructure setup. Do not create IAM users with permanent access keys for CI.

Do not grant `AdministratorAccess` to CI. The deployment role should be limited to the required ECR push, ECS task/service update, task-definition registration, and `iam:PassRole` on the two exact ECS roles. Terraform bootstrap permissions are broader and should be temporary, used by an authorized operator, and removed/reduced after setup.

## Exit criteria

The environment is not considered deployed until the live HTTPS endpoint, both healthy application task identities, RDS PostgreSQL connectivity, cross-task idempotency/failover evidence, and receipt/tamper/replay acceptance results are recorded. A green GitHub workflow alone is insufficient. FIPS status must continue to report `NOT_CERTIFIED` unless a valid applicable CMVP certificate is verified.
