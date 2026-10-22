import type { AgentService } from './service';
import type { Context } from '../../lib/control/contracts';
import type { AgentExtensions } from '../workspace-harness/extensions';
import { UncertainToolError } from '../workspace-harness/extensions';
import { contentHash } from '../../lib/knowledge/contracts';
export async function extensionTool(input: {
  service: AgentService;
  principal: Context;
  workId: string;
  invocationId: string;
  name: string;
  args: unknown;
  resolved: ReturnType<AgentExtensions['resolve']>;
  readOnly: boolean;
  signal: AbortSignal;
}) {
  const found = input.resolved.get(input.name);
  if (!found) throw Error('This extension tool is not enabled.');
  if (!found.input(input.args)) throw Error('Tool input does not match its registered schema.');
  const { service, workId, principal } = input,
    workspace = principal.workspace.id;
  if (input.readOnly && found.tool.effect !== 'read')
    throw Error('Delegated read-only work cannot mutate workspace or external state.');
  if (found.tool.effect === 'write') {
    const hash = await contentHash(input.args);
    const row = (
      await service.pool.query(
        'SELECT * FROM wa_tool_approvals WHERE workspace_id=$1 AND work_item_id=$2 AND tool_name=$3 AND args_hash=$4',
        [workspace, workId, input.name, hash],
      )
    ).rows[0];
    if (!row) {
      const id = crypto.randomUUID();
      await service.pool.query(
        "INSERT INTO wa_tool_approvals(workspace_id,id,work_item_id,tool_name,args_hash,state) VALUES($1,$2,$3,$4,$5,'pending')",
        [workspace, id, workId, input.name, hash],
      );
      return {
        question: `Allow ${input.name} to perform this action?`,
        interaction: {
          id,
          question: `Allow ${input.name} to perform this action?`,
          fields: [
            {
              id: 'approved',
              label: 'Approve this exact action',
              hint: 'Approval applies only to this tool and its recorded input.',
              type: 'boolean',
              required: true,
            },
          ],
        },
        approval: { id, tool: input.name, arguments: input.args },
      };
    }
    if (row.state !== 'approved')
      throw Error(
        row.state === 'denied' ? 'The user denied this exact action.' : 'This action still requires user approval.',
      );
    const claimed = await service.pool.query(
      'UPDATE wa_tool_approvals SET consumed_call_id=$3 WHERE workspace_id=$1 AND id=$2 AND (consumed_call_id IS NULL OR consumed_call_id=$3) RETURNING id',
      [workspace, row.id, input.invocationId],
    );
    if (!claimed.rowCount) throw Error('This approval was already used for another invocation.');
  }
  try {
    const result = await found.tool.execute(input.args, {
      service,
      principal,
      workId,
      invocationId: input.invocationId,
      signal: input.signal,
    });
    if (Buffer.byteLength(JSON.stringify(result)) > 64000) throw Error('Extension output exceeds 64 KiB.');
    if (found.output && !found.output(result)) throw Error('Extension result does not match its registered schema.');
    return { output: result };
  } catch (error) {
    if (found.tool.effect === 'write')
      throw new UncertainToolError(
        'An approved tool action did not produce a validated result. Its outcome requires review.',
      );
    throw error;
  }
}
