/**
 * READINESS ON THE PACK — THE WIRE, PROVEN AT ROUTE LEVEL.
 *
 * ⭐ WHY THIS FILE EXISTS. `projectContextPackReadiness` has its own unit suite
 * and the assembler has its own; BOTH can be fully green while the capability
 * is DARK — if the one line in `turn-executor.ts` that passes
 * `readiness: readinessForPack` into the assembler is missing, wrong, or never
 * reached. A defended pure function with a dark call site is this estate's
 * chronic failure #1.
 *
 * So this file asserts the capability through the REAL chain —
 *
 *     runTurnExecutor(payload)
 *       → deriveCanonicalReadiness (the canonical verdict for the turn)
 *       → projectContextPackReadiness (reuses summariseReadiness)
 *       → assembleContextPackWithSummary (places `readiness`)
 *       → buildUserMessage (serialises it + appends READINESS_INSTRUCTION)
 *       → the bytes the routing adapter actually receives
 *
 * — and reads its evidence off the LLM adapter's captured arguments.
 *
 * THE DEFECT IT PINS. On deployed staging the assistant told a user *"so
 * nothing there is blocking analysis"* while two factors were the only
 * blockers. The pack carried a readiness STATUS and a blocker COUNT
 * (`coaching_context`) but never the blocker IDENTITY, so the model could not
 * name what was blocking even when it knew something was.
 *
 * THE NEGATIVE CONTROL IS THE POINT (trap #13, at capability scale). A
 * BLOCKED model and a genuinely READY model are run through the same path and
 * the two prompts compared (`the READY control` below). If they were
 * indistinguishable the section would be decoration.
 *
 * ⚠ THIS CLAIM WAS FALSE WHEN FIRST WRITTEN — the header described a ready-model
 * control that did not exist and `CURRENT_GRAPH` was only ever the blocked one.
 * An adversarial review caught it. A false evidence claim in the very file whose
 * job is proving the wire is the worst place for one, so the case is now real.
 *
 * SCOPE, STATED HONESTLY (status ladder). This proves what the model
 * RECEIVES. It does not prove what the model ANSWERS — that is a
 * WIRE/JOURNEY witness against the deployed build. Rung reached here: TESTED.
 *
 * Only the STORES are faked, and every mock factory that replaces a real
 * module spreads what it needs explicitly.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';
import { READINESS_INSTRUCTION } from '../routing/route-with-tool-use.js';

const SCENARIO_ID = randomUUID();

/**
 * ⚠ `exists_probability` and `effect_direction` are REQUIRED by GraphV3. Omit
 * them and the graph fails `safeParse`, no readiness is derived at all, and
 * these tests read as "the wire is cut" when the wire is fine — a false RED
 * that costs an hour. The first draft of the blocked fixture omitted both.
 */
const edge = (from: string, to: string): unknown => ({
  from,
  to,
  strength: { mean: 0.4, std: 0.1 },
  exists_probability: 0.9,
  effect_direction: 'positive',
});

/**
 * A model that CANNOT run: one option only. The canonical readiness authority
 * owns that verdict — this fixture does not assert which code it emits, only
 * that a blocked model and a ready model are told apart on the wire.
 */
const BLOCKED_GRAPH: { nodes: unknown[]; edges: unknown[] } = {
  nodes: [
    { id: 'goal_rev', kind: 'goal', label: 'Revenue growth over the next year' },
    { id: 'opt_local', kind: 'option', label: 'Hire locally' },
    { id: 'factor_salary', kind: 'factor', label: 'Engineer salary in the local market' },
  ],
  edges: [edge('factor_salary', 'goal_rev')],
};

/**
 * A model that genuinely CAN run — canonical `status: 'ready'`, zero open items.
 * Reaching `ready` needs all of: a decision node, >= 2 options, each option
 * carrying an intervention AND a factor edge, and the factor connected to the
 * goal. Derived by probe, not guessed.
 */
const READY_GRAPH: { nodes: unknown[]; edges: unknown[] } = {
  nodes: [
    { id: 'dec', kind: 'decision', label: 'How should we staff the new tier' },
    { id: 'goal_rev', kind: 'goal', label: 'Revenue growth over the next year' },
    {
      id: 'factor_salary',
      kind: 'factor',
      label: 'Engineer salary in the local market',
      observed_state: { value: 95000, unit: 'GBP', source: 'user_edited' },
    },
    { id: 'opt_local', kind: 'option', label: 'Hire locally', interventions: { factor_salary: { value: 95000 } } },
    { id: 'opt_off', kind: 'option', label: 'Offshore partner', interventions: { factor_salary: { value: 55000 } } },
  ],
  edges: [
    edge('factor_salary', 'goal_rev'),
    edge('opt_local', 'factor_salary'),
    edge('opt_off', 'factor_salary'),
    edge('dec', 'opt_local'),
    edge('dec', 'opt_off'),
  ],
};

vi.mock('../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({ summarise: async () => ({ text: 'DECISION FRAME: noop.' }) }),
  resetRollingSummaryForTests: () => undefined,
}));

