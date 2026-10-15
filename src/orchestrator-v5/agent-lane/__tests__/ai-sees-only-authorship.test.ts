/**
 * ⭐ S10 FIX 1 (arch12/SYNTHESIS; DL 15 Oct): the AI's model view carries ONLY the authority's answer to "whose is it", never
 * the raw stamps. Served: an approved Olumi estimate is stored as `user_assumption` with `reviewed_by_user` and corrected only on
 * read; given both the stamp and the answer, the Agent told Paul "proposed values become yours when you approve them".
 * Property across served graphs (hiring r4 turn 06, pricing MRR 2a35ff31, marketing 828a36d0): every entity's value, every
 * entity and every link says whose in the ONE vocabulary, and no raw authorship stamp is in what the Agent reads.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { projectEntity, projectModelContext } from '../runtime/agent-capabilities.js';

type Rec = Record<string, any>;
const WHOSE = ['yours', 'brief', 'unverified_brief', 'olumi', 'olumi_accepted', 'unknown'];
/** The first graph in a served capture, whatever envelope holds it. */
const graphIn = (v: unknown): Rec | undefined => {
  if (v === null || typeof v !== 'object') return undefined;
  const r = v as Rec;
  if (Array.isArray(r.nodes) && Array.isArray(r.edges)) return r;
  for (const x of Object.values(r)) { const g = graphIn(x); if (g !== undefined) return g; }
  return undefined;
};
const BRIEFS: readonly [string, string][] = [
  ['hiring r4 turn 06', 'src/orchestrator-v5/agent-lane/__tests__/fixtures/hiring-positive-r4-turn06.json'],
  ['pricing MRR 2a35ff31', 'src/orchestrator-v5/agent-lane/__tests__/fixtures/pricing-e2e-2a35ff31-read02-after-reopen.json'],
  ['marketing 828a36d0', 'src/orchestrator-v5/agent-lane/__tests__/fixtures/marketing-e2e-828a36d0-read08-after-reopen.json'],
];
/** What the Agent is given about the model: each entity, and the model context's goal, limits and links. */
const agentView = (g: Rec): { entities: Rec[]; links: Rec[] } => ({
  entities: (g.nodes as Rec[]).map((n) => projectEntity(n as never)),
  links: projectModelContext({ nodes: g.nodes, edges: g.edges, raw: g, analysis_state: undefined, analysis_ready: false } as never).links as Rec[],
});
const RAW_STAMPS = /"(?:user_assumption|user_override|user_stated|user_specified|brief_extraction|cee_hypothesis|cee_inference|domain_knowledge|ai_inferred|from_brief|user_set)"/;

describe('S10 fix 1: the Agent reads whose it is from the ONE authority, never the raw stamps', () => {
  it.each(BRIEFS)('%s: every value, entity and link says whose in the one vocabulary; no raw stamp', (_name, file) => {
    const g = graphIn(JSON.parse(readFileSync(file, 'utf8')))!;
    const { entities, links } = agentView(g);
    expect(entities.length).toBeGreaterThan(3);
    for (const e of entities) {
      expect(e).not.toHaveProperty('provenance');
      if (e.value_provenance !== undefined) expect(Object.keys(e.value_provenance).filter((k) => !['whose', 'origin', 'role'].includes(k))).toEqual([]);
      if (e.value_provenance !== undefined) expect(WHOSE).toContain(e.value_provenance.whose);
      if (e.added_by !== undefined) expect(WHOSE).toContain(e.added_by);
    }
    // Contrast: the view still says whose for the entities and links that carry a record of it.
    expect(entities.filter((e) => e.added_by !== undefined).length).toBeGreaterThan(0);
    const sized = links.filter((l) => l.whose !== undefined);
    expect(sized.length).toBeGreaterThan(0);
    for (const l of links) { expect(l).not.toHaveProperty('source'); if (l.whose !== undefined) expect(WHOSE).toContain(l.whose); }
    expect(JSON.stringify({ entities, links })).not.toMatch(RAW_STAMPS);
  });

  it('the "become yours" case: an accepted Olumi estimate stored as user_assumption reads as Olumi’s, accepted, and nothing else', () => {
    const node = { id: 'churn', kind: 'factor', label: 'Monthly churn', provenance: 'ai_inferred',
      observed_state: { value: 0.05, raw_value: 5, unit: '%', source: 'user_assumption', reviewed_by_user: { intent: 'confirm', at: '2026-10-14T21:00:00Z' } } };
    const seen = projectEntity(node as never);
    expect(seen.value_provenance).toEqual({ whose: 'olumi_accepted', origin: 'olumi' });
    expect(seen.added_by).toBe('olumi');
    expect(JSON.stringify(seen)).not.toMatch(/user_assumption|reviewed_by_user|ai_inferred/);
  });

  it('PL #3177: the user’s own words with an UNVERIFIED binding (the served 80) stay the user’s source with an unverified role, never unknown', () => {
    const node = { id: 'demand', kind: 'factor', label: 'Weekly demand', provenance: 'unverified_brief',
      observed_state: { value: 80, raw_value: 80, unit: 'tickets/week', source: 'brief_extraction', user_material_unverified: true } };
    const seen = projectEntity(node as never);
    expect(seen.value_provenance).toMatchObject({ origin: 'user', role: 'unverified' });
    expect(seen.value_provenance.whose).not.toBe('unknown');
    expect(seen.added_by).toBe('unverified_brief');
  });

  it('a link with an unrecognised drawing stamp is unknown, never a human source', () => {
    const g = { nodes: [{ id: 'a', kind: 'factor', label: 'A' }, { id: 'b', kind: 'goal', label: 'B' }],
      edges: [{ from: 'a', to: 'b', strength: { mean: 0.4, std: 0.1 }, provenance: { source: 'mystery_importer' } },
        { from: 'a', to: 'b', id: 'e2', strength: { mean: 0.4, std: 0.1 }, provenance: { source: 'user_specified' } }] };
    const links = projectModelContext({ nodes: g.nodes, edges: g.edges, raw: g, analysis_state: undefined, analysis_ready: false } as never).links as Rec[];
    expect(links.map((l) => l.whose)).toEqual(['unknown', 'yours']);
  });
});
