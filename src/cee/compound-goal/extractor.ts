/**
 * Compound Goal Extractor
 *
 * Parses natural language briefs to identify compound goals and extract constraints.
 * Follows conservative extraction: if intent is ambiguous, don't extract.
 *
 * Trigger phrases for constraints (subordinate clauses):
 * - "while keeping/maintaining X under/below Y"
 * - "while ensuring X stays above/at least Y"
 * - "reach X and keep Y under Z"
 * - "achieve X without exceeding Y"
 * - "by [deadline]" / "within [timeframe]"
 *
 * Goal verbs for primary goal:
 * - "achieve", "reach", "grow", "maximise", "maximize", "increase"
 */

import { log } from "../../utils/telemetry.js";
import type { GoalConstraintT } from "../../schemas/assist.js";
import { extractDeadline } from "./deadline-extractor.js";
import { mapQualitativeToProxy } from "./qualitative-proxy.js";
import { fuzzyMatchNodeId } from "../../validators/structural-reconciliation.js";
import {
  MAGNITUDE_AMBIGUOUS_TRAILER_GUARD,
  MAGNITUDE_SUFFIX_ANON,
  requiredMagnitudeSuffixPattern,
  resolveMagnitude,
} from "../../utils/magnitude-alphabet.js";
import { REDUCTION_VERB_PATTERN } from "../../utils/reduction-framing.js";
import {
  buildBoundDisplayName,
  buildReductionDisplayName,
} from "./constraint-display-name.js";

// ============================================================================
// Types
// ============================================================================

export interface ExtractedGoalConstraint {
  /** Target metric/factor name (will be converted to node ID) */
  targetName: string;
  /** Canonical node ID for the target */
  targetNodeId: string;
  /** Comparison operator */
  operator: ">=" | "<=";
  /** Threshold value in user units */
  value: number;
  /** Unit of measurement */
  unit: string;
  /** Human-readable label */
  label: string;
  /** Source quote from brief */
  sourceQuote: string;
  /** Extraction confidence */
  confidence: number;
  /** Provenance type */
  provenance: "explicit" | "inferred" | "proxy";
  /** Deadline metadata if temporal constraint */
  deadlineMetadata?: {
    deadline_date?: string;
    reference_date?: string;
    assumed_reference_date?: boolean;
  };
}

export interface CompoundGoalExtractionResult {
  /** Primary goal target (from goal verbs) */
  primaryGoal?: {
    targetName: string;
    targetNodeId: string;
    label: string;
    sourceQuote: string;
  };
  /** Extracted constraints (from subordinate clauses) */
  constraints: ExtractedGoalConstraint[];
  /** Whether compound goals were detected */
  isCompound: boolean;
  /** Warnings about extraction */
  warnings: string[];
}

// ============================================================================
// Pattern Definitions
// ============================================================================

/* ===========================================================================
 * THE AMOUNT TOKEN — ONE fragment, EIGHTEEN patterns (ROADMAP 2.322)
 *
 * ⚠ EVERY PATTERN BELOW USED TO SPELL ITS OWN `[kKmMbB]?`, AND THAT CLASS WAS
 * THE REAL CEILING ON THIS EXTRACTOR. Folding `parseValueWithUnit` onto the
 * shared alphabet was not enough and the derived guard said so immediately:
 * the parser could read "t" and "million", but the CAPTURE never handed it
 * either, because the token grammar stopped at a single character from a
 * five-letter class. "keep costs under $4t" produced a constraint of FOUR.
 *
 * A pattern's alphabet and its parser's alphabet are two lists that must
 * agree, which is the same drift pair one layer down — so both are now derived
 * from the one map. `MAGNITUDE_SUFFIX_ANON` is the un-named spelling: several
 * of these patterns carry TWO amounts ("between X and Y"), and a duplicated
 * capture-group name is a hard `SyntaxError`.
 * ========================================================================= */

/** A currency-or-bare amount with an optional magnitude suffix and optional `%`. */
const AMT = String.raw`[£$€]?\d+(?:,\d{3})*(?:\.\d+)?${MAGNITUDE_SUFFIX_ANON}${MAGNITUDE_AMBIGUOUS_TRAILER_GUARD}%?`;

/** The same token where a trailing `%` is not admissible ("within £4bn budget"). */
const AMT_NO_PCT = String.raw`[£$€]?\d+(?:,\d{3})*(?:\.\d+)?${MAGNITUDE_SUFFIX_ANON}${MAGNITUDE_AMBIGUOUS_TRAILER_GUARD}`;

/** Goal verbs that identify primary goals */
const GOAL_VERB_PATTERNS = [
  new RegExp(String.raw`\b(achieve|reach|grow|maximise|maximize|increase|improve|boost|raise)\s+(\w+(?:\s+\w+){0,3})\s+(?:to|by)\s+(${AMT})`, "gi"),
  new RegExp(String.raw`\b(grow|increase|boost)\s+(\w+(?:\s+\w+){0,3})\s+(?:from\s+${AMT}\s+)?to\s+(${AMT})`, "gi"),
];

/** Extended value pattern fragment — captures numeric value with optional composite unit suffix */
const _VAL = `${AMT}(?:\\s*(?:\\/\\s*(?:month|year|quarter|week|day|hr|hour))|\\s+(?:hours?|months?|days?|weeks?|years?|percent))?`;

