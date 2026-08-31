/** Decode existing response metadata only. No network, hypothetical telemetry or serving changes. */
import { computeResponseHash } from '../../src/utils/response-hash.js';
import { sha256, type ContractStatus } from './contract.js';
import { configurationHash, configurationIssues, type ServingConfiguration } from './serving-evidence.js';

export interface ResponseCapture {
  observedAt: string; url: string; httpStatus: number; requestId: string;
  body: string; bodySha256: string; serviceBuild?: string;
}
export interface ResponseIdentityLevel { status: ContractStatus; issues: string[] }
const names = ['binding', 'selectedPrompt', 'requestedModel', 'providerBound', 'instruction', 'schema', 'parser', 'projector', 'consumer', 'instance', 'build'] as const;
type LevelName = typeof names[number];
export interface ResponseIdentityReport {
  configurationSha256: string; mode: 'observed' | 'simulation'; status: ContractStatus;
  responseSha256: string; requestId: string | null; instanceId: string | null;
  observedAt: string; sourceHead: string | null;
  actual: { prompt: { id: string | null; version: number | null; sha256: string | null };
    requestedModel: string | null; provider: string | null; cacheAgeMs: number | null; cacheStatus: string | null };
  levels: Record<LevelName, ResponseIdentityLevel>; issues: string[]; rung: string;
}
const issued = new WeakSet<object>();
export const isResponseIdentityReport = (value: unknown): value is ResponseIdentityReport =>
  value !== null && typeof value === 'object' && issued.has(value);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const record = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);
const present = (v: unknown) => v !== undefined && v !== null && v !== '';
const fullHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);

