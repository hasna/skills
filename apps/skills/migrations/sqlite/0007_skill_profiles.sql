-- Desired selections belong to the workspace; receipts belong to stable actors/stations.
CREATE TABLE IF NOT EXISTS skills_profiles (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  profile_id text NOT NULL,
  revision text NOT NULL,
  selections_json text NOT NULL,
  updated_at text NOT NULL,
  PRIMARY KEY (org_id, profile_id)
);
CREATE TABLE IF NOT EXISTS skills_station_state (
  org_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  actor_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  station_id text NOT NULL,
  profile_id text NOT NULL,
  profile_revision text NOT NULL,
  selections_json text NOT NULL,
  applied_at text NOT NULL,
  PRIMARY KEY (org_id, actor_id, station_id)
);
