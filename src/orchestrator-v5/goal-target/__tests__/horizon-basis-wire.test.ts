import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { createHmac, hkdfSync } from 'node:crypto';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { applyGoalSteadyEdit } from '../goal-steady-write.js';
import { horizonBasisProofKey, horizonSteadyAttested } from '../horizon-basis.js';
import { _resetConfigCache } from '../../../config/index.js';
import { runUnifiedPipeline } from '../../../cee/unified-pipeline/index.js';
import type { PipelineStageEvent } from '../../../cee/unified-pipeline/types.js';

const control = vi.hoisted(() => ({ draftGraph: vi.fn(), fallback: '' }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapterWithResolution: () => ({
    adapter: { model: 'claude-sonnet-4-6', name: 'anthropic', draftGraph: control.draftGraph },
    resolution: { task: 'draft_graph', provider: 'anthropic', resolved_model: 'claude-sonnet-4-6', resolution_source: 'default' },
  }),
}));
// Only the model-dependent stages are doubles. Parse/refinement, normalise,
// staged producer, package, boundary, and pipeline terminal/fallback code are real.
vi.mock('../../../cee/unified-pipeline/stages/enrich.js', () => ({ runStageEnrich: vi.fn() }));
vi.mock('../../../cee/unified-pipeline/stages/option-mapping-recovery.js', () => ({ runStageOptionMappingRecovery: vi.fn() }));
vi.mock('../../../cee/unified-pipeline/stages/repair/index.js', () => ({ runStageRepair: vi.fn() }));
vi.mock('../../../cee/unified-pipeline/stages/coaching-pass.js', () => ({ runStageCoachingPass: vi.fn() }));
vi.mock('../../../cee/unified-pipeline/stages/package.js', async original => {
  const actual = await original<typeof import('../../../cee/unified-pipeline/stages/package.js')>();
  return { ...actual, runStagePackage: async (...args: Parameters<typeof actual.runStagePackage>) => {
    if (control.fallback === 'package') throw new Error('test package failure');
    return actual.runStagePackage(...args);
  } };
});
vi.mock('../../../cee/unified-pipeline/stages/boundary.js', async original => {
  const actual = await original<typeof import('../../../cee/unified-pipeline/stages/boundary.js')>();
  return { ...actual, runStageBoundary: async (...args: Parameters<typeof actual.runStageBoundary>) => {
    if (control.fallback === 'boundary') throw new Error('test boundary failure');
    return actual.runStageBoundary(...args);
  } };
});
vi.mock('../../../utils/telemetry.js', async original => ({
  ...await original<typeof import('../../../utils/telemetry.js')>(),
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }, emit: vi.fn(),
}));

const SCENARIO = 'd9e3f4a5-b6c7-4d8e-9f0a-1b2c3d4e5f60';
const SECRET = 's5-r8-wire-test-only';
const base = () => GraphV3.parse({ nodes: [
  { id: 'goal', kind: 'goal', label: 'Service quality', goal_horizon_months: 9, goal_threshold_unit: '%' },
  { id: 'pilot', kind: 'option', label: 'Pilot more coverage' },
  { id: 'hold', kind: 'option', label: 'Keep current coverage' },
  { id: 'factor', kind: 'factor', label: 'Coverage' },
], edges: [{ from: 'factor', to: 'goal', strength: { mean: 0.5, std: 0.1 }, exists_probability: 1, effect_direction: 'positive' }] });

beforeEach(() => {
  vi.stubEnv('CEE_HMAC_SECRET', SECRET);
  vi.stubEnv('CEE_REFINEMENT_ENABLED', 'true');
  vi.stubEnv('CEE_VALIDATION_PIPELINE_ENABLED', 'false');
  vi.stubEnv('CEE_VERIFICATION_PIPELINE_ENABLED', 'false');
  _resetConfigCache(); control.draftGraph.mockReset(); control.fallback = '';
});
afterEach(() => { vi.unstubAllEnvs(); _resetConfigCache(); });

