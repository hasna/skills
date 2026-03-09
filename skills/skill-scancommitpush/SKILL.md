---
name: skill-scancommitpush
description: Scan repo for all changes, group them into logical commits with conventional messages, and push to GitHub. Use when the user says "commit", "push", or invokes /commit. Does NOT create a pull request.
---

# Scan, Commit & Push

Scan the entire repository for changes, group them into logical commits, write high-quality commit messages, and push to GitHub. This skill does NOT create a pull request.

## Step 1: Pre-flight Checks

1. **Verify git repo**: Run `git rev-parse --git-dir`. If not a git repo, stop and inform the user.

2. **Check for merge conflicts**: Run `git diff --name-only --diff-filter=U`. If any files listed, stop: "There are unresolved merge conflicts in: [list]. Please resolve them before committing."

3. **Check current branch**: Run `git branch --show-current`. Note the branch name. If detached HEAD, warn the user and ask whether to proceed.

4. **Check remote**: Run `git remote -v`. If no remote configured, stop: "No git remote configured. Add one before pushing."

5. **Check upstream**: Run `git rev-parse --abbrev-ref @{upstream} 2>/dev/null`. If no upstream, you'll need `git push -u origin <branch>` later.

## Step 2: Scan All Changes

1. **Run `git status`** (never use `-uall` flag). Note staged changes, unstaged modifications, and untracked files.

2. **Run `git diff --stat`** for unstaged modification summary.

3. **Run `git diff --cached --stat`** for staged change summary.

4. **If NO changes exist** (nothing staged, unstaged, or untracked): "Working tree is clean. Nothing to commit." Stop.

5. **Detect sensitive files** and EXCLUDE from commits:
   - `.env`, `.env.*` (environment files)
   - `*.pem`, `*.key`, `*.p12` (private keys)
   - `credentials.json`, `service-account*.json`
   - `.secrets/`, `secrets/`
   - Files containing API keys or tokens

   Warn: "Found potentially sensitive files that will NOT be committed: [list]. Add them to .gitignore if needed."

## Step 3: Group Changes into Logical Commits

Do NOT create one giant commit. Analyze changes and group them into logical, atomic commits.

### Grouping Rules (in priority order)

1. **By feature/functionality**: Changes implementing a single feature or fixing a single bug go together.
   - Files that import or reference each other
   - Files in the same directory working toward the same goal
   - Test files paired with the code they test

2. **By type of change**:
   - Configuration changes (package.json, tsconfig, eslint) → own commit
   - Documentation changes (README, CHANGELOG) → own commit
   - Dependency updates (lockfiles + package.json) → one commit
   - Refactoring (rename, restructure without behavior change) → separate from features
   - Test additions paired with the code they test → together

3. **By scope/area**: Changes in unrelated parts of the codebase → separate commits.

4. **Single-file changes**: A lone modified file unrelated to others → own commit.

### Decision Process

For each changed file ask:
- What is the purpose of this change? (feature, fix, refactor, docs, config, test)
- Which other files does this change relate to?
- Would this change make sense on its own?

**When in doubt, split into smaller commits.** Small atomic commits are always better than large unfocused ones.

### Special Cases

- **Lockfiles** (package-lock.json, bun.lockb, yarn.lock, pnpm-lock.yaml): Always group with corresponding package.json change
- **Generated files**: Group with the source change that produced them, or skip if they belong in .gitignore
- **Already staged changes**: Respect the user's intent — commit staged files as one group, then handle remaining changes separately
- **Untracked files**: New source files → commit. Build artifacts, logs, editor configs → suggest .gitignore

## Step 4: Create Commits

For each logical group, commit in dependency order (foundational changes first):

1. **Stage files**: `git add <file1> <file2> ...` — use specific paths, NEVER `git add .` or `git add -A`.

2. **Write commit message**:

   ```
   <type>: <concise summary in imperative mood>

   <optional body explaining WHY, not WHAT>

   Co-Authored-By: Claude <noreply@anthropic.com>
   ```

   | Type | When |
   |------|------|
   | `feat` | New feature or capability |
   | `fix` | Bug fix |
   | `refactor` | Code restructuring, no behavior change |
   | `docs` | Documentation only |
   | `test` | Adding or updating tests |
   | `chore` | Config, dependencies, build, CI |
   | `style` | Formatting, whitespace, linting |
   | `perf` | Performance improvement |

   Rules:
   - Subject line max 72 chars, imperative mood ("Add feature" not "Added")
   - No period at end of subject
   - Be specific: "fix: resolve null pointer in user auth" not "fix: fix bug"

3. **Create commit** using HEREDOC:
   ```bash
   git commit -m "$(cat <<'EOF'
   <type>: <summary>

   <optional body>

   Co-Authored-By: Claude <noreply@anthropic.com>
   EOF
   )"
   ```

4. **Verify**: `git log --oneline -1` to confirm.

5. **Repeat** for each group.

## Step 5: Push to Remote

1. If no upstream: `git push -u origin <branch>`. Otherwise: `git push`.

2. **Handle failures**:
   - **Rejected (non-fast-forward)**: "Push rejected — remote has new commits. You may need to pull and rebase first." Do NOT force-push.
   - **Auth failure**: "Check your Git credentials."
   - **No permission**: "You may not have push access to this repository."

3. **NEVER force push** unless the user explicitly requests it.

## Step 6: Summary

```
Committed and pushed to <branch>:

1. <hash> <type>: <summary> (N files)
2. <hash> <type>: <summary> (N files)
...

Total: X commits, Y files changed
Remote: origin/<branch>
```

## Edge Cases

| Situation | Action |
|-----------|--------|
| No changes | "Working tree is clean. Nothing to commit." Stop. |
| Only staged changes | Commit staged as-is, push |
| Only untracked files | Evaluate each, stage appropriate ones, commit, push |
| Hundreds of files | Still group logically, create more commits |
| Binary files | Include in commit, note in summary |
| Submodule changes | Commit pointer update separately |
| Pre-commit hook fails | Report failure, do NOT use --no-verify. Fix the issue, create NEW commit. |
| Branch behind remote | Warn, suggest pull/rebase |
| Detached HEAD | Warn, ask before proceeding |
| Empty commit would result | Skip that group, no --allow-empty |

## Safety Rules

- **NEVER** `git add .` or `git add -A` — always stage specific files
- **NEVER** `--no-verify` to skip hooks
- **NEVER** force push without explicit user request
- **NEVER** commit .env files or secrets
- **NEVER** amend existing commits unless user explicitly asks
- **NEVER** rebase or modify published history
- If pre-commit hook fails, fix the issue and create a NEW commit
