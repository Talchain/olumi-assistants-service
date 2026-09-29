/**
 * ⭐⭐⭐ A WITHHELD ANSWER MUST STILL SHOW IT UNDERSTOOD THE QUESTION.
 *
 * ── THE WITNESS. Deployed staging, 19 Sep 2026, scenario `26b908ee`, 18:59:05.
 * The person clicked the chip "How likely is this?" on the risk **Dilution and
 * Control Risk**, waited 12.7 seconds, and received, in full:
 *
 *     "Something in that response was not safe to show as-is.
 *      Please ask me what you'd like to inspect or change next."
 *
 * Nothing else. They never asked about that risk again. From their seat the
 * product had not merely declined — it had shown no sign of having read the
 * question.
 *
 * ── WHAT IS AND IS NOT WRONG HERE. The WITHHOLD is correct and is not touched:
 * an always-on post-check fired on a fresh analysis, and `NEUTRAL_DEGRADE_TEXT`
 * exists precisely so a healthy analysis is not misdescribed as stale. What is
 * wrong is that the subject of the question is dropped, so a refusal about one
 * risk is indistinguishable from a refusal about anything at all.
 *
 * ── THE BAN IS PRESERVED EXACTLY AS WRITTEN. The module's rule is that this
 * copy "carries no value, unit, hash, OPTION LABEL or freshness claim". An
 * option label is banned by name because naming a leading option is the residue
 * the egress alarm measures. A RISK is not an option, so this names the subject
 * ONLY for a non-option node, and refuses on ambiguity rather than guessing —
 * the same rule the rest of this estate applies to a subject it cannot resolve.
 */
import { describe, expect, it } from 'vitest';

import {
  buildCoachingDegradeResponse,
  NEUTRAL_DEGRADE_TEXT,
} from '../coaching-output-postcheck.js';
// ⚠ FROM ITS OWNER, not from the module under test. `coaching-output-postcheck`
// imports this type and does not re-export it, so importing it from there is a
// TS2459 that the required check cannot see (`tsconfig.build.json` excludes
// tests) and only `Typecheck Drift (ratchet)` catches.
import type { CoachingStatePack } from '../../context/canonical-analysis-state.js';

/** Fresh + usable: the arm where the analysis is fine and only the prose was unsafe. */
const FRESH_PACK = {
  analysis_present: true,
  freshness: 'fresh',
  readiness_status: 'ready',
  // ⚠ EVERY LIMB OF `isStateUnsafe` IS SET EXPLICITLY, and the first cut of
  // this fixture omitted them — so the pack read UNSAFE and all four cases
  // failed against the trust template rather than the neutral copy. A fixture
  // I write is not evidence about the code it is aimed at; the precondition is
  // pinned below so a future edit to `isStateUnsafe` REDs here rather than
  // silently moving these cases onto the other arm.
  rerun_required: false,
  usable_for_chips: true,
  blocked: false,
} as unknown as CoachingStatePack;

/** The graph the executor already passes as `readinessNodes` — nothing new is plumbed. */
const NODES = [
  { id: 'risk_1', kind: 'risk', label: 'Dilution and Control Risk' },
  { id: 'risk_2', kind: 'risk', label: 'Funding Shortfall Risk' },
  { id: 'opt_a', kind: 'option', label: 'Hybrid Syndicate' },
  { id: 'fac_1', kind: 'factor', label: 'Investor Syndicate Size' },
];

describe('a withheld coaching answer keeps the subject it was asked about', () => {
  it('PRECONDITION: the fixture reaches the FRESH arm, not a trust template', () => {
    // Without this the whole file could pass or fail for a reason that has
    // nothing to do with subject continuity.
    const baseline = buildCoachingDegradeResponse(FRESH_PACK, { readinessNodes: NODES });
    expect(baseline.assistant_text).toBe(NEUTRAL_DEGRADE_TEXT);
  });

  it('⭐ THE WITNESS: the risk follow-up names the risk', () => {
    const out = buildCoachingDegradeResponse(FRESH_PACK, {
      readinessNodes: NODES,
      question: 'How likely is Dilution and Control Risk, and what would we see first?',
    });

    expect(out.assistant_text).toContain('Dilution and Control Risk');
    // The withhold itself is unchanged — no value, no freshness claim, no chip.
    expect(out.suggested_actions).toEqual([]);
    expect(out.assistant_text).not.toContain('%');
    expect(out.assistant_text).not.toMatch(/stale|out of date|no analysis/i);
  });

  it('⛔ AN OPTION IS NEVER NAMED — the ban is by kind, not by wording', () => {
    // Naming a leading option here would inject the exact residue the egress
    // alarm measures, on every withheld turn. The subject is resolved only for
    // non-option nodes; an option question falls back to today's copy.
    const out = buildCoachingDegradeResponse(FRESH_PACK, {
      readinessNodes: NODES,
      question: 'How likely is Hybrid Syndicate to come out ahead?',
    });

    expect(out.assistant_text).toBe(NEUTRAL_DEGRADE_TEXT);
    expect(out.assistant_text).not.toContain('Hybrid Syndicate');
  });

  it('⛔ TWO SUBJECTS IS A QUESTION, NOT A FACT — ambiguity keeps today’s copy', () => {
    const out = buildCoachingDegradeResponse(FRESH_PACK, {
      readinessNodes: NODES,
      question:
        'How do Dilution and Control Risk and Funding Shortfall Risk compare?',
    });

    expect(out.assistant_text).toBe(NEUTRAL_DEGRADE_TEXT);
  });

  it('no resolvable subject ⇒ byte-identical to today', () => {
    // The discriminating control: without it, the first case would be equally
    // consistent with copy that always changed.
    const out = buildCoachingDegradeResponse(FRESH_PACK, {
      readinessNodes: NODES,
      question: 'What should we do next?',
    });

    expect(out.assistant_text).toBe(NEUTRAL_DEGRADE_TEXT);
  });

  it('no question supplied ⇒ byte-identical to today', () => {
    const out = buildCoachingDegradeResponse(FRESH_PACK, { readinessNodes: NODES });
    expect(out.assistant_text).toBe(NEUTRAL_DEGRADE_TEXT);
  });

  it('a source-bound recovery still outranks this — the better answer wins', () => {
    const out = buildCoachingDegradeResponse(FRESH_PACK, {
      readinessNodes: NODES,
      question: 'How likely is Dilution and Control Risk?',
      sourceBoundRecovery: 'Here is what the saved run shows.',
    });

    expect(out.assistant_text).toBe('Here is what the saved run shows.');
  });
});
