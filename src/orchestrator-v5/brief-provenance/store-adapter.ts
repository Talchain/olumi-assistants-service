/**
 * Brief + analysis-provenance (ROADMAP 2.1229, CEE half) — Supabase store
 * adapter (SERVICE-ROLE client).
 *
 * Mirrors the decision-records adapter idiom
 * (decision-records/store-adapter.ts, itself mirroring
 * session/supabase-store.ts): constructor-injected `SupabaseClient`
 * (hand-rolled mocks in tests, no live network), writes exclusively via a
 * SECURITY DEFINER RPC, all named args passed explicitly.
 *
 * RPC: `store_brief_and_provenance` — migration
 * supabase/migrations/20260918120000_v5_store_brief_and_provenance.sql.
 * ALREADY APPLIED AND LIVE on staging; the migration file is the repo's
 * RECORD of it, so the two agree. Live signature, read back from the
 * deployed catalogue rather than inherited from a document:
 *
 *   store_brief_and_provenance(p_scenario_id uuid, p_brief jsonb,
 *     p_graph_hash text, p_seed_used bigint, p_response_hash text)
 *     RETURNS boolean
 *
 * ⚠ SERVICE ROLE, NEVER A USER SESSION. The function is granted to
 * `service_role` only (`REVOKE … FROM PUBLIC, anon, authenticated`) —
 * verified at the live ACL: `{postgres=X/postgres,service_role=X/postgres}`.
 * A user-session client would get 42501, and routing this write through one
 * would also put a user's JWT in the path of a write that has no business
 * depending on it. The store is constructed from SUPABASE_SERVICE_ROLE_KEY
 * in index.ts and nowhere else.
 *
 * RETURN VALUE IS NOT A FORMALITY. The RPC returns `false` — it does not
 * raise — in two cases: any of the four values is NULL (its own
 * all-or-nothing guard), or no `scenarios` row matched the id. Both mean
 * NOTHING WAS WRITTEN, and reporting either as success would recreate the
 * defect this lane removes (a share button that fails while everything
 * upstream reports healthy). The caller therefore distinguishes
 * `ok` from `not_stored`.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

interface SupabaseErrorLike {
  readonly message?: string;
  readonly code?: string;
}

function errMsg(e: unknown): string {
  return (e as SupabaseErrorLike | null)?.message ?? String(e);
}

export class BriefProvenanceStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'BriefProvenanceStoreError';
  }
}

/**
 * Write payload for `store_brief_and_provenance`.
 *
 * The four fields are REQUIRED here, and that is the type system carrying
 * the all-or-nothing rule rather than a comment asking future callers to
 * remember it. `create_shared_brief` null-checks `analysis_provenance` once
 * and then dereferences `graph_hash` / `seed_used` / `response_hash` out of
 * it into three NOT NULL columns of `shared_briefs`, so a partial envelope
 * survives the null check and dies on a 23502 at SHARE time — far from the
 * turn that caused it. There is no optional member of this interface by
 * design.
 */
export interface StoreBriefAndProvenanceWrite {
  readonly scenario_id: string;
  /** PLoT's per-run decision brief, VERBATIM — lands in `scenarios.brief`
   *  (jsonb) and is copied into `shared_briefs.brief` (jsonb NOT NULL). */
  readonly brief: Record<string, unknown>;
  readonly graph_hash: string;
  /** The run seed. The column is `bigint`; JS numbers are validated as SAFE
   *  integers at the projection so a silently-rounded value can never be
   *  persisted as lineage. */
  readonly seed_used: number;
  readonly response_hash: string;
}

export interface BriefProvenanceStorePort {
  /** `true` when a scenario row was updated; `false` when the RPC wrote
   *  nothing (null input, or no such scenario). Never conflate the two with
   *  a thrown error — a throw means the call did not complete. */
  storeBriefAndProvenance(write: StoreBriefAndProvenanceWrite): Promise<boolean>;
}

export class SupabaseBriefProvenanceStore implements BriefProvenanceStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async storeBriefAndProvenance(write: StoreBriefAndProvenanceWrite): Promise<boolean> {
    // PostgREST discipline (the 20260426160532 lesson, carried through the
    // decision-records adapter): the function name is distinct (no overloads
    // exist), and ALL named args are passed anyway as defence-in-depth
    // against any future overload reintroduction.
    const { data, error } = await this.client.rpc('store_brief_and_provenance', {
      p_scenario_id: write.scenario_id,
      p_brief: write.brief,
      p_graph_hash: write.graph_hash,
      p_seed_used: write.seed_used,
      p_response_hash: write.response_hash,
    });
    if (error) {
      throw new BriefProvenanceStoreError(
        `store_brief_and_provenance RPC failed: ${errMsg(error)}`,
        { cause: error },
      );
    }
    if (typeof data !== 'boolean') {
      // The RPC is declared RETURNS boolean. Anything else means we are not
      // talking to the function we think we are — a hard error, never a
      // truthiness coercion that would report an unknown value as success.
      throw new BriefProvenanceStoreError(
        `store_brief_and_provenance returned a non-boolean (${typeof data}); refusing to interpret it`,
      );
    }
    return data;
  }
}
