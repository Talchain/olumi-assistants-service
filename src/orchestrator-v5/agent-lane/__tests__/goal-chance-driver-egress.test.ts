/**
 * PR-S2 r5 (DL GO #87, 7 Oct): the chat never denies the goal-chance driver the screen shows.
 *
 * Bound to the WIRE, keys untouched: `prod-cut6-smoke-cdcd44c3-turn003.json` is the prod cut-6 smoke's Run narration turn
 * (guest T1b, CEE 0f2c3b2, 7 Oct 00:34Z) and `…-screen-chance-lines.txt` is the SAME Run's screen text. The corpus is every
 * keyword sentence in every served Agent reply on disk (`driver-absence-corpus-20261007.json`, full population). Rows
 * written by the author are labelled as paraphrases.
 */
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { log } from '../../../utils/telemetry.js';
import { goalChanceDriverDisplayForAgent } from '../../goal-target/goal-chance-range-agent.js';
import {
  DRIVER_ABSENCE_CLAIM, GOAL_CHANCE_DRIVER_ABSENCE_REMOVED, removeDriverAbsenceClaims, withoutDriverAbsenceClaimsAtEgress,
  SENSITIVITY_ABSENCE_CLAIM, SENSITIVITY_ABSENCE_REMOVED, SENSITIVITY_ABSENCE_KEPT_UNSAFE, removeSensitivityAbsenceClaims, robustnessComputed,
} from '../goal-chance-driver-egress.js';

type Json = Record<string, any>;
const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
const PROD = JSON.parse(fixture('prod-cut6-smoke-cdcd44c3-turn003.json')) as Json;
const SCREEN = fixture('prod-cut6-smoke-cdcd44c3-screen-chance-lines.txt');
const CORPUS = JSON.parse(fixture('driver-absence-corpus-20261007.json')) as { population: string; rows: { sentence: string; fire: boolean; edited?: string }[] };
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const blockOf = (body: Json): Json => body.blocks.find((b: Json) => b.type === 'analysis_result');
const opts = (body: Json) => ({ analysisResult: blockOf(body), graph: body.draft_graph, requestId: 'req-s2', exitPath: 'agent_lane_v1_final', turnId: 'turn-s2' });
const PROD_CLAUSE = '; sensitivity has not established which assumption matters most.';

/** DL condition 1: what an edit leaves is well formed. */
function expectWellFormed(text: string): void {
  expect(text).not.toMatch(/[;,:]\s*[.!?]/);
  expect(text).not.toMatch(/[ \t]{2,}/);
  expect(text).not.toMatch(/\s[.!?;,]/);
  expect(text).not.toMatch(/(?:^|[.!?]\s+)(?:and|but|so|yet)\b/m);
  expect(text).not.toMatch(/^\s*[-*•]\s*$/m);
  expect(text).not.toMatch(/\n{3,}/);
  expect(text.trim()).not.toBe('');
}

afterEach(() => vi.restoreAllMocks());

