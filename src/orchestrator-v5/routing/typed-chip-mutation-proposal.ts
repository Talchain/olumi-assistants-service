/**
 * S2-L3 — typed-chip mutation proposal builder.
 *
 * THE GAP THIS CLOSES: `set_factor_value`, `adjust_edge_strength` and
 * `add_constraint` are typed `ActionType` values a mutation chip can carry on
 * the wire (`@talchain/schemas` 0.22.0). When the UI resolves the edit ON the
 * canvas (target id, value, unit) it can send that pre-resolved spec in
 * `chip.parameters`. Today those parameters have ZERO readers in CEE: a typed
 * mutation chip_click reaches TurnExecutor and is re-parsed from the rendered
 * chip COPY by the deterministic value parser or by Sonnet ORIENT — the exact
 * "typed chip re-inferred from text" class S2 exists to kill.
 *
 * This PURE module reads `chip.parameters` as the pre-resolved edit spec and
 * builds the SAME `ProposalAction` a Sonnet tool-call or the deterministic
 * value parser would have produced, so TurnExecutor can synthesise a
 * zero-LLM `RoutingToolCallResult` and run the UNCHANGED validated-proposal
 * lifecycle (STEP 2 validate → referee → hold/apply → confirm → receipt). The
 * proposal LIFECYCLE is S3's existing machinery; the `chip.parameters`
 * carriage is the S2 contribution. The build wires the former into the latter.
 *
 * CEE-SIDE INGRESS CONTRACT (what a producer must send in `chip.parameters`):
 *   set_factor_value    : { target_id, value:number, unit?:string, operator? }
 *   adjust_edge_strength: { target_id:"from→to" | (from,to), value:number in
 *                           [-1,1], std?:number in (0,0.5], operator? }
 *   add_constraint      : { target_id, constraint_type:"at_least"|"at_most",
 *                           value:number, label?:string, unit?:string }
 * The schema (`@talchain/schemas`) keeps `parameters` an untyped `z.record`, so
 * THIS module is the CEE-side shape authority the UI producer (Lane U1) matches.
 * `chip.parameters` also carries producer-side keys (`chip_id`/`spark_id`); the
 * per-type object schemas STRIP unknown keys (never `.strict()`) so those pass
 * through harmlessly.
 *
 * TOTALITY + FAIL-SAFE (never routes on a guess): any missing/malformed/
 * out-of-vocabulary parameter, an absent graph, or a target that does not
 * resolve to the right kind resolves to `{ matched: false, reason }` — the
 * caller then falls through BENIGNLY to the existing text/LLM path (the
 * `#634` un-routed-intent fall-through stays green). It NEVER throws.
 *
 * NOT WIRED HERE — the run-canonical `goal_threshold` parameter. It is
 * write-only today with a server-side `goal_threshold_raw` fallback deriving
 * the same value, so carrying it would be theatre until that fallback is
 * retired (S2 §2f / R-4 positive-control rule). `goal_threshold` is a
 * run_analysis concern, not one of these three mutation intents.
 */
import { z } from 'zod';

import type { ProposalAction } from './types.js';

/**
 * The typed mutation `ActionType` values this reader routes. `add_option` is
 * deliberately absent — it is an `Intent` (not an `ActionType`) and lands as a
 * compound transaction in a later lane; wiring it here would fork that build.
 */
export const TYPED_CHIP_MUTATION_ACTION_TYPES = [
  'set_factor_value',
  'adjust_edge_strength',
  'add_constraint',
] as const;

export type TypedChipMutationActionType =
  (typeof TYPED_CHIP_MUTATION_ACTION_TYPES)[number];

const MUTATION_ACTION_TYPE_SET: ReadonlySet<string> = new Set(
  TYPED_CHIP_MUTATION_ACTION_TYPES,
);

/** True when `x` names one of the mutation intents this reader owns. */
export function isTypedChipMutationActionType(
  x: unknown,
): x is TypedChipMutationActionType {
  return typeof x === 'string' && MUTATION_ACTION_TYPE_SET.has(x);
}

/**
 * The minimal graph view the reader needs to VALIDATE a target before
 * synthesising a proposal (so it never emits a doomed one). Matches the
 * `GraphStateIngress` leaf shape TurnExecutor already holds.
 */
