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
 * imagined. Every op must reference an id that exists in the PERSISTED graph,
 * or be an explicit create. An unknown id HARD-REJECTS THE WHOLE BATCH — the
 * `dsk_claim_id` cite-or-reject pattern applied to edits.
 *
 *   REJECT, NEVER REPAIR. On any failure this module returns NO operations at
 *   all — not a filtered subset. A partially-salvaged batch is a batch the
 *   user never described, and it is exactly how a fabricated op reaches a
 *   commit behind a confirm chip the user thought meant something else.
 *
 * Rules, in evaluation order (first failure wins, whole batch):
 *   G1  SCHEMA_INVALID        — payload/op shape unreadable.
 *   G2  BATCH_CAP_EXCEEDED    — over the DERIVED caps (A3; see below).
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
 *   G6  LABEL_ID_MISMATCH     — A5c DUAL IDENTITY BINDING. Every op naming an
 *                               EXISTING node carries a `target_label` echo,
 *                               verified against the persisted label for that
 *                               id. Duplicate labels in a graph let a model
 *                               pick the wrong id while every id-level check
 *                               passes (trap 19 / the 2.392 family); the echo
 *                               catches wrong-id-right-shape.
 *
 * ── A3: THE CAPS ARE DERIVED, NEVER RESTATED ───────────────────────────────
 * Two live caps govern, and they disagree: the pipeline accepts
 * `MAX_PATCH_OPERATIONS` operations, while the referee rejects a batch of more
 * than `PROPOSAL_CAP` ENVELOPES — and envelopes fan out ONE PER FIELD, so a
 * 5-op batch with multi-field updates can exceed 8. This module counts the
 * envelope fan-out with the SAME producer the gate uses
 * (`editOperationsToCandidateEnvelopes`), so the number can never drift from
 * the thing that actually rejects (CLAUDE.md trap 12 — derive, don't mirror).
 * The brief's "20-node cap" is STRUCK: it is not derivable at this tip.
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

import { PROPOSAL_CAP } from '../graph-management/types.js';
import {
  editOperationsToCandidateEnvelopes,
  parseEdgeTargetPath,
  type EditPatchOperationLike,
} from '../graph-management/adapters/edit-graph-producer.js';

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
export function edgeKeyOf(from: string, to: string): string {
  return `${from}::${to}`;
}

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
  /** The canonical batch. A1: this is what enters `handleEditGraph`. */
  readonly operations: readonly EditPatchOperationLike[];
  /** Envelope fan-out this batch will produce at the referee (diagnostics). */
  readonly envelopeCount: number;
}

export type StructuralEditValidation = StructuralEditAcceptance | StructuralEditRejection;

function reject(
  code: StructuralEditRejectionCode,
  reason: string,
): StructuralEditRejection {
  return { ok: false, code, reason };
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

  // ── G2 (second half): the ENVELOPE fan-out, counted by the SAME producer
  // the gate uses. This is the cap that actually rejects in live mode, and it
  // is per-FIELD, so it is NOT derivable from the operation count. Counted
  // last so a grounding failure always wins over a cap failure (a hallucinated
  // id is the more important thing to tell the model about).
  const envelopeCount = editOperationsToCandidateEnvelopes(operations, {
    base_graph_hash: 'preflight',
    scenario_id: 'preflight',
    turn_id: 'preflight',
    makeCandidateId: () => 'preflight',
  }).length;
  if (envelopeCount > PROPOSAL_CAP) {
    return reject(
      'BATCH_CAP_EXCEEDED',
      `This batch expands to ${envelopeCount} reviewable changes; at most ${PROPOSAL_CAP} ` +
        'can be proposed at once (each field of a multi-field update counts separately). ' +
        'Split the restructure into smaller batches.',
    );
  }

  return { ok: true, operations, envelopeCount };
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
