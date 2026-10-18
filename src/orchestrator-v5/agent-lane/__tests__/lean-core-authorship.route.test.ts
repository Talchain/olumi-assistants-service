/**
 * ⭐⭐ LEAN CORE: THE ONE AUTHORSHIP RULE on the REAL path (DL-3 18 Oct 2026; outbox/LEAN-CORE-DESIGN.md (f)). Each row drives an actual
 * writer and reads the SAVED record back by identity: construction through `buildModelFromBrief` (scripted drafter) → `/graph/register`
 * body; chat through `dispatchTool` → card → `authoriseChange` press → the register route's store → read back. Synthetic words only.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { saidByOf, userStated } from '../user-statements.js';
import { currentCorrectionOf } from '../../statement-door/read.js';
import { prepareStatementCorrection, claimRecordsOn, userStatementFor, userStatementsOn } from '../../statement-door/statements.js';
import { reconcileGoalScope } from '../reconcile-goal-scope.js';
import { ProposalStore } from '../proposal.js';

type Rec = Record<string, any>;
const AIM = 'We want to grow weekly bookings to at least 300 within 12 months.';
const TODAY = 'Bookings are 180 a week today.';
const BRIEF = [AIM, TODAY, 'We could add evening slots or run a referral offer.'].join('\n');
const GOAL = 'Weekly bookings';

function draft(over: { goal?: Rec; statements?: Rec[] } = {}): Rec {
  const link = (from: string, to: string): Rec => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 300, unit: 'bookings a week', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: true, baseline_value: 180, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM, deadline_words: null, ...over.goal },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Add evening slots', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: 'Evening slots', value: 20, value_kind: 'absolute', unit: 'slots a week', provenance: 'ai_proposed' }] },
    ],
    factors: [{ label: 'Evening slots', role: 'controllable', baseline_known: false, baseline_value: 0, unit: 'slots a week', provenance: 'ai_proposed', plausible_max: 60 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null, outcomes: [],
    links: [link('Evening slots', GOAL)],
    statements: over.statements ?? [
      { quote: AIM, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound', value: 300,
        low: null, high: null, unit: 'bookings a week', qualifier: null, conditions: null },
    ],
  };
}

async function saved(model: Rec, text = BRIEF): Promise<Rec> {
  let body: Rec | undefined;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('7b7b7b7b-0000-4b7b-8b7b-7b7b7b7b7b7b', text, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 800)).toBe(true);
  return body!;
}
const goalOf = (g: Rec): Rec => g.nodes.find((n: Rec) => n.kind === 'goal');

describe('W28: the goal\'s target is the user\'s by the door\'s own verdict, never by the drafter\'s flag or a host re-scan', () => {
  it('a verified {goal, target} statement holds the target as the user\'s even when the drafter did not mark the goal explicit', async () => {
    const g = await saved(draft({ goal: { provenance: 'inferred' } }));
    expect(goalOf(g)).toMatchObject({ label: GOAL, threshold_source: 'brief_extraction', goal_direction: '>=' });
  });

  it('CONTRAST: the drafter\'s explicit flag alone, with no verified target statement, never holds the target as the user\'s', async () => {
    const g = await saved(draft({ statements: [{ quote: TODAY, subject: { kind: 'factor', label: GOAL, to_label: null, factor_label: null },
      field: 'level', form: 'point', value: 180, low: null, high: null, unit: 'bookings a week', qualifier: null, conditions: null }] }));
    expect(goalOf(g).threshold_source).toBeUndefined();
  });

  it('CONTRAST: a target statement whose words the user never wrote is not theirs, whatever the flag says', async () => {
    const g = await saved(draft({ statements: [{ quote: 'We want at least 300 weekly bookings.', subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null },
      field: 'target', form: 'lower_bound', value: 300, low: null, high: null, unit: 'bookings a week', qualifier: null, conditions: null }] }));
    expect(goalOf(g).threshold_source).toBeUndefined();
  });
});

describe('PL-0048 (2): a span the user\'s correction retired is never re-credited by a later literal match, cold too', () => {
  const levelStatement = { quote: TODAY, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'level', form: 'point',
    value: 180, low: null, high: null, unit: 'bookings a week', qualifier: null, conditions: null };
  const FIX = 'Ignore the weekly bookings figure of 180 I gave, I have no reliable count.';
  async function corrected(edit: Rec = { retirement: { quote: TODAY, scope: 'whole', disposition: 'retracted' }, retained: [] }):
  Promise<{ graph: Rec; live: Rec; subject: Rec }> {
    const g = await saved(draft({ statements: [...(draft().statements as Rec[]), levelStatement] }));
    const subject = { kind: 'goal' as const, id: String(goalOf(g).id), field: 'level' as const };
    expect(userStatementFor(g, subject)?.statements.map((st) => st.quote), 'construction recorded the user\'s level').toEqual([TODAY]);
    const result = prepareStatementCorrection(g, { quote: FIX, edits: [{ subject, ...edit, reading_words: 'The earlier weekly figure is withdrawn.' }] } as never,
      { now: FIX }, '2026-10-18T01:00:00Z');
    if ('refused' in result) throw new Error(String(result.refused));
    // The register route's persistence: the saved bytes, read back cold (`graph`); `live` is the in-memory candidate the press wrote.
    return { graph: JSON.parse(JSON.stringify(result.candidate)) as Rec, live: result.candidate as Rec, subject };
  }
  const SCENARIO = '7b7b7b7b-0000-4b7b-8b7b-7b7b7b7b7b7b';
  const LATER = 'Keep the existing goal scope and set today\'s level from the earlier brief.';
  /** The migrated consumer, unchanged: `reconcileGoalScope` reads the goal's PERSISTED correction and asks THE ONE RULE whose level it is. */
  async function reconcileLevel(graph: Rec, typed: { now: string; conversation: string; messages?: string[]; complete?: boolean },
    level: { value: number; quote: string } = { value: 180, quote: TODAY }): Promise<{ out: Rec; proposals: readonly unknown[] }> {
    const scope = { modelled: 'weekly bookings', alternative: 'weekly bookings', extent: 'total', stated_in_brief: true, source: { quote: AIM } };
    goalOf(graph).goal_scope = scope;
    const proposals = new ProposalStore();
    const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'lean-core-b1', turn_id: 'lean-core-b1', user_turn_text: typed.now,
      user_text: typed.conversation, ...(typed.messages !== undefined ? { verified_user_messages: typed.messages } : {}), user_text_complete: typed.complete ?? true };
    const out = await reconcileGoalScope({ readGraph: async () => ({ nodes: graph.nodes, edges: graph.edges, raw: graph, graph_hash: 'h', brief_text: BRIEF } as never),
      readPending: async () => [], proposals }, ctx as never, { goal_label: GOAL, scope, current_level: { ...level, unit: 'bookings a week' } }) as unknown as Rec;
    return { out, proposals: proposals.outstanding(SCENARIO, null) };
  }
  const chat = (...messages: string[]) => ({ now: messages[messages.length - 1], conversation: messages.join('\n'), messages });

  it('after the correction, the brief\'s "180 a week" quoted again is not the user\'s (unknown), read from the cold saved record', async () => {
    const { graph, subject } = await corrected();
    const current = currentCorrectionOf(graph, subject as never);
    expect(current).toEqual({ correction: FIX, kept: [] });
    expect(userStated({ quote: TODAY, value: 180, unit: 'bookings a week' }, chat(BRIEF, FIX, 'Please set today\'s level.'), { quantity: 'goal_level' },
      { current })).toMatchObject({ origin: 'unknown' });
  });

  it('CONTRAST: with no correction on record the same quote is theirs; a NEW figure typed after the correction is theirs', async () => {
    const { graph, subject } = await corrected();
    expect(userStated({ quote: TODAY, value: 180, unit: 'bookings a week' }, chat(BRIEF, 'Please set today\'s level.'), { quantity: 'goal_level' })
      .origin).toBe('human');
    const fresh = 'Bookings are 210 a week now.';
    expect(userStated({ quote: fresh, value: 210, unit: 'bookings a week' }, chat(BRIEF, FIX, fresh), { quantity: 'goal_level' },
      { current: currentCorrectionOf(graph, subject as never) }).origin).toBe('human');
  });

  // ⛔ BUDDY-A B1 (#3391 @ec39bf01): the persisted correction holds whether or not its chat message is in this history.
  it('B1 missing chat message: the correction is not in this history, yet the withdrawn 180 is NOT the user\'s; no card', async () => {
    const { live } = await corrected();
    const r = await reconcileLevel(live, { now: LATER, conversation: [BRIEF, LATER].join('\n'), messages: [BRIEF, LATER] });
    expect(r.out).toMatchObject({ ok: false, refusal: 'level_not_stated' });
    expect(r.proposals).toHaveLength(0);
  });

  it('B1 aggregated message: the brief and the correction in ONE message (and the no-messages fallback) never re-credit the 180', async () => {
    const { live } = await corrected();
    const together = `${BRIEF}\n${FIX}`;
    for (const typed of [{ now: LATER, conversation: [together, LATER].join('\n'), messages: [together, LATER] },
      { now: LATER, conversation: [together, LATER].join('\n') }]) {
      const r = await reconcileLevel(structuredClone(live), typed);
      expect(r.out, JSON.stringify(typed.messages ?? 'fallback')).toMatchObject({ ok: false, refusal: 'level_not_stated' });
      expect(r.proposals).toHaveLength(0);
    }
  });

  it('B1 cold read: the saved bytes read back after a reopen with partial history never re-credit the 180', async () => {
    const { graph } = await corrected();
    const r = await reconcileLevel(graph, { now: LATER, conversation: [BRIEF, LATER].join('\n'), messages: [BRIEF, LATER], complete: false });
    expect(r.out).toMatchObject({ ok: false, refusal: 'level_not_stated' });
    expect(r.proposals).toHaveLength(0);
  });

  it('CONTRAST (B1 rows are not vacuous): with NO correction on record each of those histories credits the 180 and prepares the card', async () => {
    const g = await saved(draft({ statements: [...(draft().statements as Rec[]), levelStatement] }));
    const together = `${BRIEF}\n${FIX}`;
    for (const typed of [{ now: LATER, conversation: [BRIEF, LATER].join('\n'), messages: [BRIEF, LATER] },
      { now: LATER, conversation: [together, LATER].join('\n'), messages: [together, LATER] },
      { now: LATER, conversation: [together, LATER].join('\n') },
      { now: LATER, conversation: [BRIEF, LATER].join('\n'), messages: [BRIEF, LATER], complete: false }]) {
      const r = await reconcileLevel(structuredClone(g), typed);
      expect(r.out, JSON.stringify(typed)).toMatchObject({ ok: true });
      expect(r.out.reconciliation?.current_level).toMatchObject({ value: 180, source: { quote: TODAY } });
      expect(r.proposals).toHaveLength(1);
    }
  });

  it('CONTRAST (positives kept): a span the correction KEPT, and a figure typed THIS turn, stay the user\'s with the correction\'s message missing', async () => {
    const kept = 'Bookings are 180 a week';
    const { graph: keptGraph } = await corrected({ retirement: { quote: 'today', scope: 'part', disposition: 'historical' }, retained: [kept] });
    const k = await reconcileLevel(keptGraph, { now: LATER, conversation: [BRIEF, LATER].join('\n'), messages: [BRIEF, LATER] }, { value: 180, quote: kept });
    expect(k.out).toMatchObject({ ok: true });
    expect(k.proposals).toHaveLength(1);
    const fresh = 'Bookings are 210 a week now.';
    const { graph } = await corrected();
    const f = await reconcileLevel(graph, { now: fresh, conversation: [BRIEF, fresh].join('\n'), messages: [BRIEF, fresh] }, { value: 210, quote: fresh });
    expect(f.out).toMatchObject({ ok: true });
    expect(f.out.reconciliation?.current_level).toMatchObject({ value: 210, source: { quote: fresh } });
    expect(f.proposals).toHaveLength(1);
  });

  // ⭐ P2 at the correction door (DL-3 18 Oct, integration hunk in statements.ts): the AI's own speaker reading of the correction's
  // words reaches the ONE correction check (`verifyStatements`). The label only takes credit away; "user" still needs the literal span.
  it('P2 correction door: a correction the AI reads as another speaker\'s ("other") or cannot place ("unknown") is a card whose source is NEVER the user\'s; "user" is theirs', async () => {
    const g = await saved(draft({ statements: [...(draft().statements as Rec[]), levelStatement] }));
    const subject = { kind: 'goal' as const, id: String(goalOf(g).id), field: 'level' as const };
    const ask = (quote: string, speaker: string) => prepareStatementCorrection(g, { quote, speaker, edits: [{ subject,
      retirement: { quote: TODAY, scope: 'whole', disposition: 'retracted' }, retained: [], reading_words: 'The earlier weekly figure is withdrawn.' }] } as never,
    { now: quote }, '2026-10-18T01:00:00Z');
    const reported = 'My manager says we should ignore the weekly bookings figure of 180, there is no reliable count.';
    // ⭐ GATE → LABEL: the AI's reading only subtracts credit — the card's source is unresolved, never the user's, and says so.
    for (const speaker of ['other', 'unknown']) {
      const r = ask(reported, speaker) as Rec;
      expect(r, speaker).toHaveProperty('candidate');
      expect(saidByOf(r.correction.source), speaker).toBe('unknown');
      expect(r.words, speaker).not.toContain('Recorded words — you:');
    }
    // CONTRAST: the user's own correction, read as theirs, prepares the card.
    expect(ask(FIX, 'user')).toHaveProperty('candidate');
  });
});

