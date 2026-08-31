/**
 * Executes the adapter -> parse -> package disclosure path and the real
 * pipeline's early exit. The adapter fixture is already quarantined; the
 * producer's identification/removal is tested separately in option-framing.
 * No provider, persistence, or browser is involved.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { PipelineOutcome, StageContext } from '../../types.js';

const { draftGraph, normalise } = vi.hoisted(() => ({
  draftGraph: vi.fn(),
  normalise: vi.fn(async () => { throw new Error('An incomplete choice set reached normalise'); }),
}));

vi.mock('../../../../adapters/llm/router.js', () => ({
  getAdapterWithResolution: () => ({
    adapter: { model: 'claude-sonnet-4-6', name: 'anthropic', draftGraph },
    resolution: { task: 'draft_graph', provider: 'anthropic', resolved_model: 'claude-sonnet-4-6', resolution_source: 'default' },
  }),
}));
// Tripwire after the REAL parse stage: if its early exit regresses, later
// production stages cannot run an external call while this test fails.
vi.mock('../normalise.js', () => ({ runStageNormalise: normalise }));
vi.mock('../../../../utils/telemetry.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../../utils/telemetry.js')>(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: {},
}));

import { runStageParse } from '../parse.js';
import { runStagePackage } from '../package.js';
import { runStageBoundary } from '../boundary.js';
import { runUnifiedPipeline } from '../../index.js';
import { createCorrectionCollector } from '../../../corrections.js';

const QUESTION = 'We need to decide whether to raise prices 15% next quarter';
const BRIEF = `${QUESTION}. We are also considering reducing prices 5%.`;
const GAP = { reason: 'decision_framing_not_an_option', node_id: 'opt_question', label: QUESTION };

const OPTIONS = [
  {
    id: 'opt_raise', kind: 'option', label: 'Raise prices 15%', is_baseline: false,
    provenance: { provenance_class: 'stated', source_quote: 'raise prices 15%', label_authored: true },
    data: { interventions: { fac_price: 0.575 }, raw_interventions: { fac_price: 1.15 },
      intervention_details: { fac_price: { display_value: '1.15', normalised_value: 0.575, raw_value: 1.15 } } },
  },
  {
    id: 'opt_reduce', kind: 'option', label: 'Reduce prices 5%', is_baseline: false,
    provenance: { provenance_class: 'stated', source_quote: 'reducing prices 5%', label_authored: true },
    data: { interventions: { fac_price: 0.475 }, raw_interventions: { fac_price: 0.95 },
      intervention_details: { fac_price: { display_value: '0.95', normalised_value: 0.475, raw_value: 0.95 } } },
  },
];

function adapterResult(optionCount = 2, disclosures: unknown[] = [GAP]) {
  return {
    graph: {
      version: '1.2',
      nodes: [
        { id: 'dec_pricing', kind: 'decision', label: 'Pricing strategy' },
        ...structuredClone(OPTIONS.slice(0, optionCount)),
        { id: 'fac_price', kind: 'factor', label: 'Price multiplier' },
        { id: 'goal_arr', kind: 'goal', label: 'Grow recurring revenue' },
      ],
      edges: [{ id: 'edge_price_arr', from: 'fac_price', to: 'goal_arr', weight: 0.7, belief: 0.8, provenance_source: 'hypothesis' }],
    },
    rationales: [],
    record_disclosures: structuredClone(disclosures),
    meta: { model: 'claude-sonnet-4-6', prompt_version: 'v-test' },
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

function makeCtx(): StageContext {
  return {
    requestId: 'option-framing-stage-test',
    input: { brief: BRIEF }, effectiveBrief: BRIEF, rawBody: {},
    opts: { schemaVersion: 'v3', requestStartMs: Date.now() },
    start: Date.now(), rationales: [],
    transforms: [], riskCoefficientCorrections: [], nodeRenames: new Map(),
    collector: createCorrectionCollector(), pipelineCheckpoints: [], stageSnapshots: {},
    pipelineOutcome: {
      graph_drafted: true, graph_structurally_valid: true, deterministic_sweep_violations: 0,
      verification_status: 'skipped', validation_status: 'skipped', enrichment_status: 'skipped',
      coaching_status: 'partial', warnings: [], rescue_score: 0,
      factor_value_coverage: { total: 0, explicit: 0, inferred_with_evidence: 0, fallback_default: 0 },
      edge_strength_unique_count: 0,
      llm_repair: { triggered: false, outcome: 'skipped', fallback_reason: null, attempts: 0 },
      repair_provenance: [],
    } satisfies PipelineOutcome,
  } as unknown as StageContext;
}

describe('option framing recovery across production stages', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it('preserves two real alternatives and carries the explicit gap into packaged warnings', async () => {
    const draft = adapterResult();
    draftGraph.mockResolvedValue(draft);
    const ctx = makeCtx();
    await runStageParse(ctx);

    expect(ctx.earlyReturn).toBeUndefined();
    expect(ctx.recordDisclosures).toEqual([GAP]);
    expect(ctx.graph).toEqual(draft.graph);
    await runStagePackage(ctx);

    const body = ctx.ceeResponse as Record<string, any>;
    expect(ctx.earlyReturn).toBeUndefined();
    expect(body.graph.nodes.filter((n: any) => n.kind === 'option')).toEqual(OPTIONS);
    expect(body.graph.edges).toEqual(draft.graph.edges);
    expect(body.record_disclosures).toEqual([GAP]);
    const warning = body.draft_warnings.find((w: any) => w.id === 'QUESTION_NOT_AN_OPTION');
    expect(warning).toMatchObject({ severity: 'medium' });
    expect(warning.explanation).toContain(QUESTION);
    expect(warning.explanation).toMatch(/excluded from the comparison/i);
    expect(warning.fix_hint).toMatch(/clarify.*alternatives/i);
    expect(warning.fix_hint).toMatch(/no baseline has been invented/i);
    expect(ctx.draftWarnings).toContainEqual(warning);
    expect(body.graph.nodes.some((n: any) => n.id === GAP.node_id || n.is_baseline === true)).toBe(false);

    // The final schema projection must not silently discard either the exact
    // human-readable warning or the source disclosure before the tool reads it.
    await runStageBoundary(ctx);
    expect(ctx.earlyReturn).toBeUndefined();
    expect((ctx.finalResponse as Record<string, any>).draft_warnings).toContainEqual(warning);
    expect((ctx.finalResponse as Record<string, any>).record_disclosures).toEqual([GAP]);
  });

  it.each([0, 1])('stops %i remaining alternatives before normalise or GRAPH_READY, with targeted recovery', async (count) => {
    draftGraph.mockResolvedValue(adapterResult(count));
    const onStage = vi.fn();
    const result = await runUnifiedPipeline(
      { brief: BRIEF }, {},
      { id: 'option-framing-pipeline-test', headers: {}, query: {} } as FastifyRequest,
      { schemaVersion: 'v3', requestStartMs: Date.now(), onStage },
    );

    expect(result.statusCode).toBe(400);
    expect(result.body).toMatchObject({
      code: 'CEE_GRAPH_INVALID', retryable: true, reason: 'option_framing_incomplete',
      details: { unresolved_framing: [{ node_id: GAP.node_id, label: QUESTION }] },
      recovery: { hints: expect.arrayContaining([expect.stringMatching(/at least two courses of action/i)]) },
      recovery_suggestion: expect.stringMatching(/without inventing one/i),
    });
    expect(draftGraph).toHaveBeenCalledTimes(1);
    expect(normalise).not.toHaveBeenCalled();
    expect(onStage.mock.calls.some(([event]) => event.kind === 'GRAPH_READY')).toBe(false);
    expect(result.body).not.toHaveProperty('graph');
    expect(result.body).not.toHaveProperty('draft_graph');
    expect(result.body).not.toHaveProperty('analysis_ready');
  });

  it('does not classify unrelated disclosures or baseline absence as framing gaps', async () => {
    const unrelated = { reason: 'option_budget_exceeded', node_id: 'unrelated', label: QUESTION };
    draftGraph.mockResolvedValue(adapterResult(1, [unrelated]));
    const ctx = makeCtx();
    await runStageParse(ctx);
    expect(ctx.earlyReturn).toBeUndefined();
    await runStagePackage(ctx);
    expect(ctx.draftWarnings.some((w) => w.id === 'QUESTION_NOT_AN_OPTION')).toBe(false);
    expect((ctx.ceeResponse as Record<string, any>).record_disclosures).toEqual([unrelated]);
  });
});
