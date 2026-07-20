/**
 * Route-level tests for the round-1 process-meta intake guard
 * (META-DECISION-DIAGNOSIS-2026-07-20).
 *
 * Defect being pinned: the product's own coaching spark prompts (UI
 * pre-analysis-v3) arrive as anonymous text, match the draft-shape
 * heuristic on an empty canvas, get captured as the decision BRIEF by the
 * clarify round, and the drafter faithfully models the meta-decision
 * ("should we run the analysis?"). Reproduced live at the deployed tip
 * (scenario c1e6e5d7, replay 7e1f0000-…-202607200001).
 *
 * The spark strings below are pinned BYTE-VERBATIM from DecisionGuideAI
 * `src/canvas/components/pre-analysis-v3/constants.ts` (staging tip
 * 8007d03d, 2026-07-20). They are deliberately duplicated here as string
 * literals (NOT imported from the mechanism module) so a silent edit to
 * the mechanism's list goes RED against this file. A UI-side counterpart
 * test (every spark ships intent metadata) is EXPECTED from the UI spark
 * lane but did not exist at UI tip 2e5abdb1 (REVIEW-575 C2).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

// -------- Mocks --------
const dispatchDraftGraphMock = vi.fn();

vi.mock('../../../src/orchestrator-v5/handlers/draft-graph-dispatch.js', () => ({
  dispatchDraftGraph: dispatchDraftGraphMock,
}));

// Deterministic chip-click dispatcher: mock ONLY the dispatch function;
// keep the real whitelist predicate via importOriginal (a hand-listed
// re-implementation of the whitelist here could drift silently — trap 12).
const dispatchDeterministicChipClickMock = vi.fn();
vi.mock('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js', async (importOriginal) => {
  const actual = await importOriginal<
    typeof import('../../../src/orchestrator-v5/handlers/chip-click-dispatch.js')
  >();
  return {
    ...actual,
    dispatchDeterministicChipClick: dispatchDeterministicChipClickMock,
  };
});

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

// Minimal LLM adapter for TurnExecutor fall-through paths.
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({
    name: 'test',
    model: 'test-model',
    chat: async () => ({ content: 'short reply', usage: { input_tokens: 1, output_tokens: 1 } }),
    chatWithTools: async () => ({
      content: [{ type: 'text', text: 'text-only fallthrough response' }],
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
        content: [{ type: 'text', text: 'text-only fallthrough response' }],
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
const { PROCESS_META_ANSWER_MARKER } = await import(
  '../../../src/orchestrator-v5/routing/process-meta-intake.js'
);

// ---------------------------------------------------------------------------
// Pinned product-authored prompts — byte-verbatim from DecisionGuideAI
// src/canvas/components/pre-analysis-v3/constants.ts (staging 8007d03d).
// ---------------------------------------------------------------------------
/** Sparks that match the draft-shape heuristic on an empty canvas (the
 *  misroute class: each would have drafted a meta-graph before this fix). */
const DRAFT_SHAPED_SPARKS: readonly string[] = [
  'Is this the right question to be asking, and does it fit my wider goals?',
  'Take the outside view on this decision: what do similar decisions and base rates suggest?',
  'Run a pre-mortem with me: imagine this choice failed a year from now. What went wrong?',
  'What risks and best-case upsides are missing from my model?',
  'Compare my view of this decision with yours. Where do we differ, and why?',
  'What should I check before running the first analysis?', // the reproduced defect
];
/** Sparks that do NOT match the draft heuristic (no decision verb, no
 *  trailing '?') — they never drafted, but they now get the deterministic
 *  answer instead of the canned framing prompt. */
const NON_DRAFT_SHAPED_SPARKS: readonly string[] = [
  'Suggest materially different options that work through a different mechanism from the ones I already have.',
  'Help me check the estimates that matter most to the analysis.',
  'Help me define a measurable success target for this goal.',
  'You flagged a possible blind spot in how my model leans. Help me think it through.',
];

/** DecisionNode/GoalNode "Run analysis" chip text (DecisionNode.tsx:355,
 *  GoalNode.tsx:373). */
const RUN_ANALYSIS_CHIP_TEXT = 'Run the analysis now';

const SCENARIO_ID = '33333333-3333-4333-8333-333333333333';
let turnCounter = 0;
function nextTurnId(): string {
  turnCounter += 1;
  return `44444444-4444-4444-8444-${String(turnCounter).padStart(12, '0')}`;
}

