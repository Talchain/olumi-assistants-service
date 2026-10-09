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


// r1 inputs retain the review's f/o identities and native figures verbatim.
function reviewGraph(): Graph {
  const g = graph();
  const ids: Record<string, string> = { duration: 'f', full: 'o' };
  for (const n of g.nodes) {
    n.id = ids[n.id] ?? n.id;
    if (n.id === 'o') n.interventions = { f: 0.2 };
  }
  for (const e of g.edges) { e.from = ids[e.from] ?? e.from; e.to = ids[e.to] ?? e.to; }
  return g;
}
function reviewQuantity(g: Graph) {
  return resolveRawInterventionValue(mergeInterventionSourceObjects(g.nodes.find(n => n.id === 'o')!).f,
    buildFactorScaleMap(g.nodes).get('f')).value;
}
async function reviewFactorWrite(g: Graph, value: number, cap = 100) {
  const proposal: ProposalAction = { handler_id: 'set_factor_value', entity: { id: 'f', kind: 'node',
    resolution_status: 'resolved', resolution_method: 'id_match' }, parameters: [{ name: 'value',
    value: { value, unit: 'days', cap }, operator: 'set', source: 'user_explicit' }], cited_context_fields: [] };
  return createSetFactorValueHandler()(buildHandlerInvocation({ graph: g, proposal }));
}
describe('FR build5 r1 concrete failing inputs', () => {
  it.each(['slash', 'nested'])('r1 P1-1 promotion: %s carrier via projectGraphForPersistence and real door', async carrier => {
    const before = reviewGraph(); const option = before.nodes.find(n => n.id === 'o')! as Record<string, unknown>;
    delete option.interventions;
    if (carrier === 'slash') option['data/interventions/f'] = 0.2;
    else option.data = { interventions: { f: 0.2 } };
    const candidate = structuredClone(before);
    candidate.nodes.find(n => n.id === 'f')!.observed_state = { value: 0.2, raw_value: 40, cap: 200, unit: 'days' };
    const projected = projectGraphForPersistence(candidate) as Graph;
    expect(reviewQuantity(before)).toBe(20); expect(reviewQuantity(projected)).toBe(40);
    expect(projected.nodes.find(n => n.id === 'o')!.interventions).toMatchObject({ f: { value: 0.2 } });
    const p = product(before); const bytes = p.bytes();
    await expect(door(p, projected, before)).rejects.toMatchObject({ reason: 'untouched_level_rescaled' });
    expect(p.append).not.toHaveBeenCalled(); expect(p.bytes()).toBe(bytes);
  });
  it('r1 P1-1 shadow-carrier: winning nested 0.2 stays untouched while top-level changes to 0.3', async () => {
    const before = reviewGraph();
    Object.assign(before.nodes.find(n => n.id === 'o')!, { data: { interventions: { f: 0.2 } } });
    const after = structuredClone(before);
    after.nodes.find(n => n.id === 'f')!.observed_state = { value: 0.2, raw_value: 40, cap: 200, unit: 'days' };
    after.nodes.find(n => n.id === 'o')!.interventions = { f: 0.3 };
    expect(reviewQuantity(before)).toBe(20); expect(reviewQuantity(after)).toBe(40);
    const p = product(before); const bytes = p.bytes();
    await expect(door(p, after)).rejects.toMatchObject({ reason: 'untouched_level_rescaled' });
    expect(p.append).not.toHaveBeenCalled(); expect(p.bytes()).toBe(bytes);
  });
  it('r1 P1-2 raw-only approved cell: real createApplyOperations preserves approval of raw60', async () => {
    const before = reviewGraph();
    before.nodes.find(n => n.id === 'trial')!.interventions = { f: 0.2 };
    const p = product(before);
    const operations = [
      { op: 'update_node', path: 'f', value: { observed_state: { value: 0.2, raw_value: 40, cap: 200, unit: 'days' } } },
      { op: 'update_node', path: 'o', value: { interventions: { f: { raw_value: 60, unit: 'days' } } } },
    ];
    const out = await createApplyOperations({ scenarioId: SID, requestId: 'FR', store: p.store })({
      proposalId: 'FR', idempotencyKey: TID, modelRevision: modelRevisionOf(before)!,
      operations: [{ kind: 'edit_graph', summary: 'Approved factor and native option', detail: { operations } }],
    });
    expect(out).toMatchObject({ ok: true }); expect(p.writes).toHaveLength(1);
    expect(reviewQuantity(p.read())).toBe(60);
    expect(resolveRawInterventionValue(mergeInterventionSourceObjects(p.read().nodes.find(n => n.id === 'trial')!).f,
      buildFactorScaleMap(p.read().nodes).get('f')).value).toBe(20);
  });
  it.each(['nonzero-to-zero', 'zero-to-nonzero'])('r1 P1-3 zero-baseline %s at equal cap: real handler then real door', async direction => {
    const before = reviewGraph();
    if (direction === 'zero-to-nonzero') before.nodes.find(n => n.id === 'f')!.observed_state = { value: 0, raw_value: 0, cap: 100, unit: 'days' };
    const q = reviewQuantity(before); const p = product(before);
    const out = await reviewFactorWrite(before, direction === 'nonzero-to-zero' ? 0 : 40);
    const after = out.mutated_graph as Graph;
    expect(buildFactorScaleMap(before.nodes).get('f')?.cap).toBe(100);
    expect(buildFactorScaleMap(after.nodes).get('f')?.cap).toBe(100);
    expect(reviewQuantity(after)).toBe(q);
    await door(p, after); expect(p.writes).toHaveLength(1); expect(reviewQuantity(p.read())).toBe(q);
  });
  it('r1 P2 options:{}: real handler safely ignores malformed mirror', async () => {
    const before = reviewGraph(); before.options = {};
    const p = product(before); const out = await reviewFactorWrite(before, 40, 200);
    expect(reviewQuantity(out.mutated_graph as Graph)).toBe(20);
    await door(p, out.mutated_graph as Graph); expect(p.writes).toHaveLength(1);
  });
  it('r1 P2 null/non-object nodes and malformed mirrors: shared owner skips invalid records', () => {
    const before = reviewGraph(); const after = structuredClone(before);
    after.nodes.find(n => n.id === 'f')!.observed_state = { value: 0.2, raw_value: 40, cap: 200, unit: 'days' };
    const out = preserveSiblingQuantities({ ...before, nodes: [null, 1, ...before.nodes], options: {} },
      { ...after, nodes: [null, 1, ...after.nodes], options: {} }, []);
    expect(out.kind).toBe('preserved');
    if (out.kind === 'preserved') expect(() => assertUntouchedLevelQuantities(before, out.graph)).not.toThrow();
  });
});


