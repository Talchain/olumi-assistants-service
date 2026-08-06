/**
 * INV-HONOUR (ROADMAP 2.714) — a value the user stated in the brief for THIS
 * turn is never overridden by the drafter in that turn.
 *
 * THE DEFECT THIS KILLS. `observed_state.source: 'brief_extraction'` is a
 * DEFAULT stamp: `transformResponseToV3` writes it for anything the drafter did
 * not self-declare as `inferred` (`schema-v3.ts`). So a hallucinated 20,000
 * receives exactly the same `from_brief` provenance as a quoted 90,000, and
 * nothing anywhere in `src/` compares an emitted value against the brief that
 * produced it. Honouring the user's number was a PROMPT INSTRUCTION only,
 * which is why it was measured nondeterministic.
 *
 * This module is the deterministic comparison. It runs inside
 * `runGraphDataIntegrityChecks` (Stage 6 Boundary) — after the LLM, after the
 * V3 transform, before validation and before the response body is built — so
 * nothing downstream can undo it and no prompt can influence it. It is a PURE
 * function of `(v3Body, brief)`: testable with no LLM in the loop, which is the
 * point (2.716's fix removes the clarify redraft and would otherwise make this
 * defect LOOK fixed while it still fires on any first draft).
 *
 * FAIL CLOSED, EVERYWHERE. An honour rule that guesses which node the user
 * meant is the same defect wearing the fix's clothes. Every ambiguity — two
 * candidate labels, an incompatible unit, a relative anchor, an unresolved
 * magnitude word, a value beyond the node's cap — leaves the graph untouched
 * and RECORDS the skip. Silence and a decision must not look identical.
 *
 * ⚠ THE MAGNITUDE GUARD IS NOT OPTIONAL, AND IT IS THE MOST IMPORTANT LINE
 * HERE. `parseNumericValue` carries its own magnitude vocabulary
 * (`numeric-parser.ts` `MULTIPLIERS`), which is a strict SUBSET of the
 * canonical alphabet (`utils/magnitude-alphabet.ts`): measured at this tip it
 * does not know `grand`, `t` or `trillion`, so it reads `"£2 grand"` as
 * **2 GBP at confidence "high"**. A rule that trusted that would write 2 where
 * the user said 2,000 and stamp it as the USER'S OWN VALUE — a fabrication
 * introduced by the fix. So every candidate anchor is re-checked against the
 * CANONICAL alternation, and any magnitude word the parser did not consume
 * voids the binding. The guard is derived from `MAGNITUDE_ALTERNATION`, so a
 * key added to the canonical alphabet is covered here the instant it lands.
 */

import {
  parseNumericValue,
  type ParsedValue,
} from "../extraction/numeric-parser.js";
import { MAGNITUDE_ALTERNATION } from "../../utils/magnitude-alphabet.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StatedValueHonourRepair {
  node_id: string;
  /** `observed_state.raw_value` when the node is cap-normalised, else `observed_state.value`. */
  field: "observed_state.raw_value" | "observed_state.value";
  before: number;
  after: number;
  /** The node's own unit, verbatim. */
  unit: string | undefined;
  /** The brief text the value was read from (the bounded window). */
  brief_anchor: string;
  reason: string;
}

/**
 * Why a candidate binding was declined. Recorded rather than silent: a skip
 * and a decision are indistinguishable otherwise, and this is the field a
 * reviewer reads to tell "the rule found nothing" from "the rule refused".
 */
export type StatedValueHonourSkipReason =
  | "ambiguous_label_binding"
  | "unit_incompatible"
  | "relative_anchor"
  | "unresolved_magnitude"
  | "stated_exceeds_cap"
  | "non_finite_value";

export interface StatedValueHonourSkip {
  node_id: string;
  reason: StatedValueHonourSkipReason;
  detail: string;
}

export interface StatedValueHonourResult {
  repairs: StatedValueHonourRepair[];
  skips: StatedValueHonourSkip[];
}

// ---------------------------------------------------------------------------
// Unit compatibility
// ---------------------------------------------------------------------------

/**
 * Unit families. BOTH sides must resolve to a family and the families must
 * MATCH — an unknown or absent unit on either side is a refusal, not a pass.
 * A currency stated against a percentage node is not the same quantity, and
 * "0.5 scale" is not "£90,000".
 *
 * Spellings cover both producers: `parseNumericValue` returns singular
 * ISO-ish units (`GBP`, `percent`, `month`, `engineer`), while the V3
 * transform emits whatever the drafter wrote (`£`, `months`, `engineers`,
 * `scale`) — both observed in the captured staging body used by the tests.
 */
