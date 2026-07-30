/**
 * V5 TURN FENCE — the Stop tombstone + the per-scenario generation fence.
 *
 * Codex P0, brief `parallel-briefs/STOP-FENCE-BUILD-2026-07-31.md`. Closes a
 * live-reproduced data-integrity defect on the critical journey
 * (`PHASE0-EVIDENCE-2026-07-28/fix-stop-fence.md`, scenario
 * a6ccf5cf-aab0-4f01-b889-e0d6c072067c, staging CEE `76d2e1c` / UI `1e320e5c`):
 *
 *   A streamed draft turn was STOPPED by the user at +4.0s, ran the full 52.7s
 *   anyway, and committed. A second, DIFFERENT turn on the same scenario
 *   committed at 23:43:37.438179; the stopped turn committed 163 ms later and
 *   OVERWROTE its graph. Final persisted state was forked — brief_text from the
 *   live turn, graph from the stopped one.
 *
 * ── THE TWO FACTS THAT HAD NOWHERE TO LIVE ──────────────────────────────────
 *  1. "the user explicitly stopped THIS turn"        → `stopped_at` (tombstone)
 *  2. "a LATER turn has since claimed this scenario" → `generation` ordering
 *
 * Both are read in ONE round trip immediately before a graph-bearing commit
 * (`SupabaseSessionStore.append`, the single `scenarios.graph` writer in the
 * service) and a write that fails either test is REFUSED.
 *
 * ── WHAT IS FENCED, PRECISELY (claim-type discipline) ────────────────────────
 * ONLY writes that carry a graph. A superseded turn ROW is harmless history;
 * a superseded GRAPH clobbers the user's model, which is the defect. Non-graph
 * commits (answers, analysis receipts, system events without a graph) take
 * exactly the path they took before this module existed — no RPC, no latency,
 * no new failure mode.
 *
 * ── INCIDENTAL DISCONNECT IS NOT A STOP. THIS IS THE BINDING CONSTRAINT. ────
 * A tab close, a network drop, or a client that simply hangs up sends NO stop
 * request, so no tombstone exists and the turn commits exactly as it does today
 * (`streamed-turn-sse.ts:71-78` — the #751 arc chose finish-atomically
 * deliberately: a turn killed mid-flight could leave a scenario half-applied).
 * ONLY an explicit user Stop, which now travels to the server as its own
 * request, differs. The two semantics are pinned by SEPARATE tests
 * (`turn-fence-stop-vs-disconnect.test.ts`) precisely because a single test
 * that only checked "Stop rejects" would pass while disconnect-commit silently
 * regressed.
 *
 * ── WHAT CAN ARRIVE BETWEEN THE CLAIM AND THE COMMIT (the #525 discipline) ──
 * This is an async seam with a ~50 s gap, so the arrivals are enumerated rather
 * than hoped about:
 *
 *  1. A SECOND TURN starts on the scenario → it claims a HIGHER generation →
 *     this write evaluates `superseded` → REFUSED. (The defect.)
 *  2. A second turn starts AND commits first → identical to 1; the refusal is
 *     what stops the older turn overwriting the newer graph.
 *  3. A second turn starts and has NOT committed → still supersedes.
 *     DELIBERATE: the later user intent owns the scenario, and a graph computed
 *     from an older base is stale whether or not the newer one has landed yet.
 *  4. An explicit STOP for THIS turn → `stopped` → REFUSED.
 *  5. An explicit STOP that arrives BEFORE the claim lands → `v5_mark_turn_stopped`
 *     upserts a tombstoned row, and the claim's `ON CONFLICT DO UPDATE` is a
 *     deliberate no-op that preserves `stopped_at` → still REFUSED.
 *  6. An explicit STOP for a DIFFERENT turn → keyed on (scenario_id, turn_id);
 *     this turn is untouched.
 *  7. An INCIDENTAL DISCONNECT → nothing arrives at all → COMMITS (see above).
 *  8. An IDEMPOTENT RETRY of the same turn_id → the claim returns the SAME
 *     generation, so a replay never supersedes itself.
 *  9. TWO CONCURRENT CLAIMS → the generation is a `bigserial`, not
 *     `MAX(generation)+1`, so there is no read-modify-write to race.
 * 10. A STOP INSIDE THE WINDOW between this evaluation and the append RPC →
 *     NOT SEEN. This is the honest residual: the evaluation is a SELECT and the
 *     append is a separate round trip, so the fence is a CHECK, not a LOCK, and
 *     nothing in this module or its telemetry calls it atomic. The window is
 *     one RPC (~10-40 ms) out of a ~50 s turn. Closing it needs the check
 *     inside `append_turn_atomic` itself — rowed, not smuggled in here.
 * 11. THE FENCE RPC IS UNAVAILABLE (migration not executed, DB blip) → the
 *     graph write is REFUSED (fail closed). We cannot prove the write is
 *     current, and the whole point is not to clobber. This mirrors
 *     `commit.ts`'s terminal-invariant refusal, NOT the CAS observe hook's
 *     never-fail-a-write posture: that hook is observation, this is integrity.
 *     Covers BOTH halves of "unavailable": the pre-commit EVALUATE failing, and
 *     the ingress CLAIM failing (`generation: null` → verdict `unclaimed`). The
 *     second half did not work until the #759 review proved it could not — see
 *     `TurnFenceHandle.generation`.
 * 12. A COMMIT THAT NEVER PASSED THROUGH THE FENCED INGRESS → no handle at all,
 *     and it PROCEEDS (logged at ERROR + emitted as `no_ingress_fence`). This is
 *     deliberately NOT the same state as a failed claim: no handle means the
 *     commit reached the store by some route other than
 *     `POST /orchestrate/v2/turn` (a test double, or a future route), so there is
 *     nothing to fail closed ABOUT; a failed claim means the turn DID come
 *     through the ingress and we know we could not order it. Different
 *     epistemic states, different answers. No such route exists today
 *     (`turn-fence-route-registration.test.ts` pins the ingress).
 *
 * ── HOW THE TURN IDENTITY REACHES THE COMMIT ────────────────────────────────
 * Via AsyncLocalStorage, and that is a derivation, not a preference. The commit
 * metadata's `turn_id` is NOT one identity: `turn-executor.ts` passes
 * `requestId` / `context.request_id`, while the dispatchers and `route-v2` pass
 * `payload.turn_id`. The browser can only name the identity it generated
 * (`payload.turn_id`), so the tombstone must be keyed on THAT — and keying the
 * fence on `write.turn_id` would silently look up the wrong row on every
 * turn-executor commit. The ingress identity therefore travels out-of-band,
 * beside the request, exactly as the staged-SSE emitter does
 * (`stage-stream-context.ts`).
 *
 * ⚠ THE `await` MUST HAPPEN INSIDE `runWithTurnFence`, for the same reason
 *   `streamed-turn-sse.ts:263-272` documents: create-then-await-outside runs the
 *   work in the CALLER's async context and the handle is invisible for the whole
 *   turn. The failure is silent in the worst way — every commit still succeeds
 *   and only the fence disappears. `turn-fence-ingress-coverage.test.ts` pins
 *   that the route handler's whole body runs inside the context.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import type { SupabaseClient } from '@supabase/supabase-js';

import { StateCommitFailedError } from './store.js';

/** RPC names — one place, so a rename cannot drift between call sites. */
export const TURN_FENCE_RPC = {
  claim: 'v5_claim_turn_fence',
  evaluate: 'v5_evaluate_turn_fence',
  stop: 'v5_mark_turn_stopped',
} as const;

