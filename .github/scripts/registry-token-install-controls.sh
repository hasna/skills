#!/usr/bin/env bash
# shellcheck disable=SC2016 # workflow expressions and $1/$2 are meant literally here
# Behaviour controls for the credential-isolated install step (SH-00052). The step's own run text is taken from
# skills-consumer-gate.yml (the gate proves every copy is byte-identical) and executed against a stub `bun` with a
# synthetic token, so no control needs the real secret or the network. Each case must end as stated:
# fail closed on an empty token, keep the token out of bun's environment, hand bun an auth line for the canonical
# registry only, remove the credential file on success and on failure, and refuse a tree that carries the token.
# Usage: bash .github/scripts/registry-token-install-controls.sh  (from the repository root)
set -euo pipefail
root="$(mktemp -d)"
step="$root/step.sh"
ruby -ryaml -e '
  w = YAML.load_file(ARGV[0])
  s = w["jobs"]["consumer-gate"]["steps"].find { |x| x["name"] == "Install locked standalone Skills dependencies (credential isolated)" }
  abort "install step not found" unless s
  File.write(ARGV[1], s["run"])
' .github/workflows/skills-consumer-gate.yml "$step"

mkdir -p "$root/bin"
# The stub records what the real bun would see, as booleans and a mode, never the value itself.
cat > "$root/bin/bun" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail
record="$STUB_RECORD"
{
  echo "called"
  if [ -n "${NODE_AUTH_TOKEN+x}" ]; then echo "token-in-env=yes"; else echo "token-in-env=no"; fi
  if [ -f "$HOME/.npmrc" ]; then
    echo "npmrc-mode=$(stat -c %a "$HOME/.npmrc" 2>/dev/null || stat -f %Lp "$HOME/.npmrc")"
    if grep -qxF "//registry.npmjs.org/:_authToken=$STUB_EXPECTED" "$HOME/.npmrc"; then echo "auth-line=canonical"; else echo "auth-line=missing"; fi
    echo "auth-lines=$(grep -c ':_authToken=' "$HOME/.npmrc")"
  else
    echo "npmrc=absent"
  fi
  echo "args=$*"
} > "$record"
printf '%s\n' "$HOME/.npmrc" > "$STUB_RECORD.path"
mkdir -p node_modules/pkg
case "$STUB_MODE" in
  ok) echo 'export const ok = true;' > node_modules/pkg/index.js ;;
  fail) exit 3 ;;
  leak) printf 'cached=%s\n' "$STUB_EXPECTED" > node_modules/pkg/leak.txt ;;
  npmrc) echo 'export const ok = true;' > node_modules/pkg/index.js; echo 'registry=https://registry.npmjs.org/' > node_modules/pkg/.npmrc ;;
  empty) ;;
esac
STUB
chmod 755 "$root/bin/bun"

failures=0
synthetic="synthetic-read-token-for-controls-only"
run_case() { # label mode token -> sets rc, out, record
  local label="$1" mode="$2" token="$3" work
  work="$(mktemp -d "$root/case.XXXXXX")"
  mkdir -p "$work/tmp" "$work/pkg"
  record="$work/record"
  rc=0
  out="$(cd "$work/pkg" && env -i PATH="$root/bin:/usr/bin:/bin" RUNNER_TEMP="$work/tmp" HOME="$work/home-unused" \
    STUB_RECORD="$record" STUB_MODE="$mode" STUB_EXPECTED="$synthetic" NODE_AUTH_TOKEN="$token" bash "$step" 2>&1)" || rc=$?
  case_label="$label"
}
expect() { # condition-description command...
  local what="$1"; shift
  if "$@"; then echo "control $case_label: $what"
  else echo "CONTROL $case_label FAILED: $what (rc=$rc output: $(head -c 300 <<< "$out"))"; failures=$((failures + 1)); fi
}
npmrc_removed() { [ -f "$record.path" ] && [ ! -e "$(cat "$record.path")" ]; }

run_case empty-token ok ""
expect "fails closed" test "$rc" -eq 1
expect "names the secret" grep -qF "::error::NPM_RELEASE_READ_TOKEN is empty or unset." <<< "$out"
expect "never calls bun" test ! -e "$record"

run_case install ok "$synthetic"
expect "succeeds" test "$rc" -eq 0
expect "keeps the token out of bun's environment" grep -qx "token-in-env=no" "$record"
expect "gives bun a private credential file" grep -qx "npmrc-mode=600" "$record"
expect "writes the canonical auth line only" grep -qx "auth-line=canonical" "$record"
expect "writes one auth line" grep -qx "auth-lines=1" "$record"
expect "pins the frozen lockfile and registry" grep -qF -- "--frozen-lockfile --ignore-scripts --backend copyfile --registry https://registry.npmjs.org/" "$record"
expect "removes the credential file on success" npmrc_removed
expect "reports the scan" grep -qF "no .npmrc, no token bytes" <<< "$out"
expect "never prints the token" bash -c '! grep -qF "$1" <<< "$2"' _ "$synthetic" "$out"

run_case failed-install fail "$synthetic"
expect "fails with bun's status" test "$rc" -eq 3
expect "removes the credential file on failure" npmrc_removed

run_case leaked-token leak "$synthetic"
expect "refuses a tree carrying the token" test "$rc" -eq 1
expect "says why" grep -qF "contain the registry token" <<< "$out"
expect "never prints the token" bash -c '! grep -qF "$1" <<< "$2"' _ "$synthetic" "$out"
expect "removes the credential file" npmrc_removed

run_case nested-npmrc npmrc "$synthetic"
expect "refuses a tree carrying an .npmrc" test "$rc" -eq 1
expect "says why" grep -qF "contains 1 .npmrc path(s)" <<< "$out"

run_case empty-tree empty "$synthetic"
expect "refuses an empty scan" test "$rc" -eq 1
expect "says why" grep -qF "scanned 0 files" <<< "$out"

[ "$failures" -eq 0 ] || { echo "$failures control(s) failed"; exit 1; }
echo "all install-step controls held"
