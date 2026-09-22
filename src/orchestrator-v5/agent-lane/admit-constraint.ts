/**
 * Agent lane — constraint admission.
 *
 * ──────────────────────────────────────────────────────────────────────────
 * ⭐⭐ THE CANONICAL VOCABULARY CANNOT SAY "UNDER".
 *
 * `GoalConstraintSchema` (`src/schemas/assist.ts:401-407`) declares
 * `operator: z.enum([">=", "<="])` — ASCII, non-strict, and that is the whole
 * vocabulary. The pricing brief says "keeping monthly churn **under** 4%", and
 * the faithful builder captured that correctly as `operator: "<", value: 4`.
 *
 * There is no `<`. So admitting this user-stated constraint changes its meaning:
 * `<= 4` **admits exactly 4.0**, which the user excluded.
 *
 * ⚠ THIS IS NOT COSMETIC, AND IT IS NOT A MACHINE'S NUMBER — it is the user's
 * own constraint being widened at its boundary. The banked Terra transcript
 * reasons at exactly that point: *"If normal churn is exactly 2%, the shock
 * reaches 4%, which does not satisfy 'under 4%'."* A model that admits 4.0
 * would call that scenario feasible; the user would not.
 *
 * ⛔ THE FORBIDDEN "FIX" is an epsilon — mapping `< 4` to `<= 3.999`. That
 * invents a threshold the user never stated and writes a fabricated figure into
 * a field the contract says holds the user's units. The value is preserved
 * verbatim; it is the OPERATOR that cannot be expressed, and the ledger is
 * where that survives.
 *
 * So: preserve the number, widen the operator, and record the widening as a
 * loss that names the admitted boundary value explicitly.
 */

import { REPAIR_CODES, type RepairEntry } from '@talchain/schemas';

export type CandidateOperator = '>=' | '<=' | '>' | '<';
export type CanonicalOperator = '>=' | '<=';

export interface CandidateConstraint {
  readonly metric: string;
  readonly operator: CandidateOperator;
  readonly value: number;
  readonly unit?: string;
  readonly provenance: string;
}

export interface AdmittedConstraint {
  constraint_id: string;
  node_id: string;
  operator: CanonicalOperator;
  value: number;
  label?: string;
  unit?: string;
}

export interface ConstraintAdmissionResult {
  readonly constraints: readonly AdmittedConstraint[];
  readonly loss: readonly RepairEntry[];
}

const RELAXES_TO: Record<CandidateOperator, CanonicalOperator> = {
  '>=': '>=',
  '<=': '<=',
  '>': '>=',
  '<': '<=',
};

/** True when the candidate operator is strict and the canonical one is not. */
export function isStrictnessLost(op: CandidateOperator): boolean {
  return op === '<' || op === '>';
}

export function admitCandidateConstraints(
  candidates: readonly CandidateConstraint[],
  nodeIdFor: (metric: string) => string | undefined,
): ConstraintAdmissionResult {
  const constraints: AdmittedConstraint[] = [];
  const loss: RepairEntry[] = [];

  for (const c of candidates) {
    const nodeId = nodeIdFor(c.metric);
    if (nodeId === undefined) {
      loss.push({
        code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
        layer: 'cee',
        field_path: `goal_constraints[${c.metric}].node_id`,
        before: c.metric,
        after: null,
        reason:
          'The constraint names a metric with no node in the admitted model, so it cannot be ' +
          'attached. Withheld rather than attached to a guessed target.',
        severity: 'warn',
      });
      continue;
    }

    const operator = RELAXES_TO[c.operator];
    const admitted: AdmittedConstraint = {
      constraint_id: `agent-lane:${nodeId}:${operator}`,
      node_id: nodeId,
      operator,
      // Verbatim. The user's number is never adjusted to compensate for the operator.
      value: c.value,
      label: `${c.metric} ${c.operator} ${c.value}${c.unit ?? ''}`,
      ...(c.unit !== undefined ? { unit: c.unit } : {}),
    };

    if (isStrictnessLost(c.operator)) {
      loss.push({
        code: REPAIR_CODES.NORMALISE_STRENGTH_RANGE,
        layer: 'cee',
        field_path: `goal_constraints[${nodeId}].operator`,
        before: c.operator,
        after: operator,
        reason:
          `The user stated a STRICT bound ("${c.metric} ${c.operator} ${c.value}${c.unit ?? ''}") ` +
          `but the canonical vocabulary has only ">=" and "<=". The admitted constraint therefore ` +
          `treats exactly ${c.value}${c.unit ?? ''} as satisfying a bound the user excluded. ` +
          `The value is preserved verbatim — no epsilon was invented — so this widening is the ` +
          `whole of the difference, and it is decision-relevant at the boundary.`,
        severity: 'warn',
      });
    }

    constraints.push(admitted);
  }

  return { constraints, loss };
}
