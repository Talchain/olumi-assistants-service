import { describe, expect, it } from 'vitest';
import served from '../../../agent-lane/__tests__/fixtures/m1-s1-served-graphs.json';
import { linkSizing } from '../../../../cee/magnitude/link-sizing.js';
import { formatEdgeAdjustment, formatEdgeStrengthUnchanged } from '../d1-shared/format-confirmation.js';

type Edge = Record<string, unknown> & {
  from: string;
  to: string;
  strength: { mean: number; std: number };
};
const from = 'enterprise_prospect_signing_likelihood';
const to = 'quarterly_revenue';
const capture = served.cases.find((row) => row.graph.edges.some((edge) => edge.from === from && edge.to === to))!;
const doorDefault = (): Edge => structuredClone(capture.graph.edges.find((edge) => edge.from === from && edge.to === to)!) as unknown as Edge;
const labels = {
  fromLabel: capture.graph.nodes.find((node) => node.id === from)!.label,
  toLabel: capture.graph.nodes.find((node) => node.id === to)!.label,
};
const sized = (): Edge => ({
  ...doorDefault(), strength: { mean: 0.5, std: 0.1 },
  provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate' },
});

describe('P53x receipt words carry the edge sizing, including the saved post-state', () => {
  it('served D1 prospect → revenue binds the unsized default by identity', () => {
    const edge = doorDefault();
    expect(edge.from).toBe(from);
    expect(edge.to).toBe(to);
    expect(edge.strength).toEqual({ mean: 0.5, std: 0.125 });
    expect(edge.defaulted).toBe(true);
    expect(edge.provenance).toEqual({ source: 'cee_hypothesis' });
    expect(linkSizing(edge)).toBe('placeholder');
    const text = formatEdgeStrengthUnchanged({ ...labels, mean: 0.5, edge });
    expect(text).toContain('has not been sized yet');
    expect(text).not.toMatch(/\b(strong|moderate|slight)\b|Olumi.s estimate/);
  });

  it('a latent sized-before → placeholder-after receipt never names the after prior as a size', () => {
    const before = sized();
    const after = doorDefault();
    expect(linkSizing(before)).toBe('olumi_estimate');
    expect(linkSizing(after)).toBe('placeholder');
    // Science 393023 LICENCE ruling 3 (P53x), re-derived: identical .5 means formerly voiced "still strong";
    // the after edge is the served door default, so the receipt instead says its size is unknown.
    const text = formatEdgeAdjustment({ ...labels, beforeMean: 0.5, afterMean: 0.5, beforeEdge: before, afterEdge: after });
    expect(text).toContain('not sized yet');
    expect(text).not.toMatch(/\b(strong|moderate|slight)\b|Olumi.s estimate/);
  });

  it('a placeholder-before → sized-after receipt names only the authored result', () => {
    const before = doorDefault();
    const after = { ...sized(), strength: { mean: 0.1, std: 0.1 }, provenance: { source: 'user_specified' } };
    const text = formatEdgeAdjustment({ ...labels, beforeMean: 0.5, afterMean: 0.1, beforeEdge: before, afterEdge: after });
    expect(text).toContain('to slight; nobody had sized it before');
    expect(text).not.toContain('strong');
  });

  it('CONTROL: the same .5/.1 Olumi estimate preserves already-strong words', () => {
    const edge = sized();
    expect(linkSizing(edge)).toBe('olumi_estimate');
    expect(formatEdgeStrengthUnchanged({ ...labels, mean: 0.5, edge })).toBe(
      `The link between ${labels.fromLabel} and ${labels.toLabel} is already strong.`,
    );
  });

  it('CONTROL: an approved door default is sized in the saved state even when its numbers were kept', () => {
    const edge = {
      ...doorDefault(),
      provenance: { source: 'cee_hypothesis', magnitude: 'olumi_estimate', reviewed_by_user: { intent: 'confirm' } },
    };
    expect(linkSizing(edge)).toBe('olumi_accepted');
    const text = formatEdgeStrengthUnchanged({ ...labels, mean: 0.5, edge, unsized: true });
    expect(text).toContain('is already strong');
    expect(text).not.toContain('not been sized');
  });

  it('CONTROL: a sized before/after change keeps its existing band transition', () => {
    const before = sized();
    const after = { ...sized(), strength: { mean: 0.1, std: 0.1 } };
    expect(formatEdgeAdjustment({ ...labels, beforeMean: 0.5, afterMean: 0.1, beforeEdge: before, afterEdge: after })).toBe(
      `Adjusted the link between ${labels.fromLabel} and ${labels.toLabel} from strong to slight.`,
    );
  });

  it.each([
    [-0.3, 'is already moderate (negative).'],
    [0.01, 'already has no material influence.'],
  ] as const)('CONTROL: a sized mean %s retains its existing direction or near-zero words', (mean, said) => {
    const edge = { ...sized(), strength: { mean, std: 0.1 } };
    expect(formatEdgeStrengthUnchanged({ ...labels, mean, edge })).toBe(
      `The link between ${labels.fromLabel} and ${labels.toLabel} ${said}`,
    );
  });

  it('a projected user-drawn post-state remains unsized despite its numeric prior', () => {
    const edge = { ...doorDefault(), provenance: { source: 'user_specified', mean_projected: true } };
    expect(linkSizing(edge)).toBe('placeholder');
    const text = formatEdgeStrengthUnchanged({ ...labels, mean: 0.5, edge });
    expect(text).toContain('has not been sized yet');
    expect(text).not.toContain('strong');
  });
});
