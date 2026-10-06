/**
 * ⭐ SD-1 Slice R (cut 7) — the commit seam for `CommitMetadata.stampHandlerFacts`.
 *
 * The record must be built from the response AS COMMITTED (after the last pre-commit transform, so it is the response
 * the caller ships), and the stamp must never cost the turn its commit: a throw or a malformed return writes the facts
 * exactly as given. The end-to-end row runs the real stamper and the real 0.78 Run-fact schema on what the store got.
 */
import { describe, expect, it, vi } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { RunAnalysisHandlerFactSchema, type HandlerFact } from '@talchain/schemas/orchestrator';
import { maximalReviewCardBlock } from '@talchain/schemas/fixtures';

import { commitDirectAnswer } from '../commit.js';
import { composeDirectAnswerResponse } from '../compose.js';
import { makeDeliveredRecordStamper } from '../compose/run-delivered-record.js';
import { createNoopSessionStore } from '../session/__tests__/fixtures.js';

type Rec = Record<string, unknown>;
const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const NEUTRAL = 'Most of this result rests on a single factor. Arguing the case against it shows whether it survives.';

const runFact = (): HandlerFact => ({
  fact_type: 'run_analysis', fact_version: 1, noop: false,
  result: {
    scenario_id: SCENARIO_ID, leading_option_id: null, summary: 's', run_id: 'run_b', graph_hash_at_run: 'gh_b',
    computed_at: '2026-10-06T03:00:00.000Z', win_probabilities: { opt_hire: 0.6, opt_hold: 0.4 },
    constraint_verdict: { may_name_leading_option: false, constraint_verdict_state: 'unevaluated' },
  },
} as unknown as HandlerFact);

const response = (): OlumiResponse => ({
  ...composeDirectAnswerResponse({ answerKind: 'functional', assistant_text: 'hi', stage: 'analyse' }),
  blocks: [{ ...(maximalReviewCardBlock as unknown as Rec), body: NEUTRAL }],
} as unknown as OlumiResponse);

const meta = (facts: readonly HandlerFact[], over: Rec = {}) => ({
  scenario_id: SCENARIO_ID, turn_id: TURN_ID, turn_class: 'handler' as const, handler_id: 'run_analysis' as const,
  request_hash: 'sha256:test', llm_calls_used: 0, duration_ms: 1, handler_facts: facts, ...over,
});

/** A store whose append records the exact write it was handed. */
function capturingStore() {
  const store = createNoopSessionStore({ appendId: 'row-1' });
  const append = vi.spyOn(store, 'append');
  const written = () => (append.mock.calls.at(-1)?.[0] as { handler_facts: readonly HandlerFact[] } | undefined)?.handler_facts;
  return { store, append, written };
}

describe('commit seam — stampHandlerFacts', () => {
  it('⭐ the store writes what the stamper returned (by reference)', async () => {
    const { store, written } = capturingStore();
    const facts = [runFact()];
    const stamped = [{ ...facts[0]!, result: { ...(facts[0]!.result as Rec), marker: 1 } } as unknown as HandlerFact];
    await commitDirectAnswer(response(), meta(facts, { stampHandlerFacts: () => stamped }) as never, store);
    expect(written()).toBe(stamped);
  });

  it('⭐ the stamper sees the response AS COMMITTED — after projectPublicResponse, the one the caller ships', async () => {
    const { store } = capturingStore();
    const projected = { ...response(), assistant_text: 'projected' } as OlumiResponse;
    const seen: OlumiResponse[] = [];
    const result = await commitDirectAnswer(
      response(),
      meta([runFact()], { stampHandlerFacts: (r: OlumiResponse, f: readonly HandlerFact[]) => { seen.push(r); return f; } }) as never,
      store,
      () => projected,
    );
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(projected);
    expect(result.response).toBe(seen[0]);
  });

  it('a throwing stamper never fails the commit: the facts are written exactly as given', async () => {
    const { store, written } = capturingStore();
    const facts = [runFact()];
    const result = await commitDirectAnswer(response(), meta(facts, { stampHandlerFacts: () => { throw new Error('boom'); } }) as never, store);
    expect(result.performed).toBe(true);
    expect(written()).toBe(facts);
  });

  it('a stamper returning a different number of facts is ignored (facts as given)', async () => {
    const { store, written } = capturingStore();
    const facts = [runFact()];
    await commitDirectAnswer(response(), meta(facts, { stampHandlerFacts: () => [] }) as never, store);
    expect(written()).toBe(facts);
  });

  it('CONTROL: no stamper → the facts are written as given', async () => {
    const { store, written } = capturingStore();
    const facts = [runFact()];
    await commitDirectAnswer(response(), meta(facts) as never, store);
    expect(written()).toBe(facts);
  });

  it('⭐ END TO END: the real stamper writes a record the real 0.78 Run-fact schema accepts', async () => {
    const { store, written } = capturingStore();
    const stampHandlerFacts = makeDeliveredRecordStamper({
      graph: { nodes: [{ id: 'opt_hire', kind: 'option', label: 'Hire a marketing manager' }], edges: [] } as never,
      analysisReady: undefined, authorityUnavailable: false, requestId: 'req-1', exitPath: 'test',
    });
    await commitDirectAnswer(response(), meta([runFact()], { stampHandlerFacts }) as never, store);
    const fact = written()![0]!;
    expect(RunAnalysisHandlerFactSchema.safeParse(fact).success).toBe(true);
    const record = (fact.result as Rec).delivered_record as Rec;
    expect(record).toMatchObject({ record_version: 1, run_id: 'run_b', graph_hash: 'gh_b' });
    expect((record.phase3_blocks as Rec[]).map((b) => b.body)).toEqual([NEUTRAL]);
  });
});
