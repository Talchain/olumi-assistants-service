/**
 * `factor_value_edit` — the inspector value edit, routed into the EXISTING
 * `set_factor_value` machinery.
 *
 * THE DEFECT THIS CLOSES (measured 2026-07-28, UI `92f5406f` / CEE `cb54320e`).
 * Two inspector value edits on two factors produced ZERO network requests and
 * CEE's `graph_hash` did not move on either (`c9eacbc8538cc254` unchanged),
 * while a chat edit on the SAME factor moved it (`677ca064fa393a81`) and moved
 * every downstream number. The user was told "Model changed since this analysis.
 * Re-run to update.", reran, and saw byte-identical results under a green
 * "Analysis reflects the current model." strip.
 *
 * ⚠ THE WHOLE POINT OF THIS FILE IS THAT IT CONTAINS NO MUTATION LOGIC.
 * It is an ADAPTER: wire event → validated proposal → the same validator, the
 * same handler, the same commit path the natural-language lane has used since
 * D1. If you find yourself writing a `node.observed_state = …` here, stop — the
 * bug is that you are not reusing `set_factor_value`. The reuse is what makes
 * the two lanes agree by construction rather than by two people remembering to
 * keep them in step (a hand-maintained mirror is this estate's dominant defect).
 *
 * SCALE. `value` is the MODEL scale, `raw_value` the USER-UNIT magnitude, per
 * `d1-shared/normalise-factor-value.ts`. The client's `value` is NEVER persisted
 * verbatim: the handler re-derives it from the user-unit input and the factor's
 * OWN stored cap. That is deliberate — the same probe found the live UI writing
 * a display magnitude (300000) straight into the 0–1 model field, and a server
 * that trusted it would have persisted a poisoned graph.
 */

import type {
  OlumiResponse,
  SystemEventTurnPayload,
} from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { log } from '../../utils/telemetry.js';
import { composeToolCallResponse } from '../compose.js';
import { composeRecoverableHandlerResponse } from '../compose/recoverable-handler-response.js';
import { composeRecoverableValidationResponse } from '../compose/recoverable-validation-response.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { buildGraphLookup } from '../routing/graph-lookup-adapter.js';
import type { GraphLookup } from '../routing/validator.js';
import type { ProposalAction } from '../routing/types.js';
import { validateToolCall, type ValidationError } from '../routing/validator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../routing/validation-registry.js';
import { HandlerInvocationFailedError } from '../tools/handler-errors.js';
import { getDefaultRegistry, resolveHandler, type HandlerInvocation } from '../tools/registry.js';
import { mergeMutatedGraphForPersistence } from '../tools/handlers/d1-shared/apply-graph-mutation.js';
import { buildRescaleCapPendingActions } from '../session/rescale-cap-pending.js';
import type { PendingAction } from '../session/pending-action.js';

/**
 * The ONLY `observed_state` field this event may edit today. `field` is optional
 * on the wire and absence means `'value'`; anything else is REFUSED rather than
 * coerced, so a future `'baseline'` edit cannot be silently applied as a value
 * edit. (The absence-semantics census records this as verdict `same` on exactly
 * that reasoning — the equivalence is only safe BECAUSE the other values are
 * refused here.)
 */
const EDITABLE_OBSERVED_FIELD = 'value';

/**
 * `buildGraphLookup` returns a DISCRIMINATED result so a caller can tell "no
 * graph on the turn" (a legitimate skip) from "a graph was present but nothing
 * mapped" (payload drift). Every call here runs on an already-parsed, non-empty
 * `GraphV3T`, so `ok` is the only reachable case — but it is unwrapped rather
 * than asserted, and a non-`ok` result degrades to `undefined`, which the
 * validator treats as "skip the graph-dependent checks" exactly as it does for
 * the older adapters that never implemented them.
 */
function lookupOrUndefined(graph: GraphV3T): GraphLookup | undefined {
  const built = buildGraphLookup(graph);
  return built.kind === 'ok' ? built.lookup : undefined;
}

/**
 * Relative tolerance for the `value` ↔ `raw_value / cap` cross-check. Floating
 * division is not exact (30000/100000 is fine; 1/3 is not), so an exact compare
 * would reject honest clients. Scaled by magnitude rather than absolute so it
 * behaves the same at 0.3 and at 3e6.
 */
