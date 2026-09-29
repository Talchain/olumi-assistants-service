/**
 * ⭐⭐ THE ACCEPT PATH'S WRITE HALF.
 *
 * The conversation controller can offer a change and record consent; it could
 * not save one, because `applyOperations` had no production supplier. This
 * pins the supplier.
 *
 * ── WHAT IS REAL HERE AND WHAT IS NOT, STATED RATHER THAN IMPLIED ──────────
 * The whole graph transformation runs for REAL: `parseEditGraphResponse`,
 * `validatePatchOperations`, `applyPatchOperations`,
 * `encodeOptionInterventionsForEdit`, `mergeAppliedGraphForPersistence` and
 * `projectGraphForPersistence` are the shipped functions, not fakes. That is
 * the half where a wrong number gets written, so it is the half that must not
 * be simulated.
 *
 * `commitDirectAnswer` IS mocked — with `importOriginal` spread, so nothing
 * else in that module silently disappears — because the property under test is
 * WHAT THIS ADAPTER ASKS IT FOR. Its own behaviour is pinned by its own suite,
 * and reproducing it here would test this file's model of it instead.
 *
 * ⚠ SO THE SCOPE OF EVERY ASSERTION BELOW IS: the adapter composes the right
 * candidate graph and hands the commit seam the right metadata. NONE of it is
 * a claim about a database, a deployed function body, or a live journey.
 *
 * ── THE THREE DECISIVE ONES ───────────────────────────────────────────────
 *  1. A native magnitude rides as `raw_value` + `unit` and NEVER as `value` —
 *     with the negative assertion, so a future shape cannot quietly put it
 *     back. A native £5,000 landing in the `value` slot would move a [0,1]
 *     intervention to 5,000 and corrupt the causal model.
 *  2. A base-read failure yields the field ABSENT (undefined), never `null`.
 *     The two are opposite postures at a strict `=== undefined` test.
 *  3. The receipt is the TURN ROW id, not the model-version receipt — which is
 *     legitimately null for a guest.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import type { CommitMetadata, CommitResult } from '../commit.js';
import {
  ApplyOperationsUnverifiedError,
  createApplyOperations,
  currentModelRevision,
  flattenProposalOperations,
  invariantBaselineFor,
  modelRevisionOf,
  requestDigestFor,
  type ApplyOperationsInput,
  type ApplyOperationsStore,
} from '../apply-operations.js';

const commitDirectAnswer = vi.hoisted(() => vi.fn());
vi.mock('../commit.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../commit.js')>()),
  commitDirectAnswer,
}));

// The canonical store accessor, mocked so the FALLBACK is observable. Spread
// with `importOriginal` for the usual reason — replacing the module wholesale
// would silently delete every other export it has.
const getSessionStore = vi.hoisted(() => vi.fn());
vi.mock('../session/index.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../session/index.js')>()),
  getSessionStore,
}));

// ─────────────────────────────────────────────────────────────────────────────
// Fixture
//
// `f-budget` carries `observed_state.{cap, unit}` because that is what makes a
// native magnitude derivable at all: the encoder computes `value = raw_value /
// cap` and DEFERS when there is no cap rather than inventing a scale. So
// £5,000 against a £10,000 cap must arrive as the model value 0.5.
// ─────────────────────────────────────────────────────────────────────────────

const OPTION_ID = 'opt_limited_test';
const QUALITY_ID = 'f_quality';
const BUDGET_ID = 'f_budget';
const SCENARIO = '11111111-1111-4111-8111-111111111111';
const TURN_ROW_ID = '22222222-2222-4222-8222-222222222222';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function baseGraph(): GraphV3T {
  return GraphV3.parse({
    nodes: [
      { id: 'goal_outcome', kind: 'goal', label: 'Campaign outcome' },
      {
        id: OPTION_ID,
        kind: 'option',
        label: 'AI Tool + Limited Budget Test',
        interventions: {
          [QUALITY_ID]: {
            value: 0.2,
            source: 'cee_hypothesis',
            target_match: { node_id: QUALITY_ID, match_type: 'exact_id', confidence: 'high' },
          },
        },
      },
      {
        id: QUALITY_ID,
        kind: 'factor',
        label: 'Campaign Strategic Quality',
        observed_state: { value: 0.5, source: 'cee_inference' },
      },
      {
        id: BUDGET_ID,
        kind: 'factor',
        label: 'Advertising Budget Allocated',
        observed_state: { value: 0.3, raw_value: 3000, unit: '£', cap: 10000, source: 'cee_inference' },
      },
    ],
    edges: [
      [OPTION_ID, QUALITY_ID],
      [OPTION_ID, BUDGET_ID],
      [QUALITY_ID, 'goal_outcome'],
      [BUDGET_ID, 'goal_outcome'],
    ].map(([from, to]) => ({
      from,
      to,
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 1,
      effect_direction: 'positive',
    })),
  });
}

/** The operation shapes the two real emitters produce — an ENCODED value as a
 *  whole-object replacement, and a NATIVE magnitude riding beside it. */
