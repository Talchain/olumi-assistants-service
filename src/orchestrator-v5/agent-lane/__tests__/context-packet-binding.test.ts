/**
 * THE AUTHENTICATED CANONICAL CONTEXT PACKET.
 *
 * ⛔ WHY A BINDING AND NOT JUST FIELDS. Until now a packet merely ASSERTED its
 * scenario, user and revision, and `assessContextFreshness` compared those
 * assertions against what the server expected. That catches an honest mistake —
 * a stale view, the wrong scenario — but it cannot tell an issued packet from a
 * fabricated one, because a fabricator simply writes the values the server
 * expects. "Authenticated" has to mean the server can recognise its OWN packet.
 *
 * So a packet carries an HMAC over its subject and its state, keyed on a server
 * secret. Nothing that lacks the key can mint one, and nothing can alter a
 * field after issue without invalidating it.
 *
 * ⛔ AND WHY THE BINDING IS CHECKED FIRST. If the binding does not verify,
 * nothing else the packet says is trustworthy — including its scenario and user
 * — so reporting "stale" or "scenario mismatch" would be dressing up an
 * untrusted claim as a diagnosis. Binding, then subject, then freshness.
 *
 * This still does NOT make context authoritative. A perfectly valid packet buys
 * exactly one thing: permission to omit a redundant read tool. It can never add
 * a capability — that invariant is pinned in request-assembly.test.ts.
 */
import { describe, it, expect } from 'vitest';
import {
  issueContextPacket,
  assessContextFreshness,
  type CanonicalContextPacket,
} from '../runtime/request-assembly.js';

const SCENARIO = '11111111-1111-1111-1111-111111111111';
const USER = 'user-a';
const REV = 'a'.repeat(64);
const SECRET = 'server-side-secret-value';
const OTHER_SECRET = 'a-different-server-secret';

const issue = (over: Record<string, unknown> = {}) =>
  issueContextPacket(
    {
      scenario_id: SCENARIO,
      authenticated_user_id: USER,
      graph_revision: REV,
      captured_at_turn: 7,
      state: { entities: [{ id: 'price' }] },
      ...over,
    },
    SECRET,
  );

const expectation = (over: Record<string, unknown> = {}) => ({
  scenario_id: SCENARIO,
  authenticated_user_id: USER,
  graph_revision: REV,
  current_turn: 7,
  binding_secret: SECRET,
  ...over,
});

describe('issueContextPacket — only the server can mint one', () => {
  it('issues a frozen packet carrying a binding', () => {
    const p = issue();
    expect(typeof p.binding).toBe('string');
    expect(p.binding).toMatch(/^[0-9a-f]{64}$/);
    expect(Object.isFrozen(p)).toBe(true);
  });

  it('is deterministic — the same inputs and secret always bind identically', () => {
    expect(issue().binding).toBe(issue().binding);
  });

  it('a DIFFERENT secret produces a different binding', () => {
    const a = issue();
    const b = issueContextPacket({ ...a }, OTHER_SECRET);
    expect(b.binding).not.toBe(a.binding);
  });

  it('the binding covers the STATE, not just the subject', () => {
    const a = issue();
    const b = issue({ state: { entities: [{ id: 'churn' }] } });
    expect(b.binding).not.toBe(a.binding);
  });
});

describe('a packet that was not issued by this server is INVALIDATED', () => {
  it('⛔ a fabricated packet with all the right fields is refused', () => {
    // The fabricator knows the scenario, the user and the revision — everything
    // the field comparison checks. Only the binding stops it.
    const forged: CanonicalContextPacket = {
      scenario_id: SCENARIO,
      authenticated_user_id: USER,
      graph_revision: REV,
      captured_at_turn: 7,
      state: { entities: [] },
      binding: 'f'.repeat(64),
    };
    const r = assessContextFreshness(forged, expectation());
    expect(r.kind).toBe('invalidated');
    if (r.kind === 'invalidated') expect(r.reason).toBe('binding_invalid');
  });

  it('⛔ a packet minted with the WRONG secret is refused', () => {
    const p = issueContextPacket({ ...issue() }, OTHER_SECRET);
    expect(assessContextFreshness(p, expectation()).kind).toBe('invalidated');
  });

  it('⛔ TAMPERING with the state after issue invalidates it', () => {
    const p = issue();
    const tampered = { ...p, state: { entities: [{ id: 'injected' }] } };
    const r = assessContextFreshness(tampered, expectation());
    expect(r.kind).toBe('invalidated');
    if (r.kind === 'invalidated') expect(r.reason).toBe('binding_invalid');
  });

  it('⛔ TAMPERING with the user after issue invalidates it — a packet cannot be re-pointed', () => {
    const p = issue();
    const stolen = { ...p, authenticated_user_id: 'user-b' };
    const r = assessContextFreshness(stolen, expectation({ authenticated_user_id: 'user-b' }));
    expect(r.kind).toBe('invalidated');
    if (r.kind === 'invalidated') expect(r.reason).toBe('binding_invalid');
  });

  it('⛔ a packet with NO binding at all is refused — absence is not a pass', () => {
    const { binding: _drop, ...unbound } = issue();
    const r = assessContextFreshness(unbound as CanonicalContextPacket, expectation());
    expect(r.kind).toBe('invalidated');
  });

  it('BINDING IS CHECKED FIRST — a forged packet for another scenario reports binding_invalid, not scenario_mismatch', () => {
    const forged: CanonicalContextPacket = {
      scenario_id: '22222222-2222-2222-2222-222222222222',
      authenticated_user_id: USER,
      graph_revision: REV,
      captured_at_turn: 7,
      state: {},
      binding: 'f'.repeat(64),
    };
    const r = assessContextFreshness(forged, expectation());
    expect(r.kind).toBe('invalidated');
    // An untrusted claim must not be dressed up as a diagnosis about scenarios.
    if (r.kind === 'invalidated') expect(r.reason).toBe('binding_invalid');
  });
});

describe('a properly issued packet still obeys every freshness rule', () => {
  it('is fresh when it matches', () => {
    expect(assessContextFreshness(issue(), expectation()).kind).toBe('fresh');
  });

  it('is STALE when the revision moved — a valid binding does not make it current', () => {
    const r = assessContextFreshness(issue(), expectation({ graph_revision: 'b'.repeat(64) }));
    expect(r.kind).toBe('stale');
  });

  it('is INVALIDATED for a genuinely different subject, even though it was validly issued', () => {
    const otherScenario = issueContextPacket(
      { scenario_id: '22222222-2222-2222-2222-222222222222', authenticated_user_id: USER, graph_revision: REV, captured_at_turn: 7, state: {} },
      SECRET,
    );
    const r = assessContextFreshness(otherScenario, expectation());
    expect(r.kind).toBe('invalidated');
    if (r.kind === 'invalidated') expect(r.reason).toBe('scenario_mismatch');
  });
});
