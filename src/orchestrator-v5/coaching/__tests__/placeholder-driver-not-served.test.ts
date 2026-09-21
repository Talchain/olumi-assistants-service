/**
 * ⭐⭐ A FILL STRING IS NOT AN ASSUMPTION. THE PICKER MUST DECLINE IT.
 *
 * THE DEFECT, WIRE-WITNESSED 10 Sep 2026 on served build `ecfc086`
 * (`cee-staging.onrender.com/proxy/v5/turn`, 2 of 4 non-ready turns,
 * `assumption_source: uncertainty_driver` on both):
 *
 *     • Assumption to check: Extracted from brief — confirm value
 *
 * The user was shown CEE's own internal fill marker, verbatim, as the thing
 * they should go and check. It is not an assumption; it is the absence of one.
 *
 * ── WHY EVERY EXISTING GUARD PASSED IT ─────────────────────────────────────
 * `driverIsServable` is three conjuncts, and the string clears all three: it
 * is 36 characters (inside the 5–80 grammar window, no interrogative first
 * token, no forbidden jargon substring), it asserts no analysis outcome, and
 * `gateAssumptionFragment` admits it. The em dash is NOT a rejection — RC4
 * made dashes a repairable STYLE offence rather than a content one, and the
 * gate is a PREDICATE ONLY, so the caller then ships its own original bytes,
 * em dash included. Nothing in that chain is wrong. The chain simply has no
 * concept of "this string is a placeholder".
 *
 * ⛔ WHY THE ESTATE'S EXISTING WITHDRAWAL DOES NOT REACH IT — AND THIS IS THE
 * FINDING, NOT AN ASIDE. `schema-v3.ts` already withdraws this exact claim,
 * via the shared `assertsBriefExtraction` predicate. It reads
 * `v3Node.uncertainty_drivers` — the TOP-LEVEL field. This picker reads
 * `node.observed_state.uncertainty_drivers`. Those two carriers are
 * DISJOINT BY CONSTRUCTION at `schema-v3.ts:360`: a factor WITH a value puts
 * its drivers in `observed_state` and leaves the top-level field undefined;
 * only a valueless factor (drivers promoted by the repair stages) carries the
 * top-level one. The enricher always writes a `value` beside the claim
 * (`enricher.ts:1323`, `:1423`), so the withdrawal is structurally incapable
 * of firing on the nodes that carry it, and the picker is structurally
 * incapable of seeing the nodes the withdrawal cleans.
 *
 * Two guards, one string, and neither can observe the other's population.
 * That is trap 21 (two questions under one name), and it is why this defect
 * survived a lane that had already been written to kill exactly this claim.
 *
 * ── WHAT THIS SUITE PINS, AND WHY IN THIS ORDER ────────────────────────────
 * 1. PRECONDITION — the fill string is genuinely servable under all three
 *    conjuncts. Without it, the decline below could be passing because the
 *    string was refused on length or jargon, which would prove nothing about
 *    the new decision AND would go green if someone later weakened the gate.
 * 2. The decline itself, bound to the exact rendered fallback sentence.
 * 3. ⭐ THE OVER-DECLINE PIN. A genuine driver must STILL reach the user.
 *    Over-declining silently returns every non-ready turn to the fixed
 *    generic line, which is precisely the state CEE #1437 was built to end —
 *    and it would leave this whole suite green while doing it.
 * 4. SKIP, NOT ABORT. A node carrying the fill string BESIDE a real driver
 *    must serve the real one. Refusing at the gate instead of skipping in the
 *    picker would lose it, and would mislabel the telemetry `gate_rejected`
 *    when nothing was rejected on content.
 */
import { describe, it, expect } from 'vitest';
import { buildPostDraftNarrative, validateUncertaintyDriver } from '../post-draft-narrative.js';
import { assertsAnalysisOutcome, gateAssumptionFragment } from '../copy-quality-gate.js';
import {
  BRIEF_EXTRACTION_CONFIRM_DRIVER,
  briefExtractionQuote,
} from '../../../cee/factor-extraction/brief-extraction-claim.js';
import type { GraphV3T } from '../../../orchestrator/types.js';

