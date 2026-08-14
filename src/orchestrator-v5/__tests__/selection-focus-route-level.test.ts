/**
 * SELECTION-AWARE ANSWERING (hop 4) — THE WIRE, PROVEN AT ROUTE LEVEL.
 *
 * ⭐⭐ WHY THIS FILE EXISTS, AND WHY IT IS THE MOST IMPORTANT ONE IN THE SLICE.
 *
 * `projectFocus` has its own unit suite and `buildUserMessage` has its own
 * prompt suite, and BOTH can be fully green while the capability is DARK — if
 * the one line in `turn-executor.ts` that passes `selection: context.selection`
 * into the assembler is missing, wrong, or never reached. A defended pure
 * function with a dark call site is this estate's chronic failure #1: 42
 * roadmap items have been working code no user could reach.
 *
 * So this file asserts the capability through the REAL chain —
 *
 *     runTurnExecutor(payload, { selectedElements })
 *       → buildTurnContext (resolves the selection against the persisted graph)
 *       → assembleContextPackWithSummary (projects `focus`)
 *       → buildUserMessage (serialises it + appends FOCUS_INSTRUCTION)
 *       → the bytes the routing adapter actually receives
 *
 * — and reads its evidence off the LLM adapter's captured arguments. Nothing
 * here inspects an intermediate object: if the wire is cut anywhere along it,
 * these tests go red.
 *
 * THE NEGATIVE CONTROL IS THE POINT (trap #13, at capability scale). The same
 * question is run twice — once with a selection, once without — and the two
 * prompts are compared. If they were indistinguishable, the grounding would be
 * decoration. What is asserted is the honest discriminator: the analysis value
 * is BOUND TO THE SELECTED ELEMENT BY ID only in the selected arm.
 *
 * SCOPE, STATED HONESTLY (status ladder). This proves what the model RECEIVES.
 * It does not prove what the model ANSWERS — that is a WIRE/JOURNEY witness
 * against the deployed build, taken post-merge by the battery lane. Rung
 * reached here: TESTED.
 *
 * Only the STORES are faked, and every mock factory spreads `importOriginal()`
 * where it replaces a real module, because a hand-listed factory REPLACES the
 * module and silently loses everything it forgot.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { setTestSink } from '../../utils/telemetry.js';
import { computeAnalysisAffectingGraphHash } from '../context/graph-hash.js';
import { FOCUS_INSTRUCTION } from '../routing/route-with-tool-use.js';

const SCENARIO_ID = randomUUID();

const FACTOR_ID = 'factor_salary';
const FACTOR_LABEL = 'Engineer salary in the local market';
const OPTION_ID = 'opt_local';
const OPTION_LABEL = 'Hire locally';

/**
 * The PERSISTED graph the session store returns — this is what
 * `resolveTurnSelection` resolves the selection against, so the selected
 * element's fields come from HERE and never from the client's claim.
 */
const PERSISTED_GRAPH = {
  nodes: [
    {
      id: FACTOR_ID,
      kind: 'factor',
      label: FACTOR_LABEL,
      description: 'What a senior engineer costs in this market.',
      category: 'external',
      observed_state: { value: 95000, unit: 'GBP', source: 'user_edited' },
    },
    {
      id: 'factor_ramp',
      kind: 'factor',
      label: 'Ramp-up time for a new joiner',
      observed_state: { value: 12, unit: 'weeks', source: 'cee_inference' },
    },
    { id: OPTION_ID, kind: 'option', label: OPTION_LABEL },
    { id: 'opt_offshore', kind: 'option', label: 'Offshore partner' },
    { id: 'goal_rev', kind: 'goal', label: 'Revenue growth over the next year' },
  ],
  edges: [{ from: FACTOR_ID, to: 'goal_rev', strength: { mean: 0.4, std: 0.1 } }],
};

vi.mock('../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({ summarise: async () => ({ text: 'DECISION FRAME: noop.' }) }),
  resetRollingSummaryForTests: () => undefined,
}));

/**
 * A PRIOR RUN_ANALYSIS on this scenario.
 *
 * Without it the turn carries no analysis, every element honestly reports
 * `analysis_link: 'no_analysis'`, and the amended acceptance's "the answer uses
 * the ANALYSIS OUTPUTS" half could not be observed through the wired path at
 * all. `option_comparison` is what carries `option_id` — the structural key
 * `buildAnalysisLabelIndex` reads to make the focus join an IDENTITY join.
 */
