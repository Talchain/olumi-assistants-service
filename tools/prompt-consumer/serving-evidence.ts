/** Offline identity evidence only. No network, cache mutation, or serving imports. */
import assert from 'node:assert/strict';
import { PromptDefinitionSchema } from '../../src/prompts/schema.js';
import type { PromptVerifyEntry } from '../../src/adapters/llm/prompt-loader.js';
import type { TaskRouting } from '../../src/adapters/llm/model-routing-report.js';
import { sha256, type ContractStatus } from './contract.js';
import { isResponseIdentityReport, type ResponseIdentityReport } from './response-identity.js';
import { isResponseFleetReport, type ResponseFleetReport } from './response-fleet.js';

export interface EvidenceComponent {
  readonly path: string;
  readonly exportName: string;
  readonly fileSha256: string;
}
export interface ServingConfiguration {
  readonly task: string;
  readonly sourceHead: string;
  readonly prompt: { readonly id: string; readonly version: number | 'unpromoted-candidate'; readonly sha256: string };
  readonly instructionSha256: string | null;
  readonly model: { readonly provider: string; readonly id: string };
  readonly schema: EvidenceComponent & { readonly artifactSha256: string | null };
  readonly parser: EvidenceComponent;
  readonly projector: EvidenceComponent;
  readonly consumer: EvidenceComponent;
}
export const evidenceHash = (value: unknown): string => sha256(JSON.stringify(value));
/** Identity hashes are independent of JSON property order or unrelated metadata. */
export const configurationHash = (configuration: ServingConfiguration): string => {
  const source = (c: EvidenceComponent) => ({ path: c.path, exportName: c.exportName, fileSha256: c.fileSha256 });
  return evidenceHash({ task: configuration.task, sourceHead: configuration.sourceHead,
    prompt: { id: configuration.prompt.id, version: configuration.prompt.version, sha256: configuration.prompt.sha256 },
    instructionSha256: configuration.instructionSha256,
    model: { provider: configuration.model.provider, id: configuration.model.id },
    schema: { ...source(configuration.schema), artifactSha256: configuration.schema.artifactSha256 },
    parser: source(configuration.parser), projector: source(configuration.projector), consumer: source(configuration.consumer) });
};
const fullHash = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const statusOf = (statuses: readonly ContractStatus[]): ContractStatus => statuses.includes('FAIL') ? 'FAIL' : statuses.includes('UNVERIFIED') ? 'UNVERIFIED' : 'PASS';
const time = (value: string): number => { const n = Date.parse(value); assert(Number.isFinite(n), 'invalid observation timestamp'); return n; };
const object = (value: unknown): Record<string, unknown> => {
  assert(value && typeof value === 'object' && !Array.isArray(value), 'expected captured object');
  return value as Record<string, unknown>;
};
function frozen<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
}
export function configurationIssues(configuration: ServingConfiguration): string[] {
  const issues: string[] = [];
  if (!configuration.task || !/^[a-f0-9]{40}$/.test(configuration.sourceHead)) issues.push('task and full source head required');
  const version = configuration.prompt.version;
  if (!configuration.prompt.id || (version !== 'unpromoted-candidate' && (typeof version !== 'number' || !Number.isInteger(version) || version < 1)) || !fullHash(configuration.prompt.sha256)) issues.push('full prompt id/version/hash required; only unpromoted-candidate is a valid nonnumeric version');
  if (configuration.instructionSha256 !== null && !fullHash(configuration.instructionSha256)) issues.push('full appended instruction hash required');
  if (!configuration.model.provider || !configuration.model.id) issues.push('model/provider required');
  for (const role of ['schema', 'parser', 'projector', 'consumer'] as const) {
    const component = configuration[role];
    if (!component.path || !component.exportName || !fullHash(component.fileSha256)) issues.push(`full ${role} source identity required`);
  }
  if (configuration.schema.artifactSha256 !== null && !fullHash(configuration.schema.artifactSha256)) issues.push('full grammar/schema artifact hash required');
  return issues;
}

