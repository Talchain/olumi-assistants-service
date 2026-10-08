/**
 * GR2 DL condition 2: a reading licence is authority for ONE outbound Run.
 * A graph, draft seed, patch value or stored copy cannot supply that authority.
 * Keep the structural identity; remove only the two wire-only identity fields.
 * Walk payload envelopes too so legacy `data` and mirrored `options` cannot
 * preserve a stamp through a permissive ingress or persistence merge.
 */
export function stripInboundReadingLicence<T>(value: T): T {
  if (Array.isArray(value)) {
    const rows = value.map(row => stripInboundReadingLicence(row));
    return (rows.some((row, index) => row !== value[index]) ? rows : value) as T;
  }
  if (value === null || typeof value !== 'object') return value;

  const record = value as Record<string, unknown>;
  let copy: Record<string, unknown> | undefined;
  for (const [key, child] of Object.entries(record)) {
    let stripped = stripInboundReadingLicence(child);
    if (key === 'nonlinear_identity' && stripped !== null && typeof stripped === 'object' && !Array.isArray(stripped)) {
      const identity = stripped as Record<string, unknown>;
      if (Object.hasOwn(identity, 'reading_licence') || Object.hasOwn(identity, 'addends')) {
        const { reading_licence: _licence, addends: _addends, ...structuralIdentity } = identity;
        stripped = structuralIdentity;
      }
    }
    if (stripped !== child) {
      copy ??= { ...record };
      copy[key] = stripped;
    }
  }
  return (copy ?? value) as T;
}
