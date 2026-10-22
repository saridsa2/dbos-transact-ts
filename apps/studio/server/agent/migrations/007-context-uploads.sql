CREATE TABLE wa_context_permissions (
 workspace_id text PRIMARY KEY REFERENCES cp_workspaces(id),editor_upload boolean NOT NULL DEFAULT true,
 edit_version integer NOT NULL DEFAULT 1,updated_by text NOT NULL REFERENCES cp_users(id),updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wa_context_uploads (
 workspace_id text NOT NULL,id text NOT NULL,session_id text NOT NULL,actor_id text NOT NULL REFERENCES cp_users(id),
 client_key text NOT NULL,artifact_id text NOT NULL,revision_id text NOT NULL,filename text NOT NULL,
 media_type text NOT NULL,byte_size integer NOT NULL,content_hash text NOT NULL,request_id text,
 detached_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,actor_id,client_key),
 FOREIGN KEY(workspace_id,session_id) REFERENCES wa_sessions(workspace_id,id),
 FOREIGN KEY(workspace_id,artifact_id) REFERENCES wi_artifacts(workspace_id,id),
 FOREIGN KEY(workspace_id,revision_id) REFERENCES wi_revisions(workspace_id,id),
 FOREIGN KEY(workspace_id,request_id) REFERENCES wa_requests(workspace_id,id)
);
CREATE INDEX wa_context_pending ON wa_context_uploads(workspace_id,session_id) WHERE request_id IS NULL AND detached_at IS NULL;
