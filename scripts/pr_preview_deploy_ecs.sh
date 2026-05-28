#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/pr_preview_lib.sh"

assert_aws_account
require_env PREVIEW_IMAGE

for command in aws jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "::error::Missing required command: $command" >&2
    exit 1
  fi
done

SERVICE_NAME="$(preview_service_name)"
TASK_FAMILY="$(preview_task_family)"
TG_NAME="$(preview_target_group_name)"
HOST="$(preview_host)"
URL="$(preview_url)"
PRIORITY="$(preview_rule_priority)"
RUNTIME_SECRET_NAME="$(preview_runtime_secret_name)"
RUNTIME_SECRET_ARN="$(resolve_secret_arn "$RUNTIME_SECRET_NAME")"
STRIPE_SECRET_ARN="$(resolve_secret_arn "skillsmd/preview/stripe")"
SUBNETS="$(resolve_public_subnets_csv)"
ECS_SG_ID="${PREVIEW_ECS_SG:-$(resolve_security_group_id skillsmd-ecs-tasks)}"
VPC_ID="$(resolve_vpc_id)"
LISTENER_ARN="$(resolve_listener_arn)"
EXECUTION_ROLE_ARN="$(resolve_role_arn tool-skillsmd-ecs-task-execution)"
TASK_ROLE_ARN="$(resolve_role_arn tool-skillsmd-ecs-task)"

fail_if_empty_aws_text "$RUNTIME_SECRET_ARN" "Preview runtime secret is missing: $RUNTIME_SECRET_NAME"
fail_if_empty_aws_text "$STRIPE_SECRET_ARN" "Preview Stripe secret is missing: skillsmd/preview/stripe"
fail_if_empty_aws_text "$SUBNETS" "Preview public subnets not found"
fail_if_empty_aws_text "$ECS_SG_ID" "Preview ECS security group not found"
fail_if_empty_aws_text "$VPC_ID" "Preview VPC not found"

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

taskdef="$WORK_DIR/taskdef.json"

jq -n \
  --arg family "$TASK_FAMILY" \
  --arg image "$PREVIEW_IMAGE" \
  --arg executionRoleArn "$EXECUTION_ROLE_ARN" \
  --arg taskRoleArn "$TASK_ROLE_ARN" \
  --arg region "$AWS_REGION" \
  --arg containerName "$PREVIEW_CONTAINER_NAME" \
  --argjson port "$PREVIEW_RUNTIME_PORT" \
  --arg databaseUrl "$(json_secret_ref "$RUNTIME_SECRET_ARN" DATABASE_URL)" \
  --arg redisUrl "$(json_secret_ref "$RUNTIME_SECRET_ARN" REDIS_URL)" \
  --arg authSecret "$(json_secret_ref "$RUNTIME_SECRET_ARN" AUTH_SECRET)" \
  --arg tokenEncryptionKey "$(json_secret_ref "$RUNTIME_SECRET_ARN" TOKEN_ENCRYPTION_KEY)" \
  --arg workerSecret "$(json_secret_ref "$RUNTIME_SECRET_ARN" WORKER_SECRET)" \
  --arg stripeSecretKey "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_SECRET_KEY)" \
  --arg stripePublishableKey "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_PUBLISHABLE_KEY)" \
  --arg stripeWebhookSecret "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_WEBHOOK_SECRET)" \
  --arg stripeProPriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_PRO_PRICE_ID)" \
  --arg stripeCredit1PriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_CREDIT_1_PRICE_ID)" \
  --arg stripeCredit5PriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_CREDIT_5_PRICE_ID)" \
  --arg stripeCredit20PriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_CREDIT_20_PRICE_ID)" \
  --arg stripeCredit50PriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_CREDIT_50_PRICE_ID)" \
  --arg stripeCredit100PriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_CREDIT_100_PRICE_ID)" \
  --arg appUrl "$URL" \
  '{
    family: $family,
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    cpu: "512",
    memory: "1024",
    executionRoleArn: $executionRoleArn,
    taskRoleArn: $taskRoleArn,
    containerDefinitions: [{
      name: $containerName,
      image: $image,
      essential: true,
      portMappings: [{containerPort: $port, hostPort: $port, protocol: "tcp"}],
      environment: [
        {name:"NODE_ENV", value:"production"},
        {name:"APP_ENV", value:"preview"},
        {name:"NO_OPEN", value:"1"},
        {name:"HOSTNAME", value:"0.0.0.0"},
        {name:"PORT", value:($port | tostring)},
        {name:"NEXT_PUBLIC_APP_URL", value:$appUrl},
        {name:"SKILLS_API_URL", value:($appUrl + "/api/v1")}
      ],
      secrets: [
        {name:"DATABASE_URL", valueFrom:$databaseUrl},
        {name:"REDIS_URL", valueFrom:$redisUrl},
        {name:"AUTH_SECRET", valueFrom:$authSecret},
        {name:"TOKEN_ENCRYPTION_KEY", valueFrom:$tokenEncryptionKey},
        {name:"WORKER_SECRET", valueFrom:$workerSecret},
        {name:"STRIPE_SECRET_KEY", valueFrom:$stripeSecretKey},
        {name:"STRIPE_PUBLISHABLE_KEY", valueFrom:$stripePublishableKey},
        {name:"STRIPE_WEBHOOK_SECRET", valueFrom:$stripeWebhookSecret},
        {name:"STRIPE_PRO_PRICE_ID", valueFrom:$stripeProPriceId},
        {name:"STRIPE_CREDIT_1_PRICE_ID", valueFrom:$stripeCredit1PriceId},
        {name:"STRIPE_CREDIT_5_PRICE_ID", valueFrom:$stripeCredit5PriceId},
        {name:"STRIPE_CREDIT_20_PRICE_ID", valueFrom:$stripeCredit20PriceId},
        {name:"STRIPE_CREDIT_50_PRICE_ID", valueFrom:$stripeCredit50PriceId},
        {name:"STRIPE_CREDIT_100_PRICE_ID", valueFrom:$stripeCredit100PriceId}
      ],
      logConfiguration: {
        logDriver: "awslogs",
        options: {
          "awslogs-group": "/ecs/skillsmd/preview/web",
          "awslogs-region": $region,
          "awslogs-stream-prefix": "web"
        }
      }
    }]
  }' >"$taskdef"

