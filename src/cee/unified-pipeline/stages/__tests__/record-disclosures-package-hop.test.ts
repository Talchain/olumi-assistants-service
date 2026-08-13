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

const GRAPH = {
  nodes: [
    { id: 'dec_main', kind: 'decision', label: 'The decision' },
    { id: 'opt_a', kind: 'option', label: 'Continue as-is' },
    { id: 'opt_b', kind: 'option', label: 'Expand' },
    { id: 'fac_gross_margin', kind: 'factor', label: 'Gross margin' },
  ],
  edges: [],
};
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
describe('REV930D — package hop carries record_disclosures onto the V1 payload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupMocks();
  });

  it('REV930D-14 ctx.recordDisclosures reaches ceeResponse.record_disclosures', async () => {
    const disclosures = [
      { claim_index: -1, claim_kind: 'stated_item', label: 'Gross margin', reason: 'constraint_direction_unstated' },
    ];
    const ctx = makeCtx({ recordDisclosures: disclosures, topologyPlan: ['contrast'] });
    await runStagePackage(ctx);
    console.log('REV930D-14 record_disclosures =', JSON.stringify((ctx.ceeResponse as any)?.record_disclosures));
    console.log('REV930D-14 topology_plan (CONTRAST, known-carried) =', JSON.stringify((ctx.ceeResponse as any)?.topology_plan));
    expect((ctx.ceeResponse as any)?.record_disclosures).toEqual(disclosures);
  });

  it('REV930D-15 CONTRAST — an absent ctx key emits no field (not a blanket spread)', async () => {
    const ctx = makeCtx({ recordDisclosures: undefined });
    await runStagePackage(ctx);
    expect((ctx.ceeResponse as any)?.record_disclosures).toBeUndefined();
  });
});
