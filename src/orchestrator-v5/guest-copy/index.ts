/**
 * Guest copy — the store seam behind `POST /assist/v1/scenarios/:scenario_id/copy` (ACCOUNTS B3, DL 380e54).
 *
 * One RPC: `copy_guest_scenario(p_source_scenario_id, p_user_id)` (DecisionGuideAI
 * `supabase/migrations/20261001222932_copy_guest_scenario_20261001.sql`). It is SECURITY DEFINER and granted to
 * service_role ONLY, so this module holds the service-role client and the route supplies the user id from a VERIFIED
 * JWT. The function never writes the guest row: it inserts a NEW row owned by the caller, carrying `graph` and `title`
 * only, idempotent per (source, user).
 *
 * The function's typed refusals map to outcomes here; anything else is a store failure and throws, so the route
 * answers 503 rather than inventing a refusal.
 */
import { createClient } from '@supabase/supabase-js';
import type { SupabaseClient } from '@supabase/supabase-js';

export type GuestCopyOutcome =
  | { readonly kind: 'copied'; readonly scenarioId: string; readonly created: boolean }
  | { readonly kind: 'refused'; readonly reason: GuestCopyRefusal };

/**
 * `not_copyable`: absent (CG404) OR owned by anyone (CG409). One reason for both, so the route cannot be used to
 * learn whether someone else's decision exists. `no_model`: a guest row with no graph yet (CG422). `too_large`: the
 * source graph is over the SQL cap (CG413). `unknown_user`: the verified `sub` is not an auth user (22023).
 */
export type GuestCopyRefusal = 'not_copyable' | 'no_model' | 'too_large' | 'unknown_user';

export interface GuestCopyStorePort {
  copyGuestScenario(sourceScenarioId: string, userId: string): Promise<GuestCopyOutcome>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const REFUSALS: Readonly<Record<string, GuestCopyRefusal>> = {
  CG404: 'not_copyable',
  CG409: 'not_copyable',
  CG422: 'no_model',
  CG413: 'too_large',
  '22023': 'unknown_user',
};

export class GuestCopyStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GuestCopyStoreError';
  }
}

export class SupabaseGuestCopyStore implements GuestCopyStorePort {
  constructor(private readonly client: Pick<SupabaseClient, 'rpc'>) {}

  async copyGuestScenario(sourceScenarioId: string, userId: string): Promise<GuestCopyOutcome> {
    const { data, error } = await this.client.rpc('copy_guest_scenario', {
      p_source_scenario_id: sourceScenarioId,
      p_user_id: userId,
    });
    if (error) {
      const reason = typeof error.code === 'string' ? REFUSALS[error.code] : undefined;
      if (reason !== undefined) return { kind: 'refused', reason };
      throw new GuestCopyStoreError(`copy_guest_scenario failed: ${error.code ?? 'no_code'}`);
    }
    const body = data as { scenario_id?: unknown; created?: unknown } | null;
    if (
      body === null || typeof body !== 'object' ||
      typeof body.scenario_id !== 'string' || !UUID_RE.test(body.scenario_id) ||
      typeof body.created !== 'boolean'
    ) {
      throw new GuestCopyStoreError('copy_guest_scenario returned an unexpected shape');
    }
    return { kind: 'copied', scenarioId: body.scenario_id, created: body.created };
  }
}

let cachedInstance: GuestCopyStorePort | null = null;

/** Lazily, per request, like `getDecisionRecordStore`: importing the route never requires SUPABASE_* env. */
export function getGuestCopyStore(): GuestCopyStorePort {
  if (cachedInstance) return cachedInstance;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (mirrors decision-records/index.ts)
  const url = process.env.SUPABASE_URL;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design (mirrors decision-records/index.ts)
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) {
    throw new Error('GuestCopy: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set before calling getGuestCopyStore()');
  }
  cachedInstance = new SupabaseGuestCopyStore(
    createClient(url, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } }),
  );
  return cachedInstance;
}
