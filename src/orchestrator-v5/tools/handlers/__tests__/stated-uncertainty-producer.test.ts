/**
 * ⭐ STEP 8 PRODUCER — AN UNCERTAINTY FOR THE USER'S OWN PHYSICAL SIZE (DL-3 19 Oct; AIE
 * prompt/AIE-PHYSICAL-UNCERTAINTY-PRODUCER-MAPPING-AND-CARD-20261019-v1.json, sha256 df3304b7…; DL-3 ruling 19 Oct: the AI declares,
 * the host verifies only literal facts; Paul's Option B: nothing is withheld, everything is labelled).
 *
 * The real path: construction's own graph (the user's "15 orders per day" per packer) → the Agent's card (`propose_link_strength`
 * with `uncertainty`) → the press → the real edge adapter and chat writer (`applyEdgeStrengthEdit`) → the exact readback and receipt →
 * the next Run's input. The figures go through the ONE statement verifier: words that contradict a figure, unit, sign or increment
 * prepare nothing. The record is the user's own stated spread (attested) only where the AI reads the speaker as the user, the quote
 * is their whole statement and it names this link; otherwise it is saved as Olumi's reading of their words, labelled, never attested.
 */
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { OrchestratorTurnPayloadSchema } from '@talchain/schemas/boundary';

import type { PLoTClient } from '../../../../orchestrator/plot-client.js';
import type { V2RunResponseEnvelope } from '../../../../orchestrator/types.js';
import { loadScenarioSnapshotForRunAnalysis } from '../../../build-turn-context.js';
import { buildModelFromBrief } from '../../../agent-lane/runtime/build-model.js';
import { createAgentCapabilities, type InternalDispatch } from '../../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../../agent-lane/proposal.js';
import { approvalChipsFor } from '../../../agent-lane/approval-chips.js';
import { applyEdgeStrengthEdit } from '../../../system-events/edge-strength-edit.js';
import { linkEffectConversionFrames } from '../../../system-events/link-effect-edit.js';
import { clampForPersist, refitFramesForStatedEffects } from '../../../agent-lane/refit-frames.js';
import { convertLinkEffect } from '../../../../cee/magnitude/link-effect.js';
import { normalQuantilesSd, OLUMI_READING_ASSESSOR, statedUncertaintyAttested, UNCERTAINTY_SAVE_BUTTON, UNSUPPORTED_UNCERTAINTY_WORDS } from '../../../../cee/magnitude/stated-uncertainty.js';
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
const chanceShown = (r: Json): boolean => [env(r).option_comparison, env(r).results].flatMap((c) => (Array.isArray(c) ? c : []))
  .some((e: Json) => e?.option_id === MOVER && typeof e.probability_of_goal === 'number');

// The user's words, as they would answer the AIE's question: their whole statement, naming the link, in their own voice.
const SD_WORDS = 'From our last eight weeks of shift data, the standard deviation of daily order throughput per added packer is 3 orders per day.';
const SD = { stated_as: 'standard_deviation', sd: 3, unit: 'orders per day', from_words: SD_WORDS, basis_words: 'From our last eight weeks of shift data',
  speaker: 'user' };
const Q_WORDS = 'Based on last quarter’s shifts, I’m 90% sure each added packer adds between 10 and 20 orders per day to daily order throughput, with 5% below 10 and 5% above 20.';
const Q = { stated_as: 'normal_quantiles', lower: 10, upper: 20, probability_inside: 90, probability_below: 5, probability_above: 5, unit: 'orders per day',
  from_words: Q_WORDS, tails_words: '5% below 10 and 5% above 20', basis_words: 'Based on last quarter’s shifts', speaker: 'user' };
/** An SD statement in other words, with the same literal shape. */
const sd = (words: string, over: Json = {}): [string, Json] => [words, { ...SD, from_words: words, basis_words: 'From our shift data', ...over }];

