#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/production_lib.sh"

assert_aws_account

for command in aws jq; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "::error::Missing required command: $command" >&2
    exit 1
  fi
done

secret_json="$(aws secretsmanager get-secret-value \
  --secret-id "$PRODUCTION_RUNTIME_SECRET_NAME" \
  --query SecretString \
  --output text)"

missing_or_invalid=0
required_keys=(
  DATABASE_URL
  REDIS_URL
  AUTH_SECRET
  TOKEN_ENCRYPTION_KEY
  WORKER_SECRET
  RESEND_API_KEY
  FROM_EMAIL
  CEREBRAS_API_KEY
  CEREBRAS_MODEL
  S3_ASSETS_BUCKET
  S3_EXPORTS_BUCKET
)

secret_value() {
  local key="$1"
  jq -r --arg key "$key" '.[$key] // ""' <<<"$secret_json"
}

check_key() {
  local key="$1"
  local value="$2"
  if [[ -z "$value" || "$value" == "__SET_IN_AWS_SECRETS_MANAGER__" ]]; then
    echo "::error::$PRODUCTION_RUNTIME_SECRET_NAME is missing $key" >&2
    missing_or_invalid=1
  fi
}

for key in "${required_keys[@]}"; do
  check_key "$key" "$(secret_value "$key")"
done

database_url="$(secret_value DATABASE_URL)"
redis_url="$(secret_value REDIS_URL)"
auth_secret="$(secret_value AUTH_SECRET)"
token_encryption_key="$(secret_value TOKEN_ENCRYPTION_KEY)"
worker_secret="$(secret_value WORKER_SECRET)"
resend_api_key="$(secret_value RESEND_API_KEY)"
from_email="$(secret_value FROM_EMAIL)"
cerebras_api_key="$(secret_value CEREBRAS_API_KEY)"
cerebras_model="$(secret_value CEREBRAS_MODEL)"
s3_assets_bucket="$(secret_value S3_ASSETS_BUCKET)"
s3_exports_bucket="$(secret_value S3_EXPORTS_BUCKET)"

if [[ "$database_url" != postgres://* && "$database_url" != postgresql://* ]]; then
  echo "::error::Production DATABASE_URL must be a PostgreSQL connection string" >&2
  missing_or_invalid=1
fi

if [[ "$redis_url" != redis://* && "$redis_url" != rediss://* ]]; then
  echo "::error::Production REDIS_URL must be a Redis connection string" >&2
  missing_or_invalid=1
fi

for key_value in "AUTH_SECRET:$auth_secret" "TOKEN_ENCRYPTION_KEY:$token_encryption_key" "WORKER_SECRET:$worker_secret"; do
  key="${key_value%%:*}"
  value="${key_value#*:}"
  if (( ${#value} < 32 )); then
    echo "::error::Production $key must be at least 32 characters" >&2
    missing_or_invalid=1
  fi
done

if [[ "$resend_api_key" != re_* ]]; then
  echo "::error::Production RESEND_API_KEY must be a Resend API key" >&2
  missing_or_invalid=1
fi

if [[ "$from_email" != *"@"* ]]; then
  echo "::error::Production FROM_EMAIL must include an email address" >&2
  missing_or_invalid=1
fi

if (( ${#cerebras_api_key} < 16 )); then
  echo "::error::Production CEREBRAS_API_KEY must be configured for hosted premium article generation" >&2
  missing_or_invalid=1
fi

if [[ -z "$cerebras_model" ]]; then
  echo "::error::Production CEREBRAS_MODEL must be configured" >&2
  missing_or_invalid=1
fi

if [[ "$s3_assets_bucket" != skillsmd-* || "$s3_exports_bucket" != skillsmd-* ]]; then
  echo "::error::Production S3 bucket names must use the skillsmd-* bucket contract" >&2
  missing_or_invalid=1
fi

if [[ "$missing_or_invalid" -ne 0 ]]; then
  echo "::error::Production runtime secret shape check failed" >&2
  exit 1
fi

echo "Production runtime secret shape is valid."
