/**
 * Agent lane — the Agent session is a CORRELATION TOKEN, never an authority.
 *
 * ⛔ THE HOLE THIS CLOSES. The client round-trips an `agent_session_id` so a
 * conversation can continue. If any capability trusted that id to identify the
 * conversation's subject, then knowing somebody else's session id would expose
 * their scenario. So the id is never an input to authorisation: it is checked
 * AGAINST the authenticated user and the requested scenario on every single
 * request, and a mismatch is refused.
 *
 * The binding lives in a bounded in-process map. That is deliberate for this
 * witness: staging has no Redis (`REDIS_URL` is absent from all 121 service env
 * vars) and a new column would be DDL on a Supabase project shared with
 * production. A lost binding after a restart costs a re-bind, which is cheap and
 * safe — losing it FAILS CLOSED, because an unknown session is refused rather
 * than admitted.
 */

export interface SessionBinding {
  readonly agent_session_id: string;
  /** The authenticated user this session belongs to. `null` means a guest. */
  readonly user_id: string | null;
  readonly scenario_id: string;
  /** Monotonic insertion order, used for eviction. Not a clock. */
  readonly seq: number;
}

export type BindingRefusal =
  | 'unknown_session'
  | 'session_belongs_to_another_user'
  | 'session_belongs_to_another_scenario';

/** Bounded so a long-running process cannot grow without limit. */
export const MAX_BINDINGS = 500;

export class SessionBindingRegistry {
  private readonly bindings = new Map<string, SessionBinding>();
  private seq = 0;

  bind(agent_session_id: string, user_id: string | null, scenario_id: string): SessionBinding {
    const existing = this.bindings.get(agent_session_id);
    if (existing !== undefined) {
      // Re-binding the same session to a different subject is never legitimate.
      if (existing.user_id !== user_id || existing.scenario_id !== scenario_id) {
        throw new Error(
          'agent-lane: refusing to re-bind an existing agent session to a different user or scenario',
        );
      }
      return existing;
    }
    if (this.bindings.size >= MAX_BINDINGS) {
      // Evict the oldest by insertion order. Eviction fails closed: the evicted
      // session is simply unknown next time and must re-bind.
      let oldestKey: string | undefined;
      let oldestSeq = Number.POSITIVE_INFINITY;
      for (const [k, v] of this.bindings) {
        if (v.seq < oldestSeq) { oldestSeq = v.seq; oldestKey = k; }
      }
      if (oldestKey !== undefined) this.bindings.delete(oldestKey);
    }
    const binding: SessionBinding = { agent_session_id, user_id, scenario_id, seq: this.seq++ };
    this.bindings.set(agent_session_id, binding);
    return binding;
  }

  /**
   * Verify a session against the authenticated subject of THIS request.
   * Returns a refusal reason rather than throwing, so a caller can map it to an
   * indistinguishable response.
   */
  check(
    agent_session_id: string,
    user_id: string | null,
    scenario_id: string,
  ): BindingRefusal | null {
    const b = this.bindings.get(agent_session_id);
    if (b === undefined) return 'unknown_session';
    if (b.user_id !== user_id) return 'session_belongs_to_another_user';
    if (b.scenario_id !== scenario_id) return 'session_belongs_to_another_scenario';
    return null;
  }

  size(): number {
    return this.bindings.size;
  }
}
