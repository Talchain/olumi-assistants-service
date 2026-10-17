/**
 * ⭐ G3 WORKING POINT, ON THE REAL PATH (DL-3 04:15Z bar; BUDDY-A 00:12Z AMEND): a link the user stated as a range in their brief,
 * which nobody sized, gets Olumi's working point from that range as a card; its press writes it through the existing link writer;
 * the SAVED edge holds the working point's mean and its OWN spread (never `olumiSpreadForMean`); a cold read keeps it; the engine
 * input the Run sends carries it; and the chance licensed on it rests on Olumi's estimate the user accepted.
 * Path: `strengthenCardFor` → `proposeLinkStrengths` (host origin `working_point`) → `authoriseChange` → `applyLinkStrengthSet` →
 * `commitOptionLevelsInProcess` → the canonical link writer → persisted → `GraphV3` → `loadScenarioSnapshotForRunAnalysis` →
 * `createRunAnalysisHandler` → the PLoT payload. Harness: `m1-strengthen-apply-keeps-figure.test.ts`'s store + door, verbatim.
 * SYNTHETIC graph: a 0/1 switch onto a % level goal, the user's "4 to 7 percentage points" recorded as construction records it.
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';

import { GraphV3 } from '../../../src/schemas/cee-v3.js';
import { projectGraphForPersistence } from '../../../src/orchestrator-v5/persisted-graph-projection.js';
import { computeAnalysisAffectingGraphHash } from '../../../src/orchestrator-v5/context/graph-hash.js';
import { assignEntityRefs } from '../../../src/orchestrator-v5/graph/entity-refs.js';
import { CONSTRUCTION_ATTEST, linkHoldsStatedRange, userStatementRecord, withUserStatement } from '../../../src/orchestrator-v5/statement-door/statements.js';
import { linkWorkingPointOf, linkWorkingPointWords, QUARTILES_APART_IN_SD } from '../../../src/orchestrator-v5/agent-lane/link-working-point.js';
import { createNoopSessionStore } from '../../../src/orchestrator-v5/session/__tests__/fixtures.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../src/orchestrator-v5/build-turn-context.js';
import { createRunAnalysisHandler } from '../../../src/orchestrator-v5/tools/handlers/run-analysis.js';
import type { HandlerInvocation } from '../../../src/orchestrator-v5/tools/registry.js';
import type { PLoTClient } from '../../../src/orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../src/orchestrator/types.js';
import { makeMessagePayload } from '../../../src/orchestrator-v5/__tests__/fixtures.js';
import { goalChanceLicenceOf } from '../../../src/orchestrator-v5/goal-target/goal-chance-licence.js';
import { unsizedLeaderGoalPaths } from '../../../src/orchestrator-v5/agent-lane/goal-certainty.js';
import { goalChanceEstimateCounts } from '../../../src/orchestrator-v5/agent-lane/goal-chance-estimate-attribution.js';

const SCENARIO_ID = 'e3e3e3e3-0000-4000-8000-000000000301';
const FROM = 'collection', TO = 'recycling';
const QUOTE = 'Our waste officer thinks weekly food collection could lift the rate by somewhere between 4 and 7 percentage points.';
type Json = Record<string, any>;

function storedGraph(patch: { statement?: Json; edge?: Json } = {}): unknown {
  const parsed = GraphV3.parse({
    nodes: [
      { id: 'plan', kind: 'decision', label: 'Food collection plan' },
      { id: 'weekly', kind: 'option', label: 'Weekly food collection', interventions: { [FROM]: { value: 1, source: 'brief_extraction', extractionType: 'explicit', target_match: { node_id: FROM, match_type: 'exact_id', confidence: 'high' } } } },
      { id: 'keep', kind: 'option', label: 'Keep fortnightly collection', is_status_quo: true, interventions: { [FROM]: { value: 0, source: 'brief_extraction', extractionType: 'explicit', target_match: { node_id: FROM, match_type: 'exact_id', confidence: 'high' } } } },
      { id: FROM, kind: 'factor', label: 'Weekly food collection running', observed_state: { value: 0, baseline: 0, raw_value: 0, unit: '0/1', cap: 1, source: 'brief_extraction', extractionType: 'explicit' } },
      { id: TO, kind: 'goal', label: 'Household recycling rate', goal_direction: '>=', goal_threshold: 0.5, goal_threshold_raw: 50,
        goal_threshold_unit: '%', goal_threshold_cap: 100, goal_threshold_frame: 'level',
        observed_state: { value: 0.42, baseline: 0.42, raw_value: 42, unit: '%', cap: 100, source: 'brief_extraction', extractionType: 'explicit' } },
    ],
    edges: [
      { from: 'plan', to: 'weekly', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'plan', to: 'keep', strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'weekly', to: FROM, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: 'keep', to: FROM, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive' },
      { from: FROM, to: TO, strength: { mean: 0.1, std: 0.05 }, exists_probability: 1, effect_direction: 'positive',
        provenance: { source: 'brief_extraction', magnitude: 'olumi_placeholder' }, defaulted: true, ...patch.edge },
    ],
  });
  const projected = projectGraphForPersistence({ ...parsed, options: [] as Array<Record<string, unknown>> });
  const subject = { kind: 'link' as const, id: FROM, to_id: TO, field: 'effect' as const };
  const st = { speaker: 'user', reading: 'olumi', quote: QUOTE, source: QUOTE, subject: { quantity: `link|${FROM}|${TO}||effect` },
    unit: 'percentage points', form: 'range', low: 4, high: 7, ...patch.statement };
  const withRange = withUserStatement(projected as never, userStatementRecord(subject, [st as never], '2026-10-17T00:00:00.000Z', CONSTRUCTION_ATTEST), subject);
  return assignEntityRefs(withRange, withRange).graph;
}

let persisted: unknown = storedGraph();
const rows = new Map<string, { id: string; write: Record<string, unknown> }>();

vi.mock('../../../src/orchestrator-v5/session/index.js', () => ({
  getSessionStore: () => ({
    loadGraph: async () => persisted,
    loadGraphAndBriefText: async () => ({ graph: persisted, briefText: null }),
    readMostRecentPendingActions: async () => [],
    readFactsFor: async () => [],
    readRecent: async () => [...rows.values()].reverse().map(r => ({
      id: r.id, scenario_id: r.write.scenario_id, turn_id: r.write.turn_id, turn_class: r.write.turn_class,
      handler_id: r.write.handler_id, request_hash: r.write.request_hash, response_emitted: r.write.response_emitted,
      llm_calls_used: r.write.llm_calls_used, duration_ms: r.write.duration_ms,
      assistant_message: r.write.assistantMessage ?? null, created_at: '2026-10-17T00:00:00.000Z',
    })),
    readFactsWithTurnFor: async (ids: readonly string[]) => [...rows.values()].flatMap(r => {
      if (!ids.includes(r.id)) return [];
      const facts = (r.write.handler_facts ?? []) as unknown[];
      return facts.map(fact => ({ turn_id: r.id, fact_created_at: '2026-10-17T00:00:00.000Z', fact }));
    }),
    append: async (write: Record<string, unknown>) => {
      const key = `${String(write.scenario_id)}/${String(write.turn_id)}`;
      const existing = rows.get(key);
      if (existing !== undefined) return { id: existing.id };
      const id = `row-${rows.size + 1}`;
      rows.set(key, { id, write: JSON.parse(JSON.stringify(write)) });
      if (write.graph !== undefined) persisted = write.graph;
      return { id };
    },
    getScenarioOwner: async () => null,
    invalidateScoped: async (_s: string, scope: unknown) => ({ scope, entries_invalidated: [] }),
    invalidateAll: async () => ({ scope: { kind: 'structural' as const }, entries_invalidated: [] }),
    ensureScenarioExists: async (_id: string, userId: string) => ({ user_id: userId }),
  }),
  resetSessionStoreForTests: () => {},
  SessionReadError: class SessionReadError extends Error {},
}));

const llmChatMock = vi.fn();
vi.mock('../../../src/adapters/llm/router.js', () => ({
  getAdapter: () => ({ name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock }),
  getAdapterWithResolution: () => ({
    adapter: { name: 'test', model: 'test-model', chat: llmChatMock, chatWithTools: llmChatMock },
    resolution: { task: 'narrate', resolved_model: 'test-model', resolution_source: 'task_default' as const },
  }),
  getMaxTokensFromConfig: () => undefined,
}));

const edgeOf = (g: unknown, from = FROM, to = TO): Json => (g as { edges: Json[] }).edges.find((e) => e.from === from && e.to === to)!;
const RUN_STATE = { run_state: { kind: 'complete_current' } };

/** What the Run actually sends PLoT for this graph (the live run_analysis projection boundary). */
async function plotPayloadFor(graph: unknown): Promise<Json> {
  let captured: Json | undefined;
  const plotClient = {
    run: vi.fn((payload: Json) => { captured = payload; return Promise.resolve({ meta: { seed_used: 1, n_samples: 100, response_hash: 'sha256:g3' },
      results: [], response_hash: 'sha256:g3-top', analysis_status: 'completed' } as unknown as V2RunResponseEnvelope); }),
    validatePatch: vi.fn().mockResolvedValue({}),
  } as unknown as PLoTClient;
  const store = createNoopSessionStore({ loadGraphResult: graph });
  const handler = createRunAnalysisHandler({ plotClient, scenarioReader: (id) => loadScenarioSnapshotForRunAnalysis(id, 'req-g3', store) });
  await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [{ role: 'user', content: 'run analysis' }],
      session_id: SCENARIO_ID, request_id: 'req-g3', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [],
      scenarioBriefText: null, persistedGraph: null } as unknown as HandlerInvocation['context'],
    payload: makeMessagePayload({ turn_id: 't1', scenario_id: SCENARIO_ID, message: 'run analysis', turn_class: 'decide', stage: 'analyse' }),
    requestId: 'req-g3', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  if (captured === undefined) throw new Error('the Run sent PLoT nothing');
  return captured;
}

