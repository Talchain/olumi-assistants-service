/**
 * ⭐ THE INTRODUCTION CLAIM, IN THE AIE'S WORDS (AIE packet 6e52e896 `introduction.description`; DL 14 Oct). The drafter
 * already claims who introduced each option, factor, risk and outcome (`provenance`), but was never told what the three
 * values mean, so it used them inconsistently (T5: 16 first-draft risks, explicit 9 / inferred 3 / ai_proposed 4, the
 * "inferred" ones mixed). The schema now says, on those four items only, never on a value's provenance.
 *
 * The claim is NOT carried to the graph by this change (the AIE's consumer condition: no wider `proposed_by` until shared
 * schema/hash/reader/Canvas/Run compatibility is proven). The corpus is not the author's: served hiring post3007's real
 * drafter output and brief (`tests/fixtures/introduction-stamp/`, `_source`), through the real `buildModelFromBrief`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const BRIEF = (JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007.json', 'utf8')) as Rec).brief as string;
const DRAFT = JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007-draft.json', 'utf8')) as Rec;
/** The AIE's text, extracted byte for byte from the packet (`_source`). */
const AIE = JSON.parse(readFileSync('tests/fixtures/introduction-stamp/aie-introduction-text.json', 'utf8')) as { text: string };
const sid = '1b1b1b1b-1b1b-4b1b-8b1b-1b1b1b1b1b1b';

/** The real build path: the drafter answers with `draft`; the request it was sent and the registered graph come back. */
async function construct(draft: Rec): Promise<{ sent: Rec; graph: Rec }> {
  let sent: Rec | undefined;
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, BRIEF, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'introduction' } };
  }) as never, (async (req: Rec) => { sent ??= structuredClone(req); return { text: JSON.stringify(draft) }; }) as never);
  if ((result as Rec).ok !== true || graph === undefined || sent === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return { sent, graph };
}

describe('what the drafter is sent, on served hiring post3007', () => {
  it('the AIE\'s text, byte for byte, describes the introduction claim on options, factors, risks and outcomes', async () => {
    const { sent } = await construct(DRAFT);
    const p = sent.schema.properties as Rec;
    for (const [kind, prop] of [['options', p.options], ['factors', p.factors], ['risks', p.risks], ['outcomes', p.outcomes]] as const) {
      expect(prop.items.properties.provenance.description, kind).toBe(AIE.text);
      expect(prop.items.properties.provenance.enum, kind).toEqual(['explicit', 'inferred', 'ai_proposed']);
    }
  });

  it('it is NOT on any value\'s provenance: the goal\'s baseline, a limit, an option\'s level, a link and its effect keep the bare enum', async () => {
    const { sent } = await construct(DRAFT);
    const p = sent.schema.properties as Rec;
    const bare = [
      ['goal.provenance', p.goal.properties.provenance],
      ['goal.baseline_provenance', p.goal.properties.baseline_provenance],
      ['constraints.provenance', p.constraints.items.properties.provenance],
      ['interventions.provenance', p.options.items.properties.interventions.items.properties.provenance],
      ['links.provenance', p.links.items.properties.provenance],
    ] as const;
    for (const [where, prop] of bare) expect(prop, where).not.toHaveProperty('description');
    // Contrast in the same request: the introduction claim does carry it.
    expect(p.risks.items.properties.provenance.description).toBe(AIE.text);
  });

  it('the claim is not carried to the graph: the drafter\'s own "Leadership coverage" (ai_proposed) registers with no `proposed_by`', async () => {
    expect((DRAFT.factors as Rec[]).find((f) => f.label === 'Leadership coverage')!.provenance, 'PRECONDITION: claimed as its own').toBe('ai_proposed');
    const { graph } = await construct(DRAFT);
    const quantities = (graph.nodes as Rec[]).filter((n) => n.kind === 'factor' || n.kind === 'risk');
    expect(quantities.map((n) => n.label)).toContain('Leadership coverage');
    expect(quantities.filter((n) => n.proposed_by !== undefined)).toEqual([]);
  });
});
