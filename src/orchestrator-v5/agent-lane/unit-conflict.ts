/**
 * ⛔ A FIGURE IN ONE KIND OF UNIT IS NEVER A LEVEL FOR A FACTOR MEASURED IN ANOTHER.
 *
 * Served on CEE 08f6f90 (guest witness, scenario 6f918904): "Add an option: keep the price at £49 and run a
 * win-back offer… It reduces Monthly churn." The Agent passed the price as the churn level — `{value: 49, unit:
 * "GBP per month"}` on a factor measured in "percent per month" — the range check passed (49 ≤ 100), and after
 * one approval the model held a 49% monthly churn recorded as the user's own figure.
 *
 * The family of a unit phrase is read from its leading token with the repo's one classifier (`unitFamilyOf`):
 * "GBP per month" → currency, "percent per month" → percent, "£" → currency. Two phrases CONFLICT only when both
 * are recognised and of different families; an unrecognised unit is never a conflict (it fails open, as the
 * product's own value-unit check does for an untyped factor).
 */
import { unitFamilyOf, type UnitFamily } from '../routing/value-unit-resolution.js';

/** The leading token of a unit phrase, as written ("GBP MRR" → "GBP", "£/month" → "£"); null when there is none. */
export function unitPhraseHead(unit: unknown): string | null {
  if (typeof unit !== 'string') return null;
  const lead = unit.trim().split(/[\s/]+/)[0];
  return lead === undefined || lead === '' ? null : lead;
}

export function unitPhraseFamily(unit: unknown): UnitFamily | null {
  const lead = unitPhraseHead(unit);
  return lead === null ? null : unitFamilyOf(lead.toLowerCase());
}

export function unitsConflict(stated: unknown, factorUnit: unknown): { stated: UnitFamily; factor: UnitFamily } | null {
  const s = unitPhraseFamily(stated);
  const f = unitPhraseFamily(factorUnit);
  return s !== null && f !== null && s !== f ? { stated: s, factor: f } : null;
}

/**
 * The unit a factor is measured in: its own level's unit, else the unit of a limit the user stated on that SAME
 * node (`goal_constraints[].unit` joined by `node_id`). A factor with no level has no `observed_state` — the served
 * shape of churn (AI Quality 5843448904: DL (F) f-20260926T033508Z / f-20260926T031046Z, and every outcome-kind
 * churn #1965 converts) — and that is exactly where "£49 as churn" lands, so reading the level alone failed open
 * there. `undefined` only when neither exists; the check then fails open, as before.
 */
export function factorUnitOf(
  rawGraph: unknown,
  factor: { readonly id?: unknown; readonly observed_state?: unknown } | undefined,
): string | undefined {
  const own = (factor?.observed_state as { unit?: unknown } | undefined)?.unit;
  if (typeof own === 'string' && own.trim() !== '') return own;
  const limits = (rawGraph as { goal_constraints?: unknown } | null | undefined)?.goal_constraints;
  if (typeof factor?.id !== 'string' || !Array.isArray(limits)) return undefined;
  for (const c of limits as { node_id?: unknown; unit?: unknown }[]) {
    if (c?.node_id === factor.id && typeof c.unit === 'string' && c.unit.trim() !== '') return c.unit;
  }
  return undefined;
}
