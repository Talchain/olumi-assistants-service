/** Whole approved candidates are read back by canonical identity; server-added fields alone are allowed. */
import { normaliseGraphForIdentity } from '../../context/graph-identity.js';
type Rec = Record<string, unknown>;
const rec = (value: unknown): Rec | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Rec : undefined;

export function approvedGraphHeld(candidate: unknown, stored: unknown): boolean {
  const a = normaliseGraphForIdentity(candidate as never)?.graph;
  const b = normaliseGraphForIdentity(stored as never)?.graph;
  return a !== undefined && b !== undefined && heldUnchanged(a, b);
}

const entityKey = (x: unknown): string | undefined => {
  const k = rec(x)?.id ?? rec(x)?.constraint_id;
  return typeof k === 'string' ? k : undefined;
};
/** `a` held in `b`: the same members (by id where every member has one), each field of `a` equal in `b`; `b` may add fields only. */
function heldUnchanged(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    const keys = a.map(entityKey);
    if (keys.every((k) => k !== undefined) && new Set(keys).size === keys.length) {
      const byKey = new Map(b.map((x) => [entityKey(x), x] as const));
      return a.every((x, i) => byKey.has(keys[i]) && heldUnchanged(x, byKey.get(keys[i])));
    }
    return a.every((x, i) => heldUnchanged(x, b[i]));
  }
  if (a !== null && typeof a === 'object') {
    if (b === null || typeof b !== 'object' || Array.isArray(b)) return false;
    return Object.entries(a as Record<string, unknown>)
      .every(([k, v]) => Object.prototype.hasOwnProperty.call(b, k) && heldUnchanged(v, (b as Record<string, unknown>)[k]));
  }
  return a === b;
}
