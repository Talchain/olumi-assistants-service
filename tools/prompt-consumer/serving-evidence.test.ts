import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDraftRecordsSchema } from '../../src/cee/draft/records/grammar.js';
import { DRAFT_RECORDS_INSTRUCTION } from '../../src/cee/draft/records/instruction.js';
import { assertExactCaseIds, sha256 } from './contract.js';
import {
  configurationHash, configurationIssues, evidenceHash, evaluateServingEvidence, isVerifiedEvaluationReceipt, verifyEvaluationEvidence,
  type EvidenceComponent, type EvaluationVerdict, type ReadOnlyGetCapture, type ServingConfiguration,
  type ServingEvidenceInput, type ServingObservation, type VerifiedEvaluationReceipt,
} from './serving-evidence.js';

const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => assertExactCaseIds(['levels', 'prompt', 'model', 'model-authority', 'schema', 'parser', 'projector', 'consumer', 'candidate-version', 'cache-window', 'cache-split', 'capture', 'issued-receipt', 'scope', 'unverified-priority'], collected));
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const component = (path: string, exportName: string): EvidenceComponent => ({ path, exportName, fileSha256: sha256(read(path)) });
const prompt = read('src/cee/draft/records/__tests__/fixtures/served-draft-graph-v195.txt');
const config: ServingConfiguration = {
  task: 'draft_graph', sourceHead: '7aa2aa57b8ccb330bab173294ce6ac60a8a82528',
  prompt: { id: 'draft_graph_default', version: 195, sha256: sha256(prompt) }, instructionSha256: sha256(DRAFT_RECORDS_INSTRUCTION),
  model: { provider: 'anthropic', id: 'claude-sonnet-4-6' },
  schema: { ...component('src/cee/draft/records/grammar.ts', 'buildDraftRecordsSchema'), artifactSha256: evidenceHash(buildDraftRecordsSchema()) },
  parser: component('src/cee/draft/records/seam.ts', 'DraftRecordSetWire'),
  projector: component('src/cee/draft/records/projector.ts', 'projectDraftRecords'),
  consumer: component('src/cee/transforms/schema-v3.ts', 'transformNodeToV3'),
};
const verifierSource = component('tools/prompt-consumer/serving-evidence.test.ts', 'syntheticIdentityVerifier');
const get = (path: string, body: unknown): ReadOnlyGetCapture => {
  const text = JSON.stringify(body);
  return { method: 'GET', url: `https://simulation.invalid${path}`, httpStatus: 200, body: text, bodySha256: sha256(text) };
};
function sample(observedAt: string, loadedAt = observedAt): ServingObservation {
  return {
    observedAt, environment: 'staging', instanceId: 'simulation-a',
    stored: get(`/admin/prompts/${config.prompt.id}`, { id: config.prompt.id, taskId: config.task, activeVersion: 194, stagingVersion: 195,
      modelConfig: { staging: 'an-inert-configured-pin-is-not-the-router' },
      versions: [{ version: 195, content: prompt, createdBy: 'simulation', createdAt: '2026-08-30T10:00:00.000Z' }] }),
    loaded: get('/admin/prompts/verify', { prompts: [{ prompt_id: config.prompt.id, source: 'store', store_version: 195,
      content_hash: config.prompt.sha256.slice(0, 16), content_length: prompt.length, first_100_chars: prompt.slice(0, 100), last_100_chars: prompt.slice(-100), loaded_at: loadedAt }] }),
    routing: get('/admin/models/routing', { tasks: [{ task: config.task, model: config.model.id, provider: config.model.provider, executable: true, runtime_availability: 'available' }] }),
    health: get('/healthz', { build: config.sourceHead.slice(0, 8) }),
  };
}
const input = (): ServingEvidenceInput => ({
  configuration: config, mode: 'simulation', observations: [sample('2026-08-31T09:00:00Z'), sample('2026-08-31T09:20:00Z')],
  cacheWindow: { effectiveExpiryMs: 600_000, source: component('src/adapters/llm/prompt-loader.ts', 'getPromptLoaderCacheDiagnostics') },
});
function changeCapture(sample: ServingObservation, key: 'stored' | 'loaded' | 'routing' | 'health', change: (body: any) => void): ServingObservation {
  const capture = sample[key]!;
  const body: unknown = JSON.parse(capture.body);
  change(body);
  return { ...sample, [key]: get(new URL(capture.url).pathname, body) };
}
/** Only an identity mechanics simulation. No model was called in these tests. */
function receipt(configuration = config, scope: VerifiedEvaluationReceipt['scope'] = 'simulation', status: EvaluationVerdict['status'] = 'PASS') {
  const evidence = { capturedConfiguration: configuration, metadata: { object: 'teapot' } };
  return verifyEvaluationEvidence({ kind: 'provider-fidelity', scope, configurations: [config], evidence, evidenceSha256: evidenceHash(evidence),
    verifier: { ...verifierSource, run: raw => ({ status, fidelityStatus: status, observedConfigurationHashes: [configurationHash(raw.capturedConfiguration)], issues: [] }) } });
}

