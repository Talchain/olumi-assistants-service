/**
 * ⭐ AIE 6184726873 (DL AMEND 04:59Z): a likely range is two ends that the analysis reads with Olumi's equal-tail approximation
 * (ISL samples it as the quartiles of a lognormal). No writer elicits that law, so a chance resting on a person's range is WITHHELD,
 * with the AIE's face, until that approximation is adopted by the press of a card that shows it whole (`RANGE_LAW_ROW`). The card
 * is offered as the next step by the ONE route issuer; its press records the adoption (ends theirs, law Olumi's), and the chance
 * shows. An independent output that does not rest on the range is kept. Two served briefs:
 *  · pricing (scenario 5e0fbc03, CEE f8ed674d; the `b2-zero-spread` lane bytes): the brief's "between 80 and 250" new subscribers on
 *    'Launch starter tier', on the goal's path: the GOAL CHANCE;
 *  · cloud migration (R3 r1, `b6-cloud-r1-20260930`): the user's "somewhere between 2 and 5 weeks" on the limited downtime that
 *    'Switch to GCP' sets: the LIMIT row.
 * The P(goal) figures are the b2 Starter-point control's derivation (no new engine draw); Raise's 0.4 is set the same way so an
 * option with no range is visible beside it.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { goalChanceLicenceOf, withGoalChanceLicence } from '../../goal-target/goal-chance-licence.js';
import { projectGoalProbabilitiesForTransport } from '../../compose/goal-probability-transport.js';
import { applyStatementRecordEdit, approvedStatementRecordOf } from '../../goal-target/cohort-forecast-write.js';
import { runFactsOf } from '../run-facts.js';
import { limitChecksForAgent } from '../limit-checks.js';
import { likelyRangeLawWords, likelyRangeUseOf, rangeLawAdopted, rangeLawSubject, rangeLawWithheldWords } from '../../intervention-range.js';
import { doorIssueArgs } from '../../statement-door/door.js';
import { readStatement } from '../../statement-door/read.js';
import { doorCardWords, DOOR_DERIVED_APPROVE } from '../../statement-door/card.js';
import { RANGE_LAW_ROW } from '../../statement-door/fields/range-law.js';
import { CONSTRUCTION_ATTEST, userStatementRecord } from '../../statement-door/statements.js';
import type { ProposalOperation } from '../proposal.js';
import { LIKELY_RANGE_LAW_NOTE, rangeLawsOfCard, STATED_RANGE_CARD_CLOSING, statedRangeAssumptionWords } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const clone = <T>(x: T): T => structuredClone(x);
const NO_TURN = { toolCalls: [], mutated: false, proposalOffered: false, heldWaiting: false };

/** The approximation card for `subject` on `graph`, pressed: its reading, its write, and the graph after the write. */
function press(graph: Rec, subject: ReturnType<typeof rangeLawSubject>, label: string, quote: string, now: string): { card: string; after: Rec } {
  const v = readStatement(graph, subject, label, [quote], { now });
  if (v.kind !== 'read') throw new Error(JSON.stringify(v));
  const w = RANGE_LAW_ROW.writer.approve(v.reading, graph);
  if ('refused' in w) throw new Error(w.refused);
  const written = applyStatementRecordEdit(graph, approvedStatementRecordOf({ path: (w.payload as Rec).node_id, value: w.payload })!);
  if (written.kind !== 'mutated') throw new Error(JSON.stringify(written));
  expect(RANGE_LAW_ROW.writer.holds(w, written.mutatedGraph)).toBe(true);
  return { card: doorCardWords(v.reading), after: written.mutatedGraph };
}