export interface EvaluationVerdict {
  readonly status: ContractStatus;
  readonly fidelityStatus: ContractStatus;
  /** The verifier derives these from captured requests, not the desired config. */
  readonly observedConfigurationHashes: readonly string[];
  readonly issues: readonly string[];
}
export interface VerifiedEvaluationReceipt {
  readonly kind: 'structural' | 'reasoning' | 'provider-fidelity' | 'model-selection';
  readonly scope: 'offline-replay' | 'local-provider' | 'deployed-provider' | 'simulation';
  readonly configurationHashes: readonly string[];
  readonly evidenceSha256: string;
  readonly verifier: EvidenceComponent & { readonly implementationSha256: string };
  readonly verdict: EvaluationVerdict;
  readonly receiptSha256: string;
}
const issuedEvaluations = new WeakSet<VerifiedEvaluationReceipt>();

/**
 * Replays a supplied, identified verifier against the original captured facts.
 * Persisted PASS annotations are not receipts: after loading JSON, rerun the
 * verifier. This proves invocation/binding, not that the verifier's semantic
 * oracle is correct; its opposite-direction mutation controls remain required.
 */
export function verifyEvaluationEvidence<T>(input: {
  readonly kind: VerifiedEvaluationReceipt['kind'];
  readonly scope: VerifiedEvaluationReceipt['scope'];
  readonly configurations: readonly ServingConfiguration[];
  readonly evidence: T;
  readonly evidenceSha256: string;
  readonly verifier: EvidenceComponent & { readonly run: (evidence: T) => EvaluationVerdict };
}): VerifiedEvaluationReceipt {
  const issues = input.configurations.flatMap(configurationIssues);
  if (!input.configurations.length) issues.push('no configuration bound to verifier');
  const hashes = input.configurations.map(configurationHash);
  if (!fullHash(input.evidenceSha256) || evidenceHash(input.evidence) !== input.evidenceSha256) issues.push('raw evidence hash mismatch');
  if (!input.verifier.path || !input.verifier.exportName || !fullHash(input.verifier.fileSha256)) issues.push('verifier source identity missing');
  let verdict: EvaluationVerdict = { status: 'UNVERIFIED', fidelityStatus: 'UNVERIFIED', observedConfigurationHashes: [], issues: [] };
  if (!issues.length) {
    try {
      const candidate = input.verifier.run(input.evidence);
      assert(candidate && typeof candidate === 'object', 'verifier did not return a verdict');
      assert(['PASS', 'FAIL', 'UNVERIFIED'].includes(candidate.status), 'invalid verifier status');
      assert(['PASS', 'FAIL', 'UNVERIFIED'].includes(candidate.fidelityStatus), 'invalid verifier fidelity status');
      assert(Array.isArray(candidate.issues) && candidate.issues.every(i => typeof i === 'string'), 'invalid verifier issues');
      assert(Array.isArray(candidate.observedConfigurationHashes) && candidate.observedConfigurationHashes.every(fullHash), 'verifier did not return full observed identities');
      verdict = candidate;
      assert.deepEqual([...verdict.observedConfigurationHashes].sort(), [...hashes].sort(), 'verifier observed wrong configuration');
      assert.equal(evidenceHash(input.evidence), input.evidenceSha256, 'verifier mutated original evidence');
    } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  }
  const { run, ...source } = input.verifier;
  const body = {
    kind: input.kind, scope: input.scope, configurationHashes: hashes, evidenceSha256: input.evidenceSha256,
    verifier: { ...source, implementationSha256: sha256(run.toString()) },
    verdict: issues.length ? { status: 'FAIL' as const, fidelityStatus: 'FAIL' as const, observedConfigurationHashes: verdict.observedConfigurationHashes, issues: [...verdict.issues, ...issues] } : verdict,
  };
  const result = frozen({ ...body, receiptSha256: evidenceHash(body) });
  issuedEvaluations.add(result);
  return result;
}
export const isVerifiedEvaluationReceipt = (receipt: VerifiedEvaluationReceipt): boolean => issuedEvaluations.has(receipt);

