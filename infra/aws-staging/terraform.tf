# Configure the backend in a separate backend.hcl file supplied by the operator:
# terraform init -backend-config=backend.hcl
# Do not store state locally for shared staging or commit state/plan files.
terraform {
  backend "s3" {}
}
