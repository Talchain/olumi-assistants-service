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
import { commitOptionLevelsInProcess } from '../dispatch.js';
import { executeOptionInterventionBatch, type OptionLevelTarget } from '../option-intervention-edit.js';

import { buildFactorScaleMap, resolveRawInterventionValue } from '../../tools/plot-intervention-scale.js';
import { mergeInterventionSourceObjects } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { preserveSiblingQuantities, SIBLING_LEVEL_UNRESOLVABLE_SENTENCE, siblingReencodeDisclosure } from '../../agent-lane/level-batch-frame.js';
import { compareVersionRecords } from '../../model-management/compare.js';
import type { ModelVersionRecord } from '../../model-management/types.js';

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
      return { status: 200, json: { graph_hash: hash(), model_version: { version_number: 8, version_id: 'range-version', mutation_id: 'range-mutation' } } };
    }
    return { status: 200, json: { graph: read(), graph_hash: hash() } };
  };
  return { read, hash, store, writes, registers, dispatch, replace: (next: ReturnType<typeof graph>) => { bytes = JSON.stringify(next); } };
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


function engine(g: ReturnType<typeof graph>, optionId = 'full') {
  const node = g.nodes.find(n => n.id === optionId)!;
  return resolveRawInterventionValue(mergeInterventionSourceObjects(node)["duration"], buildFactorScaleMap(g.nodes).get('duration')).value;
}
function withSibling(initial = graph(), value: unknown = { value: 0.2, source: 'cee_hypothesis' }) {
  const full = initial.nodes.find(n => n.id === 'full')!;
  Object.assign(full, { interventions: { duration: value } });
  return projectGraphForPersistence(initial) as ReturnType<typeof graph>;
}
function version(g: unknown, id: string): ModelVersionRecord {
  return { id, graph: g, graph_identity_hash: id, identity_projection_version: 1,
    identity_normaliser_version: 1, graph_schema_version: 3 } as unknown as ModelVersionRecord;
}
function approved(p: ReturnType<typeof product>, compound: boolean, oneLevel = false) {
  const store = new ProposalStore();
  const operations = oneLevel ? [
    { op: 'set_option_intervention' as const, path: 'trial::duration', value: { raw: 150, normalised: 0.15, cap: 1000, derived_frame: 1000, unit: 'days' } },
  ] : [
    { op: 'set_option_intervention' as const, path: 'full::duration', value: { raw: 20, normalised: 0.2, cap: 100, derived_frame: 100, unit: 'days' } },
    { op: 'set_option_intervention' as const, path: 'trial::duration', value: { raw: 150, normalised: 0.15, cap: 1000, derived_frame: 1000, unit: 'days' } },
  ];
  const proposal = createProposal({ scenario_id: scenario, user_id: ctx.authenticated_user_id, base_graph_identity_hash: p.hash(),
    operations: [...operations, ...(compound ? [{ op: 'set_factor_value' as const, path: 'other', value: { value: 0.6, unit: 'days', authored_by: 'user_stated' } }] : [])],
    provenance: { authored_by: 'model_proposed' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Set durations' });
  store.put(proposal);
  return { store, proposal };
}
function withOther(initial: ReturnType<typeof graph>) {
  initial.nodes.push({ id: 'other', kind: 'factor', label: 'Other duration', observed_state: { value: 0.5, unit: 'days' } });
  return projectGraphForPersistence(initial) as ReturnType<typeof graph>;
}

describe('SFR fix2b: native quantities, atomic refusal and visible sibling writes', () => {
  it.each([true, false])('resolvable sibling keeps the PLoT quantity (baseline %s), including source and every other field', async baseline => {
    const initial = withSibling(graph(undefined, baseline), { value: 0.2, source: 'cee_hypothesis', confidence: 0.7,
      range: { low: 0.1, high: 0.3, source: 'olumi_estimate', meaning: 'likely_range' } });
    const p = product(initial);
    const before = engine(p.read());
    expect(before).toBe(0.2);
    const result = await batch(p, [target('trial', 150, 1000)]);
    expect(result).toMatchObject({ kind: 'committed' });
    expect(p.writes).toHaveLength(1);
    expect(engine(p.read())).toBe(before);
    expect(cell(p, 'full')).toEqual({ ...initial.nodes.find(n => n.id === 'full')!.interventions!.duration,
      value: 0.0002, raw_value: 0.2, cap: 1000 });
  });

  it('the same-value target with stale raw/cap is rewritten, not skipped (reviewer reproduction)', async () => {
    const p = product(withSibling(graph(), { value: 0.2, raw_value: 0.2, source: 'cee_hypothesis' }));
    const result = await batch(p, [target('full', 20, 100), target('trial', 0.3)]);
    expect(result, JSON.stringify(result)).toMatchObject({ kind: 'committed' });
    expect(cell(p, 'full')).toMatchObject({ value: 0.2, raw_value: 20, cap: 100, unit: 'days' });
    expect(engine(p.read())).toBe(20);
  });

  it.each([true, false])('unresolvable sibling refuses the whole batch with the named reason and zero writes (baseline %s)', async baseline => {
    // A raw-only numeric cell has no engine-read value: the resolver membership
    // gate requires value. It is not an encoded code and cannot be assumed safe.
    const p = product(withSibling(graph(undefined, baseline), { raw_value: 0.2, source: 'cee_hypothesis' }));
    const before = p.read();
    expect(engine(before)).toBeNull();
    expect(await batch(p, [target('trial', 150, 1000)])).toMatchObject({ kind: 'refused', reason: 'sibling_level_unresolvable' });
    expect(p.writes).toHaveLength(0);
    expect(p.read()).toStrictEqual(before);
  });

  it('out-of-range sibling refuses all targets and the range without a write', async () => {
    const p = product(withSibling(graph(), { value: 0.2, raw_value: 1001, source: 'cee_hypothesis' }));
    const before = p.read();
    expect(await batch(p, [target('trial', 150, 1000)])).toMatchObject({ kind: 'refused', reason: 'level_frame_mismatch' });
    expect(p.writes).toHaveLength(0);
    expect(p.read()).toStrictEqual(before);
  });

  it.each([
    { value: 1, raw_value: true, value_type: 'boolean', encoding_map: { false: 0, true: 1 } },
    { value: 0, raw_value: 'slow', value_type: 'categorical', encoding_map: { slow: 0, fast: 1 } },
  ])('encoded code is resolver-proven invariant under attachment: %j', async encoded => {
    const p = product(withSibling(graph(), encoded));
    const before = cell(p, 'full');
    const quantity = engine(p.read());
    expect(await batch(p, [target('trial', 150, 1000)])).toMatchObject({ kind: 'committed' });
    expect(cell(p, 'full')).toStrictEqual(before);
    expect(engine(p.read())).toBe(quantity);
  });

  it('preframed untouched sibling remains byte-identical', async () => {
    const p = product(withSibling(graph(1000), { value: 0.2, raw_value: 200, cap: 1000, source: 'cee_hypothesis' }));
    const before = JSON.stringify(cell(p, 'full'));
    expect(await batch(p, [target('trial', 150, 1000)])).toMatchObject({ kind: 'committed' });
    expect(JSON.stringify(cell(p, 'full'))).toBe(before);
  });

  it.each([false, true])('reviewer baseline-less readback uses committed native points (compound %s), unrelated write is not a level change', async compound => {
    const p = product(withOther(graph(undefined, false)));
    const { store, proposal } = approved(p, compound);
    const caps = createAgentCapabilities(p.dispatch, store, undefined, 'full', undefined, {
      commitOptionLevels: async input => {
        const result = await commitOptionLevelsInProcess(input, 'sfr');
        expect(result.status).toBe('committed');
        const next = p.read();
        next.nodes.find(n => n.id === 'other')!.observed_state!.value = compound ? 0.6 : 0.7;
        // For compound, edit metadata outside its selected value to move hash.
        if (compound) next.nodes.find(n => n.id === 'other')!.observed_state!.confidence = 0.8;
        p.replace(next);
        return result;
      },
    });
    const result = await caps.authoriseChange(ctx, { proposal_id: proposal.proposal_id });
    expect(result, JSON.stringify(result)).toMatchObject({ ok: true, applied: true });
    expect(result).not.toHaveProperty('changed_since_by_another_writer');
    expect(cell(p, 'full')).toMatchObject({ value: 0.02, raw_value: 20, cap: 1000 });
    expect(cell(p, 'trial')).toMatchObject({ value: 0.15, raw_value: 150, cap: 1000 });
  });

  it('single-kind still reports a genuine other-writer native change', async () => {
    const p = product(withOther(graph(undefined, false)));
    const { store, proposal } = approved(p, false);
    const caps = createAgentCapabilities(p.dispatch, store, undefined, 'full', undefined, {
      commitOptionLevels: async input => {
        const result = await commitOptionLevelsInProcess(input, 'sfr');
        const next = p.read();
        Object.assign(next.nodes.find(n => n.id === 'full')!.interventions!.duration, { value: 0.025, raw_value: 25, cap: 1000 });
        p.replace(next);
        return result;
      },
    });
    const result = await caps.authoriseChange(ctx, { proposal_id: proposal.proposal_id });
    expect(result).toMatchObject({ applied: true, changed_since_by_another_writer: [{ option: 'Full', factor: 'Duration', saved: 20, now: 25 }] });
  });

  it('compound still rejects a genuine other-writer change to its selected level', async () => {
    const p = product(withOther(graph(undefined, false)));
    const { store, proposal } = approved(p, true);
    const caps = createAgentCapabilities(p.dispatch, store, undefined, 'full', undefined, {
      commitOptionLevels: async input => {
        const result = await commitOptionLevelsInProcess(input, 'sfr');
        const next = p.read();
        Object.assign(next.nodes.find(n => n.id === 'full')!.interventions!.duration, { value: 0.025, raw_value: 25, cap: 1000 });
        p.replace(next);
        return result;
      },
    });
    expect(await caps.authoriseChange(ctx, { proposal_id: proposal.proposal_id })).toMatchObject({ applied: false, refusal: 'not_verified' });
  });

  it.each([false, true])('confirmation and receipt name every re-encoded cell in exact bytes (compound %s)', async compound => {
    const p = product(withOther(withSibling()));
    const { store, proposal } = approved(p, compound, true);
    const caps = createAgentCapabilities(p.dispatch, store, undefined, 'full', undefined, {
      commitOptionLevels: async input => {
        const result = await commitOptionLevelsInProcess(input, 'sfr');
        return result.status === 'committed' ? { ...result, receipt: { version: 9, version_id: 'levels-version', mutation_id: 'levels-mutation', source_turn_id: input.turn_id } } : result;
      },
    });
    const result = await caps.authoriseChange(ctx, { proposal_id: proposal.proposal_id });
    const words = 'Kept "Full" on "Duration" at the same amount on the new range.';
    expect(result).toMatchObject({ applied: true, detail: words,
      reencoded_siblings: [{ option: 'Full', factor: 'Duration', quantity: 0.2, detail: words }],
      receipts: expect.arrayContaining([expect.objectContaining({ reencoded_siblings: [{ option_id: 'full', factor_id: 'duration', option: 'Full', factor: 'Duration', quantity: 0.2, detail: words }] })]),
    });
    expect(siblingReencodeDisclosure('Full', 'Duration')).toBe(words);
    expect(engine(p.read())).toBe(0.2);
  });

  it('durable confirmation and graph diff name each sibling using the same exact template', async () => {
    const initial = withSibling();
    initial.nodes.push({ id: 'extra', kind: 'option', label: 'Extra', interventions: { duration: { value: 0.4, source: 'cee_hypothesis' } } });
    const p = product(projectGraphForPersistence(initial) as ReturnType<typeof graph>);
    const before = p.read();
    const result = await batch(p, [target('trial', 150, 1000)]);
    expect(result).toMatchObject({ kind: 'committed' });
    if (result.kind !== 'committed') throw new Error('Expected committed');
    for (const label of ['Full', 'Extra']) {
      const words = siblingReencodeDisclosure(label, 'Duration');
      expect(result.response.assistant_text).toContain(words);
      expect(p.writes[0]!.assistantMessage).toContain(words);
      const diff = compareVersionRecords(version(before, 'before'), version(p.read(), 'after'));
      expect(diff.relation).toBe('different');
      if (diff.relation !== 'different') throw new Error('Expected diff');
      expect(Object.values(diff.categories).flat().some(item => item.summary === words && item.why_it_matters === words)).toBe(true);
    }
  });

  it.each([false, true])('authoriser carries the named refusal and fixed sentence, writes nothing (compound %s)', async compound => {
    const p = product(withOther(withSibling(graph(), { raw_value: 0.2, source: 'cee_hypothesis' })));
    const { store, proposal } = approved(p, compound, true);
    const before = p.read();
    const caps = createAgentCapabilities(p.dispatch, store, undefined, 'full', undefined, { commitOptionLevels: input => commitOptionLevelsInProcess(input, 'sfr') });
    const result = await caps.authoriseChange(ctx, { proposal_id: proposal.proposal_id });
    expect(result).toMatchObject({ applied: false, mutated: false, refusal: 'sibling_level_unresolvable',
      detail: 'Nothing was saved. Olumi couldn\'t read another option\'s level for this factor, so it didn\'t add a range that could change it.' });
    expect(result.detail).toBe(SIBLING_LEVEL_UNRESOLVABLE_SENTENCE);
    expect(p.writes).toHaveLength(0);
    expect(p.registers).toHaveLength(0);
    expect(p.read()).toStrictEqual(before);
  });

  it('legacy carriers preserve the same resolver quantity and remain within the plan', () => {
    const before = { nodes: [ { id: 'duration', kind: 'factor', label: 'Duration' },
      { id: 'full', kind: 'option', label: 'Full', data: { interventions: { duration: { value: 0.2, source: 'cee_hypothesis' } } },
        'data/interventions/duration': { value: 0.2, source: 'cee_hypothesis' } },
    ], options: [{ id: 'extra', label: 'Extra', interventions: { duration: 0.4 } }] };
    const after = structuredClone(before);
    Object.assign(after.nodes[0]!, { scale_frame: 1000 });
    const result = preserveSiblingQuantities(before, after, []);
    expect(result.kind).toBe('preserved');
    if (result.kind !== 'preserved') throw new Error('Expected preserved');
    expect(result.reencoded.map(c => c.option)).toEqual(['Full', 'Extra']);
    expect((result.graph.nodes[1]!.data!.interventions.duration)).toMatchObject({ value: 0.0002, raw_value: 0.2, cap: 1000, source: 'cee_hypothesis' });
    expect(result.graph.options[0]!.interventions.duration).toEqual({ value: 0.0004, raw_value: 0.4, cap: 1000 });
    expect(before.nodes[1]!.data!.interventions.duration).toEqual({ value: 0.2, source: 'cee_hypothesis' });
  });
});
