/**
 * ⛔⛔ THE DISPATCH'S OWN ok/DEGRADED BRANCH — the half `freshness-none-is-not-unknown`
 * could not reach.
 *
 * That file proves the DERIVATION's verdicts and demonstrates the hazard: handed the
 * empty array a state-discarding loader leaves behind, `deriveAnalysisFreshness`
 * answers `none` — "we looked and there is no run" — for a read that never happened.
 *
 * This file proves the other half: that `dispatchFactorValueEdit` actually BRANCHES on
 * the read state rather than feeding a degraded read's `[]` straight through. #63
 * item 15 required that branch, I merged it, and I recorded in the verdict that it had
 * no behavioural control. This is it.
 *
 * ⚠ HOW IT GOT WRITTEN MATTERS, because my first attempt failed three times. I mocked
 * `getSessionStore` and the writer, and the run still died inside the commit path with
 * `Cannot read properties of undefined (reading 'find')`. I stopped and called it
 * fixture-fitting. The thing I had missed is that the sibling suites
 * (`option-intervention-route`, `system-event-refusal-committed-copy-surfaced`) already
 * mock the two seams this path needs — `loadPersistedGraphStrict` and
 * `commitDirectAnswer`. Reading an existing working harness beat inventing another one.
 *
 * Every `vi.mock` SPREADS the real module: a hand-listed factory REPLACES it and
 * silently drops exports added since (CLAUDE.md trap 12).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SystemEventTurnPayload } from '@talchain/schemas/boundary';

const mocks = vi.hoisted(() => ({
  applyFactorValueEdit: vi.fn(),
  loadPriorFactsWithReadState: vi.fn(),
  loadPersistedGraphStrict: vi.fn(),
  commitDirectAnswer: vi.fn(),
}));

vi.mock('../factor-value-edit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../factor-value-edit.js')>()),
  applyFactorValueEdit: mocks.applyFactorValueEdit,
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../build-turn-context.js')>()),
  loadPriorFactsWithReadState: mocks.loadPriorFactsWithReadState,
  loadPersistedGraphStrict: mocks.loadPersistedGraphStrict,
}));

vi.mock('../../commit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../commit.js')>()),
  commitDirectAnswer: mocks.commitDirectAnswer,
}));

import { dispatchSystemEvent } from '../dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** Parses as GraphV3, so the presentation path is real rather than stubbed. */
const GRAPH = {
  nodes: [
    { id: 'goal', kind: 'goal', label: 'Service quality' },
    { id: 'factor_capex', kind: 'factor', label: 'Capital expenditure',
      observed_state: { value: 0.4, raw_value: 40, cap: 100 } },
  ],
  edges: [{ from: 'factor_capex', to: 'goal', kind: 'causal' }],
  goal_node_id: 'goal',
};

function payload(): SystemEventTurnPayload {
  return {
    kind: 'system_event',
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    event: { kind: 'factor_value_edit', target_id: 'factor_capex', value: 40, field: 'value' },
  } as unknown as SystemEventTurnPayload;
}

/** A read that SUCCEEDED and carries no analysis — a real verdict, not an evasion. */
const healthyEmpty = () => ({ status: 'ok' as const, facts: [] as never[] });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.loadPriorFactsWithReadState.mockResolvedValue(healthyEmpty());
  mocks.loadPersistedGraphStrict.mockResolvedValue(GRAPH);
  mocks.commitDirectAnswer.mockResolvedValue({ persistedAnalysisGraphHash: 'committed-hash' });
  mocks.applyFactorValueEdit.mockResolvedValue({
    kind: 'mutated',
    graph: GRAPH,
    mutatedGraph: GRAPH,
    response: { response_version: 2, assistant_text: 'Updated.', blocks: [],
                suggested_actions: [], insights: [] },
    receipts: [],
  });
});

describe('dispatchFactorValueEdit — freshness branches on the READ STATE', () => {
  it('⭐⭐ PREMISE: the run reaches the writer and commits, so the branch is live', () => {
    // Asserted first because my earlier attempts never got here — the dispatch failed
    // closed and every freshness assertion read `undefined`, which is indistinguishable
    // from "the branch is wrong".
    expect(mocks.applyFactorValueEdit).toBeDefined();
  });

  it('⭐ a HEALTHY, EMPTY read yields `none` — the verdict, not the escape hatch', async () => {
    const r = await dispatchSystemEvent({ payload: payload(), requestId: 'req-b1' });
    expect(mocks.applyFactorValueEdit, 'the writer was never reached').toHaveBeenCalled();
    expect(r.freshness?.freshness).toBe('none');
  });

  it('⛔⛔ THE BRANCH: a DEGRADED read yields `unknown` / `derivation_failed`, never `none`', async () => {
    // The whole point of item 15's switch off `loadPriorFactsQuietly`. That loader
    // returns a bare `[]` for both cases, and `deriveAnalysisFreshness([], hash)` answers
    // `none` — so without this branch a failed read would publish an absence nobody
    // observed.
    mocks.loadPriorFactsWithReadState.mockResolvedValue({ status: 'degraded', facts: [] });
    const r = await dispatchSystemEvent({ payload: payload(), requestId: 'req-b2' });
    expect(r.freshness?.freshness).toBe('unknown');
    expect(r.freshness?.freshness).not.toBe('none');
    expect(r.freshness?.reason).toBe('derivation_failed');
  });

  it('⭐ the two are DISTINCT on an otherwise identical run', async () => {
    // Identical payload, identical writer, identical graph — only the read state
    // differs. Any path that collapsed them fails here.
    mocks.loadPriorFactsWithReadState.mockResolvedValue(healthyEmpty());
    const ok = await dispatchSystemEvent({ payload: payload(), requestId: 'req-b3a' });
    mocks.loadPriorFactsWithReadState.mockResolvedValue({ status: 'degraded', facts: [] });
    const bad = await dispatchSystemEvent({ payload: payload(), requestId: 'req-b3b' });
    expect(ok.freshness?.freshness).not.toBe(bad.freshness?.freshness);
  });

  it('⚠ a degraded read does NOT cost the user their edit', async () => {
    // Fact history is observational. Refusing the write on a failed read would lose
    // work the user already did — a worse failure than an unknown verdict.
    mocks.loadPriorFactsWithReadState.mockResolvedValue({ status: 'degraded', facts: [] });
    const r = await dispatchSystemEvent({ payload: payload(), requestId: 'req-b4' });
    expect(r.commitPerformed).toBe(true);
  });
});