const ANALYSIS_TURN_ROW_ID = 'bbbbbbbb-7a15-4bbb-8bbb-bbbbbbbbbbbb';
const ANALYSIS_TURN = {
  id: ANALYSIS_TURN_ROW_ID,
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-run-analysis',
  turn_class: 'handler',
  handler_id: 'run_analysis',
  request_hash: 'sha256:prior-ra',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
  user_message: 'Run the analysis',
  assistant_message: 'Analysis complete.',
};

const RUN_ANALYSIS_FACT: Record<string, unknown> = {
  fact_type: 'run_analysis',
  fact_version: 1,
  noop: false,
  result: {
    leading_option_id: OPTION_ID,
    summary: 'Prior analysis result',
    // Hashed from the SAME persisted graph the selection resolves against, so
    // the analysis reads as current rather than stale.
    graph_hash_at_run: computeAnalysisAffectingGraphHash(PERSISTED_GRAPH as never),
    computed_at: new Date(Date.now() - 60_000).toISOString(),
    enrichment: {
      analysis_status: 'completed',
      option_comparison: [
        { option_id: OPTION_ID, option_label: OPTION_LABEL, win_probability: 0.62, outcome_mean: 0.5 },
        { option_id: 'opt_offshore', option_label: 'Offshore partner', win_probability: 0.38, outcome_mean: 0.3 },
      ],
    },
    win_probabilities: { [OPTION_ID]: 0.62, opt_offshore: 0.38 },
  },
};

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (_id: string, limit = 20) => [ANALYSIS_TURN].slice(0, limit),
    countTurns: async () => 1,
    readFactsFor: async (turnRowIds: readonly string[]) =>
      turnRowIds.includes(ANALYSIS_TURN_ROW_ID) ? [RUN_ANALYSIS_FACT] : [],
    readFactsWithTurnFor: async (turnRowIds: readonly string[]) =>
      turnRowIds.includes(ANALYSIS_TURN_ROW_ID)
        ? [
            {
              fact: RUN_ANALYSIS_FACT,
              turn_id: ANALYSIS_TURN_ROW_ID,
              fact_created_at: new Date(Date.now() - 60_000).toISOString(),
            },
          ]
        : [],
    readNewestAnalysisFactFor: async () => RUN_ANALYSIS_FACT,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => PERSISTED_GRAPH,
    loadGraphAndBriefText: async () => ({
      graph: PERSISTED_GRAPH,
      briefText: 'Hire locally or engage an offshore partner?',
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'converse',
    stage: 'analyse',
  };
}

function textOnlyAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> };
  calls: ChatWithToolsArgs[];
} {
  const calls: ChatWithToolsArgs[] = [];
  return {
    calls,
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        calls.push(args);
        return {
          content: [{ type: 'text', text: 'Here is what I would focus on.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 40 } as ChatWithToolsResult['usage'],
          model: 'claude-sonnet-4-6',
          latencyMs: 25,
        };
      },
    },
  };
}

/** The exact user message the routing adapter received. */
function routingUserMessage(calls: ChatWithToolsArgs[]): string {
  expect(calls.length).toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user).toBeDefined();
  return typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content);
}

interface FocusSection {
  elements: Array<{
    id: string;
    label: string;
    value?: number;
    unit?: string;
    analysis_link: string;
    analysis?: Record<string, string>;
  }>;
  unresolved: string;
  requested_count: number;
  unresolved_count: number;
}

/**
 * The `focus` section AS SERIALISED into the routing prompt. Brace-matched
 * rather than sliced to a marker, because `buildUserMessage` appends
 * instruction blocks AFTER the JSON — a naive slice swallows them and throws.
 */
function focusSection(prompt: string): FocusSection | undefined {
  const marker = '## ContextPack\n';
  const at = prompt.indexOf(marker);
  expect(at).toBeGreaterThanOrEqual(0);
  const rest = prompt.slice(at + marker.length);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) {
      return (JSON.parse(rest.slice(0, i + 1)) as { focus?: FocusSection }).focus;
    }
  }
  throw new Error('focusSection: unterminated ContextPack JSON');
}

async function runTurn(
  message: string,
  selectedElements?: { node_ids: readonly string[]; edge_ids: readonly string[] } | null,
): Promise<string> {
  const { adapter, calls } = textOnlyAdapter();
  await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
    routingAdapter: adapter,
    ...(selectedElements !== undefined ? { selectedElements } : {}),
  });
  return routingUserMessage(calls);
}

const QUESTION = 'why does this one matter?';

