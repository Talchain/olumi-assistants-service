/**
 * V5 replay harness — Branch A staging DB read-back.
 *
 * `/orchestrate/v2/turn` does not surface the graph, a graph hash, or the
 * applied factor value on the wire (see `types.ts::TurnResponse`), so the
 * harness cannot prove from the HTTP response alone that a
 * `set_factor_value` mutation actually persisted. This module reads the
 * authoritative record back from the staging Supabase: the persisted
 * `set_factor_value` HandlerFact in `v5_handler_facts.payload.result`,
 * joined to the scenario via `v5_conversation_turns`.
 *
 * Two layers, deliberately split:
 *   - `assertSetFactorValuePersisted` is PURE — it takes already-read,
 *     normalised fact rows and applies the contract. Fully unit-tested
 *     with synthetic facts; never touches the network or a DB client.
 *   - `runSetFactorValueReadback` is the thin live wrapper: it reads the
 *     staging creds from the environment, queries Supabase, normalises
 *     the rows, and delegates to the pure assertion.
 *
 * Safety: the Supabase service-role key is NEVER logged or returned in an
 * error string — every surfaced message is run through `redactString`
 * against both the service-role key and the (optional) replay API key.
 * Staging/integration only: the live wrapper is invoked solely from the
 * `--db-readback` path; without it the Branch A DB step skips.
 *
 * No schema/migration changes (PR #236 confirms none) — the column shapes
 * read here (`v5_conversation_turns.id`, `v5_handler_facts.payload`)
 * already exist on staging.
 */

// Type-only import — erased at runtime, so importing this module never
// eagerly loads @supabase/supabase-js. The live wrapper loads it lazily.
import type { SupabaseClient } from '@supabase/supabase-js';

import type { AssertionResult } from './assertions.js';
import { redactString } from './redact.js';

