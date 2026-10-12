import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildModelFromBrief, type CallStructuredModel } from '../runtime/build-model.js';
import type { InternalDispatch } from '../runtime/agent-capabilities.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { isPlaceholderLink } from '../../../cee/magnitude/link-sizing.js';

type Json = Record<string, any>;
const recording = (which: 'new' | 'old'): Json => JSON.parse(readFileSync(new URL(`./fixtures/j1-${which}-construction.json`, import.meta.url), 'utf8'));
async function build(record: Json) {
  let registered: unknown;
  const dispatch: InternalDispatch = async (path, body) => {
    if (path.endsWith('/graph/register')) {
      registered = structuredClone((body as { graph: unknown }).graph);
      return { status: 200, json: { model_version: { version_number: 1 } } };
    }
    return { status: 200, json: { graph: { nodes: [], edges: [] }, graph_hash: 'h' } };
  };
  const call = (async () => ({ text: JSON.stringify(record.candidate) })) as unknown as CallStructuredModel;
  const result = await buildModelFromBrief('59165046-0000-4000-8000-000000000001', record.brief, dispatch, call) as Json;
  expect(result.ok, JSON.stringify(result)).toBe(true);
  return GraphV3.parse(registered);
}
function edgeFrom(graph: ReturnType<typeof GraphV3.parse>, label: string) {
  const source = graph.nodes.find(n => n.label === label)!;
  const goal = graph.nodes.find(n => n.id === 'monthly_recurring_revenue')!;
  expect(source).toBeDefined();
  expect(goal).toBeDefined();
  const edge = graph.edges.find(e => e.from === source.id && e.to === goal.id)!;
  expect(edge).toBeDefined();
  return { edge, goal };
}
const EXISTING = 'Existing-customer monthly recurring revenue';
describe('recorded J1 definitions survive admission and exact-link frame refit', () => {
  it.each([['new', EXISTING], ['old', 'Starter-tier MRR']] as const)('%s capture keeps its definition and user goal levels', async (which, label) => {
    const { edge, goal } = edgeFrom(await build(recording(which)), label);
    expect(edge.provenance?.definitional).toBe(true);
    expect(isPlaceholderLink(edge)).toBe(false);
    expect(edge.provenance?.natural_effect).toMatchObject({ amount: 1, per_source_change: 1, amount_unit: '£/month', per_source_change_unit: '£/month', strength_mean: edge.strength.mean });
    expect(Math.abs(edge.strength.mean)).toBeLessThanOrEqual(1);
    expect(edge.provenance).not.toHaveProperty('clamped_from');
    expect(goal.observed_state?.raw_value).toBe(120000);
    expect(goal.goal_threshold_raw).toBe(150000);
  });
  it.each(['ratio', 'unit', 'sign', 'untagged'] as const)('refuses a claimed definition with invalid %s', async mutation => {
    const record = recording('new');
    const link = record.candidate.links.find((l: Json) => l.from === EXISTING && l.to === 'monthly recurring revenue');
    if (mutation === 'ratio') link.effect_amount = 0.9;
    if (mutation === 'unit') record.candidate.outcomes.find((n: Json) => n.label === EXISTING).unit = 'hours/month';
    if (mutation === 'sign') link.effect_amount = -1;
    if (mutation === 'untagged') link.definitional = false;
    const { edge } = edgeFrom(await build(record), EXISTING);
    expect(edge.provenance?.definitional).not.toBe(true);
    // Ordinary oversized estimates still fail the representability check.
    if (mutation === 'ratio' || mutation === 'untagged') expect(isPlaceholderLink(edge)).toBe(true);
  });
});
