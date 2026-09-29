import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { partitionM1Candidate } from '../m1-candidate-partition.js';
import { buildModelFromBrief } from '../runtime/build-model.js';
import type { CandidateModel } from '../admit-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3, type GraphV3T } from '../../../schemas/cee-v3.js';

const live = JSON.parse(readFileSync(new URL('./fixtures/m1-live-paul-count-scope-20260929.json', import.meta.url), 'utf8')) as { brief: string; candidate: CandidateModel };
async function build(candidate: CandidateModel, brief: string, policy: 'current' | 'm1' = 'm1') {
  let graph: GraphV3T | undefined;
  const dispatch = (async (path: string, body: { graph?: unknown }) => {
    if (path.endsWith('/graph/register')) { graph = GraphV3.parse(body.graph); return { status: 200, json: { model_version: { version_number: 1 } } }; }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, versions: [] } };
  }) as InternalDispatch;
  const result = await buildModelFromBrief('99999999-9999-4999-8999-999999999999', brief, dispatch, async () => ({ text: JSON.stringify(candidate) }), undefined, policy);
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return { graph: graph!, result };
}

describe('M1 count population scope at the real admission payload boundary', () => {
  it('live #58 preserves the generic count without falsely making all 1,500 subscribers Pro', async () => {
    const { graph, result } = await build(live.candidate, live.brief);
    const count = graph.nodes.find((n) => n.label === 'Paying subscribers');
    expect(count).toMatchObject({ provenance: 'from_brief', source_quote: 'have 1,500 paying subscribers', observed_state: { raw_value: 1500, source: 'brief_extraction', source_quote: 'have 1,500 paying subscribers' } });
    expect(graph.nodes.some((n) => /Pro plan paying subscribers/i.test(n.description ?? n.label))).toBe(false);
    expect(graph.edges.some((e) => e.from === count!.id || e.to === count!.id)).toBe(false);
    expect(result.open_questions).toContain('Does "have 1,500 paying subscribers" refer to "Pro plan paying subscribers", or a wider group?');
    expect(result.open_questions).toContain('Does your "MRR" goal cover all plans together or the Pro plan only?');
    expect(graph.nodes.find((n) => n.kind === 'goal')?.derivation).toBeUndefined();
  });

  it.each(['neutral', 'all-Pro'] as const)('preserves an actually stated %s population', async (control) => {
    const candidate = structuredClone(live.candidate);
    const label = control === 'neutral' ? 'Paying subscribers' : 'Pro plan paying subscribers';
    const count = candidate.factors.find((f) => f.label === 'Pro plan paying subscribers')!;
    count.label = label;
    const brief = control === 'neutral' ? live.brief : live.brief.replace('1,500 paying subscribers', '1,500 Pro plan paying subscribers');
    const { graph, result } = await build(candidate, brief);
    expect(graph.nodes.find((n) => n.label === label)).toMatchObject({ provenance: 'from_brief', observed_state: { raw_value: 1500, source: 'brief_extraction' } });
    expect((result.open_questions as string[]).some((q) => /wider group/.test(q))).toBe(false);
  });

  it('an explicit dependent relationship holds the generic count pending instead of changing its meaning', () => {
    const candidate = { ...live.candidate, links: live.candidate.links.map((l) => l.from === 'Pro plan paying subscribers' ? { ...l, provenance: 'explicit' } : l) };
    const partition = partitionM1Candidate(candidate, live.brief);
    expect(partition.candidate.factors.find((f) => f.label === 'Pro plan paying subscribers')).toMatchObject({ provenance: 'inferred', baseline_known: false, baseline_value: null });
    expect(partition.candidate.factors.some((f) => f.label === 'Paying subscribers')).toBe(false);
    expect(partition.proposals).toContainEqual(expect.objectContaining({ kind: 'value', label: 'Paying subscribers', payload: { value: 1500, unit: 'subscribers', provenance: 'explicit', source_quote: 'have 1,500 paying subscribers', pending_reason: 'scope_unresolved' } }));
    expect(partition.placeholders).toContain('Pro plan paying subscribers');
    expect(partition.candidate.links.some((l) => l.from === 'Paying subscribers')).toBe(false);
  });

  it('does not alter the default constructor policy', async () => {
    const { graph } = await build(live.candidate, live.brief, 'current');
    expect(graph.nodes.find((n) => n.label === 'Pro plan paying subscribers')).toMatchObject({ provenance: 'from_brief', observed_state: { raw_value: 1500 } });
    expect(graph.nodes.some((n) => n.label === 'Paying subscribers')).toBe(false);
  });
});
