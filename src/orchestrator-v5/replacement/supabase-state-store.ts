/**
 * Replacement conversation layer — the durable store (SERVICE-ROLE client).
 *
 * The one thing `wiring.ts` says is missing. Install it at boot with
 * `setReplacementStateStore(new SupabaseReplacementStateStore(client))`;
 * until someone does, the flag refuses the turn rather than half-working.
 *
 * Mirrors the sibling single-table adapter idiom
 * (rolling-summary/store-adapter.ts and brief-provenance/store-adapter.ts,
 * both themselves mirroring session/supabase-store.ts): constructor-injected
 * `SupabaseClient` (hand-rolled fakes in tests, no live network), a named
 * error type carrying the producer's code, and `errMsg`/`errCode` normalising
 * whatever PostgREST hands back.
 *
 * Table: `v5_replacement_state` — migration
 * supabase/migrations/20260920120000_v5_replacement_state.sql.
 * ⛔ THAT MIGRATION IS A PROPOSAL AND HAS NOT BEEN APPLIED. Until Core
 * executes it this adapter cannot work against staging, which is fine,
 * because nothing constructs it. Treat it as unwired code with a contract,
 * not as a live read path.
 *
 * ⚠ SERVICE ROLE, NEVER A USER SESSION — the same rule as the fence tables
 * and the brief-provenance RPC. The proposed migration revokes this table
 * from `anon` and `authenticated`, so a user-session client would get 42501;
 * and routing conversation state through a user's JWT would make a write
 * that has no business depending on it depend on it.
 *
 * DIRECT TABLE ACCESS RATHER THAN AN RPC, on purpose. Both sibling adapters
 * go through SECURITY DEFINER RPCs, so this is the deliberate deviation and
 * it deserves its reason: those RPCs exist for WRITE-PATH ATOMICITY across
 * several tables. This is one key and one value in one table, with no second
 * row to keep consistent with it — the same argument `supabase-store.ts`
 * makes for reading `v5_turn_fence` directly ("the RPCs exist for write-path
 * atomicity, which a single read does not need"), extended to a write that
 * is genuinely a single statement. It also keeps the proposal to Core at one
 * additive table with no function to grant, review or version.
 *
 * ────────────────────────────────────────────────────────────────────────
 * THE ONE DISTINCTION THIS FILE EXISTS TO HOLD: MALFORMED ≠ UNREACHABLE.
 * ────────────────────────────────────────────────────────────────────────
 * They are opposite failures and they get opposite treatment.
 *
 *   MALFORMED STORED DATA → EMPTY STATE, NEVER A THROW.
 *     A stored blob is data from outside this process. If it is a shape we
 *     do not recognise — an older layout, a hand-edited row, a future
 *     version — the turn starts from empty and the user gets a working
 *     conversation with no memory of the last one. That is a bad turn.
 *     Throwing instead would be the `v5_handler_facts.payload` trap: a
 *     strict parse on an unfiltered read, where one unrecognised row takes
 *     down the whole scenario on EVERY later turn. Losing one turn's memory
 *     costs a turn; the strict-parse version cost a whole scenario, which is
 *     why the decoder was written to be unthrowable and why this path uses
 *     it rather than re-deriving the shape here.
 *
 *   TRANSPORT / CONNECTION FAILURE → THROW.
 *     We did not read the row; we failed to ask. Returning EMPTY here would
 *     silently discard a conversation that is still sitting in the table —
 *     and worse, the turn would then SAVE empty state over it, so a
 *     momentary connection blip would permanently erase the proposal the
 *     next "yes, make that update now" resolves against. A failed turn the
 *     user can retry is strictly better than a destroyed one they cannot.
 *
 * An implementation that cannot tell these apart — `try { … } catch { return
 * EMPTY }` is the tempting one — reads as correct against the malformed case
 * and quietly converts every outage into data loss. The spec pins the two
 * with a discriminating pair for exactly that reason.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

import { log } from '../../utils/telemetry.js';
import {
  EMPTY_REPLACEMENT_STATE,
  decodeReplacementState,
  type ReplacementState,
  type ReplacementStateStore,
} from './turn-entry.js';

/** The table the proposed migration creates. One row per scenario. */
export const REPLACEMENT_STATE_TABLE = 'v5_replacement_state';

interface SupabaseErrorLike {
  readonly message?: string;
  readonly code?: string;
}

function errMsg(e: unknown): string {
  return (e as SupabaseErrorLike | null)?.message ?? String(e);
}

function errCode(e: unknown): string | null {
  const code = (e as SupabaseErrorLike | null)?.code;
  return typeof code === 'string' && code.trim().length > 0 ? code.trim() : null;
}

interface ReplacementStateStoreErrorOptions extends ErrorOptions {
  /**
   * Producer-attested database/PostgREST code, when the client supplied one.
   * Kept separate from the prose so a caller can make a bounded retry
   * decision without parsing a message.
   */
  readonly code?: string | null;
}

