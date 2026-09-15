/**
 * ⭐⭐ AN OPTION-ANCHORED TURN WHOSE IDENTITY DOES NOT RESOLVE MUST NOT WRITE A
 * MODEL-WIDE BASELINE. It must ASK.
 *
 * ═══ THE MEASURED DEFECT — deployed `a3b0548d`, wire-level, FRESH ═══
 * Banked at `output/core-staging-driver/journey-integrated-a3b0548d/journey-buy-run1/`.
 *
 *   USER    "Change the buy option so the vendor cost is £150,000 per year
 *            instead of £120,000. Keep everything else the same."
 *   RESULT  factor `8f788330` "Vendor Licensing Cost" `observed_state`
 *             null → { value: 1.5, raw_value: 150000, source: "user_override" }
 *           option `c5f4f68e` own intervention: still 60000, UNCHANGED
 *           reply: "Updated Vendor Licensing Cost"
 *           `graph_hash` a0b39d86 → 84013c95 — IT COMMITTED
 *
 * So an option-scoped request MINTED a model-wide value and left the option
 * alone. Contrast control from the same battery: the pricing shape moved ZERO
 * baselines, so this is shape-specific rather than universal.
 *
 * ═══ WHY THE SHIPPED ARMS MISSED IT — executed, not reasoned ═══
 *   evaluateConfigureOptionOutcome -> { status: "not_applicable",
 *                                       reason: "not_configure_intent" }
 *   decideOptionInterventionWrite  -> { verdict: "allow",
 *                                       reason: "outcome_not_unhonoured" }
 * The option ANCHOR matches (the sentence contains "option"); what returns null
 * is `classifyConfigureOptionTrigger`, the effect/value vocabulary. The write
 * arm gated on `matched`, so it permitted the write.
 *
 * ⚠ The fixture below is the REAL pre-edit graph from that run, and the `after`
 * is that graph with the measured mutation applied. Historic capture: append,
 * never edit (trap 14b).
 *
 * ⚠ EXTRACTOR-DELETION OBLIGATION (trap 19): delete the
 * `decideUnresolvedOptionScope` call from `decideOptionInterventionWrite` and
 * the first test MUST go red. The three contrast tests must stay GREEN through
 * that deletion — they are what prove this is not "every baseline edit is now
 * forbidden".
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

import { decideOptionInterventionWrite } from '../option-intervention-write-guard.js';

const CAPTURE = JSON.parse(
  readFileSync(fileURLToPath(new URL('./buy-capture-a3b0548d.json', import.meta.url)), 'utf8'),
) as { nodes: Record<string, unknown>[] };

const VENDOR_FACTOR = '8f788330';
const BUY_OPTION = 'c5f4f68e';
const MSG =
  'Change the buy option so the vendor cost is £150,000 per year instead of £120,000. ' +
  'Keep everything else the same.';

function clone<T>(v: T): T {
  return JSON.parse(JSON.stringify(v)) as T;
}

/** The graph as the wire actually returned it: the baseline minted, option untouched. */
function afterBaselineMinted(): unknown {
  const g = clone(CAPTURE);
  for (const n of g.nodes) {
    if (n.id === VENDOR_FACTOR) {
      n.observed_state = { value: 1.5, unit: '£', source: 'user_override', raw_value: 150000 };
    }
  }
  return g;
}

