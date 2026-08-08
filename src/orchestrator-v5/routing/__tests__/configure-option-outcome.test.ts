/**
 * ⭐⭐ ROADMAP 2.427 — configure-option OUTCOME↔INTENT binding.
 *
 * THE CORPUS IS REAL (trap 22). Every phrasing below is a message actually sent
 * to deployed CEE `98f2476` by the 8 Aug diagnosis lane, and every verdict is
 * the verdict that lane recorded, read back from its capture set
 * (`scratchpad/lane-2427-1786147916/MANIFEST.json`, 71 fresh-scenario
 * captures). None of it was invented here, because a corpus drawn from the
 * author's head cannot see the class the author did not imagine — and this
 * defect is precisely a class nobody imagined: the product wrote the WRONG
 * ENTITY and said so accurately.
 *
 * The graph fixture is likewise lifted from a real capture
 * (`P3r7_4_phrasing.json` → `draft_graph`): the same five option ids, the same
 * three factor ids, the same labels, and — the load-bearing detail — the same
 * shape of failure, in which `opt_cloud_native`'s edge to
 * `fac_adoption_complexity` carries `strength.mean 0.7` while the option's own
 * `interventions` stay empty and its readiness stays `needs_encoding`.
 *
 * ⚠ ONE FIXTURE IS CONSTRUCTED AND IS LABELLED AS SUCH: `wrongOptionWrite`,
 * where a DIFFERENT option gains an intervention while the named option gains
 * none. No capture in the set shows that exact shape. It is inside the
 * producer's output domain — an interventions write on some option is the
 * ordinary success operation, and P3r7 proves the edit lane does pick the wrong
 * entity — but it is a perturbation of a real capture, not a capture, and it
 * exists to carry one half of the identity mutant pair.
 */

import { describe, it, expect } from 'vitest';

import { evaluateConfigureOptionOutcome } from '../configure-option-outcome.js';
import { buildConfigureOptionAdvisedFormat } from '../../configure-option-chip-text.js';
import type { GraphV3T } from '../../../schemas/cee-v3.js';

// ---------------------------------------------------------------------------
// The graph, from `P3r7_4_phrasing.json`.
// ---------------------------------------------------------------------------

const FACTORS = [
  { id: 'fac_platform_cost', label: 'Platform Licence Cost' },
  { id: 'fac_feature_richness', label: 'Feature Richness' },
  { id: 'fac_adoption_complexity', label: 'Adoption Complexity' },
] as const;

/** The real capture's intervention shape: `{ value }` objects, not bare numbers. */
function interventionBundle(values: Readonly<Record<string, number>>) {
  const out: Record<string, unknown> = {};
  for (const [factorId, value] of Object.entries(values)) {
    out[factorId] = {
      value,
      source: 'brief_extraction',
      target_match: { node_id: factorId, confidence: 'high', match_type: 'exact_id' },
    };
  }
  return out;
}

function edge(from: string, to: string, mean: number) {
  return {
    from,
    to,
    strength: { mean, std: 0.01 },
    exists_probability: 0.95,
    effect_direction: (mean >= 0 ? 'positive' : 'negative') as 'positive' | 'negative',
  };
}

interface GraphOptions {
  /** Interventions on `opt_cloud_native` — empty in the captured failure. */
  readonly cloudNativeInterventions?: Readonly<Record<string, number>>;
  /** Interventions on `opt_basic` — unchanged across the captured failure. */
  readonly basicInterventions?: Readonly<Record<string, number>>;
  /**
   * `opt_cloud_native → fac_adoption_complexity` strength. 1.0 pre-edit; the
   * captured wrong-entity write moved it to 0.7 and changed nothing else.
   */
  readonly cloudNativeComplexityStrength?: number;
}