const SCALE_CONSISTENCY_TOLERANCE = 1e-6;

export type FactorValueEditResult =
  | {
      /** The graph changed. Caller MUST commit `mutatedGraph` + `handlerFacts`. */
      readonly kind: 'mutated';
      readonly response: OlumiResponse;
      readonly mutatedGraph: unknown;
      readonly handlerFacts: readonly HandlerFact[];
      /** The post-mutation graph, parsed — for readiness + the egress sanitiser. */
      readonly graph: GraphV3T;
      /** The PRE-mutation persisted graph, for the commit's CAS expected base. */
      readonly baseGraph: unknown;
    }
  | {
      /**
       * The edit was REFUSED, honestly, with user-facing copy explaining why.
       * No graph is written, no hash moves, and the turn is still committed so
       * the transcript records the refusal. Never a 500 and never a silent clamp.
       */
      readonly kind: 'refused';
      readonly response: OlumiResponse;
      readonly reason: string;
      /**
       * Pending actions the REFUSAL itself must persist.
       *
       * ⚠ A CHIP WITHOUT ITS PENDING IS A DEAD CONTROL, and that is not a
       * cosmetic gap. The above-cap refusal ships a consented "extend the scale"
       * chip whose replay message deliberately carries NO digits and NO edit verb
       * — the structured `{value, unit, cap}` cannot ride a chip (the boundary
       * `Action` is strict `{id,label,message,action_type?}`), so it rides the
       * pending-action channel instead. Persist the chip without the pending and
       * the click finds nothing to resume, the resumer fails closed on the
       * missing hash, and the message falls through to the LLM WITHOUT the cap —
       * so the user clicks "extend the scale" and gets the same refusal again,
       * forever. Empty on every other refusal.
       */
      readonly pendingActions: readonly PendingAction[];
    };

export interface ApplyFactorValueEditParams {
  readonly payload: SystemEventTurnPayload;
  readonly event: Extract<SystemEventTurnPayload['event'], { kind: 'factor_value_edit' }>;
  readonly requestId: string;
  /** The scenario's persisted graph, already loaded by the caller. */
  readonly persistedGraph: unknown;
  /** Prior handler facts for this scenario — drives the staleness narrative. */
  readonly priorFacts: readonly HandlerFact[];
}

function refuse(
  payload: SystemEventTurnPayload,
  reason: string,
  assistantText: string,
): FactorValueEditResult {
  return {
    kind: 'refused',
    reason,
    pendingActions: [],
    response: {
      response_version: 2,
      assistant_text: assistantText,
      blocks: [],
      suggested_actions: [],
      insights: [],
      stage_indicator: payload.stage,
    },
  };
}

function refuseFromValidationError(
  payload: SystemEventTurnPayload,
  error: ValidationError,
  lookup: GraphLookup | undefined,
  persistedGraph: unknown,
): FactorValueEditResult {
  // The SAME per-code composer the NL lane uses. This is what carries the
  // cap-rejection copy and the consented "extend the scale" chip — we do not
  // re-word it here, because two copies of the same refusal drift.
  const composed = composeRecoverableValidationResponse(
    error,
    { ...(lookup !== undefined ? { graph: lookup } : {}), handlerRegistry: HANDLER_VALIDATION_REGISTRY },
    payload.stage,
  );

  // The consented "extend the scale" chip needs its backing pending, or it is a
  // dead control (see `pendingActions` above). Same builder, same fail-closed
  // rules, as the NL lane's identical recovery at turn-executor.ts:7022 — the
  // only other production caller. It returns [] unless the chip is genuinely on
  // this response AND the validator threaded the complete detail set AND a live
  // graph hash exists, so a non-cap refusal costs nothing.
  //
  // The hash is the PRE-mutation PERSISTED graph's — computed on the raw stored
  // bytes, NOT on our Zod-parsed copy. `PendingAction.preconditions.graph_hash`
  // is contractually "the persisted graph's analysis-affecting hash", and the
  // resumer re-derives it from the store on the next turn. Hashing the parsed
  // copy instead produces a value that never matches, so the pending would be
  // invalidated the moment it was read — a pending that can never resume, which
  // is the dead control this whole amendment removes, one layer down.
  // (Caught by the test asserting the exact precondition hash.)
  const pendingActions = buildRescaleCapPendingActions({
    error,
    response: composed.response,
    scenarioId: payload.scenario_id,
    currentGraphHash: computeAnalysisAffectingGraphHash(
      persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
    ),
  });

  return {
    kind: 'refused',
    reason: error.code,
    response: composed.response,
    pendingActions,
  };
}

