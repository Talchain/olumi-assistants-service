/**
 * F4 (2026-07-22) — mixed-compound whole-batch rejection recovery.
 *
 * LIVE PROBE that motivated this test (cee-staging, build 6a202d7,
 * scenario a9b32212-…): a drafted hiring graph, then
 *
 *   "Set Headcount Cost to 0.5 and remove the option Hire Two Junior Engineers."
 *
 * The value-update suppressor stands DOWN for mixed value+structural messages
 * (value-update-gate.ts) so the whole message reaches the edit_graph lane. The
 * LLM synthesised an invalid graph and REJECTED the whole batch
 * (rejection_code SYNTHESIZED_GRAPH_INVALID, 2 attempts). Because the
 * conservation-law accounting is gated on `!wasRejected`, it was bypassed, and
 * the wire fell to the generic single-cajole:
 *
 *   assistant_text: "I wasn't able to make that change safely. Can you
 *                    describe what you'd like to add or change in simpler terms?"
 *   suggested_actions: [{ label: 'Describe what to change', … }]
 *
 * That DISCARDS the known decomposition and forces the user to re-describe the
 * entire compound — which re-enters the same fragile lane and re-fails: the
 * observed cajole LOOP, and a silent drop of both parts.
 *
 * The fix names every accountable part and offers one replay chip per part, so
 * each part re-routes to its own deterministic lane and no part is dropped.
 */

import { describe, it, expect, vi, beforeEach, type MockedFunction } from 'vitest';
import type { FastifyRequest } from 'fastify';
import type { EditGraphResult } from '../../../orchestrator/tools/edit-graph.js';

// ── module-level mocks (mirror edit-graph-dispatch-false-success.test.ts) ──

vi.mock('../../../orchestrator/tools/edit-graph.js', () => ({
  handleEditGraph: vi.fn(),
}));

vi.mock('../../commit.js', () => ({
  commitDirectAnswer: vi.fn(),
  computeRequestHash: vi.fn().mockReturnValue('sha256:testhash'),
}));

vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: vi.fn().mockReturnValue({}),
}));

vi.mock('../../build-turn-context.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../build-turn-context.js')>();
  return {
    ...actual,
    loadPersistedGraphStrict: vi.fn().mockResolvedValue(null),
  };
});

// ── imports after mocks ─────────────────────────────────────────────

import { dispatchEditGraph } from '../edit-graph-dispatch.js';
import { handleEditGraph } from '../../../orchestrator/tools/edit-graph.js';
import { commitDirectAnswer } from '../../commit.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';

// ── helpers ─────────────────────────────────────────────────────────

const SCENARIO_ID = 'a9b32212-a1b2-4ada-8465-0c74b1e8bd17';
const TURN_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

// The live drafted hiring graph (subset sufficient for the dispatch path).
const INGRESS_GRAPH: GraphStateIngress = {
  nodes: [
    { id: 'goal_ship_faster', kind: 'goal', label: 'Ship Faster This Year' },
    { id: 'fac_headcount_cost', kind: 'factor', label: 'Headcount Cost' },
    { id: 'opt_two_juniors', kind: 'option', label: 'Hire Two Junior Engineers' },
    { id: 'opt_senior', kind: 'option', label: 'Hire One Senior Engineer' },
  ],
  edges: [{ from: 'fac_headcount_cost', to: 'goal_ship_faster' }],
};

function makePayload(message: string) {
  return {
    kind: 'message' as const,
    scenario_id: SCENARIO_ID,
    turn_id: TURN_ID,
    stage: 'analyse' as const,
    message,
    turn_class: 'propose' as const,
    source: 'composer' as const,
  };
}

/** The exact live rejection shape: wasRejected=true, generic cajole copy. */
function makeSynthesizedInvalidRejection(): EditGraphResult {
  return {
    blocks: [],
    assistantText:
      "I wasn't able to make that change safely. " +
      "Can you describe what you'd like to add or change in simpler terms?",
    latencyMs: 20752,
    appliedGraph: null,
    wasRejected: true,
    operations: [],
    diagnostics: {
      failure_code: 'SYNTHESIZED_GRAPH_INVALID',
      failure_branch: 'synthesized_graph_invalid',
      validation_violation_codes: ['synthesized_graph_invalid'],
    },
  } as unknown as EditGraphResult;
}

