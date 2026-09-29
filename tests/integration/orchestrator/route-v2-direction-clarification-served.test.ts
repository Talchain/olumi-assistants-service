/**
 * ROADMAP 2.1051 (limb 3) — THE QUESTION SURVIVES TO THE SERVED TURN.
 *
 * ⚠⚠ WHY THIS FILE EXISTS ONE ADAPTER FURTHER OUT THAN THE SPEC THAT PRECEDED
 * IT. `direction-gate-surfacing-executed.test.ts` was itself written because a
 * grep-based predecessor could not fail — and it STILL could not see this
 * defect, because it asserts the card on the DRAFT-GRAPH RESPONSE PAYLOAD and
 * stops one adapter short of the SERVED TURN.
 *
 * The V5 turn does not ship the structured `strengthen_items` wire field at all
 * (`draft-graph-dispatch.ts` header). On the surface the deployed UI actually
 * drives, the ONLY carrier for a direction clarification is `assistant_text`.
 * So a card that is built perfectly, appended correctly, and validated against
 * the contract can still reach the user as nothing — and every assertion in
 * every spec one layer in stays green while it happens.
 *
 * Measured at 32f06dd, by execution, with two ordinary coaching items beside
 * one clarification: `85%` appeared NOWHERE in the served text. And with the
 * clarification ALONE it was truncated to
 *
 *     "Assumption to check: You mentioned 85% for CSAT"
 *
 * — the question severed, so the user is told a number was noticed and never
 * asked which direction it is. Two independent defects (position, truncation),
 * both invisible from inside.
 *
 * This file mocks ONE layer deeper than the dispatcher — at
 * `runUnifiedPipeline` — and lets the real `handleDraftGraph` ->
 * `dispatchDraftGraph` -> route -> egress chain run, so the body it asserts
 * against is produced by the exact code path a real draft takes. It is as close
 * to the wire as a test can get in-process.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

const runUnifiedPipelineMock = vi.fn();
vi.mock('../../../src/cee/unified-pipeline/index.js', () => ({
  runUnifiedPipeline: runUnifiedPipelineMock,
  isKnownSafeNormaliseError: () => false,
}));

const appendMock = vi.fn().mockResolvedValue({ id: 'mock-row-id' });
vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    append: appendMock,
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'short text-only response' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  }),
  getAdapterWithResolution: () => ({
    adapter: {
      name: 'test',
      model: 'test-model',
      chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
      chatWithTools: async () => ({
        content: [{ type: 'text', text: 'short text-only response' }],
        stop_reason: 'end_turn',
        usage: { input_tokens: 1, output_tokens: 1 },
      }),
    },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

vi.mock('../../../src/adapters/llm/prompt-loader.js', () => ({
  getSystemPrompt: async () => 'test system prompt',
}));

vi.mock('../../../src/config/index.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../../src/config/index.js')>();
  return {
    ...original,
    config: new Proxy(original.config as object, {
      get(target, prop) {
        if (prop === 'features') {
          return new Proxy(Reflect.get(target, prop) as object, {
            get(featTarget, featProp) {
              if (featProp === 'pipelineV4Enabled') return false;
              return Reflect.get(featTarget, featProp);
            },
          });
        }
        return Reflect.get(target, prop);
      },
    }),
  };
});

const { ceeOrchestratorRouteV2 } = await import('../../../src/orchestrator/route-v2.js');
// The REAL renderer, not a fixture. A hand-written "card" here would prove
// nothing about what the gate actually emits (trap 16-inverse), and the
// truncation defect lives precisely in the gap between the two.
const { renderDirectionClarifications } = await import(
  '../../../src/cee/compound-goal/direction-gate.js'
);

const SCENARIO_ID = '44444444-4444-4444-8444-444444444444';
const BRIEF =
  'Should we move our support team to a four-day week next quarter or keep the current rota?';

/** The clarification the gate emits for the live withheld CSAT bound. */
const CLARIFICATION = renderDirectionClarifications([
  {
    metric_text: 'CSAT',
    amount_text: '85%',
    value: 0.85,
    unit: '%',
    reason: 'unspent_negation',
    question: 'Should CSAT stay at or above 85%, or at or below it?',
    options: ['a floor — keep it at or above this value', 'a ceiling — keep it at or below this value'],
  },
])[0]!;

