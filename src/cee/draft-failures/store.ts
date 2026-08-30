import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config, isProduction } from '../../config/index.js';
import { log } from '../../utils/telemetry.js';

type DraftFailureRow = {
  id: string;
  request_id: string;
  correlation_id: string | null;
  created_at: string;

  brief_hash: string;
  brief_preview: string | null;
  brief: string | null;

  raw_llm_output: unknown | null;
  raw_llm_text: string | null;

  validation_error: string;
  status_code: number | null;
  missing_kinds: string[] | null;
  node_kinds_raw_json: string[] | null;
  node_kinds_post_normalisation: string[] | null;
  node_kinds_pre_validation: string[] | null;

  prompt_version: string | null;
  prompt_hash: string | null;
  model: string | null;
  temperature: number | null;
  token_usage: unknown | null;
  finish_reason: string | null;

  llm_duration_ms: number | null;
  total_duration_ms: number | null;
};

/**
 * Why the READERS cannot answer "none" when they mean "I could not look"
 * (P0c, 30 Aug 2026).
 *
 * `/admin/v1/draft-failures` is the surface built to explain the draft-500 P0.
 * Both readers below used to collapse UNAVAILABILITY into an ordinary answer:
 * `listDraftFailureBundles` returned `{ failures: [], total: 0 }` and
 * `getDraftFailureBundleById` returned `null` whenever `getClient()` produced
 * nothing. Measured by execution at `f18d941` with both Supabase env vars
 * empty, the route then answered:
 *
 *     GET /admin/v1/draft-failures        → 200 {"failures":[],"total":0}
 *     GET /admin/v1/draft-failures/<uuid> → 404 {"error":"not_found",...}
 *
 * Clean, well-formed, and entirely wrong: an instrument that never reached the
 * table reporting that the table is empty. That is the estate's most expensive
 * defect class — an absence claim from a probe with no positive control —
 * arriving through a null client rather than through a bad grep, and it is
 * exactly the shape a triage lane inherits without suspicion.
 *
 * A PostgREST error had the mirror-image problem: rethrown as a bare `Error`
 * into a route with no catch, it produced an opaque HTTP 500 naming neither
 * the store nor the cause. (The deployed symptom. The table is created by
 * `migrations/003_create_cee_draft_failures.sql` — a legacy hand-run estate
 * SEPARATE from `supabase/migrations/`, so its application to any given
 * database is not implied by a deploy.)
 *
 * These are two different failures and they get two different `reason`s
 * (platform trap 21 — two questions must not share one silence). Neither is a
 * result, so neither may be rendered as one.
 *
 * ⚠ THE WRITE PATH IS DELIBERATELY UNCHANGED. `persistDraftFailureBundle` and
 * `cleanupOldDraftFailureBundles` still degrade quietly on an absent client:
 * they run on the failure path of a real user's turn and on a background
 * timer, where throwing would turn a diagnostic gap into a product outage.
 * Only the two ADMIN READERS — whose entire job is to answer a question
 * truthfully — are strict.
 */
export type DraftFailureStoreUnavailableReason =
  /** No Supabase client could be built: URL or service-role key absent. */
  | 'store_not_configured'
  /** A client existed and the query failed (missing relation, permission, network). */
  | 'store_query_failed';

export class DraftFailureStoreUnavailableError extends Error {
  readonly name = 'DraftFailureStoreUnavailableError';
  constructor(
    readonly reason: DraftFailureStoreUnavailableReason,
    message?: string,
  ) {
    super(message ?? reason);
  }
}

let _client: SupabaseClient | null = null;

function getSupabaseConfig(): { url: string; serviceRoleKey: string } | null {
  const url = config.prompts?.supabaseUrl;
  const serviceRoleKey = config.prompts?.supabaseServiceRoleKey;
  if (!url || !serviceRoleKey) return null;
  return { url, serviceRoleKey };
}

function getClient(): SupabaseClient | null {
  const cfg = getSupabaseConfig();
  if (!cfg) return null;
  if (_client) return _client;
  _client = createClient(cfg.url, cfg.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return _client;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('timeout')), timeoutMs);
    }),
  ]);
}

function withTimeoutLike<T>(promise: PromiseLike<T>, timeoutMs: number): Promise<T> {
  return withTimeout(Promise.resolve(promise as any), timeoutMs);
}

