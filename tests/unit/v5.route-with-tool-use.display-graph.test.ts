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

interface ParsedContextPack {
  graph: {
    edges: Array<Record<string, unknown>>;
    nodes: Array<Record<string, unknown>>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * Parse the ContextPack JSON out of the routing user message. The user
 * message format is `## ContextPack\n<json>\n\n## User turn\n<message>`.
 * Parsing the JSON (rather than regex-slicing) lets per-field assertions
 * be precise — a stray `"strength":` somewhere in display_analysis labels
 * or coaching prose can't fool a structural assertion on `graph.edges`.
 */
function parseContextPackFromUserMessage(content: string): ParsedContextPack {
  const headingIdx = content.indexOf('## ContextPack');
  expect(headingIdx).toBeGreaterThanOrEqual(0);
  const jsonStart = content.indexOf('{', headingIdx);
  expect(jsonStart).toBeGreaterThan(headingIdx);
  let depth = 0;
  let jsonEnd = -1;
  let inString = false;
  let escape = false;
  for (let i = jsonStart; i < content.length; i++) {
    const ch = content[i]!;
    if (escape) { escape = false; continue; }
    if (ch === '\\') { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) { jsonEnd = i + 1; break; }
    }
  }
  expect(jsonEnd).toBeGreaterThan(jsonStart);
  return JSON.parse(content.slice(jsonStart, jsonEnd)) as ParsedContextPack;
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

  it('graph.edges in the parsed ContextPack carry no raw numeric edge fields', async () => {
    const pack = makePackWithGraph();
    const { adapter, calls } = makeAdapter();

    await routeWithToolUse(pack, 'run analysis', {
      requestId: 'req-1',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });

    const content = userMessageContent(calls[0]!.args);
    const parsed = parseContextPackFromUserMessage(content);

    expect(Array.isArray(parsed.graph.edges)).toBe(true);
    expect(parsed.graph.edges.length).toBeGreaterThan(0);

    const ID_PREFIX = /^(fac|opt|goal|risk|out|edge)_/;
    for (const edge of parsed.graph.edges) {
      // No raw numeric leakage in any shape.
      expect(edge).not.toHaveProperty('strength');
      expect(edge).not.toHaveProperty('strength_mean');
      expect(edge).not.toHaveProperty('strength_std');
      expect(edge).not.toHaveProperty('exists');
      expect(edge).not.toHaveProperty('exists_probability');
      expect(edge).not.toHaveProperty('plain_interpretation');
      expect(edge).not.toHaveProperty('effect_direction');
      expect(edge).not.toHaveProperty('_raw_provenance');
      // Decision-language relationship phrase present.
      expect(typeof edge['relationship']).toBe('string');
      // Human labels surfaced; no internal ID prefixes in the prose-shaped fields.
      expect(typeof edge['from_label']).toBe('string');
      expect(typeof edge['to_label']).toBe('string');
      expect(edge['from_label'] as string).not.toMatch(ID_PREFIX);
      expect(edge['to_label'] as string).not.toMatch(ID_PREFIX);
      // No raw decimal floats survive on any edge field at any depth.
      const json = JSON.stringify(edge);
      expect(json).not.toMatch(/-?\d+\.\d/);
    }
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

  it('assembler raw-graph fallback (no compactedGraph) also yields decision-language edges', async () => {
    // The assembler has TWO graph projection paths: `compactedGraph` (used
    // by the V5 turn executor) and `graph` (raw passthrough fallback).
    // The raw-graph path preserves canonical GraphV3T edge shape
    // (`strength: { mean, std }` + `effect_direction`); A2.1 must handle
    // that shape too — otherwise the public API silently degrades to
    // "negligible link" on every edge when callers don't pre-compact.
    const rawPack = assembleContextPack({
      payload: {
        kind: 'message',
        stage: 'analyse',
        message: 'run analysis',
        scenario_id: 'scen-2',
        turn_id: 'turn-2',
        created_at: new Date().toISOString(),
      } as Parameters<typeof assembleContextPack>[0]['payload'],
      priorTurns: [],
      graph: {
        nodes: [
          { id: 'fac_marketing', kind: 'factor', label: 'Marketing Spend' },
          { id: 'fac_leads', kind: 'factor', label: 'New Leads' },
          { id: 'goal_growth', kind: 'goal', label: 'Quarterly Growth' },
        ],
        edges: [
          {
            from: 'fac_marketing',
            to: 'fac_leads',
            strength: { mean: 0.55, std: 0.12 },
            exists_probability: 0.9,
            effect_direction: 'positive',
          },
          {
            from: 'fac_leads',
            to: 'goal_growth',
            strength: { mean: 0.4, std: 0.1 },
            exists_probability: 0.7,
            effect_direction: 'negative',
          },
        ],
      },
    });

    const { adapter, calls } = makeAdapter();
    await routeWithToolUse(rawPack, 'run analysis', {
      requestId: 'req-raw',
      adapter,
      systemPromptOverride: ROUTING_SYSTEM_PROMPT,
    });

    const parsed = parseContextPackFromUserMessage(userMessageContent(calls[0]!.args));
    expect(parsed.graph.edges).toHaveLength(2);
    expect(parsed.graph.edges[0]!['relationship']).toBe('moderate positive link');
    expect(parsed.graph.edges[1]!['relationship']).toBe('moderate negative link');
    // No raw fields leak from the canonical-shape input either.
    for (const edge of parsed.graph.edges) {
      expect(edge).not.toHaveProperty('strength');
      expect(edge).not.toHaveProperty('strength_mean');
      expect(edge).not.toHaveProperty('strength_std');
      expect(edge).not.toHaveProperty('exists_probability');
      expect(edge).not.toHaveProperty('effect_direction');
    }
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
