/**
 * ⛔ B8 (DL CR 5934735711 on #2456): a turn-fence verdict through the REAL limit-edit and option-levels doors.
 *
 * The store refuses a fenced write inside `append` (`supabase-store.ts` `throwFenceRefusal`), BEFORE anything is
 * written. Both doors' commit catches turned that into "commit failed": the limit door's into `commitPerformed: false`
 * (`dispatchAddConstraintEdit`), the option-levels door's into `unverified / commit_not_confirmed`
 * (`executeOptionInterventionBatch`). Each door then returned `unconfirmed`, and the Agent said "may have been saved"
 * with `mutated: true`. The refusal now reaches `runFencedInProcessWrite`, which maps it the route's way: a conflict is
 * `stale`, an infrastructure refusal is the typed `refused`. The wire events keep their existing handling (the flag is
 * set by the in-process doors only); the last describe pins that for the shared option-levels body.
 *
 * Harness: the real doors, real `commitDirectAnswer` → `appendCheckedGraphWrite` → this store's `append`.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

const SCENARIO = '7c2f4e1a-3b5d-4e6f-8a9b-0c1d2e3f4a5b';
type Verdict = 'superseded' | 'stopped' | 'unclaimed' | 'unavailable';

let graph: unknown = null;
let appendFails: (() => Error) | undefined;
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();
const store = {
  claimTurnFence: vi.fn(async (scenarioId: string, turnId: string) => ({ scenarioId, turnId, generation: 7 })),
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  loadGraph: vi.fn(async () => graph),
  loadGraphAndBriefText: vi.fn(async () => ({ graph, briefText: null })),
  readMostRecentPendingActions: vi.fn(async () => []),
  readFactsFor: vi.fn(async () => []),
  readScenarioRunAnalysisFactsFor: vi.fn(async () => ({ facts: [], total_count: 0 })),
  readRecent: vi.fn(async () => [...rows.values()].reverse().map((r) => ({
    id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
    handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
    llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
    assistant_message: r.write.assistantMessage ?? null, created_at: '2026-10-01T00:00:00.000Z',
  }))),
  readFactsWithTurnFor: vi.fn(async (ids: readonly string[]) => [...rows.values()].flatMap((r) => (ids.includes(r.id)
    ? ((r.write.handler_facts ?? []) as unknown[]).map((fact) => ({ turn_id: r.id, fact_created_at: '2026-10-01T00:00:00.000Z', fact }))
    : []))),
  append: vi.fn(async (write: Record<string, unknown>) => {
    if (appendFails !== undefined) throw appendFails();
    const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
    const existing = rows.get(key);
    if (existing !== undefined) return { id: existing.id };
    const id = `row-${rows.size + 1}`;
    rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
    if (write.graph !== undefined && write.graph !== null) graph = JSON.parse(JSON.stringify(write.graph));
    return { id };
  }),
  invalidateScoped: vi.fn(async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] })),
  invalidateAll: vi.fn(async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {} }));
vi.mock('../../../adapters/llm/router.js', () => {
  const refuse = async () => { throw new Error('the writer doors make no LLM call'); };
  const adapter = { name: 'test', model: 'test-model', chat: refuse, chatWithTools: refuse };
  return {
    getAdapter: () => adapter,
    getAdapterWithResolution: () => ({ adapter, resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const } }),
    getMaxTokensFromConfig: () => undefined,
  };
});

import { commitLimitEditInProcess, commitOptionLevelsInProcess, dispatchOptionLevelsBatch } from '../dispatch.js';
import { TurnFenceRejectedError } from '../../session/turn-fence.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { runFencedInProcessWrite } from '../../../orchestrator/turn-fence-prehandler.js';

const SPEND = 'six_month_decision_spend';
/** The writer-doors seam model (`agent-writer-doors-seam.test.ts`): a £20,000 spend limit and two price options. */
const seedGraph = () => {
  const e = (from: string, to: string, mean = 0.5, dir: 'positive' | 'negative' = 'positive') =>
    ({ from, to, strength: { mean, std: 0.1 }, exists_probability: 1, effect_direction: dir });
  return {
    nodes: [
      { id: 'dec_x', kind: 'decision', label: 'Choose a price' },
      { id: 'goal_x', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 },
      { id: 'out_share', kind: 'outcome', label: 'Market share' },
      { id: 'fac_price', kind: 'factor', label: 'Price', category: 'controllable', observed_state: { value: 0.245, raw_value: 49, unit: 'GBP', cap: 200 } },
      { id: SPEND, kind: 'factor', label: 'Six-month decision spend', category: 'external', observed_state: { value: 0.375, raw_value: 15000, unit: 'GBP', cap: 40000 } },
      { id: 'opt_a', kind: 'option', label: 'Keep £49', interventions: { fac_price: { value: 0.245, raw_value: 49, unit: 'GBP', source: 'brief_extraction' } } },
      { id: 'opt_b', kind: 'option', label: 'Raise to £59', interventions: { fac_price: { value: 0.295, raw_value: 59, unit: 'GBP', source: 'brief_extraction' } } },
    ],
    edges: [e('dec_x', 'opt_a', 1), e('dec_x', 'opt_b', 1), e('opt_a', 'fac_price', 1), e('opt_b', 'fac_price', 1),
      e('fac_price', 'out_share'), e('out_share', 'goal_x'), e('fac_price', 'goal_x'), e(SPEND, 'goal_x', 0.2, 'negative')],
    goal_constraints: [
      { constraint_id: 'gc-spend-1', node_id: SPEND, operator: '<=', value: 20000, unit: 'GBP', value_frame: 'level',
        label: 'Six-month decision spend', provenance: 'inferred', source_quote: 'keep decision spend under £20,000 over six months' },
    ],
  };
};
const hashNow = () => computeAnalysisAffectingGraphHash(graph as never) as string;
const bytes = () => JSON.stringify(graph);
const refusal = (verdict: Verdict) => () => new TurnFenceRejectedError(`fence ${verdict}`, { verdict, generation: 7, maxGeneration: 8 } as never);

