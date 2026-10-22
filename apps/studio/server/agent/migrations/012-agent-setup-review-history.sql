CREATE TABLE wa_setup_bundle_versions (
 workspace_id text NOT NULL,setup_id text NOT NULL,content_hash text NOT NULL,bundle jsonb NOT NULL,
 actor_id text NOT NULL REFERENCES cp_users(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,setup_id,content_hash),FOREIGN KEY(workspace_id,setup_id) REFERENCES wa_setup_runs(workspace_id,id)
);
INSERT INTO wa_setup_bundle_versions(workspace_id,setup_id,content_hash,bundle,actor_id)
 SELECT workspace_id,id,bundle_hash,bundle,actor_id FROM wa_setup_runs WHERE bundle IS NOT NULL;
