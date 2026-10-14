/**
 * ⭐ RESTART CONTINUITY (DL 17:18Z, 14 Oct): typed words survive a redeploy, proven from the durable row itself.
 *
 * After a redeploy the process forgets what the user typed: every reseeded row was source-unknown, so a figure the user
 * typed before the deploy came back `origin_unknown` (marketing, 14 Oct). The durable answer row already says which
 * words were typed: its `request_hash` is `agentTurnRequestHash(scenario, subject, message)` with a chip press marked
 * `#chip:` and an approval's operation bound inside the digest. A row whose hash is the PLAIN hash of its own words was
 * sent with no chip and no operation: typed, by the same rule as `typedByUser`.
 *
 * Rows are the served hiring scenario 42d10ecf's own answer rows (read-only, `v5_conversation_turns`, 14 Oct 16:38–16:42Z),
 * hashes byte for byte; newest first, as `readRecent` returns them.
 */
import { describe, expect, it } from 'vitest';
import { HistoryStore, historyFromDurableTurns, type DurableRow } from '../history-store.js';
import { agentTurnRequestHash, typedRowProof } from '../../../routes/agent-v1-turn.js';
import { verifyStatements } from '../user-statements.js';

const SCENARIO = '42d10ecf-34c5-4c0a-ba6b-e2186b47c2c8';
const BRIEF = "Should I hire a Tech lead or two developers to increase productivity by at least 10%, while maintaining code quality? We have an urgent launch date in the next three months. We currently have six mid-weight developers, so we're lacking leadership. Our budget is £200,000, but we'd like to spend less.";
const SIZES = 'For this model: hiring a Tech lead would raise productivity by about 8% of today’s, and each additional developer by about 3% of today’s.';
const OTHERS = 'For the remaining links, please use your own estimates.';
const MEANING = 'I mean at least 10% more than today’s productivity, achieved by the launch date. We measure productivity as story points completed per sprint.';
/** Oldest first; reversed below into readRecent's newest-first order. */
const SERVED: DurableRow[] = [
  { request_hash: 'agent_turn:9a851ac19ed2d8bac2fcca9cfab3644623ab3282bf2fb4b841d873fde0aa8d9f', user_message: BRIEF, assistant_message: 'a' },
  { request_hash: 'agent_turn:400a2b652bc6638e28387d706de44488b7b5070a53147a3f58fd598570ea49bc', user_message: 'Yes, that is my deadline.', assistant_message: 'a' }, // the card press
  { request_hash: 'agent_turn:195ef34e51d16f95c4899aab63f034572fc58ddbbbbd70c9470f90ca820aed34', user_message: SIZES, assistant_message: 'a' },
  { request_hash: 'agent_turn:d41270988ec059f728330b79a01b8be81f8f275d1d08aef9170033f7cc29e9fc', user_message: OTHERS, assistant_message: 'a' },
  { request_hash: 'agent_turn:9ee3205a9573bf7e7ac01b26c17b7d7f44c4598004ca5fb46397e328dc367be6', user_message: 'Yes, record those.', assistant_message: 'a' }, // the card press
  { request_hash: 'agent_turn:9065583b7c4c0baa91f2178039a67ba0057c5bfa331855d924f0750d6075340e', user_message: MEANING, assistant_message: 'a' },
];
const ROWS = [...SERVED].reverse();
/** The route's own proof, as its reseed passes it (`agent-v1-turn.ts` `typedRowProof`). */
const proofFor = (subject: string | null) => typedRowProof(SCENARIO, subject);

function reseeded(proof?: (row: DurableRow) => boolean) {
  const h = new HistoryStore();
  h.seed('sess', historyFromDurableTurns(ROWS), [], ROWS, proof);
  return h;
}

describe('a redeploy keeps what the user typed, from the row\'s own request hash', () => {
  it('⭐ RED→GREEN: the brief and the three typed sentences are typed again, in order; the two card presses are not', () => {
    const h = reseeded(proofFor(null));
    expect(h.typedWords('sess')).toEqual([BRIEF, SIZES, OTHERS, MEANING]);
    expect(h.authorshipWords('sess').verified).toEqual(expect.arrayContaining([SIZES, MEANING]));
    expect(h.typedWords('sess')).not.toContain('Yes, record those.');
    expect(h.typedWords('sess')).not.toContain('Yes, that is my deadline.');
  });

  it('⭐ RED→GREEN real path: a figure typed before the redeploy verifies as the user\'s, not origin_unknown', () => {
    const words = reseeded(proofFor(null)).authorshipWords('sess');
    const verdict = verifyStatements([{ quote: SIZES, form: 'point', value: 8 }],
      { now: null, conversation: words.verified.join('\n'), unverified: words.unknown.join('\n') },
      { subject: 'effect', unit: '%', forms: ['point'], figuresIn: () => [{ low: 8, high: 8 }, { low: 3, high: 3 }] } as never);
    expect(verdict.kind, JSON.stringify(verdict)).toBe('verified');
  });

  it('CONTROL (today\'s behaviour, no proof): every reseeded word stays source-unknown', () => {
    const h = reseeded();
    expect(h.typedWords('sess')).toEqual([]);
    const words = h.authorshipWords('sess');
    const verdict = verifyStatements([{ quote: SIZES, form: 'point', value: 8 }],
      { now: null, conversation: words.verified.join('\n'), unverified: words.unknown.join('\n') },
      { subject: 'effect', unit: '%', forms: ['point'], figuresIn: () => [{ low: 8, high: 8 }] } as never);
    expect(verdict).toMatchObject({ kind: 'refused', refusal: 'origin_unknown' });
  });

  it('NEGATIVE: another subject\'s rows never prove typed (the hash binds the subject)', () => {
    expect(reseeded(proofFor('someone-else')).typedWords('sess')).toEqual([]);
  });

  it('NEGATIVE: a chip press of plain-looking words is never typed (its hash carries #chip:)', () => {
    const chip = `${agentTurnRequestHash(SCENARIO, null, OTHERS)}#chip:0123456789abcdef0123456789abcdef`;
    const rows = [{ request_hash: chip, user_message: OTHERS, assistant_message: 'a' }];
    const h = new HistoryStore();
    h.seed('sess', historyFromDurableTurns(rows), [], rows, proofFor(null));
    expect(h.typedWords('sess')).toEqual([]);
  });
});
