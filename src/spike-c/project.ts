/**
 * SPIKE ARM C — the deterministic projector (SEMANTIC-SPINE-SPIKE-PROTOCOL §2).
 *
 * ⚠ THROWAWAY. Spike branch only. Never merged, never pushed to `staging`.
 *
 * A PURE function `(StatedItem[], InferenceClaim[]) → GraphV3` with canonical
 * serialisation and stable ids. Its output enters the pipeline exactly where the
 * LLM's graph output enters today (the parse stage's post-LLM seam), so every
 * existing consumer — repair, validation, persistence, analysis, UI — is
 * unchanged.
 *
 * ── DETERMINISM IS THE DESIGN'S ENTIRE PREMISE (C-K1) ──────────────────────
 * Nothing in this module may read a clock, a random source, a UUID generator,
 * an environment variable, or any module-level mutable state. Identity is a
 * pure function of the record set's CONTENT and ORDER. The C-K1 battery
 * (`__tests__/projector-determinism.property.test.ts`) is the instrument; this
 * comment is not the guarantee.
 *
 * ── ⭐ WHY THIS CANNOT COMMIT FALSE AUTHORSHIP, STRUCTURALLY ───────────────
 * §2: "Provenance is assigned MECHANICALLY: anything from a `StatedItem`
 * carries stated provenance with its quote; anything from an `InferenceClaim`
 * carries `ai_inferred`. A deterministic projector structurally cannot commit
 * false authorship — any observed instance is a design refutation and an
 * instant kill (C-K4)."
 *
 * The mechanism that makes that true here, rather than merely asserted: there
 * is exactly ONE construction site per provenance class, each takes its badge
 * from the ARRAY IT ITERATES rather than from any field the model controls, and
 * the model has no field through which to express a provenance claim at all —
 * `records-schema.ts` carries no provenance property. A badge is therefore a
 * function of WHICH LOOP built the element, and the model cannot reach it.
 *
 * ⚠ AND THE THIRD CLASS, WHICH THE PROTOCOL DOES NOT NAME (reported finding).
 * A record set is not a graph: options need a decision to hang from. The
 * projector therefore synthesises a decision node and decision→option edges
 * when options exist. Those are NEITHER stated NOR AI-inferred — they are the
 * projector's own topology. Badging them either way WOULD be false authorship
 * committed by the projector itself, which is exactly C-K4's kill condition.
 * They carry a distinct `projector_structural` class. Metric 6.3's classifier
 * must treat that as a third value and not collapse it into either bucket; a
 * classifier that knows only two classes would score these as a defect (or,
 * worse, silently as stated). Named here because the classifier is written by
 * a different lane.
 */

import { createHash } from "node:crypto";
import type {
  SpikeCInferenceClaim,
  SpikeCRecordSet,
  SpikeCStatedItem,
} from "./records-schema.js";

// ── Provenance ──────────────────────────────────────────────────────────────

export type SpikeCProvenanceClass = "stated" | "ai_inferred" | "projector_structural";

