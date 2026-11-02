# Fails unless the read-only npm token NPM_RELEASE_READ_TOKEN reaches exactly the credential-isolated install
# steps and nothing else in the given workflow directory (SH-00052). @hasna/secrets is a restricted package, so a
# frozen install needs an authenticated registry read; this keeps that credential in one step per job, out of every
# job that can publish, and out of any step that could print it.
# Usage: ruby registry-token-gate.rb <workflows-dir>
require "yaml"

SECRET = "NPM_RELEASE_READ_TOKEN"
SECRET_REF = "secrets.#{SECRET}"
ALLOWED_VALUE = "${{ #{SECRET_REF} }}"
INSTALL_STEP = "Install locked standalone Skills dependencies (credential isolated)"
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

  allowed_sites = 0
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
      DUMP_PATTERNS.each { |what, pattern| violations << "#{label} runs #{what}" if run =~ pattern }
      env = step["env"].is_a?(Hash) ? step["env"] : {}
      is_install = step["name"] == INSTALL_STEP
      if run.include?("bun install") && !is_install
        violations << "#{label} runs bun install outside the credential-isolated install step"
      end
      if env.key?("NODE_AUTH_TOKEN") && !is_install
        violations << "#{label} defines NODE_AUTH_TOKEN outside the credential-isolated install step"
      end
      next unless is_install
      token_steps += 1
      install_bodies << [label, run]
      violations << "#{label} must be a run step, not an action" if step.key?("uses")
      violations << "#{label} must run in apps/skills" unless step["working-directory"] == "apps/skills"
      unless env == { "NODE_AUTH_TOKEN" => ALLOWED_VALUE }
        violations << "#{label} env must be exactly NODE_AUTH_TOKEN: #{ALLOWED_VALUE}"
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
    if steps.any? { |s| s.is_a?(Hash) && s["uses"].to_s.start_with?("actions/cache") }
      violations << "#{base}: job #{name} holds the read token and restores a cache"
    end
  end

  # Every reference to the secret, wherever it sits in the parsed workflow, must be an allowed env value.
  each_string(workflow, []) do |value, path|
    next unless value.include?(SECRET)
    allowed = path.length == 6 && path[0] == "jobs" && path[2] == "steps" && path[4] == "env" && path[5] == "NODE_AUTH_TOKEN" &&
      value == ALLOWED_VALUE && jobs.dig(path[1], "steps", path[3].to_i, "name") == INSTALL_STEP
    run_text = path.length == 5 && path[0] == "jobs" && path[2] == "steps" && path[4] == "run" && !value.include?(SECRET_REF)
    if allowed
      allowed_sites += 1
    elsif !run_text
      violations << "#{base}: #{SECRET} is referenced at #{path.join('.')}"
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