/** The `result` block of a persisted `set_factor_value` HandlerFact. */
export interface SetFactorValueResult {
  readonly status?: string;
  readonly target_id?: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

/**
 * A `v5_handler_facts` row normalised for the pure assertion. The DB
 * stores the wire-shape fact inside the `payload` JSONB
 * (`{ fact_type, fact_version, result }`) with `noop` / `action_type`
 * hoisted to their own columns (see `supabase-store.ts`).
 */
export interface NormalisedHandlerFact {
  readonly action_type?: string;
  readonly noop?: boolean;
  readonly result?: SetFactorValueResult;
}

export interface DbReadbackExpectation {
  /**
   * Exact target factor id the proposal applied to. Used by unit tests
   * and any future path that can capture the proposal's target. The wire
   * chip does not expose it, so live runs use `validTargetIds` instead.
   */
  readonly targetId?: string;
  /**
   * The set of factor ids drafted in step 1. The live read-back asserts
   * the applied fact targeted one of these — the strongest target check
   * available when the exact proposal target is not wire-visible.
   */
  readonly validTargetIds?: readonly string[];
  /**
   * The proposed user-scale value parsed from the "Test X at N" chip.
   * Asserted against the persisted `after` value (matching any of
   * `after.value` / `after.raw_value` / `after.display_value`, or a bare
   * numeric `after`).
   */
  readonly displayValue?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Numeric candidates the persisted `after` may carry for the value check. */
function afterValueCandidates(after: unknown): number[] {
  if (typeof after === 'number') return [after];
  if (!isPlainObject(after)) return [];
  const out: number[] = [];
  for (const key of ['value', 'raw_value', 'display_value']) {
    const v = after[key];
    if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/**
 * Pure Branch A DB read-back contract. Given the scenario's
 * `set_factor_value` facts (newest-first), assert the proposal applied:
 *   - an `applied`, non-noop `set_factor_value` fact exists;
 *   - it targeted the expected factor (exact id, or membership in the
 *     drafted factor ids);
 *   - `before` and `after` differ (the value genuinely changed);
 *   - when a proposed value is supplied, the persisted `after` matches it.
 */
export function assertSetFactorValuePersisted(
  facts: readonly NormalisedHandlerFact[],
  expected?: DbReadbackExpectation,
): AssertionResult {
  const applied = facts.find(
    (f) =>
      (f.action_type === undefined || f.action_type === 'set_factor_value') &&
      f.noop !== true &&
      f.result?.status === 'applied',
  );
  if (applied === undefined) {
    const summary = facts
      .map((f) => `${f.action_type ?? '?'}:${f.result?.status ?? '?'}${f.noop ? ':noop' : ''}`)
      .join(', ');
    return {
      ok: false,
      failing_contract: 'db_readback_no_applied_set_factor_value_fact',
      evidence: `no applied set_factor_value fact for scenario (facts=[${summary}])`,
    };
  }
  const result = applied.result!;
  const targetId = result.target_id;

  // Target check — exact id when supplied, else membership in drafted ids.
  if (expected?.targetId !== undefined) {
    if (targetId !== expected.targetId) {
      return {
        ok: false,
        failing_contract: 'db_readback_target_id_mismatch',
        evidence: `applied fact target_id=${String(targetId)} expected=${expected.targetId}`,
      };
    }
  } else if (expected?.validTargetIds && expected.validTargetIds.length > 0) {
    if (typeof targetId !== 'string' || !expected.validTargetIds.includes(targetId)) {
      return {
        ok: false,
        failing_contract: 'db_readback_target_not_a_known_factor',
        evidence:
          `applied fact target_id=${String(targetId)} is not one of the drafted ` +
          `factor ids [${expected.validTargetIds.join(', ')}]`,
      };
    }
  }

  // Value-changed check — before and after must both exist and differ.
  if (result.before === undefined || result.after === undefined) {
    return {
      ok: false,
      failing_contract: 'db_readback_missing_before_after',
      evidence: `applied fact missing before/after (before=${result.before === undefined ? 'absent' : 'present'} after=${result.after === undefined ? 'absent' : 'present'})`,
    };
  }
  if (JSON.stringify(result.before) === JSON.stringify(result.after)) {
    return {
      ok: false,
      failing_contract: 'db_readback_value_unchanged',
      evidence: `applied fact before === after (value did not change): ${JSON.stringify(result.after)}`,
    };
  }

  // Proposed-value check — only when a value was captured.
  let matchedValue: number | undefined;
  if (expected?.displayValue !== undefined) {
    const candidates = afterValueCandidates(result.after);
    matchedValue = candidates.find((c) => c === expected.displayValue);
    if (matchedValue === undefined) {
      return {
        ok: false,
        failing_contract: 'db_readback_after_value_mismatch',
        evidence:
          `persisted after value(s) [${candidates.join(', ') || 'none'}] do not include the ` +
          `proposed value ${expected.displayValue}; after=${JSON.stringify(result.after)}`,
      };
    }
  }

  return {
    ok: true,
    evidence:
      `set_factor_value applied: target_id=${String(targetId)} ` +
      `before=${JSON.stringify(result.before)} after=${JSON.stringify(result.after)}` +
      (matchedValue !== undefined ? ` matched_value=${matchedValue}` : ''),
  };
}

/**
 * Live staging read-back. Reads `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`
 * from the environment (see `.env.staging.local`), queries the scenario's
 * `set_factor_value` facts, and delegates to `assertSetFactorValuePersisted`.
 *
 * Returns an `AssertionResult` — failures (missing creds, query error,
 * contract miss) are reported as `{ ok: false }` so the harness records a
 * normal failing row rather than throwing. The service-role key is never
 * surfaced in any returned string.
 */
export async function runSetFactorValueReadback(
  scenarioId: string,
  expected: DbReadbackExpectation,
  opts?: { readonly secret?: string },
): Promise<AssertionResult> {
  const url = (process.env.SUPABASE_URL ?? '').trim();
  const serviceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
  // Redact both the service-role key and the replay API key from any
  // surfaced message (defence-in-depth — supabase-js errors rarely echo
  // the key, but never assume).
  const scrub = (s: string): string =>
    redactString(redactString(s, serviceRoleKey), opts?.secret);

  if (url.length === 0 || serviceRoleKey.length === 0) {
    return {
      ok: false,
      failing_contract: 'db_readback_missing_credentials',
      evidence:
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for --db-readback ' +
        '(see .env.staging.local). Neither value is echoed.',
    };
  }

  let client: SupabaseClient;
  try {
    const { createClient } = await import('@supabase/supabase-js');
    client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch (err) {
    return {
      ok: false,
      failing_contract: 'db_readback_client_init_failed',
      evidence: scrub(err instanceof Error ? err.message : String(err)),
    };
  }

  try {
    const turns = await client
      .from('v5_conversation_turns')
      .select('id')
      .eq('scenario_id', scenarioId);
    if (turns.error) {
      return {
        ok: false,
        failing_contract: 'db_readback_turns_query_failed',
        evidence: scrub(turns.error.message),
      };
    }
    const turnIds = (turns.data ?? [])
      .map((r) => (r as { id?: unknown }).id)
      .filter((id): id is string => typeof id === 'string');
    if (turnIds.length === 0) {
      return {
        ok: false,
        failing_contract: 'db_readback_no_turns_for_scenario',
        evidence: `no v5_conversation_turns rows for scenario ${scenarioId}`,
      };
    }

    const facts = await client
      .from('v5_handler_facts')
      .select('payload, action_type, noop, created_at')
      .in('v5_conversation_turn_id', turnIds)
      .eq('action_type', 'set_factor_value')
      .order('created_at', { ascending: false });
    if (facts.error) {
      return {
        ok: false,
        failing_contract: 'db_readback_facts_query_failed',
        evidence: scrub(facts.error.message),
      };
    }

    const normalised: NormalisedHandlerFact[] = (facts.data ?? []).map((row) => {
      const r = row as { payload?: unknown; action_type?: unknown; noop?: unknown };
      const payload = isPlainObject(r.payload) ? r.payload : {};
      const resultBlock = isPlainObject(payload.result)
        ? (payload.result as SetFactorValueResult)
        : undefined;
      return {
        action_type: typeof r.action_type === 'string' ? r.action_type : undefined,
        noop: typeof r.noop === 'boolean' ? r.noop : undefined,
        result: resultBlock,
      };
    });

    return assertSetFactorValuePersisted(normalised, expected);
  } catch (err) {
    return {
      ok: false,
      failing_contract: 'db_readback_query_exception',
      evidence: scrub(err instanceof Error ? err.message : String(err)),
    };
  }
}
