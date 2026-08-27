/**
 * THE FACTOR-VALUE SANCTION — PROVEN IN THE RENDERED PROMPT BYTES.
 *
 * ⭐⭐ WHY THIS FILE EXISTS.
 *
 * PR #1122 put `factor_values` on the ContextPack and shipped it MUTE: the data
 * reached the prompt and nothing told the model it was authoritative. Its
 * neighbour states the failure exactly — *"the field alone would leave the
 * model free to prefer the transcript"* (`GOAL_TARGET_INSTRUCTION`'s gating
 * comment). This file pins the missing half.
 *
 * ⚠⚠ IT ASSERTS THE BYTES, NEVER THE CONSTANT. A test that imports
 * `FACTOR_VALUES_INSTRUCTION` and checks it is a non-empty string passes with
 * the emission block DELETED — this repo has already shipped a gate that
 * *"rendered the message and threw it away"*, and that discard WAS the defect.
 * So every assertion below reads the user message the routing adapter actually
 * received, off the adapter's captured arguments, through the REAL chain:
 *
 *     runTurnExecutor(payload)
 *       → buildTurnContext                (loads the PERSISTED graph)
 *       → assembleContextPackWithSummary  (`factorValues`)
 *       → buildUserMessage                (pack + code-owned instructions)
 *       → the bytes the routing adapter receives
 *
 * ⚠ THE SANCTION GATE CANNOT COVER THIS FIELD, so this file is not redundant
 * with it. `prompt-pack-sanction.gate.test.ts` only demands sanction for fields
 * carrying a string of FOUR OR MORE words (`proseLeaves`). Factor labels are
 * short — its own fixture uses "Churn rate", "Onboarding time", "Support load",
 * every one of them two words — so `factor_values` scores zero prose leaves and
 * THE GATE can never fire on it. Registration in `CODE_OWNED_INSTRUCTIONS` buys
 * the EMISSION check (which this file's siblings rely on); it does NOT buy a
 * gate that discriminates on this field. These tests are the discrimination.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../adapters/llm/types.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { observeSerialisedPack } from './observe-serialised-pack.js';
import {
  FACTOR_VALUES_INSTRUCTION,
  FOCUS_INSTRUCTION,
  GOAL_TARGET_INSTRUCTION,
  READINESS_INSTRUCTION,
  BRIEF_INSTRUCTION,
  GRAPH_CONTEXT_INSTRUCTION,
  COACHING_CONTEXT_INSTRUCTION,
  OLDER_RELEVANT_FACTS_INSTRUCTION,
} from '../../routing/route-with-tool-use.js';

const SCENARIO_ID = randomUUID();

/** VALUED and user-authored — both axes populated. */
const VALUED_LABEL = 'Monthly ticket volume';
/** ⭐ THE WITNESSED SHAPE: no value, YET stamped as the model's own estimate. */
const UNVALUED_AI_LABEL = 'Support quality risk';

/**
 * The persisted graph the session store returns. `null` is a legal arm — it is
 * how `projectFactorValueRecord` returns `undefined`, which is what drives the
 * ABSENT-key byte-identity test below.
 */
let PERSISTED_GRAPH: unknown = null;

function baseNodes(): Array<Record<string, unknown>> {
  return [
    { id: 'goal_margin', kind: 'goal', label: 'Protect operating margin' },
    { id: 'opt_insource', kind: 'option', label: 'Bring support in-house' },
    { id: 'opt_status_quo', kind: 'option', label: 'Status quo' },
    {
      id: 'f_ticket_volume',
      kind: 'factor',
      label: VALUED_LABEL,
      observed_state: { value: 4200, unit: 'tickets', source: 'user_edited' },
    },
  ];
}

/** No value at all, and authored by the model — the two axes DISAGREEING. */
function unvaluedAiFactorNode(): Record<string, unknown> {
  return {
    id: 'f_support_quality',
    kind: 'factor',
    label: UNVALUED_AI_LABEL,
    observed_state: { source: 'cee_inference' },
  };
}

const PRIOR_TURN: Record<string, unknown> & { user_message: string | null } = {
  id: 'cccccccc-7a15-4ccc-8ccc-cccccccccccc',
  scenario_id: SCENARIO_ID,
  user_id: null,
  turn_id: 'prior-turn-frame',
  turn_class: 'frame',
  handler_id: null,
  request_hash: 'sha256:prior-frame',
  response_emitted: true,
  llm_calls_used: 1,
  duration_ms: 200,
  created_at: new Date(Date.now() - 60_000).toISOString(),
  user_message: 'We are weighing bringing support in-house.',
  assistant_message: 'Understood — what is holding the decision in place?',
};

