/**
 * ⭐ GOAL SCOPE (b): A PLAIN TOTAL IS READ AS THE TOTAL, NEVER A WITHHOLD (Science d5 #87 6006584860 / 6006646752 /
 * 6007088716; DL ruling 6 Oct: "a null-scope reconcile_goal_scope never withholds (asked at most once, non-blocking);
 * disclose once only when material, using d5's words verbatim").
 *
 * MEASURED on served 21ef54cc (G1): T1b's first Run withheld every finding on the drafter's untyped scope question
 * ("monthly recurring revenue" read as one tier or the total). The goal names no part, so it reads as the TOTAL.
 * Bound on the SERVED graphs (`fixtures/goal-scope-t1b-served-21ef54cc.json`), by node id and exact words.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { reconciliationPending, scopeIssueBlocks, untypedScopeComponents, untypedScopeDisclosure } from '../goal-scope.js';
import { goalScopeClaimInput } from '../../compose/goal-scope-claim-input.js';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import type { PendingAction } from '../../session/pending-action.js';

type Rec = Record<string, unknown>;
type Graph = { nodes: Rec[]; edges: Rec[] };
const SERVED = JSON.parse(readFileSync(new URL('./fixtures/goal-scope-t1b-served-21ef54cc.json', import.meta.url), 'utf8')) as
  { t1b_with_49_sentence: Graph; t1b_without_49_edge: Graph };
const GOAL = 'monthly_recurring_revenue';
const with49 = (): Graph => structuredClone(SERVED.t1b_with_49_sentence);
const without49 = (): Graph => structuredClone(SERVED.t1b_without_49_edge);
const edge = (g: Graph, from: string, to: string): Rec => g.edges.find((e) => e.from === from && e.to === to)!;
const node = (g: Graph, id: string): Rec => g.nodes.find((n) => n.id === id)!;
const provenanceOf = (e: Rec): Rec => e.provenance as Rec;

const SCENARIO = '21212121-2121-4121-8121-212121212121';
const untyped = (question = 'Which reading of your goal did you mean?'): PendingAction => reconciliationPending(SCENARIO, {
  kind: 'reconcile_goal_scope', goal_id: GOAL, goal_label: 'monthly recurring revenue',
  declared_scope: { modelled: 'the existing plans only', alternative: 'every tier together', stated_in_brief: false },
  expected: 'scope', question, operands: [], derivations: [],
}, 0);
const typed = (): PendingAction => reconciliationPending(SCENARIO, {
  kind: 'reconcile_goal_scope', goal_id: GOAL, goal_label: 'monthly recurring revenue',
  scope: { modelled: 'enterprise MRR', alternative: 'all MRR', extent: 'component', stated_in_brief: true, source: { quote: 'our enterprise MRR goal' } },
  expected: 'billing_basis', question: 'Which billing basis does your enterprise MRR use?', operands: [], derivations: [],
}, 0);

describe('(b) the served T1b graphs: who placed the Starter tier in the goal', () => {
  it('T1b (the brief says "adds £49 a month to monthly recurring revenue"): the user placed it — nothing is disclosed', () => {
    expect(provenanceOf(edge(with49(), 'starter_subscribers', GOAL)).source_quote).toBe('Each starter subscriber adds £49 a month to monthly recurring revenue.');
    expect(untypedScopeComponents(with49(), GOAL)).toEqual([]);
  });

  it('T1b minus that sentence (served brief 7): the Starter tier counts only under the total — disclosed in d5\'s words', () => {
    const components = untypedScopeComponents(without49(), GOAL);
    // Exactly the part the launch ADDS: not "Price rise" (a 0 % change the status quo holds) and not "Support capacity
    // strain" (a cost the option brings, entering the goal negatively).
    expect(components).toEqual(['Starter-tier monthly recurring revenue']);
    expect(untypedScopeDisclosure('monthly recurring revenue', components)).toBe(
      'I’ve read your goal, ‘monthly recurring revenue’, as the total across every tier, including ‘Starter-tier monthly recurring revenue’. If you meant only part of it, say which.');
  });

  it('T1b with the £49 sentence\'s quote taken away: disclosed, naming Starter subscribers', () => {
    const g = with49();
    const p = provenanceOf(edge(g, 'starter_subscribers', GOAL));
    delete p.source_quote;
    expect(untypedScopeComponents(g, GOAL)).toEqual(['Starter subscribers']);
  });

  it('CONTRAST: a user quote that names no goal quantity ("would win about 150 new subscribers") does not place the part', () => {
    const g = with49();
    provenanceOf(edge(g, 'starter_subscribers', GOAL)).source_quote = 'The starter tier would win about 150 new subscribers.';
    expect(provenanceOf(edge(g, 'starter_subscribers', GOAL)).magnitude).toBe('user_stated');
    expect(untypedScopeComponents(g, GOAL)).toEqual(['Starter subscribers']);
  });

  it('CONTROL: the raise-prices path carries the user\'s own "…to monthly recurring revenue" quotes; stripped, a 0 % change is still no part', () => {
    const g = without49();
    for (const e of g.edges) if (provenanceOf(e)?.magnitude === 'user_stated') delete provenanceOf(e).source_quote;
    expect(untypedScopeComponents(g, GOAL)).toEqual(['Starter-tier monthly recurring revenue']);
  });

  it('CONTROL (Science 6007088716): a part the baseline already has, or a zero no option moves, is reached by the status quo', () => {
    const has = with49();
    delete provenanceOf(edge(has, 'starter_subscribers', GOAL)).source_quote;
    (node(has, 'starter_subscribers').observed_state as Rec).value = 120;
    expect(untypedScopeComponents(has, GOAL)).toEqual([]);
    const unmoved = with49();
    delete provenanceOf(edge(unmoved, 'starter_subscribers', GOAL)).source_quote;
    // The option still reaches it, but leaves it at zero: no part is created, so the status quo's hold is a path.
    ((node(unmoved, 'launch_starter_tier').interventions as Rec).starter_subscribers as Rec).value = 0;
    expect(untypedScopeComponents(unmoved, GOAL)).toEqual([]);
  });

  it('the list rule: up to three named, then " and N more"', () => {
    const words = (c: string[]) => untypedScopeDisclosure('MRR', c);
    expect(words(['A'])).toBe('I’ve read your goal, ‘MRR’, as the total across every tier, including ‘A’. If you meant only part of it, say which.');
    expect(words(['A', 'B'])).toContain('including ‘A’ and ‘B’. If');
    expect(words(['A', 'B', 'C'])).toContain('including ‘A’, ‘B’ and ‘C’. If');
    expect(words(['A', 'B', 'C', 'D'])).toContain('including ‘A’, ‘B’, ‘C’ and 1 more. If');
  });
});

describe('(b) an untyped scope question never gates a claim or a write', () => {
  it('scopeIssueBlocks: only an untyped `expected: scope` question is non-blocking; every typed one still blocks', () => {
    expect(scopeIssueBlocks(untyped().action)).toBe(false);
    expect(scopeIssueBlocks(typed().action)).toBe(true);
    expect(scopeIssueBlocks({ kind: 'reconcile_goal_scope', expected: 'scope', scope: {} })).toBe(true);
    expect(scopeIssueBlocks({ kind: 'reconcile_goal_scope', expected: 'billing_basis' })).toBe(true);
    expect(scopeIssueBlocks({ kind: 'confirm_identity', expected: 'scope' })).toBe(false);
  });

  it('T1b\'s first Run names a finding AND the chat asks at most once: the claim input is clear, and nothing is disclosed', () => {
    const g = with49();
    // The served pending as the build writes it: its question is the disclosure, and T1b's is none at all.
    const components = untypedScopeComponents(g, GOAL);
    expect(components).toEqual([]);
    expect(goalScopeClaimInput([untyped()], g)).toEqual({ status: 'clear', issues: [] });
    // Contrast: a typed question on the same graph still withholds.
    expect(goalScopeClaimInput([typed()], g).status).toBe('unresolved');
  });

  it('the write gates refuse a typed scope question and never an untyped one (proposeGoalCurrentLevel)', async () => {
    const g = with49();
    const d: InternalDispatch = async () => ({ status: 200, json: { graph: g, graph_hash: 'h' } });
    const call = async (pending: PendingAction) => {
      const caps = createAgentCapabilities(d, new ProposalStore(), undefined, 'full', undefined, { readPendingActions: async () => [pending] });
      return await caps.proposeGoalCurrentLevel(
        { scenario_id: SCENARIO, authenticated_user_id: 'u', request_id: 'r' },
        { goal_id: GOAL, value: 20000, unit: 'GBP', source_quote: 'We are at £20,000 MRR today.' } as never) as Rec;
    };
    expect((await call(typed())).refusal).toBe('goal_scope_unresolved');
    expect((await call(untyped())).refusal).not.toBe('goal_scope_unresolved');
  });

  it('CLASS: every scope gate reads through scopeIssueBlocks — no gate tests the kind alone', () => {
    const src = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8');
    const caps = src('../runtime/agent-capabilities.ts');
    const claim = src('../../compose/goal-scope-claim-input.ts');
    const bareKindGate = /\.some\(\s*p\s*=>\s*p\.action\.kind\s*===\s*'reconcile_goal_scope'\s*\)/g;
    expect(caps.match(bareKindGate) ?? []).toEqual([]);
    expect(claim.match(bareKindGate) ?? []).toEqual([]);
    // Contrast: the probe sees the three gates and the claim reader.
    expect((caps.match(/\.some\(p => scopeIssueBlocks\(p\.action\)\)/g) ?? []).length).toBe(3);
    expect(claim).toContain('scopeIssueBlocks(current.action)');
  });
});