function makeGraph(nodes: unknown[]): GraphV3T {
  return { nodes, edges: [] } as unknown as GraphV3T;
}

const GOAL_NODE = {
  id: 'g1',
  kind: 'goal' as const,
  provenance: 'from_brief' as const,
  label: 'Deliver Successful Launch Within Three Months at Acceptable Quality',
};
const OPTION_A = { id: 'o1', kind: 'option' as const, label: 'Hire a tech lead' };
const OPTION_B = { id: 'o2', kind: 'option' as const, label: 'Hire two mid-weight developers' };
const FACTOR_CAPACITY = { id: 'f2', kind: 'factor' as const, label: 'Delivery capacity' };

/** A factor carrying `drivers` on the carrier the picker actually reads. */
function graphWithDrivers(drivers: readonly string[]): GraphV3T {
  return makeGraph([
    GOAL_NODE,
    OPTION_A,
    OPTION_B,
    {
      id: 'f1',
      kind: 'factor' as const,
      label: 'Leadership quality',
      observed_state: { value: 0.5, uncertainty_drivers: [...drivers] },
    },
    FACTOR_CAPACITY,
  ]);
}

/** The witnessed non-ready class. */
const NON_READY = {
  status: 'needs_user_input',
  blockers: [{
    option_id: OPTION_A.id,
    option_label: OPTION_A.label,
    factor_id: 'f1',
    factor_label: 'Leadership quality',
    blocker_type: 'missing_value',
    suggested_action: 'add_value',
  }],
} as const;

/**
 * The exact RENDERED bullet a declined pick must produce — the same slot, and
 * the same line, the defect was witnessed in:
 *
 *     • Assumption to check: Extracted from brief — confirm value
 *
 * ⚠ DERIVED FROM THE RENDERER, NOT FROM `FIXED_GENERIC_ASSUMPTION`. The first
 * version of this constant was the builder's own sentence ("One assumption
 * worth checking is …"), and it RED against a correct fix: the bullet renderer
 * re-heads the fragment. Asserting the source constant would have measured the
 * composer rather than what the user reads.
 */
const FIXED_GENERIC_BULLET =
  "• Assumption to check: whether the model's key inputs reflect your real delivery constraints";

/**
 * A driver that is true regardless of phase: it describes what is UNCERTAIN,
 * makes no claim about any comparison, and names no option.
 */
const GENUINE_DRIVER =
  'extra developers may add coordination overhead rather than throughput';

