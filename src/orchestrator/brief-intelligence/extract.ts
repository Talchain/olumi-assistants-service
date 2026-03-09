/**
 * Brief Intelligence Layer — deterministic extraction from decision brief.
 *
 * Reuses computeBriefSignals() from the CEE signals engine as the core
 * extraction layer, then maps output to the BriefIntelligence schema.
 *
 * No LLM calls, no network, no side effects beyond warning logs on failure.
 * Performance: <50ms for briefs up to 1000 words.
 */

import { computeBriefSignals } from "../../cee/signals/brief-signals.js";
import type { BriefSignals, ConstraintMarker } from "../../cee/signals/types.js";
import { BriefIntelligencePayload, BIL_CONTRACT_VERSION } from "../../schemas/brief-intelligence.js";
import type { BriefIntelligence } from "../../schemas/brief-intelligence.js";
import { matchesStatusQuoLabel } from "../../cee/structure/status-quo-patterns.js";
import { queryDsk } from "../dsk-loader.js";
import type { DSKTrigger } from "../../dsk/types.js";
import { log } from "../../utils/telemetry.js";

// ============================================================================
// Causal language patterns (not covered by BriefSignals)
// ============================================================================

const CAUSAL_PATTERNS = [
  /\b(?:affects?|affecting)\s+(.{3,40}?)(?:[.,;!?]|$)/gi,
  /\b(?:drives?|driving)\s+(.{3,40}?)(?:[.,;!?]|$)/gi,
  /\b(?:depends?\s+on)\s+(.{3,40}?)(?:[.,;!?]|$)/gi,
  /\b(?:influenced?\s+by)\s+(.{3,40}?)(?:[.,;!?]|$)/gi,
  /\b(?:impacts?|impacting)\s+(.{3,40}?)(?:[.,;!?]|$)/gi,
  /\b(?:determines?|determining)\s+(.{3,40}?)(?:[.,;!?]|$)/gi,
];

// ============================================================================
// Causal framing detection (item 32)
// ============================================================================

/**
 * Canonical causal phrase list for causal_framing_score.
 * The UI must use the identical list for client-side preview.
 *
 * Counts distinct phrase matches, not total occurrences.
 *
 * Stronger signals: "because", "leads to", "results in", "causes", "depends on"
 * — these almost always indicate causal reasoning.
 *
 * Weaker signals: "increases", "reduces", "affects", "drives", "prevents"
 * — these can appear in non-causal contexts (e.g. "increases in temperature")
 * but are retained because they correlate with causal framing in decision briefs.
 * Revisit weighting post-pilot if false-positive rate is high.
 */
export const CAUSAL_PHRASES: readonly string[] = [
  "because",
  "leads to",
  "causes",
  "results in",
  "drives",
  "affects",
  "increases",
  "reduces",
  "prevents",
  "depends on",
] as const;

/**
 * Compute causal framing score from brief text.
 *
 * Counts distinct phrase matches, not total occurrences.
 * A phrase that appears 3 times counts as 1 distinct match.
 *
 * 3+ distinct → strong, 1-2 → moderate, 0 → weak
 */
function computeCausalFramingScore(brief: string): 'strong' | 'moderate' | 'weak' {
  const lower = brief.toLowerCase();
  let distinctCount = 0;
  for (const phrase of CAUSAL_PHRASES) {
    // Word-boundary match to avoid matching substrings
    const regex = new RegExp(`\\b${phrase.replace(/\s+/g, '\\s+')}\\b`, 'i');
    if (regex.test(lower)) {
      distinctCount++;
    }
  }
  if (distinctCount >= 3) return 'strong';
  if (distinctCount >= 1) return 'moderate';
  return 'weak';
}

// ============================================================================
// Specificity scoring (item 33)
// ============================================================================

/**
 * Canonical specificity patterns for specificity_score.
 * The UI must use the identical list for client-side preview.
 *
 * Counts distinct pattern matches, not total occurrences.
 *
 * Numeric patterns detect concrete quantitative anchors.
 * Temporal patterns detect concrete time references (quarter+year, half+year, standalone year).
 * "Q3" without a year does NOT match — only "Q3 2026" qualifies.
 * Standalone years are constrained to 2020-2030 (not the broader 2020-2039 range).
 */
