/**
 * ⭐⭐ ROADMAP 2.427 — `dispatchEditGraph` binds the configure-option OUTCOME
 * to the turn's INTENT.
 *
 * Sibling of `edit-graph-dispatch-false-success.test.ts`, and the distinction
 * between the two files IS the defect:
 *
 *   - That file pins the V5 H5 invariant, which asks *"did anything land?"*
 *     and rewrites a success claim when nothing did.
 *   - This file pins the case H5 is STRUCTURALLY BLIND TO: something landed,
 *     it was the WRONG ENTITY, and the prose was accurate about the entity it
 *     described. `successfulAppliedMutation` is TRUE on that turn, so every
 *     branch of H5 is skipped and the false success ships with zero error
 *     blocks.
 *
 * The motivating capture, deployed CEE `98f2476` (`P3r7_4_phrasing.json`):
 * "Updated the Cloud-Native CRM to Adoption Complexity edge strength from 1.0
 * to 0.7. Rerun analysis to see the effect." — `blocks: []`, and the option the
 * user asked to configure still `needs_encoding` with `interventions: {}`.
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): deleting the outcome guard from
 * `edit-graph-dispatch.ts` MUST turn the T12c edge-strength case below red.
 * A test that passes with the producer removed is not a test.
 */

import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import { _resetConfigCache } from '../../../config/index.js';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

// ── module-level mocks (same posture as the H5 sibling) ─────────────

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

// ── imports after mocks ─────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import { emit, TelemetryEvents } from '../../../utils/telemetry.js';
import { composeConfigureOptionClarifyResponse } from '../../compose/configure-option-clarify-response.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// ── the captured graph ──────────────────────────────────────────────

const FACTORS = [
  { id: 'fac_platform_cost', label: 'Platform Licence Cost' },
  { id: 'fac_feature_richness', label: 'Feature Richness' },
  { id: 'fac_adoption_complexity', label: 'Adoption Complexity' },
] as const;

function interventionBundle(values: Readonly<Record<string, number>>) {
  const out: Record<string, unknown> = {};
  for (const [factorId, value] of Object.entries(values)) {
    out[factorId] = {
      value,
      source: 'brief_extraction',
      target_match: { node_id: factorId, confidence: 'high', match_type: 'exact_id' },
    };
  }
  return out;
}

function edge(from: string, to: string, mean: number) {
  return {
    from,
    to,
    strength: { mean, std: 0.01 },
    exists_probability: 0.95,
    effect_direction: (mean >= 0 ? 'positive' : 'negative') as 'positive' | 'negative',
  };
}

function captureGraph(opts: {
  readonly cloudNativeInterventions?: Readonly<Record<string, number>>;
  readonly cloudNativeComplexityStrength?: number;
} = {}): GraphV3T {
  const { cloudNativeInterventions, cloudNativeComplexityStrength = 1 } = opts;
  return {
    nodes: [
      { id: 'goal_crm_roi', kind: 'goal', label: 'CRM Programme ROI' },
      ...FACTORS.map((f) => ({ id: f.id, kind: 'factor' as const, label: f.label })),
      {
        id: 'opt_basic',
        kind: 'option' as const,
        label: 'Basic Platform',
        interventions: interventionBundle({
          fac_platform_cost: 0.3,
          fac_feature_richness: 0.3,
          fac_adoption_complexity: 0.25,
        }),
      },
      {
        id: 'opt_cloud_native',
        kind: 'option' as const,
        label: 'Cloud-Native CRM',
        ...(cloudNativeInterventions
          ? { interventions: interventionBundle(cloudNativeInterventions) }
          : {}),
      },
    ],
    edges: [
      ...FACTORS.map((f) => edge('opt_basic', f.id, 1)),
      edge('opt_cloud_native', 'fac_platform_cost', 1),
      edge('opt_cloud_native', 'fac_feature_richness', 1),
      edge('opt_cloud_native', 'fac_adoption_complexity', cloudNativeComplexityStrength),
      ...FACTORS.map((f) => edge(f.id, 'goal_crm_roi', 0.5)),
    ],
  } as GraphV3T;
}

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

/** The live T12c phrasing — capture P3/P3r1–r7, MANIFEST.json. */
const T12C = 'Under the Cloud-Native CRM option, set its effect on Adoption Complexity to 0.7.';

