# React Bits Pro components for Stack Proc

Licensed source obtained from the official authenticated React Bits Pro registry using the owner's Ultimate license. These files are adaptations, not original Stack Proc primitives. Vendor terms: https://pro.reactbits.dev/license. Do not redistribute them as a standalone component library. No license credentials are stored here.

`provenance.json` records original source hashes. `ai-chat-3` preserves the conversation frame, message presentation and stick-to-bottom behavior; `tool-calls-1` preserves the expandable tool/result cards. `agent-activity-2` adapts the collapsible timeline, and `agent-approval-2` adapts the review-card structure with host-owned actions. Demo messages, timers, fake execution and local simulated approvals are removed. Host callbacks and server state supply behavior. Existing Untitled UI controls and Font Awesome Pro icons keep application consistency. Theme variables are scoped to the agent surface; the global React Bits theme is not installed.

The tool-call result slot is bound through `lib/agent/tool-outputs.ts` and the application renderer registry; raw output is optional collapsed technical detail.

Response-placement correction: tool-call disclosures now show raw diagnostic results. Verified resource-name links are rendered inside the assistant's Markdown response; tool-output schemas remain independent of where a presentation is hosted.

Chat layout refinement: checked the official ai-chat-3 compact panel and ai-chat-1 tool/source previews in-browser against the licensed original source. The dock preserves the compact single-row header, growing single-row composer, shared send/stop position, and bounded transcript. Server state replaces the source demo streaming timers. Context is an on-demand tooltip, and accepted-message confirmation is represented by the actual message in the transcript.

Activity placement: the dock and full-screen Conversation / Activity tabs now share `agent-activity-2`. Checked its official interactive preview and licensed source before adaptation. Conversation retains messages and actionable question/proposal controls; Activity owns tool receipts, public execution summaries and expandable raw diagnostics. Status icons reflect actual recorded success, active execution or error.

`ai-blob.tsx` is the owner's supplied licensed `@reactbits-starter/ai-blob-tw` source, with only the application class-name helper adapted. The shared launcher floats above every workspace page without a footer strip. Idle motion remains animated, active server work uses the thinking mood, and simulated audio is disabled. The source's visibility and reduced-motion handling remain intact.
