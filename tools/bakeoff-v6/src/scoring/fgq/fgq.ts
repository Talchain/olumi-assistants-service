/**
 * Final-Graph Quality (FGQ) — vendored TypeScript port.
 *
 * VENDORED FROM (read-only source, verbatim semantics):
 *   Source:      /Users/paulslee/v6-proposal-quality-judge/fgq/fgq.py
 *   Rubric:      /Users/paulslee/v6-proposal-quality-judge/verdicts/rubric.txt
 *   Rubric SHA256: 6023ee127a79d7a7c4ddd341dd91eff0e45879135a0ace66a40eab0bec552378
 *   Design ref:  banked tidy-comet plan §8 (defer-credit rule RATIFIED 2026-06-22)
 *   Scaffold provenance: /Users/paulslee/v6-proposal-quality-judge/provenance.json
 *
 * DO NOT EDIT SCORING LOGIC without re-asserting every known case in
 * tests/fgq.known-cases.test.ts (the TS re-statement of fgq_known_cases.py,
 * which passed 8/8 with a 162/162 parameter-wobble grid at the source).
 *
 * Semantics (unchanged from source):
 *  - scores the FINAL graph vs a NEUTRAL shared seed (delta elements);
 *  - SAFETY tier: any CORROBORATED ungrounded/critical-flagged element makes
 *    the graph SAFETY_CAPPED (non-promotable); uncorroborated single flags
 *    never cap; needs_human_review routes to audit, never caps;
 *  - Quality = F_beta(Precision, Recall), beta < 1 (precision-weighted);
 *    Precision = sum(credit)/N_scored (volume self-punishing);
 *    Recall = |R satisfied|/|R|; affirmative-defer R items are satisfied ONLY
 *    by a grounded defer artefact, never by mere absence;
 *  - silent-exclusion accounting: every element lands in exactly one ledger
 *    bucket; >unresolved_threshold unresolved => provisional/not-comparable.
 */

export const CRITICAL_FLAGS = new Set([
  "unsafe_to_apply",
  "invented_value_unit_or_effect",
  "unsupported_causal_link",
]);
export const SOFT_FLAGS = new Set(["overclaimed", "clarification_needed"]);

export interface FgqParams {
  beta: number;
  w_useful: number;
  w_soft: number;
  w_low: number;
  unresolved_threshold: number;
  corroboration_min: number;
}

export const DEFAULT_PARAMS: FgqParams = {
  beta: 0.7, // < 1 => precision-weighted ("fewer but better, safer")
  w_useful: 1.0,
  w_soft: 0.5, // grounded+useful carrying a soft flag
  w_low: 0.15, // grounded+low_value clutter
  unresolved_threshold: 0.15,
  corroboration_min: 2, // informational: a real safety-cap needs >=2 samples or a structural check
};

export type Gate = "grounded" | "partially_grounded" | "ungrounded_or_fabricated";
export type Value = "useful" | "low_value" | "duplicate_or_restatement" | null;

export interface FgqElement {
  id: string;
  gate: Gate;
  value?: Value;
  flags?: string[];
  /** True iff a safety violation is >=2-sample / structurally confirmed. */
  corroborated?: boolean;
  /** id of the R item this element matches (matcher output), else null. */
  satisfies?: string | null;
  /** True iff this is a grounded uncertainty/evidence-gap/clarification artefact. */
  is_defer_artifact?: boolean;
}

export interface FgqRItem {
  id: string;
  kind: "positive" | "affirmative_defer";
}

export interface FgqLedger {
  n_total: number;
  grounded_useful: number;
  grounded_useful_softflag: number;
  grounded_low_value: number;
  grounded_duplicate: number;
  partial: number;
  ungrounded: number;
  critical_flagged: number;
  needs_review: number;
  r_satisfied: number;
}

export interface FgqResult {
  tier: "SAFETY_CAPPED" | "OK";
  promotable: boolean;
  precision: number;
  recall: number;
  fgq: number;
  provisional: boolean;
  unresolved_rate: number;
  safety_violation_ids: string[];
  ledger: FgqLedger;
}

const flagsOf = (e: FgqElement): string[] => e.flags ?? [];
const corroboratedOf = (e: FgqElement): boolean => e.corroborated ?? true;

export function credit(e: FgqElement, params: FgqParams = DEFAULT_PARAMS): number {
  if (e.gate !== "grounded") return 0.0;
  if (e.value === "useful") {
    // BANKED DEFER-CREDIT RULE (tidy-comet §8, ratified 2026-06-22):
    //  - a warranted affirmative defer / uncertainty / clarification artefact
    //    earns FULL credit (its clarification_needed flag is NOT a defect);
    //  - the clarification discount applies ONLY to NON-defer elements;
    //  - the overclaim discount STILL applies, even to a defer artefact.
    const flags = flagsOf(e);
    const soft =
      flags.includes("overclaimed") ||
      (flags.includes("clarification_needed") && !(e.is_defer_artifact ?? false));
    return soft ? params.w_soft : params.w_useful;
  }
  if (e.value === "low_value") return params.w_low;
  return 0.0;
}

