ALTER TABLE skills_registry ADD COLUMN lifecycle text NOT NULL DEFAULT 'active' CHECK (lifecycle IN ('active','archived'));
ALTER TABLE skills_registry ADD COLUMN archived_at text;
ALTER TABLE skills_registry ADD COLUMN archive_reason text;
ALTER TABLE skills_registry ADD COLUMN replacement_slug text;
CREATE INDEX IF NOT EXISTS skills_registry_org_lifecycle_idx ON skills_registry (org_id, lifecycle, slug);
