---
name: skill-publish
description: Full publish workflow for @hasna npm packages. Runs tests, logical commits, push, OSS checks (if hasna org), posts publish intent to git-publishing, publishes to npm, installs locally via bun, verifies via CLI, confirms in-thread. Never uses npm to install.
user_invocable: true
---

# skill-publish — Full Publish Workflow

Complete end-to-end publish for `@hasna/*` packages. Covers OSS requirements,
version bump, validation, PR merge, publish intent to `git-publishing`, npm
registry publish, bun install, CLI verification, and in-thread confirmation.

## Workflow

### 1. Pre-flight checks

```bash
# Detect org from git remote
REMOTE=$(git remote get-url origin)
ORG=$(echo $REMOTE | grep -oP '(?<=github\.com[:/])[^/]+')
PKG=$(cat package.json | python3 -c "import sys,json; print(json.load(sys.stdin)['name'])")
echo "Org: $ORG | Package: $PKG"
```

### 2. OSS checks (hasna org only)

If org is `hasna` (public open source), verify before doing anything else:

**LICENSE** — Must be Apache 2.0:
```bash
[ -f LICENSE ] || echo "MISSING: LICENSE file"
grep -q "Apache" LICENSE 2>/dev/null || echo "WRONG LICENSE: must be Apache-2.0"
```
If missing, create it (full Apache 2.0 text). Update `package.json` → `"license": "Apache-2.0"`.

**README.md** — Must exist with at minimum: package name, description, install command, basic usage.

**package.json** fields required:
- `"license": "Apache-2.0"`
- `"description"` — non-empty
- `"repository"` — pointing to github.com/hasna/<name>
- `"publishConfig": { "registry": "https://registry.npmjs.org", "access": "public" }`

**GitHub repo visibility** — Hasna OSS packages must be public, but changing
repo visibility is a risky disclosure action. Check it and stop for explicit
human approval if it is private; do not auto-flip visibility inside this skill.
```bash
if gh repo view --json isPrivate -q '.isPrivate' | grep -q true; then
  echo "BLOCKED: repo is private; get explicit approval and complete a full history/secret review before making it public"
  exit 1
fi
```

If org is `hasnaxyz` (private), ensure:
- `"publishConfig": { "access": "restricted" }`

### 3. Bump version on a release branch

Do release edits on a branch, never directly on `main`.

```bash
git switch -c "release/${PKG##*/}-$(date -u +%Y%m%d%H%M%S)"

# Check current published version. Prefer bun; fall back to npm only if present.
CURRENT=$(bun pm view "$PKG" version 2>/dev/null || npm view "$PKG" version 2>/dev/null || echo "0.0.0")
echo "Current: $CURRENT"

# Bump patch in package.json unless the user explicitly requested another level.
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json'));
const parts = pkg.version.split('.').map(Number);
parts[2]++;
pkg.version = parts.join('.');
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('New version:', pkg.version);
"
```

### 4. Run tests and build

```bash
bun test 2>&1
[ "$(cat package.json | python3 -c "import sys,json; print('build' in json.load(sys.stdin).get('scripts',{}))")" = "True" ] && bun run build
```
If tests fail → fix them before continuing. Never publish broken tests.

### 5. Secrets scan

```bash
git add package.json bun.lock
SECRET_PATTERN='sk-(ant|proj)-|npm_[[:alpha:]]|gh[op]_|AKIA[[:upper:][:digit:]]|xai[-]|AI[z]a'
if git diff --cached --diff-filter=ACM --unified=0 | grep -iE "^\\+[^+].*($SECRET_PATTERN)"; then
  echo "SECRETS - STOP"
  exit 1
fi
```

### 6. Logical commit, push, PR, and merge

```bash
NEW_VERSION=$(cat package.json | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")
git commit -m "chore: release $PKG@$NEW_VERSION"
git push -u origin HEAD
```

Open a PR for the release branch. Wait for required CI and an independent review,
then merge it. After merge, update local `main` and verify that `package.json`
on `main` contains the exact version you are about to publish. Do not publish
from an unmerged branch or unreviewed local commit.

```bash
gh pr create --fill
# after CI/review approval:
gh pr merge --squash --delete-branch
git switch main
git pull --ff-only origin main
test "$(cat package.json | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")" = "$NEW_VERSION"
```

### 7. Post publish intent to git-publishing (BEFORE publishing)

Fleet rule: publish intent goes to the `git-publishing` channel BEFORE any
`bun publish`/`npm publish`, and the result is confirmed in the same thread
after. Re-check blockers first — an unread `[FREEZE]` means stop and escalate
to `help`.

```bash
conversations blockers --from <agent>    # unread [FREEZE] → STOP
NEW_VERSION=$(cat package.json | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")
INTENT_ID=$(conversations send "publish intent: $PKG@$NEW_VERSION — <one-line changelog>" \
  --channel git-publishing --from <agent> -j \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])")
echo "Intent posted: message $INTENT_ID"
```

### 8. Publish

```bash
ACCESS=public
[ "$ORG" = "hasnaxyz" ] && ACCESS=restricted
if command -v bun >/dev/null 2>&1; then
  bun publish --access "$ACCESS"
elif command -v npm >/dev/null 2>&1; then
  npm publish --access "$ACCESS"
else
  echo "BLOCKED: neither bun nor npm publish is available"
  exit 1
fi
```

### 9. Install locally via bun (NOT npm)

```bash
bun install -g $PKG
```

Remove any npm global install if it exists:
```bash
if command -v npm >/dev/null 2>&1 && npm list -g "$PKG" 2>/dev/null | grep -q "$PKG"; then
  npm uninstall -g "$PKG" && echo "Removed npm global install"
fi
```

### 10. Verify via CLI

Get the CLI binary name from `package.json#bin`, then test it:
```bash
BIN=$(cat package.json | python3 -c "import sys,json; bins=json.load(sys.stdin).get('bin',{}); print(next(iter(bins), '')) if isinstance(bins, dict) else print('')" 2>/dev/null)
if [ -z "$BIN" ]; then
  echo "BLOCKED: package.json has no CLI bin to verify"
  exit 1
fi
"$BIN" --version || "$BIN" --help 2>&1 | head -3
echo "$PKG published and verified via $BIN"
```

### 11. Confirm in-thread on git-publishing

Reply to the intent message — success or failure, always close the thread:

```bash
conversations reply "published: $PKG@$NEW_VERSION — verified via $BIN" --to $INTENT_ID --from <agent>
```

If the publish failed or was aborted after the intent post:
```bash
conversations reply "publish aborted: $PKG@$NEW_VERSION — <reason>" --to $INTENT_ID --from <agent>
```

Repo releases (GitHub tags/releases) are announced on `git-releases`, not
`git-publishing`.

## Rules

- NEVER `npm install -g` — always `bun install -g`
- NEVER publish from an unmerged branch or unreviewed local commit
- NEVER push release changes directly to `main`; use a branch, PR, CI, review, and merge
- NEVER publish without running tests and build first
- NEVER publish with secrets in the staged diff
- NEVER publish without posting intent to `git-publishing` first (step 7)
- ALWAYS confirm in the intent thread after — published or aborted, no silent exits
- NEVER bump minor or major — patch only unless user explicitly says otherwise
- NEVER skip the CLI verification step
- NEVER auto-change GitHub repo visibility; stop for explicit approval and full history/secret review
- If `hasna` org: Apache 2.0 + public + README required — no exceptions
- If `hasnaxyz` org: restricted access required
