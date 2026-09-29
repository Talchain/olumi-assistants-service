// TEMPORARY: regex heuristic replacing spec §4 spaCy conjunction parse.
// Acceptable for PoC per spec's "explicit temporary policy" framing.
// Replace with proper NLP when JS dependency is evaluated.
//
// Conservative action-verb + coordinating-conjunction detector for
// compound intents. The detector is advisory only — it sets
// compound_detected + segments on the ContextPack; downstream step 6
// (compose) surfaces deferred intents as chips per spec §7 CHIP_REMAINDER.
//
// Must NOT false-positive on:
//   - "between 5 and 10"                (numeric range)
//   - "I want to think about marketing and pricing"  (no action verb both sides)
//   - "run the analysis"                (single action)
//
// Must detect:
//   - "set churn to 5% and run the analysis"
//   - "update the price then also add a constraint"

export interface CompoundDetectionResult {
  readonly detected: boolean;
  readonly segments?: readonly string[];
  readonly telemetry: {
    readonly pattern_matched: string | null;
  };
}

const ACTION_VERBS = [
  'set',
  'change',
  'update',
  'run',
  'add',
  'remove',
  'delete',
  'reduce',
  'increase',
  'adjust',
  'make',
];

// Coordinating conjunctions we split on. Must be whole-word boundaries to
// avoid slicing inside identifiers.
const CONJUNCTIONS = ['and', 'then', 'also', 'plus'];

/**
 * Detect compound intent. Returns detected=false with telemetry.pattern_matched=null
 * for all single-intent or non-action messages.
 */
export function detectCompound(message: string): CompoundDetectionResult {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return { detected: false, telemetry: { pattern_matched: null } };
  }

  // Build a regex that captures the conjunction seam with whitespace
  // around it. Case-insensitive. We use a capturing split so we can
  // verify action verbs on BOTH sides.
  const conjPattern = new RegExp(
    `\\s+(?:${CONJUNCTIONS.join('|')})\\s+`,
    'gi',
  );

  // Short-circuit: if the trimmed message contains no conjunction at all,
  // it cannot be compound.
  if (!conjPattern.test(trimmed)) {
    return { detected: false, telemetry: { pattern_matched: null } };
  }

  // Split on the conjunction. Reset regex state (.test left lastIndex
  // non-zero on the shared object).
  const splitRegex = new RegExp(
    `\\s+(?:${CONJUNCTIONS.join('|')})\\s+`,
    'gi',
  );
  const segments = trimmed.split(splitRegex).map((s) => s.trim()).filter((s) => s.length > 0);

  // Need at least two segments for compound
  if (segments.length < 2) {
    return { detected: false, telemetry: { pattern_matched: null } };
  }

  // Each segment must contain an action verb. This is the conservative
  // guard: "I want to think about X and Y" has no action verb in either
  // side, so it stays false.
  const actionVerbWordRegex = new RegExp(
    `\\b(?:${ACTION_VERBS.join('|')})\\b`,
    'i',
  );
  const segmentsWithAction = segments.filter((seg) => actionVerbWordRegex.test(seg));
  if (segmentsWithAction.length < 2) {
    return { detected: false, telemetry: { pattern_matched: null } };
  }

  // Identify which conjunction hit so telemetry carries provenance.
  const hitMatch = trimmed.match(new RegExp(`\\s+(${CONJUNCTIONS.join('|')})\\s+`, 'i'));
  const patternMatched = hitMatch ? hitMatch[1]!.toLowerCase() : CONJUNCTIONS[0]!;

  return {
    detected: true,
    segments,
    telemetry: { pattern_matched: patternMatched },
  };
}
