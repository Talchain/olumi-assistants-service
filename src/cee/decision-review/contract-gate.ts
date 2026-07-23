/**
 * Decision Review — POST-parse CONTRACT GATE
 *
 * decision_review auto-fires on every analysed turn and synthesises the
 * highest-stakes user-facing prose (the composed `review_card` / `coaching` /
 * `evidence` wire blocks, bias findings, anti-fabrication clause R-CONT).
 *
 * Today the auto-fire path attaches whatever JSON parsed — the block-parse
 * shape check (`performShapeCheck`) only runs on the HTTP route and the
 * decomposed slices, and even there its caps are a LOOSE structural backstop
 * (bias ≤ 3, decision_quality_prompts ≤ 3, key_assumptions ≤ 5) that sits
 * BELOW the actual prompt contract. There is no gate asserting the CONTRACT a
 * model switch (the standing gpt-4.1 A/B) could silently regress:
 *
 *   - required coverage: an analysed turn must carry ≥ 1 review_card;
 *   - block counts / bias-card cap at the TIGHT prompt bound;
 *   - no fabricated conversational callbacks (R-CONT — nothing enforces it);
 *   - grounded entity references (bias_findings[].affected_elements must be
 *     real graph ids, never invented).
 *
 * This gate runs POST-parse on the parsed decision_review output. On any
 * violation the caller DROPS the review down the existing graceful no-review
 * path (thin content) and emits a reason-tagged, R-004-clean telemetry event
 * — never a silent trim into compliance. The gate is UNCONDITIONAL (no env
 * gate — Paul doctrine); its existence is the A/B precondition.
 *
 * ── Rule derivation (derive-don't-mirror; every rule cites its source) ──
 *
 *  The contract source of truth is the staged decision_review prompt text
 *  `parallel-briefs/decision-review-v15-candidate.txt` (= PMS
 *  `decision_review_default` v13, LIVE on staging) and its clause enumeration
 *  `parallel-briefs/CLAUSE-CHECKLIST-decision-review-2026-07-16.md`.
 *
 *  - Coverage floor ("≥ 1 review_card") is derived from the COMPOSER'S OWN
 *    emission condition: `buildNarrativeCard` in
 *    `orchestrator-v5/compose/phase3-blocks.ts` emits the primary review_card
 *    only when `narrative_summary` is a non-empty (post-trim) string. A model
 *    switch returning an empty/absent narrative_summary passes the block-parse
 *    typeof check yet composes NO review_card — an analysed turn with no
 *    review is a silent regression.
 *  - The count caps below are the TIGHT prompt bounds (v15 candidate schema
 *    section), distinct from and stricter than the loose shape-check backstop.
 *  - Fabricated-continuity phrases (R-CONT) are the F14 amendment
 *    (`DECISION-REVIEW-V15-AMENDMENT-DELTA-2026-07-16.md`, TRUTH_DISCIPLINE
 *    rule 7) plus the v15 banned staleness phrases. R-CONT "nothing enforces
 *    today"; the amendment itself recommends a deterministic callback-phrase
 *    detector — this is it, wired into the runtime instead of an offline
 *    checker.
 *  - Entity grounding is R-ID / R-BIAS (v15 candidate: "bias_findings.
 *    affected_elements: [] or valid node/edge ids from graph").
 *
 * The recursive prose walker is REUSED from `shape-check.ts` (`collectStrings`)
 * rather than re-implemented, so there is a single string-collection source.
 */

import { collectStrings } from './shape-check.js';

// ============================================================================
// Contract count caps — the TIGHT prompt bound
//
// These are the prompt's own per-field maxima (v15 candidate = PMS v13, LIVE
// on staging). They are DELIBERATELY tighter than the block-parse shape-check
// backstop in `shape-check.ts` (bias > 3, decision_quality_prompts > 3,
// key_assumptions > 5, all hard errors). The shape-check bound is a structural
// floor that catches egregious overruns; THIS gate pins the contract the A/B
// must not regress. Where a rule already matches a shape-check constraint
// exactly (flip_thresholds ≤ 2), it is NOT restated here — shape-check owns it.
// ============================================================================

