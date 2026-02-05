/**
 * Qualitative Goal Proxy Mapper
 *
 * Maps vague qualitative goals to quantitative proxies.
 * These are INFERRED constraints marked with provenance: "proxy".
 *
 * Examples:
 * - "improve customer satisfaction" → NPS >= 50
 * - "reduce churn" → churn_rate <= 5%
 * - "increase team velocity" → sprint_velocity >= 20
 *
 * Proxy constraints have lower confidence (0.5-0.7) since they're
 * interpretations of qualitative language.
 */

import type { ExtractedGoalConstraint } from "./extractor.js";

// ============================================================================
// Types
// ============================================================================

export interface QualitativeProxyResult {
  /** Extracted proxy constraints */
  constraints: ExtractedGoalConstraint[];
  /** Warnings about proxy assumptions */
  warnings: string[];
}

export interface ProxyMapping {
  /** Regex pattern to detect qualitative goal */
  pattern: RegExp;
  /** Target metric name */
  targetName: string;
  /** Target node ID */
  targetNodeId: string;
  /** Default operator */
  operator: ">=" | "<=";
  /** Default threshold value */
  defaultValue: number;
  /** Unit of measurement */
  unit: string;
  /** Human-readable label */
  label: string;
  /** Base confidence for this proxy (0.5-0.7) */
  confidence: number;
  /** Warning message to show user */
  warning: string;
}

// ============================================================================
// Proxy Mappings
// ============================================================================

/**
 * Standard proxy mappings for common qualitative goals.
 * These are industry-standard defaults that can be overridden.
 */
export const QUALITATIVE_PROXY_MAPPINGS: ProxyMapping[] = [
  // Customer satisfaction proxies
  {
    pattern: /\b(?:improve|increase|boost|raise)\s+(?:customer\s+)?satisfaction\b/i,
    targetName: "NPS score",
    targetNodeId: "fac_nps_score",
    operator: ">=",
    defaultValue: 50,
    unit: "",
    label: "NPS floor (satisfaction proxy)",
    confidence: 0.6,
    warning: "Using NPS >= 50 as proxy for 'customer satisfaction'. Consider specifying an explicit target.",
  },
  {
    pattern: /\b(?:improve|increase|boost)\s+(?:customer\s+)?retention\b/i,
    targetName: "retention rate",
    targetNodeId: "fac_retention_rate",
    operator: ">=",
    defaultValue: 0.85,
    unit: "%",
    label: "Retention floor",
    confidence: 0.65,
    warning: "Using retention rate >= 85% as proxy. Consider specifying an explicit target.",
  },

  // Churn proxies
  {
    pattern: /\b(?:reduce|lower|decrease|minimize|minimise)\s+churn\b/i,
    targetName: "churn rate",
    targetNodeId: "fac_churn_rate",
    operator: "<=",
    defaultValue: 0.05,
    unit: "%",
    label: "Churn ceiling",
    confidence: 0.65,
    warning: "Using churn rate <= 5% as proxy for 'reduce churn'. Consider specifying an explicit target.",
  },

  // Team velocity/productivity proxies
  {
    pattern: /\b(?:increase|improve|boost)\s+(?:team\s+)?(?:velocity|productivity)\b/i,
    targetName: "team velocity",
    targetNodeId: "fac_team_velocity",
    operator: ">=",
    defaultValue: 20,
    unit: "points/sprint",
    label: "Velocity floor",
    confidence: 0.5,
    warning: "Using team velocity >= 20 points/sprint as proxy. This is highly team-specific.",
  },

  // Quality proxies
  {
    pattern: /\b(?:improve|increase|ensure)\s+(?:code\s+)?quality\b/i,
    targetName: "code coverage",
    targetNodeId: "fac_code_coverage",
    operator: ">=",
    defaultValue: 0.80,
    unit: "%",
    label: "Coverage floor (quality proxy)",
    confidence: 0.5,
    warning: "Using code coverage >= 80% as proxy for 'quality'. Quality is multidimensional.",
  },
  {
    pattern: /\b(?:reduce|lower|decrease)\s+(?:bug|defect)\s+(?:rate|count)\b/i,
    targetName: "defect rate",
    targetNodeId: "fac_defect_rate",
    operator: "<=",
    defaultValue: 0.02,
    unit: "%",
    label: "Defect rate ceiling",
    confidence: 0.6,
    warning: "Using defect rate <= 2% as proxy. Consider your release cycle.",
  },

  // Cost proxies
  {
    pattern: /\b(?:reduce|lower|cut|decrease)\s+(?:operating\s+)?costs?\b/i,
    targetName: "cost reduction",
    targetNodeId: "fac_cost_reduction",
    operator: ">=",
    defaultValue: 0.10,
    unit: "%",
    label: "Cost reduction target",
    confidence: 0.5,
    warning: "Using cost reduction >= 10% as proxy. Specify an explicit percentage for accuracy.",
  },

  // Market share proxies
  {
    pattern: /\b(?:grow|increase|expand)\s+(?:market\s+)?share\b/i,
    targetName: "market share",
    targetNodeId: "fac_market_share",
    operator: ">=",
    defaultValue: 0.15,
    unit: "%",
    label: "Market share floor",
    confidence: 0.5,
    warning: "Using market share >= 15% as proxy. Market context matters significantly.",
  },

  // Employee satisfaction proxies
  {
    pattern: /\b(?:improve|increase|boost)\s+(?:employee\s+)?(?:satisfaction|engagement|morale)\b/i,
    targetName: "eNPS score",
    targetNodeId: "fac_enps_score",
    operator: ">=",
    defaultValue: 30,
    unit: "",
    label: "eNPS floor (employee satisfaction proxy)",
    confidence: 0.55,
    warning: "Using eNPS >= 30 as proxy for employee satisfaction. Consider survey specifics.",
  },

  // Time to market proxies
  {
    pattern: /\b(?:reduce|shorten|decrease|speed up)\s+(?:time[- ]to[- ]market|delivery time|cycle time)\b/i,
    targetName: "time to market",
    targetNodeId: "fac_time_to_market",
    operator: "<=",
    defaultValue: 3,
    unit: "months",
    label: "Time to market ceiling",
    confidence: 0.55,
    warning: "Using time to market <= 3 months as proxy. Varies significantly by product type.",
  },

  // Conversion rate proxies
  {
    pattern: /\b(?:improve|increase|boost|optimize|optimise)\s+(?:conversion|conversions)\b/i,
    targetName: "conversion rate",
    targetNodeId: "fac_conversion_rate",
    operator: ">=",
    defaultValue: 0.03,
    unit: "%",
    label: "Conversion rate floor",
    confidence: 0.6,
    warning: "Using conversion rate >= 3% as proxy. Industry averages vary widely.",
  },

  // Uptime/reliability proxies
  {
    pattern: /\b(?:improve|ensure|maintain)\s+(?:system\s+)?(?:uptime|reliability|availability)\b/i,
    targetName: "uptime",
    targetNodeId: "fac_uptime",
    operator: ">=",
    defaultValue: 0.999,
    unit: "%",
    label: "Uptime floor (99.9%)",
    confidence: 0.7,
    warning: "Using uptime >= 99.9% as proxy. Consider your SLA requirements.",
  },
];

