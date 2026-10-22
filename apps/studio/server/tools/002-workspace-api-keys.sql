CREATE TABLE wt_workspace_api_keys (
  id uuid PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES cp_workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES cp_users(id) ON DELETE CASCADE,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  prefix text NOT NULL,
  scopes jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON wt_workspace_api_keys(workspace_id,created_at DESC);