type Outcome = { readonly status: string; readonly reason?: string };
const STALE: Outcome = { status: 'stale' };
const REFUSED = (verdict: 'unclaimed' | 'unavailable'): Outcome => ({ status: 'refused', reason: `turn_fence_${verdict}` });

const limitDoor = () => {
  const input = { scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: hashNow(), node_id: SPEND, operator: '<=' as const, raw_value: 30000 };
  return { input, run: () => commitLimitEditInProcess(input, 'req-limit') as Promise<Outcome> };
};
const levelsDoor = () => {
  const input = { scenario_id: SCENARIO, turn_id: randomUUID(), base_graph_hash: hashNow(), links: [],
    levels: [{ option_id: 'opt_b', factor_id: 'fac_price', value: 0.3, author: 'user_specified' as const }] };
  return { input, run: () => commitOptionLevelsInProcess(input, 'req-levels') as Promise<Outcome> };
};
const DOORS = [['limit edit', limitDoor], ['option levels', levelsDoor]] as const;

beforeEach(() => {
  graph = seedGraph();
  rows.clear();
  appendFails = undefined;
});

describe('B8: a turn-fence verdict through the real limit-edit and option-levels doors', () => {
  it.each(DOORS)('PRECONDITION (%s): with the store accepting, the door commits — the harness reaches the append', async (_name, door) => {
    const out = await door().run();
    expect(out.status, JSON.stringify(out)).toBe('committed');
    expect(rows.size).toBe(1);
  });

  for (const [name, door] of DOORS) {
    it.each(['superseded', 'stopped', 'unclaimed', 'unavailable'] as const)(`RED (${name}): the door lets a %s verdict out — never "unconfirmed"`, async (verdict) => {
      const before = bytes();
      appendFails = refusal(verdict);
      await expect(door().run()).rejects.toBeInstanceOf(TurnFenceRejectedError);
      expect(store.append).toHaveBeenCalled();
      expect(bytes()).toBe(before);
    });

    it.each(['superseded', 'stopped'] as const)(`RED (${name}, door + wrapper): %s → stale, nothing written`, async (verdict) => {
      const before = bytes();
      appendFails = refusal(verdict);
      const d = door();
      expect(await runFencedInProcessWrite(SCENARIO, d.input.turn_id, d.run, () => STALE, REFUSED)).toEqual(STALE);
      expect(rows.size).toBe(0);
      expect(bytes()).toBe(before);
    });

    it.each(['unclaimed', 'unavailable'] as const)(`RED (${name}, door + wrapper): %s → the typed refusal, nothing written`, async (verdict) => {
      const before = bytes();
      appendFails = refusal(verdict);
      const d = door();
      expect(await runFencedInProcessWrite(SCENARIO, d.input.turn_id, d.run, () => STALE, REFUSED)).toEqual(REFUSED(verdict));
      expect(rows.size).toBe(0);
      expect(bytes()).toBe(before);
    });

    it(`CONTROL (${name}): an ordinary append failure is still "unconfirmed" — only fence verdicts changed`, async () => {
      appendFails = () => new Error('network');
      expect(await door().run()).toEqual({ status: 'unconfirmed' });
    });
  }
});

describe('B8: the wire option-levels body keeps its handling (the flag is the in-process door\'s only)', () => {
  it('CONTROL: without the flag a fence verdict is still caught — no throw, nothing committed', async () => {
    appendFails = refusal('unavailable');
    const r = await dispatchOptionLevelsBatch(
      { scenario_id: SCENARIO, turn_id: randomUUID(), stage: 'frame', requestHash: 'sha256:wire' },
      { targets: [{ optionId: 'opt_b', factorId: 'fac_price', modelValue: 0.3 }], base_graph_hash: hashNow(), expectedLinks: [] },
      'req-wire',
    );
    expect(r.commitPerformed).toBe(false);
    expect(rows.size).toBe(0);
  });
});