// ── pricing, served ──────────────────────────────────────────────────────────────────────────────────────────────────
const B2 = new URL('../../../routes/__tests__/fixtures/b2-zero-spread/', import.meta.url);
const RUN = JSON.parse(readFileSync(new URL('run.json', B2), 'utf8')) as Rec;
const READ = (JSON.parse(readFileSync(new URL('read-graph-1791489457020.json', B2), 'utf8')) as Rec).j as Rec;
const GOAL = 'monthly_recurring_revenue';
const STARTER = 'launch_starter_tier';
const RAISE = 'raise_prices_10';
const SUBS = 'new_starter_subscribers';
const SAID = 'The starter tier would win about 150 new subscribers, between 80 and 250.';
function envelope(): Rec {
  const e = clone(RUN.blocks.find((b: Rec) => b.type === 'analysis_result').enrichment);
  e.option_comparison.find((r: Rec) => r.option_id === 'keep_current_pricing').probability_of_goal = 0;
  e.option_comparison.find((r: Rec) => r.option_id === STARTER).probability_of_goal = 0.97;
  e.option_comparison.find((r: Rec) => r.option_id === RAISE).probability_of_goal = 0.4;
  return e;
}
const starterCell = (g: Rec): Rec => g.nodes.find((n: Rec) => n.id === STARTER).interventions[SUBS];
const STARTER_SUBJECT = rangeLawSubject(STARTER, SUBS);
const FACE = 'Chance not shown: this result uses an equal-tail approximation for ‘New starter subscribers’ in ‘Launch starter tier’ that has not '
  + 'been adopted. Your stated range remains recorded.';
const ADOPTED_LINE = '‘Launch starter tier’ uses your range for ‘New starter subscribers’, 80 subscribers to 250 subscribers, read with '
  + 'Olumi’s equal-tail approximation: about one chance in four below 80 subscribers and one in four above 250 subscribers, a modelling '
  + 'convention, not your own calibration.';

