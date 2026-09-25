/**
 * `goal_target_edit` (schemas 0.59.0) — the structured success-target edit,
 * routed into the EXISTING `add_constraint` handler.
 *
 * WHAT IT CLOSES. The Canvas success-target control writes today through a
 * MESSAGE turn carrying a typed `add_constraint` chip, which the conventional
 * route runs deterministically (`turn-executor.ts`, typed-chip mutation route,
 * zero LLM). The OpenAI Agent lane forwards system events verbatim to
 * `/orchestrate/v2/turn` but has no route to that write at all. This event is
 * the id-addressed, typed carrier that gives it one.
 *
 * ⚠ THIS FILE CONTAINS NO MUTATION LOGIC, BY DESIGN — the same rule as its
 * sibling `factor-value-edit.ts`. It is an ADAPTER: wire event → the SAME
 * proposal builder the typed chip uses (`buildTypedChipMutationProposal`) →
 * the same validator → the same `add_constraint` handler → the same persisted
 * base re-merge. The handler alone owns the raw value, the unit, the cap and
 * its provenance, `goal_threshold = raw / cap`, the frame and the
 * `goal_constraints` row. If you find yourself writing `goal_threshold` here,
 * stop: the two lanes then agree only for as long as two people remember to
 * keep them in step. Parity with the typed-chip path is pinned field by field
 * in `tests/integration/orchestrator/route-v2-goal-target-edit.test.ts` (b).
 *
 * THE TWO INPUTS A STRUCTURED EVENT CANNOT SUPPLY THE WAY CHAT DOES, and what
 * stands in for each:
 *
 *   1. PROSE. The handler reads `invocation.payload.message` in four places
 *      (reduction backstop, increase-by-delta backstop, stated row frame, goal
 *      baseline mint). A structured edit has no sentence, and inventing one
 *      would put words in the user's mouth in the transcript, so `message` is
 *      `''` — exactly as `factor_value_edit` passes it. On `''` all four
 *      readers abstain (`deriveStatedConstraintFrame` has an explicit empty
 *      guard; the others need a verb or a number to match).
 *
 *   2. THE ROW'S FRAME ATTESTATION. On the chat path the UI's sentence ("…This
 *      is an absolute level, not a change from the current level.") is what
 *      attests `value_frame: 'level'` on the constraint row. Here that
 *      attestation is the CONTRACT's: the 0.59.0 member declares `raw_value` an
 *      ABSOLUTE LEVEL in user units and licenses the server frame `'level'`. So
 *      it is relayed through the handler's existing side-band,
 *      `confirmedConstraintValueFrame`, never written onto the row here. Without
 *      it the row lands unframed — a quiet difference ISL treats as fail-closed
 *      — and parity test (b) REDs on `value_frame`.
 *
 * GATES, in order (the order is the contract's):
 *   · no persisted model → refused; a malformed one → THROWS (corruption is a
 *     retryable 500, never a friendly refusal that hides it);
 *   · analysis-space STALE BASE → a typed conflict (409), before anything is
 *     resolved — `goal_threshold*` and `goal_constraints` are all inside the
 *     analysis hash, so the gate genuinely covers what this writes;
 *   · the id resolves to EXACTLY ONE node, and that node is a GOAL → else
 *     refused (the contract: "server MUST refuse unknown or non-goal node").
 */

import type { OlumiResponse, SystemEventTurnPayload } from '@talchain/schemas/boundary';
import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { log } from '../../utils/telemetry.js';
import { GraphStateIngressSchema } from '../boundary/request-extensions.js';
import { composeToolCallResponse } from '../compose.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { BASE_HASH_DIVERGED } from '../graph-management/reason-codes.js';
import { buildGraphLookup } from '../routing/graph-lookup-adapter.js';
import { buildTypedChipMutationProposal } from '../routing/typed-chip-mutation-proposal.js';
import { validateToolCall } from '../routing/validator.js';
import { HANDLER_VALIDATION_REGISTRY } from '../routing/validation-registry.js';
import { HandlerInvocationFailedError } from '../tools/handler-errors.js';
import { getDefaultRegistry, resolveHandler, type HandlerInvocation } from '../tools/registry.js';
import { mergeMutatedGraphForPersistence } from '../tools/handlers/d1-shared/apply-graph-mutation.js';
import { CEE_GOAL_THRESHOLD_FRAME } from '../../utils/goal-threshold-cap.js';

