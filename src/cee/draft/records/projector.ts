/**
 * THE DETERMINISTIC PROJECTOR — record set → GraphV3.
 *
 * A PURE function `(DraftStatedItem[], DraftInferenceClaim[]) → GraphV3` with
 * canonical serialisation and stable ids. Its output enters the pipeline exactly
 * where the model's graph output entered before, at the adapter's post-LLM seam,
 * so every existing consumer — normalisation, repair, validation, persistence,
 * analysis, UI — is byte-for-byte unchanged and no published contract moves.
 *
 * ── DETERMINISM IS THE DESIGN'S ENTIRE PREMISE ─────────────────────────────
 * Nothing in this module may read a clock, a random source, a UUID generator, an
 * environment variable, or any module-level mutable state. Identity is a pure
 * function of the record set's CONTENT and ORDER. The property battery
 * (`__tests__/projector-determinism.property.test.ts`) is the instrument; this
 * comment is not the guarantee. Measured 15/15 — 100 property fixtures × 2 runs
 * plus 3 real record sets × 10 runs, with an injected-non-determinism control
 * that REDs.
 *
 * ── ⭐ WHY THIS CANNOT COMMIT FALSE AUTHORSHIP, STRUCTURALLY ───────────────
 * Anything built from a `stated_item` carries STATED provenance with the user's
 * own quote; anything built from a `claim` carries AI-INFERRED provenance. The
 * mechanism that makes that true — rather than merely asserted — is that there
 * is exactly ONE construction site per provenance class, each takes its badge
 * from the ARRAY IT ITERATES rather than from any field the model controls, and
 * THE MODEL HAS NO FIELD THROUGH WHICH TO EXPRESS A PROVENANCE CLAIM AT ALL:
 * `grammar.ts` carries no provenance property. A badge is therefore a function
 * of WHICH LOOP built the element, and the model cannot reach it.
 *
 * ── ⚠ AND THE THIRD CLASS, WHICH IS NEITHER ────────────────────────────────
 * A record set is not a graph: options need a decision to hang from. The
 * projector therefore synthesises a decision node and decision→option edges when
 * options exist. Those are NEITHER stated NOR AI-inferred — they are the
 * projector's own topology. Badging them either way WOULD be false authorship
 * committed by the projector itself. They carry a distinct
 * `projector_structural` class. ANY CONSUMER OR CLASSIFIER MUST TREAT THAT AS A
 * THIRD VALUE and not collapse it into either bucket; a two-class reader scores
 * these as a defect, or — worse — silently as stated.
 *
 * ── ⭐ NODE-LEVEL PROVENANCE HONESTY (the `extractionType` seam) ────────────
 * Node provenance is NOT carried by the `provenance` object below — that object
 * is read by the edge path only. The user-facing NODE badge is derived by
 * `nodeProvenanceDisplay(extractionType)` (`cee/transforms/provenance-display.ts`)
 * from `observed_state.extractionType ?? node.extractionType ?? data.extractionType`,
 * and a `from_brief` claim is then independently RE-EARNED by `mayClaimFromBrief`
 * (`cee/provenance/factor-value-provenance.ts`, ROADMAP 2.972: a value-free node
 * cannot have come from the brief). Derived at those bytes, not inferred from the
 * edge path.
 *
 * The projector therefore sets `extractionType: "explicit"` on EXACTLY ONE class
 * — a `figure` the user stated WITH a number — and sets nothing anywhere else,
 * so everything the model or the projector added falls to the safe `ai_inferred`
 * default. That is the narrowest honest statement available: the value on such a
 * node is the user's own, verbatim from their located quote, and the existing
 * 2.972 gate re-checks the claim independently, so this cannot manufacture a
 * `from_brief` badge for a node that has not earned one.
 */

import { createHash } from "node:crypto";
// ⭐ DERIVED, NEVER MIRRORED. The bound the projector honours is the validator's own
// constant, imported. A hand-copied `6` here would be a second authority for one
// number and would drift silently the day CEE retunes it (trap 12, the estate's
// dominant defect class).
import { MAX_OPTIONS as MAX_PROJECTED_OPTIONS } from "../../../validators/graph-validator.types.js";
import type {
  DraftInferenceClaim,
  DraftRecordSet,
  DraftStatedItem,
} from "./grammar.js";

