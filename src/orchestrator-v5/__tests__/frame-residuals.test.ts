import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSessionStore, makeSessionTurnRow } from '../../../tests/utils/mock-session-store.js';
import type { SessionStore, SessionTurnWrite } from '../session/store.js';
import { __setUseAppendV6ForTest } from '../append-v6-flag.js';
import { createApplyOperations, modelRevisionOf } from '../apply-operations.js';
import { createSetFactorValueHandler } from '../tools/handlers/set-factor-value.js';
import { buildHandlerInvocation } from '../tools/handlers/d1-shared/__tests__/fixtures.js';
import type { ProposalAction } from '../routing/types.js';
import { appendCheckedGraphWrite } from '../persist-graph-write.js';
import { PersistedGraphInvariantError } from '../persisted-graph-invariants.js';
import { UntouchedLevelRescaledError, assertUntouchedLevelQuantities } from '../untouched-level-invariant.js';
import { preserveSiblingQuantities } from '../agent-lane/level-batch-frame.js';
import { executeOptionInterventionBatch } from '../system-events/option-intervention-edit.js';
import { buildFactorScaleMap, resolveRawInterventionValue } from '../tools/plot-intervention-scale.js';
import { mergeInterventionSourceObjects } from '../../orchestrator/tools/analysis-ready-helper.js';
import { projectGraphForPersistence } from '../persisted-graph-projection.js';
import { log } from '../../utils/telemetry.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

let activeStore: SessionStore;
vi.mock('../session/index.js', async load => ({ ...await load<typeof import('../session/index.js')>(), getSessionStore: () => activeStore }));
const SID = '550e8400-e29b-41d4-a716-446655440000';
const TID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
type Graph = GraphV3T & Record<string, unknown>;
const bool = { value: 1, raw_value: true, value_type: 'boolean', encoding_map: { true: 1, false: 0 }, source: 'user_specified' };
const category = { value: 1, raw_value: 'high', value_type: 'categorical', encoding_map: { low: 0, high: 1 }, source: 'user_specified' };
function graph(cap: number | undefined = 100, cell: unknown = 0.2): Graph {
  return projectGraphForPersistence({ nodes: [
    { id: 'goal', kind: 'goal', label: 'Quality' },
    { id: 'duration', kind: 'factor', label: 'Duration', observed_state: { value: cap === undefined ? 40 : 40 / cap,
      raw_value: 40, unit: 'days', ...(cap === undefined ? {} : { cap }) } },
    { id: 'full', kind: 'option', label: 'Full', interventions: { duration: cell } },
    { id: 'trial', kind: 'option', label: 'Trial' },
  ], edges: [['full', 'duration'], ['trial', 'duration'], ['duration', 'goal']].map(([from, to]) => ({
    from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
  })) }) as Graph;
}
function cell(g: Graph) { return mergeInterventionSourceObjects(g.nodes.find(n => n.id === 'full')!)["duration"]; }
function quantity(g: Graph) { return resolveRawInterventionValue(cell(g), buildFactorScaleMap(g.nodes).get('duration')).value; }
function reframe(g: Graph, cap: number): Graph {
  const next = structuredClone(g);
  next.nodes.find(n => n.id === 'duration')!.observed_state = { value: 40 / cap, raw_value: 40, unit: 'days', cap };
  return next;
}
function product(initial: Graph) {
  let bytes = JSON.stringify(initial);
  const writes: SessionTurnWrite[] = [];
  const read = () => JSON.parse(bytes) as Graph;
  const append = vi.fn(async (w: SessionTurnWrite) => {
    writes.push(structuredClone(w));
    if (w.graph !== undefined) bytes = JSON.stringify(w.graph);
    return { id: `row-${writes.length}` };
  });
  const store = createMockSessionStore({ loadGraph: async () => read(),
    loadGraphAndBriefText: async () => ({ graph: read(), briefText: null, revision: 7 + writes.length }), append,
    getScenarioOwner: async () => null,
    readRecent: async () => writes.map((w, i) => makeSessionTurnRow({ id: `row-${i + 1}`, scenario_id: w.scenario_id,
      turn_id: w.turn_id, turn_class: w.turn_class, handler_id: w.handler_id, request_hash: w.request_hash,
      response_emitted: w.response_emitted, llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms })),
    readFactsWithTurnFor: async ids => writes.flatMap((w, i) => ids.includes(`row-${i + 1}`)
      ? w.handler_facts.map(fact => ({ turn_id: `row-${i + 1}`, fact_created_at: '2026-10-09T08:00:00Z', fact })) : []),
  });
  activeStore = store;
  return { store, writes, append, read, bytes: () => bytes };
}
function write(g: Graph): SessionTurnWrite {
  return { graph: g, scenario_id: SID, turn_id: TID, turn_class: 'direct_answer', handler_id: null,
    request_hash: 'fr', response_emitted: false, llm_calls_used: 0, duration_ms: 0, handler_facts: [] };
}
async function door(p: ReturnType<typeof product>, g: Graph, base: unknown = p.read()) {
  return appendCheckedGraphWrite({ store: p.store, write: write(g), writesGraph: true, baseGraphForInvariants: base, source: 'FR-test' });
}
async function r3(p: ReturnType<typeof product>, cap: number, extra: Record<string, unknown>[] = []) {
  const operations = [{ op: 'update_node', path: 'duration', value: reframe(p.read(), cap).nodes.find(n => n.id === 'duration')! }, ...extra];
  return createApplyOperations({ scenarioId: SID, requestId: 'FR', store: p.store })({ proposalId: 'FR', idempotencyKey: TID,
    modelRevision: modelRevisionOf(p.read())!, operations: [{ kind: 'edit_graph', summary: 'Approved factor frame', detail: { operations } }] });
}
async function r2(g: Graph, cap: number) {
  const proposal: ProposalAction = { handler_id: 'set_factor_value', entity: { id: 'duration', kind: 'node',
    resolution_status: 'resolved', resolution_method: 'id_match' }, parameters: [{ name: 'value',
    value: { value: 40, unit: 'days', cap }, operator: 'set', source: 'user_explicit' }], cited_context_fields: [] };
  return createSetFactorValueHandler()(buildHandlerInvocation({ graph: g, proposal }));
}
async function batch(p: ReturnType<typeof product>, cap: number, attach: boolean) {
  return executeOptionInterventionBatch({ scenarioId: SID, turnId: TID, requestId: 'FR', stage: 'frame', requestHash: 'FR',
    freshness: 'none', hasExistingAnalysis: false, expectedGraphHash: modelRevisionOf(p.read())!,
    ...(attach ? { frames: [{ factorId: 'duration', cap }] } : {}),
    targets: [{ optionId: 'trial', factorId: 'duration', modelValue: 10 / cap, figure: { raw_value: 10, cap, unit: 'days' } }],
  }, p.store);
}
beforeEach(() => __setUseAppendV6ForTest(false));
afterEach(() => { vi.restoreAllMocks(); __setUseAppendV6ForTest(false); });