// Extend the original 80 cases without altering their assertions: fill every
// new transition/representation combination in the 4 × 7 × 6 cross product.
const extendedTransitions = [...transitions, 'nonzero-to-zero', 'zero-to-nonzero'] as const;
const extendedRepresentations = [...representations, 'slash-promoted', 'nested-promoted'] as const;
const extendedMatrix = writers.flatMap(writer => extendedTransitions.flatMap(transition =>
  extendedRepresentations.filter(representation => transition === 'nonzero-to-zero' || transition === 'zero-to-nonzero'
    || representation === 'slash-promoted' || representation === 'nested-promoted')
    .map(representation => ({ writer, transition, representation }))));
describe('FR build5 generated matrix extension (88 rows; combined cross product 168)', () => {
  it.each(extendedMatrix)('$writer / $transition / $representation', async ({ writer, transition, representation }) => {
    const zeroTransition = transition === 'nonzero-to-zero' || transition === 'zero-to-nonzero';
    const oldCap = transition === 'created' ? undefined : 100;
    const cap = zeroTransition || transition === 'unchanged' ? 100
      : transition === 'created' || transition === 'widened' ? 200 : 50;
    const native = transition === 'over-frame' ? 80 : oldCap === undefined || transition === 'zero-to-nonzero' ? 0.2 : 20;
    const value = oldCap === undefined || transition === 'zero-to-nonzero' ? native : native / oldCap;
    const inputCell = representation === 'code' ? bool : representation === 'raw' || representation === 'raw-cap'
      ? { value, raw_value: native, ...(representation === 'raw-cap' && oldCap !== undefined ? { cap: oldCap } : {}), source: 'user_specified' }
      : value;
    const before = graph(oldCap, inputCell);
    if (oldCap === undefined) before.nodes.find(n => n.id === 'duration')!.observed_state = { value: 40, raw_value: 40, unit: 'days' };
    if (transition === 'zero-to-nonzero') before.nodes.find(n => n.id === 'duration')!.observed_state = { value: 0, raw_value: 0, cap: 100, unit: 'days' };
    const option = before.nodes.find(n => n.id === 'full')! as Record<string, unknown>;
    if (representation === 'slash-promoted' || representation === 'nested-promoted') {
      delete option.interventions;
      if (representation === 'slash-promoted') option['data/interventions/duration'] = inputCell;
      else option.data = { interventions: { duration: inputCell } };
    }
    const next = reframe(before, cap);
    if (transition === 'nonzero-to-zero') next.nodes.find(n => n.id === 'duration')!.observed_state = { value: 0, raw_value: 0, cap: 100, unit: 'days' };
    // R2's structural parser and #2919's canonical ingress require promotion
    // before admission. R3 and the direct door admit the original carriers.
    const admitted = writer === 'R2' || writer === 'level-batch' ? projectGraphForPersistence(before) as Graph : before;
    expect(quantity(admitted)).toBe(quantity(before));
    const p = product(admitted); const bytes = p.bytes(); const q = quantity(before);
    let refused = false;
    if (writer === 'direct') {
      const projected = projectGraphForPersistence(next) as Graph;
      try { await door(p, projected); }
      catch (e) { expect(e).toBeInstanceOf(UntouchedLevelRescaledError); refused = true; }
      const bare = representation === 'bare' || representation === 'slash-promoted' || representation === 'nested-promoted';
      expect(refused).toBe(bare && transition !== 'unchanged');
    } else if (writer === 'R3') {
      const operations = [{ op: 'update_node', path: 'duration', value: { observed_state: next.nodes.find(n => n.id === 'duration')!.observed_state } }];
      const out = await createApplyOperations({ scenarioId: SID, requestId: 'FR', store: p.store })({
        proposalId: 'FR', idempotencyKey: TID, modelRevision: modelRevisionOf(before)!,
        operations: [{ kind: 'edit_graph', summary: 'Approved factor transition', detail: { operations } }],
      });
      refused = !out.ok; expect(refused).toBe(transition === 'over-frame' && representation !== 'code');
    } else if (writer === 'R2') {
      const proposal: ProposalAction = { handler_id: 'set_factor_value', entity: { id: 'duration', kind: 'node',
        resolution_status: 'resolved', resolution_method: 'id_match' }, parameters: [{ name: 'value',
        value: { value: transition === 'nonzero-to-zero' ? 0 : 40, unit: 'days', cap }, operator: 'set', source: 'user_explicit' }], cited_context_fields: [] };
      try {
        const out = await createSetFactorValueHandler()(buildHandlerInvocation({ graph: admitted, proposal }));
        await door(p, out.mutated_graph as Graph);
      } catch (e) { expect((e as { cause_kind?: string }).cause_kind).toBe('graph_invariant_violated'); refused = true; }
      expect(refused).toBe(transition === 'over-frame' && representation !== 'code');
    } else {
      // This API cannot mutate factor baselines or overwrite existing frames.
      const out = await batch(p, cap, transition !== 'unchanged');
      refused = out.kind === 'refused';
      expect(refused).toBe(transition !== 'unchanged' && transition !== 'created');
      if (refused) expect(out).toMatchObject({ reason: 'frame_not_applicable' });
      else expect(out.kind).toBe('committed');
    }
    if (refused) { expect(p.append).not.toHaveBeenCalled(); expect(p.bytes()).toBe(bytes); }
    else {
      expect(p.writes).toHaveLength(1); expect(quantity(p.read())).toBeCloseTo(q!, 10);
      if (representation === 'slash-promoted' || representation === 'nested-promoted') {
        expect(p.read().nodes.find(n => n.id === 'full')!.interventions).toHaveProperty('duration');
      }
    }
  });
});

