/**
 * ROADMAP 1.132 (F1 review finding) — a FUNCTIONAL receipt that gains an APPENDED
 * post-compose rewrite (the POC-BOARD 5b compound-edit dropped-action disclosure)
 * MUST stay FUNCTIONAL and ship PLAIN.
 *
 * THE REGRESSION (byte-authoritative, review-found): the executor captures the
 * functional-marker text (`functionalAnswerText`) for a mutation/run RECEIPT
 * BEFORE two post-compose rewrites — the resume-echo and the compound-edit
 * dropped-action disclosure. Neither re-captured. So when the disclosure appends
 * "…haven't applied the other change yet ('Sales Budget')" to the receipt, the
 * FINAL `assistant_text` DIVERGES from the captured functional-marker text; the
 * finalise re-verify (`answerFinalText === functionalAnswerText`) then fails,
 * flips `answerKind` from 'functional' → 'substantive', and the route egress
 * SHAPES it — pushing the honest disclosure line into `detail` behind Show-more.
 * That RE-BURIES the exact disclosure POC-BOARD 5b shipped PLAIN — a regression
 * vs pre-#618.
 *
 * THE INVARIANT: a FUNCTIONAL response stays functional through EVERY
 * post-compose rewrite. The fix re-captures `functionalAnswerText` after each
 * rewrite (resume echo / dropped-action disclosure).
 *
 * REAL PATH: `runTurnExecutor` is NOT mocked. The REAL router
 * (`routeWithToolUse`) extracts the second `set_factor_value` block as a REAL
 * `droppedActions` entry, the REAL execute-success compose path appends the REAL
 * disclosure, and the REAL finalise seam classifies the answer. Only the LLM
 * adapter (`chatWithTools`) is a mock (no network in CI).
 *
 * RED before the re-capture (the diverged receipt classifies 'substantive');
 * GREEN after.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { makeMessagePayload } from './fixtures.js';
import type {
  ChatWithToolsArgs,
  ChatWithToolsResult,
  ToolResponseBlock,
} from '../../adapters/llm/types.js';
import type { GraphV3T } from '../../schemas/cee-v3.js';

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async (write: { graph?: unknown }) => ({
      id: 'mock-row-id',
      ...(write.graph != null
        ? { graph_write_disposition: 'accepted_insert' as const }
        : {}),
    }),
    readRecent: async () => [],
    readFactsFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');
const { OLUMI_ACTION_TOOL_NAME } = await import('../routing/tool-schema.js');

const SCENARIO_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const TURN_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';

function payload(message: string): MessageTurnPayload {
  return makeMessagePayload({ turn_id: TURN_ID, scenario_id: SCENARIO_ID, message });
}

/** Two distinct £ factors, each with a resolved current value. */
function buildTwoFactorGraph(): GraphV3T {
  return {
    nodes: [
      { id: 'g-revenue', kind: 'goal', label: 'Revenue' },
      {
        id: 'f-marketing',
        kind: 'factor',
        label: 'Marketing Budget',
        observed_state: { value: 0.4, raw_value: 40000, unit: '£', cap: 100000 },
      },
      {
        id: 'f-sales',
        kind: 'factor',
        label: 'Sales Budget',
        observed_state: { value: 0.5, raw_value: 50000, unit: '£', cap: 100000 },
      },
      { id: 'o-launch', kind: 'option', label: 'Launch' },
    ],
    edges: [],
  } as GraphV3T;
}

function setProposal(id: string, label: string, rawValue: number): Record<string, unknown> {
  return {
    intent_class: 'execute',
    action: {
      handler_id: 'set_factor_value',
      entity: {
        id,
        kind: 'node',
        label,
        resolution_status: 'resolved',
        resolution_method: 'id_match',
      },
      parameters: [
        { name: 'value', value: { value: rawValue, unit: '£' }, operator: 'set', source: 'user_explicit' },
      ],
      cited_context_fields: [],
    },
  };
}

function mockMultiActionAdapter(inputs: Record<string, unknown>[]) {
  const content: ToolResponseBlock[] = inputs.map((input, i) => ({
    type: 'tool_use' as const,
    id: `tu-${i + 1}`,
    name: OLUMI_ACTION_TOOL_NAME,
    input,
  }));
  const result: ChatWithToolsResult = {
    content,
    stop_reason: 'tool_use',
    usage: { input_tokens: 10, output_tokens: 40 } as unknown as ChatWithToolsResult['usage'],
    model: 'claude-sonnet-4-6',
    latencyMs: 50,
  };
  return {
    chatWithTools: vi
      .fn<(args: ChatWithToolsArgs, opts: { requestId: string }) => Promise<ChatWithToolsResult>>()
      .mockResolvedValue(result),
  };
}

beforeEach(() => {
  setTestSink(() => {});
});

afterEach(() => {
  setTestSink(null);
  vi.restoreAllMocks();
});

describe('ROADMAP 1.132 (F1) — a compound-edit receipt with the dropped-action disclosure stays FUNCTIONAL', () => {
  it('the disclosed receipt is answerKind "functional" (ships PLAIN) AND the disclosure is in the plain assistant_text', async () => {
    const routingAdapter = mockMultiActionAdapter([
      setProposal('f-marketing', 'Marketing Budget', 45000),
      setProposal('f-sales', 'Sales Budget', 60000), // dropped → disclosure appended
    ]);

    const result = await runTurnExecutor(
      payload('please update the marketing and sales budgets'),
      'req-compound-edit-stays-functional',
      { routingAdapter, graphState: buildTwoFactorGraph() },
    );

    expect(result.telemetry.failure_type).toBeNull();

    // POSITIVE PRESENCE — the dropped-action disclosure DID fire and appended to
    // the receipt (otherwise the classification assertion below is vacuous: there
    // would be no post-compose rewrite to diverge the captured text).
    const text = result.response.assistant_text ?? '';
    expect(text).toContain('Sales Budget');
    expect(text.toLowerCase()).toMatch(/haven'?t applied|other change/);

    // THE FIX (RED before the re-capture): the receipt+disclosure diverged the
    // final text from the pre-rewrite capture, flipping the answer to
    // 'substantive' → the route egress would SHAPE it and bury the disclosure
    // behind Show-more. The re-capture keeps it FUNCTIONAL so the disclosure
    // ships PLAIN (no `_answer_shape` synthesised at the route egress, which only
    // shapes when answerKind !== 'functional').
    expect(
      result.answerKind,
      'a functional receipt that gains the honest compound-edit disclosure must stay functional (ship plain), not get re-buried behind Show-more',
    ).toBe('functional');
  });

  it('control: the SAME receipt with NO dropped action is also functional (the disclosure is the only difference)', async () => {
    const routingAdapter = mockMultiActionAdapter([
      setProposal('f-marketing', 'Marketing Budget', 45000),
    ]);

    const result = await runTurnExecutor(
      payload('set marketing budget to £45,000'),
      'req-single-edit-functional',
      { routingAdapter, graphState: buildTwoFactorGraph() },
    );

    expect(result.telemetry.failure_type).toBeNull();
    const text = result.response.assistant_text ?? '';
    expect(text).not.toMatch(/haven'?t applied/i);
    expect(text).not.toContain('Sales Budget');
    // Both this control and the disclosed case above are 'functional' — proving
    // the disclosure (not some other difference) is what previously flipped the
    // classification.
    expect(result.answerKind).toBe('functional');
  });
});
