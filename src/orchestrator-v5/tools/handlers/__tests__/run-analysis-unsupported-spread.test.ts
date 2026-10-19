/**
 * ⭐ STEP 8 — A CHANCE RESTING ON OLUMI'S DEFAULT SPREAD AROUND A USER'S SIZE IS NOT SUPPORTED (AIE `point_uncertainty`,
 * prompt/AIE-SPEAKER-CARRIER-AND-UNCERTAINTY-SUPPORT-20261019-v1.json sha256 564fe768…; DL-3 #94 6260306712 as AMENDED; Codex
 * pair e2ce67bb's minimum rows).
 *
 * A user's point gives the size, never the spread. The Run's one chance-support walk (`chanceSupportGoalPaths`, behind
 * `unsizedLeaderGoalPaths`) withholds only the options whose path runs through such a link, with the AIE's exact words, on every
 * chance surface: the stored result, the licence, the card, the typed rows, the reply, and no range re-entry. The size stays the
 * user's; β and σ are unchanged; a named band or explicit spread the ACTUAL chat writer recorded, an exact definition or identity
 * operand, a fixed option level, an off-path link and the status quo keep their chances.
 * PL 06:05: support is read from the carrier that records who stated each number (`magnitude: 'user_stated'` for a size in the
 * user's units, whose writers never state a spread; the chat writer's per-field `std_defaulted` for a strength), never from the
 * std's value or `defaulted`. So the user-sized links below are UNMARKED (no `std_defaulted`), as construction writes them and as
 * every graph saved before this PR holds them: each row is also the reopened / legacy case.
 * Real path: stored bytes → cold snapshot → the real Run handler (PLoT's served body) → the stored fact and its readers. Two brief
 * families: cut-costs (1f9d769) and price/MRR (17d1).
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

import { RunAnalysisResultSchema } from '@talchain/schemas/orchestrator';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { GOAL_FIGURES_PLACEHOLDER_PATH, GOAL_FIGURES_UNSUPPORTED_SPREAD } from '../../../../orchestrator/context/option-result-source.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { goalChanceWithheldForAgent } from '../../../agent-lane/goal-chance-withheld.js';
import { chanceSupportGoalPaths, placeholderGoalWarning, unsizedLeaderGoalPaths, unsupportedSpreadWarning, UNSUPPORTED_POINT_QUESTION, UNSUPPORTED_POINT_WORDS, UNSUPPORTED_RANGE_QUESTION,
  UNSUPPORTED_RANGE_WORDS } from '../../../agent-lane/goal-certainty.js';
import { buildAnalysisResultBlock } from '../../../compose.js';
import { projectCanonicalAnalysisCells } from '../../../../routes/canonical-analysis-view.js';
import { toTypedRunRows } from '../../../runs/typed-run-rows.js';
import { GOAL_CHANCE_LICENSED } from '../../../goal-target/goal-chance-licence.js';
import { GOAL_CHANCE_RANGE, goalChanceRangeOf } from '../../../goal-target/goal-chance-range.js';
import { sizeLink } from '../../../../cee/magnitude/link-effect.js';
import { admitCandidateLinks } from '../../../agent-lane/admit-candidate.js';
import { legacyDoorGraph } from '../../../agent-lane/__tests__/licence-test-graphs.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';
import { buildModelFromBrief } from '../../../agent-lane/runtime/build-model.js';
import { clampForPersist, refitFramesForStatedEffects } from '../../../agent-lane/refit-frames.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import { createAdjustEdgeStrengthHandler } from '../adjust-edge-strength.js';
import { EDGE_STRENGTH_MIDPOINTS, edgeBandStd } from '../../../format/edge-strength-bands.js';
import { linkSizing } from '../../../../cee/magnitude/link-sizing.js';
import { LINK_AUTHORSHIP_MEMBERS } from '../run-input-residual.js';
import { goalChanceLicenceForAgent } from '../../../goal-target/goal-chance-licence.js';
import { goalChanceCellFacesForAgent } from '../../../agent-lane/goal-chance-screen-lines.js';
import { goalChanceSideOf } from '../../../goal-target/goal-chance-sides.js';
import { runChanceHeadline } from '../../../coaching/run-chance-headline.js';
import { limitChecksForAgent } from '../../../agent-lane/limit-checks.js';
import { readLimitVerdictsFromResult } from '../../../../orchestrator/context/constraint-feasibility.js';
import { CONDITION_FIGURES_UNSUPPORTED_SPREAD } from '../../../../orchestrator/context/option-result-source.js';
import { notesAsShown } from '../../../goal-target/goal-targets-joint.js';
import { compactAnalysis } from '../../../../orchestrator/context/analysis-compact.js';
import { buildInvokeInputForTests } from '../../../coaching/decision-review-enricher.js';

type Json = Record<string, any>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ── Family 1: served cut-costs (CEE 1f9d769, scenario 714abc5c), its PLoT body ──────────────────────────────────────────
const CUT = JSON.parse(readFileSync(new URL('./fixtures/served-cut-costs-altB-r0-1f9d769.json', import.meta.url), 'utf8')) as {
  _provenance: { brief_text: string }; graph: Json; plot_body: Json };
const CUT_GRAPH = legacyDoorGraph(CUT.graph) as Json;
const CUT_MOVERS = ['switch_fully_to_gcp', 'phase_50_to_gcp'];
const CUT_SQ = 'remain_on_aws';
// ── Family 2: price/MRR (17d1cd3a), its PLoT body ────────────────────────────────────────────────────────────────────────
const MRR_DIR = 'tests/fixtures/cross-service/b5-per-limit';
const MRR = JSON.parse(readFileSync(`${MRR_DIR}/17d1cd3a.graph.json`, 'utf8')) as { graph: Json; brief_text: string };
const MRR_BODY = JSON.parse(readFileSync(`${MRR_DIR}/17d1cd3a.plot-response.json`, 'utf8')) as Json;
const MRR_OPTIONS = ['keep_current_49_price', 'increase_price_to_59', 'increase_price_to_54'];
/** As run-analysis-goal-certainty.test.ts holds it: the brief's "at least" kept, its target row out of this file's way. */
function mrrGraph(): Json {
  const c = clone(MRR.graph);
  const goals = new Set(c.nodes.filter((n: Json) => n.kind === 'goal').map((n: Json) => n.id));
  for (const n of c.nodes) if (n.kind === 'goal') { delete n.goal_threshold_raw; n.goal_direction = '>='; }
  if (Array.isArray(c.goal_constraints)) c.goal_constraints = c.goal_constraints.filter((r: Json) => !goals.has(r.node_id));
  return c;
}