/** Upper bound constraint patterns (operator: <=) */
const UPPER_BOUND_PATTERNS = [
  // "while keeping X under/below Y"
  new RegExp(String.raw`while\s+(?:keeping|maintaining)\s+(\w+(?:\s+\w+){0,3})\s+(?:under|below|at most)\s+(${AMT})`, "gi"),
  // "without exceeding Y"
  new RegExp(String.raw`without\s+exceeding\s+(${AMT})\s*(\w+(?:\s+\w+){0,2})?`, "gi"),
  // "keep Y under Z"
  new RegExp(String.raw`keep\s+(\w+(?:\s+\w+){0,3})\s+(?:under|below|at most)\s+(${AMT})`, "gi"),
  // "X must not exceed Y"
  new RegExp(String.raw`(\w+(?:\s+\w+){0,3})\s+(?:must not|cannot|should not)\s+exceed\s+(${AMT})`, "gi"),
  // "no more than Y X"
  new RegExp(String.raw`no\s+more\s+than\s+(${AMT})\s+(\w+(?:\s+\w+){0,2})`, "gi"),
  // "at most Y X"
  new RegExp(String.raw`at\s+most\s+(${AMT})\s+(\w+(?:\s+\w+){0,2})`, "gi"),
  // "within Y budget" - note: targetName defaults to "budget"
  new RegExp(String.raw`within\s+(${AMT_NO_PCT})\s*(budget|limit|cap)`, "gi"),
  // "X under Y" (simple form)
  new RegExp(String.raw`(\w+(?:\s+\w+){0,2})\s+(?:under|below)\s+(${AMT})`, "gi"),
  // Subject-optional: "under/below Y [unit]" (bare phrase — subject defaults to "unspecified")
  new RegExp(`(?:^|\\s)(?:under|below)\\s+(${_VAL})`, "gi"),
];

/** Lower bound constraint patterns (operator: >=) */
const LOWER_BOUND_PATTERNS = [
  // "while ensuring X stays above/at least Y"
  new RegExp(String.raw`while\s+ensuring\s+(\w+(?:\s+\w+){0,3})\s+(?:stays?\s+)?(?:above|at least)\s+(${AMT})`, "gi"),
  // "maintain at least Y"
  new RegExp(String.raw`maintain\s+(?:at\s+least\s+)?(${AMT})\s*(\w+(?:\s+\w+){0,2})?`, "gi"),
  // "X must be at least Y"
  new RegExp(String.raw`(\w+(?:\s+\w+){0,3})\s+(?:must be|should be)\s+(?:at least|above|over)\s+(${AMT})`, "gi"),
  // "no less than Y"
  new RegExp(String.raw`no\s+less\s+than\s+(${AMT})\s+(\w+(?:\s+\w+){0,2})`, "gi"),
  // "minimum of Y X"
  new RegExp(String.raw`minimum\s+(?:of\s+)?(${AMT})\s*(\w+(?:\s+\w+){0,2})?`, "gi"),
  // "X above Y" (simple form)
  new RegExp(String.raw`(\w+(?:\s+\w+){0,2})\s+(?:above|over)\s+(${AMT})`, "gi"),
  // Subject-optional: "above/over Y [unit]" (bare phrase — subject defaults to "unspecified")
  new RegExp(`(?:^|\\s)(?:above|over)\\s+(${_VAL})`, "gi"),
];

/** "Between X and Y" pattern (generates two constraints) */
/**
 * A magnitude suffix sitting at the END of an already-cleaned amount token,
 * with optional separating space ("5m", "5 million"). DERIVED from the shared
 * alphabet — longest-first, `\b`-closed — so it reads every spelling the
 * parsers elsewhere in the service read, and gains any future rung for free.
 */
const MAGNITUDE_SUFFIX_TAIL_RE = new RegExp(
  `${requiredMagnitudeSuffixPattern("mult")}$`,
  "i",
);

const BETWEEN_PATTERN = new RegExp(String.raw`(\w+(?:\s+\w+){0,3})\s+between\s+(${AMT})\s+and\s+(${AMT})`, "gi");

/**
 * Reduction ("by") constraint patterns — CHANGE framing, flipped to
 * operator `<=` with a NEGATIVE value (ROADMAP 1.52, goal-fit sign
 * inversion). "reduce/decrease/cut/lower/shrink X by N%" states that X
 * moves DOWN by N — the naive positive "at_least +N" reading inverts the
 * claim structurally (see `utils/reduction-framing.ts` for the full
 * doctrine + "by" vs "to"/"under" rationale). An absolute-level
 * restatement ("reduce cost TO £40k") is a DIFFERENT, already-unambiguous
 * ceiling case — deliberately left unmatched here (no verb+"by", no
 * guess) rather than folded in, per the file's conservative-extraction
 * doctrine.
 */
const REDUCTION_PATTERNS = [
  // "reduce/reducing/decrease/decreasing/... X by Y"
  new RegExp(`\\b${REDUCTION_VERB_PATTERN}\\s+(\\w+(?:\\s+\\w+){0,3})\\s+by\\s+(${_VAL})`, "gi"),
  // Subject-optional bare form: "reduce/decrease/... by Y [unit]"
  new RegExp(`\\b${REDUCTION_VERB_PATTERN}\\s+by\\s+(${_VAL})`, "gi"),
];

