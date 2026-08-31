import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildLlmMetadataProjection } from '../../src/cee/unified-pipeline/llm-metadata-projection.js';
import { buildV5DiagnosticTrace } from '../../src/orchestrator-v5/diagnostics/v5-diagnostic-trace.js';
import { __test_only as draftTool } from '../../src/orchestrator/tools/draft-graph.js';
import { computeResponseHash } from '../../src/utils/response-hash.js';
import { assertExactCaseIds, sha256 } from './contract.js';
import { evaluateResponseIdentity, isResponseIdentityReport, type ResponseCapture } from './response-identity.js';
import type { ServingConfiguration } from './serving-evidence.js';

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const historical = JSON.parse(read('src/cee/context-integrity/__tests__/fixtures/b3-product-bet.cold-read.json'));
const source = (path: string, exportName: string) => ({ path, exportName, fileSha256: sha256(read(path)) });
// Expected component identities are test inputs, NOT assertions about the historical build's execution.
const configuration: ServingConfiguration = {
  task: 'draft_graph', sourceHead: '4b57b8ffc8eaef1235370e83c338d1d2b8e604b6',
  prompt: { id: 'draft_graph_default', version: 195, sha256: sha256(read('src/cee/draft/records/__tests__/fixtures/served-draft-graph-v195.txt')) },
  instructionSha256: null, model: { id: 'claude-sonnet-4-6', provider: 'anthropic' },
  schema: { ...source('src/cee/draft/records/grammar.ts', 'buildDraftRecordsSchema'), artifactSha256: null },
  parser: source('src/cee/draft/records/seam.ts', 'DraftRecordSetWire'),
  projector: source('src/cee/draft/records/projector.ts', 'projectRecordsToGraph'),
  consumer: source('src/adapters/llm/shared-schemas.ts', 'LLMDraftResponse'),
};
const collected: string[] = [], originalFlag = process.env.CEE_DIAGNOSTIC_TRACE_ENABLED;
beforeEach(() => { expect.hasAssertions(); process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = 'true'; });
afterEach(() => { if (originalFlag === undefined) delete process.env.CEE_DIAGNOSTIC_TRACE_ENABLED; else process.env.CEE_DIAGNOSTIC_TRACE_ENABLED = originalFlag; });
afterAll(() => assertExactCaseIds(['historical', 'projection', 'prompt', 'model', 'missing', 'v5', 'association', 'capture', 'build', 'issued', 'partial', 'ambiguous'], collected));
function capture(body: unknown, v5 = false): ResponseCapture {
  const text = JSON.stringify(body);
  return { observedAt: '2026-08-08T17:00:00Z', url: `https://simulation.invalid${v5 ? '/proxy/v5/turn' : '/assist/v1/draft-graph'}`,
    httpStatus: 200, requestId: 'simulation-request', body: text, bodySha256: sha256(text) };
}
function v1() {
  return { metadata: { object: 'teapot' }, trace: { request_id: 'simulation-request', correlation_id: 'simulation-request',
    engine: { provider: 'anthropic' }, pipeline: { llm_metadata: { ...buildLlmMetadataProjection({
      model: configuration.model.id, prompt_version: 'draft_graph_default@v195 (staging)', prompt_hash: configuration.prompt.sha256,
      instance_id: 'simulation-instance', cache_age_ms: 120, cache_status: 'fresh', structured_outputs_used: true,
    }, undefined) }, cee_provenance: { commit: configuration.sourceHead.slice(0, 8) } } } };
}
function v5() {
  // Real production extractor and diagnostic builder; no provider/model response is invented.
  const toolLLMTelemetry = draftTool.extractToolLLMTelemetry(v1());
  const trace = buildV5DiagnosticTrace({ startedAt: Date.now(), persistenceMs: 0, requestId: 'simulation-request',
    scenarioId: 'simulation-scenario', turnId: 'simulation-turn', commitResult: {} as never,
    draftResult: { blocks: [], assistantText: null, latencyMs: 0, strengthenItems: [], coachingSummary: null,
      coachingWideningLog: null, coachingBiasSignals: null, draftWarnings: [], graphOutput: null, toolLLMTelemetry } });
  if (!trace) throw new Error('actual V5 diagnostic builder did not participate');
  const body = { assistant_text: 'Simulation body only', blocks: [] };
  return { ...body, _diagnostic_trace: { ...trace, environment: {}, correlation_ids: { ...trace.correlation_ids, response_hash: computeResponseHash(body) } } };
}
const evaluate = (raw: ResponseCapture, expected = configuration) => evaluateResponseIdentity({ configuration: expected, capture: raw, mode: 'simulation' });
describe('existing-wire draft response identity, never invented provider attestation', () => {
  it('replays unchanged historical cold-read graph metadata without relabelling it as a fresh response', () => {
    collected.push('historical');
    expect(historical._provenance.seam).toBe('POST /bff/cee/scenarios/:id/graph (cold read)');
    const raw = capture(historical.graph); raw.requestId = historical.graph.trace.request_id;
    const report = evaluate(raw);
    expect(report.mode).toBe('simulation');
    expect(report.rung).toMatch(/^SIMULATION/);
    expect(report.levels.selectedPrompt.status).toBe('PASS');
    expect(report.actual.prompt).toEqual(configuration.prompt);
    expect(report.instanceId).toBe('f67dc9b4');
    expect(report.actual.cacheAgeMs).toBe(274909);
    expect(report.sourceHead).toBeNull();
    expect(report.status).toBe('UNVERIFIED');
    expect(report.levels.consumer.status).toBe('UNVERIFIED');
  });
  it('uses actual safe metadata projection and never promotes a structured flag into grammar or execution proof', () => {
    collected.push('projection');
    const body = v1(), report = evaluate(capture(body));
    expect(body.trace.pipeline.llm_metadata.prompt_hash).toBe(configuration.prompt.sha256);
    expect(report.levels.binding.status).toBe('PASS');
    expect(report.levels.selectedPrompt.status).toBe('PASS');
    expect(report.levels.requestedModel.status).toBe('PASS');
    for (const name of ['providerBound', 'instruction', 'schema', 'parser', 'projector', 'consumer'] as const) expect(report.levels[name].status).toBe('UNVERIFIED');
    expect(report.issues.join(' ')).toContain('file integrity, not server authenticity');
  });
  it.each(['prompt', 'model'] as const)('RED wrong %s identity; GREEN unrelated metadata with the same real projection', kind => {
    collected.push(kind);
    const broken = v1();
    if (kind === 'prompt') broken.trace.pipeline.llm_metadata.prompt_hash = sha256('unrelated prompt');
    else broken.trace.pipeline.llm_metadata.model = 'wrong-model';
    const bad = evaluate(capture(broken));
    expect(bad.status).toBe('FAIL');
    expect(bad.levels[kind === 'prompt' ? 'selectedPrompt' : 'requestedModel'].status).toBe('FAIL');
    const unrelated = v1(); unrelated.metadata.object = 'bicycle';
    const good = evaluate(capture(unrelated));
    expect(good.levels.selectedPrompt.status).toBe('PASS');
    expect(good.levels.requestedModel.status).toBe('PASS');
    expect(good.status).toBe('UNVERIFIED');
  });
  it('keeps missing IDs and telemetry unknown instead of filling them from configuration', () => {
    collected.push('missing');
    const report = evaluate(capture({ assistant_text: 'A teapot says confidence.' }));
    expect(report.status).toBe('UNVERIFIED');
    expect(report.requestId).toBeNull();
    expect(report.instanceId).toBeNull();
    expect(report.actual).toEqual({ prompt: { id: null, version: null, sha256: null }, requestedModel: null, provider: null, cacheAgeMs: null, cacheStatus: null });
    expect(Object.values(report.levels).every(level => level.status === 'UNVERIFIED')).toBe(true);
    const body = v1(); delete body.trace.pipeline.llm_metadata.prompt_version;
    expect(evaluate(capture(body)).levels.selectedPrompt.status).toBe('UNVERIFIED');
    expect(evaluate({ ...capture(v1()), requestId: '' }).levels.binding.status).toBe('UNVERIFIED');
  });
  it('decodes the actual V5 builder/extractor, with hardcoded provider and absent instance still unverified', () => {
    collected.push('v5');
    const body = v5(), report = evaluate(capture(body, true));
    expect(body._diagnostic_trace.llm_calls[0]?.provider).toBe('anthropic');
    expect(body._diagnostic_trace.prompt_identity[0]?.prompt_id).toBe('draft_graph_default@v195 (staging)');
    expect(report.levels.binding.status).toBe('PASS');
    expect(report.levels.selectedPrompt.status).toBe('PASS');
    expect(report.levels.requestedModel.status).toBe('PASS');
    expect(report.levels.providerBound.status).toBe('UNVERIFIED');
    expect(report.instanceId).toBeNull();
    expect(report.status).toBe('UNVERIFIED');
  });
  it('RED trace substitution or changed wire body; GREEN unrelated trace timing metadata', () => {
    collected.push('association');
    const body = v5(); body.assistant_text = 'Changed without updating the server response hash';
    expect(evaluate(capture(body, true)).levels.binding.status).toBe('FAIL');
    const substituted = v5(); substituted._diagnostic_trace.correlation_ids.request_id = 'other-request';
    expect(evaluate(capture(substituted, true)).status).toBe('FAIL');
    const unrelated = v5(); unrelated._diagnostic_trace.benchmarking.total_duration_ms = 321;
    expect(evaluate(capture(unrelated, true)).levels.binding.status).toBe('PASS');
    const contradicted = v1(); contradicted.trace.correlation_id = 'other-request';
    expect(evaluate(capture(contradicted)).levels.binding.status).toBe('FAIL');
  });
  it('rejects malformed JSON, checksum/endpoint/HTTP mismatch and cross-family trace grafts', () => {
    collected.push('capture');
    const good = capture(v1());
    for (const changed of [{ ...good, body: '{', bodySha256: sha256('{') }, { ...good, bodySha256: sha256('wrong') },
      { ...good, url: 'https://simulation.invalid/admin/prompts/verify' }, { ...good, httpStatus: 500 },
      { ...capture(v5()), url: good.url }, { ...good, observedAt: 'invalid' }]) expect(evaluate(changed).levels.binding.status).toBe('FAIL');
    expect(evaluate(good).levels.selectedPrompt.status).toBe('PASS');
  });
  it('requires explicit full build identity and refuses contradictory source while leaving components unobserved', () => {
    collected.push('build');
    const raw = capture(v1());
    expect(evaluate(raw).levels.build.status).toBe('UNVERIFIED');
    const good = evaluate({ ...raw, serviceBuild: configuration.sourceHead });
    expect(good.sourceHead).toBe(configuration.sourceHead);
    expect(good.levels.build.status).toBe('PASS');
    expect(good.levels.build.issues.join(' ')).toContain('source-derived');
    expect(good.levels.parser.status).toBe('UNVERIFIED');
    const wrong = evaluate({ ...raw, serviceBuild: 'f'.repeat(40) });
    expect(wrong.levels.build.status).toBe('FAIL');
    expect(wrong.sourceHead).toBe('f'.repeat(40));
    expect(wrong.levels.build.issues.join(' ')).toContain(`conflicting observed build identities: ${'f'.repeat(40)} / ${configuration.sourceHead.slice(0, 8)}`);
  });
  it('issues immutable process-local reports, not serializable PASS certificates', () => {
    collected.push('issued');
    const report = evaluate(capture(v1()));
    expect(isResponseIdentityReport(report)).toBe(true);
    expect(isResponseIdentityReport(JSON.parse(JSON.stringify(report)))).toBe(false);
    expect(Object.isFrozen(report.actual.prompt)).toBe(true);
    expect(Object.isFrozen(report.levels.binding.issues)).toBe(true);
    expect(() => { report.actual.prompt.id = 'forged'; }).toThrow();
  });
  it('keeps matching partial digests unknown and rejects known prefix conflicts; invented execution metadata grants nothing', () => {
    collected.push('partial');
    const body = v1(); body.trace.pipeline.llm_metadata.prompt_hash = configuration.prompt.sha256.slice(0, 16);
    expect(evaluate(capture(body)).levels.selectedPrompt.status).toBe('UNVERIFIED');
    body.trace.pipeline.llm_metadata.prompt_hash = 'f'.repeat(16);
    expect(evaluate(capture(body)).levels.selectedPrompt.status).toBe('FAIL');
    const invented = v1(); Object.assign(invented.trace.pipeline.llm_metadata, { provider_bound: true, parser_verified: true, instruction_sha256: configuration.prompt.sha256 });
    expect(evaluate(capture(invented)).levels.providerBound.status).toBe('UNVERIFIED');
    expect(evaluate(capture(invented)).levels.instruction.status).toBe('UNVERIFIED');
    expect(evaluate(capture(invented)).levels.parser.status).toBe('UNVERIFIED');
  });
  it('keeps uncorrelated same-identity duplicates unknown, rejects contradictory calls and requires the draft exit', () => {
    collected.push('ambiguous');
    const body = v5(); body._diagnostic_trace.llm_calls.push({ ...body._diagnostic_trace.llm_calls[0]! });
    expect(evaluate(capture(body, true)).levels.requestedModel.status).toBe('UNVERIFIED');
    expect(evaluate(capture(body, true)).levels.selectedPrompt.status).toBe('UNVERIFIED');
    body._diagnostic_trace.llm_calls[1]!.model = 'wrong-model';
    expect(evaluate(capture(body, true)).levels.requestedModel.status).toBe('FAIL');
    const missing = v5(); delete (missing._diagnostic_trace as Partial<typeof missing._diagnostic_trace>).exit_path;
    expect(evaluate(capture(missing, true)).levels.binding.status).toBe('UNVERIFIED');
    const wrong = v5(); wrong._diagnostic_trace.exit_path = 'turn_executor';
    expect(evaluate(capture(wrong, true)).levels.binding.status).toBe('FAIL');
  });
});
