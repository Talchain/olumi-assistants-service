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
 */

import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import { AddConstraintHandlerFactSchema } from '@talchain/schemas/orchestrator';
import type { AddConstraintHandlerFact } from '@talchain/schemas/orchestrator';

import { GoalConstraintSchema, type GoalConstraintT } from '../../../schemas/assist.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { resolveGoalThresholdCap } from '../../../utils/goal-threshold-cap.js';
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
export const AddConstraintValueSchema = z.number();
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
const ALLOWED_TARGET_KINDS: readonly string[] = [
  'factor',
  'outcome',
  'goal',
  'risk',
];
const ALLOWED_TARGET_KIND_SET: ReadonlySet<string> = new Set(ALLOWED_TARGET_KINDS);

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
        ...(params.unit !== undefined
          ? { unit: params.unit }
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
      // acceptance-evidence/receipt-honesty/LANE-DOCTRINE.md). A success
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

      const result = applyAndValidateMutation(rawGraph, (clone) => {
        const list = clone.goal_constraints ?? [];
        const next = existing
          ? list.map((c) =>
              c.node_id === targetId && c.operator === operator ? constraintParse.data : c,
            )
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
            // Unit is ALWAYS reconciled (review hardening): keeping a stale
            // '%' unit when a unitless absolute target re-registers would
            // display "900%" — a unitless registration clears the old unit.
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
