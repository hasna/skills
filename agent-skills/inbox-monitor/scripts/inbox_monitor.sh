#!/usr/bin/env bash
set -u

signature=${1:-${INBOX_SIGNATURE:-}}
poll_seconds=${2:-${INBOX_MONITOR_POLL_SECONDS:-15}}
state_dir=${INBOX_MONITOR_STATE_DIR:-state/monitors}
max_polls=${INBOX_MONITOR_MAX_POLLS:-0}
since_duration=${INBOX_MONITOR_SINCE_DURATION:-30m}
page_limit=${INBOX_MONITOR_PAGE_LIMIT:-1000}

if [[ -z "$signature" ]]; then
  printf 'usage: %s <content-signature> [poll-seconds]\n' "$0" >&2
  exit 2
fi
if [[ ! "$page_limit" =~ ^[1-9][0-9]*$ ]]; then
  printf 'inbox-monitor: INBOX_MONITOR_PAGE_LIMIT must be a positive integer\n' >&2
  exit 2
fi

mkdir -p "$state_dir"
cursor_file="$state_dir/inbox.$$.cursor"
self_names_file="$state_dir/inbox.$$.self-names"
: >"$self_names_file"

messages() {
  jq -c 'if type == "array" then . elif (.messages? | type) == "array" then .messages elif (.items? | type) == "array" then .items elif (.data? | type) == "array" then .data else error("unsupported conversations since response") end'
}

remember_current_name() {
  local current_name
  current_name=$(conversations whoami 2>/dev/null | head -n 1 | tr -d '\r') || return 1
  [[ -z "$current_name" ]] && return 0
  grep -Fqx -- "$current_name" "$self_names_file" || printf '%s\n' "$current_name" >>"$self_names_file"
}

latest_cursor() {
  jq -r '[.[] | .id // .message_id // empty | tonumber?] | max // 0'
}

fetch_messages() {
  conversations since "$since_duration" --limit "$page_limit" -j 2>/dev/null
}

emit_inbound() {
  jq -c --arg signature "$signature" --argjson cursor "$1" --rawfile self_names "$self_names_file" '
    ($self_names | split("\n") | map(select(length > 0))) as $names
    | .[]
    | select(((.id // .message_id // 0) | tonumber? // 0) > $cursor)
    | select((((.from_agent // "") as $from | (($names | index($from)) != null) and ((.content // .message // .body // "") | tostring | contains($signature))) | not))'
}

seed=$(fetch_messages) || { printf 'inbox-monitor: failed to seed conversations cursor\n' >&2; exit 1; }
seed=$(printf '%s' "$seed" | messages) || { printf 'inbox-monitor: invalid seed response\n' >&2; exit 1; }
printf '%s\n' "$(printf '%s' "$seed" | latest_cursor)" >"$cursor_file"
remember_current_name || true

failures=0
polls=0

finish_poll() {
  ((polls += 1))
  if (( max_polls > 0 && polls >= max_polls )); then
    exit 0
  fi
}
while true; do
  sleep "$poll_seconds"
  remember_current_name || true
  cursor=$(cat "$cursor_file")

  if response=$(fetch_messages) \
    && normalized=$(printf '%s' "$response" | messages) \
    && next_cursor=$(printf '%s' "$normalized" | latest_cursor) \
    && printf '%s' "$normalized" | emit_inbound "$cursor"; then
    if (( failures >= 4 )); then
      printf 'inbox-monitor: recovered after %d consecutive poll failures\n' "$failures"
    fi
    failures=0
    if (( next_cursor > cursor )); then
      printf '%s\n' "$next_cursor" >"$cursor_file"
    fi
    finish_poll
    continue
  fi

  ((failures += 1))
  if (( failures == 4 )); then
    printf 'inbox-monitor: DEGRADED after 4 consecutive poll failures; inbox may be stale\n'
  fi
  finish_poll
done
