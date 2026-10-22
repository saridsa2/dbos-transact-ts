CREATE TABLE IF NOT EXISTS wi_model_calls (
 workspace_id text NOT NULL,task_id text NOT NULL,turn integer NOT NULL CHECK(turn BETWEEN 0 AND 2),
 status text NOT NULL CHECK(status IN ('reserved','completed')),result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 PRIMARY KEY(workspace_id,task_id,turn),FOREIGN KEY(workspace_id,task_id) REFERENCES wi_tasks(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wi_decisions (
 workspace_id text NOT NULL,id text NOT NULL,task_id text NOT NULL,task_version integer NOT NULL,
 actor_id text NOT NULL REFERENCES cp_users(id),answers jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,task_id,task_version),FOREIGN KEY(workspace_id,task_id) REFERENCES wi_tasks(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wi_proposal_revisions (
 workspace_id text NOT NULL,task_id text NOT NULL,task_version integer NOT NULL,analysis jsonb NOT NULL,
 actor_id text NOT NULL REFERENCES cp_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,task_id,task_version),FOREIGN KEY(workspace_id,task_id) REFERENCES wi_tasks(workspace_id,id)
);