describe('G3: a brief range becomes Olumi\'s working point only by its own press, saved and sent exactly', () => {
  let commitOptionLevelsInProcess: typeof import('../../../src/orchestrator-v5/system-events/dispatch.js').commitOptionLevelsInProcess;
  let createAgentCapabilities: typeof import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js').createAgentCapabilities;
  let ProposalStore: typeof import('../../../src/orchestrator-v5/agent-lane/proposal.js').ProposalStore;
  let strengthenCardFor: typeof import('../../../src/orchestrator-v5/agent-lane/strengthen-press.js').strengthenCardFor;
  let linkSizing: typeof import('../../../src/cee/magnitude/link-sizing.js').linkSizing;
  beforeAll(async () => {
    ({ commitOptionLevelsInProcess } = await import('../../../src/orchestrator-v5/system-events/dispatch.js'));
    ({ createAgentCapabilities } = await import('../../../src/orchestrator-v5/agent-lane/runtime/agent-capabilities.js'));
    ({ ProposalStore } = await import('../../../src/orchestrator-v5/agent-lane/proposal.js'));
    ({ strengthenCardFor } = await import('../../../src/orchestrator-v5/agent-lane/strengthen-press.js'));
    ({ linkSizing } = await import('../../../src/cee/magnitude/link-sizing.js'));
  });
  beforeEach(() => { persisted = storedGraph(); rows.clear(); llmChatMock.mockClear(); });

  const capabilities = () => {
    const d = async () => ({ status: 200, json: { graph: persisted, graph_hash: computeAnalysisAffectingGraphHash(persisted as never) } });
    return createAgentCapabilities(d as never, new ProposalStore(), undefined, 'full', undefined, {
      commitOptionLevels: (input) => commitOptionLevelsInProcess(input, 'req-g3'),
    });
  };
  // A chip press: no typed words, exactly as the route binds it.
  const ctx = { scenario_id: SCENARIO_ID, authenticated_user_id: 'user-a', request_id: 'r', user_text: '', user_turn_text: '' };

  it('⭐ card → press → readback → cold → the Run\'s PLoT input: the working point and its own spread, as Olumi\'s estimate you accepted', async () => {
    const wp = linkWorkingPointOf(persisted, FROM, TO)!;
    expect(wp, 'precondition: the convention holds for this link').toBeDefined();
    const before = structuredClone(edgeOf(persisted));
    expect(linkSizing(before), 'precondition').toBe('placeholder');
    expect(unsizedLeaderGoalPaths(persisted, ['weekly']), 'precondition: the placeholder withholds the goal figures')
      .toEqual([{ option_id: 'weekly', links: [{ from: FROM, to: TO }] }]);
    // 1. The issuer: a card (never the size ask), whose args name the host origin.
    const card = strengthenCardFor({ graph: persisted, analysisState: RUN_STATE, optionParticipation: [] });
    expect(card, JSON.stringify(card)).toMatchObject({ target: { from_id: FROM, to_id: TO },
      args: { links: [{ strength: wp.band, origin: 'working_point' }] } });
    expect(card).not.toHaveProperty('ask_only');
    // 2. The prepare: one set_link_strength op at the working point with its own spread, and the words shown before the press.
    const caps = capabilities();
    const p = await caps.proposeLinkStrengths!(ctx, card!.args as never);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    expect(String(p.public_label)).toContain(linkWorkingPointWords(persisted, wp));
    expect(rows.size, 'nothing written before the press').toBe(0);
    // 3. The press: ONE commit, read back whole.
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(rows.size, 'ONE commit').toBe(1);
    const saved = edgeOf(persisted);
    expect(saved.strength).toEqual({ mean: wp.mean, std: wp.std });
    expect(saved.strength.std, 'the working point\'s own spread, (7 − 4) points / 100 / 1.349').toBeCloseTo(0.03 / QUARTILES_APART_IN_SD, 12);
    expect(linkSizing(saved), 'Olumi\'s estimate, accepted').toBe('olumi_accepted');
    expect(saved.std_defaulted, 'the spread stays Olumi\'s').toBe(true);
    expect(saved.provenance?.source, 'never the user\'s figure').toBe(before.provenance.source);
    expect(linkHoldsStatedRange(persisted, FROM, TO), 'the user\'s range stays recorded').toBe(true);
    // 4. Cold: the stored bytes, re-read by the schema every reader uses.
    const cold = GraphV3.parse(JSON.parse(JSON.stringify(persisted)));
    expect(edgeOf(cold).strength).toEqual({ mean: wp.mean, std: wp.std });
    // 5. The engine input the Run actually sends.
    const payload = await plotPayloadFor(cold);
    const sent = (payload.graph as { edges: Json[] }).edges.find((e) => e.from === FROM && e.to === TO)!;
    expect(sent, JSON.stringify(payload.graph).slice(0, 600)).toBeDefined();
    expect(sent.strength ?? { mean: sent.strength_mean, std: sent.strength_std }).toEqual({ mean: wp.mean, std: wp.std });
    // 6. What the Run's chance then rests on: the placeholder no longer withholds the goal figures (the ONE reader of an unsized
    // goal-path link), and the census counts the link as Olumi's estimate the user accepted, so a chance shown is provisional.
    expect(unsizedLeaderGoalPaths(cold, ['weekly'])).toEqual([]);
    // The ONLY Olumi input the chance rests on is that accepted working point (so "provisional" below is about it).
    expect(goalChanceEstimateCounts(cold, ['weekly', 'keep'], TO)).toMatchObject({ acceptedLinks: 1, links: 0, values: 0, acceptedValues: 0,
      unverifiedLinks: 0, unverifiedValues: 0, settingsByOption: {}, unread: false });
    const wilson = (p: number, met: number): Json => ({ basis: 'simulation_precision', method: 'wilson_score', confidence_level: 0.95,
      n_informative: 10000, n_met: met, interval_lower: Math.max(0, p - 0.01), interval_upper: Math.min(1, p + 0.01) });
    const run = { option_comparison: [
      { option_id: 'weekly', probability_of_goal: 0.31, probability_of_goal_precision: wilson(0.31, 3100), outcome: { mean: 47, std: 2, p10: 45, p50: 47, p90: 50 } },
      { option_id: 'keep', probability_of_goal: 0, probability_of_goal_precision: wilson(0, 0), outcome: { mean: 42, std: 0, p10: 42, p50: 42, p90: 42 } },
    ] };
    const licence = goalChanceLicenceOf(run, cold, TO, () => false, undefined, cold, {});
    expect(licence, 'a chance is licensed on Olumi\'s accepted working point').not.toBeNull();
    expect(licence).toMatchObject({ pct_by_option: { weekly: 31 }, provisional: true });
    // CONTRAST (discriminating): the same saved graph with that one link the user's own size is not provisional.
    const usersOwn = structuredClone(cold) as Json;
    edgeOf(usersOwn).provenance = { source: 'user_specified', magnitude: 'user_stated' };
    const theirs = goalChanceLicenceOf(run, usersOwn, TO, () => false, undefined, usersOwn, {});
    expect(theirs).toMatchObject({ pct_by_option: { weekly: 31 } });
    expect(theirs).not.toHaveProperty('provisional');
  }, 60_000);

  it.each([
    ['a negated reading', { statement: { negated: true } }],
    ['a duration, not this effect (months)', { statement: { unit: 'months' } }],
  ])('⛔ %s: no working point; the Strengthen press still asks the size, and nothing is written', (_why, patch) => {
    persisted = storedGraph(patch);
    const card = strengthenCardFor({ graph: persisted, analysisState: RUN_STATE, optionParticipation: [] });
    expect(card, JSON.stringify(card)).toMatchObject({ ask_only: true, target: { from_id: FROM, to_id: TO } });
    expect(card?.args.links[0]).not.toHaveProperty('origin');
    expect(rows.size).toBe(0);
  });

  // ⛔ #3346 R1 (BUDDY-A B1, its counterexample): the placeholder already holds the working point's exact mean with another spread.
  // The press could not size it (the writer refuses an unchanged `set`), so no card is offered: the existing size ask stays.
  it('⛔ a placeholder already at the working point\'s exact mean: the honest size ask, no card, no write', async () => {
    const mean = linkWorkingPointOf(persisted, FROM, TO)!.mean;
    persisted = storedGraph({ edge: { strength: { mean, std: 0.0275 } } });
    const before = structuredClone(edgeOf(persisted));
    const card = strengthenCardFor({ graph: persisted, analysisState: RUN_STATE, optionParticipation: [] });
    expect(card, JSON.stringify(card)).toMatchObject({ ask_only: true, target: { from_id: FROM, to_id: TO } });
    expect(card?.args.links[0]).not.toHaveProperty('origin');
    // The host origin asked directly is left out too, so no card the writer cannot honour is ever prepared.
    const p = await capabilities().proposeLinkStrengths!(ctx, { links: [{ from_label: 'Weekly food collection running', to_label: 'Household recycling rate',
      strength: 'weak', origin: 'working_point' }], rationale: 'r' } as never);
    expect(p, JSON.stringify(p)).toMatchObject({ ok: false, refusal: 'origin_unknown' });
    expect(edgeOf(persisted)).toEqual(before);
    expect(rows.size).toBe(0);
  });

  it('⛔ a link the user sized: a working-point request leaves it out as unknown, prepares nothing, and the link is untouched', async () => {
    persisted = storedGraph({ edge: { strength: { mean: 0.2, std: 0.05 }, provenance: { source: 'user_specified' }, defaulted: undefined } });
    const before = structuredClone(edgeOf(persisted));
    const p = await capabilities().proposeLinkStrengths!(ctx, { links: [{ from_label: 'Weekly food collection running', to_label: 'Household recycling rate',
      strength: 'weak', origin: 'working_point' }], rationale: 'r' } as never);
    expect(p, JSON.stringify(p)).toMatchObject({ ok: false, refusal: 'origin_unknown' });
    expect(edgeOf(persisted)).toEqual(before);
    expect(rows.size).toBe(0);
  });

  it('⛔ a stale base: the model changed after the card was prepared, so the press writes nothing', async () => {
    const card = strengthenCardFor({ graph: persisted, analysisState: RUN_STATE, optionParticipation: [] })!;
    const caps = capabilities();
    const p = await caps.proposeLinkStrengths!(ctx, card.args as never);
    expect(p.ok, JSON.stringify(p)).toBe(true);
    const moved = structuredClone(persisted) as Json;
    moved.nodes.find((n: Json) => n.id === TO).goal_threshold = 0.55;
    persisted = moved;
    const before = structuredClone(edgeOf(persisted));
    const out = await caps.authoriseChange(ctx, { proposal_id: String(p.proposal_id) });
    expect(out, JSON.stringify(out)).toMatchObject({ ok: false });
    expect(edgeOf(persisted)).toEqual(before);
    expect(rows.size).toBe(0);
  });
});
