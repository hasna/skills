---
name: skill-monitor
description: Interact with the open-monitor MCP — check machine health, list processes, kill memory hogs, run doctor, manage cron jobs, trigger cache cleanup
user_invocable: true
---

# skill-monitor

Use the `monitor_*` MCP tools from `@hasna/monitor` to help the user manage their machines.

## Prerequisites check

If any `monitor_*` tool call fails with "tool not found" or "MCP not connected", tell the user:

```text
The open-monitor MCP is not installed. Add it with:
  claude mcp add monitor -- monitor-mcp
Then restart Claude Code and try again.
```

## Use cases

### Check machine health
**Trigger**: "how is the machine doing?", "machine health", "system status", "is everything ok?"

1. Call `monitor_health` (no args, or `machine_id: "local"`)
2. Call `monitor_snapshot` to get current CPU/memory/disk
3. Summarize: overall status, any alerts, top resource users

### List memory hogs
**Trigger**: "what's eating memory?", "high memory processes", "memory usage", "what's using RAM?"

1. Call `monitor_processes`
2. Show a table: PID, name, memory (MB), CPU%
3. Offer to kill any if the user wants

### Kill a process
**Trigger**: "kill pid 1234", "kill process X", "stop process Y"

1. Confirm the process name/PID with the user if ambiguous
2. Call `monitor_kill` with `pid: <pid>` and `signal: "SIGTERM"`
3. Report the result; if it failed, offer `SIGKILL`

### Run doctor
**Trigger**: "run doctor", "doctor check", "health check", "diagnose"

1. Call `monitor_doctor` (optionally with `machine_id`)
2. Show the full report: status per check, recommended actions
3. If any checks failed, summarize what to fix

### Trigger cache cleanup
**Trigger**: "clean caches", "clear dev caches", "free up disk", "cleanup npm/bun/pip cache"

1. Find the `cache-cleaner` cron job: call `monitor_cron_jobs` with `action: "list"`
2. Run it with `monitor_cron_jobs`
3. Report what changed

### List cron jobs
**Trigger**: "show monitor jobs", "what cron jobs are set up?", "monitor schedule"

1. Call `monitor_cron_jobs` with `action: "list"`
2. Show a table: name, schedule, action type, enabled, last run
3. Offer to enable/disable or run any job

## Output style

- Use tables for process lists and cron job lists
- Lead with the summary and keep details below it
- Always show the machine ID being queried (default: local)