/** v15 candidate: `bias_findings (array, max 2; [] unless STRONGLY grounded)`. */
export const MAX_BIAS_FINDINGS = 2;
/** v15 candidate: `decision_quality_prompts (array, max 2)`. */
export const MAX_DECISION_QUALITY_PROMPTS = 2;
/** v15 candidate: `key_assumptions (string[], max 3, each max 200 chars)`. */
export const MAX_KEY_ASSUMPTIONS = 3;
/** v15 candidate: `scenario_contexts (Record<edge_id, object>, max 2)`. */
export const MAX_SCENARIO_CONTEXTS = 2;

// ============================================================================
// R-CONT — fabricated conversational-callback detector
//
// The decision_review input carries NO conversation history, so ANY reference
// to a prior exchange with the user is fabricated by construction. Patterns
// are multi-word conversational frames (low false-positive risk) plus the two
// staleness phrases the v15 prompt explicitly bans (say "the latest available
// run" instead). Reflective questions to the reader ("What would change your
// mind?") are intentionally NOT matched — only invented shared history is.
//
// Sources: amendment delta TRUTH_DISCIPLINE rule 7 (exact banned examples:
// "as you mentioned", "as we discussed", "the pre-mortem you asked for",
// "the exercise you did"); the amendment's recommended detector tokens
// (`as you mentioned|as we discussed|you asked|your pre-mortem|the exercise
// you`); and v15 candidate lines 130-131 ("previous analysis", "prior
// analysis", "cached result").
// ============================================================================

export const FABRICATED_CONTINUITY_PATTERNS: readonly RegExp[] = [
  // "as you mentioned / said / asked / …" — attributes words to a prior user
  // turn that this surface's input does not contain.
  /\bas you\s+(mentioned|said|noted|asked|requested|suggested|indicated|pointed\s+out|described|explained)\b/i,
  // "like you said / mentioned / asked / …"
  /\blike you\s+(said|mentioned|asked|wanted|requested|noted)\b/i,
  // "as we discussed / agreed / …" — a shared conversation that never happened.
  /\bas we\s+(discussed|mentioned|agreed|talked\s+about|noted|covered|established|said)\b/i,
  // Bare first-person-plural conversation verbs ("we discussed", "we agreed").
  /\bwe\s+(discussed|agreed|talked\s+about|spoke\s+about)\b/i,
  // "as mentioned / discussed / noted (earlier|before|previously|above)".
  /\bas\s+(mentioned|discussed|noted|stated)\s+(earlier|before|previously|above)\b/i,
  // "you asked for / about / me" — a prior request the input does not contain.
  /\byou\s+(asked|requested)\s+(for|about|me|us)\b/i,
  // "the pre-mortem / exercise / analysis you asked / did / …" — the F14
  // exemplar ("the evidence your pre-mortem asked for").
  /\bthe\s+(pre-?mortem|exercise|analysis|scenario|question|prompt)\s+you\s+(asked|did|ran|requested|wanted|mentioned|described|raised)\b/i,
  // "your pre-mortem" — attributes the pre-mortem to the user (fabricated;
  // the review authors it, the user did not).
  /\byour\s+pre-?mortem\b/i,
  // "carrying on from an earlier turn / exchange / conversation".
  /\bearlier\s+(turn|exchange|conversation|message|discussion)\b/i,
  /\b(from|in)\s+(a\s+|the\s+)?(previous|prior|earlier)\s+(turn|exchange|conversation|message)\b/i,
  // v15 explicitly-banned staleness-continuity phrases (say "the latest
  // available run" instead).
  /\b(previous|prior)\s+analysis\b/i,
  /\bcached\s+result\b/i,
];