/** The false-success sentence the deployed product actually shipped. */
const CAPTURED_FALSE_SUCCESS =
  'Updated the Cloud-Native CRM to Adoption Complexity edge strength from 1.0 to 0.7. Rerun analysis to see the effect.';

/** The generic dead end the sibling capture (P3) shipped. */
const CAPTURED_GENERIC_REFUSAL =
  "I wasn't able to make that change safely. Can you describe what you'd like to add or change in simpler terms?";

const INGRESS_GRAPH = captureGraph() as unknown as GraphStateIngress;

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message,
    turn_class: 'frame' as const,
    source: 'composer' as const,
  };
}

/**
 * The captured branch (b): an APPLIED edit that wrote the wrong entity.
 * `appliedGraph` present + operations present ⇒ `successfulAppliedMutation`
 * is true, which is exactly why H5 cannot see this.
 */
function wrongEntityAppliedResult(assistantText: string): EditGraphResult {
  return {
    blocks: [],
    assistantText,
    latencyMs: 1000,
    appliedGraph: captureGraph({
      cloudNativeComplexityStrength: 0.7,
    }) as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [
      {
        op: 'update_edge',
        path: 'opt_cloud_native->fac_adoption_complexity',
        value: { strength: { mean: 0.7, std: 0.01 } },
      },
    ],
    appliedChanges: {
      summary: 'Adjusted the Cloud-Native CRM to Adoption Complexity edge strength.',
      changes: [
        {
          label: 'Adoption Complexity',
          description: 'Edge strength 1.0 → 0.7.',
          element_ref: 'fac_adoption_complexity',
        },
      ],
      rerun_recommended: true,
    },
    operation_meta: [{ impact: 'medium', rationale: '' }],
  } as unknown as EditGraphResult;
}

/** The captured branch (a): OPERATION_DID_NOT_LAND — ops submitted, none applied. */
function didNotLandResult(assistantText: string): EditGraphResult {
  return {
    blocks: [],
    assistantText,
    latencyMs: 500,
    appliedGraph: null,
    wasRejected: false,
    operations: [],
  };
}

