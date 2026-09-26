-- Immutable skill versions (hasna/apps#1630).
--
-- skills_registry keeps ONE row per (org, slug): the current revision. Every re-publish
-- replaced it and purged the previous bundle, so there was no history. This table records
-- each published name@version once: the content-addressed bundle it points at, the file
-- manifest and provenance the client sent, and where the version-addressed copy lives.
--
-- Rows are never updated. A publish of an existing (org, slug, version) with a different
-- bundle digest is refused (409 SKILL_VERSION_EXISTS); the same digest is idempotent.
-- bundle_sha256 references skills_bundles(org_id, sha256) softly, like skills_registry
-- does; orphan collection must consult this table so a version's bundle outlives the
-- registry row that first published it.
CREATE TABLE IF NOT EXISTS skills_versions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  version text NOT NULL,
  bundle_sha256 text NOT NULL,
  bundle_byte_size integer NOT NULL,
  -- 'db' when the bytes live in skills_bundles.body_blob, 's3' when a version-addressed
  -- object (<prefix>/skills/<org>/<slug>/<version>/bundle.tar.gz) was written.
  storage_kind text NOT NULL DEFAULT 'db',
  storage_key text,
  manifest_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, slug, version)
);

CREATE INDEX IF NOT EXISTS skills_versions_org_slug_created_idx ON skills_versions (org_id, slug, created_at DESC);
CREATE INDEX IF NOT EXISTS skills_versions_bundle_idx ON skills_versions (org_id, bundle_sha256);
