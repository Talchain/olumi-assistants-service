/**
 * ROADMAP 2.972 — ONE derivation of "how did this factor get its value?",
 * read by BOTH the pipeline's self-accounting and the wire's provenance stamp.
 *
 * WHY IT EXISTS. On 2026-08-08 a deployed draft shipped, in a SINGLE payload:
 *
 *   node `fac_nrr`  → { prior: U(0,1), extractionType: "explicit",
 *                       provenance: "from_brief" }        ← no value at all
 *   pipeline trace  → factor_value_coverage { total: 11, explicit: 0, … }
 *
 * Two subsystems in one response disagreeing, one of them lying — the classic
 * hand-maintained mirror (CLAUDE.md trap 12). The mechanism was exact and
 * unremarkable: `factor_value_coverage` read `node.data.extractionType`, while
 * the display stamp read `observed_state.extractionType ?? node.extractionType
 * ?? data.extractionType`. The `unreachable-factors` repair reclassifies a
 * factor to `external`, DELETES `data.value`, and PROMOTES `data.extractionType`
 * to the node — so after repair the counter saw nothing and the stamp saw
 * "explicit", from the same node, about the same fact.
 *
 * THE FIX IS NOT A THIRD READER. It is this module: one `extractionType`
 * precedence, one value predicate, one tier vocabulary — imported by the
 * counter and by the stamp, so the two cannot drift again.
 *
 * ⚠ THE NEW CONJUNCT, named because adding one creates a NEW CONCEPT
 * (CLAUDE.md trap 21): `explicit` now requires A NUMERIC VALUE TO EXIST as
 * well as an `explicit`/`observed` label. A node with no value carries ZERO
 * brief information whatever its label says, so the label cannot be honoured.
 * The tier vocabulary and the two non-explicit rules are unchanged and are
 * transcribed from the producer's own declaration at
 * `cee/unified-pipeline/index.ts` (the comment block above the counter), not
 * from this author's reading of what the field ought to mean (trap 13c).
 */

/** The three-tier vocabulary, unchanged from the pipeline's own declaration. */
export type FactorValueTier = "explicit" | "inferred_with_evidence" | "fallback_default";

/**
 * ⭐ THE EXPLICIT STAMP (2026-08-18, the quantities lane) — why a magic number
 * is not a discriminator.
 *
 * `classifyFactorValueTier` below detects a fabricated baseline by testing
 * `value === 0.5`. That is a VALUE PREDICATE, and CLAUDE.md trap 19 is exactly
 * this: a genuinely user-stated 0.5 satisfies it, and a fabricated default that
 * a later stage nudges off 0.5 escapes it. The pipeline knows the answer at the
 * moment it defaults — it simply threw the fact away and left a downstream
 * reader to guess it back from the magnitude.
 *
 * So the defaulting sites now SAY SO. Three of them stamp this field:
 *   `adapters/llm/normalisation.ts`            (Stage-1 controllable default)
 *   `…/repair/deterministic-sweep.ts`          (controllable + observable nets)
 *
 * ⚠ NOT A NEW VOCABULARY. The value is a member of {@link FactorValueTier},
 * which this module already owned and which the pipeline's own
 * `factor_value_coverage` counter declared. Nothing new is named; a derivation
 * that was being guessed is now recorded.
 *
 * ⚠ WHY THIS FIELD NAME. `ExtractionType` (`schemas/graph.ts:59`) has exactly
 * four members — `explicit | inferred | range | observed` — and no "defaulted"
 * class, so the honest fact cannot be expressed there without a contract
 * change. It rides an additive field on `data` instead, which the graph
 * schemas preserve via `.passthrough()`.
 *
 * ⚠⚠ AND THE LIMIT OF THAT, STATED because the sentence above invites the wrong
 * inference: `.passthrough()` preserves the field across ZOD PARSING, which is
 * NOT the same as reaching the wire. `transformNodeToV3` rebuilds each node
 * field-by-field rather than spreading it, and `value_tier` appears ZERO times
 * in `transforms/schema-v3.ts` (positive control: `extractionType` IS forwarded
 * there, `:371`). **This stamp is pipeline-internal and does not cross the V3
 * boundary today.** That is sufficient for its purpose — stopping the launderer,
 * which runs inside the pipeline — and insufficient for labelling the render,
 * which is named as the remaining work rather than assumed done.
 *
 * The name deliberately contains no
 * `"user"`, `"specified"` or `"manual"` substring: `mapToV3ProvenanceSource`
 * (`transforms/schema-v3.ts:863-877`) coerces ANY stamp containing `"user"` to
 * `user_specified`, which would convert an admission of ignorance into a claim
 * that the user supplied the number.
 */
