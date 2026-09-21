/**
 * Lane CEE-D (edit-loop reliability) — relative-delta resolution for
 * `set_factor_value` proposals at the TurnExecutor dispatch seam.
 *
 * Live trace (request_id baca4f1c): user "increase it slightly by 5%" →
 * Sonnet proposed `set_factor_value` with a percent-relative value
 * (`{ value: 5, unit: '%' }`, operator `increase`) against a £ factor →
 * the validator's unit_mismatch guard rejected it with PARAMETER_INVALID
 * parameter:"value" → recovered template. An ABSOLUTE set_factor_value
 * succeeded in the same session (turn 91a45b0a). The proposal was not
 * malformed — it was a legitimate relative expression the pipeline had no
 * way to ground.
 *
 * This module resolves the relative expression against the factor's
 * CURRENT value into an absolute `set` proposal BEFORE validateToolCall
 * runs, so the validator, the P0-A value/unit containment, and the
 * handler all see the same resolved absolute proposal (the existing
 * validator/handler parity contract is preserved — every downstream
 * guard still runs against the resolved value: cap range, finiteness,
 * unit match).
 *
 * Recognised relative shapes (conservative, unambiguous only):
 *
 *   1. STRUCTURED PERCENT — `{ value: N, unit: '%' }` (or a bare number
 *      with a parameter-level `unit: '%'`) combined with operator
 *      `increase` | `decrease`, targeting a factor whose OWN unit is NOT
 *      `%`. A percent delta against a non-percent factor can only mean
 *      "N% of the current value".
 *   2. STRING PERCENT — `value` is the string "+5%" / "-10%" / "5%". The
 *      sign gives the direction; a signless string needs an
 *      increase/decrease operator. (A signless "5%" with operator `set`
 *      means "set to 5%" — absolute, NOT relative — and is left alone.)
 *
 * NEVER-GUESS rules (proposal left untouched → today's clarify/recovery
 * path fires):
 *   - factor's own unit is '%' (percentage-point addition semantics
 *     already work today and "increase by 5%" is genuinely ambiguous
 *     between pp and relative on a % factor);
 *   - factor's current value is missing or ambiguous
 *     (resolveExistingRawValue !== 'resolved');
 *   - percent is non-finite, zero, or negative after sign extraction;
 *   - a decrease of more than 100% (nonsensical — would go negative);
 *   - operator `multiply` or `set` on the structured shape (multiply RHS
 *     is already a scalar; `set` with '%' is an absolute unit mismatch).
 */

import type { ProposalAction, ProposalParameter } from './types.js';
import type { GraphLookup } from './validator.js';
import { resolveExistingRawValue } from '../tools/handlers/d1-shared/evaluate-factor-value-proposal.js';

export type RelativeDeltaSourceShape = 'structured_percent' | 'string_percent';

export interface RelativeDeltaResolution {
  readonly resolved: true;
  /** The rewritten proposal — absolute `set` in the factor's own unit. */
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

/** Strip float dust (40000 * 1.05 → 42000.000000000004 class). */
function stripFloatDust(x: number): number {
  return Math.round(x * 1e9) / 1e9;
}

/**
 * Attempt to resolve a relative percent delta on a `set_factor_value`
 * proposal into an absolute `set` against the factor's current value.
 * Returns `{ resolved: false }` in every case where the resolution is not
 * unambiguous — the caller must then leave the proposal untouched so
 * today's clarify/recovery path fires (never guess).
 */
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

  const existing = resolveExistingRawValue({
    ...(obs.raw_value !== undefined ? { raw_value: obs.raw_value } : {}),
    ...(obs.value !== undefined ? { value: obs.value } : {}),
    ...(obs.unit !== undefined ? { unit: obs.unit } : {}),
    ...(obs.cap !== undefined ? { cap: obs.cap } : {}),
  });
  if (existing.kind !== 'resolved' || !Number.isFinite(existing.raw)) return NOT_RESOLVED;

  // provisional_doctrine_v0 — interpretation doctrine: a percent delta
  // against a NON-percent factor means "N% of the factor's current value"
  // (compounding relative change), and the user-facing receipt then states
  // the resolved ABSOLUTE change via the existing handler wording
  // ("Updated X from A to B"). Percent-on-percent is deliberately NOT
  // interpreted here (pp-addition stays the live semantics). If doctrine
  // later prefers e.g. clarify-always for relative asks, this is the
  // single site to change.
  const multiplier =
    rel.direction === 'increase' ? 1 + rel.percent / 100 : 1 - rel.percent / 100;
  const afterRaw = stripFloatDust(existing.raw * multiplier);
  if (!Number.isFinite(afterRaw)) return NOT_RESOLVED;

  const factorUnit = typeof obs.unit === 'string' && obs.unit.length > 0 ? obs.unit : undefined;

  // Rewritten value: absolute, in the factor's OWN unit when it has one
  // (inputHasUnit=true downstream, so the cap-range guard still applies
  // as `value_exceeds_cap`); a bare number for an untyped factor.
  const newValue: unknown =
    factorUnit !== undefined ? { value: afterRaw, unit: factorUnit } : afterRaw;

  const newParam: ProposalParameter = {
    name: 'value',
    value: newValue,
    operator: 'set',
    source: param.source,
    ...(factorUnit !== undefined ? { unit: factorUnit } : {}),
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