export function evaluateResponseIdentity(input: {
  configuration: ServingConfiguration; capture: ResponseCapture; mode: 'observed' | 'simulation';
}): ResponseIdentityReport {
  const { configuration: config, capture, mode } = input;
  const unknown = (): ResponseIdentityLevel => ({ status: 'UNVERIFIED', issues: [] });
  const levels: ResponseIdentityReport['levels'] = { binding: unknown(), selectedPrompt: unknown(), requestedModel: unknown(),
    providerBound: unknown(), instruction: unknown(), schema: unknown(), parser: unknown(), projector: unknown(), consumer: unknown(), instance: unknown(), build: unknown() };
  const add = (name: LevelName, status: ContractStatus, issue?: string) => {
    if (levels[name].status !== 'FAIL') levels[name].status = status;
    if (issue) levels[name].issues.push(issue);
  };
  // Intrinsic corruption/contradiction cannot be excused as an old selection
  // outside a promotion window. Expected-configuration mismatches stay scoped
  // to their individual identity level instead.
  const invalid = (name: LevelName, issue: string) => {
    add(name, 'FAIL', issue);
    if (name !== 'binding') add('binding', 'FAIL', issue);
  };
  const object = (value: unknown, path: string): Record<string, unknown> => {
    if (!present(value)) return {};
    if (!record(value)) { add('binding', 'FAIL', `${path} is not an object`); return {}; }
    return value;
  };
  const same = (name: LevelName, label: string, values: unknown[]): string | null => {
    const available = values.filter(present);
    if (available.some(v => typeof v !== 'string')) invalid(name, `${label} is invalid`);
    const strings = available.filter((v): v is string => typeof v === 'string');
    if (new Set(strings).size > 1) invalid(name, `contradictory ${label}`);
    return new Set(strings).size === 1 ? strings[0]! : null;
  };
  let body: Record<string, unknown> = {}, v5 = false;
  for (const issue of configurationIssues(config)) add('binding', 'FAIL', issue);
  if (config.task !== 'draft_graph') add('binding', 'FAIL', 'decoder covers draft_graph only');
  try {
    const path = new URL(capture.url).pathname;
    v5 = ['/proxy/v5/turn', '/orchestrate/v2/turn'].includes(path);
    if (!v5 && path !== '/assist/v1/draft-graph') throw new Error('unsupported response endpoint');
    if (capture.httpStatus !== 200) throw new Error('response was not HTTP 200');
    if (!Number.isFinite(Date.parse(capture.observedAt))) throw new Error('invalid observation timestamp');
    if (!fullHash(capture.bodySha256) || sha256(capture.body) !== capture.bodySha256) throw new Error('raw response checksum mismatch');
    const parsed: unknown = JSON.parse(capture.body);
    if (!record(parsed)) throw new Error('response is not a JSON object');
    body = parsed;
  } catch (error) { add('binding', 'FAIL', error instanceof Error ? error.message : String(error)); }
  if (v5 ? present(body.trace) : present(body._diagnostic_trace)) add('binding', 'FAIL', 'trace belongs to a different endpoint family');
  const trace = object(v5 ? body._diagnostic_trace : body.trace, 'trace');
  const pipeline = object(trace.pipeline, 'trace.pipeline');
  const meta = object(pipeline.llm_metadata, 'trace.pipeline.llm_metadata');
  const provenance = object(pipeline.cee_provenance, 'trace.pipeline.cee_provenance');
  const correlation = object(trace.correlation_ids, 'trace.correlation_ids');
  const engine = object(trace.engine, 'trace.engine');
  const environment = object(trace.environment, 'trace.environment');
  const requestId = same('binding', 'request ID', v5 ? [correlation.request_id] : [trace.request_id, trace.correlation_id]);
  if (present(capture.requestId) && (typeof capture.requestId !== 'string' || (requestId && requestId !== capture.requestId))) add('binding', 'FAIL', 'capture and response request IDs differ');
  let responseBound = !!requestId && typeof capture.requestId === 'string' && !!capture.requestId;
  if (v5) {
    if (present(trace.exit_path) && trace.exit_path !== 'draft_graph') add('binding', 'FAIL', 'trace is not a draft_graph exit');
    const { _diagnostic_trace: _trace, ...wireBody } = body;
    if (present(correlation.response_hash) && correlation.response_hash !== computeResponseHash(wireBody)) add('binding', 'FAIL', 'diagnostic trace response hash differs from actual wire body');
    responseBound = responseBound && present(correlation.response_hash) && trace.exit_path === 'draft_graph';
  }
  add('binding', responseBound ? 'PASS' : 'UNVERIFIED', v5
    ? 'Response hash/request IDs bind this trace to this body; they are not authenticated provider evidence.'
    : 'V1 request IDs are self-reported; raw checksum proves file integrity, not server authenticity.');
  const rows = (value: unknown, label: string): Record<string, unknown>[] => {
    if (!present(value)) return [];
    if (!Array.isArray(value) || value.some(v => !record(v))) { add('binding', 'FAIL', `${label} is invalid`); return []; }
    return value as Record<string, unknown>[];
  };
  const identities = v5 ? rows(trace.prompt_identity, 'prompt_identity').filter(r => r.task_id === 'draft_graph') : [];
  const calls = v5 ? rows(trace.llm_calls, 'llm_calls').filter(r => r.role === 'draft_graph') : [];
  const ambiguous = identities.length > 1 || calls.length > 1;
  const versionText = same('selectedPrompt', 'prompt version', v5 ? identities.flatMap(r => [r.prompt_id, r.version]) : [meta.prompt_version, trace.prompt_version, provenance.prompt_version]);
  const match = versionText?.match(/^([^\s@]+)@v([1-9]\d*) \((?:staging|production)\)$/);
  const prompt = { id: match?.[1] ?? null, version: match ? Number(match[2]) : null,
    sha256: same('selectedPrompt', 'prompt hash', v5 ? [...identities.map(r => r.hash), correlation.prompt_hash] : [meta.prompt_hash, trace.prompt_hash, provenance.prompt_hash]) };
  if (versionText && !match && !versionText.startsWith('default:')) invalid('selectedPrompt', 'invalid current draft prompt_version syntax');
  if (versionText?.startsWith('default:')) add('selectedPrompt', 'FAIL', 'response used a default prompt, not the configured PMS prompt');
  if (prompt.sha256 && !/^[a-f0-9]{16,64}$/.test(prompt.sha256)) invalid('selectedPrompt', 'selected prompt digest is invalid');
  if ((prompt.id && prompt.id !== config.prompt.id) || (prompt.version !== null && prompt.version !== config.prompt.version) || (prompt.sha256 && !config.prompt.sha256.startsWith(prompt.sha256))) add('selectedPrompt', 'FAIL', 'selected prompt differs from intended configuration');
  if (present(provenance.prompt_store_version) && (!Number.isInteger(provenance.prompt_store_version) || (prompt.version !== null && provenance.prompt_store_version !== prompt.version))) invalid('selectedPrompt', 'provenance prompt store version disagrees');
  if (prompt.id && prompt.version !== null && fullHash(prompt.sha256)) add('selectedPrompt', 'PASS');
  const requestedModel = same('requestedModel', 'requested model', v5 ? calls.map(r => r.model) : [meta.model, trace.model, provenance.model, provenance.model_id, engine.model]);
  const provider = same('requestedModel', 'reported provider', v5 ? calls.map(r => r.provider) : [engine.provider]);
  if ((requestedModel && requestedModel !== config.model.id) || (provider && provider !== config.model.provider)) add('requestedModel', 'FAIL', 'requested model/provider differs from intended configuration');
  if (requestedModel) add('requestedModel', 'PASS');
  if (ambiguous) for (const name of ['selectedPrompt', 'requestedModel'] as const) add(name, 'UNVERIFIED', 'Multiple uncorrelated draft calls/identities do not establish a unique selection.');
  const instanceId = v5 ? null : same('instance', 'instance ID', [meta.instance_id]);
  if (instanceId) add('instance', 'PASS');
  const cacheAge = v5 ? undefined : meta.cache_age_ms, cacheState = v5 ? undefined : meta.cache_status;
  const cacheAgeMs = typeof cacheAge === 'number' && Number.isFinite(cacheAge) && cacheAge >= 0 ? cacheAge : null;
  const cacheStatus = typeof cacheState === 'string' && ['fresh', 'stale', 'expired', 'miss'].includes(cacheState) ? cacheState : null;
  if ((present(cacheAge) && cacheAgeMs === null) || (present(cacheState) && cacheStatus === null)) invalid('instance', 'invalid cache metadata');
  const builds = [capture.serviceBuild, v5 ? environment.build_sha : provenance.commit].filter(present);
  let sourceHead: string | null = null;
  for (const build of builds) {
    if (typeof build !== 'string' || !/^[a-f0-9]{7,40}$/.test(build)) invalid('build', 'observed build identity is invalid');
    else {
      if (build.length === 40 && sourceHead === null) sourceHead = build;
      if (!config.sourceHead.startsWith(build)) add('build', 'FAIL', `observed build ${build} differs from intended full source head ${config.sourceHead}`);
    }
  }
  if (builds.length > 1 && typeof builds[0] === 'string' && typeof builds[1] === 'string' && !builds[0].startsWith(builds[1]) && !builds[1].startsWith(builds[0])) invalid('build', `conflicting observed build identities: ${builds.join(' / ')}`);
  if (sourceHead) add('build', 'PASS', 'Explicit full build identity is source-derived, not observed component execution.');
  else add('build', 'UNVERIFIED', 'No explicit full build identity; a matching short prefix is not a full-head observation.');
  for (const name of ['providerBound', 'instruction', 'schema', 'parser', 'projector', 'consumer'] as const) add(name, 'UNVERIFIED', name === 'providerBound'
    ? 'Existing response reports requested model/provider, not provider-returned model/call identity; V5 provider is hardcoded.'
    : `Existing response does not bind ${name} execution/bytes; configured identities and structured-output flags are insufficient.`);
  for (const name of ['selectedPrompt', 'requestedModel', 'instance', 'build'] as const) {
    if (levels[name].status === 'PASS' && levels.binding.status !== 'PASS') add(name, 'UNVERIFIED', 'Response/trace association is not established.');
  }
  for (const name of names) if (levels[name].status === 'UNVERIFIED' && !levels[name].issues.length) levels[name].issues.push(`${name} identity is absent or incomplete`);
  const issues = names.flatMap(n => levels[n].issues.map(issue => `${n}: ${issue}`));
  const result: ResponseIdentityReport = { configurationSha256: configurationHash(config), mode,
    status: names.some(n => levels[n].status === 'FAIL') ? 'FAIL' : 'UNVERIFIED', responseSha256: sha256(capture.body),
    requestId, instanceId, observedAt: capture.observedAt, sourceHead,
    actual: { prompt, requestedModel, provider, cacheAgeMs, cacheStatus }, levels, issues,
    rung: `${mode === 'simulation' ? 'SIMULATION' : 'CAPTURED RESPONSE'} — self-reported selected identity only; provider-bound composition and component execution UNVERIFIED` };
  freeze(result); issued.add(result); return result;
}