export interface TypedChipGraphView {
  readonly nodes: ReadonlyArray<{ readonly id: string; readonly kind: string; readonly label?: string }>;
  readonly edges: ReadonlyArray<{ readonly from: string; readonly to: string }>;
}

export type TypedChipMutationSkipReason =
  | 'not_mutation_action_type'
  | 'no_parameters'
  | 'parameters_invalid'
  | 'no_graph'
  | 'target_not_found'
  | 'target_kind_mismatch';

export type TypedChipMutationResult =
  | {
      readonly matched: true;
      readonly actionType: TypedChipMutationActionType;
      readonly proposal: ProposalAction;
    }
  | { readonly matched: false; readonly reason: TypedChipMutationSkipReason };

/** Parameter operator vocabulary — identical to `ProposalParameter.operator`. */
const OperatorSchema = z.enum(['set', 'increase', 'decrease', 'multiply']);

// Per-action_type readers of `chip.parameters`. Non-strict by design: a real
// chip bag also carries chip_id/spark_id which we ignore, never reject.
const SetFactorValueParamsSchema = z.object({
  target_id: z.string().min(1),
  value: z.number(),
  unit: z.string().min(1).optional(),
  operator: OperatorSchema.optional(),
});

const AdjustEdgeStrengthParamsSchema = z
  .object({
    target_id: z.string().min(1).optional(),
    from: z.string().min(1).optional(),
    to: z.string().min(1).optional(),
    value: z.number().min(-1).max(1),
    std: z.number().gt(0).max(0.5).optional(),
    operator: OperatorSchema.optional(),
  })
  // An edge target is identified EITHER by a composed id ("from→to") OR by an
  // explicit endpoint pair — require at least one so we never build an edge
  // proposal with no target.
  .refine(
    (d) => (d.target_id != null) || (d.from != null && d.to != null),
    { message: 'adjust_edge_strength needs target_id or both from and to' },
  );

const AddConstraintParamsSchema = z.object({
  target_id: z.string().min(1),
  constraint_type: z.enum(['at_least', 'at_most']),
  value: z.number(),
  label: z.string().min(1).optional(),
  unit: z.string().min(1).optional(),
});

/** Parse `from→to` / `from->to` into endpoints (mirrors `parseEdgeId`). */
function parseComposedEdgeId(id: string): { from: string; to: string } | null {
  const arrow = id.includes('→') ? '→' : id.includes('->') ? '->' : null;
  if (arrow === null) return null;
  const parts = id.split(arrow);
  if (parts.length !== 2) return null;
  const from = parts[0]!.trim();
  const to = parts[1]!.trim();
  if (from.length === 0 || to.length === 0) return null;
  return { from, to };
}

function findNode(
  graph: TypedChipGraphView,
  id: string,
): { id: string; kind: string; label?: string } | undefined {
  return graph.nodes.find((n) => n.id === id);
}

function edgeExists(graph: TypedChipGraphView, from: string, to: string): boolean {
  return graph.edges.some((e) => e.from === from && e.to === to);
}

function fail(reason: TypedChipMutationSkipReason): TypedChipMutationResult {
  return { matched: false, reason };
}

/**
 * Build the pre-resolved `ProposalAction` for a typed mutation chip, or a
 * classified skip. Pure + total: never throws, never mutates its inputs.
 *
 * @param actionType  the chip's typed `action_type` (already narrowed by the caller)
 * @param parameters  the chip's `parameters` bag (untyped `z.record` on the wire)
 * @param graph       the turn's graph (target validation authority); null → skip
 */