describe('FR build5 approval spellings and resolver metadata controls', () => {
  it.each(['nested', 'data-slash', 'interventions-slash', 'observed-slash', 'path'])('raw-only %s operation approves exactly its option/factor cell', async spelling => {
    const before = reviewGraph(); const p = product(before);
    const native = { raw_value: 60, unit: 'days' };
    const patch = spelling === 'nested' ? { data: { interventions: { f: native } } }
      : spelling === 'data-slash' ? { 'data/interventions/f': native }
      : spelling === 'interventions-slash' ? { 'interventions/f': native }
      : { 'observed_state/interventions/f': native };
    const operations = [
      { op: 'update_node', path: 'f', value: { observed_state: { value: 0.2, raw_value: 40, cap: 200, unit: 'days' } } },
      { op: 'update_node', path: spelling === 'path' ? '/nodes/o/data/interventions/f' : 'o', value: spelling === 'path' ? native : patch },
    ];
    const out = await createApplyOperations({ scenarioId: SID, requestId: 'FR', store: p.store })({
      proposalId: 'FR', idempotencyKey: TID, modelRevision: modelRevisionOf(before)!,
      operations: [{ kind: 'edit_graph', summary: 'Approved native option', detail: { operations } }],
    });
    expect(out).toMatchObject({ ok: true }); expect(p.writes).toHaveLength(1); expect(reviewQuantity(p.read())).toBe(60);
  });
  it('metadata and cell-cap edits cannot exempt an unchanged resolver input from the real door', async () => {
    const before = graph(100, { value: 0.2, cap: 100, source: 'cee_hypothesis', evidence: ['e1'] });
    const after = reframe(before, 200);
    after.nodes.find(n => n.id === 'full')!.interventions = { duration: { value: 0.2, cap: 200,
      source: 'user_specified', evidence: ['e2'], target_match: { node_id: 'duration', match_type: 'exact_id', confidence: 'high' } } };
    const p = product(before); const bytes = p.bytes();
    await expect(door(p, after)).rejects.toMatchObject({ reason: 'untouched_level_rescaled' });
    expect(p.append).not.toHaveBeenCalled(); expect(p.bytes()).toBe(bytes);
  });
});

