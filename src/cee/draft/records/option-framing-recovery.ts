import { buildCeeErrorResponse } from "../../validation/pipeline.js";

export const OPTION_FRAMING_WARNING_ID = "QUESTION_NOT_AN_OPTION";

interface FramingGap {
  reason: "decision_framing_not_an_option";
  node_id: string;
  label: string;
}

/** Read the existing disclosure carrier, never infer a gap from a baseline flag. */
export function optionFramingGaps(disclosures: unknown): FramingGap[] {
  if (!Array.isArray(disclosures)) return [];
  return disclosures.filter((entry): entry is FramingGap =>
    entry !== null && typeof entry === "object" &&
    entry.reason === "decision_framing_not_an_option" &&
    typeof entry.node_id === "string" && typeof entry.label === "string",
  );
}

/** Do not let structural repair invent the missing alternative after quarantine. */
export function optionFramingRecovery(
  nodes: readonly { kind?: string }[],
  disclosures: unknown,
  requestId: string,
): { statusCode: number; body: Record<string, unknown> } | undefined {
  const gaps = optionFramingGaps(disclosures);
  // Two genuine alternatives can continue through the existing readiness and
  // calibration path. Numeric incompleteness is not another framing failure.
  if (gaps.length === 0 || nodes.filter(n => n.kind === "option").length >= 2) return;
  const body = buildCeeErrorResponse("CEE_GRAPH_INVALID", "The alternatives need clarification", {
    requestId,
    reason: "option_framing_incomplete",
    retryable: true,
    recovery: {
      suggestion: "The draft treated your question as an option. I could not identify enough separate alternatives to compare without inventing one. Please name the alternatives, or retry the draft.",
      hints: [
        "Describe at least two courses of action you want to compare",
        "Include the current approach only if it is a real alternative",
      ],
    },
  });
  return { statusCode: 400, body: { ...body, details: {
    ...body.details,
    unresolved_framing: gaps.map(({ node_id, label }) => ({ node_id, label })),
  } } };
}

/** Explicit human-readable disclosure; the rest of a usable model stays usable. */
export function optionFramingWarnings(disclosures: unknown) {
  return optionFramingGaps(disclosures).map(gap => ({
    id: OPTION_FRAMING_WARNING_ID,
    severity: "medium" as const,
    affected_node_ids: [],
    affected_edge_ids: [],
    explanation: `“${gap.label}” describes the question, not an alternative. It was excluded from the comparison; the remaining alternatives are preserved.`,
    fix_hint: "Clarify which alternatives should represent this question. No baseline has been invented to fill the gap.",
  }));
}
