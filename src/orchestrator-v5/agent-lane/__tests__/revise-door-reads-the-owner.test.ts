/**
 * ⛔ THE USER'S SALARIES WERE STORED AS OLUMI'S AT THE REVISE DOOR (served CEE 5d73351, journey E, 2/2 drafts; #72 5882023751).
 *
 * The user wrote "Senior engineers cost £120k a year each and juniors £65k a year each." `propose_assumptions` (the door
 * that revises a factor's value) marked BOTH figures `not_the_users_figure` → `authored_by: model_proposed`, and the
 * Agent told the user its own figures were Olumi's estimates. Cause: the door's plain `scopeIn`. "Additional senior
 * engineers" (a headcount) shares "senior" and "engineer" with "Senior engineer annual salary", so no word of the target
 * was decisive and the "juniors" after £120k claimed it. The add-factor door fixed exactly this in #2235 (`rivals`: a
 * headcount cannot hold a £ figure; `strict`: a rate names its owner, a conjunction ends a phrase). Under the plain
 * reading the revise door also took a SWAP as the user's on the DL's own typed clarification.
 *
 * The revise door now reads the owner the add-factor door's way (`newFactorScopeIn`): ONE reading for both doors that
 * write a factor's value.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { newFactorScopeIn } from '../runtime/agent-capabilities.js';
import { figureTheUserWroteFor } from '../stated-by-user.js';

const served = (f: string): unknown => (JSON.parse(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), 'utf8')) as { graph: unknown }).graph;
const E1 = served('served-journey-e-salaries-5d73351-d1.json');
const E2 = served('served-journey-e-salaries-5d73351-d2.json');
const A = served('served-13acc577-linkset-graph.json');
const SERVED = 'Senior engineers cost £120k a year each and juniors £65k a year each.';
const DL_TYPED = 'Record them as annual salaries: £120,000 per senior engineer and £65,000 per junior engineer.';
const SENIOR = 'Senior engineer annual salary';
const JUNIOR = 'Junior engineer annual salary';

type R = ToolResult & { proposal_id: string; assumptions: { factor: string; your_figure?: boolean }[] };
const unitOf = (graph: unknown, label: string): string =>
  String((graph as { nodes: { label: string; observed_state?: { unit?: string } }[] }).nodes.find((n) => n.label === label)?.observed_state?.unit ?? '');
async function authorship(graph: unknown, text: string, values: Record<string, number>): Promise<Record<string, string | undefined>> {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const store = new ProposalStore();
  const r = await createAgentCapabilities(d, store).proposeAssumptions(
    { scenario_id: '550e8400-e29b-41d4-a716-4466554400f2', authenticated_user_id: null, request_id: 'r', user_text: text },
    { assumptions: Object.entries(values).map(([factor_label, value]) => ({ factor_label, value, unit: unitOf(graph, factor_label), basis: 'as the user said', revise: true })) },
  ) as R;
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const p = store.get(r.proposal_id)!;
  const labelOf = new Map((graph as { nodes: { id: string; label: string }[] }).nodes.map((n) => [n.id, n.label] as const));
  return Object.fromEntries(p.operations.map((o) => [labelOf.get(String((o as { path?: string }).path)), (o as { value?: { authored_by?: string } }).value?.authored_by]));
}

describe('the revise door reads a figure\'s owner the add-factor door\'s way (journey E, served 5d73351)', () => {
  it.each([['D1', E1], ['D2', E2]])('RED (served %s): the user\'s £120k senior and £65k junior salaries are stored as THEIRS', async (_d, g) => {
    expect(await authorship(g, SERVED, { [SENIOR]: 120000, [JUNIOR]: 65000 })).toEqual({ [SENIOR]: 'user_stated', [JUNIOR]: 'user_stated' });
  });

  it.each([['D1', E1], ['D2', E2]])('CONTROL (served %s): the SWAP is never the user\'s', async (_d, g) => {
    expect(await authorship(g, SERVED, { [SENIOR]: 65000, [JUNIOR]: 120000 })).toEqual({ [SENIOR]: 'model_proposed', [JUNIOR]: 'model_proposed' });
  });

  it('RED (DL\'s typed clarification): each figure binds to its owner', async () => {
    expect(await authorship(E1, DL_TYPED, { [SENIOR]: 120000, [JUNIOR]: 65000 })).toEqual({ [SENIOR]: 'user_stated', [JUNIOR]: 'user_stated' });
  });

  it('RED (the swap AIQ named): under the DL\'s typed clarification, senior £65k is NOT the user\'s — the plain reading stored it as theirs', async () => {
    expect(await authorship(E1, DL_TYPED, { [SENIOR]: 65000 })).toEqual({ [SENIOR]: 'model_proposed' });
  });

  it('CONTROL: the salary-spend limit\'s £400k is never a senior salary', async () => {
    expect(await authorship(E1, 'Keep annual salary spend under £400k.', { [SENIOR]: 400000 })).toEqual({ [SENIOR]: 'model_proposed' });
  });

  it('CONTROLS (journey A, served 13acc577): the user\'s churn stays theirs; an MRR figure is never the price', async () => {
    expect(await authorship(A, 'For the record, our current monthly churn is 3.7%.', { 'Monthly churn': 3.7 })).toEqual({ 'Monthly churn': 'user_stated' });
    expect(await authorship(A, 'Our MRR is £12,000.', { 'Pro plan price': 12000 })).toEqual({ 'Pro plan price': 'model_proposed' });
  });
});

/** AIQ 5882087383: ONE reading, two doors — the revise door's stored authorship is the add-factor door's matcher verdict. */
describe('one reading at both doors that write a factor\'s value', () => {
  const cases: [string, unknown, string, string, number][] = [
    ['E1 served senior', E1, SERVED, SENIOR, 120000], ['E1 served junior', E1, SERVED, JUNIOR, 65000],
    ['E1 served swap', E1, SERVED, SENIOR, 65000], ['E2 served senior', E2, SERVED, SENIOR, 120000],
    ['E1 typed junior', E1, DL_TYPED, JUNIOR, 65000], ['E1 typed swap', E1, DL_TYPED, SENIOR, 65000],
    ['E1 limit', E1, 'Keep annual salary spend under £400k.', SENIOR, 400000],
  ];
  it.each(cases)('%s: revise door == add-factor matcher', async (_n, g, text, label, value) => {
    const unit = unitOf(g, label);
    const addFactor = figureTheUserWroteFor(value, unit, text, newFactorScopeIn(g as never, label, unit, []));
    expect(await authorship(g, text, { [label]: value })).toEqual({ [label]: addFactor ? 'user_stated' : 'model_proposed' });
  });
});
