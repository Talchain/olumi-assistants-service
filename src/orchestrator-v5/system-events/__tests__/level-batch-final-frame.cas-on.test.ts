import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import type { SessionStore, SessionTurnWrite } from '../../session/store.js';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import { _resetConfigCache } from '../../../config/index.js';
import { isEditableGraph } from '../editable-graph.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities, type InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { createProposal, ProposalStore } from '../../agent-lane/proposal.js';
import { runWithApprovedLevelAdoptions } from '../../agent-lane/approved-adoption-context.js';
import { commitOptionLevelsInProcess } from '../dispatch.js';
import { applyOptionInterventionEdit, executeOptionInterventionBatch, type OptionLevelTarget } from '../option-intervention-edit.js';

let activeStore: SessionStore;
vi.mock('../../session/index.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../session/index.js')>(),
  getSessionStore: () => activeStore,
}));

const scenario = '550e8400-e29b-41d4-a716-446655440000';
const turn = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ctx = { scenario_id: scenario, authenticated_user_id: 'user-a', request_id: 'sfr', user_text: 'Trial sets Duration to 0.3 days.' };

function graph(cap?: number, baseline = true) {
  const result: unknown = projectGraphForPersistence({ nodes: [
    { id: 'goal', kind: 'goal', label: 'Service quality' },
    { id: 'duration', kind: 'factor', label: 'Duration', ...(baseline ? { observed_state:
      { value: cap === undefined ? 0.5 : 0.005, unit: 'days', ...(cap !== undefined ? { raw_value: 0.5, cap } : {}) } } : {}) },
    { id: 'trial', kind: 'option', label: 'Trial' },
    { id: 'full', kind: 'option', label: 'Full' },
  ], edges: [['trial', 'duration'], ['full', 'duration'], ['duration', 'goal']].map(([from, to]) => ({
    from, to, strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive',
  })) });
  if (!isEditableGraph(result)) throw new Error('Invalid SFR fixture');
  return result;
}

function product(initial = graph()) {
  let bytes = JSON.stringify(initial);
  const writes: SessionTurnWrite[] = [];
  const registers: unknown[] = [];
  const read = () => JSON.parse(bytes) as ReturnType<typeof graph>;
  const hash = () => computeAnalysisAffectingGraphHash(read())!;
  const store = createMockSessionStore({
    loadGraph: async () => read(),
    loadGraphAndBriefText: async () => ({ graph: read(), briefText: null, revision: 7 + writes.length }),
    append: async write => {
      writes.push(structuredClone(write));
      if (write.graph !== undefined) bytes = JSON.stringify(write.graph);
      return { id: `row-${writes.length}` };
    },
    readRecent: async () => writes.map((w, i) => makeSessionTurnRow({
      id: `row-${i + 1}`, scenario_id: w.scenario_id, turn_id: w.turn_id, turn_class: w.turn_class,
      handler_id: w.handler_id, request_hash: w.request_hash, response_emitted: w.response_emitted,
      llm_calls_used: w.llm_calls_used, duration_ms: w.duration_ms, assistant_message: w.assistantMessage ?? null,
    })),
    readFactsWithTurnFor: async ids => writes.flatMap((w, i) => ids.includes(`row-${i + 1}`)
      ? w.handler_facts.map(fact => ({ turn_id: `row-${i + 1}`, fact_created_at: '2026-10-09T08:00:00Z', fact })) : []),
    getScenarioOwner: async () => null,
  });
  activeStore = store;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registers.push(structuredClone(body));
      bytes = JSON.stringify((body as { graph: unknown }).graph);
      return { status: 200, json: { graph_hash: hash() } };
    }
    return { status: 200, json: { graph: read(), graph_hash: hash() } };
  };
  return { read, hash, store, writes, registers, dispatch };
}

function target(optionId: string, raw: number, cap?: number): OptionLevelTarget {
  return { optionId, factorId: 'duration', modelValue: cap === undefined ? raw : raw / cap,
    figure: { raw_value: raw, unit: 'days', ...(cap !== undefined ? { cap } : {}) } };
}

function batch(p: ReturnType<typeof product>, targets: OptionLevelTarget[], turnId = turn) {
  return executeOptionInterventionBatch({ scenarioId: scenario, turnId, requestId: 'sfr',
    stage: 'frame', requestHash: 'sfr-batch', freshness: 'none', hasExistingAnalysis: false,
    expectedGraphHash: p.hash(), targets }, p.store);
}

