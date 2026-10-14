/**
 * ⭐ ONE RULE FOR AN UNSIZED RISK — THE RUN'S OWN WIRE (DL 19:26Z 14 Oct, T1H item (a)). Served hiring r3's saved model (CEE
 * 9c3b5808, read 02 after approve) through the real loader and Run handler: the drafted, unsized ‘Code quality degradation’
 * held the Run; it is now left out of what PLoT receives (with every link touching it), never sampled at zero. Contrast: the
 * same risk sized by the user's own occurrence is sent.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import type { SessionStore } from '../../../session/store.js';
import { createNoopSessionStore } from '../../../session/__tests__/fixtures.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { runWithBoundAnalysisSnapshot } from '../../../run-analysis-snapshot-binding.js';

type Json = Record<string, any>;
const BODY = (JSON.parse(readFileSync(new URL('../../../agent-lane/__tests__/fixtures/hiring-t1h-positive-r3-read02-after-approve.json',
  import.meta.url), 'utf8')) as Json).body as Json;
const RISK = 'code_quality_degradation';
let savedGraph: Json;
const store: SessionStore = {
  ...createNoopSessionStore(),
  loadGraph: async () => structuredClone(savedGraph),
  loadGraphAndBriefText: async () => ({ graph: structuredClone(savedGraph), briefText: BODY.brief_text }),
};
vi.mock('../../../session/index.js', () => ({
  getSessionStore: () => store, resetSessionStoreForTests: () => {}, SessionReadError: class SessionReadError extends Error {},
}));
vi.mock('../../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => {} }));

/** What the Run hands PLoT for the saved model (the engine's reply is not under test, so it stops there). */
async function sentGraph(graph: Json): Promise<Json | null> {
  savedGraph = graph;
  const snapshot = await loadScenarioSnapshotForRunAnalysis(BODY.scenario_id, 'unsized-load', store);
  const run = vi.fn(async () => { throw new Error('stop after the wire'); });
  const handler = createRunAnalysisHandler({
    plotClient: { run, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: async () => snapshot,
  });
  await runWithBoundAnalysisSnapshot(undefined as never, () => handler({
    context: {
      stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [],
      session_id: BODY.scenario_id, request_id: 'unsized-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 },
      prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null,
    },
    payload: makeMessagePayload({ turn_id: 'unsized-run', scenario_id: BODY.scenario_id, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'unsized-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation)).catch(() => undefined);
  const calls = run.mock.calls as unknown as [Json][];
  return calls.length === 1 ? calls[0]![0].graph as Json : null;
}

describe('the Run sends the saved model without an unsized drafted risk', () => {
  it('RED→GREEN: served hiring r3 reaches PLoT (it was held), without the risk or any link touching it', async () => {
    const sent = await sentGraph(structuredClone(BODY.graph));
    expect(sent, 'the Run is admitted and calls PLoT').not.toBeNull();
    expect((sent!.nodes as Json[]).map((n) => n.id)).not.toContain(RISK);
    expect((sent!.edges as Json[]).filter((e) => e.from === RISK || e.to === RISK)).toEqual([]);
    expect((sent!.nodes as Json[]).map((n) => n.id)).toContain('productivity');
  });

  it('CONTRAST: sized by the user’s own occurrence, the same risk and its link to the goal are sent', async () => {
    const g = structuredClone(BODY.graph);
    Object.assign((g.nodes as Json[]).find((n) => n.id === RISK)!, { event_risk: { version: 1,
      occurrence: { p_low: 0.2, p_high: 0.4, meaning: 'at_least_once_within_horizon', basis: 'user' }, horizon: { months: 3 } } });
    const sent = await sentGraph(g);
    expect(sent).not.toBeNull();
    expect((sent!.nodes as Json[]).map((n) => n.id)).toContain(RISK);
    expect((sent!.edges as Json[]).filter((e) => e.from === RISK).map((e) => e.to)).toEqual(['productivity']);
  });
});
