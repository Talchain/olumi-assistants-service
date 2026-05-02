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
import { SetFactorValueValueSchema } from '../tools/handlers/set-factor-value.js';
import {
  AddConstraintLabelSchema,
  AddConstraintTypeSchema,
  AddConstraintUnitSchema,
  AddConstraintValueSchema,
} from '../tools/handlers/add-constraint.js';
import {
  AdjustEdgeStrengthSchema,
  AdjustEdgeStrengthStdSchema,
} from '../tools/handlers/adjust-edge-strength.js';

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

// 0.9.0 — confirmation template for the V5 no-op handlers
// (explain_from_structure, explain_results, what_would_flip). On the happy
// path the handler returns `assistant_text: ''` and Sonnet's orientation
// alone surfaces. On the empty-orientation guard path the handler returns
// a safe fallback string. On the precondition-fail path of the analysis-
// dependent handlers the handler returns the deterministic template AND
// sets `suppress_orientation: true`. In all three cases the handler-
// authored `assistant_text` is the right thing to show as confirmation —
// the function form forwards it directly, no rewriting.
const noopHandlerConfirmationTemplate = (outcome: unknown): string => {
  if (
    outcome !== null &&
    typeof outcome === 'object' &&
    'assistant_text' in outcome &&
    typeof (outcome as { assistant_text: unknown }).assistant_text === 'string'
  ) {
    return (outcome as { assistant_text: string }).assistant_text;
  }
  return '';
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
  // 0.9.0 — V5 no-op routing handlers. None has a graph-level precondition;
  // explain_results and what_would_flip do their own analysis-fact-presence
  // check inside the handler body so the user-facing failure path can return
  // a templated response with a "Run analysis" chip instead of a typed
  // PRECONDITION_UNMET rejection.
  //
  // accepted_entity_kinds is restricted to ['goal', 'option'] for all
  // three handlers. The wire entity-kind enum includes 'node' as a
  // catch-all that covers decision, factor, outcome, and risk nodes
  // collapsed into one literal. Accepting 'node' on explain_from_structure
  // would let Sonnet target outcome/risk/edge-adjacent nodes that the
  // no-op handler can't sensibly explain. The decision-node misroute
  // pattern (Sonnet picking the decision node for "what factor influences
  // my decision?") is caught instead by the validator's ENTITY_KIND_MISMATCH
  // path, which routes through composeRecoverableValidationResponse to
  // produce a 200 + coaching response asking the user to retarget — the
  // correct degradation for a structurally-ambiguous request that the
  // wire schema cannot disambiguate.
  explain_from_structure: {
    handler_id: 'explain_from_structure',
    accepted_entity_kinds: ['goal', 'option'],
    confirmation_template: noopHandlerConfirmationTemplate,
  },
  explain_results: {
    handler_id: 'explain_results',
    accepted_entity_kinds: ['goal', 'option'],
    confirmation_template: noopHandlerConfirmationTemplate,
  },
  what_would_flip: {
    handler_id: 'what_would_flip',
    accepted_entity_kinds: ['goal', 'option'],
    confirmation_template: noopHandlerConfirmationTemplate,
  },
  // V5 D1 mutation handlers. Each accepts the wire `'node'` entity kind
  // (factor nodes collapse to 'node' on the boundary). The handler body
  // performs the kind === 'factor' / 'edge' / 'goal-or-factor' check
  // against the in-memory graph and surfaces ENTITY_KIND_MISMATCH if it
  // doesn't match. confirmation_template forwards the handler-authored
  // assistant_text — the handler owns the user-visible string.
  set_factor_value: {
    handler_id: 'set_factor_value',
    accepted_entity_kinds: ['node'],
    parameter_schemas: { value: SetFactorValueValueSchema },
    confirmation_template: noopHandlerConfirmationTemplate,
  },
  add_constraint: {
    handler_id: 'add_constraint',
    accepted_entity_kinds: ['node', 'goal'],
    parameter_schemas: {
      constraint_type: AddConstraintTypeSchema,
      value: AddConstraintValueSchema,
      label: AddConstraintLabelSchema,
      unit: AddConstraintUnitSchema,
    },
    confirmation_template: noopHandlerConfirmationTemplate,
  },
  adjust_edge_strength: {
    handler_id: 'adjust_edge_strength',
    accepted_entity_kinds: ['edge'],
    parameter_schemas: {
      strength: AdjustEdgeStrengthSchema,
      std: AdjustEdgeStrengthStdSchema,
    },
    confirmation_template: noopHandlerConfirmationTemplate,
  },
};
