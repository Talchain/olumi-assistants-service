/**
 * ⭐ A BRIEF'S OWN LABEL IS KEPT WHOLE, AND THE MODEL STAYS EDITABLE (52f8cd; DL #75 5923299932).
 *
 * The construction budget was 33, derived from `structural_add_edge`'s `Connected ${from} to ${to}` summary and its
 * 80-char fact cap. Measured live then: labels of 53 and 18 produced 85 characters, CEE refused with
 * `refusal_reason: "fact_invalid"`, and the model was uneditable. Every structural summary builder now bounds its own
 * composition (fallback + clamp to `SAFE_SUMMARY_MAX_CHARS`), so the 33 cut only destroyed meaning: served paul-1/2
 * showed "Hours per week on…" on every surface. The budget is now 80, above every brief label measured (37–59), and it
 * still shortens the drafter's sentence-length options (config B, over 80).
 *
 * The editable-model guarantee is asserted on the REAL builders below, for the longest pair the budget admits. A
 * string the test composes itself is not one.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, shortLabel, slugId, type CandidateModel } from '../admit-model.js';
import { buildAddEdgeSafeSummary } from '../../system-events/structural-add-edge.js';
import { buildRenameSafeSummary } from '../../system-events/structural-rename.js';
import { buildAddSafeSummary } from '../../system-events/structural-add.js';
import { SAFE_SUMMARY_MAX_CHARS } from '../../handlers/edit-graph-fact-builder.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { compactGraph } from '../../../orchestrator/context/graph-compact.js';

const d = new URL('./fixtures/', import.meta.url);
const raw = (f: string) => JSON.parse(readFileSync(new URL(f, d), 'utf8')) as CandidateModel;
const admitted = (f: string) => admitCandidateModel(raw(f), {});
const nodeLabelled = (f: string, label: string) => admitted(f).nodes.find((n) => n.label === label);

/** Real drafter labels from config C, all over the old 33 budget and within the new one. */
const KEPT = [
  'Competitor pricing and feature positioning', // 42, a factor
  'Existing-customer migration and grandfathering policy', // 53, a factor
  'The higher price increases monthly churn above the 4% constraint', // 64, a risk
  'Increase the Pro plan price to £59/month with the next Pro feature release', // 74, an option
];

describe('a brief-length label survives admission whole', () => {
  it('RED: every config C label up to 80 characters is admitted exactly as drafted, with no shortening', () => {
    const m = admitted('configC.json');
    for (const label of KEPT) {
      const n = m.nodes.find((x) => x.label === label);
      expect(n, `${label.length}: ${label}`).toBeDefined();
      expect(m.loss.some((l) => l.field_path === `nodes[${n!.id}].label`), `no ledger entry for ${label}`).toBe(false);
    }
  });

  it('RED: …and survives the write validator (GraphV3) and the Agent’s read of the model (compactGraph) unchanged', () => {
    const m = admitted('configC.json');
    const parsed = GraphV3.safeParse({ nodes: m.nodes, edges: m.edges });
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues.slice(0, 3))).toBe(true);
    const read = compactGraph(parsed.success ? parsed.data : (undefined as never));
    for (const label of KEPT) {
      const id = m.nodes.find((x) => x.label === label)!.id;
      expect(read.nodes.find((x) => x.id === id)?.label).toBe(label);
    }
  });

  it('CONTROL (id/label): the id is the drafted label’s own slug, as before; the cap never moved an id', () => {
    const n = nodeLabelled('configC.json', KEPT[1]!)!;
    expect(n.id).toBe(slugId(KEPT[1]!));
  });

  it('CONTROL: a sentence-length draft over 80 is still shortened, the full text kept on the description', () => {
    const long = 'Existing Pro customers react negatively if the increase applies to them without a migration or grandfathering policy';
    expect(long.length).toBeGreaterThan(80);
    const m = admitted('configC.json');
    const n = m.nodes.find((x) => x.description === long || x.label === long);
    expect(n?.label).not.toBe(long);
    expect(n?.label.length).toBeLessThanOrEqual(80);
    expect(n?.label.endsWith('…')).toBe(true);
  });
});

describe('the model stays editable: every structural summary built from admitted labels fits the fact cap', () => {
  it('⭐ the REAL builders bound their own composition for the longest admitted pair (config B and C)', () => {
    for (const f of ['configB.json', 'configC.json']) {
      const labels = admitted(f).nodes.map((n) => n.label);
      const [a, b] = [...labels].sort((x, y) => y.length - x.length);
      const summaries = [
        buildAddEdgeSafeSummary(a!, b ?? a!),
        buildRenameSafeSummary(a!, b ?? a!),
        buildAddSafeSummary('factor', a!),
      ];
      for (const s of summaries) expect(s.length, `${f}: ${s}`).toBeLessThanOrEqual(SAFE_SUMMARY_MAX_CHARS);
    }
  });

  it('⭐ …and at the budget’s worst case: two labels of exactly 80 characters', () => {
    const eighty = 'x'.repeat(80);
    expect(buildAddEdgeSafeSummary(eighty, eighty).length).toBeLessThanOrEqual(SAFE_SUMMARY_MAX_CHARS);
    expect(buildRenameSafeSummary(eighty, eighty).length).toBeLessThanOrEqual(SAFE_SUMMARY_MAX_CHARS);
    expect(buildAddSafeSummary('factor', eighty).length).toBeLessThanOrEqual(SAFE_SUMMARY_MAX_CHARS);
  });

  it('the capture really has labels that would have blown the old pair composition (control)', () => {
    const longest = Math.max(...raw('configB.json').options.map((o: { label: string }) => o.label.length));
    expect(longest, 'config B emits sentence-length option labels').toBeGreaterThan(80);
  });
});

describe('shortening, where it still happens', () => {
  it('preserves the full text on the node rather than discarding it', () => {
    const m = admitted('configB.json');
    const shortened = m.nodes.filter((n) => n.description !== undefined && n.label.endsWith('…'));
    expect(shortened.length).toBeGreaterThan(0);
    for (const n of shortened) expect(n.description!.length).toBeGreaterThan(n.label.length);
  });

  it('records each shortening in the ledger', () => {
    const m = admitted('configB.json');
    const entries = m.loss.filter((l) => l.field_path.endsWith('.label'));
    expect(entries.length).toBe(m.nodes.filter((n) => n.description !== undefined && n.label.endsWith('…')).length);
  });

  it('shortLabel keeps an 80-character label whole and cuts a longer one at a word boundary, never mid-word', () => {
    expect(shortLabel('Hours per week on investment-firm outreach')).toBe('Hours per week on investment-firm outreach');
    const out = shortLabel('Defer the price-change decision until price sensitivity, churn, and feature-value evidence is available');
    expect(out.length).toBeLessThanOrEqual(80);
    expect(out.endsWith('…')).toBe(true);
    expect(out).not.toMatch(/\s…$/);
  });
});
