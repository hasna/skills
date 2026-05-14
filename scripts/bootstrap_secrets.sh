#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/bootstrap_secrets.sh [--profile <profile>] [--region <region>]

Creates or updates the AWS Secrets Manager entries used by skills.md:
- runtime env secrets with DATABASE_URL, REDIS_URL, generated auth/encryption keys, S3 bucket names, and port
- Stripe secret entries for agent-generated payment flows
- OAuth secret entries for connector login flows
- seed admin credentials

Generated secrets are preserved across reruns. External provider values can be
supplied through environment variables without appearing on the command line:

  PREVIEW_STRIPE_SECRET_KEY
  PREVIEW_STRIPE_PUBLISHABLE_KEY
  PREVIEW_STRIPE_WEBHOOK_SECRET
  PREVIEW_STRIPE_PRO_PRICE_ID
  PREVIEW_STRIPE_CREDIT_1_PRICE_ID
  PREVIEW_STRIPE_CREDIT_5_PRICE_ID
  PREVIEW_STRIPE_CREDIT_20_PRICE_ID
  PREVIEW_STRIPE_CREDIT_50_PRICE_ID
  PREVIEW_STRIPE_CREDIT_100_PRICE_ID
  PREVIEW_STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION
  PRODUCTION_STRIPE_SECRET_KEY
  PRODUCTION_STRIPE_PUBLISHABLE_KEY
  PRODUCTION_STRIPE_WEBHOOK_SECRET
  PRODUCTION_STRIPE_PRO_PRICE_ID
  PRODUCTION_STRIPE_CREDIT_1_PRICE_ID
  PRODUCTION_STRIPE_CREDIT_5_PRICE_ID
  PRODUCTION_STRIPE_CREDIT_20_PRICE_ID
  PRODUCTION_STRIPE_CREDIT_50_PRICE_ID
  PRODUCTION_STRIPE_CREDIT_100_PRICE_ID
  PRODUCTION_STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION
  GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET

If external values are not available yet, the script creates the entries with a
non-secret placeholder so deploy wiring can reference stable secret names.
USAGE
}

PROFILE="hasnatools"
REGION="us-east-1"
EXPECTED_ACCOUNT_ID="059898286899"

SERVICE_NAME="skills.md"
REPOSITORY="hasnatools/platform-skills"
DB_IDENTIFIER="skillsmd-production-postgres"
DB_NAME="skillsmd"
REDIS_REPLICATION_GROUP="skillsmd-production-redis"
REDIS_AUTH_SECRET_NAME="skillsmd/production/redis/auth-token"
ASSETS_BUCKET="skillsmd-059898286899-assets"
EXPORTS_BUCKET="skillsmd-059898286899-exports"
PLACEHOLDER="__SET_IN_AWS_SECRETS_MANAGER__"
LOCAL_PORT="3505"

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

for command in aws jq mktemp; do
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

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

secret_exists() {
  local secret_name="$1"

  aws secretsmanager describe-secret \
    --profile "$PROFILE" \
    --region "$REGION" \
    --secret-id "$secret_name" >/dev/null 2>&1
}

read_secret_json_file() {
  local secret_name="$1"
  local output_file="$2"

  if secret_exists "$secret_name"; then
    aws secretsmanager get-secret-value \
      --profile "$PROFILE" \
      --region "$REGION" \
      --secret-id "$secret_name" \
      --query SecretString \
      --output text >"$output_file"
  else
    printf '{}\n' >"$output_file"
  fi
}

random_secret() {
  local length="$1"

  aws secretsmanager get-random-password \
    --profile "$PROFILE" \
    --region "$REGION" \
    --password-length "$length" \
    --exclude-punctuation \
    --query RandomPassword \
    --output text
}

json_value() {
  local file="$1"
  local key="$2"

  jq -r --arg key "$key" '.[$key] // empty' "$file"
}

env_value() {
  local name="$1"
  printf '%s' "${!name-}"
}

