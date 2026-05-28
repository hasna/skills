#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/bootstrap_ecs_foundation.sh [--profile <profile>] [--region <region>]

Creates or updates the ECS foundation for skills.md:
- preview and production ECS clusters with Fargate capacity providers
- shared task execution and task roles
- CloudWatch log groups for web and workers containers

This script intentionally does not create VPCs, load balancers, ECS services,
or databases. Those resources are owned by separate AWS plan tasks.
USAGE
}

PROFILE="hasnatools"
REGION="us-east-1"
EXPECTED_ACCOUNT_ID="059898286899"
EXECUTION_ROLE="tool-skillsmd-ecs-task-execution"
TASK_ROLE="tool-skillsmd-ecs-task"
CLUSTERS=(
  skillsmd-preview
  skillsmd-production
)
LOG_GROUPS=(
  /ecs/skillsmd/preview/web:30
  /ecs/skillsmd/preview/workers:30
  /ecs/skillsmd/production/web:90
  /ecs/skillsmd/production/workers:90
)

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      usage
      exit 0
      ;;
    --profile)
      PROFILE="${2:-}"
      shift 2
      ;;
    --region)
      REGION="${2:-}"
      shift 2
      ;;
    *)
      echo "Unexpected argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ -z "$PROFILE" || -z "$REGION" ]]; then
  echo "Profile and region must not be empty." >&2
  exit 2
fi

for command in aws mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command: $command" >&2
    exit 1
  fi
done

actual_account_id="$(
  aws sts get-caller-identity \
    --profile "$PROFILE" \
    --query Account \
    --output text
)"

if [[ "$actual_account_id" != "$EXPECTED_ACCOUNT_ID" ]]; then
  echo "Refusing to modify AWS account $actual_account_id; expected $EXPECTED_ACCOUNT_ID." >&2
  exit 1
fi

ASSUME_ROLE_POLICY="$(mktemp)"
EXECUTION_SECRETS_POLICY="$(mktemp)"
cleanup() {
  rm -f "$ASSUME_ROLE_POLICY" "$EXECUTION_SECRETS_POLICY"
}
trap cleanup EXIT

cat >"$ASSUME_ROLE_POLICY" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Service": "ecs-tasks.amazonaws.com"
      },
      "Action": "sts:AssumeRole"
    }
  ]
}
JSON

cat >"$EXECUTION_SECRETS_POLICY" <<'JSON'
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ReadSkillsMdRuntimeSecrets",
      "Effect": "Allow",
      "Action": [
        "secretsmanager:DescribeSecret",
        "secretsmanager:GetSecretValue"
      ],
      "Resource": "arn:aws:secretsmanager:us-east-1:059898286899:secret:skillsmd/*"
    }
  ]
}
JSON

ensure_role() {
  local role_name="$1"

  if aws iam get-role \
    --profile "$PROFILE" \
    --role-name "$role_name" >/dev/null 2>&1; then
    echo "Role exists: $role_name"
  else
    aws iam create-role \
      --profile "$PROFILE" \
      --role-name "$role_name" \
      --assume-role-policy-document "file://$ASSUME_ROLE_POLICY" \
      --tags \
        Key=Service,Value=skills.md \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value=hasnatools/platform-skills >/dev/null
    echo "Created role: $role_name"
  fi
}

ensure_role "$EXECUTION_ROLE"
ensure_role "$TASK_ROLE"

aws iam attach-role-policy \
  --profile "$PROFILE" \
  --role-name "$EXECUTION_ROLE" \
  --policy-arn arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy >/dev/null

echo "Attached ECS task execution policy to $EXECUTION_ROLE"

aws iam put-role-policy \
  --profile "$PROFILE" \
  --role-name "$EXECUTION_ROLE" \
  --policy-name skillsmd-runtime-secrets-read \
  --policy-document "file://$EXECUTION_SECRETS_POLICY" >/dev/null

echo "Attached runtime secret read policy to $EXECUTION_ROLE"

for cluster in "${CLUSTERS[@]}"; do
  cluster_status="$(
    aws ecs describe-clusters \
      --profile "$PROFILE" \
      --region "$REGION" \
      --clusters "$cluster" \
      --query 'clusters[0].status' \
      --output text 2>/dev/null || true
  )"

  if [[ "$cluster_status" == "ACTIVE" ]]; then
    echo "Cluster exists: $cluster"
  else
    aws ecs create-cluster \
      --profile "$PROFILE" \
      --region "$REGION" \
      --cluster-name "$cluster" \
      --capacity-providers FARGATE FARGATE_SPOT \
      --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1 \
      --settings name=containerInsights,value=enabled \
      --tags \
        key=Service,value=skills.md \
        key=ManagedBy,value=platform-skills \
        key=Repository,value=hasnatools/platform-skills >/dev/null
    echo "Created cluster: $cluster"
  fi

  aws ecs put-cluster-capacity-providers \
    --profile "$PROFILE" \
    --region "$REGION" \
    --cluster "$cluster" \
    --capacity-providers FARGATE FARGATE_SPOT \
    --default-capacity-provider-strategy capacityProvider=FARGATE,weight=1 >/dev/null

  aws ecs update-cluster-settings \
    --profile "$PROFILE" \
    --region "$REGION" \
    --cluster "$cluster" \
    --settings name=containerInsights,value=enabled >/dev/null

  echo "Configured cluster: $cluster"
done

for entry in "${LOG_GROUPS[@]}"; do
  log_group="${entry%%:*}"
  retention_days="${entry##*:}"

  if aws logs describe-log-groups \
    --profile "$PROFILE" \
    --region "$REGION" \
    --log-group-name-prefix "$log_group" \
    --query "logGroups[?logGroupName=='$log_group'].logGroupName | [0]" \
    --output text | grep -qx "$log_group"; then
    echo "Log group exists: $log_group"
  else
    aws logs create-log-group \
      --profile "$PROFILE" \
      --region "$REGION" \
      --log-group-name "$log_group" \
      --tags Service=skills.md,ManagedBy=platform-skills,Repository=hasnatools/platform-skills
    echo "Created log group: $log_group"
  fi

  aws logs put-retention-policy \
    --profile "$PROFILE" \
    --region "$REGION" \
    --log-group-name "$log_group" \
    --retention-in-days "$retention_days"

  echo "Configured log group: $log_group ($retention_days days)"
done

aws ecs describe-clusters \
  --profile "$PROFILE" \
  --region "$REGION" \
  --clusters "${CLUSTERS[@]}" \
  --include SETTINGS \
  --query 'clusters[].{name:clusterName,status:status,settings:settings}' \
  --output table