describe('PREMISE: construction\'s graph holds the user\'s 15 orders per day per packer, bound to its frames, with no uncertainty recorded', () => {
  it('the size is the user\'s, current and bound; no spread is attested', () => {
    const e = link(BUILT);
    expect(e.provenance).toMatchObject({ magnitude: 'user_stated', natural_effect: { amount: 15, per_source_change: 1 } });
    const frames = linkEffectConversionFrames(BUILT, FROM, TO)!;
    expect(convertLinkEffect(15, 1, frames.target, frames.source)).toBeCloseTo(e.strength.mean, 12);
    expect(statedUncertaintyAttested(e)).toBe(false);
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

describe('⭐ THE USER\'S OWN STATED SPREAD: verified literally, saved once, read back exactly, attested, and on the next Run\'s input', () => {
  it('an explicit standard deviation: the card, "Save uncertainty", one save; size and source kept; σ = |k|·3 on the Run input', async () => {
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
    expect(uncertainty).toEqual({ stated_as: 'standard_deviation', sd: 3, distribution: 'normal', distribution_origin: 'olumi_provisional',
      assessor: 'you', basis: 'From our last eight weeks of shift data', source_quote: SD_WORDS });
    expect(after.std_defaulted).toBe(false);
    const k = Math.abs(before.strength.mean / 15);
    expect(after.strength.std).toBeCloseTo(3 * k, 12);
    expect(statedUncertaintyAttested(after)).toBe(true);
    // The receipt is said after the exact readback, in the AIE's words.
    expect(applied!.follow_up).toBe('Saved the uncertainty assessment for ‘Additional packers’ → ‘Daily order throughput’. Its size remains 15 orders per day per packer '
      + '(“Each packer adds 15 orders per day.”). Calculations using it remain conditional on a symmetric bell-shaped approximation centred on 15, based on From our last eight weeks of shift data.');
    // The next Run: the engine receives exactly that spread on the user's mean.
    const { result, sentEdge } = await nextRun(w.graph());
    expect(sentEdge?.strength).toMatchObject({ mean: before.strength.mean });
    expect(sentEdge!.strength.std).toBeCloseTo(3 * k, 12);
    expect(chanceShown(result)).toBe(true);
  });

  it('explicit 5%/90%/5% quantiles: σ from the AIE\'s equation, centred on the user\'s 15; the card says the assessment', async () => {
    const { w, card, applied } = await press(Q_WORDS, Q);
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true });
    expect(String(card.public_label)).toContain('Record your assessment: 5% below 10, 90% between 10 and 20, and 5% above 20. Use a symmetric bell-shaped approximation centred on 15, based on Based on last quarter’s shifts. This remains a provisional modelling assumption.');
    expect(applied).toMatchObject({ ok: true, applied: true });
    const after = link(w.graph());
    const sdQ = 10 / (2 * 1.6448536269514715);
    expect(after.provenance.natural_effect.uncertainty).toMatchObject({ stated_as: 'normal_quantiles', lower: 10, p_lower: 0.05, upper: 20, p_upper: 0.95, assessor: 'you' });
    expect(after.provenance.natural_effect.uncertainty.sd).toBeCloseTo(sdQ, 9);
    expect(after.strength.std).toBeCloseTo(sdQ * Math.abs(link(BUILT).strength.mean / 15), 12);
    expect(statedUncertaintyAttested(after)).toBe(true);
  });
});

describe('⭐ OLUMI\'S READING, LABELLED (DL-3 ruling): the figures hold literally, but the speaker, the whole statement or the link does not', () => {
  const OLUMIS: [string, string, Json][] = [
    ['the link is not named (the words answer a question)', ...sd('From our shift data, the standard deviation is 3 orders per day.')],
    ['another quantity is named ("customer complaints", Codex probe 6)', ...sd('From our shift data, the standard deviation of customer complaints is 3 orders per day.')],
    ['another speaker, read as such (the supplier, Codex probe 7)', ...sd('The supplier reports that from their shift data, the standard deviation of daily order throughput per added packer is 3 orders per day.', { speaker: 'other', basis_words: 'from their shift data' })],
    ['a span cut from another speaker\'s report, read as the user\'s', 'The supplier reports that from their shift data, the standard deviation of daily order throughput per added packer is 3 orders per day.',
      { ...SD, from_words: 'from their shift data, the standard deviation of daily order throughput per added packer is 3 orders per day', basis_words: 'from their shift data' }],
  ];
  it.each(OLUMIS)('%s: saved as Olumi\'s reading, said so on the card and receipt, never attested, and still on the Run\'s input', async (_, words, args) => {
    const { w, card, applied } = await press(words, args);
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true });
    expect(String(card.public_label)).toContain('Record Olumi’s reading of the uncertainty assessment: standard deviation 3 orders per day');
    expect(String(card.public_label)).toContain('This is Olumi’s reading, not an assessment you stated.');
    expect(applied, JSON.stringify(applied)).toMatchObject({ ok: true, applied: true });
    expect(String(applied!.follow_up)).toMatch(/^Saved Olumi’s reading of the uncertainty for /);
    const after = link(w.graph());
    expect(after.provenance.natural_effect.uncertainty).toMatchObject({ sd: 3, assessor: OLUMI_READING_ASSESSOR, read_by: 'olumi' });
    expect(after).not.toHaveProperty('std_defaulted');
    expect(statedUncertaintyAttested(after)).toBe(false);
    const k = Math.abs(link(BUILT).strength.mean / 15);
    const { sentEdge } = await nextRun(w.graph());
    expect(sentEdge!.strength.std).toBeCloseTo(3 * k, 12);
  });
  it('CONTRAST: the same figures as the user\'s whole statement naming the link are theirs (attested)', async () => {
    const { w } = await press(...sd('From our shift data, the standard deviation of daily order throughput per added packer is 3 orders per day.'));
    expect(link(w.graph()).provenance.natural_effect.uncertainty).toMatchObject({ assessor: 'you' });
    expect(statedUncertaintyAttested(link(w.graph()))).toBe(true);
  });
});

