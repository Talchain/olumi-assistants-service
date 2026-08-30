/**
 * ⭐⭐ ROADMAP 2.1266 — `dispatchEditGraph` COMPOSES the option-effect write
 * instead of asking the edit LLM for it.
 *
 * Sibling of `edit-graph-dispatch-wrong-entity-write-withheld.test.ts`, and
 * the pair is the whole row:
 *
 *   - That file pins #1016: a write bound to the WRONG entity is withheld.
 *   - This file pins what #1016 left open: the RIGHT write had no path at all.
 *     `option-intervention-write-guard.ts`'s own header ends "⭐ THE REAL FIX,
 *     rowed and deliberately not built here" — this is that fix.
 *
 * ═══ THE DEFECT, on deployed `293da07` ═══
 * The product's repair copy advises, verbatim, *"Tell me what it changes, like
 * this: Set the <option> option's effect on <factor> to 0.6"*. Sending exactly
 * that returns *"…still has no effect value…"* and writes nothing. P8: the
 * product asked a question whose direct answer it could not accept.
 *
 * ⚠ THE SENTENCE UNDER TEST IS THE WIRE'S OWN (trap 22). `wire.t4_chip_message`
 * in the witness fixture is the advised format as the product actually emitted
 * it on a real turn. A sentence I wrote would test my model of the advised
 * format, not the product's.
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): removing the
 * `preComposedOperations` thread from the `handleEditGraph` call in
 * `edit-graph-dispatch.ts` MUST turn the composition assertions RED, and
 * removing the committed-value re-read MUST turn the acknowledgement
 * assertions RED. The W1 twin at the bottom must stay GREEN through both.
 */

import { readFileSync } from 'node:fs';
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type MockedFunction,
} from 'vitest';
import type { FastifyRequest } from 'fastify';

import { _resetConfigCache } from '../../../config/index.js';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';
import type { PatchOperation } from '../../../orchestrator/types.js';
import { applyPatchOperations } from '../../../orchestrator/patch-applier.js';
import { encodeOptionInterventionsForEdit } from '../../../orchestrator/tools/encode-option-interventions.js';

// ── module-level mocks (same posture as the #1016 sibling) ─────────

vi.mock('../../../orchestrator/tools/edit-graph.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../orchestrator/tools/edit-graph.js')>();
  return {
    ...actual,
    // `parseEditGraphResponse` is deliberately the REAL one: the composed
    // operation must canonicalise through the SAME parser the model's output
    // goes through, and mocking it would make that claim unfalsifiable.
    handleEditGraph: vi.fn(),
    parseEditGraphResponse: vi.fn(actual.parseEditGraphResponse),
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});

// ── imports after mocks ────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph, parseEditGraphResponse } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { formatOptionEffectWriteAck } from '../../routing/option-effect-write.js';
import { GraphStateIngressSchema, type GraphStateIngress } from '../../boundary/request-extensions.js';
import { getAdapter } from '../../../adapters/llm/router.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import type { PendingAction } from '../../session/pending-action.js';
import { buildReadinessRecoveryChip } from '../../coaching/readiness-recovery.js';
import { finalizeChips } from '../../compose/chip-finalizer.js';
import {
  resolveRecordedOptionEffectAnswer,
  type RecordedEffectAnswer,
} from '../../routing/repair-value-binding.js';

// ── the witnessed bytes ────────────────────────────────────────────

interface WitnessFixture {
  readonly ids: {
    readonly scenario_id: string;
    readonly turn_id: string;
    readonly option_id: string;
    readonly option_label: string;
    readonly factor_id: string;
    readonly factor_label: string;
  };
  readonly wire: { readonly t5_user_message: string; readonly t4_chip_message: string };
  readonly draft_graph: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };
  readonly applied_graph_wrong_entity: {
    nodes: Array<Record<string, unknown>>;
    edges: unknown[];
  };
}

