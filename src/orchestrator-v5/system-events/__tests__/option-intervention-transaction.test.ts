import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetConfigCache } from '../../../config/index.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { computeGraphIdentityHash, computeVersionAnalysisAffectingHashRecord } from '../../context/graph-identity.js';
import { GM_HELD_HANDLER_ID } from '../../handlers/edit-graph-referee-gate.js';
import { toModelVersionMutationReceiptV1 } from '../../model-management/mutation-receipt.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { parsePendingAction, type PendingAction } from '../../session/pending-action.js';
import type { AtomicCommittedModelVersionReceipt, SessionStore, SessionTurnWrite } from '../../session/store.js';
import { applyOptionInterventionEdit, executeOptionInterventionEdit } from '../option-intervention-edit.js';

const SCENARIO_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function intervention(factorId: string, value: number) {
  return {
    value,
    source: 'cee_hypothesis',
    target_match: { node_id: factorId, match_type: 'exact_id', confidence: 'high' },
  };
}

/** The pre-state is already a real persistence fixed point, not a raw draft. */
function canonicalGraph() {
  return projectGraphForPersistence({
    ...GraphV3.parse({
      nodes: [
        { id: 'goal', kind: 'goal', label: 'Service quality', goal_threshold: 0.1 },
        { id: 'option', kind: 'option', label: 'Pilot', provenance: 'ai_inferred',
          interventions: { factor: intervention('factor', 0.2),
            other_factor: intervention('other_factor', 0.55) } },
        { id: 'other_option', kind: 'option', label: 'Pilot', is_baseline: true,
          interventions: { factor: intervention('factor', 0.7),
            other_factor: intervention('other_factor', 0.65) } },
        { id: 'factor', kind: 'factor', label: 'Coverage',
          observed_state: { value: 0.5, baseline: 0.4, unit: '%', raw_value: 50,
            cap: 100, source: 'user_override' } },
        { id: 'other_factor', kind: 'factor', label: 'Coverage',
          observed_state: { value: 0.6, source: 'brief_extraction' } },
      ],
      edges: [
        ['option', 'factor'], ['option', 'other_factor'],
        ['other_option', 'factor'], ['other_option', 'other_factor'],
        ['factor', 'goal'], ['other_factor', 'goal'],
      ].map(([from, to]) => ({ from, to, strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1, effect_direction: 'positive' })),
      goal_constraints: [{ constraint_id: 'limit', node_id: 'factor', operator: '<=',
        value: 10, unit: '%', value_frame: 'level', provenance: 'explicit',
        label: 'Maximum permitted coverage change' }],
    }),
    options: [] as Array<Record<string, unknown>>,
    retained_context: { statement: 'The user has not changed the success limit.' },
  });
}

type ExecuteInput = Parameters<typeof executeOptionInterventionEdit>[0];

function inputFor(graph: ReturnType<typeof canonicalGraph>, overrides: Partial<ExecuteInput> = {}): ExecuteInput {
  const expectedGraphHash = computeAnalysisAffectingGraphHash(graph);
  if (expectedGraphHash === null) throw new Error('Canonical fixture must have an analysis hash');
  return {
    optionId: 'option', factorId: 'factor', modelValue: 0.3, expectedGraphHash,
    scenarioId: SCENARIO_ID, turnId: TURN_ID, requestId: 'req-intervention-transaction',
    stage: 'analyse', requestHash: 'sha256:option-factor-03',
    freshness: 'fresh', hasExistingAnalysis: true,
    ...overrides,
  };
}