/**
 * The ingress-side fence claim, carried beside the request for the whole turn.
 * `generation` is this turn's position in the scenario's start order.
 */
export interface TurnFenceHandle {
  readonly scenarioId: string;
  readonly turnId: string;
  /**
   * This turn's position in the scenario's start order — or `null` when the
   * ingress claim DID NOT LAND (RPC error, throw, or a store that returned
   * nothing).
   *
   * ⚠ `null` IS THE FAIL-CLOSED SIGNAL, AND IT EXISTS BECAUSE THE FIRST VERSION
   *   OF THIS MODULE COULD NOT FAIL CLOSED AT ALL. Adversarial review of PR #759
   *   proved it: the preHandler called `done()` with NO handle when the claim
   *   failed, so the commit chokepoint hit its `no_ingress_fence` branch and
   *   ALLOWED the write. The `unclaimed` verdict existed in the classifier, in
   *   the enforcement and in the DB function, and was UNREACHABLE — the only
   *   producer of a handle was a SUCCESSFUL claim. Four doc sites and the
   *   migration header promised the opposite ("a claim failure costs the user a
   *   failed graph write, never a silently unfenced one"), which made it worse
   *   than a bug: a guarantee the code contradicted.
   *
   *   The proven blast radius was not "no fence" but an ACTIVE CLOBBER with no
   *   timing inversion needed: B's claim blips → B commits unfenced → A (gen 1)
   *   reads `max_generation = 1` → verdict `current` → A overwrites B. With a
   *   healthy claim A is correctly refused as `superseded`.
   */
  readonly generation: number | null;
}

