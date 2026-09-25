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
import { classifyUnitScaleClass, UNIT_SCALE_CLASS_TOKENS } from '../../cee/draft/records/unit-scale-class.js';

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
  /**
   * Canonical authorship marker — `GoalConstraintSchema.provenance`
   * (`src/schemas/assist.ts:418`), values `explicit | inferred | proxy`.
   *
   * ⛔ THIS WAS MISSING, AND THE OMISSION HAD TEETH. `CandidateConstraint`
   * declared `provenance` and this module never read it, so the widening receipt
   * asserted "the user stated a STRICT bound" for a constraint the MODEL
   * invented, and the analysis policy then told the user "a limit you set could
   * not be attached". A model could manufacture a limit, have Olumi certify it
   * as the user's, and have Olumi restrict the user's own analysis on it.
   */
  provenance?: 'explicit' | 'inferred' | 'proxy';
  /** `GoalConstraintSchema.provenance_unit_relabelled`: the unit LABEL was rewritten, the value was not. By presence. */
  provenance_unit_relabelled?: { rule: string; pre_normalisation_value: number; pre_normalisation_unit: string };
  /** `GoalConstraintSchema.provenance_unit_normalised`: the VALUE was rescaled; `original_*` is the figure as stated. */
  provenance_unit_normalised?: { rule: string; original_value: number; original_unit: string };
}

/**
 * ⭐⭐ A LIMIT MUST REACH PLoT IN A UNIT PLoT CAN READ — or it is scored against the wrong number.
 *
 * WIRE (#69 5840961137, PLoT b09c0f2 / ISL 3c4ab84d): the drafter wrote a churn limit as `10 "percent per month"`.
 * PLoT's percent check is an EXACT token match (`isPercentUnit`: `% percent pct percentage`), so the threshold fell
 * through to the node's inferred range and was CLAMPED to 1.0 — and on a level-framed root target the engine
 * DELIVERED P=1 for every option ("churn ≤ 100%"). The same limit as `10 "%"` normalised to 0.10.
 *
 * The classifier that reads "percent per month" as a percent ALREADY EXISTS (`classifyUnitScaleClass`); admission
 * copied the unit verbatim and never asked it. Two rungs, each onto vocabulary PLoT ALREADY handles, and nothing else:
 *
 *   P · a percent HEAD (the classifier's own percent row) + an optional PERIOD tail ("per month", "p.a.") with
 *       1 ≤ |value| ≤ 100 → `"%"`, value UNCHANGED. PLoT reads `"%"` with |v| ≥ 1 as percentage points ([0,100]).
 *       The period stays in the limit's meaning ("Monthly churn"); it is not a scale.
 *   M · a currency head + `k`/`m` → the head, value × 10³ / 10⁶ by EXPONENT PARSING (`4.1 * 1e6` is 4099999.999…).
 *
 * ⛔ WHAT THIS MUST NOT DO, each pinned by a control row in `admit-constraint-unit-canonical.test.ts`:
 *   · "% change vs this year's costs" is a percent OF SOMETHING ELSE. As `"%"` PLoT's unit_percent rung would scale it
 *     with no unit check — a SILENT wrong threshold. Its tail is not a period, so it stays verbatim and PLoT refuses it.
 *   · |value| < 1: PLoT reads `"%"` below 1 as a FRACTION, so "0.5 percent per month" would become 50%. Abstain.
 *   · "percentage points" / "pp": the classifier's rowed one-way door is not decided here.
 *   · Anything unrecognised stays VERBATIM: PLoT then fails closed on it. CEE never guesses a scale.
 */
const PERCENT_HEADS: readonly string[] = [...(UNIT_SCALE_CLASS_TOKENS.find(([cls]) => cls === 'percent')?.[1] ?? [])]
  .sort((a, b) => b.length - a.length);
const PERIOD_TAIL = /^(?:(?:per|a|an|each|\/)\s*(?:month|year|annum|quarter|week|day)|monthly|annually|annual|yearly|quarterly|weekly|daily|p\.?a\.?)?$/;
const MAGNITUDE_UNIT = /^(£|gbp|\$|usd|€|eur)\s*(k|m)$/;

type UnitCanonical = Pick<AdmittedConstraint, 'value' | 'unit' | 'provenance_unit_relabelled' | 'provenance_unit_normalised'>;

