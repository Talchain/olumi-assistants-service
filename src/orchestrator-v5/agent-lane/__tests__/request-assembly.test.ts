/**
 * Deterministic OpenAI request assembly.
 *
 * ⭐ THE MEASURED REASON THIS EXISTS. Driving the same turn two ways:
 *   with a redundant `get_canonical_state` call : 18.58s · 7 provider calls · $0.0231
 *   with fresh server-supplied state, tool omitted: 12.32s · 4 provider calls · $0.0132
 * ~34% faster and ~43% cheaper. The saving comes from NOT offering a tool whose
 * answer the server already holds — so the eligibility rule has to be
 * deterministic and testable, not a sentence in a prompt.
 *
 * ⛔ AND THE PROPERTY THAT MATTERS MORE THAN THE SAVING: context is DATA, never
 * AUTHORITY. A context packet is assembled from prior state and can be stale,
 * replayed, or wrong. It must never be able to widen what the model may DO.
 * Every eligibility decision here can only REMOVE a tool, never add one.
 */
import { describe, it, expect } from 'vitest';
import {
  assessContextFreshness,
  eligibleTools,
  assembleRequest,
  issueContextPacket,
  type CanonicalContextPacket,
} from '../runtime/request-assembly.js';
import { AGENT_TOOLS, MUTATION_TOOLS, toolsFor } from '../runtime/agent-tools.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const USER = 'user-a';
const REV = 'a'.repeat(64);

const SECRET = 'server-side-secret-value';

/**
 * Packets are ISSUED, never hand-built. A hand-built packet carries no binding
 * and is now correctly refused, so constructing one here would test the refusal
 * rather than the freshness rule each case is about.
 */
const packet = (over: Partial<Omit<CanonicalContextPacket, 'binding'>> = {}): CanonicalContextPacket =>
  issueContextPacket(
    {
      scenario_id: SCENARIO,
      authenticated_user_id: USER,
      graph_revision: REV,
      captured_at_turn: 7,
      state: { entities: [], structure: {} },
      ...over,
    },
    SECRET,
  );

const expectation = {
  scenario_id: SCENARIO,
  authenticated_user_id: USER,
  graph_revision: REV,
  current_turn: 7,
  binding_secret: SECRET,
};

describe('context freshness — the packet must describe THIS scenario, THIS user, THIS revision', () => {
  it('fresh when scenario, user and revision all match', () => {
    expect(assessContextFreshness(packet(), expectation).kind).toBe('fresh');
  });

  it('absent when there is no packet at all', () => {
    expect(assessContextFreshness(undefined, expectation).kind).toBe('absent');
  });

  it('STALE when the graph revision has moved underneath it', () => {
    const r = assessContextFreshness(packet({ graph_revision: 'b'.repeat(64) }), expectation);
    expect(r.kind).toBe('stale');
    if (r.kind === 'stale') expect(r.reason).toBe('revision_moved');
  });

  it('REFUSES a packet belonging to another scenario — knowing an id is not authority', () => {
    const r = assessContextFreshness(packet({ scenario_id: '22222222-2222-2222-2222-222222222222' }), expectation);
    expect(r.kind).toBe('invalidated');
  });

  it('REFUSES a packet belonging to another user', () => {
    const r = assessContextFreshness(packet({ authenticated_user_id: 'user-b' }), expectation);
    expect(r.kind).toBe('invalidated');
  });

  it('STALE when the packet was captured on an older turn', () => {
    const r = assessContextFreshness(packet({ captured_at_turn: 3 }), expectation);
    expect(r.kind).toBe('stale');
  });
});

