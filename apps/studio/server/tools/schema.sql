CREATE TABLE IF NOT EXISTS wt_tools (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id), id uuid NOT NULL, name text NOT NULL,
 edit_version integer NOT NULL, snapshot_id uuid NOT NULL, hash text NOT NULL,
 published_revision integer, enabled_revision integer, archived boolean NOT NULL DEFAULT false,
 updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wt_snapshots (
 workspace_id text NOT NULL, tool_id uuid NOT NULL, id uuid NOT NULL, hash text NOT NULL, files jsonb NOT NULL,
 actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,tool_id) REFERENCES wt_tools(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wt_builds (
 workspace_id text NOT NULL, id uuid NOT NULL, tool_id uuid NOT NULL, snapshot_id uuid NOT NULL,
 hash text NOT NULL, build_hash text, compiler text NOT NULL, build jsonb, test_result jsonb NOT NULL,
 actor_id text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wt_releases (
 workspace_id text NOT NULL, tool_id uuid NOT NULL, revision integer NOT NULL, version text NOT NULL,
 snapshot_id uuid NOT NULL, build_id uuid NOT NULL, hash text NOT NULL, actor_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,tool_id,revision), UNIQUE(workspace_id,tool_id,version)
);
CREATE TABLE IF NOT EXISTS wt_commands (
 workspace_id text NOT NULL, actor_id text NOT NULL, key uuid NOT NULL, hash text NOT NULL, result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,actor_id,key)
);
CREATE TABLE IF NOT EXISTS wt_developer_tokens (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES cp_users(id), workspace_id text NOT NULL REFERENCES cp_workspaces(id),
 scopes jsonb NOT NULL, expires_at timestamptz NOT NULL, revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS wt_device_logins (
 id uuid PRIMARY KEY, code_hash text UNIQUE NOT NULL, challenge text NOT NULL, user_id text,
 workspace_id text, approved boolean NOT NULL DEFAULT false, consumed boolean NOT NULL DEFAULT false,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
