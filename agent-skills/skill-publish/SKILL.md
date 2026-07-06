---
name: skill-publish
description: Full publish workflow for @hasna npm packages. Runs tests, logical commits, push, OSS checks (if hasna org), posts publish intent to git-publishing, publishes to npm, installs locally via bun, verifies via CLI, confirms in-thread. Never uses npm to install.
user_invocable: true
---

# skill-publish — Full Publish Workflow

Complete end-to-end publish for `@hasna/*` packages. Covers OSS requirements, commits, push, publish intent to `git-publishing`, npm publish, bun install, CLI verification, and in-thread confirmation.

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

**GitHub repo visibility** — Ensure public:
```bash
gh repo view --json isPrivate -q '.isPrivate' | grep -q true && gh repo edit --visibility public && echo "Made public"
```

If org is `hasnaxyz` (private), ensure:
- `"publishConfig": { "access": "restricted" }`

### 3. Run tests

```bash
bun test 2>&1
```
If tests fail → fix them before continuing. Never publish broken tests.

### 4. Secrets scan

```bash
git diff HEAD --diff-filter=ACM | grep -iE 'sk-ant-|sk-proj-|npm_[a-zA-Z]|gho_|ghp_|AKIA[A-Z0-9]|xai-|AIza' && echo "SECRETS — STOP" && exit 1
```

### 5. Logical commits & push

Follow the same grouping logic as `/skill-push` — specific files, conventional commits, no Co-Authored-By, no `git add -A`, then `git push origin main`.

### 6. Bump version & build

```bash
# Check current published version
CURRENT=$(npm view $PKG version 2>/dev/null || echo "0.0.0")
echo "Current: $CURRENT"

# Bump patch in package.json
node -e "
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('package.json'));
const parts = pkg.version.split('.').map(Number);
parts[2]++;
pkg.version = parts.join('.');
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
console.log('New version:', pkg.version);
"

# Build if build script exists
[ "$(cat package.json | python3 -c "import sys,json; print('build' in json.load(sys.stdin).get('scripts',{}))")" = "True" ] && bun run build
```

### 7. Post publish intent to git-publishing (BEFORE publishing)

Fleet rule: publish intent goes to the `git-publishing` channel BEFORE any
`npm publish`/`bun publish`, and the result is confirmed in the same thread
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
npm publish
```

### 9. Install locally via bun (NOT npm)

```bash
bun install -g $PKG
```

Remove any npm global install if it exists:
```bash
npm list -g $PKG 2>/dev/null | grep -q $PKG && npm uninstall -g $PKG && echo "Removed npm global install"
```

### 10. Verify via CLI

Get the CLI binary name from `package.json#bin`, then test it:
```bash
BIN=$(cat package.json | python3 -c "import sys,json; bins=json.load(sys.stdin).get('bin',{}); print(list(bins.keys())[0])" 2>/dev/null)
[ -n "$BIN" ] && $BIN --version || $BIN --help 2>&1 | head -3
echo "✓ $PKG published and verified"
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

### 12. Commit version bump

```bash
git add package.json
git commit -m "chore: bump version to $(cat package.json | python3 -c "import sys,json; print(json.load(sys.stdin)['version'])")"
git push origin main
```

## Rules

- NEVER `npm install -g` — always `bun install -g`
- NEVER publish without running tests first
- NEVER publish with secrets in diff
- NEVER publish without posting intent to `git-publishing` first (step 7)
- ALWAYS confirm in the intent thread after — published or aborted, no silent exits
- NEVER bump minor or major — patch only unless user explicitly says otherwise
- NEVER skip the CLI verification step
- If `hasna` org: Apache 2.0 + public + README required — no exceptions
- If `hasnaxyz` org: restricted access required
