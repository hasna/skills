-- SQLite dialect of 0005_revision_tombstone_registry.
--
-- Hand-written parallel of migrations/postgres/0005_revision_tombstone_registry.sql. Read
-- that file for why the registry gains revision_id/revision_number (immutable revision
-- identity), the optimistic-concurrency guard, and the tombstone contract; the rationale
-- is not repeated here, only the dialect differences are.
--
-- Deliberate, shape-preserving dialect differences (same set as 0001):
--   * timestamptz -> text holding a UTC ISO-8601 instant.
--
-- SQLite requires a non-null literal DEFAULT for a NOT NULL ADD COLUMN; the '' default is
-- the legacy-row marker the store's backfill (src/lib/revision.ts) replaces with a
-- content sha on first open, exactly as on Postgres.

ALTER TABLE skills_registry ADD COLUMN revision_id text NOT NULL DEFAULT '';
ALTER TABLE skills_registry ADD COLUMN revision_number integer NOT NULL DEFAULT 0;
ALTER TABLE skills_registry ADD COLUMN tombstoned_at text;
ALTER TABLE skills_registry ADD COLUMN tombstone_purge_after text;
