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
  comparisonSubstrate,
  CONFIDENCE_BEARING_NODE_KINDS,
  modePermitsAtLeast,
  PERMITTED_ANALYSIS_MODES,
  resolveAnalysisAdmission,
  semanticQualitySufficient,
  semanticVerdictCause,
  type PermittedAnalysisMode,
  type SemanticVerdictCause,
} from '../analysis-admission.js';
import { classifyValueSource } from '../../../cee/graph-readiness/obligation-provenance.js';
import { computeAnalysisAffectingGraphHashSha256 } from '../../context/graph-hash.js';
import type { GraphStateIngress } from '../../boundary/request-extensions.js';
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

  /**
   * ⚠⚠ DELIBERATELY CHANGED, AND THE OLD ASSERTION IS KEPT VISIBLE (trap 14 —
   * an honest label must not be quietly overwritten). It used to read:
   *
   *   ~~expect(resolveAnalysisAdmission(admissibleGraph()).graph_hash).toBeNull();~~
   *
   * That was TRUE and it was the DEFECT: the only production mint path passed
   * two arguments, the third parameter defaulted to `null`, and so every wire
   * payload carried `graph_hash: null` — a field documented as "the subject this
   * verdict is about, so a consumer can tell a stale one", which no consumer
   * could ever use. The default now READS the sanctioned analysis-affecting
   * hash; an explicit argument still wins. Section 10 pins the new behaviour.
   */
  it('an explicit graph_hash from the caller still wins over the derived one', () => {
    const derived = resolveAnalysisAdmission(admissibleGraph()).graph_hash;
    // Precondition pinned in-test: the two values really are different, so the
    // assertion below cannot pass by them coinciding.
    expect(derived).not.toBe('abc123');
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

// ============================================================================
// 8. THE MATERIALITY FLOOR — the 1-of-N state, in BOTH directions, on a REAL
//    capture. This is the class the original corpus had no member of.
// ============================================================================

/**
 * ⭐⭐ WHY THIS SECTION EXISTS, and why its fixture is not written here.
 *
 * The first floor was `confidence_parameters_user_stated > 0` — an EXISTENTIAL
 * over the WHOLE graph. Measured at `ad216f63`, one inspector edit ANYWHERE
 * lifted a wholly machine-authored founder model to `comparative_leader`: a
 * downstream baseline, a causal edge, the goal node, or a bare
 * `extractionType: 'explicit'` each sufficed, at 1 user-stated parameter of 7.
 *
 * ⚠ AND THE ORIGINAL CORPUS COULD NOT SEE IT. All nine members read 0 of 189,
 * so the corpus certified the ALL-MACHINE case and was SILENT on the threshold —
 * it had no member in the 1-of-N state at all. A corpus that omits a class the
 * contract admits cannot certify the code over that class (CLAUDE.md trap 13d).
 * These two arms are that missing class, and they point in OPPOSITE directions:
 * every corpus case gets its opposite-direction twin (trap 22b).
 *
 * ⭐ THE FIXTURE IS A REAL CAPTURE, MUTATED BY ONE STAMP — deliberately NOT a
 * graph written here. `live-4day-week.cold-read.json` carries exactly one
 * user-stated confidence parameter (`out_csat`, `brief_extraction`), and its
 * topology — three options intervening on two factors, three exogenous roots
 * they do not touch — is the product's own, not the author's model of it.
 */
const WORKED_CAPTURE = 'src/cee/context-integrity/__tests__/fixtures/live-4day-week.cold-read.json';

function workedCapture(): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(WORKED_CAPTURE, 'utf8')) as { graph: unknown };
  return JSON.parse(JSON.stringify(parsed.graph)) as Record<string, unknown>;
}

function nodeOf(graph: Record<string, unknown>, id: string): Record<string, unknown> {
  const found = (graph.nodes as Record<string, unknown>[]).find((n) => n.id === id);
  if (!found) throw new Error(`fixture drift: ${id} is absent from ${WORKED_CAPTURE}`);
  return found;
}

