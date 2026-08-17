/**
 * ⭐⭐ ROADMAP 2.1266 — `dispatchEditGraph` must not COMMIT a wrong-entity write
 * behind a reply that says the option's effect value is still unset.
 *
 * Sibling of `edit-graph-dispatch-configure-option-outcome.test.ts`, and the
 * distinction between the two files IS the residual defect:
 *
 *   - That file pins the 2.427 guard, which REPLACES THE TEXT on branch (b)
 *     ("something landed for a DIFFERENT entity").
 *   - This file pins what 2.427 never did: WITHHOLD THE WRITE. Without it the
 *     honest text ships on top of a persisted wrong mutation.
 *
 * ═══ THE WITNESSED TURN — deployed CEE `8be62df`, wire-level ═══
 * `olumi-docs/witness-acceptance-2026-08-17/captures/`, scenario
 * `289c2690-f605-4f3c-8e43-465b339fda1e`, J4 turn 5:
 *
 *   REQUEST  "For the subcontracting inner-city deliveries to a green courier
 *            option, set the effect value on Subcontractor cost as share of
 *            affected-route revenue to 0.12 — a share, no unit."
 *   REPLY    byte-identical to the previous turn's refusal — "…still has no
 *            effect value on Subcontractor cost as share of affected-route
 *            revenue, so that link is not carrying anything yet…"
 *   RELOAD   (`j6-reload-J4.json`) factor `49a2b80b`
 *            `observed_state { value: 0.12, source: "user_override" }`, while
 *            option `21ea9b80` still carries `interventions: {}`.
 *
 * So the FACTOR BASELINE every option reads was silently rewritten, the effect
 * value the user asked for was not, the blocker never retired, and the reply
 * denied that anything had happened.
 *
 * ⚠ THE FIXTURE IS THE WIRE'S, NOT MINE (trap 16). Both graphs and both
 * messages are generated from those captures — see the fixture's own
 * `__provenance__` field for the exact source file and transformation of each.
 * Historic record: append, never edit (trap 14b).
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): removing
 * `!optionInterventionWriteWithheld` from the `effectiveAppliedMutation`
 * conjunction in `edit-graph-dispatch.ts` MUST turn the withhold assertions
 * below red. The opposite-direction twin at the bottom must stay GREEN through
 * that mutation and RED if the withhold is widened to swallow a real edit.
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
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
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
  readonly draft_graph: { nodes: Array<Record<string, unknown>>; edges: unknown[] };
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

const { option_id: OPTION_ID, factor_id: FACTOR_ID } = WITNESS.ids;
const OPTION_LABEL = WITNESS.ids.option_label;
const FACTOR_LABEL = WITNESS.ids.factor_label;

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const PRE_EDIT_GRAPH = () => clone(WITNESS.draft_graph) as unknown as GraphV3T;
const INGRESS_GRAPH = clone(WITNESS.draft_graph) as unknown as GraphStateIngress;

/** The reload's own post-edit state: the FACTOR baseline rewritten. */
const WRONG_ENTITY_GRAPH = () =>
  clone(WITNESS.applied_graph_wrong_entity) as unknown as GraphV3T;

/** What the user actually asked for: the effect value on the OPTION. */
function withOptionEffect(value: number): GraphV3T {
  const g = clone(WITNESS.draft_graph);
  for (const node of g.nodes) {
    if (node.id !== OPTION_ID) continue;
    node.interventions = { [FACTOR_ID]: { value, source: 'user_override' } };
  }
  return g as unknown as GraphV3T;
}

/** A STRUCTURAL-only write: a rename. No baseline moved, no effect value set. */
function withRenamedFactor(label: string): GraphV3T {
  const g = clone(WITNESS.draft_graph);
  for (const node of g.nodes) {
    if (node.id !== FACTOR_ID) continue;
    node.label = label;
  }
  return g as unknown as GraphV3T;
}

/**
 * The wrong-entity write PLUS a rename of the same factor. Still withheld (a
 * baseline moved, no effect value landed for any option) — and the rename is
 * what makes the two candidate graphs produce DIFFERENT recovery copy, so a
 * composer reading the unpersisted graph names a label nobody will ever see.
 */
function wrongEntityGraphWithRename(label: string): GraphV3T {
  const g = clone(WITNESS.applied_graph_wrong_entity);
  for (const node of g.nodes) {
    if (node.id !== FACTOR_ID) continue;
    node.label = label;
  }
  return g as unknown as GraphV3T;
}

