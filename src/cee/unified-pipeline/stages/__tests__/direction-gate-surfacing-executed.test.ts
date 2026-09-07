/**
 * ROADMAP 2.1051 — THE ASK ACTUALLY ARRIVES. Executed, not grepped.
 *
 * ⚠⚠ THIS FILE EXISTS BECAUSE THE MANDATED M4 MUTANT SURVIVED 167/167 GREEN
 * (round-1 review). The first surfacing spec verified the package append by
 * READING `package.ts` and grepping it for the string
 * `renderDirectionClarifications`, plus an index-ordering check. A mutation that
 * feeds the append an empty array forever —
 *
 *     const unresolved = ctx.directionUnresolved ?? [];   ->   = []
 *
 * — leaves every one of those greps satisfied. The reviewer's complete manifest
 * confirmed the shape of the hole: of the 23 specs that execute
 * `runStagePackage`, ZERO referenced `directionUnresolved`, and the only spec
 * that referenced it never ran the stage.
 *
 * So the entire user-facing limb of the trichotomy — the "and asks" that makes
 * withholding honest rather than a silent drop — had no executing guard. If it
 * regressed, every withheld bound would become a silent drop and the suite would
 * stay green. That is the FOURTH OUTCOME the ruling forbids, hidden behind a
 * test that could not fail.
 *
 * A grep proves a STRING IS PRESENT IN A FILE. Only execution proves a USER GETS
 * THE CARD. This file executes the real stage and asserts the card arrives on
 * the response payload, bound BY ITEM ID (trap 19).
 *
 * Collaborators are mocked exactly as in the stage-5 scaffolds — EXCEPT the
 * direction gate's own renderer, which is deliberately REAL: a mocked renderer
 * here would be guarantee-theatre of precisely the kind this file was written to
 * end.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../config/index.js', () => ({
  config: { cee: { draftArchetypesEnabled: true, pipelineCheckpointsEnabled: false } },
  isProduction: vi.fn().mockReturnValue(false),
}));
vi.mock('../../../../utils/telemetry.js', () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));
vi.mock('../../../archetypes/index.js', () => ({ inferArchetype: vi.fn() }));
vi.mock('../../../quality/index.js', () => ({ computeQuality: vi.fn() }));
vi.mock('../../../transforms/response-caps.js', () => ({ applyResponseCaps: vi.fn() }));
vi.mock('../../../guidance/index.js', () => ({ ceeAnyTruncated: vi.fn(), buildCeeGuidance: vi.fn() }));
vi.mock('../../../structure/index.js', () => ({
  detectStructuralWarnings: vi.fn(),
  detectUniformStrengths: vi.fn(),
  detectStrengthClustering: vi.fn(),
  detectSameLeverOptions: vi.fn(),
  detectOptionSimilarity: vi.fn().mockReturnValue({ detected: false, critiques: [], warnings: [], validationIssues: [] }),
  detectMissingBaseline: vi.fn(),
  detectMissingCounterfactual: vi.fn().mockReturnValue({ detected: false, hasCounterfactual: false }),
  detectGoalNoBaselineValue: vi.fn(),
  detectZeroExternalFactors: vi.fn(),
  checkGoalConnectivity: vi.fn(),
  computeModelQualityFactors: vi.fn(),
}));
vi.mock('../../../verification/index.js', () => ({ verificationPipeline: { verify: vi.fn() } }));
vi.mock('../../../../schemas/ceeResponses.js', () => ({ CEEDraftGraphResponseV1Schema: {} }));
vi.mock('../../../validation/pipeline.js', () => ({ buildCeeErrorResponse: vi.fn() }));
vi.mock('../../../pipeline-checkpoints.js', () => ({
  captureCheckpoint: vi.fn(),
  applyCheckpointSizeGuard: vi.fn(),
  assembleCeeProvenance: vi.fn(),
}));
vi.mock('../../../llm-output-store.js', () => ({ buildLLMRawTrace: vi.fn() }));
vi.mock('../../../../context/context-pack.js', () => ({
  assembleDraftProvenanceDescriptor: vi.fn().mockReturnValue({ pipelinePath: 'unified', context_hash: 'h' }),
}));
vi.mock('../../../../version.js', () => ({ SERVICE_VERSION: '1.0.0-test' }));

import { runStagePackage } from '../package.js';
import { inferArchetype } from '../../../archetypes/index.js';
import { computeQuality } from '../../../quality/index.js';
import { applyResponseCaps } from '../../../transforms/response-caps.js';
import { ceeAnyTruncated, buildCeeGuidance } from '../../../guidance/index.js';
import {
  detectStructuralWarnings,
  detectUniformStrengths,
  detectStrengthClustering,
  detectSameLeverOptions,
  detectMissingBaseline,
  detectGoalNoBaselineValue,
  detectZeroExternalFactors,
  checkGoalConnectivity,
  computeModelQualityFactors,
} from '../../../structure/index.js';
import { verificationPipeline } from '../../../verification/index.js';
import { captureCheckpoint, applyCheckpointSizeGuard, assembleCeeProvenance } from '../../../pipeline-checkpoints.js';
import { buildLLMRawTrace } from '../../../llm-output-store.js';
import type { DirectionUnresolvedItem } from '../../../compound-goal/direction-gate.js';

const GRAPH = {
  nodes: [
    { id: 'dec_main', kind: 'decision', label: 'The decision' },
    { id: 'opt_a', kind: 'option', label: 'Continue as-is' },
    { id: 'opt_b', kind: 'option', label: 'Expand' },
    { id: 'fac_gross_margin', kind: 'factor', label: 'Gross margin' },
  ],
  edges: [],
};

function unresolved(metric: string, amount: string): DirectionUnresolvedItem {
  return {
    metric_text: metric,
    amount_text: amount,
    value: 0.78,
    unit: 'fraction',
    reason: 'unspent_negation',
    question: `Should ${metric} stay at or above ${amount}, or at or below it?`,
    options: ['a floor — keep it at or above this value', 'a ceiling — keep it at or below this value'],
  };
}

function makeCtx(overrides?: Record<string, unknown>): any {
  return {
    requestId: 'test-21051-surfacing',
    graph: structuredClone(GRAPH),
    input: { brief: 'Do not let gross margin drop below 78%.', seed: 's' },
    opts: { schemaVersion: 'v3' as const, strictMode: false, includeDebug: false, unsafeCaptureEnabled: false },
    start: Date.now() - 1000,
    confidence: 0.75,
    rationales: [],
    goalConstraints: undefined,
    directionUnresolved: undefined,
    coaching: undefined,
    draftAdapter: { name: 'anthropic', model: 'test-model' },
    llmMeta: {
      prompt_version: 'v-test', prompt_hash: 'hash', model: 'test-model', temperature: 0.3,
      token_usage: { input: 1, output: 1 }, finish_reason: 'stop', provider_latency_ms: 1,
      raw_llm_text: undefined, prompt_source: 'store', prompt_store_version: 1,
    },
    strpResult: undefined,
    constraintStrpResult: undefined,
    riskCoefficientCorrections: [],
    nodeRenames: new Map(),
    transforms: [],
    enrichmentTrace: undefined,
    repairTrace: undefined,
    collector: { hasCorrections: vi.fn().mockReturnValue(false), getCorrections: vi.fn(), getSummary: vi.fn() },
    pipelineCheckpoints: [],
    checkpointsEnabled: false,
    validationSummary: undefined,
    structuralMeta: undefined,
    quality: undefined,
    archetype: undefined,
    draftWarnings: [],
    ceeResponse: undefined,
    pipelineTrace: undefined,
    earlyReturn: undefined,
    pipelineOutcome: {
      graph_drafted: true, graph_structurally_valid: true, deterministic_sweep_violations: 0,
      verification_status: 'skipped', validation_status: 'skipped', enrichment_status: 'skipped',
      coaching_status: 'partial', warnings: [],
    },
    ...overrides,
  };
}

function setupMocks(): void {
  (inferArchetype as any).mockReturnValue({ archetype: { decision_type: 'investment', match: 'exact', confidence: 0.75 }, issues: [] });
  (computeQuality as any).mockReturnValue({ level: 'moderate', score: 0.65, factors: {} });
  (applyResponseCaps as any).mockImplementation((payload: any) => ({
    cappedPayload: { ...payload },
    limits: {
      bias_findings_max: 10, bias_findings_truncated: false, options_max: 10, options_truncated: false,
      evidence_suggestions_max: 10, evidence_suggestions_truncated: false,
      sensitivity_suggestions_max: 10, sensitivity_suggestions_truncated: false,
    },
  }));
  (ceeAnyTruncated as any).mockReturnValue(false);
  (buildCeeGuidance as any).mockReturnValue({ recommendations: [] });
  (detectStructuralWarnings as any).mockReturnValue({ warnings: [], uncertainNodeIds: [] });
  (detectUniformStrengths as any).mockReturnValue({ detected: false });
  (detectStrengthClustering as any).mockReturnValue({ detected: false });
  (detectSameLeverOptions as any).mockReturnValue({ detected: false });
  (detectMissingBaseline as any).mockReturnValue({ detected: false });
  (detectGoalNoBaselineValue as any).mockReturnValue({ detected: false });
  (detectZeroExternalFactors as any).mockReturnValue({ detected: false, factorCount: 0, externalCount: 0 });
  (checkGoalConnectivity as any).mockReturnValue({ status: 'connected', disconnectedOptions: [], weakPaths: [] });
  (computeModelQualityFactors as any).mockReturnValue({});
  (verificationPipeline.verify as any).mockImplementation((resp: any) => ({ response: { ...resp } }));
  (captureCheckpoint as any).mockReturnValue({ stage: 'post_stabilisation', node_count: 4, edge_count: 0 });
  (applyCheckpointSizeGuard as any).mockImplementation((cps: any) => cps);
  (assembleCeeProvenance as any).mockReturnValue({ pipelinePath: 'unified' });
  (buildLLMRawTrace as any).mockReturnValue({ stored: true });
}

/** The coaching a user would actually receive, off the built response. */
function cardsOn(ctx: any): Array<Record<string, unknown>> {
  const items = ctx.ceeResponse?.coaching?.strengthen_items;
  return Array.isArray(items) ? items : [];
}

