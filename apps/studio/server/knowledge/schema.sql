CREATE TABLE IF NOT EXISTS wi_artifacts (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id), id text NOT NULL, kind text NOT NULL CHECK(kind IN ('ontology','process','source')),
 name text NOT NULL, edit_version integer NOT NULL DEFAULT 1, revision_id text NOT NULL, published_revision_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wi_revisions (
 workspace_id text NOT NULL, id text NOT NULL, artifact_id text NOT NULL, parent_revision_id text, content_hash text NOT NULL,
 content jsonb NOT NULL, created_by text NOT NULL REFERENCES cp_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,artifact_id,id), FOREIGN KEY(workspace_id,artifact_id) REFERENCES wi_artifacts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wi_reviews (
 workspace_id text NOT NULL, revision_id text NOT NULL, actor_id text NOT NULL REFERENCES cp_users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,revision_id), FOREIGN KEY(workspace_id,revision_id) REFERENCES wi_revisions(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wi_source_blocks (
 workspace_id text NOT NULL, revision_id text NOT NULL, id text NOT NULL, ordinal integer NOT NULL, text text NOT NULL,
 PRIMARY KEY(workspace_id,revision_id,id), FOREIGN KEY(workspace_id,revision_id) REFERENCES wi_revisions(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wi_tasks (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id), id text NOT NULL, name text NOT NULL, actor_id text NOT NULL REFERENCES cp_users(id),
 source_id text NOT NULL, source_revision_id text NOT NULL, connection_id text NOT NULL, connection_revision integer NOT NULL,
 status text NOT NULL DEFAULT 'queued', edit_version integer NOT NULL DEFAULT 1, summary text, error text, analysis jsonb, answers jsonb NOT NULL DEFAULT '{}', flow_id text,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id,source_revision_id) REFERENCES wi_revisions(workspace_id,artifact_id,id)
);
CREATE TABLE IF NOT EXISTS wi_outbox (
 id text PRIMARY KEY, workspace_id text NOT NULL, task_id text NOT NULL, kind text NOT NULL, payload jsonb NOT NULL DEFAULT '{}', delivered boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(workspace_id,task_id) REFERENCES wi_tasks(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wi_applications (
 workspace_id text NOT NULL, task_id text NOT NULL, flow_id text NOT NULL, manifest jsonb NOT NULL, graph jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,task_id), FOREIGN KEY(workspace_id,task_id) REFERENCES wi_tasks(workspace_id,id)
);
CREATE INDEX IF NOT EXISTS wi_artifacts_list ON wi_artifacts(workspace_id,kind,updated_at DESC,id);
CREATE INDEX IF NOT EXISTS wi_tasks_pending ON wi_tasks(status,updated_at);
CREATE INDEX IF NOT EXISTS wi_outbox_pending ON wi_outbox(delivered,created_at);
CREATE TABLE IF NOT EXISTS wi_knowledge_acceptances (
 workspace_id text NOT NULL,task_id text NOT NULL,task_version integer NOT NULL,ontology_id text NOT NULL,ontology_revision_id text NOT NULL,process_id text NOT NULL,process_revision_id text NOT NULL,
 PRIMARY KEY(workspace_id,task_id,task_version),FOREIGN KEY(workspace_id,task_id) REFERENCES wi_tasks(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS wi_manual_generations (
 workspace_id text NOT NULL,process_revision_id text NOT NULL,flow_id text NOT NULL,manifest jsonb NOT NULL,graph jsonb NOT NULL,
 PRIMARY KEY(workspace_id,process_revision_id),FOREIGN KEY(workspace_id,process_revision_id) REFERENCES wi_revisions(workspace_id,id)
);
