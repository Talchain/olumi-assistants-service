/**
 * The admitted model must satisfy the canonical schema the WRITE PATH validates
 * against. This test should have existed from the first commit of this lane.
 *
 * ⛔ HOW ITS ABSENCE COST REAL TIME. The lane's "validate / admit candidate"
 * seam validated the CANDIDATE and never the OUTPUT. The persisted graph was
 * therefore malformed, and every attempt to write to it through the product
 * surface returned 500 `system_event_commit_failed`. CEE was behaving correctly
 * — `structural-add-edge.ts:233` does `GraphV3.safeParse(persistedGraph)` and
 * treats a non-null graph that fails as CORRUPTION, failing closed — and the
 * staging log named the field exactly: `first_issue_path: "nodes.0.provenance"`.
 *
 * Two distinct bugs, both of which this single assertion catches:
 *
 *   1. NODE provenance is a DISPLAY ENUM (`from_brief | ai_inferred | user_set`,
 *      `cee-v3.ts:363`). EDGE provenance is an OBJECT (`{source, reasoning}`,
 *      `:443`). This lane stamped the edge shape onto nodes.
 *   2. `goal_threshold` is documented as NORMALISED 0-1
 *      (`goal_threshold_raw / goal_threshold_cap`). This lane wrote the raw
 *      20000 into it — out of range by four orders of magnitude, and silently
 *      distorting any goal probability computed from it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { admitCandidateModel, type CandidateModel } from '../admit-model.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

const d = new URL('./fixtures/', import.meta.url);
const admitted = () => admitCandidateModel(
  JSON.parse(readFileSync(new URL('faithful.json', d), 'utf8')) as CandidateModel,
  JSON.parse(readFileSync(new URL('widened.json', d), 'utf8')),
);

describe('the admitted graph satisfies the write path’s own validator', () => {
  it('passes GraphV3 — the exact check structural_add_edge runs before writing', () => {
    const m = admitted();
    const parsed = GraphV3.safeParse({ nodes: m.nodes, edges: m.edges });
    const issues = parsed.success ? [] : parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`);
    expect(issues, 'a graph that fails here cannot be written to, ever').toEqual([]);
  });

  it('node provenance is the display enum, never the edge object', () => {
    for (const n of admitted().nodes) {
      expect(['from_brief', 'ai_inferred', 'user_set', undefined]).toContain(n.provenance);
    }
  });

  it('edge provenance is still the structured object', () => {
    for (const e of admitted().edges) {
      expect(typeof e.provenance === 'object' && e.provenance !== null).toBe(true);
      expect(['brief_extraction', 'cee_hypothesis', 'domain_knowledge', 'user_specified'])
        .toContain(e.provenance!.source);
    }
  });

  it('goal_threshold is normalised, with the raw value and cap beside it', () => {
    const goal = admitted().nodes.find((n) => n.kind === 'goal')!;
    expect(goal.goal_threshold_raw, 'the number the user actually stated').toBe(20000);
    expect(goal.goal_threshold_unit).toBe('£');
    // resolveGoalThresholdCapWithProvenance rule 3: cap = raw * 1.25.
    expect(goal.goal_threshold_cap).toBe(25000);
    expect(goal.goal_threshold_cap_provenance).toBe('target_derived_headroom');
    expect(goal.goal_threshold).toBeCloseTo(0.8, 10);
    expect(goal.goal_threshold as number).toBeGreaterThan(0);
    expect(goal.goal_threshold as number).toBeLessThanOrEqual(1);
  });
});
