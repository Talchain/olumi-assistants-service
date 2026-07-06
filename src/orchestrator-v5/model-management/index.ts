/**
 * Model Management v1 — module entry (Layer 2, DARK).
 *
 * ZERO production call sites this slice: nothing in routes, the
 * turn-executor, or any live path imports this module (Track 3 isolation
 * discipline). The factory below exists so the later, separately-reviewed
 * wiring slice has a single seam to consume.
 *
 * Env-read pattern — call-time, not module-load (mirrors
 * session/index.ts and its documented rationale): tests can stub env
 * between cases, and importing this module never crashes on missing
 * SUPABASE_* creds; only an actual `getModelManagementService()` call on a
 * flag-on path requires them.
 */

import { createClient } from '@supabase/supabase-js';

import { ModelManagementService } from './service.js';
import { SupabaseModelVersionStore } from './store-adapter.js';

let cachedInstance: ModelManagementService | null = null;

export function getModelManagementService(): ModelManagementService {
  if (cachedInstance) return cachedInstance;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (see file header; mirrors session/index.ts ISSUE-9020 rationale)
  const url = process.env.SUPABASE_URL;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (see file header; mirrors session/index.ts ISSUE-9020 rationale)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error(
      'ModelManagement: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before calling getModelManagementService()',
    );
  }
  const client = createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  cachedInstance = new ModelManagementService({
    store: new SupabaseModelVersionStore(client),
  });
  return cachedInstance;
}

/** Test-only: reset the singleton so a subsequent call picks up fresh env. */
export function resetModelManagementServiceForTests(): void {
  cachedInstance = null;
}

export { ModelManagementService } from './service.js';
export type {
  ModelManagementServiceOptions,
  SaveVersionRequest,
  RestoreVersionRequest,
} from './service.js';
export {
  SupabaseModelVersionStore,
  ModelVersionSignInRequiredError,
  ModelVersionNotFoundError,
  ModelVersionCasConflictError,
  ModelVersionStoreError,
  MODEL_VERSION_LIST_DEFAULT_LIMIT,
} from './store-adapter.js';
export type {
  ModelVersionStorePort,
  SaveVersionWrite,
  RestoreVersionWrite,
} from './store-adapter.js';
export { compareVersionRecords, summariseGraphDiff } from './compare.js';
export { journeyRpcVersionEventSink, notifyVersionEventSink } from './version-event-sink.js';
export { CAS_CONFLICT_KIND, SIGN_IN_REQUIRED_MESSAGE } from './types.js';
export type {
  ModelVersionSummary,
  ModelVersionRecord,
  VersionWriteOutcome,
  ModelManagementResult,
  ModelManagementError,
  ModelManagementErrorCode,
  VersionCasConflict,
  VersionComparison,
  VersionDiffSummary,
  ModelVersionEvent,
  VersionEventSink,
} from './types.js';

// Strict boundary contracts (dark, prep-only — no route consumes these yet;
// the wiring slice will parse ingress / validate egress with them).
export {
  CreateVersionRequestSchema,
  RestoreVersionRequestSchema,
  ListVersionsRequestSchema,
  GetCurrentVersionRequestSchema,
  ModelVersionSummaryResponseSchema,
  ModelVersionRecordResponseSchema,
  VersionWriteOutcomeResponseSchema,
  VersionComparisonResponseSchema,
  ListVersionsResponseSchema,
  CurrentVersionResponseSchema,
  ModelManagementErrorResponseSchema,
  VersionCasConflictResponseSchema,
} from './contracts.js';
export type {
  CreateVersionRequest,
  RestoreVersionRequestContract,
  ListVersionsRequest,
  GetCurrentVersionRequest,
  ModelVersionSummaryResponse,
  ModelVersionRecordResponse,
  VersionWriteOutcomeResponse,
  VersionComparisonResponse,
  ListVersionsResponse,
  CurrentVersionResponse,
  ModelManagementErrorResponse,
  VersionCasConflictResponse,
} from './contracts.js';
