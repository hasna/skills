#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/pr_preview_lib.sh"

assert_aws_account

SERVICE_NAME="$(preview_service_name)"
TASK_FAMILY="$(preview_task_family)"
TG_NAME="$(preview_target_group_name)"
HOST="$(preview_host)"
DB_NAME="$(preview_db_name)"
RUNTIME_SECRET_NAME="$(preview_runtime_secret_name)"
LISTENER_ARN="$(resolve_listener_arn)"
SUBNETS="$(resolve_public_subnets_csv)"
ECS_SG_ID="${PREVIEW_ECS_SG:-$(resolve_security_group_id skillsmd-ecs-tasks)}"
SLEEP_SECONDS="${PREVIEW_CLEANUP_SLEEP_SECONDS:-10}"

RULE_ARN="$(aws_text aws elbv2 describe-rules \
  --listener-arn "$LISTENER_ARN" \
  --query 'Rules[?Conditions[?Field==`host-header` && contains(Values, `'"$HOST"'`)]].RuleArn | [0]')"
if ! is_empty_aws_text "$RULE_ARN"; then
  aws elbv2 delete-rule --rule-arn "$RULE_ARN" >/dev/null
  echo "Deleted listener rule for $HOST"
fi

aws ecs update-service \
  --cluster "$PREVIEW_CLUSTER" \
  --service "$SERVICE_NAME" \
  --desired-count 0 >/dev/null 2>&1 || true
aws ecs delete-service \
  --cluster "$PREVIEW_CLUSTER" \
  --service "$SERVICE_NAME" \
  --force >/dev/null 2>&1 || true
echo "Deleted ECS service if present: $SERVICE_NAME"

sleep "$SLEEP_SECONDS"
TG_ARN="$(aws_text aws elbv2 describe-target-groups --names "$TG_NAME" --query 'TargetGroups[0].TargetGroupArn')"
if ! is_empty_aws_text "$TG_ARN"; then
  aws elbv2 delete-target-group --target-group-arn "$TG_ARN" >/dev/null
  echo "Deleted target group: $TG_NAME"
fi

ADMIN_TD="$(aws_text aws ecs list-task-definitions \
  --family-prefix "$PREVIEW_ADMIN_TASK_FAMILY" \
  --sort DESC \
  --query 'taskDefinitionArns[0]')"

if ! is_empty_aws_text "$ADMIN_TD"; then
  BASE_RUNTIME_SECRET="${BASE_RUNTIME_SECRET:-skillsmd/preview/runtime/env}"
  WORK_DIR="$(mktemp -d)"
  cleanup() { rm -rf "$WORK_DIR"; }
  trap cleanup EXIT
  aws secretsmanager get-secret-value --secret-id "$BASE_RUNTIME_SECRET" --query SecretString --output text >"$WORK_DIR/base-runtime.json"
  DATABASE_URL="$(jq -r '.DATABASE_URL' "$WORK_DIR/base-runtime.json")"
  db_parts="$(node -e 'const u = new URL(process.argv[1]); console.log(JSON.stringify({user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), host: u.hostname, port: u.port || "5432"}));' "$DATABASE_URL")"
  SQL_CMD="dropdb --if-exists '$DB_NAME'"
  OVERRIDES="$(jq -nc \
    --arg cmd "$SQL_CMD" \
    --arg pgHost "$(jq -r '.host' <<<"$db_parts")" \
    --arg pgPort "$(jq -r '.port' <<<"$db_parts")" \
    --arg pgUser "$(jq -r '.user' <<<"$db_parts")" \
    --arg pgPassword "$(jq -r '.password' <<<"$db_parts")" \
    '{containerOverrides:[{name:"psql",command:["sh","-lc",$cmd],environment:[{name:"PGHOST",value:$pgHost},{name:"PGPORT",value:$pgPort},{name:"PGUSER",value:$pgUser},{name:"PGPASSWORD",value:$pgPassword},{name:"PGSSLMODE",value:"require"}]}]}')"
  TASK_ARN="$(aws ecs run-task \
    --cluster "$PREVIEW_CLUSTER" \
    --launch-type FARGATE \
    --task-definition "$ADMIN_TD" \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
    --overrides "$OVERRIDES" \
    --query 'tasks[0].taskArn' \
    --output text 2>/dev/null || true)"
  if ! is_empty_aws_text "$TASK_ARN"; then
    aws ecs wait tasks-stopped --cluster "$PREVIEW_CLUSTER" --tasks "$TASK_ARN"
    echo "Dropped database if present: $DB_NAME"
  fi
fi

TASK_DEFS="$(aws ecs list-task-definitions \
  --family-prefix "$TASK_FAMILY" \
  --query 'taskDefinitionArns[]' \
  --output text 2>/dev/null || true)"
for arn in $TASK_DEFS; do
  aws ecs deregister-task-definition --task-definition "$arn" >/dev/null 2>&1 || true
done
echo "Deregistered task definitions for $TASK_FAMILY"

aws secretsmanager delete-secret \
  --secret-id "$RUNTIME_SECRET_NAME" \
  --force-delete-without-recovery >/dev/null 2>&1 || true
echo "Deleted runtime secret if present: $RUNTIME_SECRET_NAME"