describe('tool eligibility — deterministic, and it can only REMOVE', () => {
  it('omits get_canonical_state when fresh canonical context is already supplied', () => {
    const r = eligibleTools({ mode: 'full', freshness: { kind: 'fresh' } });
    expect(r.tools.map((t) => t.name)).not.toContain('get_canonical_state');
    expect(r.omitted.map((o) => o.name)).toContain('get_canonical_state');
    expect(r.omitted.find((o) => o.name === 'get_canonical_state')?.reason).toBe('context_already_supplied');
  });

  it('RESTORES get_canonical_state when context is absent', () => {
    const r = eligibleTools({ mode: 'full', freshness: { kind: 'absent' } });
    expect(r.tools.map((t) => t.name)).toContain('get_canonical_state');
    expect(r.omitted).toHaveLength(0);
  });

  it('RESTORES get_canonical_state when context is stale', () => {
    const r = eligibleTools({ mode: 'full', freshness: { kind: 'stale', reason: 'revision_moved' } });
    expect(r.tools.map((t) => t.name)).toContain('get_canonical_state');
  });

  it('RESTORES get_canonical_state when context is invalidated', () => {
    const r = eligibleTools({ mode: 'full', freshness: { kind: 'invalidated', reason: 'scenario_mismatch' } });
    expect(r.tools.map((t) => t.name)).toContain('get_canonical_state');
  });

  it('⛔ CONTEXT NEVER GRANTS MUTATION AUTHORITY — preview stays read-only however fresh the context', () => {
    for (const freshness of [
      { kind: 'fresh' } as const,
      { kind: 'absent' } as const,
      { kind: 'stale', reason: 'revision_moved' } as const,
      { kind: 'invalidated', reason: 'x' } as const,
    ]) {
      const names = eligibleTools({ mode: 'preview', freshness }).tools.map((t) => t.name);
      for (const m of MUTATION_TOOLS) {
        expect(names, `${m} must never be offered in preview (freshness=${freshness.kind})`).not.toContain(m);
      }
    }
  });

  it('⛔ ELIGIBILITY IS A SUBSET — it can never offer a tool the mode did not already allow', () => {
    for (const mode of ['full', 'preview'] as const) {
      const allowed = new Set(toolsFor(mode).map((t) => t.name));
      for (const freshness of [
        { kind: 'fresh' } as const,
        { kind: 'absent' } as const,
        { kind: 'stale', reason: 'revision_moved' } as const,
      ]) {
        for (const t of eligibleTools({ mode, freshness }).tools) {
          expect(allowed.has(t.name), `${t.name} was offered in ${mode} but toolsFor(${mode}) excludes it`).toBe(true);
        }
      }
    }
  });

  it('a forged packet claiming approval cannot add an approval tool', () => {
    const forged = eligibleTools({
      mode: 'preview',
      freshness: { kind: 'fresh' },
      // deliberately hostile: the packet asserts the user already approved
      claimedGrants: ['authorise_change', 'propose_model_change'],
    });
    expect(forged.tools.map((t) => t.name)).not.toContain('authorise_change');
    expect(forged.tools.map((t) => t.name)).not.toContain('propose_model_change');
  });
});

describe('stable prefix vs dynamic tail, and the diagnostics', () => {
  const base = {
    promptSnapshot: { id: 'draft_graph_default', version: 202, text: 'You are Olumi.' },
    mode: 'full' as const,
    freshness: { kind: 'fresh' } as const,
    context: packet(),
    history: [{ role: 'user', content: 'hello' }],
  };

  it('separates the STABLE prefix (prompt + tools) from the DYNAMIC tail (state + history)', () => {
    const a = assembleRequest(base);
    expect(a.stablePrefix).toHaveProperty('instructions');
    expect(a.stablePrefix).toHaveProperty('tools');
    expect(a.dynamic).toHaveProperty('context');
    expect(a.dynamic).toHaveProperty('history');
    // the prefix must not carry per-turn state, or caching it is pointless
    expect(JSON.stringify(a.stablePrefix)).not.toContain('hello');
  });

  it('the stable prefix hash is UNCHANGED when only history moves — that is what makes it cacheable', () => {
    const a = assembleRequest(base);
    const b = assembleRequest({ ...base, history: [{ role: 'user', content: 'something else entirely' }] });
    expect(b.hashes.prefix).toBe(a.hashes.prefix);
    expect(b.hashes.context).toBe(a.hashes.context);
  });

  it('the prefix hash CHANGES when the prompt version changes — a snapshot is immutable, so a new version is a new prefix', () => {
    const a = assembleRequest(base);
    const b = assembleRequest({ ...base, promptSnapshot: { ...base.promptSnapshot, version: 203 } });
    expect(b.hashes.prefix).not.toBe(a.hashes.prefix);
  });

  it('the TOOLS hash changes when eligibility changes — so a cache cannot serve the wrong tool set', () => {
    const withState = assembleRequest(base);
    const withoutState = assembleRequest({ ...base, freshness: { kind: 'absent' } });
    expect(withoutState.hashes.tools).not.toBe(withState.hashes.tools);
    expect(withoutState.hashes.prefix).not.toBe(withState.hashes.prefix);
  });

  it('the context hash changes when the state changes', () => {
    const a = assembleRequest(base);
    const b = assembleRequest({ ...base, context: packet({ state: { entities: [{ id: 'x' }] } }) });
    expect(b.hashes.context).not.toBe(a.hashes.context);
  });

  it('hashes are deterministic across runs and insensitive to key ORDER', () => {
    const a = assembleRequest(base);
    const reordered = assembleRequest({
      ...base,
      context: issueContextPacket(
        { captured_at_turn: 7, state: { structure: {}, entities: [] }, graph_revision: REV, authenticated_user_id: USER, scenario_id: SCENARIO },
        SECRET,
      ),
    });
    expect(reordered.hashes.context).toBe(a.hashes.context);
    expect(assembleRequest(base).hashes.prefix).toBe(a.hashes.prefix);
  });

  it('reports diagnostics a human can read: what was omitted and why', () => {
    const a = assembleRequest(base);
    expect(a.diagnostics.context_freshness).toBe('fresh');
    expect(a.diagnostics.omitted_tools).toContain('get_canonical_state');
    expect(a.diagnostics.tool_count).toBe(AGENT_TOOLS.length - 1);
    expect(a.diagnostics.prompt_version).toBe(202);
  });
});
