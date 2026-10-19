import type { FlowNodeData } from '../flows/types';
import { configDefinition } from '../native/node-config';
import { nodeClassification } from './editor-contract';
export type NodeHelp = {
  purpose: string;
  input: string;
  process: string;
  output: string;
  tips: string[];
  reference?: string;
};
const workflowDocs = 'https://docs.dbos.dev/typescript/tutorials/workflow-tutorial';
const communicationDocs = 'https://docs.dbos.dev/typescript/tutorials/workflow-communication';
const help: Partial<Record<FlowNodeData['kind'], NodeHelp>> = {
  trigger: {
    purpose: 'Defines where this workflow starts.',
    input: 'Data is supplied by the manual run, API, schedule or other configured entry point.',
    process: 'Name this entry point and describe the input expected by the workflow.',
    output: 'Following steps can reference the workflow input.',
    tips: ['Configure schedules and queues in Workflow settings. Entry-point configuration does not run the workflow.'],
    reference: workflowDocs,
  },
  construct: {
    purpose: 'Build one value from fields, lists and references to existing workflow data.',
    input: 'Select existing data directly on each field using Use workflow data.',
    process:
      'Add named fields and choose Fixed values or Expressions. Expand objects and lists to edit their contents.',
    output: 'The constructed value becomes this node’s result. It does not update workflow variables.',
    tips: [
      'Fixed enters a value directly. Expression calculates or references a value.',
      'Use a whole-value expression when you want to pass an existing object or list unchanged.',
    ],
  },
  setVariables: {
    purpose: 'Update declared writable values in the current workflow scope.',
    input: 'Choose the replacement value for each assignment.',
    process: 'Select Fixed or Expression for each variable you intend to update.',
    output: 'Assignments update the current scope together after validation.',
    tips: [
      'Declare variables in Workflow settings first. Inherited values are read-only.',
      'Parallel branches do not mutate their parent’s variables. Export and combine results explicitly.',
    ],
  },
  code: {
    purpose: 'Run one JavaScript or TypeScript transformation in an isolated runtime.',
    input: 'Map the value your program receives as input. The input contract describes the expected shape.',
    process:
      'Write the program in Editor and return its result. Runtime limits bound execution time, memory and output size.',
    output: 'Return a JSON value that satisfies the Return contract. Variables are read-only within this program.',
    tips: [
      'Example: return input.items.map(value => value * variables.factor);',
      'This profile has no network access, credentials or package imports. Use integration operations for external calls.',
      'Test code is a standalone runner invocation; it does not create a durable workflow checkpoint.',
    ],
  },
  merge: {
    purpose: 'Coordinate incoming paths and combine their explicitly exported results.',
    input: 'Reference the named results you need in Process.',
    process: 'Build the combined result and optionally assign declared writable parent variables.',
    output: 'The configured result is available after the join. Variable assignments validate before they commit.',
    tips: [
      'This existing control combines joining and result mapping. It is classified as a control structure, not a plain data operation.',
      'Do not assume branch-local variable changes are inherited by the parent.',
    ],
  },
  step: {
    purpose: 'Execute one installed server operation with a durable checkpoint.',
    input: 'Provide the arguments expected by the selected operation.',
    process: 'Choose the registered operation. Configure retries and timeout only when its behavior supports them.',
    output: 'The operation’s registered implementation determines the result.',
    tips: [
      'A completed checkpoint is reused during recovery.',
      'External side effects can still require provider idempotency or reconciliation. A retry is not an exactly-once guarantee.',
    ],
    reference: 'https://docs.dbos.dev/typescript/tutorials/step-tutorial',
  },
  transaction: {
    purpose: 'Execute one registered database operation through a DBOS-aware datasource transaction.',
    input: 'Provide the arguments required by that transaction.',
    process: 'Choose the registered datasource transaction.',
    output: 'Returns the committed operation result or a transaction failure.',
    tips: [
      'The application database changes and checkpoint commit together.',
      'A normal external database request is not automatically a DBOS datasource transaction.',
    ],
    reference: 'https://docs.dbos.dev/typescript/tutorials/transaction-tutorial',
  },
  delay: {
    purpose: 'Pause this running workflow for a duration, surviving process restarts.',
    input: 'No separate data payload is required.',
    process: 'Set the duration in milliseconds, directly or using workflow data.',
    output: 'Execution continues after the durable wait completes.',
    tips: [
      'A delayed workflow submission postpones starting a workflow. Delay pauses a workflow that has already started.',
    ],
    reference: workflowDocs,
  },
  decision: {
    purpose: 'Evaluate a condition and select its true or false graph path.',
    input: 'Reference the values being compared inside the condition.',
    process: 'Choose an operator and its left/right values. Truthy needs one value.',
    output: 'The graph follows the matching true or false edge.',
    tips: ['Connect the outgoing paths on the canvas. This dialog does not contain the branch’s work.'],
  },
  workflow: {
    purpose: 'Invoke an inspectable child workflow with explicitly mapped input.',
    input: 'Map the child input required by the referenced workflow.',
    process:
      'Select the child workflow and choose whether to await its result or start it in the background. Queue settings control dispatch.',
    output: 'Await mode returns the child result. Start mode returns its execution reference.',
    tips: [
      'Open the referenced graph to inspect or configure its internal steps.',
      'Background starts can be followed by Await results when their results are needed.',
    ],
    reference: workflowDocs,
  },
  await: {
    purpose: 'Collect the results of previously started workflow executions.',
    input: 'Supply the workflow execution references returned by background starts.',
    process: 'This existing operation waits for and collects those results.',
    output: 'Results are returned in the order of the supplied references.',
    tips: [
      'This Stack Proc operation includes result retrieval. It is not a direct UI wrapper for DBOS.waitAll, which returns completed handles.',
    ],
    reference: workflowDocs,
  },
  foreach: {
    purpose: 'Run an explicit child graph for each value in a collection.',
    input: 'Map the collection of items to process.',
    process:
      'Select the child graph and sequential, parallel or background execution. Set an item limit and supported concurrency.',
    output: 'Sequential/parallel modes collect ordered results. Background mode returns child execution references.',
    tips: [
      'Open the inner graph to configure the work performed for each item.',
      'A collection remains one value until this control explicitly iterates it.',
    ],
    reference: workflowDocs,
  },
  loop: {
    purpose: 'Repeat an explicit child graph while a condition remains true.',
    input: 'Supply the initial loop state.',
    process: 'Select the child graph, continuation condition and maximum iteration count.',
    output: 'Returns the loop completion data defined by the existing runtime.',
    tips: [
      'Configure the repeated work in the child graph, not inside this dialog.',
      'Always define a termination condition and finite iteration bound.',
    ],
    reference: workflowDocs,
  },
  parallel: {
    purpose: 'Execute named child workflow branches in isolated scopes.',
    input: 'Configure each branch’s input with its referenced workflow.',
    process: 'Add named branches and open their graphs to configure the work.',
    output:
      'Scoped workflows expose results by stable branch identity; older workflows retain their saved result format.',
    tips: [
      'A branch’s variable writes do not update the parent.',
      'Use an explicit join and combine the results the parent needs.',
    ],
    reference: workflowDocs,
  },
  send: {
    purpose: 'Send one message to a workflow on a named topic.',
    input: 'Provide the destination execution ID and message value.',
    process: 'Set the topic to match the receiver.',
    output: 'Continues after the send completes.',
    tips: [
      'A message is consumed by a matching Receive message operation. An event is an updatable named value instead.',
    ],
    reference: communicationDocs,
  },
  receive: {
    purpose: 'Wait durably for the next message on a topic.',
    input: 'No separate data payload is required.',
    process: 'Set the topic and timeout. Senders must use this execution’s ID and the same topic.',
    output: 'Returns the received value. The existing runtime returns null on timeout.',
    tips: [
      'Handle timeout explicitly in the graph.',
      'This existing contract cannot distinguish a nullable message from timeout; avoid null payloads.',
    ],
    reference: communicationDocs,
  },
  event: {
    purpose: 'Publish or update one named value associated with this workflow execution.',
    input: 'Provide the value to publish.',
    process: 'Choose the event name.',
    output: 'Continues after publication.',
    tips: ['Publishing again updates the named value. Use messages for consumable per-topic delivery.'],
    reference: communicationDocs,
  },
  waitEvent: {
    purpose: 'Read a named event from another workflow, waiting if necessary.',
    input: 'Provide the workflow execution ID.',
    process: 'Set the event name and timeout.',
    output: 'Returns the event value; the existing runtime returns null on timeout.',
    tips: ['Events expose the latest published value. They are not a queue of changes.'],
    reference: communicationDocs,
  },
  return: {
    purpose: 'Complete the current workflow with a result.',
    input: 'Choose the value to return.',
    process: 'Name and describe this terminal operation.',
    output: 'The returned value is exposed to the workflow’s caller.',
    tips: ['Returning a value completes this scope. Connect only the path that should finish here.'],
  },
  assign: {
    purpose: 'Construct a value using the older mapping operation.',
    input: 'Choose the mapped value.',
    process: 'Configure the value or reference.',
    output: 'The mapped value becomes this node’s result.',
    tips: ['Existing workflows remain supported. New scoped workflows offer Construct data instead.'],
  },
  review: {
    purpose: 'Run the existing human-review composition.',
    input: 'Provide review instructions.',
    process: 'Set the review timeout.',
    output: 'The existing review handler produces the decision used by following steps.',
    tips: [
      'This is a legacy composition. New atomic designs separate request delivery, response receipt and decision evaluation.',
    ],
  },
};
export function nodeHelp(node: FlowNodeData): NodeHelp {
  const kind = node.config.code ? 'code' : node.kind;
  return (
    help[kind] ?? {
      purpose: `Configure ${configDefinition(node)?.title ?? node.kind}.`,
      input: 'Configure the values required by this installed definition.',
      process:
        nodeClassification(kind) === 'legacy-composition'
          ? 'This legacy offering may compose multiple operations. Inspect its existing configuration.'
          : 'Configure the behavior exposed by the installed definition.',
      output: 'The installed implementation defines the returned data and outcomes.',
      tips: [
        'Use workflow data to reference values from earlier steps.',
        'No operation runs merely by opening this dialog.',
      ],
    }
  );
}