async function produce(schemaVersion: 'v1' | 'v2' | 'v3', fallback = '') {
  const issued = applyGoalSteadyEdit(base(), { goal_id: 'goal', months: 9 }, SCENARIO);
  if (issued.kind !== 'mutated') throw new Error('fixture mint failed');
  // Serialized stored scenario is the actual refinement context, never an inert extra property.
  const stored = JSON.parse(JSON.stringify(issued.mutatedGraph));
  const bytes = JSON.stringify(stored);
  expect(horizonSteadyAttested(stored)).toBe(true);
  control.fallback = fallback;
  control.draftGraph.mockResolvedValue({ graph: { version: '1.2', nodes: base().nodes,
    edges: [{ id: 'edge', from: 'factor', to: 'goal', weight: 0.5, belief: 0.8, provenance_source: 'hypothesis' }] },
    rationales: [], meta: { model: 'claude-sonnet-4-6', prompt_version: 'test' },
    usage: { input_tokens: 1, output_tokens: 1 } });
  const frames: PipelineStageEvent[] = [];
  const result = await runUnifiedPipeline({ brief: 'Improve service quality by piloting more coverage or keeping current coverage.',
    previous_graph: stored }, {}, { id: 'r8-stored-base', headers: {}, query: {} } as FastifyRequest,
    { schemaVersion, requestStartMs: Date.now(), forceDefault: true, onStage: event => frames.push(event) });
  expect(control.draftGraph).toHaveBeenCalledTimes(1);
  expect(control.draftGraph.mock.calls[0]![0].brief).toContain('goal [goal]: Service quality');
  expect(JSON.stringify(stored)).toBe(bytes);
  expect(horizonSteadyAttested(stored)).toBe(true);
  expect(result.statusCode, JSON.stringify(result.body)).toBe(200);
  return { result, frames, stored };
}

describe('S5 r8b non-stored draft producers', () => {
  it.each(['v1', 'v2', 'v3'] as const)('D pipeline GRAPH_READY from stored attested refinement context has no proof (%s)', async version => {
    const { frames, stored } = await produce(version);
    const ready = frames.filter(e => e.kind === 'GRAPH_READY');
    expect(ready).toHaveLength(1);
    expect(JSON.stringify(ready)).not.toContain('"proof"');
    expect(JSON.stringify(ready)).toContain('Service quality');
    expect(stored.nodes.find((n: { id: string }) => n.id === 'goal').horizon_basis.proof).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each(['v1', 'v2', 'v3'] as const)('E assist pipeline terminal from stored attested refinement context has no proof (%s)', async version => {
    const { result } = await produce(version);
    expect(JSON.stringify(result.body)).not.toContain('"proof"');
    expect(JSON.stringify(result.body)).toContain('Service quality');
  });
  it.each(['package', 'boundary'])('E assist terminal %s failure fallback retains no proof from stored context', async fallback => {
    const { result } = await produce('v3', fallback);
    expect(JSON.stringify(result.body)).not.toContain('"proof"');
    expect(JSON.stringify(result.body)).toContain('Service quality');
  });
  it('key uses the real config precedence and HMAC_SECRET fallback, with no new setting', () => {
    vi.stubEnv('HMAC_SECRET', 'test-fallback'); _resetConfigCache();
    expect(horizonBasisProofKey()).toEqual(Buffer.from(hkdfSync('sha256', SECRET, '', 'olumi/s5/horizon_basis/v1', 32)));
    vi.stubEnv('CEE_HMAC_SECRET', undefined); _resetConfigCache();
    const key = horizonBasisProofKey();
    expect(key).toEqual(Buffer.from(hkdfSync('sha256', 'test-fallback', '', 'olumi/s5/horizon_basis/v1', 32)));
    expect(createHmac('sha256', key!).update('tuple').digest('hex')).toHaveLength(64);
    vi.stubEnv('HMAC_SECRET', undefined); _resetConfigCache();
    expect(horizonBasisProofKey()).toBeNull();
  });
});