// ============================================================================
// Value Parsing
// ============================================================================

/**
 * Parse a value string into a number.
 * Handles currency symbols, percentages, suffixes (k, m, b),
 * composite units ("2 hours", "£50k/month"), and period suffixes.
 */
function parseValue(valueStr: string): { value: number; unit: string } {
  let cleaned = valueStr.trim();
  let unit = "";

  // Extract trailing composite unit: "/month", "/year", etc.
  const periodMatch = cleaned.match(/\s*\/\s*(month|year|quarter|week|day|hr|hour)$/i);
  let periodSuffix = "";
  if (periodMatch) {
    periodSuffix = `/${periodMatch[1].toLowerCase()}`;
    cleaned = cleaned.slice(0, cleaned.length - periodMatch[0].length).trim();
  }

  // Extract trailing word-unit: "hours", "months", "days", "percent", etc.
  const wordUnitMatch = cleaned.match(/\s+(hours?|months?|days?|weeks?|years?|percent)$/i);
  let wordUnit = "";
  if (wordUnitMatch) {
    wordUnit = wordUnitMatch[1].toLowerCase();
    cleaned = cleaned.slice(0, cleaned.length - wordUnitMatch[0].length).trim();
  }

  // Extract currency symbol
  const currencyMatch = cleaned.match(/^([£$€])/);
  if (currencyMatch) {
    unit = currencyMatch[1];
    cleaned = cleaned.slice(1);
  }

  // Handle percentage
  if (cleaned.endsWith("%") || wordUnit === "percent") {
    unit = "%";
    if (cleaned.endsWith("%")) cleaned = cleaned.slice(0, -1);
    const num = parseFloat(cleaned.replace(/,/g, ""));
    if (periodSuffix) unit += periodSuffix;
    return { value: num / 100, unit }; // Convert to decimal
  }

  // Handle magnitude suffixes (ROADMAP 2.322).
  //
  // ⚠ THIS WAS A SINGLE-CHARACTER `slice(-1)` CHAIN OVER k/m/b, AND IT WAS
  // WRONG IN TWO DIRECTIONS AT ONCE — both measured at `497a14e`, not reasoned:
  //
  //   - IT COULD NOT SEE A WORD FORM. "$5 million" reached here as "5 million",
  //     whose last character is "n" — no branch matched, `parseFloat("5 million")`
  //     returned 5, and a five-million-pound constraint was persisted as £5. The
  //     same for "$5 billion", "$5 trillion" and every cased variant.
  //   - IT COULD NOT SEE THE TRILLION RUNG OR `bn`. "$5t" kept its "t" and read
  //     5; "$5bn" matched the `b` branch only because "n" had already been
  //     stripped as a non-digit elsewhere — i.e. correct by accident, not by
  //     rule.
  //
  // (The claim that this site turned "5bn" into 5 was REFUTED on measurement —
  // it read 5e9. The real defects are the word forms and the missing rung, and
  // this comment says so rather than repeating the convenient version.)
  //
  // The alphabet is now the shared one, so every spelling the rest of the
  // service can parse is a spelling this extractor can parse.
  const suffixMatch = cleaned.match(MAGNITUDE_SUFFIX_TAIL_RE);
  let multiplier = 1;
  if (suffixMatch?.groups?.mult) {
    multiplier = resolveMagnitude(suffixMatch.groups.mult);
    cleaned = cleaned.slice(0, suffixMatch.index);
  }

  const num = parseFloat(cleaned.replace(/,/g, "")) * multiplier;

  // Build final unit string
  if (wordUnit) {
    unit = unit ? `${unit}/${wordUnit}` : wordUnit;
  }
  if (periodSuffix) {
    unit += periodSuffix;
  }

  return { value: num, unit };
}

/**
 * Generate a canonical node ID from a target name.
 */
function generateNodeId(targetName: string, prefix: string = "fac"): string {
  return `${prefix}_${targetName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "")}`;
}

/**
 * Generate a constraint ID from target and operator.
 */
function generateConstraintId(targetNodeId: string, operator: ">=" | "<="): string {
  const operatorSuffix = operator === ">=" ? "min" : "max";
  return `constraint_${targetNodeId}_${operatorSuffix}`;
}

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Extract primary goal from brief using goal verb patterns.
 */
function extractPrimaryGoal(brief: string): CompoundGoalExtractionResult["primaryGoal"] | undefined {
  for (const pattern of GOAL_VERB_PATTERNS) {
    pattern.lastIndex = 0; // Reset regex state
    const match = pattern.exec(brief);
    if (match) {
      const [fullMatch, verb, targetName, valueStr] = match;
      const { value: _value, unit: _unit } = parseValue(valueStr);
      const targetNodeId = generateNodeId(targetName);

      return {
        targetName: targetName.trim(),
        targetNodeId,
        label: `${verb} ${targetName} to ${valueStr}`,
        sourceQuote: fullMatch.slice(0, 200),
      };
    }
  }
  return undefined;
}

/**
 * Extract upper bound constraints (operator: <=).
 */
