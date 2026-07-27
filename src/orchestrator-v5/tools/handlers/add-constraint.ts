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
import { resolveGoalThresholdCap } from '../../../utils/goal-threshold-cap.js';
import { hasReductionByFraming } from '../../../utils/reduction-framing.js';
import type { HandlerFn, HandlerInvocation, HandlerOutcome } from '../registry.js';
import { HandlerInvocationFailedError, HandlerResultInvalidError } from '../handler-errors.js';
import { applyAndValidateMutation } from './d1-shared/apply-graph-mutation.js';
import { runD1Handler } from './d1-shared/error-boundary.js';
import { D1HandlerError } from './d1-shared/errors.js';
import {
  formatConstraintAdded,
  formatConstraintLabelUpdated,
  formatConstraintUnchanged,
  formatConstraintUpdated,
  formatGoalTargetSet,
  formatGoalTargetUnchanged,
} from './d1-shared/format-confirmation.js';
import { ADD_CONSTRAINT_USER_GUIDANCE } from './d1-shared/user-guidance.js';

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
function formatUnitAmbiguityClarify(value: number): string {
  return `Did you mean ${value}% or an absolute ${value}? Tell me which, and I'll apply it.`;
}

interface ResolvedParams {
  readonly constraint_type: 'at_least' | 'at_most';
  readonly value: number;
  readonly label?: string;
  readonly unit?: string;
}

// `resolveGoalThresholdCap` (Lane CEE-W5 Mission B — goal-threshold join,
// Gate-item-8 dead-end) now lives in `../../../utils/goal-threshold-cap.js`
// as the shared cap-resolution doctrine (ROADMAP 1.18, cap-doctrine
// unification hygiene batch) — the draft-path enricher
// (cee/factor-extraction/enricher.ts) delegates to the SAME function so a
// goal target scores identically regardless of registration path. See that
// module's doc comment for the full doctrine.

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

  return {
    constraint_type: typeParse.data,
    value: valueParse.data,
    ...(label !== undefined ? { label } : {}),
    ...(unit !== undefined ? { unit } : {}),
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

      const params = resolveParams(invocation);
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

      // Default the constraint label from the target node's label so the
      // confirmation text and the persisted shape are coherent.
      const constraintLabel = params.label ?? targetNode.label;

      // Idempotency: match an existing constraint by (node_id, operator).
      // If found, update value/label/unit in place. If not, append a
      // fresh GoalConstraint with a generated id.
      const existing = graph.goal_constraints?.find(
        (c) => c.node_id === targetId && c.operator === operator,
      );

      const newConstraintBase: Omit<GoalConstraintT, 'constraint_id'> = {
        node_id: targetId,
        operator,
        value: params.value, // user units, no normalisation
        label: constraintLabel,
        provenance: 'explicit',
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
        ...(params.unit !== undefined
          ? { unit: params.unit }
          : existing?.unit !== undefined
            ? { unit: existing.unit }
            : targetNode.observed_state?.unit !== undefined
              ? { unit: targetNode.observed_state.unit }
              : {}),
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
      const isGoalTargetSet = targetNode.kind === 'goal' && operator === '>=';

      // Review hardening (2026-07-07): a success target must be a positive
      // number — the shared value schema is a plain z.number(), so without
      // this guard "-5%" would persist a negative goal_threshold that ships
      // to PLoT/ISL unbounded.
      if (isGoalTargetSet && !(params.value > 0)) {
        throw new D1HandlerError(
          'PARAMETER_INVALID',
          'A success target must be a positive number — tell me the target value again.',
          { userGuidance: ADD_CONSTRAINT_USER_GUIDANCE },
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
      const rowValueUnchanged =
        existing !== undefined &&
        existing.value === newConstraint.value &&
        existing.unit === newConstraint.unit;
      const nodeChannelUnchanged =
        isGoalTargetSet &&
        typeof targetNode.goal_threshold_raw === 'number' &&
        targetNode.goal_threshold_raw === params.value &&
        targetNode.goal_threshold_unit === newConstraint.unit;
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
      const stampGoalThreshold = isGoalTargetSet && !valueUnchanged;

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
      const declaredCap =
        (typeof targetNode.observed_state?.cap === 'number' &&
          targetNode.observed_state.cap > 0) ||
        (typeof targetNode.goal_threshold_cap === 'number' &&
          targetNode.goal_threshold_cap > 0);
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
        const next = existing
          ? list.map((c) =>
              c.node_id === targetId && c.operator === operator ? constraintParse.data : c,
            )
          : valueUnchanged
            ? list
            : [...list, constraintParse.data];
        clone.goal_constraints = next;
        if (stampGoalThreshold) {
          const goalNode = clone.nodes.find((n) => n.id === targetId);
          if (goalNode) {
            const cap = resolveGoalThresholdCap(
              goalNode.goal_threshold_cap,
              params.value,
              newConstraint.unit,
              goalNode.goal_threshold_unit,
            );
            goalNode.goal_threshold_raw = params.value; // user units (display + has_goal_target)
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
            if (cap !== null) {
              goalNode.goal_threshold_cap = cap;
              goalNode.goal_threshold = params.value / cap; // model units (0–1)
            }
          }
        }
        return {
          before: existing ? (existing as Record<string, unknown>) : null,
          after: constraintParse.data as unknown as Record<string, unknown>,
        };
      });

      const fact: AddConstraintHandlerFact = {
        fact_type: 'add_constraint',
        fact_version: 1,
        noop: valueUnchanged && !labelChanged,
        result: {
          target_id: newConstraint.constraint_id,
          status: valueUnchanged && !labelChanged ? 'noop' : 'applied',
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
      const assistantText = isGoalTargetSet
        ? valueUnchanged
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
        : valueUnchanged
          ? labelChanged
            ? formatConstraintLabelUpdated(formatInput)
            : formatConstraintUnchanged(formatInput)
          : existing !== undefined
            ? formatConstraintUpdated(formatInput)
            : formatConstraintAdded(formatInput);

      return {
        assistant_text: assistantText,
        handler_facts: [factCheck.data],
        llm_calls_used: 0,
        mutated_graph: result.mutatedGraph,
      };
    });
  };
}
