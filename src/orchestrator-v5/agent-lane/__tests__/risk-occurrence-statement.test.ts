/**
 * ⭐ S2 THE USER'S OWN OCCURRENCE (DL 21:15Z 14 Oct), on the served hiring post3007 graph (its one risk, ‘Code quality
 * deterioration’, a root with no level; the goal's window 3 months, "an urgent launch date in the next three months"). Their
 * statement "I'd say there's about a 30% chance it slips before launch" → ONE card quoting it → the press → the risk's chance
 * is THEIRS (30% within 3 months, `basis: 'user'`), and readiness stops asking it. Real capabilities, real writer, real
 * readiness; only the read route and the level door's store are doubled.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyRiskOccurrenceEdit, riskOccurrenceGoalSubject, userOccurrenceBlock, type ApprovedRiskOccurrence } from '../risk-occurrence.js';
import { durationMonthsIn, occurrenceGovernedBy, percentReadingsIn, typedOccurrenceArgs } from '../risk-occurrence-statement.js';
import { approvalChipsFor } from '../approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, any>;
const G = (JSON.parse(readFileSync('tests/fixtures/risk-occurrence/served-hiring-post3007-read01-20261014.json', 'utf8')) as Rec).body.graph as Rec;
const RISK = 'code_quality_deterioration';
const LABEL = 'Code quality deterioration';
const SAID = 'I’d say there’s about a 30% chance it slips before launch.';
const riskOf = (g: Rec, id = RISK): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
/** The same model with a second risk root the user could be talking about. */
const withAttrition = (): Rec => {
  const g = structuredClone(G);
  g.nodes.push({ id: 'key_developer_attrition', kind: 'risk', label: 'Key developer attrition', provenance: 'ai_inferred' });
  g.edges.push({ from: 'key_developer_attrition', to: 'productivity', strength: { mean: -0.2, std: 0.1 }, exists_probability: 0.7, effect_direction: 'negative' });
  return g;
};
const CARD = `From your message: ‘${SAID}’ Olumi reads this as your figure: a 30% chance that ‘${LABEL}’ happens at least once within 3 months, `
  + 'your goal’s time window. Do you want to record it as yours? How strongly it affects the model is a separate question, still Olumi’s placeholder on its link.';
const RECEIPT = `Recorded from your words: a 30% chance that ‘${LABEL}’ happens at least once within 3 months. `
  + 'How strongly it affects the model is still Olumi’s placeholder on its link.';
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
const ctx = (said: string, extra: Rec = {}): Rec => ({ scenario_id: 'dc4e09b6-3727-4b14-a3af-dceef435b7d9', authenticated_user_id: null, request_id: 'r',
  turn_id: 't', user_text: said, user_turn_text: said, ...extra });
const stated = (quote: string, value = 30, label = LABEL): Rec => ({ assumptions: [{ factor_label: label, value, unit: '%', basis: '', user_stated: true,
  statements: [{ quote, form: 'point', value }] }] });
const asks = (g: Rec, id = RISK): string[] => (((buildCanonicalAnalysisReadyFromGraph(g) as Rec).readiness_issues ?? []) as Rec[])
  .filter((i) => i.code === 'MISSING_FACTOR_LEVEL' && i.factor_id === id).map((i) => i.message as string);