export const SPECIFICITY_PATTERNS: readonly RegExp[] = [
  // Numeric: percentage
  /\d+(?:\.\d+)?%/,
  // Numeric: currency amounts (£, $, €)
  /[£$€]\s?\d+/,
  // Numeric: large comma-separated numbers (e.g. 1,000,000)
  /\d{1,3}(?:,\d{3})+/,
  // Numeric: shorthand thousands (e.g. 50k)
  /\d+k\b/i,
  // Numeric: shorthand millions (e.g. 2m, 1.5m)
  /\d+(?:\.\d+)?m\b/i,
  // Temporal: quarter or half with year (Q3 2026, H1 2025) — year required
  /\b(?:Q[1-4]|H[12])\s?\d{4}\b/,
  // Temporal: standalone year in 2020-2030 range
  /\b20(?:2\d|30)\b/,
] as const;

/**
 * Compute specificity score from brief text.
 *
 * Counts distinct pattern matches, not total occurrences.
 * Multiple matches of the same pattern count as 1.
 *
 * 2+ distinct → specific, 1 → moderate, 0 → vague
 */
function computeSpecificityScore(brief: string): 'specific' | 'moderate' | 'vague' {
  let distinctCount = 0;
  for (const pattern of SPECIFICITY_PATTERNS) {
    if (pattern.test(brief)) {
      distinctCount++;
    }
  }
  if (distinctCount >= 2) return 'specific';
  if (distinctCount >= 1) return 'moderate';
  return 'vague';
}

// ============================================================================
// Ambiguity detection
// ============================================================================

const HEDGING_PHRASES = [
  /\b(?:maybe|perhaps|not sure|possibly|might|could be|unclear)\b/gi,
];

const VAGUE_QUANTIFIERS = [
  /\b(?:some|several|many|few|various|numerous)\b(?!\s*\d)/gi,
];

const UNDEFINED_COMPARISONS = [
  /\b(?:better|worse|faster|slower|cheaper|more expensive)\b(?!\s+than\b)/gi,
];

// ============================================================================
// Success condition patterns (fix #5)
// ============================================================================

const SUCCESS_CONDITION_PATTERNS = [
  /\bachieve\s+at\s+least\b/i,
  /\breach\s+\S/i,
  /\btarget\s+of\b/i,
  /\bgoal\s+of\b/i,
  /\baim\s+for\b/i,
  /\bhit\s+\S/i,
  /\bgrow\s+to\b/i,
  /\bkeep\s+above\b/i,
];

const HARD_LIMIT_PATTERNS = [
  /\bmust\s+not\s+exceed\b/i,
  /\bcap\s+at\b/i,
  /\bcannot\s+exceed\b/i,
  /\bno\s+more\s+than\b/i,
  /\bmaximum\b/i,
  /\bbudget\b/i,
  /\bdeadline\b/i,
  /\bkeep\s+below\b/i,
];

// ============================================================================
// Status quo detection
// — Uses shared matchesStatusQuoLabel() from cee/structure/status-quo-patterns.ts.
//   That module is the single source of truth for status quo phrase matching
//   across BIL, structure detectors, and packaging stages.
// ============================================================================

// ============================================================================
// Helpers
// ============================================================================

/** Case-insensitive dedup + alphabetical sort for stable output. */
function dedup(arr: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of arr) {
    const key = item.toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(item.trim());
    }
  }
  return result.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
}

/** Dedup objects by a string key, sort alphabetically by that key. */
function dedupBy<T>(arr: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of arr) {
    const key = keyFn(item).toLowerCase().trim();
    if (key && !seen.has(key)) {
      seen.add(key);
      result.push(item);
    }
  }
  return result.sort((a, b) =>
    keyFn(a).toLowerCase().localeCompare(keyFn(b).toLowerCase()),
  );
}

// ============================================================================
// Mapping helpers
// ============================================================================