/** The links every mover's path runs through that nobody sized (the served placeholders). */
const goalPathKeys = (graph: Json, movers: readonly string[]): string[] =>
  [...new Set(unsizedLeaderGoalPaths(graph, movers).flatMap((p) => p.links).map((l) => `${l.from}->${l.to}`))];

/**
 * Those links made the USER's size, as construction writes a stated point: `magnitude: 'user_stated'`, the same strength (β and σ
 * unchanged), and NO `std_defaulted` — unmarked, as construction writes it and as a reopened or legacy graph holds it. `stamped`:
 * the A6f mark as the chat statement writer adds it (`link-effect-edit.ts`). `range`: the user's range held on the link.
 */
function userSized(graph: Json, movers: readonly string[], o: { stamped?: boolean; range?: boolean; only?: number } = {}): Json {
  const g = clone(graph);
  const keys = goalPathKeys(g, movers).slice(0, o.only ?? Infinity);
  for (const e of g.edges as Json[]) {
    if (!keys.includes(`${e.from}->${e.to}`)) continue;
    const { mean_projected: _m, magnitude: _g, ...rest } = e.provenance ?? {};
    e.provenance = { ...rest, source: 'brief_extraction', magnitude: 'user_stated',
      ...(o.range ? { natural_effect: { amount: 2, per_source_change: 1, amount_unit: 'units', per_source_change_unit: 'units', strength_mean: e.strength.mean, strength_mean_frame: 'edge_strength',
        stated_range: { low: 1, high: 3, text: 'between 1 and 3', end: 'centre' } } } : {}) };
    delete e.defaulted;
    delete e.std_defaulted;
    if (o.stamped === true) e.std_defaulted = true;
  }
  return g;
}

/**
 * The same links written by the ACTUAL chat writer (`adjust_edge_strength`) as the user's own strength. `band`: a band the user
 * named (the trusted side band its approval carries, `stated-link-band-context.ts`), so the writer stores the band's spread and
 * records it as theirs; `std`: an explicit spread; `figure`: an exact figure, whose spread the writer records as Olumi's (A6f). Each
 * write moves the strength to a band midpoint (a same-value write is review, not authorship).
 */
async function chatWritten(graph: Json, movers: readonly string[], mode: 'band' | 'std' | 'figure'): Promise<Json> {
  let g = clone(graph);
  for (const key of goalPathKeys(graph, movers)) {
    const [from, to] = key.split('->') as [string, string];
    const edge = (g.edges as Json[]).find((e) => e.from === from && e.to === to)!;
    const band = (['moderate', 'strong'] as const).find((b) => EDGE_STRENGTH_MIDPOINTS[b] !== Math.abs(edge.strength.mean))!;
    const value = (edge.strength.mean < 0 ? -1 : 1) * EDGE_STRENGTH_MIDPOINTS[band];
    const proposal = { handler_id: 'adjust_edge_strength', cited_context_fields: [],
      entity: { id: `${from}→${to}`, kind: 'edge', resolution_status: 'resolved', resolution_method: 'id_match' },
      parameters: [{ name: 'strength', value, operator: 'set', source: 'user_explicit' }, ...(mode === 'std' ? [{ name: 'std', value: 0.07, source: 'user_explicit' }] : [])] };
    const outcome = await createAdjustEdgeStrengthHandler()({
      context: { session_id: 'sp-writer', stage: 'frame', request_id: 'req-sp-w', prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
      payload: { kind: 'message', scenario_id: 'sp-writer', turn_id: '11111111-1111-4111-8111-111111111499', stage: 'frame', message: 'Yes, record that.' },
      requestId: 'req-sp-w', signal: new AbortController().signal, orientationText: '', proposal, graphForTurn: g,
      ...(mode === 'band' ? { edgeStrengthBandAuthority: band } : {}),
    } as unknown as HandlerInvocation);
    g = clone(outcome.mutated_graph) as Json;
  }
  return g;
}
const writtenLinks = (g: Json, of: Json, movers: readonly string[]): Json[] =>
  goalPathKeys(of, movers).map((k) => (g.edges as Json[]).find((e) => `${e.from}->${e.to}` === k)!);

async function run(graph: Json, body: Json, brief: string, scenario: string): Promise<{ result: Json; fact: Json }> {
  const store = { readMostRecentPendingActions: async () => [], loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(graph), briefText: brief })),
    loadGraph: vi.fn(async () => clone(graph)) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(scenario, 'req-sp-load', store as never);
  const plot = vi.fn(async () => clone(body) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({ plotClient: { run: plot, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot) });
  const outcome = await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: scenario,
      request_id: 'req-sp-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-sp', scenario_id: scenario, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'req-sp-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  expect(plot).toHaveBeenCalledTimes(1);
  const fact = outcome.handler_facts[0]! as Json;
  expect(fact.fact_type).toBe('run_analysis');
  expect(RunAnalysisResultSchema.safeParse(fact.result).success).toBe(true);
  return { result: fact.result as Json, fact };
}
const cutRun = (g: Json) => run(g, CUT.plot_body, CUT._provenance.brief_text, '714abc5c-4e82-4436-9454-eec6c8f68589');
const mrrRun = (g: Json) => run(g, MRR_BODY, MRR.brief_text, 'a295e4a1-97b5-46c8-987a-513232e5dba4');

const envOf = (r: Json): Json => r.enrichment ?? r;
const warningsOf = (r: Json): Json[] => [...(envOf(r).inference_warnings ?? []), ...(r.inference_warnings ?? [])];
const coded = (r: Json, code: string): Json[] => warningsOf(r).filter((w) => w?.code === code);
function entriesFor(env: Json, id: string): Json[] {
  const carriers = [env.option_comparison, env.results, env.results?.option_comparison, env.results?.options, env.decision_brief?.options];
  return carriers.flatMap((c) => (Array.isArray(c) ? c : [])).filter((e: Json) => e?.option_id === id || e?.id === id);
}
const chanceShown = (r: Json, id: string): boolean => entriesFor(envOf(r), id).some((e) => typeof e.probability_of_goal === 'number');

