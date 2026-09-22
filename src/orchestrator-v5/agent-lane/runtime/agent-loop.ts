/**
 * Agent lane — the server-side Managed Agent loop.
 *
 * The Agent owns conversation, reasoning, context and tool choice. This module
 * owns none of those: it carries messages, executes the tools the Agent chooses
 * inside the request's authenticated context, and returns the text the Agent
 * produced. It never composes an answer of its own.
 *
 * ⭐ MEASURED PROTOCOL FACTS, not assumptions:
 *   · A reasoning model's `function_call` must be replayed WITH its preceding
 *     `reasoning` item, or the API refuses: "Item 'fc_…' was provided without
 *     its required 'reasoning' item". So the whole `output` array is echoed back
 *     before the tool result is appended.
 *   · Agents *sessions* were unavailable when this was built (every session
 *     created stalled at `in_progress`), so the transport is `/v1/responses`.
 *     That is a seam: the same tools and the same in-context execution move to
 *     sessions unchanged if they recover.
 */

import { AGENT_TOOLS, dispatchTool, type AgentCapabilities, type AgentToolContext, type ToolResult } from './agent-tools.js';

export interface ModelCallRequest {
  readonly instructions: string;
  readonly input: readonly unknown[];
  readonly tools: readonly unknown[];
  readonly max_output_tokens: number;
}

export interface ModelCallResponse {
  readonly output: readonly Record<string, unknown>[];
  readonly usage?: Record<string, unknown>;
}

export type CallModel = (req: ModelCallRequest) => Promise<ModelCallResponse>;

export interface AgentTurnInput {
  readonly ctx: AgentToolContext;
  /** Prior turns, already in Responses-API item shape. Olumi owns this record. */
  readonly history: readonly unknown[];
  readonly message: string;
  readonly instructions: string;
  readonly maxOutputTokens: number;
  /** Hard ceiling on tool round trips within one user turn. */
  readonly maxHops?: number;
}

export interface AgentTurnResult {
  readonly assistant_text: string;
  /** The full item list, for Olumi to persist as the conversation of record. */
  readonly items: readonly unknown[];
  readonly tool_calls: readonly { name: string; ok: boolean; mutated: boolean }[];
  /** Full results, so Olumi can decide what it owes the user this turn. */
  readonly tool_results: readonly ToolResult[];
  /** True when any tool actually changed the model. */
  readonly mutated: boolean;
  readonly hops: number;
  readonly stopped_reason: 'answered' | 'hop_limit';
}

const DEFAULT_MAX_HOPS = 6;

const textOf = (items: readonly Record<string, unknown>[]): string => {
  let t = '';
  for (const i of items) {
    if (i.type !== 'message') continue;
    for (const c of (i.content as Record<string, unknown>[] | undefined) ?? []) {
      if (c.type === 'output_text' && typeof c.text === 'string') t += c.text;
    }
  }
  return t;
};

export async function runAgentTurn(
  input: AgentTurnInput,
  caps: AgentCapabilities,
  callModel: CallModel,
): Promise<AgentTurnResult> {
  const maxHops = input.maxHops ?? DEFAULT_MAX_HOPS;
  const items: unknown[] = [
    ...input.history,
    { role: 'user', content: [{ type: 'input_text', text: input.message }] },
  ];
  const toolCalls: { name: string; ok: boolean; mutated: boolean }[] = [];
  const toolResults: ToolResult[] = [];
  let mutated = false;

  for (let hop = 0; hop < maxHops; hop++) {
    const resp = await callModel({
      instructions: input.instructions,
      input: items,
      tools: AGENT_TOOLS as readonly unknown[],
      max_output_tokens: input.maxOutputTokens,
    });
    const out = resp.output ?? [];
    const call = out.find((i) => i.type === 'function_call');

    if (call === undefined) {
      items.push(...out);
      return {
        assistant_text: textOf(out),
        items,
        tool_calls: toolCalls,
        tool_results: toolResults,
        mutated,
        hops: hop,
        stopped_reason: 'answered',
      };
    }

    const result: ToolResult = await dispatchTool(
      String(call.name), String(call.arguments ?? '{}'), input.ctx, caps,
    );
    if (result.mutated) mutated = true;
    toolCalls.push({ name: String(call.name), ok: result.ok, mutated: result.mutated });
    toolResults.push(result);

    // The whole output array first — the reasoning item must accompany the call.
    items.push(...out, {
      type: 'function_call_output',
      call_id: call.call_id,
      output: JSON.stringify(result),
    });
  }

  // ⛔ A hop limit is reported, never disguised as an answer. Silently returning
  // empty text here would read to the user as the Agent having nothing to say.
  return {
    assistant_text: '',
    items,
    tool_calls: toolCalls,
    tool_results: toolResults,
    mutated,
    hops: maxHops,
    stopped_reason: 'hop_limit',
  };
}
