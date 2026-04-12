// TEMPLATE AUDIT (12 April 2026)
//
// 6 migrated (handler emits HandlerFact → composer generates text):
//   1. draft_created   — fact.data: option_count, goal_label.  Coaching: tradeoff, biggest_inference, calibration_target.  Handler: actions/draft-graph.ts
//   2. factor_added    — fact.data: value_label, target_label, category.  Coaching: critical_gap.  Handler: actions/add-factor.ts
//   3. option_added    — fact.data: intervention_count.  Coaching: (unused).  Handler: actions/add-option.ts
//   4. value_set       — fact.data: new_value, unit.  Coaching: drivers[0].  Handler: actions/set-factor-value.ts
//   5. analysis_complete — fact.data: (none).  Coaching: headline, drivers, cta.  Handler: actions/run-analysis.ts, actions/explain-result.ts
//   6. analysis_started — fact.data: (none).  Coaching: (unused).  Handler: (pipeline internal)
//
// 8 unmigrated (legacy assistantText, composer templates are transitional placeholders):
//   7. edge_adjusted        — actions/adjust-edge-strength.ts
//   8. constraint_added     — actions/add-constraint.ts
//   9. factor_removed       — actions/remove-factor.ts
//  10. goal_target_set      — actions/set-goal-target.ts
//  11. premortem_run        — actions/run-premortem.ts
//  12. assumption_challenged — actions/challenge-assumption.ts
//  13. brief_generated      — actions/generate-artefact.ts
//  14. evidence_found       — actions/what-would-flip.ts
//

/**
 * Response Composer (WS2)
 *
 * Handlers emit a structured HandlerFact instead of a raw assistantText
 * string. The composer reads the fact + CoachingContext + hasPatchBlock
 * flag and produces user-facing text deterministically.
 *
 * Design rules (enforced by contract tests):
 *   - Decision-first: lead with decision significance, not model operations.
 *   - When hasPatchBlock=true: 1 sentence orientation only (except
 *     draft_created which allows up to 2). The patch card carries the
 *     structural detail.
 *   - When hasPatchBlock=false: 1-2 sentences maximum.
 *   - No confirmation prose: "Confirm to apply", "Please confirm", and
 *     similar are banned. Accept/Dismiss buttons handle this.
 *   - No completion verbs: "I'll add", "Updated", "Added", "Done", "Applied".
 *   - No internal jargon: "interventions", "patch", "graph_patch".
 *   - No em dashes. British English. Sentence case.
 *   - Entity labels from HandlerFact ground the text when available.
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
 *
 * @param hasPatchBlock  True when the current turn will emit a visible
 *   graph_patch card. When true, migrated templates produce a short
 *   orientation sentence only (the card carries the structural detail).
 */
