/**
 * Response Contract Validator
 *
 * Final guard applied after envelope assembly. Mutates the envelope in place
 * to drop malformed items and guarantee renderable content.
 *
 * Violation codes (stable for dashboards and alerting):
 *   invalid_action_missing_message  — suggested_action missing label or prompt
 *   invalid_block_type              — block.block_type not in VALID_BLOCK_TYPES
 *   empty_response_fallback         — assistant_text blank/null with no blocks; fallback injected
 *   missing_stage_indicator         — stage_indicator absent or has no valid stage (V2 only)
 *
 * Ordering guarantee:
 *   1. Validate/repair stage_indicator (V2 only)
 *   2. Drop invalid suggested_actions
 *   3. Drop invalid blocks
 *   4. THEN check for empty response (after stripping, so stripping all chips/blocks
 *      still produces renderable assistant_text via fallback)
 *
 * Telemetry: one event per violation, each carrying request_id, turn_id,
 * violation_type, and field_path for actionable staging diagnostics.
 */

import type {
  OrchestratorResponseEnvelope,
} from '../types.js';
import type { OrchestratorResponseEnvelopeV2 } from '../pipeline/types.js';
import { getStageAwareFallback } from './stage-fallbacks.js';
import { log, emit, TelemetryEvents } from '../../utils/telemetry.js';

// ============================================================================
// Canonical block type vocabulary
// ============================================================================

/**
 * All valid block_type values that may appear in a response envelope.
 * Source: BlockType union in src/orchestrator/types.ts.
 * Note: model_receipt is a top-level envelope field, not a block_type.
 */
export const VALID_BLOCK_TYPES: ReadonlySet<string> = new Set([
  'framing',
  'commentary',
  'graph_patch',
  'fact',
  'review_card',
  'brief',
  'evidence',
]);

// ============================================================================
// Violation shape
// ============================================================================

export interface ContractViolation {
  code: 'invalid_action_missing_message' | 'invalid_block_type' | 'empty_response_fallback' | 'missing_stage_indicator';
  detail: string;
  /** Dot-path of the envelope field that triggered the violation (e.g. "suggested_actions[1].label") */
  field_path: string;
}

export interface ContractValidationResult {
  violations: ContractViolation[];
  envelope_modified: boolean;
}

// ============================================================================
// Internal helpers
// ============================================================================

/**
 * Emit one telemetry event per violation with full correlation fields.
 */
function emitViolation(
  violation: ContractViolation,
  turn_id: string | undefined,
  request_id?: string,
): void {
  emit(TelemetryEvents.OrchestratorContractViolation, {
    request_id: request_id ?? null,
    turn_id: turn_id ?? null,
    violation_type: violation.code,
    field_path: violation.field_path,
    detail: violation.detail,
  });
}

// ============================================================================
// V2 validator
// ============================================================================

/**
 * Validate and repair a V2 response envelope.
 *
 * Mutates the envelope in place. Returns a summary of violations found.
 * Safe to call on every response — no-ops when the envelope is clean.
 *
 * @param envelope   The assembled V2 envelope to validate.
 * @param stage      Authoritative stage from enrichedContext (bypasses envelope lookup).
 * @param request_id Optional HTTP request correlation ID for telemetry.
 */
export function validateV2EnvelopeContract(
  envelope: OrchestratorResponseEnvelopeV2,
  stage?: string,
  request_id?: string,
): ContractValidationResult {
  const violations: ContractViolation[] = [];
  let modified = false;

  const addViolation = (v: ContractViolation) => {
    violations.push(v);
    emitViolation(v, envelope.turn_id, request_id);
  };

  // 1. Validate stage_indicator — required object with a valid stage field.
  // Repair: fall back to the caller-supplied stage or 'frame' so downstream is never broken.
  const si = envelope.stage_indicator;
  if (!si?.stage) {
    const repairedStage = stage ?? 'frame';
    // Patch envelope in place so subsequent steps use a valid stage
    if (si) {
      (si as { stage: string }).stage = repairedStage;
    }
    addViolation({
      code: 'missing_stage_indicator',
      detail: `stage_indicator.stage absent or invalid — repaired to "${repairedStage}"`,
      field_path: 'stage_indicator.stage',
    });
    modified = true;
  }

  // 2. Drop suggested_actions items missing trimmed label or prompt
  const originalActionsCount = envelope.suggested_actions.length;
  envelope.suggested_actions = envelope.suggested_actions.filter((a, idx) => {
    const labelOk = !!a.label?.trim();
    const promptOk = !!a.prompt?.trim();
    if (!labelOk || !promptOk) {
      addViolation({
        code: 'invalid_action_missing_message',
        detail: `action dropped: label="${a.label ?? ''}" prompt="${a.prompt ?? ''}"`,
        field_path: `suggested_actions[${idx}].${!labelOk ? 'label' : 'prompt'}`,
      });
      return false;
    }
    return true;
  });
  if (envelope.suggested_actions.length !== originalActionsCount) modified = true;

  // 3. Drop blocks with unknown block_type
  const originalBlockCount = envelope.blocks.length;
  envelope.blocks = envelope.blocks.filter((b, idx) => {
    if (!VALID_BLOCK_TYPES.has(b.block_type)) {
      addViolation({
        code: 'invalid_block_type',
        detail: `block dropped: block_type="${b.block_type}" block_id="${b.block_id}"`,
        field_path: `blocks[${idx}].block_type`,
      });
      return false;
    }
    return true;
  });
  if (envelope.blocks.length !== originalBlockCount) modified = true;

  // 4. Inject fallback if nothing renderable remains.
  // Skip when: error is set, OR turn_plan.system_event is present (ack envelopes are intentionally silent).
  const hasRenderableText = envelope.assistant_text?.trim();
  const isSystemEventAckV2 = !!envelope.turn_plan?.system_event;
  if (!hasRenderableText && envelope.blocks.length === 0 && !envelope.error && !isSystemEventAckV2) {
    const resolvedStage = stage ?? envelope.stage_indicator?.stage ?? 'frame';
    envelope.assistant_text = getStageAwareFallback(resolvedStage);
    addViolation({
      code: 'empty_response_fallback',
      detail: `assistant_text was blank/null with no blocks — injected fallback for stage="${resolvedStage}"`,
      field_path: 'assistant_text',
    });
    modified = true;
  }

  // 5. Summary warn log when violations found
  if (violations.length > 0) {
    log.warn(
      { turn_id: envelope.turn_id, request_id: request_id ?? null, violations_count: violations.length, violations },
      'orchestrator response contract violations detected',
    );
  }

  return { violations, envelope_modified: modified };
}

