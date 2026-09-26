ALTER TABLE skills_audit_events ADD COLUMN operator_operation_id text;

-- One operation may be retried, but it must produce one immutable receipt per
-- tenant/key.  The partial expression index makes that property atomic under
-- concurrent maintenance tasks; application pre-reads are not the guard.
CREATE UNIQUE INDEX IF NOT EXISTS skills_operator_scope_receipt_idx
  ON skills_audit_events (operator_operation_id)
  WHERE action = 'api_key_scopes_added'
    AND operator_operation_id IS NOT NULL;
