CREATE TABLE wa_agent_suggestions (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),id text NOT NULL,
 coordinator_id text NOT NULL,coordinator_revision integer NOT NULL,work_id text NOT NULL,
 finding_key text NOT NULL,evidence_hash text NOT NULL,proposal jsonb NOT NULL,content_hash text NOT NULL,
 state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','accepted','dismissed','superseded')),
 edit_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,coordinator_id,finding_key,evidence_hash),
 FOREIGN KEY(workspace_id,coordinator_id,coordinator_revision) REFERENCES wa_agent_revisions(workspace_id,agent_id,revision),
 FOREIGN KEY(workspace_id,work_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_agent_assignments (
 workspace_id text NOT NULL,id text NOT NULL,suggestion_id text NOT NULL,actor_id text NOT NULL REFERENCES cp_users(id),
 request_id text NOT NULL,executor jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,suggestion_id),
 FOREIGN KEY(workspace_id,suggestion_id) REFERENCES wa_agent_suggestions(workspace_id,id),
 FOREIGN KEY(workspace_id,request_id) REFERENCES wa_requests(workspace_id,id)
);
