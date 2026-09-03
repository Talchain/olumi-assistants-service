/**
 * The ONE analysis-admission result — behaviour, and the instrument checks that
 * make the behaviour claims worth reading.
 *
 * ⭐ WHAT THIS FILE IS BUILT TO SURVIVE
 *
 * The predicate under test is `semantic_quality_sufficient`, and the first
 * version of it was VACUOUS: "does the model carry any user-stated quantity?"
 * reads TRUE on every fresh draft, because option interventions are stamped
 * `brief_extraction`. A self-authored fixture would never have shown that. So
 * the load-bearing evidence here is a corpus from OUTSIDE the author's head —
 * real captured draft graphs already in this repo — and every absence assertion
 * carries a CONTRAST CONTROL in the same run (CLAUDE.md trap 13e): the target
 * must read zero AND a same-family signal must read non-zero, or the test is
 * reporting on its own blindness rather than on the product.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ANALYSIS_MODE_RANK,
  analysisAdmissionFrom,
  censusConfidenceParameters,
  CONFIDENCE_BEARING_NODE_KINDS,
  modePermitsAtLeast,
  PERMITTED_ANALYSIS_MODES,
  resolveAnalysisAdmission,
  semanticQualitySufficient,
  type PermittedAnalysisMode,
} from '../analysis-admission.js';
import { classifyValueSource } from '../../../cee/graph-readiness/obligation-provenance.js';
import { resolveRunAdmission, type RunAdmission } from '../../tools/handlers/analysis-ready-core.js';

// ============================================================================
// The corpus — real captures, enumerated from disk, never hand-listed
// ============================================================================

const CORPUS_ROOTS = [
  'acceptance-evidence/draft-speed',
  'acceptance-evidence/artefact-appendix-casing',
  'tools/golden-journey-harness/fixtures',
] as const;

interface CorpusGraph {
  readonly file: string;
  readonly graph: Record<string, unknown>;
}

function collectGraphs(): CorpusGraph[] {
  const out: CorpusGraph[] = [];
  for (const root of CORPUS_ROOTS) {
    let entries: string[];
    try {
      entries = readdirSync(root);
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.endsWith('.json')) continue;
      const file = join(root, entry);
      let parsed: unknown;
      try {
        parsed = JSON.parse(readFileSync(file, 'utf8'));
      } catch {
        continue;
      }
      const walk = (value: unknown): void => {
        if (value === null || typeof value !== 'object') return;
        const record = value as Record<string, unknown>;
        if (Array.isArray(record.nodes) && Array.isArray(record.edges) && record.nodes.length > 0) {
          out.push({ file, graph: record });
        }
        for (const key of Object.keys(record)) walk(record[key]);
      };
      walk(parsed);
    }
  }
  return out;
}

const CORPUS = collectGraphs();

/**
 * The corpus SIZE is asserted as a FLOOR, never pinned to a number.
 *
 * ⚠ A floor, because a hand-kept exact count is the mirror this estate pays for
 * most — and because a corpus that grows should strengthen the claim, not RED
 * the suite. But zero collected graphs must be a HARD ERROR: every assertion
 * below is a `for (const … of CORPUS)`, and `for` over an empty array passes
 * every one of them while testing nothing.
 */
const CORPUS_FLOOR = 8;

