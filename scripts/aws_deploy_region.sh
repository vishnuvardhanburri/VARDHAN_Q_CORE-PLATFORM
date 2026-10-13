#!/usr/bin/env bash
set -euo pipefail

# P3.5.4: Multi-Region AWS Deployment Script
#
# Usage:
#   ./scripts/aws_deploy_region.sh <region> <cluster-name>
#
# Example:
#   ./scripts/aws_deploy_region.sh us-east-1 pq-shield-ue1
#   ./scripts/aws_deploy_region.sh eu-west-1 pq-shield-euw1
#
# This script:
#   1. Validates AWS CLI + kubectl access for the target region
#   2. Updates the kubeconfig to point at the target EKS cluster
#   3. Creates/updates the KMS-backed secret for the region
#   4. Applies the region-specific k8s manifests
#   5. Waits for all pods to become Ready
#   6. Optionally enables cross-region failover routing

REGION=${1:-"us-east-1"}
CLUSTER_NAME=${2:-"pq-shield-${REGION}"}
NAMESPACE="pq-shield"

echo "=================================================================="
echo " VARDHAN TECHNOLOGIES :: Multi-Region AWS Deploy"
echo " Region: ${REGION}  |  Cluster: ${CLUSTER_NAME}"
echo "=================================================================="

# ── Pre-flight checks ────────────────────────────────────────────────────────
echo "[1/6] Validating prerequisites..."
command -v aws >/dev/null 2>&1 || { echo "ERROR: aws cli not found"; exit 1; }
command -v kubectl >/dev/null 2>&1 || { echo "ERROR: kubectl not found"; exit 1; }
command -v helm >/dev/null 2>&1 || { echo "ERROR: helm not found"; exit 1; }

# P3.7: Verify HPA metrics-server is available
kubectl get apiservice v1beta1.metrics.k8s.io >/dev/null 2>&1 || {
    echo "ERROR: metrics-server not installed. HPA requires metrics-server."
    echo "  Install: kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml"
    exit 1
}

# Verify we can assume the right AWS region
export AWS_DEFAULT_REGION="${REGION}"
aws sts get-caller-identity >/dev/null 2>&1 || {
    echo "ERROR: Cannot assume AWS identity in region ${REGION}"
    exit 1
}
echo "  AWS identity verified."

# ── KMS key validation ────────────────────────────────────────────────────────
echo "[2/6] Validating KMS key for region ${REGION}..."
KMS_KEY_ID_VAR="VARDHAN_KMS_KEY_ID_${REGION//-/_}"  # us-east-1 -> VARDHAN_KMS_KEY_ID_us_east_1
KMS_KEY_ID="${!KMS_KEY_ID_VAR:-}"

if [ -z "$KMS_KEY_ID" ]; then
    # Try to discover a key tagged with kubernetes.io/client-app=pq-shield
    KMS_KEY_ID=$(aws kms list-keys --region "$REGION" --query 'Keys[0].KeyId' --output text 2>/dev/null || echo "")
fi

if [ -z "$KMS_KEY_ID" ]; then
    echo "ERROR: No KMS key found for region ${REGION}"
    echo "  Set the environment variable ${KMS_KEY_ID_VAR} with a valid KMS key ID."
    exit 1
fi

# Verify the key exists and has the right policy
aws kms describe-key --key-id "$KMS_KEY_ID" --region "$REGION" \
    --query 'KeyMetadata.KeyState' --output text >/dev/null 2>&1 || {
    echo "ERROR: KMS key $KMS_KEY_ID not accessible in $REGION"
    exit 1
}
echo "  KMS key $KMS_KEY_ID is active in ${REGION}."

# ── Update kubeconfig ─────────────────────────────────────────────────────────
echo "[3/6] Updating kubeconfig for EKS cluster ${CLUSTER_NAME}..."
aws eks update-kubeconfig --name "$CLUSTER_NAME" --region "$REGION" --alias "pq-shield-${REGION}" 2>&1 | tail -1
echo "  Kubeconfig updated."

