/**
 * WS-A ITEM 1(b) — THE COMMIT-TIME MONEY INVARIANT.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS FOR, and the measurement that produced it.
 *
 * The pipeline encodes a stated money amount as a PAIR: a factor `cap` and an
 * option intervention level, with the amount recovered as `level × cap`. Both
 * halves are emitted by the SAME single LLM call, independently, and
 * (measured at CEE `8e3ad916`, L2B-VARIANCE.md §3.1) **nothing in the system
 * asserts that product**. Over 23 fresh guest sessions on three briefs the
 * user's own money was silently misencoded in 1/12 control runs, 1/5 of one
 * variant and 4/5 of another — £6,000 committed as **£1,440**, £18,000 as
 * **£4,500** — with `pipeline_outcome.warnings` reading `[]` on every one of
 * them. The only warning this pipeline had ever been observed to emit was
 * about its own plumbing; it had no vocabulary for *"the number I am
 * modelling is not the number you gave me."* This is that vocabulary.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DISCLOSURE, NEVER REWRITE. The graph still commits, byte-identical. This
 * module returns WARNINGS and mutates nothing — no magnitude is corrected, no
 * cap is adjusted, no value is minted. That direction is not a preference: it
 * is the ruling left by #853 / ROADMAP 2.714 (`graph-data-integrity.ts`,
 * "⚠ NONE OF THESE READS THE BRIEF, and none may"), where a seam that took a
 * stated number out of prose and wrote it back as the user's own could be
 * 10^6× wrong. A wrong number the user can SEE flagged is recoverable; a wrong
 * number written in silently is not.
 *
 * NO NEW PROSE READER. Every question about the user's words is answered by
 * the existing `findStatedAmounts` / `isAmountStatedInBrief` scan, and every
 * question about scale by the shared `denormalisedMagnitude` inverse. This
 * module contributes no regex over natural language, because the estate's
 * record on hand-written pattern batteries at pipeline chokepoints (traps 22,
 * 22b, 22d, 22f — four consecutive rounds on one predicate, each fixing one
 * direction and opening the other) says it must not.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE INVARIANT, STATED AGAINST THE SPEC AND NOT AGAINST THE SYMPTOM
 * (CLAUDE.md trap 13d):
 *
 *     For every factor whose magnitude THE SYSTEM ITSELF says the brief
 *     stated (`observed_state.source === 'brief_extraction'`), that is
 *     denominated in a currency the brief also uses, and that carries a
 *     usable cap — at least one magnitude this factor's encoding can produce
 *     (its own baseline, or any option's intervention on it, each read as
 *     `level × cap`) MUST be a magnitude the brief states in that currency.
 *
 * Read the quantifier carefully, because it is the whole design. It is NOT
 * "every intervention must be a stated amount": a model-chosen pilot level on
 * a brief-stated factor is legitimate, honest, and already labelled
 * `cee_hypothesis` by item 1(a). It is "the user's number must survive
 * SOMEWHERE in this factor's encoding". Measured against the 26-session
 * capture corpus this fires on exactly the corrupted factors and on nothing
 * else — see `__tests__/money-invariant.corpus.test.ts`, which pins the
 * detection set by identity so the numbers cannot drift unobserved.
 *
 * ⚠ THE KNOWN GAP, PINNED RATHER THAN LEFT TO BE FOUND (trap 22f's honest
 * exit). A factor whose BASELINE faithfully carries one stated magnitude while
 * its OPTIONS lose a DIFFERENT one is not detected — the corpus contains
 * exactly this case (`D2` `fac_crm_licence_cost`: baseline
 * `0.5 × 60000 = £30,000` reconciles, so the invariant is satisfied, while
 * `0.46 × 60000 = £27,600` silently misencodes the brief's £46,000). Closing
 * it needs a per-intervention SOURCE binding — which stated amount was THIS
 * intervention derived from — and that identity does not exist on the wire
 * today (trap 19: a value predicate another amount could satisfy is not a
 * binding). The corpus test asserts the CURRENT detection set EXACTLY, so this
 * gap REDs if it grows and REDs if it silently closes.
 *
 * ⚠ AND THE FALSE-POSITIVE MODE, stated because it is the dangerous direction.
 * The scan is a predicate over natural language and its coverage is not a
 * closed set (see `stated-amounts.ts`'s own enumeration of what it cannot
 * read). A brief that states an amount in a spelling the scan misses produces
 * a warning about a faithful encoding. That is why the copy asserts only what
 * is observable — *"could not be matched to an amount in your brief"* — and
 * never *"this number is wrong"*, and why the severity is `warn` rather than
 * `error`: nothing downstream may refuse a graph on this signal.
 */

import {
  readUnit,
  isAmountStatedInBrief,
  findStatedAmounts,
  denormalisedMagnitude,
  type UnitReading,
} from "./stated-amounts.js";
import type { NodeV3T, OptionV3T, ValidationWarningV3T } from "../../schemas/cee-v3.js";

