/**
 * Route-level wire pin for canonical node source wording.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';
import * as telemetry from '../../utils/telemetry.js';
import { TelemetryEvents } from '../../utils/telemetry.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';
import { SOURCE_QUOTES_INSTRUCTION } from '../routing/route-with-tool-use.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: 'mock-row-id' }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    invalidateAll: async () => ({
      scope: { kind: 'structural' as const },
      entries_invalidated: [],
    }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () =>
      (global as Record<string, unknown>).__source_quote_persisted_graph ?? null,
    loadGraphAndBriefText: async () => ({
      graph: (global as Record<string, unknown>).__source_quote_persisted_graph ?? null,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => {
    delete (global as Record<string, unknown>).__source_quote_persisted_graph;
  },
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: '73333333-3333-4333-8333-333333333333',
  scenario_id: '74444444-4444-4444-8444-444444444444',
  message: 'What exact wording is recorded for the growth goal?',
  turn_class: 'frame',
  stage: 'frame',
};

function graph(label: string, quote: string): GraphStateIngress {
  return {
    nodes: [
      {
        id: 'goal_source_wording_canary',
        kind: 'goal',
        label,
        source_quote: quote,
        label_authored: true,
      },
      {
        id: 'factor_oversize_source_wording_canary',
        kind: 'factor',
        label: 'Trust signal',
        source_quote: 'z'.repeat(513),
      },
    ],
    edges: [
      {
        from: 'factor_oversize_source_wording_canary',
        to: 'goal_source_wording_canary',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
    ],
  } as GraphStateIngress;
}

function routingAdapter() {
  return {
    chatWithTools: vi
      .fn<
        (
          args: ChatWithToolsArgs,
          opts: { requestId: string; timeoutMs?: number; signal?: AbortSignal },
        ) => Promise<ChatWithToolsResult>
      >()
      .mockResolvedValue({
        content: [{ type: 'text', text: 'The saved wording is available.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 12 } as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 20,
      }),
  };
}

function readPrompt(adapter: ReturnType<typeof routingAdapter>): string {
  const call = adapter.chatWithTools.mock.calls[0]?.[0];
  expect(call, 'routing model was not called').toBeDefined();
  const userMessage = (call!.messages as Array<{ role: string; content: unknown }>).find(
    (message) => message.role === 'user',
  );
  expect(userMessage).toBeDefined();
  return typeof userMessage!.content === 'string'
    ? userMessage!.content
    : JSON.stringify(userMessage!.content);
}

function readPack(prompt: string): Record<string, unknown> {
  const marker = '## ContextPack\n';
  const source = prompt.slice(prompt.indexOf(marker) + marker.length);
  let depth = 0;
  let quoted = false;
  let escaped = false;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') quoted = false;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === '{') depth += 1;
    else if (char === '}' && --depth === 0) {
      return JSON.parse(source.slice(0, index + 1)) as Record<string, unknown>;
    }
  }
  throw new Error('unterminated ContextPack JSON');
}

describe('TurnExecutor canonical node source wording', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete (global as Record<string, unknown>).__source_quote_persisted_graph;
  });

  it('uses persisted exact wording over divergent request bytes and emits counts only', async () => {
    const canonicalQuote = 'Preserve trust while growing recurring revenue';
    const requestCanary = 'REQUEST-ONLY SOURCE WORDING';
    (global as Record<string, unknown>).__source_quote_persisted_graph = graph(
      'Canonical durable growth',
      canonicalQuote,
    );
    const adapter = routingAdapter();
    const emitSpy = vi.spyOn(telemetry, 'emit');

    await runTurnExecutor(PAYLOAD, 'req-source-quote-canonical', {
      routingAdapter: adapter,
      graphState: graph('REQUEST-ONLY label', requestCanary),
    });

    const prompt = readPrompt(adapter);
    const pack = readPack(prompt) as {
      graph_context: { status: string };
      graph: { nodes: Array<Record<string, unknown>> };
      context_budget: { source_quotes: Record<string, unknown> };
    };
    const goal = pack.graph.nodes.find(
      (node) => node.id === 'goal_source_wording_canary',
    );
    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(goal).toMatchObject({
      label: 'Canonical durable growth',
      source_quote: canonicalQuote,
      label_authored: true,
    });
    expect(prompt).not.toContain(requestCanary);
    expect(prompt).not.toContain('REQUEST-ONLY label');
    expect(prompt.split(SOURCE_QUOTES_INSTRUCTION)).toHaveLength(2);
    expect(pack.context_budget.source_quotes).toMatchObject({
      candidate_count: 2,
      retained_count: 1,
      per_quote_withheld_count: 1,
    });

    const budgetEvent = emitSpy.mock.calls.find(
      ([event]) => event === TelemetryEvents.V5ContextBudget,
    )?.[1] as Record<string, unknown> | undefined;
    expect(budgetEvent?.source_quotes).toEqual(pack.context_budget.source_quotes);
    const telemetryBytes = JSON.stringify(budgetEvent);
    expect(telemetryBytes).not.toContain(canonicalQuote);
    expect(telemetryBytes).not.toContain('goal_source_wording_canary');
  });

  it('keeps first-touch labels provisional without quote or authorship authority', async () => {
    (global as Record<string, unknown>).__source_quote_persisted_graph = null;
    const adapter = routingAdapter();

    await runTurnExecutor(PAYLOAD, 'req-source-quote-provisional', {
      routingAdapter: adapter,
      graphState: graph('Provisional growth goal', 'PROVISIONAL SOURCE WORDING'),
    });

    const prompt = readPrompt(adapter);
    const pack = readPack(prompt) as {
      graph_context: { status: string };
      graph: { nodes: Array<Record<string, unknown>> };
      context_budget?: { source_quotes?: unknown };
    };
    expect(pack.graph_context).toEqual({ status: 'provisional' });
    expect(pack.graph.nodes.some((node) => node.label === 'Provisional growth goal')).toBe(
      true,
    );
    expect(pack.graph.nodes.every((node) => node.source_quote === undefined)).toBe(true);
    expect(pack.graph.nodes.every((node) => node.label_authored === undefined)).toBe(true);
    expect(pack.context_budget?.source_quotes).toBeUndefined();
    expect(prompt).not.toContain(SOURCE_QUOTES_INSTRUCTION);
  });
});

