/**
 * ⭐ (B) THE AGENT READS THE ONE READINESS VERDICT — never "no structural blocker" beside a blocked model.
 *
 * Paul's manual test, 25 Sep 17:54Z ("Why can't I run the analysis now?"): the Agent answered "no recorded
 * structural blocker … a fresh analysis is the next valid step" while the model could not run — the option he
 * had just added was not connected from the decision. `get_canonical_state` never carried the verdict: it
 * forwarded the read route's readiness PLACEHOLDER and `structuralFacts`, which never checks decision links.
 *
 * FIXTURE: Paul's own STORED scenario graph (`cbd15f83`, read-only from the store, `9b30de7c`) — production
 * shape, not authored here. Its option "Test £54 versus £59 by customer cohort before rollout" has no edge from
 * `decision_mrr`, which the served readiness builder reports as blocked.
 */
import { describe, it, expect } from 'vitest';
import paulGraph from './fixtures/paul-cbd15f83-stored-graph.json' with { type: 'json' };
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { ProposalStore } from '../proposal.js';

const SCENARIO = '550e8400-e29b-41d4-a716-4466554400b1';
const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'r' };
const CODE_LIKE = /\b[A-Z]+(?:_[A-Z]+){2,}\b/;
const COHORT = 'Test £54 versus £59 by customer cohort before rollout';

type G = { nodes: { id: string; kind: string; label?: string }[]; edges: { from: string; to: string }[] };
const linked = (): G => {
  const g = JSON.parse(JSON.stringify(paulGraph)) as G;
  g.edges.push({ ...(g.edges.find((e) => e.from === 'decision_mrr') as object), from: 'decision_mrr', to: '5d442591' } as G['edges'][number]);
  return g;
};
const capsOver = (graph: unknown, analysisState?: unknown) => {
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0', ...(analysisState !== undefined ? { analysis_state: analysisState } : {}) } };
    throw new Error(`unexpected dispatch ${path}`);
  };
  return createAgentCapabilities(d, new ProposalStore());
};
type Readiness = { checked: boolean; may_run?: boolean; needs_from_user: { message: string }[]; olumi_can_offer: { message: string }[]; will_run_without: string[] };

describe('(B) get_canonical_state carries the ONE readiness verdict, in plain words', () => {
  it('RED: Paul\'s stored graph → may_run FALSE, and the plain reason names the unconnected option', async () => {
    const r = await capsOver(paulGraph).getCanonicalState(ctx) as { readiness?: Readiness };
    expect(r.readiness?.checked).toBe(true);
    expect(r.readiness?.may_run).toBe(false);
    expect(JSON.stringify(r.readiness?.needs_from_user), JSON.stringify(r.readiness)).toMatch(/not connected from the decision/i);
    expect(JSON.stringify(r.readiness), 'no internal codes in what the Agent narrates from').not.toMatch(CODE_LIKE);
  });

  it('CONTRAST: the same graph with the decision link restored → the verdict changes (the unconnected-option reason is gone)', async () => {
    const r = await capsOver(linked()).getCanonicalState(ctx) as { readiness?: Readiness };
    expect(r.readiness?.checked).toBe(true);
    expect(JSON.stringify(r.readiness?.needs_from_user)).not.toMatch(/not connected from the decision/i);
  });

  it('RED: the read route\'s readiness PLACEHOLDER is never forwarded as if it were a verdict', async () => {
    const placeholder = { run_state: { kind: 'complete_stale' }, readiness: { status: 'unknown', blockers: [] }, requires_rerun: true };
    const r = await capsOver(paulGraph, placeholder).getCanonicalState(ctx) as { analysis?: Record<string, unknown> };
    expect(r.analysis ?? {}, JSON.stringify(r.analysis)).not.toHaveProperty('readiness');
  });

  it('RED: an EARLIER analysis is kept distinct from "a run is permitted now" — stale earlier result AND may_run false', async () => {
    const r = await capsOver(paulGraph, { run_state: { kind: 'complete_stale' }, requires_rerun: true }).getCanonicalState(ctx) as { analysis?: { earlier_analysis?: string }; readiness?: Readiness };
    expect(r.analysis?.earlier_analysis).toBe('complete_stale');
    expect(r.readiness?.may_run).toBe(false);
  });

  it('RED (C33): the stored goal target reaches the Agent as the user stated it — £20,000 MRR, not a normalised 0.8', async () => {
    const r = await capsOver(paulGraph).getCanonicalState(ctx) as { goal?: { label?: string; target?: { value?: number; unit?: string } } };
    expect(r.goal?.label).toBe('MRR');
    expect(r.goal?.target).toEqual(expect.objectContaining({ value: 20000, unit: 'GBP MRR' }));
  });

  it('RED (C33): the stated limits reach the Agent — monthly churn ≤ 10 percent per month', async () => {
    const r = await capsOver(paulGraph).getCanonicalState(ctx) as { limits?: { on?: string; operator?: string; value?: number; unit?: string }[] };
    expect(r.limits).toEqual([expect.objectContaining({ on: 'Monthly churn', operator: '<=', value: 10, unit: 'percent per month' })]);
  });

  it('RED (C33): each link carries whose it is and how strong — so a challenge can say "an assumption Olumi made"', async () => {
    const r = await capsOver(paulGraph).getCanonicalState(ctx) as { links?: { from: string; to: string; source?: string; strength?: { mean?: number } }[] };
    const first = r.links?.find((l) => l.from === 'decision_mrr' && l.to === 'keep_49_price');
    expect(first, JSON.stringify(r.links?.slice(0, 3))).toBeDefined();
    expect(first).toEqual(expect.objectContaining({ source: 'cee_hypothesis', strength: expect.objectContaining({ mean: 1 }) }));
  });
});

describe('(B) the user-facing readiness sentence', () => {
  it('is plain English from the same verdict — blocked names the reason; runnable-with-exclusion names what is left out; never a code', async () => {
    const { readinessViewOf, readinessSentence } = await import('../readiness-view.js');
    const blocked = readinessSentence(readinessViewOf(paulGraph));
    expect(blocked).toMatch(/^The analysis can't run yet\./);
    expect(blocked).toMatch(/not connected from the decision/i);
    expect(blocked).not.toMatch(CODE_LIKE);
    expect(readinessSentence({ checked: false, needs_from_user: [], olumi_can_offer: [], will_run_without: [] })).toMatch(/could not check/);
    expect(readinessSentence({ checked: true, may_run: true, needs_from_user: [], olumi_can_offer: [], will_run_without: [COHORT] })).toBe(`The analysis can run now; it will leave out "${COHORT}" until its levels are set.`);
  });
});

describe('(B) the post-write line never contradicts the Run control on the same turn', () => {
  it('says the verdict when it agrees with analysis_ready; says NOTHING when they disagree or the verdict is unchecked', async () => {
    const { postWriteReadinessLine } = await import('../../../routes/agent-v1-turn.js');
    expect(postWriteReadinessLine(paulGraph, { may_run: false, status: 'blocked' })).toMatch(/^The analysis can't run yet\. .*not connected from the decision/i);
    expect(postWriteReadinessLine(paulGraph, { may_run: true, status: 'ready' }), 'disagrees with the button → silent').toBeNull();
    expect(postWriteReadinessLine(paulGraph, undefined), 'unknown button state → silent, never a refusal').toBeNull();
    expect(postWriteReadinessLine(undefined, { may_run: false }), 'no graph read → silent, never "nothing is blocking"').toBeNull();
  });
});