describe('prod cut-6 smoke, keys untouched: the screen names a driver, so the reply’s denial goes', () => {
  it('the Agent’s driver sentences are the screen’s own words, for the two driven options', () => {
    const drivers = goalChanceDriverDisplayForAgent(blockOf(PROD), PROD.draft_graph);
    expect(Object.keys(drivers)).toEqual(['raise_prices_10', 'launch_starter_tier']);
    for (const sentence of Object.values(drivers)) expect(SCREEN).toContain(sentence);
    expect(drivers.launch_starter_tier).toContain('Olumi’s own estimate of how strongly ‘Starter tier MRR’');
  });

  it('RED at base: only the denial clause is removed; every other byte of the turn is unchanged', () => {
    expect(PROD.assistant_text).toContain(`Six underlying values were supplied by Olumi, not you${PROD_CLAUSE}`);
    const out = withoutDriverAbsenceClaimsAtEgress(PROD, opts(PROD)) as Json;
    expect(out.assistant_text).toBe(PROD.assistant_text.replace(PROD_CLAUSE, '.'));
    expect(out.assistant_text).toContain('The analysis has not tested whether the target is reached within 9 months.');
    expect(DRIVER_ABSENCE_CLAIM.test(out.assistant_text)).toBe(false);
    expectWellFormed(out.assistant_text);
    expect({ ...out, assistant_text: PROD.assistant_text }).toEqual(PROD);
  });

  it('CONTRAST: the same Run with no driver keeps its honest sentence, by reference', () => {
    const noDriver = clone(PROD);
    const licence = blockOf(noDriver).enrichment.inference_warnings.find((w: Json) => w.code === 'GOAL_CHANCE_LICENSED');
    licence.no_driver_by_option = Object.fromEntries(licence.option_ids.map((id: string) => [id, 'none']));
    delete licence.driver_by_option;
    expect(goalChanceDriverDisplayForAgent(blockOf(noDriver), noDriver.draft_graph)).toEqual({});
    expect(withoutDriverAbsenceClaimsAtEgress(noDriver, opts(noDriver))).toBe(noDriver);
    const noLicence = clone(PROD);
    blockOf(noLicence).enrichment.inference_warnings = blockOf(noLicence).enrichment.inference_warnings
      .filter((w: Json) => w.code !== 'GOAL_CHANCE_LICENSED');
    expect(withoutDriverAbsenceClaimsAtEgress(noLicence, opts(noLicence))).toBe(noLicence);
  });

  it('DL condition 4: one log line by code and turn id, never prose; none when nothing is removed', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never);
    withoutDriverAbsenceClaimsAtEgress(PROD, opts(PROD));
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields] = warn.mock.calls[0]! as [Json];
    expect(fields).toEqual({ event: 'agent_lane.goal_chance_driver_absence_removed', code: GOAL_CHANCE_DRIVER_ABSENCE_REMOVED,
      turn_id: 'turn-s2', request_id: 'req-s2', exit_path: 'agent_lane_v1_final', removed_count: 1 });
    const logged = JSON.stringify(warn.mock.calls);
    for (const prose of ['Six underlying', 'assumption matters', 'Starter tier', 'Raise prices']) expect(logged).not.toContain(prose);
    warn.mockClear();
    // Wave B (DL ruling 7 Oct): PROD's robustness check RAN, so "Sensitivity was not measured." is no longer the honest
    // control there. As the WHOLE reply it is kept (never an empty reply) and logged by code; no driver line is logged.
    const whole = { ...PROD, assistant_text: 'Sensitivity was not measured.' };
    expect(robustnessComputed(blockOf(PROD))).toBe(true);
    expect(withoutDriverAbsenceClaimsAtEgress(whole, opts(whole))).toBe(whole);
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0]! as [Json])[0]).toMatchObject({ code: SENSITIVITY_ABSENCE_KEPT_UNSAFE, kept_count: 1 });
    warn.mockClear();
    // The honest control: the same sentence on the same Run with NO robustness record.
    const honest = clone({ ...PROD, assistant_text: 'Sensitivity was not measured.' });
    delete blockOf(honest).enrichment.robustness;
    expect(robustnessComputed(blockOf(honest))).toBe(false);
    expect(withoutDriverAbsenceClaimsAtEgress(honest, opts(honest))).toBe(honest);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('DL condition 3: the full served corpus, not a sample', () => {
  it('population pinned: 117 distinct sentences from 446 served replies; 40 make the claim', () => {
    expect(CORPUS.population).toBe('FILES 867 · assistant_text 446 · distinct keyword sentences 117 · occurrences 379 · fire 40 · keep 77');
    expect(CORPUS.rows).toHaveLength(117);
    expect(CORPUS.rows.filter((r) => r.fire)).toHaveLength(40);
  });
  it.each(CORPUS.rows.filter((r) => r.fire).map((r) => [r.sentence, r.edited!]))('fires and edits well: %s', (sentence, edited) => {
    expect(DRIVER_ABSENCE_CLAIM.test(sentence)).toBe(true);
    const out = removeDriverAbsenceClaims(sentence);
    expect(out.text).toBe(edited);
    if (edited !== '') { expect(DRIVER_ABSENCE_CLAIM.test(edited)).toBe(false); expectWellFormed(edited); }
  });
  it.each(CORPUS.rows.filter((r) => !r.fire).map((r) => [r.sentence]))('keeps: %s', (sentence) => {
    expect(DRIVER_ABSENCE_CLAIM.test(sentence)).toBe(false);
    expect(removeDriverAbsenceClaims(sentence)).toEqual({ text: sentence, removed: 0, keptUnsafe: 0 });
  });
});

