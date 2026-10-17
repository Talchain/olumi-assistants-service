import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildCanonicalAnalysisReadyFromGraph, mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { buildFactorScaleMap, resolveRawInterventionValue } from '../../tools/plot-intervention-scale.js';
import * as writer from '../factor-value-edit.js';
import { factorValuesPostimageIsScoped } from '../option-intervention-edit.js';
import { commitOptionLevelsInProcess, type CommitOptionLevelsInput } from '../dispatch.js';
import { createAgentCapabilities } from '../../agent-lane/runtime/agent-capabilities.js';
import { createProposal, ProposalStore } from '../../agent-lane/proposal.js';

type Dict = Record<string, unknown>;
type Graph = { nodes: (Dict & { id: string; kind: string })[]; edges: Dict[]; options?: Dict[] };
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/s5-starting-figures/served-graph-rev2.json', import.meta.url), 'utf8')) as Graph;
const PROPOSAL = JSON.parse(readFileSync(new URL('./fixtures/s5-starting-figures/served-proposal.json', import.meta.url), 'utf8'));
const SCENARIO_ID = 'e09de419-4d76-405e-b47e-d2fce5568c31';
const BRIEF = "Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality? We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we're lacking leadership. Our budget is £200,000, but we'd like to spend less.";
const HLT = { factor_id: 'hiring_lead_time', value: 3, unit: 'months', author: 'model_proposed' as const };
const TLH = { factor_id: 'tech_lead_hires', value: 0, unit: 'tech leads', author: 'model_proposed' as const };
let persisted: Graph = structuredClone(SERVED);
const rows = new Map<string, { id: string; write: SessionTurnWrite }>();
const cold = (): Graph => JSON.parse(JSON.stringify(persisted));
const hash = () => computeAnalysisAffectingGraphHash(persisted as never)!;
const factor = (g: Graph, id: string) => g.nodes.find(n => n.id === id)!;

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

const door = (values: CommitOptionLevelsInput['values'] = [HLT, TLH]) => commitOptionLevelsInProcess({
  scenario_id: SCENARIO_ID, base_graph_hash: hash(), turn_id: 'prop-s5-starting-figures#levels',
  links: [], levels: [], values,
}, 'req-s5');

function checkAdopted(g: Graph, id: string, raw: number, unit: string) {
  const os = factor(g, id).observed_state as Dict;
  expect(os.raw_value).toBe(raw);
  expect(os.unit).toBe(unit);
  expect(os.source).toBe('user_assumption');
  expect(os.reviewed_by_user).toEqual({ intent: 'confirm', at: expect.any(String) });
}

beforeEach(() => { persisted = structuredClone(SERVED); rows.clear(); });
afterEach(() => vi.restoreAllMocks());

