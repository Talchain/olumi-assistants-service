import { readFileSync } from 'node:fs';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildDraftRecordsSchema } from '../../src/cee/draft/records/grammar.js';
import { DRAFT_RECORDS_INSTRUCTION } from '../../src/cee/draft/records/instruction.js';
import { buildLlmMetadataProjection } from '../../src/cee/unified-pipeline/llm-metadata-projection.js';
import { assertExactCaseIds, sha256 } from './contract.js';
import { evaluateResponseIdentity } from './response-identity.js';
import { evaluateResponseFleet } from './response-fleet.js';
import { buildPromotionEvidencePacket, type PromotionEvidenceInput } from './promotion-packet.js';
import {
  configurationHash, evidenceHash, evaluateServingEvidence, verifyEvaluationEvidence,
  type EvidenceComponent, type ReadOnlyGetCapture, type ServingConfiguration,
  type ServingEvidenceReport, type ServingObservation, type VerifiedEvaluationReceipt,
} from './serving-evidence.js';

const collected: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => assertExactCaseIds(['simulation', 'missing', 'semantic-failure', 'hybrid', 'wrong-identity', 'rollback', 'rollback-models', 'cache', 'forged', 'simulation-is-not-observation', 'actual-response-failure'], collected));
const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
const component = (path: string, exportName: string): EvidenceComponent => ({ path, exportName, fileSha256: sha256(read(path)) });
const incumbentText = read('src/cee/draft/records/__tests__/fixtures/served-draft-graph-v195.txt');
const candidateText = read('Prompts/candidates/draft_graph_records.txt');
const incumbent: ServingConfiguration = {
  task: 'draft_graph', sourceHead: '7aa2aa57b8ccb330bab173294ce6ac60a8a82528',
  prompt: { id: 'draft_graph_default', version: 195, sha256: sha256(incumbentText) },
  instructionSha256: sha256(read('src/cee/draft/records/__tests__/fixtures/records-instruction-v10.txt').trimEnd()),
  model: { provider: 'anthropic', id: 'claude-sonnet-4-6' },
  schema: { ...component('src/cee/draft/records/grammar.ts', 'buildDraftRecordsSchema'), artifactSha256: evidenceHash(buildDraftRecordsSchema()) },
  parser: component('src/cee/draft/records/seam.ts', 'DraftRecordSetWire'),
  projector: component('src/cee/draft/records/projector.ts', 'projectDraftRecords'),
  consumer: component('src/cee/transforms/schema-v3.ts', 'transformNodeToV3'),
};
// No assigned PMS version is claimed for the candidate. Numeric post-action
// assignments below exist only in explicitly synthetic GET timeline fixtures.
const candidate: ServingConfiguration = { ...incumbent, sourceHead: '0ef564ef6b272ed9f6dffe60ec359a8db744ecad',
  prompt: { ...incumbent.prompt, version: 'unpromoted-candidate', sha256: sha256(candidateText) }, instructionSha256: sha256(DRAFT_RECORDS_INSTRUCTION) };