describe('paraphrases (author-written): singular, plural, fronted, predicative, impersonal, contracted', () => {
  it.each([
    'This run doesn’t establish which assumption matters most.',
    'The run does not establish which assumptions matter most.',
    'Which assumption matters most has not been established.',
    'Which factors matter most is not yet clear.',
    'It is unclear which assumption matters most.',
    'The most important assumption is not yet established.',
    'The assumption that matters most is unknown.',
    'No single assumption stands out.',
    'We can’t tell which factor is most important.',
    'Olumi couldn’t identify which input deserves investigation first.',
  ])('must fire and leave nothing: %s', (sentence) => {
    expect(DRIVER_ABSENCE_CLAIM.test(sentence)).toBe(true);
    expect(removeDriverAbsenceClaims(sentence).text).toBe('');
  });
});

describe('DL condition 2: a different claim that shares words keeps its text', () => {
  it.each([
    'We haven’t established whether the price rise affects churn.',
    'The model can’t tell which option is ahead.',
    // Served neighbours (prod provisional view; corpus).
    'The subscriber figures alone do not establish when their revenue effects occur.',
    'The run cannot establish which choice meets your requirements; 15 inputs are Olumi’s assumptions, not yours.',
    'No single option can be put forward yet, because the options came out too close together on this run to tell apart; tell me what matters most to you between them.',
    'The link from ‘Price rise’ to ‘monthly recurring revenue’ is one of the links this result is most sensitive to.',
    'Sensitivity was not measured.',
    'No measurable factor sensitivity was established.',
    'It rests most on Olumi’s own estimate of how strongly ‘Starter tier MRR’ affects ‘monthly recurring revenue’: if that effect is weaker than Olumi assumed, the chance falls.',
    'Which assumption matters most? The link from price rise to revenue.',
  ])('must NOT fire: %s', (sentence) => {
    expect(DRIVER_ABSENCE_CLAIM.test(sentence)).toBe(false);
  });
});

describe('DL condition 1: what is left is well formed', () => {
  it.each([
    ['clause after ";" (prod)', 'Six underlying values were supplied by Olumi, not you; sensitivity has not established which assumption matters most.', 'Six underlying values were supplied by Olumi, not you.'],
    ['its own sentence, between two', 'First point. The analysis does not establish which assumption is most worth investigating. Last point.', 'First point. Last point.'],
    ['leading clause before ", but"', 'The run does not establish which assumption matters most, but the link from price to revenue is sensitive.', 'The link from price to revenue is sensitive.'],
    ['", and" clause before ";"', 'Robustness is low, and no most-sensitive factor was measurable; 14 inputs came from Olumi.', 'Robustness is low; 14 inputs came from Olumi.'],
    ['", so" clause', 'Sensitivity was not measured, so investigation priority is not established.', 'Sensitivity was not measured.'],
    ['a bullet that was only the claim', 'In this model:\n- The analysis does not establish which assumption is most worth investigating.\n- Keep this line.', 'In this model:\n- Keep this line.'],
    ['a paragraph that was only the claim', 'First paragraph.\n\nNo most-sensitive assumption was measurable.\n\nLast paragraph.', 'First paragraph.\n\nLast paragraph.'],
    ['after closing markdown', 'The nine-month deadline was not tested.** The analysis also has not established which assumption is most worth investigating.', 'The nine-month deadline was not tested.**'],
    ['a decimal is not a sentence end', 'If churn is above 4.1%, the chance falls; it is unclear which assumption matters most.', 'If churn is above 4.1%, the chance falls.'],
  ])('%s', (_name, input, expected) => {
    const out = removeDriverAbsenceClaims(input);
    expect(out.text).toBe(expected);
    expect(out.removed).toBeGreaterThan(0);
    expectWellFormed(out.text);
  });
});

