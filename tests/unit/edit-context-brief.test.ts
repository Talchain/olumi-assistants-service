/**
 * Context Architecture v2 — S2 "brief → edit/repair" (ROADMAP 1.199).
 *
 * Design of record: docs-designs/CONTEXT-ARCHITECTURE-V2-2026-07-13/ +
 * CONTEXT-POLICY-DESIGN-2026-07-23.
 *   - 02 §Seam 1 — edit_graph/repair got NOTHING of the brief; target = a
 *     1,000-char first-N slice of the same normalised brief text,
 *     DISCLOSED, threaded as `ConversationContext.brief` + a
 *     `## Decision Brief` section in the edit-context serialiser.
 *     Repair inherits automatically (it reuses the same contextSection).
 *   - S2 is now shipped ON: the CEE_CONTEXT_BRIEF_ALL_SITES flag is DELETED
 *     (no-dark-launches — flip = code, rollback = revert). dispatchEditGraph
 *     reads the brief UNCONDITIONALLY. Mutation-check: reverting the flip
 *     (re-adding the flag guard) makes the unconditional-read tests below RED.
 *
 * No-brief byte-identity: no `brief` on the context, no section in the prompt.
 */
import { describe, it, expect, vi, beforeEach, afterEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../src/orchestrator/tools/edit-graph.js';

// ── module-level mocks (mirrors edit-graph-dispatch.test.ts) ────────────────

vi.mock('../../src/orchestrator/tools/edit-graph.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orchestrator/tools/edit-graph.js')>();
  return {
    ...actual,
    handleEditGraph: vi.fn(),
  };
});

vi.mock('../../src/orchestrator-v5/commit.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orchestrator-v5/commit.js')>();
  return {
    ...actual,
    commitDirectAnswer: vi.fn(),
    computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
  };
});

vi.mock('../../src/adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../src/orchestrator-v5/build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/orchestrator-v5/build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
    loadRecentConversationTurns: vi.fn().mockResolvedValue([]),
    loadScenarioBriefText: vi.fn().mockResolvedValue(null),
  };
});

// ── imports after mocks ──────────────────────────────────────────────────────

import { dispatchEditGraph } from '../../src/orchestrator-v5/handlers/edit-graph-dispatch.js';
import { handleEditGraph } from '../../src/orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../src/orchestrator-v5/commit.js';
import { loadScenarioBriefText } from '../../src/orchestrator-v5/build-turn-context.js';
import {
  serialiseEditContextForLLMWithMeta,
  projectBriefForEdit,
  EDIT_CONTEXT_BRIEF_CHAR_CAP,
} from '../../src/orchestrator/context/serialise.js';
import * as telemetry from '../../src/utils/telemetry.js';
import { TelemetryEvents } from '../../src/utils/telemetry.js';
import { _resetConfigCache } from '../../src/config/index.js';
import type { GraphStateIngress } from '../../src/orchestrator-v5/boundary/request-extensions.js';
import type { ConversationContext } from '../../src/orchestrator/types.js';

const SCENARIO_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

function makePayload(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message: 'Increase the strength of the launch → revenue edge',
    turn_class: 'frame' as const,
    source: 'composer' as const,
    ...overrides,
  };
}

const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'dec_launch', kind: 'decision', label: 'Launch?' },
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
  ],
  edges: [{ from: 'dec_launch', to: 'goal_revenue' }],
};

function makeAppliedEditResult(): EditGraphResult {
  return {
    blocks: [],
    assistantText: 'Edge strength increased.',
    latencyMs: 1200,
    appliedGraph: null,
    wasRejected: true,
  } as unknown as EditGraphResult;
}

const STUB_REQUEST = {} as FastifyRequest;