/**
 * The wrong-entity write PLUS a newly ADDED, unconfigured option. Still
 * withheld (a NEW node is not a baseline rewrite, and a fresh option carries no
 * effect values) — and the extra unconfigured option changes the readiness
 * issue COUNT, so run admission differs between the two candidate graphs.
 */
function wrongEntityGraphWithExtraOption(): GraphV3T {
  const g = clone(WITNESS.applied_graph_wrong_entity);
  g.nodes.push({
    id: 'opt_added_by_edit',
    kind: 'option',
    label: 'An option this edit invented',
    provenance: 'ai_inferred',
  });
  (g.edges as Array<Record<string, unknown>>).push({
    from: 'opt_added_by_edit',
    to: FACTOR_ID,
    strength: { mean: 0.5, std: 0.01 },
    exists_probability: 0.9,
    effect_direction: 'positive',
  });
  return g as unknown as GraphV3T;
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

function appliedResult(opts: {
  readonly graph: GraphV3T;
  readonly assistantText: string;
  readonly operation: Record<string, unknown>;
  readonly changeLabel: string;
  readonly changeRef: string;
}): EditGraphResult {
  return {
    blocks: [],
    assistantText: opts.assistantText,
    latencyMs: 1000,
    appliedGraph: opts.graph as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [opts.operation],
    appliedChanges: {
      summary: opts.assistantText,
      changes: [
        { label: opts.changeLabel, description: 'changed.', element_ref: opts.changeRef },
      ],
      rerun_recommended: false,
    },
    operation_meta: [{ impact: 'low', rationale: '' }],
  } as unknown as EditGraphResult;
}

/** The witnessed applied result: a factor-baseline `parameter_update`. */
const factorBaselineAppliedResult = (): EditGraphResult =>
  appliedResult({
    graph: WRONG_ENTITY_GRAPH(),
    // The witnessed fact's own `safe_summary`.
    assistantText: `Updated ${FACTOR_LABEL}`,
    operation: {
      op: 'update_node',
      path: FACTOR_ID,
      value: { observed_state: { value: 0.12, source: 'user_override' } },
    },
    changeLabel: FACTOR_LABEL,
    changeRef: FACTOR_ID,
  });

/** The honest success shape: the effect value on the option the user named. */
const optionEffectAppliedResult = (): EditGraphResult =>
  appliedResult({
    graph: withOptionEffect(0.12),
    assistantText: `Set the effect of "${OPTION_LABEL}" on ${FACTOR_LABEL} to 0.12.`,
    operation: {
      op: 'update_node',
      path: OPTION_ID,
      value: { data: { interventions: { [FACTOR_ID]: 0.12 } } },
    },
    changeLabel: OPTION_LABEL,
    changeRef: OPTION_ID,
  });

/** A structural-only edit on the same turn: nothing about any value. */
const renameAppliedResult = (): EditGraphResult =>
  appliedResult({
    graph: withRenamedFactor('Subcontractor cost share'),
    assistantText: 'Renamed the factor.',
    operation: { op: 'update_node', path: FACTOR_ID, value: { label: 'Subcontractor cost share' } },
    changeLabel: FACTOR_LABEL,
    changeRef: FACTOR_ID,
  });

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-test',
    graphPersisted: true,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

async function dispatch(message: string, requestId: string) {
  return dispatchEditGraph({
    payload: makePayload(message),
    requestId,
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
}

const commitMock = () => commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>;

// Graph-management mode 'off' — the mode in which the existing path proceeds
// byte-identically, so the seam under test is reached unchanged (same premise,
// stated for the same reason, as the 2.427 sibling).
beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
  vi.clearAllMocks();
  commitMock().mockResolvedValue(
    makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>,
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('2.1266 — the wrong-entity write is withheld (J4 t5 wire replay)', () => {
  it('the witnessed factor-baseline write is NOT committed', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );

    await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-witness');

    expect(commitMock()).toHaveBeenCalledTimes(1);
    const metadata = commitMock().mock.calls[0]![1];
    // The whole defect in one assertion: on `8be62df` this was DEFINED and the
    // factor moved 0.5 → 0.12 in `scenarios.graph`, guest-readable at reload,
    // while the reply said the link was still carrying nothing.
    expect(metadata.graph).toBeUndefined();
  });

  it('the receipt FACT is withheld with the write — a non-mutating turn emits none', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-fact');
    // A committed `parameter_update` receipt would ground the NEXT turn's model
    // on an edit no persisted graph carries — the DL-7 hazard the goal-target
    // withhold names explicitly.
    expect(commitMock().mock.calls[0]![1].handler_facts).toEqual([]);
  });

  it('the wire graph agrees with the withhold, and the reply stays the honest refusal', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    const out = await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-wire');
    // The 2.427 recovery copy still owns the text — and it is now TRUE.
    expect(out.response.assistant_text).toContain(OPTION_LABEL);
    expect(out.response.assistant_text).toContain(FACTOR_LABEL);
    // No success narration about the wrong entity survives.
    expect(out.response.assistant_text).not.toContain(`Updated ${FACTOR_LABEL}`);
    // The wire must not ship the mutation the store did not keep.
    expect(out.graph ?? null).toBeNull();
  });

  it('L16 gate-reason integrity: the specific blocker SURVIVES the withheld turn', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    const out = await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-readiness');
    // Derived from the PRE-edit graph — the one that stays persisted — so the
    // specific "no effect value" reason is still available to the gate copy
    // rather than degrading to the generic "Olumi is not able to run this yet".
    expect(out.analysisReady).toBeDefined();
    const blockers = (out.analysisReady?.blockers ?? []) as Array<Record<string, unknown>>;
    // NOTE the discriminator: the CANONICAL in-process payload spells this
    // `blocker_type: 'missing_value'`; the WIRE projection spells it
    // `code: 'MISSING_OPTION_VALUE'`. This is the in-process payload.
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
    await dispatch(WITNESS.wire.t4_chip_message, 'req-2-1266-chip');
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
  });
});