describe('wiring: both Agent exits apply the edit after the leader egress', () => {
  it('live final and replay exits call it on the readback this turn ships', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    const live = route.indexOf("exitPath: 'agent_lane_v1_final',\n        ...(turnId");
    expect(live).toBeGreaterThan(route.indexOf("exitPath: 'agent_lane_v1_final',\n        scopeAuthorityUnavailable"));
    expect(route.slice(live - 200, live)).toContain('withoutDriverAbsenceClaimsAtEgress(wireBody, {');
    expect(route).toContain("return withoutDriverAbsenceClaimsAtEgress(enforceLeaderLicenceAtFinalEgress(replayBody, {");
    expect(route).toContain("analysisResult: state.analysisResult, graph: state.graph ?? null, requestId: String(req.id), exitPath: 'agent_lane_v1_replay',");
  });
});

describe('S2 review r1 #2 (DL ruling): never remove a figure, label, deadline or lead-in content; unsafe → kept + logged', () => {
  it.each([
    ['dash after a figure', '- Launch starter tier: about 52%—the run does not establish which assumption matters most.', '- Launch starter tier: about 52%.'],
    ['dash after a chance', 'The chance is about 46%—the run does not establish which assumption matters most.', 'The chance is about 46%.'],
    ['spaced dashes both sides', 'Robustness is low — the run does not establish which assumption matters most — so treat this as provisional.', 'Robustness is low — so treat this as provisional.'],
    ['comma-less "and" after the deadline', 'The nine-month deadline was not tested and the run does not establish which assumption matters most.', 'The nine-month deadline was not tested.'],
    ['comma-less "and" after a disclosure', 'Six values came from Olumi and sensitivity has not established which assumption matters most.', 'Six values came from Olumi.'],
    ['a bold lead-in left empty drops its line', 'Intro line.\n- **Sensitivity:** the run does not establish which assumption matters most.\n- Keep this line.', 'Intro line.\n- Keep this line.'],
    ['a plain lead-in left empty drops its line', 'First paragraph.\n\nIn short: the run does not establish which assumption matters most.', 'First paragraph.'],
  ])('%s', (_name, input, expected) => {
    const out = removeDriverAbsenceClaims(input);
    expect(out.text).toBe(expected);
    expect(out.removed).toBe(1);
    expect(out.keptUnsafe).toBe(0);
    expectWellFormed(out.text);
  });

  it.each([
    ['comma before the claim with no connector', 'Although robustness is low, it is unclear which assumption matters most.'],
    ['a comma inside the subject', 'Sensitivity, unfortunately, has not established which assumption matters most.'],
    ['a figure inside the clause', 'The run does not establish which assumption matters most in 3 of 5 runs.'],
    ['the deadline inside the clause', 'The run does not establish which assumption matters most within the nine-month deadline.'],
    ['an option label inside the clause', 'The run does not establish which assumption matters most for Raise prices.'],
    ['a lead-in with another sentence on its line', '**Sensitivity:** the run does not establish which assumption matters most. Robustness is low.'],
  ])('KEPT, never cut unsafely: %s', (_name, input) => {
    const out = removeDriverAbsenceClaims(input, ['Raise prices']);
    expect(out.text).toBe(input);
    expect(out.removed).toBe(0);
    expect(out.keptUnsafe).toBe(1);
  });

  it('a reply that is ONLY the denial is shipped as written and logged kept_unsafe (code + turn id, no prose)', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never);
    const only = { ...PROD, assistant_text: 'The analysis has not measured which assumption matters most to the comparison.' };
    expect(withoutDriverAbsenceClaimsAtEgress(only, opts(only))).toBe(only);
    expect(warn).toHaveBeenCalledTimes(1);
    const [fields] = warn.mock.calls[0]! as [Json];
    expect(fields).toEqual({ event: 'agent_lane.goal_chance_driver_absence_kept_unsafe', code: 'GOAL_CHANCE_DRIVER_ABSENCE_KEPT_UNSAFE',
      turn_id: 'turn-s2', request_id: 'req-s2', exit_path: 'agent_lane_v1_final', kept_count: 1 });
    expect(JSON.stringify(warn.mock.calls)).not.toContain('has not measured');
  });
});