beforeEach(() => {
  setTestSink(() => undefined);
});
afterEach(() => {
  setTestSink(null);
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// THE WIRE — the selection reaches the model through the real chain
// ---------------------------------------------------------------------------

describe('hop 4 route-level — the selected element reaches the routing prompt', () => {
  it('a selected FACTOR arrives in the prompt with its persisted id, label and value', async () => {
    const prompt = await runTurn(QUESTION, { node_ids: [FACTOR_ID], edge_ids: [] });
    const focus = focusSection(prompt);
    expect(focus, 'no `focus` section reached the prompt — the turn-executor wire is cut').toBeDefined();

    // Bound by IDENTITY, never by a value predicate another node could satisfy.
    const el = focus!.elements.find((e) => e.id === FACTOR_ID);
    expect(el, `focus carried ${JSON.stringify(focus!.elements.map((e) => e.id))}`).toBeDefined();
    expect(el!.label).toBe(FACTOR_LABEL);
    // Copied from the PERSISTED graph, which is the whole point of hop 3.
    expect(el!.value).toBe(95000);
    expect(el!.unit).toBe('GBP');
    expect(focus!.unresolved).toBe('none');
  });

  it('the code-owned answering sanction rides the SAME turn', async () => {
    // Proves the emission is REACHABLE, not merely defined — the same reasoning
    // the decision-records route-level test applies to its own instruction.
    const prompt = await runTurn(QUESTION, { node_ids: [FACTOR_ID], edge_ids: [] });
    expect(prompt).toContain(FOCUS_INSTRUCTION);
  });

  it('DISCRIMINATING PAIR — selecting a DIFFERENT node puts a DIFFERENT element on the wire', async () => {
    const a = focusSection(await runTurn(QUESTION, { node_ids: [FACTOR_ID], edge_ids: [] }))!;
    const b = focusSection(await runTurn(QUESTION, { node_ids: [OPTION_ID], edge_ids: [] }))!;
    expect(a.elements.map((e) => e.id)).toEqual([FACTOR_ID]);
    expect(b.elements.map((e) => e.id)).toEqual([OPTION_ID]);
    // Neither alone proves binding; the inequality does.
    expect(a.elements[0]).not.toEqual(b.elements[0]);
  });

  it('an unresolved id is DISCLOSED, never silently dropped and never guessed into another node', async () => {
    const prompt = await runTurn(QUESTION, {
      node_ids: [FACTOR_ID, 'ghost_node'],
      edge_ids: [],
    });
    const focus = focusSection(prompt)!;
    expect(focus.requested_count).toBe(2);
    expect(focus.unresolved_count).toBe(1);
    expect(focus.unresolved).toBe('not_in_model');
    // The resolved one is still there, and nothing was invented for the ghost.
    expect(focus.elements.map((e) => e.id)).toEqual([FACTOR_ID]);
  });
});

// ---------------------------------------------------------------------------
// THE NEGATIVE CONTROL — the capability-scale trap-13 control
// ---------------------------------------------------------------------------

describe('hop 4 route-level — NEGATIVE CONTROL: the same question without a selection', () => {
  it('produces NO focus section and NO answering sanction', async () => {
    const prompt = await runTurn(QUESTION, null);
    expect(focusSection(prompt)).toBeUndefined();
    expect(prompt).not.toContain(FOCUS_INSTRUCTION);
  });

  it('is MEASURABLY less element-specific than the selected arm', async () => {
    const selected = await runTurn(QUESTION, { node_ids: [OPTION_ID], edge_ids: [] });
    const generic = await runTurn(QUESTION, null);

    // If these two were indistinguishable, the grounding would be decoration.
    expect(selected).not.toBe(generic);

    // The honest discriminator, stated precisely: `display_analysis` already
    // carries every option's win probability, so the VALUE alone appears in
    // both arms. What appears ONLY in the selected arm is the value BOUND TO
    // THIS ELEMENT BY ID.
    const focus = focusSection(selected)!;
    const el = focus.elements.find((e) => e.id === OPTION_ID)!;
    expect(el.analysis_link).toBe('linked');
    expect(el.analysis?.win_probability).toBeDefined();

    expect(focusSection(generic)).toBeUndefined();

    // And a strictly countable delta, so "more specific" is not a vibe.
    const count = (hay: string, needle: string): number => hay.split(needle).length - 1;
    expect(count(selected, OPTION_ID)).toBeGreaterThan(count(generic, OPTION_ID));
  });
});