vi.mock('../../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: async () => null,
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  getRollingSummaryModel: () => ({ summarise: async () => ({ text: 'DECISION FRAME: noop.' }) }),
  resetRollingSummaryForTests: () => undefined,
}));

vi.mock('../../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async (_id: string, limit = 20) => [PRIOR_TURN].slice(0, limit),
    countTurns: async () => 1,
    readFactsFor: async () => [],
    readFactsWithTurnFor: async () => [],
    readNewestAnalysisFactFor: async () => null,
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => PERSISTED_GRAPH,
    loadGraphAndBriefText: async () => ({
      graph: PERSISTED_GRAPH,
      briefText: 'Should we bring customer support in-house?',
    }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../../turn-executor.js');

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

async function promptFor(message: string): Promise<string> {
  setTestSink(() => undefined);
  const calls: ChatWithToolsArgs[] = [];
  // Explicitly typed so the literal is CONTEXTUALLY typed against the adapter
  // contract — an un-annotated literal infers `content: {type: string}[]` and
  // fails the full-tsc drift ratchet (tsconfig.build.json excludes tests, so
  // only that job sees it). Same shape as the sibling wire suite's helper.
  const adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> } = {
    chatWithTools: async (args: ChatWithToolsArgs) => {
      calls.push(args);
      return {
        content: [{ type: 'text', text: 'Here is what the model carries.' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 500, output_tokens: 40 } as ChatWithToolsResult['usage'],
        model: 'claude-sonnet-4-6',
        latencyMs: 25,
      };
    },
  };
  await runTurnExecutor(payload(message), `req-${randomUUID()}`, { routingAdapter: adapter });
  expect(
    calls.length,
    'the routing adapter was never called — the turn short-circuited before the prompt was built',
  ).toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user, 'no user message reached the routing adapter').toBeDefined();
  return typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content);
}

const THE_QUESTION = 'Which factors still have no value?';

/** Every code-owned instruction block EXCEPT the one under test. */
const SIBLING_INSTRUCTIONS: ReadonlyArray<readonly [string, string]> = [
  ['FOCUS_INSTRUCTION', FOCUS_INSTRUCTION],
  ['GOAL_TARGET_INSTRUCTION', GOAL_TARGET_INSTRUCTION],
  ['READINESS_INSTRUCTION', READINESS_INSTRUCTION],
  ['BRIEF_INSTRUCTION', BRIEF_INSTRUCTION],
  ['GRAPH_CONTEXT_INSTRUCTION', GRAPH_CONTEXT_INSTRUCTION],
  ['COACHING_CONTEXT_INSTRUCTION', COACHING_CONTEXT_INSTRUCTION],
  ['OLDER_RELEVANT_FACTS_INSTRUCTION', OLDER_RELEVANT_FACTS_INSTRUCTION],
];

beforeEach(() => {
  PERSISTED_GRAPH = { nodes: [...baseNodes(), unvaluedAiFactorNode()], edges: [] };
});

afterEach(() => {
  vi.restoreAllMocks();
  setTestSink(() => undefined);
});

