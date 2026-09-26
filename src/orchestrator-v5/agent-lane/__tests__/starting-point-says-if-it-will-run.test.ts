/**
 * ⭐ A STARTING POINT SAYS, BEFORE THE APPROVAL, WHETHER THE ANALYSIS WILL BE ABLE TO RUN AFTER IT.
 *
 * Served (F) on CEE ef99a97 / cb1778b (Paul's brief, about 1 in 5 first passes; DL #70 5842400604): the drafter made
 * "£59 with AI release" and "Test £59 with AI release" (differing only in rollout). The Agent's starting point filled
 * every missing level — and made the two identical, so after the user's ONE approval the verdict said
 * `NOTHING_TO_COMPARE` and nothing could run: a dead start the user walked into.
 *
 * The proposal now carries `readiness_if_approved`: the ONE readiness verdict (`readinessViewOf`) over the stored
 * graph with this proposal's levels applied — so the Agent can say before approval what would still block.
 *
 * FIXTURE: that run's own served first-turn `draft_graph`, verbatim.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';
import { NO_COMPARISON_NEXT_STEP } from '../../tools/handlers/analysis-ready-core.js';

const served = JSON.parse(readFileSync(new URL('./fixtures/served-pre-starting-point-ef99a97.json', import.meta.url), 'utf8')) as unknown;
const ctx = { scenario_id: '550e8400-e29b-41d4-a716-446655440088', authenticated_user_id: null, request_id: 'r' };
const capsOver = (graph: unknown) => {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return createAgentCapabilities(d, new ProposalStore());
};
const levels = (testPrice: number) => [
  { option_label: '£59 with AI release', factor_label: 'AI feature availability', value: 100, basis: 'the release makes it available' },
  { option_label: 'Test £59 with AI release', factor_label: 'Pro plan price', value: testPrice, basis: 'the test price' },
  { option_label: 'Test £59 with AI release', factor_label: 'AI feature availability', value: 100, basis: 'the release makes it available' },
];
type View = { checked: boolean; may_run?: boolean; needs_from_user: { message: string }[]; reason?: string };
type G = { nodes: { id: string; kind: string }[]; edges: { from: string; to: string }[] };
const copy = (): G => JSON.parse(JSON.stringify(served)) as G;
/** The served graph without its held status quo: since #1963 that status quo is a comparator, so identical levels on
 *  the two other options only leave nothing to compare when it is absent. Order-independent with #1963. */
const noStatusQuo = (): G => {
  const g = copy();
  g.nodes = g.nodes.filter((n) => n.id !== 'keep_current_pricing');
  g.edges = g.edges.filter((e) => e.from !== 'keep_current_pricing' && e.to !== 'keep_current_pricing');
  return g;
};
/** The run path's own next step, without its closing full stop — as the note quotes it. */
const NEXT_STEP = NO_COMPARISON_NEXT_STEP.replace(/\.+$/, '');

describe('propose_starting_point says whether one approval will make the analysis runnable', () => {
  it('RED: levels that leave two options identical → readiness_if_approved says it still cannot run, and why — in the refusal\'s own words', async () => {
    const r = await capsOver(noStatusQuo()).proposeStartingPoint(ctx, { assumptions: [], option_levels: levels(59) });
    expect(r, JSON.stringify(r).slice(0, 600)).toEqual(expect.objectContaining({ ok: true }));
    const v = r.readiness_if_approved as View | undefined;
    expect(v?.checked).toBe(true);
    expect(v?.may_run).toBe(false);
    expect(v?.reason).toBe(NO_COMPARISON_NEXT_STEP);
    expect(String(r.note)).toMatch(/could still not run/i);
    expect(String(r.note)).toContain(`could still not run: ${NEXT_STEP}. Say so plainly`);
  });

  it('RED (#1957 review): ONE option besides the baseline → the note gives the refusal\'s next step, never an "identical options" question that does not fit', async () => {
    const g = copy();
    g.nodes = g.nodes.filter((n) => n.id !== 'test_59_with_ai_release');
    g.edges = g.edges.filter((e) => e.from !== 'test_59_with_ai_release' && e.to !== 'test_59_with_ai_release');
    const r = await capsOver(g).proposeStartingPoint(ctx, { assumptions: [], option_levels: [levels(59)[0]!] });
    expect(r, JSON.stringify(r).slice(0, 600)).toEqual(expect.objectContaining({ ok: true }));
    const v = r.readiness_if_approved as View | undefined;
    // Never an "identical options" question that does not fit. Whether this preview blocks depends on #1963 (which
    // counts the held status quo as a comparator); when it does block, the note quotes the verdict's own words.
    expect(String(r.note ?? '')).not.toMatch(/identical|would still be blocked/i);
    if (v?.may_run === false) {
      expect(v.needs_from_user).toEqual([]);
      expect(String(r.note)).toContain(`could still not run: ${NEXT_STEP}. Say so plainly`);
    }
  });

  it('a structural blocker is quoted once, with no doubled full stop', async () => {
    const g = copy();
    const decision = g.nodes.find((n) => n.kind === 'decision')!.id;
    g.edges = g.edges.filter((e) => !(e.from === decision && e.to === 'test_59_with_ai_release'));
    const r = await capsOver(g).proposeStartingPoint(ctx, { assumptions: [], option_levels: levels(54) });
    const v = r.readiness_if_approved as View | undefined;
    expect(v?.may_run, JSON.stringify(v)).toBe(false);
    expect(String(r.note)).toMatch(/not connected from the decision\. Link the decision to it\. Say so plainly/);
    expect(String(r.note)).not.toMatch(/\.\./);
  });

  it('CONTRAST: the same starting point with a different test price → it says the analysis can run after approval', async () => {
    const r = await capsOver(served).proposeStartingPoint(ctx, { assumptions: [], option_levels: levels(54) });
    const v = r.readiness_if_approved as View | undefined;
    expect(v?.may_run, JSON.stringify(v)).toBe(true);
    expect(String(r.note)).not.toMatch(/could still not run/i);
  });
});

describe('(#1957 review, advisory 2) a quoted reason never repeats "can\'t be analysed"', () => {
  it('the one helper strips only that opening; both the sentence and the pre-approval note use it', async () => {
    const { withoutCantRunOpening } = await import('../readiness-view.js');
    const fallback = "This model can't be analysed yet. The values involved are Olumi's own suggestions, not yours.";
    expect(withoutCantRunOpening(fallback)).toBe("The values involved are Olumi's own suggestions, not yours.");
    expect(withoutCantRunOpening('Name at least two different options you are weighing, then run analysis.'))
      .toBe('Name at least two different options you are weighing, then run analysis.');
    const caps = readFileSync(new URL('../runtime/agent-capabilities.ts', import.meta.url), 'utf8');
    const note = caps.slice(caps.indexOf('const stillBlockedNote'), caps.indexOf('const levelPathsOf'));
    expect(note).toContain('withoutCantRunOpening(v.reason)');
    const view = readFileSync(new URL('../readiness-view.ts', import.meta.url), 'utf8');
    expect(view).toContain("const reason = withoutCantRunOpening(view.reason ?? '');");
  });
});
