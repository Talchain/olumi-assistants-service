/**
 * THE REFUSAL CARRIER'S DISCRIMINATOR IS THE ADMISSION VERDICT, NOT STRUCTURAL STATUS.
 *
 * WHAT WAS SHIPPED, AND WHY IT CANNOT WORK (measured at staging tip c24bfe37,
 * production code untouched, three graph classes in one run):
 *
 *   class                                            | status            | may_run | shipped guard
 *   -------------------------------------------------|-------------------|---------|---------------
 *   A mid-session, ONE un-encoded option (#942's own  | needs_user_input  | TRUE    | carries identity
 *     ADDED_OPTION_GRAPH — the reviewers' case)       |                   |         |
 *   B complete model, every option valued            | ready             | true    | bare carrier
 *   C fresh draft, NO option valued (THE DEFECT)     | needs_user_input  | FALSE   | carries identity
 *
 * `buildAnalysisRefusalReadiness`'s doc block claimed the `status === 'ready'`
 * term separates the case it must protect (A) from the case it must fix (C).
 * BOTH ARE `needs_user_input`. The `ready` term fires on NEITHER, so it gives A
 * and C the SAME answer — and the only reason that has never been visible is
 * that the chip arm never passed the second argument, leaving the guard exactly
 * one live caller. Two live tests assert opposite answers to the same question
 * and are both green: `chip-click-dispatch-blocked-readiness` RED-3 (A → bare)
 * and `analysis-refusal-preserves-model-identity` (a not-ready projection →
 * carries). The pin RED-3 rests on (6e221054, 14 Aug, #942) PREDATES the
 * two-argument helper by four days.
 *
 * ⭐ THIS IS NOT A NEW RULE — IT IS THE ONE THIS MODULE ALREADY DOCUMENTS.
 * `buildCanonicalAnalysisReadyFromGraph`'s own doc block, ~300 lines above the
 * guard, records an INDEPENDENT EARLIER measurement of the same fact on the
 * `live-4day-week` capture: *"one unconfigured option gives `status:
 * needs_user_input, willProceed: TRUE`, while two and three give
 * `needs_user_input, willProceed: false` — one status, both verdicts, which is
 * exactly why NO READING OF `status` CAN RECOVER THE ANSWER."* The guard
 * contradicted a doctrine block in its own file.
 *
 * THE QUESTION THE GUARD ANSWERS is *"is this refusal ABOUT the model?"*:
 *   · may_run TRUE  → the analysis could have proceeded; the refusal came from
 *                     somewhere else, so the model's identity is not the answer
 *                     and the empty carrier is right. This is what #942 pinned.
 *   · may_run FALSE → the refusal IS about model readiness, and the identity is
 *                     exactly what the user needs in order to fix it.
 *
 * ⚠ ABSENCE FAILS TOWARD CARRYING. `may_run` is optional and two turn-executor
 * sites assign readiness without the stamp, so polarity must be chosen, not
 * assumed. Absence carries, because (i) the degeneracy guard below already
 * refuses a degenerate payload — it is verbatim the UI's accept predicate at
 * `applyV5State.ts:233-235` — so carrying can never ship something the consumer
 * discards; and (ii) naming the user's model on a refusal that did not need it
 * is TRUE and mildly redundant, whereas withholding it on one that did IS the
 * defect. The asymmetry of harm decides it. It is also the polarity the rest of
 * the estate already mandates for this field: *"absence means an older producer,
 * never 'no'"* (`schemas/analysis-ready.ts:279`, `orchestrator/types.ts:661`),
 * and *"absence is never synthesised into `false`"* (`analysis-ready-helper.ts`).
 *
 * ⚠ THE `status === 'ready'` TERM IS KEPT, AND THAT IS A MEASUREMENT, NOT A
 * HEDGE. An 18-case sweep at this tip found the (`status: 'ready'` AND
 * `may_run === false`) cell EMPTY, so the two terms cannot disagree on anything
 * reachable; keeping `ready` therefore preserves #1023's opposite-direction pin
 * (a `ready` projection with no `may_run` still gets the empty carrier) without
 * adjusting a single existing test. What is withdrawn is the CLAIM that `ready`
 * is the discriminator — it is a second sufficient reason, never the separator.
 */
import { describe, it, expect } from 'vitest';

import { resolveRunAdmission } from '../../../orchestrator-v5/tools/handlers/analysis-ready-core.js';
import {
  buildAnalysisRefusalReadiness,
  buildCanonicalAnalysisReadyFromGraph,
  ANALYSIS_READY_BLOCKED_STATUS,
} from '../analysis-ready-helper.js';
import type { AnalysisReadyPayload } from '../analysis-ready-helper.js';

