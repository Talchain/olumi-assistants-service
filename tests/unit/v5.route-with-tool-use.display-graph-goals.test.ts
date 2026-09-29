/**
 * V5 routing — `display_graph.goals` must be projected, not passed through.
 *
 * ── THE DEFECT THIS PINS ───────────────────────────────────────────────────
 * `projectCompactGraph` built `ContextPackGraph.goals` as
 * `compact.nodes.filter(n => n.kind === 'goal')` — the WHOLE compact node,
 * unlike `options` two lines above, which is projected down to `{id, label}`.
 * `formatGraphForContext` then passed it straight through (`goals: raw.goals`)
 * and its own header said so: *"`options`, `goals`, `constraints`, `counts`:
 * pass through unchanged."* `projectNode` was never applied to `goals`.
 *
 * `buildUserMessage` substitutes `display_graph` for `graph` and serialises the
 * result with `JSON.stringify`, so EVERY key of those objects reached Sonnet.
 * Measured on the production path at pristine, one goal node arrived TWICE:
 *
 *   graph.nodes[1] → {id, label, kind, unit: "%", display_value: "42%"}   safe
 *   graph.goals[0] → {..., value: 0.42, raw_value: 42, cap: 100, ...}     LEAK
 *
 * The goals passthrough defeated the raw-value strip that `DisplaySafeNode`
 * exists to enforce (A3.1 Task 6: floats stay in `ContextPack.graph` for
 * handlers / freshness / edit_graph; Sonnet sees the formatted string only).
 *
 * ── WHY PROJECTING CANNOT STARVE THE PROMPT ────────────────────────────────
 * `goals` is a by-kind INDEX of `nodes`, not an independent collection — both
 * `ContextPackGraph` constructors derive it by filtering the very same node
 * array (`projectCompactGraph`, `projectGraph`). So every goal is ALREADY in
 * `display_graph.nodes` in projected form. Projecting `goals` removes a
 * duplicate that leaks; it removes no information the model had. It is in fact
 * a net GAIN: the raw compact node has no `display_value` field at all, so the
 * projected entry carries "42%" where the passthrough carried only the float.
 *
 * ── WHY THESE ASSERTIONS ARE ON THE SERIALISED PROMPT, NOT ON THE PACK ─────
 * The pack is not what the model sees. A sibling test in this area asserts on
 * `pack.graph.constraints` — a field `buildUserMessage` destructures away and
 * never serialises — so it could not observe a prompt-facing regression at all.
 * Everything below is parsed back out of the user-message string that the
 * adapter actually received.
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
import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';
import type { GraphV3Compact } from '../../src/orchestrator/context/graph-compact.js';

/** The goal node under test. Bound BY IDENTITY everywhere below (trap 19) —
 *  never by a value predicate another node could satisfy. */
const GOAL_ID = 'goal_churn';
const GOAL_LABEL = 'Reduce Churn';
/** Synthesised by `synthesiseDisplayValue` from value/raw_value/unit/cap.
 *  Measured on the production path, not assumed. */
const GOAL_DISPLAY_VALUE = '42%';

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

function makeAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> };
  calls: ChatWithToolsArgs[];
} {
  const calls: ChatWithToolsArgs[] = [];
  return {
    calls,
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        calls.push(args);
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
 * A real pack through the production assembler — never a stub — so
 * `display_graph` is built by `projectCompactGraph` → `formatGraphForContext`
 * exactly as it is on a live turn.
 *
 * The goal node carries the full numeric quartet (`value`, `raw_value`, `unit`,
 * `cap`) plus both provenance fields, because that is what `compactGraph`
 * emits for a goal whose `observed_state` has been written (e.g. by
 * `add-constraint.ts`). A goal with no `observed_state` cannot exhibit the
 * defect — it has no float to leak — so a bare fixture would have made this
 * suite vacuous (trap 13: an absence assertion needs a presence it could see).
 */
function makePackWithValuedGoal(): ContextPack {
  const compactedGraph = {
    nodes: [
      { id: 'opt_a', kind: 'option', label: 'Aggressive Campaign' },
      {
        id: GOAL_ID,
        kind: 'goal',
        label: GOAL_LABEL,
        value: 0.42,
        raw_value: 42,
        unit: '%',
        cap: 100,
        provenance: 'ai_inferred',
        source: 'ai',
      },
    ],
    edges: [{ from: 'opt_a', to: GOAL_ID, strength: 0.5, exists: 0.9 }],
    _node_count: 2,
    _edge_count: 1,
  } as unknown as GraphV3Compact;

  return assembleContextPack({
    payload: makeMessagePayload({
      stage: 'analyse',
      message: 'run analysis',
      scenario_id: 'scen-goals-1',
      turn_id: 'turn-goals-1',
      turn_class: 'decide',
    }),
    priorTurns: [],
    compactedGraph,
  });
}

function userMessageContent(args: ChatWithToolsArgs): string {
  const first = args.messages[0]!;
  expect(first.role).toBe('user');
  if (typeof first.content === 'string') return first.content;
  const blocks = first.content as ReadonlyArray<{ type: string; text?: string }>;
  return blocks
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text!)
    .join('\n');
}

interface ParsedContextPack {
  graph: {
    nodes: Array<Record<string, unknown>>;
    goals: Array<Record<string, unknown>>;
    options: unknown;
    counts: Record<string, number>;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

/**
 * Slice the ContextPack JSON out of the routing user message by brace-matching
 * (string-aware), then parse it. Structural, per-field assertions on the RESULT
 * cannot be fooled by a stray `"value":` appearing in coaching prose or a label
 * elsewhere in the prompt — which a bare `content.includes('0.42')` could be.
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

async function serialisedPromptForValuedGoal(): Promise<{
  content: string;
  parsed: ParsedContextPack;
}> {
  const pack = makePackWithValuedGoal();
  const { adapter, calls } = makeAdapter();

  await routeWithToolUse(pack, 'run analysis', {
    requestId: 'req-goals-1',
    adapter,
    systemPromptOverride: ROUTING_SYSTEM_PROMPT,
  });

  expect(calls).toHaveLength(1);
  const content = userMessageContent(calls[0]!);
  return { content, parsed: parseContextPackFromUserMessage(content) };
}

/** Find the goal entry BY ID. Never `find(g => g.value === 0.42)` — a value
 *  predicate another node could satisfy is exactly how a test ends up passing
 *  on the wrong object (trap 19). */
function goalById(parsed: ParsedContextPack, id: string): Record<string, unknown> {
  const found = parsed.graph.goals.find((g) => g['id'] === id);
  expect(
    found,
    `no goal with id "${id}" in the serialised prompt — the fixture, not the projection, has changed`,
  ).toBeDefined();
  return found!;
}

describe('display_graph.goals is projected through projectNode, not passed through', () => {
  /**
   * PRECONDITION PIN (trap 13b). If the fixture ever stops producing a goal
   * that COULD leak, every absence assertion below would pass vacuously. This
   * asserts the raw pack still carries the float, so a green result downstream
   * is provably the projection's doing and not the fixture's failure.
   */
  it('precondition: the raw ContextPack.graph.goals still carries the float (handlers need it)', () => {
    const pack = makePackWithValuedGoal();
    const rawGoals = pack.graph.goals as ReadonlyArray<Record<string, unknown>>;
    const rawGoal = rawGoals.find((g) => g['id'] === GOAL_ID);
    expect(rawGoal).toBeDefined();
    // The raw pack is the handler/freshness/edit_graph channel and MUST keep
    // the float. This fix is scoped to the display projection only.
    expect(rawGoal!['value']).toBe(0.42);
    expect(rawGoal!['raw_value']).toBe(42);
  });

  it('graph.goals in the serialised prompt carries display_value and NO raw numeric fields', async () => {
    const { parsed } = await serialisedPromptForValuedGoal();

    expect(Array.isArray(parsed.graph.goals)).toBe(true);
    expect(parsed.graph.goals.length).toBe(1);

    const goal = goalById(parsed, GOAL_ID);

    // ── PRESENCE. An absence assertion alone can pass by projecting NOTHING
    //    (an empty object, or an empty array). These pin that the model still
    //    receives everything it needs to reason about the goal.
    expect(goal['id']).toBe(GOAL_ID);
    expect(goal['label']).toBe(GOAL_LABEL);
    expect(goal['kind']).toBe('goal');
    expect(goal['unit']).toBe('%');
    expect(goal['display_value']).toBe(GOAL_DISPLAY_VALUE);

    // ── ABSENCE. The raw-float cage, on the channel the model actually reads.
    expect(goal).not.toHaveProperty('value');
    expect(goal).not.toHaveProperty('raw_value');
    expect(goal).not.toHaveProperty('cap');

    // Non-numeric internals that `projectNode` also drops for every other node
    // kind. Listed explicitly because PR #1091 would set `provenance` on every
    // goal, and this passthrough was its ONLY route to the model.
    expect(goal).not.toHaveProperty('provenance');
    expect(goal).not.toHaveProperty('source');
    expect(goal).not.toHaveProperty('_raw_provenance');
  });

  it('no number of any kind survives on a serialised goal', async () => {
    const { parsed } = await serialisedPromptForValuedGoal();
    const goal = goalById(parsed, GOAL_ID);

    // Field-by-field absence above pins the KNOWN leaking keys. This pins the
    // CLASS, so a new numeric field added to CompactNode later cannot ride the
    // goals channel to the model unobserved (trap 12d: a hand-listed set needs
    // a completeness check that is not derived from the same list).
    for (const [key, value] of Object.entries(goal)) {
      expect(typeof value, `goal.${key} is a raw ${typeof value}`).not.toBe('number');
    }
  });

  it('the serialised goals array contains the display string and not the raw float', async () => {
    const { content } = await serialisedPromptForValuedGoal();

    // Byte-level check, scoped to the `"goals": [...]` region of the actual
    // prompt string. Scoped rather than whole-prompt because `0.42` may
    // legitimately appear elsewhere; an unscoped assertion would be testing
    // something other than what it claims.
    const goalsIdx = content.indexOf('"goals"');
    expect(goalsIdx).toBeGreaterThan(-1);
    const closeIdx = content.indexOf(']', goalsIdx);
    expect(closeIdx).toBeGreaterThan(goalsIdx);
    const goalsRegion = content.slice(goalsIdx, closeIdx + 1);

    expect(goalsRegion).toContain(GOAL_ID);
    expect(goalsRegion).toContain(GOAL_DISPLAY_VALUE);
    expect(goalsRegion).not.toContain('0.42');
    expect(goalsRegion).not.toContain('"raw_value"');
  });

  it('a serialised goal is byte-identical to the same node in graph.nodes', async () => {
    const { parsed } = await serialisedPromptForValuedGoal();

    // THE INVARIANT THE FIX RESTS ON: `goals` is a by-kind index of `nodes`,
    // so the two projections of one node must agree exactly. If they ever
    // diverge, `goals` has become an independent channel again and the
    // "projecting starves nothing" argument no longer holds.
    const goal = goalById(parsed, GOAL_ID);
    const node = parsed.graph.nodes.find((n) => n['id'] === GOAL_ID);
    expect(node).toBeDefined();
    expect(goal).toEqual(node);
  });

  it('counts are unaffected by the projection', async () => {
    const { parsed } = await serialisedPromptForValuedGoal();
    // Projection must not drop entries — a projector that returned null for
    // every goal would satisfy every absence assertion above.
    expect(parsed.graph.counts['goals']).toBe(1);
    expect(parsed.graph.goals.length).toBe(parsed.graph.counts['goals']);
  });
});