function extractUpperBoundConstraints(brief: string): ExtractedGoalConstraint[] {
  const constraints: ExtractedGoalConstraint[] = [];

  for (const pattern of UPPER_BOUND_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(brief)) !== null) {
      // Pattern groups vary, normalize them
      let targetName: string;
      let valueStr: string;

      if (!match[2]) {
        // Subject-optional pattern: only 1 capture group (value only)
        valueStr = match[1];
        targetName = "unspecified";
      } else if (match[2] && match[1].match(/^[£$€]?\d/)) {
        // Value comes first: "no more than Y X"
        valueStr = match[1];
        targetName = match[2] || "budget";
      } else {
        // Target comes first: "keeping X under Y"
        targetName = match[1];
        valueStr = match[2];
      }

      if (!valueStr) continue;

      const { value, unit } = parseValue(valueStr);
      const targetNodeId = generateNodeId(targetName.trim());

      constraints.push({
        targetName: targetName.trim(),
        targetNodeId,
        operator: "<=",
        value,
        unit,
        // ROADMAP 2.653 (I-B): plain words + the user's own number text, never
        // the internal direction word. See `constraint-display-name.ts`.
        label: buildBoundDisplayName(targetName, "<=", valueStr),
        sourceQuote: match[0].slice(0, 200),
        confidence: targetName === "unspecified" ? 0.6 : 0.85,
        provenance: "explicit",
      });
    }
  }

  return constraints;
}

/**
 * Extract lower bound constraints (operator: >=).
 */
function extractLowerBoundConstraints(brief: string): ExtractedGoalConstraint[] {
  const constraints: ExtractedGoalConstraint[] = [];

  for (const pattern of LOWER_BOUND_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(brief)) !== null) {
      let targetName: string;
      let valueStr: string;

      if (!match[2]) {
        // Subject-optional pattern: only 1 capture group (value only)
        valueStr = match[1];
        targetName = "unspecified";
      } else if (match[2] && match[1].match(/^[£$€]?\d/)) {
        valueStr = match[1];
        targetName = match[2] || "target";
      } else {
        targetName = match[1];
        valueStr = match[2];
      }

      if (!valueStr) continue;

      const { value, unit } = parseValue(valueStr);
      const targetNodeId = generateNodeId(targetName.trim());

      constraints.push({
        targetName: targetName.trim(),
        targetNodeId,
        operator: ">=",
        value,
        unit,
        // ROADMAP 2.653 (I-B): plain words + the user's own number text, never
        // the internal direction word. See `constraint-display-name.ts`.
        label: buildBoundDisplayName(targetName, ">=", valueStr),
        sourceQuote: match[0].slice(0, 200),
        confidence: targetName === "unspecified" ? 0.6 : 0.85,
        provenance: "explicit",
      });
    }
  }

  return constraints;
}

/**
 * Extract reduction ("by") constraints (operator: <=, value flipped
 * negative). ROADMAP 1.52 — see `REDUCTION_PATTERNS` doc comment above
 * and `utils/reduction-framing.ts` for the full sign-inversion doctrine.
 */
function extractReductionConstraints(brief: string): ExtractedGoalConstraint[] {
  const constraints: ExtractedGoalConstraint[] = [];

  for (const pattern of REDUCTION_PATTERNS) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(brief)) !== null) {
      // Subject-optional pattern: only 1 capture group (value only)
      const targetName = match[2] ? match[1] : "unspecified";
      const valueStr = match[2] ?? match[1];

      if (!valueStr) continue;

      const { value, unit } = parseValue(valueStr);
      const targetNodeId = generateNodeId(targetName.trim());

      constraints.push({
        targetName: targetName.trim(),
        targetNodeId,
        operator: "<=",
        // The metric must fall BY at least `value` — i.e. the samples
        // must reach `-value` or lower. Flipping the naive "+value"
        // reading here is the fix for the traced sign-inversion bug.
        value: -value,
        unit,
        // ROADMAP 2.653 (I-B) — the CHANGE phrasing, not the level phrasing.
        label: buildReductionDisplayName(targetName, valueStr),
        sourceQuote: match[0].slice(0, 200),
        confidence: targetName === "unspecified" ? 0.6 : 0.85,
        provenance: "explicit",
      });
    }
  }

  return constraints;
}

/**
 * Extract "between X and Y" constraints (generates two constraints).
 */
function extractBetweenConstraints(brief: string): ExtractedGoalConstraint[] {
  const constraints: ExtractedGoalConstraint[] = [];
  BETWEEN_PATTERN.lastIndex = 0;

  let match;
  while ((match = BETWEEN_PATTERN.exec(brief)) !== null) {
    const [fullMatch, targetName, lowerStr, upperStr] = match;
    const lower = parseValue(lowerStr);
    const upper = parseValue(upperStr);
    const targetNodeId = generateNodeId(targetName.trim());

    // Lower bound constraint
    constraints.push({
      targetName: targetName.trim(),
      targetNodeId,
      operator: ">=",
      value: lower.value,
      unit: lower.unit,
      label: buildBoundDisplayName(targetName, ">=", lowerStr),
      sourceQuote: fullMatch.slice(0, 200),
      confidence: 0.9,
      provenance: "explicit",
    });

    // Upper bound constraint
    constraints.push({
      targetName: targetName.trim(),
      targetNodeId,
      operator: "<=",
      value: upper.value,
      unit: upper.unit,
      label: buildBoundDisplayName(targetName, "<=", upperStr),
      sourceQuote: fullMatch.slice(0, 200),
      confidence: 0.9,
      provenance: "explicit",
    });
  }

  return constraints;
}

/**
 * Extract temporal constraints (deadlines).
 */