describe('S2 review r1 #5: the reviewer’s paraphrase misses fire; its near-misses do not', () => {
  it.each([
    'It remains unclear which of the assumptions matters most.',
    'Which of these assumptions matters most is still unknown.',
    'The most influential assumption has not been identified.',
    'No assumption has been identified as the most important.',
    'We don’t yet know which assumption is the biggest driver.',
    'The run does not establish the most important assumption.',
    'This run doesn’t tell us what matters most.',
    'Nothing in this run shows which assumption matters most.',
    'None of the assumptions stands out as the main driver.',
  ])('fires and leaves nothing: %s', (sentence) => {
    expect(DRIVER_ABSENCE_CLAIM.test(sentence)).toBe(true);
    expect(removeDriverAbsenceClaims(sentence).text).toBe('');
  });
  it.each([
    'We have not established which supplier matters most.',
    'I can’t tell which assumption you meant.',
    'I don’t know which factor the 4% refers to.',
    'We can’t tell what matters most to you between them.',
  ])('does not fire: %s', (sentence) => {
    expect(DRIVER_ABSENCE_CLAIM.test(sentence)).toBe(false);
  });
});

describe('the provisional view’s reasoning, shown beneath the reply, is held to the same rule', () => {
  // SERVED, verbatim: acceptance-successor-20261005/final/g1-2644/draft-4/wire/turn-003-1791269318680.json
  // (_agent.provisional_view.reasoning). 8 of 93 distinct served reasonings carry the claim (measured 7 Oct).
  const SERVED_REASONING = 'Your brief already supplies 2 customers lost per 1% price rise and £300/month lost per customer, yet this run cannot use that relationship to test the target. Four values behind the comparison are Olumi’s assumptions, not your figures; the analysis has not established which assumption matters most.';
  it('RED at e6327125: only the clause goes from the reasoning; the reply and every other field are unchanged', () => {
    const body = clone(PROD);
    body._agent.provisional_view.reasoning = SERVED_REASONING;
    const out = withoutDriverAbsenceClaimsAtEgress(body, opts(body)) as Json;
    expect(out._agent.provisional_view.reasoning).toBe(SERVED_REASONING.replace('; the analysis has not established which assumption matters most.', '.'));
    expect(out._agent.provisional_view.view).toBe(body._agent.provisional_view.view);
    expect(out.assistant_text).toBe(PROD.assistant_text.replace(PROD_CLAUSE, '.'));
  });
  it('CONTRAST: the prod view’s own reasoning ("do not establish when …") is a different claim and is untouched', () => {
    const out = withoutDriverAbsenceClaimsAtEgress(PROD, opts(PROD)) as Json;
    expect(out._agent).toBe(PROD._agent);
  });
});