export async function persistDraftFailureBundle(ctx: {
  requestId: string;
  correlationId?: string;

  briefHash: string;
  briefPreview?: string;
  brief?: string;

  rawLLMOutput?: unknown;
  rawLLMText?: string;

  validationError: string;
  statusCode?: number;
  missingKinds?: string[];

  nodeKindsRawJson: string[];
  nodeKindsPostNormalisation: string[];
  nodeKindsPreValidation: string[];

  promptVersion?: string;
  promptHash?: string;
  model?: string;
  temperature?: number;
  tokenUsage?: unknown;
  finishReason?: string;

  llmDurationMs?: number;
  totalDurationMs?: number;

  unsafeCaptureEnabled: boolean;
}): Promise<{ failureBundleId?: string }> {
  const client = getClient();
  if (!client) return {};

  const row = {
    request_id: ctx.requestId,
    correlation_id: ctx.correlationId ?? null,
    brief_hash: ctx.briefHash,
    brief_preview: ctx.unsafeCaptureEnabled ? (ctx.briefPreview ?? null) : null,
    brief: ctx.unsafeCaptureEnabled ? (ctx.brief ?? null) : null,

    raw_llm_output: ctx.unsafeCaptureEnabled ? (ctx.rawLLMOutput ?? null) : null,
    raw_llm_text: ctx.unsafeCaptureEnabled ? (ctx.rawLLMText ?? null) : null,

    validation_error: ctx.validationError,
    status_code: typeof ctx.statusCode === 'number' ? ctx.statusCode : null,
    missing_kinds: ctx.missingKinds ?? null,
    node_kinds_raw_json: ctx.nodeKindsRawJson,
    node_kinds_post_normalisation: ctx.nodeKindsPostNormalisation,
    node_kinds_pre_validation: ctx.nodeKindsPreValidation,

    prompt_version: ctx.promptVersion ?? null,
    prompt_hash: ctx.promptHash ?? null,
    model: ctx.model ?? null,
    temperature: typeof ctx.temperature === 'number' ? ctx.temperature : null,
    token_usage: ctx.tokenUsage ?? null,
    finish_reason: ctx.finishReason ?? null,

    llm_duration_ms: typeof ctx.llmDurationMs === 'number' ? ctx.llmDurationMs : null,
    total_duration_ms: typeof ctx.totalDurationMs === 'number' ? ctx.totalDurationMs : null,
  };

  try {
    const insertPromise = client
      .from('cee_draft_failures')
      .insert(row)
      .select('id')
      .single() as unknown as PromiseLike<{ data: { id: string } | null; error: { message: string } | null }>;

    const { data, error } = await withTimeoutLike(insertPromise, 250);
    if (error) {
      log.debug({ error: error.message }, 'Failed to persist draft failure bundle');
      return {};
    }
    return { failureBundleId: data?.id };
  } catch (error) {
    log.debug({ error: String(error) }, 'Failed to persist draft failure bundle (timeout/non-fatal)');
    return {};
  }
}

export async function listDraftFailureBundles(options: {
  requestId?: string;
  correlationId?: string;
  limit?: number;
  since?: string;
}): Promise<{ failures: DraftFailureRow[]; total: number }> {
  const client = getClient();
  if (!client) throw new DraftFailureStoreUnavailableError('store_not_configured');

  const limit = typeof options.limit === 'number' && Number.isFinite(options.limit)
    ? Math.min(200, Math.max(1, options.limit))
    : 20;

  let query = client
    .from('cee_draft_failures')
    .select(
      'id,request_id,correlation_id,created_at,brief_hash,brief_preview,validation_error,status_code,missing_kinds,node_kinds_raw_json,node_kinds_post_normalisation,node_kinds_pre_validation,model,prompt_version,prompt_hash,llm_duration_ms,total_duration_ms,finish_reason',
      { count: 'exact' }
    )
    .order('created_at', { ascending: false })
    .limit(limit);

  if (options.requestId) query = query.eq('request_id', options.requestId);
  if (options.correlationId) query = query.eq('correlation_id', options.correlationId);
  if (options.since) query = query.gte('created_at', options.since);

  const { data, error, count } = await query;
  if (error) {
    throw new DraftFailureStoreUnavailableError('store_query_failed', error.message);
  }

  return {
    failures: (data ?? []) as DraftFailureRow[],
    total: count ?? (data?.length ?? 0),
  };
}

export async function getDraftFailureBundleById(id: string): Promise<DraftFailureRow | null> {
  const client = getClient();
  if (!client) throw new DraftFailureStoreUnavailableError('store_not_configured');

  const { data, error } = await client
    .from('cee_draft_failures')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    // A genuine "this id is not in the table" stays `null` — the caller renders
    // it as 404, which is the TRUE answer from a store that was reachable. Only
    // a failure to READ becomes an unavailability.
    if (error.message.toLowerCase().includes('no rows')) return null;
    throw new DraftFailureStoreUnavailableError('store_query_failed', error.message);
  }

  return (data ?? null) as DraftFailureRow | null;
}

export async function cleanupOldDraftFailureBundles(): Promise<void> {
  const client = getClient();
  if (!client) return;

  const shouldRun = (() => {
    // eslint-disable-next-line no-restricted-syntax -- Feature flag, not in config schema yet
    const envVal = process.env.CEE_DRAFT_FAILURE_RETENTION_ENABLED;
    if (envVal === 'false' || envVal === '0') return false;
    if (envVal === 'true' || envVal === '1') return true;
    return isProduction();
  })();

  if (!shouldRun) return;

  const cutoffIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const deletePromise = client
      .from('cee_draft_failures')
      .delete()
      .lt('created_at', cutoffIso) as unknown as PromiseLike<{ error: { message: string } | null }>;

    const { error } = await withTimeoutLike(deletePromise, 1000);
    if (error) {
      log.debug({ error: error.message }, 'Draft failure retention cleanup failed');
    }
  } catch (error) {
    log.debug({ error: String(error) }, 'Draft failure retention cleanup failed (timeout/non-fatal)');
  }
}

let _cleanupTimer: ReturnType<typeof setTimeout> | null = null;

export function startDraftFailureRetentionJob(): void {
  if (_cleanupTimer) return;
  const client = getClient();
  if (!client) return;

  cleanupOldDraftFailureBundles().catch(err =>
    log.debug({ error: String(err) }, 'Draft failure retention cleanup failed (fire-and-forget)')
  );
  _cleanupTimer = setInterval(() => {
    cleanupOldDraftFailureBundles().catch(err =>
      log.debug({ error: String(err) }, 'Draft failure retention cleanup failed (fire-and-forget)')
    );
  }, 24 * 60 * 60 * 1000);
}
