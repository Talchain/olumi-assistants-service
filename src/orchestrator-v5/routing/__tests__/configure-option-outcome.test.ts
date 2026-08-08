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
import { computeStructuralReadiness } from '../../../orchestrator/tools/analysis-ready-helper.js';
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

// ---------------------------------------------------------------------------
// 5. ⭐⭐ P1 (adversarial review of 572f7ea9) — THE SOLE-UNCONFIGURED FALLBACK
//    BINDS THE VERDICT TO AN OPTION THE USER NEVER NAMED.
// ---------------------------------------------------------------------------

/**
 * TRAP 21 RESIDUE, and the lesson is sharper than the bug.
 *
 * The 2.427 split correctly moved ONE conjunct out of the recovery predicate —
 * `carriesConfigureOptionValuePayload`. It did not ask what ELSE in the shared
 * resolver had been sound only because of the intercept's domain. The
 * `sole_unconfigured` fallback is the answer: under the intercept it is a good
 * heuristic (a value-less "Help me configure one of my options." genuinely means
 * the only blocked one). Under RECOVERY, value-bearing messages flow in, and
 * those messages routinely NAME a CONFIGURED option — at which point the
 * fallback silently retargets the verdict onto a different option entirely.
 *
 * The harm is the INVERSE of the one this row exists to fix, which is why it
 * matters so much: the guard takes a TRUE success confirmation and replaces it
 * wholesale with recovery copy about an option the user never mentioned, and
 * logs `applied_something: true` — counting its own mistake as a product defect
 * in the very meter that measures the defect.
 *
 * ⚠ Note it defeated the identity mutant pair. Those mutants vary WHICH option
 * the write-check reads; this defect is in which option the target RESOLVES to.
 * Both instruments agreed, and neither was pointed at the resolution step.
 */
describe('P1 — the verdict may only name an option the USER named', () => {
  /** CRM already configured; Basic Platform is now the SOLE unconfigured option. */
  function crmConfiguredBasicBlocked(complexity: number): GraphV3T {
    return captureGraph({
      cloudNativeInterventions: { fac_adoption_complexity: complexity },
      basicInterventions: {},
    });
  }

  const REVISION = 'Under the Cloud-Native CRM option, set its effect on Adoption Complexity to 0.9.';

  it('PAIR/1 — a revision that LANDS on the named option leaves the success untouched', () => {
    const before = crmConfiguredBasicBlocked(0.7);
    const after = crmConfiguredBasicBlocked(0.9);

    // Preconditions pinned in-test, so this case cannot decay into agreeing
    // with itself: the fallback must be REACHABLE (exactly one option at
    // `needs_encoding`, and it is NOT the one the user named). DERIVED from
    // `computeStructuralReadiness` — the same reader the resolver filters on —
    // rather than from a local guess about what "unconfigured" means.
    const blocked = computeStructuralReadiness(before)!
      .options.filter((o) => o.status === 'needs_encoding')
      .map((o) => o.option_id);
    expect(blocked).toEqual(['opt_basic']);
    expect(REVISION).toContain('Cloud-Native CRM');

    const verdict = evaluateConfigureOptionOutcome({ message: REVISION, before, after });

    // The user's edit SUCCEEDED. The guard must not manufacture a failure, and
    // above all must not manufacture one about `opt_basic`.
    expect(verdict.status).not.toBe('not_honoured');
    expect(JSON.stringify(verdict)).not.toContain('opt_basic');
    expect(JSON.stringify(verdict)).not.toContain('Basic Platform');
  });

  it('PAIR/2 — the motivating shape still gets recovery copy about the NAMED option', () => {
    // The named option IS the unconfigured one (the real capture state), the
    // write does not land, and nothing about the P1 fix may weaken this.
    const verdict = evaluateConfigureOptionOutcome({
      message: T12C,
      before: BEFORE,
      after: captureGraph({ cloudNativeComplexityStrength: 0.7 }),
    });
    expect(verdict).toMatchObject({
      status: 'not_honoured',
      optionId: 'opt_cloud_native',
      optionLabel: 'Cloud-Native CRM',
    });
  });

  it('a sole-unconfigured guess is never grounds for a verdict, even when nothing landed', () => {
    // The generic chip shape reaching recovery: one blocked option, none named.
    // A guess is not identity, so the guard has no claim to make.
    const before = captureGraph({ basicInterventions: {} });
    const verdict = evaluateConfigureOptionOutcome({
      message: 'Help me configure one of my options.',
      before,
      after: null,
    });
    expect(verdict.status).toBe('not_applicable');
  });
});

/**
 * The pre/post divergence pin, made non-vacuous.
 *
 * The first cut of this pin shipped with a SURVIVING mutant: deleting it left
 * all 79 tests green, so it was an assertion about a case nobody had shown was
 * reachable. An equivalent mutant must be DEMONSTRATED, never assumed — so here
 * is the discriminating fixture, and it is not exotic:
 *
 *   The message names TWO options. Before the edit, only the second is blocked,
 *   so the target resolves to it, by name. The edit then does something
 *   destructive to the FIRST one — clearing its interventions is well inside a
 *   wrong-entity write's repertoire — which makes that option blocked too, and
 *   it sorts earlier, so the post-edit re-resolution picks it instead.
 *
 * Without the pin the verdict would carry `opt_cloud_native`'s outcome under
 * `opt_basic`'s name and factors: the exact wrong-entity harm this module
 * exists to remove, reintroduced two lines from the end of it.
 */
describe('the post-edit re-resolution may not rename the option', () => {
  const NAMES_BOTH =
    'Under the Cloud-Native CRM option, set its effect on Adoption Complexity to 0.7 — not like Basic Platform.';

  it('declines when pre- and post-edit resolution disagree about which option this is', () => {
    const before = captureGraph(); // opt_basic ready, opt_cloud_native blocked
    const after = captureGraph({ basicInterventions: {} }); // the edit cleared opt_basic

    // Preconditions pinned in-test, so this cannot decay into a tautology.
    const blockedBefore = computeStructuralReadiness(before)!
      .options.filter((o) => o.status === 'needs_encoding').map((o) => o.option_id);
    const blockedAfter = computeStructuralReadiness(after)!
      .options.filter((o) => o.status === 'needs_encoding').map((o) => o.option_id);
    expect(blockedBefore).toEqual(['opt_cloud_native']);
    expect(blockedAfter).toEqual(['opt_basic', 'opt_cloud_native']);
    expect(NAMES_BOTH).toContain('Cloud-Native CRM');
    expect(NAMES_BOTH).toContain('Basic Platform');

    expect(evaluateConfigureOptionOutcome({ message: NAMES_BOTH, before, after })).toEqual({
      status: 'not_applicable',
      reason: 'recovery_target_diverged',
    });
  });
});
