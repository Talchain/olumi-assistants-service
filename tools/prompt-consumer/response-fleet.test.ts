import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildLlmMetadataProjection } from '../../src/cee/unified-pipeline/llm-metadata-projection.js';
import { assertExactCaseIds, sha256 } from './contract.js';
import { evaluateResponseIdentity, type ResponseIdentityReport } from './response-identity.js';
import { evaluateResponseFleet, isResponseFleetReport, type ResponseFleetInput } from './response-fleet.js';
import { type EvidenceComponent, type ServingConfiguration } from './serving-evidence.js';

const names: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => assertExactCaseIds(['mixed', 'uniform', 'duplicates', 'duplicate-contradiction', 'partial-digest', 'cutoff', 'missing', 'forged', 'empty', 'coverage', 'build', 'expiry'], names));
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const source = (path: string, exportName: string): EvidenceComponent => ({ path, exportName, fileSha256: sha256(read(path)) });
const configuration: ServingConfiguration = {
  task: 'draft_graph', sourceHead: '3b53105730076df53953bcc450787b37e8e3ea22',
  prompt: { id: 'draft_graph_default', version: 195, sha256: sha256(read('src/cee/draft/records/__tests__/fixtures/served-draft-graph-v195.txt')) },
  instructionSha256: sha256('instruction identity reference only'), model: { id: 'claude-sonnet-4-6', provider: 'anthropic' },
  schema: { ...source('src/cee/draft/records/grammar.ts', 'buildDraftRecordsSchema'), artifactSha256: sha256('schema identity reference only') },
  parser: source('src/cee/draft/records/seam.ts', 'DraftRecordSetWire'), projector: source('src/cee/draft/records/projector.ts', 'projectDraftRecords'),
  consumer: source('src/cee/transforms/schema-v3.ts', 'transformNodeToV3'),
};
const alternate: ServingConfiguration['prompt'] = { ...configuration.prompt, version: 196, sha256: sha256('synthetic alternate prompt Y') };
const start = '2026-08-31T09:00:00Z', end = '2026-08-31T09:20:00Z';
/** Production metadata projector + fixed decoder. Every body is a labelled
 * synthetic fixture; no HTTP/provider operation is performed by these tests. */
function response(requestId: string, instanceId: string | null, observedAt: string, options: {
  expected?: ServingConfiguration; prompt?: ServingConfiguration['prompt']; cacheAgeMs?: number; cacheStatus?: string;
  telemetry?: boolean; build?: string; captureBuild?: string; annotation?: string; mode?: 'observed' | 'simulation';
} = {}): ResponseIdentityReport {
  const expected = options.expected ?? configuration, prompt = options.prompt ?? expected.prompt;
  const version = `${prompt.id}@v${prompt.version} (staging)`;
  const body = JSON.stringify({ trace: { request_id: requestId, correlation_id: requestId,
    engine: options.telemetry === false ? {} : { model: expected.model.id, provider: expected.model.provider },
    pipeline: options.telemetry === false ? {} : { llm_metadata: buildLlmMetadataProjection({ model: expected.model.id, prompt_version: version, prompt_hash: prompt.sha256,
      instance_id: instanceId, cache_age_ms: options.cacheAgeMs ?? 10, cache_status: options.cacheStatus ?? 'fresh' }, undefined),
      cee_provenance: { commit: (options.build ?? expected.sourceHead).slice(0, 8), prompt_version: version, prompt_hash: prompt.sha256, prompt_store_version: prompt.version } } },
    unrelated_annotation: options.annotation ?? 'A blue teapot' });
  return evaluateResponseIdentity({ configuration: expected, mode: options.mode ?? 'simulation', capture: {
    observedAt, url: 'https://simulation.invalid/assist/v1/draft-graph', httpStatus: 200, requestId,
    body, bodySha256: sha256(body), serviceBuild: options.captureBuild ?? options.build ?? expected.sourceHead,
  } });
}
const input = (responses: readonly ResponseIdentityReport[], expected = configuration): ResponseFleetInput => ({
  configuration: expected, mode: 'simulation', responses,
  settling: { notBefore: start, effectiveExpiryMs: 600_000, source: source('src/adapters/llm/prompt-loader.ts', 'getPromptLoaderCacheDiagnostics') },
});
const twins = (expected = configuration) => [response('a1', 'A', start, { expected }), response('b1', 'B', start, { expected }), response('a2', 'A', end, { expected }), response('b2', 'B', end, { expected })];

