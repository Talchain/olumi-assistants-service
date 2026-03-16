/**
 * Turn Contract (v1.0)
 *
 * Documents the field contract per turn type as code.
 * The Zod schema in route.ts is authoritative — this constant
 * mirrors its behaviour for diagnostics and observability.
 */

import { classifyIntent } from "./intent-gate.js";

// ============================================================================
// Contract Version
// ============================================================================

export const TURN_CONTRACT_VERSION = '1.0';

// ============================================================================
// Turn Types
// ============================================================================

export type TurnType =
  | 'conversation'
  | 'explicit_generate'
  | 'run_analysis'
  | 'system_event'
  | 'patch_followup'
  | 'explain'
  | 'clarification_response';

// ============================================================================
// Field Requirements
// ============================================================================

export type FieldRequirement = 'required' | 'optional' | 'forbidden';

export type ContractField =
  | 'message'
  | 'scenario_id'
  | 'client_turn_id'
  | 'conversation_history'
  | 'graph_state'
  | 'analysis_state'
  | 'analysis_inputs'
  | 'system_event'
  | 'selected_elements';

/**
 * Turn-type → field requirement matrix.
 *
 * 'required'  — field must be present for the turn to make sense
 * 'optional'  — field may be present; no warning if absent
 * 'forbidden' — field should not be present; logged as diagnostic warning
 */
export const TURN_FIELD_CONTRACT: Record<TurnType, Record<ContractField, FieldRequirement>> = {
  conversation: {
    message:               'required',
    scenario_id:           'required',
    client_turn_id:        'required',
    conversation_history:  'optional',
    graph_state:           'optional',
    analysis_state:        'optional',
    analysis_inputs:       'optional',
    system_event:          'forbidden',
    selected_elements:     'optional',
  },
  explicit_generate: {
    message:               'required',
    scenario_id:           'required',
    client_turn_id:        'required',
    conversation_history:  'optional',
    graph_state:           'optional',
    analysis_state:        'forbidden',
    analysis_inputs:       'optional',
    system_event:          'forbidden',
    selected_elements:     'optional',
  },
  run_analysis: {
    message:               'required',
    scenario_id:           'required',
    client_turn_id:        'required',
    conversation_history:  'optional',
    graph_state:           'required',
    analysis_state:        'optional',
    analysis_inputs:       'required',
    system_event:          'forbidden',
    selected_elements:     'optional',
  },
  system_event: {
    message:               'optional',
    scenario_id:           'required',
    client_turn_id:        'required',
    conversation_history:  'optional',
    graph_state:           'optional',
    analysis_state:        'optional',
    analysis_inputs:       'optional',
    system_event:          'required',
    selected_elements:     'optional',
  },
  patch_followup: {
    message:               'required',
    scenario_id:           'required',
    client_turn_id:        'required',
    conversation_history:  'required',
    graph_state:           'optional',
    analysis_state:        'optional',
    analysis_inputs:       'optional',
    system_event:          'forbidden',
    selected_elements:     'optional',
  },
  explain: {
    message:               'required',
    scenario_id:           'required',
    client_turn_id:        'required',
    conversation_history:  'optional',
    graph_state:           'optional',
    analysis_state:        'required',
    analysis_inputs:       'optional',
    system_event:          'forbidden',
    selected_elements:     'optional',
  },
  clarification_response: {
    message:               'required',
    scenario_id:           'required',
    client_turn_id:        'required',
    conversation_history:  'required',
    graph_state:           'optional',
    analysis_state:        'optional',
    analysis_inputs:       'optional',
    system_event:          'forbidden',
    selected_elements:     'optional',
  },
} as const;

// ============================================================================
// Turn Type Inference
// ============================================================================

/** Patterns that indicate a patch confirmation message. */
const PATCH_CONFIRMATION_PATTERNS = /^(yes|accept|apply it|apply|looks good|go ahead|confirm|ok|do it|sure|approved)$/i;

/**
 * Infer the turn type from the raw request body.
 *
 * Priority order:
 *   1. system_event present          → 'system_event'
 *   2. generate_model === true       → 'explicit_generate'
 *   3. intent-gate matches analysis  → 'run_analysis'
 *   4. intent-gate matches explain   → 'explain'
 *   5. pending clarification in conversational_state → 'clarification_response'
 *   6. patch followup heuristic      → 'patch_followup'
 *   7. default                       → 'conversation'
 */
