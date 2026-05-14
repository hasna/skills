#!/usr/bin/env bash
set -euo pipefail

EXPECTED_ACCOUNT_ID="059898286899"
AWS_REGION="${AWS_REGION:-us-east-1}"
PREVIEW_CLUSTER="${PREVIEW_CLUSTER:-skillsmd-preview}"
PREVIEW_DOMAIN="${PREVIEW_DOMAIN:-preview.skills.md}"
PREVIEW_ALB_NAME="${PREVIEW_ALB_NAME:-skillsmd-preview}"
PREVIEW_CONTAINER_NAME="${PREVIEW_CONTAINER_NAME:-skillsmd-web}"
PREVIEW_RUNTIME_PORT="${PREVIEW_RUNTIME_PORT:-3505}"
PREVIEW_ADMIN_TASK_FAMILY="${PREVIEW_ADMIN_TASK_FAMILY:-skillsmd-preview-admin}"
PREVIEW_SECRET_PREFIX="${PREVIEW_SECRET_PREFIX:-skillsmd/preview}"

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

preview_number() {
  require_env PR_NUMBER
  if [[ ! "$PR_NUMBER" =~ ^[0-9]+$ ]]; then
    echo "::error::PR_NUMBER must be numeric" >&2
    exit 1
  fi
  printf '%s' "$PR_NUMBER"
}

preview_id() {
  if [[ -n "${PREVIEW_ID:-}" ]]; then
    printf '%s' "$PREVIEW_ID"
    return
  fi
  printf 'pr-%s' "$(preview_number)"
}

preview_db_name() {
  if [[ -n "${PREVIEW_DB_NAME:-}" ]]; then
    printf '%s' "$PREVIEW_DB_NAME"
    return
  fi
  printf 'skillsmd_pr_%s' "$(preview_number)"
}

preview_host() {
  if [[ -n "${PREVIEW_HOST:-}" ]]; then
    printf '%s' "$PREVIEW_HOST"
    return
  fi
  printf '%s.%s' "$(preview_id)" "$PREVIEW_DOMAIN"
}

preview_url() {
  printf '%s://%s' "${PREVIEW_SCHEME:-https}" "$(preview_host)"
}

preview_service_name() {
  printf 'skillsmd-%s' "$(preview_id)"
}

preview_task_family() {
  printf 'skillsmd-%s' "$(preview_id)"
}

preview_target_group_name() {
  printf 'skillsmd-%s-tg' "$(preview_id)" | cut -c1-32
}

preview_runtime_secret_name() {
  printf '%s/%s/runtime/env' "$PREVIEW_SECRET_PREFIX" "$(preview_id)"
}

preview_rule_priority() {
  if [[ -n "${ALB_RULE_PRIORITY:-}" ]]; then
    printf '%s' "$ALB_RULE_PRIORITY"
    return
  fi
  local pr
  pr="$(preview_number)"
  printf '%s' "$((10000 + (pr % 30000)))"
}

append_github_output() {
  local name="$1"
  local value="$2"
  if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
    printf '%s=%s\n' "$name" "$value" >>"$GITHUB_OUTPUT"
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
  if [[ -n "${PREVIEW_SUBNETS:-}" ]]; then
    printf '%s' "$PREVIEW_SUBNETS"
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
  if [[ -n "${PREVIEW_VPC_ID:-}" ]]; then
    printf '%s' "$PREVIEW_VPC_ID"
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
  if [[ -n "${PREVIEW_ALB_LISTENER_ARN:-}" ]]; then
    printf '%s' "$PREVIEW_ALB_LISTENER_ARN"
    return
  fi

  local alb_arn
  alb_arn="$(aws_text aws elbv2 describe-load-balancers \
    --names "$PREVIEW_ALB_NAME" \
    --query 'LoadBalancers[0].LoadBalancerArn')"
  fail_if_empty_aws_text "$alb_arn" "Preview ALB $PREVIEW_ALB_NAME does not exist. Run bun run aws:bootstrap:preview-edge first."

  local listener_arn
  listener_arn="$(aws_text aws elbv2 describe-listeners \
    --load-balancer-arn "$alb_arn" \
    --query 'Listeners[?Port==`443`].ListenerArn | [0]')"
  if is_empty_aws_text "$listener_arn"; then
    listener_arn="$(aws_text aws elbv2 describe-listeners \
      --load-balancer-arn "$alb_arn" \
      --query 'Listeners[?Port==`80`].ListenerArn | [0]')"
  fi
  fail_if_empty_aws_text "$listener_arn" "Preview ALB $PREVIEW_ALB_NAME has no HTTP or HTTPS listener."
  printf '%s' "$listener_arn"
}

resolve_alb_dns_name() {
  aws_text aws elbv2 describe-load-balancers \
    --names "$PREVIEW_ALB_NAME" \
    --query 'LoadBalancers[0].DNSName'
}