/** A minimal graph the canonical assessor admits: two distinct valued options. */
function admissibleGraph(overrides?: {
  goalBaselineSource?: string;
  edgeProvenanceSource?: string;
}): Record<string, unknown> {
  return {
    nodes: [
      { id: 'dec_1', kind: 'decision', label: 'Pricing decision' },
      { id: 'goal_1', kind: 'goal', label: 'Grow revenue' },
      {
        id: 'fac_price',
        kind: 'factor',
        label: 'Price',
        ...(overrides?.goalBaselineSource !== undefined
          ? { observed_state: { value: 10, source: overrides.goalBaselineSource } }
          : { observed_state: { value: 10, source: 'cee_inference' } }),
      },
      {
        id: 'opt_a',
        kind: 'option',
        label: 'Raise price',
        interventions: { fac_price: { value: 12, source: 'brief_extraction' } },
      },
      {
        id: 'opt_b',
        kind: 'option',
        label: 'Hold price',
        interventions: { fac_price: { value: 9, source: 'brief_extraction' } },
      },
    ],
    edges: [
      {
        from: 'dec_1',
        to: 'opt_a',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis' },
      },
      {
        from: 'dec_1',
        to: 'opt_b',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis' },
      },
      {
        from: 'fac_price',
        to: 'goal_1',
        strength: { mean: 0.6, std: 0.1 },
        exists_probability: 0.9,
        effect_direction: 'positive',
        provenance: { source: overrides?.edgeProvenanceSource ?? 'cee_hypothesis' },
      },
      {
        from: 'opt_a',
        to: 'fac_price',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
      {
        from: 'opt_b',
        to: 'fac_price',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
    ],
  };
}

// ============================================================================
// 1. THE CORPUS CLAIM — with its contrast control in the same run
// ============================================================================

describe('semantic_quality_sufficient over real captured draft graphs', () => {
  it('collects a non-empty corpus (an empty one would pass every loop below)', () => {
    expect(CORPUS.length).toBeGreaterThanOrEqual(CORPUS_FLOOR);
  });

  it('reads FALSE on every fresh draft capture, and the contrast control reads non-zero', () => {
    // CONTRAST CONTROL — accumulated in the SAME sweep. Option interventions in
    // these very graphs ARE user-stated (`brief_extraction`). If this reads zero
    // the probe is blind and the absence claim below proves nothing.
    let optionInterventionsUserStated = 0;
    let baselinesUserStated = 0;
    const verdicts: { file: string; sufficient: boolean; total: number }[] = [];

    for (const { file, graph } of CORPUS) {
      const nodes = graph.nodes as Record<string, unknown>[];
      for (const node of nodes) {
        const interventions = node.interventions as Record<string, unknown> | undefined;
        if (node.kind === 'option' && interventions) {
          for (const entry of Object.values(interventions)) {
            const source = (entry as { source?: unknown } | null)?.source;
            if (classifyValueSource(source) === 'user_stated') optionInterventionsUserStated += 1;
          }
        }
      }
      const signals = censusConfidenceParameters(graph);
      baselinesUserStated += signals.confidence_parameters_user_stated;
      verdicts.push({
        file,
        sufficient: semanticQualitySufficient(signals),
        total: signals.confidence_parameters_total,
      });
    }

    // The control fires.
    expect(optionInterventionsUserStated).toBeGreaterThan(0);
    // The probe is pointed at something — a census of zero everywhere would make
    // the verdict trivially false for the wrong reason.
    expect(verdicts.every((v) => v.total > 0)).toBe(true);
    // The measured claim.
    expect(baselinesUserStated).toBe(0);
    expect(verdicts.filter((v) => v.sufficient).map((v) => v.file)).toEqual([]);
  });
});

// ============================================================================
// 2. THE DISCRIMINATING TWIN — the predicate must be able to say YES
// ============================================================================

describe('the predicate discriminates in BOTH directions', () => {
  it('a machine-authored baseline is insufficient; a user-stated one is sufficient', () => {
    const machine = censusConfidenceParameters(admissibleGraph());
    const user = censusConfidenceParameters(
      admissibleGraph({ goalBaselineSource: 'user_edited' }),
    );

    expect(semanticQualitySufficient(machine)).toBe(false);
    expect(semanticQualitySufficient(user)).toBe(true);
    // Bound by IDENTITY of the thing that moved, not by the verdict alone: the
    // ONLY difference is one baseline's authorship, so the counts must differ by
    // exactly one in exactly that bucket.
    expect(user.confidence_parameters_user_stated).toBe(
      machine.confidence_parameters_user_stated + 1,
    );
    expect(user.confidence_parameters_total).toBe(machine.confidence_parameters_total);
  });

  it('a user-confirmed CAUSAL EDGE is sufficient on its own', () => {
    const signals = censusConfidenceParameters(
      admissibleGraph({ edgeProvenanceSource: 'user_specified' }),
    );
    expect(semanticQualitySufficient(signals)).toBe(true);
  });

  it('an OPTION intervention alone is NOT sufficient — the vacuity this predicate was rewritten to avoid', () => {
    // Every option here is stamped `brief_extraction` (= user_stated), and the
    // verdict must still be false. This is the regression pin for the first,
    // vacuous version of the predicate.
    const graph = admissibleGraph();
    const optionStamps = (graph.nodes as Record<string, unknown>[])
      .filter((n) => n.kind === 'option')
      .flatMap((n) => Object.values(n.interventions as Record<string, { source: string }>))
      .map((i) => classifyValueSource(i.source));
    // Precondition PINNED IN-TEST: the fixture really does carry user-stated
    // option values, so a false verdict is the predicate's doing, not the
    // fixture's failure.
    expect(optionStamps).toContain('user_stated');
    expect(semanticQualitySufficient(censusConfidenceParameters(graph))).toBe(false);
  });

  it('excludes edges PLoT strips, so an option→factor stamp cannot license a claim', () => {
    const base = censusConfidenceParameters(admissibleGraph());
    // The two option→factor edges are stamped `brief_extraction` in the fixture.
    // Only the ONE factor→goal edge and the ONE baseline node may be counted.
    expect(base.confidence_parameters_total).toBe(
      // goal + factor baselines (2) + the single non-option-incident edge (1)
      3,
    );
  });

  it('a graph with no confidence-bearing parameters is INSUFFICIENT, never vacuously sufficient', () => {
    expect(semanticQualitySufficient(censusConfidenceParameters({ nodes: [], edges: [] }))).toBe(
      false,
    );
    expect(semanticQualitySufficient(censusConfidenceParameters(null))).toBe(false);
    expect(semanticQualitySufficient(censusConfidenceParameters('not a graph'))).toBe(false);
  });
});

// ============================================================================
// 3. THE MODE — the field that makes this more than deduplication
// ============================================================================

describe('permitted_analysis_mode', () => {
  it('an admissible, wholly machine-authored model is quantified_provisional — NOT comparative_leader', () => {
    const graph = admissibleGraph();
    const verdict = resolveAnalysisAdmission(graph);
    // Precondition PINNED IN-TEST: the engine really would run this. Without
    // this the assertion below could hold because the model was refused, which
    // is a different cell entirely.
    expect(verdict.structurally_analysable).toBe(true);
    expect(verdict.permitted_analysis_mode).toBe('quantified_provisional');
    expect(modePermitsAtLeast(verdict.permitted_analysis_mode, 'comparative_leader')).toBe(false);
  });

  it('the SAME model with one user-set baseline becomes comparative_leader', () => {
    const verdict = resolveAnalysisAdmission(admissibleGraph({ goalBaselineSource: 'user_edited' }));
    expect(verdict.structurally_analysable).toBe(true);
    expect(verdict.permitted_analysis_mode).toBe('comparative_leader');
    expect(modePermitsAtLeast(verdict.permitted_analysis_mode, 'comparative_leader')).toBe(true);
  });

  it('a graph with nothing to compare is exploratory, not none', () => {
    // Two options carrying IDENTICAL intervention maps: strictly well-formed,
    // but PLoT's IDENTICAL_OPTIONS floor means there is no comparison.
    const graph = admissibleGraph();
    const nodes = graph.nodes as Record<string, unknown>[];
    const optB = nodes.find((n) => n.id === 'opt_b') as Record<string, unknown>;
    optB.interventions = { fac_price: { value: 12, source: 'brief_extraction' } };

    const admission = resolveRunAdmission(graph);
    // Precondition PINNED IN-TEST — this is the "strict had no complaint, the
    // second term refused" cell, and the assertion below is meaningless without it.
    expect(admission.willProceed).toBe(false);
    expect(admission.strict.safeToAnalyse).toBe(true);

    const verdict = analysisAdmissionFrom(admission, graph);
    expect(verdict.permitted_analysis_mode).toBe('exploratory');
  });

  it('a graph the engine cannot run at all is none', () => {
    const verdict = resolveAnalysisAdmission({ nodes: [], edges: [] });
    expect(verdict.structurally_analysable).toBe(false);
    expect(verdict.permitted_analysis_mode).toBe('none');
  });

  it('the lattice is exhaustive and strictly ordered', () => {
    expect([...PERMITTED_ANALYSIS_MODES].sort()).toEqual(
      ['comparative_leader', 'exploratory', 'none', 'quantified_provisional'].sort(),
    );
    const ranks = PERMITTED_ANALYSIS_MODES.map((m) => ANALYSIS_MODE_RANK[m]);
    expect(new Set(ranks).size).toBe(ranks.length);
  });
});

// ============================================================================
// 4. A REFUSAL IS NEVER SILENT — the invariant the original defect violated
// ============================================================================

describe('no verdict is ever silent', () => {
  const REFUSING_GRAPHS: { name: string; graph: unknown }[] = [
    { name: 'empty', graph: { nodes: [], edges: [] } },
    { name: 'null', graph: null },
    { name: 'not a graph', graph: 'nonsense' },
    { name: 'no options', graph: { nodes: [{ id: 'g', kind: 'goal' }], edges: [] } },
  ];

  it.each(REFUSING_GRAPHS)('$name — a refusal names the field and says something', ({ graph }) => {
    const verdict = resolveAnalysisAdmission(graph);
    expect(verdict.structurally_analysable).toBe(false);
    expect(verdict.reasons.length).toBeGreaterThan(0);
    const structural = verdict.reasons.filter((r) => r.field === 'structurally_analysable');
    expect(structural.length).toBeGreaterThan(0);
    for (const reason of structural) expect(reason.message.trim().length).toBeGreaterThan(0);
  });

  it('EVERY verdict explains permitted_analysis_mode and semantic_quality_sufficient', () => {
    const graphs: unknown[] = [
      ...REFUSING_GRAPHS.map((g) => g.graph),
      admissibleGraph(),
      admissibleGraph({ goalBaselineSource: 'user_edited' }),
      ...CORPUS.map((c) => c.graph),
    ];
    for (const graph of graphs) {
      const verdict = resolveAnalysisAdmission(graph);
      const fields = new Set(verdict.reasons.map((r) => r.field));
      expect(fields.has('permitted_analysis_mode')).toBe(true);
      expect(fields.has('semantic_quality_sufficient')).toBe(true);
      for (const reason of verdict.reasons) {
        expect(reason.message.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('a refused verdict never carries an empty reason set even when strict readiness was silent', () => {
    // The no-comparison cell: strict readiness has NOTHING to say, so the naive
    // `strict.nextStep` inheritance would ship a refusal with no reason at all.
    const graph = admissibleGraph();
    const nodes = graph.nodes as Record<string, unknown>[];
    (nodes.find((n) => n.id === 'opt_b') as Record<string, unknown>).interventions = {
      fac_price: { value: 12, source: 'brief_extraction' },
    };
    const admission = resolveRunAdmission(graph);
    expect(admission.strict.nextStep).toBeNull();
    const verdict = analysisAdmissionFrom(admission, graph);
    expect(verdict.reasons.filter((r) => r.field === 'structurally_analysable')).not.toEqual([]);
  });
});

// ============================================================================
// 5. COMPUTE ONCE — asserted structurally, not promised in a comment
// ============================================================================

describe('compute once, consume unchanged', () => {
  it('analysisAdmissionFrom consumes the caller’s admission and resolves nothing itself', () => {
    const graph = admissibleGraph();
    const real = resolveRunAdmission(graph);

    // A SENTINEL admission: `willProceed` deliberately contradicts what a fresh
    // resolve of this graph would say. If the module re-resolved internally, the
    // verdict would follow the graph rather than the caller — so this assertion
    // fails loud on any second derivation.
    const sentinel: RunAdmission = { ...real, willProceed: false, blockedNextStep: 'SENTINEL' };
    expect(real.willProceed).toBe(true); // precondition pinned in-test

    const verdict = analysisAdmissionFrom(sentinel, graph);
    expect(verdict.structurally_analysable).toBe(false);
    expect(
      verdict.reasons.some((r) => r.field === 'structurally_analysable' && r.message === 'SENTINEL'),
    ).toBe(true);
  });

  it('carries the caller’s graph_hash and never mints one', () => {
    expect(resolveAnalysisAdmission(admissibleGraph()).graph_hash).toBeNull();
    expect(resolveAnalysisAdmission(admissibleGraph(), 'abc123').graph_hash).toBe('abc123');
  });
});

// ============================================================================
// 6. missing_important_inputs — carried, not re-worded
// ============================================================================

describe('missing_important_inputs', () => {
  it('reports each blocker with the assessor’s own sentence and its obligation class', () => {
    // One option with no values at all: a real blocker population.
    const graph = admissibleGraph();
    const nodes = graph.nodes as Record<string, unknown>[];
    (nodes.find((n) => n.id === 'opt_b') as Record<string, unknown>).interventions = {};

    const admission = resolveRunAdmission(graph);
    const verdict = analysisAdmissionFrom(admission, graph);

    expect(verdict.missing_important_inputs.length).toBe(
      admission.assessment.blockingIssues.length,
    );
    for (const [index, entry] of verdict.missing_important_inputs.entries()) {
      const source = admission.assessment.blockingIssues[index];
      // Bound by IDENTITY (issue_id + code), not by a value another issue could satisfy.
      expect(entry.issue_id).toBe(source?.issue_id);
      expect(entry.code).toBe(source?.code);
      expect(entry.why_it_matters).toBe(source?.message);
      expect(entry.waived_by_exclusion).toBe(source?.waived_by_exclusion === true);
    }
  });

  it('carries waived_by_exclusion TRUE on the option the run is about to drop', () => {
    // ⭐ THE JOURNEY'S OWN ADMISSION CELL, reproduced: three options, one with no
    // values, so the run admits by EXCLUDING it. `status` is `needs_user_input`
    // and `may_run` is TRUE at the same moment — the exact state the post-draft
    // auto-run fires in.
    //
    // ⚠ This test exists because `waived_by_exclusion` would otherwise be a
    // FIELD THAT CANNOT FIRE: `resolveRunAdmission` replaces the assessment's
    // issue arrays with waiver-stamped copies only on its admitting branch, so a
    // suite whose every fixture refuses would read `false` forever and agree
    // with a mutant that hardcoded it.
    const graph = admissibleGraph();
    const nodes = graph.nodes as Record<string, unknown>[];
    nodes.push({ id: 'opt_c', kind: 'option', label: 'Do nothing yet', interventions: {} });
    (graph.edges as Record<string, unknown>[]).push(
      {
        from: 'dec_1',
        to: 'opt_c',
        strength: { mean: 1, std: 0.01 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'cee_hypothesis' },
      },
      {
        from: 'opt_c',
        to: 'fac_price',
        strength: { mean: 0.5, std: 0.1 },
        exists_probability: 1,
        effect_direction: 'positive',
        provenance: { source: 'brief_extraction' },
      },
    );

    const admission = resolveRunAdmission(graph);
    // Preconditions PINNED IN-TEST — without these the assertions below could
    // hold on a refusing graph, which is a different cell entirely.
    expect(admission.willProceed).toBe(true);
    expect(admission.waivedOptionIds).toContain('opt_c');

    const verdict = analysisAdmissionFrom(admission, graph);

    const waived = verdict.missing_important_inputs.filter((m) => m.waived_by_exclusion);
    expect(waived.length).toBeGreaterThan(0);
    // Bound by IDENTITY: the waiver must name the option the run is dropping.
    expect(waived.every((m) => m.option_id === 'opt_c')).toBe(true);

    // ⭐⭐ AND THE POINT OF THE WHOLE MODULE: the engine will run, and the
    // product still may NOT name a leader, because every baseline this
    // comparison's confidence rests on is Olumi's own estimate.
    expect(verdict.structurally_analysable).toBe(true);
    expect(verdict.permitted_analysis_mode).toBe('quantified_provisional');
    expect(
      verdict.reasons.some(
        (r) =>
          r.field === 'structurally_analysable' && r.code === 'RUN_WILL_EXCLUDE_OPTIONS',
      ),
    ).toBe(true);
  });

  it('an admissible model reports no missing inputs', () => {
    expect(resolveAnalysisAdmission(admissibleGraph()).missing_important_inputs).toEqual([]);
  });
});

// ============================================================================
// 7. Instrument checks
// ============================================================================

describe('instrument', () => {
  it('the confidence-bearing kind set excludes option and decision', () => {
    // The measured correction: including these makes the predicate vacuous.
    expect(CONFIDENCE_BEARING_NODE_KINDS).not.toContain('option');
    expect(CONFIDENCE_BEARING_NODE_KINDS).not.toContain('decision');
    expect(CONFIDENCE_BEARING_NODE_KINDS).toContain('factor');
  });

  it('is total — no graph shape throws', () => {
    const hostile: unknown[] = [
      undefined,
      null,
      0,
      [],
      { nodes: 'x', edges: 'y' },
      { nodes: [null, 1, 'a'], edges: [null] },
      { nodes: [{ id: 1, kind: 2 }], edges: [{ from: 1, to: 2 }] },
    ];
    for (const graph of hostile) {
      expect(() => resolveAnalysisAdmission(graph)).not.toThrow();
    }
  });

  it('modePermitsAtLeast compares rank, not string identity', () => {
    const ascending: PermittedAnalysisMode[] = [
      'none',
      'exploratory',
      'quantified_provisional',
      'comparative_leader',
    ];
    for (let i = 0; i < ascending.length; i += 1) {
      for (let j = 0; j < ascending.length; j += 1) {
        expect(modePermitsAtLeast(ascending[i]!, ascending[j]!)).toBe(i >= j);
      }
    }
  });
});
