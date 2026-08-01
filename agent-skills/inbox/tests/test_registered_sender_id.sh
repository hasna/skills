#!/usr/bin/env bash
set -euo pipefail

root=$(cd "$(dirname "$0")/../../.." && pwd)
candidate=${INBOX_UNDER_TEST:-$root/agent-skills/inbox/scripts/inbox}
if [[ ! -f "$candidate" ]]; then
  printf 'FAIL: inbox command not found: %s\n' "$candidate" >&2
  exit 2
fi

temporary=$(mktemp -d)
trap 'rm -rf "$temporary"' EXIT
mkdir -p "$temporary/bin" "$temporary/mock" "$temporary/state"

cat >"$temporary/bin/conversations" <<'MOCK'
#!/usr/bin/env bash
set -euo pipefail

case "${1:-}" in
  whoami)
    if [[ "${2:-}" == '--json' ]]; then
      printf '%s\n' '{"agent":"Herminia"}'
    else
      printf '%s\n' 'Herminia'
    fi
    ;;
  agents)
    [[ "${2:-}" == 'list' && "${3:-}" == '--json' ]]
    printf '%s\n' '{"agents":[{"id":"b27c591d","agent":"herminia"}]}'
    ;;
  since)
    [[ "${2:-}" == '30m' \
      && "${3:-}" == '--limit' \
      && "${4:-}" == '1000' \
      && "${5:-}" == '-j' \
      && "${6:-}" == '' ]]
    calls_file="$MOCK_CONVERSATIONS_STATE/since.calls"
    calls=0
    [[ -f "$calls_file" ]] && calls=$(<"$calls_file")
    calls=$((calls + 1))
    printf '%s\n' "$calls" >"$calls_file"

    if ((calls == 1)); then
      printf '%s\n' '[{"id":200,"from_agent":"seed-agent","content":"seed","channel":"open-skills"}]'
    elif ((calls == 2)); then
      printf '%s\n' '[{"id":201,"from_agent":"b27c591d","content":"own signed post [inbox:test-seat]","channel":"open-skills"},{"id":202,"from_agent":"Herminia","content":"unsigned same-name peer traffic","channel":"open-skills"},{"id":203,"from_agent":"incident-agent","content":"incident traffic","channel":"incidents"},{"id":204,"from_agent":"project-agent","content":"project traffic","channel":"open-skills"}]'
    else
      printf '%s\n' '[]'
    fi
    ;;
  *)
    printf 'unexpected conversations command: %s\n' "$*" >&2
    exit 64
    ;;
esac
MOCK
chmod +x "$temporary/bin/conversations"

set +e
output=$(PATH="$temporary/bin:$PATH" \
  MOCK_CONVERSATIONS_STATE="$temporary/mock" \
  INBOX_MONITOR_STATE_DIR="$temporary/state" \
  INBOX_MONITOR_MAX_POLLS=1 \
  bash "$candidate" '[inbox:test-seat]' 0 2>"$temporary/stderr")
command_status=$?
set -e

if ((command_status != 0)); then
  printf 'FAIL: inbox command exited %d before behavior could be checked\n' "$command_status" >&2
  sed -n '1,20p' "$temporary/stderr" >&2
  exit 2
fi

if ! actual_ids=$(printf '%s\n' "$output" | jq -r '.id'); then
  printf '%s\n' 'FAIL: inbox command output was not newline-delimited message JSON' >&2
  exit 2
fi

v120_ids=$'201\n202\n203\n204'
expected_ids=$'202\n203\n204'
if [[ "$actual_ids" == "$v120_ids" ]]; then
  printf '%s\n' 'observed v1.2.0 visible IDs: 201,202,203,204' >&2
fi

if [[ "$actual_ids" != "$expected_ids" ]]; then
  printf '%s\n' 'FAIL: signed own post stored under registered sender ID b27c591d remained visible' >&2
  printf '%s\n' 'expected visible IDs: 202,203,204' >&2
  printf 'actual visible IDs: %s\n' "${actual_ids//$'\n'/,}" >&2
  exit 1
fi

printf '%s\n' 'PASS: own registered sender ID suppressed; same-name peer, incident, and project traffic visible'
