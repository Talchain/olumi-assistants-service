/** Deterministic request identity; deliberately independent of graph/projection modules. */
import { createHash } from 'node:crypto';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Deterministic JSON: object keys sorted, so equal inputs digest equally whatever their insertion order. */
function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`;
  if (isRec(v)) {
    return `{${Object.keys(v)
      .filter((k) => v[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(v[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** sha256 of the request CEE sends PLoT, `request_id` excluded (it differs on every call, the inputs need not). */
export function sentDigest(plotPayload: Rec): string {
  const { request_id: _requestId, ...inputs } = plotPayload;
  return createHash('sha256').update(stableStringify(inputs)).digest('hex');
}

