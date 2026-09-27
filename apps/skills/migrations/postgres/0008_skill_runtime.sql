CREATE TABLE IF NOT EXISTS skills_runtime_jobs (
  run_id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  skill_id TEXT NOT NULL,
  skill_version TEXT NOT NULL,
  bundle_digest TEXT NOT NULL,
  input_digest TEXT NOT NULL,
  status TEXT NOT NULL,
  payload TEXT NOT NULL,
  UNIQUE(tenant_id, idempotency_key)
);
CREATE INDEX IF NOT EXISTS skills_runtime_jobs_digests ON skills_runtime_jobs(tenant_id, skill_id, skill_version, bundle_digest, input_digest);
CREATE INDEX IF NOT EXISTS skills_runtime_jobs_active ON skills_runtime_jobs(tenant_id, status);
