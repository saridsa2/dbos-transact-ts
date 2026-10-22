CREATE TABLE wa_graph_roots (
    workspace_id text PRIMARY KEY, generation bigint NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE wa_graph_nodes (
    workspace_id text NOT NULL REFERENCES wa_graph_roots(workspace_id) ON DELETE CASCADE,
    key text NOT NULL, kind text NOT NULL, ref jsonb NOT NULL, payload jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(workspace_id,key)
  );
  CREATE TABLE wa_graph_edges (
    workspace_id text NOT NULL, key text NOT NULL, from_key text NOT NULL, to_key text NOT NULL,
    owner_key text NOT NULL, kind text NOT NULL, payload jsonb, PRIMARY KEY(workspace_id,key),
    FOREIGN KEY(workspace_id,from_key) REFERENCES wa_graph_nodes(workspace_id,key) ON DELETE CASCADE,
    FOREIGN KEY(workspace_id,to_key) REFERENCES wa_graph_nodes(workspace_id,key) ON DELETE CASCADE,
    FOREIGN KEY(workspace_id,owner_key) REFERENCES wa_graph_nodes(workspace_id,key) ON DELETE CASCADE
  );
  CREATE INDEX wa_graph_from ON wa_graph_edges(workspace_id,from_key);
  CREATE INDEX wa_graph_to ON wa_graph_edges(workspace_id,to_key);
  CREATE INDEX wa_graph_owner ON wa_graph_edges(workspace_id,owner_key,kind);
ALTER TABLE wa_graph_roots ADD CONSTRAINT wa_graph_workspace FOREIGN KEY(workspace_id) REFERENCES cp_workspaces(id) ON DELETE CASCADE;
CREATE INDEX wa_graph_node_kind ON wa_graph_nodes(workspace_id,kind);
CREATE TABLE wa_graph_extractions (
 workspace_id text NOT NULL,node_key text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','issued','ready','quarantined','uncertain')),
 receipt_id text,work_item_id text,updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,node_key),
 FOREIGN KEY(workspace_id,node_key) REFERENCES wa_graph_nodes(workspace_id,key) ON DELETE CASCADE,
 FOREIGN KEY(workspace_id,receipt_id) REFERENCES wa_calls(workspace_id,id)
);

-- Registry nodes contain provenance pointers only. Canonical content stays in its encrypted table.
CREATE FUNCTION wa_graph_register(w text,k text,t text,r jsonb,needs_extraction boolean DEFAULT false) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO wa_graph_roots(workspace_id) VALUES(w) ON CONFLICT DO NOTHING;
 INSERT INTO wa_graph_nodes(workspace_id,key,kind,ref) VALUES(w,'workspace','workspace',jsonb_build_object('id',w)) ON CONFLICT DO NOTHING;
 INSERT INTO wa_graph_nodes(workspace_id,key,kind,ref) VALUES(w,k,t,r) ON CONFLICT DO NOTHING;
 IF FOUND THEN UPDATE wa_graph_roots SET generation=generation+1 WHERE workspace_id=w; END IF;
 IF k<>'workspace' THEN
  INSERT INTO wa_graph_edges(workspace_id,key,from_key,to_key,owner_key,kind)
  VALUES(w,k||'/registered',k,'workspace',k,'registered_in') ON CONFLICT DO NOTHING;
 END IF;
 IF needs_extraction THEN
  INSERT INTO wa_graph_extractions(workspace_id,node_key) VALUES(w,k) ON CONFLICT DO NOTHING;
 END IF;
END; $$;
CREATE FUNCTION wa_graph_workspace_created() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 PERFORM wa_graph_register(NEW.id,'workspace','workspace',jsonb_build_object('id',NEW.id));
 RETURN NEW;
END; $$;
CREATE TRIGGER wa_graph_workspace AFTER INSERT ON cp_workspaces FOR EACH ROW EXECUTE FUNCTION wa_graph_workspace_created();

