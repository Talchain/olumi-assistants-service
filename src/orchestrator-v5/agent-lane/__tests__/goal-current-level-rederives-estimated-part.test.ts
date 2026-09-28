/**
 * ⭐ THE USER'S GOAL LEVEL RE-DERIVES OLUMI'S ONE ESTIMATED PART OF THE PRODUCT, IN THE SAME APPROVAL (MG #72
 * 5864722128; the DL's alternative to withdrawing the identity, 5864468829).
 *
 * Served journey C (`fixtures/served-journey-c-mrr-inferred-product-c10.json`, the graph CEE sent PLoT on run c10, the
 * goal's level removed = before the user gives it): construction declared "MRR = Pro plan price × Pro paying
 * subscribers" as Olumi's reading, with the brief's £49 and Olumi's estimate of 1,000 subscribers (`cee_inference`,
 * `scale_frame` 10,000). The user said "Our MRR is £72,000 a month today", and ISL refused the Run: the parts give
 * £49,000, 31.9% from the user's figure (`IDENTITY_NOT_EVALUATED`, `identity_inconsistent`; PLoT #385 now withdraws
 * the identity instead, and the Run falls back to the additive reading).
 *
 * THE RULE: the one figure in the product that is nobody's but Olumi's becomes the level the user's own figures imply
 * — 72,000 / 49 ≈ 1,469.4 — in the same approval, still Olumi's, and the approval says so. Never when the product is
 * the user's own, when not exactly one part is Olumi's, when a part holds no level, or when the derived level falls
 * outside the estimate's frame. The harness is the Agent's real `dispatchTool` → `createAgentCapabilities` → the real
 * `ProposalStore`; the graph read and register are a fake store with the route's CAS.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, type ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { USER_EDIT_SOURCE } from '../../../orchestrator/canonicalise-value-ops.js';

const SCENARIO = '550e8400-e29b-41d4-a716-4466554400cc';
const SAID = 'Our MRR is £72,000 a month today.';
const ARGS = { goal_label: 'MRR', value: 72000, unit: 'GBP/month', goal_is: 'at_least', user_stated: true };
const DERIVED = 72000 / 49;

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> } & Record<string, unknown>;
type Graph = { nodes: Node[]; edges: unknown[] } & Record<string, unknown>;
type Result = ToolResult & {
  proposal_id?: string; public_label?: string; note?: string; refusal?: string; detail?: string; not_represented?: string;
  rederived?: { factor: string; from: number; to: number; unit?: string; whose: string };
};

const served = JSON.parse(readFileSync(new URL('./fixtures/served-journey-c-mrr-inferred-product-c10.json', import.meta.url), 'utf8')) as Graph;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const nodeOf = (g: Graph, id: string): Node => g.nodes.find((n) => n.id === id)!;

/** The served graph with one node's fields changed — every other byte as served. */
function served_with(id: string, change: (n: Node) => Node): Graph {
  const g = clone(served);
  g.nodes = g.nodes.map((n) => (n.id === id ? change(n) : n));
  return g;
}

function setup(start: Graph) {
  let graph = clone(start);
  let rev = 0;
  const registers: { graph: Graph }[] = [];
  const dispatch: InternalDispatch = async (path, body) => {
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph`) {
      return { status: 200, json: { graph: clone(graph), graph_hash: `h${rev}`, graph_identity_hash: { value: `id-h${rev}` } } };
    }
    if (path === `/assist/v1/scenarios/${SCENARIO}/graph/register`) {
      const b = clone(body) as { graph: Graph; expected_graph_hash?: string };
      registers.push(b);
      if (b.expected_graph_hash !== undefined && b.expected_graph_hash !== `h${rev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      graph = b.graph;
      rev += 1;
      return { status: 200, json: { graph_hash: `h${rev}`, model_version: { version_number: rev + 1, version_id: `v${rev}`, mutation_id: `m${rev}` } } };
    }
    return { status: 500, json: {} };
  };
  const proposals = new ProposalStore();
  const caps = createAgentCapabilities(dispatch, proposals);
  const ctx = { scenario_id: SCENARIO, authenticated_user_id: null, request_id: 'req-rederive', user_text: SAID };
  const call = (name: string, args: Record<string, unknown>): Promise<Result> =>
    dispatchTool(name, JSON.stringify(args), ctx, caps) as Promise<Result>;
  /** Changes the stored graph WITHOUT a new revision — what only an apply-time re-check can see. */
  const editInPlace = (id: string, change: (n: Node) => Node) => { graph.nodes = graph.nodes.map((n) => (n.id === id ? change(n) : n)); };
  return { call, registers, graph: () => graph, editInPlace };
}

/** Proposed and approved: the goal holds the user's £72,000; returns what the proposal and the write said. */
async function recordMrr(start: Graph) {
  const s = setup(start);
  const proposed = await s.call('propose_goal_current_level', ARGS);
  expect(proposed.ok, JSON.stringify(proposed)).toBe(true);
  const applied = await s.call('authorise_change', { proposal_id: proposed.proposal_id });
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  expect(s.registers).toHaveLength(1);
  expect(nodeOf(s.graph(), 'mrr').observed_state).toMatchObject({ raw_value: 72000, source: USER_EDIT_SOURCE });
  return { s, proposed, applied };
}

/** Recorded alone: the goal's level only; every other node exactly as it was. */
async function recordedAlone(start: Graph) {
  const { s, proposed, applied } = await recordMrr(start);
  expect(proposed).not.toHaveProperty('rederived');
  expect(proposed.public_label).not.toContain("Olumi's estimate");
  expect(applied).not.toHaveProperty('rederived');
  for (const n of start.nodes.filter((x) => x.id !== 'mrr')) expect(nodeOf(s.graph(), n.id)).toStrictEqual(n);
}

