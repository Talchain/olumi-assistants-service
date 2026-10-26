import { describe, expect, it } from 'vitest';
import { turnContextItems, runFactsContext, REASONING_CONTEXT_LABEL, CURRENT_MODEL_STATE_PREFIX, PROGRAM_MODEL_STATE_PREFIX } from '../turn-context.js';
import { wholeStatementIn } from '../../goal-target/input-claim-context.js';
import { answeredEarlierItem, ANSWERED_EARLIER_LABEL } from '../history-store.js';

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
      verifiedUserMessages: [text], unknownUserText: text, request: 'Explain this result',
      conversation: [item('assistant', question), item('user', text), item('assistant', 'Use the existing figure?'), item('user', text),
        ...[1, 2, 3].map(n => item('user', `Later turn ${n}.`))] }));
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
    const context = contextOf(turnContextItems({ now: new Date(), briefText: '', verifiedUserMessages: ['A later response.'], request: 'Explain this result',
      conversation: [item('assistant', 'Question one?'), item('user', 'First answer.'), item('user', 'A later response.'),
        { type: 'function_call_output', output: 'Yes, 100 per week.' },
        ...[1, 2, 3].map(n => item('user', `Later turn ${n}.`))] }));
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

describe('scoped requests use the same context owner without widening their sources', () => {
  const cases = [
    { name: 'distribution', request: 'Review dispatch delays. Revenue was £2m on 2026-09-01; the night team disputes the cause.' },
    { name: 'laboratory', request: 'Review sample delays. Revenue was £2m on 2026-09-01; the bench team disputes the cause.' },
  ];
  const privateWords = 'PRIVATE: unapproved payroll forecast and the other team’s attributed figures.';
  const argsFor = (request: string) => ({ now: new Date('2026-10-18T00:00:00Z'), briefText: privateWords,
    conversation: [item('assistant', privateWords), item('user', request)], verifiedUserMessages: [request],
    unknownUserText: privateWords, request, currentRequestOrigin: 'typed' as const,
    canonicalState: { statements: [{ speaker: 'unknown', quote: 'Asha said revenue was £2m, only if the trial continues.',
      value: 2000000, unit: '£', conditions: 'only if the trial continues', disagreement: 'The evening team disputes this.' }],
      targets: [{ id: 'a', warning: 'Withhold every total.' }, { id: 'b', warning: 'Withhold every total.' }] },
    construction: { current_model: { private_note: privateWords }, retained: { brief: privateWords, conversation: [] } },
  });
  it.each(cases)('$name: request-only preserves exact current words and excludes every other source', row => {
    const args = { ...argsFor(row.request), scope: 'request-only' as const };
    const before = structuredClone(args);
    const items = turnContextItems(args);
    expect(items).toEqual([item('user', row.request)]);
    expect(JSON.stringify(items)).not.toContain(privateWords);
    expect(args).toEqual(before);
  });
  it.each(cases)('$name: model-only preserves complete reference source records and all warnings without adding a request', row => {
    const args = { ...argsFor(row.request), scope: 'model-only' as const };
    const before = structuredClone(args);
    const items = turnContextItems(args);
    expect(items).toEqual([item('user', `${REASONING_CONTEXT_LABEL}\n${JSON.stringify(args.canonicalState)}`)]);
    expect(JSON.stringify(items)).not.toContain(privateWords);
    expect(args).toEqual(before);
  });
});

