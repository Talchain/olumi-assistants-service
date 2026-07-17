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
import { SCAFFOLD_DISCLOSURE_RE_SRC } from '../coaching/scaffold-disclosure.js';
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
import { isAllowedRunAnalysisAssistantText } from '../coaching/analysis-result-headline.js';

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

// V5 deterministic analysis-result headline: forward the handler's
// `outcome.assistant_text` ONLY when {@link
// isAllowedRunAnalysisAssistantText} accepts it. The predicate is the
// single source of truth — it exact-matches one of the locked
// `RUN_ANALYSIS_ASSISTANT_TEMPLATES` strings, OR validates a
// deterministic headline shape end-to-end (length cap, no newlines,
// no raw decimals, no forbidden vocabulary, no internal-ID prefixes,
// "currently leads" anchor present, terminating period). Anything
// else — including improvised prose that happens to contain
// "currently leads" mid-sentence — falls back to the locked DEFAULT
// literal so a misbehaving handler or test mock cannot reach the
// wire. The previous loose prefix-or-regex check was promoted to this
// stricter allowlist after the PR #210 review flagged the substring
// match as too permissive.
const RUN_ANALYSIS_FALLBACK_TEXT = 'Ran analysis on your current scenario.';
// Compiled once; source is the disclosure's own published grammar.
const SCAFFOLD_DISCLOSURE_EXTRACT_RE = new RegExp(SCAFFOLD_DISCLOSURE_RE_SRC);
const runAnalysisConfirmationTemplate = (outcome: unknown): string => {
  if (
    outcome === null ||
    typeof outcome !== 'object' ||
    !('assistant_text' in outcome)
  ) {
    return RUN_ANALYSIS_FALLBACK_TEXT;
  }
  const candidate = (outcome as { assistant_text: unknown }).assistant_text;
  if (isAllowedRunAnalysisAssistantText(candidate)) {
    return candidate as string;
  }
  // Review fix B6 (honesty floor): if the rejected composed summary carried a
  // scaffold disclosure, the fallback must KEEP it — a scaffolded run may
  // never render undisclosed (D-ask-1). The grammar match is STRUCTURE-only
  // (its label slots accept digits/vocab), and this forwarder is the second
  // line of defence precisely against upstream regressions — so the COMBINED
  // output is re-checked against the allowlist before shipping (review-of-
  // review P1: an unchecked append could smuggle the very content the
  // allowlist rejected through the backstop itself). Genuine builder
  // disclosures pass; a poisoned disclosure-shaped slice falls back bare.
  if (typeof candidate === 'string') {
    const disclosure = candidate.match(SCAFFOLD_DISCLOSURE_EXTRACT_RE);
    if (disclosure) {
      const combined = RUN_ANALYSIS_FALLBACK_TEXT + disclosure[0];
      if (isAllowedRunAnalysisAssistantText(combined)) return combined;
    }
  }
  return RUN_ANALYSIS_FALLBACK_TEXT;
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
    confirmation_template: runAnalysisConfirmationTemplate,
  },
  // 0.9.0 — V5 no-op routing handlers. None has a graph-level precondition;
  // explain_results and what_would_flip do their own analysis-fact-presence
  // check inside the handler body so the user-facing failure path can return
  // a templated response with a "Run analysis" chip instead of a typed
  // PRECONDITION_UNMET rejection.
  //
  // accepted_entity_kinds for the two EXPLANATION handlers
  // (explain_from_structure, explain_results) is ['goal', 'option', 'node'].
  // The wire entity-kind enum collapses decision, factor, outcome, risk, and
  // action nodes into the single 'node' literal (see `toEntityKind` in
  // graph-lookup-adapter.ts). 'node' is accepted here because BOTH handlers
  // are scenario-wide explainers that IGNORE the proposal entity entirely —
  // they compose their answer from the structure/analysis projection (or
  // Sonnet's validated answer_text), never from the targeted node. A
  // factor / decision / outcome / risk / action target is therefore a
  // legitimate thing to ask them to explain; rejecting it produced the V5
  // routeability
  // dead-end (factor-centric question → ENTITY_KIND_MISMATCH → the generic
  // "I wasn't sure what you meant" response — the Live AI Experience audit's
  // P0). See the V5 Chip Routeability Contract lane.
  //
  // Accepting 'node' does NOT weaken validator authority:
  //   - Point B (validator.ts graph-resolved kind cross-check) still rejects
  //     a 'node' proposed against a real option/goal id (resolved kind
  //     'option'/'goal' !== 'node' → ENTITY_KIND_MISMATCH);
  //   - a 'node' id absent from the graph still fails ENTITY_NOT_FOUND;
  //   - an unresolved target still fails ENTITY_RESOLUTION_AMBIGUOUS.
  // The graph-dependent checks run on the normal production path (graph
  // context present). On a graph-absent turn (frame stage) the widened
  // structural gate alone admits the node proposal — acceptable ONLY because
  // these two handlers ignore the entity; it is not a general bypass.
  //
  // 'edge' is intentionally NOT accepted: the validator skips the existence +
  // kind cross-check for edges (they have no stable id — validator.ts), so a
  // no-op handler accepting 'edge' would have ZERO existence validation.
  // Edge/link explanation is a separate follow-up that needs an
  // edge-existence-check design first. 'constraint' stays rejected too.
  // what_would_flip keeps ['goal', 'option'] — out of scope for this lane.
  explain_from_structure: {
    handler_id: 'explain_from_structure',
    accepted_entity_kinds: ['goal', 'option', 'node'],
    confirmation_template: noopHandlerConfirmationTemplate,
  },
  explain_results: {
    handler_id: 'explain_results',
    accepted_entity_kinds: ['goal', 'option', 'node'],
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
