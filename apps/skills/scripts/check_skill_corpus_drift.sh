#!/usr/bin/env bash
set -euo pipefail
# Compatibility spelling for the repository content-boundary gate. A base ref
# no longer selects a skill corpus: the public software must have none.
if [[ "$#" -eq 2 && "$1" == "--base" ]]; then
  shift 2
fi
if [[ "$#" -ne 0 ]]; then
  echo "Usage: scripts/check_skill_corpus_drift.sh [--base <legacy-ref>]" >&2
  exit 2
fi
repo_root="$(git rev-parse --show-toplevel)"
exec bun "$repo_root/tooling/ci/check-skill-content.ts" --root "$repo_root"
