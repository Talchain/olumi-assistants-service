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
  /**
   * ⭐ ROADMAP 2.1261 — the RAW user message of the turn being composed for,
   * when the caller has one (the turn-executor's recoverable-validator path
   * threads it; system-event paths have no user prose and omit it).
   *
   * Purpose: honesty gating for refusal copy that would otherwise attribute a
   * PROPOSAL property to the USER. Wire-witnessed (req b90d62e0): the routing
   * model re-proposed a `%` unit from conversation history on the unit-free
   * message "Set it to 0.12.", and the `unit_redeclares_scale` copy told the
   * user they were "applying a value in %". Copy may only describe what the
   * input actually contained — when this field is absent the composer keeps
   * the historical copy unchanged (fail-open to today's bytes; the pinned
   * system-event wire contract in route-v2-factor-value-edit-scale-
   * redeclaration.test.ts carries its unit explicitly and is unaffected).
   */
  readonly userMessage?: string;
}

export interface FailureComposeResult {
  readonly assistant_text: string;
  readonly suggested_actions: readonly SuggestedAction[];
}