/**
 * Return the first fabricated-continuity phrase that hits in `text`, or null
 * when clean. The matched substring is used ONLY for unit-test assertions and
 * local classification — it is NEVER placed in telemetry (R-004: no user text).
 */
export function findFabricatedContinuityHit(text: string): string | null {
  if (!text || text.length === 0) return null;
  for (const re of FABRICATED_CONTINUITY_PATTERNS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}

// ============================================================================
// Entity grounding corpus
// ============================================================================

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * Collect the set of valid entity ids from the run's graph: every
 * `graph.nodes[].id` and `graph.edges[].id` that is a non-empty string. This
 * is the corpus the R-ID / R-BIAS rule grounds `affected_elements` against.
 * Defensive by construction (the enrichment graph is opaque on this path) — an
 * unrecognisable graph yields an empty set, which SKIPS the grounding rule (no
 * corpus ⇒ cannot check), mirroring the number-grounding doctrine in
 * `shape-check.ts` (`isGrounded`: empty corpus ⇒ skip).
 */
export function collectGraphEntityIds(graph: Record<string, unknown>): Set<string> {
  const ids = new Set<string>();
  const add = (v: unknown) => {
    if (typeof v === 'string' && v.length > 0) ids.add(v);
  };
  for (const key of ['nodes', 'edges'] as const) {
    const arr = graph[key];
    if (!Array.isArray(arr)) continue;
    for (const raw of arr) {
      const entity = readRecord(raw);
      if (entity) add(entity.id);
    }
  }
  return ids;
}

// ============================================================================
// Gate types
// ============================================================================

/** Reason codes — bounded vocabulary, R-004-clean (no prose, labels, or ids). */
export type DecisionReviewContractRule =
  | 'missing_review_card'
  | 'bias_findings_cap_exceeded'
  | 'decision_quality_prompts_cap_exceeded'
  | 'key_assumptions_cap_exceeded'
  | 'scenario_contexts_cap_exceeded'
  | 'fabricated_continuity_phrase'
  | 'ungrounded_entity_reference';

export interface DecisionReviewContractViolation {
  readonly rule: DecisionReviewContractRule;
  /**
   * Observed magnitude for a count/cap breach (an integer only — NEVER any
   * user text, prose, label, or id). Absent for the boolean rules.
   */
  readonly observed?: number;
}

export interface DecisionReviewContractGateInput {
  /** The run's graph (`invokeInput.graph`), for entity grounding. */
  readonly graph: Record<string, unknown>;
}

export interface DecisionReviewContractResult {
  readonly ok: boolean;
  readonly violations: readonly DecisionReviewContractViolation[];
}

// ============================================================================
// The gate
// ============================================================================

function arrayLength(value: unknown): number | null {
  return Array.isArray(value) ? value.length : null;
}

function objectKeyCount(value: unknown): number | null {
  const record = readRecord(value);
  return record ? Object.keys(record).length : null;
}

/**
 * Run the POST-parse contract gate over a parsed decision_review output.
 *
 * Returns every violated rule (not just the first) so operators see the full
 * failure shape in one telemetry event. `ok === true` ⇔ zero violations ⇔ the
 * review is contract-clean and safe to attach.
 *
 * Pure and total: never throws, never mutates `output`. A rule that cannot be
 * evaluated (field absent, or wrong type — those are the block-parse shape
 * check's remit, not this gate's) is skipped, never counted as a violation,
 * EXCEPT the coverage floor: an absent/empty narrative_summary IS the
 * missing-review-card violation.
 */
export function checkDecisionReviewContract(
  output: Record<string, unknown>,
  input: DecisionReviewContractGateInput,
): DecisionReviewContractResult {
  const violations: DecisionReviewContractViolation[] = [];

  // ── Coverage floor: ≥ 1 review_card ────────────────────────────────────
  // Derived from buildNarrativeCard (phase3-blocks.ts): the primary
  // review_card composes only when narrative_summary is a non-empty
  // (post-trim) string. Anything weaker ships an analysed turn with no review.
  const narrative = output.narrative_summary;
  if (typeof narrative !== 'string' || narrative.trim().length === 0) {
    violations.push({ rule: 'missing_review_card' });
  }

  // ── Contract count caps (tight prompt bound) ────────────────────────────
  const biasLen = arrayLength(output.bias_findings);
  if (biasLen !== null && biasLen > MAX_BIAS_FINDINGS) {
    violations.push({ rule: 'bias_findings_cap_exceeded', observed: biasLen });
  }

  const dqpLen = arrayLength(output.decision_quality_prompts);
  if (dqpLen !== null && dqpLen > MAX_DECISION_QUALITY_PROMPTS) {
    violations.push({ rule: 'decision_quality_prompts_cap_exceeded', observed: dqpLen });
  }

  const kaLen = arrayLength(output.key_assumptions);
  if (kaLen !== null && kaLen > MAX_KEY_ASSUMPTIONS) {
    violations.push({ rule: 'key_assumptions_cap_exceeded', observed: kaLen });
  }

  const scCount = objectKeyCount(output.scenario_contexts);
  if (scCount !== null && scCount > MAX_SCENARIO_CONTEXTS) {
    violations.push({ rule: 'scenario_contexts_cap_exceeded', observed: scCount });
  }

  // ── R-CONT: fabricated conversational callbacks ─────────────────────────
  // Scan every user-facing prose string in the output. One hit fails the
  // review — a single fabricated callback is a fabrication (F14).
  const proseStrings = collectStrings(output);
  let continuityHits = 0;
  for (const str of proseStrings) {
    if (findFabricatedContinuityHit(str) !== null) continuityHits += 1;
  }
  if (continuityHits > 0) {
    violations.push({ rule: 'fabricated_continuity_phrase', observed: continuityHits });
  }

  // ── R-ID / R-BIAS: grounded entity references ───────────────────────────
  // bias_findings[].affected_elements must be valid node/edge ids from the
  // graph. Skipped when the graph carries no id corpus (cannot check).
  const validIds = collectGraphEntityIds(input.graph);
  if (validIds.size > 0 && Array.isArray(output.bias_findings)) {
    let ungrounded = 0;
    for (const raw of output.bias_findings) {
      const finding = readRecord(raw);
      if (!finding) continue;
      const affected = finding.affected_elements;
      if (!Array.isArray(affected)) continue;
      for (const ref of affected) {
        if (typeof ref === 'string' && ref.length > 0 && !validIds.has(ref)) {
          ungrounded += 1;
        }
      }
    }
    if (ungrounded > 0) {
      violations.push({ rule: 'ungrounded_entity_reference', observed: ungrounded });
    }
  }

  return { ok: violations.length === 0, violations };
}

// ============================================================================
// Telemetry shaping (R-004-clean)
// ============================================================================

export interface DecisionReviewContractViolationTelemetry {
  /** Primary violated rule code (sorted-first) — the low-cardinality tag. */
  readonly reason: DecisionReviewContractRule;
  /** Comma-joined sorted set of every violated rule code (bounded vocabulary). */
  readonly reasons: string;
  /** Number of DISTINCT rules violated (a finite integer). */
  readonly violation_count: number;
}

/**
 * Reduce a violating gate result to the reason-tagged telemetry payload.
 * Contains ONLY bounded rule codes and a count — no prose, label, id, or
 * observed-value that could carry user text (R-004). `violations` MUST be
 * non-empty (call only on a failed gate).
 */
export function summariseContractViolations(
  violations: readonly DecisionReviewContractViolation[],
): DecisionReviewContractViolationTelemetry {
  const codes = [...new Set(violations.map((v) => v.rule))].sort();
  return {
    reason: codes[0] as DecisionReviewContractRule,
    reasons: codes.join(','),
    violation_count: codes.length,
  };
}
