/**
 * D4 (a) (post-F; DL 12 Oct adopting PL #94 6131809231): "Without a change, we expect it to reach 10 weeks next quarter.
 * … by the end of that quarter" is the END of the next calendar quarter from the reference day, never a rolling 3 months.
 * The existing route places a calendar point by asking for its date in the brief's OWN words (no clock, no rounding). The
 * brief's deadline was not recognised at all ("absent"), so the drafter's rolling 3 months was asked as if it were the
 * deadline ("…within 3 months?").
 *
 * The corpus is T6's exact D4 drafts (`fixtures/t6-d4-drafts.json`, sha-checked), through the real construction.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import t6 from './fixtures/t6-d4-drafts.json';
import { attestHorizon } from '../horizon-attestation.js';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const BRIEF = t6.brief;
const SHA = {
  'raw/B/D4-reduce-cycle-time-r1-call2.json': '2469e8db8a7f14ee68ece2240e4bb616f5c48e6723b3e9fe8f1857af0baa151f',
  'raw/B/D4-reduce-cycle-time-r2-call1.json': 'aeb272d7b8d233381446ad3138e04c406197281550e597000263969b91703336',
} as Record<string, string>;
const bDrafts = t6.drafts.filter((d) => d.source.startsWith('raw/B/'));

async function questionsOf(rawText: string, brief = BRIEF): Promise<string[]> {
  const dispatch: InternalDispatch = async (path) => (path.endsWith('/graph/register')
    ? { status: 200, json: { model_version: { version_number: 1 } } } : { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } });
  const call = (async () => ({ text: rawText })) as unknown as CallStructuredModel;
  const r = await buildModelFromBrief('77777777-7777-4777-8777-777777777777', brief, dispatch, call) as Rec;
  expect(r.ok, JSON.stringify(r).slice(0, 300)).toBe(true);
  return r.open_questions as string[];
}

describe('IDENTITY: T6\'s D4 B drafts, byte for byte; each claims a rolling 3 months', () => {
  it('sha-checked; goal.horizon_months 3 in both; the brief says "next quarter … by the end of that quarter"', () => {
    for (const d of bDrafts) expect(createHash('sha256').update(d.raw_text).digest('hex')).toBe(SHA[d.source]);
    expect(bDrafts.map((d) => JSON.parse(d.raw_text).goal.horizon_months)).toEqual([3, 3]);
    expect(BRIEF).toContain('next quarter');
    expect(BRIEF).toContain('by the end of that quarter');
  });
});

describe('the deadline is the brief\'s calendar point, asked in its own words; never the drafter\'s 3 months', () => {
  it('attestHorizon: unresolved, the brief\'s own span, no month count', () => {
    expect(attestHorizon(BRIEF, { horizon_months: 3 })).toEqual({ months: null, wording: 'by the end of that quarter', status: 'unresolved' });
  });
  for (const d of bDrafts) {
    it(`${d.source}: the first question asks which date the brief's words mean; none offers "within 3 months"`, async () => {
      const q = await questionsOf(d.raw_text);
      // The route's held-words form: the deadline's own words are kept on the goal (no date, no month count).
      expect(q[0]).toBe('Which date does "by the end of that quarter" mean? It is the deadline your brief sets for "median delivery cycle"; '
        + 'the model keeps your words but no date, so no result answers whether it is met by then.');
      expect(q.some((s) => /within 3 months/.test(s))).toBe(false);
    });
  }
  it('CONTROL: "by the end of next quarter" was already a calendar point; unchanged', () => {
    expect(attestHorizon('We want it below 7 weeks by the end of next quarter.', { horizon_months: 3 }))
      .toEqual({ months: null, wording: 'by the end of next quarter', status: 'unresolved' });
  });
  it('CONTROL: a duration the brief writes is still attested ("within 3 months")', () => {
    expect(attestHorizon('We want it below 7 weeks within 3 months.', { horizon_months: 3 })).toMatchObject({ months: 3, status: 'attested' });
  });
  it('NEGATIVE: "that quarter" with no by/before/until is no deadline', () => {
    expect(attestHorizon('Sales in that quarter were slow.', { horizon_months: 3 })).toEqual({ months: null, wording: '', status: 'absent' });
  });
});