export function inferTurnType(body: Record<string, unknown>): TurnType {
  // 1. System event
  if (body.system_event != null) {
    return 'system_event';
  }

  // 2. Explicit generate (accept both field names — UI sends explicit_generate)
  if (body.generate_model === true || body.explicit_generate === true) {
    return 'explicit_generate';
  }

  // 3–4. Intent gate for run_analysis / explain
  const message = typeof body.message === 'string' ? body.message : '';
  if (message) {
    const intent = classifyIntent(message);
    if (intent.tool === 'run_analysis') return 'run_analysis';
    if (intent.tool === 'explain_results') return 'explain';
  }

  // 5. Clarification response: pending_clarification in conversational_state
  const context = body.context as Record<string, unknown> | undefined;
  const convState = context?.conversational_state as Record<string, unknown> | undefined;
  if (convState?.pending_clarification != null) {
    return 'clarification_response';
  }

  // 6. Patch followup: conversation_history contains recent patch_accepted/pending,
  //    or message matches patch confirmation pattern.
  if (message && PATCH_CONFIRMATION_PATTERNS.test(message.trim())) {
    // Check if there's a pending proposal in conversational state
    if (convState?.pending_proposal != null) {
      return 'patch_followup';
    }
  }

  // Also detect if conversation_history has recent patch-related assistant_tool_calls
  const history = (body.conversation_history ?? context?.messages) as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(history) && history.length > 0) {
    const lastAssistant = [...history].reverse().find(m => m.role === 'assistant');
    if (lastAssistant) {
      const toolCalls = (lastAssistant.tool_calls ?? lastAssistant.assistant_tool_calls) as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(toolCalls) && toolCalls.some(tc => tc.name === 'edit_graph')) {
        if (message && PATCH_CONFIRMATION_PATTERNS.test(message.trim())) {
          return 'patch_followup';
        }
      }
    }
  }

  // 7. Default
  return 'conversation';
}

// ============================================================================
// Contract Validation (Diagnostic)
// ============================================================================

export interface ContractDiagnostic {
  inferred_turn_type: TurnType;
  contract_version: string;
  forbidden_fields_present: string[];
  missing_required_fields: string[];
  partial_fields: Record<string, { present: string[]; missing: string[] }>;
}

/**
 * Required nested keys for analysis_state when present.
 * Used to detect partial payloads.
 */
const ANALYSIS_STATE_REQUIRED_KEYS: readonly string[] = ['meta', 'results'];
const ANALYSIS_STATE_META_REQUIRED_KEYS: readonly string[] = ['response_hash'];

/**
 * Validate a request body against the turn-type contract.
 *
 * This is diagnostic only — the Zod schema is authoritative.
 * Returns structured information about contract mismatches.
 */
export function validateTurnContract(
  turnType: TurnType,
  body: Record<string, unknown>,
): ContractDiagnostic {
  const contract = TURN_FIELD_CONTRACT[turnType];

  const forbidden: string[] = [];
  const missing: string[] = [];
  const partial: Record<string, { present: string[]; missing: string[] }> = {};

  for (const [field, requirement] of Object.entries(contract) as Array<[ContractField, FieldRequirement]>) {
    const value = resolveFieldValue(field, body);
    const isPresent = value != null;

    if (requirement === 'forbidden' && isPresent) {
      forbidden.push(field);
    }

    if (requirement === 'required' && !isPresent) {
      missing.push(field);
    }
  }

  // Check analysis_state partial completeness
  const analysisState = body.analysis_state as Record<string, unknown> | undefined | null;
  if (analysisState != null && typeof analysisState === 'object') {
    const presentKeys: string[] = [];
    const missingKeys: string[] = [];

    for (const key of ANALYSIS_STATE_REQUIRED_KEYS) {
      if (key in analysisState && analysisState[key] != null) {
        presentKeys.push(key);
      } else {
        missingKeys.push(key);
      }
    }

    // Check meta.response_hash if meta is present
    const meta = analysisState.meta as Record<string, unknown> | undefined;
    if (meta && typeof meta === 'object') {
      for (const key of ANALYSIS_STATE_META_REQUIRED_KEYS) {
        if (key in meta && meta[key] != null) {
          presentKeys.push(`meta.${key}`);
        } else {
          missingKeys.push(`meta.${key}`);
        }
      }
    } else if (!('meta' in analysisState)) {
      missingKeys.push('meta.response_hash');
    }

    if (missingKeys.length > 0) {
      partial.analysis_state = { present: presentKeys, missing: missingKeys };
    }
  }

  return {
    inferred_turn_type: turnType,
    contract_version: TURN_CONTRACT_VERSION,
    forbidden_fields_present: forbidden,
    missing_required_fields: missing,
    partial_fields: partial,
  };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve a contract field name to its value in the request body.
 *
 * Most fields are top-level on the body. `selected_elements` and
 * `analysis_inputs` may also appear nested inside `context`.
 */
function resolveFieldValue(field: ContractField, body: Record<string, unknown>): unknown {
  // Direct top-level check first
  if (field in body && body[field] != null) {
    return body[field];
  }

  // Some fields may be nested inside context
  const context = body.context as Record<string, unknown> | undefined;
  if (context && field in context && context[field] != null) {
    return context[field];
  }

  return undefined;
}
