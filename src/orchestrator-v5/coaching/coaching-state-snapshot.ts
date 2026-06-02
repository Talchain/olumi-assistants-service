/**
 * V5 Coaching State Spine — Stage 2B-1b: durable coaching-state snapshot envelope.
 *
 * Wraps the Stage-2A `CoachingState` (derived in `buildTurnContext` at turn
 * start) with explicit, machine-checkable timing metadata before it is
 * persisted to `v5_conversation_turns.coaching_state`. The envelope makes the
 * snapshot's derivation point unambiguous:
 *   `snapshot_timing: 'pre_dispatch'` — derived BEFORE any handler mutation.
 *
 * Stage 2B-2 lifecycle (future) MUST compare like-for-like — a pre-dispatch
 * prior snapshot against a pre-dispatch current derivation; the timing tag is
 * how that invariant becomes checkable. NO lifecycle semantics are derived
 * here — this is persistence foundation only.
 *
 * Content-free: the wrapped `CoachingState` carries only closed-enum signal
 * kinds / reason_codes / statuses + SHA-prefix hashes (the Stage-2A guarantee).
 * No raw user content is ever persisted via this envelope.
 *
 * Import-cycle note: this module imports only the `CoachingState` TYPE from
 * `coaching-state.ts`; it does not import `session/*` or `build-turn-context.ts`.
 */

import type { CoachingState } from './coaching-state.js';

/** The only snapshot timing 2B-1b persists: turn-start, pre-handler-dispatch. */
export const COACHING_STATE_SNAPSHOT_TIMING_PRE_DISPATCH = 'pre_dispatch' as const;

/**
 * The shape persisted to `v5_conversation_turns.coaching_state` (a JSON object,
 * satisfying the migration CHECK `jsonb_typeof = 'object'`). Internal only —
 * never serialised on the wire, ContextPack, or routing prompt.
 */
export interface CoachingStateSnapshot {
  /** Derivation point of the wrapped state. 2B-1b only ever writes `pre_dispatch`. */
  readonly snapshot_timing: typeof COACHING_STATE_SNAPSHOT_TIMING_PRE_DISPATCH;
  /** The Stage-2A container `version` at persist time (version-safety key for 2B-2). */
  readonly coaching_state_version: string;
  /** The Stage-2A current-turn coaching state, verbatim (content-free). */
  readonly coaching_state: CoachingState;
}

/**
 * Wrap a turn-start `CoachingState` into a persist-ready pre-dispatch snapshot.
 * Stamps `snapshot_timing` and the version explicitly so the persisted JSONB is
 * self-describing.
 */
export function toPreDispatchSnapshot(state: CoachingState): CoachingStateSnapshot {
  return {
    snapshot_timing: COACHING_STATE_SNAPSHOT_TIMING_PRE_DISPATCH,
    coaching_state_version: state.version,
    coaching_state: state,
  };
}

/**
 * Defensively parse a persisted `coaching_state` JSONB value into a
 * `CoachingStateSnapshot`. Pure + total — never throws. Returns `null` on any
 * shape drift (the caller treats a missing row as `null` too):
 *   - not an object / wrong `snapshot_timing` / missing version → null;
 *   - inner `coaching_state` not a Stage-2A-shaped object → null.
 *
 * Validation is intentionally lightweight (structural, not full Zod) — it only
 * needs to confirm the envelope is a 2B-1b pre-dispatch snapshot whose inner
 * state has the expected top-level shape. Lifecycle derivation (2B-2) does the
 * deeper reasoning.
 */
export function parseCoachingStateSnapshot(raw: unknown): CoachingStateSnapshot | null {
  try {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const env = raw as Record<string, unknown>;
    if (env.snapshot_timing !== COACHING_STATE_SNAPSHOT_TIMING_PRE_DISPATCH) return null;
    if (typeof env.coaching_state_version !== 'string') return null;
    const cs = env.coaching_state;
    if (cs === null || typeof cs !== 'object' || Array.isArray(cs)) return null;
    const state = cs as Record<string, unknown>;
    if (typeof state.version !== 'string') return null;
    if (state.status !== 'empty' && state.status !== 'active' && state.status !== 'degraded') {
      return null;
    }
    if (!Array.isArray(state.signals)) return null;
    if (state.summary === null || typeof state.summary !== 'object') return null;
    return {
      snapshot_timing: COACHING_STATE_SNAPSHOT_TIMING_PRE_DISPATCH,
      coaching_state_version: env.coaching_state_version,
      coaching_state: cs as unknown as CoachingState,
    };
  } catch {
    return null;
  }
}
