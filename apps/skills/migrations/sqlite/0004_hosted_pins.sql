-- Hosted pins: the cloud becomes a source of truth for what the user selected.
--
-- SQLite dialect of 0004_hosted_pins. Read the Postgres file for the why; the
-- only differences here are the documented dialect mapping:
--   * timestamptz -> text holding a UTC ISO-8601 instant (pinned_at).
--   * jsonb       -> text holding JSON (metadata_json).
--
-- No RLS: the tenant fence on this table is the org-scoped predicate in the
-- store, exactly as it is for skills_registry and skills_bundles. RLS was
-- armed in 0003 only for the run-output tables, where a worker path writes
-- outside a tenant context; pins are written and read only by the API under
-- the requesting principal's org, so there is no context-less writer to fence.

CREATE TABLE IF NOT EXISTS skills_pins (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  principal text NOT NULL,
  slug text NOT NULL,
  pinned_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  metadata_json text NOT NULL DEFAULT '{}',
  PRIMARY KEY (org_id, principal, slug)
);
