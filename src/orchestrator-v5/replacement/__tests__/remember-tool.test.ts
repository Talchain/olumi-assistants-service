/**
 * Recording what the USER established.
 *
 * The gap this closes was found by sweep, not by review: `user_fact` had
 * ZERO runtime writers while the contrast — `ai_suggestion` and
 * `authorised_change` — had three. The record held only what the assistant
 * had done.
 */

import { describe, expect, it } from 'vitest';

import { EMPTY_CONVERSATION_MEMORY, recordItem, type ConversationMemory } from '../conversation-memory.js';
import { REMEMBER_TOOL_NAME, createRememberTool } from '../remember-tool.js';

const tool = createRememberTool({ getMemory: () => EMPTY_CONVERSATION_MEMORY });

describe('it records the four kinds that are the user\'s', () => {
  it('takes a fact in their own words', async () => {
    const out = await tool.execute({
      items: [{ kind: 'user_fact', text: 'Churn went from 3% to 4.4% in 2024' }],
    });
    expect(out.type).toBe('remembered');
    if (out.type !== 'remembered') return;
    expect(out.items).toHaveLength(1);
    expect(out.items[0]?.kind).toBe('user_fact');
    expect(out.items[0]?.text).toBe('Churn went from 3% to 4.4% in 2024');
  });

  it('accepts every allowed kind, enumerated rather than sampled', async () => {
    for (const kind of ['user_fact', 'user_preference', 'open_question', 'disagreement'] as const) {
      const out = await tool.execute({ items: [{ kind, text: 'something' }] });
      expect(out.type, `kind "${kind}" must be accepted`).toBe('remembered');
    }
  });

  it('carries a correction through, so a superseded claim stops being live', async () => {
    const out = await tool.execute({
      items: [{ kind: 'user_fact', text: 'Actually it was 4.2%, not 4.4%', supersedes: 'i-earlier' }],
    });
    if (out.type !== 'remembered') throw new Error('expected remembered');
    expect(out.items[0]?.supersedes).toBe('i-earlier');
  });

  it('is declared a remember tool, so the loop will not let anything else write the record', () => {
    expect(tool.kind).toBe('remember');
    expect(tool.definition.name).toBe(REMEMBER_TOOL_NAME);
  });
});

describe('the two kinds it must never write', () => {
  /**
   * Both are refusals rather than prompt rules because a rule that must hold
   * EVERY time cannot live in a prompt: measured at temperature 0, two
   * identical runs obeyed a plainly-stated prompt rule once out of twice.
   */
  it('refuses to record its own suggestion as something the user established', async () => {
    const out = await tool.execute({
      items: [{ kind: 'ai_suggestion', text: 'Set churn to 0.44' }],
    });
    expect(out.type).toBe('refused');
    if (out.type !== 'refused') return;
    expect(out.content).toContain('cannot record your own suggestion');
    expect(out.content).toContain('stops "you suggested it" turning into "it is so"');
  });

  it('refuses to record that something was saved — only a receipt does that', async () => {
    const out = await tool.execute({
      items: [{ kind: 'authorised_change', text: 'Updated Monthly Churn Rate' }],
    });
    expect(out.type).toBe('refused');
    if (out.type !== 'refused') return;
    expect(out.content).toContain('Only an actual receipt');
  });

  it('refuses a kind it does not know, and says which it takes', async () => {
    const out = await tool.execute({ items: [{ kind: 'vibe', text: 'x' }] });
    if (out.type !== 'refused') throw new Error('expected a refusal');
    expect(out.content).toContain('user_fact');
    expect(out.content).toContain('disagreement');
  });

  it('one bad entry refuses the WHOLE batch — a partial write would be a silent half-record', async () => {
    const out = await tool.execute({
      items: [
        { kind: 'user_fact', text: 'Churn is 3%' },
        { kind: 'authorised_change', text: 'and I saved it' },
      ],
    });
    expect(out.type).toBe('refused');
  });
});

