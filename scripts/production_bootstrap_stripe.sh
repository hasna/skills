#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: STRIPE_API_KEY=sk_live_... scripts/production_bootstrap_stripe.sh

Creates or reuses live Stripe billing resources for skills.md and updates
skillsmd/production/stripe in AWS Secrets Manager. Secrets are never printed.

Required:
  STRIPE_API_KEY              Live Stripe secret or restricted key with account, product, price, and webhook permissions

Optional:
  STRIPE_PUBLISHABLE_KEY      Live publishable key; if omitted, read from Stripe CLI config
  PRODUCTION_DOMAIN           Defaults to skills.md
  AWS_PROFILE                 Defaults to hasnatools
  AWS_REGION                  Defaults to us-east-1
USAGE
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/production_lib.sh"

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi

for command in aws jq stripe mktemp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "::error::Missing required command: $command" >&2
    exit 1
  fi
done

assert_aws_account
require_env STRIPE_API_KEY

if [[ "$STRIPE_API_KEY" != sk_live_* && "$STRIPE_API_KEY" != rk_live_* ]]; then
  echo "::error::STRIPE_API_KEY must be a live Stripe secret or restricted key" >&2
  exit 1
fi

STRIPE_PUBLISHABLE_KEY="${STRIPE_PUBLISHABLE_KEY:-$(awk -F"'" '/live_mode_pub_key/{print $2; exit}' "$HOME/.config/stripe/config.toml" 2>/dev/null || true)}"
if [[ "$STRIPE_PUBLISHABLE_KEY" != pk_live_* ]]; then
  echo "::error::STRIPE_PUBLISHABLE_KEY must be a live Stripe publishable key" >&2
  exit 1
fi

BILLING_WEBHOOK_EVENTS=(
  checkout.session.completed
  customer.subscription.created
  customer.subscription.updated
  customer.subscription.deleted
  invoice.paid
  invoice.payment_failed
)

webhook_event_args() {
  local event
  for event in "${BILLING_WEBHOOK_EVENTS[@]}"; do
    printf '%s\n' "--enabled-events"
    printf '%s\n' "$event"
  done
}

disable_duplicate_webhooks() {
  local keep_id="$1"
  local webhooks_json="$2"
  local duplicate_id
  while IFS= read -r duplicate_id; do
    [[ -z "$duplicate_id" || "$duplicate_id" == "$keep_id" ]] && continue
    stripe_json webhook_endpoints update "$duplicate_id" --disabled=true >/dev/null
  done < <(
    jq -r \
      --arg url "https://$PRODUCTION_DOMAIN/api/v1/billing/webhook" \
      '.data[] | select(.url == $url and .status == "enabled") | .id' \
      <<<"$webhooks_json"
  )
}

stripe_json() {
  local output
  if ! output="$(STRIPE_API_KEY="$STRIPE_API_KEY" stripe "$@" 2>&1)"; then
    echo "::error::Stripe CLI request failed" >&2
    sed -E 's/(sk_|rk_|pk_|whsec_)[A-Za-z0-9_]+/REDACTED/g' <<<"$output" >&2
    return 1
  fi
  if ! jq -e . >/dev/null 2>&1 <<<"$output"; then
    echo "::error::Stripe CLI did not return JSON" >&2
    sed -E 's/(sk_|rk_|pk_|whsec_)[A-Za-z0-9_]+/REDACTED/g' <<<"$output" >&2
    return 1
  fi
  printf '%s' "$output"
}

validate_live_account() {
  local account_json
  account_json="$(stripe_json accounts retrieve)" || {
    echo "::error::STRIPE_API_KEY could not reach the live Stripe account. Refresh or replace the live key before bootstrapping production." >&2
    return 1
  }
  jq -r '.id // empty' <<<"$account_json"
}

ensure_product() {
  local name="$1"
  local existing
  local products_json
  products_json="$(stripe_json products list --limit 100)" || return 1
  existing="$(jq -r --arg name "$name" '.data[] | select(.name == $name and .active == true) | .id' <<<"$products_json" | head -n1)"
  if [[ -n "$existing" ]]; then
    printf '%s' "$existing"
    return
  fi
  stripe_json products create --name "$name" | jq -r '.id'
}

ensure_price() {
  local lookup_key="$1"
  local product_id="$2"
  local unit_amount="$3"
  local recurring_interval="${4:-}"
  local existing
  local prices_json

  prices_json="$(stripe_json prices list --limit 100 --lookup-keys "$lookup_key")" || return 1
  existing="$(jq -r '.data[] | select(.active == true) | .id' <<<"$prices_json" | head -n1)"
  if [[ -n "$existing" ]]; then
    printf '%s' "$existing"
    return
  fi

  if [[ -n "$recurring_interval" ]]; then
    stripe_json prices create \
      --currency usd \
      --unit-amount "$unit_amount" \
      --product "$product_id" \
      --lookup-key "$lookup_key" \
      --recurring.interval "$recurring_interval" | jq -r '.id'
  else
    stripe_json prices create \
      --currency usd \
      --unit-amount "$unit_amount" \
      --product "$product_id" \
      --lookup-key "$lookup_key" | jq -r '.id'
  fi
}

