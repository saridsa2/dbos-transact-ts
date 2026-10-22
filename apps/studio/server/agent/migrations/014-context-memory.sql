CREATE TABLE wa_work_context_snapshots (
 workspace_id text NOT NULL,work_item_id text NOT NULL,revision integer NOT NULL,
 scope_hash text NOT NULL,source_hash text NOT NULL,summary jsonb NOT NULL,prefix_hashes jsonb NOT NULL,
 summary_call_id text,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,work_item_id,revision),UNIQUE(workspace_id,work_item_id,scope_hash,source_hash),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id),
 FOREIGN KEY(workspace_id,summary_call_id) REFERENCES wa_calls(workspace_id,id)
);
CREATE TABLE wa_memory_entries (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),id text NOT NULL,agent_id text,
 scope text NOT NULL CHECK(scope IN ('agent','workspace')),state text NOT NULL CHECK(state IN ('proposed','approved','revoked','rejected')),
 version integer NOT NULL DEFAULT 1,origin_work_id text NOT NULL,created_by text NOT NULL REFERENCES cp_users(id),
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),
 CHECK((scope='agent' AND agent_id IS NOT NULL) OR (scope='workspace' AND agent_id IS NULL)),
 FOREIGN KEY(workspace_id,agent_id) REFERENCES wa_agent_definitions(workspace_id,id),
 FOREIGN KEY(workspace_id,origin_work_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_memory_versions (
 workspace_id text NOT NULL,memory_id text NOT NULL,version integer NOT NULL,content jsonb NOT NULL,
 content_hash text NOT NULL,evidence jsonb NOT NULL,expires_at timestamptz,approved_by text REFERENCES cp_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,memory_id,version),
 FOREIGN KEY(workspace_id,memory_id) REFERENCES wa_memory_entries(workspace_id,id)
);
CREATE TABLE wa_memory_generation (
 workspace_id text PRIMARY KEY REFERENCES cp_workspaces(id),generation bigint NOT NULL DEFAULT 0
);
CREATE INDEX wa_memory_scope ON wa_memory_entries(workspace_id,state,agent_id,updated_at DESC);
CREATE TABLE wa_memory_commands (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),actor_id text NOT NULL REFERENCES cp_users(id),
 client_key text NOT NULL,request_hash text NOT NULL,result jsonb NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,client_key)
);
