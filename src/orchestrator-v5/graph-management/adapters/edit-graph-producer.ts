/**
 * Graph Management — edit_graph → CandidateMutationEnvelope producer.
 *
 * Projects the VALIDATED edit_graph patch operations (the canonical
 * `PatchOperation[]` that already passed CEE structural validation + the
 * PLoT gate inside `handleEditGraph`) into RAW candidate envelopes for the
 * referee. One envelope = one reviewable unit of change, so a multi-field
 * `update_node` / `update_edge` fans out into one envelope PER FIELD.
 *
 * Import boundary (isolation-guards.test.ts): this module does NOT import
 * `src/orchestrator/types.js` — it consumes a LOCAL structural mirror of the
 * PatchOperation shape (`EditPatchOperationLike`), to which the real type is
 * assignable. Best-effort projection: R1 (`parseEnvelope`) remains the
 * fail-closed gate — a projection that cannot resolve a well-formed payload
 * (unparseable edge path, non-string label, unknown op) still emits an
 * envelope, and R1 REJECTS it. Total; never throws.
 *
 * Batch cap: the producer does NOT truncate. Over-cap batches are handed to
 * `refereeMutationBatch`, which rejects the WHOLE batch with
 * BATCH_CAP_EXCEEDED in O(1) — the contract behaviour (T4.0 §1).
 */
import type { CandidateKind } from '../types.js';

/** Local structural mirror of the V4 `PatchOperation` (zero src/orchestrator coupling). */
export interface EditPatchOperationLike {
  readonly op: string;
  readonly path: string;
  readonly value?: unknown;
  readonly old_value?: unknown;
}

/** Context the envelopes need that the operations do not carry. */
export interface EditProducerContext {
  /** The frame-resolved hash of the graph the operations were generated against. */
  readonly base_graph_hash: string;
  readonly scenario_id: string;
  readonly turn_id: string;
  /** Injected id minting (the module may not import node:crypto). */
  readonly makeCandidateId: () => string;
  /** Optional per-op rationale strings, parallel-indexed to the ops. */
  readonly rationales?: readonly (string | undefined)[];
}

function asObject(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

/** Parse "from::to" (CEE canonical) or "from->to" (v2) edge paths; null on malformed. */
export function parseEdgeTargetPath(path: string): { from: string; to: string } | null {
  const sep = path.includes('::') ? '::' : path.includes('->') ? '->' : null;
  if (sep === null) return null;
  const parts = path.split(sep);
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  return { from: parts[0], to: parts[1] };
}

/** Fixed, content-free reason for removals initiated through the edit loop. */
const EDIT_REMOVE_REASON = 'user_requested_edit';

/**
 * ROADMAP 2.478 — the identity keys an add op's value carries that are ALREADY
 * projected into the reviewable `node` / `edge` payload. Everything else on the
 * value is what the applier will additionally write, and is carried to the
 * envelope as `screened_value` so the referee's R4 field-safety check can see
 * it. Before this, the projection DROPPED those keys and the referee screened
 * only update kinds, so an `observed_state.source` stamp on a NEW node met no
 * guard between the model and the applier.
 *
 * `id` is on the node list because `op.path` is the authoritative id (the
 * applier overrides any id in the value) — carrying it again would only give
 * the screen a key it has no rule for.
 */
const NODE_IDENTITY_KEYS: readonly string[] = ['id', 'kind', 'label'];
const EDGE_IDENTITY_KEYS: readonly string[] = ['from', 'to'];

/**
 * `{ screened_value }` for the non-identity keys of `value`, or `{}` when there
 * are none — so a plain identity-only add projects the SAME envelope it always
 * did (the field is optional and simply absent).
 */
function withoutKeys(
  value: Record<string, unknown>,
  identityKeys: readonly string[],
): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (identityKeys.includes(k)) continue;
    rest[k] = v;
  }
  return Object.keys(rest).length > 0 ? { screened_value: rest } : {};
}

interface RawEnvelopeParts {
  readonly kind: CandidateKind | string;
  readonly payload: Record<string, unknown>;
}

