/**
 * Real file PMS → prompt snapshot/cache → route resolver → OpenAI adapter →
 * Pass-2 parser → edge comparison. Only the provider SDK is intercepted.
 *
 * The banked PMS v4 bytes were read on 2026-08-30. Replaying them through a
 * hermetic store proves local assembly, not deployment or model behaviour.
 * Authored provider responses test structural carriage, never prose quality.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import servedExport from './fixtures/validate-graph-v4.json';
import { sha256 } from './contract.js';
import { consumeValidation, validationSample, verifyValidationCarriage } from './validation.js';
import { wrapUntrusted } from '../../src/adapters/llm/untrusted-envelope.js';
import { VALIDATION_PIPELINE_TIMEOUT_MS } from '../../src/config/timeouts.js';
import type { PromptAttributionCollector } from '../../src/orchestrator/pipeline/prompt-attribution.js';
import type { Pass2EdgeInput, Pass2NodeInput } from '../../src/cee/validation-pipeline/types.js';

const createSpy = vi.hoisted(() => vi.fn());
vi.mock('openai', () => ({
  default: class ProviderBoundary {
    chat = { completions: { create: createSpy } };
  },
}));

const SERVED_HASH = '45073b566184e4e8a6ce5047378e1d1e51c4e68294f8dd524e26c1219b51f066';
const BRIEF = 'Improve reliable delivery through capacity, demand management and quality.';
const NODES: Pass2NodeInput[] = [
  { id: 'capacity', kind: 'factor', label: 'Capacity' },
  { id: 'demand', kind: 'factor', label: 'Demand' },
  { id: 'quality', kind: 'factor', label: 'Quality' },
  { id: 'goal', kind: 'goal', label: 'Reliable delivery' },
];
const EDGES: Pass2EdgeInput[] = validationSample().edges.map(({ from, to }) => ({ from, to }));
type ProviderRequest = {
  model: string;
  messages: Array<{ role: string; content: string }>;
  response_format?: { type: string; json_schema?: unknown };
};

let directory: string;
const executed: string[] = [];
beforeEach(() => {
  expect.hasAssertions();
  vi.resetModules();
  directory = mkdtempSync(join(tmpdir(), 'validation-prompt-assembly-'));
  vi.stubEnv('OPENAI_API_KEY', 'test-key');
  vi.stubEnv('LLM_PROVIDER', 'openai');
  vi.stubEnv('PROMPTS_ENABLED', 'true');
  vi.stubEnv('PROMPTS_STORE_TYPE', 'file');
  vi.stubEnv('PROMPTS_STORE_PATH', join(directory, 'prompts.json'));
  vi.stubEnv('PROMPTS_USE_STAGING', 'true');
  vi.stubEnv('PROMPT_CACHE_ENABLED', 'false');
  vi.stubEnv('REDIS_PROMPT_CACHE_ENABLED', 'false');
  // No local credentials or model overrides may escape this hermetic route.
  for (const key of [
    'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'PROMPTS_POSTGRES_URL',
    'REDIS_URL', 'CEE_MODEL_VALIDATION', 'LLM_FAILOVER_PROVIDERS',
  ]) vi.stubEnv(key, undefined);
});
afterEach(() => {
  createSpy.mockReset();
  vi.unstubAllEnvs();
  rmSync(directory, { recursive: true, force: true });
});
afterAll(() => {
  // Exact multiset: missing, duplicate, or silently uncollected cases fail.
  expect(executed.sort()).toEqual(['bound-uncertainty', 'ignored-std', 'missing-std', 'unrelated-content']);
});

async function prepare(raw: unknown = validationSample()) {
  const at = '2026-08-30T00:00:00.000Z';
  const decoy = 'Unselected production version: a porcelain teapot.';
  writeFileSync(join(directory, 'prompts.json'), JSON.stringify({
    version: 1, lastModified: at,
    prompts: {
      validate_graph_default: {
        id: servedExport.promptId, taskId: servedExport.taskId, name: 'Hermetic validation assembly',
        status: 'production', activeVersion: 3, stagingVersion: servedExport.version,
        versions: [
          { version: 3, content: decoy, contentHash: sha256(decoy), createdBy: 'test', createdAt: at },
          { version: servedExport.version, content: servedExport.content, contentHash: servedExport.hash, createdBy: 'test', createdAt: at },
        ],
        // This route does not bind store model pins. The real router default
        // must win; merely reading this record is not model-resolution proof.
        modelConfig: { staging: 'gpt-4o-mini', production: 'gpt-4o-mini' },
        createdAt: at, updatedAt: at,
      },
    },
  }));
  const { initializePromptStore } = await import('../../src/prompts/store.js');
  await initializePromptStore();
  createSpy.mockResolvedValue({
    choices: [{ message: { content: JSON.stringify(raw) }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 200 },
  });
  const { PromptAttributionCollector: Collector } = await import('../../src/orchestrator/pipeline/prompt-attribution.js');
  const attribution = new Collector();
  const { callValidateGraph } = await import('../../src/cee/validation-pipeline/validate-graph.js');
  return {
    attribution,
    call: () => callValidateGraph(BRIEF, NODES, EDGES, {
      requestId: `validation-assembly-${executed.at(-1)}`,
      timeoutMs: VALIDATION_PIPELINE_TIMEOUT_MS,
      bypassCache: true,
    }, attribution),
  };
}

async function assertBoundRequest(attribution: PromptAttributionCollector) {
  expect(createSpy).toHaveBeenCalledOnce();
  expect(servedExport).toMatchObject({ taskId: 'validate_graph', promptId: 'validate_graph_default', version: 4, hash: SERVED_HASH });
  expect(sha256(servedExport.content)).toBe(SERVED_HASH);
  const body = createSpy.mock.calls[0]![0] as ProviderRequest;
  const { getSystemPromptSnapshot } = await import('../../src/adapters/llm/prompt-loader.js');
  const selected = await getSystemPromptSnapshot('validate_graph');
  expect(selected.content).toBe(servedExport.content);
  expect(selected.meta).toMatchObject({
    taskId: 'validate_graph', promptId: servedExport.promptId, version: 4,
    prompt_hash: SERVED_HASH, source: 'store', isStaging: true,
  });
  expect(body.messages).toEqual([
    { role: 'system', content: selected.content },
    { role: 'user', content: JSON.stringify({ brief: wrapUntrusted('', BRIEF), nodes: NODES, edges: EDGES }, null, 2) },
  ]);
  const { getDefaultModelForTask } = await import('../../src/config/model-routing.js');
  expect(getDefaultModelForTask('validate_graph')).toBe('o4-mini');
  expect(body.model).toBe(getDefaultModelForTask('validate_graph'));
  expect(body.model).not.toBe('gpt-4o-mini');
  // Actual provider request, not the probe's local wire descriptor. JSON
  // object mode does not attach a JSON schema or enforce required fields.
  expect(body.response_format).toEqual({ type: 'json_object' });
  expect(body.response_format).not.toHaveProperty('json_schema');
  expect(body).not.toHaveProperty('output_config');
  const trace = attribution.snapshot();
  expect(trace.llm_calls).toHaveLength(1);
  expect(trace.llm_calls[0]).toMatchObject({ role: 'validate_graph', provider: 'openai', model: body.model });
  expect(trace.prompt_identity).toEqual([{
    task_id: 'validate_graph', prompt_id: servedExport.promptId,
    version: selected.meta.prompt_version, hash: sha256(body.messages[0]!.content), source: 'store',
  }]);
}

describe('validate_graph provider-bound prompt and uncertainty carriage', () => {
  it('binds the elected PMS bytes and JSON-object request to parsed, consumed uncertainty', async () => {
    executed.push('bound-uncertainty');
    const attempt = await prepare();
    const parsed = await attempt.call();
    await assertBoundRequest(attempt.attribution);
    expect(parsed).toEqual(validationSample());
    expect(parsed.edges.map(({ from, to }) => ({ from, to }))).toEqual(EDGES);
    expect(() => verifyValidationCarriage(consumeValidation(parsed), parsed)).not.toThrow();
  });

  it('RED: a provider response missing std reaches the real parser and is rejected', async () => {
    executed.push('missing-std');
    const missing = validationSample() as unknown as { edges: Array<{ strength: Record<string, number> }> };
    delete missing.edges[0]!.strength.std;
    const attempt = await prepare(missing);
    await expect(attempt.call()).rejects.toThrow('edges[0].std must be a finite number');
    await assertBoundRequest(attempt.attribution);
  });

  it('RED: ignoring parsed uncertainty fails the same actual edge-comparison verifier', async () => {
    executed.push('ignored-std');
    const attempt = await prepare();
    const parsed = await attempt.call();
    await assertBoundRequest(attempt.attribution);
    expect(() => verifyValidationCarriage(consumeValidation(parsed), parsed)).not.toThrow();
    expect(() => verifyValidationCarriage(consumeValidation(parsed, true), parsed)).toThrow();
  });

  it('GREEN: unrelated rationale content is carried without weakening the uncertainty relationship', async () => {
    executed.push('unrelated-content');
    const unrelated = validationSample();
    unrelated.edges[0]!.reasoning = 'Museum capacity is independently estimated; a porcelain teapot is incidental.';
    const attempt = await prepare(unrelated);
    const parsed = await attempt.call();
    await assertBoundRequest(attempt.attribution);
    expect(parsed).toEqual(unrelated);
    expect(() => verifyValidationCarriage(consumeValidation(parsed), unrelated)).not.toThrow();
  });
});