/**
 * ⭐ `C-BUILD-1` — THE TWO FIELDS THE CONSUMER REQUIRES, AND WHY THESE VALUES.
 *
 * At `cec98ae2` every arm-C draft that emitted an edge was rejected:
 * `edges.N.provenance.source: Required` / `.quote: Required`. The projector was
 * correct against its OWN types and wrong against the consumer's — trap 13d.
 * The consumer, derived at the bytes:
 *
 *   `LLMEdge.provenance = StructuredProvenance.optional()`  (shared-schemas.ts:118)
 *   `StructuredProvenance = z.object({ source: z.string().min(1),
 *                                      quote:  z.string().max(100),
 *                                      location: z.string().optional() }).passthrough()`
 *                                                            (schemas/graph.ts:344)
 *
 * NOTE `LLMEdge` takes the OBJECT only — the `z.union([StructuredProvenance,
 * z.string()])` legacy-string branch exists on `EdgeInput` (graph.ts:409) and NOT
 * here, so "emit a plain string" is not available at the validator that failed.
 * `.passthrough()` is what lets `provenance_class` / `basis` / `unbased` ride
 * alongside, so the projector's own vocabulary is not lost to satisfy the schema.
 *
 * ── THE ATTRIBUTION RULE (orchestrator ruling, 2026-08-11; binding) ─────────
 * Inferred structure is HONESTLY AI-ATTRIBUTED. A user source or quote is NEVER
 * fabricated for an edge the model inferred or the projector scaffolded. Note
 * what that forecloses: `quote: <the stated item's source_quote>` would satisfy
 * the schema on the CRM control brief and fail on the fidelity briefs (whose
 * sentences exceed `max(100)`) — and where it passed it would be a LIE, telling
 * the user their own words justified a link they never drew.
 *
 * ── WHY THESE PARTICULAR STRINGS (derived, not chosen) ─────────────────────
 * `source` is free text (`z.string().min(1)`), so the value is a semantic
 * decision and is taken from the PRODUCER's declared semantics rather than from
 * this lane's reading of what the field ought to mean (trap 13c):
 *   · `"hypothesis"` — named in `StructuredProvenance`'s own comment ("File name,
 *     metric name, or 'hypothesis'"), a member of `ProvenanceSource`
 *     (graph.ts:29), and what CEE's enricher already stamps on machine-asserted
 *     edges (`factor-extraction/enricher.ts:452,1140`).
 *   · `"synthetic"` — what CEE already stamps on machine-scaffolded connectivity
 *     (`unified-pipeline/utils/edge-format.ts:138` `neutralCausalEdge`;
 *     `repair/deterministic-sweep.ts:996,1003,1308`), with a `quote` that
 *     describes the MACHINE ACTION ("Repair edge (structural connectivity)") —
 *     the precedent these two quotes follow.
 *
 * ── THE CONSUMER-SIDE CHECK THAT MADE THIS A DERIVATION AND NOT A TASTE CALL ─
 * `mapToV3ProvenanceSource` (`cee/transforms/schema-v3.ts:727`) is a LOWERCASED
 * SUBSTRING matcher over `source`, and it routes to the user-facing badge:
 * anything containing "brief", "document" or "evidence" becomes
 * `brief_extraction` → wire `provenance_display: "from_brief"`; "user",
 * "specified" or "manual" becomes `user_specified` → `"user_set"`. So the
 * well-meaning `source: "inferred from the brief"` would make the product tell
 * the user their brief stated a link the model invented — false authorship
 * committed by a string. `"hypothesis"` routes EXPLICITLY to `cee_hypothesis`;
 * `"synthetic"` falls to the same default every CEE structural edge takes. Both
 * display `ai_inferred`, which is the honest badge for both classes, and the
 * quotes are worded to contain none of that matcher's routing keywords either.
 */
const EDGE_ATTRIBUTION = {
  ai_inferred: {
    source: "hypothesis",
    quote: "Model-inferred causal link (spike arm C projector)",
  },
  projector_structural: {
    source: "synthetic",
    quote: "Decision-to-option scaffold minted by the projector",
  },
} as const;

export interface SpikeCProvenanceRecord {
  readonly provenance_class: SpikeCProvenanceClass;
  /**
   * REQUIRED by `StructuredProvenance` on any object that reaches an edge.
   * Present on edge provenance; absent on node provenance, which no consumer
   * validates (`LLMNode` and `Node` are `.passthrough()` with no `provenance`
   * key — which is exactly why the live failure named edges only).
   */
  readonly source?: string;
  /** REQUIRED by `StructuredProvenance` (max 100). NEVER user text — see above. */
  readonly quote?: string;
  /** Present iff `stated`. The verbatim quote, canonicalised. */
  readonly source_quote?: string;
  /** Present iff `ai_inferred`. Minted ids of the stated items it builds on. */
  readonly basis?: readonly string[];
  /**
   * Present iff `ai_inferred`. TRUE when `basis` is empty — pure invention,
   * and marked so (§2). Explicit rather than inferable from an empty array,
   * because "no basis supplied" and "basis supplied but empty" must not be
   * distinguishable to a downstream reader that only checks `.length`.
   */
  readonly unbased?: boolean;
}

