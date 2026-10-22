ALTER TABLE wa_agent_definitions ADD COLUMN system_template boolean NOT NULL DEFAULT false;
CREATE TABLE wa_setup_runs (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),id text NOT NULL,actor_id text NOT NULL REFERENCES cp_users(id),
 request_id text NOT NULL,template_agent_id text NOT NULL,source_refs jsonb NOT NULL,policy_version integer NOT NULL,
 expected_binding_version integer NOT NULL,bundle jsonb,bundle_hash text,projection_error text,activated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,request_id) REFERENCES wa_requests(workspace_id,id),
 FOREIGN KEY(workspace_id,template_agent_id) REFERENCES wa_agent_definitions(workspace_id,id)
);
CREATE TABLE wa_workspace_understandings (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),id text NOT NULL,setup_id text NOT NULL,
 content jsonb NOT NULL,content_hash text NOT NULL,coverage jsonb NOT NULL,source_refs jsonb NOT NULL,
 accepted_by text NOT NULL REFERENCES cp_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,setup_id),FOREIGN KEY(workspace_id,setup_id) REFERENCES wa_setup_runs(workspace_id,id)
);
ALTER TABLE wa_workspace_agent_bindings ADD COLUMN understanding_id text;
ALTER TABLE wa_workspace_agent_bindings ADD FOREIGN KEY(workspace_id,understanding_id) REFERENCES wa_workspace_understandings(workspace_id,id);