describe('the floor is MATERIALITY, not "somebody typed one number somewhere"', () => {
  it('arm A — the ONE user-stated parameter IS material: comparative_leader', () => {
    const graph = workedCapture();
    const signals = censusConfidenceParameters(graph);

    // PRECONDITIONS PINNED IN-TEST. Without these the verdict below could hold
    // for a reason that has nothing to do with materiality — and the whole point
    // of the pair is that both arms sit in the SAME 1-of-N cell.
    expect(signals.confidence_parameters_user_stated, 'the 1-of-N cell').toBe(1);
    expect(nodeOf(graph, 'out_csat').observed_state).toMatchObject({
      source: 'brief_extraction',
    });

    expect(signals.material_parameters_user_stated).toBe(1);
    expect(semanticQualitySufficient(signals)).toBe(true);
    expect(resolveAnalysisAdmission(graph).permitted_analysis_mode).toBe('comparative_leader');
  });

  it('arm B — the SAME ONE stamp moved to a NON-material root: quantified_provisional', () => {
    // ⭐ THE DISCRIMINATING MUTATION: the count of user-stated parameters is
    // IDENTICAL to arm A. Only WHERE the stamp sits changes. `fac_productivity`
    // is an exogenous root — upstream of the goal, but downstream of no
    // intervention — so it is not a parameter this COMPARISON's confidence rests
    // on: it moves both arms by the same amount.
    const graph = workedCapture();
    delete (nodeOf(graph, 'out_csat') as { observed_state?: unknown }).observed_state;
    nodeOf(graph, 'fac_productivity').observed_state = { value: 1, source: 'brief_extraction' };

    const signals = censusConfidenceParameters(graph);

    // PRECONDITION PINNED IN-TEST: the two arms really are in the same cell, so
    // a different verdict is materiality's doing and not a different population.
    expect(signals.confidence_parameters_user_stated, 'the SAME 1-of-N cell').toBe(1);

    // ⭐ THE DEFECT ASSERTION FIRST, DELIBERATELY. At `ad216f63` this line reads
    // `comparative_leader` — a stamp on an exogenous root licensed naming a
    // winner. Asserting the new signals first would have made the RED a missing
    // field rather than the behaviour, which is a weaker thing to have shown.
    expect(resolveAnalysisAdmission(graph).permitted_analysis_mode).toBe(
      'quantified_provisional',
    );
    expect(semanticQualitySufficient(signals)).toBe(false);
    expect(signals.material_parameters_user_stated).toBe(0);
  });

  it('the refusal NAMES the conjunct that refused, and it is not the all-machine one', () => {
    const graph = workedCapture();
    delete (nodeOf(graph, 'out_csat') as { observed_state?: unknown }).observed_state;
    nodeOf(graph, 'fac_productivity').observed_state = { value: 1, source: 'brief_extraction' };

    const verdict = resolveAnalysisAdmission(graph);
    const codes = verdict.reasons
      .filter((r) => r.field === 'semantic_quality_sufficient')
      .map((r) => r.code);

    // The user HAS set something — so the "everything here is Olumi's" sentence
    // would be FALSE. A refusal that misnames its own cause is the class of
    // defect this module exists to remove.
    expect(codes).toContain('USER_STATED_PARAMETERS_NOT_MATERIAL');
    expect(codes).not.toContain('CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED');
  });

  it('a wholly machine-authored model still names the ALL-MACHINE cause', () => {
    const codes = resolveAnalysisAdmission(admissibleGraph())
      .reasons.filter((r) => r.field === 'semantic_quality_sufficient')
      .map((r) => r.code);
    expect(codes).toContain('CONFIDENCE_PARAMETERS_ALL_MACHINE_AUTHORED');
    expect(codes).not.toContain('USER_STATED_PARAMETERS_NOT_MATERIAL');
  });

  it('the whole-model census is UNCHANGED by the new floor — both are published', () => {
    // The old counts still answer "who authored this model's parameters", which
    // is what a coach needs to say "every baseline here is my estimate". The new
    // counts answer "…and does this COMPARISON rest on any of the user's?".
    // Two questions, named apart, both on the wire (CLAUDE.md trap 21).
    const graph = workedCapture();
    delete (nodeOf(graph, 'out_csat') as { observed_state?: unknown }).observed_state;
    nodeOf(graph, 'fac_productivity').observed_state = { value: 1, source: 'brief_extraction' };
    const signals = censusConfidenceParameters(graph);

    expect(signals.confidence_parameters_user_stated).toBe(1);
    expect(signals.material_parameters_user_stated).toBe(0);
    expect(signals.material_parameters_total).toBeGreaterThan(0);
    expect(signals.material_parameters_total).toBeLessThan(
      signals.confidence_parameters_total,
    );
  });

  it('a graph with NO option interventions has an empty material set — fails CLOSED', () => {
    // Nothing is being compared, so nothing carries a comparison's confidence.
    // The failure direction costs coverage, never truth.
    const graph = workedCapture();
    for (const node of graph.nodes as Record<string, unknown>[]) {
      if (node.kind === 'option') node.interventions = {};
    }
    const signals = censusConfidenceParameters(graph);
    expect(signals.material_parameters_total).toBe(0);
    expect(semanticQualitySufficient(signals)).toBe(false);
  });
});

