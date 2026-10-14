/**
 * ⭐ DRAFT-TIME WIDENING RESTORED (Paul, #94 6166259456): both arms run on the served build seam.
 *
 * Real construction (`buildModelFromBrief`) on the served capacity answer (`fixtures/capacity-c85817f2-construction.json`),
 * with the widening provider passed exactly as the served capability passes it (`agent-capabilities.ts`
 * `build_model_from_brief`); the provider is scripted. The widened risk is Olumi's (`proposed_by`, `draft_widening`) and
 * stays outside the calculation; the user's parts are unchanged against the same build without widening.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';
import { isDraftWideningRequest, DRAFT_WIDENING_OPTIONS_PREAMBLE } from '../runtime/widen-draft.js';
import { thinDraftOffer } from '../method-turn/widen-turn.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-c85817f2-construction.json', import.meta.url), 'utf8')) as { brief: string; raw_text: string };

/** One risk against the first option, through a factor it moves, on the goal: ids read from the graph the widener is sent. */
function riskReply(input: string): Rec {
  const graph = (JSON.parse(input) as { graph: { nodes: Rec[]; edges: Rec[] } }).graph;
  const goal = graph.nodes.find((n) => n.kind === 'goal')!;
  const option = graph.nodes.find((n) => n.kind === 'option' && n.is_baseline !== true && graph.edges.some((e) => e.from === n.id))!;
  const factor = graph.edges.find((e) => e.from === option.id)!.to as string;
  return { risk_suggestions: [{ label: 'Specialist ramp-up runs long', category: 'timing', mechanism: 'relies_on', hits_id: option.id,
    through_id: factor, through_direction: 'positive', affects_id: goal.id, direction: 'negative', restates_id: null,
    relies_on: 'the new specialist reaching full pace quickly', watch_for: 'resolved tickets stay flat' }] };
}

async function build(widening: boolean): Promise<{ graph: Rec; result: Rec; requests: Rec[] }> {
  let graph: Rec | undefined;
  const requests: Rec[] = [];
  const provider = (async (req: Rec) => {
    requests.push(req);
    if (!isDraftWideningRequest(req)) return { text: FX.raw_text, status: 'completed' };
    if (String(req.instructions).includes(DRAFT_WIDENING_OPTIONS_PREAMBLE)) return { text: JSON.stringify({ options: [] }), status: 'completed' };
    return { text: JSON.stringify(riskReply(String(req.input))), status: 'completed' };
  }) as never;
  const result = await buildModelFromBrief('c0c0c0c0-c0c0-4c0c-8c0c-c0c0c0c0c0c2', FX.brief, (async (path: string, body: unknown) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone((body as { graph: Rec }).graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    if (path.endsWith('/versions')) return { status: 200, json: { versions: [] } };
    return { status: 200, json: { graph: graph ?? { nodes: [], edges: [] }, graph_hash: 'w' } };
  }) as never, provider, undefined, Date.now() + 120_000, widening ? provider : undefined) as Rec;
  return { graph: graph!, result, requests };
}

describe('draft-time widening runs on the served build seam (restored)', () => {
  it('⭐ the build asks the widener, and the risk it adds is Olumi\'s, outside the calculation; the user\'s parts are unchanged', async () => {
    const control = await build(false);
    expect(control.result.ok, JSON.stringify(control.result).slice(0, 400)).toBe(true);
    expect(control.requests.filter(isDraftWideningRequest)).toHaveLength(0);

    const widened = await build(true);
    expect(widened.result.ok, JSON.stringify(widened.result).slice(0, 400)).toBe(true);
    expect(widened.requests.filter(isDraftWideningRequest).length).toBeGreaterThan(0);
    const before = new Set((control.graph.nodes as Rec[]).map((n) => n.id));
    const added = (widened.graph.nodes as Rec[]).filter((n) => !before.has(n.id));
    const risk = added.find((n) => n.kind === 'risk' && n.label === 'Specialist ramp-up runs long');
    expect(risk, JSON.stringify(added.map((n) => [n.kind, n.label]))).toBeDefined();
    expect(risk).toMatchObject({ proposed_by: 'olumi', analysis_participation: 'retained_excluded', draft_widening: { provenance: 'ai_suggested_widen' } });
    expect((widened.graph.edges as Rec[]).filter((e) => e.from === risk!.id || e.to === risk!.id)).toEqual([]);
    // Every part of the unwidened build is there, byte for byte (goal, options, factors, links, the user's figures).
    for (const n of control.graph.nodes as Rec[]) expect((widened.graph.nodes as Rec[]).find((m) => m.id === n.id)).toEqual(n);
    expect(widened.graph.edges).toEqual(control.graph.edges);
    expect(widened.graph.goal_constraints ?? []).toEqual(control.graph.goal_constraints ?? []);
  });

  it('the thin-draft risk offer is not made beside a widened risk (it is Olumi\'s, never "found in your brief"); CONTRAST: the same risk unmarked', async () => {
    const { graph } = await build(true);
    // The draft's own risks removed, so the widened risk is the ONLY one: the count rule alone would offer and say it was found.
    const drafted = new Set((graph.nodes as Rec[]).filter((n) => n.kind === 'risk' && n.draft_widening === undefined).map((n) => n.id));
    const onlyWidened = { ...graph, nodes: (graph.nodes as Rec[]).filter((n) => !drafted.has(n.id)),
      edges: (graph.edges as Rec[]).filter((e) => !drafted.has(e.from) && !drafted.has(e.to)) };
    expect((onlyWidened.nodes as Rec[]).filter((n) => n.kind === 'risk').map((n) => n.label)).toEqual(['Specialist ramp-up runs long']);
    expect(thinDraftOffer(onlyWidened, true)).toBeNull();
    // CONTRAST: the same single risk without the widening marker (a risk drafted from the brief) is offered, and said found.
    const asDrafted = { ...onlyWidened, nodes: (onlyWidened.nodes as Rec[]).map((n) => { const { draft_widening: _w, ...rest } = n; return rest; }) };
    expect(thinDraftOffer(asDrafted, true)?.face).toBe('Olumi found one risk in your brief.');
  });
});
