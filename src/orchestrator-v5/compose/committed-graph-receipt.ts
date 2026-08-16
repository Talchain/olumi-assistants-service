/**
 * Canonical committed-graph receipt.
 *
 * This is the ONE canonical graph transport builder. Its only admissible
 * source is commit.ts's final persistence projection: the exact object that
 * will be handed to the atomic store. It is invoked before append, then its
 * result is released through `CommitResult.canonicalGraphReceipt` only after
 * `accepted_insert`. A caller's `appliedGraph`, `committedParse.data`, request
 * graph, or post-commit rebuild can differ or throw too late and must never
 * reach this helper.
 *
 * The existing GraphStateIngressSchema is the structural/numeric admission
 * authority. We deliberately do NOT parse via GraphV3: GraphV3 currently
 * models nodes/edges/goal_constraints and strips top-level `options` and
 * `goal_node_id`, which would make the receipt a lossy hash preimage. The
 * shared 0.43 canonical receipt schema then enforces the wire contract.
 *
 * Readiness is intentionally absent. PR #983's
 * `buildCanonicalAnalysisReadyFromGraph` is the required sole whole-status
 * authority; adding a receipt-side readiness derivation or sidecar would
 * create the parallel architecture this component is replacing.
 */

import {
  CanonicalCommittedGraphReceiptSchema,
  type CanonicalCommittedGraphReceipt,
} from '@talchain/schemas/boundary';

import {
  GraphStateIngressSchema,
} from '../boundary/request-extensions.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { assertIngressGraphNumericBounds } from '../../validators/numeric-bounds.js';

export type CommittedGraphReceiptFailureCode =
  | 'missing_persisted_graph'
  | 'missing_hash_carrier'
  | 'ingress_invalid'
  | 'numeric_bounds_invalid'
  | 'goal_identity_invalid'
  | 'wire_contract_invalid'
  | 'hash_unavailable'
  | 'hash_projection_diverged';

/** Content-free typed failure: never place graph values/labels in the error. */
export class CommittedGraphReceiptError extends Error {
  public readonly code: CommittedGraphReceiptFailureCode;

  public constructor(code: CommittedGraphReceiptFailureCode) {
    super(`canonical committed graph receipt unavailable (${code})`);
    this.name = 'CommittedGraphReceiptError';
    this.code = code;
  }
}

export interface BuiltCanonicalCommittedGraphReceipt {
  /** Strict `OlumiResponse.draft_graph` payload. */
  readonly draftGraph: CanonicalCommittedGraphReceipt;
  /** Hash of the exact persisted graph admitted above; never recomputed from a caller graph. */
  readonly analysisGraphHash: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const HASH_CARRIER_FIELDS = [
  'nodes',
  'edges',
  'options',
  'goal_node_id',
  'goal_constraints',
] as const;

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

/**
 * Build and validate the canonical receipt from exact to-be-persisted bytes.
 *
 * The persisted projection must already own every hash carrier. This helper is
 * a validator/transporter, never the first author of `[]` / `null`: accepting
 * omission here would turn a legacy partial graph into a false deletion
 * attestation after the irreversible append. The returned five carriers are
 * therefore deep-equal to `CommitResult.persistedGraph`; counts alone derive.
 */
export function buildCanonicalCommittedGraphReceipt(
  persistedGraph: unknown,
): BuiltCanonicalCommittedGraphReceipt {
  if (!isRecord(persistedGraph)) {
    throw new CommittedGraphReceiptError('missing_persisted_graph');
  }

  if (HASH_CARRIER_FIELDS.some((field) => !hasOwn(persistedGraph, field))) {
    throw new CommittedGraphReceiptError('missing_hash_carrier');
  }

  const rawGoalNodeId = persistedGraph.goal_node_id;
  if (
    rawGoalNodeId !== undefined &&
    rawGoalNodeId !== null &&
    (typeof rawGoalNodeId !== 'string' || rawGoalNodeId.length === 0)
  ) {
    throw new CommittedGraphReceiptError('goal_identity_invalid');
  }

  // The live ingress shares the 0.43 nullable, non-empty identity field, so
  // canonical explicit absence is validated directly. No compatibility
  // rewrite may make the object parsed here differ from the persisted bytes.
  const ingress = GraphStateIngressSchema.safeParse(persistedGraph);
  if (!ingress.success) {
    throw new CommittedGraphReceiptError('ingress_invalid');
  }

  const numericBounds = assertIngressGraphNumericBounds(ingress.data);
  if (!numericBounds.ok) {
    throw new CommittedGraphReceiptError('numeric_bounds_invalid');
  }

  const goalNodeId = rawGoalNodeId === null ? null : rawGoalNodeId;
  const hasGoalNode = numericBounds.graph.nodes.some((node) => node.kind === 'goal');
  if (
    (goalNodeId === null && hasGoalNode) ||
    (goalNodeId !== null &&
      !numericBounds.graph.nodes.some(
        (node) => node.id === goalNodeId && node.kind === 'goal',
      ))
  ) {
    throw new CommittedGraphReceiptError('goal_identity_invalid');
  }

  const wire = CanonicalCommittedGraphReceiptSchema.safeParse({
    nodes: persistedGraph.nodes,
    edges: persistedGraph.edges,
    options: persistedGraph.options,
    goal_node_id: persistedGraph.goal_node_id,
    goal_constraints: persistedGraph.goal_constraints,
    node_count: numericBounds.graph.nodes.length,
    edge_count: numericBounds.graph.edges.length,
  });
  if (!wire.success) {
    throw new CommittedGraphReceiptError('wire_contract_invalid');
  }

  const persistedHash = computeAnalysisAffectingGraphHash(
    persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (persistedHash === null) {
    throw new CommittedGraphReceiptError('hash_unavailable');
  }

  // Shared-schema parsing is allowed to validate, never to alter identity.
  // Prove its returned receipt hashes exactly like the append object.
  const receiptHash = computeAnalysisAffectingGraphHash(
    wire.data as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (receiptHash !== persistedHash) {
    throw new CommittedGraphReceiptError('hash_projection_diverged');
  }

  return {
    draftGraph: wire.data,
    analysisGraphHash: persistedHash,
  };
}