CREATE FUNCTION wa_graph_evidence(w text,k text,evidence jsonb) RETURNS void LANGUAGE plpgsql AS $$
DECLARE e jsonb; target text;
BEGIN
 FOR e IN SELECT * FROM jsonb_array_elements(evidence) LOOP
  IF EXISTS(SELECT 1 FROM wi_revisions r JOIN wi_artifacts a ON a.workspace_id=r.workspace_id AND a.id=r.artifact_id
   WHERE r.workspace_id=w AND r.artifact_id=e->>'id' AND r.id=e->>'revisionId' AND a.kind=e->>'kind') THEN
   target:='artifact/'||(e->>'id')||'/'||(e->>'revisionId');
   PERFORM wa_graph_register(w,target,'artifact_revision',jsonb_build_object('id',e->>'id','revisionId',e->>'revisionId','kind',e->>'kind'));
   INSERT INTO wa_graph_edges(workspace_id,key,from_key,to_key,owner_key,kind)
   VALUES(w,k||'/evidence/'||target,k,target,k,'supported_by') ON CONFLICT DO NOTHING;
  END IF;
 END LOOP;
END; $$;
CREATE FUNCTION wa_graph_capture() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j jsonb:=to_jsonb(NEW); k text; t text; r jsonb; x boolean:=false; w text:=j->>'workspace_id';
BEGIN
 CASE TG_TABLE_NAME
 WHEN 'wa_memory_versions' THEN
  k:='memory/'||(j->>'memory_id')||'/'||(j->>'version'); t:='approved_memory_version';
  r:=jsonb_build_object('memoryId',j->>'memory_id','version',(j->>'version')::integer); x:=true;
 WHEN 'wa_history_segments' THEN
  k:='history/'||md5((j->>'stream_key')||':'||(j->>'scope_hash'))||'/'||(j->>'generation'); t:='history_segment';
  r:=jsonb_build_object('stream',j->>'stream_key','scopeHash',j->>'scope_hash','generation',(j->>'generation')::integer,'workId',j->>'work_item_id');
 WHEN 'wa_work_context_snapshots' THEN
  k:='context/'||(j->>'work_item_id')||'/'||(j->>'revision'); t:='working_context';
  r:=jsonb_build_object('workId',j->>'work_item_id','revision',(j->>'revision')::integer,'scopeHash',j->>'scope_hash');
 WHEN 'wa_memories' THEN
  k:='answer/'||(j->>'id'); t:='accepted_answer';
  r:=jsonb_build_object('id',j->>'id','workId',j->>'work_item_id','decisionId',j->>'decision_id');
 WHEN 'wa_history_heads' THEN
  k:='history-head/'||md5((j->>'stream_key')||':'||(j->>'scope_hash')); t:='history_head';
  r:=jsonb_build_object('stream',j->>'stream_key','scopeHash',j->>'scope_hash');
 ELSE RAISE EXCEPTION 'Unknown graph memory source';
 END CASE;
 PERFORM wa_graph_register(w,k,t,r,x);
 IF TG_TABLE_NAME='wa_memory_versions' THEN PERFORM wa_graph_evidence(w,k,j->'evidence'); END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER wa_graph_memory AFTER INSERT ON wa_memory_versions FOR EACH ROW EXECUTE FUNCTION wa_graph_capture();
CREATE TRIGGER wa_graph_history AFTER INSERT ON wa_history_segments FOR EACH ROW EXECUTE FUNCTION wa_graph_capture();
CREATE TRIGGER wa_graph_context AFTER INSERT ON wa_work_context_snapshots FOR EACH ROW EXECUTE FUNCTION wa_graph_capture();
CREATE TRIGGER wa_graph_answer AFTER INSERT ON wa_memories FOR EACH ROW EXECUTE FUNCTION wa_graph_capture();
CREATE TRIGGER wa_graph_history_head AFTER INSERT ON wa_history_heads FOR EACH ROW EXECUTE FUNCTION wa_graph_capture();