/**
 * Resolve the USER-UNIT number to hand the handler.
 *
 * `raw_value` is preferred when present because it is what the user actually
 * typed, and it is exactly the input `normaliseFactorValue` consumes. When it is
 * absent we invert the model scale with the factor's OWN cap — the same
 * inversion `resolveExistingRawValue` performs, never a fabricated 0.
 */
function resolveUserUnitInput(args: {
  readonly value: number;
  readonly rawValue: number | undefined;
  readonly cap: number | undefined;
}): { readonly ok: true; readonly rawInput: number } | { readonly ok: false; readonly issue: string } {
  const { value, rawValue, cap } = args;

  if (rawValue !== undefined) {
    // BOTH present ⇒ cross-check them. An inconsistent pair is the live UI
    // defect's exact signature (value=300000 alongside raw_value=30000 on a
    // cap=30000 factor). Picking one silently would persist a number the user
    // never asked for; picking the wrong one would persist a 10x error. So:
    // fail LOUD. This is the boundary check that would have caught the defect.
    const expected = cap !== undefined ? rawValue / cap : rawValue;
    const scale = Math.max(1, Math.abs(expected));
    if (Math.abs(value - expected) > SCALE_CONSISTENCY_TOLERANCE * scale) {
      return {
        ok: false,
        issue:
          `The edit is internally inconsistent: value ${value} does not match ` +
          `raw_value ${rawValue}${cap !== undefined ? ` over cap ${cap}` : ''} ` +
          `(expected ${expected}). Refusing rather than guessing which one you meant.`,
      };
    }
    return { ok: true, rawInput: rawValue };
  }

  // Model-scale only. Invert with the stored cap; an uncapped factor stores
  // raw and model identically (normalise-factor-value.ts:14-18).
  return { ok: true, rawInput: cap !== undefined ? value * cap : value };
}

