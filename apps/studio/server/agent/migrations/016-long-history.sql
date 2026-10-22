ALTER TABLE wa_calls ADD COLUMN history_ordinal bigint GENERATED ALWAYS AS IDENTITY;
CREATE INDEX wa_history_call_cursor ON wa_calls(workspace_id,work_item_id,history_ordinal);
CREATE TABLE wa_history_heads (
 workspace_id text NOT NULL REFERENCES cp_workspaces(id),stream_key text NOT NULL,scope_hash text NOT NULL,
 generation integer NOT NULL DEFAULT 0,cursor bigint NOT NULL DEFAULT 0,fragment_offset integer NOT NULL DEFAULT 0,
 summary jsonb NOT NULL,source_hash text NOT NULL,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,stream_key,scope_hash)
);
CREATE TABLE wa_history_segments (
 workspace_id text NOT NULL,stream_key text NOT NULL,scope_hash text NOT NULL,generation integer NOT NULL,
 work_item_id text NOT NULL,phase text NOT NULL CHECK(phase IN ('observe','reflect')),
 source_hash text NOT NULL,cursor bigint NOT NULL,fragment_offset integer NOT NULL,
 source_manifest jsonb NOT NULL,summary jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,stream_key,scope_hash,generation),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id),
 UNIQUE(workspace_id,stream_key,scope_hash,source_hash)
);
CREATE TABLE wa_memory_vectors (
 workspace_id text NOT NULL,memory_id text NOT NULL,version integer NOT NULL,embedding_model text NOT NULL,
 vector jsonb NOT NULL,payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,memory_id,version,embedding_model),
 FOREIGN KEY(workspace_id,memory_id,version) REFERENCES wa_memory_versions(workspace_id,memory_id,version)
);
CREATE TABLE wa_memory_index_outbox (
 workspace_id text NOT NULL,memory_id text NOT NULL,version integer NOT NULL,
 attempts integer NOT NULL DEFAULT 0,completed_at timestamptz,next_attempt_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,memory_id,version),
 FOREIGN KEY(workspace_id,memory_id,version) REFERENCES wa_memory_versions(workspace_id,memory_id,version)
);
CREATE INDEX wa_memory_index_pending ON wa_memory_index_outbox(next_attempt_at) WHERE completed_at IS NULL;
