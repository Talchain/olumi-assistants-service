/**
 * ⭐⭐⭐ ONE BARRED CLAIM MUST NOT SILENCE EVERY OTHER KIND OF HELP.
 *
 * ── THE WITNESS, settled at the service logs rather than inferred. Deployed
 * staging, 19 Sep 2026, scenario `7cb3cd1c`, 18:49:58Z, trace `a01280f1`. The
 * person typed **"What would you advise?"**, waited **12.2 seconds** while the
 * model composed a real answer, and received, as the entire turn:
 *
 *     "These results may be out of date because the model has changed since
 *      the last analysis. Would you like to re-run analysis to see how your
 *      changes affect the results?"
 *
 * The turn is recorded `outcome: "answered"`. Render carries the reason:
 *
 *     event=v5.coaching.output_postcheck
 *     violation=confident_advice_under_unsafe_state
 *     freshness=stale  rerun_required=true  blocked=false
 *
 * ── WHAT IS AND IS NOT WRONG. The rule is correct and is not touched. It bars
 * exactly one thing — confident DIRECTIONAL advice toward an option — while a
 * result cannot be treated as current, and it exempts recovery guidance by
 * design. `blocked: false` says the result exists and is usable; it is only out
 * of date. So the model was rightly stopped from saying "go with X".
 *
 * What is wrong is the DEGRADE. One barred claim class collapses into total
 * silence: the reasoning, the assumptions and the structural help that rest on
 * nothing current die alongside the one sentence that was actually unsafe, and
 * the person is told neither what was withheld nor that anything else remains.
 *
 * ── WHY THE FIX IS SHAPED THIS WAY. The reason sentence is emitted ONLY for the
 * violation that earned it. A degrade that explains a reason which did not
 * apply is a new false statement, so every other violation keeps today's bytes
 * exactly — pinned below, in both directions.
 */
import { describe, expect, it } from 'vitest';

import { FORBIDDEN_USER_FACING_PHRASES } from '../../compose/forbidden-user-facing-phrases.js';
import {
  buildAnalysisStaleTemplate,
  buildAnalysisUnconfirmedTemplate,
  buildAnalysisDegradedTemplate,
} from '../../tools/handlers/no-op-helpers.js';
import {
  buildCoachingDegradeResponse,
  checkCoachingOutput,
  NEUTRAL_DEGRADE_TEXT,
} from '../coaching-output-postcheck.js';
import type { CoachingStatePack } from '../coaching-output-postcheck.js';

/**
 * The witnessed state, limb by limb. A result EXISTS, is NOT blocked, and is
 * merely out of date — every field is the one Render printed for the turn.
 */
const STALE_PACK = {
  analysis_present: true,
  freshness: 'stale',
  readiness_status: 'ready',
  rerun_required: true,
  usable_for_chips: false,
  blocked: false,
} as unknown as CoachingStatePack;

const UNCONFIRMED_PACK = { ...STALE_PACK, freshness: 'unknown' } as unknown as CoachingStatePack;
const BLOCKED_PACK = { ...STALE_PACK, blocked: true } as unknown as CoachingStatePack;
const FRESH_PACK = {
  analysis_present: true,
  freshness: 'fresh',
  readiness_status: 'ready',
  rerun_required: false,
  usable_for_chips: true,
  blocked: false,
} as unknown as CoachingStatePack;

const NODES = [
  { id: 'fac_1', kind: 'factor', label: 'Dilution Level' },
  { id: 'opt_a', kind: 'option', label: 'Angel Investors Only' },
];

