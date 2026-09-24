/**
 * The context binding had a signer, a verifier, six test files and NO source for
 * its secret — no config key, no caller. That looked like a blocked credential.
 * It is not: the packet never leaves the process, so a per-process key gives the
 * only property the binding needs — nothing can mint a verifying packet without
 * going through the signer.
 *
 * These tests pin that, and pin the reason it is safe: an unverifiable packet is
 * `invalidated`, which costs the tool-omission saving and never grants anything.
 */
import { describe, it, expect } from 'vitest';
import {
  contextBindingSecret, issueContextPacket, assessContextFreshness,
} from '../runtime/request-assembly.js';

const SCENARIO = '44444444-4444-4444-8444-444444444444';
const USER = 'user-a';
const REV = 'r'.repeat(64);

const fields = (over: Partial<Parameters<typeof issueContextPacket>[0]> = {}) => ({
  scenario_id: SCENARIO,
  authenticated_user_id: USER,
  graph_revision: REV,
  captured_at_turn: 3,
  state: { nodes: 2 },
  ...over,
});
const expectation = (over: Record<string, unknown> = {}) => ({
  scenario_id: SCENARIO,
  authenticated_user_id: USER,
  graph_revision: REV,
  current_turn: 3,
  binding_secret: contextBindingSecret(),
  ...over,
}) as Parameters<typeof assessContextFreshness>[1];

describe('the context binding secret is a per-process key, and it is enough', () => {
  it('is stable within the process, so a packet verifies on the turn that made it', () => {
    expect(contextBindingSecret()).toBe(contextBindingSecret());
    expect(contextBindingSecret().length, 'a 32-byte key as hex').toBe(64);
  });

  it('a packet minted with it is FRESH — this is the saving the binding was blocking', () => {
    const packet = issueContextPacket(fields(), contextBindingSecret());
    expect(assessContextFreshness(packet, expectation())).toEqual({ kind: 'fresh' });
  });

  it('a packet signed with a DIFFERENT secret is invalidated, not merely stale', () => {
    const forged = issueContextPacket(fields(), 'not-the-server-secret');
    // `binding_invalid` and not `stale`: an untrusted claim must never be dressed
    // up as a diagnosis about revisions.
    expect(assessContextFreshness(forged, expectation())).toEqual({ kind: 'invalidated', reason: 'binding_invalid' });
  });

  it('a TAMPERED payload under a good binding is invalidated — the binding covers the state', () => {
    const packet = issueContextPacket(fields(), contextBindingSecret());
    const tampered = { ...packet, state: { nodes: 999 } };
    expect(assessContextFreshness(tampered, expectation())).toEqual({ kind: 'invalidated', reason: 'binding_invalid' });
  });

  /**
   * Discriminating control 1 — a MISSING env var. If the secret were read from the
   * environment, an unset variable would hand every request the empty string,
   * which still verifies against itself while looking configured. Measured: this
   * mutant fails 2 of these tests.
   */
  it('a packet minted with the empty string does NOT verify', () => {
    const wellKnown = issueContextPacket(fields(), '');
    expect(assessContextFreshness(wellKnown, expectation())).toEqual({ kind: 'invalidated', reason: 'binding_invalid' });
    expect(contextBindingSecret(), 'an env-var default would be the empty string').not.toBe('');
  });

  /**
   * Discriminating control 2 — a HARDCODED constant. Control 1 alone does not
   * catch this: I ran the mutant `processBindingSecret ??= 'f'.repeat(64)` and all
   * six tests passed, so the "not a fixed value" claim was unpinned. A literal in
   * source is strictly weaker than a per-process key, because this repository is
   * PUBLIC — anyone could then mint a verifying packet, and the only thing still
   * stopping them is that a packet has no way into the process.
   *
   * Character diversity pins it without asserting the value: 32 random bytes as
   * hex draw from 16 symbols and effectively always show more than 8 distinct
   * ones over 64 characters, while `''` shows 0 and any padded or repeated
   * constant shows 1.
   */
  it('is not a hardcoded or padded constant — it carries real entropy', () => {
    const secret = contextBindingSecret();
    expect(new Set(secret).size, `a repeated or padded constant would show 1 distinct character: ${secret.slice(0, 8)}…`).toBeGreaterThan(8);
    expect(secret, 'hex only, so the HMAC key space is what it appears to be').toMatch(/^[0-9a-f]{64}$/);
  });

  it('the binding is checked BEFORE subject and revision, so a forgery cannot be read as staleness', () => {
    const forged = issueContextPacket(fields({ scenario_id: 'someone-elses' }), 'wrong-secret');
    const verdict = assessContextFreshness(forged, expectation());
    expect(verdict).toEqual({ kind: 'invalidated', reason: 'binding_invalid' });
  });
});
