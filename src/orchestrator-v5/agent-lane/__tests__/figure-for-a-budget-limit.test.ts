/**
 * ⛔ PAUL'S OWN BUDGET WORDS ARE HIS LIMIT'S FIGURE (DL #2195 CHANGES_REQUIRED 5863720934, journey C).
 *
 * #2195 binds a limit's new figure to the limit (`figureTheUserWroteFor`), so "300 Pro paying subscribers" is never a
 * £300 limit on the price. Replayed over every served journey-C budget-limit scope, it refused 6 of 38 cases the base
 * accepted:
 *  - Paul VERBATIM (C export) "…and we have £30,000 to spend." — the verb "spend" in the two words after the figure read
 *    as "Advertising spend" / "Feature development spend" (rule 1), so the figure was another entity's;
 *  - COMPOSED "Please change the budget limit to £30,000." — "budget" is decisive for "Budget overrun risk" (a RISK),
 *    so the figure was another entity's.
 * Fixed where each goes wrong, with the price/subscriber binding kept:
 *  - the figure's PURPOSE names no entity: "to <verb>" right after it that ends the clause or meets a preposition
 *    ("to spend", "to spend on ads"), as a "per X" rate already names none (`stated-by-user.ts`);
 *  - at the LIMIT door (`limitScopeIn`) the user's word "limit" is the limit's own, and a risk is no quantity a limit's
 *    figure measures, so a risk's label makes no claim on it.
 * Scopes: the served node labels and kinds, `tests/fixtures/journey-c-budget-limits-20260928/served-scopes.json`.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { figureTheUserWrote, figureTheUserWroteFor } from '../stated-by-user.js';
import { limitScopeIn } from '../runtime/agent-capabilities.js';

type Scope = { source: string; case: 'paul' | 'composed'; limit: string; unit: string; nodes: { label: string; kind: string }[] };
const SCOPES = (JSON.parse(readFileSync('tests/fixtures/journey-c-budget-limits-20260928/served-scopes.json', 'utf8')) as { scopes: Scope[] }).scopes;
const PAUL = "I've just found out that we've had a budget increase, and we have £30,000 to spend.";
const COMPOSED = 'Please change the budget limit to £30,000.';
const doorAccepts = (text: string, s: Scope, value = 30000): boolean =>
  figureTheUserWrote(value, s.unit, text) && figureTheUserWroteFor(value, s.unit, text, limitScopeIn({ nodes: s.nodes }, s.limit));

describe('the limit door takes Paul\'s budget figure for his budget limit (every served journey-C scope)', () => {
  it('PRECONDITION: six served scopes, three for each served regression', () => {
    expect(SCOPES.map((s) => s.case).sort()).toEqual(['composed', 'composed', 'composed', 'paul', 'paul', 'paul']);
  });
  it.each(SCOPES.map((s) => [s.limit, s.source, s] as const))('⭐ RED: Paul verbatim "£30,000 to spend" is the figure for "%s" (%s)', (_l, _src, s) => {
    expect(doorAccepts(PAUL, s)).toBe(true);
  });
  it.each(SCOPES.map((s) => [s.limit, s.source, s] as const))('⭐ RED: composed "the budget limit to £30,000" is the figure for "%s" (%s)', (_l, _src, s) => {
    expect(doorAccepts(COMPOSED, s)).toBe(true);
  });
});

describe('the binding still refuses a figure written about another quantity', () => {
  const s = SCOPES.find((x) => x.limit === 'Release investment')!;
  it('CONTROL (#2195 kept): "300 Pro paying subscribers" is never a £300 limit on the Pro plan price', () => {
    const g = { nodes: [{ label: 'Pro plan price', kind: 'factor' }, { label: 'Pro paying subscribers', kind: 'factor' }, { label: 'MRR', kind: 'goal' }] };
    const t = 'We have 300 Pro paying subscribers, and MRR must be at least that';
    expect(figureTheUserWrote(300, 'GBP', t)).toBe(true);
    expect(figureTheUserWroteFor(300, 'GBP', t, limitScopeIn(g, 'Pro plan price'))).toBe(false);
  });
  it('CONTRAST ("to" before a NOUN is not a purpose): "move £30,000 to Advertising spend" is not the release budget', () => {
    const others = limitScopeIn({ nodes: [...s.nodes, { label: 'Advertising spend', kind: 'factor' }] }, s.limit);
    expect(figureTheUserWroteFor(30000, s.unit, 'Please move £30,000 to Advertising spend next quarter.', others)).toBe(false);
  });
});
