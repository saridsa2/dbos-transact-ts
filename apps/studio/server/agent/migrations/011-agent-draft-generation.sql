ALTER TABLE wa_setup_runs ADD COLUMN mode text NOT NULL DEFAULT 'setup' CHECK(mode IN ('setup','specialist'));
ALTER TABLE wa_setup_runs ADD COLUMN draft_agent_id text;
ALTER TABLE wa_setup_runs ADD FOREIGN KEY(workspace_id,draft_agent_id) REFERENCES wa_agent_definitions(workspace_id,id);
