#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/production_lib.sh"

assert_aws_account

SUBNETS="$(resolve_public_subnets_csv)"
ECS_SG_ID="${PRODUCTION_ECS_SG:-$(resolve_security_group_id skillsmd-ecs-tasks)}"
MIGRATION_CMD="${PRODUCTION_MIGRATION_CMD:-bun run db:migrate:preview}"

LATEST_TD="$(aws_text aws ecs list-task-definitions \
  --family-prefix "$PRODUCTION_TASK_FAMILY" \
  --sort DESC \
  --query 'taskDefinitionArns[0]')"
fail_if_empty_aws_text "$LATEST_TD" "No production task definition found for $PRODUCTION_TASK_FAMILY"

OVERRIDES="$(jq -nc \
  --arg container "$PRODUCTION_CONTAINER_NAME" \
  --arg cmd "$MIGRATION_CMD" \
  '{containerOverrides:[{name:$container, command:["sh","-lc",$cmd]}]}')"

TASK_ARN="$(aws ecs run-task \
  --cluster "$PRODUCTION_CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$LATEST_TD" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
  --overrides "$OVERRIDES" \
  --query 'tasks[0].taskArn' \
  --output text 2>/dev/null || true)"
fail_if_empty_aws_text "$TASK_ARN" "Production migration task failed to start"

echo "Migration task started: $TASK_ARN"
aws ecs wait tasks-stopped --cluster "$PRODUCTION_CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE="$(aws ecs describe-tasks --cluster "$PRODUCTION_CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].containers[0].exitCode' --output text)"
if [[ "$EXIT_CODE" != "0" ]]; then
  echo "::error::Production migration failed with exit code $EXIT_CODE" >&2
  exit 1
fi

echo "Production migrations completed"
