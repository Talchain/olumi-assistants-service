/**
 * Deterministic scorer for decision_review LLM responses.
 *
 * Scores are rule-based — no LLM judge. Ten dimensions:
 * 1. valid_json (0.10)
 * 2. schema_complete (0.10)
 * 3. story_headlines_match (0.10)
 * 4. evidence_enhancements_coverage (0.10)
 * 5. scenario_contexts_valid (0.10)
 * 6. grounding_compliance (0.15)
 * 7. tone_alignment (0.10)
 * 8. bias_findings_grounded (0.10)
 * 9. dsk_fields_correct (0.05)
 * 10. pre_mortem_correct (0.10)
 */

import type {
  DecisionReviewFixture,
  DecisionReviewScore,
} from "./types.js";

// =============================================================================
// Tone rules
// =============================================================================

interface ToneRule {
  forbidden: RegExp[];
}

const TONE_RULES: Record<string, ToneRule> = {
  confident: {
    forbidden: [],
  },
  balanced: {
    forbidden: [
      /\bclear winner\b/i,
      /\bobvious\b/i,
      /\bdefinitely\b/i,
    ],
  },
  cautious: {
    forbidden: [
      /\bready to proceed\b/i,
      /\bconfident\b/i,
      /\bclear choice\b/i,
    ],
  },
  structural: {
    forbidden: [
      /\bready\b/i,
      /\bconfident\b/i,
      /\bclear\b/i,
    ],
  },
};

// =============================================================================
// Required schema keys
// =============================================================================

const REQUIRED_TOP_KEYS = [
  "narrative_summary",
  "story_headlines",
  "evidence_enhancements",
  "scenario_contexts",
  "bias_findings",
  "readiness_rationale",
];

// =============================================================================
// Number extraction from text fields
// =============================================================================

/**
 * Extract all numeric values from narrative text fields.
 * Returns field_path → number pairs for grounding checks.
 */
function extractNumbers(
  obj: unknown,
  path: string,
  results: Array<{ value: number; field_path: string }>
): void {
  if (typeof obj === "string") {
    // Match numbers: integers, decimals, percentages (just the number part)
    const matches = obj.matchAll(/(?<!\w)(\d+(?:\.\d+)?)\s*%?(?!\w)/g);
    for (const match of matches) {
      const num = parseFloat(match[1]);
      if (!isNaN(num)) {
        results.push({ value: num, field_path: path });
      }
    }
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      extractNumbers(obj[i], `${path}[${i}]`, results);
    }
    return;
  }
  if (obj && typeof obj === "object") {
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      extractNumbers(val, `${path}.${key}`, results);
    }
  }
}

/**
 * Extract all numbers from the input payload for grounding validation.
 */
function extractInputNumbers(input: DecisionReviewFixture["input"]): Set<number> {
  const numbers = new Set<number>();

  // Add explicit numeric values from the input
  numbers.add(input.winner.win_probability);
  numbers.add(input.winner.outcome_mean);
  if (input.margin !== null) numbers.add(input.margin);

  if (input.runner_up) {
    numbers.add(input.runner_up.win_probability);
    numbers.add(input.runner_up.outcome_mean);
  }

  for (const opt of input.isl_results.option_comparison) {
    numbers.add(opt.win_probability);
    numbers.add(opt.outcome.mean);
    numbers.add(opt.outcome.p10);
    numbers.add(opt.outcome.p90);
  }

  for (const fs of input.isl_results.factor_sensitivity) {
    numbers.add(fs.elasticity);
    numbers.add(fs.confidence);
  }

  for (const fe of input.isl_results.fragile_edges) {
    numbers.add(fe.switch_probability);
  }

  numbers.add(input.isl_results.robustness.recommendation_stability);
  numbers.add(input.isl_results.robustness.overall_confidence);

  for (const eg of input.deterministic_coaching.evidence_gaps) {
    numbers.add(eg.voi);
    numbers.add(eg.confidence);
  }

  // Also add percentage conversions (0.72 ↔ 72)
  const derived = new Set<number>();
  for (const n of numbers) {
    if (n >= 0 && n <= 1) derived.add(n * 100);
    if (n >= 1 && n <= 100) derived.add(n / 100);
  }
  for (const d of derived) numbers.add(d);

  return numbers;
}

/**
 * Check if a number is grounded in the input (within ±10% tolerance).
 */
function isGrounded(value: number, inputNumbers: Set<number>): boolean {
  if (value === 0) return true; // Zero is always grounded
  for (const ref of inputNumbers) {
    if (ref === 0) continue;
    const diff = Math.abs(value - ref) / Math.abs(ref);
    if (diff <= 0.10) return true;
  }
  // Also allow exact match for small integers (1-10) which may be counts
  if (Number.isInteger(value) && value >= 1 && value <= 10) return true;
  return false;
}

