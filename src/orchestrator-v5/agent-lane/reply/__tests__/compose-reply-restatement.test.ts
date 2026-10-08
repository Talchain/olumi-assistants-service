import { describe, expect, it } from 'vitest';
import { composeReplyShape, sentenceMultiset, type FaceObligation } from '../compose-reply.js';
import { LINK_RELATION, namedUnsizedLinks, QUOTED_LABEL, THROUGH_RELATION, UNSIZED_CAUSE } from '../named-unsized-links.js';

const graph = { nodes: [
  { id: 'support', label: 'Support cost' },
  { id: 'loss', label: 'MRR lost to support strain' },
  { id: 'monthly_support', label: 'Monthly starter support cost per subscriber' },
  { id: 'starter_loss', label: 'MRR lost to starter support strain' },
  { id: 'price', label: 'Plan price' },
  { id: 'revenue', label: 'Monthly revenue' },
] };
const closing = 'This comparison turns on the link from ‘Support cost’ to ‘MRR lost to support strain’, whose strength isn’t sized in the model yet.';
const obligation: FaceObligation = { role: 'withheld_reason', text: closing, subjects: ['support→loss'] };
const restatement = 'The link from Support cost to MRR lost to support strain has no size yet.';
const headline = 'The model records an unresolved assumption.';
const tail = 'The figures describe the current model and retain the assumptions that need testing with evidence from the team.';
const face = (c: ReturnType<typeof composeReplyShape>): string => c.shape === null ? c.text : [c.shape.headline, ...c.shape.bullets].join('\n');

describe('D-03: the one composer moves narrator restatements by directed link identity', () => {
  it.each([
    restatement,
    'Support cost affects MRR lost to support strain, whose strength is not sized in the model yet.',
    'The comparison turns on ‘Support cost’ to ‘MRR lost to support strain’.',
  ])('keeps the typed closing on the face, and every sentence including "%s" in the reply', (narrator) => {
    const text = `${narrator} ${headline}\n\n${closing}\n\n${tail}`;
    const c = composeReplyShape({ text, graph, obligations: [obligation] });
    expect(c.outcome).toBe('shaped');
    expect(face(c)).toContain(closing);
    expect(face(c)).not.toContain(narrator);
    expect(c.shape!.headline).toBe(headline);
    expect(c.shape!.detail).toContain(narrator);
    expect(c.measure?.restatements_to_detail).toBe(1);
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(text));
  });

  it('compacted labels resolve to the same link despite different words in the closing', () => {
    const typed = 'This comparison turns on the link from ‘Monthly starter support cost per subscriber’ to ‘MRR lost to starter support strain’, whose strength isn’t sized in the model yet.';
    const narrator = 'The link from ‘Monthly starter support…’ to ‘MRR lost to starter…’ has no size yet.';
    const text = `${narrator} ${headline}\n\n${typed}\n\n${tail}`;
    const c = composeReplyShape({ text, graph, obligations: [{ role: 'withheld_reason', text: typed, subjects: ['monthly_support→starter_loss'] }] });
    expect(face(c)).toContain(typed);
    expect(face(c)).not.toContain(narrator);
    expect(c.shape!.detail).toContain(narrator);
    expect(c.measure?.restatements_to_detail).toBe(1);
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(text));
  });

  it.each([
    ['a different unsized link', 'The link from Plan price to Monthly revenue has no size yet.'],
    ['the same link without the cause', 'Support cost drives MRR lost to support strain.'],
    ['the reversed link', 'The link from MRR lost to support strain to Support cost has no size yet.'],
    ['a partial word', 'The link from ExtraSupport cost to MRR lost to support strain has no size yet.'],
  ])('CONTROL: %s stays eligible for the face', (_name, narrator) => {
    const c = composeReplyShape({ text: `${narrator} ${headline}\n\n${closing}\n\n${tail}`, graph, obligations: [obligation] });
    expect(face(c)).toContain(narrator);
    expect(c.measure?.restatements_to_detail).toBe(0);
  });

  it('CONTROL: no subjects gives the existing composer output, byte for byte', () => {
    const text = `${restatement} ${headline}\n\n${closing}\n\n${tail}`;
    const c = composeReplyShape({ text, graph, obligations: [{ role: 'withheld_reason', text: closing }] });
    // Today's small-detail shortcut returns the original prose without attaching a sidecar.
    expect(c).toEqual(composeReplyShape({ text, obligations: [{ role: 'withheld_reason', text: closing }] }));
    expect(c).toMatchObject({ text, shape: null, outcome: 'already_in_shape', measure: { restatements_to_detail: 0 } });
  });

  it('CONTROL: absent withheld text or subjects on a different role give no restatement licence', () => {
    for (const o of [{ ...obligation, text: 'Absent cause.' }, { ...obligation, role: 'evidence' as const }]) {
      const c = composeReplyShape({ text: `${restatement} ${headline}\n\n${closing}\n\n${tail}`, graph, obligations: [o] });
      expect(face(c)).toContain(restatement);
      expect(c.measure?.restatements_to_detail).toBe(0);
    }
  });

  it.each([`${restatement} ${closing}`, `- ${restatement}\n\n${closing}`])('a short restatement cannot bypass disclosure or become the fallback headline: %s', (text) => {
    const c = composeReplyShape({ text, graph, obligations: [obligation] });
    expect(c.outcome).toBe('shaped');
    expect(c.shape!.headline).toBe(closing);
    expect(c.shape!.detail).toContain(restatement);
    expect(face(c)).not.toContain(restatement);
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(text));
  });

  it('a narrator bullet or question stating the cause goes to detail, even when the closing contains a typed ask', () => {
    const typed = `${closing} What evidence sizes this link?`;
    const question = 'Does the link from Support cost to MRR lost to support strain have no size yet?';
    const text = `${headline}\n- ${restatement}\n- Keep the assumption visible.\n\n${typed}\n\n${question}`;
    const c = composeReplyShape({ text, graph, obligations: [
      { role: 'withheld_reason', text: typed, subjects: obligation.subjects },
      { role: 'ask', text: 'What evidence sizes this link?' },
    ] });
    expect(face(c)).toContain(typed);
    expect(face(c)).not.toContain(restatement);
    expect(face(c)).not.toContain(question);
    expect(c.shape!.detail).toContain(restatement);
    expect(c.shape!.detail).toContain(question);
    expect(c.measure?.restatements_to_detail).toBe(2);
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(text));
  });

  it('ambiguous compacted labels do not name a subject, including ambiguity outside the held links', () => {
    const ambiguous = { nodes: [...graph.nodes, { id: 'other', label: 'Monthly starter support hours' }] };
    expect(namedUnsizedLinks('‘Monthly starter support…’ to ‘MRR lost to starter…’', new Set(['monthly_support→starter_loss']), ambiguous).size).toBe(0);
    expect(namedUnsizedLinks('‘Unknown support’ to ‘MRR lost to starter…’', new Set(['monthly_support→starter_loss']), graph).size).toBe(0);
  });

  it('end-to-end wording resolves both recorded links through the named intermediate node', () => {
    expect([...namedUnsizedLinks('‘Support cost’ to ‘Monthly revenue’ through ‘MRR lost to support strain’', new Set(['support→loss', 'loss→revenue']), graph)]).toEqual(['support→loss', 'loss→revenue']);
  });
});

