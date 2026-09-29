/** Zero-provider replay of the four frozen A candidates through real admission/registration-payload construction. */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { buildModelFromBrief, type CallStructuredModel } from '../../src/orchestrator-v5/agent-lane/runtime/build-model.js';
import type { CandidateModel } from '../../src/orchestrator-v5/agent-lane/admit-model.js';
import type { InternalDispatch } from '../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js';
// @ts-ignore local experiment scorer
import { scoreRecord } from './score.mjs';

const fixture = JSON.parse(readFileSync(new URL('../../src/orchestrator-v5/agent-lane/__tests__/fixtures/m1-four-captured-candidates-20260929.json', import.meta.url), 'utf8')) as {
  cases: { id: string; brief: string; candidates: CandidateModel[] }[];
};
const out = resolve(process.argv[2] ?? '.artifacts/alternative-constructor/m1-partition-replay.jsonl');
const records: unknown[] = [];
for (const policy of ['current', 'm1'] as const) for (const row of fixture.cases) {
  let graph: unknown = null;
  let calls = 0;
  const call: CallStructuredModel = async () => { calls += 1; return { text: JSON.stringify(row.candidates[Math.min(calls - 1, row.candidates.length - 1)]) }; };
  const dispatch = (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) {
      graph = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    if (path.endsWith('/graph')) return { status: 200, json: { graph: { nodes: [], edges: [] } } };
    return { status: 200, json: { versions: [] } };
  }) as unknown as InternalDispatch;
  const result = await buildModelFromBrief('99999999-9999-4999-8999-999999999999', row.brief, dispatch, call, undefined, policy);
  const record = {
    arm: policy === 'm1' ? 'pragmatic_m1' : 'pragmatic_frozen_candidate', brief: row.id, rep: 0,
    source_sha256: createHash('sha256').update(row.brief).digest('hex'),
    evidence_level: 'frozen_candidate_admission_payload_replay_only', provider_attempts: 0,
    injected_candidate_calls: calls, registered: graph !== null, graph, result,
    questions: result.open_questions ?? [], proposals: result.constructor_proposals ?? [],
    placeholders: result.constructor_placeholders ?? [], pending_user_changes: result.additions_without_total ?? [],
  };
  records.push(record);
  console.log(JSON.stringify({ policy, brief: row.id, injected_candidate_calls: calls, score: scoreRecord(record) }));
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, records.map((record) => JSON.stringify(record)).join('\n') + '\n');