// Build6 keeps the existing 199 tests and assertions intact.
function build6RouteGraph(): Graph {
  return {
    goal_node_id: 'g-revenue',
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      { id: 'f-edited', kind: 'factor', label: 'Marketing budget',
        observed_state: { value: 0.4, raw_value: 40000, cap: 100000, unit: '£', source: 'cee_inference' } },
      { id: 'f-untouched', kind: 'factor', label: 'Marketing budget',
        observed_state: { value: 0.2, raw_value: 0.2, cap: 1, source: 'cee_inference' } },
      { id: 'o-configured', kind: 'option', label: 'Increase marketing' },
      { id: 'o-hold', kind: 'option', label: 'No change (status quo)', is_baseline: true },
    ],
    edges: ['f-edited', 'f-untouched'].map(from => ({ from, to: 'g-revenue',
      strength: { mean: 0.4, std: 0.1 }, exists_probability: 0.9, effect_direction: 'positive' })),
    options: [
      { id: 'o-configured', option_id: 'o-configured', label: 'Increase marketing',
        interventions: { 'f-edited': { value: 0.6 }, 'f-untouched': { value: 0.2 } } },
      { id: 'o-hold', option_id: 'o-hold', label: 'No change (status quo)', is_baseline: true, interventions: {} },
    ],
  } as Graph;
}
async function build6Event(g: Graph, targetId: string, unit: string) {
  const { applyFactorValueEdit } = await import('../system-events/factor-value-edit.js');
  const event = { kind: 'factor_value_edit' as const, target_id: targetId, value: 0, raw_value: 0, unit };
  return applyFactorValueEdit({ payload: { kind: 'system_event', scenario_id: SID, turn_id: TID, stage: 'analyse', event },
    event, requestId: 'FR-build6', persistedGraph: g, priorFacts: [] });
}
function build6MirrorQuantity(g: Graph) {
  const option = (g.options as Record<string, unknown>[]).find(n => n.id === 'o-configured')!;
  return resolveRawInterventionValue(mergeInterventionSourceObjects(option)['f-edited'],
    buildFactorScaleMap(g.nodes).get('f-edited')).value;
}
describe('FR build6 named route regressions', () => {
  it('fully specified zero remains a valid zero: mirror-only £60000 stays £60000 through the real owner and door', async () => {
    const before = build6RouteGraph(); const p = product(before);
    const out = await build6Event(before, 'f-edited', '£');
    expect(out.kind).toBe('mutated');
    if (out.kind !== 'mutated') throw new Error('Expected mutation');
    expect(((out.mutatedGraph as Graph).options as Record<string, unknown>[])[0]!.interventions)
      .toMatchObject({ 'f-edited': { value: 0.6, raw_value: 60000, cap: 100000 } });
    // The real commit projects the D1 merge before the final door.
    const after = projectGraphForPersistence(out.mutatedGraph) as Graph;
    expect(after.nodes.find(n => n.id === 'f-edited')!.observed_state)
      .toMatchObject({ value: 0, raw_value: 0, cap: 100000, unit: '£' });
    expect((after.options as Record<string, unknown>[])[0]!.interventions)
      .toMatchObject({ 'f-edited': { value: 0.6, raw_value: 60000, cap: 100000 } });
    expect(build6MirrorQuantity(after)).toBe(60000);
    await door(p, after);
    expect(p.writes).toHaveLength(1); expect(build6MirrorQuantity(p.read())).toBe(build6MirrorQuantity(before));
    expect(p.read().nodes.find(n => n.id === 'f-untouched')).toEqual(before.nodes.find(n => n.id === 'f-untouched'));
    expect(before).toEqual(build6RouteGraph());
  });
  it('system-event untouched_level_rescaled reuses the existing invariant refusal verbatim and saves no graph', async () => {
    const Fastify = (await import('fastify')).default;
    const { ceeOrchestratorRouteV2 } = await import('../../orchestrator/route-v2.js');
    const owner = await import('../agent-lane/level-batch-frame.js');
    // Plant the owner's omission; the actual final door must detect the drift.
    vi.spyOn(owner, 'preserveSiblingQuantities').mockImplementation((_before, after) => ({ kind: 'preserved', graph: after, reencoded: [] }));
    const p = product(build6RouteGraph()); const bytes = p.bytes();
    const app = Fastify();
    try {
      await ceeOrchestratorRouteV2(app); await app.ready();
      const response = await app.inject({ method: 'POST', url: '/orchestrate/v2/turn', headers: { 'x-request-id': 'FR-build6-refusal' },
        payload: { kind: 'system_event', scenario_id: SID, turn_id: TID, stage: 'analyse',
          event: { kind: 'factor_value_edit', target_id: 'f-edited', value: 0, raw_value: 0, unit: '£' } } });
      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.assistant_text).toBe("Applying that change would have left the model in an invalid state, so it wasn't saved.");
      expect(body.blocks).toEqual([]);
      expect(body).not.toHaveProperty('draft_graph'); expect(body).not.toHaveProperty('graph_hash');
      expect(p.writes).toHaveLength(1);
      expect(p.writes[0]).toMatchObject({ turn_class: 'direct_answer', handler_id: null, handler_facts: [] });
      expect(p.writes[0]!.graph).toBeUndefined();
      expect(p.writes[0]!.assistantMessage).toBe(body.assistant_text);
      expect(p.bytes()).toBe(bytes);
    } finally { await app.close(); }
  }, 30_000);
});

