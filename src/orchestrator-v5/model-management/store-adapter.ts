/**
 * Model Management v1 — Supabase store adapter (service-role client).
 *
 * Mirrors the SupabaseSessionStore idiom (session/supabase-store.ts):
 * constructor-injected `SupabaseClient` (hand-rolled mocks in tests, no
 * live network), writes exclusively via RPC, reads via direct SELECT.
 *
 * Writes: `create_model_version` / `restore_model_version` — SECURITY
 * DEFINER, service-role-only RPCs (migration
 * 20260705120000_v5_model_versions.sql — EXECUTED on staging 2026-07-08,
 * build e122f16, see acceptance-evidence/gm-mm/03-mm-owned-scenario-proof.md
 * (STALE-COMMENT FIX, CEE hygiene batch FIX 2: previously said "AUTHORED,
 * NOT EXECUTED"); running this adapter against a database WITHOUT that
 * migration still surfaces as ModelVersionStoreError, never silent data
 * loss).
 *
 * Error mapping (distinct SQLSTATEs raised by the RPCs):
 *   MV001 → ModelVersionSignInRequiredError (guest refusal, recoverable)
 *   MV404 → ModelVersionNotFoundError
 *   MV409 → ModelVersionCasConflictError (stale expected-hash write)
 *   else  → ModelVersionStoreError
 *
 * Rows in model_versions are IMMUTABLE — this adapter never mutates or
 * deletes them (restore appends a new version via the RPC).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { computeVersionAnalysisAffectingHashRecord } from '../context/graph-identity.js';

import type {
  AtomicRestoreVersionOutcome,
  ModelVersionRecord,
  ModelVersionSummary,
  VersionWriteOutcome,
} from './types.js';

// ---------------------------------------------------------------------------
// Typed errors (session-store idiom: adapter throws typed, service maps).
// ---------------------------------------------------------------------------

export class ModelVersionSignInRequiredError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelVersionSignInRequiredError';
  }
}

export class ModelVersionNotFoundError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelVersionNotFoundError';
  }
}

export class ModelVersionCasConflictError extends Error {
  readonly expectedHash: string | null;
  constructor(message: string, expectedHash: string | null, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelVersionCasConflictError';
    this.expectedHash = expectedHash;
  }
}

export class ModelVersionMutationIdReusedError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelVersionMutationIdReusedError';
  }
}

export class ModelVersionStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ModelVersionStoreError';
  }
}

// ---------------------------------------------------------------------------
// Inputs.
// ---------------------------------------------------------------------------

export interface SaveVersionWrite {
  readonly scenario_id: string;
  readonly graph: unknown;
  /** Group A identity envelope — computed CEE-side by the service via
   *  `computeGraphIdentityHash` (never re-implemented here). */
  readonly graph_identity_hash: string;
  readonly hash_algorithm: string;
  readonly identity_projection_version: string;
  readonly identity_normaliser_version: string;
  readonly graph_schema_version: string;
  readonly label?: string;
  readonly provenance?: string;
  /** Optional write-time CAS: expected CURRENT HEAD identity hash,
   *  evaluated in-transaction by the RPC under the scenarios row lock. */
  readonly expected_graph_identity_hash?: string;
  /** Optional caller-supplied journey event id (idempotency key; the RPC
   *  mints a row-keyed id when absent). */
  readonly event_id?: string;
}

export interface RestoreVersionWrite {
  readonly scenario_id: string;
  readonly version_id: string;
  readonly label?: string;
  readonly expected_graph_identity_hash?: string;
}

export interface AtomicRestoreVersionWrite {
  readonly scenario_id: string;
  readonly version_id: string;
  readonly mutation_id: string;
  readonly graph: unknown;
  readonly graph_identity_hash: string;
  readonly analysis_affecting_hash: string;
  readonly hash_algorithm: string;
  readonly identity_projection_version: string;
  readonly identity_normaliser_version: string;
  readonly graph_schema_version: string;
  readonly source_graph_identity_hash: string;
  readonly current_graph: unknown;
  readonly current_graph_identity_hash: string | null;
  readonly current_analysis_affecting_hash: string | null;
  readonly expected_graph_identity_hash: string | null;
  readonly actor_kind: 'known' | 'system' | 'unknown';
  readonly authored_by: string | null;
  readonly source_turn_id: string | null;
  readonly label?: string;
}

