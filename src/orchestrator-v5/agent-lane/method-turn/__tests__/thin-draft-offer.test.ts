import { describe, expect, it } from 'vitest';
import { favouredOptionOf, SUGGEST_RISKS_CHIP, THIN_DRAFT_BUTTON_MAX, thinDraftOffer, widenTargetOf } from '../widen-turn.js';

const paulGraph = (riskCount = 1) => ({
  nodes: [
    { id: 'mrr', kind: 'goal', label: 'MRR' },
    { id: 'raise_59', kind: 'option', label: 'Raise to £59', provenance: 'from_brief' },
    { id: 'test_54', kind: 'option', label: 'Test £54', provenance: 'olumi' },
    { id: 'keep_49', kind: 'option', label: 'Keep £49', is_baseline: true, provenance: 'from_brief' },
    ...Array.from({ length: riskCount }, (_, i) => ({ id: `risk_${i}`, kind: 'risk', label: `Draft risk ${i}` })),
  ],
  edges: [],
});
const genericButton = 'Suggest up to 3 more risks, including one against one of your options';

describe('P05b favoured option: provenance and identity', () => {
  it('1a Paul brief: exactly one from-brief non-baseline option, by id and exact label', () => {
    expect(favouredOptionOf(paulGraph())).toEqual({ id: 'raise_59', label: 'Raise to £59' });
  });
  it('1b t1b: two from-brief non-baseline options mean no favoured option', () => {
    const graph = paulGraph();
    graph.nodes = graph.nodes.map((n) => n.id === 'test_54' ? { ...n, provenance: 'from_brief' } : n);
    expect(favouredOptionOf(graph)).toBeNull();
  });
  it('1c baseline-only from-brief graph means no favoured option', () => {
    const graph = paulGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== 'option' || n.is_baseline === true);
    expect(favouredOptionOf(graph)).toBeNull();
  });
});

describe('P05b thin-draft offer: an offer, never a press', () => {
  it('2a one risk on this construction: exact face/button and byte-identical risks-door identity', () => {
    const offer = thinDraftOffer(paulGraph(), true);
    expect(offer).toEqual({
      face: 'Olumi found one risk in your brief.',
      button: 'Suggest up to 3 more risks, including one against ‘Raise to £59’',
      press: { ...SUGGEST_RISKS_CHIP, label: 'Suggest up to 3 more risks, including one against ‘Raise to £59’' },
    });
    expect(offer!.press.id).toBe(SUGGEST_RISKS_CHIP.id);
    expect(offer!.press.message).toBe(SUGGEST_RISKS_CHIP.message);
    expect(widenTargetOf(offer!.press.id, offer!.press.message)).toBe('risks');
  });
  it('2b zero risks: exact no-risks face', () => {
    expect(thinDraftOffer(paulGraph(0), true)?.face).toBe('Olumi found no risks in your brief.');
  });
  it('2c CONTRAST three risks: no thin-draft offer', () => {
    expect(thinDraftOffer(paulGraph(3), true)).toBeNull();
  });
  it('2d mutated=false: no thin-draft offer', () => {
    expect(thinDraftOffer(paulGraph(), false)).toBeNull();
  });
  it('2e no goal: no thin-draft offer', () => {
    const graph = paulGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== 'goal');
    expect(thinDraftOffer(graph, true)).toBeNull();
  });
  it('2f baseline-only options: no thin-draft offer', () => {
    const graph = paulGraph();
    graph.nodes = graph.nodes.filter((n) => n.kind !== 'option' || n.is_baseline === true);
    expect(thinDraftOffer(graph, true)).toBeNull();
  });
  it('7a one from-brief non-baseline option: named button', () => {
    expect(thinDraftOffer(paulGraph(), true)?.button)
      .toBe('Suggest up to 3 more risks, including one against ‘Raise to £59’');
  });
  it('7b zero from-brief non-baseline options: generic button', () => {
    const graph = paulGraph();
    graph.nodes = graph.nodes.map((n) => n.id === 'raise_59' ? { ...n, provenance: 'olumi' } : n);
    expect(thinDraftOffer(graph, true)?.button).toBe(genericButton);
  });
  it('7c two from-brief non-baseline options: generic button', () => {
    const graph = paulGraph();
    graph.nodes = graph.nodes.map((n) => n.id === 'test_54' ? { ...n, provenance: 'from_brief' } : n);
    expect(thinDraftOffer(graph, true)?.button).toBe(genericButton);
  });
});

describe('P05b button fits the stored answer-offer envelope (label 1–80 chars)', () => {
  it('9a a long favoured label falls back to the generic button, which fits; the press stays the risks door', () => {
    const graph = paulGraph();
    graph.nodes = graph.nodes.map((n) => n.id === 'raise_59' ? { ...n, label: 'Raise the Pro plan price to £59 with the next feature release' } : n);
    const offer = thinDraftOffer(graph, true)!;
    expect(offer.button).toBe(genericButton);
    expect(offer.press.label.length).toBeLessThanOrEqual(THIN_DRAFT_BUTTON_MAX);
    expect(offer.press).toEqual({ ...SUGGEST_RISKS_CHIP, label: genericButton });
  });
  it('9b CONTRAST: Paul\'s real label (‘Raise Pro price to £59’, stored draft fadb7513) keeps the named button within 80', () => {
    const graph = paulGraph();
    graph.nodes = graph.nodes.map((n) => n.id === 'raise_59' ? { ...n, label: 'Raise Pro price to £59' } : n);
    const offer = thinDraftOffer(graph, true)!;
    expect(offer.button).toBe('Suggest up to 3 more risks, including one against ‘Raise Pro price to £59’');
    expect(offer.button.length).toBeLessThanOrEqual(THIN_DRAFT_BUTTON_MAX);
  });
});
