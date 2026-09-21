/**
 * Route-level pin for System B's causal-confidence authority join.
 *
 * This exercises the real TurnExecutor selector → compactor → assembler →
 * prompt chain. Persisted canonical state must beat divergent request bytes;
 * first-touch provisional structure remains useful but cannot inherit an
 * attested confidence category.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
} from '../../adapters/llm/types.js';
import type { GraphStateIngress } from '../boundary/request-extensions.js';

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
      (global as Record<string, unknown>).__confidence_persisted_graph ?? null,
    loadGraphAndBriefText: async () => ({
      graph: (global as Record<string, unknown>).__confidence_persisted_graph ?? null,
      briefText: null,
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => {
    delete (global as Record<string, unknown>).__confidence_persisted_graph;
  },
}));

const { runTurnExecutor } = await import('../turn-executor.js');

const PAYLOAD: MessageTurnPayload = {
  kind: 'message',
  source: 'composer',
  turn_id: '33333333-3333-4333-8333-333333333333',
  scenario_id: '44444444-4444-4444-8444-444444444444',
  message: 'Which relationship should we trust most?',
  turn_class: 'frame',
  stage: 'analyse',
};

function graphWithStd(std: number, label: string): GraphStateIngress {
  return {
    nodes: [
      { id: 'factor_demand', kind: 'factor', label },
      { id: 'goal_growth', kind: 'goal', label: 'Sustainable growth' },
    ],
    edges: [
      {
        from: 'factor_demand',
        to: 'goal_growth',
        strength: { mean: 0.55, std },
        exists_probability: 0.9,
        effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
    ],
  };
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
        content: [{ type: 'text', text: 'The saved demand relationship matters most.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 10, output_tokens: 12 } as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 20,
      }),
  };
}

interface PromptPack {
  readonly graph_context: { readonly status: string };
  readonly graph: {
    readonly nodes: ReadonlyArray<{ readonly id?: string; readonly label?: string }>;
    readonly edges: ReadonlyArray<{
      readonly relationship?: string;
      readonly coefficient_confidence?: string;
    }>;
  };
}

function readPromptPack(adapter: ReturnType<typeof routingAdapter>): PromptPack {
  const call = adapter.chatWithTools.mock.calls[0]?.[0];
  expect(call, 'routing model was not called').toBeDefined();
  const userMessage = (call!.messages as Array<{ role: string; content: unknown }>).find(
    (message) => message.role === 'user',
  );
  expect(userMessage).toBeDefined();
  const prompt =
    typeof userMessage!.content === 'string'
      ? userMessage!.content
      : JSON.stringify(userMessage!.content);
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
      return JSON.parse(source.slice(0, index + 1)) as PromptPack;
    }
  }
  throw new Error('unterminated ContextPack JSON');
}

describe('TurnExecutor coefficient-confidence authority', () => {
  afterEach(() => {
    delete (global as Record<string, unknown>).__confidence_persisted_graph;
  });

  it('uses canonical persisted confidence and rejects divergent request-only std', async () => {
    const canonical = graphWithStd(0.07, 'Canonical demand signal');
    const request = graphWithStd(0.25, 'REQUEST ONLY demand claim');
    (global as Record<string, unknown>).__confidence_persisted_graph = canonical;
    const adapter = routingAdapter();

    await runTurnExecutor(PAYLOAD, 'req-confidence-canonical', {
      routingAdapter: adapter,
      graphState: request,
    });

    const pack = readPromptPack(adapter);
    expect(pack.graph_context).toEqual({ status: 'canonical' });
    expect(pack.graph.nodes.find((node) => node.id === 'factor_demand')?.label).toBe(
      'Canonical demand signal',
    );
    expect(pack.graph.edges[0]?.coefficient_confidence).toBe('high');
    expect(JSON.stringify(pack)).not.toContain('REQUEST ONLY demand claim');
    expect(JSON.stringify(pack)).not.toContain('uncertain');
    expect(JSON.stringify(pack)).not.toContain('0.25');
  });

  it('keeps valid first-touch structure provisional without attested confidence', async () => {
    (global as Record<string, unknown>).__confidence_persisted_graph = null;
    const request = graphWithStd(0.07, 'Provisional demand signal');
    const adapter = routingAdapter();

    await runTurnExecutor(PAYLOAD, 'req-confidence-provisional', {
      routingAdapter: adapter,
      graphState: request,
    });

    const pack = readPromptPack(adapter);
    expect(pack.graph_context).toEqual({ status: 'provisional' });
    expect(pack.graph.nodes.find((node) => node.id === 'factor_demand')?.label).toBe(
      'Provisional demand signal',
    );
    expect(pack.graph.edges[0]?.relationship).toBe('moderate positive link');
    expect(pack.graph.edges[0]).not.toHaveProperty('coefficient_confidence');
  });
});
