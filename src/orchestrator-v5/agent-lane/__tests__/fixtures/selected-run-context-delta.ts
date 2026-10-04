/** A recorded comparison from the existing producer/fixture grammar, never a second delta calculation. */
import { RunDeltaSchema } from '@talchain/schemas/boundary';
import { buildRunDelta } from '../../../coaching/build-run-delta.js';
import { runAnalysisFact } from '../../../context/__tests__/run-delta-fixtures.js';

export function selectedRunContextDelta(hash: string, at: string, mayName = false) {
  const priorAt = new Date(Date.parse(at) - 30 * 60_000).toISOString();
  const facts = [
    runAnalysisFact([{ id: 'opt-a', win: 0.45 }, { id: 'opt-b', win: 0.55 }], '4242', hash, at),
    runAnalysisFact([{ id: 'opt-a', win: 0.62 }, { id: 'opt-b', win: 0.38 }], '4242', 'aaaaaaaaaaaaaaaa', priorAt),
  ];
  const built = buildRunDelta({ priorFacts: facts, mayNameLeadingOption: mayName });
  if (built.kind !== 'ok') throw new Error(`fixture: recorded delta refused (${built.reason})`);
  return RunDeltaSchema.parse(built.delta);
}
