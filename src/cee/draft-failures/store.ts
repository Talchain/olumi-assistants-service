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
  if (!client) return { failures: [], total: 0 };

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
    throw new Error(error.message);
  }

  return {
    failures: (data ?? []) as DraftFailureRow[],
    total: count ?? (data?.length ?? 0),
  };
}

export async function getDraftFailureBundleById(id: string): Promise<DraftFailureRow | null> {
  const client = getClient();
  if (!client) return null;

  const { data, error } = await client
    .from('cee_draft_failures')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    if (error.message.toLowerCase().includes('no rows')) return null;
    throw new Error(error.message);
  }

  return (data ?? null) as DraftFailureRow | null;
}

export async function cleanupOldDraftFailureBundles(): Promise<void> {
  const client = getClient();
  if (!client) return;

  const shouldRun = (() => {
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

let _cleanupTimer: NodeJS.Timeout | null = null;

export function startDraftFailureRetentionJob(): void {
  if (_cleanupTimer) return;
  const client = getClient();
  if (!client) return;

  void cleanupOldDraftFailureBundles();
  _cleanupTimer = setInterval(() => {
    void cleanupOldDraftFailureBundles();
  }, 24 * 60 * 60 * 1000);
}
