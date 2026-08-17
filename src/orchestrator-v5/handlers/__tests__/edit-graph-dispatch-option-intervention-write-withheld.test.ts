/**
 * ⭐⭐ ROADMAP 2.1266 (D1b) — `dispatchEditGraph` must not COMMIT a wrong-entity
 * write behind a reply that says the option's effect value is still unset.
 *
 * Sibling of `edit-graph-dispatch-configure-option-outcome.test.ts`, and the
 * distinction between the two files IS the residual defect that shipped:
 *
 *   - That file pins the 2.427 guard, which REPLACES THE TEXT on branch (b)
 *     ("something landed for a DIFFERENT entity").
 *   - This file pins what 2.427 never did: WITHHOLD THE WRITE. Until this
 *     change the honest text shipped on top of a persisted wrong mutation.
 *
 * THE WITNESSED TURN, deployed CEE `8be62df`
 * (`olumi-docs/witness-acceptance-2026-08-17/`, scenario
 * `289c2690-f605-4f3c-8e43-465b339fda1e`, J4 t5, turn
 * `4a43edef-603a-4777-8deb-cce556ed363f`):
 *
 *   REQUEST  "For the subcontracting inner-city deliveries to a green courier
 *            option, set the effect value on Subcontractor cost as share of
 *            affected-route revenue to 0.12 — a share, no unit."
 *   FACT     `edit_kind: parameter_update`, `status: applied`,
 *            `affected_entities: [{ kind: "factor", … }]`
 *   RELOAD   factor `49a2b80b` `observed_state { value: 0.12, source:
 *            "user_override" }`; option `21ea9b80` `interventions: {}`
 *   REPLY    byte-identical to the previous turn's refusal — "…still has no
 *            effect value … open it on the canvas…"
 *
 * ⚠ FIXTURES ARE THE WIRE'S, NOT MINE (trap 16). The message and the pre-edit
 * graph are copied verbatim from the captures into
 * `../../__tests__/fixtures/witness-2026-08-17/`; the applied graph is the
 * reload's own post-edit state reconstructed on that base. Historic record —
 * append, never edit (trap 14b).
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): removing
 * `decideOptionInterventionWrite` from the `effectiveAppliedMutation`
 * conjunction MUST turn the withhold assertions below red.
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

// ── module-level mocks (same posture as the 2.427 sibling) ──────────

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

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
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// ── the witnessed bytes ────────────────────────────────────────────

const WIRE = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-wire-strings.json', import.meta.url),
    'utf8',
  ),
) as { j4_t5_user_message: string; j4_t4_chip_message: string };

const DRAFT_GRAPH = JSON.parse(
  readFileSync(
    new URL('../../__tests__/fixtures/witness-2026-08-17/j4-draft-graph.json', import.meta.url),
    'utf8',
  ),
) as { nodes: Array<Record<string, unknown>>; edges: unknown[] };

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const OPTION_ID = '21ea9b80';
const FACTOR_ID = '49a2b80b';
const OPTION_LABEL = 'subcontracting inner-city deliveries to a green courier';
const FACTOR_LABEL = 'Subcontractor cost as share of affected-route revenue';

const SCENARIO_ID = '289c2690-f605-4f3c-8e43-465b339fda1e';
const TURN_ID = '4a43edef-603a-4777-8deb-cce556ed363f';

const INGRESS_GRAPH = DRAFT_GRAPH as unknown as GraphStateIngress;

/** The reload's own post-edit state: the FACTOR baseline rewritten. */
function withFactorBaseline(value: number): GraphV3T {
  const g = clone(DRAFT_GRAPH);
  for (const node of g.nodes) {
    if (node.id !== FACTOR_ID) continue;
    node.observed_state = { value, source: 'user_override' };
    node.display_value = String(value);
  }
  return g as unknown as GraphV3T;
}

/** What the user actually asked for: the effect value on the OPTION. */
function withOptionEffect(value: number): GraphV3T {
  const g = clone(DRAFT_GRAPH);
  for (const node of g.nodes) {
    if (node.id !== OPTION_ID) continue;
    node.interventions = { [FACTOR_ID]: { value, source: 'user_override' } };
  }
  return g as unknown as GraphV3T;
}

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'frame' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

/** The witnessed applied result: a factor-baseline `parameter_update`. */
function factorBaselineAppliedResult(): EditGraphResult {
  return {
    blocks: [],
    // The witnessed fact's own `safe_summary`.
    assistantText: 'Updated Subcontractor cost as share of affected-route revenue',
    latencyMs: 1000,
    appliedGraph: withFactorBaseline(0.12) as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [
      {
        op: 'update_node',
        path: FACTOR_ID,
        value: { observed_state: { value: 0.12, source: 'user_override' } },
      },
    ],
    appliedChanges: {
      summary: 'Updated Subcontractor cost as share of affected-route revenue',
      changes: [
        {
          label: FACTOR_LABEL,
          description: '0.5 → 0.12.',
          element_ref: FACTOR_ID,
        },
      ],
      rerun_recommended: false,
    },
    operation_meta: [{ impact: 'low', rationale: '' }],
  } as unknown as EditGraphResult;
}