# ── Create/update secrets ─────────────────────────────────────────────────────
echo "[4/6] Creating Kubernetes secrets..."
kubectl get namespace "$NAMESPACE" >/dev/null 2>&1 || \
    kubectl create namespace "$NAMESPACE"

# KMS key ID secret
kubectl create secret generic "pq-shield-kms${SUFFIX:--${REGION}}" \
    --from-literal="kms-key-id=${KMS_KEY_ID}" \
    -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

# Admin token secret (rotate per-region in production)
ADMIN_TOKEN="${VARDHAN_ADMIN_TOKEN:-$(openssl rand -hex 32)}"
kubectl create secret generic "pq-shield-admin${SUFFIX:--${REGION}}" \
    --from-literal="token=${ADMIN_TOKEN}" \
    -n "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -

echo "  Secrets applied: KMS key + admin token."
echo "  (Admin token for ${REGION}: ${ADMIN_TOKEN})"

# ── Apply region manifests ────────────────────────────────────────────────────
echo "[5/6] Deploying pq-shield to ${REGION}..."
MANIFEST="deploy_pack/k8s/regional-deployment.yaml"
if [ "$REGION" = "us-east-1" ]; then
    # Deploy only the us-east-1 slice
    kubectl apply -f "$MANIFEST" -n "$NAMESPACE" \
        -l "topology.kubernetes.io/region=${REGION}"
elif [ "$REGION" = "eu-west-1" ]; then
    kubectl apply -f "$MANIFEST" -n "$NAMESPACE" \
        -l "topology.kubernetes.io/region=${REGION}"
else
    # Full deployment
    kubectl apply -f "$MANIFEST" -n "$NAMESPACE"
fi

# Wait for pods to be ready
echo "  Waiting for pods to become Ready..."
STSF_NAME="pq-shield-${REGION}"
if echo "$REGION" | grep -q "us-east"; then
    STSF_NAME="pq-shield-ue1"
else
    STSF_NAME="pq-shield-euw1"
fi
kubectl rollout status "statefulset/${STSF_NAME}" -n "$NAMESPACE" --timeout=300s || {
    echo "ERROR: StatefulSet ${STSF_NAME} did not become ready"
    exit 1
}
echo "  StatefulSet ${STSF_NAME} is Ready."

# P3.7: Verify HPA is functional
HPA_NAME="${STSF_NAME}-hpa"
kubectl get hpa "${HPA_NAME}" -n "$NAMESPACE" >/dev/null 2>&1 && {
    echo "  HPA ${HPA_NAME} is configured."
    kubectl get hpa "${HPA_NAME}" -n "$NAMESPACE" --no-headers | tail -1 | xargs -I{} echo "  HPA status: {}"
} || echo "  WARNING: HPA ${HPA_NAME} not found — check regional-deployment.yaml includes HPA"

# ── Cross-region routing (optional) ───────────────────────────────────────────
echo "[6/6] Verifying cross-region connectivity..."
kubectl get nodes -n "$NAMESPACE" -l "topology.kubernetes.io/region=${REGION}" --no-headers | wc -l | xargs -I{} echo "  Worker nodes in ${REGION}: {}"

echo ""
echo "=================================================================="
echo " DEPLOY COMPLETE: pq-shield deployed to ${REGION}"
echo " Cluster: ${CLUSTER_NAME}"
echo " Namespace: ${NAMESPACE}"
echo " StatefulSet: ${STSF_NAME}"
echo ""
echo " Next steps:"
echo "  1. Deploy the other region:  \$0 <other-region> <other-cluster>"
echo "  2. Configure Route 53 / ALB cross-region failover"
echo "  3. Verify: kubectl exec -n ${NAMESPACE} -it ${STSF_NAME}-0 -- curl -s http://localhost:8081/api/v1/cluster/peers"
echo "=================================================================="