function extractTemporalConstraints(brief: string): ExtractedGoalConstraint[] {
  const deadlineResult = extractDeadline(brief);
  if (!deadlineResult.detected) {
    return [];
  }

  return [{
    targetName: "delivery time",
    targetNodeId: "delivery_time_months", // Canonical ID per spec
    operator: "<=",
    value: deadlineResult.months,
    unit: "months",
    label: `Delivery deadline`,
    sourceQuote: deadlineResult.sourceQuote,
    confidence: deadlineResult.confidence,
    provenance: deadlineResult.assumed ? "inferred" : "explicit",
    deadlineMetadata: {
      deadline_date: deadlineResult.deadlineDate,
      reference_date: deadlineResult.referenceDate,
      assumed_reference_date: deadlineResult.assumed,
    },
  }];
}

/**
 * Deduplicate constraints by target and operator.
 *
 * When multiple constraints exist for the same target+operator:
 * - For <= (upper bounds): keep the SMALLER value (stricter ceiling)
 * - For >= (lower bounds): keep the LARGER value (stricter floor)
 * - If values are equal, keep the one with higher confidence
 */
function deduplicateConstraints(constraints: ExtractedGoalConstraint[]): ExtractedGoalConstraint[] {
  const seen = new Map<string, ExtractedGoalConstraint>();

  for (const c of constraints) {
    const key = `${c.targetNodeId}_${c.operator}`;
    const existing = seen.get(key);

    if (!existing) {
      seen.set(key, c);
      continue;
    }

    // Determine if new constraint is stricter
    let isStricter = false;
    if (c.operator === "<=") {
      // For upper bounds, smaller value is stricter
      isStricter = c.value < existing.value;
    } else {
      // For lower bounds (>=), larger value is stricter
      isStricter = c.value > existing.value;
    }

    // Replace if stricter, or if same value but higher confidence
    if (isStricter || (c.value === existing.value && c.confidence > existing.confidence)) {
      seen.set(key, c);
    }
  }

  return Array.from(seen.values());
}

// ============================================================================
// Junk ID Detection
// ============================================================================

/** Common stop-words that should not appear as standalone constraint targets */
const STOP_WORDS = new Set([
  "we", "have", "the", "and", "for", "not", "with", "this", "that", "are",
  "from", "will", "but", "its", "our", "can", "all", "has", "was", "been",
  "they", "their", "more", "also", "any", "into", "just", "than", "each",
  "how", "may", "per", "via", "yet",
  // Verb-like stems captured by constraint patterns ("keep X under Y", "ensure X stays above Y")
  // that produce junk IDs like fac_keep or fac_ensure when the regex misparses
  "keep", "ensure", "maintain", "achieve", "reach", "stay", "stays",
  "make", "get", "set", "run", "put", "let", "do",
]);

/**
 * Check whether a generated node ID is semantically valid.
 * Rejects IDs derived from stop-words or sentence fragments.
 *
 * Rules:
 * 1. Stem (after prefix strip) must be >= 4 chars
 * 2. Every underscore-separated token must be >= 2 chars
 * 3. At least one token must NOT be a stop-word
 */
function isJunkNodeId(nodeId: string): boolean {
  // Strip known prefixes
  let stem = nodeId;
  for (const prefix of ["fac_", "out_", "risk_"]) {
    if (stem.startsWith(prefix)) {
      stem = stem.slice(prefix.length);
      break;
    }
  }

  if (stem.length < 4) return true;

  const tokens = stem.split("_").filter(Boolean);
  if (tokens.length === 0) return true;

  // Every token must be at least 2 chars
  if (tokens.some((t) => t.length < 2)) return true;

  // At least one token must not be a stop-word
  const hasSubstantiveToken = tokens.some((t) => !STOP_WORDS.has(t));
  if (!hasSubstantiveToken) return true;

  return false;
}

// ============================================================================
// Deterministic Alias Map
// ============================================================================

/**
 * Maps common constraint phrases (extracted from briefs) to an ordered list
 * of node-ID stem patterns that frequently appear in LLM-generated graphs.
 *
 * Lookup key: lowercased targetName from the regex extractor.
 * Values: candidate node-ID stems to match against (order = preference).
 *
 * Used AFTER exact-ID and exact-label matching, BEFORE fuzzy substring matching.
 *
 * Expand intentionally — add entries when new domain patterns recur in briefs.
 * Key matching is substring-based: "monthly churn rate" matches the "churn rate" key.
 * Stem matching is also substring-based: candidate "churn" matches node stem "customer_churn".
 */
