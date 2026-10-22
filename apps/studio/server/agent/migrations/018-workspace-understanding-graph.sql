-- Accepted workspace understanding is persistent memory too, distinct from inferred navigation.
CREATE FUNCTION wa_graph_understanding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE k text:='understanding/'||NEW.id;
BEGIN
 PERFORM wa_graph_register(NEW.workspace_id,k,'workspace_understanding',jsonb_build_object('id',NEW.id,'setupId',NEW.setup_id));
 PERFORM wa_graph_evidence(NEW.workspace_id,k,NEW.source_refs);
 RETURN NEW;
END; $$;
CREATE TRIGGER wa_graph_accepted_understanding AFTER INSERT ON wa_workspace_understandings FOR EACH ROW EXECUTE FUNCTION wa_graph_understanding();
SELECT wa_graph_register(workspace_id,'understanding/'||id,'workspace_understanding',jsonb_build_object('id',id,'setupId',setup_id)) FROM wa_workspace_understandings;
SELECT wa_graph_evidence(workspace_id,'understanding/'||id,source_refs) FROM wa_workspace_understandings;
