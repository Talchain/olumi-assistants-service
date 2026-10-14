/**
 * ⭐ GEN #9 TRACE (DL ruling 14 Oct 02:0xZ) — the user's stated centre on the capacity draft: saved source → the ONE
 * provenance authority → what the user is shown. No code change; this row pins the reading the DL accepted.
 *
 * Served CEE staging 351eeda0, capacity turn 01 (`fixtures/capacity-003921Z-served-draft.json`, the turn's draft graph
 * verbatim). The brief: "Each additional specialist resolves about 20 tickets per week, between 10 and 30." The saved node
 * holds `raw_value 20` stamped `source: cee_inference` / `extractionType: inferred` BESIDE `user_material_unverified: true`
 * (provenance `unverified_brief`); the range keeps the user's own source and quote. The judge read the stamp alone as Olumi's
 * (`codex/JUDGE-capacity-post2996-codex.md` row 7, FAIL on record until a served witness).
 *
 * The trace: the authority reads that pair as the person's figure with an unverified role, never Olumi's; the census the
 * chance face and the Check-estimates panel share (`goalChanceEstimateCensus`) never lists it as Olumi's estimate.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { heldFigureOwnerOf, inputOriginOf, valueAuthorshipOf, valueProvenanceOf } from '../../../cee/provenance/provenance-of.js';
import { goalChanceEstimateCensus } from '../goal-chance-estimate-attribution.js';

type Rec = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/capacity-003921Z-served-draft.json', import.meta.url), 'utf8')) as { graph: Rec };
const NODE = (FX.graph.nodes as Rec[]).find((n) => n.id === 'capacity_per_additional_specialist')!;

describe('GEN #9: the capacity draft\'s "about 20" is the user\'s figure, unverified — never Olumi\'s estimate', () => {
  it('PRECONDITION: the served node holds the stamp beside the user-material marker, and the range is the user\'s', () => {
    expect(NODE.observed_state).toMatchObject({ raw_value: 20, source: 'cee_inference', extractionType: 'inferred', user_material_unverified: true,
      range: { low: 10, high: 30, source: 'user_override', source_quote: 'Each additional specialist resolves about 20 tickets per week, between 10 and 30.' } });
    expect(NODE.provenance).toBe('unverified_brief');
  });

  it('the ONE authority: origin human, role unverified — owner "unverified brief", authorship unknown, census input unverified', () => {
    const p = valueProvenanceOf(NODE.observed_state) as Rec;
    expect(p.origin).toBe('human');
    expect(inputOriginOf(NODE.observed_state)).toBe('unverified');
    expect(valueAuthorshipOf(NODE.observed_state)).toBe('unknown');
    expect(heldFigureOwnerOf(NODE.observed_state)).toBe('unverified_brief');
  });

  it('what the user is shown: the shared estimates census never lists it as Olumi\'s estimate', () => {
    const options = (FX.graph.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => String(n.id));
    const { counts, estimates } = goalChanceEstimateCensus(FX.graph, options, 'weekly_support_capacity');
    expect(counts.unread).toBe(false);
    expect(estimates).not.toBeNull();
    expect([...estimates!.values, ...estimates!.top].map((i) => i.id)).not.toContain(NODE.id);
    expect(counts.unverifiedValues).toBeGreaterThanOrEqual(1);
  });

  it('CONTRAST (the census sees it): the same node WITHOUT the user-material marker is Olumi\'s, and is listed as Olumi\'s estimate', () => {
    const graph = structuredClone(FX.graph);
    const node = (graph.nodes as Rec[]).find((n) => n.id === NODE.id)!;
    delete node.observed_state.user_material_unverified;
    expect(inputOriginOf(node.observed_state)).toBe('ai');
    const options = (graph.nodes as Rec[]).filter((n) => n.kind === 'option').map((n) => String(n.id));
    const { estimates } = goalChanceEstimateCensus(graph, options, 'weekly_support_capacity');
    expect(estimates!.values.map((i) => i.id)).toContain(NODE.id);
  });
});
