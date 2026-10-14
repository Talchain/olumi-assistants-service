/**
 * ⭐ THE DRAFTER NEVER PAYS FOR THE HOST'S LINKS (DL ruling (b), 14 Oct; `recovery/outbox/PROMPT.md`). Paul's marketing
 * brief (T5 D2) registered NOTHING 1 time in 2: the first draft came back at 32 links against a limit of 30. 5 of the 32
 * were the status quo's repair links, which the host adds after drafting (`admit-model.ts` `wireInertStatusQuo`). The one
 * retry could not find them in its own `links`, and was refused `model_too_large`.
 *
 * The corpus is not the author's: T5's served brief and both real first drafts, copied verbatim
 * (`tests/fixtures/size-retry/t5-d2-first-drafts.json`, `_source`). The rows run the real `buildModelFromBrief`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { assessConstructionSize } from '../construction-size-gate.js';
import { REPAIR_AUTHORED_ORIGIN } from '../../../graph/repair-authored-edge.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-first-drafts.json', 'utf8')) as Rec;
const sid = '5d2d2d2d-5d2d-4d2d-8d2d-5d2d2d2d2d2e';

/** The real build path: the drafter answers every call with `draft`; what it was sent and the registered graph come back. */
async function construct(draft: Rec): Promise<{ calls: number; sizeRetries: number; result: Rec; graph: Rec | undefined }> {
  const sent: string[] = [];
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, FX.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'host-links' } };
  }) as never, (async (req: Rec) => { sent.push(String(req.instructions)); return { text: JSON.stringify(draft) }; }) as never);
  // A size retry is the request the size gate wrote (`retryInstruction`'s own opening), never a coverage repair.
  return { calls: sent.length, sizeRetries: sent.filter((i) => i.includes('Your previous model was too large')).length, result: result as Rec, graph };
}
const statusQuoLinks = (graph: Rec): Rec[] => (graph.edges as Rec[]).filter((e) => e.origin === REPAIR_AUTHORED_ORIGIN);

describe('T5 D2, through the real build path', () => {
  it('r1: 32 links, 5 of them the status quo\'s; counted 27, so no retry, and the WHOLE model registers', async () => {
    const { sizeRetries, result, graph } = await construct(FX.r1_first_draft);
    expect(result).toMatchObject({ ok: true, mutated: true, within_compact_limits: true, size_retried: false });
    // Its coverage repair (Conversion rate as a factor) still asks, as served; the size gate never does.
    expect(sizeRetries, 'no size retry').toBe(0);
    // Nothing is cut: the registered graph keeps every link, the status quo's 5 included.
    expect(graph!.edges).toHaveLength(32);
    expect(result.edges).toBe(32);
    expect(statusQuoLinks(graph!)).toHaveLength(5);
    expect(new Set(statusQuoLinks(graph!).map((e) => e.from)).size, 'all from the one status quo').toBe(1);
  });

  it('r2: still registers (33 links, counted 28), now with no retry', async () => {
    const { calls, sizeRetries, result, graph } = await construct(FX.r2_first_draft);
    expect(result).toMatchObject({ ok: true, within_compact_limits: true, size_retried: false });
    expect([calls, sizeRetries], 'r2 had nothing else to repair: one call').toEqual([1, 0]);
    expect([graph!.edges.length, statusQuoLinks(graph!).length]).toEqual([33, 5]);
  });

  it('CONTRAST: when the drafter\'s own links exceed the limit it is still retried, and refused when the retry is no smaller', async () => {
    const d = structuredClone(FX.r1_first_draft) as Rec;
    const link = (from: string, to: string) => ({ from, to, direction: 'positive', provenance: 'ai_proposed', effect_amount: null,
      effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null });
    (d.links as Rec[]).push(link('Annual marketing spend', 'New customers in first 3 months'),
      link('Working time on launch marketing', 'Qualified launch visitors'),
      link('Annual marketing spend', 'Commercial launch readiness'),
      link('Working time on launch marketing', 'Commercial launch readiness'));
    const { sizeRetries, result, graph } = await construct(d);
    expect(sizeRetries, 'the size retry ran').toBe(1);
    expect(result).toMatchObject({ ok: false, refusal: 'model_too_large', edges: 31, limits: { maxEdges: 30 } });
    expect(graph).toBeUndefined();
  });
});

describe('only the host\'s status-quo repair links are left out of the count', () => {
  type N = { id: string; kind: string };
  const verdict = (nodes: N[], edges: Rec[]) => assessConstructionSize({ nodes, edges,
    inference_classes: Object.fromEntries(nodes.map((n) => [n.id, 'model_proposed' as const])) } as never);
  const nodes: N[] = [{ id: 'd', kind: 'decision' }, { id: 'sq', kind: 'option' }, { id: 'o', kind: 'option' },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `f${i}`, kind: 'factor' }))];
  const own = Array.from({ length: 31 }, (_, i) => ({ from: `f${i % 12}`, to: `f${(i % 12 + 1 + Math.floor(i / 12)) % 12}` }));
  const repair = Array.from({ length: 5 }, (_, i) => ({ from: 'sq', to: `f${i}`, origin: REPAIR_AUTHORED_ORIGIN }));

  it('31 drafted links + 5 status-quo repair links: over by 1, the 5 reported, not counted', () => {
    const v = verdict(nodes, [...own, ...repair]);
    expect([v.edges, v.host_links_not_counted, v.over_by.edges, v.within]).toEqual([31, 5, 1, false]);
  });

  it('CONTRAST: the same origin on a link that is not option → factor still counts (identity, never origin alone)', () => {
    const v = verdict(nodes, [...own.slice(0, 29), { from: 'f0', to: 'f5', origin: REPAIR_AUTHORED_ORIGIN }]);
    expect([v.edges, v.host_links_not_counted]).toEqual([30, 0]);
  });
});