export const CONSTRAINT_ALIASES: Record<string, string[]> = {
  // ── Churn / retention ─────────────────────────────────────────────────
  churn:              ["customer_churn", "churn_rate", "monthly_churn", "annual_churn"],
  "churn rate":       ["churn_rate", "customer_churn", "monthly_churn"],
  "monthly churn":    ["monthly_churn", "churn_rate", "customer_churn"],
  retention:          ["retention_rate", "customer_retention", "revenue_retention"],
  "retention rate":   ["retention_rate", "customer_retention"],
  "customer retention": ["customer_retention", "retention_rate"],

  // ── Revenue / growth ──────────────────────────────────────────────────
  revenue:            ["revenue_growth", "total_revenue", "annual_revenue", "mrr"],
  "revenue growth":   ["revenue_growth", "total_revenue"],
  mrr:                ["mrr", "monthly_recurring_revenue", "revenue_growth"],
  arr:                ["arr", "annual_recurring_revenue", "revenue_growth"],

  // ── Cost / budget / spend ─────────────────────────────────────────────
  budget:             ["marketing_spend", "total_budget", "operating_budget", "budget"],
  "marketing spend":  ["marketing_spend", "marketing_budget", "marketing_cost"],
  "marketing budget": ["marketing_budget", "marketing_spend", "marketing_cost"],
  costs:              ["operating_costs", "total_costs", "cost"],
  cost:               ["operating_costs", "total_costs", "cost"],
  spend:              ["marketing_spend", "total_spend", "operating_spend"],
  spending:           ["marketing_spend", "total_spend", "operating_spend"],

  // ── Team / capacity ───────────────────────────────────────────────────
  team:               ["team_capacity", "team_size", "headcount"],
  "team capacity":    ["team_capacity", "team_size"],
  headcount:          ["headcount", "team_size", "team_capacity"],

  // ── Market / share ────────────────────────────────────────────────────
  "market share":     ["market_share", "market_penetration"],
  market:             ["market_share", "market_penetration", "market_size"],

  // ── Margin / profit ───────────────────────────────────────────────────
  margin:             ["profit_margin", "gross_margin", "operating_margin", "margin"],
  "profit margin":    ["profit_margin", "gross_margin"],
  profit:             ["profit", "net_profit", "profit_margin"],

  // ── Satisfaction / NPS ────────────────────────────────────────────────
  satisfaction:       ["customer_satisfaction", "nps_score", "csat"],
  "customer satisfaction": ["customer_satisfaction", "nps_score", "csat"],
  nps:                ["nps_score", "customer_satisfaction"],
};

/**
 * Try to match a constraint's targetName against CONSTRAINT_ALIASES,
 * then resolve the alias stems against actual graph node IDs.
 *
 * Key matching is substring-based: if the normalised targetName contains an
 * alias key (or vice versa), the alias candidates are used. When multiple keys
 * match, the longest key wins (most specific match).
 *
 * Stem matching is also substring-based: alias candidate "churn" matches a
 * node stem "customer_churn" (either direction). Only unambiguous single
 * matches are returned.
 *
 * Returns the first matching node ID, or undefined if no alias matches.
 */
function aliasMatchNodeId(
  targetName: string,
  nodeIds: string[],
): string | undefined {
  const normName = targetName.toLowerCase().trim();

  // Find alias candidates — exact key first, then substring (longest key wins)
  let aliasCandidates = CONSTRAINT_ALIASES[normName];
  if (!aliasCandidates) {
    let bestKey: string | undefined;
    let bestKeyLen = 0;
    for (const aliasKey of Object.keys(CONSTRAINT_ALIASES)) {
      if (normName.includes(aliasKey) || aliasKey.includes(normName)) {
        if (aliasKey.length > bestKeyLen) {
          bestKey = aliasKey;
          bestKeyLen = aliasKey.length;
        }
      }
    }
    if (bestKey) {
      aliasCandidates = CONSTRAINT_ALIASES[bestKey];
    }
  }
  if (!aliasCandidates) return undefined;

  // Build a list of { stem, nodeId } for matching
  const nodeStems: Array<{ stem: string; nodeId: string }> = [];
  for (const nodeId of nodeIds) {
    let stem = nodeId;
    for (const prefix of ["fac_", "out_", "risk_"]) {
      if (stem.startsWith(prefix)) {
        stem = stem.slice(prefix.length);
        break;
      }
    }
    nodeStems.push({ stem: stem.toLowerCase(), nodeId });
  }

  // Try each alias candidate in preference order — substring matching
  for (const candidateStem of aliasCandidates) {
    const candidateLower = candidateStem.toLowerCase();
    const matches: string[] = [];

    for (const { stem, nodeId } of nodeStems) {
      // Exact stem match or substring match (either direction)
      if (stem === candidateLower || stem.includes(candidateLower) || candidateLower.includes(stem)) {
        matches.push(nodeId);
      }
    }

    // Only use this candidate if it produces an unambiguous single match
    if (matches.length === 1) return matches[0];
    // If exact match among multiple, prefer it
    if (matches.length > 1) {
      const exact = matches.find((m) => {
        let s = m;
        for (const p of ["fac_", "out_", "risk_"]) {
          if (s.startsWith(p)) { s = s.slice(p.length); break; }
        }
        return s.toLowerCase() === candidateLower;
      });
      if (exact) return exact;
    }
  }

  return undefined;
}

/**
 * Try to match a constraint's targetName against node labels (exact label match).
 *
 * Normalises both the targetName and each node label to a lowercase slug,
 * then checks for an exact match.
 *
 * Returns the first matching node ID, or undefined if no label matches.
 */
function labelExactMatchNodeId(
  targetName: string,
  nodeLabels: Map<string, string>,
): string | undefined {
  const normTarget = targetName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  if (normTarget.length < 3) return undefined;

  for (const [nodeId, label] of nodeLabels) {
    const normLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
    if (normLabel === normTarget) return nodeId;
  }
  return undefined;
}

// ============================================================================
// Post-Extraction Remapping Against Graph Nodes
// ============================================================================

