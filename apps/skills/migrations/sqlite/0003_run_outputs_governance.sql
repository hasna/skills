-- Run outputs governance: privacy, retention, cancellation fencing, spend.
--
-- Three columns and two tables, all additive. skills_runs/skills_artifacts hold
-- tenant rows today, so this migration must not drop or rebuild them - the 0002
-- drop-and-recreate pattern was safe only while the tables had never had a writer.
--
--   * skills_artifacts.visibility     - outputs are PRIVATE by default.
--   * skills_artifacts.expires_at     - finite retention: set at write time from
--                                       the configured TTL, swept by the expiry
--                                       service, never open-ended.
--   * skills_runs.lease_generation    - the cancellation fence. Each claim bumps
--                                       it; a worker that keeps writing with a
--                                       stale generation is rejected. Cancel bumps
--                                       it too, fencing the worker it interrupts.
--
-- skills_lifecycle_receipts is the immutable, append-only record of every
-- deletion, quarantine, and cancellation. There is no UPDATE or DELETE path in
-- the store for this table - a receipt is a fact that happened, not state to
-- correct.
--
-- skills_credit_reservations is the spend ledger: a reservation is made before
-- dispatch, reconciled once at terminal state (charged with the actual cost, or
-- released when the run used nothing).

ALTER TABLE skills_runs ADD COLUMN lease_generation integer NOT NULL DEFAULT 0;

ALTER TABLE skills_artifacts ADD COLUMN visibility text NOT NULL DEFAULT 'private';
ALTER TABLE skills_artifacts ADD COLUMN expires_at text;

CREATE TABLE IF NOT EXISTS skills_lifecycle_receipts (
  id text PRIMARY KEY,
  kind text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES skills_runs(id) ON DELETE CASCADE,
  artifact_id text,
  requested_by text NOT NULL,
  metadata_json text NOT NULL DEFAULT '{}',
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (kind IN ('delete','quarantine','cancel'))
);

CREATE INDEX IF NOT EXISTS skills_lifecycle_receipts_org_run_idx
  ON skills_lifecycle_receipts (org_id, run_id);

CREATE TABLE IF NOT EXISTS skills_credit_reservations (
  id text PRIMARY KEY,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES skills_runs(id) ON DELETE CASCADE,
  estimated_cents integer NOT NULL,
  actual_cents integer,
  status text NOT NULL,
  created_at text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  reconciled_at text,
  CHECK (status IN ('reserved','charged','released'))
);

CREATE INDEX IF NOT EXISTS skills_credit_reservations_org_run_idx
  ON skills_credit_reservations (org_id, run_id);