describe('ROADMAP 2.1051 — the ask reaches the user (executed through runStagePackage)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('M4 TARGET: a withheld bound arrives as a card on the response, by item id', async () => {
    const ctx = makeCtx({ directionUnresolved: [unresolved('gross margin', '78%')] });
    await runStagePackage(ctx);

    expect(ctx.ceeResponse, 'the stage must have built a response at all').toBeDefined();
    const ids = cardsOn(ctx).map((i) => i.id);
    expect(ids, 'the clarification must reach the payload a user receives').toContain('direction_unresolved_1');

    const card = cardsOn(ctx).find((i) => i.id === 'direction_unresolved_1')!;
    expect(card.action_type).toBe('add_constraint');
    expect(String(card.label)).toContain('gross margin');
    expect(String(card.detail)).toContain('78%');
  });

  it('POSITIVE CONTROL: with nothing unresolved, no direction card appears', async () => {
    // Without this pair the assertion above could be satisfied by a stage that
    // emits the card unconditionally — which would be a different defect
    // wearing the same green tick (trap 13).
    const ctx = makeCtx({ directionUnresolved: [] });
    await runStagePackage(ctx);
    const ids = cardsOn(ctx).map((i) => String(i.id));
    expect(ids.filter((i) => i.startsWith('direction_unresolved'))).toEqual([]);
  });

  it('the card survives when the LLM produced NO coaching at all', async () => {
    // The canonical-empty coaching block must accept the injection, or a draft
    // whose only coaching is these questions would show none of them.
    const ctx = makeCtx({ coaching: undefined, directionUnresolved: [unresolved('churn', '4%')] });
    await runStagePackage(ctx);
    expect(cardsOn(ctx).map((i) => i.id)).toContain('direction_unresolved_1');
  });

  it('the card is APPENDED to existing LLM coaching, never replacing it', async () => {
    const ctx = makeCtx({
      coaching: {
        summary: 'Existing summary',
        strengthen_items: [{ id: 'llm_item_1', label: 'Add an option', detail: 'x', action_type: 'add_option' }],
        widening_log: { elements_added: [], elements_considered_but_excluded: [], brief_completeness: 'partial' },
        bias_signals: [],
      },
      directionUnresolved: [unresolved('gross margin', '78%')],
    });
    await runStagePackage(ctx);
    const ids = cardsOn(ctx).map((i) => i.id);
    expect(ids).toContain('llm_item_1');
    expect(ids).toContain('direction_unresolved_1');
  });

  it('multiple unresolved bounds arrive as distinct cards, capped, with a counted overflow', async () => {
    const ctx = makeCtx({
      directionUnresolved: [
        unresolved('gross margin', '78%'),
        unresolved('churn', '4%'),
        unresolved('runway', '250000'),
        unresolved('headcount', '30'),
        unresolved('spend', '2m'),
      ],
    });
    await runStagePackage(ctx);
    const ids = cardsOn(ctx).map((i) => String(i.id)).filter((i) => i.startsWith('direction_unresolved'));
    expect(ids).toEqual([
      'direction_unresolved_1',
      'direction_unresolved_2',
      'direction_unresolved_3',
      'direction_unresolved_more',
    ]);
    const overflow = cardsOn(ctx).find((i) => i.id === 'direction_unresolved_more')!;
    expect(String(overflow.label)).toContain('2 more limits');
  });

  it('no card leaks a node id into what the user reads', async () => {
    const ctx = makeCtx({ directionUnresolved: [unresolved('gross margin', '78%')] });
    await runStagePackage(ctx);
    for (const c of cardsOn(ctx)) {
      expect(String(c.label)).not.toMatch(/\b(?:fac|out|risk|goal|dec|opt)_[a-z0-9_]+/i);
      expect(String(c.detail)).not.toMatch(/\b(?:fac|out|risk|goal|dec|opt)_[a-z0-9_]+/i);
    }
  });
});

