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
STRIPE_SECRET_ARN="$(resolve_secret_arn "$PRODUCTION_STRIPE_SECRET_NAME")"
SUBNETS="$(resolve_public_subnets_csv)"
ECS_SG_ID="${PRODUCTION_ECS_SG:-$(resolve_security_group_id skillsmd-ecs-tasks)}"
VPC_ID="$(resolve_vpc_id)"
LISTENER_ARN="$(resolve_listener_arn)"
EXECUTION_ROLE_ARN="$(resolve_role_arn tool-skillsmd-ecs-task-execution)"
TASK_ROLE_ARN="$(resolve_role_arn tool-skillsmd-ecs-task)"

fail_if_empty_aws_text "$RUNTIME_SECRET_ARN" "Production runtime secret is missing: $PRODUCTION_RUNTIME_SECRET_NAME"
fail_if_empty_aws_text "$STRIPE_SECRET_ARN" "Production Stripe secret is missing: $PRODUCTION_STRIPE_SECRET_NAME"
fail_if_empty_aws_text "$SUBNETS" "Production public subnets not found"
fail_if_empty_aws_text "$ECS_SG_ID" "Production ECS security group not found"
fail_if_empty_aws_text "$VPC_ID" "Production VPC not found"

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

taskdef="$WORK_DIR/taskdef.json"

