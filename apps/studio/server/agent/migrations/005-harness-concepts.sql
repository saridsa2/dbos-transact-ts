CREATE TABLE wa_harness_events (
 id bigserial PRIMARY KEY,workspace_id text NOT NULL,work_item_id text NOT NULL,
 event_key text NOT NULL,kind text NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(workspace_id,work_item_id,event_key),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE INDEX wa_harness_stream ON wa_harness_events(workspace_id,work_item_id,id);
CREATE TABLE wa_skills (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),id text NOT NULL,name text NOT NULL,description text NOT NULL,
 content text NOT NULL,content_hash text NOT NULL,revision integer NOT NULL DEFAULT 1,enabled boolean NOT NULL DEFAULT true,
 created_by text NOT NULL REFERENCES cp_users(id),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,name)
);
CREATE TABLE wa_session_forks (
 workspace_id text NOT NULL,session_id text NOT NULL,parent_session_id text NOT NULL,through_ordinal bigint NOT NULL,
 PRIMARY KEY(workspace_id,session_id),
 FOREIGN KEY(workspace_id,session_id) REFERENCES wa_sessions(workspace_id,id),
 FOREIGN KEY(workspace_id,parent_session_id) REFERENCES wa_sessions(workspace_id,id)
);
CREATE TABLE wa_agent_tasks (
 workspace_id text NOT NULL,id text NOT NULL,parent_work_id text NOT NULL,child_work_id text NOT NULL,
 title text NOT NULL,depth integer NOT NULL,request_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,parent_work_id,id),
 FOREIGN KEY(workspace_id,parent_work_id) REFERENCES wa_work_items(workspace_id,id),
 FOREIGN KEY(workspace_id,child_work_id) REFERENCES wa_work_items(workspace_id,id)
);
ALTER TABLE wa_work_items ADD COLUMN task_depth integer NOT NULL DEFAULT 0;
ALTER TABLE wa_work_items ADD COLUMN read_only boolean NOT NULL DEFAULT false;
CREATE TABLE wa_agent_plans (
 workspace_id text NOT NULL,work_item_id text NOT NULL,revision integer NOT NULL DEFAULT 1,steps jsonb NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,work_item_id),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_tool_approvals (
 workspace_id text NOT NULL,id text NOT NULL,work_item_id text NOT NULL,tool_name text NOT NULL,args_hash text NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','approved','denied')),actor_id text REFERENCES cp_users(id),
 created_at timestamptz NOT NULL DEFAULT now(),decided_at timestamptz,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,work_item_id,tool_name,args_hash),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_skill_revisions (
 workspace_id text NOT NULL,id text NOT NULL,revision integer NOT NULL,content text NOT NULL,content_hash text NOT NULL,
 PRIMARY KEY(workspace_id,id,revision),FOREIGN KEY(workspace_id,id) REFERENCES wa_skills(workspace_id,id)
);
ALTER TABLE wa_tool_approvals ADD COLUMN consumed_call_id text;
ALTER TABLE wa_work_items DROP CONSTRAINT wa_work_items_state_check;
ALTER TABLE wa_work_items ADD CONSTRAINT wa_work_items_state_check CHECK(state IN ('queued','preparing','reasoning','executing_tool','waiting_for_user','waiting_for_tasks','ready_for_review','completed','cancelled','failed','uncertain','budget_exhausted','suspended'));
ALTER TABLE wa_agent_tasks ADD COLUMN request_key text NOT NULL;
CREATE UNIQUE INDEX wa_task_request ON wa_agent_tasks(workspace_id,parent_work_id,request_key);
CREATE TABLE wa_reader_leases (
 workspace_id text NOT NULL,work_item_id text NOT NULL,fence bigint NOT NULL DEFAULT 1,owner text NOT NULL,expires_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,work_item_id),FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
ALTER TABLE wa_work_items ADD COLUMN output_schema jsonb;
ALTER TABLE wa_work_items ADD COLUMN structured_result jsonb;
CREATE TABLE wa_work_directives (
 workspace_id text NOT NULL,work_item_id text NOT NULL,id text NOT NULL,actor_id text NOT NULL REFERENCES cp_users(id),
 text text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,work_item_id,id),FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_memory_proposals (
 workspace_id text NOT NULL,id text NOT NULL,work_item_id text NOT NULL,content text NOT NULL,evidence jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','accepted','rejected')),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_agent_schedules (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),id text NOT NULL,created_by text NOT NULL REFERENCES cp_users(id),
 name text NOT NULL,cron text NOT NULL,timezone text NOT NULL,goal text NOT NULL,enabled boolean NOT NULL,
 revision integer NOT NULL DEFAULT 1,applied_revision integer,error text,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE wa_session_context (
 workspace_id text NOT NULL,session_id text NOT NULL,through_ordinal bigint NOT NULL,summary jsonb NOT NULL,content_hash text NOT NULL,
 PRIMARY KEY(workspace_id,session_id),FOREIGN KEY(workspace_id,session_id) REFERENCES wa_sessions(workspace_id,id)
);