/**
 * ⭐⭐ THE RESERVED ID NAMESPACE — the precondition the downstream consumer's
 * trust rests on.
 *
 * `pickDirectionClarifications` (`orchestrator-v5/coaching/post-draft-narrative.ts`)
 * identifies a producer-built limit question BY ID PREFIX and serves it on
 * every turn, ready or not. That identification is sound only if nothing else
 * can carry the prefix. This stage is what makes it sound, and these are the
 * specs that say so — written against the PROPERTY ("only this stage's own
 * mint occupies the namespace"), not against the shape of the squatter that
 * happened to prompt them.
 *
 * The defect they close bit in BOTH directions on one line: the old
 * `alreadyPresent` check treated an LLM item under the reserved id as
 * satisfying the append, so unvetted copy inherited producer authority AND the
 * producer's genuine card was silently discarded.
 */
describe('the direction-clarification id space is reserved to this stage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('evicts an LLM item squatting the reserved id and serves the producer card instead', async () => {
    const ctx = makeCtx({
      coaching: {
        summary: 'Existing summary',
        strengthen_items: [
          { id: 'direction_unresolved_1', label: 'Squatter label', detail: 'Squatter detail', action_type: 'add_option' },
        ],
        widening_log: { elements_added: [], elements_considered_but_excluded: [], brief_completeness: 'partial' },
        bias_signals: [],
      },
      directionUnresolved: [unresolved('gross margin', '78%')],
    });
    await runStagePackage(ctx);

    const reserved = cardsOn(ctx).filter((i) => String(i.id).startsWith('direction_unresolved'));
    expect(reserved, 'exactly one item may hold the reserved id').toHaveLength(1);
    // Bound by IDENTITY of the producer's own copy, not by "is not the squatter"
    // — a value predicate a third item could also satisfy (trap 19).
    expect(String(reserved[0].detail)).toContain('78%');
    expect(String(reserved[0].label)).toContain('gross margin');
    expect(reserved[0].action_type).toBe('add_constraint');
    expect(cardsOn(ctx).map((i) => String(i.detail))).not.toContain('Squatter detail');
  });

  it('evicts a squatter even when this draft has NO unresolved bound to replace it with', async () => {
    // The case the append could never cover, and the one that matters most: with
    // nothing to displace it, a squatter would otherwise reach the narrative
    // wearing producer authority on a turn where the producer said nothing.
    const ctx = makeCtx({
      coaching: {
        summary: 'Existing summary',
        strengthen_items: [
          { id: 'direction_unresolved_2', label: 'Squatter label', detail: 'Squatter detail', action_type: 'add_option' },
        ],
        widening_log: { elements_added: [], elements_considered_but_excluded: [], brief_completeness: 'partial' },
        bias_signals: [],
      },
      directionUnresolved: [],
    });
    await runStagePackage(ctx);
    expect(cardsOn(ctx).filter((i) => String(i.id).startsWith('direction_unresolved'))).toEqual([]);
  });

  it('CONTRAST CONTROL: a non-reserved LLM item is untouched by the eviction', async () => {
    // Without this the eviction could be satisfied by a stage that drops every
    // LLM strengthen item — a different defect wearing the same green tick.
    const ctx = makeCtx({
      coaching: {
        summary: 'Existing summary',
        strengthen_items: [
          { id: 'llm_item_1', label: 'Add an option', detail: 'Keep me', action_type: 'add_option' },
          { id: 'direction_unresolved_1', label: 'Squatter label', detail: 'Squatter detail', action_type: 'add_option' },
        ],
        widening_log: { elements_added: [], elements_considered_but_excluded: [], brief_completeness: 'partial' },
        bias_signals: [],
      },
      directionUnresolved: [],
    });
    await runStagePackage(ctx);
    const ids = cardsOn(ctx).map((i) => String(i.id));
    expect(ids, 'the ordinary item must survive').toContain('llm_item_1');
    expect(ids.filter((i) => i.startsWith('direction_unresolved')), 'only the reserved id goes').toEqual([]);
  });
});