const OFFERED_OPS: Record<string, unknown>[] = [
  {
    op: 'update_node',
    path: `/nodes/${OPTION_ID}/data/interventions/${QUALITY_ID}`,
    value: { value: 0.55 },
    old_value: null,
    impact: 'moderate',
    rationale: 'Sets the effect value on Campaign Strategic Quality.',
  },
  {
    // ⭐ THE NATIVE ONE.
    op: 'update_node',
    path: `/nodes/${OPTION_ID}/data/interventions/${BUDGET_ID}`,
    value: { raw_value: 5000, unit: '£' },
    old_value: null,
    impact: 'moderate',
    rationale: 'Records the £ figure the user gave.',
  },
];

function proposalOperations(ops: Record<string, unknown>[] = OFFERED_OPS) {
  return [
    {
      kind: 'set_option_effect',
      summary: 'Set what AI Tool + Limited Budget Test does to quality (0.55) and budget (£5,000)',
      detail: { operations: ops },
    },
  ];
}

interface Harness {
  readonly store: ApplyOperationsStore;
  readonly loadGraph: ReturnType<typeof vi.fn>;
  readonly readRecent: ReturnType<typeof vi.fn>;
}

/** `stored` is the mutable "database": the commit mock writes the candidate
 *  into it, so the adapter's readback sees what the commit was given. */
function harness(options: { initial?: unknown; loadThrows?: boolean } = {}): Harness {
  const state: { graph: unknown } = {
    graph: options.initial === undefined ? baseGraph() : options.initial,
  };
  const loadGraph = vi.fn(async () => {
    if (options.loadThrows === true) throw new Error('transport');
    return state.graph;
  });
  const readRecent = vi.fn(async () => [
    {
      id: TURN_ROW_ID,
      scenario_id: SCENARIO,
      turn_id: lastCommitMetadata().turn_id,
      request_hash: lastCommitMetadata().request_hash,
      created_at: '2026-09-21T00:00:00.000Z',
      duration_ms: 0,
      turn_class: 'direct_answer' as const,
      user_id: null,
      handler_id: null,
      response_emitted: true,
      llm_calls_used: 0,
    },
  ]);
  // The commit mock persists what it was handed, which is what makes the
  // adapter's readback assertion a real check rather than a tautology.
  commitDirectAnswer.mockImplementation(async (_r: unknown, meta: CommitMetadata) => {
    state.graph = meta.graph;
    return {
      response: _r,
      performed: true,
      persisted_row_id: TURN_ROW_ID,
      modelVersionReceipt: null,
      graphPersisted: true,
    } as unknown as CommitResult;
  });
  return {
    store: { loadGraph, readRecent } as unknown as ApplyOperationsStore,
    loadGraph,
    readRecent,
  };
}

function lastCommitMetadata(): CommitMetadata {
  const call = commitDirectAnswer.mock.calls.at(-1);
  if (call === undefined) throw new Error('commitDirectAnswer was never called');
  return call[1] as CommitMetadata;
}

function input(over: Partial<ApplyOperationsInput> = {}): ApplyOperationsInput {
  return {
    proposalId: 'proposal-0',
    idempotencyKey: 'idempotency-turn-2-0',
    operations: proposalOperations(),
    modelRevision: modelRevisionOf(baseGraph())!,
    ...over,
  };
}