const codeOnly: ServingConfiguration = { ...candidate, prompt: incumbent.prompt };
const verifierSource = component('tools/prompt-consumer/promotion-packet.test.ts', 'simulationEnvelopeVerifier');
const get = (path: string, body: unknown): ReadOnlyGetCapture => {
  const text = JSON.stringify(body);
  return { method: 'GET', url: `https://simulation.invalid${path}`, httpStatus: 200, body: text, bodySha256: sha256(text) };
};
function stored(configuration: ServingConfiguration, description = 'Simulation; no PMS writes') {
  const content = configuration.prompt.sha256 === incumbent.prompt.sha256 ? incumbentText : candidateText;
  return get(`/admin/prompts/${configuration.prompt.id}`, { id: configuration.prompt.id, taskId: configuration.task,
    activeVersion: configuration.prompt.version, stagingVersion: configuration.prompt.version, description,
    modelConfig: { staging: configuration.model.id, production: 'preserve-original-production-model' }, versions: [{ version: configuration.prompt.version, content, createdAt: '2026-08-30T09:00:00.000Z', createdBy: 'simulation' }] });
}
function sample(configuration: ServingConfiguration, at: string): ServingObservation {
  const content = configuration.prompt.sha256 === incumbent.prompt.sha256 ? incumbentText : candidateText;
  return { observedAt: at, instanceId: 'simulation-a', environment: 'staging', stored: stored(configuration),
    loaded: get('/admin/prompts/verify', { prompts: [{ prompt_id: configuration.prompt.id, source: 'store', store_version: configuration.prompt.version,
      content_hash: configuration.prompt.sha256.slice(0, 16), content_length: content.length, first_100_chars: content.slice(0, 100), last_100_chars: content.slice(-100), loaded_at: at }] }),
    routing: get('/admin/models/routing', { tasks: [{ task: configuration.task, provider: configuration.model.provider, model: configuration.model.id }] }),
    health: get('/healthz', { build: configuration.sourceHead.slice(0, 8) }) };
}
/** The unit oracle tests receipt composition, not natural-language behaviour. */
function evaluation(kind: VerifiedEvaluationReceipt['kind'], configurations: readonly ServingConfiguration[], options: { failedClaims?: string[]; wording?: string; observed?: readonly ServingConfiguration[] } = {}) {
  const evidence = { observations: (options.observed ?? configurations).map(configuration => ({ configuration })), failedClaims: options.failedClaims ?? [], note: options.wording ?? 'red teapot' };
  return verifyEvaluationEvidence({ kind, scope: 'simulation', configurations, evidence, evidenceSha256: evidenceHash(evidence),
    verifier: { ...verifierSource, run: raw => ({ status: raw.failedClaims.length ? 'FAIL' : 'PASS', fidelityStatus: 'PASS',
      observedConfigurationHashes: raw.observations.map(o => configurationHash(o.configuration)), issues: raw.failedClaims }) } });
}
function cache(configuration: ServingConfiguration, start = '2026-08-31T09:00:00Z', end = '2026-08-31T09:20:00Z') {
  const observed: ServingConfiguration = configuration.prompt.version === 'unpromoted-candidate'
    ? { ...configuration, prompt: { ...configuration.prompt, version: 800_001 } } : configuration;
  return evaluateServingEvidence({ configuration: observed, mode: 'simulation', observations: [sample(observed, start), sample(observed, end)],
    modelSelectionEvidence: evaluation('model-selection', [observed]),
    cacheWindow: { effectiveExpiryMs: 600_000, source: component('src/adapters/llm/prompt-loader.ts', 'getPromptLoaderCacheDiagnostics') } });
}
function input(): PromotionEvidenceInput {
  return { mode: 'simulation', incumbent, candidate, codeOnly,
    evaluations: { structural: evaluation('structural', [candidate]), comparison: evaluation('reasoning', [incumbent, candidate]), codeOnly: evaluation('reasoning', [codeOnly]) },
    rollback: { configuration: incumbent, environment: 'staging', codeRef: incumbent.sourceHead, observedAt: '2026-08-31T08:00:00Z', originalPms: stored(incumbent),
      pmsSelection: { activeVersion: 195, stagingVersion: 195, modelConfig: { staging: incumbent.model.id, production: 'preserve-original-production-model' } } },
    cacheTransitions: { candidate: cache(candidate), rollback: cache(incumbent, '2026-08-31T10:00:00Z', '2026-08-31T10:20:00Z') } };
}

