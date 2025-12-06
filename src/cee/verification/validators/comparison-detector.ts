import type { GraphV1 } from "../../../contracts/plot/engine.js";
import type { VerificationContext, VerificationResult, VerificationStage } from "../types.js";

/**
 * ComparisonDetector
 *
 * Detects whether a graph structure suggests that comparison analysis would
 * add value. This is a heuristic-based detector that looks for patterns
 * indicating explicit trade-off or comparison scenarios.
 *
 * Detection signals:
 * - Multiple options from a single decision node
 * - Options connected to the same outcomes (shared targets)
 * - Presence of trade-off indicating labels (vs, versus, compare, etc.)
 */
export class ComparisonDetector implements VerificationStage<unknown, unknown> {
  readonly name = "comparison_detection" as const;

  // Keywords that strongly indicate comparison intent
  // Intentionally excludes common words like "or", "option", "either" to reduce noise
  private readonly comparisonKeywords = [
    "vs",
    "versus",
    "compare",
    "comparison",
    "trade-off",
    "tradeoff",
    "trade off",
    "alternative",
    "pros and cons",
    "weigh",
  ];

  private readonly minOptionsForComparison = 2;

  async validate(
    payload: unknown,
    _context?: VerificationContext,
  ): Promise<VerificationResult<unknown> & { comparison_suggested?: boolean }> {
    const graph = (payload as any)?.graph as GraphV1 | undefined;
    if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
      return {
        valid: true,
        stage: this.name,
        skipped: true,
        comparison_suggested: false,
      };
    }

    const nodes = (graph as any).nodes as any[];
    const edges = (graph as any).edges as any[];

    // Build node maps
    const kinds = new Map<string, string>();
    const labels = new Map<string, string>();
    for (const node of nodes) {
      const id = typeof (node as any)?.id === "string" ? ((node as any).id as string) : undefined;
      const kind = typeof (node as any)?.kind === "string" ? ((node as any).kind as string) : undefined;
      const label = typeof (node as any)?.label === "string" ? ((node as any).label as string) : undefined;
      if (!id || !kind) continue;
      kinds.set(id, kind);
      if (label) labels.set(id, label);
    }

    // Signal 1: Multiple options from same decision
    const decisionNodes = Array.from(kinds.entries()).filter(([, kind]) => kind === "decision");
    let hasMultipleOptionsFromDecision = false;

    for (const [decisionId] of decisionNodes) {
      const outgoingOptions = edges.filter((edge) => {
        const from = typeof edge?.from === "string" ? (edge.from as string) : undefined;
        const to = typeof edge?.to === "string" ? (edge.to as string) : undefined;
        return from === decisionId && to && kinds.get(to) === "option";
      });

      if (outgoingOptions.length >= this.minOptionsForComparison) {
        hasMultipleOptionsFromDecision = true;
        break;
      }
    }

    // Signal 2: Options connected to same outcomes (shared targets)
    const optionNodes = Array.from(kinds.entries()).filter(([, kind]) => kind === "option");
    const optionTargets = new Map<string, Set<string>>();

    for (const [optionId] of optionNodes) {
      const targets = new Set<string>();
      for (const edge of edges) {
        const from = typeof edge?.from === "string" ? (edge.from as string) : undefined;
        const to = typeof edge?.to === "string" ? (edge.to as string) : undefined;
        if (from === optionId && to && kinds.get(to) === "outcome") {
          targets.add(to);
        }
      }
      optionTargets.set(optionId, targets);
    }

    let hasSharedOutcomes = false;
    const optionIds = Array.from(optionTargets.keys());
    for (let i = 0; i < optionIds.length; i++) {
      for (let j = i + 1; j < optionIds.length; j++) {
        const targets1 = optionTargets.get(optionIds[i]) ?? new Set();
        const targets2 = optionTargets.get(optionIds[j]) ?? new Set();
        const intersection = new Set([...targets1].filter((x) => targets2.has(x)));
        if (intersection.size > 0) {
          hasSharedOutcomes = true;
          break;
        }
      }
      if (hasSharedOutcomes) break;
    }

    // Signal 3: Comparison keywords in labels
    const allLabels = Array.from(labels.values()).join(" ").toLowerCase();
    const hasComparisonKeywords = this.comparisonKeywords.some((keyword) => allLabels.includes(keyword.toLowerCase()));

    // Determine if comparison is suggested
    // Require at least 2 signals for a positive detection
    const signals = [hasMultipleOptionsFromDecision, hasSharedOutcomes, hasComparisonKeywords].filter(Boolean).length;

    const comparisonSuggested = signals >= 2;

    return {
      valid: true,
      stage: this.name,
      comparison_suggested: comparisonSuggested,
      details: {
        signals_detected: signals,
        has_multiple_options_from_decision: hasMultipleOptionsFromDecision,
        has_shared_outcomes: hasSharedOutcomes,
        has_comparison_keywords: hasComparisonKeywords,
        decision_count: decisionNodes.length,
        option_count: optionNodes.length,
      },
    };
  }
}
