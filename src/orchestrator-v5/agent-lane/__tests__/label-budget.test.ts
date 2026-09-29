/**
 * A label longer than 33 characters makes the model UNEDITABLE.
 *
 * `structural_add_edge` composes `Connected ${from} to ${to}` into its handler
 * fact's `safe_summary`, which the schema caps at 80. Measured live: labels of
 * 53 and 18 produced 85 characters, CEE refused with
 * `refusal_reason: "fact_invalid"` and told the user "I couldn't record that
 * properly, so I haven't changed the model" — committing the turn honestly and
 * writing no graph.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, shortLabel, type CandidateModel } from '../admit-model.js';

const d = new URL('./fixtures/', import.meta.url);
const admitted = (f: string) => admitCandidateModel(JSON.parse(readFileSync(new URL(f, d), 'utf8')) as CandidateModel, {});

describe('label budget', () => {
  it('ANY pair of admitted labels composes under the 80-char cap', () => {
    for (const f of ['configC.json', 'configB.json']) {
      const labels = admitted(f).nodes.map((n) => n.label);
      const longest = [...labels].sort((a, b) => b.length - a.length).slice(0, 2);
      const summary = `Connected ${longest[0]} to ${longest[1] ?? longest[0]}`;
      expect(summary.length, `${f}: worst-case safe_summary`).toBeLessThanOrEqual(80);
    }
  });

  it('the capture really has labels that would have blown it (control)', () => {
    const raw = JSON.parse(readFileSync(new URL('configB.json', d), 'utf8'));
    const longest = Math.max(...raw.options.map((o: { label: string }) => o.label.length));
    expect(longest, 'config B emits sentence-length option labels').toBeGreaterThan(80);
  });

  it('preserves the full text on the node rather than discarding it', () => {
    const m = admitted('configB.json');
    const shortened = m.nodes.filter((n) => n.description !== undefined);
    expect(shortened.length).toBeGreaterThan(0);
    for (const n of shortened) {
      expect(n.description!.length).toBeGreaterThan(n.label.length);
      expect(n.label.endsWith('…')).toBe(true);
    }
  });

  it('records each shortening in the ledger', () => {
    const m = admitted('configB.json');
    const entries = m.loss.filter((l) => l.field_path.endsWith('.label'));
    expect(entries.length).toBe(m.nodes.filter((n) => n.description !== undefined).length);
  });

  it('shortLabel cuts at a word boundary, never mid-word', () => {
    expect(shortLabel('short one')).toBe('short one');
    const out = shortLabel('Raise Pro to 59 for new subscribers at the feature release');
    expect(out.length).toBeLessThanOrEqual(33);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
});
