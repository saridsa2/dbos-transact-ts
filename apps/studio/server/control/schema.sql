CREATE TABLE IF NOT EXISTS cp_users (
 id text PRIMARY KEY, issuer text NOT NULL, subject text NOT NULL, email text NOT NULL, display_name text NOT NULL,
 email_verified boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(issuer,subject)
);
CREATE TABLE IF NOT EXISTS cp_customers (
 id text PRIMARY KEY, name text NOT NULL, owner_user_id text REFERENCES cp_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cp_workspaces (
 id text PRIMARY KEY, customer_id text NOT NULL REFERENCES cp_customers(id), name text NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cp_memberships (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id), user_id text NOT NULL REFERENCES cp_users(id),
 role text NOT NULL CHECK(role IN ('owner','admin','editor','viewer')), PRIMARY KEY(workspace_id,user_id)
);
CREATE TABLE IF NOT EXISTS cp_sessions (
 token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES cp_users(id), expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS cp_invitations (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES cp_workspaces(id), email text NOT NULL,
 role text NOT NULL CHECK(role IN ('admin','editor','viewer')), token_hash text UNIQUE, expires_at timestamptz NOT NULL,
 accepted_at timestamptz, created_by text NOT NULL REFERENCES cp_users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS cp_connections (
 id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES cp_workspaces(id), name text NOT NULL, provider text NOT NULL,
 config jsonb NOT NULL, auth_kind text NOT NULL, status text NOT NULL DEFAULT 'configured' CHECK(status IN ('configured','revoked')),
 revision integer NOT NULL DEFAULT 1, updated_at timestamptz NOT NULL DEFAULT now(), created_by text NOT NULL REFERENCES cp_users(id)
);
CREATE TABLE IF NOT EXISTS cp_connection_secrets (
 connection_id text PRIMARY KEY REFERENCES cp_connections(id), version integer NOT NULL, sealed jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS cp_audit (
 id bigserial PRIMARY KEY, workspace_id text NOT NULL REFERENCES cp_workspaces(id), actor_id text REFERENCES cp_users(id),
 action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL, details jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cp_audit_workspace ON cp_audit(workspace_id,id DESC);
CREATE INDEX IF NOT EXISTS cp_connections_workspace ON cp_connections(workspace_id,updated_at DESC);
INSERT INTO cp_customers(id,name) VALUES('local','Local customer') ON CONFLICT DO NOTHING;
INSERT INTO cp_workspaces(id,customer_id,name) VALUES('local','local','Local workspace') ON CONFLICT DO NOTHING;
ALTER TABLE studio_flows ADD COLUMN IF NOT EXISTS workspace_id text NOT NULL DEFAULT 'local' REFERENCES cp_workspaces(id);
ALTER TABLE studio_runs ADD COLUMN IF NOT EXISTS workspace_id text NOT NULL DEFAULT 'local' REFERENCES cp_workspaces(id);
ALTER TABLE studio_runs ADD COLUMN IF NOT EXISTS actor_user_id text REFERENCES cp_users(id);
ALTER TABLE studio_approvals ADD COLUMN IF NOT EXISTS resolved_by text REFERENCES cp_users(id);
CREATE INDEX IF NOT EXISTS studio_flows_workspace ON studio_flows(workspace_id,updated_at DESC);
CREATE INDEX IF NOT EXISTS studio_runs_workspace ON studio_runs(workspace_id,created_at DESC);

-- Durable, metadata-only workspace notifications. The per-workspace advisory lock
-- makes sequence order match commit order, including concurrent worker writes.
CREATE TABLE IF NOT EXISTS cp_workspace_events (
 id bigserial PRIMARY KEY,
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),
 action text NOT NULL, entity_type text NOT NULL, entity_id text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS cp_workspace_events_cursor ON cp_workspace_events(workspace_id,id);
CREATE OR REPLACE FUNCTION cp_publish_workspace_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('stackplane-events:' || NEW.workspace_id, 0));
 INSERT INTO cp_workspace_events(workspace_id,action,entity_type,entity_id)
 VALUES(NEW.workspace_id,NEW.action,NEW.entity_type,NEW.entity_id);
 PERFORM pg_notify('stackplane_workspace_events', NEW.workspace_id);
 RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER cp_audit_workspace_event AFTER INSERT ON cp_audit
 FOR EACH ROW EXECUTE FUNCTION cp_publish_workspace_event();
CREATE OR REPLACE FUNCTION cp_publish_execution_progress() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE wid text;
BEGIN
 IF NEW.event->>'type' NOT IN ('run.started','run.completed','run.failed','run.waiting','run.resumed') THEN
  SELECT workspace_id INTO wid FROM studio_runs WHERE id=NEW.run_id;
  PERFORM pg_advisory_xact_lock(hashtextextended('stackplane-events:' || wid, 0));
  INSERT INTO cp_workspace_events(workspace_id,action,entity_type,entity_id) VALUES(wid,'execution.progress','run',NEW.run_id);
  PERFORM pg_notify('stackplane_workspace_events', wid);
 END IF;
 RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER cp_execution_progress AFTER INSERT ON studio_events
 FOR EACH ROW EXECUTE FUNCTION cp_publish_execution_progress();
CREATE TABLE IF NOT EXISTS cp_notification_reads (
 user_id text NOT NULL REFERENCES cp_users(id),
 event_id bigint NOT NULL REFERENCES cp_workspace_events(id),
 read_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,event_id)
);