provider_value() {
  local env_name="$1"
  local key="$2"
  local existing_file="$3"
  local value

  value="$(env_value "$env_name")"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return
  fi

  value="$(json_value "$existing_file" "$key")"
  if [[ -n "$value" && "$value" != "$PLACEHOLDER" ]]; then
    printf '%s' "$value"
    return
  fi

  printf '%s' "$PLACEHOLDER"
}

env_scoped_provider_value() {
  local env_name="$1"
  local base_var="$2"
  local key="$3"
  local existing_file="$4"
  local env_var
  local value

  env_var="${env_name^^}_${base_var}"
  env_var="${env_var//-/_}"

  value="$(env_value "$env_var")"
  if [[ -n "$value" ]]; then
    printf '%s' "$value"
    return
  fi

  provider_value "$base_var" "$key" "$existing_file"
}

generated_or_existing() {
  local file="$1"
  local key="$2"
  local length="$3"
  local value

  value="$(json_value "$file" "$key")"
  if [[ -n "$value" && "$value" != "$PLACEHOLDER" ]]; then
    printf '%s' "$value"
    return
  fi

  random_secret "$length"
}

uri_encode() {
  local value="$1"
  jq -rn --arg value "$value" '$value | @uri'
}

upsert_json_secret() {
  local secret_name="$1"
  local description="$2"
  local environment="$3"
  local json_file="$4"

  if secret_exists "$secret_name"; then
    aws secretsmanager put-secret-value \
      --profile "$PROFILE" \
      --region "$REGION" \
      --secret-id "$secret_name" \
      --secret-string "file://$json_file" >/dev/null
    aws secretsmanager tag-resource \
      --profile "$PROFILE" \
      --region "$REGION" \
      --secret-id "$secret_name" \
      --tags \
        Key=Service,Value="$SERVICE_NAME" \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value="$REPOSITORY" \
        Key=Environment,Value="$environment" >/dev/null
    echo "Updated secret: $secret_name"
  else
    aws secretsmanager create-secret \
      --profile "$PROFILE" \
      --region "$REGION" \
      --name "$secret_name" \
      --description "$description" \
      --secret-string "file://$json_file" \
      --tags \
        Key=Service,Value="$SERVICE_NAME" \
        Key=ManagedBy,Value=platform-skills \
        Key=Repository,Value="$REPOSITORY" \
        Key=Environment,Value="$environment" >/dev/null
    echo "Created secret: $secret_name"
  fi
}

db_info_file="$WORK_DIR/db-info.json"
rds_secret_file="$WORK_DIR/rds-secret.json"
redis_info_file="$WORK_DIR/redis-info.json"
redis_auth_file="$WORK_DIR/redis-auth.txt"

aws rds describe-db-instances \
  --profile "$PROFILE" \
  --region "$REGION" \
  --db-instance-identifier "$DB_IDENTIFIER" \
  --query 'DBInstances[0].{endpoint:Endpoint.Address,port:Endpoint.Port,dbName:DBName,masterUsername:MasterUsername,masterSecretArn:MasterUserSecret.SecretArn}' \
  --output json >"$db_info_file"

rds_secret_arn="$(jq -r '.masterSecretArn // empty' "$db_info_file")"
if [[ -z "$rds_secret_arn" ]]; then
  echo "RDS instance $DB_IDENTIFIER does not expose a managed master secret." >&2
  exit 1
fi

aws secretsmanager get-secret-value \
  --profile "$PROFILE" \
  --region "$REGION" \
  --secret-id "$rds_secret_arn" \
  --query SecretString \
  --output text >"$rds_secret_file"

db_host="$(jq -r '.endpoint' "$db_info_file")"
db_port="$(jq -r '.port' "$db_info_file")"
db_name="$(jq -r ".dbName // \"$DB_NAME\"" "$db_info_file")"
db_username="$(jq -r '.username // empty' "$rds_secret_file")"
db_password="$(jq -r '.password // empty' "$rds_secret_file")"

if [[ -z "$db_host" || -z "$db_port" || -z "$db_name" || -z "$db_username" || -z "$db_password" ]]; then
  echo "Could not resolve all PostgreSQL connection fields." >&2
  exit 1
