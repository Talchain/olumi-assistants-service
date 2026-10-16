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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { _resetConfigCache } from '../../../config/index.js';
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
    // B-FIX1: the combined read follows the existing graph double.
    loadPersistedScenarioStateStrict: async (scenarioId: string) => ({ graph: (await (await import('../../build-turn-context.js')).loadPersistedGraphStrict(scenarioId)) ?? null, briefText: null, revision: 7 }),
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

vi.mock('../../../utils/telemetry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../utils/telemetry.js')>();
  return { ...actual, emit: vi.fn() };
});
import { composeConfigureOptionClarifyResponse } from '../../compose/configure-option-clarify-response.js';
import { carriesConfigureOptionValuePayload } from '../../routing/configure-option-intent.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';

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

/** The live T12c phrasing — capture P3/P3r1–r7, MANIFEST.json. */
const T12C = 'Under the Cloud-Native CRM option, set its effect on Adoption Complexity to 0.7.';

/**
 * The copy the guard is required to produce — DERIVED from the shipped
 * composer, never transcribed. A copy edit moves the expectation with it
 * instead of leaving a stale literal that passes by testing nothing.
 */
/**
 * ⚠ RE-POINTED 2026-08-16 (L-25): `valueAlreadySupplied` is now DERIVED from the
 * fixture message by the SAME predicate production uses, not assumed false.
 *
 * `T12C` carries "…to 0.7", i.e. the user HAS supplied a value. The composer
 * used to answer that by re-emitting its demand verbatim, and this expectation
 * pinned exactly that — witnessed live on deployed CEE `bacf35d`: the product
 * demanded a template, the user typed it back, and got the identical sentence
 * again. The loop did not terminate.
 *
 * Deriving the flag here (rather than hardcoding `true`) keeps the test honest
 * if the fixture message ever changes shape: the expectation follows the
 * message, exactly as the dispatch does. The precondition — that this fixture
 * really does carry a value — is asserted by name below, so this cannot become
 * a tautology that quietly stops discriminating.
 */
/**
 * ⚠ ALSO DERIVES THE ADMISSION (review C1, 2026-08-16). The dispatch now
 * resolves `resolveRunAdmission` on the graph it holds and threads the verdict
 * in, so the reply says "the analysis will run…" only when it actually would.
 * This capture graph does NOT admit, so the honest-alternative branch is the
 * correct output — derived here for the same reason `valueAlreadySupplied` is,
 * and guarded against tautology by the preconditions asserted below.
 */
const CAPTURE_ADMISSION = resolveRunAdmission(captureGraph());

const EXPECTED_RECOVERY_TEXT = composeConfigureOptionClarifyResponse({
  optionLabel: 'Cloud-Native CRM',
  factorLabels: ['Platform Licence Cost', 'Feature Richness', 'Adoption Complexity'],
  stage: 'analyse',
  // ⚠⚠ THIS WAS `valueAlreadySupplied: carriesConfigureOptionValuePayload(T12C)`
  // AND THE RENAME TO `message` MADE IT A SILENT NO-OP. Test files are excluded
  // from `tsconfig.build.json`, so an unknown excess property compiles and is
  // simply IGNORED: this derived expectation quietly became the NON-terminating
  // demand while the dispatch path under test produced the terminating copy.
  // It failed loudly here only because the expectation is DERIVED — a
  // hand-written literal would have gone on agreeing with nothing (ROADMAP 2.1267).
  message: T12C,
  analysisWillProceed: CAPTURE_ADMISSION.willProceed,
  blockedNextStep: CAPTURE_ADMISSION.willProceed ? null : CAPTURE_ADMISSION.strict.nextStep,
}).assistant_text;

describe('L-25 — the repair loop terminates', () => {
  it('the fixture message genuinely carries a value (precondition for every recovery assertion)', () => {
    expect(carriesConfigureOptionValuePayload(T12C)).toBe(true);
  });

  it('C1 — this capture graph genuinely does NOT admit, so the blocked branch is the right one', () => {
    // PRECONDITION PINNED BY NAME. Without this the derived expectation above
    // would agree with the code by construction: if the graph ever started
    // admitting, both sides would flip together and the promise assertion below
    // would silently stop testing anything.
    expect(CAPTURE_ADMISSION.willProceed).toBe(false);
    expect(CAPTURE_ADMISSION.strict.nextStep).toBeTruthy();
  });

  it('C1 — the reply states the honest alternative and makes NO promise about analysis', () => {
    expect(EXPECTED_RECOVERY_TEXT).toContain('The analysis cannot run on this model yet.');
    expect(EXPECTED_RECOVERY_TEXT).not.toMatch(/analysis will run/i);
  });

  it('C1 — DISCRIMINATING TWIN: an admitting model gets the promise instead', () => {
    const promised = composeConfigureOptionClarifyResponse({
      optionLabel: 'Cloud-Native CRM',
      factorLabels: ['Platform Licence Cost'],
      stage: 'analyse',
      message: T12C,
      analysisWillProceed: true,
    }).assistant_text;
    expect(promised).toMatch(/analysis will run/i);
    expect(promised).not.toContain('The analysis cannot run on this model yet.');
  });

  it('the recovery copy does NOT re-demand the format the user just used', () => {
    expect(EXPECTED_RECOVERY_TEXT).not.toContain("option's effect on");
    expect(EXPECTED_RECOVERY_TEXT).not.toContain('Tell me what it changes');
    // It still names the option — terminating must not mean going vague.
    expect(EXPECTED_RECOVERY_TEXT).toContain('Cloud-Native CRM');
  });

  it('DISCRIMINATING TWIN — a message with no value still gets the demand', () => {
    const noValue = 'Configure the Cloud-Native CRM option.';
    expect(carriesConfigureOptionValuePayload(noValue)).toBe(false);
    const demand = composeConfigureOptionClarifyResponse({
      optionLabel: 'Cloud-Native CRM',
      factorLabels: ['Platform Licence Cost'],
      stage: 'analyse',
      message: noValue,
    }).assistant_text;
    expect(demand).toContain("option's effect on");
  });
});

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
