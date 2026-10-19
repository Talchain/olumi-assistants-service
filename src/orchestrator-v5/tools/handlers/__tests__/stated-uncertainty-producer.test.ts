/**
 * ⭐ STEP 8 PRODUCER — A SUPPORTED UNCERTAINTY FOR THE USER'S OWN PHYSICAL SIZE (DL-3 19 Oct; AIE
 * prompt/AIE-PHYSICAL-UNCERTAINTY-PRODUCER-MAPPING-AND-CARD-20261019-v1.json, sha256 df3304b7…).
 *
 * #3443 withholds a chance resting on a user's size whose spread nobody supported and asks for the evidence. These rows prove the
 * answer has somewhere to land, on the real path: construction's own graph (the user's "15 orders per day" per packer) → the Agent's
 * card (`propose_link_strength` with `uncertainty`) → the press → the real edge adapter and chat writer (`applyEdgeStrengthEdit`) →
 * the exact readback and receipt → the next Run's input and its chance. The size is never moved; what the AIE does not accept
 * prepares nothing and says the AIE's words.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { GOAL_FIGURES_UNSUPPORTED_SPREAD } from '../../../../orchestrator/context/option-result-source.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { chanceSupportGoalPaths } from '../../../agent-lane/goal-certainty.js';
import { buildModelFromBrief } from '../../../agent-lane/runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { approvalChipsFor } from '../../../agent-lane/approval-chips.js';
import { applyEdgeStrengthEdit } from '../../../system-events/edge-strength-edit.js';
import { linkEffectConversionFrames } from '../../../system-events/link-effect-edit.js';
import { clampForPersist, refitFramesForStatedEffects } from '../../../agent-lane/refit-frames.js';
import { convertLinkEffect } from '../../../../cee/magnitude/link-effect.js';
import { currentUserSize, linkSpreadOf, normalQuantilesSd, statedUncertaintyAttested, UNCERTAINTY_SAVE_BUTTON, UNSUPPORTED_UNCERTAINTY_WORDS } from '../../../../cee/magnitude/stated-uncertainty.js';
import { GraphV3 } from '../../../../schemas/cee-v3.js';
import { makeMessagePayload } from '../../../__tests__/fixtures.js';
import type { HandlerInvocation } from '../../registry.js';
import { createRunAnalysisHandler } from '../run-analysis.js';

type Json = Record<string, any>;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const SCENARIO = '5e8e8e8e-0000-4000-8000-0000000000f3';
const FROM = 'additional_packers';
const TO = 'daily_order_throughput';
const MOVER = 'add_one_packer';

// ── Construction's own graph: the user's size in natural units, bound to its frames ───────────────────────────────────────
const BRIEF = 'We are comparing two crewing options, labelled exactly "Keep current crew" and "Add one packer". Use the exact goal '
  + 'label "Daily order throughput". Our current crew ships 50 orders per day. We need at least 70 orders per day. Keep current '
  + 'crew adds no packer. Add one packer adds one packer. Each packer adds 15 orders per day.';
const DRAFT = { goal: { metric: 'Daily order throughput', operator: '>=', target_stated: true, value: 70, unit: 'orders per day', horizon_months: null,
  provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 50, baseline_provenance: 'explicit', scope: null },
  constraints: [], options: [{ label: 'Keep current crew', provenance: 'explicit', changes: [], is_status_quo: true, interventions: [] },
    { label: 'Add one packer', provenance: 'explicit', changes: [], is_status_quo: null,
      interventions: [{ factor_label: 'Additional packers', value: 1, value_kind: 'absolute', unit: 'packers', provenance: 'explicit' }] }],
  factors: [{ label: 'Additional packers', role: 'controllable', baseline_known: true, baseline_value: 0, unit: 'packers', provenance: 'inferred', plausible_max: 5 }],
  risks: [], outcomes: [], identities: [], unknowns: [], decision_question: null,
  links: [{ from: 'Additional packers', to: 'Daily order throughput', direction: 'positive', provenance: 'explicit', effect_amount: 15,
    effect_per_source_change: 1, effect_provenance: 'explicit', definitional: null, basis: null, source_quote: 'Each packer adds 15 orders per day.' }] };

let saved: Json | undefined;
await buildModelFromBrief(SCENARIO, BRIEF, (async (path: string, body: Json) => {
  if (path.endsWith('/graph/register')) { saved = clone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
  return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
}) as never, (async () => ({ text: JSON.stringify(DRAFT) })) as never);
const BUILT = saved as Json;
const link = (g: Json): Json => (g.edges as Json[]).find((e) => e.from === FROM && e.to === TO)!;

// ── The real write path: the Agent's card, the press, the real adapter and writer, the save, the readback ─────────────────
function world(initial: Json) {
  let g = clone(initial);
  let rev = 1;
  const sent: Json[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: clone(g), graph_hash: `h${rev}` } };
    sent.push(body as Json);
    const payload = OrchestratorTurnPayloadSchema.parse(body);
    if (payload.kind !== 'system_event' || payload.event.kind !== 'edge_strength_edit') throw new Error('unexpected dispatch');
    const result = await applyEdgeStrengthEdit({ payload, event: payload.event, requestId: 'req-unc', persistedGraph: clone(g) });
    if (result.kind !== 'mutated') return { status: 422, json: { assistant_text: result.response.assistant_text } };
    g = clone(result.mutatedGraph) as Json;
    rev += 1;
    return { status: 200, json: { assistant_text: result.response.assistant_text, graph_hash: `h${rev}` } };
  };
  return { d, sent, graph: () => clone(g) };
}

async function press(words: string, uncertainty: Json, graph: Json = BUILT) {
  const w = world(graph);
  const store = new ProposalStore();
  const caps = createAgentCapabilities(w.d, store);
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text: words, user_turn_text: words };
  const card = await caps.proposeLinkStrength!(ctx, { from_label: 'Additional packers', to_label: 'Daily order throughput', rationale: words,
    uncertainty } as never);
  if (card.ok !== true) return { w, store, card, applied: undefined };
  const applied = await caps.authoriseChange(ctx, { proposal_id: String(card.proposal_id) });
  return { w, store, card, applied };
}

// ── The next Run: the real Run handler on the saved bytes, a synthetic engine body for the two options ────────────────────
const GOLDEN = JSON.parse(readFileSync('tests/fixtures/plot/v2-run-golden-happy.json', 'utf8')) as Json;
function engineBody(g: Json): Json {
  const body = clone(GOLDEN);
  const label = (id: string): string => (g.nodes as Json[]).find((n) => n.id === id)!.label;
  const rows = [['add_one_packer', 0.62, 0.9], ['keep_current_crew', 0.12, 0.1]] as const;
  body.option_comparison = rows.map(([id, p, win]) => ({ option_id: id, option_label: label(id), win_probability: win, probability_of_goal: p, status: 'computed',
    outcome: { mean: id === MOVER ? 65 : 50, std: 6, p10: 57, p50: 65, p90: 73, n_samples: 10000, n_valid_samples: 10000, validity_ratio: 1, percentiles_source: 'samples' } }));
  body.results = clone(body.option_comparison);
  body.identity_evaluations = []; body.inference_warnings = []; body.fact_objects = []; body.review_cards = [];
  body.decision_brief = { options: clone(body.option_comparison), analysis_summary: { leading_option: MOVER, win_probability: 0.9 } };
  return body;
}
async function nextRun(g: Json): Promise<{ result: Json; sentEdge: Json | undefined }> {
  const store = { readMostRecentPendingActions: async () => [], loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(g), briefText: BRIEF })),
    loadGraph: vi.fn(async () => clone(g)) };
  const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-unc-load', store as never);
  const plot = vi.fn(async (_req: unknown) => engineBody(g) as unknown as V2RunResponseEnvelope);
  const handler = createRunAnalysisHandler({ plotClient: { run: plot, validatePatch: vi.fn().mockResolvedValue({}) } as unknown as PLoTClient,
    scenarioReader: vi.fn(async () => snapshot) });
  const outcome = await handler({
    context: { stage: 'analyse', entity_registry: { option_ids: [], goal_id: null }, capabilities: {}, messages: [], session_id: SCENARIO,
      request_id: 'req-unc-run', budgets: { turn_ms: 180_000, llm_narrate_ms: 60_000 }, prior_turns: [], prior_facts: [], scenarioBriefText: null, persistedGraph: null },
    payload: makeMessagePayload({ turn_id: 't-unc', scenario_id: SCENARIO, message: 'Run the analysis.', turn_class: 'decide', stage: 'analyse' } as never),
    requestId: 'req-unc-run', signal: new AbortController().signal, orientationText: '',
  } as unknown as HandlerInvocation);
  const result = (outcome.handler_facts[0] as Json).result as Json;
  const find = (x: unknown): Json | undefined => {
    if (Array.isArray(x)) { for (const y of x) { const f = find(y); if (f !== undefined) return f; } return undefined; }
    if (x === null || typeof x !== 'object') return undefined;
    const r = x as Json;
    if (r.from === FROM && r.to === TO && r.strength !== undefined) return r;
    for (const v of Object.values(r)) { const f = find(v); if (f !== undefined) return f; }
    return undefined;
  };
  return { result, sentEdge: plot.mock.calls.length > 0 ? find(plot.mock.calls[0]![0]) : undefined };
}
const env = (r: Json): Json => r.enrichment ?? r;
const spreadWithheld = (r: Json): boolean => [...(env(r).inference_warnings ?? []), ...(r.inference_warnings ?? [])]
  .some((w: Json) => w?.code === GOAL_FIGURES_UNSUPPORTED_SPREAD && (w.option_ids as string[]).includes(MOVER));
const chanceShown = (r: Json): boolean => [env(r).option_comparison, env(r).results].flatMap((c) => (Array.isArray(c) ? c : []))
  .some((e: Json) => e?.option_id === MOVER && typeof e.probability_of_goal === 'number');

// The user's words, as they would answer the AIE's question.
const SD_WORDS = 'From our last eight weeks of shift data, the standard deviation is 3 orders per day.';
const SD = { stated_as: 'standard_deviation', sd: 3, unit: 'orders per day', from_words: 'the standard deviation is 3 orders per day',
  basis_words: 'From our last eight weeks of shift data' };
const Q_WORDS = 'Based on last quarter’s shifts, I’m 90% sure each packer adds between 10 and 20 orders per day, with 5% below 10 and 5% above 20.';
const Q = { stated_as: 'normal_quantiles', lower: 10, upper: 20, probability_inside: 90, probability_below: 5, probability_above: 5, unit: 'orders per day',
  from_words: 'I’m 90% sure each packer adds between 10 and 20 orders per day', tails_words: '5% below 10 and 5% above 20', basis_words: 'Based on last quarter’s shifts' };

describe('PREMISE: construction\'s graph holds the user\'s 15 orders per day per packer, bound to its frames, and #3443 withholds its chance', () => {
  it('the size is the user\'s, current and bound; the Run withholds the mover\'s chance with no uncertainty recorded', async () => {
    const e = link(BUILT);
    expect(e.provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { amount: 15, per_source_change: 1 } });
    const frames = linkEffectConversionFrames(BUILT, FROM, TO)!;
    expect(convertLinkEffect(15, 1, frames.target, frames.source)).toBeCloseTo(e.strength.mean, 12);
    expect(chanceSupportGoalPaths(BUILT, [MOVER]).unsupportedSpread).toEqual([{ option_id: MOVER, links: [{ from: FROM, to: TO }] }]);
    const { result } = await nextRun(BUILT);
    expect(spreadWithheld(result)).toBe(true);
    expect(chanceShown(result)).toBe(false);
  });
});

describe('THE AIE\'s MAPPING, exactly', () => {
  it('a central Normal 90% interval of 10–30 is σ 6.079568 with centre 20; central 95% is 5.102135', () => {
    const fit = normalQuantilesSd({ lower: 10, p_lower: 0.05, upper: 30, p_upper: 0.95 })!;
    expect(fit.sd).toBeCloseTo(6.079568319117694, 9);
    expect(fit.centre).toBeCloseTo(20, 9);
    expect(normalQuantilesSd({ lower: 10, p_lower: 0.025, upper: 30, p_upper: 0.975 })!.sd).toBeCloseTo(5.102134569246541, 9);
  });
});

describe('⭐ RED→GREEN: a supported uncertainty for the user\'s own size, saved once, read back exactly, and the next Run shows the chance', () => {
  it('an explicit standard deviation: the card, "Save uncertainty", one save; size and source kept; σ = |k|·3 on the Run input; the chance shows', async () => {
    const { w, store, card, applied } = await press(SD_WORDS, SD);
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false });
    expect(String(card.public_label)).toBe('Keep ‘Additional packers’ → ‘Daily order throughput’ at 15 orders per day per packer (“Each packer adds 15 orders per day.”). '
      + 'Record your uncertainty assessment: standard deviation 3 orders per day, using a symmetric bell-shaped approximation centred on 15 (a provisional approximation), '
      + 'based on From our last eight weeks of shift data. Calculations using it remain conditional on these assumptions.');
    const chips = approvalChipsFor([{ name: 'propose_link_strength', ok: true, mutated: false, proposal_id: String(card.proposal_id) }],
      (id) => ({ proposal: store.get(id), result: card }));
    expect(chips[0]).toMatchObject({ label: UNCERTAINTY_SAVE_BUTTON, detail: card.public_label });
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, mutated: true, applied: true });
    expect(w.sent).toHaveLength(1);
    const before = link(BUILT); const after = link(w.graph());
    // The size, its unit, source change, source and quote are byte-for-byte the user's; only the spread and its record change.
    expect(after.strength.mean).toBe(before.strength.mean);
    expect(after.effect_direction).toBe(before.effect_direction);
    const { uncertainty, ...sizeAfter } = after.provenance.natural_effect;
    expect(sizeAfter).toEqual(before.provenance.natural_effect);
    expect({ ...after.provenance, natural_effect: sizeAfter }).toEqual(before.provenance);
    expect(uncertainty).toMatchObject({ stated_as: 'standard_deviation', sd: 3, distribution: 'normal', distribution_origin: 'olumi_provisional',
      assessor: 'you', basis: 'From our last eight weeks of shift data', source_quote: SD.from_words });
    expect(after.std_defaulted).toBe(false);
    const k = Math.abs(before.strength.mean / 15);
    expect(after.strength.std).toBeCloseTo(3 * k, 12);
    expect(statedUncertaintyAttested(after)).toBe(true);
    // The receipt is said after the exact readback, in the AIE's words.
    expect(applied!.follow_up).toBe('Saved the uncertainty assessment for ‘Additional packers’ → ‘Daily order throughput’. Its size remains 15 orders per day per packer '
      + '(“Each packer adds 15 orders per day.”). Calculations using it remain conditional on a symmetric bell-shaped approximation centred on 15, based on From our last eight weeks of shift data.');
    // The next Run: the engine receives exactly that spread on the user's mean, and the chance is no longer withheld for the spread.
    const { result, sentEdge } = await nextRun(w.graph());
    expect(sentEdge?.strength).toMatchObject({ mean: before.strength.mean });
    expect(sentEdge!.strength.std).toBeCloseTo(3 * k, 12);
    expect(spreadWithheld(result)).toBe(false);
    expect(chanceShown(result)).toBe(true);
  });

  it('explicit 5%/90%/5% quantiles: σ from the AIE\'s equation, centred on the user\'s 15; the card says the assessment; the chance shows', async () => {
    const { w, card, applied } = await press(Q_WORDS, Q);
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true });
    expect(String(card.public_label)).toContain('Record your assessment: 5% below 10, 90% between 10 and 20, and 5% above 20. Use a symmetric bell-shaped approximation centred on 15, based on Based on last quarter’s shifts. This remains a provisional modelling assumption.');
    expect(applied).toMatchObject({ ok: true, applied: true });
    const after = link(w.graph());
    const sd = 10 / (2 * 1.6448536269514715);
    expect(after.provenance.natural_effect.uncertainty).toMatchObject({ stated_as: 'normal_quantiles', lower: 10, p_lower: 0.05, upper: 20, p_upper: 0.95 });
    expect(after.provenance.natural_effect.uncertainty.sd).toBeCloseTo(sd, 9);
    expect(after.strength.std).toBeCloseTo(sd * Math.abs(link(BUILT).strength.mean / 15), 12);
    const { result } = await nextRun(w.graph());
    expect(spreadWithheld(result)).toBe(false);
    expect(chanceShown(result)).toBe(true);
  });
});

describe('NEGATIVES: nothing is prepared or saved, the size stays, and the AIE\'s words are said', () => {
  const nothing = (r: Awaited<ReturnType<typeof press>>): void => {
    expect(r.card.ok).toBe(false);
    expect(r.w.sent).toEqual([]);
    expect(link(r.w.graph())).toEqual(link(BUILT));
  };
  it('a bare "90% sure it is between" (no tail allocation, no basis): asks exactly the missing meaning and basis', async () => {
    const words = 'I’m 90% sure each packer adds between 10 and 20 orders per day.';
    const r = await press(words, { stated_as: 'normal_quantiles', lower: 10, upper: 20, probability_inside: 90, unit: 'orders per day', from_words: words.slice(0, -1) });
    nothing(r);
    expect(r.card.refusal).toBe('uncertainty_meaning_missing');
    expect(r.card.detail).toContain('"I’ve kept your range and its source. Does the 90% mean 5% below 10 and 5% above 20, and is a symmetric bell-shaped approximation appropriate for this effect? What is that assessment based on?"');
  });
  it('the tails given but no basis: asks only the basis', async () => {
    const words = 'I’m 90% sure each packer adds between 10 and 20 orders per day, with 5% below 10 and 5% above 20.';
    const r = await press(words, { ...Q, basis_words: undefined });
    nothing(r);
    expect(r.card.detail).toContain('"I’ve kept your range and its source. What is that assessment based on?"');
  });
  it('CENTRE CONFLICT: 5%/90%/5% of 10–30 centres on 20, not the user\'s 15: the mismatch is said; the size is never moved', async () => {
    const words = 'Based on last quarter’s shifts, I’m 90% sure each packer adds between 10 and 30 orders per day, with 5% below 10 and 5% above 30.';
    const r = await press(words, { ...Q, upper: 30, from_words: 'I’m 90% sure each packer adds between 10 and 30 orders per day', tails_words: '5% below 10 and 5% above 30' });
    nothing(r);
    expect(r.card.refusal).toBe('centre_conflict');
    expect(r.card.detail).toContain('is centred on 20, but the size you gave is 15 orders per day');
  });
  it('WRONG PERIOD: the same figures per week are not this per-day effect', async () => {
    const words = 'From our shift data, the standard deviation is 3 orders per week.';
    const r = await press(words, { ...SD, unit: 'orders per week', from_words: 'the standard deviation is 3 orders per week', basis_words: 'From our shift data' });
    nothing(r);
    expect(r.card.refusal).toBe('not_the_same_quantity');
  });
  it('WRONG QUANTITY: a spread in minutes is not this effect', async () => {
    const words = 'From our shift data, the standard deviation is 3 minutes.';
    const r = await press(words, { ...SD, unit: 'minutes', from_words: 'the standard deviation is 3 minutes', basis_words: 'From our shift data' });
    nothing(r);
    expect(r.card.refusal).toBe('not_the_same_quantity');
  });
  it('UNSUPPORTED FAMILY: most likely / worst / best has no unique spread: the AIE\'s limitation, nothing assumed', async () => {
    const words = 'Most likely 15 orders per day, worst case 8, best case 22.';
    const r = await press(words, { stated_as: 'normal_quantiles', lower: 8, upper: 22, unit: 'orders per day', from_words: words.slice(0, -1) });
    nothing(r);
    expect(r.card.detail).toContain(UNSUPPORTED_UNCERTAINTY_WORDS);
  });
  it('NOT REPRESENTABLE: a spread wider than the writer can hold is refused, never clamped', async () => {
    const words = 'From our shift data, the standard deviation is 900 orders per day.';
    const r = await press(words, { ...SD, sd: 900, from_words: 'the standard deviation is 900 orders per day', basis_words: 'From our shift data' });
    nothing(r);
    expect(r.card.detail).toContain(UNSUPPORTED_UNCERTAINTY_WORDS);
  });
  it('A LINK HELD STRONGER THAN ONE EDIT CAN SAY (|strength| > 1): refused at the door, never a card that cannot be saved', async () => {
    // A saved graph from before frames were fitted (as served c96fc4bb holds £49 per subscriber at 4.6): the packers on a frame of
    // 10, so the user's 15 orders per day per packer is a strength of 15 / 87.5 × 10 ≈ 1.71, size and frames still agreeing.
    const strong = clone(BUILT);
    (strong.nodes as Json[]).find((n) => n.id === FROM)!.observed_state.cap = 10;
    const beta = (15 / 87.5) * 10;
    link(strong).strength.mean = beta;
    link(strong).provenance.natural_effect.strength_mean = beta;
    expect(Math.abs(link(strong).strength.mean), 'premise: a strength above 1').toBeGreaterThan(1);
    expect(linkSpreadOf(1, currentUserSize(link(strong))!, linkEffectConversionFrames(strong, FROM, TO), convertLinkEffect), 'premise: the spread itself is representable')
      .toBeCloseTo(beta / 15, 9);
    const words = 'From our shift data, the standard deviation is 1 order per day.';
    const r = await press(words, { ...SD, sd: 1, unit: 'orders per day', from_words: 'the standard deviation is 1 order per day', basis_words: 'From our shift data' }, strong);
    expect(r.card.ok).toBe(false);
    expect(r.w.sent).toEqual([]);
    expect(link(r.w.graph())).toEqual(link(strong));
    expect(r.card.detail).toContain(UNSUPPORTED_UNCERTAINTY_WORDS);
  });
  it('A FIGURE THE USER DID NOT WRITE is never recorded', async () => {
    const r = await press(SD_WORDS, { ...SD, sd: 4 });
    nothing(r);
    expect(r.card.refusal).toBe('figure_not_stated');
  });
});

describe('SUPPORT IS THE WRITER\'S RECORD, CURRENT AND WHOLE (fail-safe direction)', () => {
  const attested = async (): Promise<Json> => (await press(SD_WORDS, SD)).w.graph();
  it('FAIL-SAFE: a reader that drops the record (an older pin) sees no support, and the chance stays withheld', async () => {
    const g = await attested();
    delete link(g).provenance.natural_effect.uncertainty;
    expect(statedUncertaintyAttested(link(g))).toBe(false);
    expect(spreadWithheld((await nextRun(g)).result)).toBe(true);
  });
  it('the flag without the record, or the record without the flag, is no support', async () => {
    const flagOnly = clone(BUILT); link(flagOnly).std_defaulted = false;
    expect(chanceSupportGoalPaths(flagOnly, [MOVER]).unsupportedSpread).toHaveLength(1);
    const recordOnly = await attested(); link(recordOnly).std_defaulted = true;
    expect(chanceSupportGoalPaths(recordOnly, [MOVER]).unsupportedSpread).toHaveLength(1);
  });
  it('a stale spread (another writer changed σ, record left behind) is no support', async () => {
    const g = await attested();
    link(g).strength.std *= 2;
    expect(chanceSupportGoalPaths(g, [MOVER]).unsupportedSpread).toHaveLength(1);
  });
  it('a reframe moves size and spread together (`refit-frames.ts`: mean, std and strength_mean scale alike): still supported; σ left behind is not', async () => {
    const g = await attested();
    const e = link(g);
    const scaled = clone(e);
    for (const x of [scaled]) { x.strength.mean *= 0.4; x.strength.std *= 0.4; x.provenance.natural_effect.strength_mean *= 0.4; }
    expect(statedUncertaintyAttested(scaled)).toBe(true);
    const stale = clone(e);
    stale.strength.mean *= 0.4; stale.provenance.natural_effect.strength_mean *= 0.4;
    expect(statedUncertaintyAttested(stale)).toBe(false);
  });
  it('the saved bytes survive the schema, a cold reopen and a refit with size and spread together', async () => {
    const g = await attested();
    const parsed = GraphV3.parse(g) as unknown as Json;
    expect(link(parsed).provenance.natural_effect.uncertainty).toEqual(link(g).provenance.natural_effect.uncertainty);
    const store = { readMostRecentPendingActions: async () => [], loadGraphAndBriefText: vi.fn(async () => ({ graph: clone(g), briefText: BRIEF })), loadGraph: vi.fn(async () => clone(g)) };
    const snapshot = await loadScenarioSnapshotForRunAnalysis(SCENARIO, 'req-unc-cold', store as never) as Json;
    expect(chanceSupportGoalPaths(snapshot.graph, [MOVER]).unsupportedSpread).toEqual([]);
    const refit = clampForPersist(refitFramesForStatedEffects(clone(g)).graph) as Json;
    expect(statedUncertaintyAttested(link(refit))).toBe(true);
    expect(chanceSupportGoalPaths(refit, [MOVER]).unsupportedSpread).toEqual([]);
  });
});
