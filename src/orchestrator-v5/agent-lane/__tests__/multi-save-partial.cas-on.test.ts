import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { __setUseAppendV6ForTest } from '../../append-v6-flag.js';
import { createMockSessionStore } from '../../../../tests/utils/mock-session-store.js';
import { executeOptionInterventionBatch } from '../../system-events/option-intervention-edit.js';
import { GraphStaleWriteError } from '../../session/store.js';
import { REVISION_CONFLICT_MESSAGE } from '../../graph-revision-conflict.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { createProposal, ProposalStore, type ProposalOperation } from '../proposal.js';
import { narrateWriteOutcome, PARTIAL_WRITE_MESSAGES } from '../write-outcome.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { buildD1Fixture } from '../../tools/handlers/d1-shared/__tests__/fixtures.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';

const WORDS = {
  "range_saved_levels_unconfirmed": {
    "text": "The range was saved, but Olumi could not confirm whether the option levels were saved. Check the saved model before trying to set the option levels again.",
    "sha256": "9c6ce557c328c66eff70dcb3cfc189a6fa6b7a5f88ec40b771237f6ce9c9514f"
  },
  "values_saved_remaining_values_unconfirmed": {
    "text": "The earlier values were saved, but Olumi could not confirm whether the remaining values were saved. Check the saved model before trying to set the remaining values again.",
    "sha256": "804d7c140b46993845943c29c91a4f2181dae8380db7c4078d56e1960edc731d"
  },
  "values_saved_range_unconfirmed": {
    "text": "The values were saved, but Olumi could not confirm whether their range was saved. Check the saved model before trying to set their range again.",
    "sha256": "74a5d9309ac83fe36aa3e7f9c0b8ae36348c8c6f2b235808a26d29c40cf3e33a"
  },
  "target_saved_level_unconfirmed": {
    "text": "The target was saved, but Olumi could not confirm whether today's level was saved. Check the saved model before trying to set today's level again.",
    "sha256": "44d44c0b6d178e8e062ee402a01cf71cd78a641b00517196fcb78a355f24ea4a"
  },
  "values_saved_read_unconfirmed": {
    "text": "The values were saved, but Olumi could not read the model afterwards. Check the saved model before making another change.",
    "sha256": "4a1d8b3c8ef2c5e7515dbf8ecb49adea46df870a2196b45558305717006d1f6e"
  },
  "range_saved_levels_not_saved": {
    "text": "The range was saved, but the scenario changed before the option levels could be saved. Check the saved range and try setting the option levels again.",
    "sha256": "db2f25296cdc60628b873b78a63fd2b832243c491e2523dce093b88727c98309"
  },
  "values_saved_remaining_values_not_saved": {
    "text": "The earlier values were saved, but the scenario changed before the remaining values could be saved. Check the saved values and try setting the remaining values again.",
    "sha256": "61675f3f4bf9d333c77ce999b9ce39435459d2244d56b3caee2617704b523192"
  },
  "values_saved_remaining_values_refused": {
    "text": "The earlier values were saved, but the remaining values could not be saved. Check the saved values and try setting the remaining values again.",
    "sha256": "d0911f103848b37c0eb1fced95d3fe3d5d6d9069540ffcc01d524e8e2793affe"
  },
  "values_saved_range_not_saved": {
    "text": "The values were saved, but the scenario changed before their range could be saved. Check the saved values and try setting their range again.",
    "sha256": "276849a5d5e9c2eb0d623a01c7a8ef9a49507131955283b616d5a63026a289cf"
  },
  "values_saved_range_refused": {
    "text": "The values were saved, but their range could not be saved. Check the saved values and try setting their range again.",
    "sha256": "77da836e393592526ba975ad7ccead935044812d13224255a7f10c1dcdc23672"
  },
  "target_saved_level_not_saved": {
    "text": "The target was saved, but the scenario changed before today's level could be saved. Check the saved target and try setting today's level again.",
    "sha256": "8baed842111862bb30f63790a88d4d5567bfced46755a432e7fd2756783fc744"
  },
  "link_saved_estimate_refused": {
    "text": "The link was saved, but its accepted estimate detail could not be saved. Check the saved link and try accepting its estimate again.",
    "sha256": "d9824f74f9c334ae7e09a2527ea9e6a2d8909db82024616acd7010583c08e916"
  }
} as const;