describe('check 3 (#3389 probe P2): a figure in another speaker\'s quoted words is never the user\'s, on the real build → register path', () => {
  const LOSS = 'Member loss';
  const withLoss = (line: string, quote: string, speaker: string | null = null): { model: Rec; brief: string } => {
    const base = draft();
    const model = { ...base, factors: [...base.factors, { label: LOSS, role: 'external', baseline_known: true, baseline_value: 5, unit: '% a month',
      provenance: 'explicit', plausible_max: 100 }], links: [...base.links, { from: LOSS, to: GOAL, direction: 'negative', provenance: 'inferred',
      effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null }],
    statements: [...(base.statements as Rec[]), { quote, subject: { kind: 'factor', label: LOSS, to_label: null, factor_label: null }, field: 'level',
      form: 'point', value: 5, low: null, high: null, unit: '% a month', qualifier: null, conditions: null, speaker }] };
    return { model, brief: [AIM, TODAY, line, 'We could add evening slots or run a referral offer.'].join('\n') };
  };
  const lossNode = (g: Rec): Rec => g.nodes.find((n: Rec) => n.label === LOSS);

  it('the user\'s report of a colleague\'s words, speaker included: the 5% is NOT the user\'s; the words are kept, speaker unknown', async () => {
    const line = 'A colleague said: “we lose 5% of members a month.”';
    const { model, brief } = withLoss(line, line);
    const g = await saved(model, brief);
    expect(userStatementsOn(lossNode(g)), 'never the user\'s figure').toEqual([]);
    expect(claimRecordsOn(lossNode(g)).flatMap((r) => r.statements)).toEqual([expect.objectContaining({ speaker: 'unknown', quote: line, source: line })]);
  });

  it('CONTRAST: the user\'s own "we lose 5% of members a month" IS credited to them', async () => {
    const line = 'Honestly, we lose 5% of members a month.';
    const { model, brief } = withLoss(line, line);
    const g = await saved(model, brief);
    expect(userStatementsOn(lossNode(g)).flatMap((r) => r.statements)).toEqual([expect.objectContaining({ speaker: 'user', quote: line, low: 5, high: 5 })]);
  });

  // ⭐ P2 (DL-3 18 Oct): an UNMARKED report has no quotation marks for the host to read, so the AI's OWN speaker reading decides
  // (`QUOTE_SPEAKER`, the drafter's statement field). Never a host word list.
  it('an unmarked report the AI reads as another speaker\'s ("A colleague said: we lose 5% of members a month"): not the user\'s figure; the claim is kept WITH its figure, speaker unresolved', async () => {
    const line = 'A colleague said: we lose 5% of members a month.';
    const { model, brief } = withLoss(line, line, 'other');
    const g = await saved(model, brief);
    expect(userStatementsOn(lossNode(g)), 'never the user\'s figure').toEqual([]);
    // ⭐ CLAIM RECORD at construction (plan converged step 2): a relayed claim keeps its bounds; with no party named its owner stays
    // unresolved — never the user's, never flattened to words without the figure.
    const kept = claimRecordsOn(lossNode(g)).flatMap((r) => r.statements);
    expect(kept).toEqual([expect.objectContaining({ said_by: 'unknown', quote: line, source: line, low: 5, high: 5 })]);
    expect(kept[0]).not.toHaveProperty('speaker');
  });

  it('CONTRAST: the user\'s own words, read as theirs ("user"), are credited; an AI-read "user" still needs the literal span', async () => {
    const own = 'Honestly, we lose 5% of members a month.';
    const g = await saved(withLoss(own, own, 'user').model, withLoss(own, own, 'user').brief);
    expect(userStatementsOn(lossNode(g)).flatMap((r) => r.statements)).toEqual([expect.objectContaining({ speaker: 'user', quote: own, low: 5, high: 5 })]);
    const notWritten = await saved(withLoss(own, 'we lose 5% of all members a month', 'user').model, withLoss(own, own, 'user').brief);
    expect(userStatementsOn(lossNode(notWritten)), 'words the user never wrote are not theirs, whatever the reading').toEqual([]);
  });
});
