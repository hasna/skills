#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/pr_preview_lib.sh"

assert_aws_account

for command in aws jq node; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "::error::Missing required command: $command" >&2
    exit 1
  fi
done

DB_NAME="$(preview_db_name)"
RUNTIME_SECRET_NAME="$(preview_runtime_secret_name)"
BASE_RUNTIME_SECRET="${BASE_RUNTIME_SECRET:-skillsmd/preview/runtime/env}"
SUBNETS="$(resolve_public_subnets_csv)"
ECS_SG_ID="${PREVIEW_ECS_SG:-$(resolve_security_group_id skillsmd-ecs-tasks)}"
EXECUTION_ROLE_ARN="$(resolve_role_arn tool-skillsmd-ecs-task-execution)"
TASK_ROLE_ARN="$(resolve_role_arn tool-skillsmd-ecs-task)"

fail_if_empty_aws_text "$SUBNETS" "Preview public subnets not found"
fail_if_empty_aws_text "$ECS_SG_ID" "Preview ECS security group not found"

if [[ ! "$DB_NAME" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
  echo "::error::Preview database name must be a safe PostgreSQL identifier: $DB_NAME" >&2
  exit 1
fi

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

base_runtime="$WORK_DIR/base-runtime.json"
preview_runtime="$WORK_DIR/preview-runtime.json"
taskdef="$WORK_DIR/admin-taskdef.json"

aws secretsmanager get-secret-value \
  --secret-id "$BASE_RUNTIME_SECRET" \
  --query SecretString \
  --output text >"$base_runtime"

DATABASE_URL="$(jq -r '.DATABASE_URL' "$base_runtime")"
if [[ -z "$DATABASE_URL" || "$DATABASE_URL" == "null" ]]; then
  echo "::error::DATABASE_URL missing from $BASE_RUNTIME_SECRET" >&2
  exit 1
fi

db_parts="$(node -e 'const u = new URL(process.argv[1]); console.log(JSON.stringify({user: decodeURIComponent(u.username), password: decodeURIComponent(u.password), host: u.hostname, port: u.port || "5432"}));' "$DATABASE_URL")"
PGUSER_VALUE="$(jq -r '.user' <<<"$db_parts")"
PGPASSWORD_VALUE="$(jq -r '.password' <<<"$db_parts")"
PGHOST_VALUE="$(jq -r '.host' <<<"$db_parts")"
PGPORT_VALUE="$(jq -r '.port' <<<"$db_parts")"

node -e '
const fs = require("fs");
const path = process.argv[1];
const dbName = process.argv[2];
const host = process.argv[3];
const appUrl = process.argv[4];
const data = JSON.parse(fs.readFileSync(path, "utf8"));
const u = new URL(data.DATABASE_URL);
u.pathname = `/${dbName}`;
data.DATABASE_URL = u.toString();
data.NEXT_PUBLIC_APP_URL = appUrl;
data.SKILLS_API_URL = `${appUrl}/api/v1`;
fs.writeFileSync(process.argv[5], JSON.stringify(data, null, 2));
' "$base_runtime" "$DB_NAME" "$PGHOST_VALUE" "$(preview_url)" "$preview_runtime"

if aws secretsmanager describe-secret --secret-id "$RUNTIME_SECRET_NAME" >/dev/null 2>&1; then
  aws secretsmanager put-secret-value \
    --secret-id "$RUNTIME_SECRET_NAME" \
    --secret-string "file://$preview_runtime" >/dev/null
  echo "Updated preview runtime secret: $RUNTIME_SECRET_NAME"
else
  aws secretsmanager create-secret \
    --name "$RUNTIME_SECRET_NAME" \
    --description "skills.md $(preview_id) runtime environment" \
    --secret-string "file://$preview_runtime" \
    --tags Key=Service,Value=skills.md Key=ManagedBy,Value=platform-skills Key=Repository,Value=hasnatools/platform-skills Key=Environment,Value=preview Key=PreviewId,Value="$(preview_id)" >/dev/null
  echo "Created preview runtime secret: $RUNTIME_SECRET_NAME"
fi

cat >"$taskdef" <<JSON
{
  "family": "$PREVIEW_ADMIN_TASK_FAMILY",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "256",
  "memory": "512",
  "executionRoleArn": "$EXECUTION_ROLE_ARN",
  "taskRoleArn": "$TASK_ROLE_ARN",
  "containerDefinitions": [
    {
      "name": "psql",
      "image": "public.ecr.aws/docker/library/postgres:16-alpine",
      "essential": true,
      "command": ["sh", "-lc", "psql --version"],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/skillsmd/preview/web",
          "awslogs-region": "$AWS_REGION",
          "awslogs-stream-prefix": "admin"
        }
      }
    }
  ]
}
JSON

ADMIN_TASK_DEF_ARN="$(aws ecs register-task-definition \
  --cli-input-json "file://$taskdef" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)"
fail_if_empty_aws_text "$ADMIN_TASK_DEF_ARN" "Admin task definition registration failed"

SQL_CMD="psql -v ON_ERROR_STOP=1 -d postgres -c \"SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$DB_NAME'\" >/dev/null && dropdb --if-exists '$DB_NAME' && createdb '$DB_NAME'"
OVERRIDES="$(jq -nc \
  --arg cmd "$SQL_CMD" \
  --arg pgHost "$PGHOST_VALUE" \
  --arg pgPort "$PGPORT_VALUE" \
  --arg pgUser "$PGUSER_VALUE" \
  --arg pgPassword "$PGPASSWORD_VALUE" \
  '{
    containerOverrides: [{
      name: "psql",
      command: ["sh", "-lc", $cmd],
      environment: [
        {name:"PGHOST", value:$pgHost},
        {name:"PGPORT", value:$pgPort},
        {name:"PGUSER", value:$pgUser},
        {name:"PGPASSWORD", value:$pgPassword},
        {name:"PGSSLMODE", value:"require"}
      ]
    }]
  }')"

TASK_ARN="$(aws ecs run-task \
  --cluster "$PREVIEW_CLUSTER" \
  --launch-type FARGATE \
  --task-definition "$ADMIN_TASK_DEF_ARN" \
  --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
  --overrides "$OVERRIDES" \
  --query 'tasks[0].taskArn' \
  --output text 2>/dev/null || true)"
fail_if_empty_aws_text "$TASK_ARN" "Preview DB creation task failed to start"

echo "DB creation task started: $TASK_ARN"
aws ecs wait tasks-stopped --cluster "$PREVIEW_CLUSTER" --tasks "$TASK_ARN"
EXIT_CODE="$(aws ecs describe-tasks --cluster "$PREVIEW_CLUSTER" --tasks "$TASK_ARN" --query 'tasks[0].containers[0].exitCode' --output text)"
if [[ "$EXIT_CODE" != "0" ]]; then
  echo "::error::Preview DB creation failed with exit code $EXIT_CODE" >&2
  exit 1
fi

append_github_output "database_name" "$DB_NAME"
append_github_output "runtime_secret_name" "$RUNTIME_SECRET_NAME"
echo "Preview database ready: $DB_NAME"