// =============================================================================
// Fields to check for grounding
// =============================================================================

const NARRATIVE_FIELDS = [
  "narrative_summary",
  "robustness_explanation",
  "readiness_rationale",
  "scenario_contexts",
  "flip_thresholds",
];

// =============================================================================
// Fields to exclude from grounding penalty
// =============================================================================

function isExcludedPath(path: string): boolean {
  // Exclude IDs, claim IDs, protocol IDs
  if (path.includes("_id") || path.includes("claim_id") || path.includes("protocol_id")) return true;
  // Exclude brief_evidence fields
  if (path.includes("brief_evidence")) return true;
  return false;
}

// =============================================================================
// Main scoring function
// =============================================================================

export function scoreDecisionReview(
  fixture: DecisionReviewFixture,
  parsed: Record<string, unknown> | null,
  dskClaimIds?: Set<string>
): DecisionReviewScore {
  const nullScore: DecisionReviewScore = {
    valid_json: false,
    schema_complete: false,
    story_headlines_match: false,
    evidence_enhancements_coverage: false,
    scenario_contexts_valid: false,
    grounding_compliance: false,
    tone_alignment: false,
    bias_findings_grounded: false,
    dsk_fields_correct: false,
    pre_mortem_correct: false,
    overall: 0,
    unmatched_numbers: [],
  };

  // 1. valid_json
  if (!parsed) return nullScore;
  const valid_json = true;

  // 2. schema_complete — all required keys present
  const schema_complete = REQUIRED_TOP_KEYS.every(
    (key) => key in parsed
  );

  // 3. story_headlines_match — keys match option_comparison option_ids
  let story_headlines_match = false;
  const storyHeadlines = parsed.story_headlines as Record<string, unknown> | undefined;
  if (storyHeadlines && typeof storyHeadlines === "object") {
    const expectedOptionIds = new Set(
      fixture.input.isl_results.option_comparison.map((o) => o.option_id)
    );
    const actualKeys = new Set(Object.keys(storyHeadlines));
    story_headlines_match =
      expectedOptionIds.size === actualKeys.size &&
      [...expectedOptionIds].every((id) => actualKeys.has(id));
  }

  // 4. evidence_enhancements_coverage — top 3 VOI gaps covered
  let evidence_enhancements_coverage = false;
  const evidenceEnhancements = parsed.evidence_enhancements as
    | Record<string, unknown>
    | undefined;
  if (evidenceEnhancements && typeof evidenceEnhancements === "object") {
    const topGaps = [...fixture.input.deterministic_coaching.evidence_gaps]
      .sort((a, b) => b.voi - a.voi)
      .slice(0, 3);

    if (topGaps.length === 0) {
      evidence_enhancements_coverage = true;
    } else {
      const enhancementKeys = Object.keys(evidenceEnhancements);
      const enhancementText = JSON.stringify(evidenceEnhancements).toLowerCase();
      const covered = topGaps.filter(
        (gap) =>
          enhancementKeys.includes(gap.factor_id) ||
          enhancementText.includes(gap.factor_label.toLowerCase())
      );
      evidence_enhancements_coverage = covered.length >= Math.min(topGaps.length, 3);
    }
  } else if (fixture.input.deterministic_coaching.evidence_gaps.length === 0) {
    evidence_enhancements_coverage = true;
  }

  // 5. scenario_contexts_valid — keys are valid fragile edge_ids
  let scenario_contexts_valid = false;
  const scenarioContexts = parsed.scenario_contexts as
    | Record<string, unknown>
    | undefined;
  if (scenarioContexts && typeof scenarioContexts === "object") {
    const fragileEdgeIds = new Set(
      fixture.input.isl_results.fragile_edges.map((e) => e.edge_id)
    );
    const contextKeys = Object.keys(scenarioContexts);
    if (contextKeys.length === 0 && fragileEdgeIds.size === 0) {
      scenario_contexts_valid = true;
    } else if (contextKeys.length > 0) {
      scenario_contexts_valid = contextKeys.every(
        (key) => fragileEdgeIds.has(key)
      );
    }
  } else if (fixture.input.isl_results.fragile_edges.length === 0) {
    scenario_contexts_valid = true;
  }

  // 6. grounding_compliance — check numbers in narrative fields
  const inputNumbers = extractInputNumbers(fixture.input);
  const outputNumbers: Array<{ value: number; field_path: string }> = [];

  for (const field of NARRATIVE_FIELDS) {
    if (field in parsed) {
      extractNumbers(parsed[field], field, outputNumbers);
    }
  }

  // Filter out excluded paths
  const checkableNumbers = outputNumbers.filter(
    (n) => !isExcludedPath(n.field_path)
  );

  let grounding_compliance = true;
  const unmatched_numbers: Array<{ value: number; field_path: string }> = [];
  if (checkableNumbers.length > 0) {
    for (const num of checkableNumbers) {
      if (!isGrounded(num.value, inputNumbers)) {
        unmatched_numbers.push(num);
      }
    }
    grounding_compliance =
      unmatched_numbers.length / checkableNumbers.length <= 0.2;
  }

  // 7. tone_alignment — no forbidden phrases for given tone
  let tone_alignment = true;
  const toneRule = TONE_RULES[fixture.expected.tone];
  if (toneRule) {
    const fullText = JSON.stringify(parsed);
    // Check fixture-level forbidden phrases
    const allForbidden = [
      ...toneRule.forbidden,
      ...(fixture.expected.forbidden_phrases ?? []).map(
        (p) => new RegExp(`\\b${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")
      ),
    ];
    for (const pattern of allForbidden) {
      if (pattern.test(fullText)) {
        tone_alignment = false;
        break;
      }
    }
  }

  // 8. bias_findings_grounded — structural have linked_critique_code, semantic have brief_evidence
  let bias_findings_grounded = true;
  const biasFindings = parsed.bias_findings as unknown[];
  if (Array.isArray(biasFindings) && biasFindings.length > 0) {
    for (const finding of biasFindings) {
      const f = finding as Record<string, unknown>;
      const biasType = f.type as string | undefined;
      if (biasType === "structural") {
        if (!f.linked_critique_code || typeof f.linked_critique_code !== "string") {
          bias_findings_grounded = false;
          break;
        }
      } else if (biasType === "semantic") {
        if (!f.brief_evidence || typeof f.brief_evidence !== "string") {
          bias_findings_grounded = false;
          break;
        }
      }
    }
  } else if (
    fixture.expected.bias_types_expected &&
    fixture.expected.bias_types_expected.length > 0
  ) {
    bias_findings_grounded = false;
  }

  // 9. dsk_fields_correct — syntactic validity only
  let dsk_fields_correct = true;
  if (fixture.expected.dsk_fields_expected) {
    if (!Array.isArray(biasFindings) || biasFindings.length === 0) {
      dsk_fields_correct = false;
    } else {
      // Must have at least one structural finding when DSK is expected
      const structuralFindings = biasFindings.filter(
        (bf) => (bf as Record<string, unknown>).type === "structural"
      );
      if (structuralFindings.length === 0) {
        dsk_fields_correct = false;
      } else {
        for (const finding of structuralFindings) {
          const f = finding as Record<string, unknown>;

          const claimId = f.dsk_claim_id as string | undefined;
          const evidenceStrength = f.evidence_strength as string | undefined;

          if (!claimId || !evidenceStrength) {
            dsk_fields_correct = false;
            break;
          }

          if (dskClaimIds && !dskClaimIds.has(claimId)) {
            dsk_fields_correct = false;
            break;
          }

          if (evidenceStrength !== "strong" && evidenceStrength !== "medium") {
            dsk_fields_correct = false;
            break;
          }
        }
      }
    }
  } else {
    // DSK not expected — check that no dsk fields are present (or skip)
    dsk_fields_correct = true;
  }

  // 10. pre_mortem_correct — present when expected, grounded_in non-empty
  let pre_mortem_correct = true;
  const premortem = parsed.pre_mortem as Record<string, unknown> | undefined;
  if (fixture.expected.pre_mortem_expected) {
    if (!premortem || typeof premortem !== "object") {
      pre_mortem_correct = false;
    } else {
      const groundedIn = premortem.grounded_in;
      if (!Array.isArray(groundedIn) || groundedIn.length === 0) {
        pre_mortem_correct = false;
      }
    }
  } else {
    // Pre-mortem not expected — not penalised if present
    pre_mortem_correct = true;
  }

  // Overall weighted score
  const overall =
    (valid_json ? 0.10 : 0) +
    (schema_complete ? 0.10 : 0) +
    (story_headlines_match ? 0.10 : 0) +
    (evidence_enhancements_coverage ? 0.10 : 0) +
    (scenario_contexts_valid ? 0.10 : 0) +
    (grounding_compliance ? 0.15 : 0) +
    (tone_alignment ? 0.10 : 0) +
    (bias_findings_grounded ? 0.10 : 0) +
    (dsk_fields_correct ? 0.05 : 0) +
    (pre_mortem_correct ? 0.10 : 0);

  return {
    valid_json,
    schema_complete,
    story_headlines_match,
    evidence_enhancements_coverage,
    scenario_contexts_valid,
    grounding_compliance,
    tone_alignment,
    bias_findings_grounded,
    dsk_fields_correct,
    pre_mortem_correct,
    overall,
    unmatched_numbers,
  };
}