describe('an option-anchored turn with no resolved identity asks instead of writing', () => {
  it('PRECONDITION — the capture really is the buy graph, and the option is wired to the factor', () => {
    // Pinned in-test (trap 13b): if the fixture stopped carrying these, every
    // assertion below would be about a graph that cannot reproduce the defect.
    const option = CAPTURE.nodes.find((n) => n.id === BUY_OPTION);
    expect(option).toBeDefined();
    expect((option as { interventions: Record<string, unknown> }).interventions)
      .toHaveProperty(VENDOR_FACTOR);
    const factor = CAPTURE.nodes.find((n) => n.id === VENDOR_FACTOR);
    expect(factor).toBeDefined();
    // The baseline is genuinely absent BEFORE — the defect MINTS it.
    expect((factor as { observed_state?: unknown }).observed_state ?? null).toBeNull();
  });

  it('THE CLAIM: the measured buy turn is withheld as scope_unresolved', () => {
    const verdict = decideOptionInterventionWrite({
      message: MSG,
      before: CAPTURE,
      after: afterBaselineMinted(),
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('scope_unresolved');
    if (verdict.verdict !== 'scope_unresolved') throw new Error('narrowing');
    expect(verdict.baselineNodeIds).toContain(VENDOR_FACTOR);
    // The ask needs something to offer.
    expect(verdict.optionLabels.length).toBeGreaterThan(1);
    expect(verdict.optionLabels).toContain('Buy Off-the-Shelf Reporting Tool');
  });

  it('CONTRAST 1: an EXPLICIT model-wide edit still lands — no option anchor', () => {
    // The whole point of anchoring on the message rather than on the write.
    const verdict = decideOptionInterventionWrite({
      message: 'Set Vendor Licensing Cost to £150,000 per year.',
      before: CAPTURE,
      after: afterBaselineMinted(),
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('allow');
  });

  it('CONTRAST 2: an option-anchored turn that LANDED an intervention still lands', () => {
    // A compound edit that partly did what was asked must not be discarded —
    // the measured false positive the identity-binding note warns about.
    const after = clone(CAPTURE);
    for (const n of after.nodes) {
      if (n.id === VENDOR_FACTOR) {
        n.observed_state = { value: 1.5, unit: '£', source: 'user_override', raw_value: 150000 };
      }
      if (n.id === BUY_OPTION) {
        const iv = (n as { interventions: Record<string, Record<string, unknown>> }).interventions;
        iv[VENDOR_FACTOR] = { ...iv[VENDOR_FACTOR], value: 1.5, raw_value: 150000 };
      }
    }
    const verdict = decideOptionInterventionWrite({
      message: MSG, before: CAPTURE, after, appliedMutation: true,
    });
    expect(verdict.verdict).toBe('allow');
  });

  // ── REVIEWER CONTRASTS (REVIEW1512, codex-reviewer, executed on this capture) ──
  // Each of these was measured WRONG on the first cut and is pinned here so it
  // cannot regress. They are the reviewer's sentences verbatim, not paraphrases.

  it('REVIEWER 1: "…for the buy option" — matched vocabulary, unresolved identity, still refused', () => {
    // First cut returned allow/outcome_not_unhonoured: the arm skipped every
    // detection.matched turn, so mutation vocabulary bought a bypass of the
    // scope check. The buy option remained unchanged while the baseline moved.
    const verdict = decideOptionInterventionWrite({
      message: 'Set Vendor Licensing Cost to £150,000 per year for the buy option.',
      before: CAPTURE,
      after: afterBaselineMinted(),
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('scope_unresolved');
  });

  it('REVIEWER 2: an EXPLICIT model-wide request is a KNOWN target, not an unknown one', () => {
    // First cut returned scope_unresolved — a false positive. The only global
    // control was a sentence that never said "options", so it could not
    // discriminate scope at all.
    const verdict = decideOptionInterventionWrite({
      message:
        'Across all options, change Vendor Licensing Cost so the model-wide baseline ' +
        'is £150,000 per year instead of £120,000.',
      before: CAPTURE,
      after: afterBaselineMinted(),
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('allow');
  });

  it('REVIEWER 1b: the FULL option label RESOLVES, so this arm stands down', () => {
    // The sharpest half of finding 1: resolveConfigureOptionTarget returns at
    // clarify.ts:378 on !detection.matched, so the first cut's identity attempt
    // was a NO-OP and even a full label was called unresolved — a guard agreeing
    // with itself. Identity is now a real question here, so the existing arms
    // own this turn rather than this one pre-empting them.
    const verdict = decideOptionInterventionWrite({
      message:
        'Set Vendor Licensing Cost to £150,000 per year on Buy Off-the-Shelf Reporting Tool.',
      before: CAPTURE,
      after: afterBaselineMinted(),
      appliedMutation: true,
    });
    expect(verdict.verdict).not.toBe('scope_unresolved');
  });

  it('PLURAL TWIN: a turn naming TWO options is a multi-target request, not an unknown one', () => {
    // ⛔ CI CAUGHT THIS ONE. The first cut resolved identity as "exactly one
    // maximal match, else null", so a message naming TWO options deliberately
    // read as "we do not know which option" and this arm refused it — pre-empting
    // `detectOptionOwnValueSubstitution`, which owns that turn. The spec that
    // broke says so itself: "If that ever stops being true the premise of this
    // whole module has changed and this spec is the place that says so."
    //
    // Zero resolved options is unresolved. TWO is plural. They are different
    // questions and must not share one predicate (trap 21).
    // ⚠ NOW HOLDS FOR A DIFFERENT AND BETTER REASON. Standing down on "an
    // identity resolved" was itself an escape (see the reviewer twin below), so
    // that rule is gone. The turn this pinned moved the OPTIONS' OWN
    // observed_state, not a FACTOR's — and this arm is now scoped to factor
    // baselines, so it stands down on WHAT MOVED rather than on how many labels
    // the sentence contained.
    const optionOwnValueMoved = clone(CAPTURE);
    for (const n of optionOwnValueMoved.nodes) {
      if (n.kind === 'option') n.observed_state = { value: 0.3, source: 'user_override' };
    }
    const verdict = decideOptionInterventionWrite({
      message:
        'Revise Buy Off-the-Shelf Reporting Tool down, and keep ' +
        'Build Reporting In-House where it is.',
      before: CAPTURE,
      after: optionOwnValueMoved,
      appliedMutation: true,
    });
    expect(verdict.verdict).not.toBe('scope_unresolved');
  });

  // ── REVIEWER DELTA (comment 5685196455, executed on this capture) ──────────

  it('ESCAPE 1: a PROHIBITION of the global write is not permission for it', () => {
    // ⛔ The nastiest of the three. The universal-scope exemption matched
    // "model-wide" INSIDE A NEGATION, so the very sentence FORBIDDING the global
    // write granted it. A quantifier says what scope is being discussed, never
    // whether the user wants it.
    const verdict = decideOptionInterventionWrite({
      message:
        'Set Vendor Licensing Cost to £150,000 per year for the buy option. ' +
        'Do not change the model-wide baseline.',
      before: CAPTURE,
      after: afterBaselineMinted(),
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('scope_unresolved');
  });

  it('ESCAPE 1 TWIN: an AFFIRMATIVE global request is still allowed', () => {
    // The supported case must survive the fix, or this trades one harm for
    // another — the reviewer said so explicitly and it is the easy way to get
    // this wrong.
    const verdict = decideOptionInterventionWrite({
      message:
        'Across all options, change Vendor Licensing Cost so the model-wide baseline ' +
        'is £150,000 per year instead of £120,000.',
      before: CAPTURE,
      after: afterBaselineMinted(),
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('allow');
  });

  it('ESCAPE 2: resolving a full label is NOT evidence another guard owns the write', () => {
    // ⛔ I stood down whenever an identity resolved, assuming the existing arms
    // would own it. They do not — the reviewer executed this and got allow. A
    // resolved label says who the user named, nothing about who protects the
    // mutation.
    const verdict = decideOptionInterventionWrite({
      message:
        'Change Buy Off-the-Shelf Reporting Tool so the vendor cost is £150,000 ' +
        'per year instead of £120,000.',
      before: CAPTURE,
      after: afterBaselineMinted(),
      appliedMutation: true,
    });
    expect(verdict.verdict).toBe('scope_unresolved');
  });

  it('CONTRAST 3: an option-anchored turn that moved NO baseline is untouched', () => {
    const verdict = decideOptionInterventionWrite({
      message: MSG, before: CAPTURE, after: clone(CAPTURE), appliedMutation: true,
    });
    expect(verdict.verdict).toBe('allow');
  });
});
