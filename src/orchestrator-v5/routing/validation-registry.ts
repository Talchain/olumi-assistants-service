/**
 * Default V5 handler validation registry.
 *
 * One declaration per registered V5 action type. Each declaration carries:
 *   - accepted_entity_kinds
 *   - parameter_schemas (optional)
 *   - preconditions      (optional)
 *   - confirmation_template (brief correction 5 — typed per handler)
 *
 * Phase 1a ships declarations for run_analysis only (the only registered
 * handler in the current V5 registry). Future handlers register alongside
 * both here and in tools/registry.ts.
 *
 * NOTE ON PHASE 1a GAP: graph state is not yet threaded through the V5
 * boundary payload. When the graph is unavailable, TurnExecutor skips the
 * entity-existence check and only enforces structural checks against the
 * registry. Entity-existence + Dice suspicion checks activate as soon as
 * graph threading lands in a later brief.
 */

import type { HandlerValidationRegistry } from './validator.js';

export const HANDLER_VALIDATION_REGISTRY: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    // The target of run_analysis is the scenario as a whole. Sonnet surfaces
    // the winning "option" (or any option) as the entity in the proposal so
    // cited_context_fields can point to graph.options. We accept either an
    // option or a goal kind — the handler is intrinsic to the scenario so
    // either is a valid addressable target.
    accepted_entity_kinds: ['option', 'goal'],
    confirmation_template: 'Ran analysis on your current scenario.',
  },
};