type GoalTargetEditEvent = Extract<SystemEventTurnPayload['event'], { kind: 'goal_target_edit' }>;

/** Analysis-space stale base. The route maps it to 409 GRAPH_DIVERGED. */
export interface GoalTargetEditBaseHashConflict {
  readonly recovery_action: 'refresh_and_reconfirm';
  readonly conflict_category: typeof BASE_HASH_DIVERGED;
  /** The hash the server actually holds — so the refresh is a bounded action. */
  readonly expected_base_graph_hash: string | null;
}

export type GoalTargetEditResult =
  | {
      /** The handler ran. Caller MUST commit `mutatedGraph` + `handlerFacts`. */
      readonly kind: 'mutated';
      readonly response: OlumiResponse;
      readonly mutatedGraph: Record<string, unknown>;
      readonly handlerFacts: readonly HandlerFact[];
      /** The merged post-mutation graph, parsed — a fallback for the egress scrub. */
      readonly graph: GraphV3T;
      /** The PRE-mutation persisted bytes, for the commit's CAS expected base. */
      readonly baseGraph: unknown;
    }
  | {
      readonly kind: 'base_hash_diverged';
      readonly conflict: GoalTargetEditBaseHashConflict;
    }
  | {
      /**
       * The request cannot be honoured against the canonical model. Nothing is
       * written. Repeating it cannot succeed, so it is never advertised as
       * retryable.
       */
      readonly kind: 'refused';
      readonly reason: string;
    };

/**
 * A non-null persisted graph that fails GraphV3 is CORRUPTION, not absence.
 * Dispatch maps this throw to a retryable 500 with no append.
 */
export class InvalidPersistedGoalTargetGraphError extends Error {
  constructor() {
    super('goal_target_edit persisted graph failed GraphV3 validation');
    this.name = 'InvalidPersistedGoalTargetGraphError';
  }
}

export interface ApplyGoalTargetEditParams {
  readonly payload: SystemEventTurnPayload;
  readonly event: GoalTargetEditEvent;
  readonly requestId: string;
  /** The scenario's persisted graph, read strictly by the caller. */
  readonly persistedGraph: unknown;
  /** Prior handler facts — threaded to the handler exactly as fve does. */
  readonly priorFacts: readonly HandlerFact[];
}

function refused(reason: string): GoalTargetEditResult {
  return { kind: 'refused', reason };
}

