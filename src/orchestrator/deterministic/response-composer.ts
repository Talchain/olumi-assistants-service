/**
 * Response Composer (WS2)
 *
 * Handlers emit a structured HandlerFact instead of a raw assistantText
 * string. The composer reads the fact + CoachingContext and produces the
 * user-facing text deterministically, using decision language, proposal
 * framing on auto_apply=false, and acknowledgement framing on auto_apply=true.
 *
 * Output rules (enforced by tests):
 *   - 1 to 3 sentences
 *   - No banned terms: "I'll add", "Updated", "Added", "Done", "Applied",
 *     "interventions", "node", "patch", "graph_patch"
 *   - No em dashes
 *   - Proposal language for auto_apply=false ("Proposing to ...")
 *   - Acknowledgement for auto_apply=true ("{label} set to {value}")
 *   - References coaching_context fields (tradeoff, biggest_inference,
 *     calibration_target) on draft_created
 *
 * Feature flag: CEE_COACHING_CONTEXT_ENABLED (shared with WS1/WS8).
 */

import type { CoachingContext } from "./coaching-context-builder.js";

// ============================================================================
// Types
// ============================================================================

export type HandlerAction =
  | 'draft_created'
  | 'factor_added'
  | 'option_added'
  | 'value_set'
  | 'edge_adjusted'
  | 'constraint_added'
  | 'factor_removed'
  | 'goal_target_set'
  | 'analysis_started'
  | 'analysis_complete'
  | 'premortem_run'
  | 'assumption_challenged'
  | 'brief_generated'
  | 'evidence_found';

