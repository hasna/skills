# Fails unless the only id-token: write grant in the given workflow directory is the publish job of
# release-skills.yml, in environment npm-publish-skills, gated exactly on a push of an npm/skills/v* tag (SH-00015).
# npm publishes @hasna/skills through OIDC trusted publishing alone, so an id-token grant anywhere else could
# mint a publish token without the App-created release tag. Usage: ruby id-token-gate.rb <workflows-dir>
require "yaml"

ALLOWED_FILE = "release-skills.yml"
ALLOWED_JOB = "publish"
ALLOWED_ENVIRONMENT = "npm-publish-skills"
ALLOWED_IF = "github.repository == 'hasna/skills' && github.event_name == 'push' && startsWith(github.ref, 'refs/tags/npm/skills/v')"

dir = ARGV.fetch(0) { abort "usage: ruby id-token-gate.rb <workflows-dir>" }
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

def environment_name(job)
  job["environment"].is_a?(Hash) ? job["environment"]["name"] : job["environment"]
end

violations = []
files.each do |file|
  base = File.basename(file)
  workflow = load_workflow(file)
  unless workflow.is_a?(Hash)
    violations << "#{base}: not a workflow mapping"
    next
  end
  violations << "#{base}: workflow-level permissions grant id-token" if grants_id_token?(workflow["permissions"])
  (workflow["jobs"] || {}).each do |name, job|
    next unless job.is_a?(Hash) && grants_id_token?(job["permissions"])
    reasons = []
    reasons << "file is not #{ALLOWED_FILE}" unless base == ALLOWED_FILE
    reasons << "job is not #{ALLOWED_JOB}" unless name == ALLOWED_JOB
    reasons << "environment is not #{ALLOWED_ENVIRONMENT}" unless environment_name(job) == ALLOWED_ENVIRONMENT
    reasons << "if is not the release-tag push condition" unless job["if"].to_s.strip == ALLOWED_IF
    reasons << "permissions grant write-all" if job["permissions"] == "write-all"
    next if reasons.empty?
    violations << "#{base}: job #{name} grants id-token (#{reasons.join('; ')})"
  end
end

if violations.empty?
  puts "id-token gate: #{files.length} workflow files, only the release-tag publish job may request an id-token"
else
  puts violations
  exit 1
end
