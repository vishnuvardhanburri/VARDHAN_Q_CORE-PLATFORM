#!/usr/bin/env bash
set -e

echo "=================================================================="
echo " VARDHAN TECHNOLOGIES :: 1-CLICK ENTERPRISE EDGE DEPLOYER"
echo "=================================================================="

TENANT_ID=${1:-"TENANT_PILOT_DEFAULT"}
NAMESPACE="pq-shield-edge"

echo "[1/4] Validating DevSecOps Environment..."
command -v docker >/dev/null 2>&1 || { echo "Docker is required but not installed. Aborting."; exit 1; }
command -v helm >/dev/null 2>&1 || { echo "Helm is required but not installed. Aborting."; exit 1; }

echo "[2/4] Building Local Distroless OCI Image..."
docker build -t vardhan-quantum/pq_shield:latest -f deploy_pack/Dockerfile .

echo "[3/4] Preparing Kubernetes Namespace & Secrets for Tenant: ${TENANT_ID}..."
kubectl create namespace ${NAMESPACE} --dry-run=client -o yaml | kubectl apply -f -

echo "[4/4] Executing Helm Dry-Run Deployment..."
helm template pq-shield-edge deploy_pack/helm/pq-shield \
  --set tenant.id="${TENANT_ID}" \
  --namespace ${NAMESPACE} > deploy_pack/helm_rendered_spec.yaml

echo ""
echo "------------------------------------------------------------------"
echo " SUCCESS: Enterprise Edge Deployment Package Rendered!"
echo " Rendered Spec: deploy_pack/helm_rendered_spec.yaml"
echo ""
echo " To deploy live to cluster, run:"
echo "   helm upgrade --install pq-shield deploy_pack/helm/pq-shield -n ${NAMESPACE}"
echo "------------------------------------------------------------------"