describe('FR named rows — real writers and real door; in-memory persistence port', () => {
  it('row 1: R3 exact producer preserves 20 days as 0.1 in ONE append', async () => {
    const p = product(graph()); const before = p.read(); const bytes = p.bytes();
    const outcome = await r3(p, 200).catch(error => {
      // The owner-skip mutant must reach the real door and refuse before RPC.
      expect(error).toBeInstanceOf(UntouchedLevelRescaledError);
      expect(p.append).not.toHaveBeenCalled(); expect(p.bytes()).toBe(bytes);
      throw error;
    });
    expect(outcome).toMatchObject({ ok: true });
    expect(p.writes).toHaveLength(1);
    expect(cell(p.read())).toMatchObject({ value: 0.1, raw_value: 20 });
    expect(quantity(p.read())).toBe(quantity(before));
  });
  it('row 2: planted unchanged cell is refused, typed, with zero RPCs and unchanged store', async () => {
    const p = product(graph()); const before = p.bytes();
    await expect(door(p, reframe(p.read(), 200))).rejects.toMatchObject({ reason: 'untouched_level_rescaled' });
    await expect(door(p, reframe(p.read(), 200))).rejects.toBeInstanceOf(PersistedGraphInvariantError);
    expect(p.append).not.toHaveBeenCalled(); expect(p.bytes()).toBe(before);
  });
  it('row 3: explicit rewritten option cell may acquire a new quantity', async () => {
    const p = product(graph()); const next = reframe(p.read(), 200);
    next.nodes.find(n => n.id === 'full')!.interventions = { duration: { value: 0.3, raw_value: 60, source: 'user_specified' } };
    await door(p, next); expect(p.writes).toHaveLength(1); expect(quantity(p.read())).toBe(60);
  });
  it('row 4: R2 preserves raw20 while coordinate and cap refresh', async () => {
    const g = graph(100, { value: 0.2, raw_value: 20, cap: 100, unit: 'days', source: 'user_specified' });
    const outcome = await r2(g, 200); const next = outcome.mutated_graph as Graph;
    expect(cell(next)).toMatchObject({ value: 0.1, raw_value: 20, cap: 200 });
    expect(JSON.stringify((cell(next) as { raw_value: unknown }).raw_value)).toBe('20');
    expect(quantity(next)).toBe(quantity(g));
  });
  it('row 5: null passes first write; undefined passes and emits exactly one structured skip event per write', async () => {
    const warn = vi.spyOn(log, 'warn');
    for (const changed of [false, true]) {
      const p = product(graph()); const next = changed ? reframe(p.read(), 200) : p.read();
      await appendCheckedGraphWrite({ store: p.store, writesGraph: true, write: write(next), source: 'FR-undefined' });
      expect(p.writes).toHaveLength(1);
    }
    expect(warn.mock.calls.filter(([v]) => (v as { event?: unknown }).event === 'door.untouched_level_check_skipped'))
      .toEqual([[{ event: 'door.untouched_level_check_skipped', reason: 'no_base_supplied', source: 'FR-undefined' }],
        [{ event: 'door.untouched_level_check_skipped', reason: 'no_base_supplied', source: 'FR-undefined' }]]);
    const p = product(graph()); await door(p, reframe(p.read(), 200), null); expect(p.writes).toHaveLength(1);
  });
  it.each([bool, category])('row 6: categorical/boolean code remains unchanged through a frame change: %j', async code => {
    const p = product(graph(100, code)); const old = cell(p.read());
    await door(p, reframe(p.read(), 200)); expect(cell(p.read())).toEqual(old); expect(quantity(p.read())).toBe(1);
  });
  it('row 1 backstop: unpreserved R3 postimage is refused by the actual door', async () => {
    const p = product(graph()); await expect(door(p, reframe(p.read(), 200))).rejects.toBeInstanceOf(UntouchedLevelRescaledError);
    expect(p.writes).toHaveLength(0);
  });
  it('row 3: only the approved cell changes; sibling on another option remains 20', async () => {
    const p = product(graph());
    expect(await r3(p, 200, [{ op: 'update_node', path: 'trial', value: { interventions: { duration: { value: 0.3, raw_value: 60 } } } }]))
      .toMatchObject({ ok: true });
    expect(quantity(p.read())).toBe(20);
    expect(resolveRawInterventionValue(mergeInterventionSourceObjects(p.read().nodes.find(n => n.id === 'trial')!).duration,
      buildFactorScaleMap(p.read().nodes).get('duration')).value).toBe(60);
  });
});

