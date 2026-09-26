/**
 * ⛔ AN OPTION LEVEL THE AGENT PROPOSES NEVER SILENTLY REPLACES ONE ALREADY STORED — the user's own level is never
 * replaced by a figure they did not type, and any replacement is SAID before approval.
 *
 * VERIFIED GAP (CODE-READ at `af719a1`, adversarially re-checked; Runtime brief of 26 Sep): `proposeOptionInterventions`
 * skipped a pair only when the stored level was IDENTICAL. Any other stored level — the user's own (`user_specified`)
 * included — became a replacement op, and the label read "<option> sets <factor> to <n>" with no prior figure.
 * `propose_starting_point` passes its levels straight through that proposer. The VALUE proposer (`propose_assumptions`)
 * refuses to overwrite unless `revise` is set, and its label says what it replaces. So one click could replace the
 * user's £60 with Olumi's £55 with nothing said.
 *
 * THE RULE, mirroring `propose_assumptions`: (a) a level the USER set is replaced only by a figure the user wrote and
 * gave as theirs (`user_stated` AND `figureTheUserWrote`, the #1978 grounding) — otherwise that pair is left as it is,
 * and said; (b) any replacement that goes ahead carries the old level into the proposal, the result and the label.
 *
 * FIXTURE: Paul's own stored graph (`cbd15f83`) — Pro plan price in "GBP per month" on a 200 range — with the user's
 * own level set on one option: "Raise to £59 at Release" holds £60 THE USER set (`{value: 0.3, source:
 * 'user_specified'}`). "Raise to £54 at Release" keeps Olumi's stored £54 (`cee_hypothesis`, 0.27). For the rows that
 * need a fresh pair and a starting value, "Test £54 versus £59 …" has no churn level and "Monthly new Pro
 * subscribers" no value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { approvalChipIdFor, approvalChipsFor } from '../approval-chips.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown>; interventions?: Record<string, unknown> | null };
const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as { nodes: Node[]; edges: unknown[] };

const USERS_60 = { value: 0.3, source: 'user_specified' };
const graph = (() => {
  const g = JSON.parse(JSON.stringify(paulGraph)) as { nodes: Node[]; edges: unknown[] };
  for (const n of g.nodes) {
    if (n.id === 'raise_to_59_at_release') n.interventions = { pro_plan_price: USERS_60 };
    if (n.id === '5d442591') delete (n.interventions as Record<string, unknown>).monthly_churn;
    if (n.id === 'monthly_new_pro_subscribers') delete n.observed_state;
  }
  return g;
})();

const SCENARIO = '550e8400-e29b-41d4-a716-4466554400c7';
const ctxSaying = (user_text: string) => ({ scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r', user_text });
const setup = () => {
  const writes: string[] = [];
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    writes.push(path);
    return { status: 500, json: {} };
  };
  const store = new ProposalStore();
  return { caps: createAgentCapabilities(d, store), store, writes };
};

const ON_USERS_LEVEL = 'Raise to £59 at Release';
const ON_OLUMIS_LEVEL = 'Raise to £54 at Release';
const level = (option_label: string, value: number, extra: Record<string, unknown> = {}) =>
  ({ option_label, factor_label: 'Pro plan price', value, basis: 'x', ...extra });
type Op = { op: string; path: string; value?: Record<string, unknown> };
const opsOf = (store: ProposalStore, r: ToolResult): Op[] => (store.get(String(r.proposal_id))?.operations ?? []) as Op[];
const notAccepted = (r: ToolResult): { option: string; factor: string; value: unknown; reason: string }[] =>
  (r.levels_not_accepted ?? []) as never;
function chipLabel(store: ProposalStore, name: string, r: ToolResult): string | undefined {
  const calls = [{ name, ok: r.ok, mutated: r.mutated, ...(typeof r.proposal_id === 'string' ? { proposal_id: r.proposal_id } : {}) }];
  const chip = approvalChipsFor(calls, (id) => ({ proposal: store.get(id), result: r.proposal_id === id ? r : undefined }))
    .find((c) => c.id === approvalChipIdFor(String(r.proposal_id)));
  return chip?.label;
}

describe('propose_option_interventions: the user\'s own level is replaced only by a figure the user wrote', () => {
  it('RED: Olumi\'s £55 over the user\'s £60 → not replaced, nothing awaiting approval, and said', async () => {
    const { caps, store, writes } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('Can you suggest a better level for the £59 option?'),
      { interventions: [level(ON_USERS_LEVEL, 55)] }, undefined);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(r.refusal).toBe('nothing_to_set');
    expect(store.outstanding(SCENARIO, null), 'nothing the user could approve').toEqual([]);
    expect(writes).toEqual([]);
    const [why] = notAccepted(r);
    expect([why?.option, why?.factor, why?.value]).toEqual([ON_USERS_LEVEL, 'Pro plan price', 55]);
    expect(why?.reason).toContain('already sets Pro plan price to 60 GBP per month, a level the user set');
    expect(why?.reason).toContain('55 is not a figure the user wrote, so their level is left as it is');
  });

  it('RED: the Agent marks £55 as the user\'s, but the user wrote £65 → the user\'s £60 is still not replaced', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('Make the £59 option £65 instead.'),
      { interventions: [level(ON_USERS_LEVEL, 55, { user_stated: true })] }, undefined);
    expect(r.ok, JSON.stringify(r)).toBe(false);
    expect(store.outstanding(SCENARIO, null)).toEqual([]);
    expect(notAccepted(r).map((x) => x.option)).toEqual([ON_USERS_LEVEL]);
  });

  it('RED: one call over both options → only Olumi\'s own level is proposed; the user\'s pair is left out and said', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('Suggest better levels for both price options.'),
      { interventions: [level(ON_USERS_LEVEL, 55), level(ON_OLUMIS_LEVEL, 56)] }, undefined);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(opsOf(store, r).map((o) => o.path)).toEqual(['raise_to_54_at_release::pro_plan_price']);
    expect(notAccepted(r).map((x) => x.option)).toEqual([ON_USERS_LEVEL]);
    expect(String(r.public_label)).not.toContain(ON_USERS_LEVEL);
  });

  it('RED: the user\'s own typed £65 → replaced, recorded as theirs, and the label says it replaces their £60', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('Make the £59 option £65 instead.'),
      { interventions: [level(ON_USERS_LEVEL, 65, { user_stated: true })] }, undefined);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const [op] = opsOf(store, r);
    expect(op?.path).toBe('raise_to_59_at_release::pro_plan_price');
    expect(op?.value?.authored_by).toBe('user_stated');
    expect(op?.value?.replaces, 'the old level travels INSIDE the stored proposal the user approves').toBe(60);
    expect(String(r.public_label)).toContain('Raise to £59 at Release sets Pro plan price to 65 GBP per month (replaces your 60 GBP per month)');
    expect((r.interventions as { replaces?: unknown }[])[0]?.replaces).toBe(60);
    expect(String(r.note)).toContain('REPLACE a level the option already sets');
  });

  it('RED: Olumi\'s stored £54 estimate replaced by Olumi\'s £56 → allowed, and the label says it replaces £54', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('Suggest a better level for the £54 option.'),
      { interventions: [level(ON_OLUMIS_LEVEL, 56)] }, undefined);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const [op] = opsOf(store, r);
    expect(op?.value?.authored_by).toBe('model_proposed');
    expect(op?.value?.replaces).toBe(54);
    expect(String(r.public_label)).toContain('Raise to £54 at Release sets Pro plan price to 56 GBP per month (replaces Olumi’s estimate of 54 GBP per month)');
  });

  it('CONTRAST: a pair with no stored level is a fresh level — nothing is said to be replaced', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('What would the cohort test do to churn?'),
      { interventions: [{ option_label: 'Test £54 versus £59 by customer cohort before rollout', factor_label: 'Monthly churn', value: 6, basis: 'x' }] }, undefined);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const [op] = opsOf(store, r);
    expect(op?.path).toBe('5d442591::monthly_churn');
    expect(op?.value).not.toHaveProperty('replaces');
    expect(String(r.public_label)).not.toContain('replaces');
    expect(String(r.note)).not.toContain('REPLACE');
  });
});

describe('propose_starting_point: the same rule, inside the one approval', () => {
  const START = {
    assumptions: [{ factor_label: 'Monthly new Pro subscribers', value: 20, unit: 'subscribers per month', basis: 'x' }],
    option_levels: [
      level(ON_USERS_LEVEL, 55),
      level(ON_OLUMIS_LEVEL, 56),
      { option_label: 'Test £54 versus £59 by customer cohort before rollout', factor_label: 'Monthly churn', value: 6, basis: 'x' },
    ],
  };

  it('RED: Olumi\'s level over the user\'s is left out of the approval and said; Olumi\'s own estimate is replaced, and says so', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeStartingPoint(ctxSaying('Set up a starting point.'), START);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const ops = opsOf(store, r);
    expect(ops.map((o) => o.path).sort()).toEqual(['5d442591::monthly_churn', 'monthly_new_pro_subscribers', 'raise_to_54_at_release::pro_plan_price']);
    expect(ops.find((o) => o.path === 'raise_to_54_at_release::pro_plan_price')?.value?.replaces).toBe(54);
    expect(notAccepted(r).map((x) => x.option)).toEqual([ON_USERS_LEVEL]);
    expect(String(r.public_label)).toContain('(replaces Olumi’s estimate of 54 GBP per month)');
    expect(String(r.public_label)).not.toContain(ON_USERS_LEVEL);
    expect((r.option_levels as { option: string; replaces?: unknown }[]).find((x) => x.option === ON_OLUMIS_LEVEL)?.replaces).toBe(54);
    expect(String(r.note)).toContain('REPLACE a level the option already sets');
  });

  it('RED: levels only (one proposer made it) → the user\'s pair is left out of the approval, and the reason travels with the result', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeStartingPoint(ctxSaying('Set up a starting point.'), {
      assumptions: [],
      option_levels: [level(ON_USERS_LEVEL, 55), { option_label: 'Test £54 versus £59 by customer cohort before rollout', factor_label: 'Monthly churn', value: 6, basis: 'x' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(opsOf(store, r).map((o) => o.path)).toEqual(['5d442591::monthly_churn']);
    expect(notAccepted(r).map((x) => x.option)).toEqual([ON_USERS_LEVEL]);
    expect(notAccepted(r).map((x) => x.reason).join(' ')).toContain('a level the user set');
  });
});

describe('the approve chip says it replaces, from the stored proposal', () => {
  it('RED: the user\'s £65 over their £60 → "Replace £60/month with £65/month", never "Save £65 …"', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('Make the £59 option £65 instead.'),
      { interventions: [level(ON_USERS_LEVEL, 65, { user_stated: true })] }, undefined);
    expect(chipLabel(store, 'propose_option_interventions', r)).toBe('Replace £60/month with £65/month');
  });

  it('RED: Olumi\'s £56 over Olumi\'s £54 → "Replace £54/month with £56/month"', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('Suggest a better level for the £54 option.'),
      { interventions: [level(ON_OLUMIS_LEVEL, 56)] }, undefined);
    expect(chipLabel(store, 'propose_option_interventions', r)).toBe('Replace £54/month with £56/month');
  });

  it('RED: a starting point with one replacement → "Save 3 figures, replacing 1 level", never "starting figures"', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeStartingPoint(ctxSaying('Set up a starting point.'), {
      assumptions: [{ factor_label: 'Monthly new Pro subscribers', value: 20, unit: 'subscribers per month', basis: 'x' }],
      option_levels: [level(ON_OLUMIS_LEVEL, 56), { option_label: 'Test £54 versus £59 by customer cohort before rollout', factor_label: 'Monthly churn', value: 6, basis: 'x' }],
    });
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(chipLabel(store, 'propose_starting_point', r)).toBe('Save 3 figures, replacing 1 level');
  });

  it('CONTRAST: a fresh level never reads as a replacement', async () => {
    const { caps, store } = setup();
    const r = await caps.proposeOptionInterventions(ctxSaying('What would the cohort test do to churn?'),
      { interventions: [{ option_label: 'Test £54 versus £59 by customer cohort before rollout', factor_label: 'Monthly churn', value: 6, basis: 'x' }] }, undefined);
    expect(r.ok, JSON.stringify(r)).toBe(true);
    const label = chipLabel(store, 'propose_option_interventions', r);
    expect(label).toBeDefined();
    expect(label).not.toMatch(/Replac/);
  });
});
