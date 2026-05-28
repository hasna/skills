#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/production_lib.sh"

assert_aws_account

for command in aws jq curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "::error::Missing required command: $command" >&2
    exit 1
  fi
done

status=0

check() {
  local name="$1"
  shift
  if "$@" >/tmp/skillsmd-readiness.out 2>/tmp/skillsmd-readiness.err; then
    echo "ok $name"
  else
    status=1
    echo "::error::$name failed" >&2
    sed -E 's/(sk_|rk_|pk_|whsec_)[A-Za-z0-9_]+/REDACTED/g' /tmp/skillsmd-readiness.err >&2 || true
  fi
}

check_s3_bucket_private() {
  local bucket="$1"
  aws s3api get-public-access-block \
    --bucket "$bucket" \
    --query 'PublicAccessBlockConfiguration' \
    --output json |
    jq -e '
      .BlockPublicAcls == true and
      .IgnorePublicAcls == true and
      .BlockPublicPolicy == true and
      .RestrictPublicBuckets == true
    ' >/dev/null
  aws s3api get-bucket-encryption \
    --bucket "$bucket" \
    --query 'ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault.SSEAlgorithm' \
    --output text | grep -qx 'AES256'
  aws s3api get-bucket-versioning \
    --bucket "$bucket" \
    --query 'Status' \
    --output text | grep -qx 'Enabled'
}

check "production Stripe live secret shape" bash "$SCRIPT_DIR/production_validate_secrets.sh"
check "production runtime secret shape" bash "$SCRIPT_DIR/production_validate_runtime_secrets.sh"
check "production S3 assets bucket private" check_s3_bucket_private "$PRODUCTION_S3_ASSETS_BUCKET"
check "production S3 exports bucket private" check_s3_bucket_private "$PRODUCTION_S3_EXPORTS_BUCKET"

alb_state="$(aws_text aws elbv2 describe-load-balancers \
  --names "$PRODUCTION_ALB_NAME" \
  --query "LoadBalancers[0].State.Code")"
if [[ "$alb_state" == "active" ]]; then
  echo "ok production ALB exists"
else
  status=1
  echo "::error::production ALB is not active: $PRODUCTION_ALB_NAME" >&2
fi

if resolve_listener_arn >/dev/null; then
  echo "ok production HTTPS listener exists"
else
  status=1
  echo "::error::production HTTPS listener is missing" >&2
fi

cluster_state="$(aws_text aws ecs describe-clusters \
  --clusters "$PRODUCTION_CLUSTER" \
  --query "clusters[0].status")"
if [[ "$cluster_state" == "ACTIVE" ]]; then
  echo "ok production ECS cluster exists"
else
  status=1
  echo "::error::production ECS cluster is not active: $PRODUCTION_CLUSTER" >&2
fi

web_count="$(aws ecs describe-services \
  --cluster "$PRODUCTION_CLUSTER" \
  --services "$PRODUCTION_SERVICE_NAME" \
  --query 'services[?status==`ACTIVE`] | length(@)' \
  --output text 2>/dev/null || echo "0")"
if [[ "$web_count" == "1" ]]; then
  echo "ok production web service exists"
else
  status=1
  echo "::error::production web service is not active: $PRODUCTION_SERVICE_NAME" >&2
fi

worker_count="$(aws ecs describe-services \
  --cluster "$PRODUCTION_CLUSTER" \
  --services "$PRODUCTION_WORKER_SERVICE_NAME" \
  --query 'services[?status==`ACTIVE`] | length(@)' \
  --output text 2>/dev/null || echo "0")"
if [[ "$worker_count" == "1" ]]; then
  echo "ok production worker service exists"
else
  status=1
  echo "::error::production worker service is not active: $PRODUCTION_WORKER_SERVICE_NAME" >&2
fi

if curl -fsS --max-time 10 "https://$PRODUCTION_DOMAIN/api/health" >/dev/null 2>&1; then
  echo "ok production health endpoint"
else
  status=1
  echo "::error::production health endpoint is not reachable" >&2
fi

exit "$status"
