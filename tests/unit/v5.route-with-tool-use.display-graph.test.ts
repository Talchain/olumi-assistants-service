/**
 * V5 routing — outbound display-safe graph payload (brief A2.1).
 *
 * Asserts that `buildUserMessage` swaps `display_graph` in for `graph`
 * when serialising the ContextPack into the routing prompt:
 *   - Sonnet sees decision-language `relationship` phrases, never raw
 *     `strength`/`exists` floats or internal node numerics.
 *   - Bare `from`/`to` IDs are accompanied by human-readable
 *     `from_label`/`to_label`.
 *   - Raw `ContextPack.graph` remains intact for handlers / freshness /
 *     telemetry — the caller's pack is untouched.
 *   - Track 2A defence-in-depth sanitiser sees the LLM-facing user
 *     message and reports `structural_matches === 0` (no raw-edge prose
 *     patterns slip through).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { setTestSink } from '../../src/utils/telemetry.js';
import {
  routeWithToolUse,
  ROUTING_SYSTEM_PROMPT,
} from '../../src/orchestrator-v5/routing/route-with-tool-use.js';
import { OLUMI_ACTION_TOOL_NAME } from '../../src/orchestrator-v5/routing/tool-schema.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../src/adapters/llm/types.js';
import type { ContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import { assembleContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
import { sanitiseAssistantTextProse } from '../../src/orchestrator-v5/format/numeric-prose-formatter.js';
import type { GraphV3Compact } from '../../src/orchestrator/context/graph-compact.js';

const VALID_TOOL_INPUT = {
  intent_class: 'execute',
  action: {
    handler_id: 'run_analysis',
    entity: {
      id: 'opt_a',
      kind: 'option',
      resolution_status: 'resolved',
      resolution_method: 'id_match',
    },
    parameters: [],
    cited_context_fields: ['graph.options'],
  },
};

function toolUseResult(): ChatWithToolsResult {
  const content: ToolResponseBlock[] = [
    {
      type: 'tool_use',
      id: 'tu-1',
      name: OLUMI_ACTION_TOOL_NAME,
      input: VALID_TOOL_INPUT as Record<string, unknown>,
    },
  ];
  return {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 100, output_tokens: 20 } as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
}

interface RecordedCall {
  args: ChatWithToolsArgs;
}

function makeAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> };
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  return {
    calls,
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        calls.push({ args });
        return toolUseResult();
      },
    },
  };
}

beforeEach(() => {
  setTestSink(() => {});
});

afterEach(() => {
  setTestSink(null);
});

/**
 * Build a real ContextPack via the assembler (not a stub) so that
 * `display_graph` is populated through the production path. Edges
 * carry numeric `strength` and `exists` values that exercise every
 * band, including a near-zero "negligible" case.
 */
function makePackWithGraph(): ContextPack {
  const compactedGraph: GraphV3Compact = {
    nodes: [
      { id: 'fac_marketing', kind: 'factor', label: 'Marketing Spend' },
      { id: 'fac_leads', kind: 'factor', label: 'New Leads' },
      { id: 'fac_brand', kind: 'factor', label: 'Brand Awareness' },
      { id: 'opt_a', kind: 'option', label: 'Aggressive Campaign' },
      { id: 'goal_growth', kind: 'goal', label: 'Quarterly Growth' },
    ],
    edges: [
      { from: 'fac_marketing', to: 'fac_leads', strength: 0.75, exists: 0.9 },
      { from: 'fac_leads', to: 'goal_growth', strength: -0.4, exists: 0.7 },
      { from: 'fac_brand', to: 'goal_growth', strength: 0.02, exists: 0.5 },
    ],
    _node_count: 5,
    _edge_count: 3,
  };
  return assembleContextPack({
    payload: {
      kind: 'message',
      stage: 'analyse',
      message: 'run analysis',
      scenario_id: 'scen-1',
      turn_id: 'turn-1',
      created_at: new Date().toISOString(),
    } as Parameters<typeof assembleContextPack>[0]['payload'],
    priorTurns: [],
    compactedGraph,
  });
}