function pendingHold(graph: ReturnType<typeof canonicalGraph>, turns = 4): PendingAction {
  const now = Date.now();
  const pending = parsePendingAction({
    id: 'pending-unrelated-change', scenario_id: SCENARIO_ID, chip_id: 'gmh_abcdef123456',
    preconditions: { graph_hash: inputFor(graph).expectedGraphHash },
    expires_at_turn_count: turns,
    expires_at_iso: new Date(now + 600_000).toISOString(),
    emitted_at_iso: new Date(now).toISOString(),
    action: {
      kind: 'apply_proposed_change', proposal_ref: 'gmh_abcdef123456',
      inline_patch: {
        handler_id: GM_HELD_HANDLER_ID, apply_wiring: 'held_execute_v1',
        operations: [{ op: 'update_node', path: 'other_factor', value: { observed_state: { value: 0.7 } } }],
        operations_count: 1, candidate_id: 'candidate-unrelated-change',
        candidate_kind: 'update_node_field', mutation_class: 'tune', blocker_code: null,
        base_hash_match: true, params: {}, target_entity_ids: [],
      },
      public_label: 'Continue with this change', public_message: 'Yes',
    },
  });
  if (pending === null) throw new Error('Pending fixture must pass the existing persisted parser');
  return pending;
}

/** Reuse the canonical commit's metadata; this fixture does not author hashes or actor identity. */
function receiptFor(write: SessionTurnWrite): AtomicCommittedModelVersionReceipt {
  if (write.modelVersion === undefined) throw new Error('Real commit must produce version metadata');
  return {
    ...write.modelVersion,
    version_id: '11111111-1111-4111-8111-111111111111', version_number: 1,
    creation_kind: 'initial', source_version_id: null, parent_version_id: null,
    root_version_id: '22222222-2222-4222-8222-222222222222', undo_version_id: null,
    graph: clone(write.graph), event_id: `model_version_created_mutation_${write.modelVersion.mutation_id}`,
  };
}

/**
 * Only serialized bytes survive between facades. This exercises the real
 * commitDirectAnswer call, not PostgreSQL, auth, an RPC or public egress.
 * The replay rule mirrors the existing store key (scenario_id, turn_id);
 * request_hash is recorded data and deliberately NOT a new idempotency key.
 */
