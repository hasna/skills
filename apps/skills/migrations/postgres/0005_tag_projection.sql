-- The hosted tag surface (T7) queries tag membership from this relational
-- projection of skills_registry.tags_json, in both dialects with one identical
-- shape. SQLite cannot index json_each() over the JSON column, and Postgres
-- rows written by the current path hold the array text inside a jsonb scalar
-- (bun's driver binds a JS string against a ::jsonb cast as a JSON string), so
-- neither dialect can serve an indexed array-expansion query directly. The
-- projection turns tag membership into a plain indexed lookup: the PRIMARY KEY
-- serves (org_id, slug) maintenance and the org_tag index serves (org_id, tag)
-- filters. The write paths keep it in step; the backfill below covers rows
-- that predate it.
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

-- Backfill every existing row's tags. tags_json may be a real array or,
-- because of the jsonb-scalar write path, the array text inside a jsonb
-- string; both shapes are expanded here.
INSERT INTO skills_tags (org_id, slug, tag)
SELECT DISTINCT r.org_id, r.slug, t.tag
FROM skills_registry r
CROSS JOIN LATERAL jsonb_array_elements_text(
  CASE WHEN jsonb_typeof(r.tags_json) = 'array' THEN r.tags_json
       WHEN jsonb_typeof(r.tags_json) = 'string' THEN (r.tags_json #>> '{}')::jsonb
       ELSE '[]'::jsonb END
) AS t(tag)
WHERE t.tag <> '';