describe('a barred claim class does not silence the rest of the answer', () => {
  it('PRECONDITION: without a violation the stale arm is byte-identical to today', () => {
    // 13b — if this fixture ever stops reaching the stale template, every
    // assertion below would pass or fail for a reason unrelated to the change.
    const baseline = buildCoachingDegradeResponse(STALE_PACK, { readinessNodes: NODES });
    expect(baseline.assistant_text).toBe(buildAnalysisStaleTemplate());
    expect(baseline.suggested_actions).toHaveLength(1);
  });

  it('⭐ THE WITNESS: the turn says what was withheld and what is still available', () => {
    const out = buildCoachingDegradeResponse(STALE_PACK, {
      readinessNodes: NODES,
      violation: 'confident_advice_under_unsafe_state',
    });
    // The caveat still leads — `explain-results` and the golden-path contract
    // both anchor on this opening, so the note is APPENDED, never prepended.
    expect(out.assistant_text.startsWith(buildAnalysisStaleTemplate())).toBe(true);
    // The way out survives.
    expect(out.assistant_text).toMatch(/re-run analysis/i);
    // The barred claim class is named...
    expect(out.assistant_text).toMatch(/one option over another/i);
    // ...and so is what remains, which is the half that was missing entirely.
    expect(out.assistant_text).toMatch(/assumptions/i);
    // It is longer than the bare template by exactly the added help.
    expect(out.assistant_text.length).toBeGreaterThan(buildAnalysisStaleTemplate().length);
  });

  it('the same note is owed on an unconfirmed result, where currency is also in doubt', () => {
    const out = buildCoachingDegradeResponse(UNCONFIRMED_PACK, {
      readinessNodes: NODES,
      violation: 'confident_advice_under_unsafe_state',
    });
    expect(out.assistant_text.startsWith(buildAnalysisUnconfirmedTemplate())).toBe(true);
    expect(out.assistant_text).toMatch(/one option over another/i);
  });

  it('CONTROL: a DIFFERENT violation keeps the bare template — we never explain a reason that did not apply', () => {
    for (const violation of [
      'internal_field_exposed',
      'invented_mutation_success',
      'value_change_narration',
      'unsupported_evidence_or_confidence_claim',
      'stale_presented_as_fresh',
      'fabricated_result_reference',
      'mutation_proposal_on_non_mutating_question',
      'run_availability_claim_after_refusal',
    ] as const) {
      const out = buildCoachingDegradeResponse(STALE_PACK, {
        readinessNodes: NODES,
          violation,
      });
      expect(out.assistant_text, violation).toBe(buildAnalysisStaleTemplate());
    }
  });

  it('CONTROL: a blocked result has no figures to hold back, so the note is not owed', () => {
    const out = buildCoachingDegradeResponse(BLOCKED_PACK, {
      readinessNodes: NODES,
      violation: 'confident_advice_under_unsafe_state',
    });
    expect(out.assistant_text).toBe(buildAnalysisDegradedTemplate());
  });

  it('CONTROL: the fresh arm is untouched — the analysis is fine and nothing is out of date', () => {
    const out = buildCoachingDegradeResponse(FRESH_PACK, {
      readinessNodes: NODES,
      violation: 'confident_advice_under_unsafe_state',
    });
    expect(out.assistant_text).toBe(NEUTRAL_DEGRADE_TEXT);
  });

  it('CONTROL: an absent analysis is untouched', () => {
    const absent = {
      ...STALE_PACK,
      analysis_present: false,
      freshness: 'none',
    } as unknown as CoachingStatePack;
    const before = buildCoachingDegradeResponse(absent, { readinessNodes: NODES });
    const after = buildCoachingDegradeResponse(absent, {
      readinessNodes: NODES,
      violation: 'confident_advice_under_unsafe_state',
    });
    expect(after.assistant_text).toBe(before.assistant_text);
  });

  it('the degrade does not itself trip the boundary it is enforcing', () => {
    // A withhold that would be withheld is the bug one level up. Both the
    // egress phrase list and the post-check's OWN rules are applied to the
    // composed bytes, under the very state that produced them.
    const out = buildCoachingDegradeResponse(STALE_PACK, {
      readinessNodes: NODES,
      violation: 'confident_advice_under_unsafe_state',
    });
    for (const pattern of FORBIDDEN_USER_FACING_PHRASES) {
      expect(pattern.test(out.assistant_text), String(pattern)).toBe(false);
    }
    expect(
      checkCoachingOutput(out.assistant_text, STALE_PACK, {
        decisionLabels: NODES.map((n) => n.label),
      }).safe,
    ).toBe(true);
  });
});