describe('nothing is recorded from nothing', () => {
  it('refuses an empty batch', async () => {
    const out = await tool.execute({ items: [] });
    expect(out.type).toBe('refused');
    if (out.type !== 'refused') return;
    expect(out.content).toContain('only when the user has actually established something');
  });

  it('refuses a missing items field', async () => {
    expect((await tool.execute({})).type).toBe('refused');
  });

  it('refuses an entry whose text is blank or whitespace', async () => {
    expect((await tool.execute({ items: [{ kind: 'user_fact', text: '   ' }] })).type).toBe('refused');
  });
});

describe('the description carries the rules the model needs', () => {
  it('tells it to keep their words and not soften a disagreement', () => {
    const d = tool.definition.description;
    expect(d).toContain('in their own words');
    expect(d).toContain('do not summarise a number away or soften a disagreement');
    expect(d).toContain('neither is yours to assert');
  });
});

/**
 * MEASURED LIVE. On a four-turn run the model recorded a fact on turn 2 and
 * recorded the identical fact again on turn 3. Left alone the record fills
 * with repeats, every later prompt carries them, and to the user it reads
 * exactly like not having listened — the defect this tool exists to fix,
 * arriving through the fix itself.
 */
describe('it will not write the same thing twice', () => {
  const T = '2026-09-20T12:00:00.000Z';
  function withFact(text: string): ConversationMemory {
    return recordItem(EMPTY_CONVERSATION_MEMORY, {
      id: 'i1', kind: 'user_fact', text, source_turn_id: 't1', recorded_at: T,
    });
  }
  const FACT = 'When we raised prices in 2024 churn went from 3% to 4.4% within two months.';
  const dedup = (m: ConversationMemory) => createRememberTool({ getMemory: () => m });

  it('refuses an exact repeat and says what to do if it is a correction', async () => {
    const out = await dedup(withFact(FACT)).execute({ items: [{ kind: 'user_fact', text: FACT }] });
    expect(out.type).toBe('refused');
    if (out.type !== 'refused') return;
    expect(out.content).toContain('already on the record');
    expect(out.content).toContain('supersedes');
  });

  it('ignores case, spacing and a trailing full stop — the repeat is rarely byte-identical', async () => {
    const out = await dedup(withFact(FACT)).execute({
      items: [{ kind: 'user_fact', text: '  when we raised prices in 2024 CHURN went from 3% to 4.4%   within two months  ' }],
    });
    expect(out.type).toBe('refused');
  });

  it('refuses a repeat WITHIN one batch, not only against the stored record', async () => {
    const out = await dedup(EMPTY_CONVERSATION_MEMORY).execute({
      items: [{ kind: 'user_fact', text: FACT }, { kind: 'user_fact', text: FACT }],
    });
    expect(out.type).toBe('refused');
  });

  it('CONTRAST: the same text under a DIFFERENT kind is a different claim and is allowed', async () => {
    const out = await dedup(withFact(FACT)).execute({ items: [{ kind: 'disagreement', text: FACT }] });
    expect(out.type).toBe('remembered');
  });

  it('CONTRAST: a genuinely new fact still goes in — the guard is narrow', async () => {
    const out = await dedup(withFact(FACT)).execute({
      items: [{ kind: 'user_fact', text: 'Our customers are on annual contracts.' }],
    });
    expect(out.type).toBe('remembered');
  });

  it('a near-duplicate is NOT caught, and that is the deliberate limit', async () => {
    // Catching this would be a similarity predicate over natural language.
    // The tool does not try, and the docblock says so rather than implying
    // cover it does not give.
    const out = await dedup(withFact(FACT)).execute({
      items: [{ kind: 'user_fact', text: 'Churn rose to 4.4% after the 2024 price rise.' }],
    });
    expect(out.type).toBe('remembered');
  });
});
