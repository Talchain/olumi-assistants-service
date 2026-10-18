/**
 * ⭐ SYSTEM 1 M1: a risk's OWN user statements through the ONE door (AIE 6179240850 its chance; 6178729504 a condition that holds
 * now; 6180618773 row 6 an explicit zero kept, a conditional chance not written as the risk's). These are the rows of the retired
 * `risk-occurrence-statement.test.ts`, each on the door: the same served hiring post3007 graph (‘Code quality deterioration’, a
 * root with no level; the goal's window 3 months from today) and a second brief, marketing de659cfd (its window moved to today
 * for the positive). Real capabilities, real writer, real readiness, the ONE shared occurrence reader; only the read route and
 * the level door's store are doubled.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyRiskOccurrenceEdit, riskOccurrenceAskWords, riskOccurrenceIsCurrent } from '../../agent-lane/risk-occurrence.js';
import { approvalChipsFor } from '../../agent-lane/approval-chips.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities } from '../../agent-lane/runtime/agent-capabilities.js';
import { ProposalStore } from '../../agent-lane/proposal.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';
import { doorIssueArgs, typedDoorStatement } from '../door.js';
import { DOOR_APPROVE, DOOR_DERIVED_APPROVE } from '../card.js';
import { userStatementFor } from '../statements.js';

type Rec = Record<string, any>;
const G = (JSON.parse(readFileSync('tests/fixtures/risk-occurrence/served-hiring-post3007-read01-20261014.json', 'utf8')) as Rec).body.graph as Rec;
const MARKETING = (JSON.parse(readFileSync('src/orchestrator-v5/agent-lane/__tests__/fixtures/marketing-e2e-de659cfd-read05-before.json', 'utf8')) as Rec).body.graph as Rec;
const RISK = 'code_quality_deterioration';
const LABEL = 'Code quality deterioration';
const ASKED = `The analysis can’t run yet. ${riskOccurrenceAskWords(LABEL, 3)}`;
const SAID = 'I’d say there’s about a 30% chance it slips within the next 3 months.';
const riskOf = (g: Rec, id = RISK): Rec => (g.nodes as Rec[]).find((n) => n.id === id)!;
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const withAttrition = (): Rec => {
  const g = structuredClone(G);
  g.nodes.push({ id: 'key_developer_attrition', kind: 'risk', label: 'Key developer attrition', provenance: 'ai_inferred' });
  g.edges.push({ from: 'key_developer_attrition', to: 'productivity', strength: { mean: -0.2, std: 0.1 }, exists_probability: 0.7, effect_direction: 'negative' });
  return g;
};
const EFFECT = 'its effect on ‘Productivity’ is still Olumi’s placeholder, not yet sized';
const CARD = `From your message: “${SAID}” Olumi proposes this reading: your estimate of about 30% that ‘${LABEL}’ happens at least once within the next 3 months `
  + `from today. How strongly it affects ‘Productivity’ is a separate assumption: ${EFFECT}. Record this reading?`;
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
const ctx = (said: string, extra: Rec = {}): Rec => ({ scenario_id: 'dc4e09b6-3727-4b14-a3af-dceef435b7d9', authenticated_user_id: null, request_id: 'r',
  turn_id: 't', user_text: said, user_turn_text: said, preceding_assistant_text: ASKED, ...extra });
const door = (quote: string, field = 'occurrence', label = LABEL): Rec => ({ subject: { kind: 'risk', label, field }, statements: [{ quote }] });
const press = async (w: ReturnType<typeof world>, card: Rec): Promise<Rec> => await w.caps.authoriseChange({ ...ctx(DOOR_APPROVE.message),
  typed_approval_of: String(card.proposal_id), typed_approval_words: DOOR_APPROVE.message } as never, { proposal_id: String(card.proposal_id) }) as Rec;
const asks = (g: Rec, id = RISK): string[] => (((buildCanonicalAnalysisReadyFromGraph(g) as Rec).readiness_issues ?? []) as Rec[])
  .filter((i) => i.code === 'MISSING_FACTOR_LEVEL' && i.factor_id === id).map((i) => i.message as string);

describe('SYSTEM 1 M1: the user’s own chance for a risk, through the ONE door (AIE 6179240850)', () => {
  it('PRECONDITION: Olumi’s unsized risk is not asked; a user statement sent through propose_assumptions is sent to the door', async () => {
    // HIRING (DL 23:19Z): Olumi's unsized risk is left out of the Run, so readiness does not ask; the user's words still size it here.
    expect(asks(G)).toEqual([]);
    const r = await world().caps.proposeAssumptions(ctx(SAID) as never, { assumptions: [{ factor_label: LABEL, value: 30, unit: '%', basis: '',
      user_stated: true, statements: [{ quote: SAID }] }] } as never) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'use_propose_statement' });
    expect(r.detail).toContain('Record it with propose_statement (subject: kind risk, label ‘Code quality deterioration’, field occurrence');
  });

  it('RED→GREEN: their answer to Olumi’s question → ONE door card → the press → THEIR estimate and statement; the ask closes', async () => {
    const w = world();
    const card = await w.caps.proposeStatement!(ctx(SAID) as never, door(SAID)) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, mutated: false, statement: { subject: LABEL, field: 'occurrence', quotes: [SAID], your_words: true } });
    expect(card.public_label).toBe(CARD);
    expect(await w.caps.authoriseChange(ctx('Yes') as never, { proposal_id: String(card.proposal_id) })).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(w.commits()).toBe(0);
    expect(await press(w, card)).toMatchObject({ ok: true, applied: true, follow_up: RECEIPT });
    expect(riskOf(w.graph()).event_risk).toEqual(USERS);
    // Their complete statement is the ONE door's durable record beside the block (source, speaker, qualifier, period).
    expect(userStatementFor(w.graph(), { kind: 'risk', id: RISK, field: 'occurrence' })).toMatchObject({ field: 'occurrence',
      statements: [{ speaker: 'user', quote: SAID, source: SAID, form: 'point', low: 30, high: 30, qualifier: 'about', period: '3 months',
        subject: { quantity: 'risk_occurrence', node_id: RISK } }] });
    expect(riskOf(w.graph())).not.toHaveProperty('occurrence_statement');
    expect(asks(w.graph())).toEqual([]);
    expect(w.commits()).toBe(1);
  });

  it('the card’s ONE button records what they said, never “use Olumi’s”', async () => {
    const w = world();
    const card = await w.caps.proposeStatement!(ctx(SAID) as never, door(SAID)) as Rec;
    const chips = approvalChipsFor([{ name: 'propose_statement', ok: true, mutated: false, proposal_id: String(card.proposal_id) }],
      (id) => ({ proposal: w.store.get(id), result: card } as never)) as Rec[];
    expect(chips[0]).toMatchObject({ label: DOOR_APPROVE.label, message: DOOR_APPROVE.message });
  });

  it('“before launch” is never the goal’s window; the one remaining risk is never proof of “it”; words, selection or Olumi’s question bind', async () => {
    const w = world();
    const launch = 'I’d say there’s about a 30% chance it slips before launch.';
    const r = await w.caps.proposeStatement!(ctx(launch) as never, door(launch)) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'not_this_field' });
    expect(r.detail).toContain('ask only which time span it covers');
    expect(typedDoorStatement(G, launch, { preceding_ask: ASKED })).toBeUndefined();
    // ⭐ GATE → LABEL (change 1): "it", with nothing binding it, is a LABELLED card, never "your estimate of this risk" by elimination:
    // which item the words concern is Olumi's reading, said on the card, and the route never issues it by itself.
    const unbound = await w.caps.proposeStatement!(ctx(SAID, { preceding_assistant_text: 'Your results are ready.' }) as never, door(SAID)) as Rec;
    expect(unbound).toMatchObject({ ok: true, statement: { your_words: true, item_is_olumis_reading: true } });
    expect(unbound.public_label).toBe(CARD.replace(' Record this reading?', ` Olumi’s reading: these words concern “${LABEL}”. Record this reading?`));
    expect(typedDoorStatement(G, SAID, {})).toBeUndefined();
    expect(await w.caps.proposeStatement!(ctx(SAID, { preceding_assistant_text: 'Your results are ready.',
      grounded_selection: { element_ids: [RISK], unresolved: 'none' } }) as never, door(SAID))).toMatchObject({ ok: true });
    const named = 'I’d say there’s about a 30% chance of code quality deterioration within the next 3 months.';
    expect(await w.caps.proposeStatement!(ctx(named, { preceding_assistant_text: 'Your results are ready.' }) as never, door(named))).toMatchObject({ ok: true });
    expect(typedDoorStatement(G, `Thanks. ${SAID}`, { preceding_ask: ASKED })).toEqual({ subject: { kind: 'risk', id: RISK, field: 'occurrence' }, quotes: [SAID] });
    expect(w.commits()).toBe(0);
  });

  it('T1H r4-neg: a CHANCE sent as holds-now is never holds-now; with its window it is the chance card; a condition that holds now stays holds-now', async () => {
    const t1h = 'Code quality isn’t slipping today; I’d say there’s about a 30% chance it slips within the next 3 months.';
    const w = world();
    const r = await w.caps.proposeStatement!(ctx(t1h) as never, door(t1h, 'holds_now')) as Rec;
    expect(r).toMatchObject({ ok: false, refusal: 'not_this_field' });
    expect(r.detail).toContain('gives a chance of it happening, not a condition that holds now');
    const card = await w.caps.proposeStatement!(ctx(t1h) as never, door(t1h)) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, statement: { field: 'occurrence' } });
    expect(String(card.public_label)).toContain(`From your message: “${t1h}” Olumi proposes this reading: your estimate of about 30%`);
    const now = 'Honestly, our code quality is already slipping.';
    const held = await world().caps.proposeStatement!(ctx(now) as never, door(now, 'holds_now')) as Rec;
    expect(held).toMatchObject({ ok: true, statement: { field: 'holds_now', quotes: [now] } });
    // DL-3 RULING 23:12Z: the derived 100% is shown before the press as Olumi's reading of their words.
    expect(held.public_label).toBe(`From your message: “${now}” Olumi proposes this reading: ‘${LABEL}’ already being true now. `
      + `For this conditional reading, Olumi would represent ‘${LABEL}’ as true at least once in the next 3 months: occurrence 100%. This is Olumi’s derived assumption, not a numerical probability you stated, and does not establish persistence or effect. `
      + `How strongly it affects ‘Productivity’ is a separate assumption: ${EFFECT}. Record this reading?`);
  });

  it('CONTRAST: a figure about ANOTHER risk is refused for this one, even after Olumi asked about this one; the route gives it to the risk it names', async () => {
    const g = withAttrition();
    const other = 'I’d say there’s about a 30% chance of key developer attrition within the next 3 months.';
    const w = world(g);
    // ⭐ GATE → LABEL: words naming ANOTHER risk are never silently this one's: the card names both items and asks for this one only.
    const card = await w.caps.proposeStatement!(ctx(other) as never, door(other)) as Rec;
    expect(card).toMatchObject({ ok: true, statement: { item_is_olumis_reading: true } });
    expect(String(card.public_label)).toContain(`Olumi’s reading: these words concern “${LABEL}”. Olumi’s item reader matched them to “Key developer attrition” instead; `
      + `approve only if “${LABEL}” is the item you mean. Record this reading?`);
    expect(typedDoorStatement(g, other, { preceding_ask: ASKED })).toEqual({ subject: { kind: 'risk', id: 'key_developer_attrition', field: 'occurrence' }, quotes: [other] });
    expect(w.commits()).toBe(0);
  });

  it('GATE → LABEL R1 (real path): an unbound chance → labelled card → its press → the user’s figure on the risk Olumi read, the binding approved; never "you said" before it', async () => {
    const w = world();
    const card = await w.caps.proposeStatement!(ctx(SAID, { preceding_assistant_text: 'Your results are ready.' }) as never, door(SAID)) as Rec;
    const pid = String(card.proposal_id);
    // The press is the reading's button, never "record what you said"; the plain "record what I said" is not this card's press.
    const chips = approvalChipsFor([{ name: 'propose_statement', ok: true, mutated: false, proposal_id: pid }],
      (id) => ({ proposal: w.store.get(id), result: card } as never)) as Rec[];
    expect(chips[0]).toMatchObject({ label: DOOR_DERIVED_APPROVE.label, message: DOOR_DERIVED_APPROVE.message });
    // Before the press nothing is written, and the statement is no "you said" anywhere.
    expect(w.commits()).toBe(0);
    expect(userStatementFor(w.graph(), { kind: 'risk', id: RISK, field: 'occurrence' })).toBeUndefined();
    const pressed = await w.caps.authoriseChange({ ...ctx(DOOR_DERIVED_APPROVE.message), typed_approval_of: pid,
      typed_approval_words: DOOR_DERIVED_APPROVE.message } as never, { proposal_id: pid }) as Rec;
    expect(pressed).toMatchObject({ ok: true, applied: true,
      follow_up: `${RECEIPT} Your figure, applied to “${LABEL}”: Olumi’s reading, approved by you.` });
    // The figure is the user's (their words, figure and unit), so the block is theirs; the binding is Olumi's reading, approved.
    expect(riskOf(w.graph()).event_risk).toEqual(USERS);
    expect(userStatementFor(w.graph(), { kind: 'risk', id: RISK, field: 'occurrence' })?.statements).toEqual([expect.objectContaining({
      speaker: 'user', quote: SAID, low: 30, high: 30, checks: { words_found: true, figure_found: true, unit_found: true, subject_bound: false },
      approval: { proposal_id: pid } })]);
    expect(w.commits()).toBe(1);
  });

  it('the window: theirs and the goal’s from today only; a year, a launch-relative goal window, or no window is refused with its reason', async () => {
    const year = 'I’d say there’s about a 30% chance it slips within a year.';
    expect(await world().caps.proposeStatement!(ctx(year) as never, door(year))).toMatchObject({ ok: false, refusal: 'not_this_field' });
    const afterLaunch = structuredClone(G); goalOf(afterLaunch).goal_target_basis = { ...goalOf(afterLaunch).goal_target_basis, reference: 'launch' };
    const l = await world(afterLaunch).caps.proposeStatement!(ctx(SAID) as never, door(SAID)) as Rec;
    expect(l).toMatchObject({ ok: false, refusal: 'not_this_field' });
    expect(l.detail).toContain('covers a different time span from the goal’s window of 3 months from today');
    const conflict = structuredClone(G); goalOf(conflict).goal_horizon_months = 6;
    const c = await world(conflict).caps.proposeStatement!(ctx(SAID) as never, door(SAID)) as Rec;
    expect(c).toMatchObject({ ok: false, refusal: 'not_this_field' });
    expect(c.detail).toContain('because the goal does not have one clear time window yet');
  });

  it('AIE 6180618773 row 6: an explicit 0% is recorded as 0, never lifted; a conditional or negated chance is kept, never written as the risk’s', async () => {
    const zero = 'There’s a 0% chance it slips within the next 3 months.';
    const w = world();
    const card = await w.caps.proposeStatement!(ctx(zero) as never, door(zero)) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true });
    expect(card.public_label).toContain('Olumi proposes this reading: your estimate of 0% that ‘Code quality deterioration’ happens');
    expect(await press(w, card)).toMatchObject({ ok: true, applied: true });
    expect(riskOf(w.graph()).event_risk).toEqual({ ...USERS, occurrence: { ...USERS.occurrence, p_low: 0, p_high: 0 } });
    const v = world(), before = JSON.stringify(v.graph());
    const conditional = 'There’s a 30% chance it slips within the next 3 months if we hire two developers.';
    const c = await v.caps.proposeStatement!(ctx(conditional) as never, door(conditional)) as Rec;
    expect(c).toMatchObject({ ok: false, refusal: 'not_this_field' });
    expect(c.detail).toContain('gives a chance under a condition');
    expect(c.detail).toContain('Keep their estimate and its condition exactly as they said them; it stays theirs.');
    const negated = 'There’s a 30% chance it won’t slip within the next 3 months.';
    expect(await v.caps.proposeStatement!(ctx(negated) as never, door(negated))).toMatchObject({ ok: false, refusal: 'not_this_field' });
    expect(JSON.stringify(v.graph())).toBe(before);
    expect(v.commits()).toBe(0);
  });

  it('never unverified or partial words; Olumi’s range is never offered for a chance the user just gave', async () => {
    const w = world(), before = JSON.stringify(w.graph());
    expect(await w.caps.proposeStatement!(ctx('Please record it.', { user_text: 'Please record it.', unverified_user_text: SAID }) as never, door(SAID)))
      .toMatchObject({ ok: false, refusal: 'origin_unknown' });
    // ⭐ LEAN CORE (DL-3 18 Oct, PL-0048 3 confirmed): a literal span of the user's own sentence is theirs; its card keeps the COMPLETE
    // line ("I’d say there’s about …"), so the hedge is never dropped. Words they never typed stay refused.
    expect(await w.caps.proposeStatement!(ctx(SAID) as never, door('a 30% chance it slips within the next 3 months.')))
      .toMatchObject({ ok: true, mutated: false });
    expect(await w.caps.proposeStatement!(ctx(SAID) as never, door('a 30% chance it slipped within the next 3 months.')))
      .toMatchObject({ ok: false, refusal: 'statement_not_found' });
    const olumis = await w.caps.proposeAssumptions(ctx(SAID) as never, { assumptions: [{ factor_label: LABEL, value: 30, unit: '%', basis: 'Launch pressure.',
      user_stated: false, occurrence_range: { low_percent: 20, high_percent: 40 } }] } as never) as Rec;
    expect(olumis).toMatchObject({ ok: false, refusal: 'occurrence_is_the_users' });
    expect(JSON.stringify(w.graph())).toBe(before);
    expect(w.commits()).toBe(0);
    expect(await w.caps.proposeAssumptions(ctx('Can you suggest a starting estimate?') as never, { assumptions: [{ factor_label: LABEL, value: 30, unit: '%',
      basis: 'Launch pressure.', user_stated: false, occurrence_range: { low_percent: 20, high_percent: 40 } }] } as never)).toMatchObject({ ok: true, risk_assumption: { olumis_estimate: true } });
  });

  it('their estimate keeps its OWN window: after the goal’s window moves it is retained, never applied to the new window', async () => {
    const w = world();
    await press(w, await w.caps.proposeStatement!(ctx(SAID) as never, door(SAID)) as Rec);
    const moved = structuredClone(w.graph());
    goalOf(moved).goal_target_basis = { ...goalOf(moved).goal_target_basis, period_months: 6 };
    expect(riskOccurrenceIsCurrent(riskOf(moved), moved)).toBe(false);
    expect(userStatementFor(moved, { kind: 'risk', id: RISK, field: 'occurrence' })?.statements[0]?.quote).toBe(SAID);
    expect(asks(moved)).toHaveLength(1);
    expect(riskOccurrenceIsCurrent(riskOf(w.graph()), w.graph())).toBe(true);
  });

  it('TWO-BRIEF: on marketing (its window from today), the user’s chance for ‘Limited marketing experience’ is the same door card and press', async () => {
    const g = structuredClone(MARKETING); goalOf(g).goal_target_basis.reference = 'today';
    const said = 'I’d say there’s about a 40% chance it happens within the next 3 months.';
    const asked = riskOccurrenceAskWords('Limited marketing experience', 3);
    const w = world(g);
    const card = await w.caps.proposeStatement!(ctx(said, { preceding_assistant_text: asked }) as never,
      door(said, 'occurrence', 'Limited marketing experience')) as Rec;
    expect(card, JSON.stringify(card)).toMatchObject({ ok: true, statement: { field: 'occurrence' } });
    expect(card.public_label).toContain('Olumi proposes this reading: your estimate of about 40% that ‘Limited marketing experience’ happens at least once within the next 3 months from today.');
    expect(await press(w, card)).toMatchObject({ ok: true, applied: true });
    expect(riskOf(w.graph(), 'limited_marketing_experience').event_risk.occurrence).toMatchObject({ p_low: 0.4, p_high: 0.4, basis: 'user' });
    // Served: its window counts from the LAUNCH, so the same words are refused with the reason, never written over that window.
    expect(await world(MARKETING).caps.proposeStatement!(ctx(said, { preceding_assistant_text: asked }) as never, door(said, 'occurrence', 'Limited marketing experience')))
      .toMatchObject({ ok: false, refusal: 'not_this_field' });
  });

  it('the ONE route issuer: typed words first; else the brief’s own holds-now sentence; nothing while a card waits or a change was approved', () => {
    const turn = { toolCalls: [], mutated: false, proposalOffered: false, heldWaiting: false };
    expect(doorIssueArgs(G, SAID, { preceding_ask: ASKED }, turn)).toEqual({ subject: { kind: 'risk', id: RISK, field: 'occurrence' }, quotes: [SAID] });
    expect(doorIssueArgs(G, SAID, { preceding_ask: ASKED }, { ...turn, heldWaiting: true })).toBeUndefined();
    expect(doorIssueArgs(G, SAID, { preceding_ask: ASKED }, { ...turn, toolCalls: [{ name: 'authorise_change' }] })).toBeUndefined();
    const brief = structuredClone(G); riskOf(brief).already_true_quote = 'Honestly, our code quality is already slipping.';
    expect(doorIssueArgs(brief, 'Thanks.', {}, turn)).toEqual({ subject: { kind: 'risk', id: RISK, field: 'holds_now' }, quotes: ['Honestly, our code quality is already slipping.'] });
    expect(doorIssueArgs(brief, 'Thanks.', {}, { ...turn, toolCalls: [{ name: 'propose_new_option' }] })).toBeUndefined();
  });
});
