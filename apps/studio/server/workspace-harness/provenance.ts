import { contentHash } from '../../lib/knowledge/contracts';
import manifest from '../../vendor/claude-src-import.json';
import { readFile, readdir } from 'node:fs/promises';
// Freeze the executable files this worker loaded; edits on disk do not relabel a live process.
const implementationHash = (async () => {
  const files: string[] = [];
  for (const directory of ['./', '../agent/', '../agent/context/'])
    for (const entry of await readdir(new URL(directory, import.meta.url))) {
      if (
        entry.endsWith('.ts') &&
        !entry.endsWith('.test.ts') &&
        !entry.startsWith('harness2') &&
        !entry.startsWith('legacy-')
      )
        files.push(directory + entry);
    }
  files.push(
    '../../lib/processes/agent.ts',
    '../../lib/agent/contracts.ts',
    '../../lib/agent/tool-outputs.ts',
    '../../lib/agent/interactions.ts',
    '../../lib/agent/memory.ts',
    '../../lib/agent/definitions.ts',
    '../../vendor/mem0-oss/PROVENANCE.json',
  );
  return contentHash(
    await Promise.all(
      files.sort().map(async (file) => ({ file, source: await readFile(new URL(file, import.meta.url), 'utf8') })),
    ),
  );
})();
export async function harnessProvenance(fixture = false) {
  return {
    engine: 'stackproc-workspace-harness',
    revision: '2',
    provider: fixture ? 'integration-fixture' : 'minimax',
    implementation: 'standalone-source-port',
    sourceSnapshotHash: await contentHash(manifest.files.filter((file) => !file.path.startsWith('.grepai/'))),
    implementationHash: await implementationHash,
    upstreamEngine: false,
    capabilities: {
      durableTurns: true,
      typedQuestions: true,
      tools: true,
      compaction: true,
      microcompaction: true,
      tokenStreaming: true,
      readConcurrency: true,
      hooks: true,
      skills: true,
      plugins: true,
      mcp: true,
      subagents: true,
      sessionForks: true,
      structuredOutput: true,
      steering: true,
      plans: true,
      reviewedMemory: true,
      observationalHistory: true,
      approvedSemanticRecall: true,
      sandboxedCode: true,
      schedules: true,
    },
  };
}
