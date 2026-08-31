/** Observed-instance selection consistency. Never a whole-fleet certificate. */
import { type ContractStatus } from './contract.js';
import { evidenceHash, configurationHash, type EvidenceComponent, type ServingConfiguration } from './serving-evidence.js';
import { isResponseIdentityReport, type ResponseIdentityReport } from './response-identity.js';

export interface ResponseFleetInput {
  readonly configuration: ServingConfiguration;
  readonly mode: 'observed' | 'simulation';
  readonly responses: readonly ResponseIdentityReport[];
  readonly settling: { readonly notBefore: string; readonly effectiveExpiryMs: number; readonly source: EvidenceComponent } | null;
  /** A requested sample set, not an authoritative enumeration of deployed pods. */
  readonly expectedInstanceIds?: readonly string[];
}
export interface ResponseFleetReport {
  readonly configurationSha256: string;
  readonly mode: ResponseFleetInput['mode'];
  readonly evidenceSha256: string;
  readonly status: ContractStatus;
  readonly state: 'MIXED' | 'MATCHING_OBSERVED_INSTANCES' | 'UNVERIFIED';
  readonly sampledInstanceStatus: ContractStatus;
  readonly universalStatus: 'UNVERIFIED';
  readonly deployedProviderStatus: ContractStatus;
  readonly issues: readonly string[];
  readonly responses: readonly ResponseIdentityReport[];
  /** Includes duplicate bodies: contradictory capture associations remain evidence. */
  readonly windowResponses: readonly ResponseIdentityReport[];
  readonly qualifyingResponses: readonly ResponseIdentityReport[];
  readonly excludedBeforeCutoff: readonly ResponseIdentityReport[];
  readonly duplicateResponseHashes: readonly string[];
  readonly unattributedResponses: readonly ResponseIdentityReport[];
  readonly instances: readonly {
    readonly instanceId: string;
    readonly responseHashes: readonly string[];
    readonly selectionStatus: ContractStatus;
    readonly settlingStatus: ContractStatus;
    readonly issues: readonly string[];
  }[];
  readonly coverage: { readonly requestedInstanceIds: readonly string[]; readonly observedInstanceIds: readonly string[]; readonly missingInstanceIds: readonly string[] };
  readonly scope: 'observed-instance-sample';
  readonly limitation: string;
}
const combine = (states: readonly ContractStatus[]): ContractStatus => states.includes('FAIL') ? 'FAIL' : !states.length || states.includes('UNVERIFIED') ? 'UNVERIFIED' : 'PASS';
const issued = new WeakSet<ResponseFleetReport>();
export const isResponseFleetReport = (value: unknown): value is ResponseFleetReport => value !== null && typeof value === 'object' && issued.has(value as ResponseFleetReport);
const freeze = <T>(value: T): T => {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
};
const selectionStatus = (response: ResponseIdentityReport): ContractStatus => combine([
  response.levels.binding.status, response.levels.selectedPrompt.status, response.levels.requestedModel.status,
  response.levels.instance.status, response.levels.build.status,
]);

