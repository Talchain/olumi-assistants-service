/**
 * ⛔ A FIGURE IS RECORDED AS THE USER'S ONLY WHEN THE USER WROTE IT (`stated-by-user.ts`).
 *
 * Served on CEE fbb12b8 (guest witness, scenario fb2e5613; #70 5843805457). The user wrote: "Add an option: keep the
 * price at £49 and run a win-back offer for churned customers. It reduces Monthly churn. Please add it." The Agent
 * passed `level: {value: 0}` for Monthly churn to mean "not set", and one approval stored `monthly_churn: {value: 0,
 * unit: "percent per month", source: "user_specified"}` — a 0% churn level recorded as the user's, who gave none.
 *
 * FIXTURE: Paul's own stored graph (`cbd15f83`): Pro plan price in "GBP per month" on a 200 range, Monthly churn at 7
 * "percent per month"; "Raise to £59 at Release" acts on the price.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { figureTheUserWrote, typedByUser, userWordsOf } from '../stated-by-user.js';

const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as unknown;
const SERVED = 'Add an option: keep the price at £49 and run a win-back offer for churned customers. It reduces Monthly churn. Please add it.';
const ctxSaying = (user_text: string | undefined) => ({
  scenario_id: '550e8400-e29b-41d4-a716-4466554400c7', authenticated_user_id: null, request_id: 'r', ...(user_text !== undefined ? { user_text } : {}),
});
const setup = () => {
  const sent: { path: string; body: unknown }[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: paulGraph, graph_hash: 'h0' } };
    sent.push({ path, body });
    return { status: 500, json: {} };
  };
  const store = new ProposalStore();
  return { caps: createAgentCapabilities(d, store), sent, store };
};
type Sent = { chip?: { parameters?: { interventions?: { factor_id: string; value: unknown; raw_value?: unknown }[] } } };
const levelSent = (sent: { body: unknown }[], factorId: string) =>
  (sent[0]?.body as Sent | undefined)?.chip?.parameters?.interventions?.find((x) => x.factor_id === factorId);

describe('figureTheUserWrote — present in the user\'s words, in a compatible kind of unit', () => {
  it('RED: the served turn states no churn figure — neither 0 nor the price is a churn level the user wrote', () => {
    expect(figureTheUserWrote(0, 'percent per month', SERVED)).toBe(false);
    expect(figureTheUserWrote(49, 'percent per month', SERVED)).toBe(false);
    expect(figureTheUserWrote(49, undefined, SERVED), 'with no unit at all the written £49 cannot be ruled out — which is why callers pass the factor\'s unit').toBe(true);
  });

  it('RED: AI Quality\'s served turn (scenario 6d2d0bef, CEE fbb12b8; #70 5843825647) — 0 on a "%" churn factor is not the user\'s', () => {
    const AIQ = 'Add an option: keep the price at £49 and run a win-back offer. It reduces monthly churn.';
    expect(figureTheUserWrote(0, '%', AIQ)).toBe(false);
    expect(figureTheUserWrote(49, '%', AIQ)).toBe(false);
    expect(figureTheUserWrote(0.49, '%', AIQ), '£49 is never 49% nor 0.49').toBe(false);
  });

  it('a written percentage grounds its fraction on a share kept as 0–1 ("40%" → 0.4), never a money figure', () => {
    expect(figureTheUserWrote(0.4, '', 'Onboarding share is 40%.')).toBe(true);
    expect(figureTheUserWrote(40, 'percent', 'Onboarding share is 40%.')).toBe(true);
    expect(figureTheUserWrote(0.4, 'GBP', 'Onboarding share is 40%.')).toBe(false);
  });

  it('CONTRAST: the figures the user did write, in their kinds — including units the provenance reader calls plain', () => {
    expect(figureTheUserWrote(49, 'GBP per month', SERVED)).toBe(true);
    expect(figureTheUserWrote(49, '£ per month', SERVED)).toBe(true);
    const t = 'Test £54 vs £59. Churn might fall to 4%. Raise it to 62. Hire 7 engineers.';
    expect(figureTheUserWrote(54, 'GBP/month', t)).toBe(true);
    expect(figureTheUserWrote(4, 'percent per month', t)).toBe(true);
    expect(figureTheUserWrote(62, 'GBP per month', t), 'a bare figure grounds any kind').toBe(true);
    expect(figureTheUserWrote(7, 'engineers', t)).toBe(true);
    expect(figureTheUserWrote(54, 'percent per month', t), '£54 is never a percentage').toBe(false);
    expect(figureTheUserWrote(4, 'GBP per month', t), '4% is never a price').toBe(false);
  });

  it('no words bound → nothing is the user\'s', () => {
    expect(figureTheUserWrote(49, 'GBP per month', undefined)).toBe(false);
    expect(figureTheUserWrote(49, 'GBP per month', '')).toBe(false);
  });

  it('userWordsOf: what the user typed earlier, then this turn\'s message when they typed it', () => {
    const words = userWordsOf(['Test £54 vs £59.'], 'Add those.');
    expect(words).toContain('£54');
    expect(words).toContain('Add those.');
    expect(userWordsOf(['Test £54 vs £59.'], null)).toBe('Test £54 vs £59.');
    expect(userWordsOf([], null)).toBe('');
  });
});

describe('⛔ the user\'s words are what they TYPED — by provenance, never by text shape (#1978 reviews 5844589340 B1, 5844805634 B2/B3)', () => {
  it('typedByUser: a composer message is typed; a chip click, a board edit or any system event is not', () => {
    expect(typedByUser({ kind: 'message', message: 'Test £54 at release.' })).toBe(true);
    expect(typedByUser({ message: 'Test £54 at release.', source: 'composer' })).toBe(true);
    expect(typedByUser({ kind: 'message', source: 'chip', chip: { id: 'agent-approve-proposal:gmh_1' }, message: "Yes, add option 'Test £54 at release'." })).toBe(false);
    expect(typedByUser({ kind: 'message', chip: { id: 'agent-run-offer' }, message: 'Run analysis.' })).toBe(false);
    expect(typedByUser({ kind: 'message', source: 'chip', message: 'Talk me through Price.' })).toBe(false);
    expect(typedByUser({ kind: 'system_event', event: { kind: 'factor_value_edit' } })).toBe(false);
  });

  it('RED (#1978 review N1): only a composer message is typed — a chip_click with no chip object, a retry, or any unknown source is not', () => {
    expect(typedByUser({ kind: 'message', source: 'chip_click', message: "Yes, add option 'Test £54 at release'." })).toBe(false);
    expect(typedByUser({ kind: 'message', source: 'retry', message: 'Test £54 at release.' })).toBe(false);
    expect(typedByUser({ kind: 'message', source: 'coaching', message: 'Talk me through Price at £54.' })).toBe(false);
    expect(typedByUser({ kind: 'message', source: 'composer', message: 'Test £54 at release.' })).toBe(true);
  });

  it('RED (B2): a natural "Yes, …" reply keeps the user\'s own figure — contractions never cut it out', () => {
    for (const [text, value, unit] of [
      ['Yes, but it\'s closer to 4% now, that\'s from finance.', 4, '%'],
      ['Yes, let\'s make that one £62, it\'s what we\'ll charge.', 62, 'GBP'],
      ['Yes, let\'s add an option at £59, that\'s the price we\'d test.', 59, 'GBP'],
      ['Yes, it\'s 4%.', 4, '%'],
    ] as const) {
      expect(figureTheUserWrote(value, unit, userWordsOf([], text)), text).toBe(true);
    }
  });
});

describe('propose_new_option sends only levels the user wrote', () => {
  const winBack = (level: { value: number; unit?: string }) => ({
    label: 'Keep £49 and run a win-back offer',
    acts_on: [{ factor_label: 'Monthly churn', direction: 'negative' as const, level }],
    rationale: 'the user asked for it',
  });

  it('RED: the served turn — level 0 for Monthly churn is sent unset, and said', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctxSaying(SERVED), winBack({ value: 0 }) as never) as { levels_not_set?: { factor: string; reason: string }[] };
    const churn = levelSent(sent, 'monthly_churn');
    expect(churn, JSON.stringify(sent[0]?.body)).toBeDefined();
    expect(churn!.value, 'no 0% churn is sent as the user\'s').toBeNull();
    void r;
  });

  it('CONTRAST: a price the user wrote (£59) is sent as the level, with its figure', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption(ctxSaying('Add an option: raise to £59 with a win-back offer.'), {
      label: 'Raise to £59 with a win-back offer',
      acts_on: [{ factor_label: 'Pro plan price', direction: 'positive', level: { value: 59, unit: '£' } }],
      rationale: 'x',
    } as never);
    const price = levelSent(sent, 'pro_plan_price');
    expect(price?.value).toBeCloseTo(59 / 200, 10);
    expect(price?.raw_value).toBe(59);
  });

  it('RED (B2): "Yes, let\'s add an option at £59, that\'s the price we\'d test." → £59 is the user\'s level, never lost', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption(ctxSaying(userWordsOf([], 'Yes, let\'s add an option at £59, that\'s the price we\'d test.')), {
      label: 'Test £59 before rollout',
      acts_on: [{ factor_label: 'Pro plan price', direction: 'positive', level: { value: 59, unit: '£' } }],
      rationale: 'x',
    } as never);
    expect(levelSent(sent, 'pro_plan_price')?.raw_value, JSON.stringify(sent[0]?.body)).toBe(59);
  });

  it('RED: a price the user never wrote (£64 against "£59") is sent unset', async () => {
    const { caps, sent } = setup();
    await caps.proposeNewOption(ctxSaying('Add an option: raise to £59 with a win-back offer.'), {
      label: 'Raise to £64 with a win-back offer',
      acts_on: [{ factor_label: 'Pro plan price', direction: 'positive', level: { value: 64, unit: '£' } }],
      rationale: 'x',
    } as never);
    expect(levelSent(sent, 'pro_plan_price')?.value).toBeNull();
  });
});

describe('propose_option_interventions: `user_stated` stands only on a figure the user wrote', () => {
  const level = (value: number) => ({ interventions: [{ option_label: 'Raise to £59 at Release', factor_label: 'Pro plan price', value, basis: 'x', user_stated: true }] });
  const authorOf = (store: ProposalStore, id: unknown) =>
    ((store.get(String(id))?.operations[0]?.value ?? {}) as { authored_by?: unknown }).authored_by;

  it('RED: the Agent marks £62 as the user\'s, but the user wrote £59 → recorded as Olumi\'s, and said', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('Raise to £59 at release.'), level(62) as never, undefined) as { ok?: boolean; proposal_id?: unknown; not_the_users_figure?: unknown[] };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(authorOf(store, r.proposal_id)).toBe('model_proposed');
    expect(r.not_the_users_figure).toEqual([{ option: 'Raise to £59 at Release', factor: 'Pro plan price', value: 62 }]);
  });

  it('RED (B2): "Yes, let\'s make that one £62, it\'s what we\'ll charge." → the user\'s', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying(userWordsOf([], 'Yes, let\'s make that one £62, it\'s what we\'ll charge.')), level(62) as never, undefined) as { ok?: boolean; proposal_id?: unknown };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(authorOf(store, r.proposal_id)).toBe('user_stated');
  });

  it('CONTRAST: the user wrote £62 → recorded as theirs, nothing said', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('Actually make that one £62.'), level(62) as never, undefined) as { ok?: boolean; proposal_id?: unknown; not_the_users_figure?: unknown };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(authorOf(store, r.proposal_id)).toBe('user_stated');
    expect(r).not.toHaveProperty('not_the_users_figure');
  });
});

describe('propose_assumptions: a revision is the user\'s only when they wrote the figure', () => {
  const revise = { assumptions: [{ factor_label: 'Monthly churn', value: 4, unit: '%', basis: 'x', revise: true }] };
  const opAuthor = (store: ProposalStore, id: unknown) =>
    ((store.get(String(id))?.operations[0]?.value ?? {}) as { authored_by?: unknown }).authored_by;

  it('RED: "churn is lower than that" → the Agent\'s 4% is a revision recorded as Olumi\'s, and said', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeAssumptions(ctxSaying('I think churn is lower than that.'), revise as never) as { ok?: boolean; proposal_id?: unknown; not_the_users_figure?: unknown[] };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(opAuthor(store, r.proposal_id)).toBe('model_proposed');
    expect(store.get(String(r.proposal_id))?.provenance.authored_by).toBe('model_proposed');
    expect(r.not_the_users_figure).toEqual([{ factor: 'Monthly churn', value: 4 }]);
  });

  it('RED (B2): "Yes, but it\'s closer to 4% now, that\'s from finance." → the user\'s revision', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeAssumptions(ctxSaying(userWordsOf([], 'Yes, but it\'s closer to 4% now, that\'s from finance.')), revise as never) as { ok?: boolean; proposal_id?: unknown };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(opAuthor(store, r.proposal_id)).toBe('user_stated');
  });

  it('CONTRAST: "I think churn is more like 4%" → the user\'s revision, as before', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeAssumptions(ctxSaying('I think churn is more like 4%.'), revise as never) as { ok?: boolean; proposal_id?: unknown; not_the_users_figure?: unknown };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(opAuthor(store, r.proposal_id)).toBe('user_stated');
    expect(store.get(String(r.proposal_id))?.provenance.authored_by).toBe('user_stated');
    expect(r).not.toHaveProperty('not_the_users_figure');
  });
});

describe('the Agent route binds the user\'s words to every tool it runs', () => {
  it('RED: one tool context, built from what the user TYPED (never the history), used at every site', () => {
    const route = readFileSync(new URL('../../../routes/agent-v1-turn.ts', import.meta.url), 'utf8');
    expect(route).toContain('const typedNow = typedByUser(body) ? message : null;');
    expect(route).toContain('user_text: userWordsOf(histories.typedWords(sessionId), typedNow) };');
    expect(route).toContain('if (typedNow !== null) histories.recordTyped(sessionId, typedNow);');
    expect(route).not.toContain('userWordsOf(history');
    expect(route).not.toContain('{ scenario_id: scenarioId, authenticated_user_id: userId, request_id: req.id }');
    expect(route.match(/\btoolCtx\b/g)?.length, 'declared once, used at the three dispatch sites').toBe(4);
  });
});