/** Every chance surface for the withheld options: none shows a chance; the AIE's words are said, once, where words go. */
function expectWithheldEverywhere(r: Json, fact: Json, graph: Json, withheld: readonly string[], words: string, question: string): void {
  for (const id of withheld) expect(chanceShown(r, id), `${id}: no chance in any result carrier`).toBe(false);
  const [w, ...more] = coded(r, GOAL_FIGURES_UNSUPPORTED_SPREAD);
  expect(more).toEqual([]);
  expect([...w!.option_ids].sort()).toEqual([...withheld].sort());
  expect(w!.message).toContain(`${words} ${question}`);
  expect(w!.message.split(words).length - 1, 'said once').toBe(1);
  expect(w).not.toHaveProperty('acceptable_links');
  expect(w).not.toHaveProperty('first_ask');
  const licence = coded(r, GOAL_CHANCE_LICENSED)[0];
  for (const id of withheld) expect(licence?.pct_by_option?.[id], `${id}: not licensed`).toBeUndefined();
  expect(coded(r, GOAL_CHANCE_RANGE).filter((x) => withheld.some((id) => x.option_ids?.includes(id) || x.option_id === id))).toEqual([]);
  const block = buildAnalysisResultBlock(fact as never);
  const cells = projectCanonicalAnalysisCells(block as never, graph);
  for (const id of withheld) {
    const cell = cells.find((c) => c.option_id === id)?.cell as Json | undefined;
    expect(cell?.kind, `${id}: card`).not.toMatch(/^(point|range)$/);
    expect(JSON.stringify(cell)).toContain(words);
  }
  const typed = toTypedRunRows(fact as never, { scenarioId: fact.result.scenario_id }) as Json;
  for (const id of withheld) expect(JSON.stringify(typed.rows?.filter?.((row: Json) => row.option_id === id && typeof row.probability_of_goal === 'number') ?? [])).toBe('[]');
  const reply = goalChanceWithheldForAgent(block, graph);
  expect(reply?.withheld).toBe(true);
  expect(reply!.say).toContain(words);
  expect(reply!.say).toContain(question);
}

const CUT_BANDED = await chatWritten(CUT_GRAPH, CUT_MOVERS, 'band');

describe('PREMISE (chat-band controls on links NOBODY had sized, so no physical size is traded): the band the user named, attested at its writer, keeps every chance', () => {
  it('cut-costs: the placeholders withhold today; the user\'s named band, written by the writer on the same links, shows every chance', async () => {
    expect(coded((await cutRun(CUT_GRAPH)).result, GOAL_FIGURES_PLACEHOLDER_PATH)).not.toEqual([]);
    for (const e of writtenLinks(CUT_BANDED, CUT_GRAPH, CUT_MOVERS)) {
      expect(linkSizing(e), 'the user\'s strength').toBe('user');
      expect(e.std_defaulted, 'the writer ATTESTS the spread as theirs (AIE 764e9c72)').toBe(false);
      expect([edgeBandStd('moderate'), edgeBandStd('strong')]).toContain(e.strength.std);
    }
    const { result } = await cutRun(CUT_BANDED);
    expect(coded(result, GOAL_FIGURES_UNSUPPORTED_SPREAD)).toEqual([]);
    for (const id of [...CUT_MOVERS, CUT_SQ]) expect(chanceShown(result, id), id).toBe(true);
  });
  it('cut-costs: an explicit `std` reaching the writer carries no verified user origin, so it is NOT attested and is withheld', async () => {
    const g = await chatWritten(CUT_GRAPH, CUT_MOVERS, 'std');
    for (const e of writtenLinks(g, CUT_GRAPH, CUT_MOVERS)) {
      expect(e).toMatchObject({ strength: { std: 0.07 } });
      expect(e).not.toHaveProperty('std_defaulted');
    }
    const { result, fact } = await cutRun(g);
    expectWithheldEverywhere(result, fact, g, CUT_MOVERS, UNSUPPORTED_POINT_WORDS, UNSUPPORTED_POINT_QUESTION);
  });
  it('price/MRR: the named-band control on the second family', async () => {
    const { result } = await mrrRun(await chatWritten(mrrGraph(), MRR_OPTIONS, 'band'));
    expect(coded(result, GOAL_FIGURES_UNSUPPORTED_SPREAD)).toEqual([]);
    expect(MRR_OPTIONS.filter((id) => chanceShown(result, id)).length).toBeGreaterThan(1);
  });
});

describe('THE WRITER\'S ATTESTATION IS THE ONLY SUPPORT: an exact figure, and a band saved before the attestation, stay withheld', () => {
  it('cut-costs: an exact figure through the writer (std_defaulted, A6f) is withheld on every surface with the point words', async () => {
    const g = await chatWritten(CUT_GRAPH, CUT_MOVERS, 'figure');
    for (const e of writtenLinks(g, CUT_GRAPH, CUT_MOVERS)) expect(e).toMatchObject({ std_defaulted: true, provenance: { source: 'user_specified' } });
    const { result, fact } = await cutRun(g);
    expectWithheldEverywhere(result, fact, g, CUT_MOVERS, UNSUPPORTED_POINT_WORDS, UNSUPPORTED_POINT_QUESTION);
  });
  it('LEGACY: a band written before the attestation (no flag) is byte-identical in authorship to a pre-A6f exact figure, so absent is NOT support: withheld (AIE 764e9c72)', async () => {
    const legacy = clone(CUT_BANDED);
    for (const e of writtenLinks(legacy, CUT_GRAPH, CUT_MOVERS)) delete e.std_defaulted;
    const { result, fact } = await cutRun(legacy);
    expectWithheldEverywhere(result, fact, legacy, CUT_MOVERS, UNSUPPORTED_POINT_WORDS, UNSUPPORTED_POINT_QUESTION);
  });
  it('a named-band write and an exact write differ in who-authored-what ONLY by the writer\'s record: attested (false) against Olumi\'s (true)', async () => {
    const figure = await chatWritten(CUT_GRAPH, CUT_MOVERS, 'figure');
    const authorship = (e: Json): Json => Object.fromEntries(LINK_AUTHORSHIP_MEMBERS.filter((k) => k !== 'std_defaulted' && k in e)
      .map((k) => [k, k === 'provenance' ? { ...e.provenance, reviewed_by_user: undefined } : e[k]]));
    const banded = writtenLinks(CUT_BANDED, CUT_GRAPH, CUT_MOVERS);
    writtenLinks(figure, CUT_GRAPH, CUT_MOVERS).forEach((e, i) => {
      expect(authorship(e)).toEqual(authorship(banded[i]!));
      expect([e.std_defaulted, banded[i]!.std_defaulted]).toEqual([true, false]);
    });
  });
});