/** The honest success shape: an interventions write for the named option. */
function honouredResult(assistantText: string): EditGraphResult {
  return {
    blocks: [],
    assistantText,
    latencyMs: 1000,
    appliedGraph: captureGraph({
      cloudNativeInterventions: { fac_adoption_complexity: 0.7 },
    }) as unknown as EditGraphResult['appliedGraph'],
    wasRejected: false,
    operations: [
      {
        op: 'update_node',
        path: 'opt_cloud_native',
        value: { data: { interventions: { fac_adoption_complexity: 0.7 } } },
      },
    ],
    appliedChanges: {
      summary: 'Configured Cloud-Native CRM.',
      changes: [
        {
          label: 'Cloud-Native CRM',
          description: 'Adoption Complexity set to 0.7.',
          element_ref: 'opt_cloud_native',
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

/**
 * The copy the guard is required to produce — DERIVED from the shipped
 * composer, never transcribed. A copy edit moves the expectation with it
 * instead of leaving a stale literal that passes by testing nothing.
 */
const EXPECTED_RECOVERY_TEXT = composeConfigureOptionClarifyResponse({
  optionLabel: 'Cloud-Native CRM',
  factorLabels: ['Platform Licence Cost', 'Feature Richness', 'Adoption Complexity'],
  stage: 'analyse',
}).assistant_text;

// Same mode premise as the H5 sibling: 'off' is the mode in which the seam
// under test is reached byte-identically. Stated, not inherited.
beforeEach(() => {
  vi.stubEnv('CEE_GRAPH_MANAGEMENT_MODE', 'off');
  _resetConfigCache();
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

async function dispatch(message: string, result: EditGraphResult) {
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(result);
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>)
    .mockResolvedValue(makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>);

  return dispatchEditGraph({
    payload: makePayload(message),
    requestId: 'req-2427',
    request: STUB_REQUEST,
    graphState: INGRESS_GRAPH,
    analysisState: null,
  });
}

describe('ROADMAP 2.427 — branch (b): the wrong-entity write H5 cannot see', () => {
  it('refuses the captured false success and answers with the routable recovery copy', async () => {
    const out = await dispatch(T12C, wrongEntityAppliedResult(CAPTURED_FALSE_SUCCESS));

    // The lie is gone.
    expect(out.response.assistant_text).not.toContain('edge strength');
    expect(out.response.assistant_text).not.toContain(CAPTURED_FALSE_SUCCESS);
    // And what replaces it names the option, the unset factors, and the
    // sentence that writes them.
    expect(out.response.assistant_text).toBe(EXPECTED_RECOVERY_TEXT);
    expect(out.response.assistant_text).toContain('Cloud-Native CRM');
    expect(out.response.assistant_text).toContain("option's effect on");
  });

  it('emits the unhonoured-outcome meter with applied_something=true', async () => {
    await dispatch(T12C, wrongEntityAppliedResult(CAPTURED_FALSE_SUCCESS));

    const call = (emit as MockedFunction<typeof emit>).mock.calls.find(
      ([event]) => event === TelemetryEvents.V5ConfigureOptionOutcomeUnhonoured,
    );
    expect(call, 'V5ConfigureOptionOutcomeUnhonoured was not emitted').toBeDefined();
    expect(call![1]).toMatchObject({
      scenario_id: SCENARIO_ID,
      option_id: 'opt_cloud_native',
      // The field that separates this branch from the did-not-land one:
      // something DID land, which is why H5 stayed silent.
      applied_something: true,
    });
  });
});

describe('ROADMAP 2.427 — branch (a): the generic dead end', () => {
  it('replaces the generic refusal with copy that names a working phrasing', async () => {
    const out = await dispatch(T12C, didNotLandResult(CAPTURED_GENERIC_REFUSAL));

    expect(out.response.assistant_text).not.toBe(CAPTURED_GENERIC_REFUSAL);
    expect(out.response.assistant_text).toBe(EXPECTED_RECOVERY_TEXT);
  });

  it('emits the meter with applied_something=false', async () => {
    await dispatch(T12C, didNotLandResult(CAPTURED_GENERIC_REFUSAL));

    const call = (emit as MockedFunction<typeof emit>).mock.calls.find(
      ([event]) => event === TelemetryEvents.V5ConfigureOptionOutcomeUnhonoured,
    );
    expect(call![1]).toMatchObject({ option_id: 'opt_cloud_native', applied_something: false });
  });
});

describe('ROADMAP 2.427 — the guard stays out of the way of working turns', () => {
  it('an honoured configure keeps its own confirmation', async () => {
    const confirmation =
      'Configured the Cloud-Native CRM option to set Adoption Complexity to 0.7. Rerun analysis to see the downstream effect.';
    const out = await dispatch(T12C, honouredResult(confirmation));

    expect(out.response.assistant_text).toContain('Configured the Cloud-Native CRM option');
    expect(out.response.assistant_text).not.toBe(EXPECTED_RECOVERY_TEXT);
    expect(
      (emit as MockedFunction<typeof emit>).mock.calls.some(
        ([e]) => e === TelemetryEvents.V5ConfigureOptionOutcomeUnhonoured,
      ),
    ).toBe(false);
  });

  it('DISCRIMINATION CONTROL P7 — a factor edit that names no option is untouched', async () => {
    // Live capture P7: "Set Adoption Complexity to 0.7." → the product changed a
    // factor and said so. No option was named, so no option-scoped promise was
    // made and this guard must have no opinion.
    const factorEditText = 'Updated Adoption Complexity from 0.1 to 0.7.';
    const out = await dispatch('Set Adoption Complexity to 0.7.', wrongEntityAppliedResult(factorEditText));

    expect(out.response.assistant_text).toContain('Updated Adoption Complexity');
    expect(
      (emit as MockedFunction<typeof emit>).mock.calls.some(
        ([e]) => e === TelemetryEvents.V5ConfigureOptionOutcomeUnhonoured,
      ),
    ).toBe(false);
  });

  it('DISCRIMINATION CONTROL P8 — a vague ask keeps the product’s existing clarify reply', async () => {
    // Live capture P8: "Make Cloud-Native CRM better on Adoption Complexity."
    // The product already answers this well; the guard must not overwrite it.
    const existingClarify =
      'The Cloud-Native CRM option was just added and its links to Adoption Complexity do not have real effect values yet.';
    const out = await dispatch(
      'Make Cloud-Native CRM better on Adoption Complexity.',
      didNotLandResult(existingClarify),
    );

    expect(out.response.assistant_text).toContain('was just added');
    expect(
      (emit as MockedFunction<typeof emit>).mock.calls.some(
        ([e]) => e === TelemetryEvents.V5ConfigureOptionOutcomeUnhonoured,
      ),
    ).toBe(false);
  });
});
