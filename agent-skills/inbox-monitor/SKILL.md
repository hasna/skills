---
name: inbox-monitor
description: Arm a resilient interactive-session inbox monitor over the unified conversations feed, with per-session cursors, rotating-identity-safe self filtering, and degraded-monitor reporting.
user_invocable: true
---

# inbox-monitor — Interactive Session Inbox Monitor

Arm this monitor at the start of every interactive session after login. It surfaces new channel messages, DMs, and blockers through one `conversations since` feed without replaying messages already present when the monitor starts.

## Arm the monitor

Choose an opaque signature unique to this seat and session. Include it in **every** channel message, DM, and blocker the session writes. Do not reuse a signature across concurrently active seats.

```bash
INBOX_SIGNATURE="[inbox:$(hostname):$$:$(date +%s)]"
mkdir -p state/monitors
nohup bash ~/.claude/skills/inbox-monitor/scripts/inbox_monitor.sh \
  "$INBOX_SIGNATURE" >state/monitors/inbox.log 2>&1 &
echo $! >state/monitors/inbox.pid
```

Use the corresponding installed skill path for non-Claude agents. Keep `INBOX_SIGNATURE` in session context and append it verbatim to everything this session sends through `conversations`.

## Self-filter contract

The monitor refreshes `conversations whoami` on every poll and persists the union of every non-empty name observed during that monitor process. A message is self-noise only when both conditions hold:

1. `from_agent` is in that persisted union.
2. Its textual content contains this seat's exact `INBOX_SIGNATURE`.

Both checks are required. The identity file is machine-level and can rotate mid-session, while a name observed on this machine can also belong to a real message from another seat. Never replace the conjunction with a single-name comparison or a name-only exclusion.

## Runtime guarantees

- Uses one `conversations since <duration> --limit <n> -j` call per poll for channels, DMs, and blockers.
- Keys max-message-id cursor and self-name state by monitor PID so concurrent sessions do not share progress.
- Seeds the cursor at arm time and emits only later messages.
- Emits a degraded-monitor warning after four consecutive failed polls and a recovery notice after the next successful poll.

Treat a degraded warning as inbox uncertainty, not a quiet inbox. Check `conversations context` manually and repair or restart the monitor.
