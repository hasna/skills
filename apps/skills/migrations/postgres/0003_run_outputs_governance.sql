-- Run outputs governance: privacy, retention, cancellation fencing, spend.
--
-- Postgres dialect of 0003_run_outputs_governance. Read the SQLite file for why
-- the migration is additive; the rationale is not repeated here, only the
-- dialect differences are:
--   * timestamptz -> text holding a UTC ISO-8601 instant (expires_at, reconciled_at).
--   * text JSON   -> jsonb (metadata_json).
--
-- SQLite has no row-level security; tenant isolation there rests on the
-- org-scoped predicates in the store and the service-layer negative tests. This
-- dialect additionally arms PostgreSQL RLS on the two tenant tables, so a
-- statement that never set the tenant context sees zero rows (fail closed):
--
--   CREATE POLICY ... USING (
--     org_id = current_setting('app.skills_org_id', true)
--     OR current_setting('app.skills_claim_context', true) = 'worker'
--   )
--
-- The first clause is the principal path: the store runs every tenant-facing
-- read under SET LOCAL app.skills_org_id = <org>, and an unset setting matches
-- nothing. The second clause is the worker path, stated as the deliberate
-- exception it is: skills-worker claims and finalises runs for every org on the
-- instance (claimNextRun is not org-scoped by design), so it writes under an
-- explicit claim context rather than a tenant context. Both clauses must be
-- present for the shipped server to work at all, and neither weakens the tenant
-- fence: a caller with no context and no claim role reads no tenant rows.

ALTER TABLE skills_runs ADD COLUMN lease_generation integer NOT NULL DEFAULT 0;

ALTER TABLE skills_artifacts ADD COLUMN visibility text NOT NULL DEFAULT 'private';
ALTER TABLE skills_artifacts ADD COLUMN expires_at timestamptz;

CREATE TABLE IF NOT EXISTS skills_lifecycle_receipts (
  id text PRIMARY KEY,
  kind text NOT NULL,
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  run_id text NOT NULL REFERENCES skills_runs(id) ON DELETE CASCADE,
  artifact_id text,
  requested_by text NOT NULL,
  metadata_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
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
  created_at timestamptz NOT NULL DEFAULT now(),
  reconciled_at timestamptz,
  CHECK (status IN ('reserved','charged','released'))
);

CREATE INDEX IF NOT EXISTS skills_credit_reservations_org_run_idx
  ON skills_credit_reservations (org_id, run_id);

ALTER TABLE skills_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE skills_artifacts ENABLE ROW LEVEL SECURITY;

-- FORCE closes the owner exemption: Postgres exempts a table's owner from RLS,
-- and this instance runs migrations and the server as one role, so without
-- FORCE the fence would not bind the app path. With FORCE the store's
-- tenant/worker contexts apply to that role like any other.
ALTER TABLE skills_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE skills_artifacts FORCE ROW LEVEL SECURITY;

CREATE POLICY skills_runs_tenant_isolation ON skills_runs
  USING (
    org_id = current_setting('app.skills_org_id', true)
    OR current_setting('app.skills_claim_context', true) = 'worker'
  );

CREATE POLICY skills_artifacts_tenant_isolation ON skills_artifacts
  USING (
    org_id = current_setting('app.skills_org_id', true)
    OR current_setting('app.skills_claim_context', true) = 'worker'
  );