function makeCommitResult() {
  return {
    response: {},
    performed: true as const,
    persisted_row_id: 'row-test',
    graphPersisted: false,
  };
}

const STUB_REQUEST = {} as FastifyRequest;

// The verbatim live probe message.
const MIXED_MESSAGE = 'Set Headcount Cost to 0.5 and remove the option Hire Two Junior Engineers.';

describe('dispatchEditGraph — mixed-compound whole-batch rejection recovery (F4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (handleEditGraph as MockedFunction<typeof handleEditGraph>).mockResolvedValue(
      makeSynthesizedInvalidRejection(),
    );
    (commitDirectAnswer as MockedFunction<typeof commitDirectAnswer>).mockResolvedValue(
      makeCommitResult() as Awaited<ReturnType<typeof commitDirectAnswer>>,
    );
  });

  it('replaces the generic single-cajole with an honest per-part clarify naming BOTH parts', async () => {
    const out = await dispatchEditGraph({
      payload: makePayload(MIXED_MESSAGE),
      requestId: 'req-mixed-reject',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const text = out.response.assistant_text ?? '';
    // The context-losing generic cajole must be gone …
    expect(text).not.toMatch(/describe what you'd like to add or change/i);
    // … replaced by copy that names each part verbatim so nothing is dropped.
    expect(text).toMatch(/Set Headcount Cost to 0\.5/);
    expect(text).toMatch(/remove the option Hire Two Junior Engineers/);
    // British-English one-at-a-time framing (breaks the re-describe loop).
    expect(text).toMatch(/one at a time/i);
  });

  it('offers one replay chip per accountable part, each carrying its own clause (context threaded forward)', async () => {
    const out = await dispatchEditGraph({
      payload: makePayload(MIXED_MESSAGE),
      requestId: 'req-mixed-reject-chips',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const actions = out.response.suggested_actions ?? [];
    // Exactly the two accountable parts (value + structural_remove) — NOT the
    // single generic 'Describe what to change' recovery chip.
    expect(actions.length).toBe(2);
    const messages = actions.map((a) => a.message ?? '');
    // Each chip replays exactly one clause verbatim (trailing punctuation, as
    // segmented, is preserved so the replay is the user's own words).
    expect(messages.some((m) => /^Set Headcount Cost to 0\.5\.?$/.test(m))).toBe(true);
    expect(
      messages.some((m) => /^remove the option Hire Two Junior Engineers\.?$/.test(m)),
    ).toBe(true);
    // No residual generic-cajole chip survived.
    expect(actions.some((a) => /describe what to change/i.test(a.label ?? ''))).toBe(false);
  });

  it('preserves the diagnostic rejection block (codes for operators) while re-sourcing prose + chips', async () => {
    const out = await dispatchEditGraph({
      payload: makePayload(MIXED_MESSAGE),
      requestId: 'req-mixed-reject-blocks',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    const blocks = out.response.blocks ?? [];
    const errorBlock = blocks.find((b) => (b as { type?: string }).type === 'error');
    expect(errorBlock).toBeDefined();
    const details = (errorBlock as { details?: Record<string, unknown> }).details ?? {};
    expect(details.rejection_code).toBe('SYNTHESIZED_GRAPH_INVALID');
  });

  it('single-part rejection keeps today\'s generic recovery copy (false-compound trap)', async () => {
    const out = await dispatchEditGraph({
      payload: makePayload('remove the option Hire Two Junior Engineers.'),
      requestId: 'req-single-reject',
      request: STUB_REQUEST,
      graphState: INGRESS_GRAPH,
      analysisState: null,
    });

    // Only one accountable part → buildMultiPartRejectionClarify returns null →
    // the generic rejection copy is untouched.
    expect(out.response.assistant_text ?? '').toMatch(/make that change safely/i);
  });
});
