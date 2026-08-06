/**
 * ROADMAP 2.474 (CEE leg) — `propose_structural_edit`: the coach's structural
 * editing tool, and the GROUNDING VALIDATOR that is its trust core.
 *
 * Paul's Option A ruling: the conversational AI composes multi-part structural
 * edits itself, guarded by the EXISTING hold/confirm/receipt/undo referee
 * spine. This module is the composer's CONTRACT + its validator. It is PURE:
 * no LLM call, no I/O, no telemetry — so every rule below is unit-testable and
 * the transport (which adapter, which call) is the caller's business.
 *
 * ── AMENDMENT A1 (BINDING) ─────────────────────────────────────────────────
 * The tool emits the CANONICAL `PatchOperation[]` (`op` / `path` / `value` —
 * the vocabulary `PatchOperationsArraySchema` validates and the edit pipeline
 * applies). It NEVER constructs `CandidateMutationEnvelope`s: the referee
 * consumes envelopes PROJECTED from PatchOperations by
 * `editOperationsToCandidateEnvelopes`, so a tool that minted envelopes
 * directly would need a second applier or a reverse projection — a second
 * referee↔applier agreement surface, i.e. 2.380's parity defect built on
 * purpose. ONE entry seam: tool → PatchOperation[] → `handleEditGraph` →
 * `evaluateEditGraphMutations` → commit.
 *
 * ── THE GROUNDING CONTRACT (the 2.461 lesson; A5 hardened) ─────────────────
 * The model must be STRUCTURALLY INCAPABLE of editing a graph it merely
 * imagined. Every ENTITY REFERENCE an op carries must resolve against the
 * PERSISTED graph, or be an explicit create. An unresolvable one HARD-REJECTS
 * THE WHOLE BATCH — the `dsk_claim_id` cite-or-reject pattern applied to edits.
 *
 * ⚠ "EVERY ENTITY REFERENCE" IS A CLAIM ABOUT A SPECIFIC SET, and it is stated
 * here rather than left to be inferred, because an earlier version of this
 * header made the unqualified claim while the code read `path` ALONE — and an
 * id in `value` (an `interventions` map keyed by factor id) sailed through,
 * governed `proceed` with no confirm chip, and replaced a real intervention on
 * apply. The set is: the op's `path`; its identity restatements `value.id` /
 * `value.from` / `value.to`; and every key of every `interventions` map at any
 * depth of `value`. What this module does NOT do is judge whether a field may
 * be written at all — that is field-safety's job downstream, and this header
 * must never be read as covering it.
 *
 *   REJECT, NEVER REPAIR. On any failure this module returns NO operations at
 *   all — not a filtered subset. A partially-salvaged batch is a batch the
 *   user never described, and it is exactly how a fabricated op reaches a
 *   commit behind a confirm chip the user thought meant something else.
 *
 * Rules, in evaluation order (first failure wins, whole batch):
 *   G1  SCHEMA_INVALID        — payload/op shape unreadable.
 *   G2  BATCH_CAP_EXCEEDED    — a runaway OPERATION COUNT, or a batch no
 *                               partition can make cap-legal (A3; see below).
 *                               ⚠ Being merely over the ENVELOPE cap is no
 *                               longer a rejection — it is a SPLIT.
 *   G3  UNKNOWN_ENTITY_ID     — an op names an id/edge absent from the graph
 *                               (and not created earlier in this batch).
 *   G4  CREATED_ID_COLLIDES   — a create re-uses an id the graph already has,
 *                               or two creates in the batch claim the same id.
 *   G5  REMOVED_ID_REUSED     — an id removed earlier in the batch is
 *                               re-created or referenced later (A5d: the
 *                               referee's working view never subtracts
 *                               removes, so `remove_node X; add_node X` is a
 *                               structural collision — pre-caught HERE with a
 *                               precise reason so the model cannot loop on
 *                               generic collision copy).
 *   G7  VALUE_IDENTITY_CONFLICT — the op names its target twice (`path` and a
 *                               `value.id`/`from`/`to`) and the two disagree.
 *                               Two identity claims in one op; the model is
 *                               told WHICH field is wrong.
 *   G6  LABEL_ID_MISMATCH     — A5c DUAL IDENTITY BINDING. Every op naming an
 *                               EXISTING node carries a `target_label` echo,
 *                               verified against the persisted label for that
 *                               id. Duplicate labels in a graph let a model
 *                               pick the wrong id while every id-level check
 *                               passes (trap 19 / the 2.392 family); the echo
 *                               catches wrong-id-right-shape.
 *
 * ── A3: THE CAPS ARE DERIVED, AND THEY SPLIT RATHER THAN REFUSE ────────────
 * FOUR live caps govern a batch on this path, enforced in three modules, and
 * they do not agree with one another:
 *
 *   operation count  `config.cee.maxPatchOperations` (15)  edit-graph.ts
 *   node operations  `MAX_NODE_OPS` (4)                    patch-budget-limits.ts
 *   edge operations  `MAX_EDGE_OPS` (8)                    patch-budget-limits.ts
 *   envelope fan-out `PROPOSAL_CAP` (8)                    referee.ts
 *
 * The last is per FIELD, so a 5-op batch of multi-field updates can exceed 8
 * while looking small; the middle two are per OPERATION KIND, so probe C's
 * "3 node + 12 edge" batch was legal on operations and illegal on edges.
 * `structural-edit-batch-split.ts` IMPORTS all four and counts envelopes with
 * the SAME producer the gate consumes, so no number here can drift from the
 * thing that actually rejects (CLAUDE.md trap 12 — derive, don't mirror).
 *
 * ⚠ AND THE CAPS NO LONGER DEAD-END THE TURN. An over-cap batch is PARTITIONED
 * into ordered, individually cap-legal parts; the caller proposes the first and
 * discloses the rest. The brief's "20-node cap" is STRUCK: it is not derivable
 * at this tip.
 *
 * ── WHAT THIS MODULE DELIBERATELY DOES NOT DO ──────────────────────────────
 *  - It does not stamp `base_graph_hash` (A5b: the executor stamps it
 *    server-side from the frame that built the grounding; the model never
 *    echoes a hash, so a transcription slip cannot manufacture a spurious
 *    BASE_HASH_DIVERGED dead-end).
 *  - It does not decide hold-vs-apply. That is the gate's single governing
 *    verdict (A2) and this path inherits it unchanged.
 *  - It does not register whole graphs. Import registration is its own
 *    deterministic `register_graph` seam (A8) — this tool is architecturally
 *    incapable of it (caps, base-hash currency, LLM-computed diffs = 2.461).
 */

