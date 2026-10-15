/**
 * ⭐ The ONE writer of Olumi's occurrence range on an existing risk (`risk-occurrence.ts`), on the served hiring post3007 graph:
 * eligibility (a risk ROOT with no level, one goal with a period), the window (the goal's own period), the stale gate (the node
 * as the card showed it), the scoped postimage (that risk's `event_risk` only) and the verified no-op on a retry.
 */
import { unsizedOlumiRiskLine } from '../unsized-risk.js';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyRiskOccurrenceEdit, olumiOccurrenceBlock, riskOccurrenceCardHolds, riskOccurrenceGoalSubject, riskOccurrencePostimageIsScoped,
  riskOccurrenceSubject, SET_RISK_OCCURRENCE_OP, userHoldsNowBlock, type ApprovedRiskOccurrence } from '../risk-occurrence.js';
import { heldCardStillApplies, heldCardSubjectMoved } from '../proposal-object/still-applies.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { createAgentCapabilities } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { goalChanceEstimateCensus, olumiEstimateWords } from '../goal-chance-estimate-attribution.js';
import { buildCanonicalAnalysisReadyFromGraph } from '../../../orchestrator/tools/analysis-ready-helper.js';

type Rec = Record<string, any>;
const G = (JSON.parse(readFileSync('tests/fixtures/risk-occurrence/served-hiring-post3007-read01-20261014.json', 'utf8')) as Rec).body.graph as Rec;
const RISK = 'code_quality_deterioration';
const riskOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.id === RISK)!;
const goalOf = (g: Rec): Rec => (g.nodes as Rec[]).find((n) => n.kind === 'goal')!;
const BLOCK = olumiOccurrenceBlock(20, 40, 3)!;
const approved = (g: Rec = G): ApprovedRiskOccurrence => ({ risk_id: RISK, event_risk: BLOCK, expected_node: structuredClone(riskOf(g)),
  goal_id: 'productivity', expected_goal: riskOccurrenceGoalSubject(g, 'productivity')! });
/** The served goal with a saved 3-month window, 14 October 2026 to 14 January 2027 (Codex r1's shape). */
const dated = (): Rec => {
  const g = structuredClone(G);
  Object.assign(goalOf(g), { goal_horizon: { deadline: '2027-01-14' }, goal_horizon_reference_date: '2026-10-14', goal_horizon_months: 3,
    goal_horizon_stated_months: 3 });
  return g;
};