const SID = '22222222-2222-4222-8222-222222222222';
const ctx = { scenario_id: SID, authenticated_user_id: null, request_id: 'multi-save' };
type Site = 'range_levels' | 'values_loop' | 'values_range' | 'target_level';
type Refusal = 'race' | 'returned' | 'other_throw';
const codes: Record<Site, readonly [string, string]> = {
  range_levels: ['range_saved_levels_not_saved', 'range_saved_levels_refused'],
  values_loop: ['values_saved_remaining_values_not_saved', 'values_saved_remaining_values_refused'],
  values_range: ['values_saved_range_not_saved', 'values_saved_range_refused'],
  target_level: ['target_saved_level_not_saved', 'target_saved_level_refused'],
};

function world(site: Site, refusal: Refusal, options: {
  readAfterValues?: '503' | 'throw';
  firstValueRefused?: boolean;
  noReceipt?: boolean;
  repeatedTarget?: boolean;
  rangeAfterFailedValue?: boolean;
} = {}) {
  let graph = buildD1Fixture();
  const factor = graph.nodes.find(n => n.id === 'f-budget')!;
  factor.observed_state = site === 'values_loop' && !options.rangeAfterFailedValue
    ? { value: 0.4, raw_value: 40, cap: 100, unit: '£', source: 'explicit' }
    : { value: 40, unit: '£', source: 'explicit' };
  const goal = graph.nodes.find(n => n.kind === 'goal')!;
  goal.observed_state = { value: 0.1, raw_value: 10, cap: 100, unit: '£', source: 'explicit' };
  goal.goal_threshold_raw = 80;
  goal.goal_threshold_cap = 100;
  goal.goal_threshold_unit = '£';
  goal.goal_threshold_frame = 'level';
  graph.goal_constraints = [];
  let revision = 7;
  let attempts = 0;
  const saved: typeof graph[] = [];
  const receipt = { version: 1, version_id: SID, mutation_id: SID, source_turn_id: '' };
  const mv = { version_number: 1, version_id: SID, mutation_id: SID };
  const fail = () => {
    // Capture the writer's base, then race a revision-only change before its append.
    const expected = revision;
    if (refusal === 'race') {
      revision += 1;
      if (expected !== revision) throw new GraphStaleWriteError('atomic revision refusal', {
        conflict_category: 'revision_conflict', cause: { code: 'OLRV1', details: JSON.stringify({ expected, current: revision }) },
      });
    }
    if (refusal === 'other_throw') throw new Error('writer refused before append');
    return { status: 422, json: { code: 'refused_no_write' } };
  };
  const persist = () => { revision += 1; saved.push(structuredClone(graph)); };
  const dispatch: InternalDispatch = async (path, rawBody) => {
    const body = rawBody as Record<string, unknown>;
    if (path.endsWith('/graph')) {
      if (attempts >= 2 && options.readAfterValues === '503') return { status: 503, json: {} };
      if (attempts >= 2 && options.readAfterValues === 'throw') throw new Error('final model read unavailable');
      return { status: 200, json: { graph: structuredClone(graph), graph_hash: computeAnalysisAffectingGraphHash(graph) } };
    }
    attempts += 1;
    if (attempts > 1 && !(options.rangeAfterFailedValue && path.endsWith('/graph/register'))) return fail();
    if (path.endsWith('/graph/register')) {
      graph = structuredClone(body.graph) as typeof graph;
      persist();
      return { status: 200, json: { model_version: mv } };
    }
    const event = body.event as { kind: string; target_id?: string; value?: number; raw_value?: number };
    if (event.kind === 'factor_value_edit') {
      if (options.firstValueRefused) return fail();
      const node = graph.nodes.find(n => n.id === event.target_id)!;
      node.observed_state = { ...node.observed_state, value: event.value!,
        ...(event.raw_value !== undefined ? { raw_value: event.raw_value } : {}), unit: '£', source: 'explicit' };
      persist();
      return { status: 200, json: { graph_hash: computeAnalysisAffectingGraphHash(graph),
        blocks: [{ type: 'graph_patch', operation: 'set_factor_value', target_id: event.target_id, status: 'applied', after: { value: event.value } }],
        ...(!options.noReceipt ? { model_version_receipt: { schema: 'model_version_mutation_receipt.v1', scenario_id: SID, mutation_id: SID,
          version_id: SID, sequence: 1, graph, full_hash: 'a'.repeat(64), hash_algorithm: 'sha256',
          identity_projection_version: 'identity.v1', identity_normaliser_version: '1', graph_schema_version: 'graph_v3',
          analysis_affecting_hash: 'b'.repeat(64), actor: { kind: 'unknown' }, creation: { kind: 'committed_mutation' },
          source_turn_id: String(body.turn_id), lineage: { kind: 'unknown' }, undo_version_id: null, event_id: 'value-first' } } : {}) } };
    }
    if (event.kind === 'goal_target_edit') {
      goal.goal_threshold_raw = 90;
      graph.goal_constraints = [{ constraint_id: 'target-row', node_id: goal.id, operator: '>=', value: 90, unit: '£', value_frame: 'level', provenance: 'explicit' }];
      persist();
      return { status: 200, json: { model_version: mv, model_version_receipt: { schema: 'model_version_mutation_receipt.v1', scenario_id: SID,
        mutation_id: SID, version_id: SID, sequence: 1, graph, full_hash: 'a'.repeat(64), hash_algorithm: 'sha256',
        identity_projection_version: 'identity.v1', identity_normaliser_version: '1', graph_schema_version: 'graph_v3', analysis_affecting_hash: 'b'.repeat(64),
        actor: { kind: 'unknown' }, creation: { kind: 'committed_mutation' }, source_turn_id: String(body.turn_id), lineage: { kind: 'unknown' }, undo_version_id: null, event_id: 'target-first' } } };
    }
    throw new Error(`Unexpected ${event.kind}`);
  };
  const proposals = new ProposalStore();
  const option = graph.nodes.find(n => n.kind === 'option')!;
  const ops: Record<Site, ProposalOperation[]> = {
    range_levels: [{ op: 'set_option_intervention', path: `${option.id}::${factor.id}`, value: { raw: 360, normalised: 0.72, derived_frame: 500 } }],
    values_loop: [{ op: 'set_factor_value', path: factor.id, value: { value: 40, unit: '£' } },
      { op: 'set_factor_value', path: options.repeatedTarget ? factor.id : 'f-quality', value: { value: 50, unit: '£' } }],
    values_range: [{ op: 'set_factor_value', path: factor.id, value: { value: 40, unit: '£' } }],
    target_level: [{ op: 'set_goal_target', path: goal.id, value: { constraint_type: 'at_least', raw_value: 90, unit: '£',
      current_level: { value: 20, unit: '£', quote: `Our ${goal.label} today is £20.` } } }],
  };
  const initialHash = computeAnalysisAffectingGraphHash(graph);
  if (initialHash === null) throw new Error('Fixture hash unavailable');
  const proposal = createProposal({ scenario_id: SID, user_id: null, base_graph_identity_hash: initialHash,
    operations: ops[site], provenance: { authored_by: 'user_stated' }, validation: { admitted: true, loss_count: 0, refusals: [] }, public_label: 'Exact approved change' });
  proposals.put(proposal);
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    attempts += 1;
    if (refusal !== 'race') { fail(); return { status: 'refused', reason: 'unavailable' }; }
    const store = createMockSessionStore({
      loadGraphAndBriefText: async () => {
        const snapshot = { graph: structuredClone(graph), revision, briefText: null };
        revision += 1; // race after snapshot, before actual batch commit
        return snapshot;
      },
      loadGraph: async () => structuredClone(graph),
      readExistingScenario: async () => ({ userId: null, graph, briefText: null, analysisInvalidatedAt: null }),
      readAnalysisInvalidatedAt: async () => null,
      append: async write => {
        expect(write.expectedRevision).toBe(8);
        if (write.expectedRevision !== revision) throw new GraphStaleWriteError('OLRV1', { conflict_category: 'revision_conflict' });
        throw new Error('The race did not refuse the second save');
      },
    });
    if (typeof input.base_graph_hash !== 'string') throw new Error('Missing approved base hash');
    const result = await executeOptionInterventionBatch({ scenarioId: SID, turnId: input.turn_id, requestId: 'levels-race',
      requestHash: input.turn_id, stage: 'frame', freshness: 'fresh', hasExistingAnalysis: false, expectedGraphHash: input.base_graph_hash,
      targets: input.levels.map(l => ({ optionId: l.option_id, factorId: l.factor_id, modelValue: l.value })),
    }, store);
    throw new Error(`Expected revision refusal, got ${result.kind}`);
  };
  const caps = createAgentCapabilities(dispatch, proposals, undefined, 'full', undefined,
    site === 'range_levels' ? { commitOptionLevels } : {});
  return { caps, proposal, proposals, saved, graph: () => graph, revision: () => revision, attempts: () => attempts, receipt };
}

