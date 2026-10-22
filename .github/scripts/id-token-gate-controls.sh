#!/usr/bin/env bash
# Controls for id-token-gate.rb: the real workflows must pass, and every fixture and every mutant of
# release-skills.yml must be refused FOR ITS STATED REASON (a crash or an unrelated refusal fails the control).
# Usage: bash .github/scripts/id-token-gate-controls.sh  (from the repository root)
set -euo pipefail
gate=.github/scripts/id-token-gate.rb
ruby "$gate" .github/workflows > /dev/null || { echo "positive control: the real workflows were refused"; exit 1; }
echo "positive control: real workflows pass"
failures=0
check() { # label expected-reason dir
  local label="$1" reason="$2" dir="$3" out rc=0
  out="$(ruby "$gate" "$dir" 2>&1)" || rc=$?
  if [ "$rc" -eq 1 ] && grep -qF -- "$reason" <<< "$out"; then echo "control $label: refused ($reason)"
  else echo "CONTROL $label FAILED: rc=$rc output: $(head -c 300 <<< "$out")"; failures=$((failures + 1)); fi
}
fixture() { # label expected-reason yaml
  local dir; dir="$(mktemp -d)"; cp .github/workflows/*.yml "$dir/"; printf '%s\n' "$3" > "$dir/fixture.yml"; check "$1" "$2" "$dir"
}
mutant() { # label expected-reason ruby-substitution
  local dir; dir="$(mktemp -d)"; cp .github/workflows/*.yml "$dir/"
  ruby -e 'p, a, b = ARGV; s = File.read(p); abort("mutation did not apply: #{a}") unless s.include?(a); File.write(p, s.sub(a, b))' "$dir/release-skills.yml" "$3" "$4"
  check "$1" "$2" "$dir"
}
fixture job-grant "file is not release-skills.yml" $'on: workflow_dispatch\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n    steps:\n      - run: "true"'
fixture workflow-grant "workflow-level permissions grant id-token" $'on: push\npermissions:\n  id-token: write\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"'
fixture write-all "permissions grant write-all" $'on: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    permissions: write-all\n    steps:\n      - run: "true"'
fixture lookalike "file is not release-skills.yml" $'on: push\njobs:\n  publish:\n    if: github.repository == \'hasna/skills\' && github.event_name == \'push\' && startsWith(github.ref, \'refs/tags/npm/skills/v\')\n    environment: npm-publish-skills\n    runs-on: ubuntu-latest\n    permissions:\n      id-token: write\n    steps:\n      - run: "true"'
mutant retired-environment "environment is not npm-publish-skills" "environment: npm-publish-skills" "environment: npm-release-skills"
mutant no-push-clause "if is not the release-tag push condition" "github.event_name == 'push' && startsWith(github.ref" "startsWith(github.ref"
mutant no-tag-clause "if is not the release-tag push condition" " && startsWith(github.ref, 'refs/tags/npm/skills/v')" ""
mutant widened-if "if is not the release-tag push condition" "startsWith(github.ref, 'refs/tags/npm/skills/v')" "startsWith(github.ref, 'refs/tags/npm/skills/v') || github.event_name == 'workflow_dispatch'"
mutant renamed-job "job is not publish" $'\n  publish:\n' $'\n  publish2:\n'
[ "$failures" -eq 0 ] || { echo "$failures control(s) failed"; exit 1; }
echo "all controls refused for their stated reasons"