/** Raw successful GETs only. Bodies exclude auth headers/cookies. */
export interface ReadOnlyGetCapture {
  readonly method: 'GET';
  readonly url: string;
  readonly httpStatus: number;
  readonly body: string;
  readonly bodySha256: string;
}
export interface ServingObservation {
  readonly observedAt: string;
  readonly environment: 'staging' | 'production';
  /** Null means an anonymous load-balanced sample, not whole-fleet coverage. */
  readonly instanceId: string | null;
  readonly stored?: ReadOnlyGetCapture;
  readonly loaded?: ReadOnlyGetCapture;
  readonly routing?: ReadOnlyGetCapture;
  readonly health?: ReadOnlyGetCapture;
}
export interface ServingEvidenceInput {
  readonly configuration: ServingConfiguration;
  readonly mode: 'observed' | 'simulation';
  readonly observations: readonly ServingObservation[];
  /** Verified effective expiry (including grace/layering), never guessed here. */
  readonly cacheWindow: { readonly effectiveExpiryMs: number; readonly source: EvidenceComponent } | null;
  /** Actual per-call selection replay, never the configured-router GET alone. */
  readonly modelSelectionEvidence?: VerifiedEvaluationReceipt;
  readonly providerEvidence?: VerifiedEvaluationReceipt;
  /** Fixed decoder receipts from individual responses, never administrative snapshots. */
  readonly responses?: readonly ResponseIdentityReport[];
  readonly responseFleet?: ResponseFleetReport;
}
interface Level { readonly status: ContractStatus; readonly issues: readonly string[] }
export interface ServingEvidenceReport {
  readonly configuration: ServingConfiguration;
  readonly configurationSha256: string;
  readonly evidenceSha256: string;
  readonly mode: ServingEvidenceInput['mode'];
  readonly levels: Readonly<Record<'configured' | 'configuredRouter' | 'selected' | 'selectedModel' | 'loaded' | 'providerBound' | 'deployed' | 'observed', Level>>;
  readonly configuredModels: readonly { readonly observedAt: string; readonly pmsModel: string | null; readonly routerModel: string | null; readonly routerProvider: string | null; readonly routerSource: string | null }[];
  readonly cacheWindow: Level;
  readonly promptIdentityStatus: ContractStatus;
  readonly identityStatus: ContractStatus;
  readonly status: ContractStatus;
  readonly observationCount: number;
  readonly deployedProviderStatus: ContractStatus;
  readonly actualResponse: Level;
  readonly actualResponseSelection: Level;
  readonly responseIdentities: readonly ResponseIdentityReport[];
  readonly responseFleet: ResponseFleetReport | null;
  readonly fleet: Level;
  readonly limitation: string;
  readonly deploymentPermission: 'NOT_GRANTED';
}
const issuedServingReports = new WeakSet<ServingEvidenceReport>();
export const isServingEvidenceReport = (report: ServingEvidenceReport): boolean => issuedServingReports.has(report);
const storedFields = PromptDefinitionSchema.pick({ id: true, taskId: true, activeVersion: true, stagingVersion: true, versions: true, modelConfig: true });
function decode(capture: ReadOnlyGetCapture, path: string): Record<string, unknown> {
  assert.equal(capture.method, 'GET', 'write receipts are not read-only evidence');
  assert.equal(new URL(capture.url).pathname, path, 'wrong observed endpoint');
  assert.equal(capture.httpStatus, 200, 'GET did not succeed');
  assert.equal(sha256(capture.body), capture.bodySha256, 'GET body hash mismatch');
  return object(JSON.parse(capture.body));
}