describe('promotion/rollback evidence handoff never performs the actions', () => {
  it('rehearses candidate then rollback GET timelines with explicit simulation and no permission', () => {
    collected.push('simulation');
    const packet = buildPromotionEvidencePacket(input());
    expect(packet.status).toBe('UNVERIFIED');
    expect(packet.preActionEvidenceStatus).toBe('PASS');
    expect(packet.evidence.candidateCache!.cacheWindow.status).toBe('PASS');
    expect(packet.checks.candidateCache.status).toBe('UNVERIFIED');
    expect(packet.checks.rollbackCache.status).toBe('UNVERIFIED');
    expect(packet.checks.candidateCache.issues.join(' ')).toContain('No actual response telemetry');
    expect(packet.codeOnlyRequired).toBe(true);
    expect(packet.operations).toMatchObject({ owner: 'CC', promotionPerformed: false, rollbackPerformed: false });
    expect(packet.mode).toBe('simulation');
    expect(packet.configurations.candidate.prompt.version).toBe('unpromoted-candidate');
    expect(packet.evidence.candidateCache!.configuration.prompt.version).toBe(800_001);
    expect(packet.limitation).toContain('Synthetic timeline rehearsal only');
    expect(packet.deploymentPermission).toBe('NOT_GRANTED');
    expect(packet.deployedSemanticStatus).toBe('UNVERIFIED');
  });
  it('missing comparison/cache/rollback evidence remains UNVERIFIED, not a permissive default', () => {
    collected.push('missing');
    const packet = buildPromotionEvidencePacket({ ...input(), evaluations: {}, rollback: undefined, cacheTransitions: undefined });
    expect(packet.status).toBe('UNVERIFIED');
    expect(packet.checks.comparison.status).toBe('UNVERIFIED');
    expect(packet.checks.rollback.status).toBe('UNVERIFIED');
    expect(packet.checks.candidateCache.status).toBe('UNVERIFIED');
    expect(packet.deploymentPermission).toBe('NOT_GRANTED');
  });
  it('RED verified semantic failure dominates syntactic success and missing evidence; unrelated prose stays GREEN', () => {
    collected.push('semantic-failure');
    const good = input();
    const bad = buildPromotionEvidencePacket({ ...good, cacheTransitions: undefined, evaluations: { ...good.evaluations,
      comparison: evaluation('reasoning', [incumbent, candidate], { failedClaims: ['attribution absent from consumed output'] }) } });
    expect(bad.checks.structural.status).toBe('PASS');
    expect(bad.checks.comparison.status).toBe('FAIL');
    expect(bad.status).toBe('FAIL');
    const unrelated = buildPromotionEvidencePacket({ ...good, evaluations: { ...good.evaluations,
      comparison: evaluation('reasoning', [incumbent, candidate], { wording: 'green bicycle' }) } });
    expect(unrelated.preActionEvidenceStatus).toBe('PASS');
    expect(unrelated.status).toBe('UNVERIFIED');
  });
  it('RED changing either original environment model breaks rollback; unrelated description is GREEN', () => {
    collected.push('rollback-models');
    const good = input();
    for (const environment of ['staging', 'production'] as const) {
      const bad = buildPromotionEvidencePacket({ ...good, rollback: { ...good.rollback!, pmsSelection: { ...good.rollback!.pmsSelection,
        modelConfig: { ...good.rollback!.pmsSelection.modelConfig!, [environment]: 'wrong-original-model' } } } });
      expect(bad.checks.rollback.status).toBe('FAIL');
      expect(bad.checks.rollback.issues.join(' ')).toContain('full environment/model selection pointer mismatch');
    }
    expect(buildPromotionEvidencePacket({ ...good, rollback: { ...good.rollback!, originalPms: stored(incumbent, 'unrelated teapot') } }).checks.rollback.status).toBe('PASS');
  });
  it('requires the reachable code-only combination and refuses the old appended instruction', () => {
    collected.push('hybrid');
    const good = input();
    const missing = buildPromotionEvidencePacket({ ...good, codeOnly: undefined });
    expect(missing.codeOnlyRequired).toBe(true);
    expect(missing.checks.codeOnlyIdentity.status).toBe('UNVERIFIED');
    expect(missing.status).toBe('UNVERIFIED');
    const bad = buildPromotionEvidencePacket({ ...good, codeOnly: { ...codeOnly, instructionSha256: incumbent.instructionSha256 } });
    expect(bad.checks.codeOnlyIdentity.status).toBe('FAIL');
    expect(bad.status).toBe('FAIL');
    expect(buildPromotionEvidencePacket(good).checks.codeOnly.status).toBe('PASS');
  });
  it('RED a wrong actual model/prompt in verifier facts cannot certify intended candidate; independent object change is GREEN', () => {
    collected.push('wrong-identity');
    const good = input();
    for (const wrong of [{ ...candidate, model: { ...candidate.model, id: 'wrong-model' } }, { ...candidate, prompt: { ...candidate.prompt, sha256: sha256('teapot prompt') } }]) {
      const packet = buildPromotionEvidencePacket({ ...good, evaluations: { ...good.evaluations,
        comparison: evaluation('reasoning', [incumbent, candidate], { observed: [incumbent, wrong] }) } });
      expect(packet.status).toBe('FAIL');
      expect(packet.checks.comparison.issues.join(' ')).toContain('observed wrong configuration');
    }
    expect(buildPromotionEvidencePacket({ ...good, evaluations: { ...good.evaluations,
      comparison: evaluation('reasoning', [incumbent, candidate], { wording: 'irrelevant cup' }) } }).preActionEvidenceStatus).toBe('PASS');
  });
  it('binds rollback to original full bytes/model/components/head, not just a version label', () => {
    collected.push('rollback');
    const good = input();
    const bad = buildPromotionEvidencePacket({ ...good, rollback: { ...good.rollback!, codeRef: candidate.sourceHead } });
    expect(bad.checks.rollback.status).toBe('FAIL');
    const wrongBytes = buildPromotionEvidencePacket({ ...good, rollback: { ...good.rollback!, originalPms: stored(candidate) } });
    expect(wrongBytes.checks.rollback.status).toBe('FAIL');
    const unrelated = buildPromotionEvidencePacket({ ...good, rollback: { ...good.rollback!, originalPms: stored(incumbent, 'A different notebook description') } });
    expect(unrelated.checks.rollback.status).toBe('PASS');
    expect(unrelated.preActionEvidenceStatus).toBe('PASS');
    expect(unrelated.status).toBe('UNVERIFIED');
  });
  it('requires post-promotion and post-rollback cache expiry, preserving unknown short-window observations', () => {
    collected.push('cache');
    const good = input();
    const short = buildPromotionEvidencePacket({ ...good, cacheTransitions: { ...good.cacheTransitions, candidate: cache(candidate, '2026-08-31T09:00:00Z', '2026-08-31T09:00:01Z') } });
    expect(short.preActionEvidenceStatus).toBe('PASS');
    expect(short.checks.candidateCache.status).toBe('UNVERIFIED');
    expect(short.status).toBe('UNVERIFIED');
    const wrong = buildPromotionEvidencePacket({ ...good, cacheTransitions: { ...good.cacheTransitions, rollback: cache(candidate) } });
    expect(wrong.checks.rollbackCache.status).toBe('FAIL');
    expect(buildPromotionEvidencePacket(good).preActionEvidenceStatus).toBe('PASS');
    expect(buildPromotionEvidencePacket(good).status).toBe('UNVERIFIED');
  });
  it('rejects manually assigned or JSON-cloned PASS envelopes; they must be recomputed', () => {
    collected.push('forged');
    const good = input();
    const fake = JSON.parse(JSON.stringify(good.evaluations.comparison)) as VerifiedEvaluationReceipt;
    const packet = buildPromotionEvidencePacket({ ...good, evaluations: { ...good.evaluations, comparison: fake } });
    expect(packet.status).toBe('FAIL');
    expect(packet.checks.comparison.issues.join(' ')).toContain('not executable verifier evidence');
    const clonedCache = JSON.parse(JSON.stringify(good.cacheTransitions!.candidate)) as ServingEvidenceReport;
    expect(buildPromotionEvidencePacket({ ...good, cacheTransitions: { ...good.cacheTransitions, candidate: clonedCache } }).status).toBe('FAIL');
    expect(buildPromotionEvidencePacket(good).preActionEvidenceStatus).toBe('PASS');
    expect(buildPromotionEvidencePacket(good).status).toBe('UNVERIFIED');
  });
  it('cannot relabel a complete simulation as an observed promotion/rollback', () => {
    collected.push('simulation-is-not-observation');
    const good = input();
    const packet = buildPromotionEvidencePacket({ ...good, mode: 'observed' });
    expect(packet.status).toBe('FAIL');
    expect(packet.checks.comparison.issues.join(' ')).toContain('simulation cannot certify actual evaluation');
    expect(packet.checks.candidateCache.status).toBe('FAIL');
    expect(packet.operations.promotionPerformed).toBe(false);
    expect(buildPromotionEvidencePacket(good).preActionEvidenceStatus).toBe('PASS');
    expect(buildPromotionEvidencePacket(good).status).toBe('UNVERIFIED');
  });
  it('keeps known individual-response failure RED despite settled administrative GETs', () => {
    collected.push('actual-response-failure');
    const good = input(), observed = good.cacheTransitions!.candidate!.configuration;
    const candidateCache = (wrong: boolean) => {
      const observations = [sample(observed, '2026-08-31T09:00:00Z'), sample(observed, '2026-08-31T09:20:00Z')];
      const responses = observations.map((snapshot, i) => {
        const served = wrong && i === 0 ? incumbent.prompt : observed.prompt;
        const requestId = `response-${i}`, version = `${served.id}@v${served.version} (staging)`;
        const body = JSON.stringify({ trace: { request_id: requestId, correlation_id: requestId,
          engine: { model: observed.model.id, provider: observed.model.provider }, pipeline: {
            llm_metadata: buildLlmMetadataProjection({ model: observed.model.id, prompt_version: version, prompt_hash: served.sha256, instance_id: 'A', cache_age_ms: 10, cache_status: 'fresh' }, undefined),
            cee_provenance: { commit: observed.sourceHead.slice(0, 8), prompt_version: version, prompt_hash: served.sha256, prompt_store_version: served.version },
          } } });
        return evaluateResponseIdentity({ configuration: observed, mode: 'simulation', capture: { observedAt: snapshot.observedAt, url: 'https://simulation.invalid/assist/v1/draft-graph', httpStatus: 200, requestId, body, bodySha256: sha256(body), serviceBuild: observed.sourceHead } });
      });
      const expirySource = component('src/adapters/llm/prompt-loader.ts', 'getPromptLoaderCacheDiagnostics');
      const responseFleet = evaluateResponseFleet({ configuration: observed, mode: 'simulation', responses,
        settling: { notBefore: observations[0]!.observedAt, effectiveExpiryMs: 600_000, source: expirySource } });
      return evaluateServingEvidence({ configuration: observed, mode: 'simulation', observations, modelSelectionEvidence: evaluation('model-selection', [observed]),
        cacheWindow: { effectiveExpiryMs: 600_000, source: expirySource }, responses, responseFleet });
    };
    const badReport = candidateCache(true);
    expect(badReport.cacheWindow.status).toBe('PASS');
    expect(badReport.fleet.status).toBe('FAIL');
    const bad = buildPromotionEvidencePacket({ ...good, cacheTransitions: { ...good.cacheTransitions, candidate: badReport } });
    expect(bad.preActionEvidenceStatus).toBe('PASS');
    expect(bad.checks.candidateCache.status).toBe('FAIL');
    expect(bad.status).toBe('FAIL');
    const counterpart = candidateCache(false);
    expect(counterpart.actualResponseSelection.status).toBe('PASS');
    expect(counterpart.responseFleet!.sampledInstanceStatus).toBe('PASS');
    expect(counterpart.actualResponse.status).toBe('UNVERIFIED');
    expect(buildPromotionEvidencePacket({ ...good, cacheTransitions: { ...good.cacheTransitions, candidate: counterpart } }).checks.candidateCache.status).toBe('UNVERIFIED');
  });
});