export function buildTypedChipMutationProposal(
  actionType: string,
  parameters: unknown,
  graph: TypedChipGraphView | null,
): TypedChipMutationResult {
  if (!isTypedChipMutationActionType(actionType)) {
    return fail('not_mutation_action_type');
  }
  if (parameters == null || typeof parameters !== 'object') {
    return fail('no_parameters');
  }
  if (graph === null) {
    return fail('no_graph');
  }

  switch (actionType) {
    case 'set_factor_value': {
      const parsed = SetFactorValueParamsSchema.safeParse(parameters);
      if (!parsed.success) return fail('parameters_invalid');
      const { target_id, value, unit, operator } = parsed.data;
      const node = findNode(graph, target_id);
      if (node === undefined) return fail('target_not_found');
      // set_factor_value only accepts FACTOR-kind nodes (the handler rejects
      // anything else) — pre-check so a non-factor never synthesises a proposal
      // that would die at execute.
      if (node.kind !== 'factor') return fail('target_kind_mismatch');
      const proposal: ProposalAction = {
        handler_id: 'set_factor_value',
        entity: {
          id: target_id,
          kind: 'node',
          ...(node.label != null ? { label: node.label } : {}),
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [
          {
            name: 'value',
            // Structured `{ value, unit }` only when a unit rode along, exactly
            // as the deterministic value-update synthesis shapes it.
            value: unit !== undefined ? { value, unit } : value,
            operator: operator ?? 'set',
            source: 'user_explicit',
            ...(unit !== undefined ? { unit } : {}),
          },
        ],
        cited_context_fields: ['graph.nodes'],
      };
      return { matched: true, actionType, proposal };
    }

    case 'adjust_edge_strength': {
      const parsed = AdjustEdgeStrengthParamsSchema.safeParse(parameters);
      if (!parsed.success) return fail('parameters_invalid');
      const d = parsed.data;
      // Resolve endpoints from the composed id or the explicit pair.
      const endpoints =
        d.target_id != null
          ? parseComposedEdgeId(d.target_id)
          : { from: d.from!, to: d.to! };
      if (endpoints === null) return fail('parameters_invalid');
      if (!edgeExists(graph, endpoints.from, endpoints.to)) {
        return fail('target_not_found');
      }
      // Canonical edge id the handler's `parseEdgeId` accepts.
      const edgeId = `${endpoints.from}→${endpoints.to}`;
      const proposal: ProposalAction = {
        handler_id: 'adjust_edge_strength',
        entity: {
          id: edgeId,
          kind: 'edge',
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [
          {
            name: 'strength',
            value: d.value,
            operator: d.operator ?? 'set',
            source: 'user_explicit',
          },
          ...(d.std !== undefined
            ? [
                {
                  name: 'std',
                  value: d.std,
                  source: 'user_explicit' as const,
                },
              ]
            : []),
        ],
        cited_context_fields: ['graph.edges'],
      };
      return { matched: true, actionType, proposal };
    }

    case 'add_constraint': {
      const parsed = AddConstraintParamsSchema.safeParse(parameters);
      if (!parsed.success) return fail('parameters_invalid');
      const { target_id, constraint_type, value, label, unit } = parsed.data;
      const node = findNode(graph, target_id);
      if (node === undefined) return fail('target_not_found');
      // add_constraint accepts entity kinds `node` | `goal` — a goal node maps
      // to EntityKind `goal`, any other non-option node to `node`. An option
      // (or otherwise non-accepted) target is refused fail-closed.
      const entityKind: 'goal' | 'node' | null =
        node.kind === 'goal' ? 'goal' : node.kind === 'option' ? null : 'node';
      if (entityKind === null) return fail('target_kind_mismatch');
      const proposal: ProposalAction = {
        handler_id: 'add_constraint',
        entity: {
          id: target_id,
          kind: entityKind,
          ...(node.label != null ? { label: node.label } : {}),
          resolution_status: 'resolved',
          resolution_method: 'id_match',
        },
        parameters: [
          { name: 'constraint_type', value: constraint_type, source: 'user_explicit' },
          { name: 'value', value, source: 'user_explicit', ...(unit !== undefined ? { unit } : {}) },
          ...(label !== undefined
            ? [{ name: 'label', value: label, source: 'user_explicit' as const }]
            : []),
          ...(unit !== undefined
            ? [{ name: 'unit', value: unit, source: 'user_explicit' as const }]
            : []),
        ],
        cited_context_fields: ['graph.nodes'],
      };
      return { matched: true, actionType, proposal };
    }

    default: {
      // Exhaustive over TypedChipMutationActionType.
      const _never: never = actionType;
      return _never;
    }
  }
}
