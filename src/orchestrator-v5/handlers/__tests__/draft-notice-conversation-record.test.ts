/**
 * Draft dispatch -> real commit -> captured SessionStore.append -> real
 * read-side content parser and projectConversation. The provider and database
 * boundaries are isolated: this establishes the application integration, not
 * a live database save or a successful next-turn model answer.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FastifyRequest } from 'fastify';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import type { DraftGraphResult } from '../../../orchestrator/tools/draft-graph.js';
import type { SessionStore, SessionTurnWrite } from '../../session/store.js';
import type { SessionTurnWithContent } from '../../session/conversation-content.js';

const ports = vi.hoisted(() => ({
  draft: vi.fn(), pendingRead: vi.fn(), sessionStore: vi.fn(),
}));
vi.mock('../../../orchestrator/tools/draft-graph.js', () => ({ handleDraftGraph: ports.draft }));
vi.mock('../../build-turn-context.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../build-turn-context.js')>(),
  loadMostRecentPendingActions: ports.pendingRead,
}));
vi.mock('../../session/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../session/index.js')>(),
  getSessionStore: ports.sessionStore,
}));
// Leave commit and its post-commit maintainer real. Isolate the maintainer's
// external store constructor before it can create any DB/provider client.
vi.mock('../../rolling-summary/index.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../rolling-summary/index.js')>(),
  getRollingSummaryStore: () => { throw new Error('Summary store isolated in notice test'); },
}));

import { _resetConfigCache } from '../../../config/index.js';
import { setTestSink } from '../../../utils/telemetry.js';
import { buildModelBuildingNotices } from '../../../cee/draft/records/model-building-notices.js';
import { optionFramingWarnings } from '../../../cee/draft/records/option-framing-recovery.js';
import { dispatchDraftGraph } from '../draft-graph-dispatch.js';
import { createNoopSessionStore } from '../../session/__tests__/fixtures.js';
import { parseConversationContent } from '../../session/conversation-content.js';
import { makeMessagePayload } from '../../__tests__/fixtures.js';
import { projectConversation } from '../../context/context-pack-assembler.js';

const PAYLOAD = makeMessagePayload({
  scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  turn_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  message: 'Compare raising the Pro price from £49 to £59 with holding it at £49. We want to grow recurring revenue.',
  stage: 'frame',
});
const RAW_LABEL = 'Private source label only available inside the projector';
const GRAPH = {
  nodes: [
    { id: 'dec_price', kind: 'decision', label: 'Pricing strategy' },
    { id: 'opt_raise', kind: 'option', label: 'Raise price to £59', interventions: { fac_price: 0.59 } },
    { id: 'opt_hold', kind: 'option', label: 'Hold price at £49', interventions: { fac_price: 0.49 } },
    { id: 'fac_price', kind: 'factor', label: 'Pro monthly price', data: { value: 0.49 } },
    { id: 'goal_mrr', kind: 'goal', label: 'Grow recurring revenue' },
  ],
  edges: [{ from: 'fac_price', to: 'goal_mrr', strength: { mean: 0.5, std: 0.1 } }],
};

function fixture(details = 8, relationships = 2, consolidated = 1): DraftGraphResult {
  const disclosures = [
    ...Array.from({ length: details }, () => ({ reason: 'unconnected_to_goal', label: RAW_LABEL })),
    ...Array.from({ length: relationships }, () => ({ reason: 'ref_kind_illegal', label: RAW_LABEL })),
    ...Array.from({ length: consolidated }, () => ({ reason: 'undeveloped_duplicate_of_stated', label: RAW_LABEL })),
  ];
  return {
    blocks: [], assistantText: 'Draft output available.', latencyMs: 1,
    strengthenItems: [], coachingSummary: null, coachingWideningLog: null,
    coachingBiasSignals: null, draftWarnings: [],
    // Raw disclosures deliberately exist in the producer result. The public
    // receipt must use only the published aggregate, not dump this graph.
    graphOutput: { ...structuredClone(GRAPH), record_disclosures: disclosures },
    modelBuildingNotices: buildModelBuildingNotices(disclosures),
  } as unknown as DraftGraphResult;
}

function captureStore(failAppend = false) {
  const attempts: SessionTurnWrite[] = [];
  const committed: SessionTurnWrite[] = [];
  const store: SessionStore = {
    ...createNoopSessionStore(),
    async append(write) {
      attempts.push(structuredClone(write));
      if (failAppend) throw new Error('Controlled atomic append failure');
      committed.push(structuredClone(write));
      return { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' };
    },
  };
  ports.sessionStore.mockReturnValue(store);
  return { attempts, committed };
}

function nextTurnText(write: SessionTurnWrite) {
  // Use only the captured persistence arguments, never the immediate wire
  // response, to build the read-side turn.
  const turn: SessionTurnWithContent = {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    scenario_id: write.scenario_id, turn_id: write.turn_id,
    user_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
    turn_class: write.turn_class, handler_id: write.handler_id,
    request_hash: write.request_hash, response_emitted: write.response_emitted,
    llm_calls_used: write.llm_calls_used, duration_ms: write.duration_ms,
    created_at: '2026-09-14T12:00:00.000Z',
    ...parseConversationContent({ user_message: write.userMessage, assistant_message: write.assistantMessage }),
  };
  const conversation = projectConversation([turn], false, 1);
  expect(conversation.recent_turns).toHaveLength(1);
  expect(conversation.recent_turns[0]!.user_message).toBe(PAYLOAD.message);
  return conversation.recent_turns[0]!.assistant_message;
}

async function dispatch() {
  return dispatchDraftGraph({
    payload: PAYLOAD, requestId: 'notice-conversation-record',
    request: { headers: {} } as FastifyRequest,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('OLUMI_ENV', 'staging');
  vi.stubEnv('CEE_MODEL_VERSIONS_ENABLED', 'false');
  vi.stubEnv('CEE_V6_DUAL_DRAFT_ENABLED', 'false');
  _resetConfigCache();
  setTestSink(() => undefined);
  ports.pendingRead.mockResolvedValue([]);
});
afterEach(() => {
  setTestSink(null);
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe('public draft notices survive the real commit and conversation projection', () => {
  it.each([
    { details: 8, relationships: 2, consolidated: 1 },
    { details: 3, relationships: 4, consolidated: 2 },
  ])('retains the actual category counts ($details/$relationships/$consolidated), not a hardcoded tally', async counts => {
    const draft = fixture(counts.details, counts.relationships, counts.consolidated);
    ports.draft.mockResolvedValue(draft);
    const store = captureStore();
    const result = await dispatch();

    expect(result.commitPerformed).toBe(true);
    expect(store.attempts).toHaveLength(1);
    expect(store.committed).toHaveLength(1);
    const write = store.committed[0]!;
    const remembered = nextTurnText(write);
    expect(remembered).toBe(write.assistantMessage);
    expect(remembered).toMatch(new RegExp(`\\b${counts.details} details? not connected\\b`));
    expect(remembered).toMatch(new RegExp(`\\b${counts.relationships} relationships? not used\\b`));
    expect(remembered).toMatch(new RegExp(`\\b${counts.consolidated} alternatives? consolidated\\b`));
    expect(remembered).toContain('category counts');
    expect(remembered).toContain('not the individual items');
    expect(remembered).not.toContain(RAW_LABEL);
    expect(remembered).not.toMatch(/11 (?:things|items).*(?:left out|omitted|dropped)/i);
    expect(result.response.assistant_text).toContain(remembered!);
    expect(result.response.assistant_text.split('Draft notice:')).toHaveLength(2);
    expect(result.response.model_building_notices).toEqual(draft.modelBuildingNotices);
    const parsed = OlumiResponseSchema.parse(result.response);
    expect(parsed.model_building_notices).toEqual(draft.modelBuildingNotices);
  });

  it('does not turn consolidated alternatives into omitted items', async () => {
    const draft = fixture(0, 0, 2);
    ports.draft.mockResolvedValue(draft);
    const store = captureStore();
    const result = await dispatch();
    expect(result.commitPerformed).toBe(true);
    const remembered = nextTurnText(store.committed[0]!);
    expect(remembered).toMatch(/2 alternatives? consolidated/);
    expect(remembered).not.toMatch(/not connected|not used|left out|omitted|dropped|nothing was omitted/i);
    expect(result.response.assistant_text).toContain(remembered!);
  });

  it('does not invent a zero attestation when the producer supplies no notices', async () => {
    const draft = fixture(0, 0, 0);
    ports.draft.mockResolvedValue(draft);
    const store = captureStore();
    const result = await dispatch();
    expect(result.commitPerformed).toBe(true);
    expect(store.committed).toHaveLength(1);
    expect(nextTurnText(store.committed[0]!)).toBeNull();
    expect(result.response.model_building_notices).toBeUndefined();
    expect(result.response.assistant_text).not.toContain('Draft notice:');
    expect(result.response.assistant_text).not.toMatch(/(?:0|zero|no) (?:items|things) (?:were )?(?:omitted|left out)/i);
  });

  it('keeps the existing framing receipt alongside the new aggregate, each exactly once', async () => {
    const draft = fixture();
    const warnings = optionFramingWarnings([{
      reason: 'decision_framing_not_an_option', node_id: 'opt_question',
      label: 'Should we raise the Pro price?',
    }]);
    ports.draft.mockResolvedValue({ ...draft, draftWarnings: warnings });
    const store = captureStore();
    const result = await dispatch();
    expect(result.commitPerformed).toBe(true);
    const remembered = nextTurnText(store.committed[0]!);
    expect(remembered).toContain('Draft notice:');
    expect(remembered).toContain(warnings[0]!.explanation);
    for (const text of [remembered!, result.response.assistant_text]) {
      expect(text.split('Draft notice:')).toHaveLength(2);
      expect(text.split(warnings[0]!.explanation)).toHaveLength(2);
      expect(text.split(warnings[0]!.fix_hint)).toHaveLength(2);
    }
  });

  it('does not claim successful persistence or a completed draft when the append fails', async () => {
    ports.draft.mockResolvedValue(fixture());
    const store = captureStore(true);
    const result = await dispatch();
    expect(store.attempts).toHaveLength(1);
    expect(store.committed).toHaveLength(0);
    expect(result.commitPerformed).toBe(false);
    expect(result.response.stage_indicator).toBe(PAYLOAD.stage);
    expect(result.analysisReady).toBeUndefined();
    expect(result.response.assistant_text).toBe('Draft output available.');
    expect(result.response.assistant_text).not.toMatch(/saved|I've built|Draft notice:/i);
  });
});
