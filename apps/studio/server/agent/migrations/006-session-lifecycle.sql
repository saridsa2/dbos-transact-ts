ALTER TABLE wa_sessions ADD COLUMN archived_at timestamptz;
ALTER TABLE wa_sessions ADD COLUMN deleted_at timestamptz;
-- Preserve execution/audit receipts when a conversation is removed from the product.
CREATE INDEX wa_sessions_visible ON wa_sessions(workspace_id,archived_at,updated_at DESC) WHERE deleted_at IS NULL;
ALTER TABLE wa_calls ADD COLUMN tool_effect text CHECK(tool_effect IN ('read','write'));
