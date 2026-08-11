/**
 * THE DRAFT RECORDS SIDECAR — the CEE-internal artefact a projected draft leaves
 * behind.
 *
 * ── WHY IT IS A DECLARED SHAPE AND NOT PASSTHROUGH-RIDING ──────────────────
 * The obvious cheap move is to staple `records` / `provenance` / `dropped` onto
 * the graph object and let them ride a `.passthrough()` boundary. That is
 * forbidden here, and the reason is this estate's own history: a field that
 * rides a passthrough has no declared shape, so nothing fails when it changes,
 * nothing fails when it disappears, and the first consumer to depend on it
 * depends on an accident. This module declares the shape ONCE, with a version,
 * so a reader can say what it expects and a producer can fail loud.
 *
 * ── THREE BINDING CLASSES, NEVER TWO ───────────────────────────────────────
 * A binding says which record a graph element came from, and there are THREE
 * possible answers, not two:
 *   `stated`               the user said it
 *   `ai_inferred`          the model added it
 *   `projector_structural` neither — the projector's own scaffolding, minted
 *                          because a record set is not a graph
 * A two-class consumer scores the third as a defect, or worse, silently as
 * stated. The class is carried explicitly for exactly that reason.
 *
 * ── WHAT THIS IS *NOT*, STATED SO A LATER SLICE DOES NOT OVERCLAIM ─────────
 * This is a RECEIPT of one projection, not a ledger and not a source of truth.
 * It carries no revision, no supersession lineage and no amendment log; ids are
 * content-derived and are re-minted on every projection. Amendment, birth-ids
 * and the revision fence are a later slice, and until they exist no claim of the
 * form "the record state is the source of truth" is available — the canonical
 * scenario row has a second writer this sidecar cannot see.
 */
import type { DraftRecordSet } from "./grammar.js";
import type { RecordProjection, RecordProvenanceClass, DroppedRecordRef } from "./projector.js";

/** Bumped whenever the shape below changes in a way a reader could notice. */
export const DRAFT_RECORDS_SIDECAR_VERSION = 1 as const;

export type BindingClass = RecordProvenanceClass;

/** The record ↔ graph join, one entry per projected node and edge. */
export interface RecordBinding {
  /** `node` | `edge` — which side of the graph this id names. */
  readonly graph_element: "node" | "edge";
  /** The minted graph id. */
  readonly graph_ref: string;
  readonly binding_class: BindingClass;
  /**
   * The user's own words, present iff `stated`. Canonicalised, never
   * paraphrased — a paraphrase badged `stated` misrepresents the user to
   * themselves.
   */
  readonly source_quote?: string;
  /**
   * The minted ids of the stated items an inference was built on. Present iff
   * `ai_inferred`.
   */
  readonly basis?: readonly string[];
  /**
   * TRUE when an inference rests on nothing the user said. Explicit rather than
   * inferable from an empty `basis`, because "no basis supplied" and "basis
   * supplied but empty" must not be indistinguishable to a reader that only
   * checks `.length`.
   */
  readonly unbased?: boolean;
}

export interface DraftRecordsSidecar {
  readonly version: typeof DRAFT_RECORDS_SIDECAR_VERSION;
  /** sha256 of the instruction bytes the model was served. */
  readonly instruction_sha256: string;
  /** sha256 of the serialised grammar attached to the request. */
  readonly grammar_sha256: string;
  /** Exactly what the model emitted, before projection. */
  readonly records: DraftRecordSet;
  readonly bindings: readonly RecordBinding[];
  /**
   * Every reference the projector refused to guess at. DISCLOSED, never silent:
   * a dropped link a reader can see is a different and far better thing than one
   * that vanished without trace.
   */
  readonly dropped: readonly DroppedRecordRef[];
  /** Counts, derived here so no reader has to re-derive them inconsistently. */
  readonly counts: {
    readonly stated_items: number;
    readonly claims: number;
    readonly nodes: number;
    readonly edges: number;
    readonly bindings_by_class: Readonly<Record<BindingClass, number>>;
    readonly dropped: number;
  };
}

/**
 * Build the sidecar from a projection.
 *
 * PURE, and derived entirely from the projection's own provenance map — there is
 * no second traversal that could disagree with the projector about which class
 * an element belongs to (trap 12: two readers of the same fact drift).
 */
export function buildDraftRecordsSidecar(args: {
  records: DraftRecordSet;
  projection: RecordProjection;
  instructionSha256: string;
  grammarSha256: string;
}): DraftRecordsSidecar {
  const { records, projection } = args;
  const nodeIds = new Set(projection.graph.nodes.map((n) => n.id));
  const bindings: RecordBinding[] = [];
  const byClass: Record<BindingClass, number> = {
    stated: 0,
    ai_inferred: 0,
    projector_structural: 0,
  };

  // Emission order is the projection's own node-then-edge order, so the sidecar
  // is as deterministic as the projection it describes.
  const ordered: Array<{ id: string; element: "node" | "edge" }> = [
    ...projection.graph.nodes.map((n) => ({ id: n.id, element: "node" as const })),
    ...projection.graph.edges.map((e) => ({ id: e.id, element: "edge" as const })),
  ];

  for (const { id, element } of ordered) {
    const prov = projection.provenance[id];
    if (!prov) continue;
    byClass[prov.provenance_class] += 1;
    bindings.push({
      graph_element: element,
      graph_ref: id,
      binding_class: prov.provenance_class,
      ...(prov.source_quote !== undefined ? { source_quote: prov.source_quote } : {}),
      ...(prov.basis !== undefined ? { basis: prov.basis } : {}),
      ...(prov.unbased !== undefined ? { unbased: prov.unbased } : {}),
    });
  }

  return {
    version: DRAFT_RECORDS_SIDECAR_VERSION,
    instruction_sha256: args.instructionSha256,
    grammar_sha256: args.grammarSha256,
    records,
    bindings,
    dropped: projection.dropped,
    counts: {
      stated_items: records.stated_items?.length ?? 0,
      claims: records.claims?.length ?? 0,
      nodes: nodeIds.size,
      edges: projection.graph.edges.length,
      bindings_by_class: byClass,
      dropped: projection.dropped.length,
    },
  };
}