describe('timing: all new bounded regexes, 5k → 20k, ratio < 8×', () => {
  const rows: [string, (s: string) => unknown, (n: number) => string][] = [
    ['cause', s => UNSIZED_CAUSE.test(s), n => 'x'.repeat(n)],
    ['quoted labels', s => [...s.matchAll(QUOTED_LABEL)], n => '‘'.repeat(n)],
    ['link relation', s => LINK_RELATION.test(s), n => ' '.repeat(n)],
    ['through relation', s => THROUGH_RELATION.test(s), n => ' '.repeat(n)],
    ['word boundary', s => namedUnsizedLinks(s, new Set(['support→loss']), graph), n => 'Support cost'.repeat(Math.ceil(n / 12))],
  ];
  it.each(rows)('%s', (name, test, make) => {
    const batch = (s: string, calls: number): number => {
      const start = performance.now();
      for (let i = 0; i < calls; i++) test(s);
      return performance.now() - start;
    };
    const small = make(5_000), large = make(20_000);
    batch(large, 10);
    const calls = Math.min(50_000, Math.max(1, Math.ceil(40 / Math.max(batch(large, 10) / 10, 0.001))));
    let tSmall = Infinity, tLarge = Infinity;
    for (let i = 0; i < 7; i++) {
      tSmall = Math.min(tSmall, batch(small, calls));
      tLarge = Math.min(tLarge, batch(large, calls));
    }
    console.info(`TIMING ${name}: 5k ${tSmall.toFixed(3)}ms → 20k ${tLarge.toFixed(3)}ms; ratio ${(tLarge / tSmall).toFixed(3)}×; ${calls} calls`);
    expect(tLarge / Math.max(tSmall, 0.05)).toBeLessThan(8);
  });
});

describe('B15 (Codex r2 P2 #2783): a unit carrying a lead chance beside other words never leads by any selector', () => {
  const share = 'In this model, 73% of runs supported ‘Launch starter tier’.';
  const chance = '‘Launch starter tier’: about 52% chance of meeting your goal, in this model.';
  const lead: FaceObligation = { role: 'evidence', text: chance, lead: true };
  it('restatement fallback: the share-led mixed bullet is not the headline; the typed closing is', () => {
    const text = `- ${share} ${chance}\n\n${restatement}\n\n${closing}`;
    const c = composeReplyShape({ text, graph, obligations: [obligation, lead] });
    expect(c.measure?.restatements_to_detail, 'control: the restatement selector is the one in play').toBe(1);
    expect(c.shape?.headline ?? '').not.toContain(share);
    expect(c.shape?.headline).toBe(closing);
    expect(sentenceMultiset(c.text)).toEqual(sentenceMultiset(text));
  });
});

describe('withShapeOnlyIfItDerives (Codex r2 P1 #2783): a shape an egress edited alone never ships', () => {
  it('drops a shape whose derivation differs from the shipped text; keeps one that derives it', async () => {
    const { withShapeOnlyIfItDerives } = await import('../compose-reply.js');
    const { deriveAnswerTextFromShape } = await import('../../../routing/answer-shape.js');
    const shape = { headline: 'Raise prices 10%: about 34%.', bullets: ['Hire team leads: about 47%.'], detail: 'More words here for the detail.' };
    const text = deriveAnswerTextFromShape(shape);
    expect(withShapeOnlyIfItDerives({ assistant_text: text, _answer_shape: shape })._answer_shape, 'control: a proven shape rides').toEqual(shape);
    const edited = { ...shape, bullets: [] };
    const out = withShapeOnlyIfItDerives({ assistant_text: text, _answer_shape: edited });
    expect(out._answer_shape).toBeUndefined();
    expect(out.assistant_text).toBe(text);
  });
});
