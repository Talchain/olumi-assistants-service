/**
 * ⭐ SYSTEM 3, STEP 1 (DL re-plan 14 Oct): ONE authorship authority for every subject (`authorshipOf`). This step changes no
 * behaviour: each new subject is proven to AGREE with the rule today's consumers apply, on served bytes where they exist,
 * so step 3 can route those consumers through the authority one file at a time.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authorshipOf, provenanceOf, requestWasTyped, type Origin } from '../provenance-of.js';
import { typedByUser } from '../../../orchestrator-v5/agent-lane/stated-by-user.js';
import { valueAuthorshipOf as guidanceValueAuthorshipOf } from '../../../orchestrator-v5/agent-lane/turn-context/guidance-signals.js';
import { valueAuthorshipOf } from '../provenance-of.js';

type Rec = Record<string, any>;
/** Served hiring positive r4 (CEE e7f95dc6), the server read after the deadline approval. */
const R4 = JSON.parse(readFileSync(new URL('../../../orchestrator-v5/agent-lane/__tests__/fixtures/hiring-positive-r4-turn06.json', import.meta.url), 'utf8')) as { graph: Rec };

describe('words: who said it (the authority\'s answer; `userStated` is its one caller for words, LEAN CORE)', () => {
  // Today's formula, verbatim, so any drift in the authority is caught.
  const before = (verified: boolean, unknown: boolean, sourceComplete: boolean, ownEstimate: boolean): Origin =>
    verified ? 'human' : unknown || (!sourceComplete && !ownEstimate) ? 'unknown' : 'ai';
  it('agrees with the K3 formula on all 16 combinations', () => {
    for (const verified of [true, false]) for (const unknown of [true, false]) for (const complete of [true, false]) for (const own of [true, false]) {
      const want = before(verified, unknown, complete, own);
      expect(authorshipOf({ words: { verified, unknown, sourceComplete: complete, ownEstimate: own } }).origin).toBe(want);
    }
  });
  it('a request is typed only from the composer (or an API caller): a chip, a retry or a system event never is', () => {
    const cases: [Rec, boolean][] = [
      [{ kind: 'message', source: 'composer' }, true], [{ kind: 'message' }, true], [{}, true],
      [{ kind: 'message', source: 'chip', chip: { id: 'x' } }, false], [{ kind: 'message', source: 'chip_click' }, false],
      [{ kind: 'message', source: 'retry' }, false], [{ kind: 'system_event' }, false], [{ kind: 'message', chip: { id: 'x' } }, false],
    ];
    for (const [body, typed] of cases) { expect(requestWasTyped(body), JSON.stringify(body)).toBe(typed); expect(typedByUser(body)).toBe(typed); }
  });
});

describe('node display tags (served hiring r4 graph)', () => {
  // hiring-times.ts's rule today: unverified_brief → unknown, ai_inferred → Olumi's, any other tag → the user's.
  const consumer = (tag: unknown): Origin => (tag === 'unverified_brief' ? 'unknown' : tag === 'ai_inferred' ? 'ai' : 'human');
  const tierOf = (tag: unknown): Origin => { const p = authorshipOf({ nodeTag: tag }); return p.origin === 'human' && p.role === 'unverified' ? 'unknown' : p.origin; };
  it('every served node\'s tag answers as today, and the tags it holds are the ones the authority knows', () => {
    const tags = (R4.graph.nodes as Rec[]).map((n) => n.provenance).filter((t) => t !== undefined);
    expect(tags.length).toBeGreaterThan(5);
    for (const t of tags) expect(['user', 'user_set', 'from_brief', 'unverified_brief', 'ai_inferred']).toContain(t);
    for (const t of tags) expect(tierOf(t), String(t)).toBe(consumer(t));
  });
  it('a brief tag is the person\'s by its stamp alone (labelled where a chance rests on it, never withheld)', () => {
    expect(authorshipOf({ nodeTag: 'from_brief' })).toMatchObject({ origin: 'human', stampOnly: true });
    expect(authorshipOf({ nodeTag: 'user_set' })).toMatchObject({ origin: 'human', role: 'verified' });
    expect(authorshipOf({ nodeTag: undefined }).origin).toBe('unknown');
  });
});

describe('cards, risks and team time', () => {
  it('a card is the user\'s only when authored_by is user_stated (approval-chips\' rule), Olumi\'s when model_proposed', () => {
    expect(authorshipOf({ card: { authored_by: 'user_stated' } }).origin).toBe('human');
    expect(authorshipOf({ card: { authored_by: 'model_proposed' } }).origin).toBe('ai');
    expect(authorshipOf({ card: {} }).origin).toBe('unknown');
    expect(authorshipOf({ card: undefined }).origin).toBe('unknown');
  });
  it('a risk\'s occurrence basis: user → the person\'s, olumi → Olumi\'s (risk-occurrence.ts\' rule)', () => {
    expect(authorshipOf({ eventRisk: { occurrence: { basis: 'user' } } }).origin).toBe('human');
    expect(authorshipOf({ eventRisk: { occurrence: { basis: 'olumi' } } }).origin).toBe('ai');
    expect(authorshipOf({ eventRisk: { occurrence: {} } }).origin).toBe('unknown');
  });
  it('a team time\'s olumi_estimate range is Olumi\'s (team-share-write.ts\' rule)', () => {
    expect(authorshipOf({ teamRange: 'olumi_estimate' }).origin).toBe('ai');
    expect(authorshipOf({ teamRange: undefined }).origin).toBe('unknown');
  });
});

describe('values, settings and links: the existing authority, unchanged and unduplicated', () => {
  it('authorshipOf delegates to provenanceOf, and guidance-signals\' valueAuthorshipOf IS the authority\'s', () => {
    const goal = (R4.graph.nodes as Rec[]).find((n) => n.observed_state !== undefined);
    expect(goal).toBeDefined();
    expect(authorshipOf({ value: goal!.observed_state })).toEqual(provenanceOf({ value: goal!.observed_state }));
    expect(guidanceValueAuthorshipOf).toBe(valueAuthorshipOf);
  });
});
