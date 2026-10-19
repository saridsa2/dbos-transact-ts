# Framework node offerings

## Scope and dependency

Expose framework execution capabilities through the existing canvas and DBOS runtime. Frameworks consume customer-owned model/tool connections from the control plane. Account onboarding and credential management stay in the control plane.

This spec is separate from implementation of provider adapters. The source review and pinned versions are in [Provider node abstraction and offerings](../provider-node-abstraction.md).

## Initial offerings

| Framework           | Execution offerings                                                                                                                              | Resources                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Vercel AI           | Text generation/streaming, tool-loop agent execution, registered/MCP tools, subagent delegation, embeddings and image generation where supported | Model, messages/prompts, schemas, tools, agent definition, streams, limits and compatible connection          |
| CrewAI              | Durable agent-task execution                                                                                                                     | Versioned agent role/goal/backstory, task/expected output/context, tools, model connections and Python worker |
| Swarm compatibility | Conversation, function tools, active-agent handoff and context                                                                                   | Agent definitions, message/context state and Python worker; mark legacy status                                |

A model vendor and an agent framework are distinct dimensions. Vercel AI and CrewAI can select compatible OpenAI, Anthropic or Foundry model connections through their adapters.

## Contracts

Each offering declares stable ID/version, input/output/configuration schemas, required connection types, runtime language, checkpoint owner, cancellation behavior and supported policies. A node binds an offering, its resources and typed inputs. A run snapshot pins definitions and connection revisions without key values.

Agents execute at workflow level so their internal model/tool boundaries remain independently durable. Ordinary tool adapters can execute as steps; datasource tools preserve transactions; delegated agents execute as children. CrewAI requires a Python worker protocol with stable dispatch IDs, result retrieval and restart-time registration reconstruction.

Delegation returns to a parent. Handoff changes the active agent and preserves conversation state. The renderer and interpreter must preserve this distinction. Streams require their own cursor/attempt/replacement handling alongside node status events.

## Sequence and acceptance

After the control plane contract is stable, add schema-driven offering registration and workflow-capable adapter dispatch. Implement Vercel non-streaming calls/tools/subagents first, then streams and other model modalities. Add CrewAI after a tested Python transport. Evaluate the DBOS OpenAI Agents integration for new agent execution while preserving imported Swarm semantics.

Use deterministic test adapters to validate checkpoint boundaries before live credentials are configured. Acceptance requires completed-call reuse across restart, isolated concurrent model work, bounded execution, stable child IDs, no plaintext key in checkpoints/outputs, connection authorization, cancellation and explicit unavailable-provider errors.
