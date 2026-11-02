# Fails unless the read-only npm token NPM_RELEASE_READ_TOKEN reaches exactly the credential-isolated install
# steps and nothing else in the given workflow directory (SH-00052). @hasna/secrets is a restricted package, so a
# frozen install needs an authenticated registry read. This repository is public, and the runner holds every secret
# a job references for the whole job, so the gate also keeps that job free of code resolved outside the lockfile,
# and keeps every installed tree out of artifacts and caches.
# Usage: ruby registry-token-gate.rb <workflows-dir>
require "yaml"
require "digest"

SECRET = "NPM_RELEASE_READ_TOKEN"
SECRET_REF = "secrets.#{SECRET}"
ALLOWED_VALUE = "${{ #{SECRET_REF} }}"
INSTALL_STEP = "Install locked standalone Skills dependencies (credential isolated)"
# The install step's run text, pinned byte for byte (review N1, as hasna/apps #3672 does). A change to the step is
# a change to this constant, made in the same reviewed commit; nothing else may alter what the token step runs.
INSTALL_RUN_SHA256 = "eab9e9b1dd9185b51154717bedd7ed4b9076d2c71e5926e06e6e20be3eb70eef"
# The only paths a job holding the token may upload: the packed tarball, its sha256 and the release-review receipt.
TOKEN_JOB_UPLOADS = [
  "${{ runner.temp }}/skills-packed/*.tgz",
  "${{ runner.temp }}/skills-packed/packed.sha256",
  "${{ runner.temp }}/skills-packed/release-review.json",
  "${{ runner.temp }}/skills-gate-archive/*.tgz",
  "${{ runner.temp }}/skills-gate-archive/packed.sha256",
].freeze
# Commands that resolve packages outside the lockfile. None may run in a job that holds the token.
FLOATING_PATTERNS = {
  "verify:consumer-types" => /verify:consumer-types/,
  "verify:consumer-mcp" => /verify:consumer-mcp/,
  "prepack (runs verify:consumer-types)" => /\bbun\s+run\s+prepack\b|\bnpm\s+run\s+prepack\b/,
  "the candidate retention (runs verify:consumer-types)" => /retain-candidate-archive/,
  "npx" => /\bnpx\b/,
  "bunx" => /\bbunx\b/,
  "bun add or bun x" => /\bbun\s+(add|x)\b/,
  "an npm install other than an exact npm toolchain" => /\bnpm\s+(install|i|ci|exec|update|add)\b(?!\s+--global\s+--prefix\s+"\$npm_prefix"\s+npm@\d+\.\d+\.\d+$)/,
}.freeze
PUBLISH_ENVIRONMENT = "npm-publish-skills"
# Shell forms that print a whole environment or trace every command, in any step of any workflow.
DUMP_PATTERNS = {
  "printenv" => /\bprintenv\b/,
  "a bare env listing" => /(^|[;&|(]\s*)env\s*($|[|>;&)])/,
  "set -x tracing" => /\bset\s+-[a-wyzA-Z]*x/,
  "set -o xtrace" => /\bset\s+-o\s+xtrace\b/,
  "export -p" => /\bexport\s+-p\b/,
  "declare -p" => /\bdeclare\s+-[a-zA-Z]*p\b/,
}.freeze
# The install step must keep each of these exactly; each one is a reason the step is safe to hold the token.
REQUIRED_IN_INSTALL = {
  "strict mode" => "set -euo pipefail",
  "the fail-closed empty check" => "if [ -z \"${NODE_AUTH_TOKEN:-}\" ]; then",
  "the error that names the secret" => "echo \"::error::#{SECRET} is empty or unset.",
  "the credential file removal on exit" => "trap 'rm -f \"$cred_home/.npmrc\"' EXIT",
  "a private umask" => "umask 077",
  "a throwaway HOME for the credential" => "HOME=\"$cred_home\"",
  "the token kept out of bun's environment" => "env -u NODE_AUTH_TOKEN bun install --frozen-lockfile --ignore-scripts",
  "the pinned registry" => "--registry https://registry.npmjs.org/",
  "the auth line for the canonical registry only" => "printf '//registry.npmjs.org/:_authToken=%s\\n' \"$NODE_AUTH_TOKEN\"",
  "the post-install token scan" => "python3 -I - <<'PYEOF'",
}.freeze
CACHED_TREE = %r{node_modules|\.bun|bun-install|install/cache|BUN_INSTALL_CACHE}

