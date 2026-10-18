/** TL11:51: per-figure source is independent of field binding. Preserve the old swap/limit/MRR negatives as
 * explicit Olumi-reading cards, never original human field claims. The shared authorship owner classifies the
 * verified figure; a new Olumi estimate without a verified human figure remains Olumi’s.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore, hasCardOnlyOperations, type StructuredProposal } from '../proposal.js';
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
async function authorship(graph: unknown, text: string, values: Record<string, number>, check?: (proposal: StructuredProposal) => void): Promise<Record<string, string | undefined>> {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  const store = new ProposalStore();
  const r = await createAgentCapabilities(d, store).proposeAssumptions(
    { scenario_id: '550e8400-e29b-41d4-a716-4466554400f2', authenticated_user_id: null, request_id: 'r', user_text: text },
    { assumptions: Object.entries(values).map(([factor_label, value]) => ({ user_stated: true, factor_label, value, quote: text, unit: unitOf(graph, factor_label), basis: 'as the user said', revise: true })) },
  ) as R;
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const p = store.get(r.proposal_id)!;
  check?.(p);
  const labelOf = new Map((graph as { nodes: { id: string; label: string }[] }).nodes.map((n) => [n.id, n.label] as const));
  return Object.fromEntries(p.operations.map((o) => [labelOf.get(String((o as { path?: string }).path)), (o as { value?: { authored_by?: string } }).value?.authored_by]));
}

const uncertainBinding = (source: string) => (p: StructuredProposal): void => {
  expect(p.provenance.authored_by).toBe('model_proposed');
  expect(hasCardOnlyOperations(p.operations)).toBe(true);
  expect(p.public_label).toContain(source);
  expect(p.public_label).toContain('field bindings are Olumi’s reading, including after approval');
  for (const op of p.operations) expect(op.value).toMatchObject({ authored_by: 'user_stated', confirmation: { source, quote: source } });
};

describe('the revise door reads a figure\'s owner the add-factor door\'s way (journey E, served 5d73351)', () => {
  it.each([['D1', E1], ['D2', E2]])('RED (served %s): the user\'s £120k senior and £65k junior salaries are stored as THEIRS', async (_d, g) => {
    expect(await authorship(g, SERVED, { [SENIOR]: 120000, [JUNIOR]: 65000 })).toEqual({ [SENIOR]: 'user_stated', [JUNIOR]: 'user_stated' });
  });

  it.each([['D1', E1], ['D2', E2]])('CONTROL (served %s): a swap is an explicit Olumi binding on its own card; the original figures stay human', async (_d, g) => {
    expect(await authorship(g, SERVED, { [SENIOR]: 65000, [JUNIOR]: 120000 }, uncertainBinding(SERVED))).toEqual({ [SENIOR]: 'user_stated', [JUNIOR]: 'user_stated' });
  });

  it('RED (DL\'s typed clarification): each figure binds to its owner', async () => {
    expect(await authorship(E1, DL_TYPED, { [SENIOR]: 120000, [JUNIOR]: 65000 })).toEqual({ [SENIOR]: 'user_stated', [JUNIOR]: 'user_stated' });
  });

  it('the swap AIQ named never claims the proposed field binding was the original human statement', async () => {
    expect(await authorship(E1, DL_TYPED, { [SENIOR]: 65000 }, uncertainBinding(DL_TYPED))).toEqual({ [SENIOR]: 'user_stated' });
  });

  it('CONTROL: a limit is not silently declared an original salary; the proposed binding needs its own card', async () => {
    expect(await authorship(E1, 'Keep annual salary spend under £400k.', { [SENIOR]: 400000 }, uncertainBinding('Keep annual salary spend under £400k.'))).toEqual({ [SENIOR]: 'user_stated' });
  });

  it('CONTROLS (journey A, served 13acc577): the user\'s churn stays theirs; an MRR figure is never the price', async () => {
    expect(await authorship(A, 'For the record, our current monthly churn is 3.7%.', { 'Monthly churn': 3.7 })).toEqual({ 'Monthly churn': 'user_stated' });
    expect(await authorship(A, 'Our MRR is £12,000.', { 'Pro plan price': 12000 }, uncertainBinding('Our MRR is £12,000.'))).toEqual({ 'Pro plan price': 'user_stated' });
  });
});

/** TL11:51: source ownership is independent of the old binding matcher; uncertain bindings are explicit card decisions. */
describe('one source owner; the field-binding hint never reauthors a figure', () => {
  const cases: [string, unknown, string, string, number][] = [
    ['E1 served senior', E1, SERVED, SENIOR, 120000], ['E1 served junior', E1, SERVED, JUNIOR, 65000],
    ['E1 served swap', E1, SERVED, SENIOR, 65000], ['E2 served senior', E2, SERVED, SENIOR, 120000],
    ['E1 typed junior', E1, DL_TYPED, JUNIOR, 65000], ['E1 typed swap', E1, DL_TYPED, SENIOR, 65000],
    ['E1 limit', E1, 'Keep annual salary spend under £400k.', SENIOR, 400000],
  ];
  it.each(cases)('%s: a human figure stays human; uncertain field binding is never silently credited', async (_n, g, text, label, value) => {
    const unit = unitOf(g, label);
    const addFactor = figureTheUserWroteFor(value, unit, text, newFactorScopeIn(g as never, label, unit, []));
    expect(await authorship(g, text, { [label]: value }, addFactor ? undefined : uncertainBinding(text))).toEqual({ [label]: 'user_stated' });
  });
});