function jsonStore(initial: ReturnType<typeof canonicalGraph>, options: {
  rejectAppend?: boolean;
  failLoadAt?: number;
  failPendingRead?: boolean;
  omitParentRead?: boolean;
  omitFactRead?: boolean;
  pendingActions?: readonly PendingAction[];
  versionReceipt?: (write: SessionTurnWrite) => AtomicCommittedModelVersionReceipt;
} = {}) {
  let graphJson = JSON.stringify(initial);
  let concurrentGraphJson: string | undefined;
  let loads = 0;
  const attempts: SessionTurnWrite[] = [];
  const rows = new Map<string, { id: string; json: string; receiptJson?: string }>();
  const fresh = (): SessionStore => createMockSessionStore({
    loadGraph: async scenarioId => {
      expect(scenarioId).toBe(SCENARIO_ID);
      loads += 1;
      if (loads === options.failLoadAt) throw new Error('canonical read unavailable');
      return JSON.parse(graphJson);
    },
    readMostRecentPendingActions: async (scenarioId, readOptions) => {
      expect(scenarioId).toBe(SCENARIO_ID);
      expect(readOptions).toEqual({ validation: 'strict' });
      if (options.failPendingRead) throw new Error('pending authority unavailable');
      const latest = [...rows.values()].at(-1);
      // A fresh facade reads the serialized post-commit pending list, not the seed.
      return latest === undefined ? clone(options.pendingActions ?? [])
        : (JSON.parse(latest.json) as SessionTurnWrite).pending_actions ?? [];
    },
    append: async write => {
      attempts.push(clone(write));
      if (options.rejectAppend) throw new Error('atomic write rejected before commit');
      const key = `${write.scenario_id}/${write.turn_id}`;
      const previous = rows.get(key);
      if (previous !== undefined) {
        // A separately staged concurrent postimage may match the new attempt.
        // The duplicate turn still returns ONLY its original durable row/fact.
        if (concurrentGraphJson !== undefined) {
          graphJson = concurrentGraphJson;
          concurrentGraphJson = undefined;
        }
        return { id: previous.id, ...(previous.receiptJson === undefined ? {}
          : { modelVersionReceipt: JSON.parse(previous.receiptJson) as AtomicCommittedModelVersionReceipt }) };
      }
      const stored = clone(write);
      const id = `persisted-row-${rows.size + 1}`;
      const receipt = options.versionReceipt?.(stored);
      // Negative receipts must be structurally valid and reach the transaction's
      // post-commit identity check rather than fail at receipt construction.
      if (receipt !== undefined) toModelVersionMutationReceiptV1(SCENARIO_ID, receipt);
      rows.set(key, { id, json: JSON.stringify(stored),
        ...(receipt === undefined ? {} : { receiptJson: JSON.stringify(receipt) }) });
      if (stored.graph !== undefined) graphJson = JSON.stringify(stored.graph);
      // No fixture receipt means the existing guest/no-version success path.
      return { id, ...(receipt === undefined ? {} : { modelVersionReceipt: clone(receipt) }) };
    },
    readRecent: async (scenarioId, limit = 20) => {
      if (options.omitParentRead) return [];
      return [...rows.values()].reverse().flatMap(row => {
        const write = JSON.parse(row.json) as SessionTurnWrite;
        if (write.scenario_id !== scenarioId) return [];
        return [makeSessionTurnRow({
          id: row.id, scenario_id: write.scenario_id, turn_id: write.turn_id,
          turn_class: write.turn_class, handler_id: write.handler_id,
          request_hash: write.request_hash, response_emitted: write.response_emitted,
          llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms,
          assistant_message: write.assistantMessage ?? null,
        })];
      }).slice(0, limit);
    },
    readFactsWithTurnFor: async parentRowIds => {
      if (options.omitFactRead) return [];
      return [...rows.values()].flatMap(row => {
        if (!parentRowIds.includes(row.id)) return [];
        const write = JSON.parse(row.json) as SessionTurnWrite;
        return write.handler_facts.map(fact => ({
          turn_id: row.id, fact_created_at: '2026-08-31T00:00:00.000Z', fact,
        }));
      });
    },
    getScenarioOwner: async () => null,
  });
  return {
    fresh,
    attempts,
    durableRows: () => [...rows.values()].map(row => JSON.parse(row.json) as SessionTurnWrite),
    durableGraph: () => JSON.parse(graphJson) as ReturnType<typeof canonicalGraph>,
    durableReceipts: () => [...rows.values()].flatMap(row => row.receiptJson === undefined ? []
      : [JSON.parse(row.receiptJson) as AtomicCommittedModelVersionReceipt]),
    loadCount: () => loads,
    stageConcurrentGraphOnDuplicate: (graph: unknown) => { concurrentGraphJson = JSON.stringify(graph); },
  };
}