dir = ARGV.fetch(0) { abort "usage: ruby registry-token-gate.rb <workflows-dir>" }
abort "not a directory: #{dir}" unless File.directory?(dir)
files = Dir.glob(File.join(dir, "*.{yml,yaml}"), File::FNM_DOTMATCH).reject { |f| File.basename(f).start_with?("..") }.sort
abort "no workflow files under #{dir}" if files.empty?

def load_workflow(path)
  YAML.load_file(path, aliases: true)
rescue ArgumentError
  YAML.load_file(path) # Psych 3 resolves aliases by default
end

def grants_id_token?(permissions)
  return true if permissions == "write-all"
  permissions.is_a?(Hash) && permissions["id-token"].to_s == "write"
end

def read_only?(permissions)
  permissions.is_a?(Hash) && permissions == { "contents" => "read" }
end

def environment_name(job)
  job["environment"].is_a?(Hash) ? job["environment"]["name"] : job["environment"]
end

# A secret reference is an expression: inside ${{ }}, or anywhere in an `if:`, which is an expression already.
def secret_reference?(value, path)
  value =~ /\$\{\{[^}]*\bsecrets\s*\./ || (path.last == "if" && value =~ /\bsecrets\s*\./)
end

def upload_paths(step)
  step.dig("with", "path").to_s.split("\n").map(&:strip).reject(&:empty?)
end

# Every string in a parsed node, with its path, so a reference anywhere (with:, if:, outputs:, services:) is seen.
def each_string(node, path, &block)
  case node
  when Hash then node.each { |k, v| each_string(k, path + ["(key)"], &block); each_string(v, path + [k.to_s], &block) }
  when Array then node.each_with_index { |v, i| each_string(v, path + [i.to_s], &block) }
  when String then yield node, path
  end
end

violations = []
install_bodies = []
files.each do |file|
  base = File.basename(file)
  raw = File.read(file)
  workflow = load_workflow(file)
  unless workflow.is_a?(Hash)
    violations << "#{base}: not a workflow mapping"
    next
  end
  violations << "#{base}: reads the whole secrets context" if raw =~ /toJSON\(\s*secrets\s*\)|secrets\s*\[/
  violations << "#{base}: dumps the whole env context" if raw =~ /toJSON\(\s*env\s*\)/
  if workflow["env"].is_a?(Hash) && workflow["env"].key?("NODE_AUTH_TOKEN")
    violations << "#{base}: workflow-level env defines NODE_AUTH_TOKEN"
  end

  jobs = workflow["jobs"].is_a?(Hash) ? workflow["jobs"] : {}
  jobs.each do |name, job|
    next unless job.is_a?(Hash)
    if job["env"].is_a?(Hash) && job["env"].key?("NODE_AUTH_TOKEN")
      violations << "#{base}: job #{name} env defines NODE_AUTH_TOKEN"
    end
    steps = job["steps"].is_a?(Array) ? job["steps"] : []
    token_steps = 0
    steps.each_with_index do |step, index|
      next unless step.is_a?(Hash)
      label = "#{base}: job #{name} step #{index + 1} (#{step['name'] || step['uses'] || 'unnamed'})"
      run = step["run"].to_s
      uses = step["uses"].to_s
      DUMP_PATTERNS.each { |what, pattern| violations << "#{label} runs #{what}" if run =~ pattern }
      env = step["env"].is_a?(Hash) ? step["env"] : {}
      is_install = step["name"] == INSTALL_STEP
      if run.include?("bun install") && !is_install
        violations << "#{label} runs bun install outside the credential-isolated install step"
      end
      if env.key?("NODE_AUTH_TOKEN") && !is_install
        violations << "#{label} defines NODE_AUTH_TOKEN outside the credential-isolated install step"
      end
      # No installed tree crosses a job or a run: not as an artifact, and not through a cache that a fork's
      # pull request run can restore.
      if uses.start_with?("actions/upload-artifact") && upload_paths(step).any? { |p| p.include?("node_modules") }
        violations << "#{label} uploads node_modules"
      end
      if uses.start_with?("actions/cache") && step.dig("with", "path").to_s =~ CACHED_TREE
        violations << "#{label} caches node_modules or bun's install cache"
      end
      if uses.start_with?("actions/setup-node")
        violations << "#{label} setup-node must not cache a package manager store" if step.dig("with", "cache").to_s != ""
        violations << "#{label} setup-node must set package-manager-cache: false" unless step.dig("with", "package-manager-cache") == false
      end
      if uses.start_with?("oven-sh/setup-bun") && step.dig("with", "no-cache") != true
        violations << "#{label} setup-bun must set no-cache: true"
      end
      next unless is_install
      token_steps += 1
      install_bodies << [label, run]
      violations << "#{label} must be a run step, not an action" if step.key?("uses")
      violations << "#{label} must run in apps/skills" unless step["working-directory"] == "apps/skills"
      unless env == { "NODE_AUTH_TOKEN" => ALLOWED_VALUE }
        violations << "#{label} env must be exactly NODE_AUTH_TOKEN: #{ALLOWED_VALUE}"
      end
      unless Digest::SHA256.hexdigest(run) == INSTALL_RUN_SHA256
        violations << "#{label} run text differs from its pinned sha256 (#{Digest::SHA256.hexdigest(run)[0, 12]}...)"
      end
      if run =~ /GITHUB_(ENV|OUTPUT|PATH|STEP_SUMMARY|STATE)/
        violations << "#{label} writes a runner file that later steps read"
      end
      REQUIRED_IN_INSTALL.each { |what, text| violations << "#{label} lost #{what}" unless run.include?(text) }
      violations << "#{label} must install exactly once" unless run.scan("bun install").length == 1
      violations << "#{label} names the auth host more than once" unless run.scan(":_authToken=").length == 1
    end
    next if token_steps.zero?
    violations << "#{base}: job #{name} holds the read token in #{token_steps} steps" if token_steps > 1
    violations << "#{base}: job #{name} holds the read token and the publish name" if name == "publish"
    violations << "#{base}: job #{name} holds the read token and an id-token grant" if grants_id_token?(job["permissions"]) || grants_id_token?(workflow["permissions"])
    violations << "#{base}: job #{name} holds the read token inside an environment" unless environment_name(job).nil?
    effective = job.key?("permissions") ? job["permissions"] : workflow["permissions"]
    violations << "#{base}: job #{name} holds the read token without read-only permissions" unless read_only?(effective)
    steps.each_with_index do |step, index|
      next unless step.is_a?(Hash)
      label = "#{base}: job #{name} step #{index + 1} (#{step['name'] || step['uses'] || 'unnamed'})"
      uses = step["uses"].to_s
      violations << "#{base}: job #{name} holds the read token and restores a cache" if uses.start_with?("actions/cache")
      if uses.start_with?("actions/upload-") && !uses.start_with?("actions/upload-artifact@")
        violations << "#{label} token job #{name} publishes an upload other than an artifact"
      end
      if uses.start_with?("actions/upload-artifact@")
        paths = upload_paths(step)
        if paths.empty? || paths.any? { |p| !TOKEN_JOB_UPLOADS.include?(p) }
          violations << "#{label} token job #{name} uploads a path other than the packed archive and its hash"
        end
      end
      run = step["run"].to_s
      FLOATING_PATTERNS.each do |what, pattern|
        violations << "#{label} token job #{name} resolves packages outside the lockfile: #{what}" if run =~ pattern
      end
    end
  end

  # Every secret reference, wherever it sits in the parsed workflow, must be the token in an install step's env.
  # Every other job, the consumer jobs included, references no secret at all.
  allowed_sites = 0
  each_string(workflow, []) do |value, path|
    next unless value.include?(SECRET) || secret_reference?(value, path)
    allowed = path.length == 6 && path[0] == "jobs" && path[2] == "steps" && path[4] == "env" && path[5] == "NODE_AUTH_TOKEN" &&
      value == ALLOWED_VALUE && jobs.dig(path[1], "steps", path[3].to_i, "name") == INSTALL_STEP
    run_text = path.length == 5 && path[0] == "jobs" && path[2] == "steps" && path[4] == "run" && !secret_reference?(value, path)
    if allowed
      allowed_sites += 1
    elsif !run_text
      what = value.include?(SECRET) ? SECRET : "a secret"
      violations << "#{base}: #{what} is referenced at #{path.join('.')}"
    end
  end
  # A reference the parser does not see as a value (a comment, a key, an anchor the walk counted once) still counts.
  raw_refs = raw.scan(/secrets\s*\.\s*#{SECRET}/).length
  textual_sites = raw.scan(/^\s*NODE_AUTH_TOKEN: \$\{\{ #{Regexp.escape(SECRET_REF)} \}\}\s*$/).length
  violations << "#{base}: #{raw_refs} textual references to #{SECRET_REF}, #{textual_sites} in an allowed env line" if raw_refs != textual_sites
end

if install_bodies.empty?
  violations << "no credential-isolated install step found; the gate has nothing to check"
elsif install_bodies.map(&:last).uniq.length != 1
  violations << "the credential-isolated install steps differ: #{install_bodies.map(&:first).join(', ')}"
end

if violations.empty?
  puts "registry-token gate: #{files.length} workflow files, #{install_bodies.length} credential-isolated install steps, the read token reaches nothing else"
else
  puts violations.uniq
  exit 1
end