describe('risk-occurrence: Olumi’s range for an unvalued risk root', () => {
  it('the served risk is eligible over the goal’s own period (3 months), and the block is Olumi’s', () => {
    expect(riskOccurrenceSubject(G, RISK)).toMatchObject({ kind: 'eligible', window_months: 3 });
    expect(BLOCK).toEqual({ version: 1, occurrence: { p_low: 0.2, p_high: 0.4, meaning: 'at_least_once_within_horizon', basis: 'olumi' }, horizon: { months: 3 } });
    expect([olumiOccurrenceBlock(40, 20, 3), olumiOccurrenceBlock(-1, 20, 3), olumiOccurrenceBlock(20, 101, 3), olumiOccurrenceBlock('20', 40, 3)]).toEqual([undefined, undefined, undefined, undefined]);
  });

  it('writes ONLY that risk’s event_risk; a retry of the landed write is a verified no-op', () => {
    const out = applyRiskOccurrenceEdit(G, approved());
    expect(out.kind).toBe('mutated');
    const expected = structuredClone(G);
    riskOf(expected).event_risk = BLOCK;
    expect((out as Rec).mutatedGraph).toEqual(expected);
    expect(riskOccurrencePostimageIsScoped(G, expected, approved())).toBe(true);
    // A retry after THIS proposal's own write landed is a verified no-op…
    expect(applyRiskOccurrenceEdit(expected, { ...approved(), own_write_landed: true })).toEqual({ kind: 'unchanged' });
    // …ADVERSARIAL (DL 08:08Z): the equal block found WITHOUT that identity is a node changed since the card, never its write.
    expect(applyRiskOccurrenceEdit(expected, approved())).toEqual({ kind: 'refused', reason: 'risk_changed' });
  });

  it('refuses: the node moved since the card, a cause link, a level, no single goal period, or a block that is not Olumi’s', () => {
    const renamed = structuredClone(G); riskOf(renamed).label = 'Code quality';
    expect(applyRiskOccurrenceEdit(renamed, approved())).toEqual({ kind: 'refused', reason: 'risk_changed' });
    const caused = structuredClone(G); (caused.edges as Rec[]).push({ from: 'tech_lead_hires', to: RISK, strength: { mean: 0.3, std: 0.1 } });
    expect(applyRiskOccurrenceEdit(caused, approved())).toEqual({ kind: 'refused', reason: 'has_a_cause' });
    const valued = structuredClone(G); riskOf(valued).observed_state = { value: 0.3 };
    expect(riskOccurrenceSubject(valued, RISK)).toEqual({ kind: 'ineligible', reason: 'holds_a_level' });
    const noPeriod = structuredClone(G); delete goalOf(noPeriod).goal_target_basis;
    expect(applyRiskOccurrenceEdit(noPeriod, approved(noPeriod))).toEqual({ kind: 'refused', reason: 'no_window' });
    const moved = structuredClone(G); goalOf(moved).goal_target_basis.period_months = 6;
    expect(applyRiskOccurrenceEdit(moved, approved(moved))).toEqual({ kind: 'refused', reason: 'risk_changed' });
    const users = { ...approved(), event_risk: { ...BLOCK, occurrence: { ...BLOCK.occurrence, basis: 'user' as const } } };
    expect(applyRiskOccurrenceEdit(G, users)).toEqual({ kind: 'refused', reason: 'invalid_block' });
    expect(riskOccurrenceSubject(G, 'leadership_coverage')).toEqual({ kind: 'ineligible', reason: 'not_a_risk' });
  });

  it('⛔ Codex r1: the card binds the goal’s WINDOW, not its month count — the same 3 months a month later writes nothing', () => {
    const card = approved(dated());
    expect(riskOccurrenceSubject(dated(), RISK)).toMatchObject({ kind: 'eligible', window_months: 3, goal_id: 'productivity' });
    expect(card.expected_goal).toMatchObject({ horizon: { deadline: '2027-01-14', months: 3 }, starts: '2026-10-14', reading: { period_months: 3 } });
    // The saved window moves to 14 November–14 February: the analysis hash does not see it; the card does.
    const shifted = dated();
    Object.assign(goalOf(shifted), { goal_horizon: { deadline: '2027-02-14' }, goal_horizon_reference_date: '2026-11-14' });
    expect(computeAnalysisAffectingGraphHash(shifted as never)).toBe(computeAnalysisAffectingGraphHash(dated() as never));
    expect(applyRiskOccurrenceEdit(shifted, card)).toEqual({ kind: 'refused', reason: 'goal_changed' });
    // Each bound member alone retires it: the start, the end, the reading.
    const started = dated(); goalOf(started).goal_horizon_reference_date = '2026-11-14';
    const ended = dated(); goalOf(ended).goal_horizon = { deadline: '2027-02-14' };
    const relabelled = dated(); goalOf(relabelled).label = 'Team productivity';
    expect([started, ended, relabelled].map((g) => applyRiskOccurrenceEdit(g, card))).toEqual(Array(3).fill({ kind: 'refused', reason: 'goal_changed' }));
    // CONTRAST: an unrelated link edit leaves the card's subject as bound, so the writer still writes.
    const unrelated = dated(); (unrelated.edges as Rec[]).find((e) => e.from === 'leadership_coverage')!.strength = { mean: 0.1, std: 0.05 };
    expect(applyRiskOccurrenceEdit(unrelated, card).kind).toBe('mutated');
  });

  it('⛔ Codex r1: a reading counted from a launch beside a horizon counted from its own date is a conflict, even with the same month count: no card', () => {
    const launch = dated(); goalOf(launch).goal_target_basis.reference = 'launch';
    expect(riskOccurrenceSubject(launch, RISK)).toEqual({ kind: 'ineligible', reason: 'no_window' });
    expect(riskOccurrenceSubject(dated(), RISK).kind).toBe('eligible');
    // CONTRAST: a launch reading with no separate horizon is the goal's one window (no conflict).
    const launchOnly = structuredClone(G); goalOf(launchOnly).goal_target_basis.reference = 'launch';
    expect(riskOccurrenceSubject(launchOnly, RISK)).toMatchObject({ kind: 'eligible', window_months: 3 });
  });

  it('⛔ Codex r1 RACED READ-BACK: a concurrent 3 → 6 month change after the commit → not confirmed: no receipt, readiness not checked', async () => {
    let g = structuredClone(G);
    let commits = 0;
    const ctx = { scenario_id: 'dc4e09b6-3727-4b14-a3af-dceef435b7d9', authenticated_user_id: null, request_id: 'r', turn_id: 't', user_text: 'Please propose an assumption.' };
    const caps = createAgentCapabilities(async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(g), graph_hash: computeAnalysisAffectingGraphHash(g as never) } };
      if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
      throw new Error(path);
    }, new ProposalStore(), undefined, 'full', undefined, { commitOptionLevels: async (input) => {
      commits += 1;
      const r = applyRiskOccurrenceEdit(g, input.risk_occurrence!);
      if (r.kind !== 'mutated') throw new Error(r.kind);
      g = r.mutatedGraph as Rec;
      const committedHash = computeAnalysisAffectingGraphHash(g as never)!;
      goalOf(g).goal_target_basis.period_months = 6; // a second, independent write lands after this commit
      return { status: 'committed', graph_hash: committedHash, already_applied: false, committed_levels: [], links_resized: [], receipt: null } as never;
    } });
    const p = await caps.proposeAssumptions(ctx as never, { assumptions: [{ factor_label: riskOf(g).label, value: 30, unit: '%', basis: 'An estimate for the launch window.',
      user_stated: false, occurrence_range: { low_percent: 20, high_percent: 40 } }] } as never);
    expect(p).toMatchObject({ ok: true });
    const res = await caps.authoriseChange({ ...ctx, user_text: 'Yes, use that.', typed_approval_of: String(p.proposal_id), typed_approval_words: 'Yes, use that.' } as never,
      { proposal_id: String(p.proposal_id) });
    expect(commits).toBe(1);
    expect(res).toMatchObject({ ok: false, applied: false, refusal: 'not_confirmed', readiness_after: { checked: false } });
    expect(res).not.toHaveProperty('follow_up');
    expect(JSON.stringify(res)).not.toContain('Recorded Olumi’s starting assumption');
  });

  it('⛔ Codex r2: Olumi’s occurrence is a level only over the goal’s CURRENT window — stale, readiness withholds and asks again', () => {
    const written = (applyRiskOccurrenceEdit(G, approved()) as Rec).mutatedGraph as Rec;
    expect(buildCanonicalAnalysisReadyFromGraph(written)).toMatchObject({ may_run: true });
    // The goal's period moves from 3 to 6 months after the write: the 3-month range no longer counts.
    const moved = structuredClone(written); goalOf(moved).goal_target_basis.period_months = 6;
    expect(buildCanonicalAnalysisReadyFromGraph(moved)).toMatchObject({ may_run: false });
    const asks = (((buildCanonicalAnalysisReadyFromGraph(moved) as Rec).readiness_issues ?? []) as Rec[]).filter((i) => i.factor_id === RISK).map((i) => i.message);
    expect(asks).toEqual(['Is ‘Code quality deterioration’ already true now? If so, say so. If not: How likely is ‘Code quality deterioration’ to happen at least once within 6 months? Olumi can’t run the numbers '
      + 'until this risk has a figure. Or ask Olumi to suggest a starting estimate for you to review.']);
    expect(riskOccurrenceSubject(moved, RISK)).toMatchObject({ kind: 'eligible', window_months: 6 });
    // CONTRAST: a user's range keeps its own stated horizon; it still counts.
    const users = structuredClone(moved); riskOf(users).event_risk = { ...BLOCK, occurrence: { ...BLOCK.occurrence, basis: 'user' } };
    expect(buildCanonicalAnalysisReadyFromGraph(users)).toMatchObject({ may_run: true });
  });

  it('#3024’s one rule for the risk card: holds as offered and after an unrelated edit; not when an equal block is already there, nor after its window or node moved', () => {
    const op = { op: SET_RISK_OCCURRENCE_OP, path: RISK, value: { event_risk: BLOCK, expected_node: riskOf(G), goal_id: 'productivity',
      expected_goal: riskOccurrenceGoalSubject(G, 'productivity') } };
    const card = { operations: [op] } as never;
    const unrelated = structuredClone(G); (unrelated.edges as Rec[]).find((e) => e.from === 'leadership_coverage')!.strength = { mean: 0.1, std: 0.05 };
    const landed = (applyRiskOccurrenceEdit(G, approved()) as Rec).mutatedGraph as Rec;
    expect([G, unrelated].map((g) => [riskOccurrenceCardHolds(op, g), heldCardStillApplies(card, g), heldCardSubjectMoved(card, g)]))
      .toEqual(Array(2).fill([true, true, false]));
    const window = structuredClone(G); goalOf(window).goal_target_basis.period_months = 6;
    const renamed = structuredClone(G); riskOf(renamed).label = 'Code quality';
    // An equal block already on the node is not this card's write (identity, not value): the card no longer applies.
    expect([landed, window, renamed].map((g) => [riskOccurrenceCardHolds(op, g), heldCardStillApplies(card, g), heldCardSubjectMoved(card, g)]))
      .toEqual(Array(3).fill([false, false, true]));
  });

  /**
   * The press's own-write identity on a real ledger: the door's commit records its turn (`authorisationTurnId(pid)`), as the
   * store's committed-turn ledger does. `firstSave` decides what the FIRST press's door does: land this card's own write but
   * report it unconfirmed, or write nothing (reported unconfirmed) while ANOTHER writer's equal block lands.
   */
  const ownWriteWorld = (firstSave: 'own_write_unconfirmed' | 'nothing_written_equal_block_elsewhere') => {
    let g = structuredClone(G);
    const ledger: string[] = [];
    let ownWrites = 0, firstCall = true;
    const ctx = { scenario_id: 'dc4e09b6-3727-4b14-a3af-dceef435b7d9', authenticated_user_id: null, request_id: 'r', turn_id: 't', user_text: 'Please propose an assumption.' };
    const caps = createAgentCapabilities(async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(g), graph_hash: computeAnalysisAffectingGraphHash(g as never) } };
      if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
      throw new Error(path);
    }, new ProposalStore(), undefined, 'full', undefined, {
      readCommittedTurnLedger: async () => ({ write_turn_ids: [...ledger], user_message_turn_ids: [], first_user_message: null, complete: true }) as never,
      commitOptionLevels: async (input) => {
        if (firstCall && firstSave === 'nothing_written_equal_block_elsewhere') {
          firstCall = false;
          const other = applyRiskOccurrenceEdit(g, { ...input.risk_occurrence!, own_write_landed: false });
          g = (other as Rec).mutatedGraph as Rec; ledger.push('another-writers-turn');
          return { status: 'unconfirmed' } as never;
        }
        const r = applyRiskOccurrenceEdit(g, input.risk_occurrence!);
        if (r.kind === 'refused') return { status: 'refused', reason: `risk_occurrence_${r.reason}` } as never;
        if (r.kind === 'mutated') { g = r.mutatedGraph as Rec; ownWrites += 1; ledger.push(input.turn_id); }
        const result = firstCall ? { status: 'unconfirmed' } : { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(g as never), already_applied: r.kind === 'unchanged',
          committed_levels: [], links_resized: [], receipt: null };
        firstCall = false;
        return result as never;
      } });
    const press = async () => {
      const p = await caps.proposeAssumptions(ctx as never, { assumptions: [{ factor_label: riskOf(G).label, value: 30, unit: '%', basis: 'An estimate for the launch window.',
        user_stated: false, occurrence_range: { low_percent: 20, high_percent: 40 } }] } as never);
      const yes = { ...ctx, user_text: 'Yes, use that.', typed_approval_of: String(p.proposal_id), typed_approval_words: 'Yes, use that.' } as never;
      return () => caps.authoriseChange(yes, { proposal_id: String(p.proposal_id) });
    };
    return { press, graph: () => g, ownWrites: () => ownWrites };
  };

  it('OWN WRITE: the first save lands unconfirmed → the same card pressed again continues from ITS OWN write and confirms; 1 write in all', async () => {
    const w = ownWriteWorld('own_write_unconfirmed');
    const press = await w.press();
    expect(await press()).toMatchObject({ ok: false, mutated: true, refusal: 'not_confirmed' });
    expect(riskOf(w.graph()).event_risk).toEqual(BLOCK);
    const again = await press();
    expect(again).toMatchObject({ ok: true, applied: true });
    expect(w.ownWrites()).toBe(1);
  });

  it('⛔ buddy r3 (equal value, different identity): the first save writes NOTHING (unconfirmed) while another writer lands an EQUAL block → the retry is refused: no ok, no receipt, no write of its own', async () => {
    const w = ownWriteWorld('nothing_written_equal_block_elsewhere');
    const press = await w.press();
    expect(await press()).toMatchObject({ ok: false, refusal: 'not_confirmed' });
    expect(riskOf(w.graph()).event_risk, 'the equal block is another writer’s').toEqual(BLOCK);
    const again = await press() as Rec;
    // Its card no longer applies (the risk already holds a level that is not its own write), so the press refuses it.
    expect(again, JSON.stringify(again)).toMatchObject({ ok: false, mutated: false, refusal: 'superseded' });
    expect(again).not.toHaveProperty('follow_up');
    expect(w.ownWrites()).toBe(0);
  });

  it('DL Q2: the chance rests on Olumi’s occurrence too — counted on the face and listed on the panel, by the risk’s id', () => {
    const OPTIONS = ['hire_tech_lead', 'hire_two_developers', 'continue_as_now'];
    const before = goalChanceEstimateCensus(G, OPTIONS, 'productivity');
    expect(before.estimates!.values.map((v) => v.id)).not.toContain(RISK);
    const written = (applyRiskOccurrenceEdit(G, approved()) as Rec).mutatedGraph as Rec;
    const after = goalChanceEstimateCensus(written, OPTIONS, 'productivity');
    expect(after.estimates!.values.filter((v) => v.id === RISK)).toEqual([expect.objectContaining({ kind: 'value', id: RISK, label: 'Code quality deterioration' })]);
    expect(after.counts.values).toBe(before.counts.values + 1);
    expect({ ...after.counts, values: before.counts.values }).toEqual(before.counts);
    expect(olumiEstimateWords({ values: after.counts.values, links: after.counts.links })).toContain(`${after.counts.values} starting value`);
    // CONTRAST: the user's own stated range on the same risk is not Olumi's estimate.
    const users = structuredClone(written); riskOf(users).event_risk.occurrence.basis = 'user';
    expect(goalChanceEstimateCensus(users, OPTIONS, 'productivity').counts).toEqual(before.counts);
  });

  it('AIE window: the goal’s CURRENT recorded period; two recorded periods that disagree are no window licence', () => {
    const agree = structuredClone(G); goalOf(agree).goal_horizon_months = 3;
    expect(riskOccurrenceSubject(agree, RISK)).toMatchObject({ kind: 'eligible', window_months: 3 });
    const conflict = structuredClone(G); goalOf(conflict).goal_horizon_months = 6;
    expect(riskOccurrenceSubject(conflict, RISK)).toEqual({ kind: 'ineligible', reason: 'no_window' });
  });

  it('AIE readiness copy: the eligible event path asks the occurrence within the window; an ineligible risk keeps its question, never promising a card', () => {
    // AMENDED (DL 15 Oct 23:19Z; AIE #94 6177505214): Olumi's own unsized risk (`ai_inferred`) is left out of the Run and never
    // asked as a blocker. The readiness copy below is the path for a risk that is NOT positively Olumi's: here, one with no origin
    // stamp (never Olumi's by a missing stamp), so the copy keeps its own row.
    const olumis = (((buildCanonicalAnalysisReadyFromGraph(G) as Rec).readiness_issues ?? []) as Rec[]).filter((i) => i.factor_id === RISK);
    expect(olumis).toEqual([]);
    const unstamped = (g: Rec): Rec => { const c = structuredClone(g); delete riskOf(c).provenance; return c; };
    const ask = (g: Rec): string[] => (((buildCanonicalAnalysisReadyFromGraph(unstamped(g)) as Rec).readiness_issues ?? []) as Rec[])
      .filter((i) => i.code === 'MISSING_FACTOR_LEVEL' && i.factor_id === RISK).map((i) => i.message);
    expect(ask(G)).toEqual(['Is ‘Code quality deterioration’ already true now? If so, say so. If not: How likely is ‘Code quality deterioration’ to happen at least once within 3 months? Olumi can’t run the numbers '
      + 'until this risk has a figure. Or ask Olumi to suggest a starting estimate for you to review.']);
    // PL 05:53Z: where no card can exist (no single saved goal period), the ask never offers one.
    const honest = ['How likely or how large is "Code quality deterioration" today? Olumi can’t run the numbers until this '
      + 'risk has a figure.'];
    const conflict = structuredClone(G); goalOf(conflict).goal_horizon_months = 6;
    expect(ask(conflict)).toEqual(honest);
    const noPeriod = structuredClone(G); delete goalOf(noPeriod).goal_target_basis;
    expect(riskOccurrenceSubject(noPeriod, RISK)).toEqual({ kind: 'ineligible', reason: 'no_window' });
    expect(ask(noPeriod)).toEqual(honest);
  });
});

