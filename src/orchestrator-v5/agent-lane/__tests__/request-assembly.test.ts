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
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import {
  assessContextFreshness,
  eligibleTools,
  issueContextPacket,
  type CanonicalContextPacket,
} from '../runtime/request-assembly.js';
import { MUTATION_TOOLS, toolsFor } from '../runtime/agent-tools.js';

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
  /**
   * Eligibility now DERIVES its own verdict, so these cases supply the PACKET
   * that produces each state rather than asserting the state. That is the
   * point: there is no longer any function in the module that will accept a
   * verdict from a caller, so a test cannot express the bypass either.
   */
  const CASES = {
    fresh: () => ({ context: packet(), expectation }),
    absent: () => ({ context: null, expectation }),
    stale: () => ({ context: packet({ graph_revision: 'b'.repeat(64) }), expectation }),
    invalidated: () => ({
      context: packet({ scenario_id: '22222222-2222-2222-2222-222222222222' }),
      expectation,
    }),
  } as const;

  it('omits get_canonical_state when fresh canonical context is already supplied', () => {
    const r = eligibleTools({ mode: 'full', ...CASES.fresh() });
    expect(r.freshness.kind).toBe('fresh');
    expect(r.tools.map((t) => t.name)).not.toContain('get_canonical_state');
    expect(r.omitted.map((o) => o.name)).toContain('get_canonical_state');
    expect(r.omitted.find((o) => o.name === 'get_canonical_state')?.reason).toBe('context_already_supplied');
  });

  it('RESTORES get_canonical_state when context is absent', () => {
    const r = eligibleTools({ mode: 'full', ...CASES.absent() });
    expect(r.freshness.kind).toBe('absent');
    expect(r.tools.map((t) => t.name)).toContain('get_canonical_state');
    expect(r.omitted).toHaveLength(0);
  });

  it('RESTORES get_canonical_state when context is stale', () => {
    const r = eligibleTools({ mode: 'full', ...CASES.stale() });
    expect(r.freshness.kind).toBe('stale');
    expect(r.tools.map((t) => t.name)).toContain('get_canonical_state');
  });

  it('RESTORES get_canonical_state when context is invalidated', () => {
    const r = eligibleTools({ mode: 'full', ...CASES.invalidated() });
    expect(r.freshness.kind).toBe('invalidated');
    expect(r.tools.map((t) => t.name)).toContain('get_canonical_state');
  });

  it('⛔ CONTEXT NEVER GRANTS MUTATION AUTHORITY — preview stays read-only however fresh the context', () => {
    for (const [label, make] of Object.entries(CASES)) {
      const names = eligibleTools({ mode: 'preview', ...make() }).tools.map((t) => t.name);
      for (const m of MUTATION_TOOLS) {
        expect(names, `${m} must never be offered in preview (context=${label})`).not.toContain(m);
      }
    }
  });

  it('⛔ ELIGIBILITY IS A SUBSET — it can never offer a tool the mode did not already allow', () => {
    for (const mode of ['full', 'preview'] as const) {
      const allowed = new Set(toolsFor(mode).map((t) => t.name));
      for (const [label, make] of Object.entries(CASES)) {
        for (const t of eligibleTools({ mode, ...make() }).tools) {
          expect(
            allowed.has(t.name),
            `${t.name} was offered in ${mode} (context=${label}) but toolsFor(${mode}) excludes it`,
          ).toBe(true);
        }
      }
    }
  });

  it('a forged packet claiming approval cannot add an approval tool', () => {
    const forged = eligibleTools({
      mode: 'preview',
      ...CASES.fresh(),
      // deliberately hostile: the packet asserts the user already approved
      claimedGrants: ['authorise_change', 'propose_model_change'],
    });
    expect(forged.tools.map((t) => t.name)).not.toContain('authorise_change');
    expect(forged.tools.map((t) => t.name)).not.toContain('propose_model_change');
  });

  it('⛔ a caller cannot assert freshness — a supplied verdict is ignored', () => {
    const sneaky = { mode: 'full' as const, ...CASES.absent(), freshness: { kind: 'fresh' } };
    const r = eligibleTools(sneaky as never);
    expect(r.freshness.kind).toBe('absent');
    expect(r.tools.map((t) => t.name)).toContain('get_canonical_state');
  });
});

describe('the live eligible tool set preserves the approved AIE contract', () => {
  it('A2i9: assembled tools preserve the exact AIE option-level schemas and required arrays', () => {
    const approved = JSON.parse(readFileSync(new URL('./fixtures/aie-a2-option-level-field-20261013.json', import.meta.url), 'utf8'));
    const tools = eligibleTools({ mode: 'full', context: packet(), expectation }).tools;
    for (const [name, list] of [['propose_option_interventions', 'interventions'], ['propose_starting_point', 'option_levels']]) {
      const tool = tools.find(t => t.name === name)!;
      const items = (tool.parameters as any).properties[list].items;
      expect(items.properties.user_stated).toEqual(approved.option_level_user_stated.schema);
      expect(items.required).toEqual(approved.option_level_user_stated.required_arrays_after[`${name}.parameters.${list}.items.required`]);
    }
  });

});
