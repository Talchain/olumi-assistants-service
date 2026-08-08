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
 * The value that a `fallback_default` inference lands on. Declared by the
 * counter's own comment: "inferred with default 0.5".
 */
const INFERRED_DEFAULT_VALUE = 0.5;

/** The labels that assert the value came from the brief or the environment. */
const BRIEF_BACKED_EXTRACTION_TYPES: ReadonlySet<string> = new Set(["explicit", "observed"]);

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