/** Store port — the service depends on this interface, not the class, so
 *  tests inject hand-rolled fakes without a Supabase client. */
export interface ModelVersionStorePort {
  saveVersion(write: SaveVersionWrite): Promise<VersionWriteOutcome>;
  listVersions(
    scenarioId: string,
    limit?: number,
    beforeSequence?: number,
  ): Promise<readonly ModelVersionSummary[]>;
  getVersion(scenarioId: string, versionId: string): Promise<ModelVersionRecord | null>;
  /** Exact committed-turn lookup; never substitutes the current/newest version. */
  getVersionForCommittedTurn?(
    scenarioId: string, sourceTurnId: string, mutationId: string,
  ): Promise<ModelVersionRecord | null>;
  restoreVersion(write: RestoreVersionWrite): Promise<VersionWriteOutcome>;
  restoreVersionAtomic?(
    write: AtomicRestoreVersionWrite,
  ): Promise<AtomicRestoreVersionOutcome>;
  getCurrentVersionId(scenarioId: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Implementation.
// ---------------------------------------------------------------------------

interface SupabaseErrorLike {
  message?: string;
  code?: string;
}

function errMsg(e: unknown): string {
  return (e as SupabaseErrorLike | null)?.message ?? String(e);
}

function errCode(e: unknown): string | undefined {
  return (e as SupabaseErrorLike | null)?.code ?? undefined;
}

/** Summary columns — the public projection excludes `graph`. Kept as ONE
 *  string literal: concatenation would
 *  widen the type to `string` and break supabase-js's type-level column
 *  parser (rows would type as GenericStringError). */
const MODEL_VERSION_SUMMARY_COLUMNS =
  'id, scenario_id, owner_user_id, version_number, graph_identity_hash, analysis_affecting_hash, hash_algorithm, identity_projection_version, identity_normaliser_version, graph_schema_version, label, provenance, restored_from_version_id, mutation_id, parent_version_id, root_version_id, actor_kind, authored_by, creation_kind, source_version_id, source_turn_id, created_at';

const MODEL_VERSION_RECORD_COLUMNS = `${MODEL_VERSION_SUMMARY_COLUMNS}, graph`;
// Legacy rows predate analysis-affecting-hash persistence. The list reads the
// stored snapshot only to derive that one missing server-owned fact; `graph`
// is discarded by parseSummaryRow and can never enter the list wire shape.
const MODEL_VERSION_LIST_COLUMNS = MODEL_VERSION_RECORD_COLUMNS;

export const MODEL_VERSION_LIST_DEFAULT_LIMIT = 50;

export class SupabaseModelVersionStore implements ModelVersionStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async saveVersion(write: SaveVersionWrite): Promise<VersionWriteOutcome> {
    // PostgREST discipline (the 20260426160532 lesson): the function name is
    // distinct (no overloads exist), and ALL named args are passed anyway as
    // defence-in-depth against any future overload reintroduction.
    const { data, error } = await this.client.rpc('create_model_version', {
      p_scenario_id: write.scenario_id,
      p_graph: write.graph,
      p_graph_identity_hash: write.graph_identity_hash,
      p_projection_version: write.identity_projection_version,
      p_normaliser_version: write.identity_normaliser_version,
      p_graph_schema_version: write.graph_schema_version,
      p_hash_algorithm: write.hash_algorithm,
      p_label: write.label ?? null,
      p_provenance: write.provenance ?? null,
      // Caller-supplied idempotency key when present (commit-seam hook:
      // deterministic on the turn id); else the RPC mints a row-keyed id.
      p_event_id: write.event_id ?? null,
      p_expected_graph_identity_hash: write.expected_graph_identity_hash ?? null,
    });
    if (error) {
      throw mapRpcError('create_model_version', error, write.expected_graph_identity_hash ?? null);
    }
    return parseWriteOutcome('create_model_version', data);
  }

  async restoreVersion(write: RestoreVersionWrite): Promise<VersionWriteOutcome> {
    const { data, error } = await this.client.rpc('restore_model_version', {
      p_scenario_id: write.scenario_id,
      p_version_id: write.version_id,
      p_label: write.label ?? null,
      p_event_id: null,
      p_expected_graph_identity_hash: write.expected_graph_identity_hash ?? null,
    });
    if (error) {
      throw mapRpcError('restore_model_version', error, write.expected_graph_identity_hash ?? null);
    }
    return parseWriteOutcome('restore_model_version', data);
  }

  async restoreVersionAtomic(
    write: AtomicRestoreVersionWrite,
  ): Promise<AtomicRestoreVersionOutcome> {
    const rpc = 'restore_model_version_atomic_v1';
    const { data, error } = await this.client.rpc(rpc, {
      p_scenario_id: write.scenario_id,
      p_version_id: write.version_id,
      p_mutation_id: write.mutation_id,
      p_graph: write.graph,
      p_graph_identity_hash: write.graph_identity_hash,
      p_analysis_affecting_hash: write.analysis_affecting_hash,
      p_projection_version: write.identity_projection_version,
      p_normaliser_version: write.identity_normaliser_version,
      p_graph_schema_version: write.graph_schema_version,
      p_hash_algorithm: write.hash_algorithm,
      p_source_graph_identity_hash: write.source_graph_identity_hash,
      p_current_graph: write.current_graph,
      p_current_graph_identity_hash: write.current_graph_identity_hash,
      p_current_analysis_affecting_hash: write.current_analysis_affecting_hash,
      p_expected_graph_identity_hash: write.expected_graph_identity_hash,
      p_actor_kind: write.actor_kind,
      p_authored_by: write.authored_by,
      p_source_turn_id: write.source_turn_id,
      p_label: write.label ?? null,
    });
    if (error) throw mapRpcError(rpc, error, write.expected_graph_identity_hash);
    return parseAtomicRestoreOutcome(rpc, data);
  }

  async listVersions(
    scenarioId: string,
    limit: number = MODEL_VERSION_LIST_DEFAULT_LIMIT,
    beforeSequence?: number,
  ): Promise<readonly ModelVersionSummary[]> {
    // Newest-first by the monotonic per-scenario ordering identity —
    // version_number, NOT created_at (fixture/same-ms timestamps must never
    // reorder history; the unique (scenario_id, version_number) index makes
    // this a stable total order).
    let query = this.client
      .from('model_versions')
      .select(MODEL_VERSION_LIST_COLUMNS)
      .eq('scenario_id', scenarioId)
      .order('version_number', { ascending: false });
    if (beforeSequence !== undefined) {
      query = query.lt('version_number', beforeSequence);
    }
    const { data, error } = await query.limit(limit);
    if (error) {
      throw new ModelVersionStoreError(
        `listVersions(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error },
      );
    }
    return ((data ?? []) as Record<string, unknown>[]).map((row) =>
      parseSummaryRow(scenarioId, row),
    );
  }

  async getVersion(scenarioId: string, versionId: string): Promise<ModelVersionRecord | null> {
    // scenario_id filter alongside id: a version id from another scenario
    // must read as absent, never leak (defence-in-depth on top of RLS —
    // the service-role client bypasses RLS by design).
    const { data, error } = await this.client
      .from('model_versions')
      .select(MODEL_VERSION_RECORD_COLUMNS)
      .eq('scenario_id', scenarioId)
      .eq('id', versionId)
      .maybeSingle();
    if (error) {
      throw new ModelVersionStoreError(
        `getVersion(${scenarioId}, ${versionId}) failed: ${errMsg(error)}`,
        { cause: error },
      );
    }
    if (data == null) return null;
    const row = data as Record<string, unknown>;
    return { ...parseSummaryRow(scenarioId, row), graph: row.graph ?? null };
  }

  async getCurrentVersionId(scenarioId: string): Promise<string | null> {
    const { data, error } = await this.client
      .from('scenarios')
      .select('current_model_version_id')
      .eq('id', scenarioId)
      .maybeSingle();
    if (error) {
      throw new ModelVersionStoreError(
        `getCurrentVersionId(${scenarioId}) failed: ${errMsg(error)}`,
        { cause: error },
      );
    }
    const pointer = (data as { current_model_version_id?: unknown } | null)
      ?.current_model_version_id;
    return typeof pointer === 'string' && pointer.length > 0 ? pointer : null;
  }

  async getVersionForCommittedTurn(
    scenarioId: string,
    sourceTurnId: string,
    mutationId: string,
  ): Promise<ModelVersionRecord | null> {
    const { data, error } = await this.client
      .from('model_versions')
      .select(MODEL_VERSION_RECORD_COLUMNS)
      .eq('scenario_id', scenarioId)
      .eq('source_turn_id', sourceTurnId)
      .eq('mutation_id', mutationId)
      .eq('creation_kind', 'committed_mutation')
      .maybeSingle();
    if (error) {
      throw new ModelVersionStoreError('Committed-turn version read failed', { cause: error });
    }
    if (data == null) return null;
    const row = data as Record<string, unknown>;
    return { ...parseSummaryRow(scenarioId, row), graph: row.graph ?? null };
  }
}

// ---------------------------------------------------------------------------
// Row/outcome parsing — content-level checks, degraded rows throw typed
// store errors (silent shape drift must not propagate).
// ---------------------------------------------------------------------------

function requireString(row: Record<string, unknown>, key: string, ctx: string): string {
  const v = row[key];
  if (typeof v !== 'string' || v.length === 0) {
    throw new ModelVersionStoreError(`${ctx}: row field '${key}' missing or non-string`);
  }
  return v;
}

function optionalString(row: Record<string, unknown>, key: string): string | null {
  const v = row[key];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

function explicitNullableString(
  row: Record<string, unknown>,
  key: string,
  ctx: string,
): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value === 'string' && value.length > 0) return value;
  throw new ModelVersionStoreError(`${ctx}: row field '${key}' must be non-empty or null`);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isArrayOfObjects(value: unknown): boolean {
  return Array.isArray(value) && value.every(isPlainObject);
}

/** Dereferenced UNCONDITIONALLY by the projection — see requireGraphForIdentity. */
const IDENTITY_REQUIRED_COLLECTIONS = ['nodes', 'edges'] as const;

/**
 * Narrow the persisted `graph` column — SELECTed as `unknown`, and genuinely
 * unknown — to the type the durable-identity hasher declares, after checking the
 * structure that hasher ACTUALLY consumes.
 *
 * Deliberately NOT `GraphStateIngressSchema.safeParse`, the repo's usual parser
 * for this shape. That schema is the UI WIRE contract: it requires `kind` and
 * `label` on every node because the validator's GraphLookup needs them. Persistence
 * never required them. Measured at this tip, a legacy row of the shape this very
 * column set was added to serve — `{nodes:[{id:'n1'}],edges:[]}` — FAILS that parse
 * and yet hashes deterministically (56ffb07f…). Gating on it would convert the
 * legacy backfill into a hard read failure and redden the legacy-derivation case in
 * store-adapter.test.ts. Right guard, wrong boundary.
 *
 * What the projection actually requires is DERIVED from its body
 * (`computeAnalysisAffectingGraphHashSha256`, graph-hash.ts), not guessed:
 * it reads `nodes.length` / `edges.length` and then `nodes.map(...)` /
 * `edges.map(...)` UNCONDITIONALLY, while `options` and `goal_constraints` are
 * `Array.isArray`-guarded. So `nodes` and `edges` are required and must be arrays;
 * `options` is genuinely optional. Both failure modes below are measured, not
 * theoretical:
 *   · a row the hasher cannot dereference (`'corrupt'`, `42`, `[1,2,3]`, and
 *     `{corrupted:true}` — an object, but with no `nodes`) does NOT degrade to
 *     `null`. It throws a raw `TypeError` out of the projection: an UNTYPED error
 *     escaping a section whose whole contract is that degraded rows throw
 *     `ModelVersionStoreError`;
 *   · `{nodes:[42,'x'],edges:[]}` hashes SILENTLY to a well-formed 64-hex
 *     (8249e07f…) that can never equal an identity computed on the write path — and
 *     that value is then served as the row's authoritative `analysis_affecting_hash`,
 *     the field CAS and freshness compare on. This is the case a bare `as` cast
 *     would have shipped.
 *
 * Written as an ASSERTION SIGNATURE, not as a function returning a cast value.
 * The hasher's DECLARED parameter is stricter than its real contract, so no total
 * function can produce a `GraphStateIngress` from a legacy row — the narrowing is
 * irreducibly an assertion. Saying so with `asserts` keeps it honest AND keeps the
 * double-cast population at its frozen baseline
 * (scripts/check-forbidden-boundary-patterns.sh): the containment ratchet caught the
 * first draft of this function, which reached for that construct. Every property the
 * projection dereferences is checked below, so the assertion claims only what was
 * measured, and the malformed shapes fail loud and typed before reaching it.
 */
function assertGraphForIdentity(
  value: unknown,
  ctx: string,
): asserts value is GraphStateIngress {
  if (!isPlainObject(value)) {
    throw new ModelVersionStoreError(
      `${ctx}: row field 'graph' must be an object to derive an analysis-affecting identity`,
    );
  }
  for (const key of IDENTITY_REQUIRED_COLLECTIONS) {
    if (!isArrayOfObjects(value[key])) {
      throw new ModelVersionStoreError(
        `${ctx}: row field 'graph.${key}' must be an array of objects to derive an analysis-affecting identity`,
      );
    }
  }
  if (value.options !== undefined && !isArrayOfObjects(value.options)) {
    throw new ModelVersionStoreError(
      `${ctx}: row field 'graph.options' must be an array of objects to derive an analysis-affecting identity`,
    );
  }
}

function parseSummaryRow(scenarioId: string, row: Record<string, unknown>): ModelVersionSummary {
  const ctx = `model_versions row (scenario ${scenarioId})`;
  const versionNumber = row.version_number;
  if (typeof versionNumber !== 'number' || !Number.isInteger(versionNumber) || versionNumber < 1) {
    throw new ModelVersionStoreError(`${ctx}: version_number missing or invalid`);
  }
  const storedAnalysisHash = explicitNullableString(row, 'analysis_affecting_hash', ctx);
  let derivedAnalysisHash: string | null = null;
  if (storedAnalysisHash === null) {
    // Bound to a const so the assertion signature can narrow it; a property
    // access off `row` is not a narrowable reference.
    const graph = row.graph;
    assertGraphForIdentity(graph, ctx);
    derivedAnalysisHash = computeVersionAnalysisAffectingHashRecord(graph)?.value ?? null;
  }
  const analysisHash = storedAnalysisHash ?? derivedAnalysisHash;
  if (analysisHash === null || !/^[0-9a-f]{64}$/.test(analysisHash)) {
    throw new ModelVersionStoreError(`${ctx}: analysis-affecting identity is unavailable`);
  }
  const actorKind = row.actor_kind;
  if (
    actorKind !== null &&
    actorKind !== 'known' &&
    actorKind !== 'system' &&
    actorKind !== 'unknown'
  ) {
    throw new ModelVersionStoreError(`${ctx}: actor_kind is invalid`);
  }
  const creationKind = row.creation_kind;
  if (
    creationKind !== null &&
    creationKind !== 'initial' &&
    creationKind !== 'committed_mutation' &&
    creationKind !== 'restore' &&
    creationKind !== 'variant_creation' &&
    creationKind !== 'variant_promotion' &&
    creationKind !== 'unknown'
  ) {
    throw new ModelVersionStoreError(`${ctx}: creation_kind is invalid`);
  }
  return {
    id: requireString(row, 'id', ctx),
    scenario_id: requireString(row, 'scenario_id', ctx),
    owner_user_id: requireString(row, 'owner_user_id', ctx),
    version_number: versionNumber,
    graph_identity_hash: requireString(row, 'graph_identity_hash', ctx),
    hash_algorithm: requireString(row, 'hash_algorithm', ctx),
    identity_projection_version: requireString(row, 'identity_projection_version', ctx),
    identity_normaliser_version: requireString(row, 'identity_normaliser_version', ctx),
    graph_schema_version: requireString(row, 'graph_schema_version', ctx),
    analysis_affecting_hash: analysisHash,
    mutation_id: explicitNullableString(row, 'mutation_id', ctx),
    parent_version_id: explicitNullableString(row, 'parent_version_id', ctx),
    root_version_id: explicitNullableString(row, 'root_version_id', ctx),
    actor_kind: actorKind,
    authored_by: explicitNullableString(row, 'authored_by', ctx),
    creation_kind: creationKind,
    source_version_id: explicitNullableString(row, 'source_version_id', ctx),
    source_turn_id: explicitNullableString(row, 'source_turn_id', ctx),
    label: optionalString(row, 'label'),
    provenance: optionalString(row, 'provenance'),
    restored_from_version_id: optionalString(row, 'restored_from_version_id'),
    created_at: requireString(row, 'created_at', ctx),
  };
}

function parseWriteOutcome(rpc: string, data: unknown): VersionWriteOutcome {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ModelVersionStoreError(`${rpc} returned non-object outcome: ${JSON.stringify(data)}`);
  }
  const row = data as Record<string, unknown>;
  const versionId = row.version_id;
  const versionNumber = row.version_number;
  const hash = row.graph_identity_hash;
  if (typeof versionId !== 'string' || typeof versionNumber !== 'number' || typeof hash !== 'string') {
    throw new ModelVersionStoreError(`${rpc} returned malformed outcome: ${JSON.stringify(data)}`);
  }
  const restoredFrom = row.restored_from_version_id;
  return {
    version_id: versionId,
    version_number: versionNumber,
    graph_identity_hash: hash,
    deduped: row.deduped === true,
    event_id: typeof row.event_id === 'string' ? row.event_id : null,
    ...(typeof restoredFrom === 'string' ? { restored_from_version_id: restoredFrom } : {}),
  };
}

function parseAtomicRestoreOutcome(
  rpc: string,
  data: unknown,
): AtomicRestoreVersionOutcome {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new ModelVersionStoreError(`${rpc} returned non-object outcome: ${JSON.stringify(data)}`);
  }
  const row = data as Record<string, unknown>;
  const requiredStrings = [
    'mutation_id',
    'version_id',
    'graph_identity_hash',
    'analysis_affecting_hash',
    'hash_algorithm',
    'identity_projection_version',
    'identity_normaliser_version',
    'graph_schema_version',
    'restored_from_version_id',
    'event_id',
    'analysis_invalidated_at',
    'actor_kind',
    'creation_kind',
    'source_version_id',
  ] as const;
  for (const key of requiredStrings) {
    if (typeof row[key] !== 'string' || row[key].length === 0) {
      throw new ModelVersionStoreError(`${rpc} returned malformed ${key}: ${JSON.stringify(data)}`);
    }
  }
  if (
    typeof row.version_number !== 'number' ||
    !Number.isInteger(row.version_number) ||
    row.version_number < 1 ||
    typeof row.deduped !== 'boolean' ||
    typeof row.replayed !== 'boolean' ||
    !Number.isFinite(Date.parse(row.analysis_invalidated_at as string)) ||
    !Object.prototype.hasOwnProperty.call(row, 'graph')
  ) {
    throw new ModelVersionStoreError(`${rpc} returned malformed outcome: ${JSON.stringify(data)}`);
  }
  if (!/^[0-9a-f]{64}$/.test(row.analysis_affecting_hash as string)) {
    throw new ModelVersionStoreError(`${rpc} returned malformed analysis_affecting_hash: ${JSON.stringify(data)}`);
  }
  if (row.undo_version_id !== null && typeof row.undo_version_id !== 'string') {
    throw new ModelVersionStoreError(`${rpc} returned malformed undo_version_id: ${JSON.stringify(data)}`);
  }
  if (
    (row.parent_version_id !== null && typeof row.parent_version_id !== 'string') ||
    (row.root_version_id !== null && typeof row.root_version_id !== 'string') ||
    (row.authored_by !== null && typeof row.authored_by !== 'string') ||
    (row.source_turn_id !== null && typeof row.source_turn_id !== 'string')
  ) {
    throw new ModelVersionStoreError(`${rpc} returned malformed provenance: ${JSON.stringify(data)}`);
  }
  if (
    row.actor_kind !== 'known' &&
    row.actor_kind !== 'system' &&
    row.actor_kind !== 'unknown'
  ) {
    throw new ModelVersionStoreError(`${rpc} returned malformed actor_kind: ${JSON.stringify(data)}`);
  }
  if (
    (row.actor_kind === 'known' &&
      (typeof row.authored_by !== 'string' || row.authored_by.length === 0)) ||
    (row.actor_kind !== 'known' && row.authored_by !== null)
  ) {
    throw new ModelVersionStoreError(`${rpc} returned contradictory actor attribution: ${JSON.stringify(data)}`);
  }
  if (
    row.creation_kind !== 'restore' ||
    row.source_version_id !== row.restored_from_version_id
  ) {
    throw new ModelVersionStoreError(`${rpc} returned contradictory restore provenance: ${JSON.stringify(data)}`);
  }
  return {
    mutation_id: row.mutation_id as string,
    version_id: row.version_id as string,
    version_number: row.version_number,
    graph_identity_hash: row.graph_identity_hash as string,
    analysis_affecting_hash: row.analysis_affecting_hash as string,
    hash_algorithm: row.hash_algorithm as string,
    identity_projection_version: row.identity_projection_version as string,
    identity_normaliser_version: row.identity_normaliser_version as string,
    graph_schema_version: row.graph_schema_version as string,
    restored_from_version_id: row.restored_from_version_id as string,
    undo_version_id: row.undo_version_id as string | null,
    parent_version_id: row.parent_version_id as string | null,
    root_version_id: row.root_version_id as string | null,
    actor_kind: row.actor_kind as 'known' | 'system' | 'unknown',
    authored_by: row.authored_by as string | null,
    creation_kind: 'restore',
    source_version_id: row.source_version_id as string,
    source_turn_id: row.source_turn_id as string | null,
    graph: row.graph,
    deduped: row.deduped,
    replayed: row.replayed,
    analysis_invalidated_at: row.analysis_invalidated_at as string,
    event_id: row.event_id as string,
  };
}

function mapRpcError(rpc: string, error: unknown, expectedHash: string | null): Error {
  const code = errCode(error);
  const message = `${rpc} RPC failed: ${errMsg(error)}`;
  switch (code) {
    case 'MV001':
      return new ModelVersionSignInRequiredError(message, { cause: error });
    case 'MV404':
      return new ModelVersionNotFoundError(message, { cause: error });
    case 'MV409':
      return new ModelVersionCasConflictError(message, expectedHash, { cause: error });
    case 'MV422':
      return new ModelVersionMutationIdReusedError(message, { cause: error });
    default:
      return new ModelVersionStoreError(message, { cause: error });
  }
}
