import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { _resetConfigCache } from '../../../config/index.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { createMockSessionStore, makeSessionTurnRow } from '../../../../tests/utils/mock-session-store.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import type {
  AtomicCommittedModelVersionReceipt, SessionStore, SessionTurnWrite,
} from '../../session/store.js';
import type { PendingAction } from '../../session/pending-action.js';
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
  /** Live pending authority the transaction must thread, not silently drop. */
  pendings?: readonly PendingAction[];
  /** The atomic version receipt this append reports, derived from the write. */
  receiptFor?: (write: SessionTurnWrite) => AtomicCommittedModelVersionReceipt | undefined;
} = {}) {
  let graphJson = JSON.stringify(initial);
  let concurrentGraphJson: string | undefined;
  let loads = 0;
  const attempts: SessionTurnWrite[] = [];
  const rows = new Map<string, { id: string; json: string }>();
  const fresh = (): SessionStore => createMockSessionStore({
    loadGraph: async scenarioId => {
      expect(scenarioId).toBe(SCENARIO_ID);
      loads += 1;
      if (loads === options.failLoadAt) throw new Error('canonical read unavailable');
      return JSON.parse(graphJson);
    },
    readMostRecentPendingActions: async () => {
      if (options.failPendingRead) throw new Error('pending authority unavailable');
      return clone(options.pendings ?? []) as PendingAction[];
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
        return { id: previous.id };
      }
      const stored = clone(write);
      const id = `persisted-row-${rows.size + 1}`;
      rows.set(key, { id, json: JSON.stringify(stored) });
      if (stored.graph !== undefined) graphJson = JSON.stringify(stored.graph);
      const receipt = options.receiptFor?.(stored);
      if (receipt !== undefined) return { id, modelVersionReceipt: receipt };
      // Guest/no-version outcome: ordinary graph+turn+fact persistence succeeds.
      return { id };
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
    loadCount: () => loads,
    stageConcurrentGraphOnDuplicate: (graph: unknown) => { concurrentGraphJson = JSON.stringify(graph); },
  };
}

/** The submission may carry a bare number or the rich `{ value }` form. */
function interventionNumber(raw: unknown): number | undefined {
  if (typeof raw === 'number') return raw;
  if (raw !== null && typeof raw === 'object' && typeof (raw as { value?: unknown }).value === 'number') {
    return (raw as { value: number }).value;
  }
  return undefined;
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

  /**
   * ⭐⭐ THE PENDING LEG THE ORIGINAL EVIDENCE COULD NOT WITNESS.
   *
   * Every existing case in this file reads `readMostRecentPendingActions` as
   * `[]`, so `priorPendingActions: holds.threaded` was carried through the real
   * commit **without one live hold ever passing along it**. A transaction that
   * silently dropped the user's outstanding authority would have been green in
   * all of them — the PR body says so itself ("nonempty pending preservation
   * lacks a direct new transaction witness"), and this closes that.
   *
   * ⚠ TWO PENDINGS THAT MUST PART, AND THE EXPECTATION IS DERIVED FROM THE
   * PRODUCER, NOT FROM THE SHAPE OF THE FIX. My first version pinned BOTH to
   * the stale hash and expected the unpinned-by-kind one to survive; it REDs,
   * and correctly — `computeSurvivingPriorPendingsDetailed` rule 4 (commit.ts)
   * drops ANY pending whose `preconditions.graph_hash` differs from the
   * committed hash, whatever its kind, and `hold-thread-through.ts:306-310`
   * says so in as many words ("the carry-forward's hash rule owns
   * invalidation"). Asserting my reading over the producer's would have been
   * a perfect score on the wrong exam (trap 13c).
   *
   * So the pair is: an UNPINNED hold survives the commit untouched, and a
   * stale-pinned CONFIRMATION-EXPECTING hold is retired WITH A NOTICE. One
   * assertion alone cannot tell "the rule discriminates" from "every hold is
   * dropped" — that is a guard agreeing with itself. If the transaction stopped
   * threading pendings at all, the survivor assertion REDs.
   */
  it('threads live pending authority through the commit and retires only the hold this mutation invalidates', async () => {
    const before = canonicalGraph();
    const stalePin = computeAnalysisAffectingGraphHash(before);
    if (stalePin === null) throw new Error('Canonical fixture must have an analysis hash');
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const survives: PendingAction = {
      id: '11111111-1111-4111-8111-111111111111',
      scenario_id: SCENARIO_ID,
      chip_id: 'chip_clarify_factor_0',
      action: { kind: 'set_factor_value', factor_id: 'factor', value: 0.4, operator: 'set' },
      // No `graph_hash`: this hold does not depend on the topology this
      // mutation moved, so nothing has invalidated it.
      preconditions: { target_entity_ids: ['factor'] },
      expires_at_turn_count: 3,
      expires_at_iso: future,
      emitted_at_iso: '2026-09-08T00:00:00.000Z',
    };
    const retired: PendingAction = {
      id: '22222222-2222-4222-8222-222222222222',
      scenario_id: SCENARIO_ID,
      chip_id: 'chip_proposed_concept',
      action: {
        kind: 'proposed_concept', concept: 'supplier concentration',
        preferred_kind: 'risk', public_label: 'Add supplier concentration',
        public_message: 'Add supplier concentration as a risk.',
      },
      preconditions: { graph_hash: stalePin },
      expires_at_turn_count: 3,
      expires_at_iso: future,
      emitted_at_iso: '2026-09-08T00:00:00.000Z',
    };
    const persistence = jsonStore(before, { pendings: [survives, retired] });

    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());

    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') throw new Error('Expected the ordinary commit');
    // PRECONDITION, pinned in-test: this mutation really did move the hash the
    // two holds are pinned to. Without it the split below could be asserting
    // nothing (12b — a control whose reference stops discriminating).
    expect(result.analysisGraphHash).not.toBe(stalePin);

    const [write] = persistence.durableRows();
    const threadedIds = (write?.pending_actions ?? []).map(pending => pending.id);
    expect(threadedIds).toContain(survives.id);
    expect(threadedIds).not.toContain(retired.id);

    // The retirement is DISCLOSED, not silent: the ack keeps its own sentence
    // and the lapse notice is appended to it, never in place of it.
    expect(result.response.assistant_text).toContain('now has an effect value of 0.3');
    expect(result.response.assistant_text.length)
      .toBeGreaterThan('"Option A" now has an effect value of 0.3 on "Factor".'.length);
  });

  /**
   * ⭐⭐ THE VERSION-RECEIPT MISMATCH LEG, AND ITS OPPOSITE-DIRECTION TWIN.
   *
   * `committed_receipt_mismatch` is unreachable in this file today, because the
   * store never reports a receipt — so the branch that refuses to speak for a
   * receipt describing ANOTHER turn had no witness at all.
   *
   * ⚠ THE MISMATCH CASE PINS ITS OWN PRECONDITION BY CONSTRUCTION. A receipt
   * that fails `toModelVersionMutationReceiptV1` is swallowed by commit and
   * arrives as `null`, which yields `committed` — so a green mismatch case
   * cannot be the vacuous one. The twin then proves the refusal is about the
   * MISMATCH and not about receipts in general: a receipt naming this turn and
   * this postimage commits, and the response carries it.
   */
  it('will not speak for a version receipt that describes another turn, and does speak for its own', async () => {
    const receiptBase = {
      mutation_id: '33333333-3333-4333-8333-333333333333',
      version_id: '44444444-4444-4444-8444-444444444444',
      version_number: 2,
      graph_identity_hash: 'a'.repeat(64),
      analysis_affecting_hash: 'b'.repeat(64),
      hash_algorithm: 'sha256',
      identity_projection_version: 'v1',
      identity_normaliser_version: 'v1',
      graph_schema_version: 'graph.v3',
      actor_kind: 'system',
      authored_by: null,
      creation_kind: 'committed_mutation',
      source_version_id: null,
      parent_version_id: null,
      root_version_id: null,
      undo_version_id: null,
      event_id: 'evt-option-intervention',
    } as const satisfies Omit<AtomicCommittedModelVersionReceipt, 'graph' | 'source_turn_id'>;

    const otherTurn = jsonStore(canonicalGraph(), {
      receiptFor: write => ({
        ...receiptBase, graph: write.graph,
        source_turn_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      }),
    });
    const mismatched = await executeOptionInterventionEdit(
      inputFor(canonicalGraph()), otherTurn.fresh(),
    );
    expect(mismatched).toEqual({
      kind: 'unverified', reason: 'committed_receipt_mismatch', commitAttempted: true,
    });

    const ownTurn = jsonStore(canonicalGraph(), {
      receiptFor: write => ({ ...receiptBase, graph: write.graph, source_turn_id: TURN_ID }),
    });
    const matched = await executeOptionInterventionEdit(
      inputFor(canonicalGraph()), ownTurn.fresh(),
    );
    expect(matched.kind).toBe('committed');
    if (matched.kind !== 'committed') throw new Error('Expected the matching receipt to commit');
    // The twin's own precondition: the receipt was really parsed and attached,
    // so the case above refused a PRESENT receipt rather than an absent one.
    expect(matched.response.model_version_receipt?.version_id).toBe(receiptBase.version_id);
  });

  /**
   * ⭐⭐ THE ANALYSIS ACTUALLY CONSUMES THE EDITED VALUE — the join this file
   * stopped one hop short of.
   *
   * Every case above ends at the durable graph or the readback. "It is in the
   * graph" is not "the analysis runs on it": the submission is a PROJECTION,
   * and a projection can drop, re-derive or stale a field without any of these
   * assertions moving. So this walks one hop further, to
   * `buildCanonicalAnalysisReadyFromGraph` — the canonical payload the run is
   * built from.
   *
   * ⚠ NOT A SECOND COPY OF THE APPLY CHAIN. `option-effect-write-apply-chain`
   * already pins hops 0-5 for the operation the NL resolver composes, including
   * the readiness flip and #1016's guard. This asserts only what that file
   * cannot: that the value THIS transactional writer committed is the value the
   * submission carries. Duplicating its hops here would be two spellings of one
   * proof.
   *
   * ⚠ THE BEFORE/AFTER PAIR IS THE EVIDENCE, NOT THE AFTER. The fixture's
   * option already holds 0.2 on this factor, so "the payload has a number for
   * this pair" is true before the write and proves nothing. The discrimination
   * is that the number CHANGES to the committed one — and that its three
   * neighbours (the same option's other factor, and the baseline option's two)
   * are byte-identical, which is the wrong-object control.
   */
  it('submits the edited value to the analysis, and moves nothing else', async () => {
    const before = canonicalGraph();
    const readBefore = buildCanonicalAnalysisReadyFromGraph(before);
    const optionBefore = readBefore?.options.find(option => option.option_id === 'option');
    // Precondition, pinned in-test: the pair already carries the OLD number, so
    // the assertion below cannot pass by the payload merely having a value.
    expect(interventionNumber(optionBefore?.interventions.factor)).toBe(0.2);

    const persistence = jsonStore(before);
    const result = await executeOptionInterventionEdit(inputFor(before), persistence.fresh());
    expect(result.kind).toBe('committed');
    if (result.kind !== 'committed') throw new Error('Expected the ordinary commit');

    const readAfter = buildCanonicalAnalysisReadyFromGraph(result.graph);
    const optionAfter = readAfter?.options.find(option => option.option_id === 'option');
    expect(interventionNumber(optionAfter?.interventions.factor)).toBe(0.3);

    // Wrong-object control: the same option's other factor and the baseline
    // option's pair are exactly what they were.
    expect(interventionNumber(optionAfter?.interventions.other_factor)).toBe(0.55);
    const baselineAfter = readAfter?.options.find(option => option.option_id === 'other_option');
    expect(interventionNumber(baselineAfter?.interventions.factor)).toBe(0.7);
    expect(interventionNumber(baselineAfter?.interventions.other_factor)).toBe(0.65);

    // ⭐ AND THE USER-FACING MEANING TRAVELS WITH IT. `intervention_details` is
    // the payload's display half, derived from the factor's own unit and cap —
    // so this asserts the submission does not carry a new number under an old
    // rendering of it, which is the split a value edit is most likely to leave.
    expect(optionAfter?.intervention_details?.factor)
      .toEqual({ display_value: '30%', normalised_value: 0.3, raw_value: 30, unit: '%' });
    expect(optionBefore?.intervention_details?.factor)
      .toEqual({ display_value: '20%', normalised_value: 0.2, raw_value: 20, unit: '%' });

    // The edit did not cost the option its analysis status, or the run its
    // admission. (`may_run` is false on this fixture for unrelated reasons —
    // the assertion is that the write did not MOVE it, not that it is true.)
    expect(optionAfter?.status).toBe('ready');
    expect(readAfter?.may_run).toBe(readBefore?.may_run);
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

/**
 * ⭐⭐⭐ THE SHAPE THE ESTATE ACTUALLY PERSISTS — the class this whole suite
 * omitted, and the reason a witnessed manual Save was refused.
 *
 * Every fixture above builds interventions through `intervention()`, which
 * always writes `target_match`. The graph a restored example actually returns
 * does not: request 144 on 2026-09-09 read back
 * `{ value: 1, source: 'brief_extraction', display_value: 'Very high (1)' }`.
 * So the corpus could not see that `InterventionV3.safeParse` — whose
 * `target_match` is REQUIRED — refuses real stored state. Root's first manual
 * Save returned 422 `invalid_existing_intervention` with nothing written
 * (request `6ec75b90`, valid write base, no chat and no analysis first).
 *
 * A corpus that omits a class the contract admits cannot certify the code over
 * that class (CLAUDE.md trap 22). These cases supply it.
 */
describe('an existing intervention persisted WITHOUT target_match', () => {
  /** The restored entry verbatim, minus the value under test. */
  function persistedByBriefExtraction(value: number) {
    return { value, source: 'brief_extraction', display_value: `Very high (${value})` };
  }

  function graphWithPersistedEntry(entry: Record<string, unknown>) {
    const graph = canonicalGraph();
    const option = graph.nodes.find(node => node.id === 'option')!;
    // ⚠ `as unknown as` DELIBERATELY, AND NOT AS A CONVENIENCE. `interventions`
    // is typed as the producer's record, and the whole point of this fixture is
    // to install a shape that record does NOT describe — the one the estate
    // actually persists. A single-step assertion is the TS2352 the ratchet
    // caught; widening the baseline instead would have hidden the fixture's own
    // reason for existing.
    (option as unknown as { interventions: Record<string, unknown> }).interventions.factor = entry;
    return projectGraphForPersistence(graph);
  }

  it('⭐ is EDITABLE — the first manual Save prepares a write, it is not refused', () => {
    const before = graphWithPersistedEntry(persistedByBriefExtraction(1));
    const candidate = applyOptionInterventionEdit({
      ...inputFor(before, { modelValue: 0.75 }), persistedGraph: before,
    });
    expect(candidate.kind).toBe('candidate');
  });

  it('⭐ and the write it prepares still satisfies the postimage scope check', () => {
    // The encoder fills `source: user_specified` and synthesises `target_match`
    // from the canonical key, so accepting the preimage does not move the
    // refusal to `mutation_scope_mismatch` one step later.
    const before = graphWithPersistedEntry(persistedByBriefExtraction(1));
    const candidate = applyOptionInterventionEdit({
      ...inputFor(before, { modelValue: 0.75 }), persistedGraph: before,
    });
    if (candidate.kind !== 'candidate') throw new Error('Expected a candidate');
    const written = candidate.graph.nodes.find(node => node.id === 'option')?.interventions?.factor;
    expect(written).toMatchObject({ value: 0.75, source: 'user_specified' });
    expect((written as { target_match?: { node_id?: string } })?.target_match?.node_id).toBe('factor');
  });

  it('an unchanged value is still a no-op, not a new user-authored measurement', () => {
    const before = graphWithPersistedEntry(persistedByBriefExtraction(0.4));
    const candidate = applyOptionInterventionEdit({
      ...inputFor(before, { modelValue: 0.4 }), persistedGraph: before,
    });
    expect(candidate.kind).toBe('unchanged');
  });

  it('⚠ REFUSAL RETAINED: a STATED target naming another node still refuses', () => {
    // The anti-retargeting guarantee is the point of the check and is untouched.
    const before = graphWithPersistedEntry({
      value: 1, source: 'brief_extraction',
      target_match: { node_id: 'other_factor', match_type: 'exact_id', confidence: 'high' },
    });
    const candidate = applyOptionInterventionEdit({
      ...inputFor(before, { modelValue: 0.75 }), persistedGraph: before,
    });
    expect(candidate).toMatchObject({ kind: 'refused', reason: 'invalid_existing_intervention' });
  });

  it('⚠ REFUSAL RETAINED: an entry with no usable value refuses at the SOURCE guard', () => {
    // ⚠ THIS ASSERTED `invalid_existing_intervention` AND THAT REASON IS
    // UNREACHABLE HERE — an independent review derived it from the source and it
    // is correct. `hasFiniteInterventionValue` (analysis-ready-helper:299)
    // rejects an entry with no numeric `value`, so
    // `mergeInterventionSourceObjects(option)[factor.id]` is `undefined`, which
    // differs from the supplied object and trips the CANONICAL-SOURCE guard
    // three lines EARLIER than the reader.
    //
    // The refusal is corrected rather than the guard relaxed: the earlier gate
    // is the stronger one, and an unusable entry never reaching the reader is
    // the right order. What matters to the user is unchanged — refused, and
    // nothing written.
    const before = graphWithPersistedEntry({ source: 'brief_extraction', display_value: 'Very high' });
    const candidate = applyOptionInterventionEdit({
      ...inputFor(before, { modelValue: 0.75 }), persistedGraph: before,
    });
    expect(candidate).toMatchObject({ kind: 'refused', reason: 'noncanonical_intervention_source' });
    // A refusal writes nothing and appends nothing.
    expect(candidate).not.toHaveProperty('graph');
    expect(candidate).not.toHaveProperty('operations');
  });

  it('⚠ BEFORE ANALYSIS TOO — the witnessed arm had never run one', () => {
    // Root's stop was a saved example with no analysis and no chat. Nothing in
    // this path may require either.
    const before = graphWithPersistedEntry(persistedByBriefExtraction(1));
    const candidate = applyOptionInterventionEdit({
      ...inputFor(before, { modelValue: 0.75, hasExistingAnalysis: false, freshness: 'none' }),
      persistedGraph: before,
    });
    expect(candidate.kind).toBe('candidate');
  });
});

/**
 * ⭐⭐⭐ THE NEWLY ADMITTED POPULATION THROUGH THE REAL STORE, COMMIT AND COLD
 * READ — because the scope guard structurally cannot see what this asserts.
 *
 * `optionInterventionPostimageIsScoped` restores the WHOLE selected cell before
 * comparing, so it proves no OTHER cell moved and says nothing about whether
 * this cell kept its own fields. Admitting entries without `target_match` made
 * their metadata reachable for the first time, and the reconstruction was
 * dropping it. Only the committed object can show that.
 */
describe('a no-target entry keeps its unrelated metadata through commit', () => {
  const RETAINED = {
    reasoning: 'Recruiting capacity constrains this assumption',
    evidence_refs: ['research-note-7'],
  };

  function persistedWithMetadata() {
    const graph = canonicalGraph();
    const option = graph.nodes.find(node => node.id === 'option')!;
    // Same double assertion, same reason — see `graphWithPersistedEntry`.
    (option as unknown as { interventions: Record<string, unknown> }).interventions.factor = {
      value: 1, source: 'brief_extraction', display_value: 'Very high (1)', ...RETAINED,
    };
    return projectGraphForPersistence(graph);
  }

  it('⭐ commits the new value and RETAINS reasoning and additive evidence', async () => {
    const before = persistedWithMetadata();
    const persistence = jsonStore(before);
    const result = await executeOptionInterventionEdit(
      inputFor(before, { modelValue: 0.75 }), persistence.fresh(),
    );
    expect(result.kind).toBe('committed');

    const cold = GraphStateIngressSchema.parse(await persistence.fresh().loadGraph(SCENARIO_ID));
    const entry = cold.nodes.find(node => node.id === 'option')!.interventions!.factor as Record<string, unknown>;

    expect(entry).toMatchObject({ value: 0.75, source: 'user_specified', ...RETAINED });
  });

  it('⚠ and DROPS the display derived from the old value — no stale representation', async () => {
    // "Very high (1)" beside a committed 0.75 would be the product contradicting
    // itself on screen. A carried-through field must not be a value-derived one.
    const before = persistedWithMetadata();
    const persistence = jsonStore(before);
    await executeOptionInterventionEdit(inputFor(before, { modelValue: 0.75 }), persistence.fresh());

    const cold = GraphStateIngressSchema.parse(await persistence.fresh().loadGraph(SCENARIO_ID));
    const entry = cold.nodes.find(node => node.id === 'option')!.interventions!.factor as Record<string, unknown>;

    expect(entry.display_value).not.toBe('Very high (1)');
  });

  it('⚠ and leaves the untouched neighbour byte-identical', async () => {
    const before = persistedWithMetadata();
    const persistence = jsonStore(before);
    await executeOptionInterventionEdit(inputFor(before, { modelValue: 0.75 }), persistence.fresh());

    const cold = GraphStateIngressSchema.parse(await persistence.fresh().loadGraph(SCENARIO_ID));
    const neighbourBefore = before.nodes.find(node => node.id === 'option')!.interventions!.other_factor;
    const neighbourAfter = cold.nodes.find(node => node.id === 'option')!.interventions!.other_factor;
    expect(neighbourAfter).toEqual(neighbourBefore);
  });
});
