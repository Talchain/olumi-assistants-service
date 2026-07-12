/**
 * Context Architecture v2 — S4 rolling summary — Supabase store adapter
 * (service-role client). Mirrors the decision-records adapter idiom:
 * constructor-injected SupabaseClient (hand-rolled mocks in tests, no live
 * network), writes/reads exclusively via SECURITY DEFINER RPCs, typed error
 * mapping.
 *
 * RPCs: upsert_rolling_summary (MONOTONIC conditional write — the real R4
 * cross-instance guard) + get_rolling_summary (read). Migration:
 * supabase/migrations/20260712120000_v5_rolling_summary.sql — DRAFT, Paul-gated.
 * Until executed the RPCs do not exist on staging: this adapter surfaces the
 * PostgREST "function not found" error as a RollingSummaryStoreError, which the
 * fire-and-forget maintainer logs and swallows (never a turn failure).
 *
 * The summary row is a MUTABLE SINGLETON per scenario. Its safety comes NOT
 * from an idempotency key (as decision_records has) but from the RPC's WHERE
 * clause: an out-of-order/stale write whose watermark is not strictly newer
 * than the stored one is a silent no-op (applied:false, regressed:true).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { parseStoredRollingSummary } from './summary-types.js';
import type { RollingSummary } from './summary-types.js';

export class RollingSummaryStoreError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'RollingSummaryStoreError';
  }
}

export interface UpsertRollingSummaryOutcome {
  /** true = the write advanced the watermark. */
  readonly applied: boolean;
  /** true = the write was a monotonic no-op (out-of-order/stale). */
  readonly regressed: boolean;
  /** The watermark now on the row (ISO), or null. */
  readonly current_watermark: string | null;
}

export interface RollingSummaryStorePort {
  upsertSummary(scenarioId: string, summary: RollingSummary): Promise<UpsertRollingSummaryOutcome>;
  loadSummary(scenarioId: string): Promise<RollingSummary | null>;
}

interface SupabaseErrorLike {
  message?: string;
  code?: string;
}

function errMsg(e: unknown): string {
  return (e as SupabaseErrorLike | null)?.message ?? String(e);
}

export class SupabaseRollingSummaryStore implements RollingSummaryStorePort {
  constructor(private readonly client: SupabaseClient) {}

  async upsertSummary(
    scenarioId: string,
    summary: RollingSummary,
  ): Promise<UpsertRollingSummaryOutcome> {
    const { data, error } = await this.client.rpc('upsert_rolling_summary', {
      p_scenario_id: scenarioId,
      p_summary: summary,
      p_updated_turn_created_at: summary.updated_turn_created_at,
    });
    if (error) {
      throw new RollingSummaryStoreError(
        `upsert_rolling_summary RPC failed: ${errMsg(error)}`,
        { cause: error },
      );
    }
    return parseUpsertOutcome(data);
  }

  async loadSummary(scenarioId: string): Promise<RollingSummary | null> {
    const { data, error } = await this.client.rpc('get_rolling_summary', {
      p_scenario_id: scenarioId,
    });
    if (error) {
      throw new RollingSummaryStoreError(
        `get_rolling_summary RPC failed: ${errMsg(error)}`,
        { cause: error },
      );
    }
    // Unparseable stored summary reads as null — the maintainer treats it the
    // same as "no prior summary" (regen), never a throw (defence in depth).
    return parseStoredRollingSummary(data);
  }
}

function parseUpsertOutcome(data: unknown): UpsertRollingSummaryOutcome {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    throw new RollingSummaryStoreError(
      `upsert_rolling_summary returned non-object outcome: ${JSON.stringify(data)}`,
    );
  }
  const env = data as Record<string, unknown>;
  return {
    applied: env.applied === true,
    regressed: env.regressed === true,
    current_watermark:
      typeof env.current_watermark === 'string' ? env.current_watermark : null,
  };
}
