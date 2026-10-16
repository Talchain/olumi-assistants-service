import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionTurnWrite } from '../../session/store.js';
import { getSessionStore } from '../../session/index.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { createAgentCapabilities } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { runWithApprovedLevelAdoptions } from '../../agent-lane/approved-adoption-context.js';
import { optionGapsHeld, parseOptionGapsOfLevelOps } from '../../agent-lane/unmodelled-mechanisms.js';
import { commitOptionLevelsInProcess } from '../dispatch.js';
import * as native from '../option-intervention-edit.js';
import { preOfferOptionInterventions } from '../option-intervention-preoffer.js';

type Dict = Record<string, unknown>;
type Graph = { nodes: (Dict & { id: string; kind: string })[]; edges: Dict[] };
const SCENARIO = 'e09de419-4d76-405e-b47e-d2fce5568c31';
const node = (g: Graph, id: string) => g.nodes.find(n => n.id === id)!;
const cell = (g: Graph) => (node(g, 'pilot').interventions as Dict).staffing as Dict;

function fixture(unit = 'tech leads', goal = 'Delivery capacity'): Graph {
  return projectGraphForPersistence({ nodes: [
    { id: 'goal', kind: 'goal', label: goal, goal_threshold: 0.1 },
    { id: 'staffing', kind: 'factor', label: 'Staffing', category: 'controllable', scale_frame: 10 },
    { id: 'pilot', kind: 'option', label: 'Pilot', interventions: {
      staffing: { value: 0.1, raw_value: 1, unit, source: 'cee_hypothesis', user_material_unverified: true } } },
    // A neighbouring quantity is neither this proposal's unit nor its authorship authority.
    { id: 'budget', kind: 'factor', label: 'Budget', observed_state: {
      value: 0.4, raw_value: 40, cap: 100, unit: 'GBP', source: 'brief_extraction' } },
  ], edges: [
    { from: 'pilot', to: 'staffing', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
    { from: 'staffing', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' },
  ] }) as Graph;
}

let persisted = fixture();
const rows = new Map<string, { id: string; write: SessionTurnWrite }>();
const cold = (): Graph => JSON.parse(JSON.stringify(persisted));
const hash = () => computeAnalysisAffectingGraphHash(persisted as never)!;
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

const request = (unit = 'tech leads'): native.OptionInterventionBatchExecutionInput => ({
  scenarioId: SCENARIO, turnId: 'preoffer-card', requestId: 'req-preoffer', requestHash: 'sha256:preoffer',
  expectedGraphHash: hash(), stage: 'frame', freshness: 'none', hasExistingAnalysis: false,
  values: [{ factorId: 'staffing', value: 0, unit, adopted: true }],
  targets: [{ optionId: 'pilot', factorId: 'staffing', modelValue: 0.2, figure: { raw_value: 2, cap: 10, unit } }],
  optionGaps: [{ optionId: 'pilot', mechanisms: ['Onboarding support'] }], expectedLinks: [],
});
const inAdoption = <T,>(input: native.OptionInterventionBatchExecutionInput, work: () => Promise<T>) => runWithApprovedLevelAdoptions(
  input.targets.map(t => ({ scenarioId: input.scenarioId, proposalId: input.turnId,
    optionId: t.optionId, factorId: t.factorId, modelValue: t.modelValue })), work);

beforeEach(() => {
  persisted = fixture(); rows.clear();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-16T19:00:00.000Z'));
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('S5 complete native preparation before an offer', () => {
  it('passes the complete input/base/context once and returns the identical native prepared candidate', async () => {
    persisted = JSON.parse(readFileSync(new URL('./fixtures/s5-starting-figures/served-graph-rev2.json', import.meta.url), 'utf8')) as Graph;
    const input: native.OptionInterventionBatchExecutionInput = { ...request(),
      values: [{ factorId: 'hiring_lead_time', value: 3, unit: 'months', adopted: true },
        { factorId: 'tech_lead_hires', value: 0, unit: 'tech leads', adopted: true }],
      targets: [{ optionId: 'hire_a_tech_lead', factorId: 'tech_lead_hires', modelValue: 0.2,
        figure: { raw_value: 2, cap: 10, unit: 'tech leads' } }],
      optionGaps: [{ optionId: 'hire_a_tech_lead', mechanisms: ['Onboarding support'] }],
    };
    const supplied = cold(); const before = cold();
    const context = { briefText: 'Consider delivery capacity; the budget is £40, not a staffing figure.' };
    const prepare = vi.spyOn(native, 'prepareOptionInterventionBatchExecution');
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No provider/engine/DB calls'));
    const result = await inAdoption(input, () => preOfferOptionInterventions(input, supplied, context));
    expect(prepare).toHaveBeenCalledExactlyOnceWith(input, supplied, context);
    expect(result.offer).toBe(true);
    if (!result.offer) throw new Error('expected a complete native candidate');
    expect(result.prepared).toBe(await prepare.mock.results[0]!.value);
    expect(result.prepared.values).toEqual(input.values);
    expect(optionGapsHeld(result.prepared.graph, input.optionGaps!)).toBe(true);
    const candidate = result.prepared.graph as Graph;
    expect((node(candidate, 'hiring_lead_time').observed_state as Dict).raw_value).toBe(3);
    expect((node(candidate, 'tech_lead_hires').observed_state as Dict).raw_value).toBe(0);
    expect((node(candidate, 'hire_a_tech_lead').interventions as Dict).tech_lead_hires)
      .toMatchObject({ raw_value: 2, unit: 'tech leads', source: 'cee_hypothesis' });
    expect(node(candidate, 'hire_two_developers')).toEqual(node(before, 'hire_two_developers'));
    expect(supplied).toEqual(before); expect(cold()).toEqual(before); expect(rows.size).toBe(0);
    expect((await execute(input)).kind).toBe('committed');
    expect(rows.size).toBe(1); expect(cold()).toEqual(candidate);
    expect([...rows.values()][0]!.write.graph).toEqual(candidate);
    expect(network).not.toHaveBeenCalled();
  });

  it.each(['hires', 'tickets', 'GBP'])('refuses the %s relabel as the exact native refusal, with same-turn unit guidance and no write', async unit => {
    const input = request(unit); const before = cold();
    const prepare = vi.spyOn(native, 'prepareOptionInterventionBatchExecution');
    const result = await inAdoption(input, () => preOfferOptionInterventions(input, before));
    expect(result.offer).toBe(false);
    if (result.offer) throw new Error('an unsavable card must not be offered');
    expect(result.refusal).toBe(await prepare.mock.results[0]!.value);
    expect(result.refusal).toEqual({ kind: 'refused', reason: 'value_scope_mismatch', valueIndex: 0 });
    expect(result.detail).toBe('The proposed value does not preserve the saved quantity, unit or author. '
      + 'Give the value in the unit the saved option or factor already holds, as get_canonical_state shows it; never relabel what is counted.');
    expect(await execute(input)).toEqual(result.refusal);
    expect(rows.size).toBe(0); expect(cold()).toEqual(before);
  });

  it.each(['missing level', 'level coordinate', 'gap anchor', 'declared links', 'stale base'] as const)(
    'refuses an incomplete/invalid %s after preparing the WHOLE candidate', async fault => {
      const good = request();
      const input = fault === 'missing level' ? { ...good, targets: [] }
        : fault === 'level coordinate' ? { ...good, targets: [{ ...good.targets[0]!, modelValue: 0.3 }] }
        : fault === 'gap anchor' ? { ...good, optionGaps: [{ optionId: 'another_option', mechanisms: ['Onboarding support'] }] }
        : fault === 'declared links' ? { ...good, expectedLinks: ['pilot::budget'] }
        : { ...good, expectedGraphHash: '0000000000000000' };
      const reasons = { 'missing level': 'option_gap_without_level_anchor', 'level coordinate': 'level_frame_mismatch',
        'gap anchor': 'option_gap_without_level_anchor', 'declared links': 'links_mismatch', 'stale base': 'stale_graph' };
      const before = cold();
      const result = await inAdoption(input, () => preOfferOptionInterventions(input, before));
      expect(result.offer).toBe(false);
      if (result.offer) throw new Error('expected complete-candidate refusal');
      expect(result.refusal).toMatchObject({ kind: 'refused', reason: reasons[fault] });
      expect(result.detail).not.toContain(reasons[fault]);
      expect(await execute(input)).toEqual(result.refusal);
      expect(rows.size).toBe(0); expect(cold()).toEqual(before);
    });

  it('keeps an unchanged result out of the card path', async () => {
    const input = { ...request(), values: [], targets: [{ optionId: 'pilot', factorId: 'staffing', modelValue: 0.1 }], optionGaps: [] };
    const result = await inAdoption(input, () => preOfferOptionInterventions(input, cold()));
    expect(result).toEqual({ offer: false, refusal: { kind: 'unchanged' },
      detail: 'The saved model already holds this change; no approval card is needed.' });
    expect(rows.size).toBe(0);
  });

  it.each([['tech leads', 'Delivery capacity'], ['tickets', 'Support coverage']])(
    'offers the held %s unit and the native door saves/readbacks the exact complete %s candidate', async (unit, goal) => {
      persisted = fixture(unit, goal);
      const input = request(unit); const before = cold();
      const result = await inAdoption(input, () => preOfferOptionInterventions(input, before));
      expect(result.offer).toBe(true);
      if (!result.offer) throw new Error('expected offer in the held unit');
      const committed = await execute(input);
      expect(committed.kind).toBe('committed');
      expect(rows.size).toBe(1);
      expect(cold()).toEqual(result.prepared.graph);
      expect([...rows.values()][0]!.write.graph).toEqual(result.prepared.graph);
      expect(cell(cold())).toMatchObject({ raw_value: 2, unit, source: 'cee_hypothesis' });
      expect((node(cold(), 'staffing').observed_state as Dict).source).toBe('user_assumption');
      expect(node(cold(), 'budget')).toEqual(node(before, 'budget'));
    });

  it.each(['tech leads', 'hires'])('binds the real %s proposer/card to the same preparation before a native approved save', async unit => {
    const proposals = new ProposalStore();
    const caps = createAgentCapabilities(async () => ({ status: 200, json: { graph: cold(), graph_hash: hash() } }),
      proposals, undefined, 'full', undefined, { commitOptionLevels: input => commitOptionLevelsInProcess(input, 'req-real-card') });
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-real-card',
      user_text: 'Explore delivery capacity; the budget is £40.', user_turn_text: 'Explore delivery capacity; the budget is £40.' };
    const proposed = await caps.proposeStartingPoint(ctx as never, {
      assumptions: [{ factor_label: 'Staffing', value: 0, unit, basis: 'A provisional starting point', user_stated: false }],
      option_levels: [{ option_label: 'Pilot', factor_label: 'Staffing', value: 2,
        basis: 'A provisional pilot level', unmodelled_mechanisms: ['Onboarding support'], user_stated: false }],
    });
    expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
    const card = proposals.get(proposed.proposal_id as string)!;
    expect(card.operations.filter(op => op.op === 'set_factor_value').map(op => [op.path, op.value])).toEqual([
      ['staffing', { value: 0, unit, authored_by: 'model_proposed', basis: 'A provisional starting point' }],
    ]);
    const levels = card.operations.filter(op => op.op === 'set_option_intervention');
    expect(levels).toHaveLength(1);
    expect(levels[0]!.path).toBe('pilot::staffing');
    expect(levels[0]!.value).toMatchObject({ normalised: 0.2, raw: 2, cap: 10,
      authored_by: 'model_proposed', unmodelled_mechanisms: ['Onboarding support'] });
    // Served tool shape (agent-tools.ts option_levels has no unit): the level carries none; the factor's held unit decides.
    expect(Object.keys(levels[0]!.value as object)).not.toContain('unit');
    // The production callsite remains Founder's lease; this test binds its complete native input to the real stored card.
    const valueOp = card.operations.find(op => op.op === 'set_factor_value')!;
    const value = valueOp.value as { value: number; unit: string; authored_by: string };
    const level = levels[0]!.value as { normalised: number; raw: number; cap: number; unit: string };
    const gaps = parseOptionGapsOfLevelOps(card.operations);
    expect(gaps.kind).toBe('valid');
    if (gaps.kind !== 'valid') throw new Error('expected the complete card gaps');
    const input = { ...request(unit), expectedGraphHash: card.base_graph_identity_hash,
      values: [{ factorId: valueOp.path, value: value.value, unit: value.unit, adopted: value.authored_by === 'model_proposed' }],
      targets: [{ optionId: 'pilot', factorId: 'staffing', modelValue: level.normalised,
        figure: { raw_value: level.raw, cap: level.cap, unit: level.unit } }], optionGaps: gaps.declarations };
    const offered = await inAdoption(input, () => preOfferOptionInterventions(input, cold()));
    expect(rows.size).toBe(0);
    if (unit === 'hires') {
      expect(offered.offer).toBe(false);
      expect(offered).toMatchObject({ offer: false, refusal: { kind: 'refused', reason: 'value_scope_mismatch', valueIndex: 0 } });
      expect(await execute(input)).toEqual(!offered.offer && offered.refusal);
      expect(rows.size).toBe(0);
      return;
    }
    expect(offered.offer).toBe(true);
    if (!offered.offer) throw new Error('expected savable offered card');
    const unapproved = await caps.authoriseChange({ ...ctx, user_turn_text: 'Yes, use those.' } as never,
      { proposal_id: card.proposal_id });
    expect(unapproved).toEqual({ ok: false, mutated: false, refusal: 'approval_required' });
    expect(rows.size).toBe(0);
    const approved = await caps.authoriseChange({ ...ctx, user_turn_text: 'Yes, use those.', typed_approval_of: card.proposal_id } as never,
      { proposal_id: card.proposal_id });
    expect(approved.ok, JSON.stringify(approved)).toBe(true);
    expect(rows.size).toBe(1); expect(cold()).toEqual(offered.prepared.graph);
    expect([...rows.values()][0]!.write.graph).toEqual(offered.prepared.graph);
    expect(card.proposal_id).toBe(proposed.proposal_id);
  });

});

function execute(input: native.OptionInterventionBatchExecutionInput) {
  return inAdoption(input, () => native.executeOptionInterventionBatch(input, getSessionStore()));
}