TASK_DEF_ARN="$(aws ecs register-task-definition \
  --cli-input-json "file://$taskdef" \
  --query 'taskDefinition.taskDefinitionArn' \
  --output text)"
fail_if_empty_aws_text "$TASK_DEF_ARN" "Preview task definition registration failed"

TG_ARN="$(aws_text aws elbv2 describe-target-groups \
  --names "$TG_NAME" \
  --query 'TargetGroups[0].TargetGroupArn')"
if is_empty_aws_text "$TG_ARN"; then
  TG_ARN="$(aws elbv2 create-target-group \
    --name "$TG_NAME" \
    --protocol HTTP \
    --port "$PREVIEW_RUNTIME_PORT" \
    --target-type ip \
    --vpc-id "$VPC_ID" \
    --health-check-path /api/health \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --matcher HttpCode=200 \
    --tags Key=Service,Value=skills.md Key=ManagedBy,Value=platform-skills Key=Repository,Value=hasnatools/platform-skills Key=PreviewId,Value="$(preview_id)" \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)"
  echo "Created target group: $TG_NAME"
else
  echo "Reusing target group: $TG_NAME"
fi

EXISTING_RULE="$(aws_text aws elbv2 describe-rules \
  --listener-arn "$LISTENER_ARN" \
  --query 'Rules[?Conditions[?Field==`host-header` && contains(Values, `'"$HOST"'`)]].RuleArn | [0]')"
if is_empty_aws_text "$EXISTING_RULE"; then
  aws elbv2 create-rule \
    --listener-arn "$LISTENER_ARN" \
    --priority "$PRIORITY" \
    --conditions "Field=host-header,Values=$HOST" \
    --actions "Type=forward,TargetGroupArn=$TG_ARN" >/dev/null
  echo "Created listener rule for $HOST"
else
  aws elbv2 modify-rule \
    --rule-arn "$EXISTING_RULE" \
    --conditions "Field=host-header,Values=$HOST" \
    --actions "Type=forward,TargetGroupArn=$TG_ARN" >/dev/null
  echo "Updated listener rule for $HOST"
fi

SERVICE_EXISTS="$(aws ecs describe-services \
  --cluster "$PREVIEW_CLUSTER" \
  --services "$SERVICE_NAME" \
  --query 'services[?status==`ACTIVE`] | length(@)' \
  --output text 2>/dev/null || echo "0")"

if [[ "$SERVICE_EXISTS" == "0" ]]; then
  aws ecs create-service \
    --cluster "$PREVIEW_CLUSTER" \
    --service-name "$SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=$PREVIEW_CONTAINER_NAME,containerPort=$PREVIEW_RUNTIME_PORT" \
    --health-check-grace-period-seconds 60 \
    --tags key=Service,value=skills.md key=ManagedBy,value=platform-skills key=Repository,value=hasnatools/platform-skills key=PreviewId,value="$(preview_id)" >/dev/null
  echo "Created ECS service: $SERVICE_NAME"
else
  aws ecs update-service \
    --cluster "$PREVIEW_CLUSTER" \
    --service "$SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=$PREVIEW_CONTAINER_NAME,containerPort=$PREVIEW_RUNTIME_PORT" \
    --force-new-deployment >/dev/null
  echo "Updated ECS service: $SERVICE_NAME"
fi

aws ecs wait services-stable --cluster "$PREVIEW_CLUSTER" --services "$SERVICE_NAME"

append_github_output "service_name" "$SERVICE_NAME"
append_github_output "task_definition_arn" "$TASK_DEF_ARN"
append_github_output "target_group_arn" "$TG_ARN"
append_github_output "preview_url" "$URL"
echo "Preview service ready: $URL"