function captureGraph(opts: GraphOptions = {}): GraphV3T {
  const {
    cloudNativeInterventions,
    basicInterventions = {
      fac_platform_cost: 0.3,
      fac_feature_richness: 0.3,
      fac_adoption_complexity: 0.25,
    },
    cloudNativeComplexityStrength = 1,
  } = opts;

  return {
    nodes: [
      { id: 'goal_crm_roi', kind: 'goal', label: 'CRM Programme ROI' },
      ...FACTORS.map((f) => ({ id: f.id, kind: 'factor' as const, label: f.label })),
      {
        id: 'opt_basic',
        kind: 'option' as const,
        label: 'Basic Platform',
        interventions: interventionBundle(basicInterventions),
      },
      {
        id: 'opt_cloud_native',
        kind: 'option' as const,
        label: 'Cloud-Native CRM',
        ...(cloudNativeInterventions
          ? { interventions: interventionBundle(cloudNativeInterventions) }
          : {}),
      },
    ],
    edges: [
      ...FACTORS.map((f) => edge('opt_basic', f.id, 1)),
      edge('opt_cloud_native', 'fac_platform_cost', 1),
      edge('opt_cloud_native', 'fac_feature_richness', 1),
      edge('opt_cloud_native', 'fac_adoption_complexity', cloudNativeComplexityStrength),
      ...FACTORS.map((f) => edge(f.id, 'goal_crm_roi', 0.5)),
    ],
  } as GraphV3T;
}

/** Pre-edit state for every case below: the option is linked but unset. */
const BEFORE = captureGraph();

// ---------------------------------------------------------------------------
// The corpus — live phrasings, live verdicts (MANIFEST.json).
// ---------------------------------------------------------------------------

/** T12c — the intermittent phrasing this row exists for. 5/7 recorded. */
const T12C = 'Under the Cloud-Native CRM option, set its effect on Adoption Complexity to 0.7.';

interface CorpusRow {
  readonly tag: string;
  readonly phrasing: string;
  readonly note: string;
}

/**
 * Configure phrasings the deployed product RECORDED. On these, an interventions
 * write lands for the named option and the guard must stay silent — a guard
 * that fired here would replace a working confirmation with a question.
 */
const RECORDED_CORPUS: readonly CorpusRow[] = [
  {
    tag: 'P2',
    phrasing:
      'Configure the Cloud-Native CRM option: set User Adoption Complexity to 0.7, set CRM Feature Richness to 0.55.',
    note: 'configure vocab + compound value payload',
  },
  { tag: 'P3r1', phrasing: T12C, note: 'T12c, the run that recorded' },
  {
    tag: 'P4',
    phrasing:
      'Set Adoption Complexity to 0.7 and Platform Feature Richness to 0.55 for the Cloud-Native CRM option.',
    note: "the assistant's suggested format (trailing option reference)",
  },
  {
    tag: 'P5',
    phrasing: "Set the Cloud-Native CRM option's effect on Adoption Complexity to 0.7",
    note: 'the advised format — buildConfigureOptionAdvisedFormat verbatim',
  },
  {
    tag: 'P6',
    phrasing: 'For the Cloud-Native CRM option, set its effect on Adoption Complexity to 0.7.',
    note: 'leading option reference',
  },
];

/**
 * Messages the deployed product did NOT record, and which are NOT this guard's
 * business. Discrimination controls: the diagnosis lane ran them precisely to
 * show the two failure captures were not simply "any unrecorded turn".
 */
const CONTROL_CORPUS: readonly CorpusRow[] = [
  {
    tag: 'P7',
    phrasing: 'Set Adoption Complexity to 0.7.',
    note: 'a FACTOR edit — names no option, so no option-scoped promise was made',
  },
  {
    tag: 'P8',
    phrasing: 'Make Cloud-Native CRM better on Adoption Complexity.',
    note: 'a vague ask — no assignment payload; the product already clarifies well here',
  },
];