/**
 * Thrown ONLY when the store could not complete the round trip.
 *
 * Never thrown for stored data we did not recognise — that is the other
 * case, and it returns empty state. A caller seeing this error knows the
 * database was not reached or refused, not that the row was odd.
 */
export class ReplacementStateStoreError extends Error {
  readonly code: string | null;

  constructor(message: string, options?: ReplacementStateStoreErrorOptions) {
    super(message, options);
    this.name = 'ReplacementStateStoreError';
    this.code =
      typeof options?.code === 'string' && options.code.trim().length > 0
        ? options.code.trim()
        : null;
  }
}

/**
 * Pull `state` off a PostgREST row without asserting a shape we have not
 * checked.
 *
 * Widening to `unknown` first is what keeps this honest: the row comes from
 * outside the process, the client's generic row type is a claim about the
 * table and not about this particular response, and `unknown` is the only
 * type that says so. It is also why no double cast appears anywhere in this
 * file — there is nothing to force, because nothing is being asserted.
 */
function readStateColumn(row: unknown): unknown {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const record: Record<string, unknown> = { ...row };
  return record.state;
}

export class SupabaseReplacementStateStore implements ReplacementStateStore {
  constructor(private readonly client: SupabaseClient) {}

  /**
   * One indexed read on the primary key.
   *
   * No row is the NORMAL first turn of a scenario, not an error and not
   * something to log about: every conversation has one. `maybeSingle()` is
   * what expresses that — it resolves `data: null` with no error, where
   * `single()` would manufacture a PGRST116 for the most ordinary case this
   * store has.
   */
  async load(scenarioId: string): Promise<ReplacementState> {
    const { data, error } = await this.client
      .from(REPLACEMENT_STATE_TABLE)
      .select('state')
      .eq('scenario_id', scenarioId)
      .maybeSingle();

    if (error) {
      // We failed to ASK. Do not degrade to empty — see the header: the
      // turn would then save empty over a live conversation.
      throw new ReplacementStateStoreError(
        `${REPLACEMENT_STATE_TABLE} read failed for scenario ${scenarioId}: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }

    if (data === null || data === undefined) return EMPTY_REPLACEMENT_STATE;

    const stored = readStateColumn(data);

    // The decoder is documented and tested as unthrowable, and everything it
    // can receive here came out of jsonb — plain data whose property access
    // cannot raise. So this is not wrapped in a try/catch: a catch here would
    // be an untestable branch that also swallowed real programming errors if
    // the decoder were ever changed to throw. The contract is pinned by
    // turn-entry.test.ts, not by a guard that hides its violation.
    const decoded = decodeReplacementState(stored);

    if (decoded === EMPTY_REPLACEMENT_STATE && stored !== null && stored !== undefined) {
      // A row exists and we could not make sense of it. The turn proceeds
      // from empty — correct, and quiet enough that it would otherwise be
      // invisible. Say so once, without the blob: this column carries the
      // user's own words.
      log.warn(
        {
          event: 'v5.replacement_state.unrecognised_row',
          scenario_id: scenarioId,
          stored_type: Array.isArray(stored) ? 'array' : typeof stored,
        },
        'V5 replacement state — stored row was not a recognised ReplacementState; starting this turn from EMPTY rather than failing the scenario (the handler-facts trap, avoided)',
      );
    }

    return decoded;
  }

  /**
   * Upsert on the primary key. Last-writer-wins, which is safe only while
   * the turn fence serialises turns per scenario — if that stops being true
   * this needs `updated_at` as an optimistic-concurrency token instead.
   *
   * `updated_at` is written EXPLICITLY and that is load-bearing: the
   * column's `DEFAULT now()` fires on INSERT only, so an upsert that omitted
   * it would leave every scenario's timestamp frozen at row creation and
   * quietly useless for the one thing a timestamp is for.
   *
   * Client clock, not server clock, because PostgREST cannot express `now()`
   * inside an upsert body. Flagged to Core: a `BEFORE UPDATE` trigger would
   * make this server-authoritative, at the cost of a trigger to review.
   */
  async save(scenarioId: string, state: ReplacementState): Promise<void> {
    const { error } = await this.client.from(REPLACEMENT_STATE_TABLE).upsert(
      {
        scenario_id: scenarioId,
        state,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'scenario_id' },
    );

    if (error) {
      // handleReplacementTurn turns this into a ReplacementTurnFailure and
      // decides what the user may be told, because only it knows whether
      // anything was applied this turn. This layer's job is to fail loudly
      // and carry the code, not to interpret it.
      throw new ReplacementStateStoreError(
        `${REPLACEMENT_STATE_TABLE} upsert failed for scenario ${scenarioId}: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }
  }
}