describe('the goal chance on the served pricing brief: withheld until the approximation is adopted, then shown', () => {
  it('PRECONDITION: Starter sets new starter subscribers with the brief\'s 80–250 (its own words kept on the range), not adopted', () => {
    expect(starterCell(READ.graph).range).toMatchObject({ low: 80, high: 250, meaning: 'likely_range', source: 'brief_extraction', source_quote: SAID });
    expect(likelyRangeUseOf(SUBS, starterCell(READ.graph))).toMatchObject({ low: 80, high: 250, persons_own: true, source_quote: SAID });
    expect(rangeLawAdopted(READ.graph, STARTER, { factor_id: SUBS, low: 80, high: 250 })).toBe(false);
    expect(rangeLawWithheldWords('New starter subscribers', 'Launch starter tier')).toBe(FACE);
  });

  it('RED: Starter\'s chance is withheld with the AIE\'s face; Raise (no range on its path) keeps its chance; no leader over the set', () => {
    const l = goalChanceLicenceOf(envelope(), READ.graph, GOAL) as Rec;
    expect(l.withheld_option_ids).toContain(STARTER);
    expect(l.pct_by_option).not.toHaveProperty(STARTER);
    expect(l.withheld_reason_by_option[STARTER]).toEqual({ reason: 'range_law_unadopted', line: FACE });
    expect(l.pct_by_option[RAISE]).toBe(40);
    expect(l.form).toBe('each');
    expect(l).not.toHaveProperty('leader_option_id');
  });

  it('RED (the next step): the route issues the approximation card, quoting the brief\'s own words, shown whole, "Use this reading"', () => {
    expect(doorIssueArgs(READ.graph, null, {}, NO_TURN)).toEqual({ subject: STARTER_SUBJECT, quotes: [SAID] });
    const { card } = press(READ.graph, STARTER_SUBJECT, 'New starter subscribers', SAID, String(READ.brief_text));
    // The door's template quotes the complete line the words sit in (the brief is one line), so the brief's own range is in it.
    expect(card.startsWith('From your message: “')).toBe(true);
    expect(card.slice(0, card.indexOf('” Olumi proposes this reading:'))).toContain(SAID);
    expect(card.slice(card.indexOf('” Olumi proposes this reading:') + 2)).toBe('Olumi proposes this reading: ‘Launch starter tier’ sets ‘New starter subscribers’ with your '
      + 'stated range, 80 subscribers to 250 subscribers. Your stated range is 80 subscribers to 250 subscribers, with its qualification read as '
      + '“likely”; any other qualifications or conditions in your words were not read. Olumi proposes an equal-tail approximation, about one '
      + 'chance in four below 80 subscribers and one in four above 250 subscribers, for this analysis, based on how the analysis treats a likely '
      + 'range (as its lower and upper quarter points), a modelling convention, not evidence about this case or what “likely” means, with the '
      + 'limitation that the shape of the spread is also Olumi’s assumption: always above zero, with a longer tail on the high side. Your words '
      + 'did not specify those tail probabilities or how values are distributed. Record this reading?');
    expect(RANGE_LAW_ROW.derives).toBe(true);
    expect(DOOR_DERIVED_APPROVE).toEqual({ label: 'Use this reading', message: 'Yes, use this reading.' });
  });

  it('RED→GREEN (the press): the adoption is recorded, the ends stay the brief\'s, and Starter\'s chance shows, provisional, said once', () => {
    const { after } = press(READ.graph, STARTER_SUBJECT, 'New starter subscribers', SAID, String(READ.brief_text));
    expect(starterCell(after).range).toEqual(starterCell(READ.graph).range);
    expect(rangeLawAdopted(after, STARTER, { factor_id: SUBS, low: 80, high: 250 })).toBe(true);
    expect(doorIssueArgs(after, null, {}, NO_TURN)).toBeUndefined();
    const l = goalChanceLicenceOf(envelope(), after, GOAL) as Rec;
    expect(l.pct_by_option[STARTER]).toBe(97);
    expect(l.provisional).toBe(true);
    expect((l.notes as string[]).filter((n) => n === ADOPTED_LINE)).toHaveLength(1);
  });

  it('RED (the AI after the press): the selected Run\'s must_say carries the adopted line once, with Starter\'s point', () => {
    const { after } = press(READ.graph, STARTER_SUBJECT, 'New starter subscribers', SAID, String(READ.brief_text));
    const e = envelope();
    e.option_comparison = e.option_comparison.filter((r: Rec) => ['keep_current_pricing', STARTER].includes(r.option_id));
    e.option_comparison.find((r: Rec) => r.option_id === STARTER).outcome = { p10: 130000, p50: 140000, p90: 150000, std: 10000, mean: 140000 };
    e.option_comparison.find((r: Rec) => r.option_id === 'keep_current_pricing').outcome = { p10: 110000, p50: 120000, p90: 130000, std: 10000, mean: 120000 };
    e.inference_warnings = [];
    const published = projectGoalProbabilitiesForTransport(withGoalChanceLicence(e, after, GOAL), RUN.goal_certainty);
    const block = RUN.blocks.find((b: Rec) => b.type === 'analysis_result');
    const facts = runFactsOf({ ...block, enrichment: published }, after, true) as Rec;
    expect(facts.chances.goal_chance_display).toHaveProperty(STARTER);
    expect((facts.must_say as string[]).filter((x) => x === ADOPTED_LINE)).toHaveLength(1);
  });

  it('CONTRAST (#3207): the brief\'s sentence recorded by construction on the same setting is never an adoption', () => {
    const g = clone(READ.graph);
    const subs = g.nodes.find((n: Rec) => n.id === SUBS);
    subs.user_statements = [userStatementRecord(STARTER_SUBJECT, [{ speaker: 'user', quote: SAID, source: SAID, form: 'range', reading: 'olumi',
      low: 80, high: 250, subject: { quantity: 'level', node_id: SUBS, option_id: STARTER } }], '2026-10-15T00:00:00.000Z',
    { ...CONSTRUCTION_ATTEST, range_law: 'equal_tail', low: 80, high: 250 })];
    expect(rangeLawAdopted(g, STARTER, { factor_id: SUBS, low: 80, high: 250 })).toBe(false);
    expect((goalChanceLicenceOf(envelope(), g, GOAL) as Rec).withheld_reason_by_option[STARTER]?.reason).toBe('range_law_unadopted');
  });

  it('CONTRAST: an adoption of other ends is not this range\'s (a changed range is withheld again)', () => {
    const { after } = press(READ.graph, STARTER_SUBJECT, 'New starter subscribers', SAID, String(READ.brief_text));
    const moved = clone(after);
    starterCell(moved).range.low = 90;
    expect(rangeLawAdopted(moved, STARTER, { factor_id: SUBS, low: 90, high: 250 })).toBe(false);
    expect((goalChanceLicenceOf(envelope(), moved, GOAL) as Rec).withheld_reason_by_option[STARTER]?.reason).toBe('range_law_unadopted');
  });

  it('CONTRAST: a range Olumi wrote is Olumi\'s estimate, labelled as such (never withheld as the person\'s)', () => {
    const g = clone(READ.graph);
    starterCell(g).range.source = 'cee_hypothesis';
    const l = goalChanceLicenceOf(envelope(), g, GOAL) as Rec;
    expect(l.pct_by_option[STARTER]).toBe(97);
    expect(l.notes).toContain(ADOPTED_LINE.replace('uses your range', 'uses Olumi’s range').replace('not your own calibration', 'not a measured calibration'));
  });

  it('CONTRAST: with no range on Starter\'s setting, its chance is not withheld for one, and no card is offered', () => {
    const g = clone(READ.graph);
    delete starterCell(g).range;
    expect((goalChanceLicenceOf(envelope(), g, GOAL) as Rec).pct_by_option[STARTER]).toBe(97);
    expect(doorIssueArgs(g, null, {}, NO_TURN)).toBeUndefined();
  });
});

