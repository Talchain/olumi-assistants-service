import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { projectAnalysisAdmission } from '../analysis-admission-projection.js';
import { resolveAnalysisAdmission } from '../../orchestrator-v5/admission/analysis-admission.js';

/**
 * The obligation: after a reload, a client can learn whether a run may be
 * admitted — WITHOUT taking a turn, and WITHOUT the route shipping prose.
 */

// A graph the engine can actually judge: two options reaching one goal.
const ANALYSABLE = {
  nodes: [
    { id: 'o1', kind: 'option', label: 'Hire two' },
    { id: 'o2', kind: 'option', label: 'Hire none' },
    { id: 'f1', kind: 'factor', label: 'Churn rate', value: 0.4, scale: { kind: 'unit_interval' } },
    { id: 'g1', kind: 'goal', label: 'Retention' },
  ],
  edges: [
    { id: 'e1', source: 'o1', target: 'f1', kind: 'causal', magnitude: 0.5 },
    { id: 'e2', source: 'o2', target: 'f1', kind: 'causal', magnitude: 0.2 },
    { id: 'e3', source: 'f1', target: 'g1', kind: 'causal', magnitude: 0.6 },
  ],
  goal_node_id: 'g1',
};

describe('a reload can learn whether a run may be admitted', () => {
  it('⭐ answers for a real graph rather than returning null', () => {
    const p = projectAnalysisAdmission(ANALYSABLE, true);
    expect(p).not.toBeNull();
    expect(typeof p!.admitted).toBe('boolean');
  });

  it('⛔ NULL when there is no graph — "this leg did not answer", never a state', () => {
    // Mirrors `analysis_state`'s own contract on this route: a consumer must
    // leave what it already believed standing.
    expect(projectAnalysisAdmission(null, false)).toBeNull();
    expect(projectAnalysisAdmission(ANALYSABLE, false)).toBeNull();
  });

  it('⭐ the verdict is the AUTHORITY’s, not a second opinion', () => {
    // Bound by identity to `resolveAnalysisAdmission` rather than to a value
    // another computation could coincidentally match.
    const authority = resolveAnalysisAdmission(ANALYSABLE);
    const p = projectAnalysisAdmission(ANALYSABLE, true)!;
    expect(p.admitted).toBe(authority.structurally_analysable);
    expect(p.permitted_analysis_mode).toBe(authority.permitted_analysis_mode);
    expect(p.semantic_quality_sufficient).toBe(authority.semantic_quality_sufficient);
    expect(p.graph_hash).toBe(authority.graph_hash);
  });

  it('⛔⛔ SHIPS NO PROSE — every user-facing string in the source type is dropped', () => {
    const authority = resolveAnalysisAdmission({ nodes: [], edges: [] });
    const p = projectAnalysisAdmission({ nodes: [], edges: [] }, true)!;
    const flat = JSON.stringify(p);
    // Contrast control: the AUTHORITY does carry prose, so a probe that finds
    // none in the projection is measuring a real removal, not an empty input.
    const authorityProse = [
      ...authority.reasons.map((r) => r.message),
      ...authority.missing_important_inputs.map((m) => m.why_it_matters),
    ].filter((t) => typeof t === 'string' && t.length > 0);
    expect(authorityProse.length).toBeGreaterThan(0);
    for (const sentence of authorityProse) expect(flat).not.toContain(sentence);
  });

  it('⭐ reason CODES survive, so a client can still say what stands in the way', () => {
    const authority = resolveAnalysisAdmission({ nodes: [], edges: [] });
    const p = projectAnalysisAdmission({ nodes: [], edges: [] }, true)!;
    expect(authority.reasons.length).toBeGreaterThan(0);
    for (const code of new Set(authority.reasons.map((r) => r.code))) {
      expect(p.reason_codes).toContain(code);
    }
  });

  it('⛔ missing inputs are reported by CODE — `field` does not exist on that type', () => {
    // The first draft read `.field`, which would have shipped a permanently
    // empty array that read as "nothing is missing".
    const authority = resolveAnalysisAdmission({ nodes: [], edges: [] });
    const p = projectAnalysisAdmission({ nodes: [], edges: [] }, true)!;
    const codes = new Set(authority.missing_important_inputs.map((m) => m.code).filter(Boolean));
    expect(p.missing_input_codes.length).toBe(codes.size);
    for (const c of codes) expect(p.missing_input_codes).toContain(c);
  });

  it('⭐ codes are de-duplicated — one cause is not reported as several', () => {
    const p = projectAnalysisAdmission({ nodes: [], edges: [] }, true)!;
    expect(new Set(p.reason_codes).size).toBe(p.reason_codes.length);
    expect(new Set(p.missing_input_codes).size).toBe(p.missing_input_codes.length);
  });

  it('⛔ never throws on a graph it cannot read — a read route must not 500', () => {
    for (const bad of [undefined, 'a string', 42, [], { nodes: 'no' }]) {
      expect(() => projectAnalysisAdmission(bad, true)).not.toThrow();
    }
  });
});

