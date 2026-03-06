/**
 * BriefSignals extraction engine — deterministic brief quality analysis.
 *
 * Computes `BriefSignals` from a raw brief string using pure regex/string
 * matching. No external calls, no NLP, no side effects.
 *
 * **Performance contract:** <50ms for briefs up to 1000 words.
 *
 * **Compute-once rule:** Call `computeBriefSignals()` exactly once per request
 * inside `evaluatePreflightDecision()`. Attach to the decision result. All
 * downstream consumers read from there — never recompute.
 */

import type {
  BriefSignals,
  NumericAnchor,
  ConstraintMarker,
  BiasSignal,
  MissingItem,
} from "./types.js";

// ============================================================================
// Configuration constants — phrase/verb lists for testability
// ============================================================================

/** Stage A: Decision framing phrases (word-boundary matched). */
export const DECISION_FRAMING_PHRASES = [
  "should we",
  "should i",
  "whether to",
  "decide between",
  "deciding if",
  "the question is",
  "we need to choose",
  "considering whether",
] as const;

/** Stage B: Alternative indicator phrases. */
export const ALTERNATIVE_INDICATOR_PHRASES = [
  "option a",
  "option b",
  "option c",
  "option 1",
  "option 2",
  "option 3",
  "vs",
  "versus",
  "compared to",
  "alternatively",
  "or we could",
] as const;

/** Goal verbs (infinitive form, word-boundary matched). */
export const GOAL_VERBS = [
  "maximise",
  "maximize",
  "minimise",
  "minimize",
  "reduce",
  "increase",
  "achieve",
  "reach",
  "maintain",
  "improve",
  "grow",
  "optimise",
  "optimize",
] as const;

/** Target-role verbs — highest precedence for anchor role classification. */
export const TARGET_VERBS = [
  "reach",
  "achieve",
  "hit",
  "target of",
  "aim for",
  "goal of",
  "keep below",
  "keep above",
  "grow to",
  "reduce to",
] as const;

/** Constraint-role verbs. */
export const CONSTRAINT_VERBS = [
  "cap",
  "budget of",
  "deadline",
  "must not exceed",
  "limit of",
  "maximum",
  "cannot exceed",
] as const;

/** State/baseline-role verbs. */
export const STATE_VERBS = [
  "currently",
  "we have",
  "we're at",
  "existing",
  "right now",
  "at the moment",
] as const;

/** Change verbs — used for baseline detection. */
export const CHANGE_VERBS = [
  "raise",
  "increase",
  "reduce",
  "cut",
  "lower",
  "grow",
] as const;

/** Explicit uncertainty phrases — baseline_state: unknown_explicit. */
export const UNCERTAINTY_PHRASES = [
  "currently unknown",
  "varies",
  "not sure of the exact",
  "hard to measure",
  "we don't track",
  "difficult to quantify",
] as const;

/** Constraint indicator words. */
export const CONSTRAINT_WORDS = [
  "budget",
  "deadline",
  "must not",
  "cannot exceed",
  "limit",
  "cap",
  "maximum",
  "minimum",
  "at least",
  "no more than",
] as const;

/** Risk indicator words. */
export const RISK_WORDS = [
  "risk",
  "worried",
  "concerned",
  "fear",
  "danger",
  "threat",
  "downside",
  "what if",
  "could go wrong",
] as const;

/** Sunk cost bias phrases (exact match, word boundaries). */
export const SUNK_COST_PHRASES = [
  "we've already spent",
  "we've already invested",
  "after all the work we've put in",
  "too late to change",
  "can't abandon now",
  "we've come too far",
  "money already committed",
  "time already invested",
  "built so much already",
] as const;

// ============================================================================
// Helpers
// ============================================================================