// ============================================================================
// Extraction
// ============================================================================

/**
 * Map qualitative goals to quantitative proxies.
 *
 * @param brief - Natural language decision brief
 * @returns Proxy constraints and warnings
 */
export function mapQualitativeToProxy(brief: string): QualitativeProxyResult {
  const constraints: ExtractedGoalConstraint[] = [];
  const warnings: string[] = [];
  const seenTargets = new Set<string>();

  for (const mapping of QUALITATIVE_PROXY_MAPPINGS) {
    mapping.pattern.lastIndex = 0;
    const match = mapping.pattern.exec(brief);

    if (match) {
      // Skip if we already have a constraint for this target
      if (seenTargets.has(mapping.targetNodeId)) {
        continue;
      }
      seenTargets.add(mapping.targetNodeId);

      constraints.push({
        targetName: mapping.targetName,
        targetNodeId: mapping.targetNodeId,
        operator: mapping.operator,
        value: mapping.defaultValue,
        unit: mapping.unit,
        label: mapping.label,
        sourceQuote: match[0].slice(0, 200),
        confidence: mapping.confidence,
        provenance: "proxy",
      });

      warnings.push(mapping.warning);
    }
  }

  return { constraints, warnings };
}

/**
 * Check if any qualitative patterns are present in the brief.
 * Useful for quick pre-filtering.
 */
export function hasQualitativeLanguage(brief: string): boolean {
  return QUALITATIVE_PROXY_MAPPINGS.some((mapping) => {
    mapping.pattern.lastIndex = 0;
    return mapping.pattern.test(brief);
  });
}

/**
 * Get all available proxy mappings.
 * Useful for documentation or UI display.
 */
export function getAvailableProxies(): Array<{
  pattern: string;
  targetName: string;
  defaultValue: number;
  unit: string;
  operator: ">=" | "<=";
}> {
  return QUALITATIVE_PROXY_MAPPINGS.map((m) => ({
    pattern: m.pattern.source,
    targetName: m.targetName,
    defaultValue: m.defaultValue,
    unit: m.unit,
    operator: m.operator,
  }));
}