const transitions = ['unchanged', 'created', 'widened', 'narrowed', 'over-frame'] as const;
const representations = ['bare', 'raw', 'raw-cap', 'code'] as const;
const writers = ['R3', 'R2', 'direct', 'level-batch'] as const;
const matrix = writers.flatMap(writer => transitions.flatMap(transition => representations.map(representation => ({ writer, transition, representation }))));
describe('FR generated writer × transition × representation matrix (80 rows)', () => {
  it.each(matrix)('$writer / $transition / $representation', async ({ writer, transition, representation }) => {
    const oldCap = transition === 'created' ? undefined : 100;
    const cap = transition === 'unchanged' ? 100 : transition === 'created' || transition === 'widened' ? 200 : 50;
    const native = transition === 'over-frame' ? 80 : oldCap === undefined ? 0.2 : 20;
    const value = oldCap === undefined ? native : native / oldCap;
    const inputCell = representation === 'bare' ? value : representation === 'code' ? bool
      : { value, raw_value: native, ...(representation === 'raw-cap' && oldCap !== undefined ? { cap: oldCap } : {}), source: 'user_specified' };
    const before = graph(oldCap, inputCell);
    // graph(undefined) uses a JS default; remove the frame explicitly for created rows.
    if (oldCap === undefined) before.nodes.find(n => n.id === 'duration')!.observed_state = { value: 40, raw_value: 40, unit: 'days' };
    const p = product(before); const bytes = p.bytes(); const q = quantity(before);
    let refused = false;
    if (writer === 'direct') {
      try { await door(p, reframe(before, cap)); }
      catch (e) { expect(e).toBeInstanceOf(UntouchedLevelRescaledError); refused = true; }
      expect(refused).toBe(representation === 'bare' && transition !== 'unchanged');
    } else if (writer === 'R3') {
      const out = await r3(p, cap);
      refused = !out.ok;
      expect(refused).toBe(transition === 'over-frame' && representation !== 'code');
    } else if (writer === 'R2') {
      try { const out = await r2(before, cap); await door(p, out.mutated_graph as Graph); }
      catch (e) { expect((e as { cause_kind?: string }).cause_kind).toBe('graph_invariant_violated'); refused = true; }
      expect(refused).toBe(transition === 'over-frame' && representation !== 'code');
    } else {
      // #2919 attaches frames to bare factors; overwriting an existing frame is deliberately refused.
      const out = await batch(p, cap, transition !== 'unchanged');
      refused = out.kind === 'refused';
      expect(refused).toBe(transition !== 'unchanged' && transition !== 'created');
      if (refused) expect(out).toMatchObject({ reason: 'frame_not_applicable' });
      else expect(out.kind).toBe('committed');
    }
    if (refused) { expect(p.writes).toHaveLength(0); expect(p.bytes()).toBe(bytes); }
    else { expect(p.writes).toHaveLength(1); expect(quantity(p.read())).toBeCloseTo(q!, 10); }
  });
});

