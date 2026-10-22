ALTER TABLE wa_messages ADD COLUMN work_item_id text;
ALTER TABLE wa_messages ADD COLUMN resource_refs jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE wa_messages ADD CONSTRAINT wa_message_work_item_fk FOREIGN KEY(workspace_id,work_item_id) REFERENCES wa_work_items(workspace_id,id);
-- settle() writes its assistant message and activity in the same transaction, using the same timestamp.
-- Only backfill an unambiguous exact match; never infer links from a different session's work.
WITH matches AS (
 SELECT m.workspace_id,m.id,min(a.work_item_id) AS work_item_id
 FROM wa_messages m JOIN wa_work_items w ON w.workspace_id=m.workspace_id AND w.session_id=m.session_id
 JOIN wa_activity a ON a.workspace_id=w.workspace_id AND a.work_item_id=w.id
 WHERE m.role='assistant' AND a.summary=m.content AND a.created_at=m.created_at
 AND a.kind IN ('waiting_for_user','ready_for_review','completed','cancelled','failed','uncertain','budget_exhausted','suspended')
 GROUP BY m.workspace_id,m.id HAVING count(DISTINCT a.work_item_id)=1
)
UPDATE wa_messages m SET work_item_id=v.work_item_id FROM matches v WHERE m.workspace_id=v.workspace_id AND m.id=v.id;
CREATE INDEX wa_message_work ON wa_messages(workspace_id,work_item_id);