// ---------------------------------------------------------------------------
// FIXTURES DERIVED FROM REAL GRAPHS THROUGH THE REAL PRODUCER.
//
// ⚠ CLAUDE.md trap 16 — *a fixture you wrote yourself is not evidence about the
// wire*. A hand-built payload silently encodes this lane's model of the
// producer rather than the producer, and that is precisely how the routed-arm
// suites came to have ZERO `may_run` in any fixture while production carries it
// on every canonical projection. Every payload below is what
// `buildCanonicalAnalysisReadyFromGraph` ACTUALLY emits for that graph, and
// each test asserts the verdict it depends on before depending on it.
// ---------------------------------------------------------------------------

const DECISION = { id: 'dec_crm', kind: 'decision', label: 'CRM decision' };
const GOAL = { id: 'goal_revenue', kind: 'goal', label: 'Revenue', goal_threshold: 0.8 };
const FACTOR = { id: 'fac_licence', kind: 'factor', label: 'Annual CRM Licence Cost' };

const edge = (from: string, to: string, mean: number, exists = 0.9) => ({
  from,
  to,
  strength: { mean, std: 0.1 },
  exists_probability: exists,
  effect_direction: 'positive',
});

const option = (id: string, label: string, value?: number) => ({
  id,
  kind: 'option',
  label,
  ...(value === undefined ? {} : { interventions: { fac_licence: value } }),
});

const EDGES = [
  edge('dec_crm', 'opt_hubspot', 1, 1),
  edge('dec_crm', 'opt_stay', 1, 1),
  edge('dec_crm', 'opt_migrate', 1, 1),
  edge('opt_hubspot', 'fac_licence', 0.6),
  edge('opt_stay', 'fac_licence', 0.3),
  edge('opt_migrate', 'fac_licence', 0.5),
  edge('fac_licence', 'goal_revenue', 0.6, 1),
];

const graphWith = (values: readonly (number | undefined)[]): unknown => ({
  nodes: [
    DECISION,
    GOAL,
    FACTOR,
    option('opt_hubspot', 'Move to HubSpot', values[0]),
    option('opt_stay', 'Stay as we are', values[1]),
    option('opt_migrate', 'Migrate to Salesforce', values[2]),
  ],
  edges: EDGES,
});

/** CLASS A — mid-session, ONE un-encoded option. #942's ADDED_OPTION_GRAPH semantics. */
const GRAPH_A_ONE_UNENCODED = graphWith([0.7, 0.3, undefined]);
/** CLASS B — complete model, EVERY option valued. */
const GRAPH_B_COMPLETE = graphWith([0.7, 0.3, 0.5]);
/** CLASS C — fresh draft, NO option valued. THE DEFECT. */
const GRAPH_C_FRESH_DRAFT = graphWith([undefined, undefined, undefined]);

function canonicalFor(graph: unknown): AnalysisReadyPayload {
  const payload = buildCanonicalAnalysisReadyFromGraph(graph);
  if (!payload) throw new Error('fixture graph produced no canonical readiness payload');
  return payload;
}

const CANONICAL_A = canonicalFor(GRAPH_A_ONE_UNENCODED);
const CANONICAL_B = canonicalFor(GRAPH_B_COMPLETE);
const CANONICAL_C = canonicalFor(GRAPH_C_FRESH_DRAFT);

const carriesIdentity = (out: AnalysisReadyPayload): boolean =>
  out.goal_node_id !== '' && Array.isArray(out.options) && out.options.length > 0;

