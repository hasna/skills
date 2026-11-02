#!/usr/bin/env bash
# shellcheck disable=SC2016 # workflow expressions and $1/$2 are meant literally here
# Controls for registry-token-gate.rb (SH-00052): the real workflows must pass, and every fixture and every mutant
# must be refused FOR ITS STATED REASON (a crash or an unrelated refusal fails the control). No control needs the
# real token: the gate reads workflow files only.
# Usage: bash .github/scripts/registry-token-gate-controls.sh  (from the repository root)
set -euo pipefail
gate=.github/scripts/registry-token-gate.rb
ruby "$gate" .github/workflows > /dev/null || { echo "positive control: the real workflows were refused"; exit 1; }
echo "positive control: real workflows pass"
failures=0
check() { # label expected-reason dir
  local label="$1" reason="$2" dir="$3" out rc=0
  out="$(ruby "$gate" "$dir" 2>&1)" || rc=$?
  if [ "$rc" -eq 1 ] && grep -qF -- "$reason" <<< "$out"; then echo "control $label: refused ($reason)"
  else echo "CONTROL $label FAILED: rc=$rc output: $(head -c 400 <<< "$out")"; failures=$((failures + 1)); fi
}
fixture() { # label expected-reason yaml
  local dir; dir="$(mktemp -d)"; cp .github/workflows/*.yml "$dir/"; printf '%s\n' "$3" > "$dir/fixture.yml"; check "$1" "$2" "$dir"
}
mutant() { # label expected-reason workflow-file search replacement
  local dir; dir="$(mktemp -d)"; cp .github/workflows/*.yml "$dir/"
  ruby -e 'p, a, b = ARGV; s = File.read(p); abort("mutation did not apply: #{a}") unless s.include?(a); File.write(p, s.sub(a, b))' "$dir/$3" "$4" "$5"
  check "$1" "$2" "$dir"
}
token_line='NODE_AUTH_TOKEN: ${{ secrets.NPM_RELEASE_READ_TOKEN }}'
rel=release-skills.yml
gate_file=skills-consumer-gate.yml

# The publish path never receives the token: not in its publish step, not in a shared job env, not through an
# install in the publish job, and the build job that holds it never gains publish powers.
mutant publish-step "defines NODE_AUTH_TOKEN outside the credential-isolated install step" "$rel" \
  $'          REVIEWED_ARCHIVE: ${{ steps.archive.outputs.archive }}\n          REVIEW_RECEIPT:' \
  $'          '"$token_line"$'\n          REVIEWED_ARCHIVE: ${{ steps.archive.outputs.archive }}\n          REVIEW_RECEIPT:'
mutant shared-job-env "env defines NODE_AUTH_TOKEN" "$rel" \
  $'    env: &release-env\n' $'    env: &release-env\n      '"$token_line"$'\n'
mutant publish-install "runs bun install outside the credential-isolated install step" "$rel" \
  $'      - name: Bind the archive to the review receipt and the release tag\'s Packed-SHA256\n' \
  $'      - name: Install in the publish job\n        working-directory: apps/skills\n        run: bun install --frozen-lockfile --ignore-scripts --backend copyfile\n\n      - name: Bind the archive to the review receipt and the release tag\'s Packed-SHA256\n'
build_job=$'    timeout-minutes: 60\n    permissions:\n      contents: read\n    env: &release-env\n'
mutant build-id-token "holds the read token and an id-token grant" "$rel" \
  "$build_job" $'    timeout-minutes: 60\n    permissions:\n      contents: read\n      id-token: write\n    env: &release-env\n'
mutant build-environment "holds the read token inside an environment" "$rel" \
  "$build_job" $'    timeout-minutes: 60\n    environment: npm-publish-skills\n    permissions:\n      contents: read\n    env: &release-env\n'
mutant build-write-permission "holds the read token without read-only permissions" "$rel" \
  "$build_job" $'    timeout-minutes: 60\n    permissions:\n      contents: write\n    env: &release-env\n'

# Nothing that crosses jobs holds an installed tree, and the token job runs nothing resolved outside the lockfile.
mutant build-uploads-tree "token job build uploads a path other than the packed archive and its hash" "$rel" \
  $'            ${{ runner.temp }}/skills-packed/packed.sha256\n' \
  $'            ${{ runner.temp }}/skills-packed/packed.sha256\n            ${{ runner.temp }}/skills-installed/node-modules.tar\n'
mutant build-uploads-report "token job build uploads a path other than the packed archive and its hash" "$gate_file" \
  $'      - name: Retain only the packed archive and its hash\n' \
  $'      - name: Retain the test log\n        uses: actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02 # v4.6.2\n        with:\n          name: test-log\n          path: ${{ runner.temp }}/test.log\n\n      - name: Retain only the packed archive and its hash\n'
mutant consumer-uploads-tree "uploads node_modules" "$gate_file" \
  $'          path: ${{ runner.temp }}/skills-consumer-gate/summary.jsonl\n' \
  $'          path: |\n            ${{ runner.temp }}/skills-consumer-gate/summary.jsonl\n            apps/skills/node_modules\n'
mutant floating-in-token-job "token job build resolves packages outside the lockfile: verify:consumer-types" "$gate_file" \
  $'      - name: Typecheck\n' $'      - name: Consumer types in the token job\n        working-directory: apps/skills\n        run: bun run verify:consumer-types\n\n      - name: Typecheck\n'
mutant prepack-in-token-job "token job build resolves packages outside the lockfile: prepack" "$rel" \
  $'          bun run verify:generated\n          bun run verify:release\n' $'          bun run prepack\n'
mutant npx-in-token-job "token job build resolves packages outside the lockfile: npx" "$gate_file" \
  $'        run: bun run typecheck\n' $'        run: npx tsc --noEmit\n'
mutant secret-in-consumer "a secret is referenced at jobs.consumer" "$gate_file" \
  $'          BUILT_COMMIT: ${{ needs.build.outputs.commit }}\n' $'          BUILT_COMMIT: ${{ needs.build.outputs.commit }}\n          GH_PAT: ${{ secrets.GH_PAT }}\n'
mutant setup-node-cache "setup-node must not cache a package manager store" "$gate_file" \
  $'          package-manager-cache: false\n' $'          package-manager-cache: false\n          cache: npm\n'
mutant setup-node-autocache "setup-node must set package-manager-cache: false" "$rel" \
  $'          package-manager-cache: false\n' ''
mutant setup-bun-cache "setup-bun must set no-cache: true" "$gate_file" \
  $'          no-cache: true\n' $'          no-cache: false\n'
fixture cache-node-modules "caches node_modules or bun's install cache" $'on: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/cache@v4\n        with:\n          path: apps/skills/node_modules\n          key: tree'
fixture cache-bun-install "caches node_modules or bun's install cache" $'on: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/cache/save@v4\n        with:\n          path: ~/.bun/install/cache\n          key: bun'

# The install step keeps every property that makes it safe to hold the token.
mutant no-empty-check "lost the error that names the secret" "$gate_file" \
  'echo "::error::NPM_RELEASE_READ_TOKEN is empty or unset.' 'echo "::warning::NPM_RELEASE_READ_TOKEN is empty or unset.'
mutant no-env-unset "lost the token kept out of bun's environment" "$gate_file" \
  'env -u NODE_AUTH_TOKEN bun install' 'bun install'
mutant no-trap "lost the credential file removal on exit" "$gate_file" \
  $'          trap \'rm -f "$cred_home/.npmrc"\' EXIT\n' ''
mutant other-auth-host "lost the auth line for the canonical registry only" "$gate_file" \
  '//registry.npmjs.org/:_authToken=%s' '//registry.example.invalid/:_authToken=%s'
mutant tracing "runs set -x tracing" "$gate_file" \
  $'          set -euo pipefail\n          # The one step' $'          set -euxo pipefail\n          # The one step'
mutant renamed-step "defines NODE_AUTH_TOKEN outside the credential-isolated install step" "$gate_file" \
  '- name: Install locked standalone Skills dependencies (credential isolated)' '- name: Install dependencies'
mutant drifted-copy "the credential-isolated install steps differ" "$gate_file" \
  'cache_dir="$(mktemp -d "${RUNNER_TEMP%/}/bun-install-cache.XXXXXX")"' 'cache_dir="$(mktemp -d "${RUNNER_TEMP%/}/bun-cache.XXXXXX")"'
mutant later-step "defines NODE_AUTH_TOKEN outside the credential-isolated install step" "$gate_file" \
  $'      - name: Typecheck\n        working-directory: apps/skills\n' $'      - name: Typecheck\n        working-directory: apps/skills\n        env:\n          '"$token_line"$'\n'

mutant github-env-export "run text differs from its pinned sha256" "$gate_file" \
  $'          chmod 600 "$cred_home/.npmrc"\n' $'          chmod 600 "$cred_home/.npmrc"\n          echo "LEAK=$NODE_AUTH_TOKEN" >> "$GITHUB_ENV"\n'
mutant github-env-export-both "writes a runner file that later steps read" "$gate_file" \
  $'          chmod 600 "$cred_home/.npmrc"\n' $'          chmod 600 "$cred_home/.npmrc"\n          echo "LEAK=$NODE_AUTH_TOKEN" >> "$GITHUB_ENV"\n'

# Nothing else in any workflow may reach the secret or print an environment.
fixture job-env "job sneak env defines NODE_AUTH_TOKEN" $'on: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    env:\n      '"$token_line"$'\n    steps:\n      - run: "true"'
fixture workflow-env "workflow-level env defines NODE_AUTH_TOKEN" $'on: push\nenv:\n  '"$token_line"$'\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"'
fixture action-input "NPM_RELEASE_READ_TOKEN is referenced at jobs.sneak.steps.0.with.token" $'on: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/setup-node@820762786026740c76f36085b0efc47a31fe5020\n        with:\n          token: ${{ secrets.NPM_RELEASE_READ_TOKEN }}'
fixture other-variable "NPM_RELEASE_READ_TOKEN is referenced at jobs.sneak.steps.0.env.NPM_TOKEN" $'on: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"\n        env:\n          NPM_TOKEN: ${{ secrets.NPM_RELEASE_READ_TOKEN }}'
fixture inline-run "textual references to secrets.NPM_RELEASE_READ_TOKEN" $'on: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "${{ secrets.NPM_RELEASE_READ_TOKEN }}" > /dev/null'
fixture whole-secrets "reads the whole secrets context" $'on: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo "$ALL" > /dev/null\n        env:\n          ALL: ${{ toJSON(secrets) }}'
fixture printenv "runs printenv" $'on: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: printenv | sort'
fixture bare-env "runs a bare env listing" $'on: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: |\n          env | sort'
fixture comment-ref "textual references to secrets.NPM_RELEASE_READ_TOKEN" $'# secrets.NPM_RELEASE_READ_TOKEN\non: push\njobs:\n  sneak:\n    runs-on: ubuntu-latest\n    steps:\n      - run: "true"'
fixture publish-name "holds the read token and the publish name" "$(ruby -e 'require "yaml"; w = YAML.load_file(".github/workflows/skills-consumer-gate.yml"); j = w["jobs"]["build"]; s = j["steps"].find { |x| x["name"].to_s.include?("credential isolated") }; puts({ "on" => "push", "permissions" => { "contents" => "read" }, "jobs" => { "publish" => { "runs-on" => "ubuntu-latest", "steps" => [s] } } }.to_yaml)')"
fixture cached-install "holds the read token and restores a cache" "$(ruby -e 'require "yaml"; w = YAML.load_file(".github/workflows/skills-consumer-gate.yml"); j = w["jobs"]["build"]; s = j["steps"].find { |x| x["name"].to_s.include?("credential isolated") }; puts({ "on" => "push", "permissions" => { "contents" => "read" }, "jobs" => { "cached" => { "runs-on" => "ubuntu-latest", "steps" => [{ "uses" => "actions/cache@v4" }, s] } } }.to_yaml)')"
[ "$failures" -eq 0 ] || { echo "$failures control(s) failed"; exit 1; }
echo "all controls refused for their stated reasons"
