/**
 * `get_canonical_state` — authority first, then honest reporting.
 *
 * The cross-subject cases are the point: knowing a session id must never expose
 * another user's or another scenario's model.
 */

import { describe, it, expect } from 'vitest';
import { SessionBindingRegistry, MAX_BINDINGS } from '../session-binding.js';
import { getCanonicalState, type CanonicalStateDeps, type PersistedScenarioRead } from '../tools/get-canonical-state.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const OTHER_SCENARIO = '22222222-2222-2222-2222-222222222222';
const USER = 'user-a';
const OTHER_USER = 'user-b';
const SESSION = 'sess_abc';

const graph = {
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR', provenance: { source: 'user_specified' } },
    { id: 'price', kind: 'factor', label: 'Pro plan price', observed_state: { value: 49, unit: 'GBP' }, provenance: { source: 'user_specified' } },
    { id: 'churn', kind: 'factor', label: 'Monthly churn rate', provenance: { source: 'brief_extraction' } },
    { id: 'nameless', kind: 'factor', label: 'No provenance here' },
  ],
  edges: [],
};

function deps(read: PersistedScenarioRead | undefined, sessions: SessionBindingRegistry): CanonicalStateDeps {
  return { readScenario: async () => read, sessions };
}

const owned: PersistedScenarioRead = { user_id: USER, graph, brief_text: 'a brief', graph_identity_hash: 'a'.repeat(64) };

describe('getCanonicalState — authority', () => {
  it('refuses an UNKNOWN session', async () => {
    const s = new SessionBindingRegistry();
    const r = await getCanonicalState({ scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: USER }, deps(owned, s));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe('not_found');
  });

  it("refuses a session bound to ANOTHER user, even with the right scenario", async () => {
    const s = new SessionBindingRegistry();
    s.bind(SESSION, OTHER_USER, SCENARIO);
    const r = await getCanonicalState({ scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: USER }, deps(owned, s));
    expect(r.ok).toBe(false);
  });

  it('refuses a session bound to ANOTHER scenario — knowing the id is not enough', async () => {
    const s = new SessionBindingRegistry();
    s.bind(SESSION, USER, OTHER_SCENARIO);
    const r = await getCanonicalState({ scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: USER }, deps(owned, s));
    expect(r.ok).toBe(false);
  });

  it("refuses when the scenario's owner is not the authenticated caller", async () => {
    const s = new SessionBindingRegistry();
    s.bind(SESSION, OTHER_USER, SCENARIO);
    const r = await getCanonicalState({ scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: OTHER_USER }, deps(owned, s));
    expect(r.ok, 'session matches the caller, but the scenario belongs to USER').toBe(false);
  });

  it('refuses a guest scenario to an authenticated caller, and vice versa', async () => {
    const guest: PersistedScenarioRead = { ...owned, user_id: null };
    const s1 = new SessionBindingRegistry(); s1.bind(SESSION, USER, SCENARIO);
    expect((await getCanonicalState({ scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: USER }, deps(guest, s1))).ok).toBe(false);
    const s2 = new SessionBindingRegistry(); s2.bind(SESSION, null, SCENARIO);
    expect((await getCanonicalState({ scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: null }, deps(owned, s2))).ok).toBe(false);
  });

  it('refuses a scenario that does not exist, with the SAME refusal as unauthorised', async () => {
    const s = new SessionBindingRegistry(); s.bind(SESSION, USER, SCENARIO);
    const missing = await getCanonicalState({ scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: USER }, deps(undefined, s));
    const unauth = await getCanonicalState({ scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: OTHER_USER }, deps(owned, s));
    expect(missing.ok).toBe(false);
    expect(unauth.ok).toBe(false);
    if (!missing.ok && !unauth.ok) expect(missing.detail).toBe(unauth.detail);
  });

  it('CONTROL: the matching subject DOES get the state — the gate is not a constant refusal', async () => {
    const s = new SessionBindingRegistry(); s.bind(SESSION, USER, SCENARIO);
    const r = await getCanonicalState({ scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: USER }, deps(owned, s));
    expect(r.ok).toBe(true);
  });
});

describe('getCanonicalState — honest reporting', () => {
  const read = async () => {
    const s = new SessionBindingRegistry(); s.bind(SESSION, USER, SCENARIO);
    const r = await getCanonicalState({ scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: USER }, deps(owned, s));
    if (!r.ok) throw new Error('expected ok');
    return r;
  };

  it('reports a stated baseline as a number and an unstated one as unknown', async () => {
    const r = await read();
    const price = r.entities.find((e) => e.label === 'Pro plan price');
    const churn = r.entities.find((e) => e.label === 'Monthly churn rate');
    expect(price?.baseline).toEqual({ kind: 'point', value: 49, unit: 'GBP' });
    expect(churn?.baseline).toEqual({ kind: 'unknown' });
    // The whole point: never a zero standing in for an absence.
    expect(churn?.baseline).not.toEqual({ kind: 'point', value: 0 });
  });

  it('reports absent provenance as unattested, never as user-authored', async () => {
    const r = await read();
    expect(r.entities.find((e) => e.label === 'No provenance here')?.authored_by).toBe('unattested');
    expect(r.entities.find((e) => e.label === 'Monthly churn rate')?.authored_by).toBe('brief_extraction');
  });

  it('distinguishes an EMPTY model from a model with no factors', async () => {
    const s = new SessionBindingRegistry(); s.bind(SESSION, USER, SCENARIO);
    const r = await getCanonicalState(
      { scenario_id: SCENARIO, agent_session_id: SESSION, authenticated_user_id: USER },
      deps({ ...owned, graph: null }, s),
    );
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.empty).toBe(true); expect(r.entities).toHaveLength(0); }
  });
});

describe('SessionBindingRegistry', () => {
  it('refuses to re-bind one session to a different subject', () => {
    const s = new SessionBindingRegistry();
    s.bind(SESSION, USER, SCENARIO);
    expect(() => s.bind(SESSION, OTHER_USER, SCENARIO)).toThrow(/different user or scenario/);
    expect(() => s.bind(SESSION, USER, OTHER_SCENARIO)).toThrow(/different user or scenario/);
  });

  it('re-binding the same subject is idempotent', () => {
    const s = new SessionBindingRegistry();
    const a = s.bind(SESSION, USER, SCENARIO);
    const b = s.bind(SESSION, USER, SCENARIO);
    expect(b.seq).toBe(a.seq);
    expect(s.size()).toBe(1);
  });

  it('is bounded, and eviction FAILS CLOSED rather than admitting', () => {
    const s = new SessionBindingRegistry();
    for (let i = 0; i < MAX_BINDINGS + 5; i++) s.bind(`sess_${i}`, USER, SCENARIO);
    expect(s.size()).toBeLessThanOrEqual(MAX_BINDINGS);
    // The oldest was evicted, so it is now UNKNOWN — refused, not admitted.
    expect(s.check('sess_0', USER, SCENARIO)).toBe('unknown_session');
    expect(s.check(`sess_${MAX_BINDINGS + 4}`, USER, SCENARIO)).toBeNull();
  });
});
