#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/production_lib.sh"

assert_aws_account

for command in aws jq curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "::error::Missing required command: $command" >&2
    exit 1
  fi
done

secret_json="$(aws secretsmanager get-secret-value \
  --secret-id "$PRODUCTION_STRIPE_SECRET_NAME" \
  --query SecretString \
  --output text)"

missing_or_invalid=0
required_keys=(
  STRIPE_SECRET_KEY
  STRIPE_PUBLISHABLE_KEY
  STRIPE_WEBHOOK_SECRET
  STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION
  STRIPE_PRO_PRICE_ID
  STRIPE_CREDIT_1_PRICE_ID
  STRIPE_CREDIT_5_PRICE_ID
  STRIPE_CREDIT_20_PRICE_ID
  STRIPE_CREDIT_50_PRICE_ID
  STRIPE_CREDIT_100_PRICE_ID
)

secret_value() {
  local key="$1"
  jq -r --arg key "$key" '.[$key] // ""' <<<"$secret_json"
}

check_key() {
  local key="$1"
  local value="$2"
  if [[ -z "$value" || "$value" == "__SET_IN_AWS_SECRETS_MANAGER__" ]]; then
    echo "::error::$PRODUCTION_STRIPE_SECRET_NAME is missing $key" >&2
    missing_or_invalid=1
  fi
}

for key in "${required_keys[@]}"; do
  check_key "$key" "$(secret_value "$key")"
done

secret_key_mode="$(secret_value STRIPE_SECRET_KEY)"
publishable_key_mode="$(secret_value STRIPE_PUBLISHABLE_KEY)"
allow_test_mode="$(secret_value STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION)"

if [[ "$allow_test_mode" == "true" || "$allow_test_mode" == "1" ]]; then
  expected_livemode="false"
  if [[ "$secret_key_mode" != sk_test_* && "$secret_key_mode" != rk_test_* ]]; then
    echo "::error::Sandbox production STRIPE_SECRET_KEY must be a test Stripe secret or restricted key" >&2
    missing_or_invalid=1
  fi
  if [[ "$publishable_key_mode" != pk_test_* ]]; then
    echo "::error::Sandbox production STRIPE_PUBLISHABLE_KEY must be a test key" >&2
    missing_or_invalid=1
  fi
else
  expected_livemode="true"
  if [[ "$secret_key_mode" != sk_live_* && "$secret_key_mode" != rk_live_* ]]; then
    echo "::error::Production STRIPE_SECRET_KEY must be a live Stripe secret or restricted key unless STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION is true" >&2
    missing_or_invalid=1
  fi
  if [[ "$publishable_key_mode" != pk_live_* ]]; then
    echo "::error::Production STRIPE_PUBLISHABLE_KEY must be a live key unless STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION is true" >&2
    missing_or_invalid=1
  fi
fi

if [[ "$allow_test_mode" != "true" && "$allow_test_mode" != "1" && "$allow_test_mode" != "false" && "$allow_test_mode" != "0" ]]; then
  echo "::error::Production STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION must be true, false, 1, or 0" >&2
  missing_or_invalid=1
fi

if [[ "$(secret_value STRIPE_WEBHOOK_SECRET)" != whsec_* ]]; then
  echo "::error::Production STRIPE_WEBHOOK_SECRET must be a Stripe webhook signing secret" >&2
  missing_or_invalid=1
fi

for key in STRIPE_PRO_PRICE_ID STRIPE_CREDIT_1_PRICE_ID STRIPE_CREDIT_5_PRICE_ID STRIPE_CREDIT_20_PRICE_ID STRIPE_CREDIT_50_PRICE_ID STRIPE_CREDIT_100_PRICE_ID; do
  if [[ "$(secret_value "$key")" != price_* ]]; then
    echo "::error::Production $key must be a Stripe price id" >&2
    missing_or_invalid=1
  fi
done

if [[ "$missing_or_invalid" -ne 0 ]]; then
  echo "::error::Production Stripe secret shape check failed" >&2
  exit 1
fi

stripe_get_json() {
  local path="$1"
  local output
  if ! output="$(curl -fsS \
    -u "$secret_key_mode:" \
    "https://api.stripe.com/v1$path" 2>&1)"; then
    echo "::error::Stripe live credential validation failed for $path" >&2
    sed -E 's/(sk_|rk_|pk_|whsec_)[A-Za-z0-9_]+/REDACTED/g' <<<"$output" >&2
    return 1
  fi
  if ! jq -e . >/dev/null 2>&1 <<<"$output"; then
    echo "::error::Stripe API did not return JSON for $path" >&2
    return 1
  fi
  printf '%s' "$output"
}

stripe_get_json "/account" >/dev/null

for key in STRIPE_PRO_PRICE_ID STRIPE_CREDIT_1_PRICE_ID STRIPE_CREDIT_5_PRICE_ID STRIPE_CREDIT_20_PRICE_ID STRIPE_CREDIT_50_PRICE_ID STRIPE_CREDIT_100_PRICE_ID; do
  price_id="$(jq -r --arg key "$key" '.[$key]' <<<"$secret_json")"
  price_json="$(stripe_get_json "/prices/$price_id")"
  if [[ "$(jq -r '.id // ""' <<<"$price_json")" != "$price_id" ]]; then
    echo "::error::Stripe returned the wrong price for $key" >&2
    exit 1
  fi
  if [[ "$(jq -r '.livemode // false' <<<"$price_json")" != "$expected_livemode" ]]; then
    echo "::error::Production $key must point to a Stripe price matching STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION=$allow_test_mode" >&2
    exit 1
  fi
  if [[ "$(jq -r '.active // false' <<<"$price_json")" != "true" ]]; then
    echo "::error::Production $key must point to an active Stripe price" >&2
    exit 1
  fi
done

echo "Production Stripe secret shape is valid."