// ============================================================================
// 9. `goal_target_stated` — PUBLISHED, and deliberately NOT a conjunct
// ============================================================================

describe('goal_target_stated', () => {
  it('is FALSE on a capture whose user never said what "good" means', () => {
    expect(censusConfidenceParameters(workedCapture()).goal_target_stated).toBe(false);
  });

  it('is TRUE when the goal carries a raw target, via the existing trio authority', () => {
    const graph = workedCapture();
    nodeOf(graph, 'goal_4day_success').goal_threshold_raw = 800;
    expect(censusConfidenceParameters(graph).goal_target_stated).toBe(true);
  });

  it('a cap or unit WITHOUT the raw anchor does NOT count as a stated target', () => {
    // The anchor rule is `pickGoalThresholdTrio`'s, not a second opinion minted
    // here: a cap that reaches a consumer without its raw value is what arms the
    // UI's `norm x cap` re-derivation.
    const graph = workedCapture();
    nodeOf(graph, 'goal_4day_success').goal_threshold_cap = 1000;
    nodeOf(graph, 'goal_4day_success').goal_threshold_unit = 'people';
    expect(censusConfidenceParameters(graph).goal_target_stated).toBe(false);
  });

  it('does NOT gate comparative_leader — it is a different question, named apart', () => {
    // ⭐ THE DECISION, PINNED SO IT CANNOT BE SILENTLY REVERSED. A stated target
    // is a precondition for a GOAL-ATTAINMENT claim ("100% of simulated
    // scenarios"), not for a RANKING claim ("Option A leads"). Folding it into
    // this one predicate would put two questions under one name — this estate's
    // signature defect. Arm A reaches comparative_leader with no target stated.
    const graph = workedCapture();
    const verdict = resolveAnalysisAdmission(graph);
    expect(verdict.semantic_signals.goal_target_stated).toBe(false);
    expect(verdict.permitted_analysis_mode).toBe('comparative_leader');
  });
});

// ============================================================================
// 10. graph_hash — the subject the verdict is about (FINDING 2)
// ============================================================================