// ── Provenance ──────────────────────────────────────────────────────────────

export type RecordProvenanceClass = "stated" | "ai_inferred" | "projector_structural";

/**
 * ⭐ THE TWO FIELDS THE CONSUMER REQUIRES, AND WHY THESE VALUES.
 *
 * The first build of this projector had every edge-bearing draft rejected at the
 * validator: `edges.N.provenance.source: Required` / `.quote: Required`. The
 * projector was correct against its OWN types and wrong against the consumer's
 * (trap 13d: write invariants against the consumer's actual predicate). The
 * consumer, derived at the bytes and RE-DERIVED at this tip:
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
 * `mapToV3ProvenanceSource` (`cee/transforms/schema-v3.ts:728`) is a LOWERCASED
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
    quote: "Model-inferred causal link (records projector)",
  },
  projector_structural: {
    source: "synthetic",
    quote: "Decision-to-option scaffold minted by the projector",
  },
} as const;

export interface RecordProvenance {
  readonly provenance_class: RecordProvenanceClass;
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
   * and marked so. Explicit rather than inferable from an empty array,
   * because "no basis supplied" and "basis supplied but empty" must not be
   * distinguishable to a downstream reader that only checks `.length`.
   */
  readonly unbased?: boolean;
}

/** A reference the model emitted that the projector could not resolve. */
export interface DroppedRecordRef {
  readonly claim_index: number;
  readonly claim_kind: string;
  readonly label: string;
  readonly reason:
    | "unparseable_ref"
    | "ref_out_of_range"
    | "ref_target_not_a_node"
    | "self_loop"
    | "missing_ref"
    /**
     * The record was projected as a node and then withdrawn because nothing the
     * model emitted connects it to the goal. Kept as a RECORD and reported here;
     * never forced onto the graph with an invented edge, and never silently
     * lost. `claim_index` is -1 for these — they are named by label, because the
     * withdrawal happens after both node passes and a stated item has no claim
     * index to point at.
     */
    | "unconnected_to_goal"
    /**
     * The projected option set exceeded `MAX_OPTIONS` (6, `graph-validator.types.ts:287`)
     * and this refinement was left off the graph to bring it inside the bound.
     * DISCLOSED rather than silently truncated: over-budget is the projector's
     * problem to report, never the user's to discover from a shorter list.
     *
     * ⚠ A STATED option is NEVER dropped for budget. Dropping one narrows the
     * user's own choice set, which is the single thing a decision tool may not
     * do (the same reasoning the connectivity prune states for options). If the
     * user's own options alone exceed the bound, every one of them is kept and
     * `INSUFFICIENT_OPTIONS` is allowed to fire VISIBLY — a loud rejection beats
     * a quiet amputation.
     */
    | "option_budget_exceeded";
  readonly from_ref?: string;
  readonly to_ref?: string;
}

export interface RecordProjection {
  /** GraphV3, ready for the parse stage's post-LLM seam. */
  readonly graph: ProjectedGraph;
  /** node/edge id → provenance. The authority for every provenance question. */
  readonly provenance: Readonly<Record<string, RecordProvenance>>;
  /**
   * Every reference the projector refused to guess at. DISCLOSED, never silent —
   * a dropped link the user can see is a different and far better thing than one
   * that vanished without trace.
   */
  readonly dropped: readonly DroppedRecordRef[];
}

// ── GraphV3 output shapes (structural mirrors of `schemas/graph.ts`) ─────────

export interface ProjectedNode {
  id: string;
  kind: "goal" | "decision" | "option" | "outcome" | "risk" | "action" | "factor" | "constraint";
  label: string;
  category?: "controllable" | "observable" | "external";
  data?: Record<string, unknown>;
  observed_state?: Record<string, unknown>;
  provenance?: RecordProvenance;
}

