/**
 * V5 D1 — `add_constraint` handler.
 *
 * Appends a `GoalConstraint` to `graph.goal_constraints` (top-level
 * field added to GraphV3 in Commit 0). Each constraint references the
 * constrained entity by `node_id`. Per Phase 0 finding #7 + design
 * decision: constraints are persisted as the canonical
 * `GoalConstraintSchema` shape — `{ constraint_id, node_id, operator:
 * '>='|'<=', value, label?, unit?, ... }`.
 *
 * Per correction #8: constraint values are stored in USER UNITS — do
 * NOT run normaliseFactorValue. "churn at most 5%" stores
 * `{ value: 5, unit: '%', operator: '<=' }`, NOT 0.05. The downstream
 * `run_analysis` handler reads `graph.goal_constraints` and forwards
 * them in its PLoT payload, where PLoT performs the unit
 * normalisation against the factor's cap. `add_constraint` itself
 * never calls PLoT (per V5 architecture spec §12 D1 contract).
 *
 * Idempotent collision rule: when a constraint with the same
 * `(node_id, operator)` already exists, its `value`/`label`/`unit` are
 * updated in place. `noop: true` only when the value matches exactly.
 *
 * Gate-1 unit integrity (2026-07-15, Paul-ruled doctrine):
 *   - OMISSION MEANS UNCHANGED. An update turn that does not mention a
 *     unit keeps the persisted constraint's unit ("keep it at most 30"
 *     means 30 of the same kind). The unit fallback chain is
 *     `params.unit` → `existing?.unit` → `observed_state.unit`; before
 *     this fix `existing` was never consulted, so the whole-object
 *     update splice silently STRIPPED the persisted `%` — and the
 *     unit-less 30 fell through PLoT's range priority to the default
 *     [0,1] range, clamped to 1.0, turning "attrition <= 30%" into the
 *     trivially-true "<= 1.0" (silent guardrail nullification; see
 *     acceptance-evidence/constraint-unit-drop/).
 *   - A CONSTRAINT MUST NOT REACH THE WIRE UNIT-AMBIGUOUS. A unit-less
 *     value outside [0,1] targeting a probability-domain node
 *     (goal/outcome/risk) with no declared cap is KNOWN to be
 *     heuristically normalised downstream; the handler refuses it and
 *     asks for the unit (see the emit guard below).
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { AddConstraintHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { AddConstraintHandlerFact } from '@talchain/schemas/orchestrator';

import { GoalConstraintSchema, type GoalConstraintT } from '../../../schemas/assist.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import {
  CEE_GOAL_THRESHOLD_FRAME,
  resolveGoalThresholdCap,
  resolveGoalThresholdCapWithProvenance,
} from '../../../utils/goal-threshold-cap.js';
import {
  extractIncreaseByDelta,
  hasReductionByFraming,
  valuesMatch,
} from '../../../utils/reduction-framing.js';
import { extractGoalTargetWithBaseline } from '../../../cee/factor-extraction/index.js';
import {
  deriveElicitedBaselineAnswerPercent,
  deriveStatedTargetBaselinePercent,
} from '../../../cee/factor-extraction/stated-level.js';
import { findSoleLiveElicitBaselinePending } from '../../session/pending-action.js';
import { deriveStatedConstraintFrame } from '../../../cee/compound-goal/index.js';
import type { HandlerFn, HandlerInvocation, HandlerOutcome } from '../registry.js';
import { HandlerInvocationFailedError, HandlerResultInvalidError } from '../handler-errors.js';
import { sameUnit } from '../../../utils/currency-alphabet.js';
import {
  buildCanonicalAnalysisReadyFromGraph,
  mergeInterventionSourceObjects,
} from '../../../orchestrator/tools/analysis-ready-helper.js';
import { applyAndValidateMutation } from './d1-shared/apply-graph-mutation.js';
import { runD1Handler } from './d1-shared/error-boundary.js';
import { D1HandlerError } from './d1-shared/errors.js';
import {
  formatBaselineElicitation,
  formatBaselineNoted,
  formatConstraintAdded,
  formatConstraintDurationNotEvaluated,
  formatConstraintLabelUpdated,
  formatConstraintMoved,
  formatConstraintNotCheckable,
  formatConstraintUnchanged,
  formatConstraintUpdated,
  formatGoalTargetSet,
  formatGoalTargetUnchanged,
} from './d1-shared/format-confirmation.js';
import {
  classifyConstraintWriteAdmissibility,
  findUnevaluatedDurationSpan,
} from './d1-shared/constraint-write-admissibility.js';
import {
  findConstraintTargetAlternative,
  formatConstraintTargetAlternative,
} from './d1-shared/constraint-target-alternative.js';
import { ADD_CONSTRAINT_USER_GUIDANCE,
  SUCCESS_TARGET_POSITIVE_USER_GUIDANCE,
} from './d1-shared/user-guidance.js';

/**
 * Parameter Zod schema. The brief originally listed
 * `at_least|at_most|exactly|between`, but the canonical
 * GoalConstraintSchema only supports `>=` and `<=` — `exactly` and
 * `between` would require widening the schema and PLoT consumer logic,
 * outside this brief's scope. The handler accepts only `at_least` and
 * `at_most`; the validator rejects others as PARAMETER_INVALID.
 */
export const AddConstraintTypeSchema = z.enum(['at_least', 'at_most']);
// W2E-2: `.finite()` — constraint thresholds are contract-silent on range (any
// finite number is a legal threshold, so no bound is invented here), but zod's
// bare `z.number()` ACCEPTS ±Infinity: only NaN is rejected by the base type.
// An Infinity threshold lands in `graph.goal_constraints` and is forwarded
// verbatim to PLoT by the run_analysis handler. Same channel and same closure
// as SetFactorValueValueSchema; a failure rides the existing PARAMETER_INVALID
// rejection mechanism. The complete channel manifest is swept in
// __tests__/proposal-parameter-finiteness.test.ts.
export const AddConstraintValueSchema = z.number().finite();
export const AddConstraintLabelSchema = z.string().min(1);
export const AddConstraintUnitSchema = z.string().min(1);

const TYPE_TO_OPERATOR: Record<'at_least' | 'at_most', '>=' | '<='> = {
  at_least: '>=',
  at_most: '<=',
};

/**
 * Accepted constrained-entity kinds. Module-level constant so the
 * allowlist, the kind check, and the error metadata stay in one place
 * (no recreating the Set on every handler invocation, no drift
 * between the gate and the rejection details).
 *
 * Kinds:
 *   - factor   ("budget can't exceed £50k")
 *   - outcome  ("retention must be at least 90%")
 *   - goal     (constraint on the goal threshold)
 *   - risk     ("keep churn risk below 5%") — added in A3.1 Task 5.
 *
 * decision / option / action remain rejected (no threshold semantics).
 * GoalConstraintSchema's `node_id` is kind-agnostic; the downstream
 * `run_analysis` handler forwards constraints to PLoT regardless of
 * the constrained-node kind. `add_constraint` itself does not call
 * PLoT — see file header.
 */
// Exported as the SINGLE source of truth for this handler's target-kind
// capability. `routing/__tests__/registry-handler-kind-drift.test.ts` projects
// it through `toEntityKind` and asserts the routing registry's
// `accepted_entity_kinds` matches exactly, so the registry can no longer
// drift into refusing a target this handler would have accepted.
export const ALLOWED_TARGET_KINDS: readonly string[] = [
  'factor',
  'outcome',
  'goal',
  'risk',
];
const ALLOWED_TARGET_KIND_SET: ReadonlySet<string> = new Set(ALLOWED_TARGET_KINDS);

/**
 * Probability-domain target kinds (Gate-1 emit guard). Mirrors PLoT's
 * PROBABILITY_DOMAIN_KINDS (plot-lite-service
 * src/normalisation/constraint-filter.ts): ISL evaluates these nodes on
 * a [0,1] scale, so a unit-less constraint value outside [0,1] cannot
 * be interpreted without a unit or a declared cap — downstream it is
 * heuristically ranged and CLAMPED (value > 1 → 1.0, a trivially-true
 * threshold; value < 0 → 0, a trivially-false one). `factor` is
 * deliberately absent: unit-less absolute factor thresholds ("at most
 * 30" on a headcount) are legitimate.
 */
const PROBABILITY_DOMAIN_KIND_SET: ReadonlySet<string> = new Set([
  'goal',
  'outcome',
  'risk',
]);

/**
 * User-visible clarify for the unit-ambiguity refusal (Gate-1). Rides
 * the SAME wired mechanic as the reduction-sign backstop:
 * `D1HandlerError.userGuidance` → `details.specific_issue`
 * (error-boundary.ts) → the recoverable composer's full assistant_text
 * (compose/handler-failure-responses.ts, `parameter_invalid_at_execute`
 * branch) with a text-prompt recovery chip. Wording is leak-safe per
 * the d1-user-guidance-leak panel (no handler ids, parameter names,
 * enum or operator literals). A specific clarify (not the canonical
 * ADD_CONSTRAINT_USER_GUIDANCE phrase) is deliberate and
 * design-sanctioned: the Gate-1 fix design requires an honest
 * "percentage or absolute?" question, because the generic phrase gives
 * the user no path to resolve the ambiguity. Kept comfortably under the
 * composer's 100-char `sanitiseForUser` truncation (MAX_USER_STRING in
 * compose/helpers.ts) so the question is never cut mid-sentence.
 */
/**
 * ⚠ EXPORTED FOR THE BUDGET GUARD, not for reuse. It is the ONE site that passes
 * a SPECIFIC `userGuidance` rather than a canonical phrase, so it is the one
 * whose length nothing else can check — see
 * `__tests__/d1-guidance-survives-the-sanitiser.test.ts`.
 */
export function formatUnitAmbiguityClarify(value: number): string {
  return `Did you mean ${value}% or an absolute ${value}? Tell me which, and I'll apply it.`;
}

