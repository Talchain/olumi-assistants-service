/**
 * Pre-Decision Checklist and Framing Nudges Generator
 *
 * Generates contextual pre-decision checks and framing nudges based on
 * the draft graph structure to help users avoid common decision biases.
 */

import type { GraphT as Graph } from "../../schemas/graph.js";

// ============================================================================
// Types
// ============================================================================

export type PreDecisionCheck = {
  id: string;
  category: "completeness" | "bias" | "scope" | "stakeholders" | "reversibility";
  question: string;
  why_it_matters: string;
  suggested_action?: string;
};

export type FramingNudge = {
  id: string;
  type: "anchoring_warning" | "scope_prompt" | "alternatives_prompt" | "time_pressure" | "sunk_cost";
  message: string;
  severity: "info" | "warning";
};

export type PreDecisionChecklist = {
  checks: PreDecisionCheck[];
  framing_nudges: FramingNudge[];
};

// ============================================================================
// Check Generation
// ============================================================================

/**
 * Generate pre-decision checks based on graph structure
 */
function generateChecks(graph: Graph, brief: string): PreDecisionCheck[] {
  const checks: PreDecisionCheck[] = [];

  // Count node types
  const optionNodes = graph.nodes.filter(n => n.kind === "option");
  const riskNodes = graph.nodes.filter(n => n.kind === "risk");
  const actionNodes = graph.nodes.filter(n => n.kind === "action");

  // Check 1: Completeness - Are there enough options?
  if (optionNodes.length < 3) {
    checks.push({
      id: "check_options_count",
      category: "completeness",
      question: "Have you considered all viable alternatives?",
      why_it_matters: "Decisions often improve when we consider at least 3 distinct options before choosing.",
      suggested_action: "List any alternatives you may have dismissed too quickly.",
    });
  }

  // Check 2: Completeness - Are risks considered?
  if (riskNodes.length === 0) {
    checks.push({
      id: "check_risks_identified",
      category: "completeness",
      question: "What could go wrong with each option?",
      why_it_matters: "Identifying risks early helps you prepare mitigation strategies.",
      suggested_action: "For each option, list at least one potential downside or risk.",
    });
  }

  // Check 3: Bias - Is there option with disproportionate detail?
  const optionEdgeCounts = optionNodes.map(opt => {
    const edges = graph.edges.filter(e => e.from === opt.id || e.to === opt.id);
    return { id: opt.id, count: edges.length };
  });

  if (optionEdgeCounts.length >= 2) {
    const maxEdges = Math.max(...optionEdgeCounts.map(o => o.count));
    const minEdges = Math.min(...optionEdgeCounts.map(o => o.count));
    if (maxEdges > minEdges * 2 && maxEdges > 3) {
      checks.push({
        id: "check_balanced_analysis",
        category: "bias",
        question: "Are you analyzing all options equally?",
        why_it_matters: "Confirmation bias can lead us to over-research our preferred option while neglecting others.",
        suggested_action: "Ensure each option has similar depth of analysis.",
      });
    }
  }

  // Check 4: Stakeholders - Consider affected parties
  if (!brief.toLowerCase().includes("stakeholder") &&
      !brief.toLowerCase().includes("team") &&
      !brief.toLowerCase().includes("customer")) {
    checks.push({
      id: "check_stakeholders",
      category: "stakeholders",
      question: "Who will be affected by this decision?",
      why_it_matters: "Important stakeholders may have perspectives or constraints that should influence the decision.",
      suggested_action: "List key stakeholders and consider how each option affects them.",
    });
  }

  // Check 5: Reversibility - Can this be undone?
  if (actionNodes.length > 0) {
    checks.push({
      id: "check_reversibility",
      category: "reversibility",
      question: "How reversible is this decision?",
      why_it_matters: "Irreversible decisions warrant more careful analysis, while reversible ones can be tested quickly.",
      suggested_action: "Classify this as a one-way door (irreversible) or two-way door (easily reversible).",
    });
  }

  // Check 6: Scope - Is the scope appropriate?
  if (graph.nodes.length > 20 || graph.edges.length > 30) {
    checks.push({
      id: "check_scope_complexity",
      category: "scope",
      question: "Could this be broken into smaller decisions?",
      why_it_matters: "Complex decisions are often easier to manage when decomposed into smaller, independent choices.",
      suggested_action: "Identify if there are sub-decisions that could be handled separately.",
    });
  }

  // Limit to 5 most relevant checks
  return checks.slice(0, 5);
}

/**
 * Generate framing nudges based on graph and brief analysis
 */
function generateFramingNudges(graph: Graph, brief: string): FramingNudge[] {
  const nudges: FramingNudge[] = [];
  const briefLower = brief.toLowerCase();

  // Anchoring warning - Look for specific numbers that might anchor thinking
  const hasSpecificNumbers = /\$\d+|\d+%|\d+\s*(million|thousand|k|m|billion)/i.test(brief);
  if (hasSpecificNumbers) {
    nudges.push({
      id: "nudge_anchoring",
      type: "anchoring_warning",
      message: "Numbers in your brief may anchor your thinking. Consider if these figures are truly fixed constraints or starting points for negotiation.",
      severity: "info",
    });
  }

  // Time pressure nudge
  if (/urgent|immediately|asap|right away|deadline tomorrow|this week/i.test(briefLower)) {
    nudges.push({
      id: "nudge_time_pressure",
      type: "time_pressure",
      message: "Time pressure can lead to hasty decisions. Verify if the urgency is real or perceived.",
      severity: "warning",
    });
  }

  // Sunk cost nudge - Look for investment language
  if (/already invested|spent|committed|so far|to date/i.test(briefLower)) {
    nudges.push({
      id: "nudge_sunk_cost",
      type: "sunk_cost",
      message: "Past investments shouldn't influence future decisions. Focus on forward-looking costs and benefits.",
      severity: "warning",
    });
  }

  // Scope prompt - When decision seems broad
  const optionNodes = graph.nodes.filter(n => n.kind === "option");
  if (optionNodes.length > 5) {
    nudges.push({
      id: "nudge_scope_broad",
      type: "scope_prompt",
      message: "Many options detected. Consider if some options are variations that could be grouped together.",
      severity: "info",
    });
  }

  // Alternatives prompt - When there's a strong default
  if (/current|existing|continue|keep|maintain/i.test(briefLower)) {
    nudges.push({
      id: "nudge_status_quo",
      type: "alternatives_prompt",
      message: "The status quo is not always the safest choice. Actively consider what would make each alternative better than continuing as-is.",
      severity: "info",
    });
  }

  // Limit to 3 nudges
  return nudges.slice(0, 3);
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generate pre-decision checklist from graph and brief
 */
export function generatePreDecisionChecklist(
  graph: Graph,
  brief: string
): PreDecisionChecklist {
  return {
    checks: generateChecks(graph, brief),
    framing_nudges: generateFramingNudges(graph, brief),
  };
}

// Export for testing
export const __test_only = {
  generateChecks,
  generateFramingNudges,
};
