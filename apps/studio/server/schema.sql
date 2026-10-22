-- Application-owned graph/run data. DBOS manages its own separate system DB.
CREATE TABLE IF NOT EXISTS studio_flows (
  id text PRIMARY KEY, graph jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_runs (
  id text PRIMARY KEY, flow_id text NOT NULL, flow_name text NOT NULL,
  graph jsonb NOT NULL, input jsonb NOT NULL, status text NOT NULL DEFAULT 'queued',
  output jsonb, error text, created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz
);
CREATE TABLE IF NOT EXISTS studio_events (
  run_id text NOT NULL REFERENCES studio_runs(id), sequence integer NOT NULL,
  event jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, sequence)
);
CREATE TABLE IF NOT EXISTS studio_approvals (
  id text PRIMARY KEY, run_id text NOT NULL REFERENCES studio_runs(id), node_id text NOT NULL,
  node_name text NOT NULL, instruction text NOT NULL, kind text NOT NULL DEFAULT 'approval',
  status text NOT NULL DEFAULT 'open', decision jsonb, sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
  UNIQUE (run_id, node_id)
);
CREATE INDEX IF NOT EXISTS studio_runs_flow ON studio_runs(flow_id, created_at DESC);
CREATE INDEX IF NOT EXISTS studio_approvals_outbox ON studio_approvals(sent) WHERE decision IS NOT NULL;

ALTER TABLE studio_runs ADD COLUMN IF NOT EXISTS parent_id text REFERENCES studio_runs(id);
ALTER TABLE studio_runs ADD COLUMN IF NOT EXISTS parent_node_id text;
CREATE INDEX IF NOT EXISTS studio_runs_parent ON studio_runs(parent_id);
CREATE TABLE IF NOT EXISTS studio_example_ledger (
  run_id text NOT NULL, operation text NOT NULL, value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS studio_example_inventory(run_id text PRIMARY KEY, available integer NOT NULL);

CREATE TABLE IF NOT EXISTS studio_example_pages (
  execution_id text PRIMARY KEY, document_id text NOT NULL, page_number integer NOT NULL,
  content text NOT NULL, search_vector tsvector GENERATED ALWAYS AS (to_tsvector('english',content)) STORED
);
CREATE INDEX IF NOT EXISTS studio_example_pages_search ON studio_example_pages USING GIN(search_vector);
CREATE TABLE IF NOT EXISTS studio_example_orders (
  id text PRIMARY KEY, customer text NOT NULL, item text NOT NULL, quantity integer NOT NULL,
  notification_status text NOT NULL DEFAULT 'PENDING'
);
CREATE TABLE IF NOT EXISTS studio_example_notifications (
  id text PRIMARY KEY, channel text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS studio_example_mirror (
  execution_id text PRIMARY KEY, object_key text NOT NULL, content text NOT NULL
);
CREATE TABLE IF NOT EXISTS studio_example_refunds (
  order_id text PRIMARY KEY, customer text NOT NULL, item text NOT NULL, price numeric NOT NULL, status text NOT NULL
);

-- Optimistic edit versions protect saved workflows from stale canvas/agent writes.
ALTER TABLE studio_flows ADD COLUMN IF NOT EXISTS edit_version integer NOT NULL DEFAULT 1;