export const FACTOR_VALUE_TIER_FIELD = "value_tier";

/**
 * Record, at the moment of defaulting, that this value carries no information.
 *
 * Returns a new `data` bag — callers already build one by spread, and mutating
 * a shared node bag in a repair pass is how two stages end up disagreeing.
 */
export function stampFallbackDefault(
  data: Readonly<Record<string, unknown>> | undefined,
): Record<string, unknown> {
  return { ...(data ?? {}), [FACTOR_VALUE_TIER_FIELD]: "fallback_default" };
}

/**
 * Read an explicit tier stamp, in the same precedence order as
 * {@link readFactorValueView} — `observed_state`, then node level (where
 * `unreachable-factors` promotes it when it strips `data`), then `data`.
 */
export function readStampedFactorValueTier(node: unknown): FactorValueTier | undefined {
  const n = bag(node);
  if (!n) return undefined;
  const stamp = firstString(
    bag(n.observed_state)?.[FACTOR_VALUE_TIER_FIELD],
    n[FACTOR_VALUE_TIER_FIELD],
    bag(n.data)?.[FACTOR_VALUE_TIER_FIELD],
  );
  return stamp === "explicit" || stamp === "inferred_with_evidence" || stamp === "fallback_default"
    ? stamp
    : undefined;
}

/**
 * Is this factor's numeric value something the system invented?
 *
 * ⚠⚠ POSITIVE EVIDENCE ONLY — AND THE FIRST VERSION OF THIS FUNCTION GOT THE
 * POLARITY WRONG, WHICH IS WORTH RECORDING BECAUSE THE MISTAKE WAS PLAUSIBLE.
 *
 * It was written fail-closed, as `classifyFactorValueTier(node) ===
 * "fallback_default"`, reasoning that a value we cannot vouch for should be
 * treated exactly like one we know we invented. That reads as the cautious
 * choice. It is not: `classifyFactorValueTier`'s `fallback_default` rung is
 * "everything else", so a factor carrying a perfectly real `{ value: 0.6 }`
 * with NO `extractionType` landed there too — and the caller then refused to
 * narrow a genuine number, replacing real information with an assertion of
 * ignorance we did not have. Five existing tests caught it
 * (`tests/unit/cee.unified-pipeline.deterministic-sweep.test.ts`, values 0.04,
 * 0.6 and a high ratio), and they were right.
 *
 * ⭐ THE SHARED CONTRACT SETTLES IT, and against the first version. From
 * `@talchain/schemas` `ObservedStateSchema.source`, quoted in
 * `graph-readiness/obligation-provenance.ts`:
 *
 *   > Absence means the producer stamped no provenance — a consumer MUST NOT
 *   > read absence as any particular class; classify unknown/absent as neutral,
 *   > never guess.
 *
 * So absence is NEUTRAL, not fabricated. Suppressing on absence is the
 * too-wide-predicate defect (CLAUDE.md trap 22b): a false positive that DROPS
 * information and a false positive that INVENTS a constraint are different
 * harms and cannot share one predicate. The quality bar says the same thing for
 * this exact surface — MARK, never SUPPRESS.
 *
 * Two grounds, both positive, nothing inferred from absence:
 *   1. THE STAMP. A defaulting site said so. Authoritative.
 *   2. THE LEGACY SIGNATURE, for facts persisted before the stamp existed:
 *      the value IS the declared default AND no brief-backed label claims it.
 *      This is the `0.5` heuristic, kept deliberately NARROW — it fires only on
 *      the one magnitude the defaulting sites actually write, never on an
 *      arbitrary unlabelled number.
 */
export function factorValueIsFabricated(node: unknown): boolean {
  // ONE GROUND. A defaulting site recorded that it invented this number.
  // Nothing is inferred, from a label or from a magnitude.
  return readStampedFactorValueTier(node) === "fallback_default";
}