const WITNESS = JSON.parse(
  readFileSync(
    new URL(
      '../../__tests__/fixtures/witness-2026-08-17/j4-wrong-entity-write.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as WitnessFixture;

const OPTION_ID = WITNESS.ids.option_id;
const OPTION_LABEL = WITNESS.ids.option_label;
const FACTOR_ID = WITNESS.ids.factor_id;
const FACTOR_LABEL = WITNESS.ids.factor_label;
const ADVISED_SENTENCE = WITNESS.wire.t4_chip_message;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const INGRESS_GRAPH = clone(WITNESS.draft_graph) as unknown as GraphStateIngress;

/** The graph the applier would produce: the effect value on the named option. */
function withOptionEffect(value: number): GraphV3T {
  const g = clone(WITNESS.draft_graph);
  for (const node of g.nodes) {
    if (node.id !== OPTION_ID) continue;
    node.interventions = { [FACTOR_ID]: { value, source: 'user_specified' } };
  }
  return g as unknown as GraphV3T;
}

/** The witnessed WRONG-entity graph: the factor baseline rewritten instead. */
const WRONG_ENTITY_GRAPH = () =>
  clone(WITNESS.applied_graph_wrong_entity) as unknown as GraphV3T;

function appliedResult(graph: GraphV3T | null, operation: Record<string, unknown>): EditGraphResult {
  return {
    blocks: [],
    // Deliberately NULL: the pre-composed path supplies no LLM coaching, so
    // an acknowledgement that appears must have been composed by the
    // dispatcher from the committed graph, not inherited from a fixture.
    assistantText: null,
    latencyMs: 10,
    appliedGraph: graph as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [operation],
    appliedChanges: {
      summary: 'applied',
      changes: [{ label: OPTION_LABEL, description: 'changed.', element_ref: OPTION_ID }],
      rerun_recommended: false,
    },
    operation_meta: [{ impact: 'moderate', rationale: '' }],
  } as unknown as EditGraphResult;
}

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: WITNESS.ids.scenario_id,
    turn_id: WITNESS.ids.turn_id,
    stage: 'frame' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

async function dispatch(message: string, requestId: string, graphState = INGRESS_GRAPH) {
  return dispatchEditGraph({
    payload: makePayload(message),
    requestId,
    request: STUB_REQUEST,
    graphState,
    analysisState: null,
  });
}

const editMock = () => handleEditGraph as MockedFunction<typeof handleEditGraph>;
const commitMock = () => commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;

/** The 6th argument of the ONE `handleEditGraph` call this turn made. */
function editOpts() {
  expect(editMock()).toHaveBeenCalledTimes(1);
  return editMock().mock.calls[0]![5];
}

beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
  vi.clearAllMocks();
  commitMock().mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-test',
    graphPersisted: true,
  } as unknown as Awaited<ReturnType<typeof commitDirectAnswer>>);
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe("ACCEPTANCE 1 — the product's own advised sentence is written deterministically", () => {
  it('hands the edit handler a PRE-COMPOSED intervention operation bound to the ids', async () => {
    editMock().mockResolvedValue(
      appliedResult(withOptionEffect(0.12), { op: 'update_node', path: OPTION_ID }),
    );

    await dispatch(ADVISED_SENTENCE, 'req-2-1266-write');

    const opts = editOpts();
    expect(opts?.preComposedOperations).toHaveLength(1);
    const op = opts!.preComposedOperations![0]!;
    // Identity, never "an operation of the right shape" (trap 19).
    expect(op.op).toBe('update_node');
    expect(op.path).toBe(OPTION_ID);
    expect(Object.keys(op.value as Record<string, unknown>)).toEqual([
      `data/interventions/${FACTOR_ID}`,
    ]);
    expect(
      (op.value as Record<string, Record<string, unknown>>)[`data/interventions/${FACTOR_ID}`]!
        .value,
    ).toBe(0.12);
  });

  it('commits the graph and acknowledges the value the COMMITTED bytes carry (P5)', async () => {
    editMock().mockResolvedValue(
      appliedResult(withOptionEffect(0.12), { op: 'update_node', path: OPTION_ID }),
    );

    const result = await dispatch(ADVISED_SENTENCE, 'req-2-1266-ack');

    expect(commitMock()).toHaveBeenCalledTimes(1);
    // The graph really is persisted — the whole point of the row.
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();

    const ack = formatOptionEffectWriteAck({
      optionLabel: OPTION_LABEL,
      factorLabel: FACTOR_LABEL,
      committedValue: 0.12,
    });
    expect(result.response.assistant_text).toContain(ack);
    // And the readiness the turn stamps is the post-write one: this option is
    // no longer blocked.
    expect(
      result.analysisReady?.options.find((o) => o.option_id === OPTION_ID)?.status,
    ).toBe('ready');
  });

  it('the acknowledgement is NOT claimed when the write did not survive to the graph', async () => {
    // Referee hold, canonicalisation, encoder deferral — any of them leaves the
    // applied graph without the value. A claim then would be exactly the
    // fabrication class P5 forbids, so the pre-existing machinery must answer.
    editMock().mockResolvedValue(
      appliedResult(clone(WITNESS.draft_graph) as unknown as GraphV3T, {
        op: 'update_node',
        path: OPTION_ID,
      }),
    );

    const result = await dispatch(ADVISED_SENTENCE, 'req-2-1266-nolanding');

    expect(result.response.assistant_text).not.toContain('now has an effect value');
  });

  it('claims NOTHING when the committed value differs from the requested one', async () => {
    // ⚠ NAME CORRECTED (F1 lane) — the old title said "acknowledges the
    // COMMITTED value", which the branch does not do: on a divergence
    // `edit-graph-dispatch.ts` logs `option_effect_write_did_not_land` and
    // composes NO acknowledgement, leaving the pre-existing machinery to
    // answer. Behaviour is unchanged here; only the title, which asserted a
    // capability the code does not ship.
    //
    // The pipeline can rewrite a value (encoder normalisation). The
    // acknowledgement is read back from the graph, so a divergence must NOT
    // produce a sentence about the number the user typed.
    editMock().mockResolvedValue(
      appliedResult(withOptionEffect(0.5), { op: 'update_node', path: OPTION_ID }),
    );

    const result = await dispatch(ADVISED_SENTENCE, 'req-2-1266-divergent');

    expect(result.response.assistant_text).not.toContain('effect value of 0.12');
    // …and nothing about the COMMITTED value either — the branch composes no
    // acknowledgement at all. Without this the renamed title would be as
    // unpinned as the old one (trap 14: a label must be evidenced).
    expect(result.response.assistant_text).not.toContain('now has an effect value');
  });
});

describe('ACCEPTANCE 2 — the wrong-entity shape is untouched by this path', () => {
  it('the witnessed factor-baseline write is still WITHHELD (#1016 unchanged)', async () => {
    editMock().mockResolvedValue(
      appliedResult(WRONG_ENTITY_GRAPH(), {
        op: 'update_node',
        path: FACTOR_ID,
        value: { observed_state: { value: 0.12 } },
      }),
    );

    // The witnessed user sentence DOES bind, so the deterministic path claims
    // it — but this test stubs the handler to return the wrong-entity graph
    // anyway, which is the state #1016 exists for. The guard must still fire.
    await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-withheld');

    expect(commitMock()).toHaveBeenCalledTimes(1);
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
  });
});

describe('ACCEPTANCE 3 — an explicit factor-BASELINE edit keeps the LLM path', () => {
  it('the W1 shape composes NO operation — the edit handler is asked, as today', async () => {
    editMock().mockResolvedValue(appliedResult(null, { op: 'update_node', path: FACTOR_ID }));

    const w1 =
      `For the ${OPTION_LABEL} option, our ${FACTOR_LABEL} assumption is stale — `
      + `change ${FACTOR_LABEL} to 0.3.`;
    await dispatch(w1, 'req-2-1266-w1');

    expect(editOpts()?.preComposedOperations).toBeUndefined();
  });

  it('OPPOSITE-DIRECTION TWIN — the effect-framed sentence on the same pair IS composed', async () => {
    editMock().mockResolvedValue(
      appliedResult(withOptionEffect(0.3), { op: 'update_node', path: OPTION_ID }),
    );

    await dispatch(
      `Set the ${OPTION_LABEL} option's effect on ${FACTOR_LABEL} to 0.3.`,
      'req-2-1266-w1-twin',
    );

    expect(editOpts()?.preComposedOperations).toHaveLength(1);
  });
});

describe('ACCEPTANCE 5 — delete-then-configure on a surviving option', () => {
  it('composes the write against the POST-DELETE graph, by the same ids', async () => {
    const g = clone(WITNESS.draft_graph);
    const removed = new Set(
      g.nodes.filter((n) => n.kind === 'option' && n.id !== OPTION_ID).map((n) => n.id as string),
    );
    g.nodes = g.nodes.filter((n) => !removed.has(n.id as string));
    g.edges = g.edges.filter((e) => !removed.has(e.from as string) && !removed.has(e.to as string));
    // Positive control: the deletes really happened.
    expect(g.nodes.filter((n) => n.kind === 'option')).toHaveLength(1);

    editMock().mockResolvedValue(
      appliedResult(withOptionEffect(0.12), { op: 'update_node', path: OPTION_ID }),
    );

    await dispatch(
      ADVISED_SENTENCE,
      'req-2-1266-postdelete',
      g as unknown as GraphStateIngress,
    );

    const opts = editOpts();
    expect(opts?.preComposedOperations).toHaveLength(1);
    expect(opts!.preComposedOperations![0]!.path).toBe(OPTION_ID);
  });
});

describe('the deterministic path does not widen beyond the edit lane it replaces', () => {
  it('a NON-canonical ingress graph keeps the LLM path (strict-parse gate)', async () => {
    editMock().mockResolvedValue(appliedResult(null, { op: 'update_node', path: OPTION_ID }));

    const broken = clone(WITNESS.draft_graph);
    // Break one edge's required fields — the same non-strict shape the
    // deterministic add_risk path also refuses to run against.
    broken.edges.push({ from: OPTION_ID, to: FACTOR_ID } as Record<string, unknown>);

    await dispatch(ADVISED_SENTENCE, 'req-2-1266-nonstrict', broken as unknown as GraphStateIngress);

    expect(editOpts()?.preComposedOperations).toBeUndefined();
  });

  it('an ordinary structural edit is untouched', async () => {
    editMock().mockResolvedValue(appliedResult(null, { op: 'add_node', path: 'fac_new' }));

    await dispatch('Add a factor for driver retention.', 'req-2-1266-structural');

    expect(editOpts()?.preComposedOperations).toBeUndefined();
  });
});

describe('recorded missing-effect answer survives the dispatcher boundary by identity', () => {
  const DUPLICATE_OPTION_ID = '862169d7';
  const MESSAGE = 'Set it to about 0.9.';

  function duplicateLabelGraph(): GraphStateIngress {
    const graph = clone(WITNESS.draft_graph);
    const other = graph.nodes.find((node) => node.id === DUPLICATE_OPTION_ID);
    expect(other).toBeDefined();
    other!.label = OPTION_LABEL;
    expect(graph.nodes.filter((node) => node.label === OPTION_LABEL)).toHaveLength(2);
    return graph as unknown as GraphStateIngress;
  }

  function recordedAnswer(graph: GraphStateIngress): RecordedEffectAnswer {
    const now = Date.now();
    const graphHash = computeAnalysisAffectingGraphHash(graph);
    if (graphHash === null) throw new Error('Recorded-answer fixture did not hash');
    const pending: PendingAction = {
      id: '00000000-0000-4000-8000-000000000001',
      scenario_id: WITNESS.ids.scenario_id,
      chip_id: 'chip_configure_option_clarify',
      action: {
        kind: 'elicit_option_effect', option_id: OPTION_ID, option_label: OPTION_LABEL,
        factor_id: FACTOR_ID, factor_label: FACTOR_LABEL,
      },
      preconditions: { graph_hash: graphHash },
      emitted_at_iso: new Date(now).toISOString(),
      expires_at_iso: new Date(now + 600000).toISOString(),
      expires_at_turn_count: 2,
    };
    const run: PendingAction = {
      ...pending, id: '00000000-0000-4000-8000-000000000002',
      chip_id: 'chip_run_analysis', action: { kind: 'run_analysis' },
    };
    const resolution = resolveRecordedOptionEffectAnswer({
      message: MESSAGE, graph, pendings: [pending, run],
      readiness: buildCanonicalAnalysisReadyFromGraph(graph),
      scenarioId: WITNESS.ids.scenario_id, nowMs: now,
    });
    expect(resolution.kind).toBe('bind');
    if (resolution.kind !== 'bind') throw new Error('Recorded-answer fixture did not bind');
    return resolution.answer;
  }

  function appliedAskedGraph(graph: GraphStateIngress, value: number): GraphV3T {
    const changed = clone(graph);
    const option = changed.nodes.find((node) => node.id === OPTION_ID)!;
    option.interventions = { [FACTOR_ID]: { value, source: 'user_specified' } };
    return changed as unknown as GraphV3T;
  }

  function dispatchRecorded(graph: GraphStateIngress, answer: RecordedEffectAnswer, message = MESSAGE) {
    return dispatchEditGraph({
      payload: makePayload(message), requestId: 'req-recorded-effect', request: STUB_REQUEST,
      graphState: graph, analysisState: null, recordedEffectAnswer: answer,
    });
  }

  it('uses the real parser and exact asked cell despite duplicate labels; consumes only that question', async () => {
    const graph = duplicateLabelGraph();
    const answer = recordedAnswer(graph);
    editMock().mockResolvedValue(appliedResult(appliedAskedGraph(graph, 0.9), {
      op: 'update_node', path: OPTION_ID,
    }));

    const result = await dispatchRecorded(graph, answer);

    expect(parseEditGraphResponse).toHaveBeenCalled();
    const operation = editOpts()?.preComposedOperations?.[0];
    expect(operation).toMatchObject({ op: 'update_node', path: OPTION_ID });
    expect(operation?.value).toEqual({
      [`data/interventions/${FACTOR_ID}`]: { value: 0.9 },
    });
    const commit = commitMock().mock.calls[0]![1];
    expect(commit.graph).toBeDefined();
    const committed = GraphV3.parse(commit.graph);
    const before = GraphV3.parse(graph);
    expect(commit.consumedPendingRefs).toEqual([answer.pending.chip_id]);
    expect(commit.priorPendingActions).toEqual(answer.priorPendingActions);
    expect(committed.nodes.find((node) => node.id === FACTOR_ID)).toEqual(
      before.nodes.find((node) => node.id === FACTOR_ID),
    );
    expect(committed.nodes.find((node) => node.id === DUPLICATE_OPTION_ID)).toEqual(
      before.nodes.find((node) => node.id === DUPLICATE_OPTION_ID),
    );
    expect(result.response.assistant_text).toContain('effect value of 0.9');
  });

  it('recomputes the operation from durable question plus message, never trusting supplied derived fields', async () => {
    const graph = duplicateLabelGraph();
    const answer = recordedAnswer(graph);
    const forged: RecordedEffectAnswer = {
      ...answer, valueText: '0.2', instruction: 'Set the factor baseline to 0.2.',
      pair: { ...answer.pair, optionId: DUPLICATE_OPTION_ID },
    };
    editMock().mockResolvedValue(appliedResult(appliedAskedGraph(graph, 0.9), {
      op: 'update_node', path: OPTION_ID,
    }));

    await dispatchRecorded(graph, forged);

    const operation = editOpts()?.preComposedOperations?.[0];
    expect(operation?.path).toBe(OPTION_ID);
    expect(operation?.value).toEqual({
      [`data/interventions/${FACTOR_ID}`]: { value: 0.9 },
    });
  });

  it('the exact precomposed operation survives the real applier, encoder, and JSON readback', async () => {
    const graph = duplicateLabelGraph();
    const answer = recordedAnswer(graph);
    const base = GraphV3.parse(graph);
    editMock().mockImplementation(async (_context, _instruction, _adapter, _requestId, _turnId, options) => {
      expect(options?.preComposedOperations).toHaveLength(1);
      const operations = [...options!.preComposedOperations!] as PatchOperation[];
      const applied = applyPatchOperations(base, operations);
      const encoded = encodeOptionInterventionsForEdit(applied, new Set([OPTION_ID]));
      expect(encoded.unresolvedOptionIds).toEqual([]);
      return appliedResult(encoded.graph, { ...operations[0]! });
    });

    await dispatchRecorded(graph, answer);

    const commit = commitMock().mock.calls[0]![1];
    expect(commit.graph).toBeDefined();
    const reloaded = GraphV3.parse(clone(commit.graph));
    expect(reloaded.nodes.find((node) => node.id === OPTION_ID)?.interventions?.[FACTOR_ID])
      .toMatchObject({ value: 0.9 });
    expect(reloaded.nodes.find((node) => node.id === FACTOR_ID)).toEqual(
      base.nodes.find((node) => node.id === FACTOR_ID),
    );
    expect(reloaded.nodes.find((node) => node.id === DUPLICATE_OPTION_ID)).toEqual(
      base.nodes.find((node) => node.id === DUPLICATE_OPTION_ID),
    );
    expect(commit.consumedPendingRefs).toEqual([answer.pending.chip_id]);
    const readiness = buildCanonicalAnalysisReadyFromGraph(reloaded);
    expect(readiness?.options.find((option) => option.option_id === OPTION_ID)?.status).toBe('ready');
    expect(readiness?.options.find((option) => option.option_id === DUPLICATE_OPTION_ID)?.status)
      .not.toBe('ready');
  });

  it.each([false, true])('arms the next asked cell only if its recovery chip survives real finalization (duplicate=%s)', async (duplicate) => {
    const graph: GraphStateIngress = {
      goal_node_id: 'goal',
      nodes: [
        { id: 'decision', kind: 'decision', label: 'Delivery approach' },
        { id: 'goal', kind: 'goal', label: 'Protect margin' },
        { id: OPTION_ID, kind: 'option', label: OPTION_LABEL },
        { id: DUPLICATE_OPTION_ID, kind: 'option', label: 'Other courier' },
        { id: FACTOR_ID, kind: 'factor', label: FACTOR_LABEL },
      ],
      edges: [['decision', OPTION_ID], ['decision', DUPLICATE_OPTION_ID],
        [OPTION_ID, FACTOR_ID], [DUPLICATE_OPTION_ID, FACTOR_ID], [FACTOR_ID, 'goal']]
        .map(([from, to]) => ({
          from: from!, to: to!, strength: { mean: 0.5, std: 0.1 },
          exists_probability: 1, effect_direction: 'positive',
        })),
    };
    const answer = recordedAnswer(graph);
    const applied = appliedAskedGraph(graph, 0.9);
    const readiness = buildCanonicalAnalysisReadyFromGraph(applied);
    expect(readiness?.status).toBe('needs_user_input');
    const recovery = buildReadinessRecoveryChip(readiness);
    expect(recovery?.id).toBe('chip_prompt_repair_effect_value');
    const result = appliedResult(applied, { op: 'update_node', path: OPTION_ID });
    editMock().mockResolvedValue({
      ...result,
      suggestedActions: [{
        label: 'Continue considering the model',
        prompt: duplicate ? recovery!.message : 'Discuss the remaining delivery risks.',
        role: 'facilitator',
      }],
    });

    const dispatched = await dispatchRecorded(graph, answer);

    // The dispatcher returns pre-egress chips. Invoke the actual shared
    // finalizer to assert what survives, not a hand-maintained budget mirror.
    const final = finalizeChips(dispatched.response.suggested_actions, { logSuppressions: false });
    expect(final.chips.some((chip) => chip.id === recovery!.id)).toBe(!duplicate);
    if (duplicate) expect(final.report.deduped).toBe(1);
    const commit = commitMock().mock.calls[0]![1];
    const nextAsks = (commit.pending_actions ?? []).filter((pending) => pending.action.kind === 'elicit_option_effect');
    expect(nextAsks).toHaveLength(duplicate ? 0 : 1);
    if (!duplicate) {
      expect(nextAsks[0]?.action).toMatchObject({
        kind: 'elicit_option_effect', option_id: DUPLICATE_OPTION_ID, factor_id: FACTOR_ID,
      });
      expect(nextAsks[0]?.preconditions.graph_hash).toBe(
        computeAnalysisAffectingGraphHash(GraphStateIngressSchema.parse(commit.graph)),
      );
    }
    expect(commit.consumedPendingRefs).toEqual([answer.pending.chip_id]);
  });

  it.each(['no applied graph', 'no target value', 'different target value', 'wrong entity'] as const)(
    'does not consume the recorded question when %s reaches the commit boundary', async (mode) => {
      const graph = duplicateLabelGraph();
      const answer = recordedAnswer(graph);
      const applied = mode === 'no applied graph' ? null
        : mode === 'no target value' ? graph as unknown as GraphV3T
          : mode === 'different target value' ? appliedAskedGraph(graph, 0.2)
            : WRONG_ENTITY_GRAPH();
      editMock().mockResolvedValue(appliedResult(applied, {
        op: 'update_node', path: mode === 'wrong entity' ? FACTOR_ID : OPTION_ID,
      }));

      const result = await dispatchRecorded(graph, answer);

      expect(commitMock()).toHaveBeenCalledTimes(1);
      expect(commitMock().mock.calls[0]![1].consumedPendingRefs).toBeUndefined();
      expect(commitMock().mock.calls[0]![1].priorPendingActions).toEqual(answer.priorPendingActions);
      expect(result.response.assistant_text).not.toContain('effect value of 0.9');
      if (mode === 'wrong entity') expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
    },
  );

  it.each(['invalid value', 'stale graph', 'expired pending', 'invalid strict graph'] as const)(
    'rejects a direct %s carrier before asking any adapter or writing', async (mode) => {
      const graph = duplicateLabelGraph();
      let answer = recordedAnswer(graph);
      if (mode === 'stale graph') graph.nodes.push({
        id: 'new-canonical-factor', kind: 'factor', label: 'New canonical factor',
      });
      if (mode === 'expired pending') {
        const expired = { ...answer.pending, expires_at_turn_count: 0 };
        answer = { ...answer, priorPendingActions: [expired] };
      }
      if (mode === 'invalid strict graph') {
        graph.edges.push({ from: OPTION_ID, to: FACTOR_ID } as GraphStateIngress['edges'][number]);
      }

      await expect(dispatchRecorded(graph, answer, mode === 'invalid value' ? '20' : MESSAGE))
        .rejects.toThrow('Recorded option-effect answer no longer matches');

      expect(getAdapter).not.toHaveBeenCalled();
      expect(handleEditGraph).not.toHaveBeenCalled();
      expect(commitDirectAnswer).not.toHaveBeenCalled();
    },
  );
});