/** Split text into sentences (simple regex — no NLP). */
function splitSentences(text: string): string[] {
  return text
    .split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Word-boundary regex for a phrase. */
function wordBoundaryRegex(phrase: string): RegExp {
  return new RegExp(`\\b${phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

/** Count words in text. */
function countWords(text: string): number {
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

// ============================================================================
// 1a. Alternative option detection
// ============================================================================

interface AlternativeResult {
  option_count_estimate: number;
  option_markers: string[];
}

function detectAlternatives(text: string): AlternativeResult {
  const lower = text.toLowerCase();
  const markers: string[] = [];

  // Stage A: decision framing
  let hasFraming = false;
  for (const phrase of DECISION_FRAMING_PHRASES) {
    if (wordBoundaryRegex(phrase).test(lower)) {
      hasFraming = true;
      markers.push(phrase);
      break;
    }
  }

  // Stage B: distinct alternatives
  let alternativeCount = 0;

  // Check explicit option labels (Option A/B/C/1/2/3)
  const optionLabelMatches = lower.match(/\boption\s+[a-c1-3]\b/gi);
  if (optionLabelMatches) {
    const unique = new Set(optionLabelMatches.map((m) => m.toLowerCase()));
    alternativeCount = Math.max(alternativeCount, unique.size);
    for (const m of unique) markers.push(m.trim());
  }

  // Check "vs" / "versus" / "compared to"
  for (const phrase of ["vs", "versus", "compared to"] as const) {
    if (wordBoundaryRegex(phrase).test(lower)) {
      alternativeCount = Math.max(alternativeCount, 2);
      markers.push(phrase);
    }
  }

  // Check "alternatively" / "or we could"
  for (const phrase of ["alternatively", "or we could"] as const) {
    if (wordBoundaryRegex(phrase).test(lower)) {
      alternativeCount = Math.max(alternativeCount, 2);
      markers.push(phrase);
    }
  }

  // Check "or"-joined verb phrases — detect verb immediately after "or" (the
  // word before "or" may be a number, noun, etc. so we only require the word
  // after "or" to be a verb). Exclude noun-list "or" (e.g., "revenue or profit").
  const orVerbPattern = /[,;]?\s+or\s+(\w+)\b/gi;
  const commonVerbs = new Set([
    "raise", "stay", "keep", "buy", "sell", "build", "hire", "fire", "cut",
    "grow", "move", "launch", "stop", "start", "drop", "hold", "wait",
    "invest", "expand", "reduce", "increase", "switch", "change", "merge",
    "outsource", "insource", "upgrade", "downgrade", "renew", "cancel",
    "introduce", "consolidate", "close", "scale", "pause", "continue",
  ]);
  const verbSuffixes = /(?:ing|ed|ise|ize|ate|fy|en)$/i;
  let orMatch: RegExpExecArray | null;
  while ((orMatch = orVerbPattern.exec(text)) !== null) {
    const after = orMatch[1].toLowerCase();
    if (verbSuffixes.test(after) || commonVerbs.has(after)) {
      alternativeCount = Math.max(alternativeCount, 2);
      markers.push(`or ${orMatch[1]}`);
    }
  }

  // Determine final count
  if (hasFraming && alternativeCount > 0) {
    return {
      option_count_estimate: Math.min(alternativeCount, 6),
      option_markers: [...new Set(markers)],
    };
  }
  if (hasFraming) {
    return { option_count_estimate: 1, option_markers: markers };
  }
  if (alternativeCount > 0) {
    return {
      option_count_estimate: Math.min(alternativeCount, 6),
      option_markers: [...new Set(markers)],
    };
  }
  return { option_count_estimate: 0, option_markers: [] };
}

// ============================================================================
// 1b. Goal detection
// ============================================================================

interface GoalResult {
  has_explicit_goal: boolean;
  goal_markers: string[];
}

function detectGoal(text: string): GoalResult {
  const lower = text.toLowerCase();
  const markers: string[] = [];

  for (const verb of GOAL_VERBS) {
    const regex = wordBoundaryRegex(verb);
    const match = regex.exec(lower);
    if (match) {
      // Capture surrounding context (up to 30 chars around the match)
      const start = Math.max(0, match.index - 10);
      const end = Math.min(text.length, match.index + match[0].length + 20);
      markers.push(text.slice(start, end).trim());
    }
  }

  return {
    has_explicit_goal: markers.length > 0,
    goal_markers: [...new Set(markers)],
  };
}

// ============================================================================
// 1c. Numeric anchor extraction and role classification
// ============================================================================

/**
 * Extract numeric anchors from text.
 * Normalises: 200k→200000, 4.5m→4500000, 50%→50 (percentage points).
 * Excludes years (1900–2099) and ordinals ("1st", "2nd").
 */
function extractNumericAnchors(text: string): NumericAnchor[] {
  const anchors: NumericAnchor[] = [];
  // Match numbers with optional currency prefix and unit suffix
  const numPattern =
    /(?:[£$€])?\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(%|k|m|bn|months?|years?|weeks?|days?)?/gi;

  const sentences = splitSentences(text);

  for (const sentence of sentences) {
    let match: RegExpExecArray | null;
    const sentencePattern = new RegExp(numPattern.source, "gi");

    while ((match = sentencePattern.exec(sentence)) !== null) {
      const rawValue = match[1].replace(/,/g, "");
      let value = parseFloat(rawValue);
      const unitRaw = match[2]?.toLowerCase() ?? null;
      const fullMatch = match[0].trim();

      // Extract currency prefix
      const currencyMatch = fullMatch.match(/^[£$€]/);
      const currencyUnit = currencyMatch ? currencyMatch[0] : null;

      // Exclude years (4-digit numbers 1900–2099 without unit)
      if (
        !unitRaw &&
        !currencyUnit &&
        value >= 1900 &&
        value <= 2099 &&
        Number.isInteger(value)
      ) {
        continue;
      }

      // Exclude ordinals: check if ordinal suffix immediately follows the digit(s)
      const digitEnd = match.index + match[0].length;
      const afterText = sentence.slice(digitEnd, digitEnd + 2).toLowerCase();
      if (afterText === "st" || afterText === "nd" || afterText === "rd" || afterText === "th") {
        continue;
      }

      // Normalise multipliers
      if (unitRaw === "k") value *= 1000;
      else if (unitRaw === "m") value *= 1000000;
      else if (unitRaw === "bn") value *= 1000000000;

      const unit = currencyUnit ?? unitRaw;

      // Role classification within same sentence
      const role = classifyAnchorRole(sentence, fullMatch);

      anchors.push({
        value,
        unit,
        role,
        source_text: fullMatch,
      });
    }
  }

  return anchors;
}

/**
 * Classify a numeric anchor's role based on adjacent verb context
 * within the same sentence.
 *
 * Precedence: target > constraint > baseline > context
 */
function classifyAnchorRole(
  sentence: string,
  _anchorText: string
): NumericAnchor["role"] {
  const lower = sentence.toLowerCase();

  // Precedence 1: target verbs
  for (const verb of TARGET_VERBS) {
    if (wordBoundaryRegex(verb).test(lower)) return "target";
  }
  // Precedence 2: constraint verbs
  for (const verb of CONSTRAINT_VERBS) {
    if (wordBoundaryRegex(verb).test(lower)) return "constraint";
  }
  // Precedence 3: baseline/state verbs
  for (const verb of STATE_VERBS) {
    if (wordBoundaryRegex(verb).test(lower)) return "baseline";
  }
  // Default
  return "context";
}

// ============================================================================
// 1d. Baseline detection
// ============================================================================

function detectBaseline(
  text: string,
  anchors: NumericAnchor[]
): {
  baseline_state: BriefSignals["baseline_state"];
  baseline_markers: NumericAnchor[];
} {
  const lower = text.toLowerCase();
  const sentences = splitSentences(text);

  // Check for explicit uncertainty
  for (const phrase of UNCERTAINTY_PHRASES) {
    if (wordBoundaryRegex(phrase).test(lower)) {
      return { baseline_state: "unknown_explicit", baseline_markers: [] };
    }
  }

  // Check for change verb + "from" and "to" in same sentence
  for (const sentence of sentences) {
    const sLower = sentence.toLowerCase();
    const hasChangeVerb = CHANGE_VERBS.some((v) =>
      wordBoundaryRegex(v).test(sLower)
    );
    if (hasChangeVerb && /\bfrom\b/i.test(sLower) && /\bto\b/i.test(sLower)) {
      const baselineAnchors = anchors.filter((a) => a.role === "baseline");
      return { baseline_state: "present", baseline_markers: baselineAnchors };
    }
  }

  // Check for state verb + numeric value
  const baselineAnchors = anchors.filter((a) => a.role === "baseline");
  if (baselineAnchors.length > 0) {
    return { baseline_state: "present", baseline_markers: baselineAnchors };
  }

  // Check for state verb + qualitative state
  for (const verb of STATE_VERBS) {
    if (wordBoundaryRegex(verb).test(lower)) {
      // State verb present without numeric — check for qualitative descriptor
      const qualitativePattern =
        /\b(?:currently|existing|right now|at the moment)\s+\w+/i;
      if (qualitativePattern.test(lower)) {
        return { baseline_state: "present", baseline_markers: [] };
      }
    }
  }

  // Check if change verb + target present but no baseline
  const hasChangeVerb = CHANGE_VERBS.some((v) =>
    wordBoundaryRegex(v).test(lower)
  );
  const hasTarget = anchors.some((a) => a.role === "target");
  if (hasChangeVerb && hasTarget) {
    return { baseline_state: "missing", baseline_markers: [] };
  }

  return { baseline_state: "missing", baseline_markers: [] };
}

// ============================================================================
// 1e. Constraint and risk detection
// ============================================================================

function detectConstraints(text: string, anchors: NumericAnchor[]): {
  has_constraints: boolean;
  constraint_markers: ConstraintMarker[];
} {
  const lower = text.toLowerCase();
  const sentences = splitSentences(text);
  const markers: ConstraintMarker[] = [];

  for (const word of CONSTRAINT_WORDS) {
    if (!wordBoundaryRegex(word).test(lower)) continue;

    // Find the sentence containing this constraint word
    const sentenceWithConstraint = sentences.find((s) =>
      wordBoundaryRegex(word).test(s.toLowerCase())
    );

    // Classify type
    let type: ConstraintMarker["type"] = "other";
    if (/budget/i.test(word)) type = "budget";
    else if (/deadline/i.test(word)) type = "deadline";
    else if (/maximum|minimum|at least|no more than|must not|cannot exceed|limit|cap/i.test(word))
      type = "threshold";

    // Check if a numeric value is in the same sentence
    const hasValue =
      sentenceWithConstraint !== undefined &&
      anchors.some((a) => {
        const anchorInSentence = sentenceWithConstraint
          .toLowerCase()
          .includes(a.source_text.toLowerCase());
        return anchorInSentence;
      });

    markers.push({
      type,
      has_value: hasValue,
      source_text: sentenceWithConstraint?.slice(0, 60) ?? word,
    });
  }

  return {
    has_constraints: markers.length > 0,
    constraint_markers: markers,
  };
}

function detectRisks(text: string): {
  has_risks: boolean;
  risk_markers: string[];
} {
  const lower = text.toLowerCase();
  const markers: string[] = [];

  for (const word of RISK_WORDS) {
    if (wordBoundaryRegex(word).test(lower)) {
      markers.push(word);
    }
  }

  return {
    has_risks: markers.length > 0,
    risk_markers: markers,
  };
}

// ============================================================================
// 1f. Bias detection
// ============================================================================

function detectBias(text: string, anchors: NumericAnchor[]): BiasSignal[] {
  const lower = text.toLowerCase();
  const signals: BiasSignal[] = [];

  // Sunk cost detection
  for (const phrase of SUNK_COST_PHRASES) {
    if (wordBoundaryRegex(phrase).test(lower)) {
      signals.push({
        type: "sunk_cost",
        confidence: "high",
        evidence: phrase,
      });
      break; // One sunk_cost signal is sufficient
    }
  }

  // Single-number anchoring detection
  // Exclude single-digit numbers without currency/percentage unit
  const significantAnchors = anchors.filter(
    (a) => !(a.value >= 1 && a.value <= 9 && !a.unit)
  );

  // Count distinct numeric values
  const distinctValues = new Set(significantAnchors.map((a) => a.value));

  if (distinctValues.size === 1 && significantAnchors.length > 0) {
    const sentences = splitSentences(text);
    const firstSentence = sentences[0]?.toLowerCase() ?? "";
    const theAnchor = significantAnchors[0];
    const anchorInFirstSentence = firstSentence.includes(
      theAnchor.source_text.toLowerCase()
    );

    // Count occurrences of this value
    const valueOccurrences = significantAnchors.length;

    if (anchorInFirstSentence || valueOccurrences >= 2) {
      signals.push({
        type: "anchoring",
        confidence: "high",
        evidence: `${theAnchor.source_text} (single numeric reference)`,
      });
    }
  }

  return signals;
}

// ============================================================================
// 1g. Brief strength
// ============================================================================

function computeStrength(
  optionCount: number,
  hasMeasurableTarget: boolean,
  hasExplicitGoal: boolean,
  baselineState: BriefSignals["baseline_state"],
  hasConstraints: boolean,
  wordCount: number
): BriefSignals["brief_strength"] {
  if (
    optionCount >= 2 &&
    hasMeasurableTarget &&
    (baselineState !== "missing" || hasConstraints) &&
    wordCount >= 30
  ) {
    return "strong";
  }

  if (
    optionCount >= 1 &&
    (hasExplicitGoal || hasMeasurableTarget) &&
    wordCount >= 15
  ) {
    return "ok";
  }

  return "weak";
}

// ============================================================================
// 1h. Missing items
// ============================================================================

function computeMissingItems(
  signals: Pick<
    BriefSignals,
    | "option_count_estimate"
    | "option_markers"
    | "has_measurable_target"
    | "baseline_state"
    | "has_constraints"
    | "has_risks"
    | "goal_markers"
    | "target_markers"
  >
): MissingItem[] {
  const items: MissingItem[] = [];

  // Priority 1: alternative
  if (signals.option_count_estimate < 2) {
    const firstMarker = signals.option_markers[0];
    const question = firstMarker
      ? `You've described "${firstMarker}". What's the alternative you're comparing against?`
      : "What alternatives are you considering?";
    items.push({ component: "alternative", priority: 1, suggested_question: question });
  }

  // Priority 2: measurable_outcome
  if (!signals.has_measurable_target) {
    const firstGoal = signals.goal_markers[0];
    const question = firstGoal
      ? `You mentioned "${firstGoal}". What specific metric would tell you this succeeded?`
      : "What metric would tell you this decision succeeded?";
    items.push({ component: "measurable_outcome", priority: 2, suggested_question: question });
  }

  // Priority 3: baseline (only when missing, not unknown_explicit)
  if (signals.baseline_state === "missing") {
    const firstTarget = signals.target_markers[0];
    if (firstTarget) {
      items.push({
        component: "baseline",
        priority: 3,
        suggested_question: `You want to reach ${firstTarget.source_text}. What's the current state?`,
      });
    } else {
      items.push({
        component: "baseline",
        priority: 3,
        suggested_question: "What's the current state before this change?",
      });
    }
  }

  // Priority 4: constraint
  if (!signals.has_constraints) {
    items.push({
      component: "constraint",
      priority: 4,
      suggested_question:
        "Is there a hard limit — budget, deadline, or threshold — even a rough one?",
    });
  }

  // Priority 5: risk
  if (!signals.has_risks) {
    items.push({
      component: "risk",
      priority: 5,
      suggested_question:
        "What could go wrong? Even one concern helps the model account for downside.",
    });
  }

  return items;
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Compute deterministic quality signals from a decision brief.
 *
 * **Performance:** <50ms for briefs up to 1000 words.
 * Pure regex/string matching — no external calls, no NLP, no side effects.
 *
 * **Compute-once rule:** Call exactly once per request inside
 * `evaluatePreflightDecision()`. Attach to the decision result. All
 * downstream consumers (context header, telemetry, response payload)
 * read from there — never recompute.
 *
 * @param briefText - The raw brief string (post-Zod validation)
 * @returns BriefSignals with all detection fields populated
 */
export function computeBriefSignals(briefText: string): BriefSignals {
  const wordCount = countWords(briefText);
  const sentences = splitSentences(briefText);
  const sentenceCount = sentences.length;

  // 1a. Alternatives
  const { option_count_estimate, option_markers } = detectAlternatives(briefText);

  // 1b. Goal
  const { has_explicit_goal, goal_markers } = detectGoal(briefText);

  // 1c. Numeric anchors
  const numeric_anchors = extractNumericAnchors(briefText);
  const target_markers = numeric_anchors.filter((a) => a.role === "target");
  const has_measurable_target = target_markers.length > 0;

  // 1d. Baseline
  const { baseline_state, baseline_markers } = detectBaseline(
    briefText,
    numeric_anchors
  );

  // 1e. Constraints and risks
  const { has_constraints, constraint_markers } = detectConstraints(
    briefText,
    numeric_anchors
  );
  const { has_risks, risk_markers } = detectRisks(briefText);

  // 1f. Bias
  const bias_signals = detectBias(briefText, numeric_anchors);

  // Assemble partial for missing items computation
  const partial = {
    option_count_estimate,
    option_markers,
    has_measurable_target,
    baseline_state,
    has_constraints,
    has_risks,
    goal_markers,
    target_markers,
  };

  // 1g. Strength
  const brief_strength = computeStrength(
    option_count_estimate,
    has_measurable_target,
    has_explicit_goal,
    baseline_state,
    has_constraints,
    wordCount
  );

  // 1h. Missing items
  const missing_items = computeMissingItems(partial);

  return {
    option_count_estimate,
    option_markers,
    has_explicit_goal,
    goal_markers,
    has_measurable_target,
    target_markers,
    baseline_state,
    baseline_markers,
    has_constraints,
    constraint_markers,
    has_risks,
    risk_markers,
    numeric_anchors,
    numeric_anchor_count: numeric_anchors.length,
    bias_signals,
    brief_strength,
    missing_items,
    word_count: wordCount,
    sentence_count: sentenceCount,
  };
}
