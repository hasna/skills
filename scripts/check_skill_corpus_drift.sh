#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/check_skill_corpus_drift.sh [--base <git-ref>]

Compares local skills/ directories and registry names with a git base ref.
Use --base upstream/main for upstream drift checks. Use --base HEAD for a
self-check in tests.
USAGE
}

base_ref="upstream/main"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base)
      base_ref="${2:-}"
      if [[ -z "$base_ref" ]]; then
        echo "Missing value for --base" >&2
        exit 2
      fi
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if ! git rev-parse --verify "${base_ref}^{commit}" >/dev/null 2>&1; then
  echo "Base ref not found: ${base_ref}" >&2
  exit 2
fi

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

local_dirs="$tmp_dir/local_dirs.txt"
base_dirs="$tmp_dir/base_dirs.txt"
registry_names="$tmp_dir/registry_names.txt"
registry_dirs="$tmp_dir/registry_dirs.txt"

find skills -maxdepth 1 -mindepth 1 -type d -printf '%f\n' \
  | sed 's/^skill-//' \
  | grep -v '^_' \
  | sort > "$local_dirs"
git ls-tree -d --name-only "${base_ref}:skills" \
  | sed 's/^skill-//' \
  | grep -v '^_' \
  | sort > "$base_dirs"

bun -e 'import { SKILLS } from "./src/lib/registry.ts"; for (const skill of [...SKILLS].sort((a, b) => a.name.localeCompare(b.name))) console.log(skill.name);' \
  > "$registry_names"
cp "$local_dirs" "$registry_dirs"

local_only="$(comm -23 "$local_dirs" "$base_dirs" || true)"
base_only="$(comm -13 "$local_dirs" "$base_dirs" || true)"
registry_missing_dirs="$(comm -23 "$registry_names" "$registry_dirs" || true)"
registry_orphans="$(comm -13 "$registry_names" "$registry_dirs" || true)"
duplicate_registry="$(sort "$registry_names" | uniq -d || true)"
base_commit="$(git rev-parse "${base_ref}^{commit}")"
head_commit="$(git rev-parse HEAD)"
is_self_check=0
if [[ "$base_commit" == "$head_commit" ]]; then
  is_self_check=1
fi

echo "Skill corpus drift check"
echo "  Base: ${base_ref}"
echo "  Local directories: $(wc -l < "$local_dirs" | tr -d ' ')"
echo "  Base directories: $(wc -l < "$base_dirs" | tr -d ' ')"
echo "  Registry skills: $(wc -l < "$registry_names" | tr -d ' ')"

failed=0

if [[ -n "$local_only" ]]; then
  echo
  echo "Local-only skill directories:"
  echo "$local_only"
  if [[ "$is_self_check" -eq 0 ]]; then
    failed=1
  fi
fi

if [[ -n "$base_only" ]]; then
  echo
  echo "Base-only skill directories:"
  echo "$base_only"
  if [[ "$is_self_check" -eq 0 ]]; then
    failed=1
  fi
fi

if [[ -n "$registry_missing_dirs" ]]; then
  echo
  echo "Registry entries missing local directories:"
  echo "$registry_missing_dirs"
  failed=1
fi

if [[ -n "$registry_orphans" ]]; then
  echo
  echo "Local skill directories missing registry entries:"
  echo "$registry_orphans"
  failed=1
fi

if [[ -n "$duplicate_registry" ]]; then
  echo
  echo "Duplicate registry names:"
  echo "$duplicate_registry"
  failed=1
fi

modified="$(git diff --name-status "$base_ref"..HEAD -- skills src/lib/registry.ts || true)"
if [[ -n "$modified" ]]; then
  echo
  echo "Tracked corpus/registry modifications against ${base_ref}:"
  echo "$modified"
fi

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi

echo
echo "No duplicate, missing, or orphaned skill definitions found."
