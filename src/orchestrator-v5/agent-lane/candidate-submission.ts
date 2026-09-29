/**
 * Agent lane — the construction INPUT contract, deliberately model-agnostic.
 *
 * ⭐⭐ WHY THIS IS NOT "FAITHFUL PLUS WIDENED".
 *
 * The witness configuration is `gpt-4.1 faithful builder -> gpt-5.6-terra
 * widener`, but that is a CONFIGURATION UNDER TEST, not the architecture. A
 * later comparison (W3) has to be able to run:
 *
 *   A. gpt-4.1 builder -> terra widener -> the same deterministic validation
 *   B. one model (sol or terra) produces the whole candidate -> the same validation
 *
 * and judge the FINISHED validated model on fidelity, strategic enrichment,
 * causal quality, unsupported inference, representation loss, usefulness,
 * latency and cost.
 *
 * ⛔ SO NOTHING DOWNSTREAM MAY REQUIRE TWO OBJECTS. A type that demands a
 * separate `faithful` and a separate `widened` forces configuration B to fake
 * one of them, and a faked empty widening is not the same measurement as a model
 * that genuinely produced everything in one pass. The contract is therefore a
 * LIST of contributions of any length, each carrying who produced it.
 *
 * `produced_by` is RECORDED, never branched on. If code ever switches on a model
 * id, the seam has stopped being model-agnostic.
 */

/** What a contribution is claiming to be. */
export type ContributionKind =
  /** A faithful reading of the brief — adds nothing not implied by it. */
  | 'faithful'
  /** Additions and critique on top of an existing reading. */
  | 'widening'
  /** A complete candidate produced in one pass. */
  | 'whole';

export interface CandidateContribution {
  readonly kind: ContributionKind;
  /** Model id, for the record and for W3's cost/latency columns. Never branched on. */
  readonly produced_by: string;
  /** Measured cost of producing it, for W3. */
  readonly usage?: { readonly input_tokens?: number; readonly output_tokens?: number; readonly reasoning_tokens?: number };
  readonly latency_ms?: number;
  /** The producer's payload, in the banked construction contract's shape. */
  readonly payload: unknown;
}

export interface CandidateSubmission {
  /** The user's brief, verbatim. */
  readonly brief: string;
  readonly contributions: readonly CandidateContribution[];
}

/** Total measured cost of a submission, for the W3 comparison columns. */
export function submissionCost(s: CandidateSubmission): {
  input_tokens: number;
  output_tokens: number;
  reasoning_tokens: number;
  latency_ms: number;
  passes: number;
} {
  let input_tokens = 0;
  let output_tokens = 0;
  let reasoning_tokens = 0;
  let latency_ms = 0;
  for (const c of s.contributions) {
    input_tokens += c.usage?.input_tokens ?? 0;
    output_tokens += c.usage?.output_tokens ?? 0;
    reasoning_tokens += c.usage?.reasoning_tokens ?? 0;
    // Sequential by construction: a widening reads the faithful reading.
    latency_ms += c.latency_ms ?? 0;
  }
  return { input_tokens, output_tokens, reasoning_tokens, latency_ms, passes: s.contributions.length };
}
