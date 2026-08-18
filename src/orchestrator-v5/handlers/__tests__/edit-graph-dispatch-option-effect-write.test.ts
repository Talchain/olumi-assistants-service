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
import type { GraphV3T } from '../../../schemas/cee-v3.js';

// ── module-level mocks (same posture as the #1016 sibling) ─────────

vi.mock('../../../orchestrator/tools/edit-graph.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../orchestrator/tools/edit-graph.js')>();
  return {
    ...actual,
    // `parseEditGraphResponse` is deliberately the REAL one: the composed
    // operation must canonicalise through the SAME parser the model's output
    // goes through, and mocking it would make that claim unfalsifiable.
    handleEditGraph: vi.fn(),
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
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { formatOptionEffectWriteAck } from '../../routing/option-effect-write.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

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

  it('acknowledges the COMMITTED value even when it differs from the requested one', async () => {
    // The pipeline can rewrite a value (encoder normalisation). The
    // acknowledgement is read back from the graph, so a divergence must NOT
    // produce a sentence about the number the user typed.
    editMock().mockResolvedValue(
      appliedResult(withOptionEffect(0.5), { op: 'update_node', path: OPTION_ID }),
    );

    const result = await dispatch(ADVISED_SENTENCE, 'req-2-1266-divergent');

    expect(result.response.assistant_text).not.toContain('effect value of 0.12');
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
