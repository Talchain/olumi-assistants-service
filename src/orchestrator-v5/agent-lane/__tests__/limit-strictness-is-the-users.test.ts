/**
 * ⭐ A LIMIT IS AS STRICT AS THE USER'S OWN WORD FOR IT (`limit-strictness.ts`; DL pj-x3 final 5864154474, PJ-E-A2
 * STABLE FAIL: "…annual salary spend under £400k" registered "<=" with no `operator_as_stated` in 3 of 3 runs).
 */
import { describe, it, expect } from 'vitest';
import { attestLimitStrictness, statedStrictness } from '../limit-strictness.js';

const E = 'Should we hire two senior engineers or four junior engineers to ship the new platform by Q3, while keeping annual salary spend under £400k?';
const A = 'We need to reach £100k MRR within 12 months, from £75k today, while keeping monthly churn under 4%. Should we raise Pro from £49 to £59?';
const salary = (operator: string, extra: Record<string, unknown> = {}) =>
  ({ constraint_id: 'agent-lane:annual_salary_spend:<=', node_id: 'annual_salary_spend', operator, value: 400000, unit: 'GBP/year', provenance: 'explicit', ...extra });
const churn = (operator: string, extra: Record<string, unknown> = {}) =>
  ({ constraint_id: 'agent-lane:monthly_churn:<=', node_id: 'monthly_churn', operator, value: 4, unit: '%', provenance: 'explicit', ...extra });

describe('the limit carries the strictness the user wrote before its own figure', () => {
  it('⭐ RED (served journey E): "under £400k" with the drafter\'s "<=" → operator_as_stated "<"', () => {
    expect(attestLimitStrictness([salary('<=')], E)).toEqual([salary('<=', { operator_as_stated: '<' })]);
  });

  it('⭐ RED: "no more than £400k" with a drafter\'s strict "<" → the user\'s non-strict word wins: no operator_as_stated', () => {
    const brief = E.replace('under £400k', 'no more than £400k');
    expect(attestLimitStrictness([salary('<=', { operator_as_stated: '<' })], brief)).toEqual([salary('<=')]);
  });

  it('⭐ RED: the lower side — "margin above 70%" with ">=" → operator_as_stated ">"', () => {
    const row = { constraint_id: 'c:margin:>=', node_id: 'gross_margin', operator: '>=', value: 70, unit: '%', provenance: 'explicit' };
    expect(attestLimitStrictness([row], 'Keep gross margin above 70% while we grow.')).toEqual([{ ...row, operator_as_stated: '>' }]);
  });

  it.each([
    ['under 4%', true], ['below 4%', true], ['less than 4%', true], ['at most 4%', false], ['no more than 4%', false],
    ['up to 4%', false], ['a maximum of 4%', false],
  ])('statedStrictness: "%s" → strict=%s', (words, strict) => {
    expect(statedStrictness(churn('<='), A.replace('under 4%', words))).toBe(strict);
  });

  it('CONTROL (served journey A): "under 4%" with the drafter\'s "<" kept → unchanged', () => {
    const row = churn('<=', { operator_as_stated: '<' });
    expect(attestLimitStrictness([row], A)).toEqual([row]);
  });

  it('CONTRAST: no comparator written before the figure → the drafter\'s reading stands, either way', () => {
    const brief = 'We have a £400k annual salary budget. Should we hire two senior engineers or four juniors?';
    expect(attestLimitStrictness([salary('<=')], brief)).toEqual([salary('<=')]);
    expect(attestLimitStrictness([salary('<=', { operator_as_stated: '<' })], brief)).toEqual([salary('<=', { operator_as_stated: '<' })]);
  });

  it('CONTRAST: a word for the OTHER side never touches the limit ("over £400k" on a "<=" limit)', () => {
    expect(statedStrictness(salary('<='), E.replace('under £400k', 'over £400k'))).toBeNull();
  });

  it('CONTRAST: the figure written twice with words that disagree → no single answer: unchanged', () => {
    const brief = `${E} To be clear, spend must stay at most £400k.`;
    expect(statedStrictness(salary('<='), brief)).toBeNull();
  });

  it('CONTRAST: another figure\'s word does not count ("under £300k" beside a £400k limit)', () => {
    expect(statedStrictness(salary('<='), E.replace('under £400k', 'under £300k, and never above £400k'))).toBeNull();
  });

  it('CONTRAST: a limit Olumi inferred (provenance not explicit) is never re-read from the brief', () => {
    const row = salary('<=', { provenance: 'inferred' });
    expect(attestLimitStrictness([row], E)).toEqual([row]);
  });
});