fi

database_url="postgresql://$(uri_encode "$db_username"):$(uri_encode "$db_password")@$db_host:$db_port/$db_name?sslmode=require"

aws elasticache describe-replication-groups \
  --profile "$PROFILE" \
  --region "$REGION" \
  --replication-group-id "$REDIS_REPLICATION_GROUP" \
  --query 'ReplicationGroups[0].{host:NodeGroups[0].PrimaryEndpoint.Address,port:NodeGroups[0].PrimaryEndpoint.Port,transitEncryption:TransitEncryptionEnabled,authEnabled:AuthTokenEnabled}' \
  --output json >"$redis_info_file"

aws secretsmanager get-secret-value \
  --profile "$PROFILE" \
  --region "$REGION" \
  --secret-id "$REDIS_AUTH_SECRET_NAME" \
  --query SecretString \
  --output text >"$redis_auth_file"

redis_host="$(jq -r '.host' "$redis_info_file")"
redis_port="$(jq -r '.port' "$redis_info_file")"
redis_auth_token="$(<"$redis_auth_file")"

if [[ -z "$redis_host" || -z "$redis_port" || -z "$redis_auth_token" ]]; then
  echo "Could not resolve all Redis connection fields." >&2
  exit 1
fi

redis_url="rediss://:$(uri_encode "$redis_auth_token")@$redis_host:$redis_port"

