/**
 * ⭐ CONSTRUCTOR TEXT, D1 AND D4 (DL 14 Oct; `recovery/prompt/CONSTRUCTOR-TEXT-DRAFT.md`). The corpus is not the author's:
 * the AIE's three texts (manifest b34d6ebb), and T6 B r2's D4 draft and brief (a real provider output), are copied verbatim
 * (`tests/fixtures/constructor-text/t6-d4-b-r2.json`, `_source`).
 *
 * D4 failed at the raw draft in T6 even with the AIE's paragraph: the drift factor was drafted at 0 (the `baseline_known`
 * CHANGE-FROM-TODAY exception) and its 1:1 link carried `definitional: null`, so admission's exact refit
 * (`link-effect.ts`) set it aside behind a placeholder. The rows pin what is SENT, and what admission does with the shape
 * the text now asks for.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync('tests/fixtures/constructor-text/t6-d4-b-r2.json', 'utf8')) as Rec;
const OPS = FX.aie_operations as Rec[];
const DRIFT = 'No-change cycle increase by next quarter';
const GOAL = 'median delivery cycle';
const sid = '4d4d4d4d-4d4d-4d4d-8d4d-4d4d4d4d4d4d';

/** The real build path: the drafter returns `draft`; the request it was sent and the registered graph come back. */
async function construct(draft: Rec): Promise<{ sent: Rec; graph: Rec }> {
  let sent: Rec | undefined;
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, FX.brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'ctext' } };
  }) as never, (async (req: Rec) => { sent ??= structuredClone(req); return { text: JSON.stringify(draft) }; }) as never);
  if ((result as Rec).ok !== true || graph === undefined || sent === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return { sent, graph };
}
const nodeId = (graph: Rec, label: string): string => (graph.nodes as Rec[]).find((n) => n.label === label)!.id;
const driftEdge = (graph: Rec): Rec | undefined => (graph.edges as Rec[])
  .find((e) => e.from === nodeId(graph, DRIFT) && e.to === nodeId(graph, GOAL));
/** The draft as the text now asks for it: the drift is forecast minus today (10 − 8), and its 1:1 link is definitional. */
const asAsked = (): Rec => {
  const d = structuredClone(FX.draft) as Rec;
  (d.factors as Rec[]).find((f) => f.label === DRIFT)!.baseline_value = 2;
  (d.links as Rec[]).find((l) => l.from === DRIFT && l.to === GOAL)!.definitional = true;
  return d;
};

describe('D1 and D4 constructor text: what is sent', () => {
  it('the AIE\'s three texts are sent byte for byte, and the old ones are gone', async () => {
    const { sent } = await construct(FX.draft);
    const instructions = sent.instructions as string;
    expect(instructions).toContain(OPS[0].replacement);
    expect(instructions).not.toContain(OPS[0].old);
    expect(sent.schema.properties.decision_question.description).toBe(OPS[1].replacement);
    expect(instructions).toContain(`${OPS[2].anchor}${OPS[2].insertion}`);
  });

  it('the two field descriptions no longer contradict the forecast paragraph', async () => {
    const { sent } = await construct(FX.draft);
    const factor = sent.schema.properties.factors.items.properties;
    const link = sent.schema.properties.links.items.properties;
    expect(factor.baseline_known.description).toContain("A stated no-change forecast's drift is not this exception: its baseline_value is the forecast minus today's level (NO-CHANGE FORECAST), never 0.");
    expect(link.definitional.description).toContain('a no-change forecast’s drift, in the goal’s own unit, adds to the goal one for one: effect_amount 1, effect_per_source_change 1');
  });
});

describe('D4 through the real admission: T6 B r2\'s draft', () => {
  it('as served (drift 0, definitional null): the drift link is set aside behind a placeholder', async () => {
    const drift = (FX.draft.factors as Rec[]).find((f) => f.label === DRIFT)!;
    expect([drift.baseline_value, (FX.draft.links as Rec[]).find((l) => l.from === DRIFT)!.definitional]).toEqual([0, null]);
    const { graph } = await construct(FX.draft);
    expect(driftEdge(graph)?.provenance).toMatchObject({ magnitude: 'olumi_placeholder' });
    expect((graph.nodes as Rec[]).find((n) => n.label === DRIFT)!.observed_state).toMatchObject({ raw_value: 0, unit: 'weeks' });
  });

  it('as the text asks (drift 2 weeks, definitional): the link is kept at its 1:1 size and the drift holds 2 weeks', async () => {
    const { graph } = await construct(asAsked());
    const edge = driftEdge(graph)!;
    expect(edge.provenance).toMatchObject({ magnitude: 'olumi_estimate', definitional: true,
      natural_effect: { amount: 2, amount_unit: 'weeks', per_source_change: 2, per_source_change_unit: 'weeks' } });
    // Derived from the user's forecast by Olumi, never a newly stated measurement (the AIE's paragraph).
    expect((graph.nodes as Rec[]).find((n) => n.label === DRIFT)!.observed_state)
      .toMatchObject({ raw_value: 2, unit: 'weeks', source: 'cee_inference', extractionType: 'inferred' });
  });
});