// ---------------------------------------------------------------------------
// 1. The captured failures — the guard must fire on BOTH branches.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.427 — the two captured failure branches', () => {
  it('branch (b) P3r7: an EDGE-STRENGTH write is not an interventions write for the option', () => {
    // The exact captured outcome: strength 1.0 → 0.7 on
    // opt_cloud_native → fac_adoption_complexity, interventions still empty.
    const after = captureGraph({ cloudNativeComplexityStrength: 0.7 });

    const verdict = evaluateConfigureOptionOutcome({
      message: T12C,
      before: BEFORE,
      after,
    });

    expect(verdict.status).toBe('not_honoured');
    // Identity: the verdict is ABOUT the option the user named.
    expect(verdict).toMatchObject({
      status: 'not_honoured',
      optionId: 'opt_cloud_native',
      optionLabel: 'Cloud-Native CRM',
    });
    // And it names real, still-unset, linked factors — never invented ones.
    if (verdict.status === 'not_honoured') {
      expect(verdict.factorLabels).toContain('Adoption Complexity');
      for (const label of verdict.factorLabels) {
        expect(FACTORS.map((f) => f.label)).toContain(label);
      }
    }
  });

  it('branch (a) P3: nothing landed at all (OPERATION_DID_NOT_LAND)', () => {
    const verdict = evaluateConfigureOptionOutcome({
      message: T12C,
      before: BEFORE,
      after: null,
    });

    expect(verdict).toMatchObject({
      status: 'not_honoured',
      optionId: 'opt_cloud_native',
    });
  });

  it('the guard is blind to WHICH wrong thing landed — an unrelated factor edit also fails', () => {
    // Same intent, a different wrong entity: the edit relabels a factor.
    const after = captureGraph();
    const relabelled = {
      ...after,
      nodes: after.nodes.map((n) =>
        n.id === 'fac_adoption_complexity' ? { ...n, label: 'Adoption Complexity (revised)' } : n,
      ),
    } as GraphV3T;

    expect(
      evaluateConfigureOptionOutcome({ message: T12C, before: BEFORE, after: relabelled }).status,
    ).toBe('not_honoured');
  });
});

// ---------------------------------------------------------------------------
// 2. The RECORDED corpus — the guard must stay silent.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.427 — recorded configure phrasings stay untouched', () => {
  for (const row of RECORDED_CORPUS) {
    it(`${row.tag} (${row.note}): honoured when the intervention lands`, () => {
      const after = captureGraph({
        cloudNativeInterventions: { fac_adoption_complexity: 0.7 },
      });

      expect(
        evaluateConfigureOptionOutcome({ message: row.phrasing, before: BEFORE, after }),
      ).toEqual({ status: 'honoured', optionId: 'opt_cloud_native' });
    });
  }

  it('the advised format is derived from the shipped builder, not transcribed', () => {
    // Pins P5 to the producer: if `buildConfigureOptionAdvisedFormat` changes,
    // this corpus row is wrong and says so, rather than silently testing a
    // phrasing the product no longer advises (trap 12b — a control pinned to a
    // literal decays the moment the literal moves).
    const advised = buildConfigureOptionAdvisedFormat(
      'Cloud-Native CRM',
      'Adoption Complexity',
      '0.7',
    );
    expect(RECORDED_CORPUS.find((r) => r.tag === 'P5')!.phrasing).toBe(advised);
  });

  /**
   * ⚠ THE GUARD'S DOMAIN, PINNED — and this is a DELIBERATE BOUND, not an
   * oversight. Stated as a test because a scope this consequential must fail
   * loudly if someone widens the predicate without widening the copy.
   *
   * The guard fires only for an option that was `needs_encoding` BEFORE the
   * edit, because that is the domain in which the recovery copy is TRUE. The
   * composer says *"X has no effect values yet, so the analysis cannot compare
   * it with the others"* — a sentence that is false of an option already
   * carrying one value and being given a second.
   *
   * So a wrong-entity write against a PARTIALLY-configured option is NOT
   * covered here. That is a real residual, reported and rowed rather than
   * silently absorbed: widening the predicate without a second copy variant
   * would trade a false success for a false NOTICE, which is the same harm
   * wearing the opposite sign (review doctrine — a notice's truth condition is
   * a claim about the WHOLE domain of the predicate that raises it).
   */
  it('DOMAIN BOUND: a partially-configured option is out of scope (copy would be untrue)', () => {
    const before = captureGraph({ cloudNativeInterventions: { fac_platform_cost: 0.2 } });
    const after = captureGraph({
      cloudNativeInterventions: { fac_platform_cost: 0.2 },
      cloudNativeComplexityStrength: 0.7,
    });

    // The wrong-entity write happened — and the guard deliberately says nothing,
    // because it has no true sentence available for this state.
    expect(evaluateConfigureOptionOutcome({ message: T12C, before, after })).toEqual({
      status: 'not_applicable',
      reason: 'option_not_identified',
    });
  });
});

// ---------------------------------------------------------------------------
// 3. Discrimination controls — not this guard's business.
// ---------------------------------------------------------------------------