function cell(p: ReturnType<typeof product>, id: string) {
  return p.read().nodes.find(n => n.id === id)!.interventions!.duration;
}

beforeEach(() => {
  __setUseAppendV6ForTest(true);
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'true');
  _resetConfigCache();
});
afterEach(() => { __setUseAppendV6ForTest(false); vi.unstubAllEnvs(); _resetConfigCache(); });

describe('native cohort on its final factor frame, CAS ON', () => {
  it.each([true, false])('witness (likely range %s): both siblings and frame in ONE append, authorship retained', async likely => {
    const p = product();
    const trial = { ...target('trial', 0.3), figure: { raw_value: 0.3, unit: 'days', ...(likely ? { likely_range: { low: 0.1, high: 0.5 } } : {}) } };
    const result = await runWithApprovedLevelAdoptions([{ scenarioId: scenario, proposalId: 'approved',
      optionId: 'full', factorId: 'duration', modelValue: 0.2 }], () => batch(p, [target('full', 20, 100), trial]));
    expect(result).toMatchObject({ kind: 'committed' });
    expect(p.writes).toHaveLength(1);
    expect(p.registers).toHaveLength(0);
    expect(cell(p, 'full')).toMatchObject({ value: 0.2, raw_value: 20, cap: 100, unit: 'days', source: 'cee_hypothesis' });
    expect(cell(p, 'trial')).toMatchObject({ value: 0.003, raw_value: 0.3, cap: 100, source: 'user_specified' });
    expect(p.read().nodes.find(n => n.id === 'duration')!.observed_state).toMatchObject({ value: 0.005, raw_value: 0.5, cap: 100 });
    if (likely) expect(cell(p, 'trial')).toHaveProperty('range', { low: 0.1, high: 0.5, meaning: 'likely_range', source: 'user_specified' });
  });

  it('two large siblings in both orders land on the same frame and byte-identical cells', async () => {
    const snapshots: unknown[] = [];
    for (const reverse of [false, true]) {
      const p = product();
      const targets = [target('full', 20, 100), target('trial', 150, 1000)];
      expect(await batch(p, reverse ? targets.reverse() : targets)).toMatchObject({ kind: 'committed' });
      expect(p.writes).toHaveLength(1);
      expect(p.read().nodes.find(n => n.id === 'duration')!.observed_state).toHaveProperty('cap', 1000);
      expect(cell(p, 'full')).toMatchObject({ value: 0.02, raw_value: 20, cap: 1000 });
      expect(cell(p, 'trial')).toMatchObject({ value: 0.15, raw_value: 150, cap: 1000 });
      snapshots.push(p.read());
    }
    expect(snapshots[0]).toStrictEqual(snapshots[1]);
  });

  it('preframed control: cells are byte-identical to today’s dedicated writer', async () => {
    const p = product(graph(100));
    const targets = [target('full', 20, 100), target('trial', 0.3, 100)];
    let expected = p.read();
    for (const t of targets) {
      const written = applyOptionInterventionEdit({ ...t, persistedGraph: expected,
        expectedGraphHash: computeAnalysisAffectingGraphHash(expected)!, freshness: 'none', hasExistingAnalysis: false,
        scenarioId: scenario, turnId: turn, requestId: 'sfr' });
      expect(written.kind).toBe('candidate');
      if (written.kind === 'candidate') expected = written.graph;
    }
    expect(await batch(p, targets)).toMatchObject({ kind: 'committed' });
    expect(p.read()).toStrictEqual(expected);
  });

  it.each(['cap', 'scale_frame'] as const)('door refuses capless figure on %s 100 even without a coherent baseline', async carrier => {
    const initial = graph();
    const factor = initial.nodes.find(n => n.id === 'duration')!;
    if (carrier === 'cap') factor.observed_state = { value: 0.5, raw_value: 40, cap: 100, unit: 'days' };
    else Object.assign(factor, { scale_frame: 100 });
    const p = product(projectGraphForPersistence(initial));
    const before = p.read();
    expect(await batch(p, [target('trial', 0.3)])).toMatchObject({ kind: 'refused', reason: 'level_frame_mismatch' });
    expect(p.writes).toHaveLength(0);
    expect(p.read()).toStrictEqual(before);
    expect(applyOptionInterventionEdit({ ...target('trial', 0.3), persistedGraph: before, expectedGraphHash: p.hash(),
      freshness: 'none', hasExistingAnalysis: false, scenarioId: scenario, turnId: turn, requestId: 'sfr' }))
      .toMatchObject({ kind: 'refused', reason: 'level_frame_mismatch' });
  });

  it('door accepts a capless figure on range 1', async () => {
    const initial = graph();
    initial.nodes.find(n => n.id === 'duration')!.observed_state = { value: 0.5, cap: 1, unit: 'days' };
    const p = product(projectGraphForPersistence(initial));
    expect(await batch(p, [target('trial', 0.3)])).toMatchObject({ kind: 'committed' });
    expect(cell(p, 'trial')).toMatchObject({ value: 0.3, raw_value: 0.3 });
  });

  it('out-of-frame native refuses the whole batch and preserves the original graph', async () => {
    const p = product(graph(100));
    const before = p.read();
    expect(await batch(p, [target('full', 20, 100), target('trial', 150, 1000)]))
      .toMatchObject({ kind: 'refused', reason: 'level_frame_mismatch' });
    expect(p.writes).toHaveLength(0);
    expect(p.read()).toStrictEqual(before);
  });

  it('an absent baseline stays absent while the factor and all levels receive the frame', async () => {
    const p = product(graph(undefined, false));
    expect(await batch(p, [target('full', 20, 100), target('trial', 0.3)])).toMatchObject({ kind: 'committed' });
    const factor = p.read().nodes.find(n => n.id === 'duration')!;
    expect(factor).not.toHaveProperty('observed_state');
    expect(factor).toHaveProperty('scale_frame', 100);
    expect(cell(p, 'trial')).toMatchObject({ value: 0.003, raw_value: 0.3, cap: 100 });
  });

  it('in-process bridge reports final committed coordinates and keeps adoption bound to the original target', async () => {
    const p = product();
    const result = await commitOptionLevelsInProcess({ scenario_id: scenario, base_graph_hash: p.hash(), turn_id: turn, links: [], levels: [
      { option_id: 'full', factor_id: 'duration', value: 0.2, raw_value: 20, cap: 100, unit: 'days', author: 'model_proposed' },
      { option_id: 'trial', factor_id: 'duration', value: 0.15, raw_value: 150, cap: 1000, unit: 'days', author: 'user_specified' },
    ] }, 'sfr');
    expect(result).toMatchObject({ status: 'committed', committed_levels: [
      { option_id: 'full', factor_id: 'duration', value: 0.02 },
      { option_id: 'trial', factor_id: 'duration', value: 0.15 },
    ] });
    expect(cell(p, 'full')).toMatchObject({ value: 0.02, raw_value: 20, cap: 1000, source: 'cee_hypothesis' });
    expect(cell(p, 'trial')).toMatchObject({ value: 0.15, raw_value: 150, cap: 1000, source: 'user_specified' });
    expect(p.writes).toHaveLength(1);
    const repeat = await commitOptionLevelsInProcess({ scenario_id: scenario, base_graph_hash: p.hash(),
      turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', links: [], levels: [
        { option_id: 'full', factor_id: 'duration', value: 0.2, raw_value: 20, cap: 100, unit: 'days', author: 'model_proposed' },
        { option_id: 'trial', factor_id: 'duration', value: 0.15, raw_value: 150, cap: 1000, unit: 'days', author: 'user_specified' },
      ] }, 'sfr');
    expect(repeat).toMatchObject({ status: 'committed', already_applied: true, committed_levels: [
      { option_id: 'full', factor_id: 'duration', value: 0.02 },
      { option_id: 'trial', factor_id: 'duration', value: 0.15 },
    ] });
    expect(p.writes).toHaveLength(1);
  });

  it('single-cell bridge carries the known native figure; a target without one keeps today’s behaviour', async () => {
    const p = product(graph(100));
    const result = await commitOptionLevelsInProcess({ scenario_id: scenario, base_graph_hash: p.hash(), turn_id: turn, links: [], levels: [
      { option_id: 'trial', factor_id: 'duration', value: 0.3, raw_value: 0.3, cap: 1, unit: 'days', author: 'model_proposed' },
    ] }, 'sfr');
    expect(result).toMatchObject({ status: 'committed', committed_levels: [{ option_id: 'trial', factor_id: 'duration', value: 0.003 }] });
    expect(cell(p, 'trial')).toMatchObject({ value: 0.003, raw_value: 0.3, cap: 100, source: 'cee_hypothesis' });
    const next = await batch(p, [{ optionId: 'full', factorId: 'duration', modelValue: 0.3 }], 'dddddddd-dddd-4ddd-8ddd-dddddddddddd');
    expect(next).toMatchObject({ kind: 'committed' });
    expect(cell(p, 'full')).toMatchObject({ value: 0.3, raw_value: 30, cap: 100 });
  });

  it.each([true, false])('real proposer/authoriser witness (likely range %s), one approval and one level batch', async likely => {
    const p = product();
    const calls: Parameters<typeof commitOptionLevelsInProcess>[0][] = [];
    const caps = createAgentCapabilities(p.dispatch, new ProposalStore(), undefined, 'full', undefined, {
      commitOptionLevels: input => { calls.push(input); return commitOptionLevelsInProcess(input, 'sfr'); },
    });
    const proposal = await caps.proposeOptionInterventions(ctx, { interventions: [
      { option_label: 'Trial', factor_label: 'Duration', value: 0.3, user_stated: true, basis: 'the user’s stated duration',
        ...(likely ? { likely_low: 0.1, likely_high: 0.5, range_meaning: 'likely_range' as const, range_user_stated: true } : {}) },
      { option_label: 'Full', factor_label: 'Duration', value: 20, basis: 'an estimate for approval' },
    ] });
    expect(proposal.ok).toBe(true);
    const result = await caps.authoriseChange({ ...ctx, typed_approval_of: String(proposal.proposal_id) }, { proposal_id: String(proposal.proposal_id) });
    expect(result).toMatchObject({ ok: true, applied: true });
    expect(calls).toHaveLength(1);
    expect(p.writes).toHaveLength(1);
    expect(p.registers).toHaveLength(1); // Retained separate range registration; existing receipt specs pin it.
    expect(calls[0]!.levels.find(l => l.option_id === 'trial')).toMatchObject({ value: 0.003, raw_value: 0.3, cap: 100 });
    expect(cell(p, 'full')).toMatchObject({ value: 0.2, raw_value: 20, cap: 100, source: 'cee_hypothesis' });
    expect(cell(p, 'trial')).toMatchObject({ value: 0.003, raw_value: 0.3, cap: 100, source: 'user_specified' });
  });

  it.each([false, true])('both authorisers settle large siblings over the whole cohort (compound %s), in either order', async compound => {
    const snapshots: unknown[] = [];
    for (const reverse of [false, true]) {
      const initial = graph();
      if (compound) initial.nodes.push({ id: 'other', kind: 'factor', label: 'Other duration', observed_state: { value: 0.5, unit: 'days' } });
      const p = product(projectGraphForPersistence(initial));
      const store = new ProposalStore();
      const operations = [
        { op: 'set_option_intervention' as const, path: 'full::duration', value: { raw: 20, normalised: 0.2, cap: 100, derived_frame: 100, unit: 'days' } },
        { op: 'set_option_intervention' as const, path: 'trial::duration', value: { raw: 150, normalised: 0.15, cap: 1000, derived_frame: 1000, unit: 'days' } },
      ];

      const proposal = createProposal({ scenario_id: scenario, user_id: ctx.authenticated_user_id, base_graph_identity_hash: p.hash(),
        operations: [...(reverse ? operations.reverse() : operations), ...(compound ? [{ op: 'set_factor_value' as const, path: 'other', value: { value: 0.6, unit: 'days', authored_by: 'user_stated' } }] : [])], provenance: { authored_by: 'model_proposed' },
        validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Set both durations' });
      store.put(proposal);
      const caps = createAgentCapabilities(p.dispatch, store, undefined, 'full', undefined, {
        commitOptionLevels: input => commitOptionLevelsInProcess(input, 'sfr'),
      });
      const result = await caps.authoriseChange(ctx, { proposal_id: proposal.proposal_id });
      expect(result, JSON.stringify(result)).toMatchObject({ ok: true, applied: true });
      expect(cell(p, 'full')).toMatchObject({ value: 0.02, raw_value: 20, cap: 1000, source: 'cee_hypothesis' });
      expect(cell(p, 'trial')).toMatchObject({ value: 0.15, raw_value: 150, cap: 1000, source: 'cee_hypothesis' });
      expect(p.writes).toHaveLength(1);
      expect(p.registers).toHaveLength(compound ? 0 : 1);
      snapshots.push(p.read());
    }
    expect(snapshots[0]).toStrictEqual(snapshots[1]);
  });
});
