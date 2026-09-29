/**
 * B5 — narrate-mode LLM I/O validator (V5 slice A1).
 *
 * Shape-only validation over `LLMAdapterRequestSchema` / `LLMAdapterResponseSchema`
 * from `@talchain/schemas/orchestrator`. B5 is an internal sanity check for
 * the data the TurnExecutor hands to and receives from `invokeNarrate`;
 * failures are P0 alerts (indicate a bug in the orchestrator, not a user
 * request problem).
 *
 * Unlike B1, B5 does NOT translate to a wire-level error code — it's a
 * defensive internal gate. Callers either assert + continue, or throw.
 */

import {
  LLMAdapterRequestSchema,
  LLMAdapterResponseSchema,
  type LLMAdapterRequest,
  type LLMAdapterResponse,
} from '@talchain/schemas/orchestrator';

export function assertNarrateRequest(value: unknown): LLMAdapterRequest {
  const parsed = LLMAdapterRequestSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `B5 narrate request validation failed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}

export function assertNarrateResponse(value: unknown): LLMAdapterResponse {
  const parsed = LLMAdapterResponseSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `B5 narrate response validation failed: ${parsed.error.issues
        .map((i) => `${i.path.join('.')}: ${i.message}`)
        .join('; ')}`,
    );
  }
  return parsed.data;
}