describe('read-only serving identity evidence refuses unsupported claims', () => {
  it('separates selected/loaded references from actual provider and deployed observation', () => {
    collected.push('levels');
    const report = evaluateServingEvidence(input());
    expect(report.promptIdentityStatus).toBe('PASS');
    expect(report.identityStatus).toBe('UNVERIFIED');
    expect(report.levels.configured.status).toBe('PASS');
    expect(report.levels.selected.status).toBe('PASS');
    expect(report.levels.loaded.status).toBe('PASS');
    expect(report.levels.providerBound.status).toBe('UNVERIFIED');
    expect(report.deployedProviderStatus).toBe('UNVERIFIED');
    expect(report.status).toBe('UNVERIFIED');
    expect(report.deploymentPermission).toBe('NOT_GRANTED');
    expect(report.limitation).toContain('identity scope only');
  });
  it.each(['prompt', 'model'] as const)('RED wrong selected %s; GREEN unrelated object on the same GET path', kind => {
    collected.push(kind);
    const good = input();
    const badSample = changeCapture(good.observations[1]!, 'stored', body => { body.versions[0].content = 'A teapot mentions confidence but is not the intended prompt.'; });
    const bad = kind === 'prompt' ? evaluateServingEvidence({ ...good, observations: [good.observations[0]!, badSample] })
      : evaluateServingEvidence({ ...good, providerEvidence: receipt({ ...config, model: { ...config.model, id: 'wrong-model' } }) });
    expect(bad.status).toBe('FAIL');
    expect((kind === 'prompt' ? bad.levels.selected : bad.levels.providerBound).issues.join(' ')).toContain(kind === 'prompt' ? 'full prompt hash split' : 'observed wrong configuration');
    const unrelated = changeCapture(good.observations[1]!, 'stored', body => { body.description = 'A blue teapot changed to a green bicycle.'; });
    expect(evaluateServingEvidence({ ...good, observations: [good.observations[0]!, unrelated] }).promptIdentityStatus).toBe('PASS');
  });
  it('retains PMS4-6 and configured-router5 without mistaking either for per-call selection', () => {
    collected.push('model-authority');
    const good = input();
    const observations = good.observations.map(s => changeCapture(changeCapture(s, 'stored', body => { body.modelConfig.staging = 'claude-sonnet-4-6'; }), 'routing', body => { body.tasks[0].model = 'claude-sonnet-5'; body.tasks[0].source = 'env_override'; }));
    const report = evaluateServingEvidence({ ...good, observations });
    expect(report.promptIdentityStatus).toBe('PASS');
    expect(report.levels.selectedModel.status).toBe('UNVERIFIED');
    expect(report.configuredModels[0]).toMatchObject({ pmsModel: 'claude-sonnet-4-6', routerModel: 'claude-sonnet-5', routerSource: 'env_override' });
    const bound = evaluateServingEvidence({ ...good, observations, providerEvidence: receipt() });
    expect(bound.levels.selectedModel.status).toBe('PASS');
    expect(bound.identityStatus).toBe('PASS');
  });
  it.each(['schema', 'parser', 'projector', 'consumer'] as const)('RED wrong bound %s; GREEN unrelated evidence content', role => {
    collected.push(role);
    const wrong = { ...config, [role]: { ...config[role], fileSha256: sha256(`wrong ${role} implementation`) } };
    expect(receipt(wrong).verdict.status).toBe('FAIL');
    expect(receipt(wrong).verdict.issues.join(' ')).toContain('observed wrong configuration');
    const evidence = { capturedConfiguration: config, metadata: { object: 'a bicycle, not a teapot' } };
    const good = verifyEvaluationEvidence({ kind: 'provider-fidelity', scope: 'simulation', configurations: [config], evidence, evidenceSha256: evidenceHash(evidence),
      verifier: { ...verifierSource, run: raw => ({ status: 'PASS', fidelityStatus: 'PASS', observedConfigurationHashes: [configurationHash(raw.capturedConfiguration)], issues: [] }) } });
    expect(good.verdict.status).toBe('PASS');
    expect(isVerifiedEvaluationReceipt(good)).toBe(true);
  });
  it('uses an explicit unpromoted candidate label, never an invented next PMS version', () => {
    collected.push('candidate-version');
    const candidate = { ...config, prompt: { ...config.prompt, version: 'unpromoted-candidate' as const } };
    expect(configurationIssues(candidate)).toEqual([]);
    expect(configurationIssues({ ...candidate, prompt: { ...candidate.prompt, version: 'next-version' as 'unpromoted-candidate' } })).not.toEqual([]);
    expect(configurationHash({ ...config, projector: { ...config.projector, fileSha256: sha256('other projector') } })).not.toEqual(configurationHash(config));
    expect(configurationHash(Object.fromEntries(Object.entries(config).reverse()) as unknown as ServingConfiguration)).toBe(configurationHash(config));
    expect(evaluateServingEvidence({ ...input(), configuration: candidate }).levels.selected.status).toBe('FAIL');
  });
  it('does not call one sample, short intervals, or stale loaded timestamps cache-expiry proof', () => {
    collected.push('cache-window');
    const good = input();
    expect(evaluateServingEvidence(good).cacheWindow.status).toBe('PASS');
    expect(evaluateServingEvidence({ ...good, observations: good.observations.slice(0, 1) }).cacheWindow.status).toBe('UNVERIFIED');
    const short = [sample('2026-08-31T09:00:00Z'), sample('2026-08-31T09:00:01Z')];
    expect(evaluateServingEvidence({ ...good, observations: short }).cacheWindow.status).toBe('UNVERIFIED');
    const stale = [sample('2026-08-31T09:00:00Z'), sample('2026-08-31T09:20:00Z', '2026-08-31T09:00:00Z')];
    expect(evaluateServingEvidence({ ...good, observations: stale }).cacheWindow.status).toBe('UNVERIFIED');
  });
  it('RED split loaded bytes across expiry; GREEN unrelated health metadata', () => {
    collected.push('cache-split');
    const good = input();
    const broken = changeCapture(good.observations[1]!, 'loaded', body => { body.prompts[0].content_hash = sha256('other served prompt').slice(0, 16); });
    expect(evaluateServingEvidence({ ...good, observations: [good.observations[0]!, broken] }).cacheWindow.status).toBe('FAIL');
    const unrelated = changeCapture(good.observations[1]!, 'health', body => { body.description = 'teapot'; });
    expect(evaluateServingEvidence({ ...good, observations: [good.observations[0]!, unrelated] }).cacheWindow.status).toBe('PASS');
  });
  it('rejects altered bytes, write receipts and mixed serving origins', () => {
    collected.push('capture');
    const good = input();
    const first = good.observations[0]!;
    for (const stored of [{ ...first.stored!, body: '{}' }, { ...first.stored!, method: 'POST' as 'GET' }, { ...first.stored!, url: 'https://other.invalid/admin/prompts/draft_graph_default' }]) {
      expect(evaluateServingEvidence({ ...good, observations: [{ ...first, stored }, good.observations[1]!] }).status).toBe('FAIL');
    }
    expect(evaluateServingEvidence(good).promptIdentityStatus).toBe('PASS');
  });
  it('rejects JSON-cloned PASS and raw-evidence tampering; authentic verifier output is immutable', () => {
    collected.push('issued-receipt');
    const good = receipt();
    expect(Object.isFrozen(good.verdict)).toBe(true);
    expect(isVerifiedEvaluationReceipt(JSON.parse(JSON.stringify(good)))).toBe(false);
    const fake = JSON.parse(JSON.stringify(good)) as VerifiedEvaluationReceipt;
    expect(evaluateServingEvidence({ ...input(), providerEvidence: fake }).levels.providerBound.status).toBe('FAIL');
    const evidence = { capturedConfiguration: config };
    let calls = 0;
    const bad = verifyEvaluationEvidence({ kind: 'provider-fidelity', scope: 'simulation', configurations: [config], evidence, evidenceSha256: sha256('different facts'),
      verifier: { ...verifierSource, run: raw => { calls++; return { status: 'PASS', fidelityStatus: 'PASS', observedConfigurationHashes: [configurationHash(raw.capturedConfiguration)], issues: [] }; } } });
    expect(bad.verdict.status).toBe('FAIL');
    expect(calls).toBe(0);
    const malformed = verifyEvaluationEvidence({ kind: 'provider-fidelity', scope: 'simulation', configurations: [config], evidence, evidenceSha256: evidenceHash(evidence),
      verifier: { ...verifierSource, run: () => null as unknown as EvaluationVerdict } });
    expect(malformed.verdict.status).toBe('FAIL');
    expect(malformed.verdict.issues).toContain('verifier did not return a verdict');
    expect(evaluateServingEvidence({ ...input(), providerEvidence: good }).levels.providerBound.status).toBe('PASS');
  });
  it('does not upgrade simulation or a local SDK/provider witness into deployed binding', () => {
    collected.push('scope');
    expect(evaluateServingEvidence({ ...input(), providerEvidence: receipt() }).deployedProviderStatus).toBe('UNVERIFIED');
    expect(evaluateServingEvidence({ ...input(), mode: 'observed', providerEvidence: receipt(config, 'local-provider') }).deployedProviderStatus).toBe('UNVERIFIED');
    expect(evaluateServingEvidence({ ...input(), mode: 'observed', providerEvidence: receipt() }).levels.providerBound.status).toBe('FAIL');
  });
  it('missing fidelity is UNVERIFIED but cannot erase a known wrong identity failure', () => {
    collected.push('unverified-priority');
    expect(evaluateServingEvidence({ ...input(), providerEvidence: receipt(config, 'simulation', 'UNVERIFIED') }).levels.providerBound.status).toBe('UNVERIFIED');
    const wrong = { ...config, model: { ...config.model, id: 'wrong-model' } };
    expect(evaluateServingEvidence({ ...input(), providerEvidence: receipt(wrong, 'simulation', 'UNVERIFIED') }).levels.providerBound.status).toBe('FAIL');
  });
});
