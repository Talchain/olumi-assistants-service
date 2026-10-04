import { createHash } from 'node:crypto';
import type { JsonValue, StateKeyFields } from './types.js';

/** Recursive key ordering; array order is chosen by each policy, not by this serializer. */
function canonical(value: JsonValue): string {
  if (Array.isArray(value)) return `[${value.map(v => canonical(v)).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const object = value as StateKeyFields;
    return `{${Object.keys(object).sort().filter(k => object[k] !== undefined)
      .map(k => `${JSON.stringify(k)}:${canonical(object[k]!)}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('State keys require finite JSON numbers');
  return JSON.stringify(value);
}

/** The only persistence-ready representation: no raw labels, values or edits. */
export function stateKeyHash(fields: StateKeyFields): string {
  return createHash('sha256').update(canonical(fields)).digest('hex').slice(0, 12);
}