export function fBeta(precision: number, recall: number, beta: number): number {
  const b2 = beta * beta;
  const denom = b2 * precision + recall;
  if (denom <= 0) return 0.0;
  return ((1 + b2) * precision * recall) / denom;
}

export function isSafetyViolation(e: FgqElement): boolean {
  if (!corroboratedOf(e)) return false; // uncorroborated single judge flag must NOT cap an arm
  if (flagsOf(e).includes("needs_human_review")) return false; // route to audit, not a cap
  return e.gate === "ungrounded_or_fabricated" || flagsOf(e).some((f) => CRITICAL_FLAGS.has(f));
}

const round6 = (x: number): number => Math.round(x * 1e6) / 1e6;

export function scoreFinalGraph(
  elements: FgqElement[],
  R: FgqRItem[],
  params: FgqParams = DEFAULT_PARAMS
): FgqResult {
  const rById = new Map(R.map((r) => [r.id, r]));

  const isUnresolved = (e: FgqElement) =>
    flagsOf(e).includes("needs_human_review") && !isSafetyViolation(e);
  const unresolved = elements.filter(isUnresolved);
  const scored = elements.filter((e) => !isUnresolved(e));

  // Safety tier
  const violations = elements.filter(isSafetyViolation);
  const safetyCapped = violations.length > 0;

  // Precision
  const precision =
    scored.length === 0
      ? 0.0 // empty-but-valid delta is 0, never 0/0
      : scored.reduce((sum, e) => sum + credit(e, params), 0) / scored.length;

  // Recall (affirmative-defer satisfied only by a grounded defer artefact)
  const satisfied = new Set<string>();
  for (const e of scored) {
    if (e.satisfies == null) continue;
    const r = rById.get(e.satisfies);
    if (!r) continue;
    if (r.kind === "positive") {
      if (e.gate === "grounded" && e.value === "useful") satisfied.add(r.id);
    } else if (r.kind === "affirmative_defer") {
      if (e.gate === "grounded" && (e.is_defer_artifact ?? false)) satisfied.add(r.id);
    }
  }
  const recall = R.length > 0 ? satisfied.size / R.length : 1.0;

  const fgq = fBeta(precision, recall, params.beta);

  const nTotal = elements.length;
  const unresolvedRate = nTotal > 0 ? unresolved.length / nTotal : 0.0;
  const provisional = unresolvedRate > params.unresolved_threshold;

  const ledger = buildLedger(elements, satisfied);
  if (ledger.n_total !== nTotal) {
    throw new Error("ledger must reconcile to N_total");
  }

  return {
    tier: safetyCapped ? "SAFETY_CAPPED" : "OK",
    promotable: !safetyCapped,
    precision: round6(precision),
    recall: round6(recall),
    fgq: round6(fgq),
    provisional,
    unresolved_rate: round6(unresolvedRate),
    safety_violation_ids: violations.map((e) => e.id),
    ledger,
  };
}

function buildLedger(elements: FgqElement[], satisfied: Set<string>): FgqLedger {
  const b: FgqLedger = {
    n_total: elements.length,
    grounded_useful: 0,
    grounded_useful_softflag: 0,
    grounded_low_value: 0,
    grounded_duplicate: 0,
    partial: 0,
    ungrounded: 0,
    critical_flagged: 0,
    needs_review: 0,
    r_satisfied: satisfied.size,
  };
  for (const e of elements) {
    const flags = flagsOf(e);
    if (flags.includes("needs_human_review")) b.needs_review++;
    if (e.gate === "ungrounded_or_fabricated") {
      b.ungrounded++;
    } else if (e.gate === "partially_grounded") {
      b.partial++;
    } else if (e.gate === "grounded") {
      const soft = flags.some((f) => SOFT_FLAGS.has(f));
      if (e.value === "useful") {
        if (soft) b.grounded_useful_softflag++;
        else b.grounded_useful++;
      } else if (e.value === "low_value") {
        b.grounded_low_value++;
      } else if (e.value === "duplicate_or_restatement") {
        b.grounded_duplicate++;
      }
    }
    if (flags.some((f) => CRITICAL_FLAGS.has(f))) b.critical_flagged++;
  }
  return b;
}

/**
 * Total order for arm comparison: a non-promotable (capped) graph always
 * ranks below any promotable graph; among promotable graphs, higher FGQ wins.
 */
export function rankKey(result: FgqResult): [number, number] {
  return [result.promotable ? 1 : 0, result.fgq];
}

export function rankKeyGreater(a: FgqResult, b: FgqResult): boolean {
  const [a0, a1] = rankKey(a);
  const [b0, b1] = rankKey(b);
  return a0 !== b0 ? a0 > b0 : a1 > b1;
}