export function evaluateServingEvidence(input: ServingEvidenceInput): ServingEvidenceReport {
  const config = input.configuration;
  const names = ['configured', 'configuredRouter', 'selected', 'selectedModel', 'loaded', 'providerBound', 'deployed', 'observed'] as const;
  const levels = Object.fromEntries(names.map(n => [n, { status: 'UNVERIFIED' as ContractStatus, issues: [] as string[] }])) as Record<typeof names[number], { status: ContractStatus; issues: string[] }>;
  const add = (name: typeof names[number], status: ContractStatus, issue?: string) => {
    const level = levels[name];
    if (level.status !== 'FAIL') level.status = status;
    if (issue) level.issues.push(issue);
  };
  const check = (name: typeof names[number], run: () => void) => {
    try { run(); add(name, 'PASS'); } catch (error) { add(name, 'FAIL', error instanceof Error ? error.message : String(error)); }
  };
  const expectedIssues = configurationIssues(config);
  levels.configured = { status: expectedIssues.length ? 'FAIL' : 'PASS', issues: expectedIssues };
  const loadedTimes: number[] = [], observationTimes: number[] = [];
  const configuredModels: Array<{ observedAt: string; pmsModel: string | null; routerModel: string | null; routerProvider: string | null; routerSource: string | null }> = [];
  let selectedCount = 0, loadedCount = 0, routingCount = 0, healthCount = 0;
  for (const sample of input.observations) {
    check('observed', () => {
      observationTimes.push(time(sample.observedAt));
      const captures = [sample.stored, sample.loaded, sample.routing, sample.health].filter(c => c !== undefined);
      assert(captures.length, 'no read-only responses in observation');
      assert.equal(new Set(captures.map(c => new URL(c.url).origin)).size, 1, 'sample combines different serving origins');
    });
    let content: string | undefined;
    const configuredModel = { observedAt: sample.observedAt, pmsModel: null as string | null, routerModel: null as string | null, routerProvider: null as string | null, routerSource: null as string | null };
    configuredModels.push(configuredModel);
    if (sample.stored) check('selected', () => {
      const prompt = storedFields.parse(decode(sample.stored!, `/admin/prompts/${config.prompt.id}`));
      assert.equal(prompt.id, config.prompt.id, 'wrong selected prompt id');
      assert.equal(prompt.taskId, config.task, 'wrong selected prompt task');
      const version = sample.environment === 'staging' ? prompt.stagingVersion ?? prompt.activeVersion : prompt.activeVersion;
      assert.equal(version, config.prompt.version, 'selected version split');
      const versions = prompt.versions.filter(v => v.version === version);
      assert.equal(versions.length, 1, 'selected version absent or duplicated');
      content = versions[0]!.content;
      assert.equal(sha256(content), config.prompt.sha256, 'selected full prompt hash split');
      configuredModel.pmsModel = prompt.modelConfig?.[sample.environment] ?? null;
      selectedCount++;
      // PMS modelConfig is retained in the raw body but is not model routing.
    });
    if (sample.loaded) check('loaded', () => {
      const snapshot = decode(sample.loaded!, '/admin/prompts/verify');
      assert(Array.isArray(snapshot.prompts), 'loaded prompt rows absent');
      const rows = (snapshot.prompts as PromptVerifyEntry[]).filter(p => p.prompt_id === config.prompt.id);
      assert.equal(rows.length, 1, 'loaded prompt absent or duplicated');
      const row = rows[0]!;
      assert.equal(row.source, 'store', 'loaded source is not selected PMS');
      assert.equal(row.store_version, config.prompt.version, 'loaded version split');
      assert(/^[a-f0-9]{16,64}$/.test(row.content_hash), 'loaded digest too short');
      assert(config.prompt.sha256.startsWith(row.content_hash), 'loaded prompt hash split');
      assert(content !== undefined, 'no selected bytes to bind loaded prefix');
      assert.equal(row.content_length, content.length, 'loaded prompt length split');
      assert.equal(row.first_100_chars, content.slice(0, 100), 'loaded prefix bytes split');
      assert.equal(row.last_100_chars, content.slice(-100), 'loaded suffix bytes split');
      assert(row.loaded_at, 'loaded timestamp missing');
      const loadedAt = time(row.loaded_at);
      assert(loadedAt <= time(sample.observedAt), 'loaded timestamp is in the future');
      loadedTimes.push(loadedAt); loadedCount++;
    });
    if (sample.routing) check('configuredRouter', () => {
      const snapshot = decode(sample.routing!, '/admin/models/routing');
      assert(Array.isArray(snapshot.tasks), 'routing tasks absent');
      const rows = (snapshot.tasks as TaskRouting[]).filter(r => r.task === config.task);
      assert.equal(rows.length, 1, 'routing task absent or duplicated');
      const row = rows[0]!;
      assert(typeof row.model === 'string' && typeof row.provider === 'string', 'configured router model/provider absent');
      configuredModel.routerModel = row.model;
      configuredModel.routerProvider = row.provider;
      configuredModel.routerSource = row.source ?? null;
      // This endpoint omits per-call PMS overrides (parse.ts). A disagreement
      // with intended/actual selected model is not itself a serving split.
      routingCount++;
    });
    if (sample.health) check('deployed', () => {
      const health = decode(sample.health!, '/healthz');
      assert.equal(typeof health.build, 'string', 'health build absent');
      assert(/^[a-f0-9]{7,40}$/.test(String(health.build)) && config.sourceHead.startsWith(String(health.build)), 'deployed source split');
      healthCount++;
    });
  }
  const count = input.observations.length;
  if (selectedCount < count || !count) add('selected', 'UNVERIFIED', 'selected prompt not observed in every sample');
  if (routingCount < count || !count) add('configuredRouter', 'UNVERIFIED', 'configured-router observation absent from one or more samples');
  if (loadedCount < count || !count) add('loaded', 'UNVERIFIED', 'loaded identity absent from one or more samples');
  if (healthCount < count || !count) add('deployed', 'UNVERIFIED', 'deployed build absent from one or more samples');
  if (!count) add('observed', 'UNVERIFIED', 'no observations');

  const receipt = input.providerEvidence;
  if (receipt) check('providerBound', () => {
    assert(isVerifiedEvaluationReceipt(receipt), 'provider result was not issued by evidence verifier');
    assert.equal(receipt.kind, 'provider-fidelity', 'not a provider fidelity receipt');
    assert.deepEqual(receipt.configurationHashes, [configurationHash(config)], 'provider receipt targets another configuration');
    assert(['local-provider', 'deployed-provider', 'simulation'].includes(receipt.scope), 'offline replay is not provider binding');
    if (input.mode === 'observed') assert.notEqual(receipt.scope, 'simulation', 'simulated receipt is not an observed provider call');
  });
  else add('providerBound', 'UNVERIFIED', 'no captured provider-bound request and parser/consumer witness');
  if (receipt && isVerifiedEvaluationReceipt(receipt) && levels.providerBound.status !== 'FAIL') {
    levels.providerBound = { status: statusOf([receipt.verdict.status, receipt.verdict.fidelityStatus]), issues: [...receipt.verdict.issues] };
    // A callback's declared scope is not server-origin response telemetry.
    // Keep generic receipts useful for local provider probes, never deployment.
    if (receipt.scope === 'deployed-provider' && levels.providerBound.status !== 'FAIL') {
      levels.providerBound = { status: 'UNVERIFIED', issues: [...receipt.verdict.issues, 'Generic verifier scope cannot establish an actual deployed response; fixed response telemetry evidence required'] };
    }
  }
  const selection = input.modelSelectionEvidence;
  if (selection) {
    check('selectedModel', () => {
      assert(isVerifiedEvaluationReceipt(selection), 'model selection result was not issued by evidence verifier');
      assert.equal(selection.kind, 'model-selection', 'wrong selection evidence kind');
      assert.deepEqual(selection.configurationHashes, [configurationHash(config)], 'selection receipt targets another configuration');
      if (input.mode === 'observed') assert.notEqual(selection.scope, 'simulation', 'simulated model selection is not observed selection');
    });
    if (levels.selectedModel.status !== 'FAIL') levels.selectedModel = { status: statusOf([selection.verdict.status, selection.verdict.fidelityStatus]), issues: [...selection.verdict.issues] };
    if (selection.scope === 'deployed-provider' && levels.selectedModel.status !== 'FAIL') {
      levels.selectedModel = { status: 'UNVERIFIED', issues: [...selection.verdict.issues, 'Generic selection verifier scope is not deployed per-response model telemetry'] };
    }
  } else if (levels.providerBound.status === 'PASS') levels.selectedModel = { status: 'PASS', issues: ['Selected model bound by the supplied provider witness, not by the configured-router row'] };
  else add('selectedModel', 'UNVERIFIED', 'PMS pin and configured-router projection do not prove per-call model selection');
  const cacheIssues: string[] = [];
  let cacheStatus: ContractStatus = 'UNVERIFIED';
  if (levels.selected.status === 'FAIL' || levels.loaded.status === 'FAIL' || levels.deployed.status === 'FAIL') cacheStatus = 'FAIL';
  else if (!input.cacheWindow) cacheIssues.push('effective cache expiry authority missing');
  else {
    const window = input.cacheWindow;
    if (!Number.isFinite(window.effectiveExpiryMs) || window.effectiveExpiryMs <= 0 || !window.source.path || !window.source.exportName || !fullHash(window.source.fileSha256)) {
      cacheStatus = 'FAIL'; cacheIssues.push('invalid cache expiry authority');
    } else if (count < 2 || loadedTimes.length !== count || selectedCount !== count || observationTimes.length !== count) cacheIssues.push('at least two complete read-only samples required');
    else if (Math.max(...observationTimes) - Math.min(...observationTimes) < window.effectiveExpiryMs) cacheIssues.push('observation span is shorter than effective cache expiry');
    else if (Math.max(...loadedTimes) <= Math.min(...observationTimes) || Math.max(...loadedTimes) - Math.min(...loadedTimes) < window.effectiveExpiryMs) cacheIssues.push('later sample has not witnessed cache reload across expiry');
    else cacheStatus = 'PASS';
  }
  const promptIdentityStatus = statusOf([levels.configured.status, levels.selected.status, levels.loaded.status, cacheStatus]);
  const identityStatus = statusOf([promptIdentityStatus, levels.selectedModel.status]);
  const responseIssues: string[] = [];
  const responseIdentities: ResponseIdentityReport[] = [];
  let responseCollectionStatus: ContractStatus = 'PASS';
  for (const response of input.responses ?? []) {
    if (!isResponseIdentityReport(response)) { responseCollectionStatus = 'FAIL'; responseIssues.push('Actual response was not issued by the fixed raw-response decoder'); continue; }
    responseIdentities.push(response);
    if (response.mode !== input.mode || response.configurationSha256 !== configurationHash(config)) {
      responseCollectionStatus = 'FAIL'; responseIssues.push('Actual response targets a different mode/configuration');
    }
  }
  const actualResponse: Level = { status: statusOf([responseCollectionStatus, responseIdentities.length ? 'PASS' : 'UNVERIFIED', ...responseIdentities.map(r => r.status)]),
    issues: responseIdentities.length ? responseIssues : [...responseIssues, 'No actual response telemetry supplied; GET snapshots and local provider probes cannot substitute'] };
  const actualResponseSelection: Level = { status: statusOf([responseCollectionStatus, responseIdentities.length ? 'PASS' : 'UNVERIFIED',
    ...responseIdentities.flatMap(r => [r.levels.binding.status, r.levels.selectedPrompt.status, r.levels.requestedModel.status, r.levels.instance.status, r.levels.build.status])]), issues: responseIssues };
  let fleet: Level = { status: 'UNVERIFIED', issues: ['No per-response observed-instance settling evidence supplied'] };
  let responseFleet: ResponseFleetReport | null = null;
  if (input.responseFleet) {
    const candidate = input.responseFleet;
    if (!isResponseFleetReport(candidate) || candidate.mode !== input.mode || candidate.configurationSha256 !== configurationHash(config)) {
      fleet = { status: 'FAIL', issues: ['Fleet evidence is unissued or targets another mode/configuration'] };
    } else {
      responseFleet = candidate;
      // Equal body bytes do not make different capture headers/associations the
      // same evidence. Compare complete decoded receipts, not body hashes alone.
      const responseHashes = [...new Set(responseIdentities.map(r => evidenceHash(r)))].sort();
      const fleetHashes = [...new Set(candidate.responses.map(r => evidenceHash(r)))].sort();
      fleet = JSON.stringify(responseHashes) === JSON.stringify(fleetHashes)
        ? { status: candidate.status, issues: candidate.issues }
        : { status: 'FAIL', issues: ['Fleet evidence and actual response collection disagree'] };
    }
  }
  const deployedProviderStatus = input.mode === 'observed'
    ? statusOf([actualResponse.status, responseIdentities.length ? 'PASS' : 'UNVERIFIED', ...responseIdentities.flatMap(r => [r.levels.binding.status, r.levels.providerBound.status, r.levels.build.status])]) : 'UNVERIFIED';
  const result: ServingEvidenceReport = frozen({
    configuration: config, configurationSha256: configurationHash(config), evidenceSha256: evidenceHash(input), mode: input.mode,
    levels, configuredModels, cacheWindow: { status: cacheStatus, issues: cacheIssues }, promptIdentityStatus, identityStatus,
    status: statusOf([identityStatus, levels.providerBound.status, levels.deployed.status, levels.observed.status, levels.configuredRouter.status, actualResponse.status, fleet.status]), observationCount: count, deployedProviderStatus,
    actualResponse, actualResponseSelection, responseIdentities, responseFleet, fleet,
    limitation: 'PASS is identity scope only. GET loaded evidence binds a digest prefix/length/edge bytes to selected PMS bytes, not an individual response. Configured identities and generic verifier callbacks are not server-origin observations. Per-response telemetry and observed-instance consistency are separate; missing composition/provider fields stay UNVERIFIED. Neither a requested instance list nor a sample proves whole-fleet convergence. No semantic/promotion certification.',
    deploymentPermission: 'NOT_GRANTED',
  });
  issuedServingReports.add(result);
  return result;
}
