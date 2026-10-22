CREATE TABLE wa_context_admissions (
 workspace_id text NOT NULL,work_item_id text NOT NULL,invocation_id text NOT NULL,
 estimated_tokens bigint NOT NULL CHECK(estimated_tokens>=0),output_tokens integer NOT NULL CHECK(output_tokens>=0),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN ('reserved','settled')),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(workspace_id,work_item_id,invocation_id),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
CREATE TABLE wa_work_budget_grants (
 workspace_id text NOT NULL,work_item_id text NOT NULL,id text NOT NULL,actor_id text NOT NULL REFERENCES cp_users(id),
 client_key text NOT NULL,request_hash text NOT NULL,additional_tokens bigint NOT NULL CHECK(additional_tokens>0),
 reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),result jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,actor_id,client_key),
 FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id)
);