write_environment_secrets() {
  local environment="$1"
  local app_url="$2"
  local admin_email="$3"
  local runtime_secret_name="skillsmd/$environment/runtime/env"
  local stripe_secret_name="skillsmd/$environment/stripe"
  local oauth_secret_name="skillsmd/$environment/oauth"
  local seed_admin_secret_name="skillsmd/$environment/seed-admin"
  local runtime_existing="$WORK_DIR/$environment-runtime-existing.json"
  local stripe_existing="$WORK_DIR/$environment-stripe-existing.json"
  local oauth_existing="$WORK_DIR/$environment-oauth-existing.json"
  local seed_admin_existing="$WORK_DIR/$environment-seed-admin-existing.json"
  local runtime_json="$WORK_DIR/$environment-runtime.json"
  local stripe_json="$WORK_DIR/$environment-stripe.json"
  local oauth_json="$WORK_DIR/$environment-oauth.json"
  local seed_admin_json="$WORK_DIR/$environment-seed-admin.json"
  local auth_secret
  local token_encryption_key
  local worker_secret
  local seed_admin_password
  local resend_api_key
  local from_email
  local cerebras_api_key
  local cerebras_model
  local stripe_secret_key
  local stripe_publishable_key
  local stripe_webhook_secret
  local stripe_account_id
  local stripe_credits_price_id
  local stripe_pro_price_id
  local stripe_credit_1_price_id
  local stripe_credit_5_price_id
  local stripe_credit_20_price_id
  local stripe_credit_50_price_id
  local stripe_credit_100_price_id
  local google_client_id
  local google_client_secret

  read_secret_json_file "$runtime_secret_name" "$runtime_existing"
  read_secret_json_file "$stripe_secret_name" "$stripe_existing"
  read_secret_json_file "$oauth_secret_name" "$oauth_existing"
  read_secret_json_file "$seed_admin_secret_name" "$seed_admin_existing"

  auth_secret="$(generated_or_existing "$runtime_existing" "AUTH_SECRET" 64)"
  token_encryption_key="$(generated_or_existing "$runtime_existing" "TOKEN_ENCRYPTION_KEY" 64)"
  worker_secret="$(generated_or_existing "$runtime_existing" "WORKER_SECRET" 64)"
  seed_admin_password="$(generated_or_existing "$seed_admin_existing" "SEED_ADMIN_PASSWORD" 32)"
  resend_api_key="$(env_scoped_provider_value "$environment" "RESEND_API_KEY" "RESEND_API_KEY" "$runtime_existing")"
  from_email="$(env_scoped_provider_value "$environment" "FROM_EMAIL" "FROM_EMAIL" "$runtime_existing")"
  cerebras_api_key="$(env_scoped_provider_value "$environment" "CEREBRAS_API_KEY" "CEREBRAS_API_KEY" "$runtime_existing")"
  cerebras_model="$(provider_value "${environment^^}_CEREBRAS_MODEL" "CEREBRAS_MODEL" "$runtime_existing")"
  if [[ "$cerebras_model" == "$PLACEHOLDER" ]]; then
    cerebras_model="gpt-oss-120b"
  fi

  stripe_secret_key="$(env_scoped_provider_value "$environment" "STRIPE_SECRET_KEY" "STRIPE_SECRET_KEY" "$stripe_existing")"
  stripe_publishable_key="$(env_scoped_provider_value "$environment" "STRIPE_PUBLISHABLE_KEY" "STRIPE_PUBLISHABLE_KEY" "$stripe_existing")"
  stripe_webhook_secret="$(env_scoped_provider_value "$environment" "STRIPE_WEBHOOK_SECRET" "STRIPE_WEBHOOK_SECRET" "$stripe_existing")"
  stripe_account_id="$(env_scoped_provider_value "$environment" "STRIPE_ACCOUNT_ID" "STRIPE_ACCOUNT_ID" "$stripe_existing")"
  stripe_credits_price_id="$(env_scoped_provider_value "$environment" "STRIPE_CREDITS_PRICE_ID" "STRIPE_CREDITS_PRICE_ID" "$stripe_existing")"
  stripe_pro_price_id="$(env_scoped_provider_value "$environment" "STRIPE_PRO_PRICE_ID" "STRIPE_PRO_PRICE_ID" "$stripe_existing")"
  stripe_credit_1_price_id="$(env_scoped_provider_value "$environment" "STRIPE_CREDIT_1_PRICE_ID" "STRIPE_CREDIT_1_PRICE_ID" "$stripe_existing")"
  stripe_credit_5_price_id="$(env_scoped_provider_value "$environment" "STRIPE_CREDIT_5_PRICE_ID" "STRIPE_CREDIT_5_PRICE_ID" "$stripe_existing")"
  stripe_credit_20_price_id="$(env_scoped_provider_value "$environment" "STRIPE_CREDIT_20_PRICE_ID" "STRIPE_CREDIT_20_PRICE_ID" "$stripe_existing")"
  stripe_credit_50_price_id="$(env_scoped_provider_value "$environment" "STRIPE_CREDIT_50_PRICE_ID" "STRIPE_CREDIT_50_PRICE_ID" "$stripe_existing")"
  stripe_credit_100_price_id="$(env_scoped_provider_value "$environment" "STRIPE_CREDIT_100_PRICE_ID" "STRIPE_CREDIT_100_PRICE_ID" "$stripe_existing")"
  stripe_allow_test_mode="$(provider_value "${environment^^}_STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION" "STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION" "$stripe_existing")"
  if [[ "$stripe_allow_test_mode" == "$PLACEHOLDER" ]]; then
    stripe_allow_test_mode="false"
  fi
  google_client_id="$(env_scoped_provider_value "$environment" "GOOGLE_CLIENT_ID" "GOOGLE_CLIENT_ID" "$oauth_existing")"
  google_client_secret="$(env_scoped_provider_value "$environment" "GOOGLE_CLIENT_SECRET" "GOOGLE_CLIENT_SECRET" "$oauth_existing")"

  jq -n \
    --arg databaseUrl "$database_url" \
    --arg redisUrl "$redis_url" \
    --arg authSecret "$auth_secret" \
    --arg tokenEncryptionKey "$token_encryption_key" \
    --arg workerSecret "$worker_secret" \
    --arg resendApiKey "$resend_api_key" \
    --arg fromEmail "$from_email" \
    --arg cerebrasApiKey "$cerebras_api_key" \
    --arg cerebrasModel "$cerebras_model" \
    --arg awsRegion "$REGION" \
    --arg assetsBucket "$ASSETS_BUCKET" \
    --arg exportsBucket "$EXPORTS_BUCKET" \
    --arg appUrl "$app_url" \
    --arg port "$LOCAL_PORT" \
    '{
      DATABASE_URL: $databaseUrl,
      REDIS_URL: $redisUrl,
      AUTH_SECRET: $authSecret,
      TOKEN_ENCRYPTION_KEY: $tokenEncryptionKey,
      WORKER_SECRET: $workerSecret,
      RESEND_API_KEY: $resendApiKey,
      FROM_EMAIL: $fromEmail,
      CEREBRAS_API_KEY: $cerebrasApiKey,
      CEREBRAS_MODEL: $cerebrasModel,
      AWS_REGION: $awsRegion,
      S3_ASSETS_BUCKET: $assetsBucket,
      S3_EXPORTS_BUCKET: $exportsBucket,
      NEXT_PUBLIC_APP_URL: $appUrl,
      PORT: $port
    }' >"$runtime_json"

  jq -n \
    --arg secretKey "$stripe_secret_key" \
    --arg publishableKey "$stripe_publishable_key" \
    --arg webhookSecret "$stripe_webhook_secret" \
    --arg accountId "$stripe_account_id" \
    --arg creditsPriceId "$stripe_credits_price_id" \
    --arg proPriceId "$stripe_pro_price_id" \
    --arg credit1PriceId "$stripe_credit_1_price_id" \
    --arg credit5PriceId "$stripe_credit_5_price_id" \
    --arg credit20PriceId "$stripe_credit_20_price_id" \
    --arg credit50PriceId "$stripe_credit_50_price_id" \
    --arg credit100PriceId "$stripe_credit_100_price_id" \
    --arg allowTestMode "$stripe_allow_test_mode" \
    '{
      STRIPE_SECRET_KEY: $secretKey,
      STRIPE_PUBLISHABLE_KEY: $publishableKey,
      STRIPE_WEBHOOK_SECRET: $webhookSecret,
      STRIPE_ACCOUNT_ID: $accountId,
      STRIPE_CREDITS_PRICE_ID: $creditsPriceId,
      STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION: $allowTestMode,
      STRIPE_PRO_PRICE_ID: $proPriceId,
      STRIPE_CREDIT_1_PRICE_ID: $credit1PriceId,
      STRIPE_CREDIT_5_PRICE_ID: $credit5PriceId,
      STRIPE_CREDIT_20_PRICE_ID: $credit20PriceId,
      STRIPE_CREDIT_50_PRICE_ID: $credit50PriceId,
      STRIPE_CREDIT_100_PRICE_ID: $credit100PriceId
    }' >"$stripe_json"

  jq -n \
    --arg googleClientId "$google_client_id" \
    --arg googleClientSecret "$google_client_secret" \
    '{
      GOOGLE_CLIENT_ID: $googleClientId,
      GOOGLE_CLIENT_SECRET: $googleClientSecret
    }' >"$oauth_json"

  jq -n \
    --arg email "$admin_email" \
    --arg password "$seed_admin_password" \
    '{
      SEED_ADMIN_EMAIL: $email,
      SEED_ADMIN_PASSWORD: $password
    }' >"$seed_admin_json"

  upsert_json_secret "$runtime_secret_name" "skills.md $environment runtime environment" "$environment" "$runtime_json"
  upsert_json_secret "$stripe_secret_name" "skills.md $environment Stripe configuration" "$environment" "$stripe_json"
  upsert_json_secret "$oauth_secret_name" "skills.md $environment OAuth provider configuration" "$environment" "$oauth_json"
  upsert_json_secret "$seed_admin_secret_name" "skills.md $environment seed admin credentials" "$environment" "$seed_admin_json"
}

write_environment_secrets "preview" "https://pr.preview.skills.md" "admin+preview@skills.md"
write_environment_secrets "production" "https://skills.md" "admin@skills.md"

aws secretsmanager list-secrets \
  --profile "$PROFILE" \
  --region "$REGION" \
  --filters Key=name,Values=skillsmd/preview,skillsmd/production \
  --query 'SecretList[].{name:Name,description:Description}' \
  --output table