import {
  parseEdgeTargetPath,
  type EditPatchOperationLike,
} from '../graph-management/adapters/edit-graph-producer.js';
import {
  collectInterventionTargetIds,
  edgeKeyOf as sharedEdgeKeyOf,
} from './structural-edit-references.js';
import {
  deriveSplitLimits,
  partitionStructuralEditBatch,
  measurePart,
  type StructuralEditPart,
} from './structural-edit-batch-split.js';

/**
 * Re-exported so the one definition of "what does this operation name?" has a
 * single home (`structural-edit-references.ts`) while every existing importer
 * of this module keeps working. See that module's header for the measured
 * defect the scan exists for.
 */
export { collectInterventionTargetIds };

// ---------------------------------------------------------------------------
// The op grammar — DERIVED from the canonical PatchOperation union.
// ---------------------------------------------------------------------------

/**
 * The canonical `PatchOperation['op']` values. This list is a MIRROR, and it is
 * only safe because it is checked BOTH WAYS against the enforcing schema by
 * `__tests__/propose-structural-edit-grounding.test.ts` ("every advertised op
 * is a real PatchOperation discriminator, and every discriminator is
 * advertised") — a set equality, not a subset check, so a new canonical op with
 * no row here goes RED rather than being silently un-advertised. That direction
 * is the one derivation alone cannot give you (trap 12d).
 */