// ============================================================================
// V1 validator
// ============================================================================

/**
 * Validate and repair a V1 response envelope.
 *
 * Same logic as V2 but adapted to the V1 type shape:
 * - suggested_actions is optional (may be undefined)
 * - stage_indicator is DecisionStage | undefined (not an object)
 *
 * @param envelope   The assembled V1 envelope to validate.
 * @param stage      Authoritative stage from computedStage (bypasses envelope lookup).
 * @param request_id Optional HTTP request correlation ID for telemetry.
 */
export function validateV1EnvelopeContract(
  envelope: OrchestratorResponseEnvelope,
  stage?: string,
  request_id?: string,
): ContractValidationResult {
  const violations: ContractViolation[] = [];
  let modified = false;

  const addViolation = (v: ContractViolation) => {
    violations.push(v);
    emitViolation(v, envelope.turn_id, request_id);
  };

  // 1. Drop suggested_actions items missing trimmed label or prompt
  if (envelope.suggested_actions && envelope.suggested_actions.length > 0) {
    const originalCount = envelope.suggested_actions.length;
    envelope.suggested_actions = envelope.suggested_actions.filter((a, idx) => {
      const labelOk = !!a.label?.trim();
      const promptOk = !!a.prompt?.trim();
      if (!labelOk || !promptOk) {
        addViolation({
          code: 'invalid_action_missing_message',
          detail: `action dropped: label="${a.label ?? ''}" prompt="${a.prompt ?? ''}"`,
          field_path: `suggested_actions[${idx}].${!labelOk ? 'label' : 'prompt'}`,
        });
        return false;
      }
      return true;
    });
    if (envelope.suggested_actions.length !== originalCount) modified = true;
  }

  // 2. Drop blocks with unknown block_type
  const originalBlockCount = envelope.blocks.length;
  envelope.blocks = envelope.blocks.filter((b, idx) => {
    if (!VALID_BLOCK_TYPES.has(b.block_type)) {
      addViolation({
        code: 'invalid_block_type',
        detail: `block dropped: block_type="${b.block_type}" block_id="${b.block_id}"`,
        field_path: `blocks[${idx}].block_type`,
      });
      return false;
    }
    return true;
  });
  if (envelope.blocks.length !== originalBlockCount) modified = true;

  // 3. Inject fallback if nothing renderable remains.
  // Skip when: error is set, OR turn_plan.system_event is present (ack envelopes are intentionally silent).
  const hasRenderableText = envelope.assistant_text?.trim();
  const isSystemEventAck = !!envelope.turn_plan?.system_event;
  if (!hasRenderableText && envelope.blocks.length === 0 && !envelope.error && !isSystemEventAck) {
    const resolvedStage = stage ?? (typeof envelope.stage_indicator === 'string' ? envelope.stage_indicator : 'frame');
    envelope.assistant_text = getStageAwareFallback(resolvedStage);
    addViolation({
      code: 'empty_response_fallback',
      detail: `assistant_text was blank/null with no blocks — injected fallback for stage="${resolvedStage}"`,
      field_path: 'assistant_text',
    });
    modified = true;
  }

  // 4. Summary warn log when violations found
  if (violations.length > 0) {
    log.warn(
      { turn_id: envelope.turn_id, request_id: request_id ?? null, violations_count: violations.length, violations },
      'orchestrator response contract violations detected (V1)',
    );
  }

  return { violations, envelope_modified: modified };
}