export function composeResponse(
  fact: HandlerFact,
  coaching: CoachingContext | null,
  hasPatchBlock: boolean = false,
): string {
  switch (fact.action) {
    case 'draft_created':
      return composeDraftCreated(fact, coaching, hasPatchBlock);
    case 'factor_added':
      return composeFactorAdded(fact, coaching, hasPatchBlock);
    case 'option_added':
      return composeOptionAdded(fact, coaching, hasPatchBlock);
    case 'value_set':
      return composeValueSet(fact, coaching, hasPatchBlock);
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

function composeDraftCreated(fact: HandlerFact, coaching: CoachingContext | null, hasPatchBlock: boolean): string {
  const goalLabel = (fact.data?.goal_label as string | undefined) ?? 'your decision';
  const parts: string[] = [];

  // Lead with the core trade-off when coaching context is available.
  if (coaching?.tradeoff) {
    const t = coaching.tradeoff;
    parts.push(`Your ${goalLabel} trades ${t.benefit_a} against ${t.benefit_b}.`);
  } else {
    parts.push(`Your ${goalLabel} is ready to explore.`);
  }

  // Biggest inference — highlights what's estimated vs from brief.
  // Allowed as a second sentence even when hasPatchBlock=true (draft_created exception).
  if (coaching?.biggest_inference) {
    const bi = coaching.biggest_inference;
    parts.push(`${bi.factor_label} is the biggest assumption, inferred from ${bi.reason}.`);
  }

  if (hasPatchBlock) {
    // Draft always has a patch card — cap at 2 sentences (orientation only).
    return parts.slice(0, 2).join(' ');
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

function composeFactorAdded(fact: HandlerFact, coaching: CoachingContext | null, hasPatchBlock: boolean): string {
  const entity = fact.entities_affected[0];
  if (!entity) return fact.what_changed;
  const kind = entity.kind === 'risk' ? 'risk factor' : 'factor';
  const connectionSegment = fact.data?.target_label
    ? ` connecting to ${fact.data.target_label}`
    : '';

  // Pull why_it_matters from handler or coaching context.
  const significance =
    fact.why_it_matters
    ?? (coaching?.critical_gap?.type === 'missing_factor' ? coaching.critical_gap.detail : null);

  if (hasPatchBlock) {
    // Orientation only — the patch card shows the structural detail.
    if (significance) return ensureSentencePunctuation(significance);
    return `${entity.label} captures a ${kind} that could shift the balance of the decision.`;
  }

  if (fact.auto_apply) {
    const base = `${entity.label} is now in the model as a ${kind}${connectionSegment}.`;
    return significance ? `${base} ${significance}` : base;
  }

  // Proposal framing — no "Confirm to apply".
  const base = `${entity.label} would capture a ${kind}${connectionSegment}.`;
  return significance ? `${base} ${significance}` : base;
}

function composeOptionAdded(fact: HandlerFact, _coaching: CoachingContext | null, hasPatchBlock: boolean): string {
  const entity = fact.entities_affected[0];
  if (!entity) return fact.what_changed;
  const interventionCount = (fact.data?.intervention_count as number | undefined) ?? 0;
  const summary = interventionCount > 0
    ? ` with ${interventionCount} effect${interventionCount === 1 ? '' : 's'}`
    : '';

  if (hasPatchBlock) {
    // Orientation only — the patch card shows the option detail.
    return `${entity.label} adds a different path to your decision.`;
  }

  if (fact.auto_apply) {
    return `${entity.label} is now captured as an option${summary}.`;
  }

  // Proposal framing — no "Confirm to apply".
  return summary
    ? `${entity.label} would add a different path${summary} to your decision.`
    : `${entity.label} would add a different path to your decision.`;
}

function composeValueSet(fact: HandlerFact, coaching: CoachingContext | null, hasPatchBlock: boolean): string {
  const entity = fact.entities_affected[0];
  if (!entity) return fact.what_changed;
  const newValue = fact.data?.new_value;
  const unit = (fact.data?.unit as string | undefined) ?? '';
  const valueStr = newValue != null ? `${newValue}${unit ? ' ' + unit : ''}` : '?';
  const isTopDriver = coaching?.drivers?.[0]?.factor_id === entity.id;

  if (hasPatchBlock) {
    // Orientation only — the patch card shows the calibration detail.
    // Strictly 1 sentence.
    if (isTopDriver) return `At ${valueStr}, ${entity.label} is the factor the outcome is most sensitive to.`;
    if (fact.why_it_matters) return ensureSentencePunctuation(`${entity.label} at ${valueStr} ${lowercaseFirst(fact.why_it_matters)}`);
    return `${entity.label} calibrated to ${valueStr}.`;
  }

  if (fact.auto_apply) {
    const base = `${entity.label} set to ${valueStr}.`;
    if (isTopDriver) return `${base} This is the factor the outcome is most sensitive to.`;
    if (fact.why_it_matters) return `${base} ${fact.why_it_matters}`;
    return base;
  }

  // Proposal framing — no "Confirm to apply".
  if (fact.why_it_matters) return ensureSentencePunctuation(`${entity.label} at ${valueStr} would ${lowercaseFirst(fact.why_it_matters)}`);
  return `${entity.label} at ${valueStr} would shift the balance of the decision.`;
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
  // One sentence of orientation only. The results blocks carry the
  // headline, driver breakdown, and CTA detail.
  const h = coaching?.headline;
  if (!h) {
    return fact.what_changed || 'Analysis results are ready.';
  }

  return `${h.leading_option} leads at ${h.leading_probability}%.`;
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

/**
 * Lowercase the first character of a string. Used when splicing
 * why_it_matters into mid-sentence position (e.g. "X at Y would {why}").
 */
function lowercaseFirst(text: string): string {
  if (!text) return text;
  return text.charAt(0).toLowerCase() + text.slice(1);
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