describe('RED — served journey C: the user gives MRR, and Olumi\'s subscriber estimate is re-derived from it, still Olumi\'s', () => {
  it('the approval says it; ONE write holds both; price × subscribers now gives the user\'s £72,000', async () => {
    const { s, proposed, applied } = await recordMrr(served);

    expect(proposed.rederived).toEqual({ factor: 'Pro paying subscribers', from: 1000, to: DERIVED, unit: 'subscribers', whose: "Olumi's estimate" });
    expect(proposed.public_label).toContain(
      `Olumi's estimate of "Pro paying subscribers" becomes about 1,469 subscribers (was 1,000 subscribers), so that ` +
      `"Pro plan price" × "Pro paying subscribers" gives your "MRR"; it stays Olumi's estimate, not your figure.`,
    );
    expect(proposed.note).toContain(`Olumi's estimate of "Pro paying subscribers" becomes about 1,469 subscribers`);
    expect(proposed.note).toContain("never the user's");

    const subscribers = nodeOf(s.graph(), 'pro_paying_subscribers');
    const before = nodeOf(served, 'pro_paying_subscribers');
    expect(subscribers.observed_state).toStrictEqual({ ...before.observed_state, raw_value: DERIVED, value: DERIVED / 10000 });
    expect(subscribers.observed_state!.source).toBe('cee_inference');
    expect(subscribers.observed_state!.extractionType).toBe('inferred');
    expect(subscribers.scale_frame).toBe(10000);
    const price = nodeOf(s.graph(), 'pro_plan_price').observed_state!.raw_value as number;
    expect(price * (subscribers.observed_state!.raw_value as number)).toBeCloseTo(72000, 6);

    // Nothing else moved: every node but the goal and the one estimate is byte-for-byte as served.
    for (const n of served.nodes.filter((x) => x.id !== 'mrr' && x.id !== 'pro_paying_subscribers')) {
      expect(nodeOf(s.graph(), n.id)).toStrictEqual(n);
    }
    expect(nodeOf(s.graph(), 'mrr').nonlinear_identity).toStrictEqual(nodeOf(served, 'mrr').nonlinear_identity);

    expect(applied.rederived).toEqual(proposed.rederived);
    expect(applied.not_represented).toContain(`Olumi's estimate of "Pro paying subscribers" is now about 1,469 subscribers (was 1,000 subscribers)`);
    expect(applied.not_represented).toContain("still Olumi's estimate, never the user's");
  });

  it('a change to the product\'s figures after the proposal (same revision) → superseded; nothing is written', async () => {
    const s = setup(served);
    const proposed = await s.call('propose_goal_current_level', ARGS);
    expect(proposed.rederived?.to).toBe(DERIVED);
    s.editInPlace('pro_plan_price', (n) => ({ ...n, observed_state: { ...n.observed_state, raw_value: 59, value: 0.295 } }));
    const applied = await s.call('authorise_change', { proposal_id: proposed.proposal_id });
    expect(applied.ok).toBe(false);
    expect(applied.refusal, JSON.stringify(applied)).toBe('superseded');
    expect(applied.mutated).toBe(false);
    expect(s.registers).toEqual([]);
    expect(nodeOf(s.graph(), 'pro_paying_subscribers')).toStrictEqual(nodeOf(served, 'pro_paying_subscribers'));
  });
});

describe('never — the goal\'s level is recorded alone, every other node as it was', () => {
  it('the product is the user\'s own (stated_in_brief: true)', async () => {
    await recordedAlone(served_with('mrr', (n) => ({ ...n, nonlinear_identity: { ...(n.nonlinear_identity as object), stated_in_brief: true } })));
  });

  it('no product is declared on the goal', async () => {
    await recordedAlone(served_with('mrr', ({ nonlinear_identity: _gone, ...n }) => n as Node));
  });

  it('two parts are Olumi\'s (the price is an estimate too)', async () => {
    await recordedAlone(served_with('pro_plan_price', (n) => ({ ...n, observed_state: { ...n.observed_state, source: 'cee_inference' } })));
  });

  it('no part is Olumi\'s (the subscribers are the user\'s)', async () => {
    await recordedAlone(served_with('pro_paying_subscribers', (n) => ({ ...n, observed_state: { ...n.observed_state, source: 'brief_extraction' } })));
  });

  it('the other part is nobody\'s (no source): not the user\'s figure to derive from', async () => {
    await recordedAlone(served_with('pro_plan_price', (n) => {
      const { source: _gone, ...os } = n.observed_state!;
      return { ...n, observed_state: os };
    }));
  });

  it('the user\'s part holds no level above zero', async () => {
    await recordedAlone(served_with('pro_plan_price', (n) => ({ ...n, observed_state: { ...n.observed_state, raw_value: 0, value: 0 } })));
  });

  it('the derived level falls outside the estimate\'s frame (scale_frame 1,000 < 1,469)', async () => {
    await recordedAlone(served_with('pro_paying_subscribers', (n) => ({ ...n, scale_frame: 1000, observed_state: { ...n.observed_state, value: 1 } })));
  });

  it('the estimate\'s frame is not read exactly (no cap, no scale_frame)', async () => {
    await recordedAlone(served_with('pro_paying_subscribers', ({ scale_frame: _gone, ...n }) => n as Node));
  });

  it('the estimate\'s normalised value is not raw / frame', async () => {
    await recordedAlone(served_with('pro_paying_subscribers', (n) => ({ ...n, observed_state: { ...n.observed_state, value: 0.5 } })));
  });

  it('the estimate carries a display_value that would go on saying the old figure', async () => {
    await recordedAlone(served_with('pro_paying_subscribers', (n) => ({ ...n, display_value: '1,000 subscribers' })));
  });
});