describe('NEGATIVES: words that contradict a figure, unit, sign or increment prepare and save nothing; the size stays', () => {
  const nothing = (r: Awaited<ReturnType<typeof press>>): void => {
    expect(r.card.ok, JSON.stringify(r.card)).toBe(false);
    expect(r.w.sent).toEqual([]);
    expect(link(r.w.graph())).toEqual(link(BUILT));
  };
  it('a bare "90% sure it is between" (no tail allocation, no basis): asks exactly the missing meaning and basis', async () => {
    const words = 'I’m 90% sure each added packer adds between 10 and 20 orders per day to daily order throughput.';
    const r = await press(words, { stated_as: 'normal_quantiles', lower: 10, upper: 20, probability_inside: 90, unit: 'orders per day', from_words: words, speaker: 'user' });
    nothing(r);
    expect(r.card.refusal).toBe('uncertainty_meaning_missing');
    expect(r.card.detail).toContain('"I’ve kept your range and its source. Does the 90% mean 5% below 10 and 5% above 20, and is a symmetric bell-shaped approximation appropriate for this effect? What is that assessment based on?"');
  });
  it('the tails given but no basis: asks only the basis', async () => {
    const words = 'I’m 90% sure each added packer adds between 10 and 20 orders per day to daily order throughput, with 5% below 10 and 5% above 20.';
    const r = await press(words, { ...Q, from_words: words, basis_words: undefined });
    nothing(r);
    expect(r.card.detail).toContain('"I’ve kept your range and its source. What is that assessment based on?"');
  });
  it('CENTRE CONFLICT: 5%/90%/5% of 10–30 centres on 20, not the user\'s 15: the mismatch is said; the size is never moved', async () => {
    const words = 'Based on last quarter’s shifts, I’m 90% sure each added packer adds between 10 and 30 orders per day to daily order throughput, with 5% below 10 and 5% above 30.';
    const r = await press(words, { ...Q, upper: 30, from_words: words, tails_words: '5% below 10 and 5% above 30' });
    nothing(r);
    expect(r.card.refusal).toBe('centre_conflict');
    expect(r.card.detail).toContain('is centred on 20, but the size you gave is 15 orders per day');
  });
  it('UNSUPPORTED FAMILY: most likely / worst / best has no unique spread: the AIE\'s limitation, nothing assumed', async () => {
    const words = 'Most likely 15 orders per day, worst case 8 orders per day, best case 22 orders per day.';
    const r = await press(words, { stated_as: 'most_likely', lower: 8, upper: 22, unit: 'orders per day', from_words: words, speaker: 'user' });
    nothing(r);
    expect(r.card.detail).toContain(UNSUPPORTED_UNCERTAINTY_WORDS);
  });
  it('NOT REPRESENTABLE: a spread wider than the writer can hold is refused, never clamped', async () => {
    const r = await press(...sd('From our shift data, the standard deviation is 900 orders per day.', { sd: 900 }));
    nothing(r);
    expect(r.card.detail).toContain(UNSUPPORTED_UNCERTAINTY_WORDS);
  });
  it('A FIGURE THE USER DID NOT WRITE is never recorded', async () => {
    const r = await press(SD_WORDS, { ...SD, sd: 4 });
    nothing(r);
    expect(r.card.refusal).toBe('figure_not_stated');
  });
  // Codex R1 #3452 probes 1–5 and 8, through the one verifier.
  it.each([
    ['A RANGE END with the unit only after the high end ("between 3 and 27 orders per day")', ...sd('From our shift data, each added packer adds between 3 and 27 orders per day to daily order throughput.'), 'figure_not_stated'],
    ['WRONG PERIOD: per week, declared as such', ...sd('From our shift data, the standard deviation is 3 orders per week.', { unit: 'orders per week' }), 'not_the_same_quantity'],
    ['WRONG UNIT, declared as such: minutes', ...sd('From our shift data, the standard deviation is 3 minutes.', { unit: 'minutes' }), 'not_the_same_quantity'],
    ['WRONG UNIT hidden by the declared unit: "3 minutes" read as orders per day', ...sd('From our shift data, the standard deviation is 3 minutes.'), 'figure_not_stated'],
    ['ANOTHER NUMBER\'s unit: SD 4, "based on 3 shifts", declared as 3', ...sd('From our shift data, the standard deviation is 4 orders per day, based on 3 shifts.'), 'figure_not_stated'],
    ['A DIFFERENT INCREMENT: "for every ten packers"', ...sd('From our shift data, the standard deviation is 3 orders per day for every ten packers.'), 'not_the_same_quantity'],
    ['A NEGATIVE QUANTILE pair is never flipped to positive', 'Based on last quarter’s shifts, I’m 90% sure each added packer adds between -20 and -10 orders per day to daily order throughput, with 5% below -20 and 5% above -10.',
      { ...Q, lower: -20, upper: -10, from_words: 'Based on last quarter’s shifts, I’m 90% sure each added packer adds between -20 and -10 orders per day to daily order throughput, with 5% below -20 and 5% above -10.', tails_words: '5% below -20 and 5% above -10' }, 'figure_not_stated'],
  ])('%s: refused (%s)', async (_, words, args, refusal) => {
    const r = await press(words as string, args as Json);
    nothing(r);
    expect(r.card.refusal).toBe(refusal);
  });
  it.each([
    ['a ONE-SIDED BOUND is no standard deviation ("at most 3")', ...sd('From our shift data, each added packer adds at most 3 orders per day to daily order throughput.')],
    ['a RANGE END is no standard deviation ("from 3 to 27 orders per day")', ...sd('From our shift data, each added packer adds from 3 to 27 orders per day to daily order throughput.', { sd: 27 })],
  ])('%s: the AIE\'s limitation, nothing assumed', async (_, words, args) => {
    const r = await press(words, args);
    nothing(r);
    expect(r.card.detail).toContain(UNSUPPORTED_UNCERTAINTY_WORDS);
  });
});

