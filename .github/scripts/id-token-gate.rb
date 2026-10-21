# Fails unless the only id-token: write grant in the given workflow directory is the publish job of
# release-skills.yml, in environment npm-release-skills, gated on a push of an npm/skills/v* tag (SH-00015).
# npm publishes @hasna/skills through OIDC trusted publishing alone, so an id-token grant anywhere else could
# mint a publish token without the App-created release tag. Usage: ruby id-token-gate.rb <workflows-dir>
require "yaml"

dir = ARGV.fetch(0) { abort "usage: ruby id-token-gate.rb <workflows-dir>" }
files = Dir.glob(File.join(dir, "*.{yml,yaml}")).sort
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

def allowed_publish_job?(file, name, job)
  environment = job["environment"].is_a?(Hash) ? job["environment"]["name"] : job["environment"]
  condition = job["if"].to_s
  File.basename(file) == "release-skills.yml" && name == "publish" && environment == "npm-release-skills" &&
    condition.include?("github.event_name == 'push'") &&
    condition.include?("startsWith(github.ref, 'refs/tags/npm/skills/v')")
end

violations = []
files.each do |file|
  workflow = load_workflow(file)
  unless workflow.is_a?(Hash)
    violations << "#{File.basename(file)}: not a workflow mapping"
    next
  end
  violations << "#{File.basename(file)}: workflow-level permissions grant id-token" if grants_id_token?(workflow["permissions"])
  (workflow["jobs"] || {}).each do |name, job|
    next unless job.is_a?(Hash) && grants_id_token?(job["permissions"])
    next if allowed_publish_job?(file, name, job)
    violations << "#{File.basename(file)}: job #{name} grants id-token outside the release-tag publish job"
  end
end

if violations.empty?
  puts "id-token gate: #{files.length} workflow files, only the release-tag publish job may request an id-token"
else
  puts violations
  exit 1
end
