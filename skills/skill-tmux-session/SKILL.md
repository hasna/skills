---
name: skill-tmux-session
description: Create and manage grouped tmux sessions where each session focuses on its own window and its own folder. Knows workspace layout, naming conventions, and both multi-project and multi-agent patterns.
user_invocable: true
---

# skill-tmux-session

Use this skill when you need to add a window and session to an existing group, or create a new group from scratch. These are grouped tmux sessions where every named session locks onto its own window so `tmux attach -t <name>` lands directly in the intended project or tool.

## Workspace Layout

```text
~/workspace/          Linux (spark01, spark02) — always lowercase
~/Workspace/          macOS (apple01) — always capital W

[workspace]/
└── [division]/
    └── [area]/
        └── [area][status]/
            └── [prefix]-[name]/
```

Examples:

```text
workspace/hasna/opensource/opensourcedev/open-todos
workspace/hasna/opensource/opensourcedev/open-conversations
workspace/hasnaxyz/agent/agentdev/agent-claude
workspace/hasnaxyz/service/servicedev/service-chat
workspace/hasnastudio/hasnastudio-alumia/platform/platform-alumia
workspace/hasnaxyz/internalapp/iapp-takumi
```

Local tools live under `~/local/local-[name]/`.

## How grouped sessions work

- A source session owns the windows.
- Named sessions join that source session and lock onto one window index.
- `tmux attach -t open-economy` should land in the `open-economy` window without manual switching.

## When to open a session

| Work type | Source session | Session/window naming |
|-----------|----------------|-----------------------|
| Multiple OSS repos | `opensourcemaintain` | `open-[name]` |
| Multiple agent repos | `agentdev` | `agent-[name]` |
| Multiple local tools | `local` | `local-[name]` |
| Multiple workers on one project | project name | `[project]-01`, `[project]-02`, ... |

Rule: tmux groups live at the area/team level, not the individual repo level.

## Add a window to an existing group

```bash
SOURCE="opensourcemaintain"
NAME="open-economy"
DIR="$HOME/workspace/hasna/opensource/opensourcedev/open-economy"

tmux new-window -t "$SOURCE" -n "$NAME" -c "$DIR"
IDX=$(tmux list-windows -t "$SOURCE" -F "#{window_index}:#{window_name}" | grep ":${NAME}$" | cut -d: -f1)
tmux new-session -d -s "$NAME" -t "$SOURCE"
tmux select-window -t "${NAME}:${IDX}"
```

## Create a new group

```bash
SOURCE="opensourcemaintain"
BASE="$HOME/workspace/hasna/opensource/opensourcedev"

WINDOWS=(
  "open-todos:$BASE/open-todos"
  "open-conversations:$BASE/open-conversations"
  "open-mementos:$BASE/open-mementos"
)

tmux new-session -d -s "$SOURCE" -n "open-todos" -c "$BASE/open-todos"

for entry in "${WINDOWS[@]:1}"; do
  tmux new-window -t "$SOURCE" -n "$(echo "$entry" | cut -d: -f1)" -c "$(echo "$entry" | cut -d: -f2)"
done

for entry in "${WINDOWS[@]}"; do
  name=$(echo "$entry" | cut -d: -f1)
  idx=$(tmux list-windows -t "$SOURCE" -F "#{window_index}:#{window_name}" | grep ":${name}$" | cut -d: -f1)
  tmux new-session -d -s "$name" -t "$SOURCE"
  tmux select-window -t "${name}:${idx}"
done
```

## Naming rules

- OSS project: `open-[name]`
- Agent repo: `agent-[name]`
- Service repo: `service-[name]`
- Local tool: `local-[name]`
- Multi-agent on one project: `[project]-01..N`

Always use the full prefixed name for both the window name and the session name.

## Verification

```bash
tmux display-message -t open-economy -p "#{window_index}:#{window_name} @ #{pane_current_path}"
tmux list-sessions | grep "(group opensourcemaintain)"
tmux list-panes -a -F "#{session_name}:#{window_name} dead=#{pane_dead}" | grep "dead=1"
```