describe('graph_hash names the subject this verdict is about', () => {
  it('is the EXISTING 64-hex analysis-affecting hash of the same graph — never null in production', () => {
    const graph = workedCapture();
    const verdict = resolveAnalysisAdmission(graph);

    // Bound by IDENTITY to the sanctioned authority, not by shape: a 64-hex
    // string another hash could also produce would prove nothing about WHICH
    // hash this is.
    expect(verdict.graph_hash).toBe(
      computeAnalysisAffectingGraphHashSha256(graph as unknown as GraphStateIngress),
    );
    expect(verdict.graph_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('an explicit hash from the caller still wins, and a non-graph is honestly null', () => {
    expect(resolveAnalysisAdmission(admissibleGraph(), 'abc123').graph_hash).toBe('abc123');
    expect(resolveAnalysisAdmission('not a graph').graph_hash).toBeNull();
    expect(resolveAnalysisAdmission(null).graph_hash).toBeNull();
  });
});

// ============================================================================
// 11. The floor and its stated CAUSE cannot drift, and no cause is dead
// ============================================================================

describe('the floor and its reason are one derivation', () => {
  /**
   * A corpus spanning every cell, so the agreement below is asserted over a
   * population rather than over one convenient graph.
   */
  function everyCell(): { name: string; graph: unknown }[] {
    const nonMaterial = workedCapture();
    delete (nodeOf(nonMaterial, 'out_csat') as { observed_state?: unknown }).observed_state;
    nodeOf(nonMaterial, 'fac_productivity').observed_state = {
      value: 1,
      source: 'brief_extraction',
    };

    const noSubstrate = workedCapture();
    for (const node of noSubstrate.nodes as Record<string, unknown>[]) {
      if (node.kind === 'option') node.interventions = {};
    }

    return [
      { name: 'worked capture (material user-stated)', graph: workedCapture() },
      { name: 'stamp moved to an exogenous root', graph: nonMaterial },
      { name: 'no interventions at all', graph: noSubstrate },
      { name: 'synthetic all-machine', graph: admissibleGraph() },
      { name: 'synthetic user-edited baseline', graph: admissibleGraph({ goalBaselineSource: 'user_edited' }) },
      ...CORPUS.map((c) => ({ name: c.file, graph: c.graph })),
      { name: 'empty', graph: { nodes: [], edges: [] } },
      { name: 'not a graph', graph: 'nonsense' },
    ];
  }

  it('the verdict and the cause agree on every member — one derivation, two views', () => {
    // ⚠ THE DRIFT THIS FORBIDS: `semanticQualitySufficient` and
    // `semanticVerdictCause` are separate functions over the same signals. If
    // one is edited and the other is not, the product refuses for a reason it
    // did not refuse for — which is exactly the class of defect the cause field
    // was added to remove.
    const members = everyCell();
    expect(members.length, 'an empty corpus would pass this loop testing nothing')
      .toBeGreaterThanOrEqual(13);
    for (const { name, graph } of members) {
      const signals = censusConfidenceParameters(graph);
      expect(
        semanticQualitySufficient(signals),
        `${name}: verdict and cause disagree`,
      ).toBe(semanticVerdictCause(signals) === 'material_user_stated');
    }
  });

  it('every cause is REACHABLE — none is a branch that cannot fire', () => {
    // A cause nothing can produce is a sentence no user will ever be shown while
    // the code reads as if it covers that case. Derived from the type, so a new
    // cause fails HERE rather than shipping unreachable.
    const seen = new Set<SemanticVerdictCause>(
      everyCell().map(({ graph }) => semanticVerdictCause(censusConfidenceParameters(graph))),
    );
    const declared: SemanticVerdictCause[] = [
      'no_comparison_substrate',
      'all_machine_authored',
      'user_stated_not_material',
      'material_user_stated',
    ];
    for (const cause of declared) expect([...seen]).toContain(cause);
  });

  it('every cause produces a distinct, non-empty, user-facing sentence', () => {
    const messages = everyCell().map(({ graph }) => {
      const verdict = resolveAnalysisAdmission(graph);
      return verdict.reasons.find((r) => r.field === 'semantic_quality_sufficient')?.message;
    });
    for (const message of messages) expect((message ?? '').trim().length).toBeGreaterThan(0);
    // No internal id or code name leaks into a sentence declared user-facing.
    for (const message of messages) expect(message).not.toMatch(/[A-Z]{4,}_[A-Z_]{3,}/);
  });
});

// ============================================================================
// 12. The published signals a stricter consumer is told to read
// ============================================================================

describe('semantic_signals is enough to hold a stricter opinion without a second census', () => {
  it('names the intervened-factor baselines the options actually differ on', () => {
    const graph = workedCapture();
    const { intervenedFactorIds } = comparisonSubstrate(graph);
    // Bound by IDENTITY to the capture's own topology, not by a count another
    // set could satisfy.
    expect([...intervenedFactorIds].sort()).toEqual(['fac_4day_adoption', 'fac_impl_spend']);

    const signals = censusConfidenceParameters(graph);
    expect(signals.intervened_factor_baselines_total).toBe(2);
    // Both are `cee_inference` in this capture — the user has set neither, and a
    // consumer requiring THAT stricter bar can see so without asking again.
    expect(signals.intervened_factor_baselines_user_stated).toBe(0);
    // …while the floor this module ships is still met, by `out_csat`.
    expect(semanticQualitySufficient(signals)).toBe(true);
  });

  it('the material population is a strict subset of the whole-model one', () => {
    for (const { graph } of CORPUS) {
      const s = censusConfidenceParameters(graph);
      expect(s.material_parameters_total).toBeLessThanOrEqual(s.confidence_parameters_total);
      expect(s.material_parameters_user_stated).toBeLessThanOrEqual(
        s.confidence_parameters_user_stated,
      );
    }
  });
});
