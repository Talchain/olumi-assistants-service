/**
 * Model Management v1 — user-facing copy states (Layer 2, DARK; prep-only).
 *
 * CEE-side product copy for the model-management surfaces (current-version
 * indicator, version history/list, restore, compare). NOTHING here is wired to
 * a route or the UI this slice — it is the single place the copy lives so the
 * later wiring slice (and the DGAI UI, a SEPARATE repo/track) consume one
 * source, not scattered string literals.
 *
 * ⚠ GUEST COPY IS PROVISIONAL (D3 posture, not yet final). This carries the
 * Branch-A interim wording ("sign in to save versions"). If the login/demo
 * tripwire forces an Option-C non-durable preview, the sign-in copy flips to
 * "preview only — not saved". The SCHEMAS and error codes stay the same; only
 * this user-facing wording changes. copy.test.ts pins the Branch-A strings so
 * that flip is a deliberate, reviewed edit — never an accident.
 */
import type { ModelManagementErrorCode } from './types.js';

export interface CopyBlock {
  readonly headline: string;
  readonly body: string;
}

export const MODEL_MANAGEMENT_COPY = {
  /** Empty state — the scenario has no saved versions yet (getCurrentVersion
   *  → null / listVersions → []). Not an error. */
  empty: {
    headline: 'No saved versions yet',
    body: 'Save a version to capture the current model. You can restore any saved version later.',
  },

  /** Loading state — a version read/write is in flight. */
  loading: {
    headline: 'Loading versions…',
    body: 'Fetching your saved versions.',
  },

  /** CAS conflict — a version write was rejected because the model changed
   *  since the expected state was read (VersionCasConflict). Recoverable by
   *  re-reading and retrying. */
  conflict: {
    headline: 'The model changed',
    body: 'This model was updated since you last loaded it. Refresh to see the latest, then try again.',
  },

  /** Guest refusal (D3 Branch A). PROVISIONAL — see file header. */
  signInRequired: {
    headline: 'Sign in to save versions',
    body: 'Version history is available when you are signed in. Sign in to save and restore versions of your model.',
  },

  /** Generic fallback for an unexpected failure (store_error and anything the
   *  UI does not special-case). */
  errorGeneric: {
    headline: 'Something went wrong',
    body: 'We could not complete that just now. Please try again.',
  },
} as const satisfies Record<string, CopyBlock>;

/**
 * Per-error-code copy. Keyed by the exact ModelManagementErrorCode union, so a
 * new error code fails to compile until copy is provided (completeness is
 * enforced at the type level and re-asserted at runtime in copy.test.ts).
 */
export const MODEL_MANAGEMENT_ERROR_COPY: Record<ModelManagementErrorCode, CopyBlock> = {
  sign_in_required: MODEL_MANAGEMENT_COPY.signInRequired,
  version_not_found: {
    headline: 'Version not found',
    body: 'That version is no longer available. It may have been removed.',
  },
  empty_graph: {
    headline: 'Nothing to save',
    body: 'There is no model content to version yet. Add to your model, then save a version.',
  },
  store_error: MODEL_MANAGEMENT_COPY.errorGeneric,
};