describe('S2: the user’s own chance for a risk, recorded as theirs from their words', () => {
  it('PRECONDITION (as served): the risk asks its chance within the goal’s window, and the user’s figure had no door (not a factor)', async () => {
    expect(asks(G)).toEqual(['Is ‘Code quality deterioration’ already true now? If so, say so. If not: How likely is ‘Code quality deterioration’ to happen at least once '
      + 'within 3 months? Olumi can’t run the numbers until this risk has a figure. Or ask Olumi to suggest a starting estimate for you to review.']);
    const bare = await world().caps.proposeAssumptions(ctx(SAID) as never,
      { assumptions: [{ factor_label: LABEL, value: 30, unit: '%', basis: '', user_stated: true }] } as never) as Rec;
    expect(bare).toMatchObject({ ok: false, refusal: 'nothing_to_adopt', not_a_factor: [{ label: LABEL, kind: 'risk' }] });
  });

  it('RED→GREEN: their sentence → ONE card quoting it → the press → 30% within 3 months is THEIRS; the ask closes', async () => {
    const w = world();
    const card = await w.caps.proposeAssumptions(ctx(SAID) as never, stated(SAID) as never) as Rec;
    expect(card).toMatchObject({ ok: true, mutated: false, risk_stated_occurrence: { risk: LABEL, quote: SAID, chance_low_percent: 30, chance_high_percent: 30,
      within_months: 3, your_figure: true } });
    expect(card.public_label).toBe(CARD);
    expect(card.public_label).not.toMatch(/starting assumption|estimate/);
    expect(w.commits()).toBe(0);
    // Card-only: the Agent's reading of a yes never applies it.
    expect(await w.caps.authoriseChange(ctx('Yes') as never, { proposal_id: String(card.proposal_id) })).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(w.commits()).toBe(0);
    const res = await w.caps.authoriseChange({ ...ctx('Yes, record what I said.'), typed_approval_of: String(card.proposal_id),
      typed_approval_words: 'Yes, record what I said.' } as never, { proposal_id: String(card.proposal_id) }) as Rec;
    expect(res).toMatchObject({ ok: true, applied: true, follow_up: RECEIPT });
    expect(riskOf(w.graph()).event_risk).toEqual(USERS);
    expect(asks(w.graph())).toEqual([]);
    expect(w.commits()).toBe(1);
  });

  it('the route’s arguments: THIS turn’s one sentence for the one risk asked; a range is kept as their range', () => {
    expect(typedOccurrenceArgs(G, `Thanks. ${SAID}`)).toEqual(stated(SAID));
    const range = 'I\u2019d put the chance it slips before launch somewhere between 20 and 40%.';
    expect(typedOccurrenceArgs(G, range)).toEqual({ assumptions: [{ factor_label: LABEL, value: 20, unit: '%', basis: '', user_stated: true,
      statements: [{ quote: range, form: 'range', low: 20, high: 40 }] }] });
    expect(userOccurrenceBlock(20, 40, 3)).toEqual({ ...USERS, occurrence: { ...USERS.occurrence, p_low: 0.2, p_high: 0.4 } });
    expect(percentReadingsIn('20–40% or 25 per cent')).toEqual([{ low: 20, high: 40 }, { low: 25, high: 25 }]);
    expect(durationMonthsIn('within a year, or the next three months')).toEqual([12, 3]);
  });

  it('CONTRAST: a figure about ANOTHER risk is refused for this one, and the route gives it to the risk it names', async () => {
    const g = withAttrition();
    const other = 'I’d say there’s about a 30% chance a key developer leaves before launch.';
    expect(occurrenceGovernedBy(g, RISK, other)).toBe(false);
    const w = world(g);
    const r = await w.caps.proposeAssumptions(ctx(other) as never, stated(other) as never) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'occurrence_not_this_risk' });
    expect(r.detail).toContain('is not clearly about ‘Code quality deterioration’');
    expect(typedOccurrenceArgs(g, other)).toEqual(stated(other, 30, 'Key developer attrition'));
    // Two risks asked and the words name neither: whose chance it is cannot be told, so nothing is prepared.
    expect(occurrenceGovernedBy(g, RISK, SAID)).toBe(false);
    expect(typedOccurrenceArgs(g, SAID)).toBeUndefined();
    expect(await w.caps.proposeAssumptions(ctx(SAID) as never, stated(SAID) as never)).toMatchObject({ ok: false, refusal: 'occurrence_not_this_risk' });
    // Named, it binds: "code quality" is this risk's own words.
    const named = 'There’s about a 30% chance code quality slips before launch.';
    expect(occurrenceGovernedBy(g, RISK, named)).toBe(true);
    // Words naming another part of the model (an option: a different condition) are never this risk's baseline chance.
    expect(occurrenceGovernedBy(G, RISK, 'If we hire two developers there’s a 30% chance it slips.')).toBe(false);
    expect(w.commits()).toBe(0);
  });

  it('the window: the goal’s held window only; another span is refused (never rescaled); no window refuses with the reason', async () => {
    const w = world();
    const year = 'I’d say there’s about a 30% chance it slips within a year.';
    const r = await w.caps.proposeAssumptions(ctx(year) as never, stated(year) as never) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'occurrence_other_window' });
    expect(r.detail).toContain('the goal’s window of 3 months');
    expect(typedOccurrenceArgs(G, year)).toBeUndefined();
    const same = 'I’d say there’s about a 30% chance it slips in the next three months.';
    expect(typedOccurrenceArgs(G, same)).toEqual(stated(same));
    const conflict = structuredClone(G); goalOf(conflict).goal_horizon_months = 6;
    const c = await world(conflict).caps.proposeAssumptions(ctx(SAID) as never, stated(SAID) as never) as Rec;
    expect(c).toMatchObject({ ok: false, refusal: 'occurrence_not_recordable' });
    expect(c.detail).toContain('because the goal does not have one clear time window yet');
    expect(typedOccurrenceArgs(conflict, SAID)).toBeUndefined();
    expect(w.commits()).toBe(0);
  });

  it('never from unverified, partial or doubtful words; Olumi’s range is never offered for a chance the user just gave', async () => {
    const w = world(), before = JSON.stringify(w.graph());
    expect(await w.caps.proposeAssumptions(ctx('Please record it.', { user_text: 'Please record it.', unverified_user_text: SAID }) as never, stated(SAID) as never))
      .toMatchObject({ ok: false, refusal: 'origin_unknown' });
    expect(await w.caps.proposeAssumptions(ctx(SAID) as never, stated('a 30% chance it slips before launch.') as never))
      .toMatchObject({ ok: false, refusal: 'occurrence_not_stated' });
    const two = 'I’d say 30% it slips before launch, maybe 50% if we rush.';
    expect(await w.caps.proposeAssumptions(ctx(two) as never, stated(two) as never)).toMatchObject({ ok: false, refusal: 'occurrence_not_stated' });
    expect(typedOccurrenceArgs(G, two)).toBeUndefined();
    // A percent is a chance only where the words say so: Paul's marketing brief sentence is his time, never a chance (served
    // marketing brief; it bound 25% to the experience risk before this rule). Nor is a share with a chance word beside it.
    const time = 'I can\u2019t spend more than 25% of my time on this, and I\u2019m not that experienced with marketing.';
    expect(typedOccurrenceArgs(G, time)).toBeUndefined();
    expect(await w.caps.proposeAssumptions(ctx(time) as never, stated(time, 25) as never)).toMatchObject({ ok: false, refusal: 'occurrence_not_stated' });
    expect(typedOccurrenceArgs(G, 'There\u2019s a chance 30% of the code slips before launch.')).toBeUndefined();
    const olumis = await w.caps.proposeAssumptions(ctx(SAID) as never, { assumptions: [{ factor_label: LABEL, value: 30, unit: '%', basis: 'Launch pressure.',
      user_stated: false, occurrence_range: { low_percent: 20, high_percent: 40 } }] } as never) as Rec;
    expect(olumis).toMatchObject({ ok: false, refusal: 'occurrence_is_the_users' });
    expect(JSON.stringify(w.graph())).toBe(before);
    expect(w.commits()).toBe(0);
    // CONTRAST (kept): with no chance of theirs in this turn, Olumi's labelled range is still offered.
    expect(await w.caps.proposeAssumptions(ctx('Can you suggest a starting estimate?') as never, { assumptions: [{ factor_label: LABEL, value: 30, unit: '%',
      basis: 'Launch pressure.', user_stated: false, occurrence_range: { low_percent: 20, high_percent: 40 } }] } as never)).toMatchObject({ ok: true, risk_assumption: { olumis_estimate: true } });
  });

  it('the writer: a user block only with ITS statement of THIS risk, exactly as stated; the button records, never “use Olumi’s”', async () => {
    const statement = { speaker: 'user', quote: SAID, source: SAID, subject: { quantity: 'risk_occurrence', node_id: RISK }, form: 'point', low: 30, high: 30,
      unit: '%', reading: 'olumi' } as never;
    const approved = (extra: Partial<ApprovedRiskOccurrence>): ApprovedRiskOccurrence => ({ risk_id: RISK, event_risk: USERS as never,
      expected_node: structuredClone(riskOf(G)), goal_id: 'productivity', expected_goal: riskOccurrenceGoalSubject(G, 'productivity')!, ...extra });
    expect(applyRiskOccurrenceEdit(G, approved({}))).toEqual({ kind: 'refused', reason: 'invalid_block' });
    expect(applyRiskOccurrenceEdit(G, approved({ stated_occurrence: { ...(statement as Rec), subject: { quantity: 'risk_occurrence', node_id: 'other' } } as never })))
      .toEqual({ kind: 'refused', reason: 'invalid_block' });
    expect(applyRiskOccurrenceEdit(G, approved({ stated_occurrence: { ...(statement as Rec), low: 25, high: 25 } as never }))).toEqual({ kind: 'refused', reason: 'invalid_block' });
    expect(applyRiskOccurrenceEdit(G, approved({ stated_occurrence: statement }))).toMatchObject({ kind: 'mutated', confirmation: RECEIPT });
    // The card's ONE button, bound to this proposal: it records the user's words, never "use Olumi's starting assumption".
    const w = world();
    const card = await w.caps.proposeAssumptions(ctx(SAID) as never, stated(SAID) as never) as Rec;
    const chips = approvalChipsFor([{ name: 'propose_assumptions', ok: true, mutated: false, proposal_id: String(card.proposal_id) }],
      (id) => ({ proposal: w.store.get(id), result: card as never }));
    expect(chips[0]).toMatchObject({ label: 'Record what you said', message: 'Yes, record what I said.', detail: CARD });
  });
});