-- Structural knowledge bootstrap. No label-based identity merging and no claimed full RDF coverage.
CREATE FUNCTION wa_graph_artifact() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a wi_artifacts; root text; entity jsonb; prop jsonb; rel jsonb; element jsonb; lane jsonb;
 ek text; pk text; fk text; tk text;
BEGIN
 SELECT * INTO STRICT a FROM wi_artifacts WHERE workspace_id=NEW.workspace_id AND id=NEW.artifact_id;
 root:='artifact/'||a.id||'/'||NEW.id;
 PERFORM wa_graph_register(NEW.workspace_id,root,'artifact_revision',jsonb_build_object('id',a.id,'revisionId',NEW.id,'kind',a.kind));
 IF a.kind='ontology' THEN
  FOR entity IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.content->'entities','[]'::jsonb)) LOOP
   ek:=root||'/entity/'||(entity->>'id');
   PERFORM wa_graph_register(NEW.workspace_id,ek,'ontology_concept',jsonb_build_object('id',a.id,'revisionId',NEW.id,'elementId',entity->>'id'));
   INSERT INTO wa_graph_edges(workspace_id,key,from_key,to_key,owner_key,kind) VALUES(NEW.workspace_id,ek||'/member',root,ek,root,'contains') ON CONFLICT DO NOTHING;
   FOR prop IN SELECT * FROM jsonb_array_elements(COALESCE(entity->'properties','[]'::jsonb)) LOOP
    pk:=ek||'/property/'||(prop->>'id');
    PERFORM wa_graph_register(NEW.workspace_id,pk,'ontology_property',jsonb_build_object('id',a.id,'revisionId',NEW.id,'entityId',entity->>'id','elementId',prop->>'id'));
    INSERT INTO wa_graph_edges(workspace_id,key,from_key,to_key,owner_key,kind) VALUES(NEW.workspace_id,pk||'/member',ek,pk,root,'has_property') ON CONFLICT DO NOTHING;
   END LOOP;
  END LOOP;
  FOR entity IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.content->'entities','[]'::jsonb)) LOOP
   fk:=root||'/entity/'||(entity->>'id'); tk:=root||'/entity/'||(entity->>'parentId');
   IF EXISTS(SELECT 1 FROM wa_graph_nodes WHERE workspace_id=NEW.workspace_id AND key=tk) THEN
    INSERT INTO wa_graph_edges(workspace_id,key,from_key,to_key,owner_key,kind)
    VALUES(NEW.workspace_id,fk||'/parent',fk,tk,root,'subclass_of') ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
  FOR rel IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.content->'relationships','[]'::jsonb)) LOOP
   fk:=root||'/entity/'||(rel->>'sourceId'); tk:=root||'/entity/'||(rel->>'targetId');
   IF EXISTS(SELECT 1 FROM wa_graph_nodes WHERE workspace_id=NEW.workspace_id AND key=fk) AND EXISTS(SELECT 1 FROM wa_graph_nodes WHERE workspace_id=NEW.workspace_id AND key=tk) THEN
    INSERT INTO wa_graph_edges(workspace_id,key,from_key,to_key,owner_key,kind,payload) VALUES(NEW.workspace_id,root||'/relation/'||(rel->>'id'),fk,tk,root,'ontology_relation',jsonb_build_object('elementId',rel->>'id')) ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
 ELSIF a.kind='process' THEN
  FOR lane IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.content->'lanes','[]'::jsonb)) LOOP
   PERFORM wa_graph_register(NEW.workspace_id,root||'/lane/'||(lane->>'id'),'process_lane',jsonb_build_object('id',a.id,'revisionId',NEW.id,'elementId',lane->>'id'));
  END LOOP;
  FOR element IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.content->'graph'->'elements','[]'::jsonb)) LOOP
   ek:=root||'/element/'||(element->>'id');
   PERFORM wa_graph_register(NEW.workspace_id,ek,'process_element',jsonb_build_object('id',a.id,'revisionId',NEW.id,'elementId',element->>'id'));
   INSERT INTO wa_graph_edges(workspace_id,key,from_key,to_key,owner_key,kind) VALUES(NEW.workspace_id,ek||'/member',root,ek,root,'contains') ON CONFLICT DO NOTHING;
   tk:=root||'/lane/'||(element->>'laneId');
   IF EXISTS(SELECT 1 FROM wa_graph_nodes WHERE workspace_id=NEW.workspace_id AND key=tk) THEN
    INSERT INTO wa_graph_edges(workspace_id,key,from_key,to_key,owner_key,kind) VALUES(NEW.workspace_id,ek||'/lane',ek,tk,root,'in_lane') ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
  FOR rel IN SELECT * FROM jsonb_array_elements(COALESCE(NEW.content->'graph'->'flows','[]'::jsonb)) LOOP
   fk:=root||'/element/'||(rel->>'source'); tk:=root||'/element/'||(rel->>'target');
   IF EXISTS(SELECT 1 FROM wa_graph_nodes WHERE workspace_id=NEW.workspace_id AND key=fk) AND EXISTS(SELECT 1 FROM wa_graph_nodes WHERE workspace_id=NEW.workspace_id AND key=tk) THEN
    INSERT INTO wa_graph_edges(workspace_id,key,from_key,to_key,owner_key,kind,payload) VALUES(NEW.workspace_id,root||'/flow/'||(rel->>'id'),fk,tk,root,'sequence_flow',jsonb_build_object('elementId',rel->>'id')) ON CONFLICT DO NOTHING;
   END IF;
  END LOOP;
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER wa_graph_artifact_revision AFTER INSERT ON wi_revisions FOR EACH ROW EXECUTE FUNCTION wa_graph_artifact();