export function evaluateResponseFleet(input: ResponseFleetInput): ResponseFleetReport {
  const expectedHash = configurationHash(input.configuration), issues: string[] = [];
  const responses: ResponseIdentityReport[] = [], duplicates: string[] = [], excluded: ResponseIdentityReport[] = [];
  const seenBodies = new Set<string>(), seenRequests = new Map<string, string>();
  let collectionStatus: ContractStatus = 'PASS';
  let cutoff: number | null = null;
  if (input.settling) {
    cutoff = Date.parse(input.settling.notBefore);
    const { effectiveExpiryMs, source } = input.settling;
    if (!Number.isFinite(cutoff) || !Number.isFinite(effectiveExpiryMs) || effectiveExpiryMs <= 0 || !source.path || !source.exportName || !/^[a-f0-9]{64}$/.test(source.fileSha256)) {
      collectionStatus = 'FAIL'; issues.push('Invalid settling cutoff/expiry authority'); cutoff = null;
    }
  }
  for (const response of input.responses) {
    if (!isResponseIdentityReport(response)) { collectionStatus = 'FAIL'; issues.push('Response identity was not decoded from raw response evidence'); continue; }
    responses.push(response);
    if (response.mode !== input.mode || response.configurationSha256 !== expectedHash) {
      collectionStatus = 'FAIL'; issues.push('Response decoder targeted a different mode/configuration');
    }
    if (!Number.isFinite(Date.parse(response.observedAt))) { collectionStatus = 'FAIL'; issues.push('Invalid response observation time'); }
    // Request/body association is collection integrity, not current selection.
    // Neither a cutoff nor sample deduplication may hide conflicting receipts.
    if (response.requestId) {
      const prior = seenRequests.get(response.requestId);
      if (prior && prior !== response.responseSha256) { collectionStatus = 'FAIL'; issues.push('One request id has conflicting response bodies'); }
      seenRequests.set(response.requestId, response.responseSha256);
    }
  }
  const qualifying: ResponseIdentityReport[] = [], windowResponses: ResponseIdentityReport[] = [];
  for (const response of responses) {
    if (cutoff !== null && Date.parse(response.observedAt) < cutoff) { excluded.push(response); continue; }
    // Dedupe affects independent sample counts ONLY. A contradictory header,
    // binding or decoded failure attached to the same body must never disappear.
    windowResponses.push(response);
    if (seenBodies.has(response.responseSha256)) { duplicates.push(response.responseSha256); continue; }
    seenBodies.add(response.responseSha256);
    qualifying.push(response);
  }
  if (duplicates.length) issues.push('Duplicate response captures retained but excluded from independent sample counts');
  const groups = new Map<string, ResponseIdentityReport[]>();
  const unattributed = windowResponses.filter(r => !r.instanceId);
  for (const response of qualifying) {
    if (!response.instanceId) continue;
    groups.set(response.instanceId, [...(groups.get(response.instanceId) ?? []), response]);
  }
  const requested = [...(input.expectedInstanceIds ?? [])];
  if (new Set(requested).size !== requested.length || requested.some(id => !id.trim())) { collectionStatus = 'FAIL'; issues.push('Requested instance sample set contains empty/duplicate ids'); }
  const observed = [...groups.keys()].sort(), missing = requested.filter(id => !groups.has(id));
  if (missing.length) issues.push('Requested instances were not observed; enumeration is not fleet authority');
  if (unattributed.length) issues.push('Some responses lack an observed instance identity');
  const instances = [...groups].map(([instanceId, samples]) => {
    const notes: string[] = [];
    const selection = combine(windowResponses.filter(r => r.instanceId === instanceId).map(selectionStatus));
    let settlingStatus: ContractStatus = 'UNVERIFIED';
    if (selection === 'FAIL') settlingStatus = 'FAIL';
    else if (!input.settling) notes.push('No authorised settling cutoff/effective expiry reference');
    else if (samples.length < 2) notes.push('Two distinct responses from this instance are required');
    else {
      const times = samples.map(r => Date.parse(r.observedAt));
      const ages = samples.map(r => r.actual.cacheAgeMs);
      if (ages.some(age => age === null || !Number.isFinite(age) || age < 0) || samples.some(r => !r.actual.cacheStatus)) notes.push('Response cache-age/status telemetry missing');
      else if (Math.max(...times) - Math.min(...times) < input.settling.effectiveExpiryMs) notes.push('Same-instance responses do not span effective expiry');
      else {
        const loadedTimes = times.map((timestamp, i) => timestamp - ages[i]!);
        if (Math.max(...loadedTimes) <= Math.min(...times) || Math.max(...loadedTimes) - Math.min(...loadedTimes) < input.settling.effectiveExpiryMs) notes.push('Response telemetry does not witness reload across effective expiry');
        else if (samples.some(r => r.actual.cacheStatus !== 'fresh')) notes.push('Response telemetry includes non-fresh cache state');
        else settlingStatus = selection;
      }
    }
    return { instanceId, responseHashes: samples.map(r => r.responseSha256), selectionStatus: selection, settlingStatus, issues: notes };
  });
  const prompts = windowResponses.map(r => r.actual.prompt);
  // A compatible short digest is incomplete evidence, not a different prompt.
  // Compare each observed field without completing missing bytes from config.
  const promptSplit = prompts.some(a => prompts.some(b =>
    (a.id !== null && b.id !== null && a.id !== b.id)
    || (a.version !== null && b.version !== null && a.version !== b.version)
    || (a.sha256 !== null && b.sha256 !== null && !a.sha256.startsWith(b.sha256) && !b.sha256.startsWith(a.sha256))));
  const knownModels = new Set(windowResponses.map(r => r.actual.requestedModel).filter(model => model !== null));
  const knownProviders = new Set(windowResponses.map(r => r.actual.provider).filter(provider => provider !== null));
  const builds = windowResponses.map(r => r.sourceHead).filter((build): build is string => typeof build === 'string' && build.length > 0);
  const buildSplit = builds.some(a => builds.some(b => !a.startsWith(b) && !b.startsWith(a)));
  const mixed = promptSplit || knownModels.size > 1 || knownProviders.size > 1 || buildSplit;
  if (mixed) issues.push('Mixed prompt/model/provider/build identities in the observed response window');
  const sampledInstanceStatus = combine([collectionStatus, mixed ? 'FAIL' : 'PASS', ...windowResponses.map(selectionStatus), ...instances.map(i => i.settlingStatus),
    qualifying.length && !unattributed.length && !missing.length && groups.size ? 'PASS' : 'UNVERIFIED']);
  const status = combine([sampledInstanceStatus, ...windowResponses.map(r => r.status)]);
  const result: ResponseFleetReport = freeze({
    configurationSha256: expectedHash, mode: input.mode, evidenceSha256: evidenceHash(input), status,
    state: mixed ? 'MIXED' : sampledInstanceStatus === 'PASS' ? 'MATCHING_OBSERVED_INSTANCES' : 'UNVERIFIED',
    sampledInstanceStatus, universalStatus: 'UNVERIFIED',
    deployedProviderStatus: input.mode === 'observed' ? combine([sampledInstanceStatus, qualifying.length ? 'PASS' : 'UNVERIFIED',
      ...windowResponses.map(r => combine([r.status, r.levels.binding.status, r.levels.providerBound.status, r.levels.build.status]))]) : 'UNVERIFIED',
    issues, responses, windowResponses, qualifyingResponses: qualifying, excludedBeforeCutoff: excluded, duplicateResponseHashes: duplicates, unattributedResponses: unattributed,
    instances, coverage: { requestedInstanceIds: requested, observedInstanceIds: observed, missingInstanceIds: missing }, scope: 'observed-instance-sample',
    limitation: 'Only these decoded responses and observed instances are covered. Requested instance IDs are not an authoritative fleet inventory. Historical pre-cutoff responses and duplicates remain visible. Selection consistency does not prove provider response, assembled prompt/schema consumption, semantic quality, or universal deployment convergence.',
  });
  issued.add(result);
  return result;
}