describe('2.1266 opposite-direction twins — a withhold that eats a real edit is a NEW harm', () => {
  it('the effect value landing on the named option COMMITS', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      optionEffectAppliedResult(),
    );
    const out = await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-honoured');
    const metadata = commitMock().mock.calls[0]![1];
    expect(metadata.graph).toBeDefined();
    expect(out.graph ?? null).not.toBeNull();
    // And the honest success narration is preserved.
    expect(out.response.assistant_text).toContain('0.12');
  });

  it('a STRUCTURAL-only edit (a rename) COMMITS — a compound turn keeps what landed', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      renameAppliedResult(),
    );
    // The outcome verdict is still `not_honoured` (no effect value landed for
    // the named option), so this case discriminates the withhold's SECOND
    // conjunct — "a node baseline moved" — from the first. A guard that
    // withheld on `not_honoured` alone would eat this edit.
    await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-structural');
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
  });

  it('an unrelated message with the same applied graph COMMITS — the guard needs the intent', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    // Identical wrong-entity graph, but no configure-option intent naming an
    // option, so `evaluateConfigureOptionOutcome` reaches no `not_honoured`
    // verdict and today's behaviour must be byte-identical.
    await dispatch(
      `Set ${FACTOR_LABEL} to 0.12.`,
      'req-2-1266-no-intent',
    );
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
  });
});

describe('2.1266 — the withhold is NOT SILENT: the user is told nothing was saved', () => {
  /**
   * ⭐⭐ WHY THIS IS A SEPARATE, LOAD-BEARING BLOCK. Withholding is the honest
   * choice when the graph and the reply would otherwise disagree — but a
   * SILENT withhold is its own trust defect. On the W1 shape (an explicit,
   * correct request to change a factor's own baseline, where that factor IS
   * wired to the option) the write is discarded even though the user asked for
   * exactly it, and without this sentence they would get recovery copy about
   * the option's missing effect value and never learn their edit was dropped.
   */
  it('the withheld reply says plainly that nothing was saved, and names the factor', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    const out = await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-notice');
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
    expect(out.response.assistant_text).toContain('nothing from this message was saved');
    // Identity-bound: it names the factor whose change was actually discarded.
    expect(out.response.assistant_text).toContain(FACTOR_LABEL);
  });

  it('the STORED copy carries it too — stored and wire text must not diverge', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-notice-stored');
    const stored = commitMock().mock.calls[0]![0] as Record<string, unknown>;
    expect(JSON.stringify(stored)).toContain('nothing from this message was saved');
  });

  it('OPPOSITE-DIRECTION TWIN: a turn that COMMITS carries no such notice', async () => {
    // A notice claiming nothing was saved, on a turn that saved something,
    // would be the inverse lie — and it is the easy way to get this wrong.
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      optionEffectAppliedResult(),
    );
    const out = await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-notice-absent');
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
    expect(out.response.assistant_text).not.toContain('nothing from this message was saved');
  });

  it('and a structural-only edit, which also commits, carries no notice', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      renameAppliedResult(),
    );
    const out = await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-notice-structural');
    expect(commitMock().mock.calls[0]![1].graph).toBeDefined();
    expect(out.response.assistant_text).not.toContain('nothing from this message was saved');
  });
});

