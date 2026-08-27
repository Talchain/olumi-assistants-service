/**
 * Display-safe graph projection for the LLM-facing context pack.
 *
 * Originally introduced as brief-display-safe-graph A2.1 (strip raw
 * edge floats / exists / model-internal node fields; preserve user-
 * supplied `value`). Tightened by V5 D1 golden-path closure (A3.1
 * Task 6) to also strip node-level `value`, `raw_value`, and `cap`:
 * exposing any node numeric encouraged Sonnet to echo it as
 * structural fact ("the model sets X to 5") and reuse it as a
 * coefficient in narration. Reintroduced by A2.2 with a single
 * formatted field `display_value` ("5%", "£50k", "18 months") so
 * Sonnet can answer "what is the current churn rate?" without
 * seeing the underlying floats — the raw `value` / `raw_value` /
 * `cap` remain stripped. Sonnet now sees label, kind, category, unit
 * (label only), `display_value` (formatted string only), relationship
 * language, and the compactor's closed coefficient-confidence band — no raw
 * node numerics, no edge `strength` / `std` floats, no `exists` probabilities.
 *
 * Design principle: raw model values stay in structured state for
 * handlers, telemetry, freshness hashing, and edit_graph dispatch;
 * the LLM-facing context pack uses decision-language projections
 * only.
 *
 * Operates strictly downstream of `compactGraphForContextPack()` and
 * `projectCompactGraph()`. The raw `ContextPack.graph` is preserved
 * for handler-side reads (edit_graph dispatch reads from raw
 * boundary graph state via a wholly separate path; freshness hashing
 * and telemetry continue to read raw `ContextPack.graph`).
 *
 * Pure function. No side effects. Idempotent on its own output
 * (re-running produces an equivalent shape — `relationship` strings
 * carry no decimals to re-classify; nodes have nothing numeric to
 * re-strip).
 */

import { synthesiseDisplayValue } from '../../cee/factor-extraction/display-value.js';
import {
  boundNodeDescriptionForContext,
  projectUncertaintyDriversForContext,
  type CompactCoefficientConfidence,
  type CompactProvenance,
  type CompactUncertaintyDriversDisclosure,
} from '../../orchestrator/context/graph-compact.js';
import type { ContextPackGraph } from '../context/context-pack-assembler.js';
import { bandFromMagnitude, NEAR_ZERO_INFLUENCE_THRESHOLD } from './influence-bands.js';

export interface DisplaySafeNode {
  readonly id: string;
  readonly label: string;
  readonly kind: string;
  /** Producer-attested status-quo identity (option nodes only). */
  readonly is_baseline?: true;
  /** Saved Living Model detail, bounded without local interpretation. */
  readonly description?: string;
  readonly category?: string;
  readonly unit?: string;
  readonly intervention_summary?: string;
  /** Exact producer text, bounded upstream without local interpretation. */
  readonly uncertainty_drivers?: readonly string[];
  /** Truthful notice when source text was bounded or had to be withheld. */
  readonly uncertainty_drivers_disclosure?: CompactUncertaintyDriversDisclosure;
  /**
   * Pre-formatted user-facing quantity string ("5%", "£50,000",
   * "18 months"). Reintroduced in A2.2 because A3.1's full
   * value-strip left Sonnet unable to answer "what is the current
   * churn rate?" — the LLM had labels but no numeric data at all.
   * `display_value` carries the formatted string only; the
   * underlying `value` / `raw_value` / `cap` floats remain stripped
   * (A3.1 contract preserved). The raw `ContextPack.graph` still
   * carries the floats for handlers / freshness / edit_graph
   * dispatch; Sonnet never sees them.
   *
   * Source priority: existing `display_value` on the raw input
   * (set by `set_factor_value` post-mutation, A3.1 Task 3) is
   * preferred verbatim. When absent, the projector calls
   * `synthesiseDisplayValue` from `cee/factor-extraction/display-
   * value.ts` against value/raw_value/unit/factor_type/cap. A
   * bare-number guard discards unit-less numeric results ("0.05",
   * "0.75", "1", "50,000") so the projection cannot leak the
   * model-scale value through the display channel.
   */
  readonly display_value?: string;
  /**
   * Option nodes only: the elements this option leads to by a directed route
   * in the model as drawn, in the user's own label vocabulary.
   *
   * Derived by the compactor from the shared reachability kernel — see
   * `buildOptionReachability` in `orchestrator/context/graph-compact.ts` for the
   * witnessed defect it closes and, in particular, for why it is NOT gated on
   * `exists_probability`. It is a STRUCTURAL claim only: it carries no strength,
   * no sign and no certainty.
   */
  readonly reaches?: readonly string[];
}

