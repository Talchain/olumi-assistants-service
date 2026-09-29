import { createHash } from 'node:crypto';

/** Canonical JSON for validated, own-property data. Arrays retain significant order. */
export function canonicalJson(value: unknown): string {
  const ancestors = new WeakSet<object>();
  function encode(item: unknown): string {
    if (item === null) return 'null';
    if (typeof item === 'string' || typeof item === 'boolean') return JSON.stringify(item) as string;
    if (typeof item === 'number') {
      if (!Number.isFinite(item)) throw new Error('nonfinite_canonical_number');
      return JSON.stringify(Object.is(item, -0) ? 0 : item) as string;
    }
    if (typeof item !== 'object') throw new Error('unsupported_canonical_value');
    if (ancestors.has(item)) throw new Error('cyclic_canonical_value');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (Object.getPrototypeOf(item) !== Array.prototype) throw new Error('inherited_canonical_array');
        const keys = Object.keys(item);
        if (keys.length !== item.length) throw new Error('sparse_or_extended_canonical_array');
        const values: string[] = [];
        for (let index = 0; index < item.length; index += 1) {
          if (!Object.hasOwn(item, index)) throw new Error('sparse_canonical_array');
          const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
          if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('accessor_canonical_array');
          values.push(encode(descriptor.value));
        }
        if (Object.getOwnPropertySymbols(item).length > 0) throw new Error('symbol_canonical_array');
        return `[${values.join(',')}]`;
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new Error('inherited_canonical_object');
      if (Object.getOwnPropertySymbols(item).length > 0) throw new Error('symbol_canonical_object');
      const keys = Object.keys(item).sort();
      const fields = keys.map((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('accessor_canonical_object');
        return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
      });
      return `{${fields.join(',')}}`;
    } finally {
      ancestors.delete(item);
    }
  }
  return encode(value);
}

export function contentHash(value: unknown): string {
  return createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex');
}