describe('construction uses the shared source-labelled context', () => {
  const cases = [
    { name: 'distribution', brief: 'Review depot throughput while retaining the safety constraint.', reply: 'Only on the night shift, if staffing stays unchanged.' },
    { name: 'laboratory', brief: 'Review sample turnaround while retaining the quality constraint.', reply: 'Only for refrigerated samples, if the assay remains unchanged.' },
  ];
  const textsOf = (items: unknown[]) => items.flatMap(i => (i as ReturnType<typeof item>).content.map(c => c.text));
  it.each([false, true])('keeps older-word items and answered-pair sources at the constructor boundary; request supplied=%s', supplied => {
    const legacy = answeredEarlierItem([{ olumi: 'Which unit?', reply: 'Tickets per week.', reply_source: 'unknown' }])!;
    const typed = 'Only the night team, conditional on the current checks.';
    const texts = textsOf(turnContextItems({ now: new Date('2026-10-18T00:00:00Z'), briefText: 'Review throughput.', request: supplied ? 'Revise the model.' : undefined,
      recentTurns: 0, verifiedUserMessages: [typed], conversation: [legacy, item('assistant', 'Which team and conditions?'), item('user', typed)], construction: {} }));
    const shared = JSON.parse(texts.find(t => t.startsWith(`${REASONING_CONTEXT_LABEL}\n`))!.slice(REASONING_CONTEXT_LABEL.length));
    expect(shared.find((i: ReturnType<typeof item>) => i.content[0]!.text.startsWith(ANSWERED_EARLIER_LABEL))).toEqual(legacy);
    const reasoningText = shared.find((i: ReturnType<typeof item>) => i.content[0]!.text.startsWith(REASONING_CONTEXT_LABEL)).content[0].text;
    const reasoning = JSON.parse(reasoningText.slice(REASONING_CONTEXT_LABEL.length));
    expect(reasoning.verified_user_statements).toEqual([{ speaker: 'user', source: 'typed', text: typed }]);
    expect(reasoning.answered_pairs).toEqual([{ olumi: { speaker: 'olumi', source: "Olumi's reply, not a user statement", text: 'Which team and conditions?' },
      response: { speaker: 'unknown', source: 'stored conversation; typed or chip origin not verified here', text: typed } }]);
  });
  it.each(cases)('$name retains the full model, objections, source occurrences and question/answer context without changing its inputs', row => {
    const unknown = 'Advertising spend is £100000.';
    const typed = 'Revenue was £100000 as of 2026-09-01. Keep the original condition.';
    const args = { now: new Date('2026-10-18T00:00:00Z'), briefText: row.brief,
      conversation: [item('assistant', 'Under which conditions does that hold?'), item('user', row.reply)],
      construction: { current_model: { recorded_reasoning: [{ id: 'retained', quote: row.reply, disposition: 'retracted' }],
        current_retained: [{ id: 'current-aim', text: 'The current aim is separate from the eventual ambition.' }] },
      retained: { brief: row.brief, conversation: [
        { speaker: 'unknown' as const, source: 'stored, origin not verified' as const, text: unknown },
        { speaker: 'user' as const, source: 'typed' as const, text: typed },
      ] }, objections: ['Do not revive the withdrawn assumption.'] } };
    const before = structuredClone(args);
    const texts = textsOf(turnContextItems(args));
    expect(texts.some(t => t.includes(JSON.stringify(args.construction.current_model))), 'the complete retained model reaches construction').toBe(true);
    expect(texts.some(t => t.includes(JSON.stringify(args.construction.objections)))).toBe(true);
    for (const occurrence of args.construction.retained.conversation) {
      const { text, ...origin } = occurrence;
      expect(texts.some(t => t.includes(`${JSON.stringify(origin)}\n${JSON.stringify(text)}`)), 'source and complete words stay together').toBe(true);
    }
    expect(texts.some(t => t.includes('Under which conditions does that hold?'))).toBe(true);
    expect(texts.some(t => t.includes(row.reply))).toBe(true);
    expect(args).toEqual(before);
  });
  it.each(cases)('$name does not use JSON quotation as an authorship defence', row => {
    const quote = 'Advertising spend is £100000.';
    const referenceText = `A note called "budget". ${quote} End of note.`;
    const brief = `${row.brief} Revenue was £100000 as of 2026-09-01.`;
    const args = { now: new Date('2026-10-18T00:00:00Z'), briefText: brief, conversation: [], construction: {
      retained: { brief, conversation: [{ speaker: 'unknown' as const, source: 'stored, origin not verified' as const, text: referenceText }] },
    } };
    const reference = textsOf(turnContextItems(args)).join('\n\n');
    expect(wholeStatementIn(reference, quote), 'a wrong attestation input must encounter a genuinely readable whole statement').toBe(true);
    expect(wholeStatementIn(brief, quote), 'the unrelated equal amount cannot supply this statement').toBe(false);
    expect(wholeStatementIn(`${brief}\n${quote}`, quote), 'the identical statement is readable when actually typed').toBe(true);
    expect(reference).toContain(`${JSON.stringify({ speaker: 'unknown', source: 'stored, origin not verified' })}\n${JSON.stringify(referenceText)}`);
  });

  it('a model program\'s state block is in the program tools\' words; any other state keeps the Living Model\'s', () => {
    const block = (canonicalState: unknown) => (turnContextItems({ now: new Date('2026-10-26T12:00:00Z'), briefText: '', conversation: [], canonicalState })
      .map((i) => (i as { content: { text: string }[] }).content[0]!.text).find((t) => t.startsWith('CURRENT MODEL STATE'))!);
    const program = block({ model_program: 'v1', revision: { graph_hash: 'h' }, model: {} });
    expect(program.startsWith(PROGRAM_MODEL_STATE_PREFIX)).toBe(true);
    expect(program).not.toContain('get_canonical_state');
    expect(block({ ok: true, graph_revision: 'r1' }).startsWith(CURRENT_MODEL_STATE_PREFIX)).toBe(true);
  });
});
