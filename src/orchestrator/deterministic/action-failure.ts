/**
 * Action Failure Handlers
 *
 * Per-action failure policies — each failure type maps to a recovery strategy
 * that returns user-facing text + optional recovery chips.
 */

import type { SuggestedAction } from "../types.js";
import type { ActionName } from "./actions/types.js";
import type { ResolvedEntity } from "./entity-resolver.js";
import { ACTION_CATALOGUE } from "./actions/registry.js";

// ============================================================================
// Failure Types
// ============================================================================

export type FailureType =
  | 'target_not_found'
  | 'prerequisites_missing'
  | 'validation_failed'
  | 'execution_error'
  | 'noop'
  | 'llm_malformed';

// ============================================================================
// Failure Result
// ============================================================================

export interface ActionFailureResult {
  assistantText: string;
  suggested_actions?: SuggestedAction[];
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Handle an action failure and produce a user-facing recovery response.
 */
export function handleActionFailure(
  failureType: FailureType,
  actionType: ActionName,
  details: FailureDetails,
): ActionFailureResult {
  switch (failureType) {
    case 'target_not_found':
      return handleTargetNotFound(actionType, details);
    case 'prerequisites_missing':
      return handlePrerequisitesMissing(actionType, details);
    case 'validation_failed':
      return handleValidationFailed(actionType, details);
    case 'execution_error':
      return handleExecutionError(actionType, details);
    case 'noop':
      return handleNoop(actionType, details);
    case 'llm_malformed':
      return handleMalformed(actionType, details);
  }
}

// ============================================================================
// Detail Types
// ============================================================================

export interface FailureDetails {
  /** The target reference that was provided. */
  target_ref?: string;
  /** Closest matching entities (for target_not_found). */
  candidates?: ResolvedEntity[];
  /** Prerequisite error message. */
  prerequisite_reason?: string;
  /** Suggested next action. */
  suggested_action?: ActionName;
  /** Validation rule that failed. */
  validation_rule?: string;
  /** Validation message. */
  validation_message?: string;
  /** Execution error message. */
  error_message?: string;
  /** What's already in place (for noop). */
  current_state?: string;
}

// ============================================================================
// Handlers
// ============================================================================

function handleTargetNotFound(actionType: ActionName, details: FailureDetails): ActionFailureResult {
  const ref = details.target_ref ?? 'that element';
  const candidates = details.candidates ?? [];

  if (candidates.length > 0) {
    const names = candidates.map((c) => c.label).join(', ');
    return {
      assistantText: `"${ref}" isn't in the model. Did you mean ${names}?`,
      suggested_actions: candidates.slice(0, 2).map((c) => ({
        label: c.label,
        prompt: `${actionType.replace(/_/g, ' ')} ${c.label}`,
        role: 'facilitator' as const,
      })),
    };
  }

  return {
    assistantText: `"${ref}" isn't in the model. Check the factor names and try again.`,
  };
}

function handlePrerequisitesMissing(actionType: ActionName, details: FailureDetails): ActionFailureResult {
  const reason = details.prerequisite_reason ?? 'prerequisites not met';
  const result: ActionFailureResult = {
    assistantText: `Can't ${actionType.replace(/_/g, ' ')} yet: ${reason}`,
  };

  if (details.suggested_action) {
    const suggestedDef = ACTION_CATALOGUE.get(details.suggested_action);
    if (suggestedDef) {
      result.suggested_actions = [{
        label: suggestedDef.chipLabel({ action_type: details.suggested_action }),
        prompt: suggestedDef.chipPrompt({ action_type: details.suggested_action }),
        role: 'facilitator',
      }];
    }
  }

  return result;
}

function handleValidationFailed(_actionType: ActionName, details: FailureDetails): ActionFailureResult {
  const rule = details.validation_rule ?? 'Validation';
  const message = details.validation_message ?? 'The change couldn\'t be validated.';
  return {
    assistantText: `${rule}: ${message}`,
  };
}

function handleExecutionError(actionType: ActionName, details: FailureDetails): ActionFailureResult {
  const error = details.error_message ?? 'An error occurred.';
  return {
    assistantText: `The ${actionType.replace(/_/g, ' ')} couldn't be applied: ${error}`,
    suggested_actions: [{
      label: 'Try again',
      prompt: actionType.replace(/_/g, ' '),
      role: 'facilitator',
    }],
  };
}

function handleNoop(_actionType: ActionName, details: FailureDetails): ActionFailureResult {
  const current = details.current_state ?? 'The requested change';
  return {
    assistantText: `${current} is already in place.`,
  };
}

function handleMalformed(_actionType: ActionName, _details: FailureDetails): ActionFailureResult {
  return {
    assistantText: "I understood what you're asking, but I need a bit more detail. Could you rephrase?",
  };
}
