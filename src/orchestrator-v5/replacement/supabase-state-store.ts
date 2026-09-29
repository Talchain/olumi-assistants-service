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
 * ⚠ That argument survived the move to compare-and-swap, and it is worth
 * saying why rather than leaving it to be re-litigated. CAS here is still
 * ONE statement — a single conditional `UPDATE ... WHERE scenario_id = $1
 * AND revision = $2`, whose atomicity is the row lock Postgres takes anyway.
 * It needs no transaction and no function, because there is no second row to
 * keep consistent with it. What it DID need was a way to see how many rows
 * the statement matched, which is why every write here carries `.select()`.
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
 *   A STALE WRITE (write path only) → THROW ReplacementStateConflictError.
 *     The database was reached and worked perfectly; it refused a write
 *     built from a snapshot that has since moved. That is a third fact
 *     about the world, not a flavour of the second, and it leads to
 *     different words for the user — "another turn got there first, say
 *     that again" rather than "the store is broken". It is typed apart for
 *     that reason, and `handleReplacementTurn` reads the type.
 *
 * An implementation that cannot tell these apart — `try { … } catch { return
 * EMPTY }` is the tempting one — reads as correct against the malformed case
 * and quietly converts every outage into data loss. The spec pins them with
 * discriminating pairs for exactly that reason.
 */

import { randomUUID } from 'node:crypto';

import type { SupabaseClient } from '@supabase/supabase-js';

import { log } from '../../utils/telemetry.js';
import {
  EMPTY_REPLACEMENT_STATE,
  ReplacementStateConflictError,
  decodeReplacementState,
  type LoadedReplacementState,
  type ReplacementState,
  type ReplacementStateRevision,
  type ReplacementStateStore,
} from './turn-entry.js';

/** The table the proposed migration creates. One row per scenario. */
export const REPLACEMENT_STATE_TABLE = 'v5_replacement_state';

/** The optimistic-concurrency token column. Opaque to everything above this
 *  file — see the header for why it is not `updated_at`. */
export const REPLACEMENT_STATE_REVISION_COLUMN = 'revision';

/** PostgreSQL unique-violation. On the INSERT arm this means a row for this
 *  scenario appeared between our read and our write, which is a conflict and
 *  not a fault. */
const UNIQUE_VIOLATION = '23505';

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
function readColumn(row: unknown, column: string): unknown {
  if (row === null || typeof row !== 'object' || Array.isArray(row)) return undefined;
  const record: Record<string, unknown> = { ...row };
  return record[column];
}

/**
 * The row's concurrency token, or `null` if it does not carry a usable one.
 *
 * `null` here is FAIL-CLOSED, not fail-open: the caller will then attempt an
 * INSERT, which the primary key refuses because the row exists, so a row
 * whose `revision` is missing or null produces a loud conflict rather than a
 * silent unconditional overwrite. That is the correct direction for a
 * half-applied migration.
 */