function port(h: Harness) {
  return createApplyOperations({ scenarioId: SCENARIO, store: h.store, requestId: 'req-1' });
}

beforeEach(() => {
  commitDirectAnswer.mockReset();
  getSessionStore.mockReset();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('applyOperations — the accept path writes what was consented to', () => {
  it('⭐ a native magnitude rides as raw_value + unit and NEVER as value', async () => {
    const h = harness();
    const outcome = await port(h)(input());

    expect(outcome.ok, JSON.stringify(outcome)).toBe(true);

    // (a) THE SHAPE, at the operation the adapter constructed. Bound by
    //     identity to the budget factor's own key, not to "some operation".
    const committedGraph = lastCommitMetadata().graph as GraphV3T;
    const option = committedGraph.nodes.find((n) => n.id === OPTION_ID);
    const budget = option?.interventions?.[BUDGET_ID] as Record<string, unknown> | undefined;
    expect(budget, 'the budget intervention exists at all').toBeDefined();
    expect(budget!.raw_value, 'the native figure survives verbatim').toBe(5000);
    expect(budget!.unit).toBe('£');

    // (b) THE NUMBER, which is the part that would corrupt the model. £5,000
    //     against a £10,000 cap is the MODEL value 0.5. A native 5000 landing
    //     in `value` is the defect; assert the real quotient, not merely "not
    //     5000", so a fabricated substitute cannot pass either.
    expect(budget!.value, 'value = raw_value / cap, never the native magnitude').toBe(0.5);
    expect(budget!.value).not.toBe(5000);

    // (c) THE NEGATIVE ASSERTION the brief names, at the operation as sent:
    //     the native entry the adapter forwarded to the applier carries no
    //     `value` key of its own, so a future shape cannot quietly put one back.
    const sentNative = OFFERED_OPS.find((o) => String(o.path).endsWith(BUDGET_ID))!;
    expect(sentNative.value).toEqual({ raw_value: 5000, unit: '£' });
    expect(sentNative.value).not.toHaveProperty('value');

    // And the encoded sibling is untouched by any of this.
    const quality = option?.interventions?.[QUALITY_ID] as Record<string, unknown> | undefined;
    expect(quality?.value, 'the already-encoded value is used as-is').toBe(0.55);
  });

  it('⭐ the receipt is the TURN ROW id, not the model-version receipt', async () => {
    const h = harness();
    commitDirectAnswer.mockImplementation(async (r: unknown, meta: CommitMetadata) => {
      (h.loadGraph as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(meta.graph);
      return {
        response: r,
        performed: true,
        persisted_row_id: TURN_ROW_ID,
        // A DIFFERENT id, so the two cannot be confused by coincidence.
        modelVersionReceipt: {
          version_id: '99999999-9999-4999-8999-999999999999',
          source_turn_id: 'idempotency-turn-2-0',
          graph: meta.graph,
        },
        graphPersisted: true,
      } as unknown as CommitResult;
    });

    const outcome = await port(h)(input());
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) throw new Error('expected ok');
    expect(outcome.receiptId).toBe(TURN_ROW_ID);
    expect(outcome.receiptId).not.toBe('99999999-9999-4999-8999-999999999999');
  });

  it('a guest commit — a NULL version receipt — is a success with a receipt, not a failure', async () => {
    const h = harness();
    const outcome = await port(h)(input());
    expect(lastCommitMetadata()).toBeDefined();
    expect(outcome).toEqual({
      ok: true,
      receiptId: TURN_ROW_ID,
      newModelRevision: modelRevisionOf(lastCommitMetadata().graph),
    });
  });

  it('⭐ the idempotency key IS the turn id — the whole at-most-once mechanism', async () => {
    const h = harness();
    await port(h)(input({ idempotencyKey: 'idempotency-turn-9-0' }));
    expect(lastCommitMetadata().turn_id).toBe('idempotency-turn-9-0');
  });

  it('the request digest is stable across a replay of the same call', () => {
    expect(requestDigestFor(input())).toBe(requestDigestFor(input()));
    expect(requestDigestFor(input())).not.toBe(requestDigestFor(input({ proposalId: 'other' })));
  });

  it('commits a handler fact, without which the next turn cannot see the change', async () => {
    const h = harness();
    await port(h)(input());
    expect(lastCommitMetadata().handler_facts).toHaveLength(1);
    expect(lastCommitMetadata().graph_hash).toBe(modelRevisionOf(lastCommitMetadata().graph));
  });

  it('leaves the rest of the model exactly as it was', async () => {
    const before = baseGraph();
    const pristine = clone(before);
    const h = harness({ initial: before });
    await port(h)(input());
    const after = lastCommitMetadata().graph as GraphV3T;
    expect(after.nodes.filter((n) => n.id !== OPTION_ID)).toEqual(
      pristine.nodes.filter((n) => n.id !== OPTION_ID),
    );
    expect(after.edges).toEqual(pristine.edges);
    expect(before, 'the base is not mutated in place').toEqual(pristine);
  });
});

describe('applyOperations — the invariant baseline is a three-state field', () => {
  it('⭐ a base-read FAILURE yields the field ABSENT (undefined), never null', () => {
    const failed = invariantBaselineFor({ ok: false, reason: 'transport' });
    expect('baseGraphForInvariants' in failed, 'absent, so the strict === undefined test fires').toBe(false);
    expect(failed).toEqual({});
    // The discriminating twin: `null` must NOT be how a failure is spelled,
    // because `null !== undefined` and the check flips to fully fail-closed.
    expect(failed).not.toEqual({ baseGraphForInvariants: null });
  });

  it('a stored graph is passed through VERBATIM — including a legitimate null', () => {
    const stored = baseGraph();
    expect(invariantBaselineFor({ ok: true, graph: stored }).baseGraphForInvariants).toBe(stored);
    const nullBase = invariantBaselineFor({ ok: true, graph: null });
    expect('baseGraphForInvariants' in nullBase, 'a real null is PRESENT, not absent').toBe(true);
    expect(nullBase.baseGraphForInvariants).toBeNull();
  });

  it('the live commit carries the stored graph by IDENTITY, with no coercion in between', async () => {
    const stored = baseGraph();
    const h = harness({ initial: stored });
    await port(h)(input());
    expect(lastCommitMetadata().baseGraphForInvariants).toBe(stored);
  });
});

describe('applyOperations — what it refuses, with nothing dispatched', () => {
  it('a base read that throws refuses and sends nothing', async () => {
    const h = harness({ loadThrows: true });
    const outcome = await port(h)(input());
    expect(outcome.ok).toBe(false);
    expect(commitDirectAnswer, 'no write may be dispatched').not.toHaveBeenCalled();
  });

  it('a revision that has moved refuses — consent was given against a different model', async () => {
    const h = harness();
    const outcome = await port(h)(input({ modelRevision: 'a-revision-that-has-moved' }));
    expect(outcome.ok).toBe(false);
    if (outcome.ok) throw new Error('expected refusal');
    expect(outcome.reason).toContain('changed');
    expect(commitDirectAnswer).not.toHaveBeenCalled();
  });

  it('⛔ an operation it cannot read refuses the WHOLE set, never a partial write', async () => {
    const h = harness();
    const outcome = await port(h)(
      input({
        operations: [
          ...proposalOperations(),
          { kind: 'something_else', summary: 'an operation with no patch' },
        ],
      }),
    );
    expect(outcome.ok, 'one unreadable entry refuses all of them').toBe(false);
    expect(commitDirectAnswer).not.toHaveBeenCalled();
  });

  it('the flattener names the entry it could not read, and admits an empty list is nothing', () => {
    expect(flattenProposalOperations([])).toEqual({ ok: false, reason: 'there was nothing to apply' });
    const bad = flattenProposalOperations([{ kind: 'k', summary: 'the summary', detail: { operations: [1] } }]);
    expect(bad.ok).toBe(false);
    if (bad.ok) throw new Error('expected refusal');
    expect(bad.reason).toContain('the summary');
    const good = flattenProposalOperations(proposalOperations());
    expect(good.ok && good.raw).toHaveLength(2);
  });

  it('an operation naming a node that is not there refuses rather than throwing', async () => {
    const h = harness();
    const outcome = await port(h)(
      input({
        operations: proposalOperations([
          { op: 'update_node', path: '/nodes/no_such_node/label', value: 'x', old_value: null },
        ]),
      }),
    );
    expect(outcome.ok).toBe(false);
    expect(commitDirectAnswer).not.toHaveBeenCalled();
  });
});

describe('applyOperations — after dispatch, "it did not save" stops being a claim we can make', () => {
  it('⛔ a readback that disagrees THROWS — it does not report a failure', async () => {
    const h = harness();
    commitDirectAnswer.mockImplementation(
      async (r: unknown) =>
        ({
          response: r,
          performed: true,
          persisted_row_id: TURN_ROW_ID,
          modelVersionReceipt: null,
          // Says it committed, but the store still holds the OLD graph.
          graphPersisted: true,
        }) as unknown as CommitResult,
    );
    await expect(port(h)(input())).rejects.toBeInstanceOf(ApplyOperationsUnverifiedError);
  });

  it('a commit that reports no graph write THROWS rather than returning ok:false', async () => {
    const h = harness();
    commitDirectAnswer.mockImplementation(
      async (r: unknown, meta: CommitMetadata) =>
        ({
          response: r,
          performed: true,
          persisted_row_id: TURN_ROW_ID,
          modelVersionReceipt: null,
          graphPersisted: false,
          graph: meta.graph,
        }) as unknown as CommitResult,
    );
    await expect(port(h)(input())).rejects.toBeInstanceOf(ApplyOperationsUnverifiedError);
  });

  it('⛔ a stale-write raise from the commit propagates UNCHANGED — the unknown arm', async () => {
    // This is the deployed replay-before-CAS defect reaching the caller. It
    // must NOT be converted into `ok: false`, which would assert the write did
    // not land when the whole point is that it probably did.
    const h = harness();
    const raised = new Error('OLGC1 stale graph write');
    commitDirectAnswer.mockRejectedValue(raised);
    await expect(port(h)(input())).rejects.toBe(raised);
  });

  it('a turn row bound to a different key is unverified, not a success', async () => {
    const h = harness();
    (h.readRecent as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue([
      {
        id: TURN_ROW_ID,
        scenario_id: SCENARIO,
        turn_id: 'some-other-turn',
        request_hash: 'whatever',
        created_at: '2026-09-21T00:00:00.000Z',
        duration_ms: 0,
        turn_class: 'direct_answer',
        user_id: null,
        handler_id: null,
        response_emitted: true,
        llm_calls_used: 0,
      },
    ]);
    await expect(port(h)(input())).rejects.toBeInstanceOf(ApplyOperationsUnverifiedError);
  });

  it('a version receipt describing a DIFFERENT turn is unverified', async () => {
    const h = harness();
    commitDirectAnswer.mockImplementation(async (r: unknown, meta: CommitMetadata) => {
      (h.loadGraph as unknown as { mockResolvedValue: (v: unknown) => void }).mockResolvedValue(meta.graph);
      return {
        response: r,
        performed: true,
        persisted_row_id: TURN_ROW_ID,
        modelVersionReceipt: { version_id: 'v1', source_turn_id: 'a-different-turn', graph: meta.graph },
        graphPersisted: true,
      } as unknown as CommitResult;
    });
    await expect(port(h)(input())).rejects.toBeInstanceOf(ApplyOperationsUnverifiedError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('the store is optional, and omitting it costs nothing until the port is used', () => {
  // WHY THIS EXISTS. `store` became optional so that a caller offering an
  // accept needs no `getSessionStore` import of its own — see the field's
  // docblock for why that is the narrower surface and not a gate dodge. The
  // property that makes it safe is WHERE the fallback resolves: per call,
  // inside the returned function, exactly as `commitDirectAnswer` does at
  // `commit.ts:1121`. Resolve it at construction instead and every suite that
  // builds a port would reach the real accessor, which builds a Supabase
  // client from config. These three assertions are what keeps it per call.

  it('does not touch the accessor at construction', () => {
    createApplyOperations({ scenarioId: SCENARIO, requestId: 'req-lazy' });
    expect(getSessionStore).not.toHaveBeenCalled();
  });

  it('uses an INJECTED store verbatim and never resolves the canonical one', async () => {
    const h = harness();
    await createApplyOperations({ scenarioId: SCENARIO, store: h.store, requestId: 'req-inj' })(
      input(),
    );
    // Bound by identity to the injected double, not by "some store was read":
    // a fallback that silently won would satisfy a bare read-count assertion.
    expect(h.loadGraph).toHaveBeenCalledWith(SCENARIO);
    expect(getSessionStore).not.toHaveBeenCalled();
  });

  it('resolves the canonical store ONCE, on first use, when omitted', async () => {
    const h = harness();
    getSessionStore.mockReturnValue(h.store);
    const run = createApplyOperations({ scenarioId: SCENARIO, requestId: 'req-fallback' });
    expect(getSessionStore).not.toHaveBeenCalled();
    await run(input());
    expect(getSessionStore).toHaveBeenCalledTimes(1);
    expect(h.loadGraph).toHaveBeenCalledWith(SCENARIO);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('currentModelRevision — the server-minted base assertion', () => {
  // WHY THIS EXISTS. The offer side and the accept side must read the SAME
  // source. The adapter re-derives its base from `store.loadGraph`; if an
  // offer minted its token from the request's `extensions.graphState` the two
  // could disagree with nothing having changed, and EVERY accept would refuse
  // with "the model has changed since that was agreed" — a total outage
  // wearing a reasonable sentence. Measured at staging: ingress
  // `c373cbdfb844909d` vs persisted `4dadc7e6510ec272`, and already shipped
  // once as a false GRAPH_DIVERGED. See the field's docblock.
  //
  // ⚠ THESE ASSERT THE ROUND TRIP, NOT THAT MEASUREMENT. The ingress-vs-store
  // divergence is a property of the persist projection and belongs to its own
  // evidence; restating it here would be a second copy of someone else's
  // number — the mirror trap. What is pinned here is the only part this module
  // controls: a token minted by this function is the token the adapter expects.

  it('agrees with the base the adapter itself reads', async () => {
    const h = harness();
    const minted = await currentModelRevision(SCENARIO, { store: h.store });
    expect(minted, 'a real graph mints a real token, never null').not.toBeNull();
    expect(minted).toBe(modelRevisionOf(baseGraph()));
  });

  it('⭐ a minted token is ACCEPTED, and a fabricated one is REFUSED', async () => {
    // Both arms in one test on purpose: the acceptance alone would pass just
    // as well against an adapter that never compares anything.
    const accepted = harness();
    const minted = await currentModelRevision(SCENARIO, { store: accepted.store });
    const ok = await port(accepted)(input({ modelRevision: minted! }));
    expect(ok.ok, JSON.stringify(ok)).toBe(true);

    const refused = harness();
    const no = await port(refused)(input({ modelRevision: 'not-a-revision-this-graph-ever-had' }));
    expect(no.ok).toBe(false);
    expect(no.ok === false ? no.reason : '').toContain('has changed');
  });

  it('cannot be handed a graph — it reads the store, resolving the canonical one when omitted', async () => {
    const h = harness();
    getSessionStore.mockReturnValue(h.store);
    const minted = await currentModelRevision(SCENARIO);
    expect(getSessionStore).toHaveBeenCalledTimes(1);
    expect(h.loadGraph).toHaveBeenCalledWith(SCENARIO);
    expect(minted).toBe(modelRevisionOf(baseGraph()));
  });

  it('⛔ a FAILED read throws — "we could not look" must not arrive as "no model"', async () => {
    // The adapter refuses on a null token. If a transport failure returned
    // null here, a caller minting a base would be told the scenario has no
    // model — the wrong diagnosis, and one that invites creating a second.
    const h = harness({ loadThrows: true });
    await expect(currentModelRevision(SCENARIO, { store: h.store })).rejects.toThrow('transport');
  });
});
