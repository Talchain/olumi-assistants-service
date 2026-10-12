/**
 * Batch F (DL 12 Oct; T5 meaning loss, `recovery/t5-meaning/DIAGNOSIS.md` §3 (b2)): the drafter's question that carries
 * the interviews' "10–20% churn" range was deleted whenever ANY number in it equalled the size of ANY link Olumi set aside
 * (`withoutSetAsideAmounts`). A drafter question is removed only when it restates THAT link's size: it names the link
 * (every word of one end, a word of the other) and writes the size as that link's kind of quantity (its target's unit).
 *
 * The corpus is the AIE's T5 raw drafts of the D3 brief (`fixtures/row5-range-drafts-t5.json`, sha-checked), through the
 * real construction (`buildModelFromBrief`) at this head. A r2 sets three sizes aside (60, £400 and £20 per paying
 * customer); its range question writes "10–20%", a percentage, and names neither end of the £20 link.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import t5 from './fixtures/row5-range-drafts-t5.json';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const BRIEF = (t5.briefs as Record<string, string>)['D3-pricing-money-denominator']!;
const draft = (arm: string, run: string) => t5.drafts.find((d) => d.case.startsWith('D3') && d.arm === arm && d.sample.includes(`-${run}-`))!;
async function build(rawText: string): Promise<Rec> {
  const dispatch: InternalDispatch = async (path) => path.endsWith('/graph/register')
    ? { status: 200, json: { model_version: { version_number: 1 } } } : { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  const call = (async () => ({ text: rawText })) as unknown as CallStructuredModel;
  const result = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', BRIEF, dispatch, call) as Rec;
  expect(result.ok, JSON.stringify(result).slice(0, 300)).toBe(true);
  return result;
}
const unknownsOf = (rawText: string): string[] => JSON.parse(rawText).unknowns as string[];

describe('T5 D3: the drafter\'s range question survives a set-aside size it does not restate', () => {
  it('IDENTITY: the four D3 drafts, byte for byte; the brief\'s interviews state 10–20% churn', () => {
    for (const d of t5.drafts.filter((x) => x.case.startsWith('D3'))) expect(createHash('sha256').update(d.raw_text).digest('hex')).toBe(d.raw_sha256);
    expect(BRIEF).toContain('Customer interviews suggest that raising the price could cause 10–20% churn');
  });
  it('A r2: the range question is kept, though £20 per paying customer was set aside (its 20 is a percentage, on no end of that link)', async () => {
    const d = draft('A', 'r2');
    const range = unknownsOf(d.raw_text).find((q) => q.includes('10–20%'))!;
    const result = await build(d.raw_text);
    expect((result.set_aside_estimates as Rec[]).map((s) => [s.from, s.to]), 'its reason: the sizes set aside')
      .toContainEqual(['paying_customers_at_month_3', 'monthly_recurring_revenue']);
    expect(result.open_questions).toContain(range);
  });
  it('CONTRAST: A r2\'s question that restates the £20 per paying customer of that same link ("monthly recurring revenue … £20") is still not shown', async () => {
    const d = draft('A', 'r2');
    const restates = unknownsOf(d.raw_text).find((q) => q.includes('monthly recurring revenue') && q.includes('£20'))!;
    expect(restates).toBeDefined();
    expect((await build(d.raw_text)).open_questions).not.toContain(restates);
  });
  /** A r2's draft with one more drafter question (design placement; the words are named below). */
  const withQuestion = (q: string): string => { const c = JSON.parse(draft('A', 'r2').raw_text) as Rec; c.unknowns = [...c.unknowns, q]; return JSON.stringify(c); };
  it('the same money amount on no end of the link is kept: C r2\'s served "GBP 20" question, placed in A r2 (where £20 per customer is set aside)', async () => {
    const q = unknownsOf(draft('C', 'r2').raw_text).find((x) => x.includes('GBP 20'))!;
    expect(q).toMatch(/^Would annual contracts be sold at the same GBP 20 monthly-equivalent price/);
    expect((await build(withQuestion(q))).open_questions).toContain(q);
  });
  it('the same money amount, written as £, on no end of the link is kept (design: the served question\'s words with "£20")', async () => {
    const q = 'Would annual contracts be sold at the same £20 monthly-equivalent price, at a discount, or with an upfront payment only?';
    expect((await build(withQuestion(q))).open_questions).toContain(q);
  });
  it('the link named but another kind of quantity is kept (design): "20% fewer paying customers at month 3" is not £20 per customer', async () => {
    const q = 'Could 20% fewer paying customers at month 3 cut monthly recurring revenue?';
    expect((await build(withQuestion(q))).open_questions).toContain(q);
  });
  it('CONTRAST: A r1 (only the price → churn size set aside) keeps its range question, as before', async () => {
    const d = draft('A', 'r1');
    const range = unknownsOf(d.raw_text).find((q) => q.includes('10–20%'))!;
    expect((await build(d.raw_text)).open_questions).toContain(range);
  });
});
