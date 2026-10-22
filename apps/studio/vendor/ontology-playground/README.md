# Microsoft Ontology Playground components in Stack Proc

Source: https://github.com/microsoft/Ontology-Playground
Pinned commit: `d78965d7ab409714a52018c323278c8485838ff2`
License: MIT; Microsoft's copyright and complete license are retained in `LICENSE`.
The full reference clone is a sibling checkout at `ontology-playground`; this
vendored subset makes Stack Proc builds reproducible without that checkout.

This is source reuse, not a recreated graph: the visual designer forms, RDF
parser/serializer, Cytoscape explorer, inspector, search, insights, path finder,
legend and graph interaction helpers come from that commit.

Stack Proc adaptations:

- Per-editor Zustand stores, rather than cross-workspace global singletons.
- Stack Proc's existing header, access checks and immutable revision APIs.
- Font Awesome Pro Regular icons from the existing licensed installation.
- Neutral square graph nodes with Font Awesome artwork instead of colored circles.
- Geist, warm surfaces, official installed Untitled UI form/button controls.
- Scoped upstream CSS generated with `npm run build:ontology`; never global vendor overrides.
- Compact entity list opening the shared workflow-style configuration dialog.
- Material Design 500 entity accents and thin selection outlines.
- Stable property IDs, nested object/array schemas, required/nullable flags and
  validated schema defaults preserved through revision persistence.
- Object/array authoring and a lossless visual document
  retained alongside the native ontology projection.

The upstream quests, community submission, GitHub authentication and AI-provider
features are not mounted. No Microsoft/Azure account or public catalogue write
is required. Existing workspace intelligence continues to use MiniMax.

`components/knowledge/ontology-editor.tsx` composes the imported designer/explorer.
`lib/knowledge/playground.ts` bridges the visual model to our ontology schema.
Graph layouts are maintained during the current editing session by upstream
helpers; cross-session node-position persistence is not included in this pass.
RDF is the upstream supported visual subset; it is not an arbitrary OWL reasoner.
RDF import also recognizes typed and rdf:Description RDFS classes, prefers English
or untagged labels, and reports omitted relationships with unresolved endpoints.
Import previews explicitly warn about extra inheritance parents omitted from the
one-parent native projection; complete source assertions remain in rdfSource.
Manual multiple-parent edits still block saving in the visual model adapter.
