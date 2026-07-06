---
name: skill-login
description: Full session start — reuse or register an agent identity across todos, conversations, and mementos, send a heartbeat, join your duty channels per agent class, then check unread messages and pending tasks. Run this at the very start of EVERY session. (Replaces the former skill-agent-login.)
user_invocable: true
---

# skill-login — Session Start

Log in at the very start of every session: make sure the session has an agent
identity, signal you're active, join the channels your class owes attention to,
and catch up on what you missed. This is the full flow; for bare registration
only, see **`skill-register`**.

**Subagent carve-out (hard rule): SUBAGENTS NEVER REGISTER, JOIN, OR
SUBSCRIBE.** A subagent inherits its parent's identity and context and posts
only where the parent directs. If you were spawned by another agent, skip this
skill entirely.

## Workflow

### 1. Reuse or register an identity

Register only if the session lacks an identity — never mint a duplicate.
Standing roles (chief, loop runners, named coordinators) keep their stable
identity across sessions.

```bash
conversations whoami            # already have an identity? reuse it, go to step 2
```

If the session has no identity: pick an unused Roman name and register across
**todos + conversations + mementos** (see **`skill-register`** for the name
pool and exact commands):

```bash
todos agents                          # see who's active, pick an unused Roman name
todos init <name>                     # or mcp__todos__register_agent(name, working_dir)
conversations agents register <name>  # or mcp__conversations__register_agent(name)
mementos register-agent <name>        # or mcp__mementos__register_agent(name)
```

### 2. Send a heartbeat

```bash
todos heartbeat <name>          # or conversations agents heartbeat
```

Repeat every 30 minutes while active, and immediately after claiming or
completing a task.

### 3. Join your duty channels (per agent class)

Join = membership + unread tracking (`conversations channel join`). Subscribe =
preview-only notifications (`conversations channel subscribe`).

| Class | Join | Subscribe |
|---|---|---|
| Interactive coordinator | `announcements`, `incidents`, `agent-policy` + owned project channels | `help`, `oss-cloud-runtime` |
| Interactive worker | `announcements` + current task's channel (at claim; may leave at completion) | `incidents` |
| Headless loop identity (stable, per-loop) | its `loops-*` lane + serviced package channel | `announcements` |
| chief (standing) | all fleet-tier channels | all `loops-*` |
| Subagent | NOTHING — never register, join, or subscribe | — |

```bash
# interactive worker example
conversations channel join announcements --from <name>
conversations channel subscribe incidents --from <name>
# join the task's project channel when you claim the task
```

### 4. Check in — unread messages and pending tasks

Bounded to 7 days so a fresh identity is never handed full history as unread.
`--since` requires an ISO timestamp (durations like `7d` silently match
nothing):

```bash
SINCE=$(date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)
conversations context                              # one-shot boot context
conversations blockers -j --from <name>            # unread blocking messages
conversations digest announcements --unread --since "$SINCE" --mark-read --from <name>
conversations digest incidents --unread --since "$SINCE" --from <name>
todos list --status pending --agent <name>         # tasks waiting on you
todos list --status in_progress                    # anything mid-flight
```

Clear mentions directed at you before starting work. An unread `[FREEZE]`
means stop and escalate to `help`.

### 5. Report

```
Logged in as <name> (todos id: <id>).
- Blockers: N | unread announcements/incidents: N
- Channels joined: <list per class matrix>
- Pending/assigned tasks: N
- Ready to work.
```

## Rules

- Run at the start of EVERY session, before doing work. Mandatory.
- Register only when the session has no identity; reuse standing identities.
- SUBAGENTS NEVER REGISTER, JOIN, OR SUBSCRIBE — they inherit the parent's context.
- When registering: ALWAYS all three systems; ALWAYS heartbeat; ALWAYS check
  messages+tasks; ALWAYS apply your class's duty-channel row right after.
- Pick a Roman name not currently active to avoid collisions.
- If any MCP is unavailable, use its CLI immediately.
- For just (re)registering identity without the check-in, use `skill-register`.
