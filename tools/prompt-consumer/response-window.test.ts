import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildLlmMetadataProjection } from '../../src/cee/unified-pipeline/llm-metadata-projection.js';
import { DRAFT_RECORDS_INSTRUCTION } from '../../src/cee/draft/records/instruction.js';
import { buildDraftRecordsSchema } from '../../src/cee/draft/records/grammar.js';
import { sha256 } from './contract.js';
import { buildResponseIdentityPacket } from './quality-report.js';
import { evaluateServingEvidence, type ServingConfiguration, type ServingEvidenceInput } from './serving-evidence.js';
import { buildPromotionEvidencePacket } from './promotion-packet.js';

const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
// Independent regression from programme-docs 26fae0d0636cf959aaa20f09faa8495d94674606;
// originally reproduced at 1e2dd143. Rebind source identity to each tested head.
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const component = (path: string, exportName: string) => ({ path, exportName, fileSha256: sha256(read(path)) });
const config: ServingConfiguration = {
  task: 'draft_graph', sourceHead: head,
  prompt: { id: 'draft_graph_default', version: 195, sha256: sha256(read('src/cee/draft/records/__tests__/fixtures/served-draft-graph-v195.txt')) },
  instructionSha256: sha256(DRAFT_RECORDS_INSTRUCTION), model: { provider: 'anthropic', id: 'claude-sonnet-4-6' },
  schema: { ...component('src/cee/draft/records/grammar.ts', 'buildDraftRecordsSchema'), artifactSha256: sha256(JSON.stringify(buildDraftRecordsSchema())) },
  parser: component('src/cee/draft/records/seam.ts', 'projectDraftRecords'),
  projector: component('src/cee/draft/records/projector.ts', 'projectRecordsToGraph'),
  consumer: component('src/adapters/llm/shared-schemas.ts', 'LLMDraftResponse.parse'),
};
const previous = { ...config.prompt, version: 194, sha256: sha256('Explicitly synthetic predecessor prompt') };
const start = '2026-08-31T09:00:00Z', end = '2026-08-31T09:20:00Z';
// These are fabricated captures through the actual metadata producer. Nothing
// in this test asserts that these responses were received from staging.
function capture(id: string, at: string, prompt = config.prompt, annotation = 'blue cup') {
  const promptVersion = `${prompt.id}@v${prompt.version} (staging)`;
  const body = JSON.stringify({ annotation, trace: { request_id: id, correlation_id: id,
    engine: { model: config.model.id, provider: config.model.provider },
    pipeline: { llm_metadata: buildLlmMetadataProjection({ model: config.model.id,
      prompt_version: promptVersion, prompt_hash: prompt.sha256, instance_id: 'instance-A',
      cache_age_ms: 10, cache_status: 'fresh' }, undefined),
    cee_provenance: { commit: head, prompt_version: promptVersion, prompt_hash: prompt.sha256, prompt_store_version: prompt.version } },
  } });
  return { observedAt: at, url: 'https://simulation.invalid/assist/v1/draft-graph', httpStatus: 200,
    requestId: id, body, bodySha256: sha256(body), serviceBuild: head };
}
type Capture = ReturnType<typeof capture>;
const current = () => [capture('after-1', start), capture('after-2', end)];
function through(captures: Capture[], cutoff: string | null = start, mode: 'simulation' | 'observed' = 'simulation') {
  const packet = buildResponseIdentityPacket({ format: 'olumi.prompt-response-observations.v1', mode, configuration: config, captures,
    settling: cutoff === null ? null : { notBefore: cutoff, effectiveExpiryMs: 600_000,
      source: component('src/adapters/llm/prompt-loader.ts', 'getPromptLoaderCacheDiagnostics') } });
  return consume(packet);
}
function consume(packet: ReturnType<typeof buildResponseIdentityPacket>, overrides: Partial<ServingEvidenceInput> = {}) {
  const serving = evaluateServingEvidence({ configuration: config, mode: packet.mode, observations: [], cacheWindow: null,
    responses: packet.responses, responseFleet: packet.fleet, ...overrides });
  const promotion = buildPromotionEvidencePacket({ mode: packet.mode, incumbent: { ...config, prompt: previous },
    candidate: config, evaluations: {}, cacheTransitions: { candidate: serving } });
  return { packet, serving, promotion };
}
const summaries: unknown[] = [];
const names: string[] = [];
beforeEach(() => expect.hasAssertions());
function retain(name: string, result: ReturnType<typeof through>) {
  summaries.push({ name, responsePacket: result.packet.status, sample: result.packet.fleet.sampledInstanceStatus,
    state: result.packet.fleet.state, all: result.packet.responses.length,
    excluded: result.packet.fleet.excludedBeforeCutoff.map(r => r.requestId),
    window: result.packet.fleet.windowResponses.map(r => r.requestId),
    servingActual: result.serving.actualResponse.status, servingSelection: result.serving.actualResponseSelection.status,
    servingFleet: result.serving.fleet.status, candidateCache: result.promotion.checks.candidateCache.status,
    promotion: result.promotion.status, issues: result.promotion.checks.candidateCache.issues,
    permission: result.promotion.deploymentPermission });
}
afterAll(() => {
  assert.deepEqual(names, ['current-control', 'history-window-binding', 'inside-window-failure', 'missing-cutoff-failure', 'annotation-control',
    'full-history-binding', 'current-duplicate-contradiction', 'fleet-authority', 'historical-integrity', 'empty-current-window', 'missing-fleet-no-cutoff', 'observed-status-window']);
  console.log('CODEX1271_WINDOW=' + JSON.stringify({ head, scope: 'Synthetic captures through real decoder/fleet/serving/promotion; no network', summaries }));
});
describe('CODEX1271 historical evidence must not become current-window contradiction', () => {
  it('current-control', () => {
    names.push('current-control'); const r = through(current()); retain('current-control', r);
    expect(r.packet.fleet.sampledInstanceStatus).toBe('PASS');
    expect(r.packet.status).toBe('UNVERIFIED');
    expect(r.serving.actualResponse.status).toBe('UNVERIFIED');
    expect(r.promotion.checks.candidateCache.status).toBe('UNVERIFIED');
    expect(r.promotion.deploymentPermission).toBe('NOT_GRANTED');
  });
  it('history-window-binding', () => {
    names.push('history-window-binding');
    const r = through([capture('before-change', '2026-08-31T08:59:00Z', previous), ...current()]); retain('history-window-binding', r);
    expect(r.packet.responses).toHaveLength(3);
    expect(r.serving.responseIdentities).toEqual(r.packet.responses);
    expect(r.packet.fleet.excludedBeforeCutoff.map(x => x.requestId)).toEqual(['before-change']);
    expect(r.packet.fleet.sampledInstanceStatus).toBe('PASS');
    expect(r.packet.status).toBe('UNVERIFIED');
    // Current window is coherent; missing provider proof stays UNKNOWN. The
    // retained predecessor is expected history, not a current-cache failure.
    expect.soft(r.serving.actualResponse.status).toBe('UNVERIFIED');
    expect.soft(r.serving.actualResponseSelection.status).toBe('PASS');
    expect.soft(r.promotion.checks.candidateCache.status).toBe('UNVERIFIED');
  });
  it('inside-window-failure', () => {
    names.push('inside-window-failure');
    const r = through([capture('stale-current', '2026-08-31T09:10:00Z', previous), ...current()]); retain('inside-window-failure', r);
    expect(r.packet.fleet.state).toBe('MIXED');
    expect(r.packet.status).toBe('FAIL');
    expect(r.serving.actualResponse.status).toBe('FAIL');
    expect(r.promotion.checks.candidateCache.status).toBe('FAIL');
  });
  it('missing-cutoff-failure', () => {
    names.push('missing-cutoff-failure');
    const r = through([capture('before-unknown-action', '2026-08-31T08:59:00Z', previous), ...current()], null); retain('missing-cutoff-failure', r);
    expect(r.packet.fleet.state).toBe('MIXED');
    expect(r.promotion.checks.candidateCache.status).toBe('FAIL');
  });
  it('annotation-control', () => {
    names.push('annotation-control');
    const r = through([capture('irrelevant-prior-note', '2026-08-31T08:59:00Z', config.prompt, 'unrelated bicycle'), ...current()]); retain('annotation-control', r);
    expect(r.packet.fleet.excludedBeforeCutoff).toHaveLength(1);
    expect(r.packet.fleet.sampledInstanceStatus).toBe('PASS');
    expect(r.serving.actualResponse.status).toBe('UNVERIFIED');
    expect(r.promotion.checks.candidateCache.status).toBe('UNVERIFIED');
  });
  it('full-history-binding', () => {
    names.push('full-history-binding');
    const full = through([capture('retained-before', '2026-08-31T08:59:00Z', previous), ...current()]);
    // Neither side may filter away history to make receipt collections match.
    for (const overrides of [{ responses: full.packet.fleet.windowResponses }, { responseFleet: through(current()).packet.fleet }]) {
      const r = consume(full.packet, overrides); retain('full-history-binding', r);
      expect(r.serving.fleet.status).toBe('FAIL');
      expect(r.serving.fleet.issues).toContain('Fleet evidence and actual response collection disagree');
      expect(r.promotion.checks.candidateCache.status).toBe('FAIL');
    }
    expect(full.serving.actualResponseSelection.status).toBe('PASS');
  });
  it('current-duplicate-contradiction', () => {
    names.push('current-duplicate-contradiction');
    const [first, second] = current();
    const conflict = { ...first!, serviceBuild: 'f'.repeat(40) };
    for (const captures of [[first!, conflict, second!], [conflict, first!, second!]]) {
      const r = through(captures); retain('current-duplicate-contradiction', r);
      expect(r.packet.fleet.qualifyingResponses).toHaveLength(2);
      expect(r.packet.fleet.windowResponses).toHaveLength(3);
      expect(r.serving.actualResponse.status).toBe('FAIL');
      expect(r.serving.actualResponseSelection.status).toBe('FAIL');
      expect(r.promotion.checks.candidateCache.status).toBe('FAIL');
    }
    // Identical body hashes are insufficient collection binding when the
    // receipt associates that body with a conflicting capture header.
    const good = through(current()), contradicted = through([conflict, second!]);
    const mismatched = consume(good.packet, { responseFleet: contradicted.packet.fleet });
    expect(mismatched.serving.fleet.issues).toContain('Fleet evidence and actual response collection disagree');
    expect(mismatched.promotion.checks.candidateCache.status).toBe('FAIL');
    expect(through([first!, first!, second!]).serving.actualResponseSelection.status).toBe('PASS');
  });
  it('fleet-authority', () => {
    names.push('fleet-authority');
    const good = through(current());
    const otherConfiguration = buildResponseIdentityPacket({ format: 'olumi.prompt-response-observations.v1', mode: 'simulation',
      configuration: { ...config, model: { ...config.model, id: 'different-model' } }, captures: current(), settling: null });
    for (const fleet of [JSON.parse(JSON.stringify(good.packet.fleet)), through(current(), start, 'observed').packet.fleet, otherConfiguration.fleet]) {
      const r = consume(good.packet, { responseFleet: fleet }); retain('fleet-authority', r);
      expect(r.serving.fleet.status).toBe('FAIL');
      expect(r.serving.fleet.issues).toContain('Fleet evidence is unissued or targets another mode/configuration');
      expect(r.promotion.checks.candidateCache.status).toBe('FAIL');
    }
    const invalid = through([capture('before-invalid-cutoff', '2026-08-31T08:59:00Z', previous), ...current()], 'invalid-cutoff');
    expect(invalid.packet.fleet.excludedBeforeCutoff).toHaveLength(0);
    expect(invalid.promotion.checks.candidateCache.status).toBe('FAIL');
    expect(good.serving.actualResponseSelection.status).toBe('PASS');
  });
  it('historical-integrity', () => {
    names.push('historical-integrity');
    const predecessor = capture('before-corruption', '2026-08-31T08:59:00Z', previous);
    const promptConflict = JSON.parse(predecessor.body);
    promptConflict.trace.pipeline.cee_provenance.prompt_hash = config.prompt.sha256;
    const modelConflict = JSON.parse(predecessor.body);
    modelConflict.trace.engine.model = 'contradicts-model-in-metadata';
    const contradictoryBodies = [promptConflict, modelConflict].map(raw => {
      const body = JSON.stringify(raw); return { ...predecessor, body, bodySha256: sha256(body) };
    });
    for (const broken of [{ ...predecessor, bodySha256: sha256('different body') }, { ...predecessor, requestId: 'unbound-request' },
      { ...predecessor, serviceBuild: 'f'.repeat(40) }, ...contradictoryBodies]) {
      const r = through([broken, ...current()]); retain('historical-integrity', r);
      expect(r.packet.fleet.excludedBeforeCutoff).toHaveLength(1);
      expect(r.packet.responses[0]!.levels.binding.status).toBe('FAIL');
      expect(r.serving.actualResponse.status).toBe('FAIL');
      expect(r.serving.actualResponseSelection.status).toBe('FAIL');
      expect(r.promotion.checks.candidateCache.status).toBe('FAIL');
    }
    expect(through([predecessor, ...current()]).serving.actualResponseSelection.status).toBe('PASS');
    // A genuinely different historical build/model is not intrinsic corruption.
    const old = JSON.parse(predecessor.body);
    old.trace.pipeline.cee_provenance.commit = 'e'.repeat(40);
    old.trace.pipeline.llm_metadata.model = old.trace.engine.model = 'previous-model';
    const body = JSON.stringify(old);
    const coherentHistory = through([{ ...predecessor, body, bodySha256: sha256(body), serviceBuild: 'e'.repeat(40) }, ...current()]);
    expect(coherentHistory.packet.responses[0]!.levels.binding.status).toBe('PASS');
    expect(coherentHistory.serving.actualResponseSelection.status).toBe('PASS');
    expect(coherentHistory.promotion.checks.candidateCache.status).toBe('UNVERIFIED');
  });
  it('empty-current-window', () => {
    names.push('empty-current-window');
    for (const captures of [[], [capture('only-history', '2026-08-31T08:59:00Z', previous)]]) {
      const r = through(captures); retain('empty-current-window', r);
      expect(r.serving.responseIdentities).toHaveLength(captures.length);
      expect(r.packet.fleet.windowResponses).toHaveLength(0);
      expect(r.serving.actualResponseSelection.status).toBe('UNVERIFIED');
      expect(r.serving.actualResponse.status).toBe('UNVERIFIED');
      expect(r.promotion.checks.candidateCache.status).toBe('UNVERIFIED');
    }
    expect(through(current()).serving.actualResponseSelection.status).toBe('PASS');
  });
  it('missing-fleet-no-cutoff', () => {
    names.push('missing-fleet-no-cutoff');
    const full = through([capture('before-unbound-cutoff', '2026-08-31T08:59:00Z', previous), ...current()]);
    const r = consume(full.packet, { responseFleet: undefined }); retain('missing-fleet-no-cutoff', r);
    expect(r.serving.responseFleet).toBeNull();
    expect(r.serving.actualResponseSelection.status).toBe('FAIL');
    expect(r.promotion.checks.candidateCache.status).toBe('FAIL');
    expect(full.serving.actualResponseSelection.status).toBe('PASS');
  });
  it('observed-status-window', () => {
    names.push('observed-status-window');
    // Synthetic branch control only, NOT an assertion of received traffic.
    const r = through([capture('before-observation', '2026-08-31T08:59:00Z', previous), ...current()], start, 'observed');
    retain('observed-status-window', r);
    expect(r.serving.actualResponseSelection.status).toBe('PASS');
    expect(r.serving.actualResponse.status).toBe('UNVERIFIED');
    expect(r.serving.deployedProviderStatus).toBe('UNVERIFIED');
    expect(r.promotion.checks.candidateCache.status).toBe('UNVERIFIED');
    expect(r.promotion.deploymentPermission).toBe('NOT_GRANTED');
    const bad = through([capture('wrong-current-observation', start, previous), ...current()], start, 'observed');
    expect(bad.serving.deployedProviderStatus).toBe('FAIL');
  });
});