function mapGoal(signals: BriefSignals): BriefIntelligence['goal'] {
  if (!signals.has_explicit_goal || signals.goal_markers.length === 0) {
    return null;
  }
  const label = signals.goal_markers[0].trim();
  const measurable = signals.has_measurable_target;
  const confidence = measurable ? 0.9 : 0.7;
  return { label, measurable, confidence };
}

function mapOptions(signals: BriefSignals): BriefIntelligence['options'] {
  const options = signals.option_markers.map((marker) => {
    // Explicit "Option A/B" markers get higher confidence than inferred "or" markers
    const isExplicit = /^option\s+[a-c1-3]/i.test(marker);
    return { label: marker.trim(), confidence: isExplicit ? 0.9 : 0.6 };
  });
  return dedupBy(options, (o) => o.label);
}

function classifyConstraintType(
  marker: ConstraintMarker,
  briefLower: string,
): 'hard_limit' | 'success_condition' | 'guardrail' {
  const source = marker.source_text.toLowerCase();

  // Check success_condition patterns in constraint source text
  for (const pattern of SUCCESS_CONDITION_PATTERNS) {
    if (pattern.test(source)) return 'success_condition';
  }

  // Check hard_limit patterns
  for (const pattern of HARD_LIMIT_PATTERNS) {
    if (pattern.test(source)) return 'hard_limit';
  }

  // Map BriefSignals constraint types
  if (marker.type === 'budget' || marker.type === 'deadline') return 'hard_limit';
  if (marker.type === 'threshold') return 'guardrail';

  return 'guardrail';
}

function mapConstraints(signals: BriefSignals, brief: string): BriefIntelligence['constraints'] {
  const lower = brief.toLowerCase();
  const constraints = signals.constraint_markers.map((marker) => ({
    label: marker.source_text.trim(),
    type: classifyConstraintType(marker, lower),
    confidence: marker.has_value ? 0.8 : 0.5,
  }));
  return dedupBy(constraints, (c) => c.label);
}

function extractFactors(brief: string): BriefIntelligence['factors'] {
  const factors: Array<{ label: string; confidence: number }> = [];
  for (const pattern of CAUSAL_PATTERNS) {
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(brief)) !== null) {
      const label = match[1].trim().replace(/[.,;!?]+$/, '').trim();
      if (label.length >= 3 && label.split(/\s+/).length <= 6) {
        factors.push({ label, confidence: 0.6 });
      }
    }
  }
  return dedupBy(factors, (f) => f.label);
}

function mapCompletenessBand(signals: BriefSignals): BriefIntelligence['completeness_band'] {
  // strong → high, ok → medium, weak → low
  if (signals.brief_strength === 'strong') return 'high';
  if (signals.brief_strength === 'ok') return 'medium';
  return 'low';
}

function detectAmbiguityFlags(brief: string): string[] {
  const flags: string[] = [];
  for (const pattern of HEDGING_PHRASES) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(brief)) !== null) {
      flags.push(`Hedging: "${m[0].trim()}"`);
    }
  }
  for (const pattern of VAGUE_QUANTIFIERS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(brief)) !== null) {
      flags.push(`Vague quantifier: "${m[0].trim()}"`);
    }
  }
  for (const pattern of UNDEFINED_COMPARISONS) {
    pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(brief)) !== null) {
      flags.push(`Undefined comparison: "${m[0].trim()}"`);
    }
  }
  return dedup(flags);
}

function computeMissingElements(
  signals: BriefSignals,
  brief: string,
): BriefIntelligence['missing_elements'] {
  const missing: BriefIntelligence['missing_elements'] = [];

  if (!signals.has_explicit_goal) missing.push('goal');
  if (!signals.has_constraints) missing.push('constraints');
  if (!signals.has_measurable_target) missing.push('success_metric');
  if (!signals.has_risks) missing.push('risk_factors');

  // Check for time_horizon: no deadline-type constraint
  const hasTimeline = signals.constraint_markers.some(
    (m) => m.type === 'deadline',
  );
  if (!hasTimeline) missing.push('time_horizon');

  // Check for status_quo_option: no option resembling "keep current"
  // Uses shared matchesStatusQuoLabel() — single source of truth for status quo phrases.
  const hasStatusQuo = matchesStatusQuoLabel(brief);
  if (!hasStatusQuo) missing.push('status_quo_option');

  return missing.sort();
}