describe('ROADMAP 2.427 — discrimination controls (live, NOT-RECORDED, still not_applicable)', () => {
  for (const row of CONTROL_CORPUS) {
    it(`${row.tag} (${row.note}): not_applicable`, () => {
      const verdict = evaluateConfigureOptionOutcome({
        message: row.phrasing,
        before: BEFORE,
        after: null,
      });
      expect(verdict).toEqual({
        status: 'not_applicable',
        reason: 'not_configure_intent',
      });
    });
  }

  it('declines rather than guesses when two options are blocked and none is named', () => {
    // "Help me configure one of my options." — the generic chip. With two
    // unconfigured options the target is genuinely ambiguous, and a guard that
    // picked one would be the confident-wrong-answer this lane exists to
    // remove.
    const before = captureGraph({ basicInterventions: {} });
    expect(
      evaluateConfigureOptionOutcome({
        message: 'Help me configure one of my options.',
        before,
        after: null,
      }),
    ).toEqual({ status: 'not_applicable', reason: 'option_not_identified' });
  });

  it('an unparseable pre-edit graph produces no verdict', () => {
    expect(
      evaluateConfigureOptionOutcome({ message: T12C, before: { nodes: 'nope' }, after: null }),
    ).toEqual({ status: 'not_applicable', reason: 'pre_graph_unparseable' });
  });
});

// ---------------------------------------------------------------------------
// 4. ⭐ IDENTITY BINDING — the discriminating mutant pair (trap 19).
// ---------------------------------------------------------------------------

describe('ROADMAP 2.427 — the outcome is bound to the option by IDENTITY', () => {
  /**
   * MUTANT PAIR TARGET — RED half.
   *
   * A write lands, and it lands on the WRONG OPTION. `opt_basic` gains a
   * factor it did not have; `opt_cloud_native` — the option the user named —
   * gains nothing.
   *
   * Loosening `interventionsWriteLandedFor` to "ANY option gained a write"
   * turns this test RED, because the guard would then read the unrelated
   * write as satisfaction of a promise it does not satisfy. A single biting
   * mutant proves sensitivity to *something*; this half proves sensitivity to
   * *the named object*.
   *
   * ⚠ CONSTRUCTED FIXTURE — see the file header. No capture shows this exact
   * shape; it is a perturbation of P3r7 inside the producer's output domain.
   */
  it('MUTANT-PAIR/RED: a write on a DIFFERENT option does not honour this option', () => {
    const after = captureGraph({
      basicInterventions: {
        fac_platform_cost: 0.3,
        fac_feature_richness: 0.3,
        fac_adoption_complexity: 0.25,
        // The wrong-entity write: a NEW key, on the wrong option.
        fac_newly_written: 0.7,
      },
    });

    const verdict = evaluateConfigureOptionOutcome({ message: T12C, before: BEFORE, after });

    expect(verdict.status).toBe('not_honoured');
    expect(verdict).toMatchObject({ optionId: 'opt_cloud_native' });
  });

  /**
   * MUTANT PAIR TARGET — GREEN half.
   *
   * The captured P3r7 shape: NOTHING landed on any option. Loosening the check
   * for one unrelated option (`opt_basic`) must leave this verdict unchanged —
   * that is what proves the RED half above is discriminating on IDENTITY and
   * not merely on "the check got weaker".
   *
   * PRECONDITION PINNED IN-TEST (trap 13b, third face): this case is only
   * discriminating while no option gains anything. Assert that here, so the
   * test cannot quietly decay into agreeing with itself if the fixture drifts.
   */
  it('MUTANT-PAIR/GREEN: with no write anywhere, loosening for another option changes nothing', () => {
    const after = captureGraph({ cloudNativeComplexityStrength: 0.7 });

    // The precondition this case's discriminating power depends on.
    const optionIds = ['opt_basic', 'opt_cloud_native'] as const;
    for (const id of optionIds) {
      const pre = BEFORE.nodes.find((n) => n.id === id) as Record<string, unknown>;
      const post = after.nodes.find((n) => n.id === id) as Record<string, unknown>;
      expect(
        JSON.stringify(post.interventions ?? null),
        `fixture precondition broken: ${id} changed its interventions`,
      ).toBe(JSON.stringify(pre.interventions ?? null));
    }

    expect(
      evaluateConfigureOptionOutcome({ message: T12C, before: BEFORE, after }).status,
    ).toBe('not_honoured');
  });
});