/*
 * ── HOW THIS FUNCTION GOT TO ONE LINE, IN TWO DELETIONS ────────────────────
 *
 * Both rounds REMOVED a rule. That is worth recording, because the estate's own
 * doctrine says a third round on one predicate is usually where an approach
 * needs abandoning rather than patching — and the reason it was safe here is
 * that each round subtracted. An oscillation is sustained by adding conditions;
 * it ends when the conditions come out.
 *
 * DELETED (round 2) — the MAGNITUDE limb, `value === INFERRED_DEFAULT_VALUE`,
 * kept as a "legacy signature" for pre-stamp facts. Measured: `{0.5, inferred}`
 * destroyed, `0.51` survived, everything else equal — so the discriminator WAS
 * the magic number for anything labelled `inferred` or `range`. Trap 19 alive
 * inside the fix written for trap 19, one line below this module's own quotation
 * of the contract rule forbidding it.
 *
 * DELETED (round 3) — the BRIEF-BACKED SHORT-CIRCUIT, `if (extractionType is
 * explicit|observed) return false`. It was added to protect the containment
 * invariant, and it did protect it — but so did the structural guard added in
 * the same change, and the short-circuit was the sole cause of a live hole:
 *
 *   `normalisation.ts:987` preserves an LLM-supplied `extractionType`
 *   (`existingType ?? 'inferred'`), and `fixControllableMissingData` only
 *   defaults it when undefined. So a factor the model labelled `explicit` while
 *   supplying NO VALUE receives a stamped invented `0.5` AND keeps the
 *   brief-backed label — and the short-circuit let the label beat the stamp.
 *   It laundered exactly as before. THREE nodes in the committed cold-read
 *   corpus are in that class, including `fac_nrr`, the very node this module's
 *   header cites as the deployed 2026-08-08 defect.
 *
 * ⭐ AND THE PRECISE SHAPE OF THE MISTAKE, because it is this estate's chronic
 * one: `classifyFactorValueTier` (above) says an `explicit` label with NO VALUE
 * cannot be honoured. `factorValueIsFabricated` honoured it — because by the
 * time it runs, a defaulting site upstream has already supplied a value and
 * thereby ERASED the condition that disqualified the label. Two authorities
 * answering different questions under similar names, one reading state the
 * other had already mutated. CLAUDE.md trap 21, inside the fix.
 *
 * WHY CONTAINMENT DID NOT NEED THE SHORT-CIRCUIT. The guard at the collapse site
 * (`unreachable-factors.ts`) refuses to collapse a baseline that `[0,1]` cannot
 * contain. That is STRUCTURAL — `[0,1]` contains every value in `[0,1]` by
 * definition — so it cannot fail the way a tuned rule can. Verified: with the
 * short-circuit deleted, `{1.12, explicit, stamped}` still narrows to
 * [0.56, 1.68], and every containment test still passes.
 *
 * THE ONE RESIDUAL COST, and why it is unreachable: a STALE stamp landing on a
 * value that later becomes real. `value_tier` occurs ZERO times in the V3
 * transform (`src/cee/transforms/schema-v3.ts`; contrast control:
 * `extractionType` occurs 24 times and IS forwarded at `:371`), the persisted
 * graph is `GraphV3T`, and the V3 transform runs BEFORE the persist site. So no
 * stamp survives a turn, and a stale one cannot exist.
 */

import type { z } from "zod";

import type { ExtractionType } from "../../schemas/graph.js";

/** `ExtractionType` (`schemas/graph.ts:59`), derived — never re-typed here. */
type ExtractionTypeLiteral = z.infer<typeof ExtractionType>;

/**
 * The value that a `fallback_default` inference lands on. Declared by the
 * counter's own comment: "inferred with default 0.5".
 */
const INFERRED_DEFAULT_VALUE = 0.5;

/**
 * Which `ExtractionType` label asserts the value came from the brief or the
 * environment — DERIVED from the contract enum (`schemas/graph.ts:59`), one
 * entry per member.
 *
 * ⭐ WHY A RECORD AND NOT JUST A RETYPED SET. The membership list used to be a
 * bare `ReadonlySet<string>` literal, so a fifth `ExtractionType` member would
 * have been classified `fallback_default` by omission, silently. Retyping the
 * SET does not fix that: `ReadonlySet<X>` is NOT exhaustive — a two-member set
 * satisfies it however many members `X` has, the same defect
 * `system-events/dispatch.ts` records for its own kind list. A `Record` over the
 * union IS exhaustive, so adding a member now fails `tsc` HERE and the author
 * has to decide which side it falls on.
 *
 * ⚠ Deliberately NOT merged with `graph-readiness/obligation-provenance.ts`'s
 * partition of the same enum. That one answers *"whose structure is this, for
 * the obligation rule?"*; this one answers *"may this factor's badge read
 * `from_brief`?"*. Two questions under similar names is exactly the pair
 * CLAUDE.md trap 21 says to keep apart — cross-named at both ends so a future
 * divergence is a choice rather than an accident.
 */