export const STRUCTURAL_EDIT_OPS = [
  'add_node',
  'remove_node',
  'update_node',
  'add_edge',
  'remove_edge',
  'update_edge',
] as const;

export type StructuralEditOp = (typeof STRUCTURAL_EDIT_OPS)[number];

const STRUCTURAL_EDIT_OP_SET: ReadonlySet<string> = new Set(STRUCTURAL_EDIT_OPS);

/** Ops whose `path` names an EXISTING NODE — these carry the label echo (G6). */
const EXISTING_NODE_OPS: ReadonlySet<StructuralEditOp> = new Set<StructuralEditOp>([
  'remove_node',
  'update_node',
]);

/** Ops whose `path` names an EXISTING EDGE (`from::to` / `from->to`). */
const EXISTING_EDGE_OPS: ReadonlySet<StructuralEditOp> = new Set<StructuralEditOp>([
  'remove_edge',
  'update_edge',
]);

// ---------------------------------------------------------------------------
// Grounding table — built from the PERSISTED graph ONLY (A5a).
// ---------------------------------------------------------------------------

export interface GroundedNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
}

export interface GroundedEdge {
  readonly from: string;
  readonly to: string;
}

export interface StructuralEditGrounding {
  readonly nodes: readonly GroundedNode[];
  readonly edges: readonly GroundedEdge[];
  /** Every node id the persisted graph carries. */
  readonly nodeIds: ReadonlySet<string>;
  /** id → persisted label, for the A5c dual identity binding. */
  readonly labelById: ReadonlyMap<string, string>;
  /** `${from}::${to}` for every persisted edge. */
  readonly edgeKeys: ReadonlySet<string>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** Canonical edge key. Directional — the graph's edges are directional. */
export const edgeKeyOf = sharedEdgeKeyOf;

/**
 * Project the PERSISTED graph into the grounding table.
 *
 * A5(a) — THE ONLY LEGITIMATE SOURCE IS THE STRICT PERSISTED LOAD. The
 * `gmFrameBase = strictBase ?? graphState` ingress-echo fallback (the 2.398(b)
 * seam) is NEVER a grounding source: a client echo can disagree with the
 * server's graph, and grounding against the echo is grounding against a graph
 * the server will not edit. The caller passes the strict-loaded graph; a
 * strict-load failure must reach here as `null`/unreadable, which returns
 * `null` — and a null grounding means THE TOOL DOES NOT ENGAGE (honest
 * "I can't read your model" refusal), never a tool call against nothing.
 *
 * Returns null when the graph has no readable `nodes` array. An EMPTY node
 * list is readable and returns a grounding with zero nodes — a real state
 * (empty canvas) in which every non-create op correctly hard-rejects.
 */
export function buildStructuralEditGrounding(
  persistedGraph: unknown,
): StructuralEditGrounding | null {
  const graph = asRecord(persistedGraph);
  if (graph === null) return null;
  if (!Array.isArray(graph.nodes)) return null;

  const nodes: GroundedNode[] = [];
  const nodeIds = new Set<string>();
  const labelById = new Map<string, string>();
  for (const raw of graph.nodes) {
    const node = asRecord(raw);
    if (node === null) continue;
    const id = readString(node.id);
    if (id === null) continue;
    const label = typeof node.label === 'string' ? node.label : '';
    // `kind` is the GraphV3 field; `type` is the divergent twin the 2.467c
    // rider normalises. Read both so the table never shows a blank kind for a
    // node the UI renders — display only; nothing branches on it here.
    const kind =
      readString(node.kind) ?? readString((node as { type?: unknown }).type) ?? 'unknown';
    nodes.push({ id, label, kind });
    nodeIds.add(id);
    labelById.set(id, label);
  }

  const edges: GroundedEdge[] = [];
  const edgeKeys = new Set<string>();
  if (Array.isArray(graph.edges)) {
    for (const raw of graph.edges) {
      const edge = asRecord(raw);
      if (edge === null) continue;
      const from = readString(edge.from);
      const to = readString(edge.to);
      if (from === null || to === null) continue;
      edges.push({ from, to });
      edgeKeys.add(edgeKeyOf(from, to));
    }
  }

  return { nodes, edges, nodeIds, labelById, edgeKeys };
}

/**
 * The full grounding table as compact text for the tool prompt.
 *
 * A12: send the FULL table, ALWAYS — no summarisation, no paging. At platform
 * caps (50 nodes / 100 edges) this is ≈5–8K tokens; typical POC graphs ≈2–3K.
 * A page the model cannot see is a graph it will imagine, which is the 2.461
 * defect this tool exists to kill.
 */
export function renderGroundingTable(grounding: StructuralEditGrounding): string {
  const nodeLines = grounding.nodes.map((n) => `  ${n.id} | ${n.kind} | ${n.label}`);
  const edgeLines = grounding.edges.map((e) => `  ${e.from} -> ${e.to}`);
  return [
    `NODES (${grounding.nodes.length}) — id | kind | label`,
    ...(nodeLines.length > 0 ? nodeLines : ['  (none)']),
    `EDGES (${grounding.edges.length}) — from -> to`,
    ...(edgeLines.length > 0 ? edgeLines : ['  (none)']),
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Rejection vocabulary.
// ---------------------------------------------------------------------------

export const STRUCTURAL_EDIT_REJECTION_CODES = [
  'SCHEMA_INVALID',
  'BATCH_CAP_EXCEEDED',
  'UNKNOWN_ENTITY_ID',
  'CREATED_ID_COLLIDES',
  'REMOVED_ID_REUSED',
  'LABEL_ID_MISMATCH',
  'VALUE_IDENTITY_CONFLICT',
] as const;

export type StructuralEditRejectionCode = (typeof STRUCTURAL_EDIT_REJECTION_CODES)[number];

export interface StructuralEditRejection {
  readonly ok: false;
  readonly code: StructuralEditRejectionCode;
  /**
   * A REDACTED, model-facing reason. It names the op index and the structural
   * problem; it never echoes a raw user value. This is what a single
   * corrective round would carry — after which the tool refuses honestly
   * rather than repairing (reject-don't-repair).
   */
  readonly reason: string;
}

export interface StructuralEditAcceptance {
  readonly ok: true;
  /**
   * The canonical batch, WHOLE — every operation the model composed, in order.
   * Retained even when the batch splits, so a caller can describe the complete
   * change (labels of nodes a later part references included) and so nothing is
   * silently lost between here and the disclosure.
   */
  readonly operations: readonly EditPatchOperationLike[];
  /** Envelope fan-out the WHOLE batch would produce at the referee. */
  readonly envelopeCount: number;
  /**
   * A3 — THE BATCH, PARTITIONED INTO CAP-LEGAL PARTS.
   *
   * Always at least one part; `parts.length === 1` is the ordinary case and
   * `parts[0].operations` is then the whole batch. `parts.length > 1` means the
   * request was too large for one proposal and the caller must propose
   * `parts[0]` and DISCLOSE the rest (never truncate, never submit them
   * silently). See `structural-edit-batch-split.ts` for why splitting is not
   * disclosed-partial.
   */
  readonly parts: readonly StructuralEditPart[];
}

export type StructuralEditValidation = StructuralEditAcceptance | StructuralEditRejection;

function reject(
  code: StructuralEditRejectionCode,
  reason: string,
): StructuralEditRejection {
  return { ok: false, code, reason };
}

/**
 * The identity fields an op's `value` may restate. A restatement that AGREES
 * with `path` is fine (models do it, and it is not an error); a restatement
 * that DISAGREES is two identity claims in one operation, and the model must
 * be told which field is wrong or it will re-emit the pair.
 */
function identityConflictIn(
  kind: StructuralEditOp,
  path: string,
  value: Record<string, unknown> | null,
): string | null {
  if (value === null) return null;
  const declared = (field: 'id' | 'from' | 'to'): string | null => readString(value[field]);
  if (kind === 'add_node' || kind === 'update_node' || kind === 'remove_node') {
    const id = declared('id');
    if (id !== null && id !== path) return `\`value.id\` says '${id}' while \`path\` says '${path}'`;
    return null;
  }
  // Edge ops: identity is the (from, to) pair carried by `path`.
  const target = parseEdgeTargetPath(path);
  const from = declared('from');
  const to = declared('to');
  if (target === null) return null; // unreadable path is SCHEMA_INVALID upstream
  if (from !== null && from !== target.from) {
    return `\`value.from\` says '${from}' while \`path\` says '${target.from}'`;
  }
  if (to !== null && to !== target.to) {
    return `\`value.to\` says '${to}' while \`path\` says '${target.to}'`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The validator.
// ---------------------------------------------------------------------------

export interface StructuralEditValidationOptions {
  /**
   * The pipeline's operation cap (`config.cee.maxPatchOperations`, default 15,
   * env-overridable). Passed in rather than imported so this module stays pure
   * and the caller cannot accidentally validate against a different number
   * than the pipeline will.
   */
  readonly maxPatchOperations: number;
}

/**
 * Validate a raw `propose_structural_edit` tool payload against the grounding
 * table. Whole-batch: any failure returns a rejection carrying NO operations.
 *
 * Sequencing note: ids created EARLIER in the batch are visible to LATER ops
 * (mirroring `advanceBatchGraph`, which lets an `add_node` + `add_edge`-to-it
 * batch judge correctly). Removes are deliberately NOT subtracted — the
 * referee's working view never subtracts them either, so a later reference to
 * a removed id is a REMOVED_ID_REUSED rejection here rather than a generic
 * collision at the referee.
 */
export function validateProposedStructuralEdit(
  rawInput: unknown,
  grounding: StructuralEditGrounding,
  options: StructuralEditValidationOptions,
): StructuralEditValidation {
  const payload = asRecord(rawInput);
  if (payload === null) {
    return reject('SCHEMA_INVALID', 'The tool payload is not an object.');
  }
  const rawOps = payload.operations;
  if (!Array.isArray(rawOps) || rawOps.length === 0) {
    return reject(
      'SCHEMA_INVALID',
      'The tool payload must carry a non-empty `operations` array.',
    );
  }
  if (rawOps.length > options.maxPatchOperations) {
    return reject(
      'BATCH_CAP_EXCEEDED',
      `The batch carries ${rawOps.length} operations; the pipeline accepts at most ` +
        `${options.maxPatchOperations}. Split the restructure into smaller batches.`,
    );
  }

  const operations: EditPatchOperationLike[] = [];
  // Sequencing state, mirroring the referee's working view.
  const createdIds = new Set<string>();
  const removedIds = new Set<string>();
  const createdEdgeKeys = new Set<string>();

  const nodeExists = (id: string): boolean =>
    grounding.nodeIds.has(id) || createdIds.has(id);

  for (let index = 0; index < rawOps.length; index += 1) {
    const at = `Operation ${index + 1}`;
    const opRecord = asRecord(rawOps[index]);
    if (opRecord === null) {
      return reject('SCHEMA_INVALID', `${at} is not an object.`);
    }
    const op = readString(opRecord.op);
    if (op === null || !STRUCTURAL_EDIT_OP_SET.has(op)) {
      return reject(
        'SCHEMA_INVALID',
        `${at} has no recognised \`op\`. Use one of: ${STRUCTURAL_EDIT_OPS.join(', ')}.`,
      );
    }
    const kind = op as StructuralEditOp;
    const path = readString(opRecord.path);
    if (path === null) {
      return reject('SCHEMA_INVALID', `${at} has no \`path\` (the target id).`);
    }

    // ── G5 first for the target itself: a removed id may not come back. ────
    if (removedIds.has(path)) {
      return reject(
        'REMOVED_ID_REUSED',
        `${at} targets '${path}', which an earlier operation in this batch removes. ` +
          'An id removed in a batch cannot be reused in the same batch.',
      );
    }

    if (EXISTING_NODE_OPS.has(kind)) {
      // ── G3: the id must exist (persisted, or created earlier in-batch). ──
      if (!nodeExists(path)) {
        return reject(
          'UNKNOWN_ENTITY_ID',
          `${at} targets node id '${path}', which is not in the model. ` +
            'Every operation must name an id from the grounding table, or create it explicitly.',
        );
      }
      // ── G6: A5c dual identity binding on PERSISTED targets. ─────────────
      // An id created earlier in THIS batch has no persisted label to echo,
      // so the binding applies to persisted ids only — and for those it is
      // MANDATORY: a missing echo is a mismatch, not a pass. (A guard that
      // treats "absent" as "fine" is a guard agreeing with itself — trap 13b.)
      if (grounding.nodeIds.has(path)) {
        const echo = opRecord.target_label;
        const persisted = grounding.labelById.get(path) ?? '';
        if (typeof echo !== 'string' || echo.trim() !== persisted.trim()) {
          return reject(
            'LABEL_ID_MISMATCH',
            `${at} names node id '${path}', whose label in the model is '${persisted}'. ` +
              'Echo the exact label of the node you mean in `target_label`; a mismatch ' +
              'means the wrong node was picked.',
          );
        }
      }
    } else if (EXISTING_EDGE_OPS.has(kind)) {
      const target = parseEdgeTargetPath(path);
      if (target === null) {
        return reject(
          'SCHEMA_INVALID',
          `${at} has an unreadable edge path '${path}'. Use 'from_id::to_id'.`,
        );
      }
      if (removedIds.has(target.from) || removedIds.has(target.to)) {
        return reject(
          'REMOVED_ID_REUSED',
          `${at} targets an edge whose endpoint an earlier operation in this batch removes.`,
        );
      }
      const key = edgeKeyOf(target.from, target.to);
      if (!grounding.edgeKeys.has(key) && !createdEdgeKeys.has(key)) {
        return reject(
          'UNKNOWN_ENTITY_ID',
          `${at} targets the link '${target.from} -> ${target.to}', which is not in the model.`,
        );
      }
    } else if (kind === 'add_node') {
      // ── G4: an explicit create must claim a genuinely new id. ────────────
      if (grounding.nodeIds.has(path) || createdIds.has(path)) {
        return reject(
          'CREATED_ID_COLLIDES',
          `${at} creates node id '${path}', which already exists. Choose an unused id.`,
        );
      }
      createdIds.add(path);
    } else {
      // add_edge — endpoints must exist (persisted or created earlier).
      const value = asRecord(opRecord.value);
      const from = value === null ? null : readString(value.from);
      const to = value === null ? null : readString(value.to);
      if (from === null || to === null) {
        return reject(
          'SCHEMA_INVALID',
          `${at} adds a link but its \`value\` carries no \`from\`/\`to\` node ids.`,
        );
      }
      if (removedIds.has(from) || removedIds.has(to)) {
        return reject(
          'REMOVED_ID_REUSED',
          `${at} links '${from}' -> '${to}', but an earlier operation in this batch ` +
            'removes one of those nodes.',
        );
      }
      if (!nodeExists(from) || !nodeExists(to)) {
        return reject(
          'UNKNOWN_ENTITY_ID',
          `${at} links '${from}' -> '${to}', and one of those ids is not in the model. ` +
            'Every link endpoint must be an existing node or one this batch creates.',
        );
      }
      createdEdgeKeys.add(edgeKeyOf(from, to));
    }

    // ── THE ID CAN HIDE IN `value` ────────────────────────────────────────
    // Runs AFTER the `path` checks (a bad target is the more fundamental
    // problem and should be the reason the model is given) and BEFORE this op
    // registers its own creates/removes, so an op cannot ground its own
    // smuggled reference.
    const valueRecord = asRecord(opRecord.value);
    const conflict = identityConflictIn(kind, path, valueRecord);
    if (conflict !== null) {
      return reject(
        'VALUE_IDENTITY_CONFLICT',
        `${at} names its target twice and the two disagree: ${conflict}. ` +
          'Name the target once, in `path`.',
      );
    }
    for (const targetId of collectInterventionTargetIds(opRecord.value)) {
      if (removedIds.has(targetId)) {
        return reject(
          'REMOVED_ID_REUSED',
          `${at} sets an effect on '${targetId}', which an earlier operation in ` +
            'this batch removes.',
        );
      }
      if (!nodeExists(targetId)) {
        return reject(
          'UNKNOWN_ENTITY_ID',
          `${at} sets an effect on '${targetId}', which is not a node in the model. ` +
            'Every effect must be keyed by an id from the grounding table, or by one ' +
            'this batch creates.',
        );
      }
    }

    if (kind === 'remove_node') {
      removedIds.add(path);
    }

    // The canonical op — `target_label` is a GROUNDING field, not part of the
    // PatchOperation vocabulary, and is stripped here. What leaves this
    // module is exactly what `PatchOperationsArraySchema` validates.
    const canonical: EditPatchOperationLike = {
      op: kind,
      path,
      ...(opRecord.value !== undefined ? { value: opRecord.value } : {}),
      ...(opRecord.old_value !== undefined ? { old_value: opRecord.old_value } : {}),
    };
    operations.push(canonical);
  }

  // ── G2 (second half): THE CAPS BECOME A SPLIT, NOT A REFUSAL (A3) ────────
  //
  // ⚠ WHAT CHANGED, AND WHY. This used to REJECT any batch whose envelope
  // fan-out exceeded PROPOSAL_CAP. Ten live runs of the canonical headline
  // sentence (witness-2474-live-2026-08-05.md) produced a usable proposal
  // twice; probe C composed a real "3 node operations and 12 edge operations"
  // batch and the whole thing was discarded on a cap the user cannot see. A
  // composed edit thrown away is the worst outcome available — the user paid
  // the model call and got nothing to confirm.
  //
  // So the caps now PARTITION. Run LAST, after every grounding rule, so a
  // hallucinated id still wins: an ungrounded batch must be rejected whole and
  // never partitioned into ungrounded parts. Splitting is reserved for a batch
  // that is entirely legitimate and merely large.
  //
  // Note what did NOT change: `rawOps.length > maxPatchOperations` above is
  // still a hard rejection. That guard is about a runaway emission, not about
  // an honest restructure, and this lane had no witness for widening it.
  const limits = deriveSplitLimits(options.maxPatchOperations);
  const partition = partitionStructuralEditBatch(operations, limits);
  if (!partition.ok) {
    return reject(
      'BATCH_CAP_EXCEEDED',
      partition.failure === 'operation_exceeds_part'
        ? `One operation in this batch is on its own larger than a single reviewable ` +
            `change allows (at most ${limits.maxEnvelopes} fields change per proposal). ` +
            'Change fewer fields of that item at a time.'
        : `This batch would need ${partition.partsNeeded} separate proposals; at most ` +
            `${limits.maxParts} can be offered for one request. Ask for a smaller part of ` +
            'the restructure.',
    );
  }

  return {
    ok: true,
    operations,
    envelopeCount: measurePart(operations).envelopeCount,
    parts: partition.parts,
  };
}

// ---------------------------------------------------------------------------
// The tool advert.
// ---------------------------------------------------------------------------

export const PROPOSE_STRUCTURAL_EDIT_TOOL_NAME = 'propose_structural_edit' as const;

/**
 * The Anthropic-SDK-shaped tool definition, carrying the FULL grounding table
 * (A12). The JSONSchema here is DESCRIPTIVE — `validateProposedStructuralEdit`
 * is the enforcing contract, exactly as `parseToolCallResponse` is for
 * `olumi_action`. The `op` enum is DERIVED from `STRUCTURAL_EDIT_OPS`, so the
 * advert cannot drift from the validator.
 */
export function buildProposeStructuralEditTool(grounding: StructuralEditGrounding): {
  readonly name: typeof PROPOSE_STRUCTURAL_EDIT_TOOL_NAME;
  readonly description: string;
  readonly input_schema: Record<string, unknown>;
} {
  return {
    name: PROPOSE_STRUCTURAL_EDIT_TOOL_NAME,
    description:
      'Compose a structural change to the decision model: add or remove ' +
      'factors, options, risks and causal links, and update their values — ' +
      'several at once, as one reviewable batch.\n' +
      '\n' +
      'GROUND EVERY OPERATION IN THE MODEL BELOW. Each operation must name an ' +
      'id from this table, or create a new one explicitly with add_node. An id ' +
      'that is not in the table (and not created earlier in the same batch) ' +
      'REJECTS THE WHOLE BATCH — nothing is applied and nothing is partially ' +
      'applied. Do not guess ids, and do not describe changes to parts of a ' +
      'model you cannot see here.\n' +
      '\n' +
      'For every operation that targets an EXISTING node, also echo that ' +
      "node's exact label in `target_label`. If the label you echo does not " +
      'match the id you named, the batch is rejected — this is how a ' +
      'wrong-but-plausible target gets caught before it is applied.\n' +
      '\n' +
      'IDS INSIDE `value` ARE CHECKED THE SAME WAY. An `interventions` map is ' +
      'keyed by the id of the factor each effect acts on, and every one of ' +
      'those keys must be in the table above (or created earlier in the same ' +
      'batch). Do not name a target once in `path` and differently in ' +
      '`value.id`, `value.from` or `value.to` — name it once, in `path`.\n' +
      '\n' +
      'THE CURRENT MODEL:\n' +
      `${renderGroundingTable(grounding)}\n` +
      '\n' +
      'Structural changes are held for the user to confirm; nothing moves in ' +
      'the model until they do. Do not promise that a change has been made.',
    input_schema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        operations: {
          type: 'array',
          minItems: 1,
          description:
            'The batch, in the order it should be applied. Later operations ' +
            'may reference nodes that earlier operations create.',
          items: {
            type: 'object',
            additionalProperties: false,
            properties: {
              op: {
                type: 'string',
                enum: [...STRUCTURAL_EDIT_OPS],
                description:
                  'add_node / remove_node / update_node take a node id in ' +
                  '`path`. add_edge takes the new link id in `path` and ' +
                  '`{from, to}` in `value`. remove_edge / update_edge take ' +
                  "'from_id::to_id' in `path`.",
              },
              path: {
                type: 'string',
                description:
                  'The target id. For a node operation, the node id. For ' +
                  "remove_edge / update_edge, 'from_id::to_id'.",
              },
              target_label: {
                type: 'string',
                description:
                  'REQUIRED when `path` names a node that already exists: ' +
                  "that node's exact label, copied from the table above. " +
                  'Omit only when the operation creates the node.',
              },
              value: {
                type: 'object',
                additionalProperties: true,
                description:
                  'The new content. add_node: {kind, label, ...}. add_edge: ' +
                  '{from, to, strength, exists_probability, effect_direction}. ' +
                  'update_node / update_edge: only the fields that change.',
              },
            },
            required: ['op', 'path'],
          },
        },
      },
      required: ['operations'],
    },
  };
}
