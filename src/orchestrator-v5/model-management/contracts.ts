/**
 * Model Management v1 — strict boundary contracts (Layer 2, DARK; prep-only).
 *
 * Zod request/response schemas for the model-management entry points. NOTHING
 * here is wired to a route or exported as a public API this slice — these are
 * the strict shapes a later, separately-reviewed wiring slice will parse
 * ingress / validate egress with (the request-extensions.ts safeParse idiom).
 *
 * LOAD-BEARING SECURITY PROPERTY — the server owns graph + hash truth:
 *   - The identity envelope of a saved version (graph_identity_hash + its
 *     projection/normaliser/schema/algorithm versions) is ALWAYS computed
 *     server-side by the Group A `computeGraphIdentityHash` (service.ts). A
 *     client can never supply it: the request schemas below have NOWHERE to
 *     put it, and `.strict()` REJECTS any smuggled hash/envelope field rather
 *     than silently stripping it.
 *   - The ONLY hash a request may carry is `expected_graph_identity_hash` — an
 *     optimistic-CAS EXPECTATION compared in-transaction against the current
 *     head, never trusted as the identity of anything being written.
 *   - Restore accepts NO client graph: it copies the target version's graph
 *     server-side. The restore schema is `.strict()` with no `graph` field.
 *
 * Compare has NO request contract here on purpose: the product-facing
 * compare/timeline surface waits for #341 merged to staging (the internal
 * compare helper stays dark). Only create/list/current/restore + the response
 * and safe-error shapes are contracted this slice.
 */
import { z } from 'zod';

import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { CAS_CONFLICT_KIND } from './types.js';

// ---------------------------------------------------------------------------
// Shared field schemas.
// ---------------------------------------------------------------------------

const ScenarioId = z.string().uuid();
const VersionId = z.string().uuid();

/** 64-hex sha256. Used for BOTH the CAS expectation (request) and the stored
 *  identity value (response). In a request it is ONLY an optimistic-CAS
 *  expectation — never the identity of the graph being saved. */
const Sha256Hex = z.string().regex(/^[0-9a-f]{64}$/, 'must be a 64-hex sha256');

const Label = z.string().min(1).max(200);
const Provenance = z.string().min(1).max(200);
/** List page size — bounded so a request can never ask for an unbounded scan. */
const ListLimit = z.number().int().positive().max(200);

// ---------------------------------------------------------------------------
// REQUEST schemas — strict: an unexpected field (a smuggled identity hash /
// envelope / client graph on restore) is REJECTED, not stripped.
// ---------------------------------------------------------------------------

/** Save a new version. `graph` is hashed server-side; there is deliberately no
 *  field for the resulting identity hash/envelope — the client cannot supply
 *  it. `expected_graph_identity_hash` is the optional CAS expectation only. */
export const CreateVersionRequestSchema = z
  .object({
    scenario_id: ScenarioId,
    graph: GraphStateIngressSchema,
    label: Label.optional(),
    provenance: Provenance.optional(),
    expected_graph_identity_hash: Sha256Hex.optional(),
  })
  .strict();

/** Restore a version = create a NEW version copying the target's graph
 *  server-side. NO `graph` field: a client can never inject a graph on
 *  restore. `expected_graph_identity_hash` is the optional CAS expectation. */
export const RestoreVersionRequestSchema = z
  .object({
    scenario_id: ScenarioId,
    version_id: VersionId,
    label: Label.optional(),
    expected_graph_identity_hash: Sha256Hex.optional(),
  })
  .strict();

export const ListVersionsRequestSchema = z
  .object({
    scenario_id: ScenarioId,
    limit: ListLimit.optional(),
  })
  .strict();

export const GetCurrentVersionRequestSchema = z
  .object({
    scenario_id: ScenarioId,
  })
  .strict();

// ---------------------------------------------------------------------------
// RESPONSE schemas — the server-owned egress shapes (mirror types.ts exactly).
// The graph identity hash is a 64-hex content-address, opaque on the wire.
// ---------------------------------------------------------------------------

/** The Group A identity envelope stored per row — value + the version fields
 *  that scope its comparability. */
const identityEnvelopeShape = {
  graph_identity_hash: Sha256Hex,
  hash_algorithm: z.string().min(1),
  identity_projection_version: z.string().min(1),
  identity_normaliser_version: z.string().min(1),
  graph_schema_version: z.string().min(1),
} as const;

