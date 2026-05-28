#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: AWS_PROFILE=hasnatools AWS_REGION=us-east-1 scripts/preview_verify_stripe.sh

Verifies the sandbox Stripe resources stored in skillsmd/preview/stripe without
printing secrets or mutating Stripe resources.
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/production_lib.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

for command in aws jq curl; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "::error::Missing required command: $command" >&2
    exit 1
  fi
done

assert_aws_account

PREVIEW_STRIPE_SECRET_NAME="${PREVIEW_STRIPE_SECRET_NAME:-skillsmd/preview/stripe}"
PREVIEW_WEBHOOK_URL="${PREVIEW_WEBHOOK_URL:-https://preview.skills.md/api/v1/billing/webhook}"

secret_json="$(aws secretsmanager get-secret-value \
  --secret-id "$PREVIEW_STRIPE_SECRET_NAME" \
  --query SecretString \
  --output text)"

secret_value() {
  local key="$1"
  jq -r --arg key "$key" '.[$key] // ""' <<<"$secret_json"
}

failures=0

check_shape() {
  local key="$1"
  local expected_prefix="$2"
  local value
  value="$(secret_value "$key")"
  if [[ "$value" != "$expected_prefix"* ]]; then
    echo "::error::$PREVIEW_STRIPE_SECRET_NAME has invalid $key" >&2
    failures=1
  fi
}

check_shape STRIPE_SECRET_KEY sk_test_
check_shape STRIPE_PUBLISHABLE_KEY pk_test_
check_shape STRIPE_WEBHOOK_SECRET whsec_
check_shape STRIPE_PRO_PRICE_ID price_
check_shape STRIPE_CREDIT_1_PRICE_ID price_
check_shape STRIPE_CREDIT_5_PRICE_ID price_
check_shape STRIPE_CREDIT_20_PRICE_ID price_
check_shape STRIPE_CREDIT_50_PRICE_ID price_
check_shape STRIPE_CREDIT_100_PRICE_ID price_

if [[ "$failures" -ne 0 ]]; then
  exit 1
fi

stripe_secret_key="$(secret_value STRIPE_SECRET_KEY)"

stripe_get_json() {
  local path="$1"
  local output
  if ! output="$(curl -fsS \
    -u "$stripe_secret_key:" \
    "https://api.stripe.com/v1$path" 2>&1)"; then
    echo "::error::Stripe sandbox validation failed for $path" >&2
    sed -E 's/(sk_|rk_|pk_|whsec_)[A-Za-z0-9_]+/REDACTED/g' <<<"$output" >&2
    return 1
  fi
  if ! jq -e . >/dev/null 2>&1 <<<"$output"; then
    echo "::error::Stripe API did not return JSON for $path" >&2
    return 1
  fi
  printf '%s' "$output"
}

account_json="$(stripe_get_json "/account")"
account_id="$(jq -r '.id // ""' <<<"$account_json")"
expected_account_id="$(secret_value STRIPE_ACCOUNT_ID)"
if [[ -n "$expected_account_id" && "$account_id" != "$expected_account_id" ]]; then
  echo "::error::Stripe account mismatch for $PREVIEW_STRIPE_SECRET_NAME" >&2
  exit 1
fi

verify_price() {
  local key="$1"
  local lookup_key="$2"
  local price_id
  local price_json
  price_id="$(secret_value "$key")"
  price_json="$(stripe_get_json "/prices/$price_id")"
  if [[ "$(jq -r '.id // ""' <<<"$price_json")" != "$price_id" ]]; then
    echo "::error::Stripe returned the wrong price for $key" >&2
    exit 1
  fi
  if [[ "$(jq -r '.lookup_key // ""' <<<"$price_json")" != "$lookup_key" ]]; then
    echo "::error::$key does not use lookup key $lookup_key" >&2
    exit 1
  fi
  if ! jq -e '.livemode == false' >/dev/null <<<"$price_json"; then
    echo "::error::$key must point to a sandbox Stripe price" >&2
    exit 1
  fi
  if [[ "$(jq -r '.active // false' <<<"$price_json")" != "true" ]]; then
    echo "::error::$key must point to an active Stripe price" >&2
    exit 1
  fi
}

verify_price STRIPE_PRO_PRICE_ID skillsmd_preview_pro_monthly
verify_price STRIPE_CREDIT_1_PRICE_ID skillsmd_preview_credit_1
verify_price STRIPE_CREDIT_5_PRICE_ID skillsmd_preview_credit_5
verify_price STRIPE_CREDIT_20_PRICE_ID skillsmd_preview_credit_20
verify_price STRIPE_CREDIT_50_PRICE_ID skillsmd_preview_credit_50
verify_price STRIPE_CREDIT_100_PRICE_ID skillsmd_preview_credit_100

webhooks_json="$(stripe_get_json "/webhook_endpoints?limit=100")"
enabled_preview_count="$(jq -r \
  --arg url "$PREVIEW_WEBHOOK_URL" \
  '[.data[] | select(.url == $url and .status == "enabled" and .livemode == false)] | length' \
  <<<"$webhooks_json")"
if [[ "$enabled_preview_count" != "1" ]]; then
  echo "::error::Expected exactly one enabled sandbox webhook for $PREVIEW_WEBHOOK_URL; found $enabled_preview_count" >&2
  exit 1
fi

required_events=(
  checkout.session.completed
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
  invoice.paid
  invoice.payment_failed
)

for event in "${required_events[@]}"; do
  if ! jq -e \
    --arg url "$PREVIEW_WEBHOOK_URL" \
    --arg event "$event" \
    '.data[] | select(.url == $url and .status == "enabled" and .livemode == false) | .enabled_events | index($event)' \
    >/dev/null <<<"$webhooks_json"; then
    echo "::error::Preview webhook is missing $event" >&2
    exit 1
  fi
done

echo "Preview Stripe sandbox resources are valid."