/** Two ordinary coaching items, the shape the draft LLM emits. */
const LLM_ITEMS = [
  {
    id: 'str_cost_ceiling',
    label: 'Name the cost ceiling',
    detail:
      'Your brief does not say what the support budget can absorb, so the comparison cannot weigh cost against service quality',
    action_type: 'add_constraint',
  },
  {
    id: 'str_baseline',
    label: 'Add a baseline option',
    detail:
      'Adding a continue-as-is option would let the comparison measure improvement rather than absolute levels',
    action_type: 'add_option',
  },
];

const GRAPH = {
  version: '1.2',
  nodes: [
    { id: 'goal_4day', kind: 'goal', label: 'Choose a support rota' },
    // This is deliberately an exact-ready control. Freeform direction cards
    // are not admitted for non-ready/missing states because their producer
    // provenance is not structurally carried to the narrative boundary.
    {
      id: 'opt_four_day',
      kind: 'option',
      label: 'Move to a four-day week',
      interventions: {
        fac_support_cost: {
          value: 0.7,
          source: 'brief_extraction',
          reasoning: 'Test fixture value',
          target_match: {
            node_id: 'fac_support_cost',
            confidence: 'high',
            match_type: 'exact_id',
          },
          value_confidence: 'high',
        },
      },
    },
    {
      id: 'opt_status_quo',
      kind: 'option',
      label: 'Keep the current rota',
      interventions: {
        fac_support_cost: {
          value: 0.3,
          source: 'brief_extraction',
          reasoning: 'Test fixture value',
          target_match: {
            node_id: 'fac_support_cost',
            confidence: 'high',
            match_type: 'exact_id',
          },
          value_confidence: 'high',
        },
      },
    },
    { id: 'out_csat', kind: 'outcome', label: 'Customer Satisfaction Score' },
    { id: 'fac_support_cost', kind: 'factor', label: 'Support cost' },
  ],
  edges: [{ id: 'e1', from: 'fac_support_cost', to: 'out_csat', belief: 0.6 }],
};

// The unified-pipeline producer contract includes analysis_ready beside the
// graph. This route test deliberately uses a lightweight legacy edge fixture
// for its unrelated narration concern, so asking draft-graph's graph fallback
// to reconstruct readiness would make the test depend on an invalid carrier
// it is not meant to exercise. Carry the exact producer field instead: the
// served assertion below then proves producer → dispatcher → finaliser → wire.
const ANALYSIS_READY = {
  goal_node_id: 'goal_4day',
  status: 'ready',
  options: [
    {
      id: 'opt_four_day',
      label: 'Move to a four-day week',
      status: 'ready',
      interventions: { fac_support_cost: 0.7 },
    },
    {
      id: 'opt_status_quo',
      label: 'Keep the current rota',
      status: 'ready',
      interventions: { fac_support_cost: 0.3 },
    },
  ],
  bias_findings: [],
} as const;

function pipelineBody(strengthenItems: unknown[]) {
  return {
    statusCode: 200,
    body: {
      graph: GRAPH,
      analysis_ready: ANALYSIS_READY,
      coaching: {
        summary: '',
        strengthen_items: strengthenItems,
        widening_log: { elements_added: [], elements_considered_but_excluded: [], brief_completeness: 'partial' },
        bias_signals: [],
      },
    },
  };
}

async function servedText(app: FastifyInstance, strengthenItems: unknown[]): Promise<string> {
  runUnifiedPipelineMock.mockResolvedValueOnce(pipelineBody(strengthenItems));
  const res = await app.inject({
    method: 'POST',
    url: '/orchestrate/v2/turn',
    payload: {
      kind: 'message',
      turn_id: '44444444-4444-4444-8444-4444fc010001',
      scenario_id: SCENARIO_ID,
      stage: 'frame',
      message: BRIEF,
      turn_class: 'frame',
      source: 'composer',
    },
  });
  expect(res.statusCode, 'the turn must succeed — a 500 would make every assertion below vacuous').toBe(200);
  const body = JSON.parse(res.body);
  expect(typeof body.assistant_text, 'the served turn must carry assistant_text').toBe('string');
  expect(body.analysis_ready?.status, 'this direction-delivery control must remain exact-ready').toBe('ready');
  return body.assistant_text as string;
}