function matchDskCues(
  brief: string,
  signals: BriefSignals,
  stage: string,
): BriefIntelligence['dsk_cues'] {
  const cues: BriefIntelligence['dsk_cues'] = [];
  const lower = brief.toLowerCase();

  // Map bias_signals from BriefSignals (these have no DSK claim_id)
  for (const bias of signals.bias_signals) {
    cues.push({
      bias_type: bias.type,
      signal: bias.evidence,
      claim_id: null,
      confidence: 0.8,
    });
  }

  // Query DSK triggers if available
  try {
    const dskObjects = queryDsk(stage, [], []);
    const triggers = dskObjects.filter(
      (obj): obj is DSKTrigger => obj.type === 'trigger',
    );

    for (const trigger of triggers) {
      // Conservative: only match if the observable_signal keyword appears in the brief
      const signalWords = trigger.observable_signal
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);

      // Require at least 2 signal words to match, or exact phrase for short signals
      const matchCount = signalWords.filter((w) => lower.includes(w)).length;
      const isMatch =
        signalWords.length <= 2
          ? lower.includes(trigger.observable_signal.toLowerCase())
          : matchCount >= Math.ceil(signalWords.length * 0.6);

      if (isMatch && trigger.linked_claim_ids.length > 0) {
        cues.push({
          bias_type: trigger.title,
          signal: trigger.observable_signal,
          claim_id: trigger.linked_claim_ids[0],
          confidence: 0.7,
        });
      }
    }
  } catch {
    // DSK query failed (bundle not loaded) — continue without DSK cues
  }

  return dedupBy(cues, (c) => `${c.bias_type}:${c.signal}`);
}

// ============================================================================
// Minimal fallback
// ============================================================================

const FALLBACK: BriefIntelligence = {
  contract_version: BIL_CONTRACT_VERSION,
  goal: null,
  options: [],
  constraints: [],
  factors: [],
  completeness_band: 'low',
  causal_framing_score: 'weak',
  specificity_score: 'vague',
  ambiguity_flags: [],
  missing_elements: ['goal', 'constraints', 'risk_factors', 'status_quo_option', 'success_metric', 'time_horizon'],
  dsk_cues: [],
};

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Extract Brief Intelligence from a decision brief.
 *
 * Deterministic, no LLM calls, no network. Uses computeBriefSignals() as the
 * core extraction engine and maps to the BIL schema.
 *
 * @param brief - Raw decision brief text
 * @param _dskBundle - Unused; DSK triggers are queried via the process-level singleton
 * @param stage - Decision stage for DSK trigger filtering (default: 'frame')
 * @returns Validated BriefIntelligence payload, or minimal fallback on failure
 */
export function extractBriefIntelligence(
  brief: string,
  _dskBundle?: unknown,
  stage: string = 'frame',
): BriefIntelligence {
  try {
    const signals = computeBriefSignals(brief);

    const payload: BriefIntelligence = {
      contract_version: BIL_CONTRACT_VERSION,
      goal: mapGoal(signals),
      options: mapOptions(signals),
      constraints: mapConstraints(signals, brief),
      factors: extractFactors(brief),
      completeness_band: mapCompletenessBand(signals),
      causal_framing_score: computeCausalFramingScore(brief),
      specificity_score: computeSpecificityScore(brief),
      ambiguity_flags: detectAmbiguityFlags(brief),
      missing_elements: computeMissingElements(signals, brief),
      dsk_cues: matchDskCues(brief, signals, stage),
    };

    const result = BriefIntelligencePayload.safeParse(payload);
    if (!result.success) {
      log.warn(
        { errors: result.error.flatten(), brief_length: brief.length },
        'BIL extraction: safeParse failed, returning fallback',
      );
      return FALLBACK;
    }

    return result.data;
  } catch (error) {
    log.warn(
      { error: error instanceof Error ? error.message : String(error), brief_length: brief.length },
      'BIL extraction: unexpected error, returning fallback',
    );
    return FALLBACK;
  }
}