const build6ZeroMatrix = writers.flatMap(writer => extendedRepresentations.map(representation => ({ writer, representation })));
describe('FR build6 matrix transition: factor value set to 0 (raw 0) at the same cap (24 rows)', () => {
  it.each(build6ZeroMatrix)('$writer / $representation', async ({ writer, representation }) => {
    const input = representation === 'code' ? bool : representation === 'raw' || representation === 'raw-cap'
      ? { value: 0.2, raw_value: 20, ...(representation === 'raw-cap' ? { cap: 100 } : {}) } : 0.2;
    const before = graph(100, input);
    const option = before.nodes.find(n => n.id === 'full')! as Record<string, unknown>;
    if (representation === 'slash-promoted' || representation === 'nested-promoted') {
      delete option.interventions;
      if (representation === 'slash-promoted') option['data/interventions/duration'] = input;
      else option.data = { interventions: { duration: input } };
    }
    const admitted = writer === 'R2' || writer === 'level-batch' ? projectGraphForPersistence(before) as Graph : before;
    expect(quantity(admitted)).toBe(quantity(before));
    const p = product(admitted); const bytes = p.bytes(); const q = quantity(before);
    const next = structuredClone(before);
    next.nodes.find(n => n.id === 'duration')!.observed_state = { value: 0, raw_value: 0, cap: 100, unit: 'days' };
    let refused = false;
    if (writer === 'direct') {
      try { await door(p, projectGraphForPersistence(next) as Graph); }
      catch (error) { expect(error).toBeInstanceOf(UntouchedLevelRescaledError); refused = true; }
      expect(refused).toBe(representation === 'bare' || representation === 'slash-promoted' || representation === 'nested-promoted');
    } else if (writer === 'R3') {
      const out = await createApplyOperations({ scenarioId: SID, requestId: 'FR-build6', store: p.store })({
        proposalId: 'FR-build6', idempotencyKey: TID, modelRevision: modelRevisionOf(before)!,
        operations: [{ kind: 'edit_graph', summary: 'Approved zero factor', detail: { operations: [
          { op: 'update_node', path: 'duration', value: { observed_state: next.nodes.find(n => n.id === 'duration')!.observed_state } },
        ] } }],
      });
      expect(out).toMatchObject({ ok: true });
    } else if (writer === 'R2') {
      const out = await build6Event(admitted, 'duration', 'days');
      expect(out.kind).toBe('mutated');
      if (out.kind !== 'mutated') throw new Error('Expected mutation');
      await door(p, out.mutatedGraph as Graph);
    } else {
      const out = await batch(p, 100, true);
      expect(out).toMatchObject({ kind: 'refused', reason: 'frame_not_applicable' }); refused = true;
    }
    if (refused) { expect(p.append).not.toHaveBeenCalled(); expect(p.bytes()).toBe(bytes); }
    else {
      expect(p.writes).toHaveLength(1); expect(quantity(p.read())).toBe(q);
      expect(p.read().nodes.find(n => n.id === 'duration')!.observed_state).toMatchObject({ value: 0, raw_value: 0, cap: 100 });
    }
  });
});