it('a genuinely new Olumi estimate absent from the typed words stays Olumi’s', async () => {
  const graph = { nodes: [{ id: 'cost', kind: 'factor', label: 'Cost estimate', observed_state: { value: 50000, unit: 'GBP/year', source: 'cee_inference' } }], edges: [] };
  const d: InternalDispatch = async path => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    throw new Error('No write allowed');
  };
  const store = new ProposalStore();
  const result = await createAgentCapabilities(d, store).proposeAssumptions({ scenario_id: 'source-contrast', authenticated_user_id: null,
    request_id: 'source', user_text: 'The separate annual spending ceiling is £90k.' },
  { assumptions: [{ factor_label: 'Cost estimate', value: 150000, unit: 'GBP/year', user_stated: false, revise: true, basis: 'A new Olumi estimate, separate from the ceiling' }] });
  expect(result.ok, JSON.stringify(result)).toBe(true);
  expect(store.get(String(result.proposal_id))!.operations[0]!.value).toMatchObject({ authored_by: 'model_proposed' });
});

it.each([true, false])('a claimed 7 when the human typed 6.5 never becomes human source (complete=%s)', async complete => {
  const graph = { nodes: [{ id: 'churn', kind: 'factor', label: 'Churn', observed_state: { value: 5, unit: '%', source: 'cee_inference' } }], edges: [] };
  const d: InternalDispatch = async path => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    throw new Error('No write allowed');
  };
  const store = new ProposalStore();
  const result = await createAgentCapabilities(d, store).proposeAssumptions({ scenario_id: 'absent-point', authenticated_user_id: null,
    request_id: 'source', user_text: 'Churn is 6.5%.', user_turn_text: 'Churn is 6.5%.', user_text_complete: complete },
    { assumptions: [{ factor_label: 'Churn', value: 7, unit: '%', user_stated: true, revise: true, basis: 'proposed reading' }] });
  if (complete) {
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'figure_not_in_users_words' });
    expect(store.outstanding('absent-point', null)).toHaveLength(0);
    const estimate = await createAgentCapabilities(d, store).proposeAssumptions({ scenario_id: 'absent-point', authenticated_user_id: null,
      request_id: 'estimate', user_text: 'Churn is 6.5%.', user_turn_text: 'Churn is 6.5%.', user_text_complete: true },
    { assumptions: [{ factor_label: 'Churn', value: 7, unit: '%', user_stated: false, revise: true, basis: 'Olumi’s separate estimate, never the user’s 6.5%.' }] });
    expect(estimate.ok, JSON.stringify(estimate)).toBe(true);
    expect(store.get(String(estimate.proposal_id))!.operations[0]!.value).toMatchObject({ authored_by: 'model_proposed' });
  } else {
    expect(result).toMatchObject({ ok: false, mutated: false, refusal: 'origin_unknown' });
    expect(store.outstanding('absent-point', null)).toHaveLength(0);
  }
});
