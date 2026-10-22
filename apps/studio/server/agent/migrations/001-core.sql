CREATE TABLE wa_agents (
 workspace_id text PRIMARY KEY REFERENCES cp_workspaces(id), sponsor_id text NOT NULL REFERENCES cp_users(id),
 edit_version integer NOT NULL DEFAULT 1, enabled boolean NOT NULL, config jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE wa_sessions (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id), id text NOT NULL, created_by text NOT NULL REFERENCES cp_users(id),
 title text NOT NULL, client_key text NOT NULL, edit_version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,created_by,client_key)
);
CREATE TABLE wa_messages (
 workspace_id text NOT NULL,id text NOT NULL,session_id text NOT NULL,ordinal bigint NOT NULL,
 role text NOT NULL CHECK(role IN ('user','assistant')),actor_id text REFERENCES cp_users(id),client_key text,request_hash text,
 content text NOT NULL,attachments jsonb NOT NULL DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,session_id,ordinal), UNIQUE(workspace_id,session_id,client_key),
 FOREIGN KEY(workspace_id,session_id) REFERENCES wa_sessions(workspace_id,id)
);
CREATE TABLE wa_work_items (
 workspace_id text NOT NULL,id text NOT NULL,session_id text NOT NULL,sponsor_id text NOT NULL REFERENCES cp_users(id),
 state text NOT NULL CHECK(state IN ('queued','preparing','reasoning','executing_tool','waiting_for_user','ready_for_review','completed','cancelled','failed','uncertain','budget_exhausted','suspended')),
 goal text NOT NULL,config_revision integer NOT NULL,config_snapshot jsonb NOT NULL,attachments jsonb NOT NULL DEFAULT '[]',
 edit_version integer NOT NULL DEFAULT 1,turn_no integer NOT NULL DEFAULT 0,tool_count integer NOT NULL DEFAULT 0,
 error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,session_id) REFERENCES wa_sessions(workspace_id,id)
);
CREATE TABLE wa_command_outbox (
 workspace_id text NOT NULL,id text NOT NULL,work_item_id text NOT NULL,command_key text NOT NULL,start_turn integer NOT NULL DEFAULT 0,
 delivered_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,command_key),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_activity (
 workspace_id text NOT NULL,id text NOT NULL,work_item_id text NOT NULL,kind text NOT NULL,summary text NOT NULL,
 detail jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_workspace_leases (
 workspace_id text PRIMARY KEY REFERENCES cp_workspaces(id),work_item_id text NOT NULL,fence bigint NOT NULL DEFAULT 1,
 owner text NOT NULL,expires_at timestamptz NOT NULL,FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_calls (
 workspace_id text NOT NULL,id text NOT NULL,work_item_id text NOT NULL,turn_no integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('model','tool')),call_key text NOT NULL,
 state text NOT NULL CHECK(state IN ('prepared','issued','completed','failed','uncertain')),
 request_hash text NOT NULL,request jsonb,result jsonb,private_result jsonb,error text,
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,work_item_id,kind,call_key),FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_context_manifests (
 workspace_id text NOT NULL,id text NOT NULL,work_item_id text NOT NULL,turn_no integer NOT NULL,manifest jsonb NOT NULL,
 content_hash text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,work_item_id,turn_no),FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_decisions (
 workspace_id text NOT NULL,id text NOT NULL,work_item_id text NOT NULL,actor_id text NOT NULL REFERENCES cp_users(id),
 client_key text NOT NULL,kind text NOT NULL,content jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,work_item_id,client_key),FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_change_sets (
 workspace_id text NOT NULL,id text NOT NULL,work_item_id text NOT NULL,artifact_id text NOT NULL,expected_version integer NOT NULL,
 content jsonb NOT NULL,content_hash text NOT NULL,summary text NOT NULL,state text NOT NULL DEFAULT 'proposed' CHECK(state IN ('proposed','applied','rejected')),
 receipt jsonb,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id),FOREIGN KEY(workspace_id,artifact_id) REFERENCES wi_artifacts(workspace_id,id)
);
CREATE TABLE wa_memories (
 workspace_id text NOT NULL,id text NOT NULL,work_item_id text NOT NULL,decision_id text NOT NULL,content text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id),FOREIGN KEY(workspace_id,decision_id) REFERENCES wa_decisions(workspace_id,id)
);
CREATE TABLE wa_domain_outbox (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),id text NOT NULL,event_type text NOT NULL,actor_id text NOT NULL REFERENCES cp_users(id),
 entity_kind text NOT NULL,entity_id text NOT NULL,delivered_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id)
);
CREATE TABLE wa_inbox (
 workspace_id text NOT NULL,id text NOT NULL,source_event_id text NOT NULL,payload jsonb NOT NULL,work_item_id text,
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,source_event_id),
 FOREIGN KEY(workspace_id,source_event_id) REFERENCES wa_domain_outbox(workspace_id,id),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE INDEX wa_sessions_list ON wa_sessions(workspace_id,updated_at DESC,id);
CREATE INDEX wa_work_queue ON wa_work_items(state,created_at,id);
CREATE INDEX wa_commands_pending ON wa_command_outbox(created_at) WHERE delivered_at IS NULL;
CREATE INDEX wa_events_pending ON wa_domain_outbox(created_at) WHERE delivered_at IS NULL;
CREATE INDEX wa_activity_work ON wa_activity(workspace_id,work_item_id,created_at,id);
CREATE OR REPLACE FUNCTION wa_capture_workspace_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.action IN ('knowledge.saved','workflow.saved','run.failed','connection.revoked','connection.updated','member.removed','member.role_changed')
 AND EXISTS(SELECT 1 FROM wa_agents WHERE workspace_id=NEW.workspace_id AND enabled) THEN
  INSERT INTO wa_domain_outbox(workspace_id,id,event_type,actor_id,entity_kind,entity_id)
  VALUES(NEW.workspace_id,'audit:'||NEW.id::text,NEW.action,NEW.actor_id,NEW.entity_type,NEW.entity_id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER wa_audit_changes AFTER INSERT ON cp_audit FOR EACH ROW EXECUTE FUNCTION wa_capture_workspace_change();
