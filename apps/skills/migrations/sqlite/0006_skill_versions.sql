-- Immutable skill versions (hasna/apps#1630). SQLite twin of migrations/postgres/0006.
CREATE TABLE IF NOT EXISTS skills_versions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  version text NOT NULL,
  bundle_sha256 text NOT NULL,
  bundle_byte_size integer NOT NULL,
  storage_kind text NOT NULL DEFAULT 'db',
  storage_key text,
  manifest_json text NOT NULL DEFAULT '{}',
  published_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (org_id, slug, version)
);

CREATE INDEX IF NOT EXISTS skills_versions_org_slug_created_idx ON skills_versions (org_id, slug, created_at DESC);
CREATE INDEX IF NOT EXISTS skills_versions_bundle_idx ON skills_versions (org_id, bundle_sha256);