describe('response-scoped observed instance consistency, not fleet certification', () => {
  it('preserves A:X/B:Y and fails mixed selection; coherent A:Y/B:Y is the counterpart', () => {
    names.push('mixed');
    const observations = [response('a1', 'A', start), response('b1', 'B', start, { prompt: alternate }), response('a2', 'A', end), response('b2', 'B', end, { prompt: alternate })];
    const mixed = evaluateResponseFleet(input(observations));
    expect(mixed.state).toBe('MIXED');
    expect(mixed.status).toBe('FAIL');
    expect(mixed.responses.map(r => [r.instanceId, r.actual.prompt.sha256])).toEqual(observations.map(r => [r.instanceId, r.actual.prompt.sha256]));
    const targetY = { ...configuration, prompt: alternate };
    const stable = evaluateResponseFleet(input(twins(targetY), targetY));
    expect(stable.state).toBe('MATCHING_OBSERVED_INSTANCES');
    expect(stable.sampledInstanceStatus).toBe('PASS');
    expect(stable.status).toBe('UNVERIFIED');
  });
  it('reports selection-only consistency without promoting missing provider/composition evidence', () => {
    names.push('uniform');
    const report = evaluateResponseFleet(input(twins()));
    expect(isResponseFleetReport(report)).toBe(true);
    expect(report.sampledInstanceStatus).toBe('PASS');
    expect(report.instances.map(i => [i.instanceId, i.settlingStatus])).toEqual([['A', 'PASS'], ['B', 'PASS']]);
    expect(report.status).toBe('UNVERIFIED');
    expect(report.universalStatus).toBe('UNVERIFIED');
    expect(report.deployedProviderStatus).toBe('UNVERIFIED');
    const unchanged = evaluateResponseFleet(input([response('a1', 'A', start, { annotation: 'A green bicycle' }), ...twins().slice(1)]));
    expect(unchanged.sampledInstanceStatus).toBe('PASS');
    expect(unchanged.status).toBe('UNVERIFIED');
  });
  it('does not count repeated captures as independent requests or an expiry window', () => {
    names.push('duplicates');
    const one = response('a1', 'A', start);
    const duplicate = evaluateResponseFleet(input([one, one]));
    expect(duplicate.qualifyingResponses).toHaveLength(1);
    expect(duplicate.duplicateResponseHashes).toEqual([one.responseSha256]);
    expect(duplicate.sampledInstanceStatus).toBe('UNVERIFIED');
    const conflicting = evaluateResponseFleet(input([one, response('a1', 'A', end, { annotation: 'same request, conflicting body' })]));
    expect(conflicting.status).toBe('FAIL');
    expect(evaluateResponseFleet(input([one, response('a2', 'A', end)])).sampledInstanceStatus).toBe('PASS');
  });
  it('requires an explicit cutoff for X-to-Y settling and retains excluded history', () => {
    names.push('cutoff');
    const targetY = { ...configuration, prompt: alternate };
    const old = response('old-a', 'A', '2026-08-31T08:59:00Z', { expected: targetY, prompt: configuration.prompt });
    const samples = [old, response('a1', 'A', start, { expected: targetY }), response('a2', 'A', end, { expected: targetY })];
    const settled = evaluateResponseFleet(input(samples, targetY));
    expect(settled.excludedBeforeCutoff).toEqual([old]);
    expect(settled.responses).toHaveLength(3);
    expect(settled.sampledInstanceStatus).toBe('PASS');
    const unbounded = evaluateResponseFleet({ ...input(samples, targetY), settling: null });
    expect(unbounded.state).toBe('MIXED');
    expect(unbounded.status).toBe('FAIL');
  });
  it('duplicate bodies never hide contradictory capture headers in either order', () => {
    names.push('duplicate-contradiction');
    const good = response('a1', 'A', start);
    const bad = response('a1', 'A', start, { captureBuild: 'ffffffffffffffffffffffffffffffffffffffff' });
    const later = response('a2', 'A', end);
    expect(good.responseSha256).toBe(bad.responseSha256);
    expect(good.levels.build.status).toBe('PASS');
    expect(bad.levels.build.status).toBe('FAIL');
    for (const observations of [[good, bad, later], [bad, good, later]]) {
      const report = evaluateResponseFleet(input(observations));
      expect(report.windowResponses).toHaveLength(3);
      expect(report.qualifyingResponses).toHaveLength(2);
      expect(report.sampledInstanceStatus).toBe('FAIL');
      expect(report.status).toBe('FAIL');
      expect(report.state).not.toBe('MATCHING_OBSERVED_INSTANCES');
    }
    const benign = evaluateResponseFleet(input([good, good, later]));
    expect(benign.qualifyingResponses).toHaveLength(2);
    expect(benign.sampledInstanceStatus).toBe('PASS');
    expect(evaluateResponseFleet(input([good, good])).sampledInstanceStatus).toBe('UNVERIFIED');
  });
  it('missing identity stays unknown and cannot erase a known mismatch', () => {
    names.push('missing');
    const unknownInstance = response('unknown', null, end);
    const unknown = evaluateResponseFleet(input([response('a1', 'A', start), unknownInstance]));
    expect(unknown.unattributedResponses).toEqual([unknownInstance]);
    expect(unknown.sampledInstanceStatus).toBe('UNVERIFIED');
    expect(evaluateResponseFleet(input([response('empty', 'A', start, { telemetry: false })])).status).toBe('UNVERIFIED');
    expect(evaluateResponseFleet(input([unknownInstance, response('wrong', 'B', start, { prompt: alternate })])).status).toBe('FAIL');
  });
  it('compatible partial prompt digests stay unknown; conflicting hash/id/version stays RED', () => {
    names.push('partial-digest');
    const full = response('a1', 'A', start);
    const partialPrompt = { ...configuration.prompt, sha256: configuration.prompt.sha256.slice(0, 16) };
    const partial = response('a2', 'A', end, { prompt: partialPrompt });
    expect(partial.levels.selectedPrompt.status).toBe('UNVERIFIED');
    for (const responses of [[full, partial], [partial, full]]) {
      const report = evaluateResponseFleet(input(responses));
      expect(report.state).not.toBe('MIXED');
      expect(report.sampledInstanceStatus).toBe('UNVERIFIED');
      expect(report.status).toBe('UNVERIFIED');
    }
    for (const wrong of [
      { ...partialPrompt, sha256: '0000000000000000' },
      { ...partialPrompt, id: 'different_prompt' },
      { ...partialPrompt, version: 196 },
    ]) {
      const report = evaluateResponseFleet(input([full, response('a2', 'A', end, { prompt: wrong })]));
      expect(report.status).toBe('FAIL');
      expect(report.state).toBe('MIXED');
    }
    const matching = evaluateResponseFleet(input([full, response('a2', 'A', end)]));
    expect(matching.sampledInstanceStatus).toBe('PASS');
    expect(matching.state).toBe('MATCHING_OBSERVED_INSTANCES');
  });
  it('rejects asserted/cloned reports even when their PASS and full identity match', () => {
    names.push('forged');
    const genuine = response('a1', 'A', start);
    const forged = { ...JSON.parse(JSON.stringify(genuine)), status: 'PASS' } as ResponseIdentityReport;
    expect(evaluateResponseFleet(input([forged, response('a2', 'A', end)])).status).toBe('FAIL');
    expect(isResponseFleetReport(JSON.parse(JSON.stringify(evaluateResponseFleet(input(twins())))))).toBe(false);
    expect(evaluateResponseFleet(input(twins())).sampledInstanceStatus).toBe('PASS');
  });
  it('empty and all-pre-cutoff collections never produce deployed provider PASS', () => {
    names.push('empty');
    const empty = evaluateResponseFleet({ ...input([]), mode: 'observed' });
    expect(empty.status).toBe('UNVERIFIED');
    expect(empty.deployedProviderStatus).toBe('UNVERIFIED');
    const old = response('old', 'A', '2026-08-31T08:59:00Z', { mode: 'observed' });
    const excluded = evaluateResponseFleet({ ...input([old]), mode: 'observed' });
    expect(excluded.qualifyingResponses).toHaveLength(0);
    expect(excluded.deployedProviderStatus).toBe('UNVERIFIED');
  });
  it('an enumerated requested set does not claim a universal deployed inventory', () => {
    names.push('coverage');
    const observed = evaluateResponseFleet({ ...input(twins()), expectedInstanceIds: ['A', 'B'] });
    expect(observed.sampledInstanceStatus).toBe('PASS');
    expect(observed.universalStatus).toBe('UNVERIFIED');
    const missing = evaluateResponseFleet({ ...input(twins()), expectedInstanceIds: ['A', 'B', 'C'] });
    expect(missing.coverage.missingInstanceIds).toEqual(['C']);
    expect(missing.sampledInstanceStatus).toBe('UNVERIFIED');
  });
  it('a source-build mismatch is RED while an unrelated response object is GREEN for selection', () => {
    names.push('build');
    const wrong = response('b2', 'B', end, { build: '0123456789012345678901234567890123456789' });
    expect(evaluateResponseFleet(input([...twins().slice(0, 3), wrong])).status).toBe('FAIL');
    expect(evaluateResponseFleet(input([...twins().slice(0, 3), response('b2', 'B', end, { annotation: 'different cup' })])).sampledInstanceStatus).toBe('PASS');
  });
  it('requires per-instance expiry and witnessed fresh reload, not timestamps alone', () => {
    names.push('expiry');
    const first = response('a1', 'A', start);
    const tooSoon = response('a2', 'A', '2026-08-31T09:00:01Z');
    expect(evaluateResponseFleet(input([first, tooSoon])).sampledInstanceStatus).toBe('UNVERIFIED');
    const noReload = response('a2', 'A', end, { cacheAgeMs: 1_200_010 });
    expect(evaluateResponseFleet(input([first, noReload])).sampledInstanceStatus).toBe('UNVERIFIED');
    expect(evaluateResponseFleet(input([first, response('a2', 'A', end, { cacheStatus: 'stale' })])).sampledInstanceStatus).toBe('UNVERIFIED');
    expect(evaluateResponseFleet(input([first, response('a2', 'A', end)])).sampledInstanceStatus).toBe('PASS');
  });
});
