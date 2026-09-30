/**
 * ⛔ A FIGURE RULE WITHHOLDS FIGURES; IT NEVER REMOVES STRUCTURE (DL #75 5916217417).
 *
 * Paul (30 Sep 17:2xZ): new models have fewer risks. The DL's Supabase read: drafted models with NO risk were ≤8% on
 * 20–27 Sep, 57% on 29 Sep and 81% on 30 Sep. MG measured the cause on staging `68c9789c` (one live OpenAI draft per brief
 * of the DL's fixed set, strict json_schema): both MRR briefs drafted 0 risks, hiring 2, funding 1. The drafter was
 * leaving them out. With the keep-risks prompt, all four drafted a risk, but on the £85k brief
 * `product-goal-extra-parent` then DELETED it ("I've taken … out of the model"). Now it keeps its node and its link, out
 * of the calculation.
 *
 * Rows replay those four live drafts (`fixtures/keep-risks-live-drafts-20260930.json`, the drafter's output verbatim) on
 * the real path: `buildModelFromBrief` → the `/graph/register` body → `GraphV3.parse`. Risks are bound by their drafted
 * label.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Json = Record<string, any>;
type Graph = { nodes: Json[]; edges: Json[] };
const RECORDED = JSON.parse(readFileSync(new URL('./fixtures/keep-risks-live-drafts-20260930.json', import.meta.url), 'utf8')) as {
  drafts: { id: string; brief: string; raw: string }[];
};

async function register(draft: { brief: string; raw: string }): Promise<{ graph: Graph; out: Json }> {
  let body: unknown = null;
  const call = (async () => ({ text: draft.raw })) as unknown as CallStructuredModel;
  const d: InternalDispatch = async (path, b) => {
    if (path.endsWith('/graph/register')) {
      body = structuredClone((b as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const out = await buildModelFromBrief('5916217a-0000-4000-8000-000000000001', draft.brief, d, call) as Json;
  expect(out.ok, JSON.stringify(out).slice(0, 400)).toBe(true);
  return { graph: GraphV3.parse(body) as unknown as Graph, out };
}

const key = (s: string) => s.trim().toLowerCase();

describe('every risk the drafter writes registers (DL 5916217417: structure is never removed to satisfy a figure rule)', () => {
  it('the recorded set is the four live drafts, each drafting at least one risk', () => {
    expect(RECORDED.drafts.map((d) => d.id)).toEqual(['mrr-12m', 'mrr-85k', 'hiring', 'funding']);
    for (const d of RECORDED.drafts) expect((JSON.parse(d.raw).risks as unknown[]).length, d.id).toBeGreaterThanOrEqual(1);
  });

  it.each(RECORDED.drafts.map((d) => [d.id, d] as const))('RED (%s): every drafted risk is a risk node on the saved model', async (_id, draft) => {
    const drafted = (JSON.parse(draft.raw).risks as { label: string }[]).map((r) => key(r.label));
    const { graph } = await register(draft);
    const saved = graph.nodes.filter((n) => n.kind === 'risk').map((n) => key(String(n.label)));
    for (const label of drafted) expect(saved, `${label} on ${JSON.stringify(saved)}`).toContain(label);
  });

  it.each(RECORDED.drafts.map((d) => [d.id, d] as const))('(%s) no size nobody stated: every link out of a risk is unsized', async (_id, draft) => {
    const { graph } = await register(draft);
    const risks = new Set(graph.nodes.filter((n) => n.kind === 'risk').map((n) => n.id));
    const out = graph.edges.filter((e) => risks.has(e.from));
    expect(out.length).toBeGreaterThanOrEqual(1);
    for (const e of out) expect(e.provenance?.natural_effect, `${e.from}->${e.to}`).toBeUndefined();
  });

  it('RED (mrr-85k): the risk whose effect MRR already carries stays, with its link, out of the calculation, and is said', async () => {
    const draft = RECORDED.drafts.find((d) => d.id === 'mrr-85k')!;
    const { graph, out } = await register(draft);
    const risk = graph.nodes.find((n) => n.kind === 'risk' && key(String(n.label)) === 'price sensitivity risk');
    expect(risk).toBeDefined();
    expect(risk!.analysis_participation).toBe('retained_excluded');
    expect(graph.edges.some((e) => e.from === risk!.id)).toBe(true);
    expect(JSON.stringify(out)).toContain('in the model but out of the calculation');
    expect(JSON.stringify(out)).not.toContain('out of the model');
  });

  it('CONTROL: a risk no route already carries is in the calculation (no participation mark)', async () => {
    const { graph } = await register(RECORDED.drafts.find((d) => d.id === 'hiring')!);
    for (const n of graph.nodes.filter((x) => x.kind === 'risk')) expect(n.analysis_participation, String(n.id)).toBeUndefined();
  });

  it('the drafter is told to keep a risk, and no sentence tells it to leave the limit\'s risk out', () => {
    expect(BUILD_INSTRUCTIONS).toContain('ALWAYS KEEP AT LEAST ONE RISK');
    expect(BUILD_INSTRUCTIONS).not.toMatch(/do not ALSO keep that one risk as a node/);
    expect(BUILD_INSTRUCTIONS).toContain('keep that risk as a node, linked to the goal metric with all three size fields null');
  });
});