export interface ProjectedEdge {
  id: string;
  from: string;
  to: string;
  effect_direction?: "positive" | "negative";
  strength_mean?: number;
  origin: "ai" | "default";
  provenance_source: "inferred" | "structural";
  provenance?: RecordProvenance;
}

export interface ProjectedGraph {
  version: string;
  default_seed: number;
  nodes: ProjectedNode[];
  edges: ProjectedEdge[];
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
 * Recursively key-sorted stringify — the canonical serialisation the determinism
 * battery hashes.
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

const STATED_KIND_TO_NODE_KIND: Readonly<Record<string, ProjectedNode["kind"]>> = {
  goal: "goal",
  option: "option",
  constraint: "constraint",
  // A stated figure is a quantity the user asserted: a factor node carrying it.
  figure: "factor",
};

const CLAIM_KIND_TO_NODE_KIND: Readonly<Record<string, ProjectedNode["kind"] | null>> = {
  factor: "factor",
  option_refinement: "option",
  prior: "factor",
  // Produces an EDGE, never a node.
  causal_link: null,
};

/** `s3` → stated_items[3]; `c1` → claims[1]. Anything else is unparseable. */
const REF_PATTERN = /^([sc])(\d+)$/;

// ── The projector ───────────────────────────────────────────────────────────

export function projectRecordsToGraph(records: DraftRecordSet): RecordProjection {
  const statedItems: readonly DraftStatedItem[] = records.stated_items ?? [];
  const claims: readonly DraftInferenceClaim[] = records.claims ?? [];

  const nodes: ProjectedNode[] = [];
  const edges: ProjectedEdge[] = [];
  const dropped: DroppedRecordRef[] = [];
  /** edge id → the model's stated option→factor intervention level (`sets_to`). */
  const setsToByEdgeId = new Map<string, number>();
  const provenance: Record<string, RecordProvenance> = {};
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

    const prov: RecordProvenance = { provenance_class: "stated", source_quote: quote };
    provenance[id] = prov;

    const node: ProjectedNode = {
      id,
      kind,
      // The label IS the user's own words. Nothing is paraphrased: a paraphrase
      // badged `stated` would be a misrepresentation of the user to themselves,
      // so the projector never rewrites a quote it attributes.
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
      node.data = {
        value: item.value,
        ...(item.unit ? { unit: item.unit } : {}),
        // ⭐ THE ONE PLACE THIS PROJECTOR CLAIMS THE BRIEF, and the only one.
        //
        // `extractionType` is a DECLARED field (`FactorNodeData.extractionType`,
        // `schemas/graph.ts:135`) — it does not ride a `.passthrough()`. The
        // consumer chain, derived at the bytes rather than inferred:
        //   `schema-v3.ts` reads `observed_state.extractionType ?? node.extractionType
        //   ?? data.extractionType` (via `isFactorData`), maps it through
        //   `nodeProvenanceDisplay` ("explicit"|"observed" → `from_brief`), and then
        //   WITHDRAWS the claim unless `mayClaimFromBrief` re-earns it
        //   (`classifyFactorValueTier === "explicit"`, i.e. the label AND a numeric
        //   value both present — ROADMAP 2.972).
        //
        // The claim is honest here by construction: this branch runs only inside the
        // stated-items loop, only for a `figure`, and only when the USER stated the
        // number — `item.value` is the model's transcription of their own quote, not
        // an estimate. Every other node this projector emits sets no
        // `extractionType` at all and therefore falls to the safe `ai_inferred`
        // default. And because 2.972's gate re-derives the verdict from the value it
        // can see, this line cannot manufacture a `from_brief` badge for a node that
        // has not earned one — the badge and the pipeline's own value accounting
        // come from ONE derivation and cannot drift apart (trap 12).
        extractionType: "explicit",
      };
      // ⚠ FactorObservedState REFUSES any `metadata` key (graph.ts:225-233) —
      // a factor carrying constraint metadata matches NEITHER union branch and
      // 400s. Unit lives on `data`, never here.
      node.observed_state = { value: item.value, raw_value: item.value };
    }

    // ⚠ `role` DOES NOT SET A CATEGORY EITHER — same reasoning as the claim
    // branch below. `target`/`baseline` describe what the user was doing with the
    // number; `controllable`/`observable`/`external` describe the node's position
    // in the causal structure. They are two different questions, and answering
    // one with the other is how a `figure` an option acts on ends up labelled
    // `observable` and its edge rejected.

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

    const prov: RecordProvenance = {
      provenance_class: "ai_inferred",
      basis: basisIds,
      unbased: basisIds.length === 0,
    };
    provenance[id] = prov;

    const node: ProjectedNode = { id, kind: nodeKind, label, provenance: prov };
    if (nodeKind === "factor") {
      // ⚠ THE MODEL'S DECLARED `category` IS DELIBERATELY NOT PROPAGATED.
      //
      // Derived at the consumer's bytes, and measured live before this line was
      // written. `category` is INFERRED FROM STRUCTURE by the validator
      // (`graph-validator.ts:83-134`): a factor is `controllable` because an
      // option edge points at it. And the edge rule CONSULTS the category —
      // `{ fromKind: "option", toKind: "factor", toFactorCategory: "controllable" }`
      // (`graph-validator.types.ts:295`) — so a factor the model labelled
      // `observable` that an option points at is not merely mislabelled: the
      // edge itself becomes `INVALID_EDGE_TYPE` (`:518`), and `CATEGORY_MISMATCH`
      // fires alongside it (`:787`).
      //
      // Measured on a live draft: after the factor→goal split cleared every
      // kind-level violation, the graph still carried `INVALID_EDGE_TYPE ×2` and
      // `CATEGORY_MISMATCH ×2` — entirely from copied categories. The instruction
      // already declines to ASK the model for a category for exactly this reason;
      // the projector was quietly undoing that by copying the one the grammar
      // still allows it to volunteer.
      //
      // So the honest move is a deletion, not a translation: the projector does
      // not know the category, the validator derives it, and a value we cannot
      // justify is not one we should place on the user's graph. (The grammar
      // keeps the field: removing it is a wire change for no gain, and an
      // unread optional property costs one slot, not a rejection.)
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

  const resolveRef = (ref: string | undefined): { id?: string; reason?: DroppedRecordRef["reason"] } => {
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
    const prov: RecordProvenance = {
      provenance_class: "ai_inferred",
      ...EDGE_ATTRIBUTION.ai_inferred,
      basis: basisIds,
      unbased: basisIds.length === 0,
    };

    // Edge identity includes its endpoints, so two links with the same label
    // between different pairs stay distinct.
    const edgeId = mintUnique(sha8("edge", label, from.id, to.id), usedIds);
    provenance[edgeId] = prov;
    // Recorded per EDGE ID, not per claim index, so pass 3c reads the magnitude of
    // the edge that actually survived rather than re-deriving it from the claim
    // array — the two can diverge once the prune and the option budget have run.
    if (typeof claim.sets_to === "number") setsToByEdgeId.set(edgeId, claim.sets_to);
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

  // ── Pass 3b: DISCLOSE what the model never connected; never force it in. ───
  //
  // MEASURED, and this is the finding the whole slice turned on. A record set is
  // not a graph, and a record the model states but never links is not a graph
  // node: the consumer's `NO_PATH_TO_GOAL` (`graph-validator.ts:620`) requires
  // EVERY node except the decision to reach the goal. On a live draft, 8 of 17
  // projected nodes reached nothing — mostly stated figures the model correctly
  // kept in `stated_items` (the instruction tells it never to drop what the user
  // said) and correctly declined to connect, because they did not bear on the
  // goal. Projecting them anyway manufactured the rejection.
  //
  // There are exactly three things the projector can do with such a record, and
  // two of them are defects:
  //   FORCE IT IN   — place the node and let a repair invent an edge to the
  //                   goal. That is a machine-authored causal claim presented to
  //                   the user as part of their model. The worst option, and it
  //                   is the one that happens by default if we do nothing.
  //   DROP IT       — silently lose something the user said. The second worst.
  //   DISCLOSE IT   — keep the RECORD, leave it off the graph, and say so.
  // Only the third is honest, so it is the only one implemented.
  //
  // ⭐ WHAT IS DELIBERATELY *NOT* PRUNED, because the reasoning differs per kind:
  //   `goal`     — the graph has no meaning without it.
  //   `option`   — an option the user named must appear even if the model failed
  //                to connect it; dropping options also trips
  //                `INSUFFICIENT_OPTIONS` and silently narrows the user's own
  //                choice set, which is the one thing a decision tool may never
  //                do. A disconnected option is the sweep's problem
  //                (`NO_EFFECT_PATH`), and it is a VISIBLE problem.
  //   `decision` — minted below, structural.
  // So the rule bites only on factors and constraints: the derived material,
  // where "we could not place this" is a truthful and useful thing to report.
  //
  // The predicate is the CONSUMER's, derived at its bytes rather than invented
  // here: can this node reach the goal along emitted causal links? Reachability
  // is computed on the reverse graph from the goal, so it is a pure function of
  // the record set and stays deterministic.
  const goalNodes = nodes.filter((n) => n.kind === "goal");
  if (goalNodes.length > 0) {
    const incoming = new Map<string, string[]>();
    for (const e of edges) {
      const list = incoming.get(e.to);
      if (list) list.push(e.from);
      else incoming.set(e.to, [e.from]);
    }
    const reachesGoal = new Set<string>();
    const stack = goalNodes.map((n) => n.id);
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (reachesGoal.has(current)) continue;
      reachesGoal.add(current);
      for (const from of incoming.get(current) ?? []) stack.push(from);
    }

    const unmodelled = nodes.filter(
      (n) => (n.kind === "factor" || n.kind === "constraint") && !reachesGoal.has(n.id),
    );
    if (unmodelled.length > 0) {
      const unmodelledIds = new Set(unmodelled.map((n) => n.id));
      for (const node of unmodelled) {
        // Disclosed through the SAME channel as an unresolvable reference, so a
        // reader has one list to consult rather than two vocabularies for "the
        // projector did not place this" (trap 21).
        dropped.push({
          claim_index: -1,
          claim_kind: node.provenance?.provenance_class === "stated" ? "stated_item" : "claim",
          label: node.label,
          reason: "unconnected_to_goal",
        });
        delete provenance[node.id];
      }
      // Edges among pruned nodes go with them. An edge whose endpoint is not on
      // the graph is not a partial truth, it is a dangling reference.
      for (const edge of edges.filter((e) => unmodelledIds.has(e.from) || unmodelledIds.has(e.to))) {
        delete provenance[edge.id];
      }
      const keptEdges = edges.filter((e) => !unmodelledIds.has(e.from) && !unmodelledIds.has(e.to));
      edges.length = 0;
      edges.push(...keptEdges);
      const keptNodes = nodes.filter((n) => !unmodelledIds.has(n.id));
      nodes.length = 0;
      nodes.push(...keptNodes);
    }
  }

  // ── Pass 3b: OPTION BUDGET. The projector mints an option per stated option AND
  // per `option_refinement` claim (CLAIM_KIND_TO_NODE_KIND), so the minted count can
  // exceed the validator's `MAX_OPTIONS` even when the user named only two or three
  // things. Measured on the banked corpus: minted options ran 3..7 per set against a
  // bound of 6.
  //
  // Same three-way choice as the connectivity prune, and the same answer: FORCE IT IN
  // (let `INSUFFICIENT_OPTIONS` reject the whole draft) and DROP IT (silently shorten
  // the user's choice set) are both defects; DISCLOSE IT is the honest one. Refinements
  // are surrendered first and in reverse emission order, so the result is deterministic
  // and a stated option is never the thing that goes.
  {
    const optionNodesForBudget = nodes.filter((n) => n.kind === "option");
    if (optionNodesForBudget.length > MAX_PROJECTED_OPTIONS) {
      const isRefinement = (id: string) => provenance[id]?.provenance_class === "ai_inferred";
      const surrenderable = optionNodesForBudget.filter((n) => isRefinement(n.id)).reverse();
      const overBy = optionNodesForBudget.length - MAX_PROJECTED_OPTIONS;
      const surrendered = surrenderable.slice(0, overBy);
      if (surrendered.length > 0) {
        const goneIds = new Set(surrendered.map((n) => n.id));
        for (const node of surrendered) {
          dropped.push({
            claim_index: -1,
            claim_kind: "claim",
            label: node.label,
            reason: "option_budget_exceeded",
          });
          delete provenance[node.id];
        }
        for (const edge of edges.filter((e) => goneIds.has(e.from) || goneIds.has(e.to))) {
          delete provenance[edge.id];
        }
        const keptEdges = edges.filter((e) => !goneIds.has(e.from) && !goneIds.has(e.to));
        edges.length = 0;
        edges.push(...keptEdges);
        const keptNodes = nodes.filter((n) => !goneIds.has(n.id));
        nodes.length = 0;
        nodes.push(...keptNodes);
      }
    }
  }

  // ── Pass 3c: INTERVENTIONS. `sets_to` on an option→factor causal_link is the level
  // that factor takes under that option, and `OptionData.interventions`
  // (`schemas/graph.ts:163`, `z.record(z.string(), z.number())`) is where the analysis
  // reads it. Without this the maths can only compare bare labels.
  //
  // ⭐ THE PROJECTOR INVENTS NOTHING HERE. An entry exists if and only if the model
  // stated a number for that exact option→factor pair; there is no default, no
  // neutral fill and no derivation from `strength` (a different question — see the
  // grammar's note on why the two fields are named apart). A missing magnitude stays
  // missing, and the analysis is entitled to see that it is missing.
  //
  // Built from the SURVIVING edges, after both the connectivity prune and the option
  // budget, so an intervention can never name a factor that is no longer on the graph
  // — a dangling `interventions` key is `INVALID_INTERVENTION_REF` downstream.
  {
    const kindById = new Map(nodes.map((n) => [n.id, n.kind]));
    const interventionsByOption = new Map<string, Record<string, number>>();
    for (const edge of edges) {
      if (kindById.get(edge.from) !== "option") continue;
      if (kindById.get(edge.to) !== "factor") continue;
      const setsTo = setsToByEdgeId.get(edge.id);
      if (typeof setsTo !== "number" || !Number.isFinite(setsTo)) continue;
      const bucket = interventionsByOption.get(edge.from) ?? {};
      bucket[edge.to] = setsTo;
      interventionsByOption.set(edge.from, bucket);
    }
    for (const node of nodes) {
      const built = interventionsByOption.get(node.id);
      // An option with no stated magnitude gets NO `interventions` key at all. An
      // empty object is a sentinel the sweep strips (`deterministic-sweep.ts:494`)
      // and would claim we looked and found nothing, which is not what happened.
      //
      // ⭐ The `undefined` check is the WHOLE check, deliberately. A defensive
      // `Object.keys(built).length === 0` clause stood here and a mutant proved it
      // UNREACHABLE: a bucket is only ever stored after a key has been written to
      // it, so an empty one cannot exist. It was removed rather than left in — an
      // unreachable guard is a branch no test can ever kill, which is the same
      // "guard that cannot fail" shape this module's tests exist to hunt.
      if (built === undefined) continue;
      node.data = { ...(node.data ?? {}), interventions: built };
    }
  }

  // ── Pass 4: projector-structural topology. See the header's third-class note.
  const optionNodes = nodes.filter((n) => n.kind === "option");
  if (optionNodes.length > 0) {
    // ONE construction site for this class, as the header's mechanism requires —
    // the decision node and its edges share it. The two consumer-required fields
    // are load-bearing on the EDGES (nodes are not validated); carrying them on
    // the node too is honest of a scaffold node and keeps the class to one site.
    const structuralProv: RecordProvenance = {
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

/** The determinism-comparison value: one canonical string per projection. */
export function projectionFingerprint(projection: RecordProjection): string {
  return canonicalSerialise({
    graph: projection.graph,
    provenance: projection.provenance,
    dropped: projection.dropped,
  });
}
