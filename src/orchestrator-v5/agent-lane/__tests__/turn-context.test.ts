import { describe, expect, it } from 'vitest';
import { turnContextItems, runFactsContext, REASONING_CONTEXT_LABEL } from '../turn-context.js';

const item = (role: string, text: string) => ({ role, content: [{ type: role === 'assistant' ? 'output_text' : 'input_text', text }] });
const contextOf = (items: unknown[]) => {
  const text = items.flatMap(i => (i as ReturnType<typeof item>).content).map(c => c.text).find(t => t.startsWith(REASONING_CONTEXT_LABEL))!;
  return JSON.parse(text.slice(REASONING_CONTEXT_LABEL.length));
};

describe('S1 shared context: origin belongs to the occurrence', () => {
  it('identical chip and typed words do not share authorship; Olumi questions retain their complete conditions', () => {
    const text = 'Yes, at least 100 per week. Revenue was £2m on 2026-09-01.';
    const question = 'Is 100 per week your target, conditional on keeping the existing team?';
    const context = contextOf(turnContextItems({ now: new Date('2026-10-16T04:20:00Z'), briefText: 'Capacity planning.',
      verifiedUserMessages: [text], unknownUserText: text,
      conversation: [item('assistant', question), item('user', text), item('assistant', 'Use the existing figure?'), item('user', text)] }));
    expect(context.verified_user_statements).toEqual([{ speaker: 'user', source: 'typed', text }]);
    expect(context.unknown_origin).toEqual({ speaker: 'unknown', source: 'stored, origin not verified', text });
    expect(context.answered_pairs).toEqual([
      { olumi: { speaker: 'olumi', source: "Olumi's reply, not a user statement", text: question },
        response: { speaker: 'unknown', source: 'stored conversation; typed or chip origin not verified here', text } },
      { olumi: { speaker: 'olumi', source: "Olumi's reply, not a user statement", text: 'Use the existing figure?' },
        response: { speaker: 'unknown', source: 'stored conversation; typed or chip origin not verified here', text } },
    ]);
  });

  it('a question is never credited to a non-adjacent response, nor a tool result treated as a human answer', () => {
    const context = contextOf(turnContextItems({ now: new Date(), briefText: '', verifiedUserMessages: ['A later response.'],
      conversation: [item('assistant', 'Question one?'), item('user', 'First answer.'), item('user', 'A later response.'),
        { type: 'function_call_output', output: 'Yes, 100 per week.' }] }));
    expect(context.answered_pairs).toHaveLength(1);
    expect(context.answered_pairs[0].response.text).toBe('First answer.');
  });

  it('moving the instruction preserves every fact and all target warnings without modifying the canonical read', () => {
    const read = { ok: true, run_facts: { use: 'unchanged instruction', per_option: [
      { id: 'a', warning: 'withhold every total' }, { id: 'b', warning: 'withhold every total' },
    ], source: { authored_by: 'unknown', quote: 'Revenue was £2m, not capacity.' } }, other: { value: 85, unit: 'tickets/week' } };
    const before = structuredClone(read);
    const projected = runFactsContext(read);
    expect(projected.use).toBe('unchanged instruction');
    expect(projected.facts).toEqual({ ok: true, run_facts: { per_option: before.run_facts.per_option, source: before.run_facts.source }, other: before.other });
    expect(read).toEqual(before);
    expect(runFactsContext(projected.facts)).toEqual({ facts: projected.facts });
  });
});