describe('SUPPORT IS THE WRITER\'S RECORD, CURRENT AND WHOLE (fail-safe direction)', () => {
  const attested = async (): Promise<Json> => (await press(SD_WORDS, SD)).w.graph();
  it('FAIL-SAFE: a reader that drops the record (an older pin) sees no attestation', async () => {
    const g = await attested();
    delete link(g).provenance.natural_effect.uncertainty;
    expect(statedUncertaintyAttested(link(g))).toBe(false);
  });
  it('the flag without the record, or the record without the flag, is no attestation', async () => {
    const flagOnly = clone(BUILT); link(flagOnly).std_defaulted = false;
    expect(statedUncertaintyAttested(link(flagOnly))).toBe(false);
    const recordOnly = await attested(); link(recordOnly).std_defaulted = true;
    expect(statedUncertaintyAttested(link(recordOnly))).toBe(false);
  });
  it('an Olumi reading with the flag forced on is still no attestation', async () => {
    const g = (await press(...sd('From our shift data, the standard deviation is 3 orders per day.'))).w.graph();
    link(g).std_defaulted = false;
    expect(statedUncertaintyAttested(link(g))).toBe(false);
  });
  it('a stale spread (another writer changed σ, record left behind) is no attestation', async () => {
    const g = await attested();
    link(g).strength.std *= 2;
    expect(statedUncertaintyAttested(link(g))).toBe(false);
  });
  it('a reframe moves size and spread together (`refit-frames.ts`: mean, std and strength_mean scale alike): still attested; σ left behind is not', async () => {
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
    expect(statedUncertaintyAttested(link(snapshot.graph))).toBe(true);
    const refit = clampForPersist(refitFramesForStatedEffects(clone(g)).graph) as Json;
    expect(statedUncertaintyAttested(link(refit))).toBe(true);
  });
  it('an Olumi reading survives the schema with its label', async () => {
    const g = (await press(...sd('From our shift data, the standard deviation is 3 orders per day.'))).w.graph();
    expect(link(GraphV3.parse(g) as unknown as Json).provenance.natural_effect.uncertainty).toMatchObject({ read_by: 'olumi' });
  });
});