describe('factor-value sanction — the instruction reaches the rendered prompt', () => {
  /**
   * ⚠⚠ THE PRECONDITION (trap 13b — pin it IN-TEST). Without this, every
   * assertion below could pass or fail for a reason that has nothing to do with
   * the sanction: a turn that never assembled the slice proves nothing either
   * way. Assert the FIELD is there before asserting the INSTRUCTION about it.
   */
  it('POSITIVE CONTROL — the slice this sanctions is on the pack in these bytes', async () => {
    const prompt = await promptFor(THE_QUESTION);
    const pack = observeSerialisedPack(prompt);
    expect(pack.factor_values, 'factor_values absent — the sanction has nothing to govern').toBeDefined();
  });

  /**
   * ⭐ THE FACT. Not "the constant exists" — the constant existed for the whole
   * time this defect was live. The prompt BYTES carry it, exactly once.
   */
  it('THE BYTES: the rendered prompt carries FACTOR_VALUES_INSTRUCTION, exactly once', async () => {
    const prompt = await promptFor(THE_QUESTION);
    expect(prompt).toContain(FACTOR_VALUES_INSTRUCTION);
    expect(
      prompt.split(FACTOR_VALUES_INSTRUCTION),
      'the block is emitted more than once — duplicate sanction',
    ).toHaveLength(2);
  });

  /**
   * ⭐⭐ THE BINDING HALF OF THE DISCRIMINATING PAIR, STRUCTURAL RATHER THAN
   * MANUAL. Deleting the emission block turns the test above RED — but a single
   * red only proves sensitivity to SOMETHING. This proves the assertion binds to
   * THIS block and could not be satisfied by a neighbour: the sentences it
   * checks appear in NO other code-owned instruction. Mutate a sibling and this
   * file stays GREEN, by construction.
   */
  it('BINDING: the sanctioned sentences appear in NO sibling instruction block', () => {
    const claims = [
      '`has_value` and `provenance` are SEPARATE facts and must never be merged.',
      'When `without_value_count` is 0 AND factors are listed, every factor listed HAS a value',
    ];
    for (const claim of claims) {
      expect(FACTOR_VALUES_INSTRUCTION, 'claim is not in the block under test').toContain(claim);
      for (const [name, sibling] of SIBLING_INSTRUCTIONS) {
        expect(sibling, `${name} also carries this sentence — the assertion is not binding`).not.toContain(claim);
      }
    }
  });

  /**
   * ⭐⭐ THE TWO AXES, NOT COLLAPSED — asserted against a fixture that actually
   * disagrees. The precondition is pinned first: this graph really does produce
   * a factor that is valueless AND stamped as an AI estimate. Without that, the
   * instruction assertion would be a claim about text with no data behind it.
   */
  it('TWO AXES: a valueless YET AI-stamped factor is in the pack, and the sanction forbids conflating them', async () => {
    const prompt = await promptFor(THE_QUESTION);
    const slice = observeSerialisedPack(prompt).factor_values as {
      factors: ReadonlyArray<{ label: string; has_value: boolean; provenance: string }>;
      without_value_count: number;
    };
    // PRECONDITION: the two axes genuinely disagree on this factor.
    const witnessed = slice.factors.find((f) => f.label === UNVALUED_AI_LABEL);
    expect(witnessed, 'the disagreeing factor never reached the pack').toEqual({
      label: UNVALUED_AI_LABEL,
      has_value: false,
      provenance: 'ai_drafted',
    });
    expect(slice.factors.find((f) => f.label === VALUED_LABEL)?.has_value).toBe(true);

    // THE SANCTION over that data, in the bytes the model receives.
    expect(prompt).toContain(FACTOR_VALUES_INSTRUCTION);
    expect(FACTOR_VALUES_INSTRUCTION).toContain(
      '`has_value` and `provenance` are SEPARATE facts and must never be merged.',
    );
    expect(FACTOR_VALUES_INSTRUCTION).toContain(
      'A factor can carry NO value and still be marked as the model’s own estimate',
    );
    // ⛔ provenance is AUTHORSHIP, not a user-write receipt: the block must not
    // license "the user typed this" (classifyValueSource maps BOTH
    // brief_extraction and explicit to user_stated).
    expect(FACTOR_VALUES_INSTRUCTION).toContain(
      'not a receipt that the user typed it',
    );
    expect(FACTOR_VALUES_INSTRUCTION).not.toMatch(/the user (typed|entered) (this|it)\b(?!.{0,80}never)/);
  });

  /**
   * HONEST AT ZERO. "Nothing is missing" must be SAYABLE. The whole defect was
   * "none missing" and "I cannot see" collapsing into one silence, so a
   * fully-valued graph must still carry BOTH the zero count and the sanction
   * that says a zero is a positive finding.
   */
  it('HONEST AT ZERO: a fully-valued graph carries a zero count AND the sanction that makes it sayable', async () => {
    PERSISTED_GRAPH = { nodes: baseNodes(), edges: [] };
    const prompt = await promptFor(THE_QUESTION);
    const slice = observeSerialisedPack(prompt).factor_values as { without_value_count: number };
    expect(slice, 'factor_values absent on the fully-valued arm').toBeDefined();
    expect(slice.without_value_count).toBe(0);
    expect(prompt).toContain(FACTOR_VALUES_INSTRUCTION);
    expect(FACTOR_VALUES_INSTRUCTION).toContain(
      'When `without_value_count` is 0 AND factors are listed, every factor listed HAS a value — say so plainly.',
    );
    expect(FACTOR_VALUES_INSTRUCTION).toContain('That is a positive finding');
  });

  /**
   * ⭐⭐ ARM 1 OF THE COUNT'S LIMITS: A FACTOR-LESS GRAPH IS COUNT-IDENTICAL TO A
   * FULLY-VALUED ONE. Measured on the projector: no factor nodes projects
   * `{"factors":[],"without_value_count":0}` — the SAME count as "every factor
   * has a value". An unscoped "0 means every factor is valued" would report a
   * fully-valued model over a model with no factors at all. That is
   * under-reporting, which is the exact harm this slice exists to close.
   */
  it('EMPTY FACTORS: a factor-less graph is count-identical to fully-valued, and the sanction separates them', async () => {
    PERSISTED_GRAPH = {
      nodes: [
        { id: 'goal_margin', kind: 'goal', label: 'Protect operating margin' },
        { id: 'opt_status_quo', kind: 'option', label: 'Status quo' },
      ],
      edges: [],
    };
    const prompt = await promptFor(THE_QUESTION);
    const slice = observeSerialisedPack(prompt).factor_values as {
      factors: readonly unknown[];
      without_value_count: number;
    };
    // PRECONDITION: the ambiguity is real in this payload, not hypothetical.
    expect(slice, 'factor_values absent on the factor-less arm').toBeDefined();
    expect(slice.factors).toEqual([]);
    expect(slice.without_value_count).toBe(0);

    expect(prompt).toContain(FACTOR_VALUES_INSTRUCTION);
    expect(FACTOR_VALUES_INSTRUCTION).toContain(
      'An EMPTY `factors` list is NOT that finding.',
    );
    expect(FACTOR_VALUES_INSTRUCTION).toContain(
      'never report it as every factor being valued',
    );
    // ⛔ And the zero-clause must be SCOPED, or it licenses the conflation the
    // clause above forbids — the two must not contradict each other.
    expect(FACTOR_VALUES_INSTRUCTION).toContain('is 0 AND factors are listed');
  });

  /**
   * ⭐⭐ ARM 2: TRUNCATION MAKES THE COUNT A FLOOR, NOT A TOTAL. Measured on the
   * projector: 45 valueless factors project `without_value_count: 40` with
   * `factors_omitted: 5`, because the count describes only the ENUMERATED list
   * (cap 40). An unscoped "never give a number that disagrees with this count"
   * would licence reporting 40 when 45 lack values — under-reporting again.
   */
  it('TRUNCATION: the count is a floor, not a total, and the sanction forbids giving it as the total', async () => {
    PERSISTED_GRAPH = {
      nodes: Array.from({ length: 45 }, (_, i) => ({
        id: `f_${i}`,
        kind: 'factor',
        label: `Unvalued factor number ${i}`,
      })),
      edges: [],
    };
    const prompt = await promptFor(THE_QUESTION);
    const slice = observeSerialisedPack(prompt).factor_values as {
      factors: readonly unknown[];
      without_value_count: number;
      factors_omitted?: number;
    };
    // PRECONDITION: this payload really does under-report, by 5.
    expect(slice, 'factor_values absent on the truncated arm').toBeDefined();
    expect(slice.factors).toHaveLength(40);
    expect(slice.without_value_count).toBe(40);
    expect(slice.factors_omitted).toBe(5);

    expect(prompt).toContain(FACTOR_VALUES_INSTRUCTION);
    expect(FACTOR_VALUES_INSTRUCTION).toContain(
      'The count and the list describe ONLY the factors shown here.',
    );
    expect(FACTOR_VALUES_INSTRUCTION).toContain(
      'do not give this count as the total number lacking a value',
    );
    // ⛔ The instruction must carry NO unconditional "never disagree with this
    // count" clause — that is what licensed the under-report.
    expect(FACTOR_VALUES_INSTRUCTION).not.toContain(
      'Never give a number of unset factors that disagrees with this count',
    );
  });

  /**
   * ⭐ ABSENT KEY → NO INSTRUCTION → BYTE-IDENTITY, the posture every sibling
   * holds. And the block's own last-but-one bullet is what makes absence
   * survivable: absence is UNKNOWN, never "nothing is missing".
   */
  it('BYTE-IDENTITY: no slice on the pack ⇒ no sanction in the prompt', async () => {
    PERSISTED_GRAPH = null;
    const prompt = await promptFor(THE_QUESTION);
    expect(
      observeSerialisedPack(prompt).factor_values,
      'the slice was emitted on a graphless turn — this arm is not testing absence',
    ).toBeUndefined();
    expect(prompt).not.toContain(FACTOR_VALUES_INSTRUCTION);
    // ⚠ The block's own "if this block is absent" bullet is INERT IN THIS ARM —
    // when the section is off the pack the whole block is off the prompt, so
    // nothing here instructs the model. It governs the case where the model
    // holds the block on one turn and not another; asserting it as though it
    // covered THIS turn would over-read it. Asserted only as text, not as a
    // property of this prompt.
    expect(FACTOR_VALUES_INSTRUCTION).toContain(
      'Never read its absence as "nothing is missing"',
    );
  });
});
