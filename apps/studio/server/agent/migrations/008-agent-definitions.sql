CREATE TABLE wa_agent_definitions (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id), id text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('coordinator','specialist')), name text NOT NULL,
 owner_id text NOT NULL REFERENCES cp_users(id), draft jsonb NOT NULL, draft_hash text NOT NULL,
 edit_version integer NOT NULL DEFAULT 1, published_revision integer,
 enabled boolean NOT NULL DEFAULT false, archived_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE wa_agent_revisions (
 workspace_id text NOT NULL, agent_id text NOT NULL, revision integer NOT NULL,
 definition jsonb NOT NULL, content_hash text NOT NULL, created_by text NOT NULL REFERENCES cp_users(id),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,agent_id,revision),
 FOREIGN KEY(workspace_id,agent_id) REFERENCES wa_agent_definitions(workspace_id,id)
);
ALTER TABLE wa_agent_definitions ADD FOREIGN KEY(workspace_id,id,published_revision) REFERENCES wa_agent_revisions(workspace_id,agent_id,revision);
CREATE TABLE wa_agent_commands (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),actor_id text NOT NULL REFERENCES cp_users(id),
 operation text NOT NULL, client_key text NOT NULL, request_hash text NOT NULL,result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,actor_id,operation,client_key)
);
CREATE TABLE wa_workspace_agent_bindings (
 workspace_id text PRIMARY KEY REFERENCES cp_workspaces(id),agent_id text NOT NULL,revision integer NOT NULL,
 content_hash text NOT NULL,edit_version integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(workspace_id,agent_id,revision) REFERENCES wa_agent_revisions(workspace_id,agent_id,revision)
);
CREATE TABLE wa_agent_channels_v2 (
 workspace_id text NOT NULL,agent_id text NOT NULL,actor_id text NOT NULL REFERENCES cp_users(id),session_id text NOT NULL,
 PRIMARY KEY(workspace_id,agent_id,actor_id),
 FOREIGN KEY(workspace_id,agent_id) REFERENCES wa_agent_definitions(workspace_id,id),
 FOREIGN KEY(workspace_id,session_id) REFERENCES wa_sessions(workspace_id,id)
);
ALTER TABLE wa_requests ADD COLUMN execution_snapshot jsonb;
ALTER TABLE wa_work_items ADD COLUMN execution_snapshot jsonb;
ALTER TABLE wa_sessions ADD COLUMN agent_id text;
ALTER TABLE wa_sessions ADD FOREIGN KEY(workspace_id,agent_id) REFERENCES wa_agent_definitions(workspace_id,id);
CREATE INDEX wa_definitions_list ON wa_agent_definitions(workspace_id,updated_at DESC,id DESC);
