/**
 * ⛔ A FIGURE IN ONE KIND OF UNIT IS NEVER A LEVEL (OR VALUE) FOR A FACTOR MEASURED IN ANOTHER.
 *
 * Served on CEE 08f6f90 (guest witness, scenario 6f918904; #70 5842724128): "Add an option: keep the price at £49
 * and run a win-back offer… It reduces Monthly churn." The Agent passed `{value: 49, unit: "GBP per month"}` as the
 * Monthly churn level; the range check passed (49 ≤ 100) and one approval stored a 49% monthly churn as the user's
 * own figure. The same gap was open on `propose_assumptions`, which also takes a unit and compared it with nothing.
 *
 * FIXTURE: Paul's own stored graph (`cbd15f83`): Monthly churn in "percent per month", Pro plan price in "GBP per month".
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { unitsConflict } from '../unit-conflict.js';

const paulGraph = JSON.parse(readFileSync(new URL('./fixtures/paul-cbd15f83-stored-graph.json', import.meta.url), 'utf8')) as unknown;
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-4466554400c7', authenticated_user_id: null, request_id: 'r' };
type Raw = { nodes: { id: string; observed_state?: unknown }[]; goal_constraints?: unknown[] };
/** Churn as the served level-less shape (no `observed_state`; AI Quality 5843448904), with or without its limit. */
const levelLessChurn = (keepLimit: boolean): Raw => {
  const g = JSON.parse(JSON.stringify(paulGraph)) as Raw;
  delete g.nodes.find((n) => n.id === 'monthly_churn')!.observed_state;
  if (!keepLimit) g.goal_constraints = [];
  return g;
};
const setup = (graph: unknown = paulGraph) => {
  const sent: { path: string; body: unknown }[] = [];
  const d: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    sent.push({ path, body });
    return { status: 500, json: {} };
  };
  return { caps: createAgentCapabilities(d, new ProposalStore()), sent };
};
const winBack = (level: { value: number; unit?: string } | undefined) => ({
  label: 'Keep £49 and run a win-back offer',
  acts_on: [{ factor_label: 'Monthly churn', direction: 'negative' as const, ...(level !== undefined ? { level } : {}) }],
  rationale: 'the user asked for it',
});

describe('unitsConflict — the leading token of each unit, through the repo\'s one classifier', () => {
  it('currency against percent conflicts; the same family or an unknown unit never does', () => {
    expect(unitsConflict('GBP per month', 'percent per month')).toEqual({ stated: 'currency', factor: 'percent' });
    expect(unitsConflict('£', 'percent per month')).not.toBeNull();
    expect(unitsConflict('%', 'percent per month')).toBeNull();
    expect(unitsConflict('£', 'GBP per month')).toBeNull();
    expect(unitsConflict('subscribers', 'percent per month')).toBeNull();
    expect(unitsConflict(undefined, 'percent per month')).toBeNull();
  });
});

describe('propose_new_option refuses a level in another kind of unit — nothing prepared, nothing sent', () => {
  it('RED: the served case — £49 as the Monthly churn level → level_unit_mismatch, and no typed turn is sent', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, winBack({ value: 49, unit: 'GBP per month' }) as never) as { ok?: boolean; refusal?: string; detail?: string; mutated?: boolean };
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'level_unit_mismatch' }));
    expect(r.detail).toMatch(/Monthly churn/);
    expect(r.detail).toMatch(/percent per month/);
    expect(r.detail).toMatch(/Nothing was prepared/);
    expect(sent, 'nothing is proposed to the product').toEqual([]);
  });

  it('CONTRAST: a level in the factor\'s own kind of unit (4%) passes the unit check and is sent as the typed change', async () => {
    const { caps, sent } = setup();
    const r = await caps.proposeNewOption(ctx, winBack({ value: 4, unit: '%' }) as never) as { refusal?: string };
    expect(r.refusal).not.toBe('level_unit_mismatch');
    expect(sent.length, JSON.stringify(r)).toBeGreaterThan(0);
  });

  it('CONTRAST: no unit given → no unit refusal (the range rule still applies, unchanged)', async () => {
    const { caps } = setup();
    const r = await caps.proposeNewOption(ctx, winBack({ value: 4 }) as never) as { refusal?: string };
    expect(r.refusal).not.toBe('level_unit_mismatch');
  });
});

describe('propose_assumptions leaves out a value in another kind of unit, and says so', () => {
  it('RED: £49 as the Monthly churn value → not proposed, listed under unit_mismatch', async () => {
    const { caps } = setup();
    const r = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Monthly churn', value: 49, unit: 'GBP per month', basis: 'x', revise: true }] } as never) as { ok?: boolean; unit_mismatch?: { label: string }[]; assumptions?: unknown[] };
    expect(r.ok).toBe(false);
    expect(r.unit_mismatch?.map((m) => m.label)).toEqual(['Monthly churn']);
  });

  it('CONTRAST: 5 percent per month for Monthly churn is proposed as before', async () => {
    const { caps } = setup();
    const r = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Monthly churn', value: 5, unit: 'percent per month', basis: 'x', revise: true }] } as never) as { ok?: boolean; unit_mismatch?: unknown };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('unit_mismatch');
  });
});

describe('a factor with NO level takes its kind from the limit the user stated on it (AI Quality 5843448904)', () => {
  it('RED: level-less churn with the user\'s "percent per month" limit → £49 as its level is refused, nothing sent', async () => {
    const { caps, sent } = setup(levelLessChurn(true));
    const r = await caps.proposeNewOption(ctx, winBack({ value: 49, unit: 'GBP per month' }) as never) as { refusal?: string };
    expect(r.refusal).toBe('level_unit_mismatch');
    expect(sent).toEqual([]);
  });

  it('RED: level-less churn with its limit → £49 as its starting value is left out, listed under unit_mismatch', async () => {
    const { caps } = setup(levelLessChurn(true));
    const r = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Monthly churn', value: 49, unit: 'GBP per month', basis: 'x' }] } as never) as { unit_mismatch?: { label: string }[] };
    expect(r.unit_mismatch?.map((m) => m.label)).toEqual(['Monthly churn']);
  });

  it('CONTROL: level-less churn and NO limit → nothing to read its kind from, so it fails open as before', async () => {
    const { caps, sent } = setup(levelLessChurn(false));
    const r = await caps.proposeNewOption(ctx, winBack({ value: 49, unit: 'GBP per month' }) as never) as { refusal?: string };
    expect(r.refusal).not.toBe('level_unit_mismatch');
    expect(sent.length).toBeGreaterThan(0);
  });

  it('CONTRAST: level-less churn with its limit → 7% as its starting value is proposed', async () => {
    const { caps } = setup(levelLessChurn(true));
    const r = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: 'Monthly churn', value: 7, unit: '%', basis: 'x' }] } as never) as { ok?: boolean; unit_mismatch?: unknown };
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(r).not.toHaveProperty('unit_mismatch');
  });
});