describe('analyse refusal — the discriminator is the ADMISSION VERDICT', () => {
  it('THE TABLE: the three classes reproduce, and A and C share a status while differing on may_run', () => {
    // The premise the whole ruling rests on. If this ever stops holding, the
    // remedy below is answering a question that no longer exists.
    expect(CANONICAL_A.status).toBe('needs_user_input');
    expect(CANONICAL_A.may_run).toBe(true);

    expect(CANONICAL_B.status).toBe('ready');
    expect(CANONICAL_B.may_run).toBe(true);

    expect(CANONICAL_C.status).toBe('needs_user_input');
    expect(CANONICAL_C.may_run).toBe(false);

    // ⭐ THE LOAD-BEARING CLAUSE: the case to PROTECT and the case to FIX carry
    // the SAME status, so no reading of `status` can separate them.
    expect(CANONICAL_C.status).toBe(CANONICAL_A.status);
    expect(CANONICAL_C.may_run).not.toBe(CANONICAL_A.may_run);

    // The published field is the run path's own answer, read not re-derived.
    expect(CANONICAL_A.may_run).toBe(resolveRunAdmission(GRAPH_A_ONE_UNENCODED).willProceed);
    expect(CANONICAL_C.may_run).toBe(resolveRunAdmission(GRAPH_C_FRESH_DRAFT).willProceed);

    // Both classes really do hold an identity worth preserving, so a bare
    // carrier below is a decision and not an artefact of an empty fixture
    // (CLAUDE.md trap 13b — pin the precondition in-test).
    for (const p of [CANONICAL_A, CANONICAL_C]) {
      expect(p.goal_node_id).toBe('goal_revenue');
      expect(p.options.length).toBe(3);
    }
  });

  it('may_run TRUE → the EMPTY carrier: the run could have proceeded, so the refusal is not about the model', () => {
    // #942/RED-3's case, at the shared guard rather than through one arm. The
    // reviewers measured that carrying real options here flips the deployed
    // `DecisionOverviewCard` from `unassessed` to `needs_input` and auto-expands
    // "Olumi needs a little more from you" over a gap that does not exist.
    const out = buildAnalysisRefusalReadiness('mixed_scale_unresolved', CANONICAL_A);
    expect(out.goal_node_id).toBe('');
    expect(out.options).toEqual([]);
    expect(out.status).toBe(ANALYSIS_READY_BLOCKED_STATUS);
    expect(out.blocked_reason).toBe('mixed_scale_unresolved');
  });

  it('may_run FALSE → the identity is PRESERVED: the refusal IS about model readiness', () => {
    // THE DEFECT. A signed-in user clicks "Run analysis" on a freshly drafted
    // model and gets a blocked verdict naming no model and no blockers, so
    // nothing downstream can say what to fix.
    const out = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', CANONICAL_C);
    // Bound by IDENTITY, never by a count (CLAUDE.md trap 19): `length === 3`
    // is satisfied by any three objects, and "a different set of three options"
    // is the exact fabrication class the continuity check exists to catch.
    expect(out.goal_node_id).toBe('goal_revenue');
    expect(
      out.options.map((o) => (o as { option_id?: string; id?: string }).option_id
        ?? (o as { id?: string }).id),
    ).toEqual(['opt_hubspot', 'opt_stay', 'opt_migrate']);
    // The verdict is still WITHDRAWN — preserving identity must not buy a pass.
    expect(out.status).toBe(ANALYSIS_READY_BLOCKED_STATUS);
    expect(out.blocked_reason).toBe('MISSING_OPTION_VALUE');
  });

  it('may_run ABSENT → CARRIES (the ruled fail-toward-carry polarity), and it is a CHOICE, not a default', () => {
    // Two turn-executor sites assign readiness without the canonical stamp
    // (`current.assessment?.analysisReady` and `readback.analysisReady`), so a
    // present-but-unstamped payload is constructible and the polarity must be
    // pinned rather than inherited. Absence carries: withholding the identity
    // on a refusal that needed it is the defect; naming it on one that did not
    // is merely redundant.
    const absent = { ...CANONICAL_C } as Record<string, unknown>;
    delete absent.may_run;
    expect('may_run' in absent).toBe(false);

    const out = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', absent as AnalysisReadyPayload);
    expect(out.goal_node_id).toBe('goal_revenue');
    expect(out.options.length).toBe(3);
    expect(out.status).toBe(ANALYSIS_READY_BLOCKED_STATUS);
  });

  it('⭐ DISCRIMINATION: three payloads identical but for `may_run` get the three ruled answers', () => {
    // The whole test file in one assertion, and the reason it can be trusted.
    // A prior measurement of this remedy reported the routed suites 62/62 GREEN
    // — a guard agreeing with itself, because EVERY routed-arm fixture has zero
    // occurrences of `may_run`, so `may_run === true` was trivially false and
    // the term could not fire. Green proved only that payloads WITHOUT the
    // field are unperturbed.
    //
    // Here the three inputs are byte-identical once `may_run` is removed, so a
    // difference in the OUTPUT is provably that field's doing and cannot be an
    // artefact of three different fixtures.
    const base = { ...CANONICAL_C } as Record<string, unknown>;
    delete base.may_run;

    const withTrue = { ...base, may_run: true } as unknown as AnalysisReadyPayload;
    const withFalse = { ...base, may_run: false } as unknown as AnalysisReadyPayload;
    const withAbsent = { ...base } as unknown as AnalysisReadyPayload;

    // PRECONDITION PINNED IN-TEST: they differ in exactly one key.
    const strip = (p: unknown) => {
      const c = { ...(p as Record<string, unknown>) };
      delete c.may_run;
      return JSON.stringify(c);
    };
    expect(strip(withTrue)).toBe(strip(withFalse));
    expect(strip(withTrue)).toBe(strip(withAbsent));
    // ...and that one key really does take three distinct values.
    expect([withTrue.may_run, withFalse.may_run, withAbsent.may_run])
      .toEqual([true, false, undefined]);

    expect(carriesIdentity(buildAnalysisRefusalReadiness('r', withTrue))).toBe(false);
    expect(carriesIdentity(buildAnalysisRefusalReadiness('r', withFalse))).toBe(true);
    expect(carriesIdentity(buildAnalysisRefusalReadiness('r', withAbsent))).toBe(true);
  });

  it('OPPOSITE-DIRECTION TWIN: a complete model (`ready`, may_run true) still gets the EMPTY carrier', () => {
    // Class B. Both sufficient reasons agree here, which is why this case never
    // exposed the defect.
    const out = buildAnalysisRefusalReadiness('scale_postcondition_violated', CANONICAL_B);
    expect(out.goal_node_id).toBe('');
    expect(out.options).toEqual([]);
  });

  it('the `ready` term is a SECOND sufficient reason, never the separator — and the disagreeing cell is empty', () => {
    // Kept deliberately: an 18-case sweep at this tip found no graph producing
    // `status: 'ready'` with `may_run === false`, so the two terms cannot
    // disagree on anything reachable, and keeping `ready` preserves #1023's
    // pin for a `ready` projection that carries no `may_run` at all.
    const readyNoVerdict = { ...CANONICAL_B } as Record<string, unknown>;
    delete readyNoVerdict.may_run;
    expect(readyNoVerdict.status).toBe('ready');
    expect('may_run' in readyNoVerdict).toBe(false);
    expect(
      carriesIdentity(
        buildAnalysisRefusalReadiness('scale_postcondition_violated', readyNoVerdict as AnalysisReadyPayload),
      ),
    ).toBe(false);
  });

  it('carries IDENTITY ONLY — no blockers, no findings, no science the refusal declined to produce', () => {
    const noisy = {
      ...CANONICAL_C,
      blockers: [{ kind: 'missing_value' }],
      bias_findings: [{ id: 'DSK-B-003' }],
      readiness_issues: [{ code: 'MISSING_OPTION_VALUE' }],
      repair_proposal: { proposal_version: 'readiness_repair_v1' },
    } as unknown as AnalysisReadyPayload;
    const out = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', noisy);
    expect(Object.keys(out).sort()).toEqual(
      ['blocked_reason', 'goal_node_id', 'options', 'status'].sort(),
    );
  });

  it('NO ANALYSIS NEWLY ADMITS: the admission verdict is untouched by the carrier', () => {
    // The guard is a WIRE-SHAPE decision taken AFTER a refusal has already
    // happened. It must not be able to move the gate. Asserted over every
    // refusal state these fixtures can construct: the verdict is read before
    // and after building the carrier and must be byte-identical, and the
    // carrier must report `blocked` in every case.
    for (const [name, graph] of [
      ['A one un-encoded', GRAPH_A_ONE_UNENCODED],
      ['B complete', GRAPH_B_COMPLETE],
      ['C fresh draft', GRAPH_C_FRESH_DRAFT],
    ] as const) {
      const before = JSON.stringify(resolveRunAdmission(graph));
      const payload = canonicalFor(graph);
      const out = buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', payload);
      const after = JSON.stringify(resolveRunAdmission(graph));
      expect(before, name).toBe(after);
      expect(out.status, name).toBe(ANALYSIS_READY_BLOCKED_STATUS);
    }
    // Positive control: the corpus contains BOTH verdicts, so "identical" is
    // not satisfied by a corpus that only ever produces one answer.
    expect(resolveRunAdmission(GRAPH_A_ONE_UNENCODED).willProceed).toBe(true);
    expect(resolveRunAdmission(GRAPH_C_FRESH_DRAFT).willProceed).toBe(false);
  });

  it('does not MUTATE the payload it was handed', () => {
    const before = JSON.stringify(CANONICAL_C);
    buildAnalysisRefusalReadiness('MISSING_OPTION_VALUE', CANONICAL_C);
    expect(JSON.stringify(CANONICAL_C)).toBe(before);
  });
});