describe('⭐ RED→GREEN: a user\'s POINT on the default spread withholds only the dependent chances, on every surface', () => {
  it('cut-costs, UNMARKED (reopened / legacy): the movers are withheld with the AIE\'s point words; the status quo keeps its chance; β/σ unchanged', async () => {
    const g = userSized(CUT_GRAPH, CUT_MOVERS);
    const keys = goalPathKeys(CUT_GRAPH, CUT_MOVERS);
    const users = (g.edges as Json[]).filter((e) => keys.includes(`${e.from}->${e.to}`));
    for (const e of users) expect(e, 'no A6f mark: the graph a reopen or a legacy save holds').not.toHaveProperty('std_defaulted');
    // The mark changes nothing: the size's own carrier decides.
    expect(chanceSupportGoalPaths(g, CUT_MOVERS).unsupportedSpread).toEqual(chanceSupportGoalPaths(userSized(CUT_GRAPH, CUT_MOVERS, { stamped: true }), CUT_MOVERS).unsupportedSpread);
    const { result, fact } = await cutRun(g);
    expectWithheldEverywhere(result, fact, g, CUT_MOVERS, UNSUPPORTED_POINT_WORDS, UNSUPPORTED_POINT_QUESTION);
    expect(chanceShown(result, CUT_SQ)).toBe(true);
    expect(coded(result, GOAL_FIGURES_PLACEHOLDER_PATH)).toEqual([]);
    // A share of runs drawn on the same unsupported spread has no warrant of its own and never stands in for the chance (AIE
    // cc9fbadf): every option's share goes (a share compares with every other option), and with it the leader.
    for (const id of [CUT_SQ, ...CUT_MOVERS]) expect(entriesFor(envOf(result), id).some((e) => typeof e.win_probability === 'number'), id).toBe(false);
    expect(coded(result, GOAL_FIGURES_UNSUPPORTED_SPREAD)[0]!.withheld_claims).toEqual(['goal_probability', 'joint_probability', 'downside', 'win_share']);
    // The outcome distribution is no chance of meeting the goal either, and the qualitative help (the structural challenge) reads it.
    for (const id of CUT_MOVERS) expect(entriesFor(envOf(result), id).some((e) => typeof e.outcome?.mean === 'number'), `${id}: outcome kept`).toBe(true);
    for (const e of users) {
      expect(e.provenance.magnitude, 'the size stays the user\'s').toBe('user_stated');
      const was = (CUT_GRAPH.edges as Json[]).find((x) => x.from === e.from && x.to === e.to)!;
      expect(e.strength).toEqual(was.strength);
    }
  });
  it('⭐ INTERVALS (AIE 764e9c72): the saved Run keeps every engine figure; no public block, AI fact or review carries the movers\' range', async () => {
    const g = userSized(CUT_GRAPH, CUT_MOVERS);
    const { result, fact } = await cutRun(g);
    const range = (e: Json): boolean => ['std', 'p10', 'p90'].some((k) => typeof e.outcome?.[k] === 'number');
    // PREMISE: the served body has a range for every option, and the saved Run keeps it (history untouched).
    for (const id of [CUT_SQ, ...CUT_MOVERS]) expect(entriesFor(envOf(result), id).some(range), `${id}: saved range`).toBe(true);
    // The public block (turn and cold read): the movers keep their centre, never their range; the status quo keeps both.
    const block = buildAnalysisResultBlock(fact as never) as Json;
    for (const id of CUT_MOVERS) {
      expect(entriesFor(block.enrichment, id).some(range), `${id}: block range`).toBe(false);
      expect(entriesFor(block.enrichment, id).some((e) => typeof e.outcome?.mean === 'number'), `${id}: block centre`).toBe(true);
    }
    expect(entriesFor(block.enrichment, CUT_SQ).some(range), 'status quo range').toBe(true);
    // The AI's facts: no range for a mover, so no uncertainty band either (all-or-nothing).
    const compact = compactAnalysis(envOf(result) as never) as Json;
    for (const o of (compact.options as Json[]).filter((x) => CUT_MOVERS.includes(x.option_id))) {
      expect(o).not.toHaveProperty('outcome_p10');
      expect(o).not.toHaveProperty('outcome_p90');
    }
    expect(compact.uncertainty_bands ?? null).toBeNull();
    // The decision review's AI gets no input at all: with every share withheld there is no result to review.
    expect(buildInvokeInputForTests('brief', envOf(result) as Json, null)).toBeNull();
  });
  it('price/MRR, UNMARKED: the same on the second family; the options that move nothing keep theirs', async () => {
    const before = await mrrRun(await chatWritten(mrrGraph(), MRR_OPTIONS, 'band'));
    const shownBefore = MRR_OPTIONS.filter((id) => chanceShown(before.result, id));
    const g = userSized(mrrGraph(), MRR_OPTIONS);
    const withheld = chanceSupportGoalPaths(g, MRR_OPTIONS).unsupportedSpread.map((p) => p.option_id);
    expect(withheld.length).toBeGreaterThan(0);
    const { result, fact } = await mrrRun(g);
    expectWithheldEverywhere(result, fact, g, withheld, UNSUPPORTED_POINT_WORDS, UNSUPPORTED_POINT_QUESTION);
    for (const id of shownBefore.filter((x) => !withheld.includes(x))) expect(chanceShown(result, id), id).toBe(true);
  });
});

describe('a user RANGE (or bound) on the default spread is not a supported distribution either (Science C1)', () => {
  it('cut-costs, UNMARKED: withheld with the AIE\'s range words and its question; the range is kept; no point words', async () => {
    const g = userSized(CUT_GRAPH, CUT_MOVERS, { range: true });
    const { result, fact } = await cutRun(g);
    expectWithheldEverywhere(result, fact, g, CUT_MOVERS, UNSUPPORTED_RANGE_WORDS, UNSUPPORTED_RANGE_QUESTION);
    expect(coded(result, GOAL_FIGURES_UNSUPPORTED_SPREAD)[0]!.message).not.toContain(UNSUPPORTED_POINT_WORDS);
    for (const e of (g.edges as Json[]).filter((x) => x.provenance?.magnitude === 'user_stated')) expect(e.provenance.natural_effect.stated_range).toMatchObject({ low: 1, high: 3 });
  });
});

describe('MIXED PATH: a placeholder beside a user point cannot bring the chance back as a range (Codex probe :130)', () => {
  it('cut-costs, UNMARKED: one link the user\'s on the default spread, the other unsized: both causes withhold, and no range re-enters', async () => {
    const g = userSized(CUT_GRAPH, CUT_MOVERS, { only: 1 });
    const support = chanceSupportGoalPaths(g, CUT_MOVERS);
    expect(support.unsized.length).toBeGreaterThan(0);
    expect(support.unsupportedSpread.length).toBeGreaterThan(0);
    const { result } = await cutRun(g);
    for (const id of CUT_MOVERS) expect(chanceShown(result, id), id).toBe(false);
    expect(coded(result, GOAL_FIGURES_UNSUPPORTED_SPREAD)).not.toEqual([]);
    expect(coded(result, GOAL_CHANCE_RANGE)).toEqual([]);
  });
});