describe('a brief-extraction fill string is never served as the assumption to check', () => {
  it('PRECONDITION: the fill string clears all three of driverIsServable\'s conjuncts', () => {
    // Reconstructed from the three exported parts rather than by exporting the
    // private predicate, so this pin reads the SAME guards the picker consults.
    // If any of these flips, the decline test below stops discriminating and
    // this assertion says so by name.
    expect(
      validateUncertaintyDriver(BRIEF_EXTRACTION_CONFIRM_DRIVER),
      'grammar guard admits it (36 chars, no interrogative, no jargon)',
    ).toBe(true);
    expect(
      assertsAnalysisOutcome(BRIEF_EXTRACTION_CONFIRM_DRIVER),
      'it asserts no analysis outcome',
    ).toBe(false);
    expect(
      gateAssumptionFragment(BRIEF_EXTRACTION_CONFIRM_DRIVER).accept,
      'the copy-quality gate admits it — the em dash is repaired, not rejected',
    ).toBe(true);
  });

  it('⭐ DEFECT: a factor whose only driver is the fill string serves the FALLBACK, not the fill string', () => {
    const nonReady = buildPostDraftNarrative({
      graph: graphWithDrivers([BRIEF_EXTRACTION_CONFIRM_DRIVER]),
      analysisReady: NON_READY,
    });

    // The witnessed sentence, in the form the user read it.
    expect(nonReady.text).not.toContain('Extracted from brief');
    expect(nonReady.text).not.toContain(BRIEF_EXTRACTION_CONFIRM_DRIVER);
    // Bound to the exact rendered fallback, so a decline that produced some
    // other sentence would not pass this by accident.
    expect(nonReady.text).toContain(FIXED_GENERIC_BULLET);
    expect(nonReady.telemetry.assumption_source).toBe('deterministic_fallback');
    // `no_candidate`, NOT `gate_rejected`: a placeholder is an ABSENCE of a
    // candidate, not a candidate refused on its content. Ops read these two
    // apart to tell a coverage gap from a rejection rate.
    expect(nonReady.telemetry.fallback_reason).toBe('no_candidate');
  });

  it('⭐ DEFECT: the ready path declines it too — the decision is about the string, not the phase', () => {
    const ready = buildPostDraftNarrative({
      graph: graphWithDrivers([BRIEF_EXTRACTION_CONFIRM_DRIVER]),
      analysisReady: { status: 'ready' },
    });
    expect(ready.text).not.toContain('Extracted from brief');
    expect(ready.text).toContain(FIXED_GENERIC_BULLET);
    expect(ready.telemetry.assumption_source).toBe('deterministic_fallback');
  });

  it('⭐ OVER-DECLINE PIN: a genuine driver still reaches the user on a non-ready turn', () => {
    // If this REDs, the fix has silently returned every non-ready turn to the
    // fixed generic sentence — the exact state CEE #1437 was built to end.
    const nonReady = buildPostDraftNarrative({
      graph: graphWithDrivers([GENUINE_DRIVER]),
      analysisReady: NON_READY,
    });
    expect(nonReady.text, 'a real driver must survive the placeholder decline').toContain(
      GENUINE_DRIVER,
    );
    expect(nonReady.telemetry.assumption_source).toBe('uncertainty_driver');
    expect(nonReady.telemetry.fallback_reason).toBeNull();
  });

  it('⭐ SKIP, NOT ABORT: a fill string beside a real driver serves the real one', () => {
    const nonReady = buildPostDraftNarrative({
      graph: graphWithDrivers([BRIEF_EXTRACTION_CONFIRM_DRIVER, GENUINE_DRIVER]),
      analysisReady: NON_READY,
    });
    expect(nonReady.text).not.toContain('Extracted from brief');
    expect(nonReady.text).toContain(GENUINE_DRIVER);
    expect(nonReady.telemetry.assumption_source).toBe('uncertainty_driver');
    // Nothing was refused on content, so nothing is reported as refused.
    expect(nonReady.telemetry.fallback_reason).toBeNull();
  });

  it('the claim is declined in every form the shared constant can produce', () => {
    // The predicate is deliberately case-insensitive and prefix-based, so the
    // quote form and casing/whitespace variants decline too. Recognise
    // generously, withdraw safely.
    for (const variant of [
      BRIEF_EXTRACTION_CONFIRM_DRIVER,
      briefExtractionQuote('churn is 4%'),
      '  Extracted from brief — confirm value',
      'extracted from brief - confirm value',
      'EXTRACTED FROM BRIEF, confirm value',
    ]) {
      const nonReady = buildPostDraftNarrative({
        graph: graphWithDrivers([variant]),
        analysisReady: NON_READY,
      });
      expect(nonReady.text.toLowerCase(), `variant must not reach the user: ${variant}`).not.toContain(
        'extracted from brief',
      );
      expect(nonReady.telemetry.assumption_source).toBe('deterministic_fallback');
    }
  });

  it('a driver that merely MENTIONS a brief is not a fill string and is still served', () => {
    // The predicate is a PREFIX test, not a substring one. A real driver that
    // happens to contain the word "brief" must be unaffected — otherwise the
    // decline is quietly eating genuine coaching.
    const mentionsBrief = 'the timeline stated in the brief may already be out of date';
    expect(
      validateUncertaintyDriver(mentionsBrief),
      'PRECONDITION: this string is servable, so a refusal would be the new decline',
    ).toBe(true);

    const nonReady = buildPostDraftNarrative({
      graph: graphWithDrivers([mentionsBrief]),
      analysisReady: NON_READY,
    });
    expect(nonReady.text).toContain(mentionsBrief);
    expect(nonReady.telemetry.assumption_source).toBe('uncertainty_driver');
  });
});