interface ResolvedParams {
  readonly constraint_type: 'at_least' | 'at_most';
  readonly value: number;
  readonly label?: string;
  readonly unit?: string;
  /**
   * ⭐⭐ THE ROW THIS WRITE CORRECTS — the one thing the writer could not be told.
   *
   * The idempotency key is `(node_id, operator)`. A correction MOVES a limit to
   * a different node, so `existing` is undefined and the write APPENDS — leaving
   * the original, wrong, un-evaluable constraint in place, still blocking the
   * same journey it was blocking before (Codex CX-171). `add_constraint` is the
   * only constraint handler in the estate and `apply-graph-mutation.ts:195`
   * states it does NOT prune, so nothing else can remove it either.
   *
   * ⚠ NAMED, NEVER INFERRED. The obvious alternative — treat a write that
   * matches an existing row's operator+value+unit on a different node as a
   * correction of it — was considered and REJECTED: two genuinely different
   * limits can share all three ("£200k on hiring", "£200k on marketing"), and
   * replacing one would be silent data loss. Losing a limit the user set is
   * strictly worse than the duplicate this exists to prevent.
   */
  readonly corrects_node_id?: string;
}

// `resolveGoalThresholdCap` (Lane CEE-W5 Mission B — goal-threshold join,
// Gate-item-8 dead-end) now lives in `../../../utils/goal-threshold-cap.js`
// as the shared cap-resolution doctrine (ROADMAP 1.18, cap-doctrine
// unification hygiene batch) — the draft-path enricher
// (cee/factor-extraction/enricher.ts) delegates to the SAME function so a
// goal target scores identically regardless of registration path. See that
// module's doc comment for the full doctrine.

/**
 * The turn's options, read from the RAW snapshot through the CANONICAL
 * readiness membership — not a third population algorithm.
 *
 * ⚠⚠ TWO DEFECTS LIVED HERE, IN OPPOSITE DIRECTIONS, AND BOTH WERE FOUND ON
 * THE REAL CALLER RATHER THAN BY MY TESTS.
 *
 * FIRST, it read the PARSED graph. `GraphV3` declares nodes, edges and
 * goal_constraints and nothing else, so the ingress parse strips top-level
 * options: `graph.options` was always undefined and the every-option-pin
 * anchor route was dead in production while helper tests passed.
 *
 * THEN, reading the raw snapshot, it preferred any top-level `options` array
 * WHOLESALE. That over-anchors, which is the worse direction. Codex's
 * counterexample: option node A pins hiring cost, node B pins another factor,
 * and the top-level mirror contains only A. A wholesale read sees one option,
 * finds it pins, and concludes EVERY option pins — while the real analysis
 * retains A+B and concludes the opposite. The result is an offer PLoT will
 * refuse to anchor: exactly the actionable-looking dead end this module exists
 * to prevent.
 *
 * ⭐ So the membership question is answered by the code that already answers it
 * for the run. `buildCanonicalAnalysisReadyFromGraph` COMPLETES a partial
 * top-level mirror from the option nodes (analysis-ready-helper.ts:897-942 —
 * a top-level array owns the population only when it is an exact unique-id
 * bijection with the option nodes), and it is what `build-turn-context` uses
 * to load the real run. Asking a different question here would be a third
 * population that is free to drift from both.
 *
 * ⚠ FAILS CLOSED. When canonical readiness cannot build a payload the answer
 * is NO OPTIONS, so the pin route simply does not fire and the offer is
 * withheld. Under-offering is the safe error; over-anchoring names a dead end.
 */
function readSameTurnOptions(rawGraph: unknown): ReadonlyArray<{ interventions?: unknown }> {
  const ready = buildCanonicalAnalysisReadyFromGraph(rawGraph);
  const canonical = ready?.options;
  if (!Array.isArray(canonical) || canonical.length === 0) return [];

  // Interventions come from the option NODE ONLY — byte-for-byte the projection
  // the loader submits (`mergeOptionInterventionObjects`, build-turn-context.ts:
  // "returns the ORIGINAL merged intervention OBJECTS per option", sourced from
  // `optionNodesById.get(option.option_id)` and nothing else).
  //
  // ⛔ THE CANONICAL ROW'S OWN `interventions` ARE DELIBERATELY NOT MERGED IN.
  // Codex CX-20260916 counterexample: node A pins the measured cost, node B pins
  // an upstream factor, and a COMPLETE top-level mirror (an exact unique-id
  // bijection, so it owns the population) pins the cost for BOTH. Unioning the
  // row over the node certifies an all-option cost pin the loader never submits,
  // and the offer then names a target PLoT will refuse to anchor.
  //
  // Canonical readiness answers MEMBERSHIP (which options exist, completing a
  // partial mirror from the nodes). The NODE answers WHAT EACH ONE PINS. Two
  // questions, two authorities, named apart — merging them was one authority
  // answering a question it does not own (trap 21).
  const optionNodesById = new Map<string, Record<string, unknown>>();
  const nodes = (rawGraph as { nodes?: unknown } | null)?.nodes;
  if (Array.isArray(nodes)) {
    for (const n of nodes as Array<Record<string, unknown>>) {
      if (n?.kind === 'option' && typeof n.id === 'string') optionNodesById.set(n.id, n);
    }
  }
  // ⚠ The callback parameter is typed structurally rather than cast. A
  // double cast here would be a 59th `as unknown as` against a baseline of 58
  // and the boundary ratchet would refuse it — correctly, since nothing about
  // this read needs to escape the type system.
  // Only the IDENTITY fields are declared: the row is read for membership and
  // nothing else, and a declared-but-unread `interventions` would invite the
  // merge back.
  const rows: ReadonlyArray<{
    readonly option_id?: unknown;
    readonly id?: unknown;
  }> = canonical;
  return rows.map((row) => {
    const id = typeof row.option_id === 'string' ? row.option_id
      : typeof row.id === 'string' ? row.id : undefined;
    const node = id !== undefined ? optionNodesById.get(id) : undefined;
    // `mergeInterventionSourceObjects` is the loader's own merger, so safely
    // encoded raw-only node interventions are preserved exactly as submitted.
    return { interventions: node !== undefined ? mergeInterventionSourceObjects(node) : {} };
  });
}

function resolveParams(invocation: HandlerInvocation): ResolvedParams {
  const params = invocation.proposal?.parameters ?? [];
  const get = (name: string) => params.find((p) => p.name === name);

  const typeParam = get('constraint_type');
  if (!typeParam) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      'add_constraint requires a "constraint_type" parameter (at_least | at_most).',
      { userGuidance: ADD_CONSTRAINT_USER_GUIDANCE },
    );
  }
  const typeParse = AddConstraintTypeSchema.safeParse(typeParam.value);
  if (!typeParse.success) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      'add_constraint: constraint_type must be "at_least" or "at_most".',
      { details: { received: typeParam.value }, userGuidance: ADD_CONSTRAINT_USER_GUIDANCE },
    );
  }

  const valueParam = get('value');
  if (!valueParam) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      'add_constraint requires a "value" parameter.',
      { userGuidance: ADD_CONSTRAINT_USER_GUIDANCE },
    );
  }
  const valueParse = AddConstraintValueSchema.safeParse(valueParam.value);
  if (!valueParse.success) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      'add_constraint: value must be a number.',
      { details: { received: valueParam.value }, userGuidance: ADD_CONSTRAINT_USER_GUIDANCE },
    );
  }

  const labelParam = get('label');
  let label: string | undefined;
  if (labelParam !== undefined) {
    const labelParse = AddConstraintLabelSchema.safeParse(labelParam.value);
    if (!labelParse.success) {
      throw new D1HandlerError(
        'PARAMETER_INVALID',
        'add_constraint: label must be a non-empty string.',
        { userGuidance: ADD_CONSTRAINT_USER_GUIDANCE },
      );
    }
    label = labelParse.data;
  }

  const unitParam = get('unit');
  let unit: string | undefined;
  if (unitParam !== undefined) {
    const unitParse = AddConstraintUnitSchema.safeParse(unitParam.value);
    if (!unitParse.success) {
      throw new D1HandlerError(
        'PARAMETER_INVALID',
        'add_constraint: unit must be a non-empty string.',
        { userGuidance: ADD_CONSTRAINT_USER_GUIDANCE },
      );
    }
    unit = unitParse.data;
  }

  // ⛔⛔ PRESENT BUT INVALID MUST REJECT — IT MUST NOT DEGRADE TO APPEND
  // (Codex CX-195, found by executing `corrects_node_id: 42`).
  //
  // The first version parsed leniently and fell back to `undefined`, which
  // reads as "no correction was asked for" and APPENDS. So a malformed id
  // silently turned a requested MOVE into a second limit — the exact
  // substitution of one intent for another that CX-183 had just corrected
  // elsewhere, surviving in the PARSER because I only fixed it in the writer.
  //
  // Absence still means "no correction requested" and keeps today's behaviour.
  // It is PRESENCE that now carries an obligation.
  const correctsParam = get('corrects_node_id');
  let correctsNodeId: string | undefined;
  if (correctsParam !== undefined) {
    const correctsRaw = correctsParam.value;
    if (typeof correctsRaw !== 'string' || correctsRaw.trim() === '') {
      throw new D1HandlerError(
        'PARAMETER_INVALID',
        'I did not move the limit because I could not tell which one you meant. Nothing on your model changed.',
        {
          details: { corrects_node_id: correctsRaw, received_type: typeof correctsRaw },
          userGuidance: ADD_CONSTRAINT_USER_GUIDANCE,
        },
      );
    }
    correctsNodeId = correctsRaw.trim();
  }

  return {
    constraint_type: typeParse.data,
    value: valueParse.data,
    ...(label !== undefined ? { label } : {}),
    ...(unit !== undefined ? { unit } : {}),
    ...(correctsNodeId !== undefined ? { corrects_node_id: correctsNodeId } : {}),
  };
}

