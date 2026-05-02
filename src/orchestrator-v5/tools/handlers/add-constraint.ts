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
 * `{ value: 5, unit: '%', operator: '<=' }`, NOT 0.05. PLoT does the
 * normalisation against the factor's cap downstream.
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
import type { HandlerFn, HandlerInvocation, HandlerOutcome } from '../registry.js';
import { HandlerInvocationFailedError, HandlerResultInvalidError } from '../handler-errors.js';
import { applyAndValidateMutation } from './d1-shared/apply-graph-mutation.js';
import { runD1Handler } from './d1-shared/error-boundary.js';
import { D1HandlerError } from './d1-shared/errors.js';
import {
  formatConstraintAdded,
  formatConstraintUpdated,
} from './d1-shared/format-confirmation.js';

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

interface ResolvedParams {
  readonly constraint_type: 'at_least' | 'at_most';
  readonly value: number;
  readonly label?: string;
  readonly unit?: string;
}

function resolveParams(invocation: HandlerInvocation): ResolvedParams {
  const params = invocation.proposal?.parameters ?? [];
  const get = (name: string) => params.find((p) => p.name === name);

  const typeParam = get('constraint_type');
  if (!typeParam) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      'add_constraint requires a "constraint_type" parameter (at_least | at_most).',
    );
  }
  const typeParse = AddConstraintTypeSchema.safeParse(typeParam.value);
  if (!typeParse.success) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      'add_constraint: constraint_type must be "at_least" or "at_most".',
      { details: { received: typeParam.value } },
    );
  }

  const valueParam = get('value');
  if (!valueParam) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      'add_constraint requires a "value" parameter.',
    );
  }
  const valueParse = AddConstraintValueSchema.safeParse(valueParam.value);
  if (!valueParse.success) {
    throw new D1HandlerError(
      'PARAMETER_INVALID',
      'add_constraint: value must be a number.',
      { details: { received: valueParam.value } },
    );
  }

  const labelParam = get('label');
  let label: string | undefined;
  if (labelParam !== undefined) {
    const labelParse = AddConstraintLabelSchema.safeParse(labelParam.value);
    if (!labelParse.success) {
      throw new D1HandlerError('PARAMETER_INVALID', 'add_constraint: label must be a non-empty string.');
    }
    label = labelParse.data;
  }

  const unitParam = get('unit');
  let unit: string | undefined;
  if (unitParam !== undefined) {
    const unitParse = AddConstraintUnitSchema.safeParse(unitParam.value);
    if (!unitParse.success) {
      throw new D1HandlerError('PARAMETER_INVALID', 'add_constraint: unit must be a non-empty string.');
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
          { details: { handler_id: 'add_constraint' } },
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
          { details: { handler_id: 'add_constraint', target_id: targetId } },
        );
      }
      // Constraints attach to the constrained entity. Accepted kinds:
      //   - factor   ("budget can't exceed £50k")
      //   - outcome  ("retention must be at least 90%")
      //   - goal     (constraint on the goal threshold)
      //   - risk     ("keep churn risk below 5%")
      //
      // V5 D1 golden-path closure (A3.1 Task 5): added 'risk' here.
      // GoalConstraintSchema's `node_id` is `z.string()` — kind-agnostic,
      // and PLoT forwards constraints regardless of the constrained-node
      // kind (verified via loadScenarioSnapshotForRunAnalysis →
      // run-analysis.ts:273 plotPayload.goal_constraints; the snapshot
      // reader does no kind filtering). Risk-node constraints are a
      // common user phrasing the prior allowlist rejected as
      // ENTITY_KIND_MISMATCH.
      //
      // decision/option/action stay rejected — those aren't valid
      // constrained entities (no threshold semantics).
      const ALLOWED_TARGET_KINDS = new Set(['factor', 'outcome', 'goal', 'risk']);
      if (!ALLOWED_TARGET_KINDS.has(targetNode.kind)) {
        throw new D1HandlerError(
          'ENTITY_KIND_MISMATCH',
          `Cannot add a constraint to a ${targetNode.kind}.`,
          {
            details: {
              handler_id: 'add_constraint',
              target_id: targetId,
              actual_kind: targetNode.kind,
              accepted_kinds: ['factor', 'outcome', 'goal'],
            },
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
          },
        );
      }

      const result = applyAndValidateMutation(rawGraph, (clone) => {
        const list = clone.goal_constraints ?? [];
        const next = existing
          ? list.map((c) =>
              c.node_id === targetId && c.operator === operator ? constraintParse.data : c,
            )
          : [...list, constraintParse.data];
        clone.goal_constraints = next;
        return {
          before: existing ? (existing as Record<string, unknown>) : null,
          after: constraintParse.data as unknown as Record<string, unknown>,
        };
      });

      const valueUnchanged =
        existing !== undefined &&
        existing.value === newConstraint.value &&
        existing.unit === newConstraint.unit &&
        existing.label === newConstraint.label;

      const fact: AddConstraintHandlerFact = {
        fact_type: 'add_constraint',
        fact_version: 1,
        noop: valueUnchanged,
        result: {
          target_id: newConstraint.constraint_id,
          status: valueUnchanged ? 'noop' : 'applied',
          before: result.before as Record<string, unknown> | null,
          after: result.after as Record<string, unknown> | null,
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
      const assistantText =
        existing !== undefined
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
