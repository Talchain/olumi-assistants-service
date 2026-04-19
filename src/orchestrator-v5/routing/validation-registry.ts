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

import type { HandlerValidationRegistry, PreconditionCheck } from './validator.js';
import type { GraphLookupWithOptions } from './graph-lookup-adapter.js';

/**
 * run_analysis precondition (Phase 1.5 — plan correction #4).
 *
 * Distinguishes two blockers with different fix paths so the user-facing
 * response can tell the user exactly what to do next:
 *
 *   • `no_options_defined`          → "Define at least one option first."
 *   • `options_lack_intervention_data` → "Configure interventions on your
 *                                         options before running analysis."
 *
 * The naive "options.length > 0" check the brief initially proposed would
 * pass for option nodes that have no intervention mappings yet — a different
 * blocker from "no options at all", and worth reporting distinctly.
 *
 * The validator's `GraphLookup` interface is intentionally minimal
 * (findEntityById + listEntitiesByKind). Preconditions that need richer
 * data narrow to `GraphLookupWithOptions` — the adapter's extended return
 * shape. Validator code is unchanged (plan correction #5).
 */
const runAnalysisPrecondition: PreconditionCheck = ({ graph }) => {
  const extended = graph as Partial<GraphLookupWithOptions>;
  const options = extended.options ?? [];
  const optionNodes = graph.listEntitiesByKind('option');

  if (options.length === 0 && optionNodes.length === 0) {
    return { ok: false, reason: 'no_options_defined' };
  }

  // P1-3: an option is only analysis-ready when both its status is 'ready'
  // AND at least one intervention is configured — matches the canonical
  // isOptionReady() helper in src/schemas/cee-v3.ts. An option with
  // status='needs_user_mapping' + one intervention passes the looser
  // "has interventions" check but isn't actually runnable.
  const hasReadyOption = options.some((o) => {
    const raw = o as { status?: unknown; interventions?: unknown };
    if (raw.status !== 'ready') return false;
    const interventions = raw.interventions;
    return (
      interventions !== undefined &&
      interventions !== null &&
      typeof interventions === 'object' &&
      !Array.isArray(interventions) &&
      Object.keys(interventions as Record<string, unknown>).length > 0
    );
  });
  if (!hasReadyOption) {
    return { ok: false, reason: 'options_lack_intervention_data' };
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
