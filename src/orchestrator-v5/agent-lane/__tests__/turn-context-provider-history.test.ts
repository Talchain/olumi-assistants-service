import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ANSWERED_EARLIER_LABEL, OLDER_WORDS_LABEL, RESTORED_FIRST_LABEL } from '../history-store.js';
import { pairProviderInput } from '../provider-input-pairing.js';
import { REASONING_CONTEXT_LABEL, turnContextItems } from '../turn-context.js';

const NOW = new Date('2026-10-16T22:00:00Z');
const message = (role: 'user' | 'assistant', text: string) => ({ role, content: [{ type: role === 'user' ? 'input_text' : 'output_text', text }] });
const textOf = (item: unknown): string => {
  const content = (item as { content?: unknown })?.content;
  return typeof content === 'string' ? content : Array.isArray(content)
    ? content.map(part => typeof part?.text === 'string' ? part.text : '').join('\n') : '';
};
const contextOf = (items: readonly unknown[]) => {
  const text = items.map(textOf).find(text => text.startsWith(REASONING_CONTEXT_LABEL));
  expect(text, 'the actual producer emitted source-labelled context').toBeDefined();
  return JSON.parse(text!.slice(REASONING_CONTEXT_LABEL.length)) as {
    current_request_origin: string;
    verified_user_statements: unknown[];
    answered_pairs: unknown[];
    unknown_origin?: unknown;
  };
};
const project = (conversation: readonly unknown[], extra: Partial<Parameters<typeof turnContextItems>[0]> = {}) =>
  turnContextItems({ now: NOW, briefText: '', conversation, request: 'Explain the selected Run.', ...extra });
const nativeItems = (output: readonly unknown[], history: readonly unknown[]) => output.filter(item => history.includes(item));

