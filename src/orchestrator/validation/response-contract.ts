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
 *
 * Ordering guarantee:
 *   1. Drop invalid suggested_actions
 *   2. Drop invalid blocks
 *   3. THEN check for empty response (after stripping, so stripping all chips/blocks
 *      still produces renderable assistant_text via fallback)
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
  code: 'invalid_action_missing_message' | 'invalid_block_type' | 'empty_response_fallback';
  detail: string;
}

export interface ContractValidationResult {
  violations: ContractViolation[];
  envelope_modified: boolean;
}

// ============================================================================
// V2 validator
// ============================================================================

/**
 * Validate and repair a V2 response envelope.
 *
 * Mutates the envelope in place. Returns a summary of violations found.
 * Safe to call on every response — no-ops when the envelope is clean.
 */
export function validateV2EnvelopeContract(
  envelope: OrchestratorResponseEnvelopeV2,
  stage?: string,
): ContractValidationResult {
  const violations: ContractViolation[] = [];
  let modified = false;

  // 1. Drop suggested_actions items missing label or prompt
  const originalActionsCount = envelope.suggested_actions.length;
  envelope.suggested_actions = envelope.suggested_actions.filter((a) => {
    if (!a.label || !a.prompt) {
      violations.push({
        code: 'invalid_action_missing_message',
        detail: `action dropped: label="${a.label ?? ''}" prompt="${a.prompt ?? ''}"`,
      });
      return false;
    }
    return true;
  });
  if (envelope.suggested_actions.length !== originalActionsCount) modified = true;

  // 2. Drop blocks with unknown block_type
  const originalBlockCount = envelope.blocks.length;
  envelope.blocks = envelope.blocks.filter((b) => {
    if (!VALID_BLOCK_TYPES.has(b.block_type)) {
      violations.push({
        code: 'invalid_block_type',
        detail: `block dropped: block_type="${b.block_type}" block_id="${b.block_id}"`,
      });
      return false;
    }
    return true;
  });
  if (envelope.blocks.length !== originalBlockCount) modified = true;

  // 3. Inject fallback if nothing renderable remains.
  // Skip when: error is set, OR turn_plan.system_event is present (ack envelopes are intentionally silent).
  const hasRenderableText = envelope.assistant_text?.trim();
  const isSystemEventAckV2 = !!envelope.turn_plan?.system_event;
  if (!hasRenderableText && envelope.blocks.length === 0 && !envelope.error && !isSystemEventAckV2) {
    const resolvedStage = stage ?? envelope.stage_indicator?.stage ?? 'frame';
    envelope.assistant_text = getStageAwareFallback(resolvedStage);
    violations.push({
      code: 'empty_response_fallback',
      detail: `assistant_text was blank/null with no blocks — injected fallback for stage="${resolvedStage}"`,
    });
    modified = true;
  }

  // 4. Emit telemetry when violations found
  if (violations.length > 0) {
    log.warn(
      { turn_id: envelope.turn_id, violations_count: violations.length, violations },
      'orchestrator response contract violations detected',
    );
    emit(TelemetryEvents.OrchestratorContractViolation, {
      turn_id: envelope.turn_id,
      violations_count: violations.length,
      violations,
    });
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
 */
export function validateV1EnvelopeContract(
  envelope: OrchestratorResponseEnvelope,
  stage?: string,
): ContractValidationResult {
  const violations: ContractViolation[] = [];
  let modified = false;

  // 1. Drop suggested_actions items missing label or prompt
  if (envelope.suggested_actions && envelope.suggested_actions.length > 0) {
    const originalCount = envelope.suggested_actions.length;
    envelope.suggested_actions = envelope.suggested_actions.filter((a) => {
      if (!a.label || !a.prompt) {
        violations.push({
          code: 'invalid_action_missing_message',
          detail: `action dropped: label="${a.label ?? ''}" prompt="${a.prompt ?? ''}"`,
        });
        return false;
      }
      return true;
    });
    if (envelope.suggested_actions.length !== originalCount) modified = true;
  }

  // 2. Drop blocks with unknown block_type
  const originalBlockCount = envelope.blocks.length;
  envelope.blocks = envelope.blocks.filter((b) => {
    if (!VALID_BLOCK_TYPES.has(b.block_type)) {
      violations.push({
        code: 'invalid_block_type',
        detail: `block dropped: block_type="${b.block_type}" block_id="${b.block_id}"`,
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
    violations.push({
      code: 'empty_response_fallback',
      detail: `assistant_text was blank/null with no blocks — injected fallback for stage="${resolvedStage}"`,
    });
    modified = true;
  }

  // 4. Emit telemetry when violations found
  if (violations.length > 0) {
    log.warn(
      { turn_id: envelope.turn_id, violations_count: violations.length, violations },
      'orchestrator response contract violations detected (V1)',
    );
    emit(TelemetryEvents.OrchestratorContractViolation, {
      turn_id: envelope.turn_id,
      violations_count: violations.length,
      violations,
    });
  }

  return { violations, envelope_modified: modified };
}
