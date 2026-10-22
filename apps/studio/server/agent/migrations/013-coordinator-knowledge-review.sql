CREATE TABLE wa_coordinator_rules (
 workspace_id text PRIMARY KEY REFERENCES cp_workspaces(id),target jsonb NOT NULL,actor_id text NOT NULL REFERENCES cp_users(id),
 enabled boolean NOT NULL,edit_version integer NOT NULL DEFAULT 1,max_runs integer NOT NULL CHECK(max_runs BETWEEN 1 AND 12),
 daily_tokens integer NOT NULL CHECK(daily_tokens BETWEEN 1024 AND 1000000),error text,updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE wa_setup_runs ADD COLUMN initial_request_id text;
ALTER TABLE wa_setup_runs ADD FOREIGN KEY(workspace_id,initial_request_id) REFERENCES wa_requests(workspace_id,id);
CREATE TABLE wa_coordinator_changes (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),artifact_id text NOT NULL,kind text NOT NULL,event_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,artifact_id),
 FOREIGN KEY(workspace_id,event_id) REFERENCES wa_domain_outbox(workspace_id,id)
);
CREATE TABLE wa_coordinator_admissions (
 workspace_id text NOT NULL,request_id text NOT NULL,rule_version integer NOT NULL,day date NOT NULL,
 reserved_tokens integer NOT NULL,charged_tokens integer,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,request_id),
 FOREIGN KEY(workspace_id,request_id) REFERENCES wa_requests(workspace_id,id)
);