describe('FR build6 final owner uses the winning mirror cell', () => {
  it.each(['nested', 'slash'])('%s mirror carrier retains quantity and metadata through the D1 structural merge', async carrier => {
    const before = build6RouteGraph();
    const mirror = (before.options as Record<string, unknown>[])[0]!;
    const winning = { value: 0.2, unit: '£', source: 'user_specified', evidence: ['e1'] };
    if (carrier === 'nested') mirror.data = { interventions: { 'f-edited': winning } };
    else mirror['data/interventions/f-edited'] = winning;
    expect(build6MirrorQuantity(before)).toBe(20000);
    const out = await build6Event(before, 'f-edited', '£');
    expect(out.kind).toBe('mutated');
    if (out.kind !== 'mutated') throw new Error('Expected mutation');
    const held = mergeInterventionSourceObjects(((out.mutatedGraph as Graph).options as Record<string, unknown>[])[0]!);
    expect(held['f-edited']).toEqual({ ...winning, raw_value: 20000, cap: 100000 });
    const projected = projectGraphForPersistence(out.mutatedGraph) as Graph;
    const p = product(before);
    await door(p, projected);
    expect(p.writes).toHaveLength(1); expect(build6MirrorQuantity(p.read())).toBe(20000);
  });
});

describe('FR buddy r2: a shadowed carrier never blocks a quantity-preserving edit', () => {
  it('zero edit with a winning raw20 data cell and a shadowed raw60 top-level cell saves, keeps 20, leaves the shadow alone', async () => {
    const shadow = { value: 0.6, raw_value: 60, cap: 100 };
    const graph = {
      goal_node_id: 'goal',
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Quality' },
        { id: 'f', kind: 'factor', label: 'Duration', observed_state: { value: 0.4, raw_value: 40, cap: 100, unit: 'days' } },
        { id: 'o', kind: 'option', label: 'Full' },
        { id: 'p', kind: 'option', label: 'Trial' },
      ],
      edges: [['o', 'f'], ['p', 'f'], ['f', 'goal']].map(([from, to]) => ({
        from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
      })),
      options: [
        { id: 'o', label: 'Full', data: { interventions: { f: { value: 0.2, raw_value: 20, cap: 100 } } }, interventions: { f: { ...shadow } } },
        { id: 'p', label: 'Trial', interventions: {} },
      ],
    } as unknown as Graph;
    const before = structuredClone(graph);
    const out = await build6Event(structuredClone(graph), 'f', 'days');
    expect(out.kind).toBe('mutated');
    if (out.kind !== 'mutated') throw new Error('Expected mutation');
    const after = out.mutatedGraph as Graph;
    const option = (after.options as Record<string, unknown>[]).find(o => o.id === 'o')!;
    const scale = buildFactorScaleMap((after.nodes as unknown as Record<string, unknown>[])).get('f');
    expect(resolveRawInterventionValue(mergeInterventionSourceObjects(option).f, scale).value).toBe(20);
    expect((option.interventions as Record<string, unknown>).f).toEqual(shadow);
    // The real door accepts the projected write against the original base.
    expect(() => assertUntouchedLevelQuantities(before, projectGraphForPersistence(after))).not.toThrow();
  });
});
