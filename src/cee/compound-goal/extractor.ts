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

/** Goal verbs that identify primary goals */
const GOAL_VERB_PATTERNS = [
  /\b(achieve|reach|grow|maximise|maximize|increase|improve|boost|raise)\s+(\w+(?:\s+\w+){0,3})\s+(?:to|by)\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
  /\b(grow|increase|boost)\s+(\w+(?:\s+\w+){0,3})\s+(?:from\s+[£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?\s+)?to\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
];

/** Upper bound constraint patterns (operator: <=) */
const UPPER_BOUND_PATTERNS = [
  // "while keeping X under/below Y"
  /while\s+(?:keeping|maintaining)\s+(\w+(?:\s+\w+){0,3})\s+(?:under|below|at most)\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
  // "without exceeding Y"
  /without\s+exceeding\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)\s*(\w+(?:\s+\w+){0,2})?/gi,
  // "keep Y under Z"
  /keep\s+(\w+(?:\s+\w+){0,3})\s+(?:under|below|at most)\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
  // "X must not exceed Y"
  /(\w+(?:\s+\w+){0,3})\s+(?:must not|cannot|should not)\s+exceed\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
  // "no more than Y X"
  /no\s+more\s+than\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)\s+(\w+(?:\s+\w+){0,2})/gi,
  // "at most Y X"
  /at\s+most\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)\s+(\w+(?:\s+\w+){0,2})/gi,
  // "within Y budget" - note: targetName defaults to "budget"
  /within\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?)\s*(budget|limit|cap)/gi,
  // "X under Y" (simple form)
  /(\w+(?:\s+\w+){0,2})\s+(?:under|below)\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
];

/** Lower bound constraint patterns (operator: >=) */
const LOWER_BOUND_PATTERNS = [
  // "while ensuring X stays above/at least Y"
  /while\s+ensuring\s+(\w+(?:\s+\w+){0,3})\s+(?:stays?\s+)?(?:above|at least)\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
  // "maintain at least Y"
  /maintain\s+(?:at\s+least\s+)?([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)\s*(\w+(?:\s+\w+){0,2})?/gi,
  // "X must be at least Y"
  /(\w+(?:\s+\w+){0,3})\s+(?:must be|should be)\s+(?:at least|above|over)\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
  // "no less than Y"
  /no\s+less\s+than\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)\s+(\w+(?:\s+\w+){0,2})/gi,
  // "minimum of Y X"
  /minimum\s+(?:of\s+)?([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)\s*(\w+(?:\s+\w+){0,2})?/gi,
  // "X above Y" (simple form)
  /(\w+(?:\s+\w+){0,2})\s+(?:above|over)\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi,
];

/** "Between X and Y" pattern (generates two constraints) */
const BETWEEN_PATTERN = /(\w+(?:\s+\w+){0,3})\s+between\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)\s+and\s+([£$€]?\d+(?:,\d{3})*(?:\.\d+)?[kKmMbB]?%?)/gi;

// ============================================================================
// Value Parsing
// ============================================================================

/**
 * Parse a value string into a number.
 * Handles currency symbols, percentages, and suffixes (k, m, b).
 */
function parseValue(valueStr: string): { value: number; unit: string } {
  let cleaned = valueStr.trim();
  let unit = "";

  // Extract currency symbol
  const currencyMatch = cleaned.match(/^([£$€])/);
  if (currencyMatch) {
    unit = currencyMatch[1];
    cleaned = cleaned.slice(1);
  }

  // Handle percentage
  if (cleaned.endsWith("%")) {
    unit = "%";
    cleaned = cleaned.slice(0, -1);
    const num = parseFloat(cleaned.replace(/,/g, ""));
    return { value: num / 100, unit }; // Convert to decimal
  }

  // Handle suffixes
  let multiplier = 1;
  const lastChar = cleaned.slice(-1).toLowerCase();
  if (lastChar === "k") {
    multiplier = 1000;
    cleaned = cleaned.slice(0, -1);
  } else if (lastChar === "m") {
    multiplier = 1000000;
    cleaned = cleaned.slice(0, -1);
  } else if (lastChar === "b") {
    multiplier = 1000000000;
    cleaned = cleaned.slice(0, -1);
  }

  const num = parseFloat(cleaned.replace(/,/g, "")) * multiplier;
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
      const { value, unit } = parseValue(valueStr);
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

      if (match[2] && match[1].match(/^[£$€]?\d/)) {
        // Value comes first: "no more than Y X"
        valueStr = match[1];
        targetName = match[2] || "budget";
      } else {
        // Target comes first: "keeping X under Y"
        targetName = match[1];
        valueStr = match[2];
      }

      if (!targetName || !valueStr) continue;

      const { value, unit } = parseValue(valueStr);
      const targetNodeId = generateNodeId(targetName.trim());

      constraints.push({
        targetName: targetName.trim(),
        targetNodeId,
        operator: "<=",
        value,
        unit,
        label: `${targetName.trim()} ceiling`,
        sourceQuote: match[0].slice(0, 200),
        confidence: 0.85,
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

      if (match[2] && match[1].match(/^[£$€]?\d/)) {
        valueStr = match[1];
        targetName = match[2] || "target";
      } else {
        targetName = match[1];
        valueStr = match[2];
      }

      if (!targetName || !valueStr) continue;

      const { value, unit } = parseValue(valueStr);
      const targetNodeId = generateNodeId(targetName.trim());

      constraints.push({
        targetName: targetName.trim(),
        targetNodeId,
        operator: ">=",
        value,
        unit,
        label: `${targetName.trim()} floor`,
        sourceQuote: match[0].slice(0, 200),
        confidence: 0.85,
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
      label: `${targetName.trim()} minimum`,
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
      label: `${targetName.trim()} maximum`,
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
  const between = extractBetweenConstraints(brief);
  const temporal = extractTemporalConstraints(brief);

  // Combine and deduplicate
  let constraints = deduplicateConstraints([
    ...upperBound,
    ...lowerBound,
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

  // Determine if compound
  const isCompound = constraints.length > 0 || (primaryGoal !== undefined && constraints.length > 0);

  // Log extraction
  log.info({
    event: "cee.compound_goal.extraction",
    is_compound: isCompound,
    primary_goal_detected: primaryGoal !== undefined,
    constraint_count: constraints.length,
    constraint_types: {
      upper_bound: upperBound.length,
      lower_bound: lowerBound.length,
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
  }));
}
