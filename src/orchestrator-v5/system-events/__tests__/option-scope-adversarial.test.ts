// S5 adversarial rows for the value writer's quantity-preserving option rewrite (#3299 review probes, cleaned).
// e2 (GBP onto a unitless count factor whose option is in an unrecognised unit) is a KNOWN limitation of the
// shared unit classifier and is deliberately not asserted here; see the PR body.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildCanonicalAnalysisReadyFromGraph, mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { buildFactorScaleMap, resolveRawInterventionValue } from '../../tools/plot-intervention-scale.js';
import * as writer from '../factor-value-edit.js';
import { commitOptionLevelsInProcess, type CommitOptionLevelsInput } from '../dispatch.js';
import { createAgentCapabilities } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';

type Dict = Record<string, unknown>;
type Graph = { nodes: (Dict & { id: string; kind: string })[]; edges: Dict[]; options?: Dict[] };
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/s5-starting-figures/served-graph-rev2.json', import.meta.url), 'utf8')) as Graph;
const PROPOSAL = JSON.parse(readFileSync(new URL('./fixtures/s5-starting-figures/served-proposal.json', import.meta.url), 'utf8'));
const SCENARIO_ID = 'e09de419-4d76-405e-b47e-d2fce5568c31';
const HLT = { factor_id: 'hiring_lead_time', value: 3, unit: 'months', author: 'model_proposed' as const };
const TLH = { factor_id: 'tech_lead_hires', value: 0, unit: 'hires', author: 'model_proposed' as const };
let persisted: Graph = structuredClone(SERVED);
const rows = new Map<string, { id: string; write: SessionTurnWrite }>();
const cold = (): Graph => JSON.parse(JSON.stringify(persisted));
const hash = () => computeAnalysisAffectingGraphHash(persisted as never)!;
const node = (g: Graph, id: string) => g.nodes.find(n => n.id === id)!;

vi.mock('../../session/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../session/index.js')>(),
  getSessionStore: () => createMockSessionStore({
    loadGraph: async () => cold(),
    loadGraphAndBriefText: async () => ({ graph: cold(), briefText: null }),
    readRecent: async () => [...rows.values()].reverse().map(({ id, write }) => makeSessionTurnRow({
      id, scenario_id: write.scenario_id, turn_id: write.turn_id, turn_class: write.turn_class,
      handler_id: write.handler_id, request_hash: write.request_hash, response_emitted: write.response_emitted,
      llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms, assistant_message: write.assistantMessage ?? null,
    })),
    readFactsWithTurnFor: async ids => [...rows.values()].flatMap(({ id, write }) => ids.includes(id)
      ? write.handler_facts.map(fact => ({ turn_id: id, fact_created_at: '2026-10-16T00:00:00.000Z', fact })) : []),
    append: async write => {
      const key = `${write.scenario_id}/${write.turn_id}`;
      const previous = rows.get(key);
      if (previous) return { id: previous.id };
      const id = `row-${rows.size + 1}`;
      const stored = JSON.parse(JSON.stringify(write)) as SessionTurnWrite;
      rows.set(key, { id, write: stored });
      if (stored.graph !== undefined) persisted = stored.graph as Graph;
      return { id };
    },
  }),
}));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: vi.fn(), chatWithTools: vi.fn() }),
  getAdapterWithResolution: () => ({ adapter: { name: 'test', model: 'test-model', chat: vi.fn(), chatWithTools: vi.fn() },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' } }),
  getMaxTokensFromConfig: () => undefined,
}));

const door = (values: CommitOptionLevelsInput['values'] = [HLT, TLH], baseHash = hash(), turn = 'prop-review#levels') =>
  commitOptionLevelsInProcess({ scenario_id: SCENARIO_ID, base_graph_hash: baseHash, turn_id: turn, links: [], levels: [], values }, 'req-review');

/** Tamper with the REAL writer's output for one factor, then let the real door judge it. */
function tamper(target: string, fn: (g: Graph) => void) {
  const real = writer.applyFactorValueEdit;
  vi.spyOn(writer, 'applyFactorValueEdit').mockImplementation(async input => {
    const res = await real(input);
    if (res.kind === 'mutated' && input.event.target_id === target) fn(res.mutatedGraph as Graph);
    return res;
  });
}
const tlCell = (g: Graph, carrier: 'nodes' | 'options' = 'nodes') =>
  mergeInterventionSourceObjects(carrier === 'options' ? g.options![0]! : node(g, 'hire_a_tech_lead')).tech_lead_hires as Dict;

async function expectRefusedNothingWritten(values: CommitOptionLevelsInput['values'], blamed?: string) {
  const before = cold();
  const result = await door(values);
  expect(result.status).toBe('refused');
  if (blamed !== undefined) expect(result.status === 'refused' && result.value).toEqual({ factor_id: blamed });
  expect(rows.size).toBe(0);
  expect(cold()).toEqual(before);
  return result;
}