const UNIT_FAMILY_BY_SPELLING: ReadonlyMap<string, string> = new Map(
  (
    [
      [
        "currency",
        [
          "gbp", "usd", "eur", "jpy", "inr", "aud", "cad", "nzd", "chf", "sek",
          "£", "$", "€", "¥", "₹", "pounds", "pound", "dollars", "dollar",
          "euros", "euro",
        ],
      ],
      ["percent", ["percent", "%", "pct", "percentage", "percentage_points"]],
      [
        "time",
        [
          "day", "days", "week", "weeks", "month", "months", "year", "years",
          "hour", "hours", "quarter", "quarters",
        ],
      ],
      [
        "count",
        [
          "count", "people", "person", "engineer", "engineers", "developer",
          "developers", "employee", "employees", "user", "users", "customer",
          "customers", "unit", "units", "item", "items", "fte", "headcount",
        ],
      ],
    ] as ReadonlyArray<readonly [string, ReadonlyArray<string>]>
  ).flatMap(([family, spellings]) =>
    spellings.map((s) => [s, family] as const),
  ),
);

function unitFamily(unit: unknown): string | undefined {
  if (typeof unit !== "string") return undefined;
  const key = unit.trim().toLowerCase();
  if (key.length === 0) return undefined;
  return UNIT_FAMILY_BY_SPELLING.get(key);
}

// ---------------------------------------------------------------------------
// The canonical magnitude guard
// ---------------------------------------------------------------------------

/**
 * Any canonical magnitude token, derived from the ONE place a magnitude key
 * may be written. Never spell an alphabet here.
 */
const CANONICAL_MAGNITUDE_TOKEN = new RegExp(
  `\\b(?:${MAGNITUDE_ALTERNATION})\\b`,
  "i",
);

/**
 * True when the window carries a canonical magnitude word that the parser's
 * own match did NOT consume — i.e. the parsed number is missing a multiplier
 * the user wrote. Fail closed: the binding is voided.
 */
function hasUnconsumedMagnitude(window: string, parsed: ParsedValue): boolean {
  const consumed = parsed.originalText.trim();
  const idx = consumed.length > 0 ? window.indexOf(consumed) : -1;
  const remainder =
    idx === -1
      ? window
      : `${window.slice(0, idx)} ${window.slice(idx + consumed.length)}`;
  return CANONICAL_MAGNITUDE_TOKEN.test(remainder);
}

// ---------------------------------------------------------------------------
// Label binding
// ---------------------------------------------------------------------------