describe('SCOPE: exact links, fixed option levels, off-path links and the status quo are never named', () => {
  it('a user size on the default spread off every mover\'s path names nothing', () => {
    const g = clone(CUT_BANDED);
    const off = (g.edges as Json[]).find((e) => e.from === 'gcp_unit_cost_discount')!;
    off.provenance = { ...off.provenance, magnitude: 'user_stated' };
    expect(chanceSupportGoalPaths(g, [CUT_SQ, ...CUT_MOVERS]).unsupportedSpread
      .flatMap((p) => p.links).some((l) => l.from === 'gcp_unit_cost_discount')).toBe(false);
  });
  it('a FIXED conditional input — each option\'s own set level and its link to what it sets, even made the user\'s — is never named', () => {
    const g = clone(CUT_BANDED);
    for (const e of (g.edges as Json[]).filter((x) => [CUT_SQ, ...CUT_MOVERS].includes(x.from))) {
      e.provenance = { source: 'brief_extraction', magnitude: 'user_stated' };
      e.std_defaulted = true;
    }
    expect(chanceSupportGoalPaths(g, [CUT_SQ, ...CUT_MOVERS]).unsupportedSpread).toEqual([]);
  });
  it('the status quo moves nothing, so no path of its own is named', () => {
    const g = userSized(CUT_GRAPH, CUT_MOVERS);
    expect(chanceSupportGoalPaths(g, [CUT_SQ, ...CUT_MOVERS]).unsupportedSpread.map((p) => p.option_id)).not.toContain(CUT_SQ);
  });
  /** A part of the goal's own quantity, user-sized on the default spread, with its link into the goal shaped by `into`. */
  function withPart(into: (unit: string) => Json, goalIdentity?: Json): { g: Json; part: string; goal: string } {
    const g = clone(CUT_BANDED);
    const goal = (g.nodes as Json[]).find((n) => n.kind === 'goal')!;
    const unit = goal.observed_state?.unit as string;
    expect(typeof unit, 'the goal states its level unit').toBe('string');
    g.nodes.push({ id: 'gcp_spend_part', kind: 'factor', label: 'Monthly cloud spend on GCP', observed_state: { value: 0, raw_value: 0, unit } });
    if (goalIdentity !== undefined) goal.nonlinear_identity = goalIdentity;
    g.edges.push({ from: 'gcp_workload_share', to: 'gcp_spend_part', strength: { mean: 0.5, std: 0.25 }, exists_probability: 0.8,
      provenance: { source: 'brief_extraction', magnitude: 'user_stated' } },
    { from: 'gcp_spend_part', to: goal.id, strength: { mean: 1, std: 0.5 }, exists_probability: 0.8, ...into(unit) });
    return { g, part: 'gcp_spend_part', goal: goal.id };
  }
  const definition = (unit: string, strengthMean = 1): Json => ({ provenance: { source: 'brief_extraction', magnitude: 'user_stated', definitional: true,
    natural_effect: { amount: 1, per_source_change: 1, amount_unit: unit, per_source_change_unit: unit, strength_mean: strengthMean, strength_mean_frame: 'edge_strength' } } });
  const named = (g: Json): Json[] => chanceSupportGoalPaths(g, CUT_MOVERS).unsupportedSpread.flatMap((p) => p.links);
  it('a VALIDATED definition into its total (exact on the Run input) is never named, whoever sized it; the link into its part is', () => {
    const { g, part, goal } = withPart((u) => definition(u));
    expect(named(g)).toContainEqual({ from: 'gcp_workload_share', to: part });
    expect(named(g)).not.toContainEqual({ from: part, to: goal });
  });
  it('a definitional FLAG that does not validate (stale size) is no exemption: its spread stays the default, so it is named', () => {
    const { g, part, goal } = withPart((u) => definition(u, 0.4));
    expect(named(g)).toContainEqual({ from: part, to: goal });
  });
  it('an operand of the goal\'s stated identity draws no spread, so it is never named; the same link with no identity is', () => {
    const plain = (): Json => ({ provenance: { source: 'brief_extraction', magnitude: 'user_stated' } });
    const stated = withPart(plain, { operation: 'sum', factor_ids: ['gcp_spend_part', 'monthly_gcp_cost_saving'], stated_in_brief: true });
    expect(named(stated.g)).not.toContainEqual({ from: stated.part, to: stated.goal });
    const bare = withPart(plain);
    expect(named(bare.g)).toContainEqual({ from: bare.part, to: bare.goal });
  });
});

describe('RANGE RE-ENTRY (Codex probe :130, reproduced on the range producer): a placeholder range never rests on a user point\'s default spread', () => {
  const src = { label: 'Extra packers', kind: 'factor', scale_frame: 10, observed_state: { value: 0, raw_value: 0, unit: 'packers' }, option_levels: [0, 0.1] };
  const tgt = { label: 'Output', kind: 'goal', scale_frame: 1000, observed_state: { value: 0.5, raw_value: 500, unit: 'packs' }, option_levels: [] };
  function probe(): { g: Json; envelope: (spread: boolean) => Json; inputs: Json } {
    const sizing = sizeLink({ direction: 'positive', effect_amount: 20, effect_per_source_change: 1, user_stated: true }, src as never, tgt as never);
    const point = admitCandidateLinks([{ from: 'x', to: 'm', direction: 'positive', provenance: 'explicit' } as never], new Map([['x::m', sizing]])).edges[0] as Json;
    expect(point.provenance.magnitude, 'construction: the user\'s size').toBe('user_stated');
    expect(point, 'construction writes no A6f mark: the unmarked case').not.toHaveProperty('std_defaulted');
    const g: Json = { nodes: [
      { id: 'x', ...src },
      { id: 'g', ...tgt, goal_direction: '>=', goal_threshold: 0.6, goal_threshold_raw: 600, goal_threshold_cap: 1000, goal_threshold_unit: 'packs',
        goal_threshold_frame: 'level', observed_state: { ...tgt.observed_state, baseline: 0.5 } },
      { id: 'm', kind: 'factor', label: 'Intermediate output', scale_frame: 1000, observed_state: { value: 0.5, baseline: 0.5, raw_value: 500, cap: 1000, unit: 'packs', source: 'user_override' } },
      { id: 'a', kind: 'option', label: 'Add one packer', interventions: { x: 0.1 } },
      { id: 'sq', kind: 'option', label: 'Keep staffing', interventions: { x: 0 } },
    ], edges: [point, { from: 'a', to: 'x', strength: { mean: 1, std: 0.01 } }, { from: 'sq', to: 'x', strength: { mean: 1, std: 0.01 } },
      { from: 'm', to: 'g', strength: { mean: 0.5, std: 0.25 }, provenance: { magnitude: 'olumi_placeholder' } }], goal_constraints: [] };
    const support = chanceSupportGoalPaths(g, ['a']);
    expect(support.unsized).toEqual([{ option_id: 'a', links: [{ from: 'm', to: 'g' }] }]);
    expect(support.unsupportedSpread).toEqual([{ option_id: 'a', links: [{ from: 'x', to: 'm' }] }]);
    const envelope = (spread: boolean): Json => ({ option_comparison: [{ option_id: 'a' }], inference_warnings: [
      placeholderGoalWarning(g, support.unsized, GOAL_FIGURES_PLACEHOLDER_PATH), ...(spread ? [unsupportedSpreadWarning(g, support.unsupportedSpread)] : [])] });
    const drivers = { drivers: [{ kind: 'link_strength', quantity_id: 'm->g', from: 'm', to: 'g', status: 'resolved', spread: 0.4,
      p_goal_if_low: 0.234, p_goal_if_high: 0.876, n_low: 4000, n_high: 40 }] };
    return { g, envelope, inputs: { driversByOption: new Map([['a', drivers]]), goalPaths: support.unsized, plotWithheld: false, goalId: 'g' } };
  }
  it('the placeholder alone may carry its range (#87 PR-S1, unchanged) — the positive control', () => {
    const { g, envelope, inputs } = probe();
    expect(goalChanceRangeOf(envelope(false), g, 'a', inputs as never)).toMatchObject({ low_pct: 23, high_pct: 90, from: 'm', to: 'g' });
  });
  it('⭐ RED→GREEN: with the user point on the same path, the Run\'s spread withhold bars that range', () => {
    const { g, envelope, inputs } = probe();
    expect(goalChanceRangeOf(envelope(true), g, 'a', inputs as never)).toBeNull();
  });
});

