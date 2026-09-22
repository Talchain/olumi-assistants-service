/**
 * A brief-derived figure is `brief_extraction`, NOT `user_specified`.
 *
 * ⭐ WHY THIS IS NOT PEDANTRY. `src/cee/provenance/money-invariant.ts:211` gates
 * its whole audit on exactly this stamp:
 *
 *     if (observed.source !== "brief_extraction") continue;
 *
 * That invariant exists to ask "does the figure this model holds actually appear
 * in the user's brief?" — and it answers by auditing THE SYSTEM'S OWN CLAIM to
 * have read it from their words. Stamping `user_specified` instead does two
 * things, both wrong: it asserts the user set the value directly, and it removes
 * the figure from that audit entirely. A £49 that never appeared in the brief
 * would then pass unnoticed.
 *
 * Measured with the invariant itself: with `source: 'brief_extraction'` plus a
 * `cap`, a model holding £49 against a brief stating £79 produces
 * `STATED_MAGNITUDE_UNRECONCILED`. With the stamp this lane was writing, it
 * produces nothing.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { admitCandidateLinks } from '../admit-candidate.js';

const d = new URL('./fixtures/', import.meta.url);
const faithful = JSON.parse(readFileSync(new URL('faithful.json', d), 'utf8')) as CandidateModel;
const widened = JSON.parse(readFileSync(new URL('widened.json', d), 'utf8'));

describe('brief-derived authorship', () => {
  it('a node whose figure came from the brief is stamped brief_extraction', () => {
    const m = admitCandidateModel(faithful, widened);
    const price = m.nodes.find((n) => (n.description ?? n.label) === 'Pro plan price');
    expect(price, 'the capture carries a stated price').toBeDefined();
    expect(price!.observed_state?.value).toBe(49);
    // The builder marked this factor provenance 'explicit' — meaning the user
    // stated it IN THE BRIEF, which is brief_extraction, not a direct UI edit.
    // Node display vocabulary; the durable value authorship is on observed_state.
    expect(price!.provenance).toBe('from_brief');
    expect((price!.observed_state as Record<string, unknown>).source).toBe('brief_extraction');
  });

  it('no admitted entity claims a direct user edit from a brief-derived candidate', () => {
    const m = admitCandidateModel(faithful, widened);
    const overstated = m.nodes.filter((n) => n.provenance === 'user_set');
    expect(
      overstated.map((n) => n.label),
      'nothing in a brief-derived candidate was set directly by the user',
    ).toEqual([]);
  });

  it('a brief-derived LINK is also brief_extraction', () => {
    const r = admitCandidateLinks([
      { from: 'a', to: 'b', direction: 'positive', provenance: 'explicit' },
    ]);
    expect(r.edges[0].provenance?.source).toBe('brief_extraction');
  });

  it('CONTROL: an explicit provenance_source override still wins', () => {
    const r = admitCandidateLinks([
      { from: 'a', to: 'b', direction: 'positive', provenance: 'explicit', provenance_source: 'user_specified' },
    ]);
    expect(r.edges[0].provenance?.source).toBe('user_specified');
  });

  it('CONTROL: a model-proposed addition is still cee_hypothesis, not brief_extraction', () => {
    const r = admitCandidateLinks([
      { from: 'a', to: 'b', direction: 'positive', provenance: 'ai_proposed' },
    ]);
    expect(r.edges[0].provenance?.source).toBe('cee_hypothesis');
  });
});