export async function applyGoalTargetEdit(
  params: ApplyGoalTargetEditParams,
): Promise<GoalTargetEditResult> {
  const { payload, event, requestId, persistedGraph, priorFacts } = params;
  const logBase = {
    request_id: requestId,
    scenario_id: payload.scenario_id,
    goal_node_id: event.goal_node_id,
  };

  // ── 1. a base we can trust, or nothing ───────────────────────────────────
  if (persistedGraph === null || persistedGraph === undefined) {
    log.info(
      { ...logBase, event: 'v5.system_event.goal_target_edit.no_persisted_graph' },
      'goal_target_edit — no persisted model; refusing without a write',
    );
    return refused('no_persisted_graph');
  }
  const graphParse = GraphV3.safeParse(persistedGraph);
  if (!graphParse.success) {
    log.error(
      {
        ...logBase,
        event: 'v5.system_event.goal_target_edit.persisted_graph_invalid',
        first_issue_path: graphParse.error.issues[0]?.path.join('.') ?? '',
      },
      'goal_target_edit — non-null persisted graph is malformed; failing closed',
    );
    throw new InvalidPersistedGoalTargetGraphError();
  }
  const graph = graphParse.data;

  // ── 2. THE ANALYSIS-SPACE STALE GATE, before anything is resolved ────────
  // Hashed on the RAW persisted bytes (what the client's hash was derived
  // from), never on the Zod-parsed copy — the same rule `structural_rename`
  // applies at the same step.
  const currentBaseHash = computeAnalysisAffectingGraphHash(
    persistedGraph as Parameters<typeof computeAnalysisAffectingGraphHash>[0],
  );
  if (currentBaseHash === null || currentBaseHash !== event.base_graph_hash) {
    log.info(
      {
        ...logBase,
        event: 'v5.system_event.goal_target_edit.base_hash_diverged',
        client_base_graph_hash: event.base_graph_hash,
        server_base_graph_hash: currentBaseHash,
      },
      'goal_target_edit — client base hash diverged from the persisted graph; refusing',
    );
    return {
      kind: 'base_hash_diverged',
      conflict: {
        recovery_action: 'refresh_and_reconfirm',
        conflict_category: BASE_HASH_DIVERGED,
        expected_base_graph_hash: currentBaseHash,
      },
    };
  }

  // ── 3. the target, BY ID, and it must be a GOAL ──────────────────────────
  // Never a label match; a duplicate id is refused rather than arbitrarily
  // disambiguated (the rule every id-addressed writer on this seam applies).
  const matches = graph.nodes.filter((n) => n.id === event.goal_node_id);
  if (matches.length !== 1) {
    log.info(
      {
        ...logBase,
        event: 'v5.system_event.goal_target_edit.goal_not_resolved',
        match_count: matches.length,
      },
      'goal_target_edit — goal_node_id does not resolve to exactly one node; refusing',
    );
    return refused(matches.length === 0 ? 'goal_not_found' : 'goal_ambiguous');
  }
  if (matches[0]!.kind !== 'goal') {
    log.info(
      {
        ...logBase,
        event: 'v5.system_event.goal_target_edit.target_not_goal',
        target_kind: matches[0]!.kind,
      },
      'goal_target_edit — named node is not a goal; refusing',
    );
    return refused('target_not_goal');
  }

  // ── 4. the SAME proposal the typed chip builds ───────────────────────────
  const built = buildTypedChipMutationProposal(
    'add_constraint',
    {
      target_id: event.goal_node_id,
      constraint_type: event.constraint_type,
      value: event.raw_value,
      unit: event.unit,
    },
    { nodes: graph.nodes, edges: graph.edges },
  );
  if (!built.matched) {
    log.warn(
      { ...logBase, event: 'v5.system_event.goal_target_edit.proposal_unbuilt', reason: built.reason },
      'goal_target_edit — typed proposal builder declined; refusing',
    );
    return refused(`proposal_${built.reason}`);
  }

  // The graph handed to the validator and the handler is derived EXACTLY as the
  // conventional path derives it from the persisted graph (`turn-executor.ts`,
  // the `GraphStateIngressSchema` fallback): a PASSTHROUGH parse, not fve's
  // GraphV3 parse. It matters for the handler's RAW reads — it reads the raw
  // target node for the admissibility disclosure and the raw top-level
  // `options[]` for the correction offer, and a GraphV3 parse strips both.
  //
  // ⚠ It does NOT preserve undeclared NODE fields in the stored graph, and must
  // not be read as doing so: `applyAndValidateMutation` GraphV3-parses whatever
  // it is handed, so every D1 write drops them — on the chat path identically
  // (pinned by the node-array parity assertions in the route test).
  const ingress = GraphStateIngressSchema.safeParse(persistedGraph);
  const graphForTurn: unknown = ingress.success ? ingress.data : persistedGraph;

  // ── 5. the EXISTING validator ────────────────────────────────────────────
  const lookupResult = buildGraphLookup(ingress.success ? ingress.data : graph);
  const lookup = lookupResult.kind === 'ok' ? lookupResult.lookup : undefined;
  const validation = validateToolCall(built.proposal, lookup, HANDLER_VALIDATION_REGISTRY);
  if (!validation.valid) {
    log.info(
      {
        ...logBase,
        event: 'v5.system_event.goal_target_edit.validation_refused',
        code: validation.error.code,
      },
      'goal_target_edit — validator refused; no graph written',
    );
    return refused(validation.error.code);
  }

  // ── 6. the EXISTING handler ──────────────────────────────────────────────
  const handlerFn = resolveHandler(getDefaultRegistry(), 'add_constraint');
  if (!handlerFn) return refused('handler_not_registered');

  const invocation: HandlerInvocation = {
    context: {
      session_id: payload.scenario_id,
      stage: payload.stage,
      request_id: requestId,
      prior_turns: [],
      prior_facts: priorFacts,
      scenarioBriefText: null,
      persistedGraph,
      // A system event carries no pending-question context: the elliptical
      // baseline-answer grammar must stay closed, so this is stated EMPTY rather
      // than left to an absent-means-empty reading.
      most_recent_pending_actions: [],
      // BOUNDED, and the bound is checkable. `add_constraint` reads exactly two
      // context fields — `persistedGraph` (fallback graph) and
      // `most_recent_pending_actions` (the elliptical baseline gate) — and both
      // are populated honestly above. `EnrichedTurnContext` is
      // produced only by `buildTurnContext`, which is typed `MessageTurnPayload`;
      // a system event has no `message`, so the alternatives are this cast or
      // FABRICATING user text to feed the builder — the same boundary
      // `factor-value-edit.ts` narrows at, for the same reason.
      // forbidden-exempt: bounded shim — add_constraint reads only persistedGraph + most_recent_pending_actions off the context, both populated honestly; mirrors factor-value-edit.ts
    } as unknown as HandlerInvocation['context'],
    payload: {
      kind: 'message',
      scenario_id: payload.scenario_id,
      turn_id: payload.turn_id,
      stage: payload.stage,
      // ⚠ EMPTY, NEVER FABRICATED. The user entered a number and a unit into a
      // control, not a sentence. The four `payload.message` readers in the
      // handler abstain on '' (see the module header).
      message: '',
      // forbidden-exempt: bounded shim — add_constraint reads only payload.message, which stays empty rather than fabricating user prose; mirrors factor-value-edit.ts
    } as unknown as HandlerInvocation['payload'],
    requestId,
    signal: new AbortController().signal,
    orientationText: '',
    proposal: validation.proposal,
    graphForTurn,
    // The CONTRACT's attestation, relayed through the handler's own side-band.
    // The 0.59.0 member declares `raw_value` an absolute LEVEL in user units;
    // the handler writes it onto the row (and it is the same constant the
    // handler stamps as `goal_threshold_frame`).
    confirmedConstraintValueFrame: CEE_GOAL_THRESHOLD_FRAME,
  };

  let outcome;
  try {
    outcome = await handlerFn(invocation);
  } catch (err) {
    if (err instanceof HandlerInvocationFailedError) {
      log.info(
        {
          ...logBase,
          event: 'v5.system_event.goal_target_edit.handler_refused',
          cause_kind: err.cause_kind,
        },
        'goal_target_edit — handler refused; no graph written',
      );
      return refused(err.cause_kind);
    }
    throw err;
  }

  if (outcome.mutated_graph == null) {
    return refused('handler_returned_no_graph');
  }

  // ⚠ A SYSTEM EVENT HAS NO CHANNEL FOR THE HANDLER'S PENDING QUESTIONS. The
  // two side-channels below are persisted by the turn executor as pending
  // actions in the SAME commit as the receipt that asks them; this writer does
  // not persist them, so a receipt that asked would be a dead control. Neither
  // is reachable for a goal target today (the baseline elicitation is gated to
  // outcome/risk; the correction offer needs a non-checkable target and goals
  // are checkable) — this is the fail-closed backstop if that ever changes.
  if (
    outcome.__constraint_target_correction !== undefined ||
    outcome.__elicit_baseline !== undefined
  ) {
    log.error(
      { ...logBase, event: 'v5.system_event.goal_target_edit.unpersistable_pending' },
      'goal_target_edit — handler asked a question this event cannot persist; refusing',
    );
    return refused('unpersistable_pending_question');
  }

  // Re-merge onto the persisted base, exactly as the turn-executor's write
  // chokepoint (and `factor_value_edit`) does.
  const mergedGraph = mergeMutatedGraphForPersistence({
    mutatedGraph: outcome.mutated_graph as Record<string, unknown>,
    persistedBase: persistedGraph,
    requestId,
    scenarioId: payload.scenario_id,
  });
  const mergedParse = GraphV3.safeParse(mergedGraph);
  if (!mergedParse.success) {
    return refused('merged_graph_invalid');
  }

  // The SAME composer the chat lane uses — maps the `add_constraint` fact to
  // the boundary `graph_patch` block.
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