const outbound = vi.fn(async () => { throw new Error('this producer test permits no external request'); });
beforeAll(() => vi.stubGlobal('fetch', outbound));
afterAll(() => { expect(outbound).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

const families = [
  { name: 'capacity', brief: 'Improve capacity without dropping support quality.',
    request: 'We handle 80 tickets/week; aim for 100 only if quality holds. Alex reported £2m revenue; that is not capacity.',
    reply: 'The 100 tickets/week aim depends on quality; £2m is Alex’s revenue, not a capacity observation.', unit: 'tickets/week' },
  { name: 'service throughput', brief: 'Improve service throughput while preserving response quality.',
    request: 'We handle 30 cases/day; aim for 40 only if response quality holds. Sam reported 200 training hours; those are not throughput.',
    reply: 'The 40 cases/day aim depends on response quality; Sam’s 200 training hours are not a throughput observation.', unit: 'cases/day' },
] as const;

describe.each(families)('$name: the requested context keeps complete ordered provider history', family => {
  const user = message('user', family.request);
  const reasoning = { type: 'reasoning', id: 'rs_opaque_A3', encrypted_content: 'opaque reasoning bytes', summary: [{ type: 'summary_text', text: 'Keep the condition and dissent.' }] };
  const assistant = { type: 'message', id: 'msg_unrelated_X9', status: 'completed', role: 'assistant',
    content: [{ type: 'output_text', text: family.reply, annotations: [] }] };
  const calls = [
    { type: 'function_call', id: 'fc_native_1', call_id: 'call_state', name: 'get_canonical_state', arguments: '{"section":"run_explanation"}' },
    { type: 'function_call', id: 'fc_native_2', call_id: 'call_source', name: 'get_source', arguments: '{"id":"separate-subject"}' },
  ];
  const outputs = [
    { type: 'function_call_output', call_id: 'call_state', output: JSON.stringify({ unit: family.unit, source: 'unknown', warning: 'withhold every unsupported target' }) },
    { type: 'function_call_output', call_id: 'call_source', output: JSON.stringify({ speaker: 'third party', quote: family.reply, adopted: false }) },
  ];
  const history = [user, reasoning, ...calls, ...outputs, assistant];

  it('keeps reasoning, parallel call/output identity, message identity and exact content before any downstream repair', () => {
    expect(nativeItems(project(history), history)).toEqual(history);
    const sent = project(history);
    for (const item of history) expect(sent.filter(candidate => candidate === item)).toHaveLength(1);
    expect(sent.indexOf(reasoning)).toBeLessThan(sent.indexOf(assistant));
  });

  it('the existing downstream pairing owner leaves this complete producer output unchanged', () => {
    const sent = project(history);
    expect(sent).toContain(reasoning); // A valid repaired orphan is insufficient: the producer must preserve the original pair.
    expect(pairProviderInput(sent)).toBe(sent);
    expect(nativeItems(pairProviderInput(sent), history)).toEqual(history);
  });

  it('a neighbouring figure, quoted speaker and tool result gain no user authorship or approval', () => {
    const sent = project(history, { briefText: family.brief, verifiedUserMessages: [family.request],
      unknownUserText: family.reply, currentRequestOrigin: 'product control' });
    const context = contextOf(sent);
    expect(context.verified_user_statements).toEqual([{ speaker: 'user', source: 'typed', text: family.request }]);
    expect(context.unknown_origin).toEqual({ speaker: 'unknown', source: 'stored, origin not verified', text: family.reply });
    expect(context.current_request_origin).toBe('product control');
    expect(context.answered_pairs).toEqual([]);
    expect(nativeItems(sent, history)).toEqual(history);
    expect(sent.filter(item => (item as { role?: unknown }).role === 'developer').map(textOf)).toHaveLength(1);
  });

  it('later corrections preserve their full wording and source order without treating Olumi’s reply as human text', () => {
    const correction = `Keep the stated condition. I disagree with treating ${family.unit} as the other speaker’s figure.`;
    const sent = project([...history, message('user', correction)], { verifiedUserMessages: [family.request, correction] });
    expect(contextOf(sent).verified_user_statements).toEqual([
      { speaker: 'user', source: 'typed', text: family.request },
      { speaker: 'user', source: 'typed', text: correction },
    ]);
    expect(nativeItems(sent, history)).toEqual(history);
  });
});

describe('window and source boundaries remain owned by existing context/history helpers', () => {
  it('cuts only before the retained user turn and keeps all three selected chains in their original order', () => {
    const dropped = [message('user', 'Old turn.'), { type: 'reasoning', id: 'rs_old', summary: [] },
      { type: 'message', id: 'msg_old', role: 'assistant', content: [{ type: 'output_text', text: 'Old reply.' }] }];
    const kept = [1, 2, 3].flatMap(n => [message('user', `Retained turn ${n}.`),
      { type: 'reasoning', id: `rs_selected_${n}`, summary: [] },
      { type: 'function_call', id: `fc_${n}`, call_id: `call_${n}`, name: 'get_canonical_state', arguments: '{}' },
      { type: 'function_call_output', call_id: `call_${n}`, output: `Unchanged record ${n}.` },
      { type: 'message', id: `msg_different_${n}`, role: 'assistant', content: [{ type: 'output_text', text: `Reply ${n}.` }] }]);
    expect(nativeItems(project([...dropped, ...kept]), [...dropped, ...kept])).toEqual(kept);
  });

  it('keeps the existing older-source carriers ahead of the selected window without changing their recorded source', () => {
    const older = [OLDER_WORDS_LABEL, RESTORED_FIRST_LABEL, ANSWERED_EARLIER_LABEL].map(label => message('user', `${label}\nWhole conditional words; source remains as recorded.`));
    const turns = [1, 2, 3, 4].map(n => message('user', `Turn ${n}.`));
    expect(nativeItems(project([...older, ...turns]), [...older, ...turns])).toEqual([...older, ...turns.slice(1)]);
  });

  it('a dropped Olumi question remains beside its response as quoted unknown-origin history', () => {
    const question = 'Is the target conditional on keeping Support, even if revenue reaches £2m?';
    const answer = 'Yes, only under that condition; Alex disagrees.';
    const history = [message('user', 'Earlier.'), message('assistant', question), message('user', answer),
      ...[1, 2, 3].map(n => message('user', `Later ${n}.`))];
    expect(contextOf(project(history)).answered_pairs).toEqual([
      { olumi: { speaker: 'olumi', source: "Olumi's reply, not a user statement", text: question },
        response: { speaker: 'unknown', source: 'stored conversation; typed or chip origin not verified here', text: answer } },
    ]);
  });

  it('does not modify any source item or caller array', () => {
    const history = [message('user', 'Keep this condition.'), { type: 'reasoning', id: 'rs_frozen', summary: [] },
      { type: 'message', id: 'msg_frozen', role: 'assistant', content: [{ type: 'output_text', text: 'A provisional interpretation.' }] }];
    const before = JSON.stringify(history);
    for (const item of history) Object.freeze(item);
    Object.freeze(history);
    project(history);
    expect(JSON.stringify(history)).toBe(before);
  });

  it('ordinary chat still supplies its history once at its existing caller, with no second history in context items', () => {
    const history = [message('user', 'Keep the condition.'), { type: 'reasoning', id: 'rs_chat', summary: [] },
      { type: 'message', id: 'msg_chat', role: 'assistant', content: [{ type: 'output_text', text: 'The condition remains.' }] }];
    const context = turnContextItems({ now: NOW, briefText: '', conversation: history, verifiedUserMessages: ['Keep the condition.'] });
    expect(nativeItems(context, history)).toEqual([]);
    const chatInput = [...history, ...context, message('user', 'Continue.')];
    expect(pairProviderInput(chatInput)).toBe(chatInput);
    expect(nativeItems(chatInput, history)).toEqual(history);
  });

  it('does not pretend to restore reasoning absent from stored history; the existing guard safely replays exact orphan words', () => {
    const orphan = { type: 'message', id: 'msg_without_saved_reasoning', role: 'assistant', content: [{ type: 'output_text', text: 'Only these words were retained.' }] };
    const sent = project([message('user', 'Explain.'), orphan]);
    expect(sent).toContain(orphan);
    const safe = pairProviderInput(sent);
    expect(safe).toEqual(sent.map(item => item === orphan ? { role: 'assistant', content: orphan.content } : item));
  });

  it('does not fabricate a partner for an existing orphan reasoning item; the downstream owner drops it', () => {
    const orphan = { type: 'reasoning', id: 'rs_without_output', summary: [] };
    const sent = project([message('user', 'Explain.'), orphan]);
    expect(sent).toContain(orphan);
    expect(pairProviderInput(sent)).toEqual(sent.filter(item => item !== orphan));
  });
});
