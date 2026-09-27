CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organization_members (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes_json jsonb NOT NULL DEFAULT '["skills:read","runs:write"]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS skills_registry (
  slug text PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Remote',
  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'bundled',
  version text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS skills_runs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_slug text NOT NULL,
  requested_slug text NOT NULL,
  status text NOT NULL,
  input_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  args_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  idempotency_key text,
  correlation_id text NOT NULL,
  cost_cents integer NOT NULL DEFAULT 0,
  output_type text,
  output_preview text,
  error_code text,
  error_message text,
  locked_by text,
  locked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  CHECK (status IN ('queued','waiting_for_approval','running','succeeded','failed','cancel_requested','cancelled','retrying','expired','refunded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS skills_runs_org_idempotency_idx
  ON skills_runs (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS skills_runs_org_created_idx ON skills_runs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS skills_runs_status_created_idx ON skills_runs (status, created_at ASC);

CREATE TABLE IF NOT EXISTS skills_run_logs (
  id bigserial PRIMARY KEY,
  run_id text NOT NULL REFERENCES skills_runs(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (run_id, sequence)
);

CREATE TABLE IF NOT EXISTS skills_artifacts (
  id text PRIMARY KEY,
  run_id text NOT NULL REFERENCES skills_runs(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  relative_path text NOT NULL,
  content_type text NOT NULL,
  byte_size integer NOT NULL,
  sha256 text NOT NULL,
  storage_kind text NOT NULL DEFAULT 'db',
  storage_key text,
  body_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS skills_artifacts_run_idx ON skills_artifacts (run_id);

CREATE TABLE IF NOT EXISTS skills_approvals (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text REFERENCES skills_runs(id) ON DELETE CASCADE,
  approved_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  policy_digest text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  CHECK (status IN ('pending','approved','rejected','expired'))
);

CREATE TABLE IF NOT EXISTS skills_audit_events (
  id bigserial PRIMARY KEY,
  org_id text REFERENCES organizations(id) ON DELETE SET NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  api_key_id text REFERENCES api_keys(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