export interface RemapResult {
  constraints: ExtractedGoalConstraint[];
  remapped: number;
  rejected_junk: number;
  rejected_no_match: number;
}

/**
 * Remap extracted constraint targetNodeIds against actual graph nodes.
 *
 * Matching order (first hit wins):
 *  0. Temporal → pass through (deadlines don't target graph nodes)
 *  1. Reject junk IDs (stop-word-only stems)
 *  2. Exact ID match
 *  3. Exact label match (normalised targetName == normalised node label)
 *  4. Alias match (deterministic CONSTRAINT_ALIASES lookup)
 *  5. Fuzzy match (stem substring + label substring via fuzzyMatchNodeId)
 *  6. Drop (no match)
 *  7. Deduplicate
 *
 * @param constraints - Extracted constraints with invented targetNodeIds
 * @param nodeIds - Actual graph node IDs from the LLM-generated graph
 * @param nodeLabels - Optional node ID → label map for label-based fallback
 * @param requestId - Optional request ID for telemetry
 * @param goalNodeId - Optional goal node ID for temporal constraint binding
 */
export function remapConstraintTargets(
  constraints: ExtractedGoalConstraint[],
  nodeIds: string[],
  nodeLabels?: Map<string, string>,
  requestId?: string,
  goalNodeId?: string,
): RemapResult {
  const nodeIdSet = new Set(nodeIds);
  const remapped: ExtractedGoalConstraint[] = [];
  let remapCount = 0;
  let junkCount = 0;
  let noMatchCount = 0;

  for (const constraint of constraints) {
    // Step 0: Temporal constraints — bind to goal node or drop with reason
    if (constraint.deadlineMetadata) {
      if (goalNodeId) {
        remapped.push({
          ...constraint,
          targetNodeId: goalNodeId,
        });
        if (constraint.targetNodeId !== goalNodeId) {
          remapCount++;
          log.info({
            event: "cee.compound_goal.temporal_bound_to_goal",
            request_id: requestId,
            original_target: constraint.targetNodeId,
            goal_node_id: goalNodeId,
          }, `Temporal constraint bound to goal node: ${constraint.targetNodeId} → ${goalNodeId}`);
        }
      } else {
        noMatchCount++;
        log.info({
          event: "cee.compound_goal.temporal_dropped",
          request_id: requestId,
          target_node_id: constraint.targetNodeId,
          drop_reason: "no_goal_node",
        }, `Temporal constraint dropped: no goal node to bind to`);
      }
      continue;
    }

    // Step 1: Reject junk IDs before any matching attempt
    if (isJunkNodeId(constraint.targetNodeId)) {
      junkCount++;
      log.info({
        event: "cee.compound_goal.junk_id_rejected",
        request_id: requestId,
        target_node_id: constraint.targetNodeId,
        target_name: constraint.targetName,
      }, `Junk constraint target rejected: ${constraint.targetNodeId}`);
      continue;
    }

    // Step 2: Exact ID match — keep as-is
    if (nodeIdSet.has(constraint.targetNodeId)) {
      remapped.push(constraint);
      continue;
    }

    // Step 3: Exact label match — normalised targetName matches a node label
    if (nodeLabels && nodeLabels.size > 0) {
      const labelMatch = labelExactMatchNodeId(constraint.targetName, nodeLabels);
      if (labelMatch) {
        remapCount++;
        log.info({
          event: "cee.compound_goal.target_remapped",
          request_id: requestId,
          original_target: constraint.targetNodeId,
          remapped_target: labelMatch,
          target_name: constraint.targetName,
          match_strategy: "exact_label",
        }, `Constraint target remapped via exact label: ${constraint.targetNodeId} → ${labelMatch}`);
        remapped.push({
          ...constraint,
          targetNodeId: labelMatch,
        });
        continue;
      }
    }

    // Step 4: Alias match — deterministic CONSTRAINT_ALIASES lookup
    const aliasMatch = aliasMatchNodeId(constraint.targetName, nodeIds);
    if (aliasMatch) {
      remapCount++;
      log.info({
        event: "cee.compound_goal.target_remapped",
        request_id: requestId,
        original_target: constraint.targetNodeId,
        remapped_target: aliasMatch,
        target_name: constraint.targetName,
        match_strategy: "alias",
      }, `Constraint target remapped via alias: ${constraint.targetNodeId} → ${aliasMatch}`);
      remapped.push({
        ...constraint,
        targetNodeId: aliasMatch,
      });
      continue;
    }

    // Step 5: Fuzzy match — try stem then label-based matching
    const fuzzyMatch = fuzzyMatchNodeId(constraint.targetNodeId, nodeIds, nodeLabels);
    if (fuzzyMatch) {
      remapCount++;
      log.info({
        event: "cee.compound_goal.target_remapped",
        request_id: requestId,
        original_target: constraint.targetNodeId,
        remapped_target: fuzzyMatch,
        target_name: constraint.targetName,
        match_strategy: "fuzzy",
      }, `Constraint target remapped: ${constraint.targetNodeId} → ${fuzzyMatch}`);
      remapped.push({
        ...constraint,
        targetNodeId: fuzzyMatch,
      });
      continue;
    }

    // Step 6: No match — drop this constraint
    noMatchCount++;
    log.info({
      event: "cee.compound_goal.target_no_match",
      request_id: requestId,
      target_node_id: constraint.targetNodeId,
      target_name: constraint.targetName,
      available_node_count: nodeIds.length,
    }, `Constraint target dropped (no match): ${constraint.targetNodeId}`);
  }

  // Step 7: Deduplicate after remapping (two different extracted names
  // may now point to the same graph node)
  const deduplicated = deduplicateConstraints(remapped);

  if (remapCount > 0 || junkCount > 0 || noMatchCount > 0) {
    log.info({
      event: "cee.compound_goal.remap_summary",
      request_id: requestId,
      input_count: constraints.length,
      output_count: deduplicated.length,
      remapped: remapCount,
      rejected_junk: junkCount,
      rejected_no_match: noMatchCount,
      deduplicated: remapped.length - deduplicated.length,
    }, `Constraint remap: ${deduplicated.length}/${constraints.length} survived (${remapCount} remapped, ${junkCount} junk, ${noMatchCount} no-match)`);
  }

  return {
    constraints: deduplicated,
    remapped: remapCount,
    rejected_junk: junkCount,
    rejected_no_match: noMatchCount,
  };
}

