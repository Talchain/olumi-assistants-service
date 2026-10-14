/**
 * ⭐ THE SIZE RETRY GIVES THE DRAFTER ITS OWN LINKS BUDGET (T5 D2 r1, DL 14 Oct; `recovery/outbox/PROMPT.md`). Paul's
 * marketing brief registered NOTHING 1 time in 2: the first draft came back at 32 links (limit 30), and the one retry, told
 * only "32 links, 2 over", cut none of its 14 `links`. The other 18 are the kept options' own links (4 decision → option,
 * 9 actions, 5 for the status quo), which the drafter cannot see in `links`.
 *
 * The corpus is not the author's: T5's served brief and both real provider drafts, copied verbatim
 * (`tests/fixtures/size-retry/t5-d2-r1.json`, `_source`). The rows run the real `buildModelFromBrief`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { assessConstructionSize, retryInstruction } from '../construction-size-gate.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/size-retry/t5-d2-r1.json', 'utf8')) as Rec;
/** The AIE's own text (packet 4056486b), branches (a) and (b), filled with the host's counts. */
const AIE = JSON.parse(readFileSync('tests/fixtures/size-retry/aie-size-retry-text.json', 'utf8')) as Rec;
const budgetA = (optionLinks: number, room: number, own: number): string => (AIE.a_replacement as string)
  .replace('{option_links}', String(optionLinks)).replace('{own - room}', String(own - room)).replace('{room}', String(room)).replace('{own}', String(own));
const budgetB = (optionLinks: number): string => (AIE.b_replacement as string).replace('{option_links}', String(optionLinks));
const sid = '5d2d2d2d-5d2d-4d2d-8d2d-5d2d2d2d2d2d';

/** The real build path: the drafter answers with `drafts` in turn; every request it was sent comes back, with the result. */
async function construct(drafts: Rec[]): Promise<{ sent: Rec[]; result: Rec; registered: number }> {
  const sent: Rec[] = [];
  let registered = 0;
  const result = await buildModelFromBrief(sid, FX.brief, (async (path: string) => {
    if (path.endsWith('/graph/register')) { registered += 1; return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'size-retry' } };
  }) as never, (async (req: Rec) => {
    sent.push(structuredClone(req));
    return { text: JSON.stringify(drafts[Math.min(sent.length - 1, drafts.length - 1)]) };
  }) as never);
  return { sent, result: result as Rec, registered };
}

describe('the served D2 r1 retry, through the real build path', () => {
  it('reproduces the served totals, and now gives the drafter its own links budget: 30 − 18 = 12 for its 14', async () => {
    expect(FX.draft_call1.links, 'the first draft drew 14 links itself').toHaveLength(14);
    const { sent } = await construct([FX.draft_call1, FX.draft_call2]);
    expect(sent, 'one first pass and one retry').toHaveLength(2);
    const retry = sent[1]!.instructions as string;
    // The served state, byte for byte: the same draft yields the same totals the provider was sent.
    expect(retry).toContain(FX.served_retry_totals);
    // The AIE's branch (a), whole and byte for byte, with T5 D2 r1's own counts: 18 options' links, room 12, holds 14.
    expect(retry).toContain(budgetA(18, 12, 14));
    expect(sent[0]!.instructions as string, 'the first pass is unchanged by the retry text').not.toContain('of those links come from the options');
  });

  it('the gate itself is unchanged: the served retry (still 32 links) is refused, and nothing registers', async () => {
    const { result, registered } = await construct([FX.draft_call1, FX.draft_call2]);
    expect(result).toMatchObject({ ok: false, refusal: 'model_too_large', edges: 32, limits: { maxEdges: 30 } });
    expect(registered).toBe(0);
  });
});

describe('the links budget is said only when links are over, as a target, never a list', () => {
  type N = { id: string; kind: string };
  const graph = (nodes: N[], edges: [string, string][]) => ({
    nodes, edges: edges.map(([from, to]) => ({ from, to })),
    inference_classes: Object.fromEntries(nodes.map((n) => [n.id, 'model_proposed' as const])),
  }) as never;
  const factors = (n: number): N[] => Array.from({ length: n }, (_, i) => ({ id: `f${i}`, kind: 'factor' }));

  it('CONTRAST: over on nodes only (the links budget is met), no budget sentence', () => {
    const nodes: N[] = [{ id: 'd', kind: 'decision' }, { id: 'o', kind: 'option' }, ...factors(20)];
    const v = assessConstructionSize(graph(nodes, [['d', 'o'], ['o', 'f0'], ['f0', 'f1']]));
    expect([v.over_by.nodes > 0, v.over_by.edges, v.option_edges]).toEqual([true, 0, 2]);
    expect(retryInstruction(v)).not.toMatch(/of those links come from the options|room for|leaving no room/);
  });

  it('counts only links leaving the decision or an option, and names how many `links` must go', () => {
    const nodes: N[] = [{ id: 'd', kind: 'decision' }, { id: 'o', kind: 'option' }, ...factors(10)];
    const own: [string, string][] = Array.from({ length: 29 }, (_, i) => [`f${i % 10}`, `f${(i + 1 + Math.floor(i / 10)) % 10}`]);
    const v = assessConstructionSize(graph(nodes, [['d', 'o'], ['o', 'f0'], ['o', 'f1'], ...own]));
    expect([v.edges, v.option_edges]).toEqual([32, 3]);
    expect(retryInstruction(v)).toContain(budgetA(3, 27, 29));
  });

  it('when the options\' own links already reach the limit, the step is an added option or action, not `links`', () => {
    const nodes: N[] = [{ id: 'd', kind: 'decision' }, ...Array.from({ length: 4 }, (_, i) => ({ id: `o${i}`, kind: 'option' })), ...factors(8)];
    const actions: [string, string][] = Array.from({ length: 4 }, (_, i) => Array.from({ length: 7 }, (_, j) => [`o${i}`, `f${j}`] as [string, string])).flat();
    const v = assessConstructionSize(graph(nodes, [...Array.from({ length: 4 }, (_, i) => ['d', `o${i}`] as [string, string]), ...actions, ['f0', 'f7']]));
    expect([v.edges, v.option_edges]).toEqual([33, 32]);
    expect(retryInstruction(v)).toContain(budgetB(32));
  });
});