describe('S2 review r2 (DL, exact fixes): each probe RED at de8a7f92 is kept + logged, or cut cleanly', () => {
  const LABELS = ['Raise prices 10%', 'Launch starter tier', 'Keep pricing as it is'];
  it.each([
    ['#1 a lead-in naming an option (numbered)', '1. Raise prices 10%: the run does not establish which assumption matters most.'],
    ['#1 a bold lead-in naming an option', '- **Launch starter tier:** the run does not establish which assumption matters most.'],
    ['#1 a lead-in holding a month and figure', 'By month 9: the run does not establish which assumption matters most.'],
    ['#1 a lead-in holding a chance', 'Chance 46%: the run does not establish which assumption matters most.'],
    ['#1 a quoted option lead-in', '‘Launch starter tier’: the run does not establish which assumption matters most.'],
    ['#2 an option label in another case', 'The run does not establish which assumption matters most for launch starter tier.'],
    ['#3 a month name', 'The run does not establish which assumption matters most by March.'],
    ['#4 noun "and" in the subject', 'The model’s estimates for price and churn have not established which assumption matters most.'],
    ['#4 "because X and Y"', 'Robustness is low because price and churn do not establish which assumption matters most.'],
    ['#4 "figures for X and Y"', 'Olumi’s own figures for starter subscribers and starter price do not show which assumption matters most.'],
    ['#4 "runs on X and Y"', 'The sensitivity runs on price and churn could not identify which factor matters most.'],
    ['#4 "while" inside the subject', 'The test run while you were away did not establish which assumption matters most.'],
    ['#5 a ", which" tail with nothing before the claim', 'The run does not establish which assumption matters most, which limits what we can say.'],
  ])('KEPT + logged: %s', (_name, input) => {
    const out = removeDriverAbsenceClaims(input, LABELS);
    expect(out).toEqual({ text: input, removed: 0, keptUnsafe: 1 });
  });
  it('#5 ", which" closes the claim when a clause stands before it', () => {
    const out = removeDriverAbsenceClaims('Sensitivity was not measured, so the run does not establish which assumption matters most, which limits what we can say.');
    expect(out.text).toBe('Sensitivity was not measured, which limits what we can say.');
    expectWellFormed(out.text);
  });
  it('#3 CONTROL: the modal "may" is not a month (lower case)', () => {
    expect(removeDriverAbsenceClaims('Prices may rise; the run does not establish which assumption matters most.').text).toBe('Prices may rise.');
  });
});

/**
 * Wave B pilot (7 Oct 02:26Z, guest T1b, CEE 86ccaf3, UI d16ccc87): `waveB-pilot-t1b-86ccaf3-turn003.json` is the Run
 * narration turn, keys untouched. It said "Sensitivity of the option comparison has not been measured." while its own
 * robustness record held a CRITICAL fragile link (switch 0.86) and the screen showed "Tipping point: Existing-plan price
 * rise". DL ruling: the claim is false whenever the Run's robustness was computed (fragile or not); kept when absent.
 */
const PILOT = JSON.parse(fixture('waveB-pilot-t1b-86ccaf3-turn003.json')) as Json;
const PILOT_CLAIM = ' Sensitivity of the option comparison has not been measured.';

