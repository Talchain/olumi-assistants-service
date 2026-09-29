/**
 * User-facing copy for the deterministic `add_risk` clarification path.
 *
 * This is deterministic fallback copy, not an LLM prompt, not loaded from
 * PMS, and intentionally not subject to runtime prompt resolution.
 *
 * Bare add-risk requests such as "Add team dynamics as a risk" are
 * high-confidence edit intent, but they do not specify what drives the risk.
 * Creating a risk node without that driver would require inventing topology,
 * so the deterministic path asks for the missing causal factor instead of
 * mutating the graph.
 */

export function buildAddRiskClarification(label: string): string {
  const displayLabel = displayRiskLabel(label);
  return (
    `I can add ‘${displayLabel}’ as a risk. ` +
    `What factor drives it most — for example team size, hiring pace, or onboarding complexity?`
  );
}

function displayRiskLabel(label: string): string {
  const normalised = label.trim().replace(/\s+/g, ' ');
  if (normalised.length === 0) return 'This';
  return normalised.charAt(0).toUpperCase() + normalised.slice(1);
}