function userMessageContent(args: ChatWithToolsArgs): string {
  const first = args.messages[0]!;
  expect(first.role).toBe('user');
  if (typeof first.content === 'string') return first.content;
  // Anthropic message content can be block array; flatten text blocks.
  const blocks = first.content as ReadonlyArray<{ type: string; text?: string }>;
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('\n');
}

describe('display-safe graph reaches Sonnet via buildUserMessage (A2.1)', () => {
  it('substitutes display_graph for graph in the outbound user message', async () => {
    const pack = makePackWithGraph();
    const { adapter, calls } = makeAdapter();

    await routeWithToolUse(pack, 'run analysis', {
      requestId: 'req-1',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });

    expect(calls).toHaveLength(1);
    const content = userMessageContent(calls[0]!.args);

    // Decision-language phrases present.
    expect(content).toContain('strong positive link'); // 0.75 → strong
    expect(content).toContain('moderate negative link'); // -0.4 → moderate
    expect(content).toContain('negligible link'); // 0.02 → negligible

    // Human labels surfaced for edge endpoints.
    expect(content).toContain('Marketing Spend');
    expect(content).toContain('New Leads');
    expect(content).toContain('Quarterly Growth');
  });

  it('strips raw strength / exists / strength_mean / strength_std / exists_probability', async () => {
    const pack = makePackWithGraph();
    const { adapter, calls } = makeAdapter();

    await routeWithToolUse(pack, 'run analysis', {
      requestId: 'req-1',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });

    const content = userMessageContent(calls[0]!.args);

    expect(content).not.toMatch(/strength_mean/);
    expect(content).not.toMatch(/strength_std/);
    expect(content).not.toMatch(/exists_probability/);
    expect(content).not.toMatch(/"mean":/);
    expect(content).not.toMatch(/mean=/);

    // Within the graph block of the JSON, no `"strength":` / `"exists":` keys.
    // (The whole JSON also includes `display_analysis` etc — we narrow to the
    //  graph slice via a forgiving substring match.)
    const graphSliceMatch = content.match(/"graph":\s\{[\s\S]*?\n {2}\}/);
    expect(graphSliceMatch).not.toBeNull();
    const graphSlice = graphSliceMatch![0];
    expect(graphSlice).not.toMatch(/"strength":/);
    expect(graphSlice).not.toMatch(/"exists":/);
    expect(graphSlice).not.toMatch(/plain_interpretation/);
    // Raw decimal floats should not appear inside edge data.
    // (Counts are integers; bare `: 0.xx` would only come from leaked floats.)
    const edgesBlockMatch = graphSlice.match(/"edges":\s\[[\s\S]*?\]/);
    expect(edgesBlockMatch).not.toBeNull();
    expect(edgesBlockMatch![0]).not.toMatch(/-?0\.\d/);
  });

  it('Track 2A: serialised user message yields zero structural matches', async () => {
    const pack = makePackWithGraph();
    const { adapter, calls } = makeAdapter();

    await routeWithToolUse(pack, 'run analysis', {
      requestId: 'req-1',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });

    const content = userMessageContent(calls[0]!.args);
    const result = sanitiseAssistantTextProse(content);
    expect(result.structural_matches).toBe(0);
  });

  it('does not mutate the caller\'s ContextPack — raw graph survives intact for handlers', async () => {
    const pack = makePackWithGraph();
    // Snapshot raw graph fields the handlers / freshness path depend on.
    const rawEdgesBefore = JSON.parse(JSON.stringify(pack.graph.edges));
    const displayGraphBefore = JSON.parse(JSON.stringify(pack.display_graph));

    const { adapter } = makeAdapter();
    await routeWithToolUse(pack, 'run analysis', {
      requestId: 'req-1',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });

    // Raw edges still carry numeric `strength` / `exists` for handlers.
    expect(pack.graph.edges).toEqual(rawEdgesBefore);
    const firstRawEdge = pack.graph.edges[0] as { strength: number; exists: number };
    expect(typeof firstRawEdge.strength).toBe('number');
    expect(typeof firstRawEdge.exists).toBe('number');

    // display_graph still carries decision-language phrases.
    expect(pack.display_graph).toEqual(displayGraphBefore);
    expect(pack.display_graph.edges[0]!.relationship).toMatch(/positive link|negative link|negligible link/);
  });
});
