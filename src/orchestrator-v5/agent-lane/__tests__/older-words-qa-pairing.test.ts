/**
 * EXPERIMENT arm B (exp/mem0-context-spike-20260929; CEE_CONTEXT_INHOUSE_QA_PAIRING): the user's older words carry the
 * question Olumi asked just before them. Off → today's bytes exactly.
 */
import { describe, expect, it } from 'vitest';
import { HistoryStore, lastQuestionOf, olderWordsItem } from '../history-store.js';

const user = (t: string) => ({ role: 'user', content: [{ type: 'input_text', text: t }] });
const olumi = (t: string) => ({ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: t }] });

/** A 10-turn conversation: turn 2 answers a strength question; the 8-turn window drops turns 1–2. */
function conversation(store: HistoryStore): string | undefined {
  const said = ['Should we raise our price?', 'It is a moderate effect.', ...Array.from({ length: 8 }, (_, i) => `follow-up ${i}`)];
  const replies = ['Noted. How strongly does price affect churn?', 'Thanks.', ...Array.from({ length: 8 }, () => 'OK.')];
  for (let i = 0; i < said.length; i += 1) {
    // Exactly as the route does: the held (already trimmed) history plus this turn's items.
    store.recordTyped('s', said[i]!);
    store.set('s', [...store.get('s'), user(said[i]!), olumi(replies[i]!)]);
  }
  const first = store.get('s')[0] as { content: { text: string }[] };
  return first.content[0]!.text;
}

describe('older words, paired with the question they answered', () => {
  it('CONTRAST CONTROL — pairing off: the older-words item is exactly today’s', () => {
    const off = conversation(new HistoryStore());
    expect(off).toContain('- "It is a moderate effect."');
    expect(off).not.toContain('Olumi asked');
    expect(olderWordsItem(['a', 'b'])).toEqual(olderWordsItem(['a', 'b'], undefined, undefined));
  });

  it('pairing on: "moderate" says WHAT is moderate', () => {
    const on = conversation(new HistoryStore(undefined, undefined, () => true));
    expect(on).toContain('- Olumi asked: "How strongly does price affect churn?" → user: "It is a moderate effect."');
  });

  it('lastQuestionOf takes the final question of a reply, capped', () => {
    expect(lastQuestionOf('Saved. What is your churn today? And how strong is the link?')).toBe('And how strong is the link?');
    expect(lastQuestionOf('No question here.')).toBeUndefined();
    expect(lastQuestionOf(`${'x'.repeat(400)}?`)!.length).toBeLessThanOrEqual(201);
  });
});