beforeEach(() => {
  vi.clearAllMocks();
  _resetConfigCache();
  (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(makeAppliedEditResult());
  (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue({
    response: {},
    performed: true,
    persisted_row_id: 'row-edit-1',
    graphPersisted: false,
  } as Awaited<ReturnType<typeof commitDirectAnswer>>);
});

afterEach(() => {
  _resetConfigCache();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// projectBriefForEdit — 1,000-char disclosed slice (02 §Seam 1 sizes table)
// ---------------------------------------------------------------------------

describe('projectBriefForEdit', () => {
  it('caps at 1,000 chars (02 §Seam 1: edit needs framing, not the full narrative)', () => {
    expect(EDIT_CONTEXT_BRIEF_CHAR_CAP).toBe(1_000);
  });

  it('null/empty → null; short brief passes through undisclosed', () => {
    expect(projectBriefForEdit(null)).toBeNull();
    expect(projectBriefForEdit(undefined)).toBeNull();
    expect(projectBriefForEdit('   ')).toBeNull();
    expect(projectBriefForEdit('Choose a market entry strategy.')).toEqual({
      text: 'Choose a market entry strategy.',
      truncated: false,
      original_chars: 31,
    });
  });

  it('long brief → first-1,000 slice, disclosed, with a truncation event', () => {
    const emitSpy = vi.spyOn(telemetry, 'emit');
    const long = 'b'.repeat(5_500);
    const projected = projectBriefForEdit(long);
    expect(projected).toEqual({
      text: 'b'.repeat(1_000),
      truncated: true,
      original_chars: 5_500,
    });
    const cuts = emitSpy.mock.calls
      .filter((c) => c[0] === TelemetryEvents.V5ContextTruncation)
      .map((c) => c[1] as Record<string, unknown>);
    expect(cuts).toHaveLength(1);
    expect(cuts[0]).toMatchObject({
      site: 'serialise.projectBriefForEdit',
      section: 'brief',
      original_chars: 5_500,
      kept_chars: 1_000,
      strategy: 'hard_slice',
      disclosed: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Serialiser — ## Decision Brief section
// ---------------------------------------------------------------------------

describe('serialiseEditContextForLLM — ## Decision Brief section', () => {
  const baseContext: ConversationContext = {
    graph: {
      nodes: [{ id: 'dec_a', kind: 'decision', label: 'A?' }],
      edges: [],
    } as unknown as ConversationContext['graph'],
    analysis_response: null,
    framing: null,
    messages: [],
    scenario_id: SCENARIO_ID,
  };

  it('renders the brief FIRST, undisclosed form for an untruncated slice', () => {
    const { text, sectionChars } = serialiseEditContextForLLMWithMeta({
      ...baseContext,
      brief: { text: 'Pick a pricing model for the new tier.', truncated: false, original_chars: 38 },
    });
    expect(text.startsWith('## Decision Brief\n\nPick a pricing model for the new tier.')).toBe(true);
    expect(sectionChars.brief).toBeGreaterThan(0);
    expect(text).not.toContain('(brief truncated:');
  });

  it('renders the disclosure line for a truncated slice', () => {
    const { text } = serialiseEditContextForLLMWithMeta({
      ...baseContext,
      brief: { text: 'b'.repeat(1_000), truncated: true, original_chars: 5_500 },
    });
    expect(text).toContain('## Decision Brief');
    expect(text).toContain('(brief truncated: showing 1000 of 5500 chars)');
  });

  it('renders NO brief section when context.brief is absent (flag-off byte-identity)', () => {
    const { text, sectionChars } = serialiseEditContextForLLMWithMeta(baseContext);
    expect(text).not.toContain('## Decision Brief');
    expect(sectionChars.brief).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Dispatch threading — UNCONDITIONAL store read (S2 shipped ON, flag deleted)
// ---------------------------------------------------------------------------

describe('dispatchEditGraph brief threading (S2 unconditional, no flag)', () => {
  it('reads the scenario brief UNCONDITIONALLY and threads the disclosed 1,000-char slice', async () => {
    // Mutation-check: reverting the flip (re-adding the flag guard, default
    // OFF) makes THIS assertion RED — loadScenarioBriefText would not be called
    // and context.brief would be absent.
    (loadScenarioBriefText as MockedFunction<typeof loadScenarioBriefText>).mockResolvedValue(
      'w'.repeat(4_000),
    );

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-s2-on',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(loadScenarioBriefText).toHaveBeenCalledWith(SCENARIO_ID, 'req-s2-on');
    const context = (handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]![0];
    expect(context.brief).toEqual({
      text: 'w'.repeat(1_000),
      truncated: true,
      original_chars: 4_000,
    });
  });

  it('ANAPHORA (S2 value): the threaded brief renders the ## Decision Brief section so a referent resolves', () => {
    // The edit LLM must SEE the decision framing to resolve "the hire option"
    // style referents (02 §Seam 1). With S2 on, the brief the dispatch threads
    // becomes the first section of the edit prompt.
    const briefText =
      'Should we hire two senior engineers locally (the hire option) or engage an offshore partner?';
    const { text } = serialiseEditContextForLLMWithMeta({
      graph: {
        nodes: [{ id: 'dec_hire', kind: 'decision', label: 'Hire?' }],
        edges: [],
      } as unknown as ConversationContext['graph'],
      analysis_response: null,
      framing: null,
      messages: [{ role: 'user', content: 'increase the strength of the hire option edge' }],
      scenario_id: SCENARIO_ID,
      brief: projectBriefForEdit(briefText),
    });
    expect(text.startsWith('## Decision Brief')).toBe(true);
    expect(text).toContain('the hire option');
  });

  it('no persisted brief: context carries no brief (never an empty section)', async () => {
    (loadScenarioBriefText as MockedFunction<typeof loadScenarioBriefText>).mockResolvedValue(null);

    await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-s2-none',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const context = (handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]![0];
    expect(context.brief ?? null).toBeNull();
  });

  it('a brief-read failure degrades to no-brief (never fails the turn)', async () => {
    (loadScenarioBriefText as MockedFunction<typeof loadScenarioBriefText>).mockRejectedValue(
      new Error('store unavailable'),
    );

    const result = await dispatchEditGraph({
      payload: makePayload(),
      requestId: 'req-s2-degrade',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    expect(result.commitPerformed).toBe(true);
    const context = (handleEditGraph as MockedFunction<typeof handleEditGraph>).mock.calls[0]![0];
    expect(context.brief ?? null).toBeNull();
  });
});
