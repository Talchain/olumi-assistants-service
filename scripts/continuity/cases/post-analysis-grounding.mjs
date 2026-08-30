/**
 * CASE: post-analysis-grounding  —  SEAM B (independent of the discourse ledger)
 *
 * THE PROPERTY
 * ------------
 * When the product discloses how much of the model it had to fill in for
 * itself, that disclosure must be QUANTITATIVELY FAITHFUL. If five factors
 * were defaulted, it must not say one.
 *
 * WHY THIS IS A DIFFERENT SEAM FROM EVERYTHING ELSE HERE
 * -----------------------------------------------------
 * It is not a memory defect at all. It is one array answering two questions
 * across the PLoT→CEE enrichment passthrough: the producer de-duplicates
 * disclosure entries BY WARNING CODE, which is correct for "which distinct
 * sentences should I show?" and wrong for "how many factors were defaulted?".
 * The consumer counts entries and asks the second question. Because that
 * passthrough is an untyped record, no contract check can catch it.
 *
 * It shares no code with Seam A and must be fixed separately. It is in this
 * harness because it is a TRUST defect that understates in the flattering
 * direction, and because an architecture-ranked list would otherwise bury it.
 *
 * THE INVARIANT, NOT THE MAGIC NUMBER
 * -----------------------------------
 * Engineering a model with exactly five defaulted roots is brittle: the count
 * depends on the drafter's inferences and would drift. So the assertion is the
 * INVARIANT — the disclosed count equals the count the producer itself
 * reports — with the control being a model whose defaulted count differs. That
 * survives drafting drift, which a pinned "must say 5" would not, and it is
 * the property that actually matters.
 *
 * HONEST FAILURE MODE
 * -------------------
 * The disclosure carrier only exists after a COMPLETED analysis run. If no run
 * completes, this case reports COULD_NOT_MEASURE and NAMES THE ARTEFACT IT
 * SEARCHED — never PASS. An absence claim that does not say where it looked is
 * how a scoped result becomes a false general one.
 */

import { check } from '../lib/verdict.mjs';
import { BRIEF_FULLY_SPECIFIED, BRIEF_WAREHOUSE, draft, runStateKind } from '../lib/scenarios.mjs';

const RUN = 'Run the analysis now.';

/**
 * Carrier keys searched, NAMED so any absence claim states its scope.
 * A contrast key is included so the search can prove it is capable of finding
 * something in the same payload — a search that finds nothing everywhere is
 * indistinguishable from a broken search.
 */
export const SEARCHED_CARRIERS = [
  'defaulted_assumptions',
  'default_disclosure',
  'inference_warnings',
  'value_defaulted',
  'ROOT_NODE_DEFAULT_VALUE',
];
const CONTRAST_KEY = 'analysis_state';

