ALTER TABLE wa_work_items ADD COLUMN request_context jsonb NOT NULL DEFAULT '{}';
CREATE TABLE wa_agent_channels (
 workspace_id text PRIMARY KEY REFERENCES cp_workspaces(id),session_id text NOT NULL,
 FOREIGN KEY(workspace_id,session_id) REFERENCES wa_sessions(workspace_id,id)
);
CREATE TABLE wa_requests (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),id text NOT NULL,actor_id text NOT NULL REFERENCES cp_users(id),
 client_key text NOT NULL,request_hash text NOT NULL,origin text NOT NULL CHECK(origin IN ('shell','workbench','workspace-event')),
 kind text NOT NULL CHECK(kind IN ('goal','answer')),payload jsonb NOT NULL,config_revision integer NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','dispatched','rejected')),
 session_id text,work_item_id text,source_event_id text,error text,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,actor_id,client_key),
 FOREIGN KEY(workspace_id,session_id) REFERENCES wa_sessions(workspace_id,id),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE INDEX wa_requests_pending ON wa_requests(workspace_id,created_at,id) WHERE state='queued';