// ============================================================================
// Main Extraction Function
// ============================================================================

/**
 * Extract compound goals from a brief.
 *
 * @param brief - Natural language decision brief
 * @param options - Extraction options
 * @returns Extraction result with primary goal and constraints
 */
export function extractCompoundGoals(
  brief: string,
  options: {
    /** Include qualitative proxy mappings */
    includeProxies?: boolean;
    /** Reference date for deadline computation (default: today) */
    referenceDate?: Date;
  } = {}
): CompoundGoalExtractionResult {
  const warnings: string[] = [];

  // Extract primary goal
  const primaryGoal = extractPrimaryGoal(brief);

  // Extract all constraint types
  const upperBound = extractUpperBoundConstraints(brief);
  const lowerBound = extractLowerBoundConstraints(brief);
  const reduction = extractReductionConstraints(brief);
  const between = extractBetweenConstraints(brief);
  const temporal = extractTemporalConstraints(brief);

  // Combine and deduplicate
  let constraints = deduplicateConstraints([
    ...upperBound,
    ...lowerBound,
    ...reduction,
    ...between,
    ...temporal,
  ]);

  // Add qualitative proxies if enabled
  if (options.includeProxies) {
    const proxyResult = mapQualitativeToProxy(brief);
    if (proxyResult.constraints.length > 0) {
      constraints = deduplicateConstraints([...constraints, ...proxyResult.constraints]);
      warnings.push(...proxyResult.warnings);
    }
  }

  // Determine if compound — a primary goal OR any constraints signals compound intent
  const isCompound = constraints.length > 0 || primaryGoal !== undefined;

  // Log extraction
  log.info({
    event: "cee.compound_goal.extraction",
    is_compound: isCompound,
    primary_goal_detected: primaryGoal !== undefined,
    constraint_count: constraints.length,
    constraint_types: {
      upper_bound: upperBound.length,
      lower_bound: lowerBound.length,
      reduction: reduction.length,
      between: between.length / 2, // Each "between" generates 2 constraints
      temporal: temporal.length,
    },
  }, "Compound goal extraction complete");

  return {
    primaryGoal,
    constraints,
    isCompound,
    warnings,
  };
}

/**
 * Normalise percentage-unit constraints to prevent double-encoding.
 *
 * The LLM extractor converts "4%" to value: 0.04, unit: "%".
 * If a consumer interprets unit: "%" as "value is percentage points",
 * 0.04% ≠ 4%.  This normaliser detects the fractional case and relabels
 * the unit to "fraction" so the convention is unambiguous.
 *
 * Rule: if unit === "%" and 0 < |value| < 1 → already fractional → unit = "fraction".
 *
 * ROADMAP 1.52: sign-agnostic on purpose — a reduction constraint's value
 * is negative by design (e.g. -0.15 for "reduce cost by 15%"); the
 * original `value > 0` guard silently skipped negative fractions, which
 * would have left them mislabelled unit "%" (double-encoding risk in the
 * exact way this fix is closing) instead of "fraction".
 */
export function normaliseConstraintUnits(
  constraints: ExtractedGoalConstraint[],
): ExtractedGoalConstraint[] {
  return constraints.map((c) => {
    if (c.unit === "%" && Math.abs(c.value) > 0 && Math.abs(c.value) < 1) {
      return {
        ...c,
        unit: "fraction",
        provenance_unit_normalised: {
          rule: "percent_to_fraction",
          original_value: c.value,
          original_unit: c.unit,
        } as any,
      };
    }
    return c;
  });
}

/**
 * Convert extracted constraints to GoalConstraintT array for output.
 */
export function toGoalConstraints(
  extractedConstraints: ExtractedGoalConstraint[]
): GoalConstraintT[] {
  return extractedConstraints.map((c) => ({
    constraint_id: generateConstraintId(c.targetNodeId, c.operator),
    node_id: c.targetNodeId,
    operator: c.operator,
    value: c.value,
    label: c.label,
    unit: c.unit || undefined,
    source_quote: c.sourceQuote,
    confidence: c.confidence,
    provenance: c.provenance,
    deadline_metadata: c.deadlineMetadata,
    ...((c as any).provenance_unit_normalised
      ? { provenance_unit_normalised: (c as any).provenance_unit_normalised }
      : {}),
  }));
}