function makeDraftGraphMockResult() {
  return {
    response: {
      response_version: 2 as const,
      assistant_text: 'Drafted a decision graph with 3 nodes and 2 edges.',
      blocks: [] as const,
      suggested_actions: [] as const,
      insights: [] as const,
      stage_indicator: 'frame' as const,
    },
    commitPerformed: true,
  };
}

interface InjectOpts {
  readonly message: string;
  readonly source?: 'composer' | 'chip' | 'chip_click';
  readonly chip?: { action_type?: string };
}

describe('POST /orchestrate/v2/turn — round-1 process-meta intake guard', () => {
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
    dispatchDraftGraphMock.mockReset();
    dispatchDeterministicChipClickMock.mockReset();
    appendMock.mockClear();
  });

  async function inject(opts: InjectOpts) {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: nextTurnId(),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: opts.message,
        turn_class: 'frame',
        source: opts.source ?? 'chip',
        ...(opts.chip ? { chip: opts.chip } : {}),
      },
    });
    return res;
  }

  // ------------------------------------------------------------------
  // 1. Every draft-shaped spark deflects to a deterministic ANSWER —
  //    never a draft, never a clarify capture, never the framing prompt.
  // ------------------------------------------------------------------
  for (const spark of DRAFT_SHAPED_SPARKS) {
    it(`spark deflects (chip source): ${JSON.stringify(spark.slice(0, 48))}…`, async () => {
      const res = await inject({ message: spark, source: 'chip' });
      expect(res.statusCode).toBe(200);
      expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
      const body = JSON.parse(res.body);
      // The deterministic process-meta answer, not the clarify script and
      // not the frame guard's framing prompt.
      expect(body.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
      expect(body.assistant_text).not.toContain('Before I draft the model');
      expect(body.assistant_text).not.toContain('I need a single decision question');
      // No draft-offer chip may be seeded from a meta-question (the C3
      // seed would BE the poisoned brief).
      const chipLabels = (body.suggested_actions ?? []).map((a: { label?: string }) => a.label);
      expect(chipLabels).not.toContain('Build the model');
    });
  }

  it('the reproduced spark deflects when TYPED (composer source) too', async () => {
    const res = await inject({
      message: 'What should I check before running the first analysis?',
      source: 'composer',
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
  });

  it('the defect string WITHOUT the trailing "?" also deflects (REVIEW-575 C1 under-capture)', async () => {
    // "What should I check before I run my first analysis" (no "?")
    // reproduced the meta-draft end-to-end at the pre-tightening head:
    // the decision-verb regex arm ("should") makes it draft-shaped even
    // without the trailing question mark.
    const res = await inject({
      message: 'What should I check before I run my first analysis',
      source: 'composer',
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
  });

  it('typed process-meta variant deflects: "How does the analysis work?"', async () => {
    const res = await inject({ message: 'How does the analysis work?', source: 'composer' });
    expect(res.statusCode).toBe(200);
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    const body = JSON.parse(res.body);
    expect(body.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
  });

  // ------------------------------------------------------------------
  // 2. Non-draft-shaped sparks also get the deterministic answer (they
  //    previously fell into the frame guard's canned framing prompt).
  // ------------------------------------------------------------------
  for (const spark of NON_DRAFT_SHAPED_SPARKS) {
    it(`non-draft-shaped spark answered: ${JSON.stringify(spark.slice(0, 48))}…`, async () => {
      const res = await inject({ message: spark, source: 'chip' });
      expect(res.statusCode).toBe(200);
      expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
      const body = JSON.parse(res.body);
      expect(body.assistant_text).toContain(PROCESS_META_ANSWER_MARKER);
    });
  }

  // ------------------------------------------------------------------
  // 3. POSITIVE CONTROLS — genuine decision briefs MUST still route to
  //    the brief pipeline (draft dispatch, or clarify round-1 questions
  //    when the rubric finds the brief thin). Over-blocking real briefs
  //    is a worse defect than the one this guard fixes.
  // ------------------------------------------------------------------
  const POSITIVE_CONTROLS: readonly string[] = [
    // The diagnosis' canonical positive control.
    'Should I hire a founding engineer or contract the build out?',
    // Established draft-path fixture shape.
    'Should we expand the product into the German market next quarter or hold?',
    // Contains an analysis-adjacent word yet is a genuine brief.
    'Should we invest in a new analytics platform for the finance team?',
    // Decision question referencing a model (product noun in decision
    // content, not process-meta).
    'Should I license my model to a competitor or keep it in-house?',
  ];
  for (const brief of POSITIVE_CONTROLS) {
    it(`positive control still routes to brief pipeline: ${JSON.stringify(brief.slice(0, 48))}…`, async () => {
      dispatchDraftGraphMock.mockResolvedValue(makeDraftGraphMockResult());
      const res = await inject({ message: brief, source: 'composer' });
      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body);
      const drafted = dispatchDraftGraphMock.mock.calls.length > 0;
      const clarified =
        typeof body.assistant_text === 'string' &&
        body.assistant_text.includes('Before I draft the model');
      // Either arm proves the message was treated as a BRIEF.
      expect(drafted || clarified).toBe(true);
      // And it must never receive the process-meta deflection answer.
      expect(body.assistant_text).not.toContain(PROCESS_META_ANSWER_MARKER);
    });
  }

  // ------------------------------------------------------------------
  // 4. Explicit intent metadata (source='chip_click') never reaches the
  //    draft heuristic — even for a valid, non-whitelisted action_type
  //    whose canned text is draft-shaped.
  // ------------------------------------------------------------------
  it('chip_click with valid non-whitelisted action_type + draft-shaped text does NOT draft', async () => {
    const res = await inject({
      message: 'Compare my current options and tell me whether to expand or hold?',
      source: 'chip_click',
      chip: { action_type: 'compare_options' },
    });
    // Falls through to TurnExecutor (Sonnet ORIENT / typed unsupported-action
    // path) — the outcome may be 200 or a typed failure in this harness; the
    // contract under test is only that the draft heuristic never fires.
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect(dispatchDeterministicChipClickMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
  });

  // ------------------------------------------------------------------
  // 5. The "Run the analysis now" chip WITH intent metadata dispatches
  //    run_analysis deterministically (regression pin — the UI-side fix
  //    is to SEND this metadata; CEE already routes it).
  // ------------------------------------------------------------------
  it('chip_click run_analysis with the exact NodeChip text dispatches deterministically', async () => {
    dispatchDeterministicChipClickMock.mockResolvedValueOnce({
      outcome: 'ok',
      response: {
        response_version: 2 as const,
        assistant_text: 'Analysis complete.',
        blocks: [],
        suggested_actions: [],
        insights: [],
        stage_indicator: 'frame' as const,
      },
      graph: null,
    });
    const res = await inject({
      message: RUN_ANALYSIS_CHIP_TEXT,
      source: 'chip_click',
      chip: { action_type: 'run_analysis' },
    });
    expect(res.statusCode).toBe(200);
    expect(dispatchDeterministicChipClickMock).toHaveBeenCalledTimes(1);
    expect(dispatchDeterministicChipClickMock.mock.calls[0]![0]).toBe('run_analysis');
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------
  // 6. The "Run the analysis now" chip WITHOUT metadata (today's UI):
  //    honest-negative pin. It is too short for the draft heuristic and
  //    is NOT claimed by the process-meta guard (it is an action intent,
  //    not a process question — its fix is UI-side metadata, which the
  //    contract supports today via action_type='run_analysis').
  // ------------------------------------------------------------------
  it('anonymous "Run the analysis now" never drafts and never gets the meta answer', async () => {
    const res = await inject({ message: RUN_ANALYSIS_CHIP_TEXT, source: 'chip' });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = JSON.parse(res.body);
      expect(body.assistant_text ?? '').not.toContain(PROCESS_META_ANSWER_MARKER);
    }
  });

  // ------------------------------------------------------------------
  // 7. Scope guards: the branch claims ONLY the empty-canvas frame state.
  // ------------------------------------------------------------------
  it('a populated canvas keeps the spark on the LLM path (no deterministic claim)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/orchestrate/v2/turn',
      payload: {
        kind: 'message',
        turn_id: nextTurnId(),
        scenario_id: SCENARIO_ID,
        stage: 'frame',
        message: 'What should I check before running the first analysis?',
        turn_class: 'frame',
        source: 'chip',
        graph_state: {
          nodes: [
            { id: 'dec_1', kind: 'decision', label: 'Decision' },
            { id: 'opt_1', kind: 'option', label: 'Option A' },
          ],
          edges: [],
        },
      },
    });
    expect(dispatchDraftGraphMock).not.toHaveBeenCalled();
    expect([200, 500]).toContain(res.statusCode);
    if (res.statusCode === 200) {
      const body = JSON.parse(res.body);
      // Falls through to TurnExecutor (LLM coaching with graph context),
      // never the canned empty-canvas answer.
      expect(body.assistant_text ?? '').not.toContain(PROCESS_META_ANSWER_MARKER);
    }
  });
});
