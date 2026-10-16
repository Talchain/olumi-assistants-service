const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

/**
 * Preserve ordered Responses output groups; provider ids are opaque, never sibling keys.
 * An orphan assistant message is replayed as role/content, with the exact original content.
 * A reasoning item without a following output in its context segment is not replayed alone.
 * This cannot restore missing reasoning or certify an opaque provider item's original response membership.
 */
export function pairProviderInput<T>(input: T): T {
  // A string (or absent) input carries no provider items to pair; it passes through untouched.
  if (!Array.isArray(input)) return input;
  return pairItems(input) as T;
}

function pairItems(input: readonly unknown[]): readonly unknown[] {
  const dropped = new Set<number>();
  const plain = new Set<number>();
  let pending: number[] = [];
  let hasReasoning = false;
  const close = () => {
    for (const index of pending) dropped.add(index);
    pending = [];
    hasReasoning = false;
  };
  for (const [index, item] of input.entries()) {
    const row = record(item);
    if (row?.role === 'user' || row?.role === 'developer' || row?.role === 'system') close();
    if (row?.type === 'reasoning') {
      pending.push(index);
      hasReasoning = true;
    } else if (row?.type === 'message' && row.role === 'assistant') {
      pending = [];
      if (typeof row.id === 'string' && !hasReasoning) plain.add(index);
    } else if (typeof row?.type === 'string' && row.type.endsWith('_call')) {
      // Parallel calls and their outputs retain their identity/order; an output does not end the reasoning chain.
      pending = [];
    }
  }
  close();
  if (dropped.size === 0 && plain.size === 0) return input;
  return input.flatMap((item, index) => dropped.has(index) ? []
    : plain.has(index) ? [{ role: 'assistant', content: record(item)!.content }] : [item]);
}
