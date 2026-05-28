#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${PRODUCTION_URL:-https://skills.md}"
CURL_STATUS_ARGS=(-sS --max-time "${SMOKE_TIMEOUT_SECONDS:-10}")
CURL_FAIL_ARGS=(-f "${CURL_STATUS_ARGS[@]}")
STRIPE_CUSTOM_DOMAIN="${STRIPE_CUSTOM_DOMAIN:-pay.hasna.tools}"

wait_for_path() {
  local path="$1"
  local expected="${2:-200}"
  local url="$BASE_URL$path"
  for attempt in $(seq 1 60); do
    status="$(curl "${CURL_STATUS_ARGS[@]}" -o /tmp/skillsmd-production-smoke-body -w "%{http_code}" "$url" 2>/dev/null || echo "000")"
    if [[ "$status" == "$expected" ]]; then
      echo "ok $path $status"
      return 0
    fi
    echo "waiting $path attempt=$attempt status=$status"
    sleep 10
  done
  echo "::error::$path did not return $expected" >&2
  return 1
}

wait_for_path /api/health 200
wait_for_path /api/version 200
wait_for_path "/api/skills?fields=name,category" 200
wait_for_path "/api/v1/skills" 401
wait_for_path "/api/v1/skills/image" 401
wait_for_path "/api/v1/runs/00000000-0000-0000-0000-000000000000/artifacts" 401
wait_for_path / 200
wait_for_path /docs 200
wait_for_path /docs/quickstart 200

quote_status="$(curl "${CURL_STATUS_ARGS[@]}" \
  -o /tmp/skillsmd-production-quote-smoke-body \
  -w "%{http_code}" \
  -H "Content-Type: application/json" \
  -X POST \
  --data '{}' \
  "$BASE_URL/api/v1/skills/image/quote")"
if [[ "$quote_status" != "401" ]]; then
  echo "::error::unauthenticated skill quote returned $quote_status, expected 401" >&2
  exit 1
fi
echo "ok /api/v1/skills/image/quote 401"

json_field() {
  local file="$1"
  local field="$2"
  node -e "const data=require(process.argv[1]); const value=data[process.argv[2]]; if (typeof value !== 'string' || value.length === 0) process.exit(1); console.log(value)" "$file" "$field"
}

assert_url_prefix() {
  local name="$1"
  local url="$2"
  local prefix="$3"
  if [[ "$url" == "$prefix"* ]]; then
    echo "ok $name custom domain"
  else
    echo "::error::$name returned unexpected hosted URL: ${url%%\\?*}" >&2
    return 1
  fi
}

if [[ -n "${SKILLS_API_KEY:-}" ]]; then
  curl "${CURL_FAIL_ARGS[@]}" \
    -H "Authorization: Bearer $SKILLS_API_KEY" \
    -H "Content-Type: application/json" \
    -X POST \
    -o /tmp/skillsmd-production-checkout.json \
    "$BASE_URL/api/v1/billing/checkout"
  checkout_url="$(json_field /tmp/skillsmd-production-checkout.json url)"
  assert_url_prefix "checkout" "$checkout_url" "https://$STRIPE_CUSTOM_DOMAIN/c/"

  curl "${CURL_FAIL_ARGS[@]}" \
    -H "Authorization: Bearer $SKILLS_API_KEY" \
    -H "Content-Type: application/json" \
    -X POST \
    -o /tmp/skillsmd-production-portal.json \
    "$BASE_URL/api/v1/billing/portal"
  portal_url="$(json_field /tmp/skillsmd-production-portal.json url)"
  assert_url_prefix "customer portal" "$portal_url" "https://$STRIPE_CUSTOM_DOMAIN/p/"

  if command -v bun >/dev/null 2>&1; then
    if [[ ! -d node_modules/react || ! -d node_modules/commander ]]; then
      bun install --frozen-lockfile
    fi
    SKILLS_API_URL="$BASE_URL/api/v1" SKILLS_API_KEY="$SKILLS_API_KEY" \
      bun run src/cli/index.tsx list --remote --json >/tmp/skillsmd-production-cli-smoke.json
    node -e 'const data=require("/tmp/skillsmd-production-cli-smoke.json"); if (!Array.isArray(data) || data.length === 0) process.exit(1)'
    echo "ok authenticated cli remote list"
  fi
else
  echo "skip authenticated Stripe hosted URL smoke (SKILLS_API_KEY not set)"
  echo "skip authenticated CLI remote list smoke (SKILLS_API_KEY not set)"
fi