export function createAddConstraintHandler(): HandlerFn {
  return async function addConstraintHandler(
    invocation: HandlerInvocation,
  ): Promise<HandlerOutcome> {
    return runD1Handler('add_constraint', async () => {
      const proposal = invocation.proposal;
      if (!proposal) {
        throw new HandlerInvocationFailedError(
          'add_constraint invoked without a proposal',
          {
            cause_kind: 'parameter_invalid_at_execute',
            retryable: false,
            details: { handler_id: 'add_constraint' },
          },
        );
      }

      const rawGraph = invocation.graphForTurn ?? invocation.context.persistedGraph ?? null;
      if (!rawGraph) {
        throw new D1HandlerError(
          'PRECONDITION_UNMET',
          'add_constraint requires a graph — none was supplied for this turn.',
          {
            details: { handler_id: 'add_constraint' },
            userGuidance: ADD_CONSTRAINT_USER_GUIDANCE,
          },
        );
      }
      const graphParse = GraphV3.safeParse(rawGraph);
      if (!graphParse.success) {
        throw new D1HandlerError(
          'GRAPH_INVARIANT_VIOLATED',
          'add_constraint: ingress graph failed schema validation.',
          {
            details: {
              handler_id: 'add_constraint',
              first_issue: graphParse.error.issues[0]?.message,
            },
            userGuidance: ADD_CONSTRAINT_USER_GUIDANCE,
          },
        );
      }
      const graph = graphParse.data;

      const targetId = proposal.entity.id;
      const targetNode = graph.nodes.find((n) => n.id === targetId);
      if (!targetNode) {
        throw new D1HandlerError(
          'ENTITY_NOT_FOUND',
          `Cannot add constraint: "${targetId}" is not in the graph.`,
          {
            details: { handler_id: 'add_constraint', target_id: targetId },
            userGuidance: ADD_CONSTRAINT_USER_GUIDANCE,
          },
        );
      }
      // Allowlist + rejection metadata are sourced from the same
      // module-level constant so they cannot drift apart.
      if (!ALLOWED_TARGET_KIND_SET.has(targetNode.kind)) {
        throw new D1HandlerError(
          'ENTITY_KIND_MISMATCH',
          `Cannot add a constraint to a ${targetNode.kind}.`,
          {
            details: {
              handler_id: 'add_constraint',
              target_id: targetId,
              actual_kind: targetNode.kind,
              // Includes 'risk' post-A3.1 — must match the allowlist
              // so user-facing recovery (chip generator reads
              // accepted_kinds) and telemetry agree with actual
              // behaviour.
              accepted_kinds: [...ALLOWED_TARGET_KINDS],
            },
            userGuidance: ADD_CONSTRAINT_USER_GUIDANCE,
          },
        );
      }

      const proposedParams = resolveParams(invocation);

      /**
       * An answer alone states a current level. An independent limitChange
       * carries separate authority and is checked against the proposal below.
       *
       * A target carries TWO semantic quantities: its BASELINE (where it is
       * now) and its SUCCESS CONSTRAINT (where the user needs it to get to).
       * The warrant that admits an answer is scoped to (handler, target), and
       * that is one scope too coarse: granting authority over the baseline
       * conferred it on the limit. Measured — the offered answer "Churn rate is
       * 30%" with a model proposal of 30 rewrote the user's own 10% limit to
       * 30%, DROPPED its `value_frame: level`, and recorded NO baseline, while
       * replying "Updated constraint: Churn rate must be at most 30%."
       *
       * Preserving the row is also what lets the baseline actually record: the
       * frame is inherited only while this turn's value and unit are unchanged
       * (see `inheritedValueFrame`), and the mint cell needs that frame. A turn
       * that "updates" the limit to the answer's number destroys the very
       * attestation the mint depends on — which is why the witnessed defect
       * both corrupted the limit AND lost the baseline.
       *
       * This is the handler's existing OMISSION MEANS UNCHANGED doctrine — held
       * already for `unit` (the gc-cdd6eb74 silent nullification) and for
       * `value_frame` (2.877) — reaching the field those two left exposed. An
       * EXPLICIT limit change on a compound turn must retain its own authority.
       *
       * Matched on the TARGET, not on the proposed operator: a model that
       * mis-reads the answer may propose the other operator too, and appending
       * a second row would be the same harm wearing a different shape.
       */
      const answersBaselineForThisTarget =
        invocation.baselineAnswerAuthority?.targetId === targetId;
      const requestedLimitChange = answersBaselineForThisTarget
        ? invocation.baselineAnswerAuthority?.limitChange
        : undefined;
      if (requestedLimitChange !== undefined &&
          (proposedParams.constraint_type !== requestedLimitChange.constraint_type ||
            !valuesMatch(proposedParams.value, requestedLimitChange.value))) {
        throw new D1HandlerError('PARAMETER_INVALID',
          'The proposed limit does not match the independent instruction in the baseline answer.',
          { userGuidance: ADD_CONSTRAINT_USER_GUIDANCE });
      }
      const constraintRowThisAnswerPreserves = answersBaselineForThisTarget && requestedLimitChange === undefined
        ? graph.goal_constraints?.find((c) => c.node_id === targetId)
        : undefined;

      const params =
        constraintRowThisAnswerPreserves !== undefined
          ? {
              ...proposedParams,
              constraint_type: (constraintRowThisAnswerPreserves.operator === '<='
                ? 'at_most'
                : 'at_least') as typeof proposedParams.constraint_type,
              value: constraintRowThisAnswerPreserves.value,
              ...(constraintRowThisAnswerPreserves.unit !== undefined
                ? { unit: constraintRowThisAnswerPreserves.unit }
                : {}),
            }
          : proposedParams;
      const operator = TYPE_TO_OPERATOR[params.constraint_type];

      // ROADMAP 1.52 — goal-fit sign-inversion backstop. "reduce/decrease/
      // cut/lower/shrink X BY N%" states a CHANGE amount: X moves DOWN on
      // success. The tool-schema guidance (above this handler in the call
      // chain) tells Sonnet to encode that as `at_most`/negative — but if
      // Sonnet ignores the guidance and still emits the naive positive
      // "at_least +N" reading against a message that used exactly this
      // reduction framing, that is the precise fingerprint of the traced
      // bug (6B capture: displayed ~0%, honest ~97-99%). Block and ask for
      // confirmation rather than silently persisting an inverted claim —
      // never guess a fix, per the fix doctrine. Deliberately coarse
      // (whole-message scan): a false positive here only ever costs a
      // clarifying round-trip, never a silent wrong-sign persist.
      if (
        operator === '>=' &&
        params.value > 0 &&
        hasReductionByFraming(invocation.payload.message)
      ) {
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          'add_constraint: reduction-framed message ("reduce/decrease/cut/' +
            'lower/shrink ... by ...") but the resolved constraint is ' +
            '">= positive" — this is the sign-inversion fingerprint ' +
            '(ROADMAP 1.52). Refusing to persist; ask the user to confirm ' +
            'the target instead of guessing the flip.',
          { userGuidance: ADD_CONSTRAINT_USER_GUIDANCE },
        );
      }

      // ROADMAP 2.273 prerequisite — the INCREASE-side mirror of the backstop
      // above. "grow revenue BY 2M" states a CHANGE amount; persisting it as
      // `>= 2M` and stamping `goal_threshold_frame: 'level'` asserts an
      // ABSOLUTE level the user never stated (their target is baseline + 2M).
      // Inert before this PR — a goal with no `observed_state.baseline` made
      // ISL refuse the conversion outright — but this PR POPULATES that
      // baseline, so the same misencoding now yields a confident WRONG
      // probability. Refuse rather than guess the delta→level arithmetic:
      // same doctrine as 1.52, never a silent auto-correction.
      //
      // The trigger is deliberately narrower than 1.52's whole-message scan:
      // it fires only when the RESOLVED value IS the stated delta. If the
      // model already resolved "grow by 2M" to `at_least 6M` it did the
      // arithmetic correctly and must not be punished for it.
      if (operator === '>=' && params.value > 0) {
        const statedDelta = extractIncreaseByDelta(invocation.payload.message);
        if (statedDelta !== null && valuesMatch(params.value, statedDelta)) {
          throw new D1HandlerError(
            'PARAMETER_INVALID',
            'add_constraint: increase-framed message ("increase/grow/raise/' +
              'boost/lift/expand ... by <amount>") resolved to ">= " that same ' +
              'amount, so a stated CHANGE would be persisted and attested as an ' +
              'absolute LEVEL (ROADMAP 2.273). Refusing to persist; ask the user ' +
              'for the target level rather than guessing baseline + delta.',
            { userGuidance: ADD_CONSTRAINT_USER_GUIDANCE },
          );
        }
      }

      // ROADMAP 2.877 (link 1) — RELAY the frame the user's own words attest.
      //
      // ⚠ THIS IS A DIFFERENT QUESTION FROM `isGoalTargetSet` BELOW, AND THAT
      // IS THE WHOLE POINT (trap 21 shape). That predicate answers "is this
      // turn setting the SUCCESS TARGET?" — a goal-node question about the
      // node's own threshold channel. This one answers "does CEE hold
      // deterministic evidence of THIS NUMBER's frame?" — a question about the
      // constraint row, with no goal-ness in it. Fusing them is what left the
      // chat path unframed on EVERY target kind: 2.877 recorded the gap as
      // "non-goal targets carry no value_frame", but measured at `ed8aad89` the
      // regex extractor stamps outcome, risk and factor targets alike (it never
      // reads `kind`), and this handler stamped NONE of them — the dark axis is
      // the PRODUCER, not the target kind. So this derivation is deliberately
      // target-kind agnostic.
      //
      // It mints nothing: `deriveStatedConstraintFrame` returns a frame a
      // registered stamper already attested, gated on the parsed number BEING
      // the number persisted below, and `undefined` in every ambiguous
      // direction — in which case the row stays unattested and ISL keeps
      // failing closed, exactly as #862 intended. Same evidence carrier, and
      // for the same stated reason, as the goal-baseline gate further down.
      const statedValueFrame = deriveStatedConstraintFrame(
        invocation.payload.message,
        operator,
        params.value,
      ) ?? invocation.confirmedConstraintValueFrame ?? requestedLimitChange?.value_frame;

      // Idempotency: match an existing constraint by (node_id, operator).
      // If found, update value/label/unit in place. If not, append a
      // fresh GoalConstraint with a generated id.
      const existing = graph.goal_constraints?.find(
        (c) => c.node_id === targetId && c.operator === operator,
      );

      // ⭐⭐ IS THIS TURN A CORRECTION? Derived ONCE, and derived HERE —
      // ABOVE the unit chain — because THREE readers need it and the unit
      // chain is one of them (Codex CX-195).
      //   · the UNIT chain, to inherit the moved limit's own currency;
      //   · the WRITE, to replace the named row rather than append;
      //   · the RECEIPT and the FACT, because a correction DESTROYS a row.
      // A second derivation would be a twin free to drift.
      const correctsId = params.corrects_node_id;
      // Pointing at the node already targeted asks for nothing to be moved —
      // that is an ordinary update, not a correction.
      const correctionRequested = correctsId !== undefined && correctsId !== targetId;
      const correctableRows = correctionRequested
        ? (graph.goal_constraints ?? []).filter(
            (c) => c.node_id === correctsId && c.operator === operator,
          )
        : [];
      const isCorrection =
        correctionRequested && existing === undefined && correctableRows.length === 1;
      /** The row being moved. Its own recorded unit travels with it. */
      const sourceRow = isCorrection ? correctableRows[0] : undefined;

      // ⭐⭐⭐ A CORRECTION RELOCATES ONE ROW — SO ITS ATTESTED PROPERTIES
      // TRAVEL WITH IT. This is the CLASS, named once, because I have now been
      // handed FOUR separate findings that are all the same fact.
      //
      // `existing` is undefined BY CONSTRUCTION on a move (the row is on a
      // different node), so EVERY chain that reads it falls through to
      // DESTINATION metadata. Each reader loses something the user attested:
      //   · unit        → the limit's currency          (fixed, CX195)
      //   · before      → the row that was destroyed    (fixed, CX195)
      //   · receipt     → "added" instead of "moved"    (fixed)
      //   · value_frame → its quantitative meaning      (CX213 — here)
      //   · label       → the user's own description    (found by sweeping)
      //
      // I fixed the first three ONE AT A TIME and was handed the fourth,
      // which is the "remedy scoped to the instance, nothing sweeps its
      // siblings" failure this estate keeps paying for. So the remaining two
      // are fixed together, under one rule: on a correction the SOURCE row is
      // the prior state of the thing being changed — exactly the role
      // `existing` plays for an ordinary update — and therefore outranks any
      // destination metadata.
      //
      // ⚠ CARRIES, NEVER INVENTS. Absent upstream it stays absent, and an
      // explicit parameter on this turn always wins: the user restating
      // something is not the same as us preserving it.
      //
      // ⛔ `constraint_id` IS DELIBERATELY NOT IN THIS LIST. It is the same
      // shape but it is a SEMANTICS decision (is a moved limit the same
      // limit?), not a loss of attested meaning, and no returned finding asks
      // for it. I checked the one consequence I could think of — identity
      // churn feeding `constraint_identity_unresolved`, which withholds the
      // leader — and it does not bite: that state is reconciled WITHIN a run
      // (run-analysis.ts:1694 reads `constraintVerdict.state`), so a fresh id
      // is self-consistent on the next run. Recorded rather than changed.

      // Default the constraint label from the target node's label so the
      // confirmation text and the persisted shape are coherent — EXCEPT on a
      // correction, where the moved row's own label is the user's attested
      // description and relocating the limit must not silently retitle it
      // with whatever the destination node happens to be called.
      const constraintLabel =
        params.label
        ?? (isCorrection ? sourceRow?.label : undefined)
        ?? targetNode.label;

      // Gate-1 unit-drop fix (Paul-ruled doctrine: omission means
      // UNCHANGED). On an update, a turn that does not mention a unit
      // keeps the persisted row's unit — `existing?.unit` sits between
      // the explicit parameter and the node's observed unit, and it
      // OUTRANKS the observed unit because the row is the prior state
      // of the thing being updated (same convention as
      // set_factor_value's `parsed.unit → before.unit` merge). Before
      // this fix the chain skipped `existing` entirely, so the
      // whole-object update splice below silently stripped the
      // persisted `%` (the live gc-cdd6eb74 silent-nullification
      // defect). Never silently clear a persisted unit.
      //
      // Lifted out of the object literal because the FRAME resolution below
      // has to read the resolved unit, not the raw parameter.
      // ⛔⛔ A MOVE MUST NOT ERASE THE LIMIT'S OWN CURRENCY (Codex CX-195,
      // found by executing a GBP 200,000 move onto a UNITLESS factor).
      //
      // On a correction `existing` is undefined by construction — the row is on
      // a DIFFERENT node — so the old chain fell straight through to the
      // DESTINATION's observed unit. Moving £200,000 onto a factor that records
      // no unit therefore produced a limit with NO CURRENCY AT ALL: the same
      // number, silently denominated in nothing. The one thing a move must
      // preserve is what the number means.
      //
      // `sourceRow.unit` sits exactly where `existing.unit` sits for an
      // ordinary update — it IS the prior state of the thing being changed —
      // and therefore AHEAD of any destination metadata.
      const resolvedUnit =
        params.unit !== undefined
          ? params.unit
          : existing?.unit !== undefined
            ? existing.unit
            : sourceRow?.unit !== undefined
              ? sourceRow.unit
              : targetNode.observed_state?.unit !== undefined
                ? targetNode.observed_state.unit
                : undefined;

      if (requestedLimitChange !== undefined && resolvedUnit !== requestedLimitChange.unit) {
        throw new D1HandlerError('PARAMETER_INVALID',
          'The proposed limit units do not match the independent instruction in the baseline answer.',
          { userGuidance: ADD_CONSTRAINT_USER_GUIDANCE });
      }

      // ⛔ AND TWO UNITS THAT DISAGREE ARE REFUSED, NOT SILENTLY PICKED. An
      // explicit unit that contradicts the moved row's own is two different
      // intents wearing one call — a move, and a re-denomination. Answering
      // one of them silently would change what the user's limit MEANS while
      // reporting a move. `sameUnit` so £ and GBP are one unit spelled twice.
      // ⛔⛔ A MOVE THAT ALSO CHANGES THE NUMBER MAY NOT INHERIT THE UNIT.
      // This is a 700% defect, and it was found by reading PLoT/ISL rather
      // than this file.
      //
      // CEE relabels a sub-1 percentage: `{value: 0.07, unit: '%'}` is stored
      // as `{value: 0.07, unit: 'fraction'}` and MEANS 7%
      // (`compound-goal/extractor.ts` `normaliseConstraintUnits`). That rule
      // fires ONLY on `unit === '%'`, so a row already labelled `fraction` is
      // never re-examined. If a correction moves that limit and states a new
      // value of 7 while silently inheriting `fraction`, the model now carries
      // SEVEN HUNDRED PER CENT and nothing downstream objects.
      //
      // Inheriting a unit is only safe for the quantity it was attested for.
      // A move is a MOVE; a move that also restates the amount is two intents
      // in one call, exactly like the conflicting-unit case below. So the unit
      // must be stated explicitly when the number changes — the turn that
      // changes the quantity is the turn that must say what it is in.
      if (
        isCorrection &&
        params.unit === undefined &&
        sourceRow?.unit !== undefined &&
        !valuesMatch(sourceRow.value, params.value)
      ) {
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          `I did not move the limit because you have changed the amount and I cannot assume it is still in ${sourceRow.unit}. Tell me the amount and its units together. Nothing on your model changed.`,
          {
            details: {
              source_value: sourceRow.value,
              requested_value: params.value,
              source_unit: sourceRow.unit,
            },
            userGuidance: ADD_CONSTRAINT_USER_GUIDANCE,
          },
        );
      }

      // ⚠ AND THIS ONE FIRES ONLY WHEN THE NUMBER IS UNCHANGED, which is the
      // whole of its case. Re-denominating the SAME number is genuinely
      // ambiguous — "move it, and it is USD not GBP" asks two questions at
      // once. But a turn that states BOTH a new amount AND its unit has
      // assumed nothing and left nothing to inherit: the limit is fully
      // specified, so there is no ambiguity to refuse. Refusing it anyway
      // would block the natural repair for the 700% case above ("make it 7%"),
      // which is the one phrasing a user is most likely to reach for.
      if (
        isCorrection &&
        params.unit !== undefined &&
        sourceRow?.unit !== undefined &&
        valuesMatch(sourceRow.value, params.value) &&
        !sameUnit(params.unit, sourceRow.unit)
      ) {
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          `I did not move the limit because it is recorded in ${sourceRow.unit} and you have asked for ${params.unit}. Nothing on your model changed.`,
          {
            details: { source_unit: sourceRow.unit, requested_unit: params.unit },
            userGuidance: ADD_CONSTRAINT_USER_GUIDANCE,
          },
        );
      }

      // ROADMAP 2.877 (link 1) — THE SAME SILENT-NULLIFICATION CLASS AS THE
      // UNIT DROP ABOVE, which this PR would otherwise have opened on a new
      // field. The update path replaces the row WHOLESALE (`list.map(... =>
      // constraintParse.data)`), so once a row can carry a frame, a later turn
      // that carries no deterministic evidence — a label-only change, or a
      // restatement phrased without a constraint clause — would silently CLEAR
      // an attestation that is still true, and ISL would resume refusing.
      //
      // Same doctrine, same shape: OMISSION MEANS UNCHANGED. But gated
      // strictly harder than the unit, because a frame describes a NUMBER:
      // it is inherited only when this turn's value AND unit are both
      // unchanged, i.e. the row still describes the very quantity the frame
      // was attested for. If the value moved, the old frame described a
      // different number and carrying it over would be a manufactured
      // attestation — so it is dropped and the row fails closed, exactly as an
      // unattested row should.
      // The SAME attestation test, applied to whichever row is the prior state
      // of the thing being changed: `existing` for an update, `sourceRow` for a
      // move. `sameUnit` on the correction arm because the move may legitimately
      // spell the currency differently (GBP vs the pound sign) and that is not a
      // change of quantity — an exact string compare would drop the frame on a
      // move that preserved its meaning exactly.
      const frameCarrier = existing ?? (isCorrection ? sourceRow : undefined);
      const frameUnitMatches =
        frameCarrier === existing
          ? existing?.unit === resolvedUnit
          : frameCarrier?.unit !== undefined &&
            resolvedUnit !== undefined &&
            sameUnit(frameCarrier.unit, resolvedUnit);
      const inheritedValueFrame =
        frameCarrier?.value_frame !== undefined &&
        valuesMatch(frameCarrier.value, params.value) &&
        frameUnitMatches
          ? frameCarrier.value_frame
          : undefined;

      const newConstraintBase: Omit<GoalConstraintT, 'constraint_id'> = {
        node_id: targetId,
        operator,
        value: params.value, // user units, no normalisation
        label: constraintLabel,
        provenance: 'explicit',
        // BY-PRESENCE, never defaulted: an absent frame must stay absent on the
        // row, because `undefined` and "unattested" are the same fact here and
        // the contract forbids manufacturing the difference. This turn's own
        // deterministic evidence outranks the inherited one — a re-statement
        // that parses is a fresh attestation of the same number.
        ...(statedValueFrame !== undefined
          ? { value_frame: statedValueFrame }
          : inheritedValueFrame !== undefined
            ? { value_frame: inheritedValueFrame }
            : {}),
        ...(resolvedUnit !== undefined ? { unit: resolvedUnit } : {}),
      };

      const newConstraint: GoalConstraintT = {
        constraint_id: existing?.constraint_id ?? `gc-${randomUUID()}`,
        ...newConstraintBase,
      };

      // Validate the constraint shape before mutating.
      const constraintParse = GoalConstraintSchema.safeParse(newConstraint);
      if (!constraintParse.success) {
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          'add_constraint produced an invalid constraint shape.',
          {
            details: {
              handler_id: 'add_constraint',
              first_issue: constraintParse.error.issues[0]?.message,
            },
            userGuidance: ADD_CONSTRAINT_USER_GUIDANCE,
          },
        );
      }

      // Lane CEE-W5 Mission B — the goal-threshold JOIN. An `at_least`
      // constraint whose target IS the goal node is the conversational
      // "set the success target" intent (tool-schema routes it here;
      // validation-registry accepts entity kind 'goal'). Historically the
      // constraint fact landed while the goal node's threshold fields —
      // the ONLY source `has_goal_target` / the UI goal chip / PLoT's
      // explicit-threshold path read — stayed unset (Gate-item-8
      // dead-end). Stamp them in the SAME validated write below (single
      // derivation from the same params, same sanctioned commit path:
      // mutated_graph → mergeMutatedGraphForPersistence →
      // commitDirectAnswer — no new writer). With goal_threshold now
      // explicit on the goal node, PLoT's auto_goal_threshold synthesis
      // no longer triggers — the user threshold travels explicitly.
      //
      // `at_most` goal constraints deliberately do NOT stamp a threshold:
      // ISL computes P(samples >= threshold) (MINIMISATION doctrine —
      // encoding a "keep below" bound as a >=-threshold would invert the
      // claim). The constraint entry still lands.
      //
      // ⚠ ONE PREDICATE, TWO QUESTIONS — SPLIT AND NAMED APART (ROADMAP 2.877,
      // trap 21). `isGoalTargetSet` was read by four call sites answering two
      // genuinely different questions:
      //
      //   (1) "Is this turn SETTING THE SUCCESS TARGET?" — a question about the
      //       user's INTENT, which decides the positive-value guard and which
      //       receipt sentence the user reads.
      //   (2) "Does this write OWN THE GOAL NODE's threshold channel?" — a
      //       question about PERSISTENCE, which decides the second
      //       unchanged-value channel and whether the node-threshold stamp runs.
      //
      // They are CO-EXTENSIVE TODAY and deliberately derived from one another
      // below, so this split changes no behaviour. It exists because a third
      // question — "does CEE hold deterministic evidence of this number's
      // FRAME?" (see `statedValueFrame` above) — had no name at all, and so
      // inherited this predicate's goal-ness by default and left the chat path
      // unframed on every target kind. Naming the questions apart is what stops
      // the next one being folded in silently: when a new conjunct is needed,
      // add it to the question it answers, never to "the goal predicate".
      const isSuccessTargetTurn = targetNode.kind === 'goal' && operator === '>=';
      /** Co-extensive with (1) today; a separate name so it can stop being. */
      const ownsGoalThresholdChannel = isSuccessTargetTurn;

      // Review hardening (2026-07-07): a success target must be a positive
      // number — the shared value schema is a plain z.number(), so without
      // this guard "-5%" would persist a negative goal_threshold that ships
      // to PLoT/ISL unbounded.
      if (isSuccessTargetTurn && !(params.value > 0)) {
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          'A success target must be a positive number — tell me the target value again.',
          {
            // ⭐ THIS SENTENCE IS SHOWN TO THE USER, not replaced by the generic
            // one — and it is the ONLY one of the file's user-voiced messages
            // that may be, which is why it is written out here rather than
            // pointed at a shared constant.
            //
            // TWO GATES, BOTH MEASURED. (1) VOCABULARY: every term is one the
            // product has already shown — "Success target value" is a labelled
            // field in the interface and "Get help defining the success target"
            // is its help copy. A sentence can be flawless English and still
            // name a concept the product invented and never taught; that is the
            // test, not plain-English readability. (2) BUDGET: 76 characters
            // against `sanitiseForUser`'s 100, so it survives whole.
            //
            // ⛔ THE OTHER USER-VOICED SENTENCES IN THIS FILE DO NOT QUALIFY AND
            // MUST KEEP THE GENERIC GUIDANCE. Three exceed the budget (101, 138
            // and 188 characters) and would truncate mid-word — shortening them
            // is authorship, not routing, and is not this lane's call. Three
            // more name "the independent instruction in the baseline answer",
            // a product concept with ZERO occurrences anywhere in the interface
            // (measured, against a contrast control firing 234 times).
            userGuidance: SUCCESS_TARGET_POSITIVE_USER_GUIDANCE,
          },
        );
      }

      // Overnight review F8+F9 — ONE add-constraint channel-unification fix
      // (ORCHESTRATOR-DEFAULT doctrine, pending Paul ratification — see
      // acceptance-evidence/receipt-honesty/README.md). A success
      // target can be registered through TWO channels, and unchanged-value
      // detection must compare against BOTH before the mutation runs:
      //   (a) the goal_constraints row (`existing`, above) — this
      //       handler's own canonical representation.
      //   (b) the goal node's OWN goal_threshold_raw/_unit fields — the
      //       draft path (cee/factor-extraction/enricher.ts) stamps ONLY
      //       these, by design, and never writes a goal_constraints row.
      //       A restatement of an already-draft-registered value must not
      //       read the row's absence as "nothing registered yet" (F8).
      // `label` is EXCLUDED from the value-sameness predicate (F8
      // secondary): an LLM-supplied label paraphrase must not flip an
      // identical-value restatement into a false "fresh update" claim. A
      // label-only change gets its own distinct receipt below — never a
      // value-change claim, never a total no-op either (the label DID
      // change and is persisted).
      // ⛔ "UNCHANGED" MEANS THE TARGET THE USER READS (#1924 follow-up, #69 5834662051). The UI
      // writes the stamp (`threshold_source: 'user'` + `success_threshold`) WITHOUT the raw target on
      // its stamp-only surfaces and reads the stamp first. A restatement that matches the RAW target
      // but not a user stamp is a change the user will see, never "already … no need to change it".
      // An absent or cleared stamp agrees by definition: the UI then reads raw.
      const userStampDisagrees =
        ownsGoalThresholdChannel &&
        targetNode.threshold_source === 'user' &&
        typeof targetNode.success_threshold === 'number' &&
        targetNode.success_threshold !== params.value;
      const rowValueUnchanged =
        existing !== undefined &&
        existing.value === newConstraint.value &&
        existing.unit === newConstraint.unit &&
        !userStampDisagrees;
      const nodeChannelUnchanged =
        ownsGoalThresholdChannel &&
        typeof targetNode.goal_threshold_raw === 'number' &&
        targetNode.goal_threshold_raw === params.value &&
        targetNode.goal_threshold_unit === newConstraint.unit &&
        !userStampDisagrees;
      const valueUnchanged = rowValueUnchanged || nodeChannelUnchanged;
      const labelChanged = existing !== undefined && existing.label !== newConstraint.label;
      // F9 — the node's goal_threshold_raw/_unit/_cap fields are the exact
      // fields `computeAnalysisAffectingGraphHash` reads; re-stamping them
      // on a turn whose OWN receipt says "nothing changed" moves the
      // analysis-affecting hash out from under an honest noop claim. Only
      // stamp when the value genuinely changed this turn. The
      // goal_constraints row upsert below still runs unconditionally
      // (matching every other D1 handler's noop contract — see
      // d1-cross-handler.test.ts: a noop turn still returns a
      // `mutated_graph`, just one whose hash is unchanged because its
      // content is byte-identical to what was already persisted); it is
      // ONLY the node-threshold stamp that is gated, since that is the
      // field the F9 defect actually moved.
      const stampGoalThreshold = ownsGoalThresholdChannel && !valueUnchanged;

      // Gate-1 EMIT GUARD — a constraint must not reach the wire
      // unit-ambiguous. A unit-less value outside [0,1] targeting a
      // probability-domain node (goal/outcome/risk) with no declared cap
      // is KNOWN to be heuristically normalised downstream: PLoT's range
      // priority finds no percent unit and no explicit cap, falls to the
      // default [0,1] range, and CLAMPS — value > 1 becomes a
      // trivially-true threshold (the analysis reports the guardrail
      // checked-and-passed while it was never evaluated; the live
      // 2026-07-15 silent-nullification defect), value < 0 the
      // trivially-false mirror. Refuse and ask for the unit instead of
      // guessing — a false positive costs one clarifying round-trip,
      // never a silent wrong persist (same doctrine as the
      // reduction-framing backstop above). Exemptions, in order:
      //   - the effective unit (params → existing row → observed_state)
      //     resolved: the scale is asserted;
      //   - the node carries a declared cap (`observed_state.cap` or
      //     `goal_threshold_cap`): downstream normalisation is explicit;
      //   - this very turn co-stamps a goal_threshold_cap (goal `>=`
      //     target-set with a changed value — `capToStamp` below is
      //     non-null whenever the stamp will run, since the positive-
      //     target guard above guarantees `params.value > 0`): the cap
      //     travels in the SAME committed write, PLoT's P0 tier.
      // NOTE: this deliberately fires even when the ambiguous row is
      // ALREADY persisted and the turn is a value-identical restatement —
      // confirming "already constrained ✓" would re-affirm a guardrail
      // that is not being evaluated; the clarify is the repair path.
      // ROADMAP 2.877 (link 2) TIGHTENING — a cap only exempts when the value
      // actually FITS it. The old predicate treated ANY positive cap as "the
      // downstream normalisation is explicit", but PLoT's normaliseValue CLAMPS
      // to [0,1]: a unit-less value ABOVE the cap lands at 1.0 (trivially-true
      // threshold) and a NEGATIVE one at 0 (trivially-false) — the exact silent
      // nullification this guard exists to refuse, reachable through e.g. an
      // LLM-drafted cap smaller than the user's number. Priced now because the
      // link-2 baseline mint declares cap:1 on its targets (the identity scale
      // for fraction-frame rows), which would otherwise have widened the
      // exempt-then-clamp cell to every minted node. The exemption survives
      // exactly where it is sane: 0 ≤ value ≤ cap, the unclamped cell.
      const capExempts = (cap: unknown): boolean =>
        typeof cap === 'number' &&
        cap > 0 &&
        params.value >= 0 &&
        params.value <= cap;
      const declaredCap =
        capExempts(targetNode.observed_state?.cap) ||
        capExempts(targetNode.goal_threshold_cap);
      const capToStamp = stampGoalThreshold
        ? resolveGoalThresholdCap(
            targetNode.goal_threshold_cap,
            params.value,
            newConstraint.unit,
            targetNode.goal_threshold_unit,
          )
        : null;
      if (
        newConstraint.unit === undefined &&
        (params.value > 1 || params.value < 0) &&
        PROBABILITY_DOMAIN_KIND_SET.has(targetNode.kind) &&
        !declaredCap &&
        capToStamp === null
      ) {
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          'add_constraint: unit-ambiguous constraint refused — a unit-less ' +
            `value ${params.value} on a probability-domain node with no ` +
            'declared cap would be heuristically ranged downstream and ' +
            'clamped into a trivially-satisfied (or trivially-violated) ' +
            'threshold. Ask the user for the unit instead of guessing.',
          {
            details: {
              handler_id: 'add_constraint',
              target_id: targetId,
              target_kind: targetNode.kind,
              value: params.value,
              rejection_reason: 'unit_ambiguous_probability_domain',
            },
            userGuidance: formatUnitAmbiguityClarify(params.value),
          },
        );
      }

      // ROADMAP 2.877 (link 2) — MINT THE TARGET'S USER-STATED CURRENT LEVEL.
      //
      // A level-framed constraint on a non-goal target reaches ISL and refuses
      // `CONSTRAINT_NOT_CONVERTIBLE / missing_target_baseline`, because the
      // level→sample-frame conversion needs `observed_state.baseline` on the
      // TARGET node and nobody mints it. This block mints it — RELAY-ONLY,
      // never invented: `deriveStatedTargetBaselinePercent` returns a number
      // only when the user's own message states the target's current level
      // ("churn is 12% today, keep it under 10%"), bound to the target by its
      // label. No statement ⇒ no mint ⇒ the honest refusal stands (elicitation
      // is row 2.918, not this handler). A defaulted baseline is the
      // fabrication class this whole chain exists to remove — CEE's own prompt
      // once emitted 0.5/`inferred` placeholders (defaults-v187.ts) and that
      // class is forbidden here.
      //
      // THE CELL IS NARROW ON PURPOSE, each conjunct derived from a CONSUMER'S
      // bytes rather than from what a field ought to mean:
      //   - frame 'level' on the row that will persist (stated this turn or
      //     honestly inherited): a delta row needs no baseline, and an
      //     unframed row must keep failing closed at the frame hop;
      //   - kind outcome|risk: factors get a PLoT ParameterUncertainty
      //     (translator-v3.ts:674) and ISL then refuses the conversion — a
      //     baseline there is inert (2.877 measured arm H). Goals have their
      //     own coherent mint (2.273) and a different divisor (rung-3 cap);
      //   - unit '%' with 1 < value ≤ 100: PLoT only RUNS constraint
      //     normalisation when some value leaves [0,1]
      //     (constraintsNeedNormalisation); value > 1 guarantees every run
      //     carrying THIS row normalises it on the fixed [0,100] percent rung,
      //     and ≤ 100 keeps it unclamped. A '%' row ≤ 1 can be forwarded RAW,
      //     where a fraction baseline beside a raw-percent threshold converts
      //     to a confident wrong number — so it never mints;
      //   - no goal_threshold_cap on the target: that cap outranks the percent
      //     rung in PLoT's ladder and would change the divisor;
      //   - NON-ROOT target: ISL refuses roots (`root_target`) AND reads a
      //     root's observed value as its sample base, so a root mint buys
      //     nothing and moves the analysis instead;
      //   - FILL-ONLY, precisely scoped: an existing BASELINE — whatever wrote
      //     it — outranks this mint and is never overwritten. An existing
      //     observed_state WITHOUT a baseline is extended, and its `value` IS
      //     replaced by the stated fraction (the user's own statement outranks
      //     a model-drafted value — the same doctrine as the transform's goal
      //     limb, 2.294) provided its scale fields (unit/cap) agree with the
      //     minted shape; otherwise the whole mint is skipped.
      //
      // KNOWN RESIDUAL (paired with row 2.918, disclosed not discovered): a
      // baseline minted from a statement the user later disavows cannot be
      // corrected through THIS channel — fill-only means a restatement with a
      // different number refuses rather than overwrites. The correction path
      // is the elicitation/edit seam (2.918), which owns provenance-aware
      // overwrite semantics; silently letting the newest parse win here would
      // let one regex misread destroy a user-attested value.
      //
      // THE SHAPE {value: frac, baseline: frac, unit: 'fraction', cap: 1} is
      // the identity-scale declaration: PLoT's deriveRange resolves
      // explicit_cap [0,1] for this node, so a coexisting draft-path 'fraction'
      // row normalises to itself (without the cap, deriveRange's
      // inferred-baseline rung would turn baseline 0.12 into range [0,0.24]
      // and rescale a draft 0.05 into 0.208 — a confident wrong number).
      // 'fraction' is PLoT's own fraction-scale token, so the scale-unit
      // compatibility check reconciles. `value` rides beside `baseline`
      // because ISL's ObservedState requires it (robustness_v2.py:174) — at
      // statement time the current observed level IS the baseline, the same
      // single-number argument the goal limb documents (transforms/schema-v3).
      const effectiveRowFrame = statedValueFrame ?? inheritedValueFrame;
      const existingObserved = targetNode.observed_state;
      // Draft percentages carry a unit-interval calculation value and a raw
      // display percentage. Only that declared, corroborated pair is compatible.
      const declaredPercentLevel = existingObserved?.unit === '%' &&
        existingObserved.declared_scale === 'unit_interval' &&
        existingObserved.cap === undefined &&
        Number.isFinite(existingObserved.value) &&
        existingObserved.value >= 0 && existingObserved.value <= 1 &&
        typeof existingObserved.raw_value === 'number' &&
        Number.isFinite(existingObserved.raw_value) &&
        existingObserved.raw_value >= 0 && existingObserved.raw_value <= 100 &&
        valuesMatch(existingObserved.value, existingObserved.raw_value / 100);
      const mintEligible =
        effectiveRowFrame === 'level' &&
        (targetNode.kind === 'outcome' || targetNode.kind === 'risk') &&
        resolvedUnit === '%' &&
        params.value > 1 &&
        params.value <= 100 &&
        targetNode.goal_threshold_cap === undefined &&
        graph.edges.some((e) => e.to === targetId) &&
        existingObserved?.baseline === undefined &&
        (existingObserved?.unit === undefined || existingObserved.unit === 'fraction' || declaredPercentLevel) &&
        (existingObserved?.cap === undefined || existingObserved.cap === 1);
      // Review B2, WIDENED by 2.960 R2 — the statement must name THIS target
      // unambiguously among EVERY other labelled node, whatever its kind. The
      // old population mirrored the KIND gate (outcome/risk), so a goal 'Win
      // rate' or a factor 'Customer churn' whose label the subject also binds
      // was invisible to the ambiguity rule and "The rate is 12%" minted onto
      // 'Churn rate' as if the goal did not exist. Words do not read kinds.
      // The cost is refusal in graphs that carry a same-worded sibling — and
      // that refusal lands in the elicitation cell below, whose question
      // names the target and so RESOLVES the ambiguity on the next turn.
      const competingLabels = graph.nodes
        .filter((n) => n.id !== targetId)
        .map((n) => n.label);
      // ROADMAP 2.918 — the QUESTION-CONTEXT GATE for the elliptical answer
      // grammar. An elliptical answer ("about 12%") carries no subject, so it
      // may bind ONLY when the immediately prior turn asked THIS target's
      // baseline question: exactly ONE live `elicit_target_baseline` pending
      // (two live questions are ambiguous — the helper returns null), whose
      // target IS this handler's target. Pendings are SERVER-MINTED (persisted
      // by the executor from this handler's own `__elicit_baseline` channel,
      // validated by `parsePendingAction` on read), so no LLM proposal can
      // fabricate the carry. No pending question ⇒ the plain #868 grammar ⇒
      // no elliptical binding — fail closed.
      const soleElicitPending = findSoleLiveElicitBaselinePending(
        invocation.context.most_recent_pending_actions,
        Date.now(),
      );
      const ellipticalAllowed =
        soleElicitPending !== null && soleElicitPending.action.target_id === targetId;
      const statedBaselinePercent = mintEligible
        ? ellipticalAllowed
          ? deriveElicitedBaselineAnswerPercent(
              invocation.payload.message,
              targetNode.label,
              competingLabels,
            )
          : deriveStatedTargetBaselinePercent(
              invocation.payload.message,
              targetNode.label,
              competingLabels,
            )
        : undefined;
      const mintedBaseline = statedBaselinePercent !== undefined;
      // ROADMAP 2.918 — THE ELICITATION CELL, derived from the mint's own
      // gates in this same scope (one predicate, no twin to drift): the mint
      // COULD serve this row (`mintEligible`) and there is no stated level to
      // mint. The receipt below asks the one question; `__elicit_baseline` on
      // the outcome tells the executor to persist the pending question in the
      // same commit. The constraint commit itself is NEVER touched.
      const elicitBaseline = mintEligible && !mintedBaseline;


      // ⛔⛔ AN UNRESOLVABLE CORRECTION FAILS CLOSED — IT DOES NOT FALL THROUGH
      // TO APPEND (Codex CX-183, correcting my first cut, and they are right).
      //
      // My first version treated 0 or 2+ matches as "refuse the correction and
      // behave exactly as today", i.e. append. That reads like the safe
      // default and is the opposite: the user asked for a limit to be MOVED,
      // and appending silently substitutes an ADDITIONAL limit for the move —
      // leaving the original, un-evaluable row in place and recreating the
      // exact poisoned-old-row loop this parameter exists to break. A silent
      // substitution of one intent for a different one is worse than a visible
      // refusal.
      //
      // Destination collision is refused for the same reason rather than
      // merged: with a row already on the destination there are two plausible
      // readings (update the destination and drop the source, or leave the
      // source alone) and picking one is inference. Ambiguous identity is
      // asked about, never resolved by guessing.
      //
      // ⚠ Only callers that supply NO correction parameter keep the ordinary
      // append — so nothing existing changes behaviour.
      if (correctionRequested && !isCorrection) {
        const reason =
          existing !== undefined
            ? 'there is already a limit on that target'
            : correctableRows.length === 0
              ? 'I could not find the limit you meant'
              : 'more than one limit matches the one you meant';
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          `I did not move the limit because ${reason}. Nothing on your model changed.`,
          {
            details: {
              corrects_node_id: correctsId,
              target_node_id: targetId,
              matching_source_rows: correctableRows.length,
              destination_row_exists: existing !== undefined,
            },
            userGuidance: ADD_CONSTRAINT_USER_GUIDANCE,
          },
        );
      }

      const result = applyAndValidateMutation(rawGraph, (clone) => {
        const list = clone.goal_constraints ?? [];
        // F8 backfill residual (self-review hardening): when there is no
        // existing row (`existing === undefined`) AND the value is
        // unchanged (necessarily via the NODE channel in that case — see
        // `nodeChannelUnchanged` above), appending a brand-new
        // goal_constraints row would move the analysis-affecting hash
        // (goal_constraints is part of that hash) on a turn whose own
        // receipt says nothing changed — the same defect class F9 closed
        // for the node stamp, manifesting via row-creation instead. Skip
        // the append in exactly that case; a genuinely NEW constraint
        // (existing undefined, valueUnchanged false) still appends as
        // before.
        // ⭐⭐ THE CORRECTION ARM (Codex CX-171). Replaces the NAMED row in the
        // SAME atomic mutation, so there is no window in which the graph holds
        // both limits and no second write to fail halfway.
        //
        // ⚠ It sits BELOW `existing` and ABOVE `valueUnchanged`, and both
        // placements are load-bearing:
        //   · below `existing` — a write to the SAME (node, operator) is an
        //     ordinary update and must stay exactly as it was;
        //   · above `valueUnchanged` — a correction that moves £200,000 from a
        //     risk to a factor changes NO value, so the unchanged-skip would
        //     silently discard the entire correction.
        //
        // ⛔ REFUSES ON AMBIGUOUS IDENTITY. 0 matches means the row is already
        // gone; 2+ means the (node, operator) key is not unique here and
        // choosing between them would be a guess. Both fall through to today's
        // behaviour untouched — the user's limit is never lost to this path.
        const next = existing
          ? list.map((c) =>
              c.node_id === targetId && c.operator === operator ? constraintParse.data : c,
            )
          : isCorrection
            ? list.map((c) =>
                c.node_id === correctsId && c.operator === operator ? constraintParse.data : c,
              )
            : valueUnchanged
              ? list
              : [...list, constraintParse.data];
        clone.goal_constraints = next;
        if (stampGoalThreshold) {
          const goalNode = clone.nodes.find((n) => n.id === targetId);
          if (goalNode) {
            const resolvedCap = resolveGoalThresholdCapWithProvenance(
              goalNode.goal_threshold_cap,
              params.value,
              newConstraint.unit,
              goalNode.goal_threshold_unit,
            );
            goalNode.goal_threshold_raw = params.value; // user units (display + has_goal_target)
            // ⛔ THE TARGET AND THE UI'S STAMP ARE ONE PAIR (#1921 follow-up, #69 5834364983). NodeV3 now
            // keeps `threshold_source` + `success_threshold` through every write, and the UI reads a stated
            // target from that stamp first — so moving the raw target without it left a stale figure on
            // screen after a reload. This row is `provenance: 'explicit'` (the user stated it): the pair is theirs.
            goalNode.success_threshold = params.value;
            goalNode.threshold_source = 'user';
            // Unit is ALWAYS reconciled (review hardening): the node's
            // threshold unit follows the constraint row's effective unit.
            // Gate-1 doctrine note: with `existing?.unit` now in the
            // fallback chain, a turn that OMITS the unit inherits the
            // persisted row's unit (omission means unchanged) rather
            // than clearing it — the inherited unit is displayed in the
            // receipt, so a wrong inheritance is user-visible and
            // correctable, never a silent scale change. The clearing
            // branch below now only runs when no unit resolves anywhere
            // (params, existing row, observed_state).
            if (newConstraint.unit !== undefined) {
              goalNode.goal_threshold_unit = newConstraint.unit;
            } else {
              delete goalNode.goal_threshold_unit;
            }
            if (resolvedCap !== null) {
              const cap = resolvedCap.cap;
              goalNode.goal_threshold_cap = cap;
              // WHICH RULE produced that denominator, minted in the same block
              // as the cap so the two cannot diverge. On
              // `target_derived_headroom` the cap is `raw * 1.25`, which makes
              // the line below the constant 0.8 for every target.
              goalNode.goal_threshold_cap_provenance = resolvedCap.provenance;
              goalNode.goal_threshold = params.value / cap; // model units (0–1)
              // ROADMAP 2.273 — the chat-path twin of the draft-path baseline
              // stamp (cee/factor-extraction/enricher.ts). Same shared
              // extractor, so the two registration paths cannot drift.
              //
              // GATED ON THE TARGET MATCHING `params.value`. The extractor
              // guarantees its target and baseline came from ONE match, i.e.
              // the same metric — but it says nothing about whether that
              // metric is the one being persisted here. Requiring the stated
              // target to equal the value actually being stamped carries that
              // guarantee across: if the user mentioned a different metric's
              // target in the same message, the numbers won't match and no
              // baseline is written. Divided by the SAME `cap` as the line
              // above, never a separately-derived one.
              // This path already holds a V3 node, so it writes the WIRE field
              // (`observed_state`) directly rather than a V1 carrier the
              // transform would later convert — there is no transform left to
              // run. `value` and `baseline` are the same single extracted
              // number for the reason documented in
              // `cee/transforms/schema-v3.ts`: ISL's `ObservedState.value` is
              // required, and at registration time the goal's current observed
              // level IS its baseline.
              const statedPair = extractGoalTargetWithBaseline(invocation.payload.message);
              if (statedPair) {
                const rawTarget =
                  statedPair.unit === '%' ? statedPair.value * 100 : statedPair.value;
                const rawBaseline =
                  statedPair.unit === '%' ? statedPair.baseline * 100 : statedPair.baseline;
                if (valuesMatch(rawTarget, params.value)) {
                  const normalisedBaseline = rawBaseline / cap;
                  goalNode.observed_state = {
                    ...goalNode.observed_state,
                    value: normalisedBaseline,
                    baseline: normalisedBaseline,
                    source: 'brief_extraction',
                    raw_value: rawBaseline,
                    cap,
                    ...(goalNode.goal_threshold_unit !== undefined && {
                      unit: goalNode.goal_threshold_unit,
                    }),
                  };
                }
              }
              // ROADMAP 2.258 — attest the FRAME beside the number, on the
              // same branch that mints it so the two can never diverge. A CODE
              // CONSTANT: the line above divides a user-units target by a cap,
              // which is an absolute LEVEL by construction.
              goalNode.goal_threshold_frame = CEE_GOAL_THRESHOLD_FRAME;
            }
          }
        }
        // ROADMAP 2.877 (link 2) — the stated-baseline write. Same committed
        // write as the row upsert (mutated_graph → persistence), no new
        // writer. Guarded by `mintedBaseline`, whose derivation above already
        // enforced fill-only against the pre-mutation node; the goal-stamp
        // block cannot have raced it because the mint excludes goal targets.
        if (statedBaselinePercent !== undefined) {
          const mintTarget = clone.nodes.find((n) => n.id === targetId);
          if (mintTarget) {
            const frac = statedBaselinePercent / 100;
            mintTarget.observed_state = {
              ...mintTarget.observed_state,
              value: frac,
              baseline: frac,
              unit: 'fraction',
              cap: 1,
              raw_value: frac,
              source: 'brief_extraction',
              extractionType: 'explicit',
            };
          }
        }
        return {
          // ⛔ ON A CORRECTION `before` IS THE SOURCE ROW (Codex CX-195). It
          // was `null` because `existing` is undefined by construction on a
          // move — so the fact channel recorded a destroyed limit as a fresh
          // add, and nothing downstream could see what was removed.
          before: isCorrection
            ? (sourceRow as Record<string, unknown>)
            : existing
              ? (existing as Record<string, unknown>)
              : null,
          after: constraintParse.data as unknown as Record<string, unknown>,
        };
      });

      // ROADMAP 2.877 (link 2) — F9 discipline: a turn that minted a baseline
      // CHANGED the graph (observed_state is analysis-affecting), so it must
      // not be narrated as a no-op even when the constraint row itself is a
      // value-identical restatement. That restatement-plus-stated-level turn is
      // the natural REPAIR after an honest ISL refusal, and swallowing it under
      // `noop` would both lie in the fact channel and move the
      // analysis-affecting hash out from under a "nothing changed" receipt.
      // ⚠ `!isCorrection` is the same discipline as `!mintedBaseline` beside it:
      // a correction REMOVES a constraint row, which is analysis-affecting, so
      // the turn changed the model however unchanged the value looks.
      const turnIsNoop = valueUnchanged && !labelChanged && !mintedBaseline && !isCorrection;
      const fact: AddConstraintHandlerFact = {
        fact_type: 'add_constraint',
        fact_version: 1,
        noop: turnIsNoop,
        result: {
          target_id: newConstraint.constraint_id,
          status: turnIsNoop ? 'noop' : 'applied',
          before: result.before,
          after: result.after,
        },
      };

      const factCheck = AddConstraintHandlerFactSchema.safeParse(fact);
      if (!factCheck.success) {
        throw new HandlerResultInvalidError(
          'AddConstraintHandlerFact failed schema validation',
          factCheck.error,
        );
      }

      const formatInput = {
        targetLabel: constraintLabel,
        operator,
        value: params.value,
        ...(newConstraint.unit !== undefined ? { unit: newConstraint.unit } : {}),
      };
      // Goal-target sets get the honest target-naming receipt (the
      // threshold IS stamped in the committed write above); everything
      // else keeps the existing constraint copy byte-for-byte. ROADMAP
      // 1.19(a): a re-registration whose value is IDENTICAL to what is
      // already persisted (`valueUnchanged`, computed above across BOTH
      // channels per F8/F9) must not claim "Updated"/"set" — that
      // borrows the pre-existing threshold/constraint to narrate a
      // commit that did not happen this turn. The fact channel already
      // marks this `noop`; the text channel now agrees. F8(b): a
      // label-only change (value unchanged, label differs) gets its own
      // distinct receipt — never the fresh-update claim, never the
      // total-noop claim either.
      // ⚠⚠ THE TEXT CHANNEL MUST USE THE SAME PREDICATE AS THE FACT CHANNEL,
      // and this is the line that keeps them together. The comment above says
      // "the fact channel already marks this noop; the text channel now
      // agrees" — so when a conjunct is added to one, it belongs on both. I
      // added `!isCorrection` to `turnIsNoop` alone and a test caught the text
      // still saying "no need to change it" over a mutation that DELETED a
      // constraint row. Fixing one channel of a two-channel agreement is how
      // the agreement silently ends.
      //
      // A correction is never "unchanged": it removes a row, which is
      // analysis-affecting, whatever the value looks like.
      const narratesUnchanged = valueUnchanged && !isCorrection;
      const constraintText = isSuccessTargetTurn
        ? narratesUnchanged
          ? formatGoalTargetUnchanged({
              goalLabel: targetNode.label,
              value: params.value,
              ...(newConstraint.unit !== undefined ? { unit: newConstraint.unit } : {}),
            })
          : formatGoalTargetSet({
              goalLabel: targetNode.label,
              value: params.value,
              ...(newConstraint.unit !== undefined ? { unit: newConstraint.unit } : {}),
            })
        : isCorrection
          // A correction destroyed a row on another node. "Added constraint"
          // would be true of the destination and silent about the deletion.
          ? formatConstraintMoved({
              fromLabel:
                graph.nodes.find((n) => n.id === correctsId)?.label ?? 'the previous target',
              toLabel: targetNode.label,
              label: constraintLabel,
            })
          : narratesUnchanged
            ? labelChanged
              ? formatConstraintLabelUpdated(formatInput)
              : formatConstraintUnchanged(formatInput)
            : existing !== undefined
              ? formatConstraintUpdated(formatInput)
              : formatConstraintAdded(formatInput);

      // ⭐⭐ THE RECEIPT MUST NOT CLAIM AN ENFORCEMENT THAT WILL NOT HAPPEN.
      //
      // Measured on staging 14 Sep 2026 (debug export `44e349fa`): this handler
      // said "Added constraint: …" for a `<= 7%` bound on a `risk` node that
      // records no value anywhere. PLoT logged
      // `plot.constraint_no_observed_value` and `constraint_analysis_absent` for
      // all four options; the user learned this TWO TURNS LATER, on the rerun.
      // The disclosure was correct and correctly worded — it was simply two
      // turns too late, so the same words are now available at the write.
      //
      // ⚠ READ THE **RAW** NODE, NOT THE PARSED ONE, AND IT IS NOT A DETAIL.
      // `NodeV3` is a plain `z.object`, so it STRIPS undeclared keys — and the
      // V1 quantity carrier `data` is undeclared (measured at
      // `schemas/cee-v3.ts` 14 Sep 2026: 8 of the 9 fields in
      // `NODE_QUANTITY_FIELDS` are declared, `data` is not). Classifying the
      // parsed node would therefore read a `data`-only node as carrying nothing
      // and tell a user their perfectly good limit will be ignored — the one
      // error this disclosure must never make. The raw node is also the exact
      // input class the run_analysis-time collector consumes
      // (`snapshot.rawPersistedGraph`), so the two moments classify the same
      // bytes.
      //
      // ⚠ AND IF THE RAW NODE CANNOT BE FOUND, SAY NOTHING. A sweep that could
      // not look returns the same clean answer as one that looked and found
      // nothing (CLAUDE.md standing brief). Silence is today's behaviour;
      // speaking on an unread node would be a claim we have not established.
      const rawTargetNode = ((): Record<string, unknown> | null => {
        const nodes = (rawGraph as { nodes?: unknown } | null)?.nodes;
        if (!Array.isArray(nodes)) return null;
        for (const n of nodes) {
          if (n !== null && typeof n === 'object' && (n as Record<string, unknown>).id === targetId) {
            return n as Record<string, unknown>;
          }
        }
        return null;
      })();
      const admissibility =
        rawTargetNode === null ? null : classifyConstraintWriteAdmissibility(rawTargetNode);

      // The time span the row has no field for. Read off the label that will be
      // PERSISTED, because that is the only place it survives.
      const unevaluatedDurationSpan = findUnevaluatedDurationSpan({
        label: newConstraint.label,
        value: params.value,
        unit: newConstraint.unit,
      });

      // ROADMAP 2.877 (link 2) — the mint is user-visible in the same receipt:
      // the user stated two facts (a bound and a level) and is owed
      // confirmation of both; and on an otherwise-unchanged restatement the
      // note is what keeps the text channel honest about the turn not being a
      // no-op (see `turnIsNoop` above).
      // ROADMAP 2.918 — the elicitation is the mint receipt's interrogative
      // dual, on the same cell and the same channel: mint fired → note the
      // level; mint impossible for want of a statement → ask for one.
      //
      // ⚠ THE NOT-CHECKABLE DISCLOSURE IS THE LAST ARM OF THE SAME CHAIN, AND
      // THAT ORDERING IS DELIBERATE, NOT INCIDENTAL:
      //   · `mintedBaseline` — this very turn stamps `observed_state` on the
      //     target, so the limit IS checkable from here on. Disclosing
      //     otherwise would be false the moment it was written.
      //   · `elicitBaseline` — the elicitation already names the missing thing
      //     and asks for it ("the analysis also needs to know where X stands
      //     today"). It is ADDITIVE (the constraint receipt precedes it and the
      //     row is already in the committed write). Stacking a second repair ask
      //     on the same cell is noise, and two asks in one receipt invite the
      //     user to answer neither.
      //   · otherwise, and only then, the disclosure speaks.
      // ⭐ Hoisted so the OUTCOME can offer the move, not just describe it.
      // The sentence alone was the honest-dead-end pattern: it names the node
      // that could carry the limit and leaves the user to retype the whole
      // thing, which is what put the limit on the wrong node in the first
      // place. `null` ⇒ nothing was offered ⇒ no pending (fail closed).
      let alternativeForCorrection: ReturnType<typeof findConstraintTargetAlternative> = null;
      const fragments: string[] = [constraintText];
      if (unevaluatedDurationSpan !== null) {
        fragments.push(
          formatConstraintDurationNotEvaluated({ span: unevaluatedDurationSpan }),
        );
      }
      if (mintedBaseline) {
        fragments.push(
          formatBaselineNoted({
            targetLabel: targetNode.label,
            value: statedBaselinePercent!,
            unit: '%',
          }),
        );
      } else if (elicitBaseline) {
        fragments.push(formatBaselineElicitation({ targetLabel: targetNode.label }));
      } else if (admissibility !== null && !admissibility.checkable) {
        // ⭐ NAME THE CAUSE, NOT ONLY THE SYMPTOM.
        //
        // `formatConstraintNotCheckable` says "X has no number recorded
        // against it" — true, and where it stops the user is left holding a
        // correct sentence and no move. Measured on Paul's 16 Sep session
        // `1dd2133d`: his £200,000 landed on "Budget Overrun Risk" (kind risk,
        // observed_state null) while "Hiring and Onboarding Cost" sat in the
        // same graph, and he was told only that the risk had no number. The
        // honest disclosure was already in place and he was still stuck.
        //
        // When exactly one factor in the graph already records the
        // constraint's own unit, name it and offer the move. Nothing is
        // re-targeted: the user chose a node, and moving their limit under
        // them on a unit match would be the confident wrongness the
        // admissibility check exists to prevent.
        alternativeForCorrection = findConstraintTargetAlternative({
          chosenIsCheckable: false,
          chosenNodeId: targetId,
          constraintUnit: newConstraint.unit ?? null,
          nodes: graph.nodes as never,
          edges: graph.edges as never,
          // ⛔⛔ OPTIONS COME FROM THE RAW SNAPSHOT, NOT THE PARSED GRAPH.
          // `GraphV3` is a plain `z.object` declaring nodes/edges/
          // goal_constraints and nothing else (schemas/cee-v3.ts:642-655), so
          // the parse at :353 STRIPS top-level options. Reading `graph.options`
          // after it always yielded undefined, which silently disabled the
          // every-option-pin anchor route: a measured non-root factor pinned by
          // every real option was withheld even though PLoT's own predicate
          // accepts it. My helper tests injected options directly and so could
          // not see the boundary — a fixture proving nothing about the producer.
          // Found by Codex on the real caller, not by my suite.
          //
          // Same-turn raw snapshot, no second graph read. Prefer the canonical
          // top-level carrier; fall back to option NODES, which is how a V3
          // graph carries them and what run_analysis projects into the wire
          // `options` it sends PLoT.
          options: readSameTurnOptions(rawGraph) as never,
        });
        fragments.push(
          alternativeForCorrection === null
            ? formatConstraintNotCheckable({ targetLabel: targetNode.label })
            : formatConstraintTargetAlternative({
                chosenLabel: targetNode.label,
                alternative: alternativeForCorrection,
              }),
        );
      }
      const assistantText = fragments.join(' ');

      return {
        assistant_text: assistantText,
        handler_facts: [factCheck.data],
        llm_calls_used: 0,
        mutated_graph: result.mutatedGraph,
        // The move the user may confirm. Fields are the builder's own, so the
        // sentence and the offer cannot describe different nodes.
        ...(alternativeForCorrection !== null && newConstraint.unit !== undefined
          ? {
              __constraint_target_correction: {
                misplaced_node_id: targetId,
                misplaced_node_label: targetNode.label,
                operator,
                value: params.value,
                unit: newConstraint.unit,
                alternative_node_id: alternativeForCorrection.nodeId,
                alternative_label: alternativeForCorrection.label,
              },
            }
          : {}),
        // The executor persists the pending question from this channel in the
        // SAME commit as the receipt that asked it (fields shared with the
        // pending-action type so the two cannot drift). `label` is the
        // PERSISTED row's label so the answer-turn replay cannot silently
        // rewrite it; `unit` is the RESOLVED unit ('%' by the mint cell's own
        // gate) so the replay does not depend on inheritance re-running.
        ...(elicitBaseline
          ? {
              __elicit_baseline: {
                target_id: targetId,
                target_label: targetNode.label,
                constraint_type: params.constraint_type,
                value: params.value,
                ...(resolvedUnit !== undefined ? { unit: resolvedUnit } : {}),
                label: newConstraint.label,
              },
            }
          : {}),
      };
    });
  };
}
