#!/usr/bin/env bash
#
# build_oss_export.sh — produce a clean OSS copy of this repo at a temp dir.
#
# OSS = CLI + MCP + library + skills registry + minimal platform contract.
# Strips: dashboard, server, SaaS API routes, billing, db, runner, storage,
#         auth, aws, ci, upstream sync, internal web utils, all related tests,
#         and rewrites package.json for the @hasna/skills OSS package.
#
# Usage:
#   bash scripts/build_oss_export.sh [dest]
#
# Default dest: /tmp/oss-skills-export
#
# To push to GitHub after running this:
#   cd <dest>
#   git remote add origin https://github.com/hasna/skills.git
#   git checkout -b oss-sync
#   git add -A && git commit -m "sync: refresh OSS export"
#   git push origin oss-sync   # then PR/merge into main

set -euo pipefail

SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST_DIR="${1:-/tmp/oss-skills-export}"

echo "[oss-export] source: $SOURCE_DIR"
echo "[oss-export] dest:   $DEST_DIR"

rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"

# rsync everything tracked, exclude private dirs + heavy build outputs
rsync -a \
  --exclude=".git/" \
  --exclude="node_modules/" \
  --exclude="dist/" \
  --exclude="bin/" \
  --exclude=".next/" \
  --exclude=".turbo/" \
  --exclude="out/" \
  --exclude=".secrets/" \
  --exclude=".connect/" \
  --exclude="dashboard/" \
  --exclude="src/server/" \
  --exclude="src/platform/auth/" \
  --exclude="src/platform/aws/" \
  --exclude="src/platform/ci/" \
  --exclude="src/platform/db/" \
  --exclude="src/platform/runner/" \
  --exclude="src/platform/storage/" \
  --exclude="src/platform/upstream/" \
  --exclude="src/platform/web/" \
  --exclude="skills/*/node_modules/" \
  --exclude="skills/scaffold-project/my-app/" \
  "$SOURCE_DIR/" "$DEST_DIR/"

# Strip SaaS-only files from platform/api, keep only the OSS-needed contract + client.
keep_in_api=( "run-contract.ts" "client.ts" )
shopt -s extglob
pushd "$DEST_DIR/src/platform/api" >/dev/null
for f in *; do
  keep=0
  for k in "${keep_in_api[@]}"; do
    [[ "$f" == "$k" ]] && keep=1
  done
  [[ "$f" == "run-contract.test.ts" ]] && keep=1
  if [[ "$keep" -eq 0 ]]; then
    rm -f "$f"
  fi
done
popd >/dev/null

# Drop tests / artifacts that target stripped surface area or don't belong in OSS.
rm -rf \
  "$DEST_DIR/src/platform/web" \
  "$DEST_DIR/src/platform/upstream" \
  "$DEST_DIR/deploy" \
  "$DEST_DIR/drizzle" \
  "$DEST_DIR/drizzle.config.ts" \
  "$DEST_DIR/Dockerfile" \
  "$DEST_DIR/exports" \
  "$DEST_DIR/logs" \
  2>/dev/null || true
find "$DEST_DIR" -maxdepth 2 -name "*.tgz" -delete 2>/dev/null || true

# Tests specific to the private @hasnatools/platform-skills wrapper.
rm -f "$DEST_DIR/src/lib/package-naming-publishing-policy.test.ts" 2>/dev/null || true

# Patch source so it compiles without the SaaS layer.
# 1. discovery.ts: reroute SkillMeta type to the local registry-types module.
sed -i 's|from "../upstream/skills";|from "../../lib/registry-types.js";|' \
  "$DEST_DIR/src/platform/skills/discovery.ts"

# 2. runtime.ts: drop the `skills serve` subcommand (depends on stripped server).
python3 - "$DEST_DIR/src/cli/commands/runtime.ts" <<'PY'
import re, sys, pathlib
path = pathlib.Path(sys.argv[1])
src = path.read_text()
pattern = re.compile(
    r"  // Serve\n(?:  parent\n|  parent$)"  # anchor
    r"[\s\S]*?\}\);\n\n",
    re.MULTILINE,
)
new = pattern.sub("", src, count=1)
if new == src:
    sys.stderr.write(f"warning: did not remove 'serve' block from {path}\n")
path.write_text(new)
PY

# Rewrite package.json:
#   - name → @hasna/skills (OSS scope)
#   - drop server/dashboard scripts
#   - drop deps unique to the SaaS layer (drizzle, pg, stripe, resend, aws, etc.)
node --input-type=module -e "
import { readFileSync, writeFileSync } from 'node:fs';
const path = '$DEST_DIR/package.json';
const pkg = JSON.parse(readFileSync(path, 'utf8'));
pkg.name = '@hasna/skills';
pkg.repository = { type: 'git', url: 'git+https://github.com/hasna/skills.git' };
pkg.homepage = 'https://github.com/hasna/skills';
pkg.bugs = { url: 'https://github.com/hasna/skills/issues' };

const dropScripts = ['server','server:dev','dashboard:build','dashboard:dev','db:push','db:generate','db:test:migrations','aws:bootstrap:data','aws:bootstrap:ecr','aws:bootstrap:github-oidc'];
for (const k of dropScripts) delete pkg.scripts[k];

const dropDeps = [
  'drizzle-orm','drizzle-kit','pg','@types/pg',
  'stripe',
  'resend',
  '@aws-sdk/client-s3','@aws-sdk/client-ses','@aws-sdk/client-sts','@aws-sdk/credential-providers','@aws-sdk/s3-request-presigner',
  'jose',
  'next','next-themes','react','react-dom','@types/react','@types/react-dom',
];
for (const section of ['dependencies','devDependencies']) {
  if (!pkg[section]) continue;
  for (const k of dropDeps) delete pkg[section][k];
}

// Drop files entries that pointed to private dirs / dashboard.
if (Array.isArray(pkg.files)) {
  pkg.files = pkg.files.filter(f =>
    !f.includes('dashboard') &&
    !f.includes('src/server') &&
    !f.includes('src/platform/auth') &&
    !f.includes('src/platform/db') &&
    !f.includes('src/platform/runner') &&
    !f.includes('src/platform/storage')
  );
}

writeFileSync(path, JSON.stringify(pkg, null, 2) + '\n');
"

# Replace top-level README + CLAUDE.md with OSS-appropriate copy if a template exists.
# (kept as-is for now; user can curate later.)

# Initialize a fresh git history so the OSS push doesn't leak private commits.
cd "$DEST_DIR"
git init --quiet --initial-branch=main
git add -A
git -c user.email=oss@hasna.com -c user.name='hasna' commit -q -m 'chore: sync OSS skills (CLI + MCP + library)'

echo
echo "[oss-export] done."
echo "[oss-export] $DEST_DIR is a fresh git repo with one commit on main."
echo
echo "Next steps (not run automatically):"
echo "  cd $DEST_DIR"
echo "  git remote add origin https://github.com/hasna/skills.git"
echo "  git push --force origin main     # ⚠ destructive, replaces upstream main"
echo
echo "Or open a PR instead by pushing to a branch and creating one with gh."