/**
 * The handle bound when the ingress claim did not land. Separate constructor so
 * every producer of an unclaimed handle is greppable, and so the shape cannot
 * drift between the preHandler and the tests that pin it.
 */
export function unclaimedTurnFenceHandle(
  scenarioId: string,
  turnId: string,
): TurnFenceHandle {
  return { scenarioId, turnId, generation: null };
}

/**
 * Why a graph write was allowed or refused. Closed enum — telemetry and the
 * wire code both derive from it, so a new outcome cannot appear un-named.
 *
 *  · `current`     — this turn still owns the scenario: write proceeds.
 *  · `stopped`     — an explicit user Stop is recorded for this turn.
 *  · `superseded`  — a later turn has claimed the scenario.
 *  · `unclaimed`   — no fence row for this (scenario, turn): the claim never
 *                    landed, so there is no ordering to reason with.
 *  · `unavailable` — the fence could not be read at all.
 */
export type TurnFenceVerdict =
  | 'current'
  | 'stopped'
  | 'superseded'
  | 'unclaimed'
  | 'unavailable';

export interface TurnFenceEvaluation {
  readonly verdict: TurnFenceVerdict;
  readonly generation: number | null;
  readonly maxGeneration: number | null;
  /** Present only for `unavailable` — the reason we could not read the fence. */
  readonly unavailableReason?: string;
}

export interface TurnStopOutcome {
  /** The tombstone is recorded. Always true on a successful RPC. */
  readonly stopped: boolean;
  /** A fence row already existed, i.e. the turn had reached ingress. */
  readonly claimed: boolean;
  /**
   * The turn had ALREADY committed when the Stop arrived — derived from
   * `v5_conversation_turns`, not tracked twice. This is what lets the UI state
   * something true about the past instead of predicting a commit.
   */
  readonly alreadyCommitted: boolean;
}

/**
 * A graph write refused by the fence. Extends `StateCommitFailedError` so the
 * existing `instanceof StateCommitFailedError` catch ladders in
 * `turn-executor.ts` / `route-v2.ts` map it onto the typed failure envelope
 * with no new wire shape — the same route `GraphStaleWriteError` already takes.
 */
export class TurnFenceRejectedError extends StateCommitFailedError {
  readonly verdict: TurnFenceVerdict;
  readonly generation: number | null;
  readonly maxGeneration: number | null;

  constructor(message: string, evaluation: TurnFenceEvaluation, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'TurnFenceRejectedError';
    this.verdict = evaluation.verdict;
    this.generation = evaluation.generation;
    this.maxGeneration = evaluation.maxGeneration;
  }
}

// ── The ingress context ─────────────────────────────────────────────────────
const fenceStorage = new AsyncLocalStorage<TurnFenceHandle>();

/**
 * Run `fn` with the fence handle bound for the whole turn. The `await` on the
 * turn's work MUST be inside `fn` — see the file header's warning.
 */
export function runWithTurnFence<T>(handle: TurnFenceHandle, fn: () => T): T {
  return fenceStorage.run(handle, fn);
}

/** The current turn's fence handle, or `undefined` outside a fenced request. */
export function currentTurnFence(): TurnFenceHandle | undefined {
  return fenceStorage.getStore();
}

function errMessage(e: unknown): string {
  if (e === null || e === undefined) return 'unknown';
  if (typeof e === 'string') return e;
  const m = (e as { message?: unknown }).message;
  return typeof m === 'string' ? m : String(e);
}

/**
 * Claim this turn's place in the scenario's start order.
 *
 * Returns `null` when the claim could not be made. The caller does NOT then
 * proceed unfenced: it binds an `unclaimedTurnFenceHandle`, so the turn runs to
 * completion and its GRAPH WRITE is refused at the commit (arrival 11). The turn
 * itself is not failed at ingress, because refusing there would convert a fence
 * outage into a total outage — including for the many turns that write no graph
 * at all. So a claim failure costs the user a failed graph write, and (since the
 * #759 review) that sentence is enforced rather than merely written down.
 */
export async function claimTurnFence(
  client: Pick<SupabaseClient, 'rpc'>,
  scenarioId: string,
  turnId: string,
): Promise<{ handle: TurnFenceHandle } | { handle: null; error: string }> {
  try {
    const { data, error } = await client.rpc(TURN_FENCE_RPC.claim, {
      p_scenario_id: scenarioId,
      p_turn_id: turnId,
    });
    if (error) return { handle: null, error: errMessage(error) };
    const generation = Number(data);
    if (!Number.isFinite(generation)) {
      return { handle: null, error: `claim returned a non-numeric generation: ${String(data)}` };
    }
    return { handle: { scenarioId, turnId, generation } };
  } catch (err) {
    return { handle: null, error: errMessage(err) };
  }
}

