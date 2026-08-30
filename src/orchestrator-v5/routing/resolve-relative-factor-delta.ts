/**
 * Preserve an unambiguous relative percentage as the existing dimensionless
 * multiply operator. Never compile it to a baseline-derived absolute set:
 * that would hide its dependency on a fallback/unknown starting quantity.
 * Validator and handler select the current canonical quantity before arithmetic.
 * Percent-on-percent retains the existing percentage-point interpretation.
 */

import type { ProposalAction, ProposalParameter } from './types.js';
import type { GraphLookup } from './validator.js';
import { relativePercentMultiplier } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

export type RelativeDeltaSourceShape = 'structured_percent' | 'string_percent';

export interface RelativeDeltaResolution {
  readonly resolved: true;
  /** The rewritten proposal retains a relative, dimensionless `multiply`. */
  readonly action: ProposalAction;
  /** Telemetry payload (system ids + closed enums only — no user values). */
  readonly telemetry: {
    readonly target_id: string;
    readonly direction: 'increase' | 'decrease';
    readonly source_shape: RelativeDeltaSourceShape;
  };
}

export type RelativeDeltaOutcome = RelativeDeltaResolution | { readonly resolved: false };

const NOT_RESOLVED: RelativeDeltaOutcome = { resolved: false };

/** "+5%", "-10%", "5%", "12.5 %" — optional sign, number, percent sign. */
const STRING_PERCENT_RE = /^\s*([+-])?\s*(\d+(?:\.\d+)?)\s*%\s*$/;

interface RelativePercentExpression {
  readonly percent: number;
  readonly direction: 'increase' | 'decrease';
  readonly sourceShape: RelativeDeltaSourceShape;
}

/**
 * Read a relative percent expression off the `value` parameter, or null
 * when the parameter is not unambiguously relative.
 */
function readRelativePercent(param: ProposalParameter): RelativePercentExpression | null {
  const operator = param.operator;
  const raw = param.value;

  // STRING shape: "+5%" / "-10%" / "5%".
  if (typeof raw === 'string') {
    const m = STRING_PERCENT_RE.exec(raw);
    if (!m) return null;
    const sign = m[1];
    const magnitude = Number.parseFloat(m[2]!);
    if (!Number.isFinite(magnitude) || magnitude <= 0) return null;
    let direction: 'increase' | 'decrease';
    if (sign === '+') direction = 'increase';
    else if (sign === '-') direction = 'decrease';
    else if (operator === 'increase' || operator === 'decrease') direction = operator;
    // Signless string without a delta operator: "set to 5%" is absolute,
    // not relative — never guess.
    else return null;
    return { percent: magnitude, direction, sourceShape: 'string_percent' };
  }

  // STRUCTURED shape: requires an explicit delta operator.
  if (operator !== 'increase' && operator !== 'decrease') return null;

  let numeric: number | undefined;
  let unit: string | undefined;
  if (typeof raw === 'number') {
    numeric = raw;
    unit = param.unit;
  } else if (raw !== null && typeof raw === 'object') {
    const obj = raw as { value?: unknown; unit?: unknown };
    if (typeof obj.value !== 'number') return null;
    numeric = obj.value;
    unit = typeof obj.unit === 'string' ? obj.unit : param.unit;
  } else {
    return null;
  }

  if (unit !== '%') return null;
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return { percent: numeric, direction: operator, sourceShape: 'structured_percent' };
}

/** Return an equivalent relative operator, or leave ambiguous input unchanged. */
export function resolveRelativeFactorDelta(
  action: ProposalAction,
  graph: GraphLookup | undefined,
): RelativeDeltaOutcome {
  if (action.handler_id !== 'set_factor_value') return NOT_RESOLVED;
  if (action.entity.kind !== 'node') return NOT_RESOLVED;
  if (!graph || typeof graph.findFactorObservedState !== 'function') return NOT_RESOLVED;

  const paramIndex = action.parameters.findIndex((p) => p.name === 'value');
  if (paramIndex === -1) return NOT_RESOLVED;
  const param = action.parameters[paramIndex]!;

  const rel = readRelativePercent(param);
  if (!rel) return NOT_RESOLVED;

  // A decrease of more than 100% would cross zero — nonsensical for a
  // relative reduction; clarify instead.
  if (rel.direction === 'decrease' && rel.percent > 100) return NOT_RESOLVED;

  const obs = graph.findFactorObservedState(action.entity.id);
  if (!obs) return NOT_RESOLVED;

  // Percent-on-percent stays on today's percentage-point semantics —
  // "increase churn by 5%" on a % factor is ambiguous (pp vs relative)
  // and the existing pipeline already applies pp addition successfully.
  if (obs.unit === '%') return NOT_RESOLVED;

  const multiplier = relativePercentMultiplier(rel.percent, rel.direction);
  if (!Number.isFinite(multiplier)) return NOT_RESOLVED;

  // The RHS has no currency/unit. The selected factor retains its own scale;
  // downstream admission still checks baseline authority, bounds and finiteness.
  const newParam: ProposalParameter = {
    name: 'value',
    value: multiplier,
    operator: 'multiply',
    source: param.source,
  };
  const parameters = action.parameters.map((p, i) => (i === paramIndex ? newParam : p));

  return {
    resolved: true,
    action: { ...action, parameters },
    telemetry: {
      target_id: action.entity.id,
      direction: rel.direction,
      source_shape: rel.sourceShape,
    },
  };
}