/** Case/whitespace-normalised, punctuation preserved (labels carry none). */
function normaliseForBinding(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Bind BY IDENTITY (the node's own label), never by a value predicate another
 * node could satisfy. Returns every start offset at which the node's label
 * occurs in the normalised brief; more than one is an ambiguity, not a pick.
 */
function labelOccurrences(normalisedBrief: string, label: string): number[] {
  const needle = normaliseForBinding(label);
  if (needle.length < 3) return [];
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = normalisedBrief.indexOf(needle, from);
    if (at === -1) break;
    found.push(at);
    from = at + needle.length;
  }
  return found;
}

/** How far past the label a stated value may sit before it stops being "about" it. */
const BINDING_WINDOW_CHARS = 160;

/**
 * The bounded window a value may be read from: from the label to the end of
 * its sentence, capped. Deliberately NOT split on `,` (that would cut
 * `£90,000` in half) nor on `and` (that would cut `hiring and staffing cost`
 * in half) — the two splits `extractAllNumericValues` performs, and the reason
 * this module windows the brief itself and calls `parseNumericValue`, the same
 * parser, rather than re-using the split-based collector.
 */
function bindingWindow(normalisedBrief: string, labelStart: number): string {
  const tail = normalisedBrief.slice(labelStart, labelStart + BINDING_WINDOW_CHARS);
  const terminator = tail.search(/[.!?]/);
  return terminator === -1 ? tail : tail.slice(0, terminator);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

const TOLERANCE = 1e-6;

function approximatelyEqual(a: number, b: number): boolean {
  if (b === 0) return Math.abs(a) < TOLERANCE;
  return Math.abs(a - b) / Math.abs(b) <= TOLERANCE;
}

/**
 * Apply INV-HONOUR to a V3 body, in place.
 *
 * @param v3Body finalised V3 response body (mutated)
 * @param brief  the brief THIS turn drafted from — on a clarify resume this is
 *               the accumulated working brief, which contains the user's own
 *               words verbatim (`incorporateAnswerIntoBrief` appends, it does
 *               not summarise), so it is the correct corpus on every path.
 */
export function honourStatedValues(
  v3Body: unknown,
  brief: string | undefined,
): StatedValueHonourResult {
  const result: StatedValueHonourResult = { repairs: [], skips: [] };
  if (typeof brief !== "string" || brief.trim().length === 0) return result;

  const nodes: any[] = Array.isArray((v3Body as any)?.nodes)
    ? (v3Body as any).nodes
    : [];
  if (nodes.length === 0) return result;

  const normalisedBrief = normaliseForBinding(brief);
  const allLabels = nodes
    .map((n) => (typeof n?.label === "string" ? normaliseForBinding(n.label) : ""))
    .filter((l) => l.length >= 3);

  for (const node of nodes) {
    const observed = node?.observed_state;
    if (!observed || typeof observed !== "object") continue;
    if (typeof node?.id !== "string" || typeof node?.label !== "string") continue;
    if (typeof observed.value !== "number") continue;

    const occurrences = labelOccurrences(normalisedBrief, node.label);
    if (occurrences.length === 0) continue;
    if (occurrences.length > 1) {
      result.skips.push({
        node_id: node.id,
        reason: "ambiguous_label_binding",
        detail: `label occurs ${occurrences.length} times in the brief`,
      });
      continue;
    }

    const window = bindingWindow(normalisedBrief, occurrences[0]!);

    // A window that also contains ANOTHER node's label cannot be attributed.
    const selfLabel = normaliseForBinding(node.label);
    const rivals = allLabels.filter((l) => l !== selfLabel && window.includes(l));
    if (rivals.length > 0) {
      result.skips.push({
        node_id: node.id,
        reason: "ambiguous_label_binding",
        detail: `window also names ${rivals.length} other node label(s)`,
      });
      continue;
    }

    const parsed = parseNumericValue(window);
    if (parsed === null) continue;

    if (parsed.isRelative) {
      result.skips.push({
        node_id: node.id,
        reason: "relative_anchor",
        detail: `"${parsed.originalText.trim()}" states a change, not a value`,
      });
      continue;
    }
    if (!Number.isFinite(parsed.value)) {
      result.skips.push({
        node_id: node.id,
        reason: "non_finite_value",
        detail: `"${parsed.originalText.trim()}" did not resolve to a finite number`,
      });
      continue;
    }
    if (hasUnconsumedMagnitude(window, parsed)) {
      result.skips.push({
        node_id: node.id,
        reason: "unresolved_magnitude",
        detail:
          `"${window.trim()}" carries a magnitude word the numeric parser did not ` +
          `consume — refusing rather than committing a possibly 1,000x-wrong value`,
      });
      continue;
    }

    const nodeFamily = unitFamily(observed.unit);
    const briefFamily = unitFamily(parsed.unit);
    if (
      nodeFamily === undefined ||
      briefFamily === undefined ||
      nodeFamily !== briefFamily
    ) {
      result.skips.push({
        node_id: node.id,
        reason: "unit_incompatible",
        detail:
          `brief unit ${JSON.stringify(parsed.unit ?? null)} (${briefFamily ?? "unknown"}) ` +
          `vs node unit ${JSON.stringify(observed.unit ?? null)} (${nodeFamily ?? "unknown"})`,
      });
      continue;
    }

    const stated = parsed.value;
    const rawValue = observed.raw_value;
    const cap = observed.cap;
    const capNormalised =
      typeof rawValue === "number" && typeof cap === "number" && cap > 0;

    if (capNormalised) {
      if (approximatelyEqual(rawValue as number, stated)) continue;
      if (stated > (cap as number)) {
        result.skips.push({
          node_id: node.id,
          reason: "stated_exceeds_cap",
          detail: `stated ${stated} exceeds the node's cap ${cap} — re-scaling the model is not this rule's decision`,
        });
        continue;
      }
      const before = rawValue as number;
      const divisor = observed.unit === "%" ? 100 : (cap as number);
      node.observed_state = {
        ...observed,
        raw_value: stated,
        value: Number((stated / divisor).toFixed(6)),
        source: "user_override",
        extractionType: "explicit",
      };
      node.provenance = "from_brief";
      result.repairs.push({
        node_id: node.id,
        field: "observed_state.raw_value",
        before,
        after: stated,
        unit: typeof observed.unit === "string" ? observed.unit : undefined,
        brief_anchor: window.trim(),
        reason: `the brief states ${parsed.originalText.trim()} for "${node.label}"; the draft carried ${before}`,
      });
      continue;
    }

    if (approximatelyEqual(observed.value, stated)) continue;
    const before = observed.value as number;
    node.observed_state = {
      ...observed,
      value: stated,
      source: "user_override",
      extractionType: "explicit",
    };
    node.provenance = "from_brief";
    result.repairs.push({
      node_id: node.id,
      field: "observed_state.value",
      before,
      after: stated,
      unit: typeof observed.unit === "string" ? observed.unit : undefined,
      brief_anchor: window.trim(),
      reason: `the brief states ${parsed.originalText.trim()} for "${node.label}"; the draft carried ${before}`,
    });
  }

  return result;
}