describe('PROVENANCE: construction\'s UNMARKED stated point is named through save, cold reopen, refit and clamp', () => {
  const BRIEF = 'We are comparing two crewing options, labelled exactly "Keep current crew" and "Add one packer". Use the exact goal '
    + 'label "Daily order throughput". Our current crew ships 50 orders per day. We need at least 70 orders per day. Keep current '
    + 'crew adds no packer. Add one packer adds one packer. Each packer adds 15 orders per day.';
  const draft = { goal: { metric: 'Daily order throughput', operator: '>=', target_stated: true, value: 70, unit: 'orders per day', horizon_months: null,
    provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 50, baseline_provenance: 'explicit', scope: null },
    constraints: [], options: [{ label: 'Keep current crew', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
      { label: 'Add one packer', provenance: 'explicit', changes: [], is_status_quo: null,
        interventions: [{ factor_label: 'Additional packers', value: 1, value_kind: 'absolute', unit: 'packers', provenance: 'explicit' }] }],
    factors: [{ label: 'Additional packers', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'packers', provenance: 'inferred', plausible_max: 5 }],
    risks: [], outcomes: [], identities: [], unknowns: [], decision_question: null,
    links: [{ from: 'Additional packers', to: 'Daily order throughput', direction: 'positive', provenance: 'explicit', effect_amount: 15,
      effect_per_source_change: 1, effect_provenance: 'explicit', definitional: null, basis: null, source_quote: 'Each packer adds 15 orders per day.' }] };
  it('the user\'s 15 per packer is theirs (user_stated), carries no mark, and is named at save → cold snapshot → refit → clamp', async () => {
    let saved: Json | undefined;
    const out = await buildModelFromBrief('5e8e8e8e-0000-4000-8000-0000000000f2', BRIEF, (async (path: string, body: Json) => {
      if (path.endsWith('/graph/register')) { saved = clone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
      return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
    }) as never, (async () => ({ text: JSON.stringify(draft) })) as never) as Json;
    expect(out.ok).toBe(true);
    const link = (g: Json): Json => (g.edges as Json[]).find((e) => e.from === 'additional_packers' && e.to === 'daily_order_throughput')!;
    expect(link(saved!)).toMatchObject({ provenance: { magnitude: 'user_stated' } });
    expect(link(saved!), 'construction writes no A6f mark').not.toHaveProperty('std_defaulted');
    const named = [{ option_id: 'add_one_packer', links: [{ from: 'additional_packers', to: 'daily_order_throughput' }] }];
    expect(chanceSupportGoalPaths(saved!, ['add_one_packer']).unsupportedSpread).toEqual(named);
    const store = { readMostRecentPendingActions: async () => [], loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(saved!), briefText: BRIEF })),
      loadGraph: vi.fn(async () => clone(saved!)) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis('5e8e8e8e-0000-4000-8000-0000000000f2', 'req-sp-prov', store as never) as Json;
    expect(chanceSupportGoalPaths(snapshot.graph, ['add_one_packer']).unsupportedSpread).toEqual(named);
    const refit = clampForPersist(refitFramesForStatedEffects(clone(saved!)).graph) as Json;
    expect(link(refit)).toMatchObject({ provenance: { magnitude: 'user_stated' } });
    expect(chanceSupportGoalPaths(refit, ['add_one_packer']).unsupportedSpread).toEqual(named);
  });
});