export interface DisplaySafeEdge {
  readonly from: string;
  readonly to: string;
  readonly from_label: string;
  readonly to_label: string;
  /**
   * Decision-language phrase. Which FAMILY of phrase is emitted is decided by
   * `edge_type`, and the two families are not interchangeable:
   *
   *   directed   (`edge_type` absent)      "moderate positive link",
   *                                        "very strong negative link",
   *                                        "negligible link" for |strength| < 0.05
   *   bidirected (`edge_type: 'bidirected'`)
   *                                        "moderate positive co-movement,
   *                                         unmeasured common cause (not a causal route)"
   *
   * A bidirected edge MUST NOT be described with directed-route language. This
   * field previously enumerated the directed family only, while `edge_type`
   * below documented bidirected edges as "not a directed path" — two
   * contradictory statements about one edge, and the projector implemented the
   * first: `relationshipPhrase` composed the phrase from the SIGNED STRENGTH
   * ALONE and never read `edge_type`. On deployed staging that produced a false
   * causal claim 3/3 runs on a bidirected bridge ("brand sentiment score has a
   * direct link into quarterly profit. So the pathway to your goal runs through
   * brand perception") while the model held `edge_type: "bidirected"`. The model
   * echoed the string it was handed; the string was the lie. Both families are
   * now documented here and both are allowlisted, per family.
   */
  readonly relationship: string;
  /** Compactor-classified coefficient confidence; no raw std reaches the prompt. */
  readonly coefficient_confidence?: CompactCoefficientConfidence;
  readonly provenance?: CompactProvenance;
  /**
   * Emitted ONLY for `'bidirected'`. Without it the model-facing edge list shows
   * a bidirected edge as an ordinary link while the option's `reaches` set
   * correctly omits it — two contradictory Zone 2 facts with no datum to
   * reconcile them, in the same false-negative direction as the witnessed
   * defect. A bidirected edge is an unmeasured common cause, not a directed
   * path; carrying the type lets the model see WHY it is not a route instead of
   * inferring that the reachable set is wrong.
   */
  readonly edge_type?: 'bidirected';
}

export interface DisplaySafeOption {
  readonly id: string;
  readonly label: string;
}

export interface DisplaySafeGraph {
  readonly nodes: readonly DisplaySafeNode[];
  readonly edges: readonly DisplaySafeEdge[];
  /** Display-only duplicate index. Baseline identity lives on option nodes. */
  readonly options: readonly DisplaySafeOption[];
  /**
   * Goal nodes, projected through the SAME `projectNode` as `nodes` — not the
   * raw `ContextPackGraph.goals` passthrough this field used to carry.
   *
   * `ContextPackGraph.goals` is a by-kind INDEX of `ContextPackGraph.nodes`
   * (both constructors — `projectCompactGraph` and `projectGraph` — derive it
   * by filtering the same node array), so every entry here is also in `nodes`.
   * Passing it through unprojected therefore did not add information: it
   * duplicated each goal in raw form and defeated the raw-value strip that
   * `DisplaySafeNode` exists to enforce. Measured on the production path, one
   * goal reached Sonnet as BOTH `{unit, display_value: "42%"}` (via `nodes`)
   * and `{value: 0.42, raw_value: 42, cap: 100}` (via `goals`).
   *
   * Typed as `DisplaySafeNode[]` rather than `unknown[]` so the guarantee is
   * checked by the compiler, not just by the test suite.
   */
  readonly goals: readonly DisplaySafeNode[];
  readonly constraints: readonly unknown[];
  readonly counts: ContextPackGraph['counts'];
}

/**
 * Shape of a raw input node consulted by `projectNode`. The
 * projection emits `id`, `label`, `kind`, bounded saved `description`, `category`, `unit`,
 * `intervention_summary`, and `display_value` (A2.2). Numeric
 * fields (`value`, `raw_value`, `cap`) are READ here so
 * `synthesiseDisplayValue` can format them when an existing
 * `display_value` is absent — but they are NEVER projected onto
 * `DisplaySafeNode`. Sonnet sees the formatted string, never the
 * raw float (A3.1 Task 6 contract).
 *
 * `observed_state` is the canonical GraphV3T nesting; the
 * extractors read both compact-top-level and `observed_state.*`
 * shapes for value / raw_value / unit / cap / factor_type.
 */
interface RawNodeShape {
  readonly id?: unknown;
  readonly label?: unknown;
  readonly kind?: unknown;
  readonly is_baseline?: unknown;
  readonly description?: unknown;
  readonly category?: unknown;
  readonly unit?: unknown;
  readonly intervention_summary?: unknown;
  /** Compactor-derived structural reachable set (option nodes only): node ids
   *  on the first pass, already-resolved labels on an idempotent re-projection. */
  readonly reaches?: unknown;
  readonly uncertainty_drivers?: unknown;
  readonly uncertainty_drivers_disclosure?: unknown;
  /**
   * A3.1 Task 3 sets this on the raw graph after a
   * `set_factor_value` mutation via `synthesiseDisplayValue`.
   * `projectNode` prefers it verbatim when present; otherwise it
   * synthesises from value/raw_value/unit/cap/factor_type below.
   */
  readonly display_value?: unknown;
  /** Compact top-level user-unit value (numeric or string). */
  readonly value?: unknown;
  /** Compact top-level raw user-supplied number (e.g. 50000 for £50k). */
  readonly raw_value?: unknown;
  /** Normalisation cap (e.g. 100 for percentage, 100000 for currency). */
  readonly cap?: unknown;
  /** Factor type classification consumed by `synthesiseDisplayValue`. */
  readonly factor_type?: unknown;
  /**
   * Canonical GraphV3T nesting. Both `unit` and the numeric
   * fields (`value`, `raw_value`, `cap`, `factor_type`) may be
   * inside this wrapper. The extractors read top-level first and
   * fall back here.
   */
  readonly observed_state?: unknown;
}