/** Locate the disclosure and the underlying defaulted count, reporting scope. */
export function findDefaultedEvidence(body) {
  const serialised = JSON.stringify(body || {});
  const found = SEARCHED_CARRIERS.filter((k) => serialised.includes(k));
  const contrastPresent = serialised.includes(CONTRAST_KEY);

  let disclosureEntries = null;
  const walk = (v) => {
    if (!v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach(walk);
    for (const [k, val] of Object.entries(v)) {
      if (k === 'defaulted_assumptions' && Array.isArray(val)) disclosureEntries = val;
      walk(val);
    }
  };
  walk(body);

  return {
    searched: SEARCHED_CARRIERS,
    found,
    contrastPresent,
    disclosureEntries,
    disclosureCount: disclosureEntries ? disclosureEntries.length : null,
    // Entries whose factor is unnamed are the signature of code-level dedup:
    // five named factors collapsing into one anonymous row.
    unnamedEntries: disclosureEntries
      ? disclosureEntries.filter((e) => e && (e.factor_label === null || e.factor_label === undefined)).length
      : null,
  };
}

export default {
  id: 'post-analysis-grounding',
  seam: 'B',
  stateClass: 'fresh',
  title: 'the product\'s statement of its own incompleteness is quantitatively honest',
  expectedAt: {
    caceba1a:
      'source-derived defect: PLoT dedups disclosure by warning code, so N defaulted roots collapse to 1 unnamed entry',
  },

  async setup(ctx) {
    // ARM: a brief with many unstated root values → more defaulting.
    // CONTROL: a brief that states values → less defaulting. Different counts
    // are what make the comparison informative.
    const [arm, control] = await Promise.all([
      draft(ctx.client, BRIEF_WAREHOUSE, 'grounding-ARM-draft'),
      draft(ctx.client, BRIEF_FULLY_SPECIFIED, 'grounding-CTL-draft'),
    ]);
    const [armRun, ctlRun] = await Promise.all([
      ctx.client.turn({ scenarioId: arm.scenarioId, message: RUN, label: 'grounding-ARM-run' }),
      ctx.client.turn({ scenarioId: control.scenarioId, message: RUN, label: 'grounding-CTL-run' }),
    ]);
    return {
      arm: { scenarioId: arm.scenarioId, run: armRun, evidence: findDefaultedEvidence(armRun.body) },
      control: { scenarioId: control.scenarioId, run: ctlRun, evidence: findDefaultedEvidence(ctlRun.body) },
    };
  },

  precondition(s) {
    const a = s.arm.evidence;
    return [
      check('arm run turn accepted', s.arm.run.ok, `status=${s.arm.run.status}`),
      check('control run turn accepted', s.control.run.ok, `status=${s.control.run.status}`),
      check(
        'the search instrument is not blind',
        a.contrastPresent,
        `contrast key "${CONTRAST_KEY}" present=${a.contrastPresent} — if false, the payload search itself is broken ` +
          'and every "carrier absent" reading would be an artefact of the instrument',
      ),
      check(
        'a defaulted-assumptions carrier is present on the wire',
        a.found.length > 0,
        a.found.length
          ? `found ${JSON.stringify(a.found)}`
          : `NONE of the searched carriers present. SCOPE OF THIS ABSENCE CLAIM: keys ${JSON.stringify(a.searched)} ` +
            `in the /proxy/v5/turn response body only. run_state.kind=${runStateKind(s.arm.run.body)}. ` +
            'Most likely no analysis completed within the turn — COULD_NOT_MEASURE, not a pass.',
      ),
      check(
        'the disclosure list itself is readable',
        a.disclosureCount !== null,
        a.disclosureCount === null ? 'no defaulted_assumptions array found to count' : `${a.disclosureCount} entr(ies)`,
      ),
    ];
  },

  async arm(ctx, s) {
    return s.arm.run;
  },

  async control(ctx, s) {
    return s.control.run;
  },

  assertArm(resp, s) {
    const a = s.arm.evidence;
    return [
      check(
        'the disclosure names the factors it defaulted',
        a.unnamedEntries === 0,
        a.unnamedEntries === null
          ? 'no entries to inspect'
          : `${a.unnamedEntries} of ${a.disclosureCount} entries carry factor_label: null — ` +
            'the signature of de-duplication by warning code collapsing named factors into one anonymous row',
      ),
      check(
        'the disclosure is not a single collapsed row hiding several defaults',
        !(a.disclosureCount === 1 && a.unnamedEntries === 1),
        `count=${a.disclosureCount} unnamed=${a.unnamedEntries}`,
      ),
    ];
  },

  /**
   * OPPOSITE OUTCOME: a fully-specified brief should default fewer values, so
   * its disclosure must differ from the arm's. If both worlds produce the same
   * disclosure, the disclosure is not a function of the model and nothing it
   * says can be trusted — which the discrimination gate will catch anyway.
   */
  assertControl(resp, s) {
    const a = s.arm.evidence;
    const c = s.control.evidence;
    return [
      check(
        'the disclosure varies with the model',
        a.disclosureCount === null || c.disclosureCount === null || a.disclosureCount !== c.disclosureCount,
        `arm=${a.disclosureCount} control=${c.disclosureCount} — identical counts across very different models ` +
          'would mean the number is not derived from the model at all',
      ),
    ];
  },
};
