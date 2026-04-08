---
name: skill-commitpush
description: Create logical commits from all staged and unstaged changes, then push directly to main. Groups related changes into separate commits with conventional commit messages. Use when you want to commit and push without creating a PR.
user_invocable: true
---

# Commit & Push to Main

Create logical, well-organized commits from the current working directory changes and push directly to `main`.

## Workflow

1. Analyze changes: run `git status` and `git diff --stat`.
2. Group logically:
   - feature code and its tests
   - documentation changes
   - config or dependency changes
   - refactors separate from new behavior
3. Skip temp or generated files:
   - `.agents-data/`, `.tmp/`, uploaded blobs
   - non-package-manager lockfiles
   - `.claude/scheduled_tasks.lock`
4. Stage and commit each logical group:
   - use `git add <specific files>`
   - write a conventional commit message (`feat:`, `fix:`, `docs:`, `test:`, `chore:`, `refactor:`)
   - explain why in the body when needed
5. Push to `origin main`
6. Report the commits created with short hashes and messages

## Commit message format

```text
type: concise description of the change

Optional body explaining why the change was made,
not what was changed.
```

Use a heredoc when the message needs a body:

```bash
git commit -m "$(cat <<'EOF'
type: description

Body if needed.
EOF
)"
```

## Rules

- Never use `git add .` or `git add -A`
- Never commit secrets, `.env` files, or credentials
- Never amend existing commits unless the user explicitly asks
- Never force-push
- If there are no changes, say so and stop
- Prefer fewer, well-scoped commits over many tiny ones