describe('Wave B pilot, keys untouched: a Run whose robustness check ran never says sensitivity was not measured', () => {
  it('RED at base: only the claim goes; figures, deadline line, Olumi-values sentence and every other key unchanged', () => {
    expect(PILOT.assistant_text.endsWith(`not you.${PILOT_CLAIM}`)).toBe(true);
    const r = blockOf(PILOT).enrichment.robustness;
    expect(r.fragile_edges[0]).toMatchObject({ edge_id: 'existing_plan_price_rise->monthly_recurring_revenue', severity: 'critical' });
    expect(robustnessComputed(blockOf(PILOT))).toBe(true);
    const out = withoutDriverAbsenceClaimsAtEgress(PILOT, opts(PILOT)) as Json;
    expect(out.assistant_text).toBe(PILOT.assistant_text.replace(PILOT_CLAIM, ''));
    for (const kept of ['about 51%', 'less than 1%', "This model doesn't yet say whether any option gets there within 9 months.",
      'These results depend partly on six values supplied by Olumi, not you.']) expect(out.assistant_text).toContain(kept);
    expect(SENSITIVITY_ABSENCE_CLAIM.test(out.assistant_text)).toBe(false);
    expectWellFormed(out.assistant_text);
    expect({ ...out, assistant_text: PILOT.assistant_text }).toEqual(PILOT);
  });

  it('computed with NO fragile link is still computed: the claim goes', () => {
    const robust = clone(PILOT);
    Object.assign(blockOf(robust).enrichment.robustness, { fragile_edges: [], is_robust: true, display_verdict: 'robust', level: 'high' });
    expect(robustnessComputed(blockOf(robust))).toBe(true);
    expect((withoutDriverAbsenceClaimsAtEgress(robust, opts(robust)) as Json).assistant_text).toBe(PILOT.assistant_text.replace(PILOT_CLAIM, ''));
  });

  it.each([
    ['absent', (r: Json) => { delete r.robustness; }],
    ['empty object', (r: Json) => { r.robustness = {}; }],
    ['no fragile_edges array', (r: Json) => { delete r.robustness.fragile_edges; }],
    ['an array but no verdict', (r: Json) => { r.robustness = { fragile_edges: [] }; }],
  ])('CONTROL robustness %s: not computed, the sentence stays, by reference', (_name, strip) => {
    const body = clone(PILOT);
    strip(blockOf(body).enrichment);
    expect(robustnessComputed(blockOf(body))).toBe(false);
    expect(withoutDriverAbsenceClaimsAtEgress(body, opts(body))).toBe(body);
  });

  it('one log line by code and turn id, never prose', () => {
    const warn = vi.spyOn(log, 'warn').mockImplementation(() => undefined as never);
    withoutDriverAbsenceClaimsAtEgress(PILOT, opts(PILOT));
    expect(warn).toHaveBeenCalledTimes(1);
    expect((warn.mock.calls[0]! as [Json])[0]).toEqual({ event: 'agent_lane.sensitivity_absence_removed', code: SENSITIVITY_ABSENCE_REMOVED,
      turn_id: 'turn-s2', request_id: 'req-s2', exit_path: 'agent_lane_v1_final', removed_count: 1 });
    expect(JSON.stringify(warn.mock.calls)).not.toMatch(/Sensitivity of|six values|Raise prices/);
  });

  // DL ruling 2: every paraphrase form, each with its edited text (author-written paraphrases, labelled as such).
  it.each([
    ['Six values are Olumi’s, not yours. Sensitivity of the option comparison has not been measured.', 'Six values are Olumi’s, not yours.'],
    ['The deadline was not tested, and sensitivity was not measured.', 'The deadline was not tested.'],
    ['Sensitivity hasn’t been assessed, and the deadline was not tested.', 'The deadline was not tested.'],
    ['Olumi did not run a sensitivity analysis, so treat this as a first pass.', 'Treat this as a first pass.'],
    ['There was no sensitivity analysis; the deadline was not tested.', 'The deadline was not tested.'],
    ['Robustness and sensitivity were not assessed, and seven values are Olumi’s.', 'Seven values are Olumi’s.'],
    ['The run has not measured sensitivity, so read the figures as provisional.', 'Read the figures as provisional.'],
    ['Sensitivity remains untested, but the figures are recorded.', 'The figures are recorded.'],
    ['Figures are provisional; decision sensitivity was not measured.', 'Figures are provisional.'],
    ['Figures are provisional.\n- Sensitivity not measured.\n- The deadline was not tested.', 'Figures are provisional.\n- The deadline was not tested.'],
  ])('MUST FIRE (paraphrase): %s', (text, edited) => {
    expect(SENSITIVITY_ABSENCE_CLAIM.test(text)).toBe(true);
    const out = removeSensitivityAbsenceClaims(text);
    expect(out).toEqual({ text: edited, removed: 1, keptUnsafe: 0 });
    expectWellFormed(out.text);
  });

  it.each([
    'We have not measured the starter tier’s revenue.',
    'Customers’ price sensitivity has not been measured.',
    'Price sensitivity was not measured in your data.',
    'Sensitivity to the price rise has not been tested against your deadline.',
    'The nine-month deadline was not tested.',
    'Sensitivity was measured: the comparison turns on the price rise.',
    'The robustness check flagged the price-rise link as sensitive.',
    'We have not assessed the churn figure.',
    'Demand sensitivity is unmeasured, so the figure is Olumi’s estimate.',
    'Our price-sensitivity has not been measured.',
  ])('MUST NOT FIRE (twin): %s', (text) => {
    expect(SENSITIVITY_ABSENCE_CLAIM.test(text)).toBe(false);
    expect(removeSensitivityAbsenceClaims(text)).toEqual({ text, removed: 0, keptUnsafe: 0 });
  });

  it('kept-unsafe rules unchanged: a span holding the deadline is kept and counted', () => {
    const text = 'Figures are provisional. Sensitivity has not been measured within the 9 months.';
    expect(removeSensitivityAbsenceClaims(text)).toEqual({ text, removed: 0, keptUnsafe: 1 });
  });

  // DL ruling 3: S2's full served corpus replayed with BOTH gates on. Base = staging 86ccaf3f (driver class only).
  // Exactly these 16 sentences change, each losing only its sensitivity/robustness-absence clause; 0 unintended diffs.
  const CHANGED: ReadonlyArray<[string, string]> = [
    ['Sensitivity was not measured, and no tipping point was evaluated.', 'No tipping point was evaluated.'],
    ['This first pass cannot put an option forward: it rests on unvalidated Olumi assumptions, and sensitivity has not been measured.', 'This first pass cannot put an option forward: it rests on unvalidated Olumi assumptions.'],
    ['The nine-month deadline remains untested.** Factor sensitivity was not measured, so this result does not establish which assumption deserves investigation first.', 'The nine-month deadline remains untested.**'],
    ['Three underlying values are Olumi’s assumptions, not yours; sensitivity was not measured, so investigation priority is not established.', 'Three underlying values are Olumi’s assumptions, not yours.'],
    ['Sensitivity has not been measured, and the nine-month deadline was not tested.', 'The nine-month deadline was not tested.'],
    ['The nine-month deadline was not tested; sensitivity and robustness were not assessed.', 'The nine-month deadline was not tested.'],
    ['The model also does not test the nine-month deadline, and sensitivity has not been measured.', 'The model also does not test the nine-month deadline.'],
    ['Sensitivity was not measured, and the 9-month deadline was not tested.', 'The 9-month deadline was not tested.'],
    ['Seven input values were supplied by Olumi, not you; sensitivity was not measured, so investigation priority is not established.', 'Seven input values were supplied by Olumi, not you.'],
    ['Four underlying values were supplied by Olumi, not you; sensitivity was not measured, so this run does not establish which assumption matters most.', 'Four underlying values were supplied by Olumi, not you.'],
    ['Eight underlying values were supplied by Olumi, not you; sensitivity was not measured, so investigation priority is not established.', 'Eight underlying values were supplied by Olumi, not you.'],
    ['The run also does not test your nine-month deadline, and decision sensitivity was not measured.', 'The run also does not test your nine-month deadline.'],
    ['But the run does not test your nine-month deadline, and sensitivity was not measured.', 'But the run does not test your nine-month deadline.'],
    ['All three options were analysed, but the nine-month deadline was not tested, and sensitivity was not measured.', 'All three options were analysed, but the nine-month deadline was not tested.'],
    ['Sensitivity and robustness were not assessed, and seven underlying values were supplied by Olumi rather than you.', 'Seven underlying values were supplied by Olumi rather than you.'],
    ['Robustness and sensitivity were not assessed, and seven underlying values are Olumi’s assumptions, not yours.', 'Seven underlying values are Olumi’s assumptions, not yours.'],
  ];
  it('corpus replay: exactly the 16 listed sentences change, as listed; every other row is byte-identical to base', () => {
    const changed = new Map(CHANGED);
    let n = 0;
    for (const row of CORPUS.rows) {
      const base = removeDriverAbsenceClaims(row.sentence).text;
      const sens = removeSensitivityAbsenceClaims(base);
      const final = sens.removed > 0 && sens.text !== '' ? sens.text : base;
      if (changed.has(row.sentence)) { n += 1; expect(final).toBe(changed.get(row.sentence)); expectWellFormed(final); }
      else expect(final).toBe(base);
    }
    expect(n).toBe(16);
  });
});
