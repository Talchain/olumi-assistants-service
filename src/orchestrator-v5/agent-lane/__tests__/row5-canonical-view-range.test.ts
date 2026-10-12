/**
 * Recovery Batch B, Row5 surface (DL ruling 12 Oct 13:3xZ, VALUE GAP GO): a stated range stored on a level reaches the
 * Agent's canonical view (`projectEntity`, the served `get_canonical_state`), so the reply can say "you gave 10–30" or
 * "a supplier's 10–30 (unverified)". No prompt instruction text changes; the field is the whole change.
 * The nodes go through the persisted projection first (`projectGraphForPersistence`, `GraphV3`): what a reopened session
 * reads.
 */
import { describe, expect, it } from 'vitest';
import cap from './fixtures/capacity-served-drafts-20261011.json';
import t5 from './fixtures/row5-range-drafts-t5.json';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { projectEntity } from '../runtime/agent-capabilities.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

type Rec = Record<string, any>;
const SUPPLIER = 'A supplier says a specialist can contribute 10–30 features per week; I have not verified that claim.';
function view(candidate: Rec, brief: string, label: string): Rec {
  const admitted = admitCandidateModel(structuredClone(candidate) as unknown as CandidateModel, {}, brief);
  const stored = GraphV3.parse(projectGraphForPersistence({ nodes: admitted.nodes, edges: admitted.edges } as never)) as unknown as { nodes: Rec[] };
  const node = stored.nodes.find(n => n.kind === 'factor' && n.label === label);
  expect(node, `stored "${label}"`).toBeDefined();
  return projectEntity(node as never);
}
const labelOf = (candidate: Rec, value: number) => (candidate.factors as Rec[]).find(f => f.baseline_value === value)!.label as string;

describe('Row5 surface: the canonical view reports the stated range with its author and the point beside it', () => {
  for (const d of cap.drafts) {
    it(`capacity ${d.scenario_id.slice(0, 8)}: Paul's 20 shows his own 10–30, beside his own figure`, () => {
      const e = view(d.candidate, cap.brief, labelOf(d.candidate, 20));
      expect(e.raw_value).toBe(20);
      expect(e.stated_range).toEqual({ low: 10, high: 30, stated_by: 'user', point: 'user_figure' });
    });
  }
  const d6 = (sample: string, arm: string) => t5.drafts.find(d => d.sample === sample && d.arm === arm)!;
  for (const [sample, arm, label, value, point] of [
    ['D6-capacity-reference-boundary-r1-call1', 'A', 'Specialist output per week', 20, 'olumi_midpoint'],
    ['D6-capacity-reference-boundary-r2-call1', 'A', 'Feature contribution per specialist', 20, 'olumi_midpoint'],
    ['D6-capacity-reference-boundary-r2-call1', 'C', 'Specialist contribution per week', 10, undefined],
  ] as const) {
    it(`D6 ${arm} ${sample.slice(-8)}: "${label}" shows the supplier's 10–30, quoted, unverified${point ? '; the 20 is Olumi\'s midpoint' : ''}`, () => {
      const e = view(JSON.parse(d6(sample, arm).raw_text), t5.briefs['D6-capacity-reference-boundary'], label);
      expect(e.raw_value).toBe(value);
      expect(e.stated_range).toEqual({ low: 10, high: 30, stated_by: 'third_party_unverified', quote: SUPPLIER, ...(point ? { point } : {}) });
    });
  }
  it('CONTRAST: a level with no stated range shows its point only (Paul\'s 80; D6\'s current team)', () => {
    const c = cap.drafts[0]!;
    const eighty = view(c.candidate, cap.brief, labelOf(c.candidate, 80));
    expect(eighty.raw_value).toBe(80);
    expect('stated_range' in eighty).toBe(false);
    const team = view(JSON.parse(d6('D6-capacity-reference-boundary-r1-call1', 'C').raw_text), t5.briefs['D6-capacity-reference-boundary'], 'Current team delivery capacity');
    expect(team.raw_value).toBe(80);
    expect('stated_range' in team).toBe(false);
  });
  it('CONTRAST: a range with no known author is not shown (never guessed as the user\'s)', () => {
    const e = projectEntity({ id: 'f', kind: 'factor', label: 'F', observed_state: { value: 0.2, raw_value: 20, unit: 'x',
      source: 'cee_inference', range: { low: 10, high: 30, meaning: 'min_max', source: 'cee_inference' } } } as never);
    expect('stated_range' in e).toBe(false);
  });
});