describe('POST /orchestrate/v2/turn — a direction clarification reaches the SERVED TURN', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    await ceeOrchestratorRouteV2(app);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    runUnifiedPipelineMock.mockReset();
    appendMock.mockClear();
  });

  it('PRECONDITION: the real renderer emits a card that names the metric, the amount AND both directions', () => {
    // Trap 13b, third face: a guard whose discrimination depends on a fixture
    // nothing pins. If the renderer stops emitting the question, every
    // assertion below would pass by testing a card that never asked anything.
    expect(CLARIFICATION.id).toMatch(/^direction_unresolved_/);
    expect(CLARIFICATION.detail).toContain('85%');
    expect(CLARIFICATION.detail).toContain('CSAT');
    expect(CLARIFICATION.detail).toMatch(/at or above/i);
    expect(CLARIFICATION.detail).toMatch(/at or below/i);
    expect(CLARIFICATION.detail, 'the copy must ASK, not merely observe').toContain('?');
  });

  it('THE DEFECT: with two ordinary coaching items beside it, the question still reaches the user', async () => {
    // The measured live shape. At 32f06dd the clarification is appended LAST,
    // `pickAssumption` reads `strengthenItems[0]` only, and the single extra
    // "worth a look" slot is consumed by the second LLM item — so the served
    // text contained no "85%" at all.
    const text = await servedText(app, [...LLM_ITEMS, CLARIFICATION]);
    expect(text, 'the amount the user stated must reach the served turn').toContain('85%');
    expect(text, 'and it must be attributed to the metric they named').toContain('CSAT');
    expect(text, 'and it must ASK, not merely observe').toMatch(/at or above 85%/i);
    expect(text).toMatch(/at or below/i);
  });

  it('THE SEVERED QUESTION: the clarification is not cut down to its first sentence', async () => {
    // Even ALONE the card was truncated to "Assumption to check: You mentioned
    // 85% for CSAT" — a statement where a question belongs. Binding on the
    // exact severed string means this test fails if the truncation returns,
    // whatever else changes around it.
    const text = await servedText(app, [CLARIFICATION]);
    expect(text).not.toContain('Assumption to check: You mentioned 85% for CSAT');
    expect(text, 'the question is the whole point of the card').toMatch(/at or above 85%/i);
  });

  it('the clarification does not CROWD OUT ordinary coaching — both survive', async () => {
    // An "explicit slot" fix must not simply steal the assumption bullet. The
    // opposite-direction twin of the defect (trap 22b): a fix that surfaces the
    // question by silencing the coaching is a trade, not a fix.
    const text = await servedText(app, [...LLM_ITEMS, CLARIFICATION]);
    expect(text).toContain('85%');
    expect(text, 'the ordinary coaching signal must still be there').toMatch(
      /support budget can absorb|continue-as-is/i,
    );
  });

  it('CONTROL: with NO clarification the served text is unchanged in shape and mentions no limit', async () => {
    // The positive control that makes the assertions above evidence rather than
    // instrument blindness: if "85%" appeared here too, the tests above would
    // be measuring something other than the clarification.
    const text = await servedText(app, LLM_ITEMS);
    expect(text).not.toContain('85%');
    expect(text).toMatch(/What the model is weighing/);
  });

  it('a clarification whose copy would leak an internal id is DROPPED, not served', async () => {
    // The metric text comes from the USER'S OWN WORDS, so the card is not
    // trusted copy the way the fixed fallbacks are. Fail closed: a card that
    // trips the content gate never reaches a user.
    const leaky = { ...CLARIFICATION, detail: CLARIFICATION.detail.replace('CSAT', 'fac_csat_score') };
    const text = await servedText(app, [leaky]);
    expect(text).not.toContain('fac_csat_score');
  });
});