export const ModelVersionSummaryResponseSchema = z
  .object({
    id: z.string().uuid(),
    scenario_id: ScenarioId,
    owner_user_id: z.string().uuid(),
    version_number: z.number().int().positive(),
    ...identityEnvelopeShape,
    label: z.string().nullable(),
    provenance: z.string().nullable(),
    restored_from_version_id: z.string().uuid().nullable(),
    created_at: z.string().min(1),
  })
  .strict();

/** Single-version read: summary + the full graph snapshot (list reads exclude
 *  the graph; single reads carry it). `graph` is opaque here. */
export const ModelVersionRecordResponseSchema = ModelVersionSummaryResponseSchema.extend({
  graph: z.unknown(),
}).strict();

export const VersionWriteOutcomeResponseSchema = z
  .object({
    version_id: z.string().uuid(),
    version_number: z.number().int().positive(),
    graph_identity_hash: Sha256Hex,
    deduped: z.boolean(),
    event_id: z.string().nullable(),
    restored_from_version_id: z.string().uuid().optional(),
  })
  .strict();

const VersionDiffSummaryResponseSchema = z
  .object({
    nodes_added: z.number().int().nonnegative(),
    nodes_removed: z.number().int().nonnegative(),
    nodes_changed: z.number().int().nonnegative(),
    edges_added: z.number().int().nonnegative(),
    edges_removed: z.number().int().nonnegative(),
    edges_changed: z.number().int().nonnegative(),
  })
  .strict();

export const VersionComparisonResponseSchema = z.discriminatedUnion('relation', [
  z.object({ relation: z.literal('identical'), short_circuit: z.literal(true) }).strict(),
  z
    .object({
      relation: z.literal('different'),
      short_circuit: z.literal(false),
      analysis_equivalent: z.boolean().nullable(),
      diff: VersionDiffSummaryResponseSchema,
    })
    .strict(),
]);

/** List response — summaries only (no graphs over the wire). */
export const ListVersionsResponseSchema = z
  .object({ versions: z.array(ModelVersionSummaryResponseSchema) })
  .strict();

/** Current-version response — the record, or null when there are no versions. */
export const CurrentVersionResponseSchema = z
  .object({ current: ModelVersionRecordResponseSchema.nullable() })
  .strict();

// ---------------------------------------------------------------------------
// Safe error / conflict shapes — the wire projection of the service's typed
// results (ModelManagementResult error/conflict variants).
// ---------------------------------------------------------------------------

export const ModelManagementErrorResponseSchema = z
  .object({
    code: z.enum(['sign_in_required', 'version_not_found', 'empty_graph', 'store_error']),
    recoverable: z.boolean(),
    message: z.string().min(1),
  })
  .strict();

export const VersionCasConflictResponseSchema = z
  .object({
    kind: z.literal(CAS_CONFLICT_KIND),
    expected_graph_identity_hash: Sha256Hex.nullable(),
    message: z.string().min(1),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inferred types (for the future wiring slice; still dark).
// ---------------------------------------------------------------------------

export type CreateVersionRequest = z.infer<typeof CreateVersionRequestSchema>;
export type RestoreVersionRequestContract = z.infer<typeof RestoreVersionRequestSchema>;
export type ListVersionsRequest = z.infer<typeof ListVersionsRequestSchema>;
export type GetCurrentVersionRequest = z.infer<typeof GetCurrentVersionRequestSchema>;
export type ModelVersionSummaryResponse = z.infer<typeof ModelVersionSummaryResponseSchema>;
export type ModelVersionRecordResponse = z.infer<typeof ModelVersionRecordResponseSchema>;
export type VersionWriteOutcomeResponse = z.infer<typeof VersionWriteOutcomeResponseSchema>;
export type VersionComparisonResponse = z.infer<typeof VersionComparisonResponseSchema>;
export type ListVersionsResponse = z.infer<typeof ListVersionsResponseSchema>;
export type CurrentVersionResponse = z.infer<typeof CurrentVersionResponseSchema>;
export type ModelManagementErrorResponse = z.infer<typeof ModelManagementErrorResponseSchema>;
export type VersionCasConflictResponse = z.infer<typeof VersionCasConflictResponseSchema>;