const BRIEF_BACKED_BY_EXTRACTION_TYPE: Readonly<Record<ExtractionTypeLiteral, boolean>> = {
  explicit: true,
  observed: true,
  inferred: false,
  range: false,
};

/**
 * The runtime membership test. Widened to `ReadonlySet<string>` ON PURPOSE at
 * this one seam: the stamp reaching `classifyFactorValueTier` is an
 * UNVALIDATED wire string, so narrowing here would only move the cast. The
 * MEMBERSHIP is derived above; only the lookup type is wide.
 */
const BRIEF_BACKED_EXTRACTION_TYPES: ReadonlySet<string> = new Set(
  Object.entries(BRIEF_BACKED_BY_EXTRACTION_TYPE)
    .filter(([, briefBacked]) => briefBacked)
    .map(([label]) => label),
);

interface Bag {
  readonly [key: string]: unknown;
}

function bag(value: unknown): Bag | undefined {
  return typeof value === "object" && value !== null ? (value as Bag) : undefined;
}

function firstString(...candidates: readonly unknown[]): string | undefined {
  for (const c of candidates) if (typeof c === "string") return c;
  return undefined;
}

function firstNumber(...candidates: readonly unknown[]): number | undefined {
  for (const c of candidates) if (typeof c === "number" && Number.isFinite(c)) return c;
  return undefined;
}

/**
 * The three places an `extractionType` / value can legitimately sit on a
 * factor node at some point in the pipeline, in ONE precedence order:
 *
 *   1. `observed_state` — post-V3-transform factors that carry a value
 *   2. node level       — promoted by `unreachable-factors` when it strips `data`
 *   3. `data`           — the LLM's own pre-transform shape
 *
 * This is the display stamp's existing order (`schema-v3.ts`), adopted as the
 * shared one so nothing changes for the surface that was already right.
 */
export interface FactorValueView {
  readonly extractionType?: string;
  readonly value?: number;
}

/** Read a factor node's value view. Accepts any node-ish object; never throws. */
export function readFactorValueView(node: unknown): FactorValueView {
  const n = bag(node);
  if (!n) return {};
  const observed = bag(n.observed_state);
  const data = bag(n.data);
  const extractionType = firstString(observed?.extractionType, n.extractionType, data?.extractionType);
  const value = firstNumber(observed?.value, data?.value);
  return {
    ...(extractionType !== undefined && { extractionType }),
    ...(value !== undefined && { value }),
  };
}

/**
 * Does this factor carry a numeric value at all?
 *
 * This is the predicate the whole row turns on: no value ⇒ no brief
 * information ⇒ no `explicit` / `from_brief` claim is available to make,
 * whatever label the draft attached.
 */
export function factorHasExtractedValue(node: unknown): boolean {
  return readFactorValueView(node).value !== undefined;
}

/**
 * Classify a factor into the pipeline's three tiers.
 *
 * Transcribed from `factor_value_coverage`'s own declaration, with the value
 * conjunct added to the `explicit` rung:
 *   explicit               — label is explicit/observed AND a value exists
 *   inferred_with_evidence — label is inferred, value exists and is not 0.5
 *   fallback_default       — everything else
 */
export function classifyFactorValueTier(node: unknown): FactorValueTier {
  const { extractionType, value } = readFactorValueView(node);
  if (extractionType !== undefined && BRIEF_BACKED_EXTRACTION_TYPES.has(extractionType)) {
    return value !== undefined ? "explicit" : "fallback_default";
  }
  if (extractionType === "inferred" && value !== undefined && value !== INFERRED_DEFAULT_VALUE) {
    return "inferred_with_evidence";
  }
  return "fallback_default";
}

/**
 * May this factor's UI provenance read `from_brief`?
 *
 * True exactly when the tier is `explicit` — so the badge a user sees and the
 * number the pipeline reports about itself are the same derivation, by
 * construction rather than by anyone remembering to keep them aligned.
 */
export function mayClaimFromBrief(node: unknown): boolean {
  return classifyFactorValueTier(node) === "explicit";
}
