/**
 * Candidate admission — magnitude honesty.
 *
 * ⭐ THE FIXTURES ARE CAPTURES, NOT INVENTIONS. `faithful.json` and
 * `widened.json` are the verbatim outputs of the banked construction chain run
 * against the live API on 22 Sep 2026 (gpt-4.1 strict builder; gpt-5.6-terra
 * widener at effort high, 6,000 output headroom). A self-authored fixture would
 * only confirm the author's model of the producer; these came from outside it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateLinks, noUnmarkedMagnitudes, isFullyAuthored, type CandidateLink } from '../admit-candidate.js';

const here = new URL('./fixtures/', import.meta.url);
const faithful = JSON.parse(readFileSync(new URL('faithful.json', here), 'utf8'));
const widened = JSON.parse(readFileSync(new URL('widened.json', here), 'utf8'));

const capturedLinks: CandidateLink[] = [
  ...faithful.links.map((l: Record<string, string>) => ({
    from: l.from, to: l.to, direction: l.direction as CandidateLink['direction'], provenance: l.provenance,
  })),
  ...widened.proposed_links.map((l: Record<string, string>) => ({
    from: l.from, to: l.to, direction: l.direction as CandidateLink['direction'], provenance: l.provenance,
  })),
];

describe('admitCandidateLinks — the captured candidate', () => {
  it('the capture actually exercises the hazard (control on the fixture itself)', () => {
    // If this ever goes to zero the fixture stopped testing anything and every
    // assertion below would pass vacuously.
    expect(capturedLinks.length).toBeGreaterThanOrEqual(15);
    const authoredMagnitudes = capturedLinks.filter((l) => 'strength_mean' in l).length;
    expect(authoredMagnitudes, 'captured candidate should author no magnitudes').toBe(0);
    const unknownDirections = capturedLinks.filter((l) => l.direction === 'unknown').length;
    expect(unknownDirections, 'capture must contain the unknown-direction case').toBeGreaterThan(0);
  });

  it('withholds every link whose direction nobody authored — and says why', () => {
    const r = admitCandidateLinks(capturedLinks);
    const unknown = capturedLinks.filter((l) => l.direction === 'unknown');
    expect(r.withheld).toHaveLength(unknown.length);
    for (const u of unknown) {
      const w = r.withheld.find((x) => x.from === u.from && x.to === u.to);
      expect(w, `withheld entry for ${u.from}->${u.to}`).toBeDefined();
      expect(w!.reason).toBe('no_authored_direction');
    }
    // Bound by identity: the withheld link must NOT appear among the edges.
    for (const u of unknown) {
      expect(r.edges.some((e) => e.from === u.from && e.to === u.to)).toBe(false);
    }
  });

  it('marks every unauthored magnitude as defaulted — none reads as authored', () => {
    const r = admitCandidateLinks(capturedLinks);
    expect(r.edges.length).toBeGreaterThan(0);
    expect(noUnmarkedMagnitudes(r)).toBe(true);
    for (const e of r.edges) {
      expect(e.defaulted, `${e.from}->${e.to} magnitude must be marked defaulted`).toBe(true);
      expect(e.provenance?.source, 'a model-proposed link must never claim user authorship')
        .not.toBe('user_specified');
    }
  });

  it('records the representation loss per field, not as a bare count', () => {
    const r = admitCandidateLinks(capturedLinks);
    const meanLoss = r.loss.filter((l) => l.field_path.endsWith('.strength.mean'));
    const existsLoss = r.loss.filter((l) => l.field_path.endsWith('.exists_probability'));
    expect(meanLoss).toHaveLength(r.edges.length);
    expect(existsLoss).toHaveLength(r.edges.length);
    for (const entry of meanLoss) {
      expect(entry.before).toBeNull();
      expect(typeof entry.after).toBe('number');
      expect(entry.severity).toBe('warn');
      expect(entry.reason).toMatch(/never be presented as user- or evidence-authored/);
    }
  });

  it('CONTRAST CONTROL: an authored magnitude is kept verbatim, and no mean-loss is recorded', () => {
    const authored: CandidateLink[] = [
      { from: 'a', to: 'b', direction: 'positive', provenance: 'explicit', strength_mean: 0.83 },
    ];
    const r = admitCandidateLinks(authored);
    expect(r.edges).toHaveLength(1);
    expect(r.edges[0].strength.mean).toBe(0.83);
    expect(r.loss.filter((l) => l.field_path.endsWith('.strength.mean'))).toHaveLength(0);
    // ⚠ This assertion previously read `defaulted` toBeUndefined, which ENCODED
    // the defect: std and exists_probability are still ours on this edge, so the
    // edge genuinely does carry numbers nobody authored and must say so.
    expect(r.edges[0].defaulted).toBe(true);
    expect(noUnmarkedMagnitudes(r), 'every projection is marked and ledgered').toBe(true);
  });

  it('CONTROL: an edge whose EVERY numeric is authored is not marked at all', () => {
    const r = admitCandidateLinks([
      {
        from: 'a', to: 'b', direction: 'positive', provenance: 'explicit',
        strength_mean: 0.83, strength_std: 0.04, existence_probability: 0.97,
      },
    ]);
    expect(r.edges[0].strength).toEqual({ mean: 0.83, std: 0.04 });
    expect(r.edges[0].exists_probability).toBe(0.97);
    expect(r.edges[0].defaulted, 'nothing here was chosen by us').toBeUndefined();
    expect(r.loss, 'and nothing is ledgered, because nothing was projected').toHaveLength(0);
    expect(isFullyAuthored(r)).toBe(true);
  });

  it('a negative direction projects a NEGATIVE magnitude, not a positive one', () => {
    const r = admitCandidateLinks([{ from: 'x', to: 'y', direction: 'negative', provenance: 'ai_proposed' }]);
    expect(r.edges[0].strength.mean).toBeLessThan(0);
    expect(r.edges[0].effect_direction).toBe('negative');
  });
});
