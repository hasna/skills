-- SQLite dialect of 0002_org_scoped_skill_registry.
--
-- Hand-written parallel of migrations/postgres/0002_org_scoped_skill_registry.sql. Read
-- that file for why the registry is org-scoped and why the table is dropped rather than
-- altered; the rationale is not repeated here, only the dialect differences are.
--
-- Deliberate, shape-preserving dialect differences (same set as 0001):
--   * timestamptz -> text holding a UTC ISO-8601 instant.
--   * jsonb       -> text holding JSON.
--   * bytea       -> blob. Both are "opaque bytes"; bun:sqlite round-trips a Uint8Array
--                    through a blob column and Bun's SQL client round-trips one through
--                    bytea, so the store hands the same Uint8Array to either backend.
DROP TABLE IF EXISTS skills_registry;

CREATE TABLE IF NOT EXISTS skills_bundles (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  byte_size integer NOT NULL,
  content_type text NOT NULL DEFAULT 'application/gzip',
  storage_kind text NOT NULL DEFAULT 'db',
  storage_key text,
  body_blob blob,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, sha256)
);

CREATE TABLE IF NOT EXISTS skills_registry (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Remote',
  tags_json text NOT NULL DEFAULT '[]',
  source text NOT NULL DEFAULT 'custom',
  kind text NOT NULL DEFAULT 'executable',
  version text,
  skill_md text,
  bundle_sha256 text,
  bundle_byte_size integer,
  published_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, slug),
  CHECK (kind IN ('executable','instruction'))
);

CREATE INDEX IF NOT EXISTS skills_registry_org_updated_idx ON skills_registry (org_id, updated_at DESC);
