/**
 * ⭐ S2 THE USER'S OWN OCCURRENCE (DL 21:15Z 14 Oct; AIE AMEND 6179240850), on the served hiring post3007 graph (its one risk,
 * ‘Code quality deterioration’, a root with no level; the goal's window 3 months from today). Olumi asks "How likely is ‘Code
 * quality deterioration’ to happen at least once within 3 months?"; the user answers "I’d say there’s about a 30% chance it slips
 * within the next 3 months." → ONE card quoting it → the press → THEIR estimate (30% within 3 months, `basis: 'user'`) with their
 * complete statement kept beside it; readiness stops asking. Real capabilities, real writer, real readiness, the ONE shared
 * occurrence reader; only the read route and the level door's store are doubled.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyRiskOccurrenceEdit, riskOccurrenceAskWords, riskOccurrenceGoalSubject, riskOccurrenceIsCurrent, type ApprovedRiskOccurrence } from '../risk-occurrence.js';
import { occurrenceBoundTo, typedOccurrenceArgs } from '../risk-occurrence-statement.js';
import { approvalChipsFor } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, any>;
const G = (JSON.parse(readFileSync('tests/fixtures/risk-occurrence/served-hiring-post3007-read01-20261014.json', 'utf8')) as Rec).body.graph as Rec;
const RISK = 'code_quality_deterioration';
const LABEL = 'Code quality deterioration';
const ASKED = `The analysis can’t run yet. ${riskOccurrenceAskWords(LABEL, 3)}`;
const SAID = 'I’d say there’s about a 30% chance it slips within the next 3 months.';
const riskOf = (g: Rec, id = RISK): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
/** The same model with a second risk root the user could be talking about. */
const withAttrition = (): Rec => {
  const g = structuredClone(G);
  g.nodes.push({ id: 'key_developer_attrition', kind: 'risk', label: 'Key developer attrition', provenance: 'ai_inferred' });
  g.edges.push({ from: 'key_developer_attrition', to: 'productivity', strength: { mean: -0.2, std: 0.1 }, exists_probability: 0.7, effect_direction: 'negative' });
  return g;
};
const EFFECT = 'its effect on ‘Productivity’ is still Olumi’s placeholder, not yet sized';
const CARD = `From your message: “${SAID}”. Olumi reads this as your estimate of about 30% that ‘${LABEL}’ happens at least once within the next 3 months `
  + `from today. Record this reading? How strongly it affects ‘Productivity’ is a separate assumption: ${EFFECT}.`;
const RECEIPT = `Recorded your estimate: about 30% that ‘${LABEL}’ happens at least once within the next 3 months from today. `
  + 'Its effect on ‘Productivity’ is still Olumi’s placeholder, not yet sized.';
const USERS = { version: 1, occurrence: { p_low: 0.3, p_high: 0.3, meaning: 'at_least_once_within_horizon', basis: 'user' }, horizon: { months: 3 } };

function world(initial: Rec = G) {
  let g = structuredClone(initial);
  let commits = 0;
  const store = new ProposalStore();
  const caps = createAgentCapabilities(async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(g), graph_hash: computeAnalysisAffectingGraphHash(g as never) } };
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    throw new Error(path);
  }, store, undefined, 'full', undefined, { commitOptionLevels: async (input) => {
    commits += 1;
    const r = applyRiskOccurrenceEdit(g, input.risk_occurrence!);
    if (r.kind !== 'mutated') return { status: 'refused', reason: r.kind === 'refused' ? r.reason : r.kind } as never;
    g = r.mutatedGraph as Rec;
    return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(g as never)!, already_applied: false, committed_levels: [], links_resized: [], receipt: null } as never;
  } });
  return { caps, store, graph: () => g, commits: () => commits };
}
/** The user's typed words this turn, answering Olumi's previous reply (`preceding_assistant_text`, bound by the route). */
const ctx = (said: string, extra: Rec = {}): Rec => ({ scenario_id: 'dc4e09b6-3727-4b14-a3af-dceef435b7d9', authenticated_user_id: null, request_id: 'r',
  turn_id: 't', user_text: said, user_turn_text: said, preceding_assistant_text: ASKED, ...extra });
const stated = (quote: string, label = LABEL): Rec => ({ assumptions: [{ factor_label: label, value: 30, unit: '%', basis: '', user_stated: true,
  statements: [{ quote }] }] });
