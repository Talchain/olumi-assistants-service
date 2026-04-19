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
 */

import type { HandlerValidationRegistry, PreconditionCheck } from './validator.js';

/**
 * run_analysis precondition (Phase 1.5 review — P0-1 wire reality fix).
 *
 * IMPORTANT: the UI sends `graph_state: { nodes, edges }` on the wire — no
 * top-level `options[]` array, and therefore no option-level `status` or
 * `interventions` fields visible to this precondition. Canonical option +
 * intervention configuration lives in the scenario store, which is async
 * I/O (`scenarioReader`) that only the handler has access to at execution
 * time. A previous version of this check relied on options on the wire and
 * would have failed every production run_analysis turn with a spurious
 * PRECONDITION_UNMET.
 *
 * The cheap, correct, wire-checkable invariant is: "at least one option
 * node exists in the graph". If none, the user hasn't even started
 * defining options, so nothing downstream will succeed. Anything stronger
 * (status === 'ready' + non-empty interventions) is the handler's
 * responsibility — it loads scenario data and reports a typed
 * HANDLER_INVOCATION_FAILED with the right cause_kind when options exist
 * but aren't configured.
 */
const runAnalysisPrecondition: PreconditionCheck = ({ graph }) => {
  const optionNodes = graph.listEntitiesByKind('option');
  if (optionNodes.length === 0) {
    return { ok: false, reason: 'no_options_defined' };
  }
  return { ok: true };
};

export const HANDLER_VALIDATION_REGISTRY: HandlerValidationRegistry = {
  run_analysis: {
    handler_id: 'run_analysis',
    // The target of run_analysis is the scenario as a whole. Sonnet surfaces
    // the winning "option" (or any option) as the entity in the proposal so
    // cited_context_fields can point to graph.options. We accept either an
    // option or a goal kind — the handler is intrinsic to the scenario so
    // either is a valid addressable target.
    accepted_entity_kinds: ['option', 'goal'],
    preconditions: runAnalysisPrecondition,
    confirmation_template: 'Ran analysis on your current scenario.',
  },
};
