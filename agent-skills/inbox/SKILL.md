---
name: inbox
description: Install and arm the repository-owned interactive-session inbox monitor with sender-ID-aware self filtering.
user_invocable: true
---

# inbox — Interactive Session Inbox

`scripts/inbox` is the canonical source for `~/.hasna/bin/inbox`. Install it verbatim with an atomic rename:

```bash
install -d "$HOME/.hasna/bin"
staged=$(mktemp "$HOME/.hasna/bin/.inbox.XXXXXX")
install -m 0755 scripts/inbox "$staged"
mv "$staged" "$HOME/.hasna/bin/inbox"
```

Choose a unique per-seat signature, include it in every Conversations message sent by the seat, and arm the monitor:

```bash
INBOX_SIGNATURE="[inbox:$(hostname):$$:$(date +%s)]"
inbox "$INBOX_SIGNATURE" 15
```

The monitor suppresses a message only when its exact signature is present and its stored sender is either the current display name or a registered ID resolved for that name. Unsigned same-name peer traffic remains visible.
