/**
 * ⛔ THE LINKS A LEVEL NEEDS ARE NAMED, NEVER "CHANGES" (#2004 added the `links` part): the user read
 * "Saved 1 of 1 changes." for the option → factor link their approval added.
 */
import { describe, it, expect } from 'vitest';
import { narrateWriteOutcome } from '../write-outcome.js';

const said = (parts: Record<string, unknown>[], extra: Record<string, unknown> = {}): string =>
  narrateWriteOutcome('', [{ name: 'authorise_change' }], [{ ok: true, mutated: true, applied: true, parts, ...extra }]).status;

describe('a compound approval names the links it added', () => {
  it('RED: one link and two levels → "Saved 1 of 1 links. Saved 2 of 2 option levels."', () => {
    expect(said([
      { part: 'links', ok: true, recorded_count: 1, requested_count: 1 },
      { part: 'option_levels', ok: true, recorded_count: 2, requested_count: 2 },
    ])).toBe('Saved 1 of 1 links. Saved 2 of 2 option levels.');
  });

  it('RED: none written → "Not saved: the link."', () => {
    expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [{ ok: false, mutated: false, parts: [
      { part: 'links', ok: false, recorded_count: 0, requested_count: 1 },
    ] }]).status).toBe('Not saved: the link.');
  });

  it('CONTROL: an unnamed part is still "changes", never a code', () => {
    expect(said([{ part: 'something_new', ok: true, recorded_count: 1, requested_count: 1 }])).toBe('Saved 1 of 1 changes.');
  });
});
