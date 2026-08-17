/**
 * R2 — auto-run provisional analysis: the `autoRun` trigger contract on
 * `dispatchChipClickRunAnalysis`.
 *
 * The auto-run REUSES the one run orchestration (chip-click dispatch →
 * buildTurnContext → registered run_analysis handler → commitDirectAnswer) —
 * no second run path. The trigger param changes exactly three things, each
 * pinned here with its negative twin (an untriggered dispatch must stay
 * byte-identical to today's behaviour):
 *
 *  1. HONEST CONVERSATION RECORD: the commit carries NO `userMessage` — the
 *     user typed nothing, so nothing may be stored as their words. (NULL
 *     user_message is the established system-event turn shape; see
 *     commit.ts's capConversationText note.)
 *
 *  2. PROVISIONAL LABELLING, machine-readable: the run_analysis fact's open
 *     `enrichment` record (the established CEE-authored-key carrier — the
 *     decision_review enricher precedent) gains `run_provenance`
 *     { initiated_by:'auto_post_draft', provisional:true, draft_turn_id }.
 *     No schema change: `enrichment` is `z.record(z.unknown())` at every
 *     published contract version, so this validates at 0.43.0 and 0.46.0
 *     alike and the UI's transport keep-list simply strips it — the feature
 *     degrades to an ordinary completed analysis exactly as required.
 *
 *  3. PROVISIONAL LABELLING, user-visible: the committed assistant answer
 *     opens with the provisional-disclosure sentence, so the conversation
 *     record a user resumes into never presents the auto-run as something
 *     they asked for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { makeMessagePayload } from '../../__tests__/fixtures.js';

const {
  loadScenarioSnapshotForRunAnalysisMock,
  commitDirectAnswerMock,
  enrichRunAnalysisMock,
  runAnalysisHandlerMock,
  routeWithToolUseSpy,
  buildTurnContextMock,
} = vi.hoisted(() => ({
  loadScenarioSnapshotForRunAnalysisMock: vi.fn(),
  commitDirectAnswerMock: vi.fn(),
  enrichRunAnalysisMock: vi.fn(),
  runAnalysisHandlerMock: vi.fn(),
  routeWithToolUseSpy: vi.fn(),
  buildTurnContextMock: vi.fn(),
}));

vi.mock('../../build-turn-context.js', async () => {
  const actual = await vi.importActual<typeof import('../../build-turn-context.js')>(
    '../../build-turn-context.js',
  );
  return {
    ...actual,
    loadScenarioSnapshotForRunAnalysis: loadScenarioSnapshotForRunAnalysisMock,
    buildTurnContext: buildTurnContextMock,
  };
});

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: commitDirectAnswerMock,
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../coaching/decision-review-enricher.js', () => ({
  enrichRunAnalysisWithDecisionReview: enrichRunAnalysisMock,
}));

vi.mock('../../tools/registry.js', async () => {
  const actual = await vi.importActual<typeof import('../../tools/registry.js')>(
    '../../tools/registry.js',
  );
  return {
    ...actual,
    createRegistry: () => new Map<string, unknown>([['run_analysis', runAnalysisHandlerMock]]),
    resolveHandler: (registry: Map<string, unknown>, id: string) => registry.get(id) ?? null,
  };
});

vi.mock('../../routing/route-with-tool-use.js', () => ({
  routeWithToolUse: routeWithToolUseSpy,
}));

import {
  dispatchChipClickRunAnalysis,
  AUTO_RUN_PROVISIONAL_DISCLOSURE,
  RUN_PROVENANCE_ENRICHMENT_KEY,
} from '../chip-click-dispatch.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const DRAFT_TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const DEFAULT_TURN_CONTEXT = {
  stage: 'analyse' as const,
  entity_registry: { option_ids: [], goal_id: null },
  capabilities: {
    can_run_analysis: false,
    can_edit_graph: false,
    can_run_decision_review: false,
    can_generate_coaching: false,
    can_invoke_tools: false,
    can_commit_session_state: false,
  },
  messages: [{ role: 'user' as const, content: 'Run analysis.' }],
  session_id: SCENARIO_ID,
  request_id: 'req-test',
  budgets: {
    turn_ms: 30000,
    handler_ms: 20000,
    plot_ms: 15000,
    anthropic_ms: 15000,
    openai_ms: 15000,
  },
  prior_turns: [],
  prior_facts: [] as unknown[],
  scenarioBriefText: null,
  persistedGraph: null,
};

function payload() {
  return makeMessagePayload({
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse',
    message: 'Run a provisional analysis of the drafted model.',
    turn_class: 'decide',
    source: 'chip_click',
    chip: { action_type: 'run_analysis' },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  buildTurnContextMock.mockResolvedValue(DEFAULT_TURN_CONTEXT);
  loadScenarioSnapshotForRunAnalysisMock.mockResolvedValue({
    graph: {
      nodes: [
        { id: 'goal_x', kind: 'goal', label: 'Outcome', goal_threshold: 0.8 },
        { id: 'opt_a', kind: 'option', label: 'Option A', interventions: {} },
        { id: 'opt_b', kind: 'option', label: 'Option B', interventions: {} },
      ],
      edges: [],
    },
    options: [],
    goal_node_id: 'goal_x',
    rawPersistedGraph: null,
  });
  runAnalysisHandlerMock.mockResolvedValue({
    assistant_text: 'Ran analysis.',
    handler_facts: [
      {
        fact_type: 'run_analysis' as const,
        fact_version: 1,
        noop: false,
        result: {
          scenario_id: SCENARIO_ID,
          leading_option_id: 'opt_a',
          win_probabilities: { opt_a: 0.7, opt_b: 0.3 },
          summary: 'Done.',
          // A PLoT-originated key that MUST survive the provenance stamp —
          // the stamp spreads, never replaces (the decision_review enricher's
          // own clone rule).
          enrichment: { results: { report: { option_probabilities: { opt_a: 0.7 } } } },
        },
      },
    ],
    llm_calls_used: 0,
  });
  enrichRunAnalysisMock.mockImplementation(
    async ({ handlerFacts }: { handlerFacts: unknown[] }) => handlerFacts,
  );
  commitDirectAnswerMock.mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-1',
    graphPersisted: false,
  });
});

describe('dispatchChipClickRunAnalysis — autoRun trigger present', () => {
  it('commits WITHOUT a userMessage: nothing is recorded as the user\'s words', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-auto',
      autoRun: { draftTurnId: DRAFT_TURN_ID },
    });
    expect(out.outcome).toBe('ok');
    expect(commitDirectAnswerMock).toHaveBeenCalledTimes(1);
    const meta = commitDirectAnswerMock.mock.calls[0][1];
    // Bound precisely: the KEY must be absent, not merely undefined-valued —
    // a `userMessage: undefined` would still document intent to store one.
    expect(Object.prototype.hasOwnProperty.call(meta, 'userMessage')).toBe(false);
  });

  it('stamps run_provenance on the committed run_analysis fact, preserving PLoT enrichment keys', async () => {
    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-auto',
      autoRun: { draftTurnId: DRAFT_TURN_ID },
    });
    const meta = commitDirectAnswerMock.mock.calls[0][1];
    const fact = meta.handler_facts.find(
      (f: { fact_type: string }) => f.fact_type === 'run_analysis',
    );
    expect(fact).toBeDefined();
    const enrichment = fact.result.enrichment as Record<string, unknown>;
    expect(enrichment[RUN_PROVENANCE_ENRICHMENT_KEY]).toEqual({
      initiated_by: 'auto_post_draft',
      provisional: true,
      draft_turn_id: DRAFT_TURN_ID,
    });
    // The PLoT-originated key survives — spread, not replace.
    expect(enrichment.results).toEqual({ report: { option_probabilities: { opt_a: 0.7 } } });
  });

  it('opens the committed assistant answer with the provisional disclosure', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-auto',
      autoRun: { draftTurnId: DRAFT_TURN_ID },
    });
    expect(out.outcome).toBe('ok');
    if (out.outcome !== 'ok') return;
    expect(out.response.assistant_text.startsWith(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(true);
    // The committed copy is the same response object (commitDirectAnswer's
    // first argument), so stored copy == wire copy on this seam.
    const committedResponse = commitDirectAnswerMock.mock.calls[0][0];
    expect(committedResponse.assistant_text.startsWith(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(
      true,
    );
  });

  it('still runs the ONE orchestration: registered handler invoked once, no Sonnet routing', async () => {
    await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-auto',
      autoRun: { draftTurnId: DRAFT_TURN_ID },
    });
    expect(runAnalysisHandlerMock).toHaveBeenCalledTimes(1);
    expect(routeWithToolUseSpy).not.toHaveBeenCalled();
  });
});

describe('dispatchChipClickRunAnalysis — autoRun trigger ABSENT (the negative twins)', () => {
  it('commits WITH the user\'s message, exactly as before', async () => {
    const p = payload();
    await dispatchChipClickRunAnalysis({ payload: p, requestId: 'req-user' });
    const meta = commitDirectAnswerMock.mock.calls[0][1];
    expect(meta.userMessage).toBe(p.message);
  });

  it('stamps NO run_provenance and prepends NO disclosure', async () => {
    const out = await dispatchChipClickRunAnalysis({
      payload: payload(),
      requestId: 'req-user',
    });
    const meta = commitDirectAnswerMock.mock.calls[0][1];
    const fact = meta.handler_facts.find(
      (f: { fact_type: string }) => f.fact_type === 'run_analysis',
    );
    const enrichment = fact.result.enrichment as Record<string, unknown>;
    expect(
      Object.prototype.hasOwnProperty.call(enrichment, RUN_PROVENANCE_ENRICHMENT_KEY),
    ).toBe(false);
    expect(out.outcome).toBe('ok');
    if (out.outcome !== 'ok') return;
    expect(out.response.assistant_text.includes(AUTO_RUN_PROVISIONAL_DISCLOSURE)).toBe(false);
  });
});