ensure_webhook() {
  local webhook_url="https://$PRODUCTION_DOMAIN/api/v1/billing/webhook"
  local endpoint
  local webhooks_json
  local endpoint_json
  webhooks_json="$(stripe_json webhook_endpoints list --limit 100)" || return 1
  endpoint="$(jq -r --arg url "$webhook_url" '.data[] | select(.url == $url and .status == "enabled") | .id' <<<"$webhooks_json" | head -n1)"
  if [[ -n "$endpoint" && -n "${STRIPE_WEBHOOK_SECRET:-}" ]]; then
    mapfile -t event_args < <(webhook_event_args)
    endpoint_json="$(stripe_json webhook_endpoints update "$endpoint" "${event_args[@]}")"
    disable_duplicate_webhooks "$endpoint" "$webhooks_json"
    printf '%s' "$endpoint_json"
    return
  fi

  mapfile -t event_args < <(webhook_event_args)
  endpoint_json="$(stripe_json webhook_endpoints create \
    --url "$webhook_url" \
    "${event_args[@]}")"
  endpoint="$(jq -r '.id' <<<"$endpoint_json")"
  disable_duplicate_webhooks "$endpoint" "$webhooks_json"
  printf '%s' "$endpoint_json"
}

WORK_DIR="$(mktemp -d)"
cleanup() {
  rm -rf "$WORK_DIR"
}
trap cleanup EXIT

account_id="$(validate_live_account)" || exit 1
if [[ -z "$account_id" ]]; then
  echo "::error::Stripe account response did not include an account id" >&2
  exit 1
fi

pro_product_id="$(ensure_product "Skills.md Pro")" || exit 1
credits_product_id="$(ensure_product "Skills.md Credits")" || exit 1

pro_price_id="$(ensure_price skillsmd_pro_monthly "$pro_product_id" 1000 month)" || exit 1
credit_1_price_id="$(ensure_price skillsmd_credit_1 "$credits_product_id" 100)" || exit 1
credit_5_price_id="$(ensure_price skillsmd_credit_5 "$credits_product_id" 500)" || exit 1
credit_20_price_id="$(ensure_price skillsmd_credit_20 "$credits_product_id" 2000)" || exit 1
credit_50_price_id="$(ensure_price skillsmd_credit_50 "$credits_product_id" 5000)" || exit 1
credit_100_price_id="$(ensure_price skillsmd_credit_100 "$credits_product_id" 10000)" || exit 1

webhook_json="$WORK_DIR/webhook.json"
ensure_webhook >"$webhook_json" || exit 1
webhook_secret="${STRIPE_WEBHOOK_SECRET:-$(jq -r '.secret // empty' "$webhook_json")}"
if [[ "$webhook_secret" != whsec_* ]]; then
  echo "::error::Stripe did not return a webhook signing secret. Create a new endpoint or rotate the secret, then rerun with a valid endpoint secret." >&2
  exit 1
fi

secret_payload="$WORK_DIR/stripe-secret.json"
jq -n \
  --arg secretKey "$STRIPE_API_KEY" \
  --arg publishableKey "$STRIPE_PUBLISHABLE_KEY" \
  --arg webhookSecret "$webhook_secret" \
  --arg accountId "$account_id" \
  --arg proPriceId "$pro_price_id" \
  --arg credit1PriceId "$credit_1_price_id" \
  --arg credit5PriceId "$credit_5_price_id" \
  --arg credit20PriceId "$credit_20_price_id" \
  --arg credit50PriceId "$credit_50_price_id" \
  --arg credit100PriceId "$credit_100_price_id" \
  --arg allowTestMode "${STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION:-false}" \
  '{
    STRIPE_SECRET_KEY: $secretKey,
    STRIPE_PUBLISHABLE_KEY: $publishableKey,
    STRIPE_WEBHOOK_SECRET: $webhookSecret,
    STRIPE_ACCOUNT_ID: $accountId,
    STRIPE_PRO_PRICE_ID: $proPriceId,
    STRIPE_CREDIT_1_PRICE_ID: $credit1PriceId,
    STRIPE_CREDIT_5_PRICE_ID: $credit5PriceId,
    STRIPE_CREDIT_20_PRICE_ID: $credit20PriceId,
    STRIPE_CREDIT_50_PRICE_ID: $credit50PriceId,
    STRIPE_CREDIT_100_PRICE_ID: $credit100PriceId,
    STRIPE_ALLOW_TEST_MODE_IN_PRODUCTION: $allowTestMode
  }' >"$secret_payload"

aws secretsmanager put-secret-value \
  --secret-id "$PRODUCTION_STRIPE_SECRET_NAME" \
  --secret-string "file://$secret_payload" >/dev/null

echo "Production Stripe resources are configured in AWS Secrets Manager."
