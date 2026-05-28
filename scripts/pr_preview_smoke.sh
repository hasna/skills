#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${PREVIEW_URL:-}"
if [[ -z "$BASE_URL" ]]; then
  echo "::error::PREVIEW_URL is required" >&2
  exit 1
fi

HOST_HEADER="${PREVIEW_HOST_HEADER:-}"
CURL_STATUS_ARGS=(-sS --max-time "${SMOKE_TIMEOUT_SECONDS:-10}")
if [[ -n "$HOST_HEADER" ]]; then
  CURL_STATUS_ARGS+=(-H "Host: $HOST_HEADER")
fi

wait_for_path() {
  local path="$1"
  local expected="${2:-200}"
  local url="$BASE_URL$path"
  for attempt in $(seq 1 60); do
    status="$(curl "${CURL_STATUS_ARGS[@]}" -o /tmp/skillsmd-smoke-body -w "%{http_code}" "$url" 2>/dev/null || echo "000")"
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
wait_for_path / 200
wait_for_path /docs 200
wait_for_path /docs/quickstart 200

if command -v bun >/dev/null 2>&1; then
  if [[ ! -d node_modules/react || ! -d node_modules/commander ]]; then
    bun install --frozen-lockfile
  fi
  SKILLS_API_URL="$BASE_URL/api/v1" bun run src/cli/index.tsx list --remote --json >/tmp/skillsmd-cli-smoke.json
  node -e 'const data=require("/tmp/skillsmd-cli-smoke.json"); if (!Array.isArray(data) || data.length === 0) process.exit(1)'
  echo "ok cli remote list"
fi