export interface HandlerFact {
  /** Canonical action name — drives which template is applied. */
  action: HandlerAction;
  /** Entities the action touched, with label + id + kind. */
  entities_affected: Array<{ id: string; label: string; kind: string }>;
  /** Short phrase describing what changed (e.g. "strength from 0.20 to 0.75"). */
  what_changed: string;
  /** One-sentence coaching significance (filled by handler or composer). */
  why_it_matters?: string | null;
  /** True when the model has been mutated and the prior analysis is now stale. */
  stale_analysis: boolean;
  /** True when the change was applied without confirmation. */
  auto_apply: boolean;
  /** Action-specific payload (values, unit, options, etc.). */
  data?: Record<string, unknown>;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Produce user-facing text for a handler fact.
 *
 * Pure function — no side effects. The caller (pipeline-v4.ts) replaces
 * assistantText with the return value when a fact is present on ActionResult.
 */
export function composeResponse(
  fact: HandlerFact,
  coaching: CoachingContext | null,
): string {
  switch (fact.action) {
    case 'draft_created':
      return composeDraftCreated(fact, coaching);
    case 'factor_added':
      return composeFactorAdded(fact, coaching);
    case 'option_added':
      return composeOptionAdded(fact, coaching);
    case 'value_set':
      return composeValueSet(fact, coaching);
    case 'edge_adjusted':
      return composeEdgeAdjusted(fact);
    case 'constraint_added':
      return composeConstraintAdded(fact);
    case 'factor_removed':
      return composeFactorRemoved(fact);
    case 'goal_target_set':
      return composeGoalTargetSet(fact);
    case 'analysis_started':
      return composeAnalysisStarted(fact);
    case 'analysis_complete':
      return composeAnalysisComplete(fact, coaching);
    case 'premortem_run':
      return composePremortemRun(fact);
    case 'assumption_challenged':
      return composeAssumptionChallenged(fact);
    case 'brief_generated':
      return composeBriefGenerated(fact);
    case 'evidence_found':
      return composeEvidenceFound(fact);
  }
}

// ============================================================================
// Template implementations
// ============================================================================

function composeDraftCreated(fact: HandlerFact, coaching: CoachingContext | null): string {
  const optionCount = (fact.data?.option_count as number | undefined) ?? 0;
  const goalLabel = (fact.data?.goal_label as string | undefined) ?? 'your decision';
  const optionWord = optionCount === 1 ? 'approach' : 'approaches';
  const parts: string[] = [];

  parts.push(`Your model captures ${optionCount} ${optionWord} to ${goalLabel}.`);

  // Tradeoff framing from coaching context (precedence chain already applied in builder).
  if (coaching?.tradeoff) {
    const t = coaching.tradeoff;
    parts.push(`${t.option_a} offers ${t.benefit_a}; ${t.option_b} offers ${t.benefit_b}.`);
  }

  // Biggest inference — highlights what's estimated vs from brief.
  if (coaching?.biggest_inference) {
    const bi = coaching.biggest_inference;
    parts.push(`${bi.factor_label} is the biggest assumption here: it was ${bi.reason}.`);
  }

  // Calibration target — next question the user should think about.
  if (coaching?.calibration_target) {
    const ct = coaching.calibration_target;
    parts.push(
      `How strong is the effect of ${ct.source_label} on ${ct.target_label} in your experience?`,
    );
  }

  return parts.slice(0, 3).join(' ');
}

function composeFactorAdded(fact: HandlerFact, coaching: CoachingContext | null): string {
  const entity = fact.entities_affected[0];
  if (!entity) return fact.what_changed;
  const kind = entity.kind === 'risk' ? 'risk factor' : 'factor';
  const valueSegment = fact.data?.value_label ? ` (${fact.data.value_label})` : '';
  const connectionSegment = fact.data?.target_label
    ? ` connecting to ${fact.data.target_label}`
    : '';

  if (fact.auto_apply) {
    // Acknowledgement framing — neutral, no "Added/Updated/Done/Applied".
    const base = `${entity.label} is now in the model as a ${kind}${connectionSegment}.`;
    return fact.why_it_matters ? `${base} ${fact.why_it_matters}` : base;
  }

  // Proposal framing.
  const base = `Proposing to add ${entity.label}${valueSegment} as a ${kind}${connectionSegment}. Confirm to apply.`;
  // Pull why_it_matters from coaching context if the handler didn't set it.
  const coachingSignal =
    fact.why_it_matters
    ?? (coaching?.critical_gap?.type === 'missing_factor' ? coaching.critical_gap.detail : null);
  return coachingSignal ? `${base} ${coachingSignal}` : base;
}

function composeOptionAdded(fact: HandlerFact, coaching: CoachingContext | null): string {
  const entity = fact.entities_affected[0];
  if (!entity) return fact.what_changed;
  const interventionCount = (fact.data?.intervention_count as number | undefined) ?? 0;
  const summary = interventionCount > 0
    ? ` with ${interventionCount} effect${interventionCount === 1 ? '' : 's'}`
    : '';

  if (fact.auto_apply) {
    return `${entity.label} is now captured as an option${summary}.`;
  }

  void coaching;
  return `Proposing to add ${entity.label} as an option${summary}. Confirm to apply.`;
}

function composeValueSet(fact: HandlerFact, coaching: CoachingContext | null): string {
  const entity = fact.entities_affected[0];
  if (!entity) return fact.what_changed;
  const newValue = fact.data?.new_value;
  const unit = (fact.data?.unit as string | undefined) ?? '';
  const valueStr = newValue != null ? `${newValue}${unit ? ' ' + unit : ''}` : '?';

  if (fact.auto_apply) {
    const base = `${entity.label} set to ${valueStr}.`;
    // Add coaching significance if this factor is the top driver.
    if (coaching?.drivers?.[0]?.factor_id === entity.id) {
      return `${base} This is the factor the outcome is most sensitive to.`;
    }
    if (fact.why_it_matters) {
      return `${base} ${fact.why_it_matters}`;
    }
    return base;
  }

  // Proposal framing (rare for set_factor_value since it auto-applies, but kept for completeness).
  return `Proposing to set ${entity.label} to ${valueStr}. Confirm to apply.`;
}

function composeEdgeAdjusted(fact: HandlerFact): string {
  if (fact.auto_apply) {
    return `Edge strength is now ${fact.what_changed}.`;
  }
  return `Proposing to adjust edge strength: ${fact.what_changed}. Confirm to apply.`;
}

function composeConstraintAdded(fact: HandlerFact): string {
  const entity = fact.entities_affected[0];
  const label = entity?.label ?? 'constraint';
  if (fact.auto_apply) {
    return `${label} is now captured as a constraint.`;
  }
  return `Proposing to add ${label} as a constraint. Confirm to apply.`;
}

function composeFactorRemoved(fact: HandlerFact): string {
  const entity = fact.entities_affected[0];
  const label = entity?.label ?? 'the factor';
  if (fact.auto_apply) {
    return `${label} is no longer in the model.`;
  }
  return `Proposing to remove ${label} from the model. Confirm to apply.`;
}

function composeGoalTargetSet(fact: HandlerFact): string {
  const entity = fact.entities_affected[0];
  const label = entity?.label ?? 'the goal';
  const target = fact.data?.target;
  if (fact.auto_apply) {
    return `${label} target is now ${target ?? 'the new value'}.`;
  }
  return `Proposing to set ${label} target to ${target ?? 'the new value'}. Confirm to apply.`;
}

function composeAnalysisStarted(fact: HandlerFact): string {
  void fact;
  return 'Running the analysis now.';
}

function composeAnalysisComplete(fact: HandlerFact, coaching: CoachingContext | null): string {
  const h = coaching?.headline;
  if (!h) {
    return fact.what_changed || 'Analysis results are ready.';
  }

  const parts: string[] = [];
  parts.push(`${h.leading_option} leads at ${h.leading_probability}%.`);

  const topDriver = coaching?.drivers?.[0];
  if (topDriver) {
    const influence = Math.round(topDriver.sensitivity * 100);
    const calibrationNote = topDriver.is_ai_estimated
      ? '. This estimate is worth calibrating'
      : '';
    parts.push(`${topDriver.factor_label} drives ${influence}% of the outcome${calibrationNote}.`);
  }

  if (coaching?.cta?.guidance) {
    parts.push(ensureSentencePunctuation(coaching.cta.guidance));
  }

  // Each part already ends with sentence punctuation, so a single-space
  // join produces a clean multi-sentence paragraph.
  return parts.slice(0, 3).join(' ');
}

/**
 * Append a period if the sentence doesn't already end with terminal
 * punctuation. Prevents run-on sentences when composer parts are joined.
 */
function ensureSentencePunctuation(text: string): string {
  const trimmed = text.trimEnd();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function composePremortemRun(fact: HandlerFact): string {
  void fact;
  return 'Here are the most likely failure paths for your leading option.';
}

function composeAssumptionChallenged(fact: HandlerFact): string {
  const entity = fact.entities_affected[0];
  if (entity) {
    return `Looking harder at ${entity.label}. What evidence would change your view?`;
  }
  return 'Looking harder at that assumption. What evidence would change your view?';
}

function composeBriefGenerated(fact: HandlerFact): string {
  void fact;
  return 'Here is your decision brief, ready to share.';
}

function composeEvidenceFound(fact: HandlerFact): string {
  const count = (fact.data?.evidence_count as number | undefined) ?? 0;
  return count > 0
    ? `Found ${count} relevant piece${count === 1 ? '' : 's'} of evidence.`
    : 'No directly relevant evidence was found for this question.';
}
