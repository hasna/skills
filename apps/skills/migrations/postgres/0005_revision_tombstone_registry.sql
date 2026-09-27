-- Revision identity, optimistic concurrency, and the tombstone contract for the hosted
-- registry (todos d061fcda, plan 8022d27f).
--
-- Three behaviours this migration makes possible, all in one table because they are
-- three properties of the same row:
--
--   1. IMMUTABLE REVISION IDENTITY. revision_id is a sha-256 over the row's published
--      content (computed in TypeScript, src/lib/revision.ts) and revision_number is a
--      monotonic per-slug write counter. Together they let a client prove WHICH revision
--      it installed and let the server refuse a stale overwrite.
--
--   2. OPTIMISTIC CONCURRENCY. publish/update require an If-Match carrying the current
--      revision_id; a mismatch (or a missing guard against an existing row) returns 409
--      instead of silently overwriting a newer revision. The guard is enforced in the
--      store's SQL (WHERE ... revision_id = <expected> on the upsert), never in
--      read-then-write JS, so two concurrent writers cannot both pass a stale check.
--
--   3. TOMBSTONES. delete no longer drops the row: it stamps tombstoned_at +
--      tombstone_purge_after (delete time + the configured window). Reads within the
--      window answer 410 with the tombstone marker so a client's pull can reconcile
--      (remove the local copy); after the window a read or list purges the row and its
--      bundle. Re-publish over a tombstoned slug revives it as a fresh revision.
--
-- The columns are added by ALTER rather than by the 0002 drop-and-recreate pattern:
-- the registry can hold tenant rows now (publishing shipped in the 0002 change), so a
-- rebuild would be data loss. Rows that predate this migration get revision_id '' and
-- revision_number 0; the store backfills a content sha for them on first open, because
-- an empty revision id would make If-Match vacuous for legacy rows (every stale client
-- would "match" the same empty string and two concurrent writers could both land).
--
-- Hand-written parallel of migrations/sqlite/0005_revision_tombstone_registry.sql; the
-- dialect differences are the same documented set as 0001-0003 (timestamptz -> text).

ALTER TABLE skills_registry ADD COLUMN revision_id text NOT NULL DEFAULT '';
ALTER TABLE skills_registry ADD COLUMN revision_number integer NOT NULL DEFAULT 0;
ALTER TABLE skills_registry ADD COLUMN tombstoned_at timestamptz;
ALTER TABLE skills_registry ADD COLUMN tombstone_purge_after timestamptz;
