import { GraphStaleWriteError } from './session/store.js';

type RevisionDetails = { readonly expected?: number; readonly current?: number };
type RevisionConflict = RevisionDetails & { readonly conflict_category: string };

export function isRevisionConflict(error: unknown): error is GraphStaleWriteError {
  return error instanceof GraphStaleWriteError && error.conflict_category === 'revision_conflict';
}

/** In-process adapters must not flatten the database's known revision refusal. */
export function rethrowRevisionConflict(conflict: RevisionConflict): void {
  if (conflict.conflict_category !== 'revision_conflict') return;
  throw new GraphStaleWriteError('The model changed while this edit was being saved; refresh and reconfirm.', {
    conflict_category: 'revision_conflict',
    cause: { details: JSON.stringify({ reason: 'revision_conflict', expected: conflict.expected, current: conflict.current }) },
  });
}

/** Preserve a revision refusal returned by the Agent's internal HTTP dispatch. */
export function promoteRevisionConflictResponse<T extends { status: number; json: Record<string, unknown> }>(response: T): T {
  if (response.status !== 409) return response;
  const details = response.json.details;
  const row = details !== null && typeof details === 'object' && !Array.isArray(details)
    ? details as Record<string, unknown> : {};
  if (response.json.code !== 'revision_conflict' && row.code !== 'revision_conflict') return response;
  const expected = response.json.expected ?? row.expected;
  const current = response.json.current ?? row.current;
  rethrowRevisionConflict({ conflict_category: 'revision_conflict',
    ...(isRevision(expected) && isRevision(current) ? { expected, current } : {}) });
  return response;
}

const isRevision = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

/** Read measured revision details preserved by the RPC or an in-process refusal. */
export function readRevisionConflictDetails(error: GraphStaleWriteError): RevisionDetails {
  if (error.conflict_category !== 'revision_conflict') return {};
  const cause = typeof error === 'object' && error !== null && 'cause' in error
    ? error.cause : undefined;
  if (cause === null || typeof cause !== 'object') return {};
  let detail: unknown = (cause as { details?: unknown }).details;
  if (typeof detail === 'string') {
    try { detail = JSON.parse(detail); } catch { return {}; }
  }
  if (detail === null || typeof detail !== 'object' || Array.isArray(detail)) return {};
  const row = detail as { reason?: unknown; expected?: unknown; current?: unknown };
  if (row.reason !== 'revision_conflict' || !isRevision(row.expected) || !isRevision(row.current)) return {};
  return { expected: row.expected, current: row.current };
}

/** Add the revision-specific wire code at the existing 409 mapping boundary. */
export function withRevisionConflictWire<T extends { details?: Record<string, unknown> }>(
  body: T,
  conflict: RevisionConflict,
): T | (Omit<T, 'code'> & { code: 'revision_conflict'; expected?: number; current?: number }) {
  if (conflict.conflict_category !== 'revision_conflict') return body;
  const revisions = isRevision(conflict.expected) && isRevision(conflict.current)
    ? { expected: conflict.expected, current: conflict.current }
    : {};
  return {
    ...body,
    code: 'revision_conflict',
    ...revisions,
    details: { ...body.details, code: 'revision_conflict', ...revisions },
  };
}