/**
 * ⭐ S2 "HOLDS NOW" (SCIENCE 16:49Z; AIE #94 6173489813): a risk the user says is ALREADY TRUE NOW is recorded as theirs, from
 * their verified words, never asked as an occurrence chance. Real capabilities, real writer, real readiness.
 */
describe('S2 holds now: the user’s statement that a risk already holds', () => {
  const SAID = 'Honestly, our code quality is already slipping.';
  const world = (initial: Rec = G) => {
    let g = structuredClone(initial);
    let commits = 0;
    const caps = createAgentCapabilities(async (path) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: structuredClone(g), graph_hash: computeAnalysisAffectingGraphHash(g as never) } };
      if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
      throw new Error(path);
    }, new ProposalStore(), undefined, 'full', undefined, { commitOptionLevels: async (input) => {
      commits += 1;
      const r = applyRiskOccurrenceEdit(g, input.risk_occurrence!);
      if (r.kind !== 'mutated') return { status: 'refused', reason: r.kind } as never;
      g = r.mutatedGraph as Rec;
      return { status: 'committed', graph_hash: computeAnalysisAffectingGraphHash(g as never)!, already_applied: false, committed_levels: [], links_resized: [], receipt: null } as never;
    } });
    return { caps, graph: () => g, commits: () => commits };
  };
  const ctx = (said: string, extra: Rec = {}): Rec => ({ scenario_id: 'dc4e09b6-3727-4b14-a3af-dceef435b7d9', authenticated_user_id: null, request_id: 'r',
    turn_id: 't', user_text: said, user_turn_text: said, preceding_assistant_text: ASKED, ...extra });
  // SYSTEM 1 M1: "holds now" is the ONE statement door's (field holds_now), answering Olumi's readiness ask about this risk.
  const holdsNow = (quote: string): Rec => ({ subject: { kind: 'risk', label: riskOf(G).label, field: 'holds_now' }, statements: [{ quote }] });
  const ASKED = 'Is ‘Code quality deterioration’ already true now? If so, say so.';
  const asks = (g: Rec): string[] => (((buildCanonicalAnalysisReadyFromGraph(g) as Rec).readiness_issues ?? []) as Rec[])
    .filter((i) => i.code === 'MISSING_FACTOR_LEVEL' && i.factor_id === RISK).map((i) => i.message as string);

  it('RED→GREEN: their words → ONE card quoting them → the press → the risk holds now as THEIRS (occurrence 1, basis user); its gap closes', async () => {
    const w = world();
    // Before (AMENDED, DL 15 Oct 23:19Z): Olumi's unsized risk is left out of the Run, so readiness does not ask, and the host
    // says what the calculation leaves out; the user's own words below still size it through this card.
    expect(asks(w.graph())).toEqual([]);
    expect(unsizedOlumiRiskLine(w.graph(), RISK, false)).toContain('‘Code quality deterioration’ is Olumi’s unsized risk suggestion');
    const card = await w.caps.proposeStatement!(ctx(SAID) as never, holdsNow(SAID)) as Rec;
    expect(card).toMatchObject({ ok: true, statement: { subject: 'Code quality deterioration', field: 'holds_now', quotes: [SAID] } });
    expect(card.public_label).toBe(`From your message: “${SAID}” Olumi proposes this reading: ‘Code quality deterioration’ already being true now. How `
      + 'strongly it affects ‘Productivity’ is a separate assumption: its effect on ‘Productivity’ is still Olumi’s placeholder, not yet sized. Record this reading?');
    expect(card.public_label).not.toMatch(/chance|likely|Olumi’s starting assumption/);
    // Card-only: the Agent's reading of a yes never applies it.
    expect(await w.caps.authoriseChange(ctx('Yes') as never, { proposal_id: String(card.proposal_id) })).toMatchObject({ ok: false, refusal: 'approval_required' });
    expect(w.commits()).toBe(0);
    // AIE 6181498097: its write adds Olumi's derivation (p = 1 within a window from today), so its button is "Use this reading".
    const res = await w.caps.authoriseChange({ ...ctx('Yes, use this reading.'), typed_approval_of: String(card.proposal_id),
      typed_approval_words: 'Yes, use this reading.' } as never, { proposal_id: String(card.proposal_id) }) as Rec;
    expect(res).toMatchObject({ ok: true, applied: true, follow_up: 'Recorded from your words: ‘Code quality deterioration’ is already true now. '
      + 'How strongly it affects the model is still Olumi’s placeholder on its link.' });
    expect(riskOf(w.graph()).event_risk).toEqual({ version: 1, occurrence: { p_low: 1, p_high: 1, meaning: 'at_least_once_within_horizon', basis: 'user' }, horizon: { months: 3 } });
    // AIE 6178729504 / 6180193788: their words are durable beside it (`user_statements[]`), not only on the card and receipt.
    expect(riskOf(w.graph()).user_statements).toEqual([expect.objectContaining({ subject_key: `risk|${RISK}|||holds_now`, field: 'holds_now',
      statements: [expect.objectContaining({ speaker: 'user', quote: SAID, form: 'holds_now' })] })]);
    expect(asks(w.graph())).toEqual([]);
    expect(w.commits()).toBe(1);
  });
  it('never on unverified, partial or other words; a risk that cannot hold it says why; the writer refuses a holds-now block without its statement', async () => {
    const w = world(), before = JSON.stringify(w.graph());
    // "code quality is already slipping" drops "Honestly, our": not their whole statement (T2A5's one check).
    expect(await w.caps.proposeStatement!(ctx(SAID) as never, holdsNow('code quality is already slipping.'))).toMatchObject({ ok: false, refusal: 'statement_not_found' });
    expect(await w.caps.proposeStatement!(ctx('Please record it.', { user_text: 'Please record it.', unverified_user_text: SAID }) as never, holdsNow(SAID)))
      .toMatchObject({ ok: false, refusal: 'origin_unknown' });
    // AIE 6178729504 + SCIENCE 22:40Z: the blocker is the figure's write, said once; never that it is not true now.
    const conflict = structuredClone(G); goalOf(conflict).goal_horizon_months = 6;
    const c = await world(conflict).caps.proposeStatement!(ctx(SAID) as never, holdsNow(SAID)) as Rec;
    expect(c).toMatchObject({ ok: false, refusal: 'not_this_field' });
    expect(c.detail).toContain('‘Code quality deterioration’ being true now is the user’s own statement: keep it as theirs');
    expect(c.detail).toContain('the goal does not have one clear period yet');
    // A window counted from a LAUNCH: true now does not show it holds then, so no p = 1 is offered over it.
    const launch = structuredClone(G); goalOf(launch).goal_target_basis.reference = 'launch';
    expect(c.detail).not.toMatch(/cannot be recorded as already true now/);
    const l = await world(launch).caps.proposeStatement!(ctx(SAID) as never, holdsNow(SAID)) as Rec;
    expect(l).toMatchObject({ ok: false, refusal: 'not_this_field' });
    expect(l.detail).toContain('the goal’s period counts from the launch, and being true now does not show it still holds then');
    expect(JSON.stringify(w.graph())).toBe(before);
    expect(w.commits()).toBe(0);
    // The writer: a user block needs its verified statement, and a statement never carries Olumi's range.
    const userBlock = userHoldsNowBlock(3)!;
    expect(applyRiskOccurrenceEdit(G, { ...approved(), event_risk: userBlock })).toEqual({ kind: 'refused', reason: 'invalid_block' });
    const statement = { speaker: 'user', quote: SAID, source: SAID, subject: { quantity: 'risk_holds_now', node_id: RISK }, form: 'holds_now', unit: '', reading: 'olumi' } as never;
    expect(applyRiskOccurrenceEdit(G, { ...approved(), holds_now: statement })).toEqual({ kind: 'refused', reason: 'invalid_block' });
    // A user's statement is written only WITH its durable record (`user_statements[]`, dated by the door's writer).
    expect(applyRiskOccurrenceEdit(G, { ...approved(), event_risk: userBlock, holds_now: statement })).toEqual({ kind: 'refused', reason: 'invalid_block' });
    expect(applyRiskOccurrenceEdit(G, { ...approved(), event_risk: userBlock, holds_now: statement, recorded_at: '2026-10-15T00:00:00.000Z' })).toMatchObject({ kind: 'mutated' });
  });
});
