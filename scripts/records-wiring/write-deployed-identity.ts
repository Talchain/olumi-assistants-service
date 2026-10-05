/** Run offline from a clean checkout of the deployed SHA; never calls a provider. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { buildStrictDraftRecordsSchema } from '../../src/orchestrator-v5/agent-lane/runtime/build-model-from-records.js';
import { vNextDraftRecordsInstructionHash } from '../../src/cee/draft/records/instruction-vnext.js';

const path = process.argv[2];
if (!path) throw new Error('Usage: node --import tsx scripts/records-wiring/write-deployed-identity.ts <identity.json>');
execFileSync('git', ['diff', '--quiet']);
execFileSync('git', ['diff', '--cached', '--quiet']);
const identity = {
  cee_build: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
  // The served records path sends the V-NEXT instruction (instruction-vnext.ts).
  prompt_sha256: vNextDraftRecordsInstructionHash(),
  schema_sha256: createHash('sha256').update(JSON.stringify(buildStrictDraftRecordsSchema())).digest('hex'),
};
writeFileSync(path, `${JSON.stringify(identity, null, 2)}\n`);
