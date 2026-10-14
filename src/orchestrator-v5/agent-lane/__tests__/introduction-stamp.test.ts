/**
 * ⭐ THE INTRODUCTION STAMP (DL 14 Oct; `recovery/prompt/INTRODUCTION-STAMP-DRAFT.txt`). The drafter claims its own additions
 * `provenance: "ai_proposed"`, but admission kept that only in its ledger, so the graph could not tell Olumi's risk or factor
 * from the user's. Construction now carries the claim to `proposed_by: "olumi"` on risk and factor nodes, as for options.
 * Unknown stays unknown: `inferred` is never marked.
 *
 * The corpus is not the author's: served hiring post3007's real drafter output and brief, copied verbatim
 * (`tests/fixtures/introduction-stamp/`, `_source`). The rows run the real `buildModelFromBrief`.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief } from '../runtime/build-model.js';

type Rec = Record<string, any>;
const BRIEF = (JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007.json', 'utf8')) as Rec).brief as string;
const DRAFT = JSON.parse(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007-draft.json', 'utf8')) as Rec;
const sid = '1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a';

/** The real build path: the drafter answers with `draft`; the request it was sent and the registered graph come back. */
async function construct(draft: Rec, brief = BRIEF): Promise<{ sent: Rec; graph: Rec }> {
  let sent: Rec | undefined;
  let graph: Rec | undefined;
  const result = await buildModelFromBrief(sid, brief, (async (path: string, body: Rec) => {
    if (path.endsWith('/graph/register')) { graph = structuredClone(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'stamp' } };
  }) as never, (async (req: Rec) => { sent ??= structuredClone(req); return { text: JSON.stringify(draft) }; }) as never);
  if ((result as Rec).ok !== true || graph === undefined || sent === undefined) throw new Error(JSON.stringify(result).slice(0, 2000));
  return { sent, graph };
}
const node = (graph: Rec, label: string): Rec => {
  const found = (graph.nodes as Rec[]).filter((n) => n.label === label);
  if (found.length !== 1) throw new Error(`expected one node "${label}", found ${found.length}`);
  return found[0]!;
};
const withItem = (draft: Rec, kind: 'risks' | 'factors', label: string, patch: Rec): Rec => {
  const d = structuredClone(draft) as Rec;
  Object.assign((d[kind] as Rec[]).find((q) => q.label === label)!, patch);
  return d;
};

describe('served hiring post3007, through the real build path', () => {
  it('the user\'s own concern ("while maintaining code quality") is claimed `inferred`, and is NOT stamped', async () => {
    expect((DRAFT.risks as Rec[]).find((r) => r.label === 'Code quality deterioration')!.provenance).toBe('inferred');
    expect(BRIEF).toContain('while maintaining code quality');
    const { graph } = await construct(DRAFT);
    expect(node(graph, 'Code quality deterioration')).toMatchObject({ kind: 'risk' });
    expect(node(graph, 'Code quality deterioration')).not.toHaveProperty('proposed_by');
  });

  it('a factor the drafter added, that no option the user stated acts on, IS stamped Olumi\'s', async () => {
    const { graph } = await construct(DRAFT);
    expect(node(graph, 'Leadership coverage')).toMatchObject({ kind: 'factor', proposed_by: 'olumi' });
    expect(node(graph, 'Recruitment cost per hire')).toMatchObject({ kind: 'factor', proposed_by: 'olumi' });
  });

  it('BACKSTOP: "Tech lead hires", claimed `ai_proposed` but the lever of the user\'s own "Hire Tech Lead", is NOT stamped', async () => {
    expect((DRAFT.factors as Rec[]).find((f) => f.label === 'Tech lead hires')!.provenance).toBe('ai_proposed');
    const { graph } = await construct(DRAFT);
    expect(node(graph, 'Tech lead hires')).not.toHaveProperty('proposed_by');
    // The user's stated factor and the user's options carry no mark either.
    expect(node(graph, 'Mid-weight developers')).not.toHaveProperty('proposed_by');
    expect((graph.nodes as Rec[]).filter((n) => n.kind === 'option' && n.proposed_by === 'olumi')).toEqual([]);
  });

  it('the drafter\'s own claim is what stamps a risk: the same risk claimed `ai_proposed` IS stamped', async () => {
    const { graph } = await construct(withItem(DRAFT, 'risks', 'Code quality deterioration', { provenance: 'ai_proposed' }));
    expect(node(graph, 'Code quality deterioration')).toMatchObject({ kind: 'risk', proposed_by: 'olumi' });
  });

  it('BACKSTOP: an `ai_proposed` item whose label the brief names is NOT stamped', async () => {
    const d = structuredClone(DRAFT) as Rec;
    (d.risks as Rec[]).push({ label: 'Urgent launch date', provenance: 'ai_proposed', unit: null, plausible_max: null });
    (d.links as Rec[]).push({ from: 'Urgent launch date', to: 'Productivity', direction: 'negative', provenance: 'ai_proposed',
      effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null });
    expect(BRIEF.toLowerCase()).toContain('urgent launch date');
    const { graph } = await construct(d);
    expect(node(graph, 'Urgent launch date')).not.toHaveProperty('proposed_by');
    // Contrast in the same graph: the drafter's other additions are still stamped.
    expect(node(graph, 'Leadership coverage')).toMatchObject({ proposed_by: 'olumi' });
  });

  it('BACKSTOP: a factor with a KNOWN baseline (only the user or evidence supplies one) is NOT stamped, whatever is claimed', async () => {
    const { graph } = await construct(withItem(DRAFT, 'factors', 'Leadership coverage', { baseline_known: true }));
    expect(node(graph, 'Leadership coverage')).not.toHaveProperty('proposed_by');
    expect(node(graph, 'Recruitment cost per hire')).toMatchObject({ proposed_by: 'olumi' });
  });
});

describe('what the drafter is sent (AIE_TEXT_PENDING)', () => {
  it('the introduction claim is described on options, factors, risks and outcomes, and NOT on a value\'s provenance', async () => {
    const { sent } = await construct(DRAFT);
    const p = sent.schema.properties as Rec;
    const described = [p.options.items.properties.provenance, p.factors.items.properties.provenance,
      p.risks.items.properties.provenance, p.outcomes.items.properties.provenance].map((x: Rec) => x.description as string);
    for (const d of described) expect(d).toMatch(/^Who introduced this item\./);
    expect(new Set(described).size, 'one text').toBe(1);
    expect(p.factors.items.properties.provenance.enum).toEqual(['explicit', 'inferred', 'ai_proposed']);
    expect(p.goal.properties.baseline_provenance).not.toHaveProperty('description');
    expect(p.links.items.properties.provenance).not.toHaveProperty('description');
  });
});
