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

export function unitPhraseFamily(unit: unknown): UnitFamily | null {
  if (typeof unit !== 'string') return null;
  const lead = unit.trim().toLowerCase().split(/[\s/]+/)[0];
  return lead === undefined || lead === '' ? null : unitFamilyOf(lead);
}

export function unitsConflict(stated: unknown, factorUnit: unknown): { stated: UnitFamily; factor: UnitFamily } | null {
  const s = unitPhraseFamily(stated);
  const f = unitPhraseFamily(factorUnit);
  return s !== null && f !== null && s !== f ? { stated: s, factor: f } : null;
}