describe('the read route actually ships it', () => {
  const ROUTE = readFileSync(new URL('../assist.v1.scenario-graph.ts', import.meta.url), 'utf8');

  it('the probe can see the route (not vacuous)', () => {
    expect(ROUTE).toContain('analysis_state:');
    expect(ROUTE).toContain('layout_present:');
  });

  it('⭐ the response carries analysis_admission from the projection', () => {
    expect(ROUTE).toContain('analysis_admission: projectAnalysisAdmission(graph, graphPresent)');
  });

  it('⛔ the FORBIDDEN turn-shaped key is still not on this route', () => {
    // The pin at `analysis-read.test.ts:448` stands: `analysis_ready` is the
    // prose carrier AND a turn-shaped key. This adds a verdict WITHOUT it.
    const send = ROUTE.slice(ROUTE.indexOf('layout_present:'));
    expect(send).not.toContain('analysis_ready:');
  });
});

/**
 * ⛔ THE CONTRACT SAID "Empty when admitted" AND IT NEVER IS — a consumer
 * implementing it would have shown a blocker on every healthy scenario.
 * `analysisAdmissionFrom` pushes the `semantic_quality_sufficient` reason and the
 * `permitted_analysis_mode` reason UNCONDITIONALLY, plus one of
 * `RUN_WILL_EXCLUDE_OPTIONS` / `READY_TO_COMPARE`.
 *
 * And a code alone cannot say whether the user OWES anything: the authority
 * separates "N inputs are still needed from you" from "Olumi filled in the gaps
 * here itself" purely in the message, under one shared `MODEL_HAS_BLOCKERS` code.
 */
describe('the projection does not promise a contract the authority breaks', () => {
  it('⛔ reason_codes is NON-EMPTY on an admitted model — the old docblock was false', () => {
    const p = projectAnalysisAdmission(ANALYSABLE, true);
    expect(p).not.toBeNull();
    // ⚠ Bound to the FIELD, not to a particular verdict: the point is that
    // `reason_codes` is populated whatever `admitted` says, so a consumer must
    // never read its emptiness as "no blockers".
    expect(p!.reason_codes.length).toBeGreaterThan(0);
  });

  it('⭐ cardinality survives the code collapse, and obligation is discriminated', () => {
    const p = projectAnalysisAdmission(ANALYSABLE, true);
    expect(p).not.toBeNull();
    // `missing_input_codes` answers "what kind"; `missing_input_count` "how many".
    // A consumer reading `.length` for cardinality undercounts whenever one code
    // recurs across factors, which is legitimate and common.
    expect(p!.missing_input_count).toBeGreaterThanOrEqual(p!.missing_input_codes.length);
    // Every distinct gap is either demanded of the user or waived by exclusion —
    // nothing is silently in neither bucket.
    expect(p!.inputs_demanded_of_user + p!.inputs_waived_by_exclusion).toBe(p!.missing_input_count);
  });
});
