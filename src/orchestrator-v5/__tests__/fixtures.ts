/**
 * Shared test fixtures for `OrchestratorTurnPayload` shapes.
 *
 * Centralises the boundary discriminated-union shape so individual tests do
 * not re-declare the full field set. Drift in `@talchain/schemas` (notably
 * the v0.7.0 introduction of required `source` and `kind` discriminants on
 * the message branch) updates here once instead of across ~20 files.
 *
 * Two factories — one per discriminant — return strongly-typed payloads
 * that callers can spread `...` and override per-test.
 *
 * Naming convention (single colocated `fixtures.ts`) matches the existing
 * `src/orchestrator-v5/session/__tests__/fixtures.ts` and
 * `src/orchestrator-v5/tools/handlers/d1-shared/__tests__/fixtures.ts`.
 */

import type {
  MessageTurnPayload,
  SystemEvent,
  SystemEventTurnPayload,
} from '@talchain/schemas/boundary';

// `OrchestratorTurnPayloadSchema` validates `turn_id` and `scenario_id`
// as UUIDs at runtime (see `@talchain/schemas/boundary` →
// `MessageTurnPayloadSchema` / `SystemEventTurnPayloadSchema`). The Zod
// type-level signature is `z.ZodString`, which masks the `.uuid()`
// refinement — historical fixtures used opaque ids ('t-001', 'scen-abc')
// that pass typecheck but fail `safeParse`. UUID-shaped defaults make
// the factories runtime-valid by construction.
const DEFAULT_TURN_ID = '00000000-0000-4000-8000-000000000001';
const DEFAULT_SCENARIO_ID = '00000000-0000-4000-8000-0000000000a1';

/**
 * Build a fully-populated `MessageTurnPayload` with sensible defaults.
 * Callers override any field via `overrides`. Returned object is mutable
 * so tests can spread `...` it.
 */
export function makeMessagePayload(
  overrides: Partial<MessageTurnPayload> = {},
): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_class: 'frame',
    stage: 'frame',
    turn_id: DEFAULT_TURN_ID,
    scenario_id: DEFAULT_SCENARIO_ID,
    message: 'What should I do?',
    ...overrides,
  };
}

/**
 * Build a fully-populated `SystemEventTurnPayload` with sensible defaults.
 * Defaults to a `chip_click` event; pass a different `event` via overrides
 * to exercise other system-event kinds.
 */
export function makeSystemEventPayload(
  overrides: Partial<SystemEventTurnPayload> = {},
): SystemEventTurnPayload {
  const defaultEvent: SystemEvent = {
    kind: 'chip_click',
    chip_id: 'chip-001',
  };
  return {
    kind: 'system_event',
    stage: 'frame',
    turn_id: DEFAULT_TURN_ID,
    scenario_id: DEFAULT_SCENARIO_ID,
    event: defaultEvent,
    ...overrides,
  };
}