-- Backfill via the same registration functions, without rewriting immutable source rows.
SELECT wa_graph_register(id,'workspace','workspace',jsonb_build_object('id',id)) FROM cp_workspaces;
SELECT wa_graph_register(workspace_id,'memory/'||memory_id||'/'||version,'approved_memory_version',jsonb_build_object('memoryId',memory_id,'version',version),true) FROM wa_memory_versions;
SELECT wa_graph_register(workspace_id,'history/'||md5(stream_key||':'||scope_hash)||'/'||generation,'history_segment',jsonb_build_object('stream',stream_key,'scopeHash',scope_hash,'generation',generation,'workId',work_item_id)) FROM wa_history_segments;
SELECT wa_graph_register(workspace_id,'context/'||work_item_id||'/'||revision,'working_context',jsonb_build_object('workId',work_item_id,'revision',revision,'scopeHash',scope_hash)) FROM wa_work_context_snapshots;
SELECT wa_graph_register(workspace_id,'answer/'||id,'accepted_answer',jsonb_build_object('id',id,'workId',work_item_id,'decisionId',decision_id)) FROM wa_memories;
SELECT wa_graph_register(workspace_id,'history-head/'||md5(stream_key||':'||scope_hash),'history_head',jsonb_build_object('stream',stream_key,'scopeHash',scope_hash)) FROM wa_history_heads;
-- Replay revision inserts into a temporary trigger bridge for structural backfill only.
CREATE TEMP TABLE wa_graph_backfill (LIKE wi_revisions INCLUDING DEFAULTS) ON COMMIT DROP;
CREATE TRIGGER wa_graph_backfill_revision AFTER INSERT ON wa_graph_backfill FOR EACH ROW EXECUTE FUNCTION wa_graph_artifact();
INSERT INTO wa_graph_backfill SELECT * FROM wi_revisions;

SELECT wa_graph_evidence(workspace_id,'memory/'||memory_id||'/'||version,evidence) FROM wa_memory_versions;