/** A reference the model emitted that the projector could not resolve. */
export interface SpikeCDroppedRef {
  readonly claim_index: number;
  readonly claim_kind: string;
  readonly label: string;
  readonly reason:
    | "unparseable_ref"
    | "ref_out_of_range"
    | "ref_target_not_a_node"
    | "self_loop"
    | "missing_ref";
  readonly from_ref?: string;
  readonly to_ref?: string;
}

export interface SpikeCProjection {
  /** GraphV3, ready for the parse stage's post-LLM seam. */
  readonly graph: SpikeCGraph;
  /** node/edge id → provenance. The classifier's authority for metric 6.3. */
  readonly provenance: Readonly<Record<string, SpikeCProvenanceRecord>>;
  /**
   * Every reference the projector refused to guess at. DISCLOSED, never
   * silent — a dropped link is `unresolved-or-disclosed` under metric 6.2,
   * whereas a silently swallowed one is `silently-lost`, the defect class.
   */
  readonly dropped: readonly SpikeCDroppedRef[];
}

// ── GraphV3 output shapes (structural mirrors of `schemas/graph.ts`) ─────────

export interface SpikeCNode {
  id: string;
  kind: "goal" | "decision" | "option" | "outcome" | "risk" | "action" | "factor" | "constraint";
  label: string;
  category?: "controllable" | "observable" | "external";
  data?: Record<string, unknown>;
  observed_state?: Record<string, unknown>;
  provenance?: SpikeCProvenanceRecord;
}

export interface SpikeCEdge {
  id: string;
  from: string;
  to: string;
  effect_direction?: "positive" | "negative";
  strength_mean?: number;
  origin: "ai" | "default";
  provenance_source: "inferred" | "structural";
  provenance?: SpikeCProvenanceRecord;
}

export interface SpikeCGraph {
  version: string;
  default_seed: number;
  nodes: SpikeCNode[];
  edges: SpikeCEdge[];
  meta: {
    roots: string[];
    leaves: string[];
    suggested_positions: Record<string, never>;
    source: "assistant";
  };
}

// ── Canonicalisation primitives ─────────────────────────────────────────────

/**
 * NFC-normalise, trim, collapse internal whitespace runs to a single space.
 *
 * ⚠ This is IDENTITY-BEARING: it feeds the hash. Two quotes differing only by
 * a non-breaking space, a CRLF, or a trailing tab MUST mint the same id, or the
 * "same content ⇒ same id" premise fails on input a real model actually emits.
 * `\s` in a JS regex covers NBSP (U+00A0), the Unicode space separators, tabs
 * and every newline form, so one class handles all of them.
 */
export function canonicalText(input: string): string {
  return input.normalize("NFC").replace(/\s+/g, " ").trim();
}

/**
 * First 8 hex chars of sha256 over NUL-joined parts.
 *
 * The NUL separator is not decoration: joining with any printable character
 * makes `("ab","c")` and `("a","bc")` collide. NUL cannot occur in canonicalised
 * text (`\s+` collapsing does not produce it and JSON strings carry it escaped),
 * so the encoding is injective over this domain.
 */
export function sha8(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000"), "utf8").digest("hex").slice(0, 8);
}

/**
 * Recursively key-sorted stringify — the canonical serialisation C-K1 hashes.
 *
 * Object key order is NOT part of graph identity: two projections that differ
 * only in key order are the same graph. Comparing raw `JSON.stringify` output
 * would therefore report a divergence that is not one — and, far worse, could
 * report AGREEMENT for the wrong reason if both sides were built by the same
 * accidental ordering. Sorting makes the comparison a claim about CONTENT.
 * Arrays keep their order, because element order IS identity-bearing here.
 */