/**
 * Project ONE validated op into its envelope parts. A multi-field update op
 * produces multiple parts (one per field). Unknown ops produce a part with
 * the raw op name as `kind` — R1 rejects it (fail-closed, never dropped).
 */
function projectOperation(op: EditPatchOperationLike): RawEnvelopeParts[] {
  const value = asObject(op.value);
  const oldValue = asObject(op.old_value);
  switch (op.op) {
    case 'add_node':
      return [
        {
          kind: 'add_node',
          // op.path is the authoritative node id (patch-applier contract).
          payload: {
            node: { id: op.path, kind: value.kind, label: value.label },
            // ROADMAP 2.478: everything the applier will write BEYOND the
            // identity triple, carried so R4 can screen it. Omitted entirely
            // when there is nothing beyond identity, so the envelope of a
            // plain add is byte-identical to what it was.
            ...withoutKeys(value, NODE_IDENTITY_KEYS),
          },
        },
      ];
    case 'remove_node':
      return [
        { kind: 'remove_node', payload: { node_id: op.path, reason: EDIT_REMOVE_REASON } },
      ];
    case 'update_node': {
      const parts: RawEnvelopeParts[] = [];
      for (const [field, to] of Object.entries(value)) {
        if (field === 'id') continue; // identity is never updatable (applier strips it too)
        if (field === 'label') {
          parts.push({
            kind: 'rename_node',
            payload: {
              node_id: op.path,
              ...(typeof oldValue.label === 'string' ? { from_label: oldValue.label } : {}),
              to_label: to,
            },
          });
        } else {
          parts.push({
            kind: 'update_node_field',
            payload: { node_id: op.path, field, from: oldValue[field], to },
          });
        }
      }
      return parts;
    }
    case 'add_edge':
      return [
        {
          kind: 'add_edge',
          payload: {
            edge: { from: value.from, to: value.to },
            ...withoutKeys(value, EDGE_IDENTITY_KEYS),
          },
        },
      ];
    case 'remove_edge': {
      const target = parseEdgeTargetPath(op.path);
      return [
        {
          kind: 'remove_edge',
          payload: {
            from_node: target?.from ?? '',
            to_node: target?.to ?? '',
            reason: EDIT_REMOVE_REASON,
          },
        },
      ];
    }
    case 'update_edge': {
      const target = parseEdgeTargetPath(op.path);
      const parts: RawEnvelopeParts[] = [];
      for (const [field, to] of Object.entries(value)) {
        if (field === 'from' || field === 'to') continue; // edge identity is never updatable
        parts.push({
          kind: 'update_edge_field',
          payload: {
            from_node: target?.from ?? '',
            to_node: target?.to ?? '',
            field,
            from: oldValue[field],
            to,
          },
        });
      }
      return parts;
    }
    default:
      // Unknown op — surfaced as an R1-rejectable envelope, never silently dropped.
      return [{ kind: op.op, payload: {} }];
  }
}

/**
 * Project the validated operations into RAW candidate envelopes (unknown[]
 * on purpose — the referee's R1 parse is the only validity authority).
 */
export function editOperationsToCandidateEnvelopes(
  operations: readonly EditPatchOperationLike[],
  ctx: EditProducerContext,
): unknown[] {
  const out: unknown[] = [];
  operations.forEach((op, index) => {
    const rationale = ctx.rationales?.[index];
    for (const part of projectOperation(op)) {
      out.push({
        envelope_version: 1,
        candidate_id: ctx.makeCandidateId(),
        kind: part.kind,
        base_graph_hash: ctx.base_graph_hash,
        payload: part.payload,
        provenance: {
          source: 'edit_graph_llm',
          evidence_pointer: `edit_graph:turn:${ctx.turn_id}:op:${index}`,
          ...(typeof rationale === 'string' && rationale.length > 0
            ? { rationale }
            : {}),
        },
        identity: { scenario_id: ctx.scenario_id, turn_id: ctx.turn_id },
      });
    }
  });
  return out;
}
