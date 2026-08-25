/**
 * Authenticated live-wire witness for Core Runtime canonical-state precedence.
 *
 * This file is an evidence client, never a state, authentication or mutation
 * authority. It uses the existing authenticated scenario-graph reader and V5
 * turn route against an externally provisioned disposable owned scenario. The
 * fixture's conflict case is scored by the existing canonical-precedence
 * scorer; no second detector or interpretation of GraphV3 is introduced here.
 *
 * The live scenario must already contain the fixture's current model, recent
 * conflicting conversation, rolling-summary conflicts, valid durable summary
 * fact, accepted-change fact and stale analysis/readiness state. This client
 * neither creates that state nor repairs it. Primary owns account and fixture
 * provisioning.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  AnalysisStateV1Schema,
  OlumiResponseSchema,
  type AnalysisStateV1,
} from '@talchain/schemas/boundary';
import { z } from 'zod';

import {
  enforceTurnCap,
  resolveLiveGate,
} from '../../orchestrator-eval/src/live-gate.js';
import {
  loadCanonicalPrecedenceCase,
  scoreCanonicalPrecedenceAnswer,
  type CanonicalConflictCase,
  type CanonicalPrecedenceScore,
} from './canonical-state-precedence.js';
import {
  GraphStateIngressSchema,
  type GraphStateIngress,
} from '../../../src/orchestrator-v5/boundary/request-extensions.js';
import { readFactorValueView } from '../../../src/cee/provenance/factor-value-provenance.js';
import { projectGoalTargetRecord } from '../../../src/orchestrator-v5/context/goal-target-record.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const REQUEST_TIMEOUT_MS = 180_000;

export const AUTHENTICATED_WIRE_ENV = {
  baseUrl: 'OLUMI_CEE_BASE_URL',
  assistKey: 'OLUMI_ASSIST_KEY',
  userJwt: 'OLUMI_AUTHENTICATED_USER_JWT',
  scenarioIds: 'OLUMI_AUTHENTICATED_SCENARIO_IDS',
  expectedGraphIdentity: 'OLUMI_EXPECTED_GRAPH_IDENTITY_HASH',
} as const;

const WireFixtureSchema = z.object({
  schema: z.literal('authenticated_canonical_precedence_wire.v1'),
  evidence_rung: z.literal('AUTHENTICATED_LIVE_WIRE'),
  scoring_case_fixture: z.literal('canonical-precedence-case.json'),
  scenario_count: z.literal(3),
  turns_per_scenario: z.literal(1),
  scenario_mode: z.literal('distinct_preprovisioned_scenarios'),
  worst_case_provider_attempts_per_turn: z.literal(4),
  endpoints: z.object({
    graph_read: z.literal('/assist/v1/scenarios/{scenario_id}/graph'),
    turn: z.literal('/orchestrate/v2/turn'),
  }).strict(),
  turn: z.object({
    kind: z.literal('message'),
    source: z.literal('composer'),
    turn_class: z.literal('direct_answer'),
    stage: z.literal('analyse'),
  }).strict(),
}).strict();

export type AuthenticatedWireFixture = z.infer<typeof WireFixtureSchema>;

const GraphIdentitySchema = z.object({
  kind: z.literal('graph_identity_hash'),
  value: z.string().regex(SHA256_PATTERN),
  algorithm: z.literal('sha256'),
  projection_version: z.string().min(1),
  graph_schema_version: z.string().min(1),
  normaliser_version: z.string().min(1),
}).strict();

const GraphReadSchema = z.object({
  schema: z.literal('scenario_graph.v1'),
  scenario_id: z.string().uuid(),
  graph: z.unknown(),
  graph_present: z.literal(true),
  graph_identity_hash: GraphIdentitySchema,
  analysis_state: z.unknown(),
}).passthrough();

export interface JwtClaims {
  readonly sub: string;
  readonly role: 'authenticated';
  readonly exp: number;
}

export interface AuthenticatedWirePlan {
  readonly fixture: AuthenticatedWireFixture;
  readonly kase: CanonicalConflictCase;
  readonly baseUrl: string;
  readonly assistKey: string;
  readonly bearer: string;
  readonly scenarioIds: readonly [string, string, string];
  readonly expectedGraphIdentity: string;
  readonly authenticatedClaims: JwtClaims;
  readonly plannedProviderAttemptCeiling: number;
}

export interface AuthenticatedWireObservation {
  readonly scenario_id: string;
  readonly anonymous_status: 404;
  readonly score: CanonicalPrecedenceScore;
  readonly response_version: 2;
  readonly graph_identity_before: string;
  readonly graph_identity_after: string;
}

export interface AuthenticatedWireReport {
  readonly schema: 'authenticated_canonical_precedence_live_report.v1';
  readonly evidence_rung: 'AUTHENTICATED_LIVE_WIRE';
  readonly advisory_only: true;
  readonly reliability_claim: false;
  readonly status: 'PASS' | 'FAIL';
  readonly aggregation: 'worst_scenario_any_failure';
  readonly n: 3;
  readonly scenario_ids: readonly [string, string, string];
  readonly scenario_independence: 'three_distinct_preprovisioned_scenarios';
  readonly ownership_preflight: 'anonymous_404_then_same_scenario_bearer_200';
  readonly canonical_preflight: 'all_three_graph_and_analysis_anchors_exact';
  readonly question_self_priming: 'none_of_scored_canaries_present';
  readonly graph_identity: string;
  readonly graph_unchanged: true;
  readonly served_cee_build: string;
  readonly planned_model_turns: 3;
  readonly planned_provider_attempt_ceiling: number;
  readonly observations: readonly AuthenticatedWireObservation[];
  readonly caveat: string;
}

type FetchInit = Parameters<typeof globalThis.fetch>[1];
type FetchLike = (input: string | URL, init?: FetchInit) => Promise<Response>;

interface HttpJsonResponse {
  readonly body: unknown;
  readonly serviceBuild: string;
}

export interface AuthenticatedWireRunOptions {
  readonly argv: readonly string[];
  readonly env: Readonly<Record<string, string | undefined>>;
  readonly fetchImpl?: FetchLike;
  readonly fixture?: unknown;
  readonly kase?: CanonicalConflictCase;
  readonly nowSeconds?: number;
  readonly randomId?: () => string;
}

function fixturePath(): string {
  return fileURLToPath(
    new URL('../fixtures/authenticated-canonical-precedence-wire.json', import.meta.url),
  );
}

export function loadAuthenticatedWireFixture(): AuthenticatedWireFixture {
  return WireFixtureSchema.parse(JSON.parse(readFileSync(fixturePath(), 'utf8')));
}

function requireSecretInput(
  env: Readonly<Record<string, string | undefined>>,
  name: string,
): string {
  const value = env[name];
  if (value === undefined || value.length === 0 || value.trim() !== value) {
    throw new Error(`${name} must be set to a non-empty, unpadded value`);
  }
  return value;
}

function decodeJwtSegment(segment: string, label: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(segment, 'base64url').toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('not an object');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`authenticated JWT ${label} is not valid base64url JSON`);
  }
}

export function validateAuthenticatedJwt(token: string, nowSeconds: number): JwtClaims {
  const segments = token.split('.');
  if (segments.length !== 3 || segments.some((segment) => segment.length === 0)) {
    throw new Error('OLUMI_AUTHENTICATED_USER_JWT must be a three-segment JWT');
  }
  const header = decodeJwtSegment(segments[0]!, 'header');
  const payload = decodeJwtSegment(segments[1]!, 'payload');
  if (typeof header.alg !== 'string' || header.alg.length === 0 || header.alg.toLowerCase() === 'none') {
    throw new Error('authenticated JWT must declare a non-none signing algorithm');
  }
  if (typeof payload.sub !== 'string' || !UUID_PATTERN.test(payload.sub)) {
    throw new Error('authenticated JWT sub must be a UUID');
  }
  if (payload.role !== 'authenticated') {
    throw new Error('authenticated JWT role must be authenticated');
  }
  if (typeof payload.exp !== 'number' || !Number.isInteger(payload.exp) || payload.exp <= nowSeconds) {
    throw new Error('authenticated JWT must carry an unexpired integer exp');
  }
  return { sub: payload.sub, role: 'authenticated', exp: payload.exp };
}

function validateBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('OLUMI_CEE_BASE_URL must be a valid absolute URL');
  }
  if (
    url.protocol !== 'https:'
    || url.username.length > 0
    || url.password.length > 0
    || url.search.length > 0
    || url.hash.length > 0
    || (url.pathname !== '/' && url.pathname !== '')
  ) {
    throw new Error('OLUMI_CEE_BASE_URL must be an origin-only HTTPS URL');
  }
  return url.origin;
}

function requestedMaxTurns(argv: readonly string[]): number | undefined {
  const index = argv.indexOf('--max-turns');
  if (index < 0) return undefined;
  const raw = argv[index + 1];
  const value = raw === undefined ? Number.NaN : Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`--max-turns must be a positive integer (got ${raw ?? 'missing'})`);
  }
  return value;
}

function parseScenarioIds(raw: string): readonly [string, string, string] {
  const ids = raw.split(',');
  if (
    ids.length !== 3
    || ids.some((id) => id.trim() !== id || !UUID_PATTERN.test(id))
    || new Set(ids).size !== 3
  ) {
    throw new Error(
      'OLUMI_AUTHENTICATED_SCENARIO_IDS must contain exactly three distinct, unpadded UUIDs',
    );
  }
  return [ids[0]!, ids[1]!, ids[2]!];
}

function assertQuestionHasNoScoredCanary(kase: CanonicalConflictCase): void {
  const question = kase.question.normalize('NFC').toLocaleLowerCase('en-GB');
  const change = kase.current.accepted_change;
  const canaries = [
    `${String(kase.current.goal.target_value)} ${kase.current.goal.target_unit}`,
    String(kase.current.goal.target_value),
    ...kase.current.constraints.flatMap((constraint) => [
      constraint.label,
      constraint.source_quote,
    ]),
    `${change.target_label} from ${String(change.before_value)} ${change.unit} to ${String(change.after_value)} ${change.unit}`,
    `${String(change.after_value)} ${change.unit}`,
    kase.current.readiness.description,
    kase.current.analysis.freshness,
    kase.durable_summary_fact.display,
    ...kase.obsolete_claims.map((claim) => claim.display),
    ...kase.never_stated_controls.map((control) => control.display),
  ];
  for (const canary of canaries) {
    if (question.includes(canary.normalize('NFC').toLocaleLowerCase('en-GB'))) {
      throw new Error(`authenticated wire question self-primes scored canary: ${canary}`);
    }
  }
}

export function resolveAuthenticatedWirePlan(
  options: Pick<AuthenticatedWireRunOptions, 'argv' | 'env' | 'fixture' | 'kase' | 'nowSeconds'>,
): AuthenticatedWirePlan {
  const gate = resolveLiveGate({ argv: options.argv, env: options.env });
  if (!gate.live) throw new Error(gate.reason);

  const fixture = WireFixtureSchema.parse(options.fixture ?? loadAuthenticatedWireFixture());
  const kase = options.kase
    ?? loadCanonicalPrecedenceCase(fixture.scoring_case_fixture);
  if (kase.mode !== 'canonical_conflict') {
    throw new Error('authenticated wire fixture must resolve a canonical_conflict case');
  }
  assertQuestionHasNoScoredCanary(kase);

  const baseUrl = validateBaseUrl(requireSecretInput(options.env, AUTHENTICATED_WIRE_ENV.baseUrl));
  const assistKey = requireSecretInput(options.env, AUTHENTICATED_WIRE_ENV.assistKey);
  const token = requireSecretInput(options.env, AUTHENTICATED_WIRE_ENV.userJwt);
  const scenarioIds = parseScenarioIds(
    requireSecretInput(options.env, AUTHENTICATED_WIRE_ENV.scenarioIds),
  );
  const expectedGraphIdentity = requireSecretInput(
    options.env,
    AUTHENTICATED_WIRE_ENV.expectedGraphIdentity,
  );
  if (!SHA256_PATTERN.test(expectedGraphIdentity)) {
    throw new Error('OLUMI_EXPECTED_GRAPH_IDENTITY_HASH must be a lowercase SHA-256 hex value');
  }

  const nowSeconds = options.nowSeconds ?? Math.floor(Date.now() / 1000);
  const authenticatedClaims = validateAuthenticatedJwt(token, nowSeconds);
  const plannedProviderAttemptCeiling =
    fixture.scenario_count
    * fixture.turns_per_scenario
    * fixture.worst_case_provider_attempts_per_turn;
  enforceTurnCap(plannedProviderAttemptCeiling, requestedMaxTurns(options.argv));

  return {
    fixture,
    kase,
    baseUrl,
    assistKey,
    bearer: `Bearer ${token}`,
    scenarioIds,
    expectedGraphIdentity,
    authenticatedClaims,
    plannedProviderAttemptCeiling,
  };
}

function endpoint(baseUrl: string, path: string, scenarioId: string): string {
  return new URL(path.replace('{scenario_id}', encodeURIComponent(scenarioId)), baseUrl).href;
}

function baseHeaders(plan: AuthenticatedWirePlan): Readonly<Record<string, string>> {
  return {
    'Content-Type': 'application/json',
    'X-Olumi-Assist-Key': plan.assistKey,
  };
}

function authenticatedHeaders(plan: AuthenticatedWirePlan): Readonly<Record<string, string>> {
  return {
    ...baseHeaders(plan),
    Authorization: plan.bearer,
  };
}

function servedCeeBuild(response: Response, label: string): string {
  const service = response.headers.get('x-olumi-service');
  const serviceBuild = response.headers.get('x-olumi-service-build');
  if (service !== 'cee') {
    throw new Error(`${label} did not expose the CEE service identity`);
  }
  if (serviceBuild === null || !/^[0-9a-f]{7}$/u.test(serviceBuild)) {
    throw new Error(`${label} did not expose a valid CEE build identity`);
  }
  return serviceBuild;
}

async function responseJson(
  fetchImpl: FetchLike,
  url: string,
  init: FetchInit,
  label: string,
): Promise<HttpJsonResponse> {
  const response = await fetchImpl(url, init);
  const text = await response.text();
  const serviceBuild = servedCeeBuild(response, label);
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }
  try {
    return { body: JSON.parse(text) as unknown, serviceBuild };
  } catch {
    throw new Error(`${label} returned non-JSON bytes`);
  }
}

interface AnonymousRefusalObservation {
  readonly status: 404;
  readonly serviceBuild: string;
}

async function readAnonymousGraphRefusal(
  plan: AuthenticatedWirePlan,
  fetchImpl: FetchLike,
  scenarioId: string,
): Promise<AnonymousRefusalObservation> {
  const response = await fetchImpl(
    endpoint(plan.baseUrl, plan.fixture.endpoints.graph_read, scenarioId),
    {
      method: 'POST',
      headers: baseHeaders(plan),
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
  );
  await response.text();
  const serviceBuild = servedCeeBuild(response, 'anonymous scenario-graph ownership preflight');
  if (response.status !== 404) {
    throw new Error(
      `anonymous scenario-graph ownership preflight returned HTTP ${response.status}; expected 404`,
    );
  }
  return { status: 404, serviceBuild };
}

interface GraphReadObservation {
  readonly envelope: z.infer<typeof GraphReadSchema>;
  readonly serviceBuild: string;
}

async function readAuthenticatedGraph(
  plan: AuthenticatedWirePlan,
  fetchImpl: FetchLike,
  scenarioId: string,
): Promise<GraphReadObservation> {
  const body = {};
  if (Object.prototype.hasOwnProperty.call(body, 'user_id')) {
    throw new Error('authenticated graph-read payload must never carry user_id');
  }
  const response = await responseJson(
    fetchImpl,
    endpoint(plan.baseUrl, plan.fixture.endpoints.graph_read, scenarioId),
    {
      method: 'POST',
      headers: authenticatedHeaders(plan),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
    'authenticated scenario-graph read',
  );
  const parsed = GraphReadSchema.parse(response.body);
  if (parsed.scenario_id !== scenarioId) {
    throw new Error('authenticated scenario-graph read returned a different scenario_id');
  }
  return { envelope: parsed, serviceBuild: response.serviceBuild };
}

export function buildAuthenticatedTurnPayload(
  plan: AuthenticatedWirePlan,
  scenarioId: string,
  turnId: string,
): Readonly<Record<string, unknown>> {
  const payload = {
    scenario_id: scenarioId,
    turn_id: turnId,
    turn_class: plan.fixture.turn.turn_class,
    kind: plan.fixture.turn.kind,
    stage: plan.fixture.turn.stage,
    source: plan.fixture.turn.source,
    message: plan.kase.question,
  } satisfies Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(payload, 'user_id')) {
    throw new Error('authenticated turn payload must never carry user_id');
  }
  return payload;
}

const MUTATION_RECEIPT_KEY = /^(?:draft_graph|graph_patch|applied_changes|applied_graph|model_receipt|committed_graph_receipt)$/iu;
const RECEIPT_SUFFIX_KEY = /(?:mutation|model[_-]?version).*receipt/iu;
const MUTATING_BLOCK_TYPES = new Set([
  'draft_graph',
  'graph_patch',
  'model_version_receipt',
  'mutation_receipt',
]);

export function findMutationReceipt(value: unknown, path = '$'): string | null {
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findMutationReceipt(value[index], `${path}[${index}]`);
      if (found !== null) return found;
    }
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    (typeof record.type === 'string'
      && MUTATING_BLOCK_TYPES.has(record.type.toLowerCase()))
    || (typeof record.block_type === 'string'
      && MUTATING_BLOCK_TYPES.has(record.block_type.toLowerCase()))
  ) {
    const discriminator = typeof record.block_type === 'string' ? 'block_type' : 'type';
    return `${path}.${discriminator}=${String(record[discriminator])}`;
  }
  for (const [key, nested] of Object.entries(record)) {
    if (MUTATION_RECEIPT_KEY.test(key) || RECEIPT_SUFFIX_KEY.test(key)) {
      return `${path}.${key}`;
    }
    const found = findMutationReceipt(nested, `${path}.${key}`);
    if (found !== null) return found;
  }
  return null;
}

const SANCTIONED_RESPONSE_SIDECARS = new Set([
  '_timings',
  '_diagnostic_trace',
  '_context_summary',
  '_reasoning',
  '_answer_shape',
  '_grounded_selection',
]);

export function stripSanctionedResponseSidecars(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('authenticated V5 turn returned a non-object envelope');
  }
  const body = { ...(raw as Record<string, unknown>) };
  for (const key of SANCTIONED_RESPONSE_SIDECARS) delete body[key];
  return body;
}

export function scoreAuthenticatedWireResponse(
  kase: CanonicalConflictCase,
  raw: unknown,
): CanonicalPrecedenceScore {
  // Scan the delivered bytes BEFORE removing route-sanctioned diagnostic
  // sidecars. A hidden mutation carrier is still a mutation carrier.
  const receiptPath = findMutationReceipt(raw);
  const wire = OlumiResponseSchema.parse(stripSanctionedResponseSidecars(raw));
  const visible = wire.assistant_text.trim();
  const score = scoreCanonicalPrecedenceAnswer(
    kase,
    visible,
    visible.length > 0 ? 'text_only' : 'invalid',
  );
  const errorBlockIndex = wire.blocks.findIndex((block) => block.type === 'error');
  if (receiptPath === null && errorBlockIndex < 0) return score;
  const failures = [...score.failures];
  if (receiptPath !== null) {
    failures.push(`precedence witness carried a mutation receipt at ${receiptPath}`);
  }
  if (errorBlockIndex >= 0) {
    failures.push(`precedence witness carried a published error block at $.blocks[${errorBlockIndex}]`);
  }
  return {
    ...score,
    pass: false,
    failures,
  };
}

interface TurnObservation {
  readonly raw: unknown;
  readonly serviceBuild: string;
}

async function runOneTurn(
  plan: AuthenticatedWirePlan,
  fetchImpl: FetchLike,
  scenarioId: string,
  turnId: string,
): Promise<TurnObservation> {
  const payload = buildAuthenticatedTurnPayload(plan, scenarioId, turnId);
  const response = await responseJson(
    fetchImpl,
    endpoint(plan.baseUrl, plan.fixture.endpoints.turn, scenarioId),
    {
      method: 'POST',
      headers: authenticatedHeaders(plan),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    },
    'authenticated V5 turn',
  );
  return {
    raw: response.body,
    serviceBuild: response.serviceBuild,
  };
}

function bindServedCeeBuild(builds: readonly string[]): string {
  if (builds.length === 0 || new Set(builds).size !== 1) {
    throw new Error('CEE service build identity changed within the witness');
  }
  return builds[0]!;
}

interface AnalysisAnchor {
  readonly run_state_kind: 'complete_stale';
  readonly readiness_status: string;
  readonly unresolved_blocker_message: string;
}

interface CanonicalPreflightObservation {
  readonly scenarioId: string;
  readonly anonymousStatus: 404;
  readonly graphRead: GraphReadObservation;
  readonly graph: GraphStateIngress;
  readonly analysisState: AnalysisStateV1;
  readonly analysisAnchor: AnalysisAnchor;
}

function recordOf(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function assertCanonicalGraphAndAnalysis(
  kase: CanonicalConflictCase,
  read: GraphReadObservation,
): Pick<CanonicalPreflightObservation, 'graph' | 'analysisState' | 'analysisAnchor'> {
  const graph = GraphStateIngressSchema.parse(read.envelope.graph);
  const nodesById = new Map<string, GraphStateIngress['nodes'][number]>();
  for (const node of graph.nodes) {
    if (nodesById.has(node.id)) throw new Error(`canonical graph has duplicate node id: ${node.id}`);
    nodesById.set(node.id, node);
  }

  const goals = graph.nodes.filter((node) => node.kind === 'goal');
  if (
    goals.length !== 1
    || goals[0]!.id !== kase.current.goal.id
    || goals[0]!.label !== kase.current.goal.label
  ) {
    throw new Error('canonical graph does not exactly match the case goal identity and label');
  }
  const target = projectGoalTargetRecord(graph);
  if (
    target?.status !== 'set'
    || target.value !== kase.current.goal.target_value
    || target.unit !== kase.current.goal.target_unit
  ) {
    throw new Error('canonical graph does not carry the exact authoritative goal target');
  }

  const optionNodes = graph.nodes.filter((node) => node.kind === 'option');
  if (optionNodes.length !== kase.current.options.length) {
    throw new Error('canonical graph option count does not match the precedence case');
  }
  for (const option of kase.current.options) {
    const actual = nodesById.get(option.id);
    if (actual?.kind !== 'option' || actual.label !== option.label) {
      throw new Error(`canonical graph does not exactly match option ${option.id}`);
    }
  }

  const rawConstraints = graph.goal_constraints ?? [];
  if (rawConstraints.length !== kase.current.constraints.length) {
    throw new Error('canonical graph constraint count does not match the precedence case');
  }
  const constraintsById = new Map<string, Record<string, unknown>>();
  for (const value of rawConstraints) {
    const constraint = recordOf(value);
    const id = constraint?.constraint_id ?? constraint?.id;
    if (typeof id !== 'string' || id.length === 0 || constraintsById.has(id)) {
      throw new Error('canonical graph has a malformed or duplicate constraint identity');
    }
    constraintsById.set(id, constraint);
  }
  for (const expected of kase.current.constraints) {
    const actual = constraintsById.get(expected.id);
    if (
      actual?.label !== expected.label
      || actual.source_quote !== expected.source_quote
    ) {
      throw new Error(`canonical graph does not exactly match constraint ${expected.id}`);
    }
  }

  const change = kase.current.accepted_change;
  const factor = nodesById.get(change.target_id);
  if (factor?.kind !== 'factor' || factor.label !== change.target_label) {
    throw new Error('canonical graph does not exactly match the accepted-change factor');
  }
  const factorRecord = factor as Record<string, unknown>;
  const acceptedChangeRawCarrier = recordOf(factorRecord.observed_state);
  const normalizedCurrentValue = readFactorValueView(factor).value;
  if (
    normalizedCurrentValue !== change.after_value
    || acceptedChangeRawCarrier?.raw_value !== change.after_value
    || acceptedChangeRawCarrier?.unit !== change.unit
  ) {
    throw new Error('canonical graph does not carry the accepted change current value and unit');
  }

  const analysisState = AnalysisStateV1Schema.parse(read.envelope.analysis_state);
  if (analysisState.run_state.kind !== 'complete_stale') {
    throw new Error('scenario analysis state is not complete_stale');
  }
  if (analysisState.readiness.status !== kase.current.readiness.status) {
    throw new Error('scenario analysis readiness does not match the precedence case');
  }
  if (
    analysisState.readiness.blockers.length !== 1
    || analysisState.readiness.blockers[0]!.message !== kase.current.readiness.description
  ) {
    throw new Error('scenario analysis unresolved blocker does not match the precedence case');
  }
  return {
    graph,
    analysisState,
    analysisAnchor: {
      run_state_kind: analysisState.run_state.kind,
      readiness_status: analysisState.readiness.status,
      unresolved_blocker_message: analysisState.readiness.blockers[0]!.message,
    },
  };
}

export async function runAuthenticatedCanonicalPrecedenceWire(
  options: AuthenticatedWireRunOptions,
): Promise<AuthenticatedWireReport> {
  // Resolve every live opt-in, credential shape, scenario/hash anchor, fixture
  // and cost cap before selecting/calling fetch. A malformed plan therefore
  // cannot make even a graph-read request.
  const plan = resolveAuthenticatedWirePlan(options);
  const fetchImpl = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const randomId = options.randomId ?? randomUUID;

  // Complete all three A/B ownership reads and all canonical anchors before
  // spending a single model call. Local JWT decoding is only an input-shape
  // guard; the bearer-protected route is the ownership authority.
  const preflights: CanonicalPreflightObservation[] = [];
  const serviceBuilds: string[] = [];
  for (const scenarioId of plan.scenarioIds) {
    const anonymous = await readAnonymousGraphRefusal(plan, fetchImpl, scenarioId);
    const graphRead = await readAuthenticatedGraph(plan, fetchImpl, scenarioId);
    serviceBuilds.push(anonymous.serviceBuild, graphRead.serviceBuild);
    if (anonymous.serviceBuild !== graphRead.serviceBuild) {
      throw new Error('CEE service build changed within an anonymous/bearer ownership preflight');
    }
    if (graphRead.envelope.graph_identity_hash.value !== plan.expectedGraphIdentity) {
      throw new Error('authenticated scenario graph does not match the expected identity');
    }
    const canonical = assertCanonicalGraphAndAnalysis(plan.kase, graphRead);
    preflights.push({
      scenarioId,
      anonymousStatus: anonymous.status,
      graphRead,
      ...canonical,
    });
  }
  bindServedCeeBuild(serviceBuilds);

  const baseline = preflights[0]!;
  for (const preflight of preflights.slice(1)) {
    if (
      !isDeepStrictEqual(preflight.graph, baseline.graph)
      || !isDeepStrictEqual(preflight.analysisAnchor, baseline.analysisAnchor)
    ) {
      throw new Error('the three provisioned scenarios do not share identical canonical anchors');
    }
  }

  const observations: AuthenticatedWireObservation[] = [];
  for (const preflight of preflights) {
    const turn = await runOneTurn(plan, fetchImpl, preflight.scenarioId, randomId());
    serviceBuilds.push(turn.serviceBuild);
    bindServedCeeBuild(serviceBuilds);

    const score = scoreAuthenticatedWireResponse(plan.kase, turn.raw);
    const after = await readAuthenticatedGraph(plan, fetchImpl, preflight.scenarioId);
    serviceBuilds.push(after.serviceBuild);
    bindServedCeeBuild(serviceBuilds);
    const afterCanonical = assertCanonicalGraphAndAnalysis(plan.kase, after);
    if (
      after.envelope.graph_identity_hash.value
        !== preflight.graphRead.envelope.graph_identity_hash.value
      || after.envelope.graph_identity_hash.value !== plan.expectedGraphIdentity
      || !isDeepStrictEqual(afterCanonical.graph, preflight.graph)
      || !isDeepStrictEqual(afterCanonical.analysisAnchor, preflight.analysisAnchor)
    ) {
      throw new Error('canonical graph or analysis anchors changed during the precedence witness');
    }
    observations.push({
      scenario_id: preflight.scenarioId,
      anonymous_status: preflight.anonymousStatus,
      score,
      response_version: 2,
      graph_identity_before: preflight.graphRead.envelope.graph_identity_hash.value,
      graph_identity_after: after.envelope.graph_identity_hash.value,
    });
  }

  const servedCeeBuild = bindServedCeeBuild(serviceBuilds);
  const pass = observations.every((observation) => observation.score.pass);
  return {
    schema: 'authenticated_canonical_precedence_live_report.v1',
    evidence_rung: plan.fixture.evidence_rung,
    advisory_only: true,
    reliability_claim: false,
    status: pass ? 'PASS' : 'FAIL',
    aggregation: 'worst_scenario_any_failure',
    n: plan.fixture.scenario_count,
    scenario_ids: plan.scenarioIds,
    scenario_independence: 'three_distinct_preprovisioned_scenarios',
    ownership_preflight: 'anonymous_404_then_same_scenario_bearer_200',
    canonical_preflight: 'all_three_graph_and_analysis_anchors_exact',
    question_self_priming: 'none_of_scored_canaries_present',
    graph_identity: plan.expectedGraphIdentity,
    graph_unchanged: true,
    served_cee_build: servedCeeBuild,
    planned_model_turns: plan.fixture.scenario_count * plan.fixture.turns_per_scenario,
    planned_provider_attempt_ceiling: plan.plannedProviderAttemptCeiling,
    observations,
    caveat:
      'Authenticated CEE HTTP + visible assistant_text witness across three separate preprovisioned scenarios. Rolling-summary and prior-fact cloning remain externally provisioned and are not graph-route-attested; the exact turn question contains none of the scored canary values. Requested direct_answer is not an observed routed-intent attestation. UI display and deployment identity remain Primary-owned.',
  };
}

async function main(): Promise<void> {
  const report = await runAuthenticatedCanonicalPrecedenceWire({
    argv: process.argv.slice(2),
    env: process.env,
  });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === 'PASS' ? 0 : 1;
}

const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === invokedPath) {
  main().catch((error: unknown) => {
    // Input names and HTTP status only: secret values are never interpolated
    // into errors, reports, request captures or stdout/stderr.
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