export function canonicalSerialise(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalSerialise).join(",")}]`;
  const rec = value as Record<string, unknown>;
  const keys = Object.keys(rec).sort();
  return `{${keys
    .filter((k) => rec[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalSerialise(rec[k])}`)
    .join(",")}}`;
}

/**
 * THE `floor`/`ceiling` → wire-operator mapping. The ONLY site.
 *
 * Derived at the CONSUMER's bytes: `ConstraintOperator = z.enum([">=", "<="])`
 * (`schemas/graph.ts:171`). CEE #888 burned four rounds on a floor/ceiling
 * predicate; the lesson taken here is that the gate's language and the wire
 * operator are two vocabularies, the translation happens exactly once, and it
 * is pinned by a test rather than restated in prose.
 */
export function directionToOperator(direction: "floor" | "ceiling"): ">=" | "<=" {
  return direction === "floor" ? ">=" : "<=";
}

// ── Identity minting ────────────────────────────────────────────────────────

/**
 * Deterministic collision suffixing.
 *
 * Two identical `(kind, quote)` pairs are legitimately possible (a model may
 * repeat itself). Both must still get DISTINCT node ids or the graph silently
 * loses one. Suffixing by first-seen array position is deterministic: same
 * input order ⇒ same suffixes.
 */
function mintUnique(base: string, used: Map<string, number>): string {
  const seen = used.get(base) ?? 0;
  used.set(base, seen + 1);
  return seen === 0 ? base : `${base}-${seen + 1}`;
}

const STATED_KIND_TO_NODE_KIND: Readonly<Record<string, SpikeCNode["kind"]>> = {
  goal: "goal",
  option: "option",
  constraint: "constraint",
  // A stated figure is a quantity the user asserted: a factor node carrying it.
  figure: "factor",
};

const CLAIM_KIND_TO_NODE_KIND: Readonly<Record<string, SpikeCNode["kind"] | null>> = {
  factor: "factor",
  option_refinement: "option",
  prior: "factor",
  // Produces an EDGE, never a node.
  causal_link: null,
};

/** `s3` → stated_items[3]; `c1` → claims[1]. Anything else is unparseable. */
const REF_PATTERN = /^([sc])(\d+)$/;

// ── The projector ───────────────────────────────────────────────────────────

export function projectRecordsToGraph(records: SpikeCRecordSet): SpikeCProjection {
  const statedItems: readonly SpikeCStatedItem[] = records.stated_items ?? [];
  const claims: readonly SpikeCInferenceClaim[] = records.claims ?? [];

  const nodes: SpikeCNode[] = [];
  const edges: SpikeCEdge[] = [];
  const dropped: SpikeCDroppedRef[] = [];
  const provenance: Record<string, SpikeCProvenanceRecord> = {};
  const usedIds = new Map<string, number>();

  /** Wire-ref token → minted node id. Populated in emission order. */
  const statedIdByIndex = new Map<number, string>();
  const claimIdByIndex = new Map<number, string>();

  // ── Pass 1: stated items → nodes. Provenance badge is `stated`, taken from
  // the loop, not from any model-supplied field.
  statedItems.forEach((item, index) => {
    const quote = canonicalText(item.source_quote ?? "");
    const kind = STATED_KIND_TO_NODE_KIND[item.kind];
    // An unknown kind cannot occur through the grammar (enum-constrained), but
    // the projector is also called from tests and fixtures. Skip loudly rather
    // than emit an untyped node.
    if (!kind) return;

    const id = mintUnique(sha8(item.kind, quote), usedIds);
    statedIdByIndex.set(index, id);

    const prov: SpikeCProvenanceRecord = { provenance_class: "stated", source_quote: quote };
    provenance[id] = prov;

    const node: SpikeCNode = {
      id,
      kind,
      // The label IS the user's own words. Nothing is paraphrased: a paraphrase
      // badged `stated` would be the misrepresentation class (metric 6.2's
      // worst), so the projector never rewrites a quote it attributes.
      label: quote,
      provenance: prov,
    };

    if (kind === "constraint" && typeof item.value === "number") {
      const operator = directionToOperator(item.direction ?? "ceiling");
      // PLoT reads the operator in BOTH places (graph.ts:176-178, 252-258).
      node.data = { operator };
      node.observed_state = {
        value: item.value,
        metadata: {
          operator,
          original_value: item.value,
          ...(item.unit ? { unit: item.unit } : {}),
        },
      };
    } else if (kind === "factor" && typeof item.value === "number") {
      node.data = { value: item.value, ...(item.unit ? { unit: item.unit } : {}) };
      // ⚠ FactorObservedState REFUSES any `metadata` key (graph.ts:226-235) —
      // a factor carrying constraint metadata matches NEITHER union branch and
      // 400s. Unit lives on `data`, never here.
      node.observed_state = { value: item.value, raw_value: item.value };
    }

    if (item.role === "target" || item.role === "baseline") {
      node.category = "observable";
    }

    nodes.push(node);
  });

  // ── Pass 2: claims → nodes. Badge is `ai_inferred`, again taken from the loop.
  claims.forEach((claim, index) => {
    const nodeKind = CLAIM_KIND_TO_NODE_KIND[claim.claim_kind];
    if (nodeKind === null || nodeKind === undefined) return;

    const label = canonicalText(claim.label ?? "");
    const id = mintUnique(sha8(claim.claim_kind, label), usedIds);
    claimIdByIndex.set(index, id);

    const basisIds = (claim.basis ?? [])
      .filter((i) => Number.isInteger(i) && statedIdByIndex.has(i))
      .map((i) => statedIdByIndex.get(i)!);

    const prov: SpikeCProvenanceRecord = {
      provenance_class: "ai_inferred",
      basis: basisIds,
      unbased: basisIds.length === 0,
    };
    provenance[id] = prov;

    const node: SpikeCNode = { id, kind: nodeKind, label, provenance: prov };
    if (nodeKind === "factor") {
      if (claim.category) node.category = claim.category;
      if (typeof claim.value === "number") {
        node.data = { value: claim.value };
        node.observed_state = { value: claim.value };
      }
    }
    nodes.push(node);
  });

  // ── Pass 3: causal_link claims → edges. Runs AFTER both node passes so a
  // link may reference a claim declared later in the array.
  const nodeIds = new Set(nodes.map((n) => n.id));

  const resolveRef = (ref: string | undefined): { id?: string; reason?: SpikeCDroppedRef["reason"] } => {
    if (ref === undefined) return { reason: "missing_ref" };
    const m = REF_PATTERN.exec(ref);
    if (!m) return { reason: "unparseable_ref" };
    const idx = Number(m[2]);
    const id = m[1] === "s" ? statedIdByIndex.get(idx) : claimIdByIndex.get(idx);
    if (id === undefined) return { reason: "ref_out_of_range" };
    if (!nodeIds.has(id)) return { reason: "ref_target_not_a_node" };
    return { id };
  };

  claims.forEach((claim, index) => {
    if (claim.claim_kind !== "causal_link") return;
    const label = canonicalText(claim.label ?? "");
    const from = resolveRef(claim.from_ref);
    const to = resolveRef(claim.to_ref);

    const bad = from.reason ?? to.reason;
    if (bad || !from.id || !to.id) {
      dropped.push({
        claim_index: index,
        claim_kind: claim.claim_kind,
        label,
        reason: bad ?? "missing_ref",
        ...(claim.from_ref !== undefined ? { from_ref: claim.from_ref } : {}),
        ...(claim.to_ref !== undefined ? { to_ref: claim.to_ref } : {}),
      });
      return;
    }
    if (from.id === to.id) {
      dropped.push({
        claim_index: index,
        claim_kind: claim.claim_kind,
        label,
        reason: "self_loop",
        ...(claim.from_ref !== undefined ? { from_ref: claim.from_ref } : {}),
        ...(claim.to_ref !== undefined ? { to_ref: claim.to_ref } : {}),
      });
      return;
    }

    const basisIds = (claim.basis ?? [])
      .filter((i) => Number.isInteger(i) && statedIdByIndex.has(i))
      .map((i) => statedIdByIndex.get(i)!);
    // The EDGE provenance carries the two consumer-required fields; the badge
    // and the basis are unchanged. The basis is the honest reference to the
    // records this link was built on — the record IDS, never their quotes.
    const prov: SpikeCProvenanceRecord = {
      provenance_class: "ai_inferred",
      ...EDGE_ATTRIBUTION.ai_inferred,
      basis: basisIds,
      unbased: basisIds.length === 0,
    };

    // Edge identity includes its endpoints, so two links with the same label
    // between different pairs stay distinct.
    const edgeId = mintUnique(sha8("edge", label, from.id, to.id), usedIds);
    provenance[edgeId] = prov;
    edges.push({
      id: edgeId,
      from: from.id,
      to: to.id,
      ...(claim.effect ? { effect_direction: claim.effect } : {}),
      ...(typeof claim.strength === "number" ? { strength_mean: claim.strength } : {}),
      origin: "ai",
      provenance_source: "inferred",
      provenance: prov,
    });
  });

  // ── Pass 4: projector-structural topology. See the header's third-class note.
  const optionNodes = nodes.filter((n) => n.kind === "option");
  if (optionNodes.length > 0) {
    // ONE construction site for this class, as the header's mechanism requires —
    // the decision node and its edges share it. The two consumer-required fields
    // are load-bearing on the EDGES (nodes are not validated); carrying them on
    // the node too is honest of a scaffold node and keeps the class to one site.
    const structuralProv: SpikeCProvenanceRecord = {
      provenance_class: "projector_structural",
      ...EDGE_ATTRIBUTION.projector_structural,
    };
    // Identity is derived from the option ids it joins, so the decision node is
    // stable across runs and distinct across different option sets.
    const decisionId = mintUnique(sha8("decision", ...optionNodes.map((n) => n.id)), usedIds);
    provenance[decisionId] = structuralProv;
    // Unshifted so the decision precedes its options in emission order.
    nodes.unshift({
      id: decisionId,
      kind: "decision",
      label: "Decision",
      provenance: structuralProv,
    });
    for (const opt of optionNodes) {
      const edgeId = mintUnique(sha8("edge", "structural", decisionId, opt.id), usedIds);
      provenance[edgeId] = structuralProv;
      edges.push({
        id: edgeId,
        from: decisionId,
        to: opt.id,
        origin: "default",
        provenance_source: "structural",
        provenance: structuralProv,
      });
    }
  }

  // ── meta: derived, in node-emission order (never Set-iteration order).
  const hasIncoming = new Set(edges.map((e) => e.to));
  const hasOutgoing = new Set(edges.map((e) => e.from));

  return {
    graph: {
      version: "1",
      // The frozen default (`schemas/graph.ts` `default_seed: 17`). A projector
      // that minted its own seed would be a non-determinism source AND would
      // fork the graph hash — the exact defect trap 10 was written about.
      default_seed: 17,
      nodes,
      edges,
      meta: {
        roots: nodes.filter((n) => !hasIncoming.has(n.id)).map((n) => n.id),
        leaves: nodes.filter((n) => !hasOutgoing.has(n.id)).map((n) => n.id),
        suggested_positions: {},
        source: "assistant",
      },
    },
    provenance,
    dropped,
  };
}

/** The C-K1 comparison value: one canonical string per projection. */
export function projectionFingerprint(projection: SpikeCProjection): string {
  return canonicalSerialise({
    graph: projection.graph,
    provenance: projection.provenance,
    dropped: projection.dropped,
  });
}
