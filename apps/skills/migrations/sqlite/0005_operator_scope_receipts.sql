ALTER TABLE skills_audit_events ADD COLUMN operator_operation_id text;

-- SQLite equivalent of the PostgreSQL operation-receipt uniqueness fence.
CREATE UNIQUE INDEX IF NOT EXISTS skills_operator_scope_receipt_idx
  ON skills_audit_events (operator_operation_id)
  WHERE action = 'api_key_scopes_added'
    AND operator_operation_id IS NOT NULL;