// ── cloud migration, served ──────────────────────────────────────────────────────────────────────────────────────────
const B6 = JSON.parse(readFileSync(new URL('../../../orchestrator/context/__tests__/fixtures/b6-cloud-r1-20260930.json', import.meta.url), 'utf8')) as {
  user_limit: { graph: Rec };
};
const LIMIT = 'agent-lane:migration_downtime:<=';
const TARGET = 'migration_downtime';
const RANGE_SAID = 'somewhere between 2 and 5 weeks';
function ranged(range: Rec | undefined): Rec {
  const g = clone(B6.user_limit.graph);
  g.nodes.find((n: Rec) => n.id === 'switch_to_gcp').interventions = { [TARGET]: { value: 0.25, raw_value: 3, unit: 'weeks', source: 'cee_hypothesis',
    ...(range !== undefined ? { range } : {}) } };
  return g;
}
const USERS_RANGE = { low: 2, high: 5, meaning: 'likely_range', source: 'user_specified', source_quote: RANGE_SAID };
const SCORED = { per_limit: [{ constraint_id: LIMIT, state: 'scored' }], joint: { state: 'scored' } } as never;
const GCP = rangeLawSubject('switch_to_gcp', TARGET);

describe('the limit row on the served cloud brief: withheld on the user\'s unadopted range, checked once it is adopted', () => {
  it('RED: Switch to GCP\'s downtime check is withheld for the unadopted approximation, never a re-ask of the range', () => {
    const [row] = limitChecksForAgent(ranged(USERS_RANGE), SCORED) ?? [];
    expect(row?.withheld_for).toEqual(['Switch to GCP']);
    expect(row?.say).toContain('For ‘Switch to GCP’ it isn’t shown: it uses an equal-tail approximation for ‘Migration downtime’ that has not been '
      + 'adopted. Your stated range remains recorded.');
    expect(row?.ask ?? '').not.toMatch(/likely range for/);
    expect(doorIssueArgs(ranged(USERS_RANGE), null, {}, NO_TURN)).toEqual({ subject: GCP, quotes: [RANGE_SAID] });
  });

  it('RED→GREEN: after the press the option is checked, and the row says the range is read with Olumi\'s approximation', () => {
    const { after } = press(ranged(USERS_RANGE), GCP, 'Migration downtime', RANGE_SAID, RANGE_SAID);
    const [row] = limitChecksForAgent(after, SCORED) ?? [];
    expect(row?.withheld_for ?? []).not.toContain('Switch to GCP');
    expect(row?.say).toContain('‘Switch to GCP’ uses your range for ‘Migration downtime’, 2 weeks to 5 weeks, read with Olumi’s equal-tail '
      + 'approximation: about one chance in four below 2 weeks and one in four above 5 weeks, a modelling convention, not your own calibration.');
  });

  it('CONTRAST: a range with another meaning (a hard min–max) is not a likely range: no approximation card or line', () => {
    const g = ranged({ ...USERS_RANGE, meaning: 'min_max' });
    expect(doorIssueArgs(g, null, {}, NO_TURN)).toBeUndefined();
    expect(limitChecksForAgent(g, SCORED)?.[0]?.say ?? '').not.toContain('equal-tail approximation');
  });
});