beforeEach(() => {
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'true');
  _resetConfigCache();
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('option-intervention transaction — real commit, serialized store boundary', () => {
  it('commits the exact target, canonical options mirror and edit fact; cold reload retains every unrelated field', async () => {
    const before = canonicalGraph();
    const pristine = clone(before);
    expect(projectGraphForPersistence(clone(before))).toEqual(before);
    expect(before.options).toHaveLength(2);
    const persistence = jsonStore(before);
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') throw new Error(`Expected commit, got ${result.kind}`);

    expect(persistence.attempts).toHaveLength(1);
    expect(persistence.durableRows()).toHaveLength(1);
    const stored = persistence.durableRows()[0]!;
    expect(stored.request_hash).toBe('sha256:option-factor-03');
    expect(stored.handler_id).toBeNull();
    expect(stored.handler_facts).toHaveLength(1);
    expect(stored.handler_facts[0]).toMatchObject({
      fact_type: 'edit_graph', fact_version: 1, noop: false,
      result: { edit_kind: 'option_configuration', status: 'applied', operations_count: 1 },
    });

    const cold = GraphStateIngressSchema.parse(await persistence.fresh().loadGraph(SCENARIO_ID));
    expect(cold).toEqual(stored.graph);
    expect(result.graph).toEqual(cold);
    expect(result.persistedRowId).toBe('persisted-row-1');
    expect(result.analysisGraphHash).toBe(computeAnalysisAffectingGraphHash(cold));
    expect(result.analysisGraphHash).not.toBe(computeAnalysisAffectingGraphHash(pristine));
    const target = cold.nodes.find(node => node.id === 'option')!;
    expect(target.interventions).toMatchObject({
      factor: { value: 0.3, source: 'user_specified', target_match: { node_id: 'factor' } },
      other_factor: intervention('other_factor', 0.55),
    });
    expect(target.provenance).toBe('ai_inferred');
    expect(cold.options).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'option', interventions: target.interventions }),
    ]));
    expect(cold.nodes.filter(node => node.id !== 'option')).toEqual(
      pristine.nodes.filter(node => node.id !== 'option'),
    );
    expect(cold.options?.filter(option => (option as { id: string }).id !== 'option')).toEqual(
      pristine.options.filter(option => option.id !== 'option'),
    );
    expect(cold.edges).toEqual(pristine.edges);
    expect(cold.goal_constraints).toEqual(pristine.goal_constraints);
    expect(cold.retained_context).toEqual(pristine.retained_context);
    expect(before).toEqual(pristine);
  });

  it('does not turn an append rejection into a stored graph, fact or applied outcome', async () => {
    const before = canonicalGraph();
    const persistence = jsonStore(before, { rejectAppend: true });
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result).toMatchObject({ kind: 'unverified', commitAttempted: true });
    expect(result).not.toHaveProperty('response');
    expect(persistence.attempts).toHaveLength(1);
    expect(persistence.durableRows()).toEqual([]);
    expect(persistence.durableGraph()).toEqual(before);
  });

  it('does not append after the initial canonical read fails', async () => {
    const before = canonicalGraph();
    const persistence = jsonStore(before, { failLoadAt: 1 });
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result).toMatchObject({ kind: 'unverified', commitAttempted: false });
    expect(persistence.attempts).toEqual([]);
    expect(persistence.durableRows()).toEqual([]);
    expect(persistence.durableGraph()).toEqual(before);
  });

  it('does not lose unresolved pending authority when its read fails after graph loading', async () => {
    const before = canonicalGraph();
    const persistence = jsonStore(before, { failPendingRead: true });
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result).toMatchObject({ kind: 'unverified', commitAttempted: false });
    expect(result).not.toHaveProperty('response');
    expect(persistence.loadCount()).toBe(1);
    expect(persistence.attempts).toEqual([]);
    expect(persistence.durableRows()).toEqual([]);
    expect(persistence.durableGraph()).toEqual(before);
  });

  it('reports unverified after a post-commit read fails without claiming that the durable write did not occur', async () => {
    const before = canonicalGraph();
    const persistence = jsonStore(before, { failLoadAt: 2 });
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result).toMatchObject({ kind: 'unverified', commitAttempted: true });
    expect(result).not.toHaveProperty('response');
    expect(persistence.loadCount()).toBe(2);
    expect(persistence.attempts).toHaveLength(1);
    expect(persistence.durableRows()).toHaveLength(1);
    expect(persistence.durableGraph().nodes.find(node => node.id === 'option')?.interventions?.factor)
      .toMatchObject({ value: 0.3, source: 'user_specified' });
  });

  it('does not report a changed retry candidate as newly stored when the existing turn key wins', async () => {
    const before = canonicalGraph();
    const persistence = jsonStore(before);
    const first = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(first.kind).toBe('committed');
    const afterFirst = persistence.durableGraph();
    const firstRow = clone(persistence.durableRows()[0]!);
    const changedRetry = inputFor(afterFirst, {
      modelValue: 0.9, requestHash: 'sha256:different-request-same-turn',
    });
    expect(changedRetry.turnId).toBe(TURN_ID);
    expect(changedRetry.requestHash).not.toBe(firstRow.request_hash);
    const replay = await executeOptionInterventionEdit(changedRetry, persistence.fresh());
    expect(replay).toMatchObject({ kind: 'unverified', commitAttempted: true });
    expect(replay).not.toHaveProperty('response');
    expect(persistence.attempts).toHaveLength(2);
    expect(persistence.durableRows()).toEqual([firstRow]);
    expect(persistence.durableGraph()).toEqual(afterFirst);
    expect(persistence.durableGraph().nodes.find(node => node.id === 'option')?.interventions?.factor.value)
      .toBe(0.3);
  });

  it.each([
    ['different request hash', 'sha256:different-request', 'committed_turn_unverified'],
    ['reused request hash but different fact', 'sha256:option-factor-03', 'committed_fact_unverified'],
  ])('does not let matching current graph override the original parent: %s', async (_case, requestHash, reason) => {
    const before = canonicalGraph();
    const persistence = jsonStore(before);
    expect((await executeOptionInterventionEdit(inputFor(before), persistence.fresh())).kind).toBe('committed');
    const afterFirst = persistence.durableGraph();
    const firstRow = clone(persistence.durableRows()[0]!);
    const changedRetry = inputFor(afterFirst, { modelValue: 0.9, requestHash });
    const candidate = applyOptionInterventionEdit({ ...changedRetry, persistedGraph: afterFirst });
    expect(candidate.kind).toBe('candidate');
    if (candidate.kind !== 'candidate') throw new Error('Expected explicit changed retry candidate');
    persistence.stageConcurrentGraphOnDuplicate(candidate.graph);

    const result = await executeOptionInterventionEdit(changedRetry, persistence.fresh());
    expect(persistence.durableGraph()).toEqual(candidate.graph);
    expect(persistence.durableRows()).toEqual([firstRow]);
    expect(persistence.attempts).toHaveLength(2);
    expect(result).toMatchObject({ kind: 'unverified', reason, commitAttempted: true });
    expect(result).not.toHaveProperty('response');
  });

  it.each(['omitParentRead', 'omitFactRead'] as const)(
    'withholds an Applied outcome when %s makes committed history unverifiable', async missingRead => {
      const before = canonicalGraph();
      const persistence = jsonStore(before, { [missingRead]: true });
      const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
      expect(result).toMatchObject({ kind: 'unverified', commitAttempted: true });
      expect(result).not.toHaveProperty('response');
      expect(persistence.attempts).toHaveLength(1);
      expect(persistence.durableRows()).toHaveLength(1);
      expect(persistence.durableGraph().nodes.find(node => node.id === 'option')?.interventions?.factor.value)
        .toBe(0.3);
    },
  );

  it('keeps a guest commit successful when there is no model-version receipt', async () => {
    const before = canonicalGraph();
    const persistence = jsonStore(before);
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') throw new Error('Expected ordinary guest commit');
    expect(result.response.model_version_receipt).toBeUndefined();
    expect(result.graph).toEqual(await persistence.fresh().loadGraph(SCENARIO_ID));
    expect(persistence.durableRows()).toHaveLength(1);
  });

  it('carries an unrelated executable hold through the real commit and cold read with exactly one TTL decrement', async () => {
    const before = canonicalGraph();
    const pending = pendingHold(before);
    const originalPending = clone(pending);
    const persistence = jsonStore(before, { pendingActions: [pending] });
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') throw new Error(`Expected commit, got ${result.kind}`);
    const coldPending = await persistence.fresh().readMostRecentPendingActions(SCENARIO_ID, { validation: 'strict' });
    expect(coldPending).toEqual([{
      ...originalPending,
      preconditions: { ...originalPending.preconditions, graph_hash: result.analysisGraphHash },
      expires_at_turn_count: 3,
    }]);
    expect(parsePendingAction(coldPending[0])).toEqual(coldPending[0]);
    expect(result.analysisGraphHash).not.toBe(originalPending.preconditions.graph_hash);
    expect(pending).toEqual(originalPending);
    expect(persistence.attempts).toHaveLength(1);
    expect(persistence.durableRows()).toHaveLength(1);
    expect(persistence.durableRows()[0]?.pending_actions).toEqual(coldPending);
    expect(persistence.durableRows()[0]?.handler_facts).toHaveLength(1);
    // Threading is not consent to execute the unrelated held operation.
    expect(persistence.durableGraph().nodes.find(node => node.id === 'other_factor')?.observed_state?.value)
      .toBe(0.6);
    expect(result.response.assistant_text).not.toMatch(/lapsed/i);
  });

  it('lets the same hold lapse honestly when the one commit exhausts its turn TTL', async () => {
    const before = canonicalGraph();
    const pending = pendingHold(before, 1);
    expect(pending.expires_at_turn_count).toBe(1);
    const persistence = jsonStore(before, { pendingActions: [pending] });
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') throw new Error(`Expected commit, got ${result.kind}`);
    expect(persistence.durableRows()).toHaveLength(1);
    expect(persistence.durableRows()[0]?.pending_actions).toEqual([]);
    expect(await persistence.fresh().readMostRecentPendingActions(SCENARIO_ID, { validation: 'strict' })).toEqual([]);
    expect(result.response.assistant_text).toMatch(/lapsed/i);
    expect(persistence.durableRows()[0]?.assistantMessage).toBe(result.response.assistant_text);
    expect(persistence.durableGraph().nodes.find(node => node.id === 'other_factor')?.observed_state?.value)
      .toBe(0.6);
  });

  it('returns the optional version receipt only when it describes the committed turn and postimage', async () => {
    const before = canonicalGraph();
    const persistence = jsonStore(before, { versionReceipt: receiptFor });
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') throw new Error(`Expected receipted commit, got ${result.kind}`);
    expect(persistence.durableReceipts()).toHaveLength(1);
    const receipt = persistence.durableReceipts()[0]!;
    expect(result.response.model_version_receipt).toEqual(toModelVersionMutationReceiptV1(SCENARIO_ID, receipt));
    expect(result.response.model_version_receipt?.source_turn_id).toBe(TURN_ID);
    expect(result.response.model_version_receipt?.graph).toEqual(result.graph);
    expect(result.graph).toEqual(await persistence.fresh().loadGraph(SCENARIO_ID));
    expect(persistence.durableRows()).toHaveLength(1);
    expect(persistence.durableRows()[0]?.handler_facts).toHaveLength(1);
  });

  it.each(['different_turn', 'different_postimage'] as const)(
    'withholds Applied for a structurally valid receipt with %s after the graph, parent and fact actually commit',
    async mismatch => {
      const before = canonicalGraph();
      const persistence = jsonStore(before, { versionReceipt: write => {
        const receipt = receiptFor(write);
        if (mismatch === 'different_turn') {
          return { ...receipt, source_turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd' };
        }
        const oldIdentity = computeGraphIdentityHash(before);
        const oldAnalysis = computeVersionAnalysisAffectingHashRecord(before);
        if (oldIdentity === null || oldAnalysis === null) throw new Error('Old receipt fixture must hash');
        // An internally consistent old receipt must not certify the new graph.
        return { ...receipt, graph: clone(before), graph_identity_hash: oldIdentity.value,
          analysis_affecting_hash: oldAnalysis.value };
      } });
      const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
      expect(result).toEqual({ kind: 'unverified', reason: 'committed_receipt_mismatch', commitAttempted: true });
      expect(result).not.toHaveProperty('response');
      expect(persistence.attempts).toHaveLength(1);
      expect(persistence.durableRows()).toHaveLength(1);
      expect(persistence.durableRows()[0]?.handler_facts).toHaveLength(1);
      const cold = await persistence.fresh().loadGraph(SCENARIO_ID);
      expect(cold).toEqual(persistence.durableRows()[0]?.graph);
      expect(persistence.durableGraph().nodes.find(node => node.id === 'option')?.interventions?.factor.value)
        .toBe(0.3);
      const receipt = persistence.durableReceipts()[0]!;
      expect(toModelVersionMutationReceiptV1(SCENARIO_ID, receipt)).toBeDefined();
      if (mismatch === 'different_turn') {
        expect(receipt.source_turn_id).not.toBe(TURN_ID);
        expect(receipt.graph).toEqual(cold);
      } else {
        expect(receipt.source_turn_id).toBe(TURN_ID);
        expect(receipt.graph).toEqual(before);
        expect(receipt.graph).not.toEqual(cold);
        expect(receipt.graph_identity_hash).toBe(computeGraphIdentityHash(before)?.value);
        expect(receipt.analysis_affecting_hash).toBe(computeVersionAnalysisAffectingHashRecord(before)?.value);
      }
    },
  );

  it('does not render a model-scale intervention as a percentage or an unlicensed raw currency amount', async () => {
    const initial = canonicalGraph();
    const factor = initial.nodes.find(node => node.id === 'factor')!;
    factor.observed_state = {
      ...factor.observed_state, value: 0.5, unit: 'GBP', cap: 100_000, raw_value: 50_000,
    };
    const before = projectGraphForPersistence(initial);
    expect(projectGraphForPersistence(clone(before))).toEqual(before);
    const persistence = jsonStore(before);
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') throw new Error('Expected model-scale intervention commit');
    expect(persistence.durableGraph().nodes.find(node => node.id === 'option')?.interventions?.factor)
      .toMatchObject({ value: 0.3, source: 'user_specified' });
    expect(persistence.durableGraph().nodes.find(node => node.id === 'factor')?.observed_state)
      .toEqual(factor.observed_state);
    expect(result.response.assistant_text).toContain('Pilot');
    expect(result.response.assistant_text).toContain('Coverage');
    // The explicit model-scale value remains licensed. It must not be
    // converted into percent or raw currency via this factor's amount/cap.
    expect(result.response.assistant_text).toContain('0.3');
    expect(result.response.assistant_text).not.toMatch(/[%£$€]|\bGBP\b|\b(?:30[ ,]?000|50[ ,]?000|100[ ,]?000)\b/);
  });

  it('leaves an unchanged AI estimate and its provenance untouched without appending', async () => {
    const before = canonicalGraph();
    const persistence = jsonStore(before);
    const result = await executeOptionInterventionEdit(inputFor(before, { modelValue: 0.2 }), persistence.fresh());
    expect(result).toEqual({ kind: 'unchanged' });
    expect(persistence.attempts).toEqual([]);
    expect(persistence.durableGraph()).toEqual(before);
  });

  it('never appends an invalid or stale request', async () => {
    const before = canonicalGraph();
    for (const overrides of [{ modelValue: 1.1 }, { expectedGraphHash: 'stale' }]) {
      const persistence = jsonStore(before);
      const result = await executeOptionInterventionEdit(inputFor(before, overrides), persistence.fresh());
      expect(result.kind).toBe('refused');
      expect(persistence.attempts).toEqual([]);
      expect(persistence.durableRows()).toEqual([]);
      expect(persistence.durableGraph()).toEqual(before);
    }
  });

  it('does not turn unknown freshness into permission to append', async () => {
    const before = canonicalGraph();
    const persistence = jsonStore(before);
    const result = await executeOptionInterventionEdit(
      inputFor(before, { freshness: 'unknown' }), persistence.fresh(),
    );
    expect(result.kind).toBe('refused');
    expect(persistence.attempts).toEqual([]);
    expect(persistence.durableRows()).toEqual([]);
    expect(persistence.durableGraph()).toEqual(before);
  });
});
