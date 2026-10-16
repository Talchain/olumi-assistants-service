import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { pairProviderInput } from '../provider-input-pairing.js';
import { turnContextItems } from '../turn-context.js';

type Item = Record<string, unknown>;
// Reuse the existing private API rule without importing/rerunning its Fastify suite or copying its implementation.
const ruleSource = readFileSync(new URL('./run-keeps-reasoning-item.test.ts', import.meta.url), 'utf8');
const ruleTree = ts.createSourceFile('existing-api-rule.ts', ruleSource, ts.ScriptTarget.Latest, true);
const rule = ruleTree.statements.find((node): node is ts.FunctionDeclaration =>
  ts.isFunctionDeclaration(node) && node.name?.text === 'refusalFor');
if (rule === undefined) throw new Error('Existing Responses pairing rule is unavailable');
const refusalFor = new Function(ts.transpileModule(rule.getText(ruleTree), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText + '\nreturn refusalFor;')() as (input: readonly Item[]) => string | null;
const rs = (id: string): Item => ({ type: 'reasoning', id, summary: [{ type: 'summary_text', text: 'Retained reasoning summary.' }],
  encrypted_content: 'opaque-synthetic-reasoning', status: 'completed' });
const message = (id: string, text = 'Revenue was 2m as of 2026-09-01, and our deadline remains separate.'): Item => ({
  type: 'message', id, role: 'assistant', status: 'completed', content: [{ type: 'output_text', text, annotations: [] }],
});
const user = { role: 'user', content: [{ type: 'input_text', text: 'Preserve the goal, range, units, source and disagreement.' }] };
const call = (id: string): Item => ({ type: 'function_call', id: `fc_${id}`, call_id: `call_${id}`,
  name: 'get_canonical_state', arguments: '{"scenario_id":"synthetic"}', status: 'completed' });

describe('one provider input pairing projection', () => {
  it('passes a string or absent input through untouched (the Responses API accepts a plain string)', () => {
    expect(pairProviderInput('plain text request')).toBe('plain text request');
    expect(pairProviderInput(undefined)).toBeUndefined();
    expect(pairProviderInput(null)).toBeNull();
  });
  it('repairs the T04 orphan-message shape under the EXISTING API refusal rule, preserving its complete content', () => {
    const orphan = message('msg_t04'); const input = [user, orphan];
    expect(refusalFor(input)).toBe("Item 'msg_t04' of type 'message' was provided without its required 'reasoning' item: 'rs_t04'.");
    const output = pairProviderInput(input) as Item[];
    expect(refusalFor(output)).toBeNull();
    expect(output).toEqual([user, { role: 'assistant', content: orphan.content }]);
    expect(output[0]).toBe(user); expect(output[1]!.content).toBe(orphan.content);
    expect(input[1]).toBe(orphan); expect(orphan.id).toBe('msg_t04');
  });

  it('leaves an ordered paired message/reasoning input exactly unchanged, including encrypted reasoning', () => {
    const input = [user, rs('rs_pair'), message('msg_pair')];
    expect(refusalFor(input)).toBeNull();
    expect(pairProviderInput(input)).toBe(input);
    expect(JSON.stringify(pairProviderInput(input))).toBe(JSON.stringify(input));
  });

  it('does not infer opaque provider pairing from matching id suffixes', () => {
    const input = [user, rs('rs_a9f0_opaque'), message('msg_b7e1_unrelated_id_bytes')];
    // The retained checker uses synthetic matching suffixes, not a real provider-id relationship.
    // This ordered provider-output fixture deliberately has different opaque ids.
    expect(pairProviderInput(input)).toBe(input);
    expect(JSON.stringify(pairProviderInput(input))).toBe(JSON.stringify(input));
  });

  it('keeps parallel function calls, their outputs and the final message in their original reasoning chain', () => {
    const input = [user, rs('rs_tools'), call('one'), call('two'),
      { type: 'function_call_output', call_id: 'call_one', output: '{"ok":true,"value":2}' },
      { type: 'function_call_output', call_id: 'call_two', output: '{"ok":false,"source":"unknown"}' },
      message('msg_tools')];
    expect(refusalFor(input)).toBeNull();
    expect(pairProviderInput(input)).toBe(input);
    expect(JSON.stringify(pairProviderInput(input))).toBe(JSON.stringify(input));
  });

  it('retains multiple assistant output messages and consecutive reasoning items without stripping their valid ids', () => {
    const input = [user, rs('rs_first'), rs('rs_second'),
      { ...message('msg_analysis'), phase: 'analysis' }, { ...message('msg_final'), phase: 'final' }];
    expect(pairProviderInput(input)).toBe(input);
  });

  it('drops only reasoning with no following output partner, including before a new user turn and at the end', () => {
    const lone = rs('rs_lone'); const trailing = rs('rs_trailing');
    const input = [lone, user, trailing];
    expect(pairProviderInput(input)).toEqual([user]);
    expect(lone.encrypted_content).toBe('opaque-synthetic-reasoning');
    expect(input).toEqual([lone, user, trailing]);
  });

  it('does not pair a message with reasoning that comes after it', () => {
    const msg = message('msg_backwards');
    const output = pairProviderInput([msg, rs('rs_backwards')]) as Item[];
    expect(output).toEqual([{ role: 'assistant', content: msg.content }]);
    expect(refusalFor(output)).toBeNull();
  });

  it.each(['user', 'developer', 'system'])('a new %s context cannot lend earlier reasoning to another response', role => {
    const boundary = { role, content: [{ type: 'input_text', text: 'A different turn or instruction.' }] };
    const orphan = message('msg_other');
    const input = [rs('rs_kept'), message('msg_kept'), boundary, orphan];
    const output = pairProviderInput(input) as Item[];
    expect(refusalFor(output)).toBeNull();
    expect(output).toEqual([input[0], input[1], boundary, { role: 'assistant', content: orphan.content }]);
    expect(output.slice(0, 3)).toEqual(input.slice(0, 3));
  });

  it('does not rewrite user/developer text, ordinary id-less answers, tool call ids or tool output bytes', () => {
    const input = [user, { role: 'developer', content: 'Known source is distinct from the numeric reading.' },
      { role: 'assistant', content: 'The range is 40–55; that is not a point estimate.' }, call('orphan-call'),
      { type: 'function_call_output', call_id: 'call_orphan-call', output: '{"raw_value":80,"unit":"orders/week"}' }];
    expect(pairProviderInput(input)).toBe(input);
    expect(JSON.stringify(pairProviderInput(input))).toBe(JSON.stringify(input));
  });

  it('the existing interpretation context projection reproduces the orphan and the boundary repairs only its API identity', () => {
    const answer = message('msg_projection');
    const projected = turnContextItems({ now: new Date('2026-10-16T21:00:00Z'), briefText: '',
      conversation: [user, rs('rs_projection'), answer], request: 'Explain this Run; do not change the model.',
      canonicalState: { goal: 'Retain human reasoning', unit: 'GBP', user_words: 'Our range is 40–55; I disagree with that estimate.' } }) as Item[];
    expect(projected).toContain(answer); expect(projected.some(i => i.id === 'rs_projection')).toBe(false);
    expect(refusalFor(projected)).not.toBeNull();
    const output = pairProviderInput(projected) as Item[];
    expect(refusalFor(output)).toBeNull();
    expect(output.filter(i => i.role !== 'assistant')).toEqual(projected.filter(i => i.role !== 'assistant'));
    expect(output.find(i => i.role === 'assistant')).toEqual({ role: 'assistant', content: answer.content });
  });

  it('the banked callModelFor input hook preserves the native request settings/tools and accepts the orphan shape', () => {
    const source = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const tree = ts.createSourceFile('native-call-body.ts', source, ts.ScriptTarget.Latest, true);
    let body: string | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'plainBody') body = node.initializer?.getText(tree);
      ts.forEachChild(node, visit);
    };
    visit(tree);
    if (body === undefined) throw new Error('Native callModelFor request body is unavailable');
    // The REAL route source carries the hook (reverting it must turn this row red).
    expect(body).toContain('input: pairProviderInput(req.input)');
    const original = body.replace('input: pairProviderInput(req.input)', 'input: req.input');
    const candidate = original.replace('input: req.input', 'input: pairProviderInput(req.input)');
    expect(candidate).not.toBe(original);
    const encode = (expression: string, req: Item) => new Function('req', 'budget', 'forcedToolOf', 'callEffortFor', 'pairProviderInput',
      ts.transpileModule(`return (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText)(
      req, { model: 'synthetic-model' }, () => undefined, () => 'low', pairProviderInput) as Item;
    const req = { instructions: 'Retain the model’s sources, units, uncertainty and dissent.', input: [user, message('msg_hook')],
      tools: [{ type: 'function', name: 'synthetic_tool', parameters: { type: 'object', properties: {} } }],
      tool_choice: 'none', text: { format: { type: 'json_schema', name: 'synthetic_reply', strict: true } }, max_output_tokens: 3400 };
    const before = encode(original, req); const after = encode(candidate, req);
    const { input: _oldInput, ...oldSettings } = before; const { input: _newInput, ...newSettings } = after;
    expect(newSettings).toEqual(oldSettings); expect(after.tools).toBe(req.tools);
    expect(refusalFor(before.input as Item[])).not.toBeNull();
    expect(refusalFor(JSON.parse(JSON.stringify(after)).input)).toBeNull();
    const paired = { ...req, input: [user, rs('rs_valid_hook'), message('msg_valid_hook')] };
    expect(JSON.stringify(encode(candidate, paired))).toBe(JSON.stringify(encode(original, paired)));
  });

  it('keeps reasoning with a tool-call continuation that has no assistant message (user → reasoning → call → output)', () => {
    const continuation = [user, rs('rs_tool_turn'), call('tool-turn'),
      { type: 'function_call_output', call_id: 'call_tool-turn', output: '{"ok":true}' }];
    expect(refusalFor(continuation)).toBeNull();
    expect(pairProviderInput(continuation)).toBe(continuation);
    const withDeveloper = [...continuation, { role: 'developer', content: 'Explain the Run; do not change the model.' }];
    expect(pairProviderInput(withDeveloper)).toBe(withDeveloper);
  });

  it('is idempotent and never mutates its deeply frozen input', () => {
    const msg = message('msg_frozen');
    Object.freeze(msg.content); Object.freeze(msg);
    const input = Object.freeze([user, msg]);
    const first = pairProviderInput(input);
    expect(pairProviderInput(first)).toBe(first); expect(msg.id).toBe('msg_frozen');
  });
});