export async function applyFactorValueEdit(
  params: ApplyFactorValueEditParams,
): Promise<FactorValueEditResult> {
  const { payload, event, requestId, persistedGraph, priorFacts } = params;

  // ── the field gate ───────────────────────────────────────────────────────
  if (event.field !== undefined && event.field !== EDITABLE_OBSERVED_FIELD) {
    return refuse(
      payload,
      'unsupported_field',
      `I can only change a factor's value from the inspector, not its ` +
        `"${event.field}". I haven't changed anything.`,
    );
  }

  // ── the graph ────────────────────────────────────────────────────────────
  // No model yet ⇒ nothing to edit. This is not an error: it is the honest
  // answer, and it must not write an empty graph over the scenario.
  const graphParse = GraphV3.safeParse(persistedGraph);
  if (!persistedGraph || !graphParse.success || graphParse.data.nodes.length === 0) {
    log.info(
      {
        event: 'v5.system_event.factor_value_edit.no_persisted_graph',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        parse_ok: graphParse.success,
      },
      'factor_value_edit — no usable persisted model; refusing without a write',
    );
    return refuse(
      payload,
      'no_persisted_graph',
      `There's no model saved for this decision yet, so there's nothing to ` +
        `change. I haven't changed anything.`,
    );
  }
  const graph = graphParse.data;

  // ── the target, ID-ADDRESSED ─────────────────────────────────────────────
  // Never a label match. A label match silently retargets on a duplicate or a
  // renamed label, and the wire gives us an id precisely so it cannot.
  const targetNode = graph.nodes.find((n) => n.id === event.target_id);
  if (!targetNode) {
    return refuse(
      payload,
      'target_not_found',
      `I couldn't find that factor in the current model, so I haven't changed ` +
        `anything. It may have been removed or renamed — try reloading.`,
    );
  }

  const observed = targetNode.observed_state as
    | { value?: number; raw_value?: number; unit?: number | string; cap?: number }
    | undefined;
  const factorCap = typeof observed?.cap === 'number' ? observed.cap : undefined;
  const factorUnit = typeof observed?.unit === 'string' ? observed.unit : undefined;

  // ── the scale ────────────────────────────────────────────────────────────
  const resolved = resolveUserUnitInput({
    value: event.value,
    rawValue: event.raw_value,
    cap: factorCap,
  });
  if (!resolved.ok) {
    log.warn(
      {
        event: 'v5.system_event.factor_value_edit.scale_inconsistent',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        target_id: event.target_id,
      },
      'factor_value_edit — value/raw_value disagree; refusing rather than guessing',
    );
    return refuse(
      payload,
      'scale_inconsistent',
      `I couldn't apply that change because the value didn't add up, so I ` +
        `haven't changed anything. Try entering it again.`,
    );
  }

  // The proposal's unit: the client's if stated, else the factor's own. This
  // drives `inputHasUnit`, which decides WHICH cap guard fires
  // (`value_exceeds_cap` vs the stricter `bare_number_outside_cap`).
  const proposalUnit = event.unit ?? factorUnit;

  // ── the proposal ─────────────────────────────────────────────────────────
  // Shape mirrors `buildTypedChipMutationProposal` — the estate's other
  // id-addressed, structured-client mutation path.
  const proposal: ProposalAction = {
    handler_id: 'set_factor_value',
    entity: {
      id: event.target_id,
      kind: 'node',
      ...(targetNode.label != null ? { label: targetNode.label } : {}),
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [
      {
        name: 'value',
        value:
          proposalUnit !== undefined
            ? { value: resolved.rawInput, unit: proposalUnit }
            : resolved.rawInput,
        // An inspector edit is an absolute set. Deltas stay in the NL lane;
        // the wire event carries no operator, so this cannot become one.
        operator: 'set',
        source: 'user_explicit',
        ...(proposalUnit !== undefined ? { unit: proposalUnit } : {}),
      },
    ],
    cited_context_fields: ['graph.nodes'],
  };

  // ── the EXISTING validator ───────────────────────────────────────────────
  // Unchanged, and it is what produces the cap-rejection outcome (including the
  // `suggested_cap` the consented "extend the scale" chip is built from).
  const lookup = lookupOrUndefined(graph);
  const validation = validateToolCall(proposal, lookup, HANDLER_VALIDATION_REGISTRY);
  if (!validation.valid) {
    log.info(
      {
        event: 'v5.system_event.factor_value_edit.validation_refused',
        request_id: requestId,
        scenario_id: payload.scenario_id,
        target_id: event.target_id,
        code: validation.error.code,
        rejection_reason: validation.error.details?.rejection_reason ?? null,
      },
      'factor_value_edit — validator refused; no graph written',
    );
    return refuseFromValidationError(payload, validation.error, lookup, persistedGraph);
  }

  // ── the EXISTING handler ─────────────────────────────────────────────────
  const handlerFn = resolveHandler(getDefaultRegistry(), 'set_factor_value');
  if (!handlerFn) {
    return refuse(
      payload,
      'handler_not_registered',
      `I can't change factor values right now. I haven't changed anything.`,
    );
  }

  // The handler reads exactly four things off the invocation: `proposal`,
  // `graphForTurn`, `context.prior_facts` (staleness narrative) and
  // `context.persistedGraph` (fallback graph). `HandlerInvocation.payload` is
  // typed `MessageTurnPayload` because handlers historically only ran on
  // message turns; a system event has no `message`. Rather than widen that type
  // across every handler, the shape is narrowed here at a single documented
  // boundary — the same pattern the D1 test fixtures use.
  const invocation: HandlerInvocation = {
    context: {
      session_id: payload.scenario_id,
      stage: payload.stage,
      request_id: requestId,
      prior_turns: [],
      prior_facts: priorFacts,
      scenarioBriefText: null,
      persistedGraph,
      // BOUNDED, and the bound is checkable. `set_factor_value` reads exactly two
      // fields off the context — `prior_facts` (staleness narrative) and
      // `persistedGraph` (fallback graph) — and both are populated honestly above.
      // `EnrichedTurnContext` is produced only by `buildTurnContext`, which is typed
      // `MessageTurnPayload`; a system event has no `message`, so the alternatives
      // are this cast or FABRICATING user text to feed the builder. The structural
      // fix is widening `HandlerInvocation.payload` to the payload union (only two
      // handlers read it: add-constraint.ts:346 `.message`, run-analysis.ts:253
      // `.scenario_id`) — a change to every handler's contract, so it rides its own
      // train rather than this one.
      // forbidden-exempt: bounded shim — the handler reads only prior_facts + persistedGraph, both populated honestly; widening HandlerInvocation.payload to the payload union is the structural fix and rides its own train
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      stage: payload.stage,
      message: '',
      // Same bound as the context cast above. `set_factor_value` never reads
      // `invocation.payload` at all (verified: the only handler readers are
      // add-constraint.ts:346 and run-analysis.ts:253, neither of them this one), so
      // this shape is inert for this call. `message: ''` deliberately does NOT
      // fabricate user prose — the user typed a number into an inspector, not a
      // sentence, and inventing one would put words in their mouth in the transcript.
      // forbidden-exempt: inert shim — set_factor_value never reads invocation.payload; message stays empty rather than fabricating user prose for the transcript
    } as unknown as HandlerInvocation['payload'],
    requestId,
    signal: new AbortController().signal,
    orientationText: '',
    proposal: validation.proposal,
    graphForTurn: graph,
  };

  let outcome;
  try {
    outcome = await handlerFn(invocation);
  } catch (err) {
    // A typed handler refusal is a 200 with honest copy, never a 500. The
    // handler re-runs the shared predicate itself (set-factor-value.ts:310-329),
    // so this is also the backstop if the validator ever stops catching one.
    if (err instanceof HandlerInvocationFailedError) {
      log.info(
        {
          event: 'v5.system_event.factor_value_edit.handler_refused',
          request_id: requestId,
          scenario_id: payload.scenario_id,
          target_id: event.target_id,
          cause_kind: err.cause_kind,
        },
        'factor_value_edit — handler refused; no graph written',
      );
      const composed = composeRecoverableHandlerResponse(
        err,
        {
          ...(lookup !== undefined ? { graph: lookup } : {}),
          handlerRegistry: HANDLER_VALIDATION_REGISTRY,
        },
        payload.stage,
      );
      // The handler's own re-run of the predicate is a BACKSTOP, not the primary
      // cap path — the validator above catches value_exceeds_cap first and is
      // where the rescale pending is built. Reaching here with a cap rejection
      // would mean the validator stopped catching it; no pending is minted,
      // because the composer on this path emits no rescale chip to back.
      return {
        kind: 'refused',
        reason: err.cause_kind,
        response: composed.response,
        pendingActions: [],
      };
    }
    throw err;
  }

  if (outcome.mutated_graph == null) {
    // Defensive: `set_factor_value` always returns one. If that ever changes,
    // refuse rather than commit a turn that claims a change it cannot show.
    return refuse(
      payload,
      'handler_returned_no_graph',
      `I couldn't save that change. I haven't changed anything.`,
    );
  }

  // Re-merge onto the persisted base, exactly as the turn-executor's write
  // chokepoint does. The handler mutates the graph it was handed; this restores
  // any canonical top-level state (goal_node_id, options[]) that a projection
  // could have dropped. Skipping it is how a mutation silently strips the model.
  const mergedGraph = mergeMutatedGraphForPersistence({
    mutatedGraph: outcome.mutated_graph as Record<string, unknown>,
    persistedBase: persistedGraph,
    requestId,
    scenarioId: payload.scenario_id,
  });

  const mergedParse = GraphV3.safeParse(mergedGraph);
  if (!mergedParse.success) {
    return refuse(
      payload,
      'merged_graph_invalid',
      `I couldn't save that change. I haven't changed anything.`,
    );
  }

  // The SAME composer the NL lane uses — this is what maps the
  // `set_factor_value` fact to the boundary `graph_patch` block.
  const response = composeToolCallResponse({
    answerKind: 'functional',
    orientation: '',
    confirmation: outcome.assistant_text,
    coaching: null,
    stage: payload.stage,
    handlerFacts: outcome.handler_facts,
  });

  return {
    kind: 'mutated',
    response,
    mutatedGraph: mergedGraph,
    handlerFacts: outcome.handler_facts,
    graph: mergedParse.data,
    baseGraph: persistedGraph,
  };
}
