/**
 * LEADER_HONESTY against REAL model wording — corpus v4 (65 withheld replies, 34 leaking, 31 clean).
 * Labels are blind (fresh-context classifier, blind reviewer #63 5822982121), never the scorer's own.
 * Before this change the scorer caught 12 of 34 (it could not see "the £59-at-release path", and had no
 * "scores highest" / "produces the strongest" cue). Clean replies must stay clean: over-flagging would
 * make every withheld Run look like a leak.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { leaderClaimsIn } from '../src/checks.js';
import { buildOptionMatchers } from '../src/options.js';
import { sentencesOf } from '../src/text.js';

const corpus = JSON.parse(readFileSync(new URL('./fixtures/leader-corpus-v4.json', import.meta.url), 'utf8')) as { id: string; label: 'names_leader' | 'clean'; text: string }[];
const labels = ['Keep Pro at £49', 'Raise Pro to £59 at release', 'Phase Pro price increase'];
const m = buildOptionMatchers(labels);
// The same path checkLeaderHonesty takes: sentence by sentence over the model's words.
const flagged = (t: string) => sentencesOf(t, 'model').some((s) => leaderClaimsIn(s.text, m, labels).length > 0);
const leaking = corpus.filter((c) => c.label === 'names_leader');
const clean = corpus.filter((c) => c.label === 'clean');

describe('LEADER_HONESTY on the real withheld-leader corpus', () => {
  it('the corpus is what it claims', () => expect([leaking.length, clean.length]).toEqual([34, 31]));
  it('flags every blind-labelled leak', () => {
    expect(leaking.filter((c) => !flagged(c.text)).map((c) => c.id)).toEqual([]);
  });
  it('flags none of the blind-labelled clean replies', () => {
    expect(clean.filter((c) => flagged(c.text)).map((c) => c.id)).toEqual([]);
  });
});