/**
 * ⭐⭐ THE EVICTION ANSWERS EXACTLY ONE QUESTION, OVER EVERY ITEM SHAPE THE
 * UPSTREAM CAN DELIVER.
 *
 * ⚠ WRITTEN AGAINST THE SPEC, NOT AGAINST THE SHAPE THAT PROMPTED IT. The
 * property is: *an item is evicted if and only if its id lies in the reserved
 * `direction_unresolved_*` namespace.* A `null` entry has no id, so the answer
 * is NO and it is kept — and so is every other shape that carries no reserved
 * id. Writing this suite as "does not crash on null" would have the same
 * asymmetry as the defect (CLAUDE.md trap 13d): null is where we came in, it is
 * not the class.
 *
 * ⭐ TWO OPPOSITE HARMS, TWO MECHANISMS — they do not share a threshold, and
 * this suite asserts BOTH DIRECTIONS on every case:
 *
 *   - THE GAP: an item the eviction must NOT touch is dropped, or worse, reading
 *     it throws. A throw here is not a local failure — `unified-pipeline/index.ts`
 *     catches a Package exception and returns `{graph, rationales, confidence}`
 *     only, so ONE malformed optional coaching entry would discard `coaching`,
 *     `goal_constraints` and `analysis_ready` — including the limit disclosure
 *     this whole change exists to deliver. The disclosure would be lost by the
 *     very guard that makes it trustworthy.
 *   - THE LIE: an item the eviction MUST take is kept, and unvetted copy reaches
 *     the narrative wearing producer authority.
 *
 * Each case below therefore carries its OPPOSITE-DIRECTION TWIN in the same run:
 * a reserved-id impostor that must go, a legitimate sibling that must stay, and
 * the producer's genuine card that must arrive.
 *
 * ⚠ THE INPUT CLASS IS DERIVED FROM THE PRODUCER, NOT IMAGINED. Stage 4.5 hands
 * `ctx.coaching` the RAW parsed model object (`coaching-pass.ts:479-481`), and
 * the only thing between there and here is `normaliseLegacyCoachingValues`,
 * whose loop `continue`s past non-object entries WITHOUT REMOVING THEM
 * (`adapters/llm/normalise-legacy-coaching.ts:61`). So every shape below is
 * something `strengthen_items` can actually hold when this stage reads it.
 */