jq -n \
  --arg family "$PRODUCTION_TASK_FAMILY" \
  --arg image "$PRODUCTION_IMAGE" \
  --arg executionRoleArn "$EXECUTION_ROLE_ARN" \
  --arg taskRoleArn "$TASK_ROLE_ARN" \
  --arg region "$AWS_REGION" \
  --arg containerName "$PRODUCTION_CONTAINER_NAME" \
  --argjson port "$PRODUCTION_RUNTIME_PORT" \
  --arg databaseUrl "$(json_secret_ref "$RUNTIME_SECRET_ARN" DATABASE_URL)" \
  --arg redisUrl "$(json_secret_ref "$RUNTIME_SECRET_ARN" REDIS_URL)" \
  --arg authSecret "$(json_secret_ref "$RUNTIME_SECRET_ARN" AUTH_SECRET)" \
  --arg tokenEncryptionKey "$(json_secret_ref "$RUNTIME_SECRET_ARN" TOKEN_ENCRYPTION_KEY)" \
  --arg workerSecret "$(json_secret_ref "$RUNTIME_SECRET_ARN" WORKER_SECRET)" \
  --arg resendApiKey "$(json_secret_ref "$RUNTIME_SECRET_ARN" RESEND_API_KEY)" \
  --arg fromEmail "$(json_secret_ref "$RUNTIME_SECRET_ARN" FROM_EMAIL)" \
  --arg s3AssetsBucket "$(json_secret_ref "$RUNTIME_SECRET_ARN" S3_ASSETS_BUCKET)" \
  --arg s3ExportsBucket "$(json_secret_ref "$RUNTIME_SECRET_ARN" S3_EXPORTS_BUCKET)" \
  --arg stripeSecretKey "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_SECRET_KEY)" \
  --arg stripePublishableKey "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_PUBLISHABLE_KEY)" \
  --arg stripeWebhookSecret "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_WEBHOOK_SECRET)" \
  --arg stripeAllowTestMode "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION)" \
  --arg stripeProPriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_PRO_PRICE_ID)" \
  --arg stripeCredit1PriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_CREDIT_1_PRICE_ID)" \
  --arg stripeCredit5PriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_CREDIT_5_PRICE_ID)" \
  --arg stripeCredit20PriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_CREDIT_20_PRICE_ID)" \
  --arg stripeCredit50PriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_CREDIT_50_PRICE_ID)" \
  --arg stripeCredit100PriceId "$(json_secret_ref "$STRIPE_SECRET_ARN" STRIPE_CREDIT_100_PRICE_ID)" \
  --arg appUrl "https://$PRODUCTION_DOMAIN" \
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
        {name:"APP_ENV", value:"production"},
        {name:"NO_OPEN", value:"1"},
        {name:"HOSTNAME", value:"0.0.0.0"},
        {name:"PORT", value:($port | tostring)},
        {name:"AWS_REGION", value:$region},
        {name:"SKILLS_RUNNER_ENABLED", value:"0"},
        {name:"NEXT_PUBLIC_APP_URL", value:$appUrl},
        {name:"APP_URL", value:$appUrl},
        {name:"SKILLS_API_URL", value:($appUrl + "/api/v1")}
      ],
      secrets: [
        {name:"DATABASE_URL", valueFrom:$databaseUrl},
        {name:"REDIS_URL", valueFrom:$redisUrl},
        {name:"AUTH_SECRET", valueFrom:$authSecret},
        {name:"TOKEN_ENCRYPTION_KEY", valueFrom:$tokenEncryptionKey},
        {name:"WORKER_SECRET", valueFrom:$workerSecret},
        {name:"RESEND_API_KEY", valueFrom:$resendApiKey},
        {name:"FROM_EMAIL", valueFrom:$fromEmail},
        {name:"S3_ASSETS_BUCKET", valueFrom:$s3AssetsBucket},
        {name:"S3_EXPORTS_BUCKET", valueFrom:$s3ExportsBucket},
        {name:"STRIPE_SECRET_KEY", valueFrom:$stripeSecretKey},
        {name:"STRIPE_PUBLISHABLE_KEY", valueFrom:$stripePublishableKey},
        {name:"STRIPE_WEBHOOK_SECRET", valueFrom:$stripeWebhookSecret},
        {name:"STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION", valueFrom:$stripeAllowTestMode},
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
          "awslogs-group": "/ecs/skillsmd/production/web",
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
fail_if_empty_aws_text "$TASK_DEF_ARN" "Production task definition registration failed"

if [[ "${PRODUCTION_REGISTER_ONLY:-0}" == "1" ]]; then
  append_github_output "task_definition_arn" "$TASK_DEF_ARN"
  echo "Registered production task definition: $TASK_DEF_ARN"
  exit 0
fi

TG_ARN="$(aws_text aws elbv2 describe-target-groups \
  --names "$PRODUCTION_TARGET_GROUP_NAME" \
  --query 'TargetGroups[0].TargetGroupArn')"
if is_empty_aws_text "$TG_ARN"; then
  TG_ARN="$(aws elbv2 create-target-group \
    --name "$PRODUCTION_TARGET_GROUP_NAME" \
    --protocol HTTP \
    --port "$PRODUCTION_RUNTIME_PORT" \
    --target-type ip \
    --vpc-id "$VPC_ID" \
    --health-check-path /api/health \
    --health-check-interval-seconds 30 \
    --healthy-threshold-count 2 \
    --unhealthy-threshold-count 3 \
    --matcher HttpCode=200 \
    --tags Key=Service,Value=skills.md Key=ManagedBy,Value=platform-skills Key=Repository,Value=hasnatools/platform-skills Key=Environment,Value=production \
    --query 'TargetGroups[0].TargetGroupArn' \
    --output text)"
  echo "Created target group: $PRODUCTION_TARGET_GROUP_NAME"
else
  echo "Reusing target group: $PRODUCTION_TARGET_GROUP_NAME"
fi

EXISTING_RULE="$(aws_text aws elbv2 describe-rules \
  --listener-arn "$LISTENER_ARN" \
  --query 'Rules[?Conditions[?Field==`host-header` && contains(Values, `'"$PRODUCTION_DOMAIN"'`)]].RuleArn | [0]')"
if is_empty_aws_text "$EXISTING_RULE"; then
  aws elbv2 create-rule \
    --listener-arn "$LISTENER_ARN" \
    --priority "${PRODUCTION_ALB_RULE_PRIORITY:-100}" \
    --conditions "Field=host-header,Values=$PRODUCTION_DOMAIN" \
    --actions "Type=forward,TargetGroupArn=$TG_ARN" >/dev/null
  echo "Created listener rule for $PRODUCTION_DOMAIN"
else
  aws elbv2 modify-rule \
    --rule-arn "$EXISTING_RULE" \
    --conditions "Field=host-header,Values=$PRODUCTION_DOMAIN" \
    --actions "Type=forward,TargetGroupArn=$TG_ARN" >/dev/null
  echo "Updated listener rule for $PRODUCTION_DOMAIN"
fi

SERVICE_EXISTS="$(aws ecs describe-services \
  --cluster "$PRODUCTION_CLUSTER" \
  --services "$PRODUCTION_SERVICE_NAME" \
  --query 'services[?status==`ACTIVE`] | length(@)' \
  --output text 2>/dev/null || echo "0")"

if [[ "$SERVICE_EXISTS" == "0" ]]; then
  aws ecs create-service \
    --cluster "$PRODUCTION_CLUSTER" \
    --service-name "$PRODUCTION_SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --desired-count 1 \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$SUBNETS],securityGroups=[$ECS_SG_ID],assignPublicIp=ENABLED}" \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=$PRODUCTION_CONTAINER_NAME,containerPort=$PRODUCTION_RUNTIME_PORT" \
    --health-check-grace-period-seconds 60 \
    --tags key=Service,value=skills.md key=ManagedBy,value=platform-skills key=Repository,value=hasnatools/platform-skills key=Environment,value=production >/dev/null
  echo "Created ECS service: $PRODUCTION_SERVICE_NAME"
else
  aws ecs update-service \
    --cluster "$PRODUCTION_CLUSTER" \
    --service "$PRODUCTION_SERVICE_NAME" \
    --task-definition "$TASK_DEF_ARN" \
    --load-balancers "targetGroupArn=$TG_ARN,containerName=$PRODUCTION_CONTAINER_NAME,containerPort=$PRODUCTION_RUNTIME_PORT" \
    --force-new-deployment >/dev/null
  echo "Updated ECS service: $PRODUCTION_SERVICE_NAME"
fi

aws ecs wait services-stable --cluster "$PRODUCTION_CLUSTER" --services "$PRODUCTION_SERVICE_NAME"

append_github_output "service_name" "$PRODUCTION_SERVICE_NAME"
append_github_output "task_definition_arn" "$TASK_DEF_ARN"
append_github_output "target_group_arn" "$TG_ARN"
append_github_output "production_url" "https://$PRODUCTION_DOMAIN"
echo "Production service ready: https://$PRODUCTION_DOMAIN"