interface RawEdgeShape {
  readonly from?: unknown;
  readonly to?: unknown;
  /** Two shapes accepted on this field:
   *    - compact: numeric signed mean
   *    - canonical GraphV3T: `{ mean, std }` object (sign carried separately
   *      via `effect_direction`) */
  readonly strength?: unknown;
  /** Legacy / `editCompactGraph`-like form: a top-level numeric mean.
   *  Sign carried separately via `effect_direction` when present. */
  readonly strength_mean?: unknown;
  /** Optional sign override for the canonical and legacy shapes (their
   *  numeric magnitudes are non-negative). Ignored when the compact
   *  numeric `strength` is already signed. */
  readonly effect_direction?: unknown;
  /** Non-default edge type from compactGraph; only 'bidirected' is emitted. */
  readonly edge_type?: unknown;
  /** Closed compactor band emitted by compactGraph; raw std remains stripped. */
  readonly coefficient_confidence?: unknown;
  readonly provenance?: unknown;
  /** Idempotency: a second pass through the formatter sees no `strength`
   *  but should preserve an existing allowlisted relationship phrase. */
  readonly relationship?: unknown;
}

interface RawOptionShape {
  readonly id?: unknown;
  readonly label?: unknown;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asProvenance(value: unknown): CompactProvenance | undefined {
  return value === 'from_brief' || value === 'ai_inferred' || value === 'user_set'
    ? value
    : undefined;
}

function asCoefficientConfidence(
  value: unknown,
): CompactCoefficientConfidence | undefined {
  return value === 'high' || value === 'moderate' || value === 'uncertain'
    ? value
    : undefined;
}

/**
 * The qualifier every bidirected phrase carries.
 *
 * Wording is the RATIFIED in-repo vocabulary, not a newly minted predicate:
 * `src/prompts/defaults-v19.ts:76` and `Prompts/canonical/draft_graph.txt:213`
 * both define a bidirected edge as an *unmeasured common cause*. Both live
 * there as prose INSIDE a prompt template literal, so there is no symbol to
 * import into a pure display projector; the wording is reused verbatim so the
 * model-facing string and the drafting instruction cannot drift apart.
 */
const BIDIRECTED_COMMON_CAUSE_QUALIFIER = 'unmeasured common cause (not a causal route)';

const NEGLIGIBLE_DIRECTED_PHRASE = 'negligible link';
const NEGLIGIBLE_BIDIRECTED_PHRASE = `negligible co-movement, ${BIDIRECTED_COMMON_CAUSE_QUALIFIER}`;

/**
 * Allowlist of phrases the formatter is permitted to emit on
 * `DisplaySafeEdge.relationship` for a DIRECTED edge. Pre-built once: every
 * band × sign plus the near-zero suppression phrase. Anything outside this set
 * is treated as an unsafe upstream string and dropped (defaults to "negligible
 * link" via the projectEdge fallback) — important when re-projecting an edge
 * carrying an unrecognised legacy `relationship` such as `"strength of 0.55"`,
 * which would otherwise leak verbatim.
 */
const DIRECTED_RELATIONSHIP_PHRASES: ReadonlySet<string> = new Set([
  NEGLIGIBLE_DIRECTED_PHRASE,
  'weak positive link',
  'weak negative link',
  'moderate positive link',
  'moderate negative link',
  'strong positive link',
  'strong negative link',
  'very strong positive link',
  'very strong negative link',
]);

/**
 * The same allowlist for a BIDIRECTED edge — same bands, same signs, different
 * predicate. It exists for two reasons, and the second is not optional:
 *
 *  1. Re-projection carries no numeric strength (`resolveSignedStrength`
 *     returns null on a display-safe edge), so the phrase can ONLY survive a
 *     second pass by being allowlisted. Measured: with the bidirected phrases
 *     missing from any allowlist, pass 1 emits the correct phrase and pass 2
 *     rewrites it to "negligible link" while `edge_type: "bidirected"`
 *     survives — a false SMALLNESS claim about a user-set 0.5, under a fully
 *     green suite. Pinned by IDEMPOTENT_REPROJECTION_PRESERVES_BIDIRECTED_PHRASE
 *     and, across the whole band space, by
 *     ALL_BIDIRECTED_BAND_PHRASES_SURVIVE_REPROJECTION.
 *  2. The allowlists are kept SEPARATE, not unioned, so the check is
 *     type-aware. A single union would let a bidirected edge re-project while
 *     carrying a directed "…link" phrase — re-admitting the exact false causal
 *     claim this projector was changed to remove — and would make the
 *     unrecognised-string fallback emit directed language ("negligible link")
 *     on a bidirected edge.
 */
const BIDIRECTED_RELATIONSHIP_PHRASES: ReadonlySet<string> = new Set([
  NEGLIGIBLE_BIDIRECTED_PHRASE,
  `weak positive co-movement, ${BIDIRECTED_COMMON_CAUSE_QUALIFIER}`,
  `weak negative co-movement, ${BIDIRECTED_COMMON_CAUSE_QUALIFIER}`,
  `moderate positive co-movement, ${BIDIRECTED_COMMON_CAUSE_QUALIFIER}`,
  `moderate negative co-movement, ${BIDIRECTED_COMMON_CAUSE_QUALIFIER}`,
  `strong positive co-movement, ${BIDIRECTED_COMMON_CAUSE_QUALIFIER}`,
  `strong negative co-movement, ${BIDIRECTED_COMMON_CAUSE_QUALIFIER}`,
  `very strong positive co-movement, ${BIDIRECTED_COMMON_CAUSE_QUALIFIER}`,
  `very strong negative co-movement, ${BIDIRECTED_COMMON_CAUSE_QUALIFIER}`,
]);

function asAllowedRelationship(value: unknown, isBidirected: boolean): string | undefined {
  const allowed = isBidirected ? BIDIRECTED_RELATIONSHIP_PHRASES : DIRECTED_RELATIONSHIP_PHRASES;
  return typeof value === 'string' && allowed.has(value) ? value : undefined;
}

/**
 * Extract the user-supplied node `unit` (label only) from the compact
 * top-level field first, falling back to the canonical
 * `observed_state.unit` nesting. The unit string is the only piece of
 * `observed_state` that survives into the display projection — the
 * inner numeric fields (`value`, `raw_value`, `cap`) are stripped per
 * A3.1 Task 6 because exposing them encouraged Sonnet to echo node
 * numerics as structural fact.
 */
function extractNodeUnit(raw: RawNodeShape): string | undefined {
  const top = asString(raw.unit);
  if (top !== undefined) return top;
  const observed = raw.observed_state;
  if (typeof observed === 'object' && observed !== null && 'unit' in observed) {
    const inner = (observed as { unit?: unknown }).unit;
    if (typeof inner === 'string') return inner;
  }
  return undefined;
}

/**
 * Convert a signed edge strength into the user-visible relationship phrase.
 *
 *   0.95  → "very strong positive link"
 *   0.70  → "strong positive link"
 *   0.65  → "moderate positive link"
 *  -0.25  → "weak negative link"
 *   0.02  → "negligible link"            (sign suppressed below NEAR_ZERO_INFLUENCE_THRESHOLD)
 */
export function relationshipPhrase(signedStrength: number): string {
  if (!Number.isFinite(signedStrength)) return NEGLIGIBLE_DIRECTED_PHRASE;
  const abs = Math.abs(signedStrength);
  if (abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return NEGLIGIBLE_DIRECTED_PHRASE;
  const band = bandFromMagnitude(abs);
  const sign = signedStrength < 0 ? 'negative' : 'positive';
  return `${band} ${sign} link`;
}

/**
 * The bidirected twin of `relationshipPhrase`.
 *
 * A bidirected edge denotes CONFOUNDING — an unmeasured common cause — and
 * explicitly NOT a directed causal effect. `relationshipPhrase` derives its
 * phrase from the signed strength alone, so it describes every edge as a
 * causal "link"; handing that string to the model on a bidirected edge is what
 * produced the witnessed false causal claim. This function keeps the SAME band
 * and the SAME sign — a user-set 0.5 is still "moderate positive", because
 * discarding the magnitude would trade a false causal claim for a false
 * smallness claim, the opposite-direction harm — and carries the correction in
 * the predicate instead:
 *
 *   0.50 → "moderate positive co-movement, unmeasured common cause (not a causal route)"
 *  -0.85 → "strong negative co-movement, unmeasured common cause (not a causal route)"
 *   0.02 → "negligible co-movement, unmeasured common cause (not a causal route)"
 *
 * Bands and the near-zero threshold come from the shared `influence-bands`
 * module — the same source as the directed path — so the two families can
 * never disagree about where a band boundary sits.
 */
export function bidirectedRelationshipPhrase(signedStrength: number): string {
  if (!Number.isFinite(signedStrength)) return NEGLIGIBLE_BIDIRECTED_PHRASE;
  const abs = Math.abs(signedStrength);
  if (abs < NEAR_ZERO_INFLUENCE_THRESHOLD) return NEGLIGIBLE_BIDIRECTED_PHRASE;
  const band = bandFromMagnitude(abs);
  const sign = signedStrength < 0 ? 'negative' : 'positive';
  return `${band} ${sign} co-movement, ${BIDIRECTED_COMMON_CAUSE_QUALIFIER}`;
}

/**
 * Read a compact-top-level OR canonical `observed_state.*` numeric
 * field. Returns `undefined` when neither shape carries a finite
 * number. Mirror of `extractNodeUnit`'s two-tier pattern.
 */
function extractNodeNumeric(
  raw: RawNodeShape,
  field: 'value' | 'raw_value' | 'cap',
): number | undefined {
  const top = (raw as Record<string, unknown>)[field];
  if (typeof top === 'number' && Number.isFinite(top)) return top;
  const observed = raw.observed_state;
  if (typeof observed === 'object' && observed !== null && field in observed) {
    const inner = (observed as Record<string, unknown>)[field];
    if (typeof inner === 'number' && Number.isFinite(inner)) return inner;
  }
  return undefined;
}

function extractNodeFactorType(raw: RawNodeShape): string | undefined {
  const top = asString(raw.factor_type);
  if (top !== undefined) return top;
  const observed = raw.observed_state;
  if (typeof observed === 'object' && observed !== null && 'factor_type' in observed) {
    const inner = (observed as { factor_type?: unknown }).factor_type;
    if (typeof inner === 'string') return inner;
  }
  return undefined;
}

/**
 * Bare-number guard for the display channel. `synthesiseDisplayValue`
 * is generally safe — it formats with units and bands — but on a
 * factor with no unit / cap / factor_type it can fall through to the
 * raw normalised number as a string. That includes bare decimals
 * ("0.05", "0.75", "-0.5"), bare integers ("0", "1", "7" — emitted
 * via `parseFloat(n.toFixed(2))` for normalised values that round to
 * whole numbers), and thousands-separated bare numbers ("1,000",
 * "50,000" from `formatPlainNumber` priority-4 with no unit). Each
 * is exactly the model-scale leakage A3.1 Task 6 stripped at the
 * raw-numeric layer; allowing any of them through would defeat the
 * point of the display-safe projection.
 *
 * Allow legitimate formats: "5%", "£50,000", "18 months", "4.2/5",
 * "Low (0.15)", "Very high (1)" — anything that has a unit symbol,
 * currency prefix, suffix word, ratio, qualitative band wrapper, or
 * any non-numeric character. The regex matches strings composed
 * exclusively of an optional sign, digits, commas (thousands
 * separators), and an optional fractional part.
 *
 * EXPORTED (2026-07-31, ROADMAP 2.205 practical resolution): the flip-point
 * display licence in `./format-analysis-for-context.ts` applies the SAME
 * predicate to the flip display strings it admits. Shared rather than copied —
 * a second hand-kept copy of a safety rule is the dominant defect class
 * (CLAUDE.md trap 12), and these are the two display projections that face the
 * same prompt with the same float cage.
 */
export function looksLikeRawDecimal(value: string): boolean {
  return /^-?[\d,]+(?:\.\d+)?$/.test(value);
}

function projectNode(
  raw: RawNodeShape,
  labelMap: ReadonlyMap<string, string>,
): DisplaySafeNode | null {
  const id = asString(raw.id);
  const label = asString(raw.label);
  const kind = asString(raw.kind);
  if (id === undefined || label === undefined || kind === undefined) return null;
  const node: {
    id: string;
    label: string;
    kind: string;
    is_baseline?: true;
    description?: string;
    category?: string;
    unit?: string;
    intervention_summary?: string;
    uncertainty_drivers?: readonly string[];
    uncertainty_drivers_disclosure?: CompactUncertaintyDriversDisclosure;
    display_value?: string;
    reaches?: readonly string[];
  } = { id, label, kind };
  // One narrow authority: only a literal producer field on an option can
  // identify the saved current approach. Labels such as "status quo" are not
  // reclassified here, malformed values are ignored, and false is omitted.
  if (kind === 'option' && raw.is_baseline === true) node.is_baseline = true;
  const description = boundNodeDescriptionForContext(raw.description);
  if (description !== undefined) node.description = description;
  const category = asString(raw.category);
  if (category !== undefined) node.category = category;
  const unit = extractNodeUnit(raw);
  if (unit !== undefined) node.unit = unit;
  const interventionSummary = asString(raw.intervention_summary);
  if (interventionSummary !== undefined) node.intervention_summary = interventionSummary;

  // Structural reachability, resolved into the user's own vocabulary.
  //
  // ⚠ AN UNRESOLVABLE ENTRY FALLS BACK TO ITS OWN STRING RATHER THAN BEING
  // DROPPED. A silently-shortened reachable set reads to the model as a genuine
  // non-reachability, which is precisely the false claim this projection exists
  // to remove — so the set may become less pretty, never shorter. (The same
  // fallback makes re-projection idempotent: on a second pass the entries are
  // already labels and resolve to themselves.)
  //
  // A malformed `reaches` is omitted rather than coerced: the producer is the
  // compactor, and a non-array here means the field did not come from it.
  if (Array.isArray(raw.reaches) && raw.reaches.every((entry) => typeof entry === 'string')) {
    node.reaches = (raw.reaches as readonly string[]).map(
      (entry) => labelMap.get(entry) ?? entry,
    );
  }

  // Producer-owned uncertainty only: the shared projector preserves exact
  // strings/order within its bounds and refuses conflicting permitted source
  // locations. The formatter neither ranks nor interprets it.
  if (kind === 'factor') {
    const uncertaintyProjection = projectUncertaintyDriversForContext(raw);
    if (uncertaintyProjection.uncertainty_drivers !== undefined) {
      node.uncertainty_drivers = uncertaintyProjection.uncertainty_drivers;
    }
    if (uncertaintyProjection.uncertainty_drivers_disclosure !== undefined) {
      node.uncertainty_drivers_disclosure =
        uncertaintyProjection.uncertainty_drivers_disclosure;
    }
  }

  // V5 A2.2 — display_value re-introduction.
  //
  // Source priority:
  //   1. Existing `display_value` on the raw input. Set by
  //      `set_factor_value` post-mutation (A3.1 Task 3) using the
  //      same `synthesiseDisplayValue` formatter. Use it verbatim
  //      so handler-set values survive without recomputation.
  //   2. Synthesise from value / raw_value / unit / cap /
  //      factor_type via the canonical formatter.
  //
  // After either source, the bare-number guard discards unit-less
  // numeric strings ("0.05", "1", "50,000") so a unit-less factor
  // cannot leak the underlying float through the display channel.
  //
  // Raw `value` / `raw_value` / `cap` remain stripped from the
  // projection (A3.1 Task 6 contract); only the formatted string
  // reaches Sonnet.
  const existing = asString(raw.display_value);
  let displayCandidate: string | undefined;
  if (existing !== undefined && existing.length > 0) {
    displayCandidate = existing;
  } else {
    const value = extractNodeNumeric(raw, 'value');
    const rawValue = extractNodeNumeric(raw, 'raw_value');
    const cap = extractNodeNumeric(raw, 'cap');
    const factorType = extractNodeFactorType(raw);
    const synthesised = synthesiseDisplayValue({
      ...(value !== undefined ? { value } : {}),
      ...(rawValue !== undefined ? { raw_value: rawValue } : {}),
      ...(unit !== undefined ? { unit } : {}),
      ...(factorType !== undefined ? { factor_type: factorType } : {}),
      ...(cap !== undefined ? { cap } : {}),
    });
    if (synthesised !== undefined && synthesised.length > 0) {
      displayCandidate = synthesised;
    }
  }
  if (displayCandidate !== undefined && !looksLikeRawDecimal(displayCandidate)) {
    node.display_value = displayCandidate;
  }
  return node;
}

/**
 * Resolve the signed edge strength across all canonical and legacy shapes
 * that can reach `ContextPack.graph`:
 *
 *   - compact (`compactGraph`)         → `strength: number`
 *   - canonical GraphV3T               → `strength: { mean: number }` (+ optional `effect_direction`)
 *   - legacy / `editCompactGraph`-like → top-level `strength_mean: number` (+ optional `effect_direction`)
 *
 * Returns `null` when no usable strength is found, signalling the caller
 * to either preserve an existing relationship (idempotent re-projection)
 * or omit the relationship rather than emit a misleading "negligible link".
 */
function resolveSignedStrength(raw: RawEdgeShape): number | null {
  if (typeof raw.strength === 'number' && Number.isFinite(raw.strength)) {
    return raw.strength;
  }
  let magnitude: number | null = null;
  if (
    typeof raw.strength === 'object'
    && raw.strength !== null
    && 'mean' in raw.strength
    && typeof (raw.strength as { mean?: unknown }).mean === 'number'
  ) {
    const mean = (raw.strength as { mean: number }).mean;
    if (Number.isFinite(mean)) magnitude = mean;
  } else if (typeof raw.strength_mean === 'number' && Number.isFinite(raw.strength_mean)) {
    magnitude = raw.strength_mean;
  }
  if (magnitude === null) return null;
  // Apply effect_direction sign override only when supplied AND the magnitude
  // is non-negative.
  //
  // ⚠⚠ THE JUSTIFICATION THAT USED TO SIT HERE WAS FALSE, AND IT NEARLY COST A
  // LANE A DAY. It read: "canonical GraphV3T emits non-negative means with sign
  // carried separately". **It does not.** `EdgeStrengthV3.mean` is declared
  // "Signed linear coefficient [-1, +1]" (`schemas/cee-v3.ts`), `schemas/graph.ts`
  // says "sign indicates direction", `deriveEffectDirection(mean) = mean >= 0`
  // makes `effect_direction` a DERIVED RESTATEMENT of that sign, and the draft
  // prompts instruct the model to the same rule.
  //
  // Why the correction is recorded rather than just made: a lane investigating a
  // witnessed SIGN INVERSION in deployed narration read this comment, saw that
  // `compactGraph` drops `effect_direction`, and concluded it had found a
  // structural sign-loss seam on the production path. It had not — the compact
  // numeric IS the signed mean, so the first branch above is correct and nothing
  // is lost. The real cause lay elsewhere (the model composing signs along a
  // PATH it had no derived reachability for). A comment that sends the next
  // reader hunting a data-loss defect that does not exist is a live hazard, so
  // the false sentence is removed and its refutation left in its place.
  //
  // The branch itself STAYS: legacy / `editCompactGraph`-like shapes may emit a
  // non-negative `strength_mean` alongside an explicit `effect_direction`, and
  // it costs nothing to honour that. It is a compatibility path, not the
  // canonical contract.
  if (raw.effect_direction === 'negative' && magnitude >= 0) return -magnitude;
  return magnitude;
}

function projectEdge(raw: RawEdgeShape, labelMap: ReadonlyMap<string, string>): DisplaySafeEdge | null {
  const from = asString(raw.from);
  const to = asString(raw.to);
  if (from === undefined || to === undefined) return null;
  const strength = resolveSignedStrength(raw);
  // STRICT equality, never `!== 'directed'` and never "absent means
  // bidirected". `Prompts/canonical/draft_graph.txt:484` MANDATES the opposite
  // default — "edge_type defaults to 'directed' when omitted — so do NOT emit
  // edge_type on directed edges" — so a loose test would reclassify
  // essentially every drafted edge in the estate as a confounder. This is the
  // same predicate `:580` below already uses to carry the type.
  const isBidirected = raw.edge_type === 'bidirected';
  // Idempotency: re-projecting an already display-safe edge has no
  // numeric strength but carries an existing `relationship`. Preserve
  // it ONLY when it is one of the formatter's allowlisted phrases FOR THAT
  // EDGE TYPE — unknown strings (e.g. legacy `"strength of 0.55"` prose) MUST
  // NOT pass through verbatim, since they would defeat the entire point of
  // the display-safe projection, and a directed phrase must not survive onto
  // a bidirected edge. Unknown / missing → the near-zero phrase of the
  // matching family, so the fallback can never introduce causal language.
  const existingRelationship = asAllowedRelationship(raw.relationship, isBidirected);
  const relationship = strength !== null
    ? (isBidirected ? bidirectedRelationshipPhrase(strength) : relationshipPhrase(strength))
    : existingRelationship ?? (isBidirected ? NEGLIGIBLE_BIDIRECTED_PHRASE : NEGLIGIBLE_DIRECTED_PHRASE);
  const edge: {
    from: string;
    to: string;
    from_label: string;
    to_label: string;
    relationship: string;
    coefficient_confidence?: CompactCoefficientConfidence;
    provenance?: CompactProvenance;
    edge_type?: 'bidirected';
  } = {
    from,
    to,
    from_label: labelMap.get(from) ?? from,
    to_label: labelMap.get(to) ?? to,
    relationship,
  };
  const coefficientConfidence = asCoefficientConfidence(raw.coefficient_confidence);
  if (coefficientConfidence !== undefined) {
    edge.coefficient_confidence = coefficientConfidence;
  }
  const provenance = asProvenance(raw.provenance);
  if (provenance !== undefined) edge.provenance = provenance;
  // Only the non-default value is carried, and only verbatim: an unrecognised
  // value is dropped rather than coerced, so this can never invent a type.
  if (isBidirected) edge.edge_type = 'bidirected';
  return edge;
}

/**
 * Project the display-only option index to its documented `{id, label}` shape.
 *
 * The authoritative option facts already live on `nodes`. In particular,
 * `is_baseline` is intentionally not copied from this duplicate index: doing
 * so would let a raw/direct caller present a second, contradictory current-
 * approach authority. Malformed entries fail closed rather than acquiring a
 * label through local inference.
 */
function projectOption(raw: unknown): DisplaySafeOption | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const option = raw as RawOptionShape;
  const id = asString(option.id);
  const label = asString(option.label);
  return id !== undefined && label !== undefined ? { id, label } : null;
}

/**
 * Project the raw `ContextPackGraph` into the LLM-facing display-safe shape.
 *
 *   - Edges: `strength` and `exists` are stripped; `plain_interpretation` is
 *     stripped (may contain raw edge language like "strength of 0.55"; the
 *     raw graph retains it). A `relationship` phrase replaces them, while the
 *     compactor's closed `coefficient_confidence` band survives without raw
 *     std. Bare IDs
 *     are kept on `from`/`to`; human labels are surfaced as `from_label` /
 *     `to_label`. `_raw_provenance` is stripped (diagnostic-only).
 *
 *   - Nodes: `id`, `label`, `kind`, `category?`, `unit?` (label only),
 *     `intervention_summary?`, producer-supplied `uncertainty_drivers?`
 *     (bounded/disclosed without interpretation), and `display_value?`
 *     (A2.2) survive.
 *     Per V5 D1 golden-path
 *     closure (A3.1 Task 6), node-level `value`, `raw_value`, and
 *     `cap` are stripped from the LLM-facing projection (including
 *     when nested under canonical `observed_state.{value,raw_value,
 *     cap}`). Brief A2.1 originally preserved `value` as a "user-
 *     meaningful quantity"; the post-A3 review reversed that
 *     decision because exposing any node numeric encouraged Sonnet
 *     to echo it as structural fact and reuse it as a coefficient
 *     in narration. The raw `ContextPack.graph` retains all node
 *     numerics for handlers, freshness hashing, and edit_graph
 *     dispatch — Sonnet just doesn't see them. Internal `source` /
 *     `_raw_provenance` are dropped (diagnostic-only).
 *     A literal producer-attested `is_baseline: true` survives only on option
 *     nodes; the formatter does not infer it from labels or IDs.
 *     The `unit` extractor still reads compact top-level `unit`
 *     first and canonical `observed_state.unit` second so the
 *     assembler raw-graph fallback preserves the user-facing label.
 *
 *     A2.2 reintroduces `display_value` — the pre-formatted
 *     user-facing string ("5%", "£50,000", "18 months") — because
 *     A3.1's full value-strip left Sonnet unable to answer "what
 *     is the current churn rate?". The display channel carries
 *     the formatted string only; the underlying floats remain
 *     stripped. Source priority: existing `display_value` on the
 *     raw input is preferred verbatim (set by `set_factor_value`
 *     post-mutation, A3.1 Task 3); otherwise the projector calls
 *     `synthesiseDisplayValue` against value / raw_value / unit /
 *     factor_type / cap. A bare-number guard rejects unit-less
 *     results ("0.05", "1", "50,000") so the display channel
 *     cannot leak the model-scale value.
 *
 *   - Edge strength resolution accepts every shape that can reach
 *     `ContextPack.graph`: compact (`strength: number`), canonical
 *     GraphV3T (`strength: { mean }` + optional `effect_direction`),
 *     and legacy `strength_mean`. When no strength is present an
 *     existing `relationship` (idempotent re-projection) is preserved.
 *
 *   - `goals` is projected through the SAME `projectNode` as `nodes`. It used
 *     to pass through unchanged, which was a raw-value LEAK: `goals` is a
 *     by-kind index of `nodes` built by filtering the same array, so each goal
 *     reached Sonnet twice — once stripped via `nodes`, once raw via `goals`,
 *     carrying `value` / `raw_value` / `cap`. Projecting loses nothing the
 *     model had (the stripped twin was always already present) and gains
 *     `display_value`, which the raw compact node has no field for.
 *
 *   - `options`: projected independently to the closed `{id, label}` display
 *     shape. Raw/direct assembler callers may supply richer records, so this
 *     boundary must not trust them to have been pre-projected. Baseline,
 *     ranking, readiness, intervention, and other fields are stripped.
 *     `constraints` and `counts` pass through unchanged.
 */
export function formatGraphForContext(raw: ContextPackGraph): DisplaySafeGraph {
  const labelMap = new Map<string, string>();
  for (const node of raw.nodes as readonly RawNodeShape[]) {
    const id = asString(node.id);
    const label = asString(node.label);
    if (id !== undefined && label !== undefined) labelMap.set(id, label);
  }

  const nodes: DisplaySafeNode[] = [];
  for (const node of raw.nodes as readonly RawNodeShape[]) {
    const projected = projectNode(node, labelMap);
    if (projected !== null) nodes.push(projected);
  }

  const edges: DisplaySafeEdge[] = [];
  for (const edge of raw.edges as readonly RawEdgeShape[]) {
    const projected = projectEdge(edge, labelMap);
    if (projected !== null) edges.push(projected);
  }

  // Goals go through the SAME projector as `nodes` — see the `goals` field
  // note on `DisplaySafeGraph`. Because `raw.goals` is a by-kind index of
  // `raw.nodes`, a goal that projects to `null` here is one that was already
  // dropped from `nodes` above, so the two arrays stay consistent.
  const goals: DisplaySafeNode[] = [];
  for (const goal of raw.goals as readonly RawNodeShape[]) {
    const projected = projectNode(goal, labelMap);
    if (projected !== null) goals.push(projected);
  }

  const options: DisplaySafeOption[] = [];
  for (const option of raw.options) {
    const projected = projectOption(option);
    if (projected !== null) options.push(projected);
  }

  return {
    nodes,
    edges,
    options,
    goals,
    constraints: raw.constraints,
    counts: raw.counts,
  };
}