function readRevisionColumn(row: unknown): ReplacementStateRevision | null {
  const raw = readColumn(row, REPLACEMENT_STATE_REVISION_COLUMN);
  return typeof raw === 'string' && raw.trim().length > 0 ? raw : null;
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
  async load(scenarioId: string): Promise<LoadedReplacementState> {
    const { data, error } = await this.client
      .from(REPLACEMENT_STATE_TABLE)
      .select(`state, ${REPLACEMENT_STATE_REVISION_COLUMN}`)
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

    // No row. `revision: null` is what tells `save` to CREATE rather than
    // update, and it is the only case in which it may.
    if (data === null || data === undefined) {
      return { state: EMPTY_REPLACEMENT_STATE, revision: null };
    }

    const stored = readColumn(data, 'state');
    // Read from the SAME response as the state. A token fetched separately
    // would describe a row this read never saw.
    const revision = readRevisionColumn(data);

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

    // ⚠ The revision is returned even when the state did not decode. An
    // unrecognised row is still A ROW: the recovery write must UPDATE it
    // under its current token, not attempt an INSERT that the primary key
    // would refuse on every later turn — which would turn one bad row into a
    // permanently unwritable scenario.
    return { state: decoded, revision };
  }

  /**
   * Compare-and-swap on `revision`. NOT an upsert.
   *
   * ⛔ WHY THE UPSERT HAD TO GO. It was last-writer-wins, and its safety was
   * asserted from the existence of the turn fence rather than measured. The
   * fence does not serialise these writes — `admitCurrentTurnFence` returns
   * `Promise<void>` and never aborts, and its enforcement is scoped to
   * "ONLY writes that carry a graph". Two turns for one scenario could both
   * read, and the older snapshot could overwrite the newer one, destroying a
   * remembered fact, an open proposal or a completed receipt while BOTH
   * writes reported success. See {@link ReplacementStateStore} for the
   * contract this now implements.
   *
   * WHY A DEDICATED `revision` COLUMN AND NOT `updated_at`. `updated_at` is
   * a CLIENT CLOCK value (PostgREST cannot express `now()` in a write body),
   * and a concurrency token has exactly two requirements: it must differ
   * from its predecessor on every write, and it must not collide between
   * writers. A client timestamp guarantees neither. Two saves inside one
   * millisecond — an ordinary checkpoint-then-final pair — produce the SAME
   * ISO string, so the CAS compares equal and admits a write it should have
   * refused; and this service runs more than one instance, so clock skew can
   * make the token go BACKWARDS between writers. Both failures are silent
   * and both look exactly like success. A random uuid minted per write has
   * neither property, and it leaves `updated_at` meaning the one thing a
   * timestamp should mean. The cost is one additive column.
   *
   * `updated_at` is still written EXPLICITLY, which remains load-bearing:
   * the column's `DEFAULT now()` fires on INSERT only, so an UPDATE that
   * omitted it would freeze every scenario's timestamp at row creation.
   */
  async save(
    scenarioId: string,
    state: ReplacementState,
    expectedRevision: ReplacementStateRevision | null,
  ): Promise<ReplacementStateRevision> {
    const nextRevision = randomUUID();
    const updatedAt = new Date().toISOString();

    // `.select()` is not decoration. Without it PostgREST returns no body,
    // and a conditional UPDATE that matched NOTHING is then indistinguishable
    // from one that matched a row — which is precisely the silent success
    // this whole change exists to remove.
    const { data, error } =
      expectedRevision === null
        ? await this.client
            .from(REPLACEMENT_STATE_TABLE)
            .insert({
              scenario_id: scenarioId,
              state,
              [REPLACEMENT_STATE_REVISION_COLUMN]: nextRevision,
              updated_at: updatedAt,
            })
            .select(REPLACEMENT_STATE_REVISION_COLUMN)
        : await this.client
            .from(REPLACEMENT_STATE_TABLE)
            .update({
              state,
              [REPLACEMENT_STATE_REVISION_COLUMN]: nextRevision,
              updated_at: updatedAt,
            })
            .eq('scenario_id', scenarioId)
            .eq(REPLACEMENT_STATE_REVISION_COLUMN, expectedRevision)
            .select(REPLACEMENT_STATE_REVISION_COLUMN);

    if (error) {
      // A primary-key violation on the INSERT arm is the first-turn race: a
      // row for this scenario appeared between our read and our write. The
      // database worked; it refused a stale write. That is a CONFLICT, and
      // calling it a store fault would tell the caller the wrong thing about
      // whether a retry is sane.
      if (errCode(error) === UNIQUE_VIOLATION) {
        throw new ReplacementStateConflictError(scenarioId, expectedRevision, { cause: error });
      }
      // handleReplacementTurn turns this into a ReplacementTurnFailure and
      // decides what the user may be told, because only it knows whether
      // anything was applied this turn. This layer's job is to fail loudly
      // and carry the code, not to interpret it.
      throw new ReplacementStateStoreError(
        `${REPLACEMENT_STATE_TABLE} write failed for scenario ${scenarioId}: ${errMsg(error)}`,
        { cause: error, code: errCode(error) },
      );
    }

    // ZERO ROWS AFFECTED, NO ERROR. This is the whole point: the filter
    // matched nothing, so the row moved and the write did not happen. It
    // must NOT resolve.
    if (!Array.isArray(data) || data.length === 0) {
      throw new ReplacementStateConflictError(scenarioId, expectedRevision);
    }

    return nextRevision;
  }
}