let CURRENT_GRAPH: unknown = BLOCKED_GRAPH;

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => [],
    countTurns: async () => 0,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readNewestAnalysisFactFor: async () => null,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => CURRENT_GRAPH,
    loadGraphAndBriefText: async () => ({
      graph: CURRENT_GRAPH,
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
    // ⚠ NOT 'converse' — that is not a member of the boundary enum
    // ('clarify' | 'decide' | 'frame' | 'review' | 'propose'). `pnpm typecheck`
    // is BLIND to this file (tsconfig.build.json excludes tests); only the
    // separate `Typecheck Drift (ratchet)` CI job sees it, and it did.
    turn_class: 'decide',
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
          content: [{ type: 'text', text: 'Here is what I can see.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 40 } as ChatWithToolsResult['usage'],
          model: 'claude-sonnet-4-6',
          latencyMs: 25,
        };
      },
    },
  };
}

function routingUserMessage(calls: ChatWithToolsArgs[]): string {
  expect(calls.length).toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user).toBeDefined();
  return typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content);
}

interface ReadinessSection {
  status: string;
  open_items: Array<{ kind: string; description: string; option_label?: string }>;
}

/**
 * The `readiness` section AS SERIALISED into the routing prompt. Brace-matched
 * rather than sliced to a marker, because `buildUserMessage` appends
 * instruction blocks AFTER the JSON — a naive slice swallows them and throws.
 */
function readinessSection(prompt: string): ReadinessSection | undefined {
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
      return (JSON.parse(rest.slice(0, i + 1)) as { readiness?: ReadinessSection }).readiness;
    }
  }
  throw new Error('readinessSection: unterminated ContextPack JSON');
}

async function runTurn(message: string): Promise<string> {
  const { adapter, calls } = textOnlyAdapter();
  await runTurnExecutor(payload(message), `req-${randomUUID()}`, {
    routingAdapter: adapter,
  });
  return routingUserMessage(calls);
}

// The blocked graph is the default; the READY control swaps it and MUST put it
// back, or a later test silently measures the wrong model (trap: a fixture that
// moves under you).
afterEach(() => {
  CURRENT_GRAPH = BLOCKED_GRAPH;
});

describe('ContextPack readiness — the wire', () => {
  it('a blocked model puts the readiness verdict AND its instruction in the routing prompt', async () => {
    CURRENT_GRAPH = BLOCKED_GRAPH;
    const prompt = await runTurn('Is there anything stopping this from running?');

    const readiness = readinessSection(prompt);
    expect(
      readiness,
      'no `readiness` section reached the prompt — the turn-executor wire is cut',
    ).toBeDefined();

    // BY IDENTITY: the canonical status and the canonical blocker KIND, never
    // prose. A one-option model cannot run, and the model is now told which
    // blocker that is rather than only that a count exists.
    expect(readiness!.status).toBe('blocked');
    expect(readiness!.open_items.map((i) => i.kind)).toContain('too_few_options');

    // The ROUTE out reaches the model too — Paul's standing rule: never an
    // honest dead end.
    const item = readiness!.open_items.find((i) => i.kind === 'too_few_options');
    expect(item!.description.trim().length).toBeGreaterThan(0);

    // The code-owned instruction is appended by the SAME condition.
    expect(prompt).toContain(READINESS_INSTRUCTION);
  });

  it('THE READY CONTROL — a genuinely ready model is DISCRIMINATED on the wire', async () => {
    CURRENT_GRAPH = BLOCKED_GRAPH;
    const blockedPrompt = await runTurn('Is there anything stopping this from running?');
    CURRENT_GRAPH = READY_GRAPH;
    const readyPrompt = await runTurn('Is there anything stopping this from running?');

    const blocked = readinessSection(blockedPrompt);
    const ready = readinessSection(readyPrompt);
    expect(blocked, 'blocked arm carried no readiness section').toBeDefined();
    expect(ready, 'ready arm carried no readiness section').toBeDefined();

    // THE DISCRIMINATION. If these agreed, the section would be decoration —
    // present on every turn and carrying no information about the model.
    expect(blocked!.status).toBe('blocked');
    expect(ready!.status).toBe('ready');
    expect(ready!.open_items).toHaveLength(0);
    expect(blocked!.open_items.length).toBeGreaterThan(0);

    // ⚠ AND THE INVERSION, ON THE REAL WIRE: the ready arm's EMPTY list is not
    // what makes it runnable — the STATUS is. A consumer reading emptiness as
    // permission would be right here by luck and wrong on an auto-repairable
    // payload, which is exactly the defect one level down.
    expect(readyPrompt).toContain(READINESS_INSTRUCTION);
  });

  it('open items are DEDUPED — byte-identical copies never reach the prompt', async () => {
    CURRENT_GRAPH = BLOCKED_GRAPH;
    const readiness = readinessSection(await runTurn('What is open?'))!;
    const identities = readiness.open_items.map(
      (i) => `${i.kind}|${i.description}|${i.option_label ?? ''}`,
    );
    expect(new Set(identities).size).toBe(identities.length);
  });

  it('the instruction forbids the exact falsehood that motivated this slice', () => {
    // Bound to the instruction constant, not to a model reply. This asserts the
    // constraint EXISTS in the bytes the model receives; what the model then
    // says is a journey witness, not a unit claim.
    expect(READINESS_INSTRUCTION).toContain('nothing is blocking');
    expect(READINESS_INSTRUCTION).toContain('EMPTY list of open items does NOT mean');
    // The count-suppression clause (adversarial review): two blocker counts
    // disagree on every turn and both blocks claim authority, so the model is
    // told to name what is open and never to state a number.
    expect(READINESS_INSTRUCTION).toContain('Do not state a number of blockers');
    expect(READINESS_INSTRUCTION).toContain('this block governs');
  });
});
