/**
 * ⛔ T1 HOST P07 (pilot 17 Oct, judges/T1-ATTRIBUTION.codex.md; outbox/LANE-A-T1-HOST-MAP.md row 4–5): a person's words the brief
 * quotes with their name ("Name, role: '…'") were refused as "not a whole statement", because the quote check never let a closing
 * quotation mark follow the full stop, so the statement and its attribution were lost from the saved model. The AI quoted them
 * verbatim. SYNTHETIC brief (an analogue of the shape, never the brief itself).
 * Real path: `buildModelFromBrief` (scripted drafter) → `/graph/register` → the saved record.
 */
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { userStatementsOn } from '../../statement-door/statements.js';

type Rec = Record<string, any>;
const AIM = 'We need to bring in at least £600k of new contract value this year.';
// Double marks bound a speech; single marks cannot (an apostrophe is the same mark): DL-3 16:14Z.
const SPEECH = 'Priya, sales lead: “More referrals mean more contracts signed, because the client already trusts us.”';
const BRIEF = `${AIM} ${SPEECH} We could hire a second salesperson or start a referral scheme.`;
const GOAL = 'New contract value';
const REFERRALS = 'Referrals';
const COUNT = 'Contracts signed';

function draft(quote: string): Rec {
  const link = (from: string, to: string): Rec => ({ from, to, direction: 'positive', provenance: 'inferred', effect_amount: null,
    effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null });
  return {
    goal: { kind: null, deliverable: null, metric: GOAL, operator: '>=', target_stated: true, value: 600000, unit: '£', horizon_months: 12,
      provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'explicit', scope: null,
      quantity_frame: 'level', source_quote: AIM, deadline_words: null },
    constraints: [],
    options: [
      { label: 'Carry on as now', provenance: 'ai_proposed', changes: [], interventions: [], added_capacity: null, is_status_quo: true },
      { label: 'Start a referral scheme', provenance: 'explicit', changes: [], added_capacity: null, is_status_quo: null,
        interventions: [{ factor_label: REFERRALS, value: 20, value_kind: 'absolute', unit: 'referrals', provenance: 'ai_proposed' }] },
    ],
    factors: [{ label: REFERRALS, role: 'controllable', baseline_known: false, baseline_value: 5, unit: 'referrals', provenance: 'ai_proposed', plausible_max: 50 }],
    risks: [], identities: [], unknowns: [], unknown_concerns: [], decision_question: null,
    outcomes: [{ label: COUNT, provenance: 'inferred', unit: 'contracts', plausible_max: 30 }],
    links: [link(REFERRALS, COUNT), link(COUNT, GOAL)],
    statements: [
      { quote: AIM, subject: { kind: 'goal', label: GOAL, to_label: null, factor_label: null }, field: 'target', form: 'lower_bound', value: 600000, low: null, high: null, unit: '£', qualifier: null, conditions: null },
      { quote, subject: { kind: 'link', label: REFERRALS, to_label: COUNT, factor_label: null }, field: 'relation', form: 'describes',
        value: null, low: null, high: null, unit: null, qualifier: null, conditions: null },
    ],
  };
}
async function saved(model: Rec, brief = BRIEF): Promise<Rec> {
  let body: Rec | undefined;
  const call = (async () => ({ text: JSON.stringify(model) })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) { body = structuredClone((b as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('5e5e5e5e-0000-4e5e-8e5e-5e5e5e5e5e5e', brief, d, call) as Rec;
  expect(out.ok, JSON.stringify(out).slice(0, 800)).toBe(true);
  return body!;
}
const relationRecord = (graph: Rec): Rec | undefined => {
  const from = graph.nodes.find((n: Rec) => n.label === REFERRALS);
  const to = graph.nodes.find((n: Rec) => n.label === COUNT);
  return from?.user_statements?.find((r: Rec) => r.subject_key === `link|${from.id}|${to.id}||relation`);
};
/**
 * ⛔ DL-3 16:14Z (first loss P07/P09; #3376 rulings 2–3): words the check cannot bound as whole are KEPT, by identity: speaker unknown,
 * the exact words, the brief's line, `describes`, and no figure, unit or sign. They are never the user's: every reader's record
 * (`userStatementsOn`) holds none for this subject.
 */
async function expectKeptNeverTheUsers(graph: Promise<Rec>, quote: string, brief: string, why = quote): Promise<void> {
  const g = await graph;
  expect(relationRecord(g)?.statements, why).toEqual([{ speaker: 'unknown', quote, source: brief, form: 'describes', reading: 'olumi',
    subject: { quantity: `link|${REFERRALS.toLowerCase()}|${COUNT.toLowerCase()}||relation` } }]);
  const from = g.nodes.find((n: Rec) => n.label === REFERRALS);
  expect(userStatementsOn(from).filter((r) => r.subject_key === relationRecord(g)!.subject_key), `${why}: never the user's`).toEqual([]);
}

describe('a person the brief quotes by name keeps their words, whole, on the link they are about', () => {
  it('⭐ RED → GREEN, real build → register: "Name, role: “…”" closed after its full stop is recorded verbatim, speaker included', async () => {
    const record = relationRecord(await saved(draft(SPEECH)));
    expect(record?.statements, 'the named speech is recorded').toEqual([expect.objectContaining({ speaker: 'user', quote: SPEECH, form: 'describes' })]);
  });

  it('⛔ #3363 B1 (BUDDY-A), real path: a two-sentence speech with an earlier qualification is kept whole; its last sentence alone is never the user\'s', async () => {
    const qualified = 'Priya, sales lead: “This is only true if the pilot works. More referrals mean more contracts signed, because the client already trusts us.”';
    const tail = 'More referrals mean more contracts signed, because the client already trusts us.”';
    const brief = `${AIM} ${qualified} We could hire a second salesperson or start a referral scheme.`;
    const whole = relationRecord(await saved(draft(qualified), brief));
    expect(whole?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: qualified })]);
    await expectKeptNeverTheUsers(saved(draft(tail), brief), tail, brief, 'the tail loses Priya and her condition');
  });

  it('⛔ #3363 B1 R2 A (BUDDY-A), real path: a plural possessive inside the speech and its full stop OUTSIDE the closing mark never free its last sentence', async () => {
    const qualified = "Priya, sales lead: “This is only true if the users' pilot works. More referrals mean more contracts signed, because the client already trusts us”.";
    const tail = 'More referrals mean more contracts signed, because the client already trusts us”.';
    const brief = `${AIM} ${qualified} We could hire a second salesperson or start a referral scheme.`;
    expect(relationRecord(await saved(draft(qualified), brief))?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: qualified })]);
    await expectKeptNeverTheUsers(saved(draft(tail), brief), tail, brief, 'the tail loses Priya and her condition');
  });

  it('⛔ DL-3 16:14Z, real path: the same speech in SINGLE marks cannot be bounded: neither all of it nor its tail is recorded as anyone\'s, and no speaker is asserted (words kept)', async () => {
    const qualified = "Priya, sales lead: 'This is only true if the users' pilot works. More referrals mean more contracts signed, because the client already trusts us'.";
    const tail = "More referrals mean more contracts signed, because the client already trusts us'.";
    const brief = `${AIM} ${qualified} We could hire a second salesperson or start a referral scheme.`;
    for (const quote of [qualified, tail]) await expectKeptNeverTheUsers(saved(draft(quote), brief), quote, brief);
    for (const quote of ['More referrals mean more contracts signed, because the client already trusts us.']) {
      expect(relationRecord(await saved(draft(quote), brief)), quote).toBeUndefined();
    }
  });

  it('⛔ #3363 B1 R3 A (BUDDY-A), real path: single-marked speech with NO colon ("Priya said \'…\'") never frees its last sentence as the user\'s', async () => {
    const said = 'More referrals mean more contracts signed, because the client already trusts us.';
    const brief = `${AIM} Priya said 'This is only true if the users' pilot works. ${said}' We could hire a second salesperson or start a referral scheme.`;
    await expectKeptNeverTheUsers(saved(draft(said), brief), said, brief, 'the tail loses Priya and her condition');
  });

  it('⛔ #3363 B1 R3 B (BUDDY-A), real path: a lone inch mark opens no speech; the complete sentence after it is recorded', async () => {
    const said = 'More referrals mean more contracts signed, because the client already trusts us.';
    const brief = `${AIM} We use a 12" rack. ${said} We could hire a second salesperson or start a referral scheme.`;
    expect(relationRecord(await saved(draft(said), brief))?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: said })]);
  });

  it('⛔ #3363 B1 R2 B (BUDDY-A), real path: a year written "\'27" opens no speech; the complete sentence after it is recorded', async () => {
    const said = 'More referrals mean more contracts signed, because the client already trusts us.';
    const brief = `${AIM} The plan starts in '27. ${said} We could hire a second salesperson or start a referral scheme.`;
    expect(relationRecord(await saved(draft(said), brief))?.statements).toEqual([expect.objectContaining({ speaker: 'user', quote: said })]);
  });

  it('CONTRAST: the same words without their speaker are not the brief\'s whole statement, so they are never recorded as the user\'s', async () => {
    const inner = 'More referrals mean more contracts signed, because the client already trusts us.';
    await expectKeptNeverTheUsers(saved(draft(inner)), inner, BRIEF);
  });
});