describe('the eviction predicate is total over admissible strengthen_items', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  const MALFORMED: ReadonlyArray<readonly [string, unknown]> = [
    ['null', null],
    ['undefined', undefined],
    ['a bare string', 'not an object'],
    ['a number', 42],
    ['an array', []],
    ['an object with no id', { label: 'no id here', detail: 'x' }],
    ['an object with a non-string id', { id: 123, label: 'numeric id', detail: 'x' }],
  ];

  it.each(MALFORMED)(
    'keeps the package intact when strengthen_items contains %s, and still evicts the impostor beside it',
    async (_name, malformed) => {
      const ctx = makeCtx({
        coaching: {
          summary: 'Existing summary',
          strengthen_items: [
            malformed,
            { id: 'llm_item_1', label: 'Add an option', detail: 'Keep me', action_type: 'add_option' },
            { id: 'direction_unresolved_1', label: 'Squatter label', detail: 'Squatter detail', action_type: 'add_option' },
          ],
          widening_log: { elements_added: [], elements_considered_but_excluded: [], brief_completeness: 'partial' },
          bias_signals: [],
        },
        directionUnresolved: [unresolved('gross margin', '78%')],
      });

      await runStagePackage(ctx);

      // GAP DIRECTION — the stage completed and the package survived. If the
      // eviction throws, `ceeResponse` is never built and the caller degrades to
      // graph-only, taking the disclosure with it.
      expect(ctx.ceeResponse, 'a malformed coaching entry must not discard the package').toBeDefined();
      expect(ctx.ceeResponse?.coaching, 'coaching must still reach the user').toBeDefined();

      const ids = cardsOn(ctx).map((i) => String(i.id));

      // GAP DIRECTION — a well-formed neighbour is not collateral damage.
      expect(ids, 'the ordinary item must survive alongside the malformed one').toContain('llm_item_1');

      // GAP DIRECTION — the disclosure this change exists to deliver still lands.
      expect(ids, 'the producer card must still arrive').toContain('direction_unresolved_1');

      // LIE DIRECTION — the twin. Bound by the producer's own copy, never by
      // "is not the squatter", which a third item could satisfy (trap 19).
      const reserved = cardsOn(ctx).filter((i) => String(i.id).startsWith('direction_unresolved'));
      expect(reserved, 'exactly one item may hold the reserved id').toHaveLength(1);
      expect(String(reserved[0]!.detail)).toContain('78%');
      expect(cardsOn(ctx).map((i) => String(i.detail))).not.toContain('Squatter detail');
    },
  );

  it('a malformed entry does not cost the user the disclosure when there is no impostor at all', async () => {
    // The reachable everyday case: the model emits one null item and nothing
    // else unusual. Before the repair the eviction ran UNCONDITIONALLY, so this
    // input — with no squatter anywhere and nothing for the guard to do — was
    // exactly where the crash was newly reachable.
    const ctx = makeCtx({
      coaching: {
        summary: 'Existing summary',
        strengthen_items: [null, { id: 'llm_item_1', label: 'Add an option', detail: 'Keep me', action_type: 'add_option' }],
        widening_log: { elements_added: [], elements_considered_but_excluded: [], brief_completeness: 'partial' },
        bias_signals: [],
      },
      directionUnresolved: [],
    });

    await runStagePackage(ctx);

    expect(ctx.ceeResponse, 'the package must survive a null coaching entry').toBeDefined();
    expect(cardsOn(ctx).map((i) => String(i.id)), 'the useful item must reach the user').toContain('llm_item_1');
  });
});