beforeEach(() => __setUseAppendV6ForTest(true));
afterEach(() => __setUseAppendV6ForTest(true));

describe('every multi-save capability keeps save 1 after save 2 is refused', () => {
  it.each([
    { proof: 'receipt and own write', readAfterValues: '503', noReceipt: false, repeatedTarget: false },
    { proof: 'guest own write without a receipt', readAfterValues: '503', noReceipt: true, repeatedTarget: false },
    { proof: 'guest own write after a later refusal for the same target', readAfterValues: '503', noReceipt: true, repeatedTarget: true },
    { proof: 'receipt after a later refusal overwrites the same target own-write flag', readAfterValues: '503', noReceipt: false, repeatedTarget: true },
    { proof: 'receipt after a later refusal and a thrown read', readAfterValues: 'throw', noReceipt: false, repeatedTarget: true },
  ] as const)('BFIX6 P1: $proof survives a $readAfterValues final read', async options => {
    const w = world('values_loop', 'returned', options);
    const result = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    expect(w.saved).toHaveLength(1);
    expect(w.attempts()).toBe(2);
    expect(result).toMatchObject({ ok: false, mutated: true, applied: false, outcome: 'values_saved_read_unconfirmed' });
    expect(result.receipts).toEqual(options.noReceipt ? [] : [expect.objectContaining({ version: 1, version_id: SID })]);
    const words = WORDS.values_saved_read_unconfirmed;
    expect(result.detail).toBe(words.text);
    const narrated = narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]);
    expect(narrated.status).toBe(words.text);
    expect(createHash('sha256').update(String(result.detail)).digest('hex')).toBe(words.sha256);
    expect(createHash('sha256').update(narrated.status!).digest('hex')).toBe(words.sha256);
    expect(`${result.detail} ${narrated.status} ${narrated.text}`).not.toMatch(/unchanged|None of the values/);
    expect(w.proposals.outstanding(SID, null).map(p => p.proposal_id)).toContain(w.proposal.proposal_id);
  });

  it('BFIX6 P1 contrast: no value committed and a 503 final read keeps the existing no-write words', async () => {
    const w = world('values_loop', 'returned', { readAfterValues: '503', firstValueRefused: true });
    const result = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    expect(w.saved).toHaveLength(0);
    expect(w.attempts()).toBe(2);
    expect(result).toMatchObject({ ok: false, mutated: false, applied: false, refusal: 'not_applied' });
    expect(result.receipts).toBeUndefined();
    expect(result.detail).toBe('None of the values were recorded, so this approval left the model unchanged. Read the model again before describing it: someone else may have changed it meanwhile.');
    expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]).status).toBe('Not saved: none of it was applied.');
  });

  it('BFIX6 P2: a saved value and its saved range never narrate a values approval as levels', async () => {
    const w = world('values_loop', 'returned', { rangeAfterFailedValue: true });
    const result = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    expect(w.saved).toHaveLength(2);
    expect(w.attempts()).toBe(3);
    expect(result).toMatchObject({ mutated: true, applied: false, refusal: 'partially_applied',
      outcome: 'values_saved_remaining_values_refused', adopted_count: 1, requested_count: 2,
      ranges_added_for_analysis: [{ factor: 'Marketing budget', value: 40, range: 100 }],
      receipts: [expect.objectContaining({ version_id: SID }), expect.objectContaining({ version_id: SID })] });
    const narrated = narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]);
    expect(result.detail).toBe(WORDS.values_saved_remaining_values_refused.text);
    expect(narrated.status).toBe(WORDS.values_saved_remaining_values_refused.text);
    expect(`${result.detail} ${narrated.status} ${narrated.text}`).not.toMatch(/levels/i);
  });

  it.each(['range_levels', 'values_loop', 'values_range', 'target_level'] as const)('%s: real revision change between saves', async site => {
    const w = world(site, 'race');
    const result = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    const outcome = codes[site][0];
    expect(w.saved).toHaveLength(1);
    expect(w.attempts()).toBe(2);
    expect(w.revision()).toBe(9);
    expect(w.graph()).toEqual(w.saved[0]);
    expect(result).toMatchObject({ ok: false, mutated: true, applied: false, outcome,
      receipts: [expect.objectContaining({ version: 1, version_id: SID })] });
    expect(result.detail).toBe(WORDS[outcome as keyof typeof WORDS].text);
    const narrated = narrateWriteOutcome(`${REVISION_CONFLICT_MESSAGE} Useful reasoning remains.`, [{ name: 'authorise_change' }], [result]);
    expect(narrated.status).toBe(WORDS[outcome as keyof typeof WORDS].text);
    expect(narrated.text).toBe('Useful reasoning remains.');
    expect(`${result.detail} ${narrated.text} ${narrated.status}`).not.toContain(REVISION_CONFLICT_MESSAGE);
    expect(createHash('sha256').update(String(result.detail)).digest('hex')).toBe(WORDS[outcome as keyof typeof WORDS].sha256);
    expect(createHash('sha256').update(narrated.status!).digest('hex')).toBe(WORDS[outcome as keyof typeof WORDS].sha256);
    expect(w.proposals.outstanding(SID, null).map(p => p.proposal_id)).toContain(w.proposal.proposal_id);
  });

  it.each(['range_levels', 'values_loop', 'values_range', 'target_level'] as const)('%s: returned non-revision refusal keeps receipts and honest copy', async site => {
    const w = world(site, 'returned');
    const result = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    expect(w.saved).toHaveLength(1);
    expect(w.attempts()).toBe(2);
    expect(result).toMatchObject({ mutated: true, applied: false, outcome: codes[site][1], receipts: [expect.objectContaining({ version_id: SID })] });
    if (site === 'range_levels') {
      expect(result).toMatchObject({ refusal: 'partially_applied', ranges_added_for_analysis: [{ factor: 'Marketing budget', range: 500 }] });
      expect(result.detail).toBe('This approval attached a range where the analysis needed one, so the model did change: Marketing budget 0 to 500 (taken from the figure itself, a unit of measurement, not a forecast). But none of the levels were recorded. Read the model again before describing it: someone else may have changed it meanwhile.');
      expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]).status).toBe('Partly saved: this approval attached a range (Marketing budget 0 to 500), but none of the levels were recorded. Read the model again before describing it.');
    } else if (site === 'target_level') {
      expect(result.detail).toBe('The goal "Revenue" now has the target at least £90, as you stated it. Its level today (£20) was not recorded. What is its level today?');
      expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]).status).toBe(result.detail);
    } else {
      expect(result.detail).toBe(WORDS[codes[site][1] as keyof typeof WORDS].text);
      expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]).status).toBe(result.detail);
    }
    expect(String(result.detail)).not.toMatch(/scenario changed|nothing was saved/);
    const narrated = narrateWriteOutcome(`Nothing was saved. ${REVISION_CONFLICT_MESSAGE} Useful reasoning remains.`, [{ name: 'authorise_change' }], [result]);
    expect(narrated.text).toBe('Useful reasoning remains.');
    expect(narrated.status).toBe(narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]).status);

  });
  it.each(['range_levels', 'values_loop', 'values_range', 'target_level'] as const)('%s: an unknown second-write transport outcome keeps save 1 without claiming save 2 failed', async site => {
    const w = world(site, 'other_throw');
    const result = await w.caps.authoriseChange(ctx, { proposal_id: w.proposal.proposal_id });
    const outcome = { range_levels: 'range_saved_levels_unconfirmed', values_loop: 'values_saved_remaining_values_unconfirmed',
      values_range: 'values_saved_range_unconfirmed', target_level: 'target_saved_level_unconfirmed' }[site];
    expect(w.saved).toHaveLength(1);
    expect(w.attempts()).toBe(2);
    expect(result).toMatchObject({ mutated: true, applied: false, outcome, receipts: [expect.objectContaining({ version_id: SID })] });
    expect(result.detail).toBe(WORDS[outcome as keyof typeof WORDS].text);
    expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [result]).status).toBe(result.detail);
    expect(String(result.detail)).not.toMatch(/scenario changed|nothing was saved|could not be saved/);
  });

});

it('all ACKed sentences retain their independent literal words and hashes', () => {
  for (const [code, words] of Object.entries(WORDS)) {
    expect(PARTIAL_WRITE_MESSAGES[code]).toBe(words.text);
    expect(createHash('sha256').update(PARTIAL_WRITE_MESSAGES[code]).digest('hex')).toBe(words.sha256);
  }
});