/** The honest success shape: the effect value on the option the user named. */
function optionEffectAppliedResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: `Set the effect of "${OPTION_LABEL}" on ${FACTOR_LABEL} to 0.12.`,
    latencyMs: 1000,
    appliedGraph: withOptionEffect(0.12) as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [
      {
        op: 'update_node',
        path: OPTION_ID,
        value: { data: { interventions: { [FACTOR_ID]: 0.12 } } },
      },
    ],
    appliedChanges: {
      summary: `Configured ${OPTION_LABEL}.`,
      changes: [
        {
          label: OPTION_LABEL,
          description: `${FACTOR_LABEL} set to 0.12.`,
          element_ref: OPTION_ID,
        },
      ],
      rerun_recommended: true,
    },
    operation_meta: [{ impact: 'medium', rationale: '' }],
  } as unknown as EditGraphResult;
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-test',
    graphPersisted: true,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

// Graph-management mode 'off' — the mode in which the existing path proceeds
// byte-identically, so the seam under test is reached unchanged (same premise,
// stated for the same reason, as the persistence sibling).
beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
  vi.clearAllMocks();
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
    makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>,
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('dispatchEditGraph — 2.1266 the wrong-entity write is withheld (J4 t5 replay)', () => {
  it('RED→GREEN: the witnessed factor-baseline write is NOT committed', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );

    await dispatchEditGraph({
      payload: makePayload(WIRE.j4_t5_user_message),
      requestId: 'req-2-1266-witness',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    expect(commitMock).toHaveBeenCalledTimes(1);
    const metadata = commitMock.mock.calls[0]![1];
    // The whole defect in one assertion: on `8be62df` this was DEFINED and the
    // factor moved 0.5 → 0.12 in `scenarios.graph`, guest-readable at reload,
    // while the reply said the link was still carrying nothing.
    expect(metadata.graph).toBeUndefined();
  });

  it('the receipt FACT is withheld with the write — a non-mutating turn emits none', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    await dispatchEditGraph({
      payload: makePayload(WIRE.j4_t5_user_message),
      requestId: 'req-2-1266-fact',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });
    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    const metadata = commitMock.mock.calls[0]![1];
    // A committed `parameter_update` fact would ground the NEXT turn's model on
    // an edit no persisted graph carries (the DL-7 hazard the goal-target
    // withhold names explicitly).
    expect(metadata.handler_facts).toEqual([]);
  });

  it('the reply and the returned graph agree with the withhold', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    const out = await dispatchEditGraph({
      payload: makePayload(WIRE.j4_t5_user_message),
      requestId: 'req-2-1266-wire',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });
    // The 2.427 recovery copy still owns the text — and it is now TRUE.
    expect(out.response.assistant_text).toContain(OPTION_LABEL);
    expect(out.response.assistant_text).toContain(FACTOR_LABEL);
    // No success narration survives.
    expect(out.response.assistant_text).not.toContain('Updated Subcontractor cost');
    // The wire must not ship the mutation the store did not keep.
    expect(out.graph ?? null).toBeNull();
  });

  it('L16 gate-reason integrity: the blocker SURVIVES the withheld turn (not dropped to generic)', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    const out = await dispatchEditGraph({
      payload: makePayload(WIRE.j4_t5_user_message),
      requestId: 'req-2-1266-readiness',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });
    // Derived from the PRE-edit graph — the one that stays persisted — so the
    // specific "no effect value" reason is still available to the gate copy.
    expect(out.analysisReady).toBeDefined();
    const blockers = (out.analysisReady?.blockers ?? []) as Array<Record<string, unknown>>;
    // NOTE the discriminator: the CANONICAL payload spells this
    // `blocker_type: 'missing_value'`; the wire projection spells it
    // `code: 'MISSING_OPTION_VALUE'`. Asserting the canonical one here is
    // deliberate — this is the in-process payload the dispatcher returns.
    expect(
      blockers.some(
        (b) =>
          b.blocker_type === 'missing_value' &&
          b.option_id === OPTION_ID &&
          b.factor_id === FACTOR_ID,
      ),
    ).toBe(true);
  });

  it("the product's OWN repair chip message gets the same protection", async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    await dispatchEditGraph({
      payload: makePayload(WIRE.j4_t4_chip_message),
      requestId: 'req-2-1266-chip',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });
    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    expect(commitMock.mock.calls[0]![1].graph).toBeUndefined();
  });
});

describe('opposite-direction control — a withhold that eats a real edit is a NEW harm', () => {
  it('the effect value landing on the named option COMMITS, byte-for-byte as before', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      optionEffectAppliedResult(),
    );
    const out = await dispatchEditGraph({
      payload: makePayload(WIRE.j4_t5_user_message),
      requestId: 'req-2-1266-honoured',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });
    const commitMock = commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;
    const metadata = commitMock.mock.calls[0]![1];
    expect(metadata.graph).toBeDefined();
    expect(out.graph).not.toBeNull();
    // And the honest success narration is preserved.
    expect(out.response.assistant_text).toContain('0.12');
  });
});