const asks = (g: Rec, id = RISK): string[] => (((buildCanonicalAnalysisReadyFromGraph(g) as Rec).readiness_issues ?? []) as Rec[])
  .filter((i) => i.code === 'MISSING_FACTOR_LEVEL' && i.factor_id === id).map((i) => i.message as string);

describe('S2: the user’s own chance for a risk, recorded as theirs from their words (AIE 6179240850)', () => {
  it('PRECONDITION (as served): the risk asks its chance within the goal’s window, and the user’s figure had no door (not a factor)', async () => {
    expect(asks(G)[0]).toContain(riskOccurrenceAskWords(LABEL, 3));
    const bare = await world().caps.proposeAssumptions(ctx(SAID) as never,
      { assumptions: [{ factor_label: LABEL, value: 30, unit: '%', basis: '', user_stated: true }] } as never) as Rec;
    expect(bare).toMatchObject({ ok: false, refusal: 'nothing_to_adopt', not_a_factor: [{ label: LABEL, kind: 'risk' }] });
  });

  it('RED→GREEN: their answer to Olumi’s question → ONE card in the AIE’s words → the press → THEIR estimate and statement; the ask closes', async () => {
    const w = world();
    const card = await w.caps.proposeAssumptions(ctx(SAID) as never, stated(SAID) as never) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false, risk_stated_occurrence: { risk: LABEL, chance_low_percent: 30, chance_high_percent: 30, within_months: 3 } });
    expect(card.public_label).toBe(CARD);
    expect(await w.caps.authoriseChange(ctx('Yes') as never, { proposal_id: String(card.proposal_id) })).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(w.commits()).toBe(0);
    const res = await w.caps.authoriseChange({ ...ctx('Yes, record what I said.'), typed_approval_of: String(card.proposal_id),
      typed_approval_words: 'Yes, record what I said.' } as never, { proposal_id: String(card.proposal_id) }) as Rec;
    expect(res).toMatchObject({ ok: true, applied: true, follow_up: RECEIPT });
    expect(riskOf(w.graph()).event_risk).toEqual(USERS);
    // Their complete statement is kept beside the block (source, speaker, qualifier, period), for reopen and read-back.
    expect(riskOf(w.graph()).occurrence_statement).toMatchObject({ speaker: 'user', quote: SAID, source: SAID, form: 'point', low: 30, high: 30,
      qualifier: 'about', period: '3 months', subject: { quantity: 'risk_occurrence', node_id: RISK } });
    expect(asks(w.graph())).toEqual([]);
    expect(w.commits()).toBe(1);
  });

  it('AMEND: “before launch” is never the goal’s window; the one remaining risk is never proof of “it”; words, selection or Olumi’s question bind', async () => {
    const w = world();
    const launch = 'I’d say there’s about a 30% chance it slips before launch.';
    const r = await w.caps.proposeAssumptions(ctx(launch) as never, stated(launch) as never) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'occurrence_other_window' });
    expect(r.detail).toContain('ask only which time span it covers');
    expect(typedOccurrenceArgs(G, launch, { preceding_ask: ASKED })).toBeUndefined();
    // No question asked and no name: the only unsized risk is NOT bound by elimination.
    expect(await w.caps.proposeAssumptions(ctx(SAID, { preceding_assistant_text: 'Your results are ready.' }) as never, stated(SAID) as never))
      .toMatchObject({ ok: false, refusal: 'occurrence_not_this_risk' });
    expect(typedOccurrenceArgs(G, SAID)).toBeUndefined();
    expect(occurrenceBoundTo(G, RISK, SAID, { preceding_ask: ASKED })).toBe('bound');
    expect(occurrenceBoundTo(G, RISK, SAID, { selection: { element_ids: [RISK], unresolved: 'none' } })).toBe('bound');
    expect(occurrenceBoundTo(G, RISK, 'There’s about a 30% chance code quality deterioration happens within the next 3 months.')).toBe('bound');
    expect(typedOccurrenceArgs(G, `Thanks. ${SAID}`, { preceding_ask: ASKED })).toEqual(stated(SAID));
    expect(w.commits()).toBe(0);
  });

  it('T1H r4-neg: a CHANCE sent as holds-now takes the chance path, never holds-now; “before launch” then asks only its time span', async () => {
    const holdsNow = (quote: string): Rec => ({ assumptions: [{ factor_label: LABEL, value: 0, unit: '', basis: '', user_stated: true, holds_now: { quote } }] });
    const t1h = 'Code quality isn\u2019t slipping today; I\u2019d say there\u2019s about a 30% chance it slips before launch.';
    const w = world();
    const r = await w.caps.proposeAssumptions(ctx(t1h) as never, holdsNow(t1h) as never) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'occurrence_other_window' });
    expect(r.detail).toContain('ask only which time span it covers');
    expect(w.commits()).toBe(0);
    // With its window stated, the same act is the chance card, quoting their words.
    const windowed = 'Code quality isn\u2019t slipping today; I\u2019d say there\u2019s about a 30% chance it slips within the next 3 months.';
    const card = await w.caps.proposeAssumptions(ctx(windowed) as never, holdsNow(windowed) as never) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, risk_stated_occurrence: { chance_low_percent: 30, within_months: 3 } });
    expect(card).not.toHaveProperty('risk_holds_now');
    expect(String(card.public_label)).toContain(`From your message: “${windowed}”. Olumi reads this as your estimate of about 30%`);
    // CONTRAST (kept): a condition the user says holds now is still the holds-now card.
    const now = 'Honestly, our code quality is already slipping.';
    expect(await world().caps.proposeAssumptions(ctx(now) as never, holdsNow(now) as never)).toMatchObject({ ok: true, risk_holds_now: { quote: now } });
  });

  it('CONTRAST: a figure about ANOTHER risk is refused for this one, even after Olumi asked about this one; the route gives it to the risk it names', async () => {
    const g = withAttrition();
    const other = 'I’d say there’s about a 30% chance of key developer attrition within the next 3 months.';
    expect(occurrenceBoundTo(g, RISK, other, { preceding_ask: ASKED })).toBe('another');
    const w = world(g);
    const r = await w.caps.proposeAssumptions(ctx(other) as never, stated(other) as never) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'occurrence_not_this_risk' });
    expect(typedOccurrenceArgs(g, other, { preceding_ask: ASKED })).toEqual(stated(other, 'Key developer attrition'));
    expect(w.commits()).toBe(0);
  });

  it('the window: theirs and the goal’s from today only; a year, a launch-relative goal window, or no window is refused with its reason', async () => {
    const year = 'I’d say there’s about a 30% chance it slips within a year.';
    expect(await world().caps.proposeAssumptions(ctx(year) as never, stated(year) as never)).toMatchObject({ ok: false, refusal: 'occurrence_other_window' });
    const afterLaunch = structuredClone(G); goalOf(afterLaunch).goal_target_basis = { ...goalOf(afterLaunch).goal_target_basis, reference: 'launch' };
    expect(await world(afterLaunch).caps.proposeAssumptions(ctx(SAID) as never, stated(SAID) as never)).toMatchObject({ ok: false, refusal: 'occurrence_other_window' });
    const conflict = structuredClone(G); goalOf(conflict).goal_horizon_months = 6;
    const c = await world(conflict).caps.proposeAssumptions(ctx(SAID) as never, stated(SAID) as never) as Rec;
    expect(c).toMatchObject({ ok: false, refusal: 'occurrence_not_recordable' });
    expect(c.detail).toContain('because the goal does not have one clear time window yet');
  });

  it('never a negated, conditional, zero, unverified or partial reading; Olumi’s range is never offered for a chance the user just gave', async () => {
    const w = world(), before = JSON.stringify(w.graph());
    for (const words of ['There’s a 30% chance it won’t slip within the next 3 months.',
      'There’s a 30% chance it slips within the next 3 months if we hire two developers.']) {
      expect(await w.caps.proposeAssumptions(ctx(words) as never, stated(words) as never), words).toMatchObject({ ok: false, refusal: 'occurrence_not_stated' });
    }
    const zero = 'There’s a 0% chance it slips within the next 3 months.';
    const z = await w.caps.proposeAssumptions(ctx(zero) as never, stated(zero) as never) as Rec;
    expect(z).toMatchObject({ ok: false, refusal: 'occurrence_not_stated' });
    expect(z.detail).toContain('Do not replace it with another figure');
    expect(await w.caps.proposeAssumptions(ctx('Please record it.', { user_text: 'Please record it.', unverified_user_text: SAID }) as never, stated(SAID) as never))
      .toMatchObject({ ok: false, refusal: 'origin_unknown' });
    expect(await w.caps.proposeAssumptions(ctx(SAID) as never, stated('a 30% chance it slips within the next 3 months.') as never))
      .toMatchObject({ ok: false, refusal: 'occurrence_not_stated' });
    const olumis = await w.caps.proposeAssumptions(ctx(SAID) as never, { assumptions: [{ factor_label: LABEL, value: 30, unit: '%', basis: 'Launch pressure.',
      user_stated: false, occurrence_range: { low_percent: 20, high_percent: 40 } }] } as never) as Rec;
    expect(olumis).toMatchObject({ ok: false, refusal: 'occurrence_is_the_users' });
    expect(olumis.detail).toContain('The user has supplied a risk estimate, so no replacement Olumi estimate was prepared.');
    expect(JSON.stringify(w.graph())).toBe(before);
    expect(w.commits()).toBe(0);
    // CONTRAST (kept): with no chance of theirs in this turn, Olumi's labelled range is still offered.
    expect(await w.caps.proposeAssumptions(ctx('Can you suggest a starting estimate?') as never, { assumptions: [{ factor_label: LABEL, value: 30, unit: '%',
      basis: 'Launch pressure.', user_stated: false, occurrence_range: { low_percent: 20, high_percent: 40 } }] } as never)).toMatchObject({ ok: true, risk_assumption: { olumis_estimate: true } });
  });

  it('AMEND: their estimate keeps its OWN window: after the goal’s window moves it is retained, never applied to the new window', async () => {
    const w = world();
    const card = await w.caps.proposeAssumptions(ctx(SAID) as never, stated(SAID) as never) as Rec;
    await w.caps.authoriseChange({ ...ctx('Yes, record what I said.'), typed_approval_of: String(card.proposal_id) } as never, { proposal_id: String(card.proposal_id) });
    const moved = structuredClone(w.graph());
    goalOf(moved).goal_target_basis = { ...goalOf(moved).goal_target_basis, period_months: 6 };
    expect(riskOccurrenceIsCurrent(riskOf(moved), moved)).toBe(false);
    expect(riskOf(moved).event_risk).toEqual(USERS);
    expect(riskOf(moved).occurrence_statement.quote).toBe(SAID);
    expect(asks(moved)).toHaveLength(1);
    // CONTRAST: unmoved, it is current.
    expect(riskOccurrenceIsCurrent(riskOf(w.graph()), w.graph())).toBe(true);
  });

  it('the writer: a user block only with ITS statement of THIS risk, exactly as stated; the button records, never “use Olumi’s”', async () => {
    const statement = { speaker: 'user', quote: SAID, source: SAID, subject: { quantity: 'risk_occurrence', node_id: RISK }, form: 'point', low: 30, high: 30,
      unit: '%', qualifier: 'about', reading: 'olumi' } as never;
    const approved = (extra: Partial<ApprovedRiskOccurrence>): ApprovedRiskOccurrence => ({ risk_id: RISK, event_risk: USERS as never,
      expected_node: structuredClone(riskOf(G)), goal_id: 'productivity', expected_goal: riskOccurrenceGoalSubject(G, 'productivity')!, ...extra });
    expect(applyRiskOccurrenceEdit(G, approved({}))).toEqual({ kind: 'refused', reason: 'invalid_block' });
    expect(applyRiskOccurrenceEdit(G, approved({ stated_occurrence: { ...(statement as Rec), subject: { quantity: 'risk_occurrence', node_id: 'other' } } as never })))
      .toEqual({ kind: 'refused', reason: 'invalid_block' });
    expect(applyRiskOccurrenceEdit(G, approved({ stated_occurrence: { ...(statement as Rec), low: 25, high: 25 } as never }))).toEqual({ kind: 'refused', reason: 'invalid_block' });
    expect(applyRiskOccurrenceEdit(G, approved({ stated_occurrence: statement }))).toMatchObject({ kind: 'mutated', confirmation: RECEIPT });
    const w = world();
    const card = await w.caps.proposeAssumptions(ctx(SAID) as never, stated(SAID) as never) as Rec;
    const chips = approvalChipsFor([{ name: 'propose_assumptions', ok: true, mutated: false, proposal_id: String(card.proposal_id) }],
      (id) => ({ proposal: w.store.get(id), result: card as never }));
    expect(chips[0]).toMatchObject({ label: 'Record what you said', message: 'Yes, record what I said.', detail: CARD });
  });
});