describe('2.1266 coherence — every derived signal reads the graph that PERSISTS', () => {
  it('wire freshness carries the PRE-edit hash, never the withheld one', async () => {
    // ⚠ THIS TEST PINS ITS OWN PRECONDITION (trap 13b). If the two hashes were
    // equal the assertion below would hold for the wrong reason, so the
    // difference is asserted first — the witnessed baseline write genuinely
    // moves the analysis-affecting hash (287dc82d… → b5c25b91…), which is why
    // `run_state` went to `complete_stale`/`graph_changed` on the wire.
    const preHash = computeAnalysisAffectingGraphHash(
      clone(WITNESS.draft_graph) as unknown as Parameters<
        typeof computeAnalysisAffectingGraphHash
      >[0],
    );
    const postHash = computeAnalysisAffectingGraphHash(
      WRONG_ENTITY_GRAPH() as unknown as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
    );
    expect(postHash).not.toBe(preHash);

    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    const out = await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-freshness');
    expect(out.freshness?.current_graph_hash).toBe(preHash);
  });

  it('the recovery copy names the PERSISTED factor label, not the withheld one', async () => {
    const WITHHELD_LABEL = 'Subcontractor cost (renamed by the edit)';
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      appliedResult({
        graph: wrongEntityGraphWithRename(WITHHELD_LABEL),
        assistantText: `Updated ${FACTOR_LABEL}`,
        operation: { op: 'update_node', path: FACTOR_ID, value: { label: WITHHELD_LABEL } },
        changeLabel: FACTOR_LABEL,
        changeRef: FACTOR_ID,
      }),
    );
    const out = await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-copy-graph');
    // The write is withheld, so the rename never persists. Copy composed
    // against the applied graph would name a label the user can never find.
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
    expect(out.response.assistant_text).toContain(FACTOR_LABEL);
    expect(out.response.assistant_text).not.toContain(WITHHELD_LABEL);
  });

  it('run admission is assessed against the persisted graph, not the withheld one', async () => {
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      appliedResult({
        graph: wrongEntityGraphWithExtraOption(),
        assistantText: `Updated ${FACTOR_LABEL}`,
        operation: {
          op: 'update_node',
          path: FACTOR_ID,
          value: { observed_state: { value: 0.12 } },
        },
        changeLabel: FACTOR_LABEL,
        changeRef: FACTOR_ID,
      }),
    );
    const out = await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-admission');
    expect(commitMock().mock.calls[0]![1].graph).toBeUndefined();
    // P8/P5: the next step the product prescribes must describe the model the
    // user actually holds. The withheld graph carries an extra unconfigured
    // option, so a next step derived from IT counts one issue too many — an
    // instruction about a model that never existed.
    const persisted = resolveRunAdmission(PRE_EDIT_GRAPH());
    const withheld = resolveRunAdmission(wrongEntityGraphWithExtraOption());
    // Precondition, pinned in-test: the two graphs must genuinely disagree, or
    // the assertion below passes without discriminating anything.
    expect(withheld.strict.nextStep).not.toBe(persisted.strict.nextStep);
    expect(out.response.assistant_text).toContain(persisted.strict.nextStep);
  });
});

describe('2.1266 unchanged-graph coherence — the pre-edit graph is what persists', () => {
  it('the pre-edit graph is unmodified by the withheld turn', async () => {
    const before = JSON.stringify(PRE_EDIT_GRAPH());
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      factorBaselineAppliedResult(),
    );
    await dispatch(WITNESS.wire.t5_user_message, 'req-2-1266-immutable');
    // P1, one seam past the guard: the withhold must not mutate the graph it
    // decided to keep. `INGRESS_GRAPH` is the object the dispatcher was handed.
    expect(JSON.stringify(INGRESS_GRAPH)).toBe(before);
  });
});