export function canonicaliseLimitUnit(value: number, unit: string | undefined): UnitCanonical {
  if (unit === undefined) return { value };
  const t = unit.trim().toLowerCase();

  if (unit !== '%' && classifyUnitScaleClass(unit) === 'percent' && Math.abs(value) >= 1 && Math.abs(value) <= 100) {
    const head = PERCENT_HEADS.find((h) => t.startsWith(h));
    if (head !== undefined && PERIOD_TAIL.test(t.slice(head.length).trim())) {
      return {
        value,
        unit: '%',
        provenance_unit_relabelled: { rule: 'agent_lane_limit_unit_v1', pre_normalisation_value: value, pre_normalisation_unit: unit },
      };
    }
  }

  const m = MAGNITUDE_UNIT.exec(t);
  if (m !== null) {
    const scaled = Number(`${value}e${m[2] === 'k' ? 3 : 6}`);
    if (Number.isFinite(scaled)) {
      const trimmed = unit.trim();
      return {
        value: scaled,
        unit: trimmed.slice(0, m[1].length),
        provenance_unit_normalised: { rule: 'agent_lane_limit_magnitude_v1', original_value: value, original_unit: unit },
      };
    }
  }

  return { value, unit };
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

/** Only a bound the user actually stated may be reported as theirs. */
function isUserAuthored(candidateProvenance: string): boolean {
  return candidateProvenance === 'explicit';
}

function canonicalProvenance(candidateProvenance: string): 'explicit' | 'inferred' {
  return isUserAuthored(candidateProvenance) ? 'explicit' : 'inferred';
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
          `${isUserAuthored(c.provenance) ? 'A limit you stated' : 'A limit this system proposed'} ` +
          'names a metric with no node in the admitted model, so it cannot be attached. Withheld ' +
          'rather than attached to a guessed target.',
        severity: 'warn',
      });
      continue;
    }

    const operator = RELAXES_TO[c.operator];
    // The user's number is never adjusted to compensate for the operator. It is rescaled ONLY by a stated magnitude
    // suffix (£k), and every rewrite is stamped (`canonicaliseLimitUnit`).
    const { value, unit, ...unitProvenance } = canonicaliseLimitUnit(c.value, c.unit);
    const admitted: AdmittedConstraint = {
      constraint_id: `agent-lane:${nodeId}:${operator}`,
      node_id: nodeId,
      operator,
      value,
      // ⛔ THE LABEL IS THE LIMIT'S NAME, NOT THE LIMIT (`GoalConstraintSchema.label`: "Human-readable label, e.g.
      // 'First-year budget cap'"). The bound lives in `operator`/`value`/`unit`, which every consumer renders itself: a
      // label carrying "< 40000GBP/year" rendered on the canvas as "Annual PA salary < 40000GBP/year ≤ 40,000 GBP/year"
      // (Canvas D2, 5832368556) and quoted the drafter's strict symbol against the stored "<=".
      label: c.metric,
      ...(unit !== undefined ? { unit } : {}),
      provenance: canonicalProvenance(c.provenance),
      ...unitProvenance,
    };

    if (isStrictnessLost(c.operator)) {
      loss.push({
        code: REPAIR_CODES.NORMALISE_STRENGTH_RANGE,
        layer: 'cee',
        field_path: `goal_constraints[${nodeId}].operator`,
        before: c.operator,
        after: operator,
        reason:
          `${isUserAuthored(c.provenance) ? 'You stated' : 'This system proposed'} a STRICT bound ` +
          `("${c.metric} ${c.operator} ${c.value}${c.unit ?? ''}") ` +
          `but the canonical vocabulary has only ">=" and "<=". The admitted constraint therefore ` +
          `treats exactly ${c.value}${c.unit ?? ''} as satisfying a bound the user excluded. ` +
          `The value is preserved verbatim — no epsilon was invented — so this widening is the ` +
          `whole of the difference, and it is decision-relevant at the boundary.`,
        severity: 'warn',
      });
    }

    constraints.push(admitted);
  }

  // ⛔ A LIMIT READ BOTH WAYS IS NOT A LIMIT (review 5831251158, saved draw cap-attach/L/B2/draw-4): "Budget is
  // £900k either way" was drafted as BOTH "at least 900000" and "at most 900000" on one node. Attached, the lower
  // half turned the user's ceiling into a floor. When a node's lower bound meets or exceeds its upper bound, both
  // are withheld together and the loss is said in words; neither side is guessed. A genuine range still attaches.
  const contradicted = new Set<string>();
  for (const lower of constraints) {
    if (lower.operator !== '>=') continue;
    const upper = constraints.find((u) => u.node_id === lower.node_id && u.operator === '<=' && lower.value >= u.value);
    if (upper === undefined || contradicted.has(lower.node_id)) continue;
    contradicted.add(lower.node_id);
    const metric = candidates.find((c) => nodeIdFor(c.metric) === lower.node_id)?.metric ?? lower.node_id;
    const authored = lower.provenance === 'explicit' || upper.provenance === 'explicit';
    loss.push({
      code: REPAIR_CODES.RESOLVE_BELIEF_PRECEDENCE,
      layer: 'cee',
      field_path: `goal_constraints[${lower.node_id}].bound_direction`,
      before: `${metric}: at least ${lower.value}${lower.unit ?? ''} and at most ${upper.value}${upper.unit ?? ''}`,
      after: null,
      reason:
        `${authored ? 'Your limit' : 'The limit Olumi proposed'} on "${metric}" was drafted both as at least ` +
        `${lower.value}${lower.unit ?? ''} and as at most ${upper.value}${upper.unit ?? ''}, which would count every ` +
        `option on one side of it as breaking it. Neither was attached, so the analysis will not check this limit ` +
        `until you say which way it runs (a budget is usually at most).`,
      severity: 'warn',
    });
  }

  // ⛔ A RANGE ON ONE METRIC NEEDS TWO NAMES (review 5833797482). The label is the limit's NAME, so a floor and a cap on
  // the same node would both read "Gross margin" in the "could not be checked" card. On that collision only, the lower
  // bound is named "<metric> floor" and the upper "<metric> cap" (structural-reconciliation strips both suffixes).
  const kept = constraints.filter((c) => !contradicted.has(c.node_id));
  const directions = new Map<string, Set<CanonicalOperator>>();
  for (const c of kept) directions.set(c.node_id, (directions.get(c.node_id) ?? new Set<CanonicalOperator>()).add(c.operator));
  const named = kept.map((c) => ((directions.get(c.node_id)?.size ?? 0) > 1 && c.label !== undefined
    ? { ...c, label: `${c.label} ${c.operator === '>=' ? 'floor' : 'cap'}` }
    : c));
  return { constraints: named, loss };
}
