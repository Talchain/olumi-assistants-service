/**
 * ⛔ A GUEST'S CONFIRMED SAVE SAYS "Saved." — never "No version number was recorded for it."
 *
 * Paul's test 1a298d6d (17:50Z, guest): "Use these 3 starting figures" → "Saved. No version number was recorded for
 * it." Guests' saves are never versioned (the guest store policy), so that line read as a fault on EVERY guest
 * approval (matrix C14, item (E)); it was served again on CEE e3b0844 (Canonical 5842648209). For a signed-in user a
 * save without a version is still an anomaly worth saying, so that line stays for them.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { narrateWriteOutcome } from '../write-outcome.js';

const approve = [{ name: 'authorise_change' }];
const landed = [{ ok: true, applied: true, mutated: true }];
const versioned = [{ ok: true, applied: true, mutated: true, receipts: [{ version: 7 }] }];

describe('the save line a guest reads', () => {
  it('RED: a guest\'s confirmed save → "Saved." and nothing about a version number', () => {
    const r = narrateWriteOutcome('', approve, landed as never, { versioned: false });
    expect(r.status).toBe('Saved.');
  });

  it('CONTRAST: signed in, a save with no version is still said (an anomaly for them)', () => {
    expect(narrateWriteOutcome('', approve, landed as never).status).toBe('Saved. No version number was recorded for it.');
    expect(narrateWriteOutcome('', approve, landed as never, { versioned: true }).status).toBe('Saved. No version number was recorded for it.');
  });

  it('a save WITH a version reads the same for both', () => {
    const guest = narrateWriteOutcome('', approve, versioned as never, { versioned: false }).status;
    expect(guest).toBe(narrateWriteOutcome('', approve, versioned as never).status);
    expect(guest).toMatch(/version 7/);
  });

  it('RED: every narration call in the Agent route says whether this caller is versioned (a guest is not)', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const calls = route.match(/narrateWriteOutcome\([^;]*/g) ?? [];
    expect(calls.length, 'the scan sees the call sites').toBeGreaterThanOrEqual(2);
    for (const c of calls) expect(c).toContain('{ versioned: userId !== null }');
  });
});