describe('⭐ SECOND TARGET AND LIMIT (Codex R1 #3443 BLOCK; DL-3: targets AND limits): the same support decision, per condition', () => {
  // Codex's case, on the several-targets harness of `last-check-reproductions.test.ts` (r2): goal ‘Quality’ (primary target),
  // ‘Reach’ (second target) and ‘Cost’ (a limit). Each plan moves ‘Effort’ and ‘Audience’; ‘Effort’ → ‘Quality’ is a validated
  // definition (exact on the Run input), and ‘Audience’ → ‘Reach’ is the user's 0.3 with no stated spread. Real snapshot loader
  // and real Run handler; PLoT's body is local transport.
  const jsid = 'acdca123-4567-4000-8000-1234567893a1';
  const precision = { n_informative: 10000, standard_error: 0.005 };
  const FIXTURE = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-minimal.json', 'utf8')) as Json;
  const userPoint = (): Json => ({ source: 'user_specified', magnitude: 'user_stated', natural_effect: { amount: 0.3, amount_unit: '%',
    per_source_change: 1, per_source_change_unit: '%', strength_mean: 0.3, strength_mean_frame: 'edge_strength' } });
  /**
   * A genuinely supported input for the second target, with no physical size traded away (AIE cc9fbadf): ‘Audience’ becomes the
   * part of ‘Reach’ the user defined it as, one for one in %, a VALIDATED definition that the Run draws exactly.
   */
  const exactPart = (g: Json): void => {
    g.nodes.find((n: Json) => n.id === 'y').label = 'Reach contribution';
    Object.assign(g.edges.find((e: Json) => e.from === 'y' && e.to === 'other'), { strength: { mean: 1, std: 0.5 },
      provenance: { source: 'brief_extraction', magnitude: 'user_stated', definitional: true, natural_effect: { amount: 1, per_source_change: 1,
        amount_unit: '%', per_source_change_unit: '%', strength_mean: 1, strength_mean_frame: 'edge_strength' } } });
  };
  function jointGraph(o: { limitVia?: 'x' | 'y'; optionsSetLimit?: boolean; planC?: boolean } = {}): Json {
    // Codex's probe names the definition's part as part of the total (`Quality contribution`), so the definition validates.
    const names: Record<string, string> = { g: 'Quality', other: 'Reach', limit: 'Cost', x: 'Quality contribution', y: 'Audience' };
    const nodes: Json[] = Object.entries(names).map(([id, label]) => ({ id, label, kind: id === 'g' ? 'goal' : 'factor',
      observed_state: { value: 0.2, baseline: 0.2, raw_value: 20, cap: 100, unit: '%', source: 'user_override' } }));
    Object.assign(nodes[0]!, { goal_threshold_frame: 'level', goal_threshold_raw: 70, goal_threshold_cap: 100, goal_threshold: 0.7,
      goal_threshold_unit: '%', goal_direction: '>=', goal_target_basis: { quantity_frame: 'level', target_frame: 'level', target_raw: 70,
        reference: 'today', period_months: 3, period_kind: 'at_end', effect_unit: 'percentage points at month three', effects_at_period_end: true,
        source: 'olumi_reading' } });
    const set = ['x', 'y', ...(o.optionsSetLimit !== false ? ['limit'] : [])];
    for (const id of ['a', 'b']) nodes.push({ id, kind: 'option', label: `Plan ${id}`, interventions: Object.fromEntries(set
      .map((n) => [n, { value: id === 'a' ? 0.6 : 0.7, raw_value: id === 'a' ? 60 : 70, unit: '%', source: 'user_specified' }])) });
    // Plan c moves only ‘Quality contribution’: nothing it does reaches ‘Reach’ through the user's point.
    if (o.planC === true) nodes.push({ id: 'c', kind: 'option', label: 'Plan c', interventions: { x: { value: 0.8, raw_value: 80, unit: '%', source: 'user_specified' },
      ...(o.optionsSetLimit !== false ? { limit: { value: 0.8, raw_value: 80, unit: '%', source: 'user_specified' } } : {}) } });
    nodes.push({ id: 'd', kind: 'decision', label: 'Which plan?' });
    const link = (from: string, to: string, provenance: Json): Json => ({ from, to, strength: { mean: 0.3, std: 0.15 }, exists_probability: 1,
      effect_direction: 'positive', provenance });
    const edges = [...[['d', 'a'], ['d', 'b'], ...['a', 'b'].flatMap((opt) => set.map((n) => [opt, n])),
      ...(o.planC === true ? [['d', 'c'], ['c', 'x'], ...(o.optionsSetLimit !== false ? [['c', 'limit']] : [])] : [])]
      .map(([from, to]) => ({ from, to, strength: { mean: 1, std: 0.01 }, exists_probability: 1, effect_direction: 'positive', provenance: { source: 'user_specified' } })),
    { from: 'x', to: 'g', strength: { mean: 1, std: 0.5 }, exists_probability: 1, effect_direction: 'positive',
      provenance: { source: 'brief_extraction', magnitude: 'user_stated', definitional: true, natural_effect: { amount: 1, per_source_change: 1,
        amount_unit: '%', per_source_change_unit: '%', strength_mean: 1, strength_mean_frame: 'edge_strength' } } },
    link('y', 'other', userPoint()), ...(o.limitVia !== undefined ? [link(o.limitVia, 'limit', userPoint())] : [])];
    return { nodes, edges, goal_constraints: [
      { constraint_id: 'primary', node_id: 'g', operator: '>=', value: 70, unit: '%', value_frame: 'level', role: 'goal_target' },
      { constraint_id: 'secondary', node_id: 'other', operator: '>=', value: 50, unit: '%', value_frame: 'level', role: 'goal_target' },
      { constraint_id: 'budget', node_id: 'limit', operator: '<=', value: 80, unit: '%', value_frame: 'level' },
    ] };
  }
  const rows = (req: Json): Json[] => (req.options as Json[]).map((opt, i) => ({ option_id: opt.id, probability_of_goal: 0.41 + i * 0.1,
    probability_of_goal_precision: precision, probability_of_joint_goal: 0.21 + i * 0.1, probability_of_joint_goal_precision: precision,
    constraint_probabilities: Object.fromEntries(((req.goal_constraints ?? []) as Json[]).map((c) => [c.constraint_id,
      c.node_id === 'g' ? 0.41 + i * 0.1 : c.node_id === 'other' ? 0.51 + i * 0.1 : 0.8])),
    constraint_probabilities_precision: Object.fromEntries(((req.goal_constraints ?? []) as Json[]).map((c) => [c.constraint_id, precision])),
    outcome: { mean: 82, std: 4, p10: 77, p50: 82, p90: 90 } }));
  async function runJoint(g: Json): Promise<{ result: Json; analysis: Json; licence: Json }> {
    const bytes = JSON.stringify(g);
    const snapshot = await loadScenarioSnapshotForRunAnalysis(jsid, 'req-sp-joint', {
      loadGraphAndBriefText: async () => ({ graph: JSON.parse(bytes), briefText: null, revision: 3 }), readMostRecentPendingActions: async () => [],
    } as never);
    const handler = createRunAnalysisHandler({ scenarioReader: async () => snapshot, plotClient: {
      run: async (req: Json) => ({ ...clone(FIXTURE), option_comparison: rows(req) }), validatePatch: async () => {},
    } } as never);
    const outcome = await handler({ payload: { scenario_id: jsid, turn_id: 'sp-joint' }, requestId: 'req-sp-joint', signal: new AbortController().signal,
      context: {}, orientationText: '' } as never) as Json;
    const result = outcome.handler_facts?.[0]?.result as Json;
    expect(RunAnalysisResultSchema.safeParse(result).success).toBe(true);
    const analysis = { type: 'analysis_result', enrichment: result.enrichment, computed_against_hash: result.graph_hash_at_run };
    return { result, analysis, licence: goalChanceLicenceForAgent(analysis) as Json };
  }
  const perTarget = (l: Json, id: string): Json => (l.targets.per_target as Json[]).find((t) => t.constraint_id === id)?.pct_by_option ?? {};
  /** What a surface shows of the block's notes (`notesAsShown`: a grouped cause is said as its one line). */
  const says = (l: Json): string => notesAsShown(l.targets.notes ?? [], l.targets.note_groups).join(' ');
  const spreadRecords = (r: Json): Json[] => warningsOf(r).filter((w) => w?.code === CONDITION_FIGURES_UNSUPPORTED_SPREAD);

  it('POSITIVE CONTROL: with the second target\'s part a validated definition (exact), both targets and the joint are licensed', async () => {
    const g = jointGraph();
    exactPart(g);
    const { result, licence } = await runJoint(g);
    expect(spreadRecords(result)).toEqual([]);
    expect(perTarget(licence, 'primary')).toEqual({ a: 41, b: 51 });
    expect(perTarget(licence, 'secondary')).toEqual({ a: 51, b: 61 });
    expect(licence.targets.joint).toMatchObject({ status: 'licensed', pct_by_option: { a: 21, b: 31 } });
  });

  it('⭐ RED→GREEN: the user\'s point with no stated spread feeding only the second target withholds its chance and the joint on every surface; the primary 41%/51% stands', async () => {
    const g = jointGraph();
    const { result, analysis, licence } = await runJoint(g);
    // The primary goal's chance rests on an exact definition: untouched (no goal-figures withhold at all).
    expect(coded(result, GOAL_FIGURES_UNSUPPORTED_SPREAD)).toEqual([]);
    expect(perTarget(licence, 'primary')).toEqual({ a: 41, b: 51 });
    // The second target and the joint: withheld for both plans, said once in the AIE's words with the link named.
    expect(perTarget(licence, 'secondary')).toEqual({});
    expect(licence.targets.joint.status).toBe('withheld');
    const [record, ...more] = spreadRecords(result);
    expect(more).toEqual([]);
    expect(record).toMatchObject({ constraint_ids: ['secondary'], option_ids: ['a', 'b'], links: [{ from: 'y', to: 'other' }] });
    expect(record.message).toBe(`On the link from ‘Audience’ to ‘Reach’: ${UNSUPPORTED_POINT_WORDS} ${UNSUPPORTED_POINT_QUESTION}`);
    expect(says(licence)).toContain(record.message);
    expect(says(licence).split(UNSUPPORTED_POINT_WORDS).length - 1, 'said once').toBe(1);
    // No surface quotes the withheld second target or joint: Agent licence, card faces, compare, coaching.
    expect(Object.values(licence.pct_by_option ?? {})).not.toContain(21);
    const faces = [...goalChanceCellFacesForAgent(analysis, g, true).values()].join(' ');
    for (const pct of ['21%', '31%', '51%', '61%']) expect(faces).not.toContain(pct);
    for (const id of ['a', 'b']) expect(goalChanceSideOf(result, id)).not.toMatchObject({ kind: 'point', pct: id === 'a' ? 21 : 31 });
    expect(runChanceHeadline(result, g) ?? '').not.toMatch(/21%|31%/);
    // The engine's own figures are kept for nothing else: the stored rows lose exactly the second target's P and the joint.
    for (const row of envOf(result).option_comparison as Json[]) {
      expect(row.constraint_probabilities).not.toHaveProperty('secondary');
      expect(row).not.toHaveProperty('probability_of_joint_goal');
      expect(row.probability_of_goal).toBeTypeOf('number');
    }
    // The per-condition row for the Agent: the second target is not shown for either plan, in the same words.
    const checks = limitChecksForAgent(g, readLimitVerdictsFromResult(result), undefined, undefined, result) ?? [];
    const reach = checks.find((c) => c.constraint_id === 'secondary');
    expect(reach?.say).toContain(record.message);
    expect(reach?.say).not.toMatch(/was checked/);
  });

  it('⭐ LIMIT: a limit moved through the user\'s point with no stated spread is withheld for those plans, with the joint; the targets stand', async () => {
    const g = jointGraph({ limitVia: 'x', optionsSetLimit: false });
    exactPart(g);
    const { result, licence } = await runJoint(g);
    expect(perTarget(licence, 'primary')).toEqual({ a: 41, b: 51 });
    expect(perTarget(licence, 'secondary')).toEqual({ a: 51, b: 61 });
    expect(licence.targets.joint.status).toBe('withheld');
    const [record, ...more] = spreadRecords(result);
    expect(more).toEqual([]);
    expect(record).toMatchObject({ constraint_ids: ['budget'], option_ids: ['a', 'b'], links: [{ from: 'x', to: 'limit' }] });
    for (const row of envOf(result).option_comparison as Json[]) {
      expect(row.constraint_probabilities).not.toHaveProperty('budget');
      expect(row).not.toHaveProperty('probability_of_joint_goal');
    }
    const cost = (limitChecksForAgent(g, readLimitVerdictsFromResult(result), undefined, undefined, result) ?? []).find((c) => c.constraint_id === 'budget');
    expect(cost?.say).toContain(`On the link from ‘Quality contribution’ to ‘Cost’: ${UNSUPPORTED_POINT_WORDS} ${UNSUPPORTED_POINT_QUESTION}`);
    expect(cost?.say).not.toMatch(/was checked/);
  });

  it('PER OPTION: only the plans the spread withholds lose the second target and the joint, named in the note; plan c keeps both', async () => {
    const g = jointGraph({ planC: true });
    const { result, licence } = await runJoint(g);
    const [record] = spreadRecords(result);
    expect(record).toMatchObject({ constraint_ids: ['secondary'], option_ids: ['a', 'b'] });
    expect(perTarget(licence, 'primary')).toMatchObject({ a: 41, b: 51 });
    expect(perTarget(licence, 'secondary')).toEqual({ c: 71 });
    expect(licence.targets.joint).toMatchObject({ status: 'licensed', pct_by_option: { c: 41 } });
    expect(licence.targets.joint.withheld_option_ids).toEqual(['a', 'b']);
    expect(says(licence)).toContain(`‘Reach’ being at least 50% at three months (for ‘Plan a’ and ‘Plan b’): ${record.message}`);
    expect(says(licence).split(UNSUPPORTED_POINT_WORDS).length - 1, 'said once').toBe(1);
    expect(says(licence)).not.toContain('did not return a usable chance for ‘Plan a’');
  });

  it('SCOPE: a limit each plan SETS itself is a fixed input — a user point into it carries no plan\'s P, so nothing is withheld', async () => {
    const g = jointGraph({ limitVia: 'y', optionsSetLimit: true });
    exactPart(g);
    const { result, licence } = await runJoint(g);
    expect(spreadRecords(result)).toEqual([]);
    expect(licence.targets.joint).toMatchObject({ status: 'licensed', pct_by_option: { a: 21, b: 31 } });
  });
});