/**
 * Read the fence for a claimed turn and classify it. Never throws: an
 * unreadable fence is an `unavailable` VERDICT, and it is the CALLER (the
 * commit path) that decides an unavailable fence refuses the write — so the
 * fail-closed decision lives at the write, in one place, rather than being
 * spread across this module's error handling.
 */
export async function evaluateTurnFence(
  client: Pick<SupabaseClient, 'rpc'>,
  handle: TurnFenceHandle,
): Promise<TurnFenceEvaluation> {
  let payload: unknown;
  try {
    const { data, error } = await client.rpc(TURN_FENCE_RPC.evaluate, {
      p_scenario_id: handle.scenarioId,
      p_turn_id: handle.turnId,
    });
    if (error) {
      return {
        verdict: 'unavailable',
        generation: null,
        maxGeneration: null,
        unavailableReason: `rpc_error: ${errMessage(error)}`,
      };
    }
    payload = data;
  } catch (err) {
    return {
      verdict: 'unavailable',
      generation: null,
      maxGeneration: null,
      unavailableReason: `rpc_threw: ${errMessage(err)}`,
    };
  }
  return classifyTurnFence(payload);
}

/**
 * Pure classifier over the evaluate RPC's payload. Split out so the ordering of
 * the two rejection reasons is unit-testable without a client: an explicitly
 * STOPPED turn reads `stopped` even when it is ALSO superseded, because that is
 * the reason the user would recognise.
 */
export function classifyTurnFence(payload: unknown): TurnFenceEvaluation {
  if (payload === null || typeof payload !== 'object') {
    return {
      verdict: 'unavailable',
      generation: null,
      maxGeneration: null,
      unavailableReason: 'malformed_payload',
    };
  }
  const row = payload as {
    claimed?: unknown;
    stopped?: unknown;
    generation?: unknown;
    max_generation?: unknown;
  };
  const generation = typeof row.generation === 'number' ? row.generation : null;
  const maxGeneration = typeof row.max_generation === 'number' ? row.max_generation : null;

  if (row.claimed !== true || generation === null) {
    return { verdict: 'unclaimed', generation, maxGeneration };
  }
  if (row.stopped === true) {
    return { verdict: 'stopped', generation, maxGeneration };
  }
  if (maxGeneration === null) {
    // The turn is claimed, so its own row is in the table and MAX cannot be
    // null. A null here means we misread the payload, not that the fence is
    // clear — never resolve that to `current`.
    return {
      verdict: 'unavailable',
      generation,
      maxGeneration,
      unavailableReason: 'claimed_without_max_generation',
    };
  }
  if (generation < maxGeneration) {
    return { verdict: 'superseded', generation, maxGeneration };
  }
  return { verdict: 'current', generation, maxGeneration };
}

/**
 * ⚠ NO RETRY ON A FENCE READ, AND THAT IS A PRICED TRADE (raised by the #759
 *   review as a non-blocking note). One transient blip on the claim or the
 *   evaluate costs the user a whole draft — the graph write is refused and ~50 s
 *   of work is discarded. A retry would recover most of those, but a retry around
 *   an integrity check is its own hazard: it widens the evaluate→append window
 *   the fence's honesty depends on (arrival 10), and a retry that succeeds on the
 *   second attempt has read the fence at a LATER moment than the caller believes.
 *   So: no retry now, deliberately, priced at one lost draft per blip, and rowed
 *   rather than built. If it is ever added, it belongs INSIDE the RPC, not around
 *   it.
 */

/** Record an explicit user Stop. Throws only if the RPC itself fails. */
export async function markTurnStopped(
  client: Pick<SupabaseClient, 'rpc'>,
  scenarioId: string,
  turnId: string,
): Promise<TurnStopOutcome> {
  const { data, error } = await client.rpc(TURN_FENCE_RPC.stop, {
    p_scenario_id: scenarioId,
    p_turn_id: turnId,
  });
  if (error) {
    throw new Error(`${TURN_FENCE_RPC.stop} RPC failed: ${errMessage(error)}`);
  }
  const row = (data ?? {}) as {
    stopped?: unknown;
    claimed?: unknown;
    already_committed?: unknown;
  };
  return {
    stopped: row.stopped === true,
    claimed: row.claimed === true,
    alreadyCommitted: row.already_committed === true,
  };
}