describe('the level card\'s press adopts only the approximation the card showed whole (`rangeLawsOfCard`)', () => {
  const op: ProposalOperation = { op: 'set_option_intervention', path: `switch_to_gcp::${TARGET}`,
    value: { normalised: 0.3, raw: 3, unit: 'weeks', likely_range: { low: 2, high: 5 }, range_quote: 'somewhere between 2 and 5 weeks' } };
  const shown = `Switch to GCP sets Migration downtime to 3 weeks${statedRangeAssumptionWords('2 weeks', '5 weeks')}. ${STATED_RANGE_CARD_CLOSING}`;
  it('RED: the template for those ends and the closing were shown → one adoption, the exact ends, the user\'s words', () => {
    const [a, ...rest] = rangeLawsOfCard({ public_label: shown, operations: [op] }, ranged(undefined));
    expect(rest).toEqual([]);
    expect(a?.user_statement.record.attest).toEqual({ range_law: 'equal_tail', low: 2, high: 5 });
    expect(a?.user_statement.record.statements[0]).toMatchObject({ speaker: 'user', quote: 'somewhere between 2 and 5 weeks', form: 'range' });
  });
  it('CONTRAST: no closing, or another range\'s template, adopts nothing', () => {
    expect(rangeLawsOfCard({ public_label: shown.replace(STATED_RANGE_CARD_CLOSING, ''), operations: [op] }, ranged(undefined))).toEqual([]);
    expect(rangeLawsOfCard({ public_label: shown.replaceAll('5 weeks', '6 weeks'), operations: [op] }, ranged(undefined))).toEqual([]);
  });
});

describe('the words are one producer', () => {
  it('likelyRangeLawWords says the ends\' owner and the law as Olumi\'s', () => {
    expect(likelyRangeLawWords('Switch to GCP', 'Migration downtime', { factor_id: TARGET, low: 2, high: 5, unit: 'weeks', persons_own: true }))
      .toBe('‘Switch to GCP’ uses your range for ‘Migration downtime’, 2 weeks to 5 weeks, read with Olumi’s equal-tail approximation: about one '
        + 'chance in four below 2 weeks and one in four above 5 weeks, a modelling convention, not your own calibration.');
  });
  it('the level card\'s tool-result note keeps the user\'s ends and Olumi\'s law apart', () => {
    expect(LIKELY_RANGE_LAW_NOTE).toContain('The two ends are the user’s.');
    expect(LIKELY_RANGE_LAW_NOTE).toContain('is Olumi’s modelling convention, adopted only by the press: never call it the user’s calibration.');
  });
});
