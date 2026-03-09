/**
 * Deterministic First-Question Selector
 *
 * Given BIL output, selects the single highest-priority gap to ask about.
 * Pure function — no side effects.
 *
 * Priority ladder (first match wins):
 * 1. goal — missing_elements includes 'goal'
 * 2. options — bil.options.length < 2 (NOT from missing_elements)
 * 3. constraints — missing_elements includes 'constraints'
 * 4. status_quo — missing_elements includes 'status_quo_option' AND options >= 2
 * 5. time_horizon / success_metric / risk_factors — first found in missing_elements
 */

import type { BriefIntelligence } from "../../schemas/brief-intelligence.js";

type MissingElement = BriefIntelligence['missing_elements'][number];

// ============================================================================
// Types
// ============================================================================

export type GapId =
  | 'goal'
  | 'options'
  | 'constraints'
  | 'status_quo'
  | 'time_horizon'
  | 'success_metric'
  | 'risk_factors';

export interface PrimaryGap {
  gap_id: GapId;
  coaching_prompt: string;
}

// ============================================================================
// Coaching prompts per gap
// ============================================================================

const COACHING_PROMPTS: Record<GapId, string> = {
  goal: 'What outcome are you trying to achieve? A clear, measurable goal helps the model focus on what matters most.',
  options: 'What alternatives are you considering? The model needs at least two options to compare.',
  constraints: 'Are there any hard limits, budgets, or non-negotiable requirements that should constrain the analysis?',
  status_quo: 'What happens if you do nothing — is there a status quo or default option to compare against?',
  time_horizon: 'Over what time period should the model evaluate outcomes?',
  success_metric: 'How will you measure success? A concrete metric helps ground the analysis.',
  risk_factors: 'What risks or uncertainties concern you most about this decision?',
};

// ============================================================================
// Selector
// ============================================================================

/**
 * Select the single highest-priority gap from BIL output.
 * Returns null when no gaps detected.
 */
export function selectPrimaryGap(bil: BriefIntelligence): PrimaryGap | null {
  const missing = new Set(bil.missing_elements);

  // 1. Goal
  if (missing.has('goal')) {
    return { gap_id: 'goal', coaching_prompt: COACHING_PROMPTS.goal };
  }

  // 2. Options (< 2 options, regardless of missing_elements)
  if (bil.options.length < 2) {
    return { gap_id: 'options', coaching_prompt: COACHING_PROMPTS.options };
  }

  // 3. Constraints
  if (missing.has('constraints')) {
    return { gap_id: 'constraints', coaching_prompt: COACHING_PROMPTS.constraints };
  }

  // 4. Status quo — suppress when options < 2 (already handled above, but defensive)
  if (missing.has('status_quo_option') && bil.options.length >= 2) {
    return { gap_id: 'status_quo', coaching_prompt: COACHING_PROMPTS.status_quo };
  }

  // 5. Remaining gaps in priority order
  const remainingPriority: Array<{ element: MissingElement; gap_id: GapId }> = [
    { element: 'time_horizon', gap_id: 'time_horizon' },
    { element: 'success_metric', gap_id: 'success_metric' },
    { element: 'risk_factors', gap_id: 'risk_factors' },
  ];

  for (const { element, gap_id } of remainingPriority) {
    if (missing.has(element)) {
      return { gap_id, coaching_prompt: COACHING_PROMPTS[gap_id] };
    }
  }

  return null;
}
