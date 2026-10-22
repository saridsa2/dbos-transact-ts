ALTER TABLE wa_work_items ADD COLUMN engine_provenance jsonb;
CREATE TABLE wa_executor_runs (
 workspace_id text NOT NULL,work_item_id text NOT NULL,start_turn integer NOT NULL,
 state text NOT NULL CHECK(state IN ('issued','completed','failed','uncertain')),
 session_id text,provenance jsonb,request_hash text NOT NULL,summary text,error text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 PRIMARY KEY(workspace_id,work_item_id,start_turn),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_harness_versions (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),id text NOT NULL,
 base_id text,tree jsonb NOT NULL,content_hash text NOT NULL,evidence jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('candidate','adopted','retired')),
 created_by text NOT NULL REFERENCES cp_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,content_hash),
 FOREIGN KEY(workspace_id,base_id) REFERENCES wa_harness_versions(workspace_id,id)
);
CREATE UNIQUE INDEX wa_harness_one_adopted ON wa_harness_versions(workspace_id) WHERE state='adopted';
CREATE TABLE wa_harness_refinements (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),id text NOT NULL,sponsor_id text NOT NULL REFERENCES cp_users(id),
 config_revision integer NOT NULL,request_hash text NOT NULL,state text NOT NULL CHECK(state IN ('queued','running','completed','failed','uncertain')),
 result jsonb,error text,created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 PRIMARY KEY(workspace_id,id)
);
