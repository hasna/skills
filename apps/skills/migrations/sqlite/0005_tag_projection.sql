-- The hosted tag surface (T7) queries tag membership from this relational
-- projection of skills_registry.tags_json, in both dialects with one identical
-- shape. SQLite cannot index json_each() over the JSON column, so the tag
-- lookup becomes an indexed read here: the PRIMARY KEY serves (org_id, slug)
-- maintenance and the org_tag index serves (org_id, tag) filters. The write
-- paths keep it in step; the backfill below covers rows that predate it.
-- No composite FK to skills_registry: the schema-parity parser cannot
-- represent a multi-column FK identically in both dialects, and every write
-- path here maintains the projection explicitly (publish/update replace its
-- rows, the tombstone purge removes them with the row), so the constraint
-- would be redundancy.
CREATE TABLE skills_tags (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  slug text NOT NULL,
  tag text NOT NULL,
  PRIMARY KEY (org_id, slug, tag)
);

CREATE INDEX skills_tags_org_tag_idx ON skills_tags (org_id, tag);

-- Backfill every existing row's tags from the stored JSON array.
INSERT INTO skills_tags (org_id, slug, tag)
SELECT DISTINCT r.org_id, r.slug, je.value
FROM skills_registry r, json_each(r.tags_json) AS je
WHERE je.value <> '';