// ── Through construction: what `/graph/register` receives ───────────────────────────────────────────────────────────
import { buildModelFromBrief } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const C = 'We need to reach £100k MRR within 6 months, while keeping monthly churn under 4%. '
  + 'Should we increase our Pro plan price from £49 to £59 per month, or invest in additional advertising?';
const link = (from: string, to: string, direction: 'positive' | 'negative') =>
  ({ from, to, direction, provenance: 'ai_proposed', effect_amount: null, effect_per_source_change: null, effect_provenance: null });
const draft = (operator: '<' | '<=') => ({
  goal: { metric: 'MRR', operator: '>=', target_stated: true, value: 100000, unit: 'GBP', horizon_months: 6, provenance: 'explicit', baseline_known: false, baseline_value: null, baseline_provenance: 'ai_proposed', scope: null },
  constraints: [{ metric: 'Monthly churn rate', operator, value: 4, unit: '%', provenance: 'explicit', frame: 'level' }],
  options: [
    { label: 'Raise Pro price to £59', provenance: 'explicit', is_status_quo: null, changes: [], interventions: [{ factor_label: 'Pro plan price', value: 59, value_kind: 'absolute', unit: 'GBP per month', provenance: 'explicit' }] },
    { label: 'Carry on as now', provenance: 'ai_proposed', is_status_quo: true, changes: [], interventions: [] },
  ],
  factors: [
    { label: 'Pro plan price', role: 'controllable', baseline_known: true, baseline_value: 49, unit: 'GBP per month', provenance: 'explicit', plausible_max: 200 },
    { label: 'Monthly churn rate', role: 'observable', baseline_known: false, baseline_value: 3, unit: '%', provenance: 'ai_proposed', plausible_max: 100 },
  ],
  risks: [], outcomes: [],
  links: [link('Pro plan price', 'MRR', 'positive'), link('Pro plan price', 'Monthly churn rate', 'positive'), link('Monthly churn rate', 'MRR', 'negative')],
  identities: [], unknowns: [], decision_question: null,
});
async function registered(brief: string, operator: '<' | '<='): Promise<Record<string, unknown>[]> {
  let graph: unknown;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: unknown }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const r = await buildModelFromBrief('0d0d0d0d-1111-4222-8333-444455556666', brief, dispatch, async () => ({ text: JSON.stringify(draft(operator)) })) as Record<string, unknown>;
  expect(r.ok, JSON.stringify(r)).toBe(true);
  return ((GraphV3.parse(graph) as unknown as { goal_constraints?: Record<string, unknown>[] }).goal_constraints ?? []);
}

describe('through construction — the registered limit says the user\'s strictness', () => {
  it('⭐ RED: "churn under 4%" drafted as "<=" → registered "<=" WITH operator_as_stated "<"', async () => {
    const [row] = await registered(C, '<=');
    expect(row).toMatchObject({ operator: '<=', operator_as_stated: '<', value: 4 });
  });
  it('⭐ RED: "churn at most 4%" drafted as "<" → registered "<=" with NO operator_as_stated', async () => {
    const [row] = await registered(C.replace('under 4%', 'at most 4%'), '<');
    expect(row).toMatchObject({ operator: '<=', value: 4 });
    expect(row).not.toHaveProperty('operator_as_stated');
  });
  it('CONTROL: "under 4%" drafted as "<" → "<" kept (journey A\'s served shape, unchanged)', async () => {
    const [row] = await registered(C, '<');
    expect(row).toMatchObject({ operator: '<=', operator_as_stated: '<' });
  });
});
