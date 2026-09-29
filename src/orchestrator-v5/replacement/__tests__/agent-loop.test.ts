/**
 * The agent loop — run entirely against a scripted fake model.
 *
 * No network, no provider credentials, no spend. Every behaviour that matters
 * for safety is pinned here rather than left to a downstream guard.
 */

import { describe, expect, it } from 'vitest';

import {
  AgentLoopError,
  runAgentLoop,
  type AgentTool,
  type ChatWithToolsLike,
} from '../agent-loop.js';
import type { ToolResponseBlock } from '../../../adapters/llm/types.js';

type Reply = { content: ToolResponseBlock[]; stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' };

/** A model that plays a fixed script, and records what it was sent. */
function scripted(replies: Reply[]): ChatWithToolsLike & { calls: Parameters<ChatWithToolsLike>[0][] } {
  const calls: Parameters<ChatWithToolsLike>[0][] = [];
  let i = 0;
  const fn = (async (args: Parameters<ChatWithToolsLike>[0]) => {
    calls.push({ ...args, messages: JSON.parse(JSON.stringify(args.messages)) });
    const r = replies[Math.min(i, replies.length - 1)];
    i += 1;
    return r!;
  }) as ChatWithToolsLike & { calls: Parameters<ChatWithToolsLike>[0][] };
  (fn as { calls: unknown }).calls = calls;
  return fn;
}

const say = (text: string): Reply => ({ content: [{ type: 'text', text }], stop_reason: 'end_turn' });
const call = (name: string, input: Record<string, unknown> = {}, id = 'tu1'): Reply => ({
  content: [{ type: 'tool_use', id, name, input }],
  stop_reason: 'tool_use',
});

function readTool(name: string, content: string): AgentTool {
  return {
    kind: 'read',
    definition: { name, description: 'a read', input_schema: { type: 'object', properties: {} } },
    execute: () => ({ type: 'result', content }),
  };
}

function proposeTool(name: string, summary: string): AgentTool {
  return {
    kind: 'propose',
    definition: { name, description: 'a proposal', input_schema: { type: 'object', properties: {} } },
    execute: () => ({ type: 'proposed', summary, operations: [{ op: 'update_node', path: '/nodes/x' }] }),
  };
}

const BASE = { system: 'sys', messages: [{ role: 'user' as const, content: 'hello' }] };

describe('the loop answers, and can use tools to do it', () => {
  it('returns the model text when it does not call a tool', async () => {
    const r = await runAgentLoop({ ...BASE, tools: [] }, { chatWithTools: scripted([say('here is my answer')]) });
    expect(r.text).toBe('here is my answer');
    expect(r.iterations).toBe(1);
    expect(r.toolsCalled).toEqual([]);
    expect(r.haltedAtCeiling).toBe(false);
  });

  it('runs a read tool and feeds the result back, then answers', async () => {
    const model = scripted([call('read_workspace'), say('the model has four options')]);
    const r = await runAgentLoop(
      { ...BASE, tools: [readTool('read_workspace', '4 options, 5 factors')] },
      { chatWithTools: model },
    );
    expect(r.toolsCalled).toEqual(['read_workspace']);
    expect(r.text).toBe('the model has four options');
    // The tool's output reached the model...
    const second = model.calls[1]!;
    expect(JSON.stringify(second.messages)).toContain('4 options, 5 factors');
    // ...and never reached the user.
    expect(r.text).not.toContain('5 factors');
  });

  it('keeps the assistant blocks adjacent to their results, as the protocol requires', async () => {
    const model = scripted([call('read_workspace'), say('done')]);
    await runAgentLoop({ ...BASE, tools: [readTool('read_workspace', 'x')] }, { chatWithTools: model });
    const msgs = model.calls[1]!.messages;
    expect(msgs[msgs.length - 2]?.role).toBe('assistant');
    expect(msgs[msgs.length - 1]?.role).toBe('user');
    expect(JSON.stringify(msgs[msgs.length - 1]?.content)).toContain('tool_result');
  });
});

describe('a proposal never becomes a change inside the loop', () => {
  it('stages operations instead of applying them', async () => {
    const model = scripted([call('set_option_effect'), say('shall I go ahead?')]);
    const r = await runAgentLoop(
      { ...BASE, tools: [proposeTool('set_option_effect', 'Set what X does to Y to 1')] },
      { chatWithTools: model },
    );
    expect(r.proposed).toHaveLength(1);
    expect(r.proposed[0]?.tool).toBe('set_option_effect');
    expect(r.proposed[0]?.operations).toHaveLength(1);
  });

  it('tells the model in words that nothing has changed — so it cannot narrate the change as done', async () => {
    const model = scripted([call('set_option_effect'), say('ok')]);
    await runAgentLoop(
      { ...BASE, tools: [proposeTool('set_option_effect', 'Set what X does to Y to 1')] },
      { chatWithTools: model },
    );
    const fedBack = JSON.stringify(model.calls[1]!.messages);
    expect(fedBack).toContain('PROPOSED, NOT APPLIED');
    expect(fedBack).toContain('Nothing has changed in the model');
    expect(fedBack).toContain('must agree before this is saved');
  });

  it('refuses a "read" tool that tries to stage operations — a silent staging under a read name', async () => {
    const liar: AgentTool = {
      kind: 'read',
      definition: { name: 'peek', description: 'd', input_schema: { type: 'object', properties: {} } },
      execute: () => ({ type: 'proposed', summary: 's', operations: [{ op: 'x' }] }),
    };
    await expect(
      runAgentLoop({ ...BASE, tools: [liar] }, { chatWithTools: scripted([call('peek'), say('x')]) }),
    ).rejects.toThrow(AgentLoopError);
  });
});

describe('failures are recoverable, not fatal', () => {
  it('returns an unknown tool name to the model as an error it can act on', async () => {
    const model = scripted([call('does_not_exist'), say('let me try another way')]);
    const r = await runAgentLoop({ ...BASE, tools: [readTool('real', 'x')] }, { chatWithTools: model });
    expect(r.text).toBe('let me try another way');
    const fed = JSON.stringify(model.calls[1]!.messages);
    expect(fed).toContain('No tool named');
    expect(fed).toContain('does_not_exist');
    expect(fed).toContain('real');            // it is told what DOES exist
    expect(fed).toContain('"is_error":true');
  });

  it('a throwing tool does not kill the turn or leak a stack trace to the user', async () => {
    const boom: AgentTool = {
      kind: 'read',
      definition: { name: 'boom', description: 'd', input_schema: { type: 'object', properties: {} } },
      execute: () => { throw new Error('upstream exploded'); },
    };
    const model = scripted([call('boom'), say('I could not read that just now')]);
    const r = await runAgentLoop({ ...BASE, tools: [boom] }, { chatWithTools: model });
    expect(r.text).toBe('I could not read that just now');
    expect(r.text).not.toContain('upstream exploded');
    expect(JSON.stringify(model.calls[1]!.messages)).toContain('upstream exploded');
  });

  it('a refusal reaches the model flagged as an error', async () => {
    const refuser: AgentTool = {
      kind: 'propose',
      definition: { name: 'set_x', description: 'd', input_schema: { type: 'object', properties: {} } },
      execute: () => ({ type: 'refused', content: 'that factor is not linked to that option' }),
    };
    const model = scripted([call('set_x'), say('it is not linked — shall we add the link?')]);
    const r = await runAgentLoop({ ...BASE, tools: [refuser] }, { chatWithTools: model });
    expect(r.proposed).toHaveLength(0);
    const fed = JSON.stringify(model.calls[1]!.messages);
    expect(fed).toContain('not linked');
    expect(fed).toContain('"is_error":true');
  });
});

describe('the loop is bounded', () => {
  it('stops at the ceiling and says so rather than presenting a truncated turn as finished', async () => {
    const model = scripted([call('read_workspace', {}, 'a')]); // always wants another tool
    const r = await runAgentLoop(
      { ...BASE, tools: [readTool('read_workspace', 'x')] },
      { chatWithTools: model, maxIterations: 3 },
    );
    expect(r.iterations).toBe(3);
    expect(r.haltedAtCeiling).toBe(true);
    expect(r.toolsCalled).toHaveLength(3);
  });

  it('a finished turn is never flagged as halted', async () => {
    const r = await runAgentLoop({ ...BASE, tools: [] }, { chatWithTools: scripted([say('done')]), maxIterations: 3 });
    expect(r.haltedAtCeiling).toBe(false);
  });

  it('refuses two tools sharing a name — the model could not address them distinctly', async () => {
    await expect(
      runAgentLoop(
        { ...BASE, tools: [readTool('same', 'a'), readTool('same', 'b')] },
        { chatWithTools: scripted([say('x')]) },
      ),
    ).rejects.toThrow(/share a name/);
  });

  it('refuses a ceiling below one', async () => {
    await expect(
      runAgentLoop({ ...BASE, tools: [] }, { chatWithTools: scripted([say('x')]), maxIterations: 0 }),
    ).rejects.toThrow(/at least 1/);
  });
});

describe('several tools in one model turn', () => {
  it('executes every call and returns every result in one message', async () => {
    const model = scripted([
      {
        content: [
          { type: 'tool_use', id: 'a', name: 'read_one', input: {} },
          { type: 'tool_use', id: 'b', name: 'read_two', input: {} },
        ],
        stop_reason: 'tool_use',
      },
      say('both read'),
    ]);
    const r = await runAgentLoop(
      { ...BASE, tools: [readTool('read_one', 'ONE'), readTool('read_two', 'TWO')] },
      { chatWithTools: model },
    );
    expect(r.toolsCalled).toEqual(['read_one', 'read_two']);
    const fed = JSON.stringify(model.calls[1]!.messages);
    expect(fed).toContain('ONE');
    expect(fed).toContain('TWO');
  });

  it('passes the tool definitions to the model every round', async () => {
    const model = scripted([call('read_one'), say('x')]);
    await runAgentLoop({ ...BASE, tools: [readTool('read_one', 'x')] }, { chatWithTools: model });
    expect(model.calls[0]!.tools.map((t) => t.name)).toEqual(['read_one']);
    expect(model.calls[1]!.tools.map((t) => t.name)).toEqual(['read_one']);
  });

  it('awaits an async tool', async () => {
    const slow: AgentTool = {
      kind: 'read',
      definition: { name: 'slow', description: 'd', input_schema: { type: 'object', properties: {} } },
      execute: async () => { await Promise.resolve(); return { type: 'result', content: 'LATE' }; },
    };
    const model = scripted([call('slow'), say('got it')]);
    await runAgentLoop({ ...BASE, tools: [slow] }, { chatWithTools: model });
    expect(JSON.stringify(model.calls[1]!.messages)).toContain('LATE');
  });
});
