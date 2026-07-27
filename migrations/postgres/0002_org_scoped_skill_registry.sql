-- Org-scope the skill registry and give it content-addressed bundle storage.
--
-- 0001 declared skills_registry with `slug` as its whole primary key, no org_id, and no
-- reference to any stored content. Nothing in src/ ever read or wrote it. Publishing
-- makes it real, and a published skill is tenant data: two organizations on one instance
-- must both be able to publish `deploy-notes` without colliding, and neither may read the
-- other's. That makes the primary key (org_id, slug).
--
-- The table is DROPPED and recreated rather than altered. A primary key cannot be
-- redefined by ALTER TABLE in SQLite at all, and the two dialect files must declare the
-- same shape, so an ALTER-based Postgres migration and a rebuild-based SQLite one would
-- diverge in exactly the way the parallel set exists to prevent.
--
-- Dropping is safe only because the table has never had a writer - `grep -rn
-- skills_registry src/` before this migration found one reference, in the schema-parity
-- test's table list - so there is no row anywhere whose owning organization we would have
-- to invent. That is stated rather than assumed, because the identical statement would be
-- data loss the day after this migration ships.
DROP TABLE IF EXISTS skills_registry;

-- Bundle bytes, addressed by content.
--
-- Separate from skills_registry for two reasons. Content addressing is only real if two
-- rows that happen to hold identical bytes share one blob, which requires the digest to
-- be the key. And listing an org's skills must not drag megabytes of tarball through the
-- row mapper to render a name and a description.
--
-- Scoped by org even though a digest is globally unique: a bundle is a tenant's source
-- code, and deduplicating across tenants would let org B confirm the exact contents of
-- org A's private skill by uploading a guess and watching for a shared row.
CREATE TABLE IF NOT EXISTS skills_bundles (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  byte_size integer NOT NULL,
  content_type text NOT NULL DEFAULT 'application/gzip',
  storage_kind text NOT NULL DEFAULT 'db',
  storage_key text,
  -- bytea, not text. A skill bundle is a gzipped tar; skills_artifacts.body_text could
  -- stay text because a run artifact is a document, but there is no encoding under which
  -- a tarball survives a text column intact.
  body_blob bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, sha256)
);

CREATE TABLE IF NOT EXISTS skills_registry (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  category text NOT NULL DEFAULT 'Remote',
  tags_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  source text NOT NULL DEFAULT 'custom',
  kind text NOT NULL DEFAULT 'executable',
  version text,
  -- The agent-facing document, kept alongside the metadata so GET /skills/:slug/skill.md
  -- can answer for a published skill without the server ever unpacking a tarball.
  skill_md text,
  -- Soft reference to skills_bundles(org_id, sha256). Deliberately not a composite
  -- foreign key: the only usable ON DELETE action for it would be SET NULL, which on a
  -- composite key would also null org_id, and org_id is NOT NULL. Orphan collection is an
  -- application-level concern (deleteSkill drops a bundle no remaining row references).
  bundle_sha256 text,
  bundle_byte_size integer,
  published_by_user_id text REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, slug),
  CHECK (kind IN ('executable','instruction'))
);

CREATE INDEX IF NOT EXISTS skills_registry_org_updated_idx ON skills_registry (org_id, updated_at DESC);
