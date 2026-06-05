#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/check_upstream_sync.sh [options] [range]

Preflight a commit range before merging or publishing public hasna/skills work.

Arguments:
  range                         Git revision range to inspect.
                                Default: upstream/main..HEAD

Options:
  --strict-private-markers      Fail on private SaaS marker strings.
  -h, --help                    Show this help.

This script does not create branches and never uses git worktrees.
EOF
}

range="main..HEAD"
strict_private_markers=0

while (($# > 0)); do
  case "$1" in
    --strict-private-markers)
      strict_private_markers=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      range="$1"
      shift
      ;;
  esac
done

repo_root="$(git rev-parse --show-toplevel)"
cd "$repo_root"

origin_url="$(git remote get-url origin 2>/dev/null || true)"

if [[ -n "$origin_url" && "$origin_url" != *"hasna/skills"* ]]; then
  echo "origin should point at hasna/skills for public package work; got: ${origin_url}" >&2
  exit 1
fi

if ! git rev-parse --verify --quiet "${range%%..*}" >/dev/null; then
  echo "range base is not available locally: ${range%%..*}" >&2
  echo "Run: git fetch upstream origin" >&2
  exit 1
fi

mapfile -t changed_files < <(git diff --name-only "$range" --)

if ((${#changed_files[@]} == 0)); then
  echo "No files changed in range: $range"
  exit 0
fi

private_path_pattern='^(apps/|packages/database/|infra/|terraform/|cdk/|aws/|deploy/|src/platform/|platform/|\.github/workflows/(deploy|preview|production)|docker-compose\.prod\.yml)'
private_paths=()

for file in "${changed_files[@]}"; do
  if [[ "$file" =~ $private_path_pattern ]]; then
    private_paths+=("$file")
  fi
done

if ((${#private_paths[@]} > 0)); then
  echo "Private product paths must not be included in an upstream hasna/skills PR:" >&2
  printf '  %s\n' "${private_paths[@]}" >&2
  exit 1
fi

marker_pattern='(@hasna/cloud|@hasnatools/|src/platform|aws:bootstrap|preview-stripe|production-stripe|STRIPE_|tenant|billing|private cloud|preview deploy|production deploy)'
marker_hits=()

for file in "${changed_files[@]}"; do
  [[ -f "$file" ]] || continue
  if grep -EIn "$marker_pattern" "$file" >/tmp/upstream_sync_hits.$$ 2>/dev/null; then
    while IFS= read -r line; do
      marker_hits+=("$file:$line")
    done </tmp/upstream_sync_hits.$$
  fi
done
rm -f /tmp/upstream_sync_hits.$$

if ((${#marker_hits[@]} > 0)); then
  if ((strict_private_markers == 1)); then
    echo "Private marker strings found in upstream candidate files:" >&2
    printf '  %s\n' "${marker_hits[@]}" >&2
    exit 1
  fi

  echo "Warning: private marker strings found. Review before opening an upstream PR:" >&2
  printf '  %s\n' "${marker_hits[@]}" >&2
fi

echo "Upstream sync preflight passed for range: $range"
echo "Changed files: ${#changed_files[@]}"
