#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
mkdir -p "$temporary/bin" "$temporary/state"

cat >"$temporary/bin/conversations" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

counter_file="$MOCK_STATE/${1}.calls"
count=0
[[ -f "$counter_file" ]] && count=$(cat "$counter_file")
count=$((count + 1))
printf '%s\n' "$count" >"$counter_file"

expect_since() {
  [[ "${1:-}" == 'since' \
    && "${2:-}" == '30m' \
    && "${3:-}" == '--limit' \
    && "${4:-}" == '1000' \
    && "${5:-}" == '-j' \
    && "${6:-}" == '' ]]
}

case "$1:$count" in
  whoami:1) printf 'manius\n' ;;
  whoami:2) printf 'fabricius\n' ;;
  whoami:3) printf 'agent-ceo\n' ;;
  since:1)
    expect_since "$@"
    printf '[{"id":100,"from_agent":"old","content":"seed"}]\n'
    ;;
  since:2)
    expect_since "$@"
    printf '%s\n' '[{"id":101,"from_agent":"fabricius","content":"own [seat-signature]"},{"id":102,"from_agent":"agent-ceo","content":"genuine before observation"}]'
    ;;
  since:3)
    expect_since "$@"
    printf '%s\n' '[{"id":103,"from_agent":"manius","content":"own after rotation [seat-signature]"},{"id":104,"from_agent":"agent-ceo","content":"own current [seat-signature]"},{"id":105,"from_agent":"agent-ceo","content":"genuine from same-name seat"}]'
    ;;
  *) exit 1 ;;
esac
MOCK
chmod +x "$temporary/bin/conversations"

output=$(PATH="$temporary/bin:$PATH" \
  MOCK_STATE="$temporary" \
  INBOX_MONITOR_STATE_DIR="$temporary/state" \
  INBOX_MONITOR_MAX_POLLS=2 \
  bash "$root/agent-skills/inbox-monitor/scripts/inbox_monitor.sh" '[seat-signature]' 0)

actual_ids=$(printf '%s\n' "$output" | jq -r '.id')
[[ "$actual_ids" == $'102\n105' ]]
! printf '%s\n' "$output" | jq -e 'select(.id == 101 or .id == 103 or .id == 104)' >/dev/null

names_file=$(find "$temporary/state" -name 'inbox.*.self-names' -type f)
[[ $(sort "$names_file") == $'agent-ceo\nfabricius\nmanius' ]]
cursor_file=$(find "$temporary/state" -name 'inbox.*.cursor' -type f)
[[ $(cat "$cursor_file") == 105 ]]

fixture='[{"id":101,"from_agent":"fabricius","content":"own [seat-signature]"},{"id":105,"from_agent":"agent-ceo","content":"genuine from same-name seat"}]'
[[ $(printf '%s' "$fixture" | jq --arg me manius '[.[] | select(.from_agent != $me) | .id]') == '[
  101,
  105
]' ]]
[[ $(printf '%s' "$fixture" | jq --arg me agent-ceo '[.[] | select(.from_agent != $me) | .id]') == '[
  101
]' ]]
