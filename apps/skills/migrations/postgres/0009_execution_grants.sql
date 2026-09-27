-- Explicit org predicates fence API reads/writes; there is no context-less worker writer.
CREATE TABLE IF NOT EXISTS skills_execution_grants (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id text NOT NULL,
  revision text NOT NULL,
  document_json jsonb NOT NULL,
  PRIMARY KEY (org_id, profile_id)
);
CREATE TABLE IF NOT EXISTS skills_execution_grant_revisions (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id text NOT NULL,
  revision text NOT NULL,
  document_json jsonb NOT NULL,
  PRIMARY KEY (org_id, profile_id, revision)
);
