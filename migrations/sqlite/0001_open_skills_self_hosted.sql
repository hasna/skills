-- SQLite dialect of 0001_open_skills_self_hosted.
--
-- This is a hand-written parallel of migrations/postgres/0001_open_skills_self_hosted.sql,
-- not a translation produced at runtime. The two files MUST declare the same schema
-- *shape* - same tables, same column names, same primary keys, same NOT NULL columns,
-- same uniqueness constraints, same foreign keys, same status domain - because the
-- org-scoped data model is the OSS layer's and is not per-backend negotiable.
-- src/server/schema-parity.test.ts executes this file and compares the result against
-- the parsed Postgres DDL, so drift fails CI rather than surfacing as a cross-backend
-- behaviour difference in production.
--
-- Deliberate, shape-preserving dialect differences:
--   * pgcrypto is not created - no column defaults to a database-generated UUID; every
--     id is minted in TypeScript (runId()/artifactId()/randomUUID()) for both backends.
--   * timestamptz -> text holding a UTC ISO-8601 instant. strftime('...%fZ','now')
--     produces exactly the format Date#toISOString() emits, so values written by raw
--     SQL and values written by the store are byte-identical and sort lexicographically
--     in the same order timestamptz sorts chronologically.
--   * jsonb -> text holding JSON. The row mappers already accept either a parsed object
--     or a JSON string (parseJsonObject/parseJsonArray in store.ts), so one mapper
--     serves both backends.
--   * bigserial -> integer PRIMARY KEY AUTOINCREMENT, SQLite's monotonic surrogate key.

CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS organization_members (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'owner',
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, user_id)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  scopes_json text NOT NULL DEFAULT '["skills:read","runs:write"]',
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  last_used_at text,
  revoked_at text
);

CREATE TABLE IF NOT EXISTS skills_registry (
  slug text PRIMARY KEY,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Remote',
  tags_json text NOT NULL DEFAULT '[]',
  source text NOT NULL DEFAULT 'bundled',
  version text,
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS skills_runs (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  skill_slug text NOT NULL,
  requested_slug text NOT NULL,
  status text NOT NULL,
  input_json text NOT NULL DEFAULT '{}',
  args_json text NOT NULL DEFAULT '[]',
  idempotency_key text,
  correlation_id text NOT NULL,
  cost_cents integer NOT NULL DEFAULT 0,
  output_type text,
  output_preview text,
  error_code text,
  error_message text,
  locked_by text,
  locked_at text,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  started_at text,
  completed_at text,
  CHECK (status IN ('queued','waiting_for_approval','running','succeeded','failed','cancel_requested','cancelled','retrying','expired','refunded'))
);

CREATE UNIQUE INDEX IF NOT EXISTS skills_runs_org_idempotency_idx
  ON skills_runs (org_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS skills_runs_org_created_idx ON skills_runs (org_id, created_at DESC);
CREATE INDEX IF NOT EXISTS skills_runs_status_created_idx ON skills_runs (status, created_at ASC);

CREATE TABLE IF NOT EXISTS skills_run_logs (
  id integer PRIMARY KEY AUTOINCREMENT,
  run_id text NOT NULL REFERENCES skills_runs(id) ON DELETE CASCADE,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sequence integer NOT NULL,
  level text NOT NULL DEFAULT 'info',
  message text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
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
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS skills_artifacts_run_idx ON skills_artifacts (run_id);

CREATE TABLE IF NOT EXISTS skills_approvals (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text REFERENCES skills_runs(id) ON DELETE CASCADE,
  approved_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  policy_digest text NOT NULL,
  status text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  decided_at text,
  CHECK (status IN ('pending','approved','rejected','expired'))
);

CREATE TABLE IF NOT EXISTS skills_audit_events (
  id integer PRIMARY KEY AUTOINCREMENT,
  org_id text REFERENCES organizations(id) ON DELETE SET NULL,
  user_id text REFERENCES users(id) ON DELETE SET NULL,
  api_key_id text REFERENCES api_keys(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  metadata_json text NOT NULL DEFAULT '{}',
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
