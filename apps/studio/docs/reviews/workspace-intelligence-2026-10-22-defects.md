# Workspace Intelligence: live screen review, 22 October 2026

Scope: Workspace Intelligence only. UI findings were inspected in the existing Banking session and the fresh Banking · End-to-end verification workspace. UI layouts were not changed during the review.

| Finding                       | Observed behavior                                                                                                                                       | Required behavior                                                                                                                                   | Tracking                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| Instruction/response identity | Alignment and prose alone do not clearly identify user instructions, model responses and system notices across activity history.                        | Consistent accessible role labels and message boundaries; preserve formatted responses and evidence links.                                          | [#10](https://github.com/saridsa2/dbos-transact-ts/issues/10) |
| Thinking placement            | Header/work-status ThinkingState; ChatScreen explicitly disables its thinking indicator.                                                                | Progress belongs immediately after the active instruction in the message area; header retains overall status and Stop.                              | [#11](https://github.com/saridsa2/dbos-transact-ts/issues/11) |
| Execution shell               | Outer title is Execution/Activity; inner Execution details title, status and tabs scroll with long receipts. Reproduced by scrolling the receipt panel. | One pinned Execution details title, pinned status/tab navigation, scrolling selected-tab content only.                                              | [#12](https://github.com/saridsa2/dbos-transact-ts/issues/12) |
| Receipt rendering             | Entire receipt serialized as fenced JSON into a document ArtifactPanel. Preview is a dump; Markdown displays the literal fenced source.                 | Receipt-aware preview and correctly typed JSON/Markdown source renderers. The library has rendering support; the host integration is misconfigured. | [#13](https://github.com/saridsa2/dbos-transact-ts/issues/13) |
| Fresh setup readiness         | Overview instructs the user to add knowledge/provider access although both exist and setup is running.                                                  | Separate prerequisite, inspection and activation states, with a direct link to current inspection.                                                  | [#14](https://github.com/saridsa2/dbos-transact-ts/issues/14) |
| Setup structured output       | Fresh setup reached a free-text JSON validation retry before completing.                                                                                | Adopt the harness internal structured-result tool contract for setup output too.                                                                    | [#15](https://github.com/saridsa2/dbos-transact-ts/issues/15) |

## Model/history defect

[#9](https://github.com/saridsa2/dbos-transact-ts/issues/9) records the original failure: valid observations wrapped in Markdown were rejected by free-text JSON parsing; the repair repeated the wrapping. History observation/reflection now use an internal named result tool through the shared harness contract. Live validation also exposed an invalid reflection enum. The schema remains strict; rejected work maintenance preserves the last valid checkpoint and original receipts, records deferred maintenance, and continues if the original context fits safely. No invalid summary advances the checkpoint. Unknown provider outcomes are not replayed.

Build, 37 targeted tests, 38 durable-harness integration tests and 70 general runtime integration tests pass. A live MiniMax named-result probe passed. Setup's separate adoption gap remains open as #15.

## Fresh workspace check

Workspace: Banking · End-to-end verification (`d23f66c3-b943-43f1-909a-e65fa5c96849`). Existing source-backed banking records were copied through the application API as fresh saved artifacts: BIAN reference, original FIBO RDF source, FIBO ontology and BIAN-informed onboarding process. This checks saved-artifact onboarding; it does not retest the RDF import dialog/parser itself.

A new provider connection and workspace policy were configured. Setup completed after one JSON-format retry; the advisory coordinator was reviewed and activated with compact/observational memory, approved-memory retrieval and read/proposal-only tools. Domain execution remains disconnected; jurisdiction, bank policy, integrations and reviewer independence are recorded demo gaps. The memory graph and local embedding runtime report ready. Sample editor and viewer memberships were added; API permission checks confirm editor upload allowed and viewer upload denied.

The fresh activity failed the end-to-end progress check: it repeatedly reread receipts and reached the configured tool-call cap after 10 rounds and 151,264 recorded tokens, before QA cancellation was issued. This is logged as [#16](https://github.com/saridsa2/dbos-transact-ts/issues/16). The earlier context-format exception did not recur. Its final outcome is recorded in the private verification state at `.studio/procczar-validation-2026-10-22/state.json`; credentials are not stored in that state.

## Screen evidence

Local screenshots under `/Users/satyasuman/Downloads/Projects/dbos/output/branding/`:

- `intelligence-execution-defects.png`
- `intelligence-execution-scroll-defect.png`
- `intelligence-receipt-markdown-defect.png`
- `procczar-fresh-workspace-readiness.png`
- `procczar-fresh-activity-thinking.png`