describe('FR carrier and byte controls', () => {
  it.each(['top', 'nested', 'slash', 'mirror'])('door covers untouched %s carrier', carrier => {
    const before = graph(); const option = before.nodes.find(n => n.id === 'full')! as Record<string, unknown>;
    if (carrier !== 'top') delete option.interventions;
    if (carrier === 'nested') option.data = { interventions: { duration: 0.2 } };
    if (carrier === 'slash') option['data/interventions/duration'] = 0.2;
    if (carrier === 'mirror') before.options = [{ id: 'full', interventions: { duration: 0.2 } }];
    expect(() => assertUntouchedLevelQuantities(before, reframe(before, 200))).toThrow(UntouchedLevelRescaledError);
    const preserved = preserveSiblingQuantities(before, reframe(before, 200), []);
    expect(preserved.kind).toBe('preserved');
    if (preserved.kind === 'preserved') expect(() => assertUntouchedLevelQuantities(before, preserved.graph)).not.toThrow();
  });
  it('raw-looking 25000 and inconsistent raw-backed cells remain byte-identical', () => {
    for (const held of [{ value: 25000 }, { value: 0.2, raw_value: 25, cap: 100 }]) {
      const before = graph(100, held); const out = preserveSiblingQuantities(before, reframe(before, 200), []);
      expect(out.kind).toBe('preserved');
      if (out.kind === 'preserved') { expect(cell(out.graph)).toEqual(cell(before)); expect(quantity(out.graph)).toBe(quantity(before)); }
    }
  });
  it('row 2: a different representation with equal engine quantity passes the door', async () => {
    const p = product(graph()); const next = reframe(p.read(), 200);
    next.nodes.find(n => n.id === 'full')!.interventions = { duration: { value: 0.1, raw_value: 20, cap: 200 } };
    await door(p, next); expect(p.writes).toHaveLength(1); expect(quantity(p.read())).toBe(20);
  });
  it('initial scale_frame re-encoding preserves quantity and disclosures; native-looking 25000 stays native', () => {
    const before = graph(100, { value: 0.2, source: 'cee_hypothesis' });
    delete before.nodes.find(n => n.id === 'duration')!.observed_state;
    before.options = [{ id: 'mirror', label: 'Mirror', interventions: { duration: 0.4 } }];
    before.nodes.find(n => n.id === 'trial')!.interventions = { duration: { value: 25000 } };
    const after = structuredClone(before);
    Object.assign(after.nodes.find(n => n.id === 'duration')!, { scale_frame: 1000 });
    const out = preserveSiblingQuantities(before, after, []); expect(out.kind).toBe('preserved');
    if (out.kind !== 'preserved') throw new Error('Expected preserved');
    expect(cell(out.graph)).toEqual({ value: 0.0002, raw_value: 0.2, cap: 1000, source: 'cee_hypothesis' });
    expect(quantity(out.graph)).toBe(quantity(before));
    const mirrors = out.graph.options as { interventions: Record<string, unknown> }[];
    expect(mirrors[0]!.interventions).toEqual({ duration: { value: 0.0004, raw_value: 0.4, cap: 1000 } });
    expect(out.graph.nodes.find(n => n.id === 'trial')!.interventions).toEqual({ duration: { value: 25000 } });
    expect(out.reencoded.map(c => c.option)).toEqual(['Full', 'Mirror']);
    expect(() => assertUntouchedLevelQuantities(before, out.graph)).not.toThrow();
  });
  it('scale_frame transition preserves metadata, evidence and likely range without inventing a baseline', () => {
    const before = graph(100, { value: 0.2, raw_value: 20, cap: 100, source: 'user_specified',
      unit: 'days', provenance: { author: 'person' }, evidence: ['e1'], range: { low: 10, high: 25, meaning: 'likely_range', source: 'user_specified' } });
    const factor = before.nodes.find(n => n.id === 'duration')! as Record<string, unknown>;
    delete factor.observed_state; factor.scale_frame = 100;
    const after = structuredClone(before); (after.nodes.find(n => n.id === 'duration')! as Record<string, unknown>).scale_frame = 200;
    const out = preserveSiblingQuantities(before, after, []); expect(out.kind).toBe('preserved');
    if (out.kind === 'preserved') {
      expect(cell(out.graph)).toEqual({ ...(cell(before) as object), value: 0.1, cap: 200 });
      expect(quantity(out.graph)).toBe(20); expect(out.graph.nodes.find(n => n.id === 'duration')).not.toHaveProperty('observed_state');
    }
  });
});
