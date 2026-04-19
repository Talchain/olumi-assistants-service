/**
 * V5 compose layer — shared types for per-code failure composers.
 *
 * `SuggestedAction` is re-exported from the boundary `Action` type with no
 * shape change: `{ id, label, message, action_type? }`. Per review
 * correction, chips do not need a new discriminated union — `action_type`
 * presence distinguishes handler-invoking chips from text-prompt chips.
 *
 * `ComposeContext` carries the minimum data a failure composer needs from
 * TurnExecutor: optional graph access (frame-stage turns run without it)
 * and the handler validation registry for curated next-action chips.
 */

import type { Action } from '@talchain/schemas/boundary';

import type { GraphLookup, HandlerValidationRegistry } from '../routing/validator.js';

export type SuggestedAction = Action;

/**
 * Compose-layer chip classification for the `failure_response` telemetry
 * `chip_type` field. Distinct from boundary `Action.action_type` (which
 * names a handler) — this tag describes chip *intent*:
 *   - `action`            fires a specific handler (Action.action_type set)
 *   - `text_prompt`       sends a free-text prompt back for Sonnet routing
 *   - `entity_suggestion` user picks one of N graph entities
 */
export type ChipType = 'action' | 'text_prompt' | 'entity_suggestion';

export interface ComposeContext {
  readonly graph?: GraphLookup;
  readonly handlerRegistry: HandlerValidationRegistry;
}

export interface FailureComposeResult {
  readonly assistant_text: string;
  readonly suggested_actions: readonly SuggestedAction[];
}