describe('S5 starting figures: real in-process door, serialized store/readback', () => {
  it('served fixture is the exact card base', () => expect(hash()).toBe('4d0cbc289f487354'));

  it('served press stores BOTH adopted Olumi figures in ONE append, keeps one Tech lead, agrees on readback and may_run', async () => {
    const beforeCell = structuredClone(mergeInterventionSourceObjects(factor(persisted, 'hire_a_tech_lead')).tech_lead_hires);
    const result = await door();
    expect(result.status).toBe('committed');
    expect(rows.size).toBe(1);
    const readback = cold();
    checkAdopted(readback, 'hiring_lead_time', 3, 'months');
    checkAdopted(readback, 'tech_lead_hires', 0, 'tech leads');
    const option = factor(readback, 'hire_a_tech_lead');
    const cell = mergeInterventionSourceObjects(option).tech_lead_hires;
    expect(cell).toEqual({ ...(beforeCell as Dict), cap: 10 });
    expect(resolveRawInterventionValue(cell, buildFactorScaleMap(readback.nodes).get('tech_lead_hires')).value).toBe(1);
    expect(result.status === 'committed' && result.graph_hash).toBe(hash());
    expect(result.status === 'committed' && result.reencoded_siblings).toEqual([]);
    expect([...rows.values()][0]!.write.graph).toEqual(readback);
    const readiness = buildCanonicalAnalysisReadyFromGraph(readback as never);
    expect(readiness?.may_run).toBe(true);
  });

  it('stored proposal -> authoriseChange -> real door lands the card once', async () => {
    // DL16:52: supported replacement card; the captured old relabel is retained in its JSON fixture.
    const content = structuredClone(PROPOSAL);
    content.operations.find((op: { path: string }) => op.path === TLH.factor_id).value.unit = TLH.unit;
    content.public_label = content.public_label.replace('Tech lead hires = 0 hires', 'Tech lead hires = 0 tech leads');
    const replacement = createProposal(content);
    const proposals = new ProposalStore();
    proposals.put(replacement);
    const caps = createAgentCapabilities(async () => ({ status: 200, json: { graph: cold(), graph_hash: hash() } }),
      proposals, undefined, 'full', undefined, { commitOptionLevels: input => commitOptionLevelsInProcess(input, 'req-s5-card') });
    const result = await caps.authoriseChange({ scenario_id: SCENARIO_ID, authenticated_user_id: null,
      request_id: 'req-s5-card', user_text: BRIEF, user_turn_text: 'Yes, use those.' } as never,
    { proposal_id: replacement.proposal_id });
    expect(result.ok).toBe(true);
    expect(rows.size).toBe(1);
    for (const [id, raw] of [['hiring_lead_time', 3], ['tech_lead_hires', 0]] as const) {
      const os = factor(cold(), id).observed_state as Dict;
      expect(os.raw_value).toBe(raw);
      expect(os.source).toBe('user_assumption');
    }
  });

  for (const brief of ['hiring', 'service capacity'] as const) for (const carrier of ['interventions', 'data', 'options'] as const) {
    it(`${brief}: admits only the writer's exact quantity-preserving rewrite in ${carrier}`, async () => {
      if (brief === 'service capacity') {
        // Independent brief: "Expand support capacity; consider a £40 service plan or the current plan."
        // Olumi proposes a £20 current cost and 3 months setup; the option remains £40.
        persisted = projectGraphForPersistence({ nodes: [
          { id: 'goal', kind: 'goal', label: 'Support capacity', goal_threshold: 0.1 },
          { id: 'tech_lead_hires', kind: 'factor', label: 'Service cost', scale_frame: 100 },
          { id: 'hiring_lead_time', kind: 'factor', label: 'Setup time', scale_frame: 12 },
          { id: 'hire_a_tech_lead', kind: 'option', label: 'Service plan', interventions: {
            tech_lead_hires: { value: 0.4, raw_value: 40, unit: 'GBP', source: 'cee_hypothesis' } } },
          { id: 'baseline', kind: 'option', label: 'Current plan', is_baseline: true },
        ], edges: [{ from: 'tech_lead_hires', to: 'goal', strength: { mean: 0.5, std: 0.1 },
          exists_probability: 1, effect_direction: 'positive' }] }) as Graph;
      }
      const option = factor(persisted, 'hire_a_tech_lead');
      if (carrier === 'data') { option.data = { interventions: option.interventions }; delete option.interventions; }
      if (carrier === 'options') {
        persisted.options = [structuredClone(option)];
        delete option.interventions;
      }
      persisted = projectGraphForPersistence(persisted) as Graph;
      const before = cold();
      const v = brief === 'hiring' ? TLH : { ...TLH, value: 20, unit: 'GBP' };
      expect((await door([HLT, v])).status).toBe('committed');
      expect(rows.size).toBe(1);
      const after = cold();
      const heldBefore = carrier === 'options' ? before.options![0]! : factor(before, 'hire_a_tech_lead');
      const heldAfter = carrier === 'options' ? after.options![0]! : factor(after, 'hire_a_tech_lead');
      const cell = mergeInterventionSourceObjects(heldAfter).tech_lead_hires as Dict;
      expect(cell).toEqual({ ...(mergeInterventionSourceObjects(heldBefore).tech_lead_hires as Dict), cap: brief === 'hiring' ? 10 : 100 });
      expect(resolveRawInterventionValue(cell, buildFactorScaleMap(after.nodes).get('tech_lead_hires')).value).toBe(brief === 'hiring' ? 1 : 40);
      expect(factorValuesPostimageIsScoped(before, after, ['hiring_lead_time', 'tech_lead_hires'])).toBe(true);
    });
  }

  for (const carrier of ['nodes', 'options'] as const) for (const change of ['quantity', 'unit', 'authorship', 'unrelated option'] as const) {
    it(`REFUSES genuine ${change} change in ${carrier} in the same commit; names FIRST value, writes nothing`, async () => {
      if (carrier === 'options') persisted.options = [structuredClone(factor(persisted, 'hire_a_tech_lead'))];
      persisted = projectGraphForPersistence(persisted) as Graph;
      const before = cold();
      const real = writer.applyFactorValueEdit;
      vi.spyOn(writer, 'applyFactorValueEdit').mockImplementation(async input => {
        const res = await real(input);
        if (res.kind !== 'mutated' || input.event.target_id !== TLH.factor_id) return res;
        const g = res.mutatedGraph as Graph;
        const option = carrier === 'options' ? g.options![0]! : factor(g, 'hire_a_tech_lead');
        const cell = mergeInterventionSourceObjects(option).tech_lead_hires as Dict;
        if (change === 'quantity') { cell.value = 0.2; cell.raw_value = 2; }
        if (change === 'unit') cell.unit = 'GBP';
        if (change === 'authorship') cell.source = 'user_specified';
        if (change === 'unrelated option') factor(g, 'hire_two_developers').label = 'Unapproved rename';
        return res;
      });
      expect(await door([TLH, HLT])).toEqual({ status: 'refused', reason: 'value_scope_mismatch', value: { factor_id: TLH.factor_id } });
      expect(rows.size).toBe(0);
      expect(cold()).toEqual(before);
    });
  }

  it('refusal identifies a later offending value too, without writing an earlier valid value', async () => {
    const before = cold();
    const real = writer.applyFactorValueEdit;
    vi.spyOn(writer, 'applyFactorValueEdit').mockImplementation(async input => {
      const res = await real(input);
      if (res.kind === 'mutated' && input.event.target_id === HLT.factor_id) (res.mutatedGraph as Graph).nodes[0]!.label = 'Unapproved rename';
      return res;
    });
    expect(await door([TLH, HLT])).toEqual({ status: 'refused', reason: 'value_scope_mismatch', value: { factor_id: HLT.factor_id } });
    expect(rows.size).toBe(0);
    expect(cold()).toEqual(before);
  });

  it('TL 14:18: money on an already count-unit factor is refused atomically, even with an unrelated valid time value', async () => {
    factor(persisted, TLH.factor_id).observed_state = { value: 0, raw_value: 0, cap: 10, unit: 'hires', source: 'user_assumption' };
    persisted = projectGraphForPersistence(persisted) as Graph;
    const before = cold();
    const result = await door([HLT, { ...TLH, unit: 'GBP' }]);
    expect(result.status).toBe('refused');
    expect(result.status === 'refused' && result.value).toEqual({ factor_id: TLH.factor_id });
    expect(rows.size).toBe(0);
    expect(cold()).toEqual(before);
  });
});