beforeEach(() => { persisted = structuredClone(SERVED); rows.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('#3299 reviewer probes', () => {
  // (a) same re-encode shape, quantity changed
  it('a1: re-encode with quantity 1 -> 2 tech leads (node) refuses, names TLH', async () => {
    tamper(TLH.factor_id, g => Object.assign(tlCell(g), { value: 0.2, raw_value: 2, cap: 10 }));
    await expectRefusedNothingWritten([HLT, TLH], TLH.factor_id);
  });
  it('a2: re-encode with quantity 1 -> 2 in top-level options[] refuses', async () => {
    persisted.options = [structuredClone(node(persisted, 'hire_a_tech_lead'))];
    delete node(persisted, 'hire_a_tech_lead').interventions;
    persisted = projectGraphForPersistence(persisted) as Graph;
    tamper(TLH.factor_id, g => Object.assign(tlCell(g, 'options'), { value: 0.2, raw_value: 2, cap: 10 }));
    await expectRefusedNothingWritten([HLT, TLH], TLH.factor_id);
  });
  it('a3: value-only drift (raw 1 kept, value 0.1 -> 0.2) refuses', async () => {
    tamper(TLH.factor_id, g => Object.assign(tlCell(g), { value: 0.2 }));
    await expectRefusedNothingWritten([HLT, TLH], TLH.factor_id);
  });
  // (b) cap mismatch / cap on an untouched option
  it('b1: cap 20 on the cell while the factor frame is 10 (quantity still 1) refuses', async () => {
    tamper(TLH.factor_id, g => Object.assign(tlCell(g), { value: 0.05, raw_value: 1, cap: 20 }));
    await expectRefusedNothingWritten([HLT, TLH], TLH.factor_id);
  });
  it('b2: quantity-preserving cap added to an UNTOUCHED option/factor (two developers, 8 of 30) refuses', async () => {
    tamper(TLH.factor_id, g => {
      const c = mergeInterventionSourceObjects(node(g, 'hire_two_developers')).mid_weight_developers as Dict;
      Object.assign(c, { value: 8 / 30, raw_value: 8, cap: 30 });
    });
    await expectRefusedNothingWritten([HLT, TLH], TLH.factor_id);
  });
  // (c) authorship
  it('c1: source cee_hypothesis -> user_specified in the rewrite refuses', async () => {
    tamper(TLH.factor_id, g => { tlCell(g).source = 'user_specified'; });
    await expectRefusedNothingWritten([HLT, TLH], TLH.factor_id);
  });
  it('c2: user_material_unverified flag dropped in the rewrite refuses', async () => {
    tamper(TLH.factor_id, g => { delete tlCell(g).user_material_unverified; });
    await expectRefusedNothingWritten([HLT, TLH], TLH.factor_id);
  });
  it('c3: authorship change in top-level options[] refuses', async () => {
    persisted.options = [structuredClone(node(persisted, 'hire_a_tech_lead'))];
    persisted = projectGraphForPersistence(persisted) as Graph;
    tamper(TLH.factor_id, g => { tlCell(g, 'options').source = 'user_specified'; });
    await expectRefusedNothingWritten([HLT, TLH], TLH.factor_id);
  });
  // (d) another option altered
  it('d1: two-developers quantity 8 -> 9 in the same commit refuses', async () => {
    tamper(TLH.factor_id, g => {
      const c = mergeInterventionSourceObjects(node(g, 'hire_two_developers')).mid_weight_developers as Dict;
      Object.assign(c, { raw_value: 9, value: 0.3 });
    });
    await expectRefusedNothingWritten([HLT, TLH], TLH.factor_id);
  });
  it('d2: keep_current_team gains a cell on the written factor (writer-shaped) refuses', async () => {
    tamper(TLH.factor_id, g => {
      (node(g, 'keep_current_team') as Dict).interventions = { tech_lead_hires: { value: 0.1, raw_value: 1, cap: 10 } };
    });
    await expectRefusedNothingWritten([HLT, TLH], TLH.factor_id);
  });
  // (e) unit mismatches
  it('e1: GBP onto a count factor that already holds "hires" refuses', async () => {
    node(persisted, TLH.factor_id).observed_state = { value: 0, raw_value: 0, cap: 10, unit: 'hires', source: 'user_assumption' };
    persisted = projectGraphForPersistence(persisted) as Graph;
    await expectRefusedNothingWritten([HLT, { ...TLH, unit: 'GBP' }], TLH.factor_id);
  });
  it('e3: "months" onto a UNITLESS factor whose option holds £40 (recognised family conflict) (expect refuse)', async () => {
    persisted = projectGraphForPersistence({ nodes: [
      { id: 'goal', kind: 'goal', label: 'Support capacity', goal_threshold: 0.1 },
      { id: 'tech_lead_hires', kind: 'factor', label: 'Service cost', scale_frame: 100 },
      { id: 'hiring_lead_time', kind: 'factor', label: 'Setup time', scale_frame: 12 },
      { id: 'hire_a_tech_lead', kind: 'option', label: 'Service plan', interventions: {
        tech_lead_hires: { value: 0.4, raw_value: 40, unit: 'GBP', source: 'cee_hypothesis' } } },
      { id: 'baseline', kind: 'option', label: 'Current plan', is_baseline: true },
    ], edges: [{ from: 'tech_lead_hires', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] }) as Graph;
    const r = await door([HLT, { ...TLH, value: 3, unit: 'months' }]);
    expect(r.status).toBe('refused');
    expect(rows.size).toBe(0);
  });
  // (f) top-level options[] legit
  it('f1: top-level options[] only: commits, cell = before + cap 10, engine reads 1', async () => {
    persisted.options = [structuredClone(node(persisted, 'hire_a_tech_lead'))];
    delete node(persisted, 'hire_a_tech_lead').interventions;
    persisted = projectGraphForPersistence(persisted) as Graph;
    const before = cold();
    const r = await door();
    expect(r.status).toBe('committed');
    expect(rows.size).toBe(1);
    const after = cold();
    const cell = tlCell(after, 'options');
    expect(cell).toEqual({ ...tlCell(before, 'options'), cap: 10 });
    expect(resolveRawInterventionValue(cell, buildFactorScaleMap(after.nodes).get('tech_lead_hires')).value).toBe(1);
  });
  it('f2: BOTH carriers (node + options[]) present: commits, both hold 1 tech lead', async () => {
    persisted.options = [structuredClone(node(persisted, 'hire_a_tech_lead'))];
    persisted = projectGraphForPersistence(persisted) as Graph;
    const r = await door();
    expect(r.status).toBe('committed');
    const after = cold();
    const scale = buildFactorScaleMap(after.nodes).get('tech_lead_hires');
    for (const c of [tlCell(after, 'nodes'), tlCell(after, 'options')]) {
      expect(c.raw_value).toBe(1); expect(c.source).toBe('cee_hypothesis'); expect(c.unit).toBe('tech leads');
      expect(resolveRawInterventionValue(c, scale).value).toBe(1);
    }
  });
  // (g) served card end to end
  it('g1: served card via authoriseChange: one commit, both adopted, 1 tech lead, readback agrees, may_run', async () => {
    const proposals = new ProposalStore();
    proposals.put(structuredClone(PROPOSAL));
    const caps = createAgentCapabilities(async () => ({ status: 200, json: { graph: cold(), graph_hash: hash() } }),
      proposals, undefined, 'full', undefined, { commitOptionLevels: input => commitOptionLevelsInProcess(input, 'req-review-card') });
    const result = await caps.authoriseChange({ scenario_id: SCENARIO_ID, authenticated_user_id: null,
      request_id: 'req-review-card', user_text: 'x', user_turn_text: 'Yes, use those.' } as never, { proposal_id: PROPOSAL.proposal_id });
    expect(result.ok).toBe(true);
    expect(rows.size).toBe(1);
    const rb = cold();
    for (const [id, raw, unit] of [['hiring_lead_time', 3, 'months'], ['tech_lead_hires', 0, 'hires']] as const) {
      const os = node(rb, id).observed_state as Dict;
      expect(os.raw_value).toBe(raw); expect(os.unit).toBe(unit); expect(os.source).toBe('user_assumption');
    }
    const cell = tlCell(rb);
    expect(cell.raw_value).toBe(1); expect(cell.source).toBe('cee_hypothesis');
    expect(resolveRawInterventionValue(cell, buildFactorScaleMap(rb.nodes).get('tech_lead_hires')).value).toBe(1);
    expect([...rows.values()][0]!.write.graph).toEqual(rb);
    expect(buildCanonicalAnalysisReadyFromGraph(rb as never)?.may_run).toBe(true);
  });
  // CAS / idempotency unchanged
  it('h1: stale base hash refuses or reports stale with no write', async () => {
    const r = await door([HLT, TLH], '0000000000000000');
    expect(['stale', 'refused']).toContain(r.status);
    expect(rows.size).toBe(0);
  });
  it('h2: the same press replayed (same turn id, same base) leaves exactly one row', async () => {
    const base = hash();
    expect((await door([HLT, TLH], base, 'prop-dup#levels')).status).toBe('committed');
    await door([HLT, TLH], base, 'prop-dup#levels');
    expect(rows.size).toBe(1);
  });
});
