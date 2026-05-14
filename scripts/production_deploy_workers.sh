#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/production_lib.sh"

assert_aws_account
require_env PRODUCTION_IMAGE

for command in aws jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "::error::Missing required command: $command" >&2
    exit 1
  fi
done

RUNTIME_SECRET_ARN="$(resolve_secret_arn "$PRODUCTION_RUNTIME_SECRET_NAME")"
SUBNETS="$(resolve_public_subnets_csv)"
ECS_SG_ID="${PRODUCTION_ECS_SG:-$(resolve_security_group_id skillsmd-ecs-tasks)}"
EXECUTION_ROLE_ARN="$(resolve_role_arn tool-skillsmd-ecs-task-execution)"
TASK_ROLE_ARN="$(resolve_role_arn tool-skillsmd-ecs-task)"

fail_if_empty_aws_text "$RUNTIME_SECRET_ARN" "Production runtime secret is missing: $PRODUCTION_RUNTIME_SECRET_NAME"
fail_if_empty_aws_text "$SUBNETS" "Production public subnets not found"
fail_if_empty_aws_text "$ECS_SG_ID" "Production ECS security group not found"

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

taskdef="$WORK_DIR/worker-taskdef.json"

jq -n \
  --arg family "$PRODUCTION_WORKER_TASK_FAMILY" \
  --arg image "$PRODUCTION_IMAGE" \
  --arg executionRoleArn "$EXECUTION_ROLE_ARN" \
  --arg taskRoleArn "$TASK_ROLE_ARN" \
  --arg region "$AWS_REGION" \
  --arg databaseUrl "$(json_secret_ref "$RUNTIME_SECRET_ARN" DATABASE_URL)" \
  --arg redisUrl "$(json_secret_ref "$RUNTIME_SECRET_ARN" REDIS_URL)" \
  --arg workerSecret "$(json_secret_ref "$RUNTIME_SECRET_ARN" WORKER_SECRET)" \
  --arg s3AssetsBucket "$(json_secret_ref "$RUNTIME_SECRET_ARN" S3_ASSETS_BUCKET)" \
  --arg s3ExportsBucket "$(json_secret_ref "$RUNTIME_SECRET_ARN" S3_EXPORTS_BUCKET)" \
  --arg cerebrasApiKey "$(json_secret_ref "$RUNTIME_SECRET_ARN" CEREBRAS_API_KEY)" \
  --arg cerebrasModel "$(json_secret_ref "$RUNTIME_SECRET_ARN" CEREBRAS_MODEL)" \
  '{
    family: $family,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: "1024",
    memory: "2048",
    executionRoleArn: $executionRoleArn,
    taskRoleArn: $taskRoleArn,
    containerDefinitions: [{
      name: "skillsmd-worker",
      image: $image,
      essential: true,
      command: ["bun", "run", "src/platform/runner/worker.ts"],
      environment: [
        {name:"NODE_ENV", value:"production"},
        {name:"APP_ENV", value:"production"},
        {name:"AWS_REGION", value:$region},
        {name:"SKILLS_RUNNER_ENABLED", value:"1"},
        {name:"SKILLS_DB_SERVICE_MODE", value:"1"}
      ],
      secrets: [
        {name:"DATABASE_URL", valueFrom:$databaseUrl},
        {name:"REDIS_URL", valueFrom:$redisUrl},
        {name:"WORKER_SECRET", valueFrom:$workerSecret},
        {name:"S3_ASSETS_BUCKET", valueFrom:$s3AssetsBucket},
        {name:"S3_EXPORTS_BUCKET", valueFrom:$s3ExportsBucket},
        {name:"CEREBRAS_API_KEY", valueFrom:$cerebrasApiKey},
        {name:"CEREBRAS_MODEL", valueFrom:$cerebrasModel}
      ],
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": "/ecs/skillsmd/production/workers",
          "awslogs-region": $region,
          "awslogs-stream-prefix": "worker"
        }
      }
    }]
  }' >"$taskdef"

TASK_DEF_ARN="$(aws ecs register-task-definition \
  --cli-input-json "file://$taskdef" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)"
fail_if_empty_aws_text "$TASK_DEF_ARN" "Production worker task definition registration failed"

SERVICE_EXISTS="$(aws ecs describe-services \
  --cluster "$PRODUCTION_CLUSTER" \
  --services "$PRODUCTION_WORKER_SERVICE_NAME" \
  --query 'services[?status==`ACTIVE`] | length(@)' \
  --output text 2>/dev/null || echo "0")"

if [[ "$SERVICE_EXISTS" == "0" ]]; then
  aws ecs create-service \
    --cluster "$PRODUCTION_CLUSTER" \
    --service-name "$PRODUCTION_WORKER_SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
    --tags key=Service,value=skills.md key=ManagedBy,value=platform-skills key=Repository,value=hasnatools/platform-skills key=Environment,value=production key=Component,value=worker >/dev/null
  echo "Created ECS worker service: $PRODUCTION_WORKER_SERVICE_NAME"
else
  aws ecs update-service \
    --cluster "$PRODUCTION_CLUSTER" \
    --service "$PRODUCTION_WORKER_SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --force-new-deployment >/dev/null
  echo "Updated ECS worker service: $PRODUCTION_WORKER_SERVICE_NAME"
fi

aws ecs wait services-stable --cluster "$PRODUCTION_CLUSTER" --services "$PRODUCTION_WORKER_SERVICE_NAME"

append_github_output "worker_service_name" "$PRODUCTION_WORKER_SERVICE_NAME"
append_github_output "worker_task_definition_arn" "$TASK_DEF_ARN"
echo "Production worker service ready: $PRODUCTION_WORKER_SERVICE_NAME"
