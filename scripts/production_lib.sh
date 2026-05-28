#!/usr/bin/env bash
set -euo pipefail

EXPECTED_ACCOUNT_ID="059898286899"
AWS_REGION="${AWS_REGION:-us-east-1}"
PRODUCTION_CLUSTER="${PRODUCTION_CLUSTER:-skillsmd-production}"
PRODUCTION_ALB_NAME="${PRODUCTION_ALB_NAME:-skillsmd-production}"
PRODUCTION_DOMAIN="${PRODUCTION_DOMAIN:-skills.md}"
PRODUCTION_CONTAINER_NAME="${PRODUCTION_CONTAINER_NAME:-skillsmd-web}"
PRODUCTION_RUNTIME_PORT="${PRODUCTION_RUNTIME_PORT:-3505}"
PRODUCTION_TASK_FAMILY="${PRODUCTION_TASK_FAMILY:-skillsmd-production-web}"
PRODUCTION_SERVICE_NAME="${PRODUCTION_SERVICE_NAME:-skillsmd-production-web}"
PRODUCTION_TARGET_GROUP_NAME="${PRODUCTION_TARGET_GROUP_NAME:-skillsmd-production-web}"
PRODUCTION_WORKER_TASK_FAMILY="${PRODUCTION_WORKER_TASK_FAMILY:-skillsmd-production-workers}"
PRODUCTION_WORKER_SERVICE_NAME="${PRODUCTION_WORKER_SERVICE_NAME:-skillsmd-production-workers}"
PRODUCTION_RUNTIME_SECRET_NAME="${PRODUCTION_RUNTIME_SECRET_NAME:-skillsmd/production/runtime/env}"
PRODUCTION_STRIPE_SECRET_NAME="${PRODUCTION_STRIPE_SECRET_NAME:-skillsmd/production/stripe}"
PRODUCTION_S3_ASSETS_BUCKET="${PRODUCTION_S3_ASSETS_BUCKET:-skillsmd-059898286899-assets}"
PRODUCTION_S3_EXPORTS_BUCKET="${PRODUCTION_S3_EXPORTS_BUCKET:-skillsmd-059898286899-exports}"

require_env() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    echo "::error::$name is required" >&2
    exit 1
  fi
}

is_empty_aws_text() {
  local value="${1:-}"
  [[ -z "$value" || "$value" == "None" || "$value" == "null" ]]
}

fail_if_empty_aws_text() {
  local value="${1:-}"
  local message="$2"
  if is_empty_aws_text "$value"; then
    echo "::error::$message" >&2
    exit 1
  fi
}

assert_aws_account() {
  local actual_account_id
  actual_account_id="$(aws sts get-caller-identity --query Account --output text)"
  if [[ "$actual_account_id" != "$EXPECTED_ACCOUNT_ID" ]]; then
    echo "::error::Refusing to modify AWS account $actual_account_id; expected $EXPECTED_ACCOUNT_ID." >&2
    exit 1
  fi
}

aws_text() {
  local value
  value="$("$@" --output text 2>/dev/null || true)"
  if [[ "$value" == "None" || "$value" == "null" ]]; then
    value=""
  fi
  printf '%s' "$value"
}

resolve_public_subnets_csv() {
  if [[ -n "${PRODUCTION_SUBNETS:-}" ]]; then
    printf '%s' "$PRODUCTION_SUBNETS"
    return
  fi
  aws ec2 describe-subnets \
    --filters "Name=tag:Name,Values=skillsmd-public-1,skillsmd-public-2" \
    --query 'Subnets | sort_by(@,&AvailabilityZone)[].SubnetId' \
    --output text | tr '\t' ','
}

resolve_security_group_id() {
  local group_name="$1"
  aws_text aws ec2 describe-security-groups \
    --filters "Name=group-name,Values=$group_name" \
    --query 'SecurityGroups[0].GroupId'
}

resolve_vpc_id() {
  if [[ -n "${PRODUCTION_VPC_ID:-}" ]]; then
    printf '%s' "$PRODUCTION_VPC_ID"
    return
  fi
  aws_text aws ec2 describe-vpcs \
    --filters "Name=tag:Name,Values=skillsmd-vpc" \
    --query 'Vpcs[0].VpcId'
}

resolve_role_arn() {
  local role_name="$1"
  aws iam get-role --role-name "$role_name" --query 'Role.Arn' --output text
}

resolve_secret_arn() {
  local secret_name="$1"
  aws secretsmanager describe-secret --secret-id "$secret_name" --query ARN --output text
}

json_secret_ref() {
  local secret_arn="$1"
  local json_key="$2"
  printf '%s:%s::' "$secret_arn" "$json_key"
}

resolve_listener_arn() {
  if [[ -n "${PRODUCTION_ALB_LISTENER_ARN:-}" ]]; then
    printf '%s' "$PRODUCTION_ALB_LISTENER_ARN"
    return
  fi

  local alb_arn
  alb_arn="$(aws_text aws elbv2 describe-load-balancers \
    --names "$PRODUCTION_ALB_NAME" \
    --query 'LoadBalancers[0].LoadBalancerArn')"
  fail_if_empty_aws_text "$alb_arn" "Production ALB $PRODUCTION_ALB_NAME does not exist."

  local listener_arn
  listener_arn="$(aws_text aws elbv2 describe-listeners \
    --load-balancer-arn "$alb_arn" \
    --query 'Listeners[?Port==`443`].ListenerArn | [0]')"
  fail_if_empty_aws_text "$listener_arn" "Production ALB $PRODUCTION_ALB_NAME has no HTTPS listener."
  printf '%s' "$listener_arn"
}

append_github_output() {
  local name="$1"
  local value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$name" "$value" >>"$GITHUB_OUTPUT"
  fi
}