/**
 * The warning code. Declared in `ValidationWarningCode` (cee-v3.ts) alongside
 * the other CEE-owned codes; the shared contract types `code` as
 * `z.string()` with `.passthrough()` (`@talchain/schemas` `warnings.ts`), so a
 * new member is additive at every hop — producer, CEE validator, wire.
 */
export const STATED_MAGNITUDE_UNRECONCILED = "STATED_MAGNITUDE_UNRECONCILED" as const;

/** One factor's failure to reproduce any stated magnitude, before it becomes copy. */
interface Unreconciled {
  readonly factorId: string;
  readonly factorLabel: string;
  /** The graph's own unit string, verbatim, for the machine-readable details. */
  readonly unit: string;
  /** That unit, already read — the copy formats from this, never from the string. */
  readonly reading: UnitReading;
  readonly cap: number;
  /** Every magnitude this factor's encoding produces, in graph order. */
  readonly encoded: readonly number[];
  /** The magnitudes the brief states in this factor's currency. */
  readonly statedInCurrency: readonly number[];
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Format a magnitude for user-facing copy: no fabricated precision, group
 * thousands.
 *
 * ⚠ WS-A ROUND 2, B3 — FORMATS FROM THE CURRENCY TOKEN, NEVER FROM THE RAW
 * UNIT STRING. The magnitude passed in has ALREADY been multiplied by
 * `reading.multiplier`, so prefixing the unit as written spends the unit's
 * magnitude letter a second time: measured at `3038820c`, `unit: "£m"` made
 * £1m read as `£m1,000,000` and the brief's own £0.9m read as `£m900,000` —
 * both lists mislabelled by 10^6, in the one sentence whose entire purpose is
 * to be honest about the user's money. `unit: "£m"` is not synthetic; it is a
 * persisted shape carried on `brief_extraction` rows in the deployed cold-read
 * capture `context-integrity/__tests__/fixtures/b1-growth.cold-read.json`.
 *
 * `readUnit` has already parsed the token apart, so this takes its answer
 * rather than re-deriving one (CLAUDE.md trap 21).
 */
function formatMagnitude(reading: UnitReading, magnitude: number): string {
  const rounded = Math.round(magnitude * 100) / 100;
  // ⚠ THE SIGN IS RENDERED OUTSIDE THE CURRENCY TOKEN. `£-18,000` is not money
  // in any English register, and a negative level is reachable — the shared
  // inverse has an explicit branch for it (see `encodedMagnitudes`).
  const magnitudeOnly = Math.abs(rounded);
  const sign = rounded < 0 ? "-" : "";
  const rendered = Number.isInteger(magnitudeOnly)
    ? magnitudeOnly.toLocaleString("en-GB")
    : magnitudeOnly.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const token = (reading.currencyDisplay ?? reading.currencyCode ?? "").trim();
  if (token.length === 0) return `${sign}${rendered}`;
  // A currency SYMBOL prefixes; an ISO code (or any word form) trails, because
  // "GBP18,000" is not English.
  return /^[^\p{L}\p{N}\s]/u.test(token)
    ? `${sign}${token}${rendered}`
    : `${sign}${rendered} ${token}`;
}

/**
 * The magnitudes a factor's encoding produces, through THE SAME INVERSE THE
 * RECONCILIATION CHECK USES.
 *
 * ⚠ WS-A ROUND 2, B2 — THIS IS WHY IT IS A FUNCTION AND NOT AN INLINE PRODUCT.
 * Round 1 checked with `isAmountStatedInBrief(level, unit, brief, cap)` — which
 * routes through `denormalisedMagnitude` → `resolveExistingRawValue` — and then
 * printed `level × cap × multiplier`. Those two agree only on `level ∈ [0,1]`.
 * The shared inverse is SIGN-SYMMETRIC (`value < 0 || value > 1 ⇒ raw = value`,
 * `evaluate-factor-value-proposal.ts:280`), a branch that exists because
 * off-contract already-raw graphs occur. So on an already-raw level of 19,000
 * against a cap of 25,000 the check correctly reasoned about £19,000 while the
 * message announced **£475,000,000** — a fabricated magnitude, inside the
 * disclosure written because the product misstated the user's money. Negative
 * levels diverged the same way.
 *
 * That is CLAUDE.md trap 13d exactly: round 1 wrote its derivation against the
 * failure mode in hand (`[0,1]`) rather than against the predicate the
 * consumer actually applies. ONE inverse, consulted by both, is the only shape
 * that cannot drift — and it is the shape this module's own header already
 * demanded (trap 21: *"two derivations of one meaning end up disagreeing
 * inside a single response"*).
 */
function encodedMagnitudes(
  levels: readonly number[],
  unit: string,
  cap: number,
  reading: UnitReading,
): number[] {
  return levels.map(
    (level) => (denormalisedMagnitude(level, unit, cap) ?? level) * reading.multiplier,
  );
}

/**
 * Detect every factor whose brief-stated magnitude no part of its encoding
 * reproduces. PURE — reads the committed graph and returns warnings; never
 * mutates, never throws, and returns `[]` on every shape it cannot read.
 */
export function detectUnreconciledStatedMagnitudes(input: {
  readonly nodes: readonly NodeV3T[];
  readonly options: readonly OptionV3T[];
  readonly briefText: string | null | undefined;
}): ValidationWarningV3T[] {
  const { nodes, options, briefText } = input;
  if (typeof briefText !== "string" || briefText.trim().length === 0) return [];
  const stated = findStatedAmounts(briefText);
  if (stated.length === 0) return [];

  const findings: Unreconciled[] = [];

  for (const node of nodes ?? []) {
    if (node?.kind !== "factor") continue;
    const observed = node.observed_state;
    if (observed === undefined || observed === null) continue;

    // THE SYSTEM'S OWN CLAIM IS THE GATE, not a re-reading of the brief. This
    // is the stamp CEE's extractor writes when it believes it took the
    // magnitude from the user's words; auditing the claim CEE already made is
    // a different and much safer act than minting a new one.
    if (observed.source !== "brief_extraction") continue;

    const unit = typeof observed.unit === "string" ? observed.unit : undefined;
    const reading = readUnit(unit);
    // MONEY invariant. A "scale" / "count" / "months" factor carries no
    // currency claim to audit, and matching one against a £ statement is the
    // cross-denomination hole `stated-amounts.ts` exists to keep closed.
    //
    // ⚠ DELIBERATELY REDUNDANT, AND THE REDUNDANCY IS MEASURED, NOT ASSUMED
    // (CLAUDE.md trap 13c: an equivalent mutant must be DEMONSTRATED, never
    // asserted). Deleting `reading.kind !== "currency"` changes NOTHING: a
    // non-currency `readUnit` carries no `currencyCode`, so the
    // `statedInCurrency` filter below is always empty and the loop `continue`s
    // one guard later. Proven by execution — the detector's full output over
    // the 23 drafted capture runs × nine unit spellings (£, $, €, £m, scale,
    // %, months, GBP, count) is BYTE-IDENTICAL with and without this line.
    // It stays because it is the readable statement of what this module
    // audits, and because it fails closed if the filter below is ever
    // loosened; it is recorded as redundant so a later tidy-up removes THIS
    // line knowingly rather than removing the load-bearing one by mistake.
    if (reading.kind !== "currency" || unit === undefined) continue;

    const cap = observed.cap;
    if (!isFiniteNumber(cap) || cap <= 0) continue;

    // Only audit against a currency the brief actually uses. With no stated
    // amount in this denomination the question "does the encoding reproduce
    // one" has no true answer, and a warning would be a fabrication.
    const statedInCurrency = stated
      .filter((a) => a.kind === "currency" && a.currencyCode === reading.currencyCode)
      .map((a) => a.magnitude);
    if (statedInCurrency.length === 0) continue;

    // Every magnitude this factor's encoding can produce: its own committed
    // baseline, then each option's intervention on it, in graph order.
    const levels: number[] = [];
    if (isFiniteNumber(observed.value)) levels.push(observed.value);
    for (const option of options ?? []) {
      const intervention = option?.interventions?.[node.id];
      if (intervention !== undefined && isFiniteNumber(intervention.value)) {
        levels.push(intervention.value);
      }
    }
    if (levels.length === 0) continue;

    const reconciled = levels.some((level) =>
      isAmountStatedInBrief(level, unit, briefText, cap),
    );
    if (reconciled) continue;

    findings.push({
      factorId: node.id,
      factorLabel: typeof node.label === "string" && node.label.length > 0 ? node.label : node.id,
      unit,
      reading,
      cap,
      encoded: encodedMagnitudes(levels, unit, cap, reading),
      statedInCurrency,
    });
  }

  return findings.map((f) => ({
    code: STATED_MAGNITUDE_UNRECONCILED,
    severity: "warn" as const,
    // Says exactly what was observed and nothing wider: the encoding could not
    // be matched to a stated amount. It does NOT say the model is wrong, does
    // not tell the user to correct anything they may not have got wrong, and
    // does not name a leader or a recommendation.
    message:
      `“${f.factorLabel}” is recorded as coming from your brief, but none of the amounts ` +
      `this model holds for it — ${f.encoded.map((m) => formatMagnitude(f.reading, m)).join(", ")} — ` +
      `could be matched to an amount in your brief ` +
      `(${f.statedInCurrency.map((m) => formatMagnitude(f.reading, m)).join(", ")}). ` +
      `The figures in the model are the model's own.`,
    affected_node_id: f.factorId,
    stage: "v3_transform",
    details: {
      factor_id: f.factorId,
      unit: f.unit,
      cap: f.cap,
      encoded_magnitudes: f.encoded,
      stated_magnitudes_in_currency: f.statedInCurrency,
    },
  }));
}
