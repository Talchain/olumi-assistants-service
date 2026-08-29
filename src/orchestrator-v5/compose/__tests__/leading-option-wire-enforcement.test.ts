/**
 * ROADMAP 2.149 — the WIRE gate's PROPERTIES, at the unit.
 *
 * The route-level suite (`__tests__/claim-safety-non-execute-exits-route-level.
 * test.ts`) drives real HTTP through real exits and asserts serialized bytes;
 * that is where "the harm no longer ships" is proven. THIS file proves the
 * properties that a route drive can only sample: surgery, byte identity by
 * REFERENCE, never-empties, idempotence, the `whole_field` last resort, and the
 * enforcer/alarm narrowness relation the whole design rests on.
 *
 * ⚠ EVERY ABSENCE ARM HAS A PRESENCE ARM (CLAUDE.md trap #13). "the designation
 * is gone" proves nothing unless the same instrument is shown to keep it when
 * the verdict permits.
 */

import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';

import { setTestSink, TelemetryEvents } from '../../../utils/telemetry.js';
import {
  enforceLeadingOptionClaimsAtWire,
  optionRosterFromGraph,
  textNamesAnOption,
  WIRE_ENFORCED_PROSE_FIELDS,
  WIRE_ENFORCED_STRUCTURED_FIELDS,
  WIRE_WITHHELD_LEADER_REPLACEMENT,
} from '../leading-option-wire-enforcement.js';
import { WITHHELD_ANALYSIS_SUMMARY } from '../withheld-claim-projection.js';
import {
  textAssertsLeadingOption,
  textNamesLeadingOption,
} from '../leading-option-egress-guard.js';
import { readFinalLeaderClaimEgressPolicy } from '../analysis-state-v1.js';
import { splitIntoRedactableUnits, replaceAssertingUnits } from '../redactable-units.js';
import { WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL } from '../withheld-explanation-answer.js';

const LEADER = 'Hire Marketing Manager';
const RECEIPT = 'Added the risk.';
const CLAIM = `${LEADER} leads at 72% against Hold at 28%.`;

function envelope(assistantText: string, extra: Record<string, unknown> = {}): OlumiResponse {
  return {
    response_version: 2,
    assistant_text: assistantText,
    blocks: [],
    suggested_actions: [],
    insights: [],
    stage_indicator: 'analyse',
    ...extra,
  } as OlumiResponse;
}

/**
 * The scenario's own graph — the ONLY thing this gate reads it for is the option
 * ROSTER ("which options exist"), never a ranking. Without it the gate stands
 * down, which is itself pinned below.
 */
const ROSTER_GRAPH = {
  nodes: [
    { id: 'goal_growth', kind: 'goal', label: 'Customer growth' },
    { id: 'fac_capacity', kind: 'factor', label: 'Capacity' },
    { id: 'opt_hire', kind: 'option', label: LEADER },
    { id: 'opt_hold', kind: 'option', label: 'Hold' },
  ],
  edges: [],
};

const OPTS = {
  requestId: 'req-2149',
  exitPath: 'edit_graph' as const,
  graph: ROSTER_GRAPH,
};

let events: Array<{ name: string; data: Record<string, unknown> }> = [];
beforeEach(() => {
  events = [];
  setTestSink((name, data) => events.push({ name, data: data as Record<string, unknown> }));
});
afterEach(() => setTestSink(null));

describe('PERMIT-WINS — the first line, and the one that must never regress', () => {
  it('a permitted turn returns the SAME OBJECT REFERENCE', () => {
    // By reference, not by value. #755's first cut is the reason: a gate that
    // rebuilds the envelope "harmlessly" is a gate that can drop a field, and a
    // reference check is the only assertion that cannot be satisfied by a
    // careful-enough copy.
    const input = envelope(`${RECEIPT} ${CLAIM}`);
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'designation_permitted',
    });
    expect(result.response).toBe(input);
    expect(result.changed).toBe(false);
    expect(result.editedFields).toEqual([]);
    expect(events).toEqual([]);
  });

  it('INSTRUMENT: the same input on a WITHHELD turn really is edited', () => {
    // The positive control for the arm above — otherwise "unchanged" could mean
    // "this gate does nothing at all".
    const result = enforceLeadingOptionClaimsAtWire(envelope(`${RECEIPT} ${CLAIM}`), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(result.changed).toBe(true);
    expect(result.editedFields).toEqual(['assistant_text']);
  });

  it('a withheld turn whose prose designates NOTHING also returns the same reference', () => {
    const input = envelope('Added the risk. Higher capacity leads to faster delivery.');
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(
      result.response,
      'causal "leads to" is the documented carve-out — deleting it is over-suppression',
    ).toBe(input);
  });
});

describe('FINAL AUTHORITY — designation and independently attested evidence are distinct', () => {
  const completeCurrent = { kind: 'complete_current', computed_at: '2026-08-28T12:00:00Z' };

  function policyFor(leaderClaim: Record<string, unknown>, runState = completeCurrent) {
    return readFinalLeaderClaimEgressPolicy({
      analysis_state: { run_state: runState, leader_claim: leaderClaim },
    });
  }

  it('licenses a designation only for a current, separated, internally consistent final claim', () => {
    expect(policyFor({ permitted: true, separation: 'separated' })).toBe(
      'designation_permitted',
    );
  });

  it('maps each valid withheld reason to an evidence-only policy', () => {
    expect(
      policyFor({
        permitted: false,
        withheld_reason: 'options_do_not_separate',
        separation: 'near_tie',
      }),
    ).toBe('evidence_only_options_do_not_separate');
    expect(
      policyFor({
        permitted: false,
        withheld_reason: 'constraint_verdict_withheld',
        separation: 'separated',
      }),
    ).toBe('evidence_only_constraint_verdict_withheld');
    expect(
      policyFor({ permitted: false, withheld_reason: 'separation_unavailable' }),
    ).toBe('evidence_only_separation_unavailable');
  });

  it('fails closed on contradictory, malformed, absent and non-current final authority', () => {
    expect(
      policyFor({
        permitted: true,
        withheld_reason: 'options_do_not_separate',
        separation: 'near_tie',
      }),
    ).toBe('designation_withheld');
    expect(
      policyFor({ permitted: true }),
      'the shared contract makes separation optional; permitted is already the composed conjunction',
    ).toBe('designation_permitted');
    expect(policyFor({ permitted: true, separation: 'near_tie' })).toBe(
      'designation_withheld',
    );
    expect(policyFor({ permitted: false, withheld_reason: 'unknown_reason' })).toBe(
      'designation_withheld',
    );
    expect(readFinalLeaderClaimEgressPolicy({})).toBe('designation_withheld');
    expect(
      policyFor({ permitted: true, separation: 'separated' }, { kind: 'complete_stale' }),
    ).toBe('designation_withheld');
    expect(
      policyFor({ permitted: true, separation: 'separated' }, { kind: 'running' }),
    ).toBe('designation_withheld');
    expect(
      policyFor({ permitted: true, separation: 'separated' }, { kind: 'refused' }),
    ).toBe('designation_withheld');
  });
});

describe('EVIDENCE-ONLY — typed and code-owned surfaces only', () => {
  const evidenceOnlyPolicies = [
    'evidence_only_options_do_not_separate',
    'evidence_only_constraint_verdict_withheld',
    'evidence_only_separation_unavailable',
  ] as const;

  it.each(evidenceOnlyPolicies)(
    'does not infer semantic spans in arbitrary prose under %s',
    (leaderClaimPolicy) => {
      const input = envelope(
        `${LEADER} currently leads at 72%. It comes out ahead in a salary survey.`,
        {
          framing_question: `Why does ${LEADER} lead?`,
        },
      );
      const result = enforceLeadingOptionClaimsAtWire(input, {
        ...OPTS,
        leaderClaimPolicy,
      });

      expect(result.changed).toBe(false);
      expect(result.response).toBe(input);
      expect(result.editedFields).toEqual([]);
    },
  );

  it('keeps an unrelated same-unit co-occurrence byte-identical', () => {
    const input = envelope(
      `${LEADER} is in scope; the salary survey currently leads the discussion.`,
    );
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'evidence_only_options_do_not_separate',
    });

    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
  });

  it.each(evidenceOnlyPolicies)(
    'projects typed designation and summary while preserving comparison prose under %s',
    (leaderClaimPolicy) => {
      const comparison = [
        { option_id: 'opt_hire', option_label: LEADER, win_probability: 0.5 },
        { option_id: 'opt_hold', option_label: 'Hold', win_probability: 0.5 },
      ];
      const assistantText =
        `${LEADER} came out ahead in 50% of simulations, but the analysis treats this as a close call.`;
      const input = envelope(assistantText, {
        blocks: [
          {
            type: 'analysis_result',
            leading_option_id: 'opt_hire',
            summary: `${LEADER} leads on this run.`,
            enrichment: { option_comparison: comparison },
          },
        ],
      });
      const result = enforceLeadingOptionClaimsAtWire(input, {
        ...OPTS,
        leaderClaimPolicy,
      });
      const block = result.response.blocks.find(
        (candidate) => candidate.type === 'analysis_result',
      );

      expect(result.response.assistant_text).toBe(assistantText);
      expect(block?.leading_option_id).toBeNull();
      expect(block?.summary).toBe(WITHHELD_ANALYSIS_SUMMARY);
      expect((block?.enrichment as Record<string, unknown>)?.option_comparison).toEqual(
        comparison,
      );
    },
  );

  it.each([
    [`The prior claim \"${LEADER} leads.\" is disputed.`, 'quoted claim'],
    [`I am checking whether ${LEADER} leads.`, 'interrogative clause'],
    [`${LEADER} leads the implementation workstream.`, 'transitive workstream'],
    [`${LEADER} is in scope; the salary survey currently leads the discussion.`, 'co-occurrence'],
  ])('does not treat a %s as a direct designation', (assistantText) => {
    const input = envelope(assistantText, {
      blocks: [
        {
          type: 'analysis_result',
          leading_option_id: 'opt_hire',
          summary: 'The options do not separate.',
        },
      ],
    });
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'evidence_only_options_do_not_separate',
    });

    expect(result.response.assistant_text).toBe(assistantText);
  });

  it('does not turn a distributed pronoun into an option identity', () => {
    const input = envelope(
      `${LEADER} is a distant third. It only comes out ahead in a tiny fraction of simulations.`,
    );
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'evidence_only_options_do_not_separate',
    });

    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
  });

  it('does not splice or rewrite untyped same-unit evidence and consequences', () => {
    const input = envelope(
      `${LEADER} comes out ahead in 99%, so the regulator approved it and budget risk is eliminated.`,
    );
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'evidence_only_options_do_not_separate',
    });

    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
  });

  it('removes the exact code-owned first-analysis designation without deleting its receipt', () => {
    const signal =
      'Your first analysis is ready. Take a moment to explore the leading option and the factors shaping it before acting on the result.';
    const input = envelope(`${RECEIPT} ${signal}`);
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'evidence_only_options_do_not_separate',
    });

    expect(result.changed).toBe(true);
    expect(result.editedFields).toEqual(['assistant_text']);
    expect(result.response.assistant_text).toContain(RECEIPT);
    expect(result.response.assistant_text).not.toContain(signal);
    expect(result.response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it.each(evidenceOnlyPolicies)(
    'projects typed structured designation under %s while leaving free summary prose untouched',
    (leaderClaimPolicy) => {
      const comparison = [
        {
          option_id: 'opt_hire',
          option_label: LEADER,
          win_probability: 0.5,
          status: 'computed',
        },
        {
          option_id: 'opt_hold',
          option_label: 'Hold',
          win_probability: 0.5,
          status: 'computed',
        },
      ];
      const summary = `${LEADER} leads on this run.`;
      const input = envelope('Analysis complete.', {
        blocks: [
          {
            type: 'analysis_result',
            leading_option_id: 'opt_hire',
            summary,
            enrichment: {
              option_comparison_status: 'computed',
              option_comparison: comparison,
              decision_brief: {
                headline: `${LEADER} currently leads, but remains within model uncertainty.`,
                top_drivers: ['Capacity is the strongest licensed driver.'],
                key_assumptions: ['Demand remains stable.'],
              },
              decision_review: {
                story_headlines: { opt_hire: `${LEADER} leads—but only slightly.` },
              },
              robustness: {
                recommended_option_id: 'opt_hire',
                recommended_option_label: LEADER,
                near_tie: {
                  is_tie: true,
                  gap: 0,
                  threshold: 0.05,
                  top_option_id: 'opt_hire',
                  second_option_id: 'opt_hold',
                },
              },
            },
          },
        ],
      });

      const result = enforceLeadingOptionClaimsAtWire(input, {
        ...OPTS,
        leaderClaimPolicy,
      });
      const block = result.response.blocks.find(
        (candidate) => candidate.type === 'analysis_result',
      );
      const enrichment = block?.enrichment as Record<string, any> | undefined;

      expect(result.changed).toBe(true);
      expect(result.editedFields).toEqual(['analysis_result']);
      expect(block?.leading_option_id).toBeNull();
      expect(block?.summary).toBe(summary);
      expect(enrichment?.option_comparison).toEqual(comparison);
      expect(enrichment?.decision_brief).toMatchObject({
        top_drivers: ['Capacity is the strongest licensed driver.'],
        key_assumptions: ['Demand remains stable.'],
      });
      expect(enrichment?.decision_brief).not.toHaveProperty('headline');
      expect(enrichment).not.toHaveProperty('decision_review');
      expect(enrichment?.robustness).toEqual({
        near_tie: { is_tie: true, gap: 0, threshold: 0.05 },
      });
    },
  );

  it('keeps the structured leader designation byte-identical when final authority permits it', () => {
    const input = envelope('Analysis complete.', {
      blocks: [
        {
          type: 'analysis_result',
          summary: `${LEADER} leads on this run.`,
          leading_option_id: 'opt_hire',
        },
      ],
    });
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'designation_permitted',
    });

    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
  });

  it.each([
    ['BigInt', { option_comparison: [{ impossible: 1n }] }],
    [
      'cycle',
      (() => {
        const value: Record<string, unknown> = {};
        value.self = value;
        return value;
      })(),
    ],
    [
      'throwing getter',
      Object.defineProperty({}, 'decision_brief', {
        enumerable: true,
        get() {
          throw new Error('getter');
        },
      }),
    ],
    ['throwing toJSON', { option_comparison: { toJSON() { throw new Error('toJSON'); } } }],
  ])('does not let hostile %s enrichment bypass typed designation removal', (_name, enrichment) => {
    const input = envelope('Analysis complete.', {
      blocks: [
        {
          type: 'analysis_result',
          leading_option_id: 'opt_hire',
          summary: `${LEADER} leads on this run.`,
          enrichment,
        },
      ],
    });
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    const block = result.response.blocks.find(
      (candidate) => candidate.type === 'analysis_result',
    );

    expect(result.changed).toBe(true);
    expect(block?.leading_option_id).toBeNull();
    expect(block?.summary).not.toMatch(/leads on this run/i);
  });

  it('preserves the recorded losing-option explanation rather than guessing its pronouns', () => {
    const text =
      'Keep what we have is a long way off the pace. ' +
      'It is currently a distant third. It only comes out ahead in a tiny fraction of simulations, ' +
      'so the case for it rests on the other two options underperforming badly. ' +
      'Budget overrun is the main lever working against switching.';
    const input = envelope(text);
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      graph: {
        nodes: [
          { id: 'opt_keep', kind: 'option', label: 'Keep what we have' },
          { id: 'opt_move', kind: 'option', label: 'Move to HubSpot' },
        ],
        edges: [],
      },
      leaderClaimPolicy: 'evidence_only_options_do_not_separate',
    });

    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
  });

  it('leaves historical rerun prose untouched at wire; its code-owned producer owns the fix', () => {
    const text =
      'The picture has stayed the same: Hire Marketing Manager still leads. ' +
      'That is a result in itself: the conclusion held both before and after those changes.';
    const input = envelope(text);
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'evidence_only_options_do_not_separate',
    });

    expect(result.changed).toBe(false);
    expect(result.response).toBe(input);
  });
});
describe('SURGERY — only the offending unit goes', () => {
  it('the surviving sentence is byte-identical and the claim is gone', () => {
    const { response } = enforceLeadingOptionClaimsAtWire(envelope(`${RECEIPT} ${CLAIM}`), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    const text = response.assistant_text;
    expect(text.startsWith(RECEIPT)).toBe(true);
    expect(text).not.toContain(LEADER);
    expect(text).not.toContain('72%');
    expect(text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('a claim in the MIDDLE leaves both neighbours intact', () => {
    const before = 'You asked about coordination overhead.';
    const after = 'The gap is not stable across the runs.';
    const { response } = enforceLeadingOptionClaimsAtWire(
      envelope(`${before} ${CLAIM} ${after}`),
      { ...OPTS, leaderClaimPolicy: 'designation_withheld' },
    );
    expect(response.assistant_text).toContain(before);
    expect(response.assistant_text).toContain(after);
    expect(response.assistant_text).not.toContain(LEADER);
  });

  it('LINES FIRST: a bullet list loses one bullet, not the list', () => {
    // The splitter's whole reason for splitting on newlines before sentences.
    const answer = [
      '• Coordination overhead is now modelled.',
      `• ${CLAIM}`,
      '• The capacity link is still unverified.',
    ].join('\n');
    const { response } = enforceLeadingOptionClaimsAtWire(envelope(answer), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    const lines = response.assistant_text.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe('• Coordination overhead is now modelled.');
    expect(lines[2]).toBe('• The capacity link is still unverified.');
    expect(lines[1]).not.toContain(LEADER);
  });

  it('CONSECUTIVE claims collapse to ONE replacement, not a wall of them', () => {
    const answer = `${LEADER} leads at 72%. ${LEADER} comes out ahead. ${LEADER} performs best.`;
    const { response } = enforceLeadingOptionClaimsAtWire(envelope(answer), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    const occurrences =
      response.assistant_text.split(WIRE_WITHHELD_LEADER_REPLACEMENT).length - 1;
    expect(occurrences).toBe(1);
  });

  it('NEVER EMPTIES: an answer that is nothing but a claim still says something', () => {
    // `assistant_text` is a REQUIRED schema field. An emptied one is a worse
    // answer than the one being repaired, and it ships past the validator
    // because this gate runs downstream of it.
    const { response } = enforceLeadingOptionClaimsAtWire(envelope(CLAIM), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(response.assistant_text.length).toBeGreaterThan(0);
    expect(response.assistant_text).toBe(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('IDEMPOTENT: a second pass over the output changes nothing', () => {
    const once = enforceLeadingOptionClaimsAtWire(envelope(`${RECEIPT} ${CLAIM}`), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    const twice = enforceLeadingOptionClaimsAtWire(once.response, {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(twice.changed).toBe(false);
    expect(twice.response).toBe(once.response);
  });

});

describe('framing_question — the second covered surface', () => {
  it('is projected, and reported separately from the answer', () => {
    const { response, editedFields } = enforceLeadingOptionClaimsAtWire(
      envelope(RECEIPT, { framing_question: `Should you take ${LEADER}, which leads at 72%?` }),
      { ...OPTS, leaderClaimPolicy: 'designation_withheld' },
    );
    expect(editedFields).toEqual(['framing_question']);
    expect(
      response.assistant_text,
      'a framing_question edit must not disturb the answer',
    ).toBe(RECEIPT);
    expect(response.framing_question).not.toContain(LEADER);
  });

  it('an absent framing_question is not invented', () => {
    const { response } = enforceLeadingOptionClaimsAtWire(envelope(`${RECEIPT} ${CLAIM}`), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect('framing_question' in (response as Record<string, unknown>)).toBe(false);
  });
});

describe('the whole_field LAST RESORT — bounded, coded, and not the normal path', () => {
  it('fires only when BOTH escalations leave a residual that still asserts', () => {
    // The claim straddles a soft wrap: the splitter cuts on the newline, so
    // "leading" and "option" land in different units and neither asserts alone —
    // and removing the name-bearing unit does not fix that either.
    const straddling = 'Hire Marketing Manager.\nIt is the leading\noption.';
    expect(
      textAssertsLeadingOption(straddling),
      'fixture check — the whole field must assert, or this arm tests nothing',
    ).toBe(true);
    expect(
      splitIntoRedactableUnits(straddling).some((u) => textAssertsLeadingOption(u)),
      'fixture check — no single unit may assert, or the surgical path would handle it',
    ).toBe(false);

    const { response } = enforceLeadingOptionClaimsAtWire(envelope(straddling), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(response.assistant_text).toBe(WIRE_WITHHELD_LEADER_REPLACEMENT);

    const emitted = events.filter(
      (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
    );
    expect(emitted).toHaveLength(1);
    expect(
      emitted[0]!.data['mode'],
      'coded separately so a dashboard cannot sum the last resort into the success number',
    ).toBe('whole_field');
  });

  it('⭐ P2 SOFT-WRAP: non-naming prose can NO LONGER reach the last resort', () => {
    // ⭐ THE FIX THE NAME GATE BUYS FOR FREE. Before it, ANY field that asserted
    // while no unit did — a claim straddling a soft wrap, an abbreviation-split
    // sentence — was replaced WHOLE, even though it designated nobody. Now
    // `whole_field` is name-gated, so ordinary wrapped prose is untouchable.
    const wrapped = 'Our capacity work is the leading\noption for next quarter, we think.';
    expect(
      textAssertsLeadingOption(wrapped),
      'fixture check — this must still assert at field level, or the arm is vacuous',
    ).toBe(true);
    const input = envelope(wrapped);
    const { response, changed } = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(changed).toBe(false);
    expect(response).toBe(input);
  });

  it('and the ordinary case is NOT coded whole_field', () => {
    enforceLeadingOptionClaimsAtWire(envelope(`${RECEIPT} ${CLAIM}`), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    const emitted = events.filter(
      (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
    );
    expect(emitted[0]!.data['mode']).toBe('surgical');
  });
});

describe('TELEMETRY carries no decision content', () => {
  it('lengths and bounded names only — never the matched prose', () => {
    enforceLeadingOptionClaimsAtWire(envelope(`${RECEIPT} ${CLAIM}`), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    const emitted = events.filter(
      (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
    );
    const payload = JSON.stringify(emitted[0]!.data);
    expect(payload).not.toContain(LEADER);
    expect(payload).not.toContain('72%');
    expect(emitted[0]!.data['original_length']).toBe(`${RECEIPT} ${CLAIM}`.length);
  });
});

describe('THE SHARED CONSTANT — one refusal, three gates, no twin', () => {
  it('the replacement IS the estate tail, trimmed', () => {
    expect(WIRE_WITHHELD_LEADER_REPLACEMENT).toBe(
      WITHHELD_EXPLANATION_NO_DISCLOSURE_TAIL.trim(),
    );
  });

  it('and it makes no currency, existence or cause claim', () => {
    // ROADMAP 2.149 §1 + derivation residual (c). The route seam does not have
    // the four substitution inputs the executor has, so its copy must assert
    // none of the things those inputs would license.
    const copy = WIRE_WITHHELD_LEADER_REPLACEMENT.toLowerCase();
    expect(copy, 'no currency claim').not.toContain('current');
    expect(copy, 'no currency claim').not.toContain('up to date');
    expect(copy, 'no existence claim').not.toContain('your latest analysis');
    expect(copy, 'no existence claim').not.toContain('most recent analysis');
    expect(
      copy,
      'the "on this result" deixis presupposes a result on the three provenances that ' +
        'withhold precisely because none is proven (derivation residual (c))',
    ).not.toContain('this result');
  });

  it('is inert under BOTH readers', () => {
    expect(textAssertsLeadingOption(WIRE_WITHHELD_LEADER_REPLACEMENT)).toBe(false);
    expect(textNamesLeadingOption(WIRE_WITHHELD_LEADER_REPLACEMENT)).toBe(false);
    // POSITIVE CONTROL — both readers can see a claim, so the two arms above
    // are measuring inertness rather than broken readers.
    expect(textAssertsLeadingOption(CLAIM)).toBe(true);
    expect(textNamesLeadingOption(CLAIM)).toBe(true);
  });
});

describe('residual (a) — the enforcer is NEVER wider than the alarm', () => {
  it('the recorded defect: "Bob is tech lead ahead of Carol." is spared', () => {
    // ⭐ THE #755 ADVERSARIAL-REVIEW FINDING (adv-review-cee-755.md:315-345).
    // With the old ' ' neutralisation, blanking "tech lead" brought "is" and
    // "ahead" into adjacency and MANUFACTURED a match the input never had — so
    // the reader that DELETES user content fired on a string the observe-only
    // reader could not even see.
    const sentence = 'Bob is tech lead ahead of Carol.';
    expect(textNamesLeadingOption(sentence), 'the ALARM does not see this').toBe(false);
    expect(textAssertsLeadingOption(sentence), 'so the ENFORCER must not either').toBe(false);
  });

  it('PROPERTY: asserts ⟹ names, over the carve-out corpus', () => {
    const corpus = [
      'Bob is tech lead ahead of Carol.',
      'Higher capacity leads to faster delivery.',
      'Your team leads will need to agree the rollout window.',
      'The engineering leads have not been consulted.',
      'What would firm this up is real enterprise figures.',
      'Sales win rate is still unverified.',
      CLAIM,
    ];
    for (const s of corpus) {
      if (textAssertsLeadingOption(s)) {
        expect(textNamesLeadingOption(s), `enforcer wider than alarm on: ${s}`).toBe(true);
      }
    }
    // Non-vacuity: at least one corpus member must trip the enforcer.
    expect(corpus.some((s) => textAssertsLeadingOption(s))).toBe(true);
  });
});

describe('⭐ DESIGNATION, NOT NAMES — distributed prose loses only the asserting unit', () => {
  // A field-level name plus a later pronoun can form a designation, but once the
  // asserting unit is removed the earlier descriptive unit is not itself a
  // leader claim. Requiring every option name to disappear destroyed truthful
  // losing-option evidence in the recorded corpus.
  const DISTRIBUTED = `${LEADER} is strong. It leads at 72%.`;

  it('the designation does not ship while the non-designating name survives', () => {
    const { response } = enforceLeadingOptionClaimsAtWire(envelope(DISTRIBUTED), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(response.assistant_text).toContain(`${LEADER} is strong.`);
    expect(response.assistant_text).not.toContain('leads at 72%');
  });

  it('is ordinary surgery, not name-deleting escalation', () => {
    enforceLeadingOptionClaimsAtWire(envelope(DISTRIBUTED), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    const emitted = events.filter(
      (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
    );
    expect(emitted[0]!.data['mode']).toBe('surgical');
  });

  it('INSTRUMENT: the permitted twin ships the distributed claim intact', () => {
    // Positive control (trap #13) — without it, "the name is absent" could just
    // mean this fixture never carried one.
    const { response } = enforceLeadingOptionClaimsAtWire(envelope(DISTRIBUTED), {
      ...OPTS,
      leaderClaimPolicy: 'designation_permitted',
    });
    expect(response.assistant_text).toBe(DISTRIBUTED);
  });

  it('a pronoun-free designation is removed without deleting earlier evidence', () => {
    const spread = `${LEADER} came through well. The gap is real. That option comes out ahead.`;
    const { response } = enforceLeadingOptionClaimsAtWire(envelope(spread), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(response.assistant_text).toContain(`${LEADER} came through well.`);
    expect(response.assistant_text).toContain('The gap is real.');
    expect(response.assistant_text).not.toContain('comes out ahead');
  });
});

describe('⭐ P1-OVERSUPPRESS — honest receipts survive a withheld turn', () => {
  // ⭐ RED-FIRST, AND ALSO RED ON THE FIRST CUT. Ordinary decision vocabulary fed
  // the DELETING reader on every withheld turn. This is #755's canary class — an
  // honest receipt destroyed by a guard — reopened at a new address, and the
  // executor's own canaries are structurally BLIND to it because they drive the
  // executor, not the wire.
  it.each([
    ['the review fixture, verbatim', 'Your sales leads improved this quarter.'],
    ['lead time', 'Lead time is down to four weeks.'],
    ['who leads', 'Who leads the coordination work?'],
    ['ahead of plan', 'The rollout is ahead of plan.'],
    [
      'the estate MANUFACTURING its own banned vocabulary upstream',
      'Explore the leading option and the factors shaping it.',
    ],
  ])('%s ships BYTE-IDENTICAL', (_label, text) => {
    const input = envelope(text);
    const { response, changed } = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(changed, 'no option is named, so no designation is possible').toBe(false);
    expect(response).toBe(input);
  });

  it('INSTRUMENT: four of those five really do trip the deleting reader', () => {
    // ⭐ THE POSITIVE CONTROL THAT MAKES THE ARMS ABOVE MEAN SOMETHING: they are
    // spared by the NAME gate, not because the vocabulary reader is asleep.
    //
    // ⚠ "Lead time is down to four weeks." IS DELIBERATELY NOT IN THIS LIST, and
    // the omission is the finding rather than a gap. It does NOT trip the reader
    // at all — `\bleads\b` is plural-only, so the singular noun "Lead" was never
    // at risk. Listing it here would have manufactured a false positive control:
    // the arm above would have "proved" the name gate spared a string nothing
    // threatened. Checked, not assumed — see the explicit assertion below.
    for (const text of [
      'Your sales leads improved this quarter.',
      'Who leads the coordination work?',
      'The rollout is ahead of plan.',
      'Explore the leading option and the factors shaping it.',
    ]) {
      expect(textAssertsLeadingOption(text), `expected the reader to fire on: ${text}`).toBe(true);
    }
    expect(
      textAssertsLeadingOption('Lead time is down to four weeks.'),
      'if this ever becomes true, the singular "lead" entered the shared vocabulary and the ' +
        'over-suppression surface widened — move it into the loop above deliberately',
    ).toBe(false);
  });

  it('a receipt that NAMES the edited option, with no claim, is untouched', () => {
    // The other half: naming an option is not asserting a leader. An edit turn
    // names the thing the user just edited, constantly.
    const input = envelope(`Added a risk to ${LEADER}.`);
    const { response, changed } = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(changed).toBe(false);
    expect(response).toBe(input);
  });

  it('preserves an honest receipt sharing a field with a separate leader claim', () => {
    const { response } = enforceLeadingOptionClaimsAtWire(
      envelope(`Added a risk to ${LEADER}. It leads at 72%.`),
      { ...OPTS, leaderClaimPolicy: 'designation_withheld' },
    );
    expect(response.assistant_text).toContain(`Added a risk to ${LEADER}.`);
    expect(response.assistant_text).not.toContain('leads at 72%');
  });
});

describe('THE ROSTER — "which options exist", never "which one leads"', () => {
  it('a null graph stands the gate DOWN, and says so', () => {
    const input = envelope(`${RECEIPT} ${CLAIM}`);
    const { response, changed } = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      graph: null,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(changed, 'no roster ⇒ no designation can be established ⇒ do not delete prose').toBe(
      false,
    );
    expect(response).toBe(input);
    const emitted = events.filter(
      (e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire,
    );
    expect(
      emitted[0]!.data['mode'],
      'a SILENT stand-down is how a guarantee becomes theatre — the hole must be countable',
    ).toBe('roster_unavailable');
  });

  it('a null graph on a body with NO leader vocabulary is silent', () => {
    enforceLeadingOptionClaimsAtWire(envelope(RECEIPT), {
      ...OPTS,
      graph: null,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(
      events.filter((e) => e.name === TelemetryEvents.V5WithheldLeaderClaimNeutralisedAtWire),
      'reporting a stand-down that could not have mattered would drown the signal',
    ).toEqual([]);
  });

  it('reads option nodes only, and ignores goals and factors', () => {
    expect([...optionRosterFromGraph(ROSTER_GRAPH)]).toEqual([LEADER, 'Hold']);
  });

  it('ignores labels too short to be evidence', () => {
    const roster = optionRosterFromGraph({
      nodes: [
        { id: 'a', kind: 'option', label: 'A' },
        { id: 'b', kind: 'option', label: 'AB' },
        { id: 'c', kind: 'option', label: 'Buy' },
      ],
    });
    expect([...roster], 'a one- or two-character label collides with ordinary prose').toEqual([
      'Buy',
    ]);
  });

  it('is total over malformed shapes and never throws', () => {
    expect(optionRosterFromGraph(null)).toEqual([]);
    expect(optionRosterFromGraph(undefined)).toEqual([]);
    expect(optionRosterFromGraph({})).toEqual([]);
    expect(optionRosterFromGraph({ nodes: 'not-an-array' })).toEqual([]);
    expect(optionRosterFromGraph({ nodes: [null, 7, { kind: 'option' }] })).toEqual([]);
  });

  it('matches option names as WHOLE TOKENS, not substrings', () => {
    // "Hold" is an option; "holding" and "household" are not it.
    const input = envelope('We are holding the household budget. The lead time is fine.');
    const { changed } = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(changed).toBe(false);
  });

  describe('⭐ SOFT-WRAPPED NAMES — the matcher catches up to the criterion', () => {
    // ⭐ RED-FIRST. Model prose soft-wraps a multi-word option label across a
    // newline. Before the `\s+` normalisation the escaped label carried a
    // LITERAL space, the name check missed, and the withheld designation shipped
    // byte-identical — the exact leak this PR exists to stop, defeated by the
    // matcher rather than by the criterion.
    it('a newline inside the option name ENTERS and removes the CLAIM', () => {
      // ⭐ THE CORE FIX. Before the `\s+` normalisation this shipped
      // BYTE-IDENTICAL (changed=false) — the matcher missed the wrapped name, the
      // field fell to the "asserts but names nobody ⇒ ship unchanged" row, and
      // the withheld designation shipped at HTTP 200. Now the field ENTERS and
      // the CLAIM ("leads at 72%") is removed.
      //
      // ⚠ WHAT SURVIVES IS THE STATED CEILING, NOT A BUG. The name straddles the
      // `\n` unit boundary, so surgery removes the asserting unit ("Manager leads
      // at 72%.") and leaves the claimless fragment "Hire Marketing". That
      // fragment is a SHORT FORM with NO claim attached — exactly the residual
      // the module docstring and the SCOPE block name (fixed by the semantic
      // judge, ROADMAP 2.198), NOT closed here. Chasing it means partial matching,
      // which re-opens P1-OVERSUPPRESS. See `textNamesAnOption`'s note.
      const wrapped = 'Hire Marketing\nManager leads at 72%.';
      const { response, changed } = enforceLeadingOptionClaimsAtWire(envelope(wrapped), {
        ...OPTS,
        leaderClaimPolicy: 'designation_withheld',
      });
      expect(changed, 'the name spans a soft wrap — it must still be recognised at field level').toBe(
        true,
      );
      expect(response.assistant_text, 'the CLAIM must be gone').not.toContain('72%');
      expect(response.assistant_text).not.toContain('leads at');
      expect(response.assistant_text).toContain(WIRE_WITHHELD_LEADER_REPLACEMENT);
    });

    it('CEILING, stated: a claimless short-form fragment of a wrapped name MAY survive', () => {
      // ⚠ PINNED SO THE CEILING IS HONEST, NOT DISCOVERED. This documents the
      // residual rather than blessing it: the fragment carries NO leader claim,
      // so it designates nothing on its own. If a future semantic judge (2.198)
      // closes it, this arm changes deliberately.
      const { response } = enforceLeadingOptionClaimsAtWire(
        envelope('Hire Marketing\nManager leads at 72%.'),
        { ...OPTS, leaderClaimPolicy: 'designation_withheld' },
      );
      expect(response.assistant_text).toBe(
        `Hire Marketing\n${WIRE_WITHHELD_LEADER_REPLACEMENT}`,
      );
    });

    it('a name wholly WITHIN one line keeps the receipt (surgical, no fragment)', () => {
      const { response, changed } = enforceLeadingOptionClaimsAtWire(
        envelope(`Added the risk. ${LEADER} leads at 72%.`),
        { ...OPTS, leaderClaimPolicy: 'designation_withheld' },
      );
      expect(changed).toBe(true);
      expect(response.assistant_text.startsWith('Added the risk.')).toBe(true);
      expect(response.assistant_text).not.toContain(LEADER);
    });

    it('a run of spaces / tabs inside the name is matched too', () => {
      const spaced = 'Hire Marketing   Manager leads at 72%.';
      const { changed } = enforceLeadingOptionClaimsAtWire(envelope(spaced), {
        ...OPTS,
        leaderClaimPolicy: 'designation_withheld',
      });
      expect(changed).toBe(true);
    });

    it('PERMIT-WINS: a wrapped mention on a PERMITTED turn stays byte-identical', () => {
      const wrapped = 'Hire Marketing\nManager leads at 72%.';
      const input = envelope(wrapped);
      const { response, changed } = enforceLeadingOptionClaimsAtWire(input, {
        ...OPTS,
        leaderClaimPolicy: 'designation_permitted',
      });
      expect(changed).toBe(false);
      expect(response).toBe(input);
    });

    it('REGRESSION GUARD: possessive / case / punctuation variants stay matched', () => {
      // The reviewer confirmed these already worked; pin them so the `\s+`
      // rewrite cannot quietly regress them.
      const roster = [LEADER]; // "Hire Marketing Manager"
      // Possessive — the `'s` is outside the name, so the right boundary holds.
      expect(textNamesAnOption("Hire Marketing Manager's edge is real.", roster)).toBe(true);
      // Case-insensitive.
      expect(textNamesAnOption('hire marketing manager leads.', roster)).toBe(true);
      // Trailing punctuation.
      expect(textNamesAnOption('The pick is Hire Marketing Manager.', roster)).toBe(true);
      // A leading paren before the name.
      expect(textNamesAnOption('(Hire Marketing Manager) leads.', roster)).toBe(true);
      // Still whole-token: a substring is not a match.
      expect(textNamesAnOption('Rehire Marketing Managerial staff.', roster)).toBe(false);
    });
  });
});

describe('REFUTED — why the post-check does NOT use the wide ALARM reader', () => {
  it('a carve-out phrase inside an ENTERED field must not force escalation', () => {
    // ⚠ THE REVIEW'S PROPOSED POST-CHECK WAS "BOTH textAsserts AND textNames
    // must be false". `textNamesLeadingOption` is the WIDE reader, and the only
    // strings it sees that the narrow one does not are the two documented
    // carve-outs — causal "leads to" and job-title "team leads". Neither can
    // designate anything, so escalating on them deletes true, useful prose: the
    // over-suppression finding rebuilt one layer in. Refuted with this case.
    const text = `${LEADER} leads at 72%. Higher capacity leads to faster delivery.`;
    expect(
      textNamesLeadingOption('Higher capacity leads to faster delivery.'),
      'fixture check — the WIDE reader must see this, or the refutation is empty',
    ).toBe(true);
    expect(
      textAssertsLeadingOption('Higher capacity leads to faster delivery.'),
      'fixture check — and the NARROW reader must not',
    ).toBe(false);

    const { response } = enforceLeadingOptionClaimsAtWire(envelope(text), {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(
      response.assistant_text,
      'the causal clause is true, useful, and designates nobody — it must survive',
    ).toContain('Higher capacity leads to faster delivery.');
    expect(response.assistant_text).not.toContain(LEADER);
  });
});

describe('SCOPE — stated, asserted, and not implied by which arms exist', () => {
  it('covers the two top-level prose fields and the typed analysis-result block', () => {
    // ⚠ THIS ARM IS A CONVERSATION, NOT A RUBBER STAMP. If it goes red, the
    // covered surface moved — and moving it is legitimate, but it must be
    // DELIBERATE. Widening pulls block prose and enrichment under a SECOND
    // authority (the producer projection `withheld-claim-projection.ts` already
    // owns them, and two authorities over one question is the trap-#12 shape
    // this estate has paid for twice); narrowing leaves a model-authored
    // channel unguarded. Either way, update the module's SCOPE block, the PR
    // body's scope statement and this list together.
    expect([...WIRE_ENFORCED_PROSE_FIELDS]).toEqual(['assistant_text', 'framing_question']);
    expect([...WIRE_ENFORCED_STRUCTURED_FIELDS]).toEqual(['analysis_result']);
  });

  it('projects typed analysis-result designations through the same final authority', () => {
    const withBlock = envelope(RECEIPT, {
      blocks: [
        {
          type: 'analysis_result',
          leading_option_id: 'opt_hire',
          summary: `${LEADER} leads by 18 points.`,
        },
      ],
    });
    const { response, changed } = enforceLeadingOptionClaimsAtWire(withBlock, {
      ...OPTS,
      leaderClaimPolicy: 'designation_withheld',
    });
    expect(changed).toBe(true);
    expect(response.blocks[0]).toMatchObject({
      type: 'analysis_result',
      leading_option_id: null,
      summary: WIRE_WITHHELD_LEADER_REPLACEMENT,
    });
  });
});

describe('the shared unit machinery is SHARED, not copied', () => {
  it('splitIntoRedactableUnits is lossless', () => {
    const sample =
      'Line one has no claim.  Line one continues.\n\n• A bullet.\nTrailing line without punctuation';
    expect(splitIntoRedactableUnits(sample).join('')).toBe(sample);
  });

  it('replaceAssertingUnits returns the INPUT REFERENCE when nothing asserts', () => {
    const clean = 'Nothing here designates anything at all.';
    expect(replaceAssertingUnits(clean, textAssertsLeadingOption, 'X')).toBe(clean);
  });

  describe('⭐ P2 — ABBREVIATIONS ARE NOT SENTENCE ENDS', () => {
    // ⚠ A FALSE BOUNDARY MAKES SURGERY LESS SURGICAL, NOT MORE: the "sentence"
    // removed is half a clause, the user gets a mangled fragment, and the
    // surviving half can still carry the designation. Structural rules, never an
    // abbreviation allowlist (that is the trap-#12 mirror).
    it.each([
      ['vs. before a capital', 'Compare Hire vs. Hold on cost. Then decide.', 2],
      ['i.e. before lowercase', 'Use the baseline, i.e. the current plan. Then decide.', 2],
      ['e.g. before lowercase', 'Pick one, e.g. the cheaper route. Then decide.', 2],
      ['No. before a digit', 'See No. 3 in the list. Then decide.', 2],
      ['Inc. before lowercase', 'Acme Inc. reported a loss. Then decide.', 2],
    ])('%s does not split', (_label, text, expectedUnits) => {
      expect(splitIntoRedactableUnits(text)).toHaveLength(expectedUnits);
    });

    it('INSTRUMENT: a real sentence end still splits', () => {
      // Otherwise the arms above would pass under a splitter that never splits.
      expect(splitIntoRedactableUnits('It ran well. Then we decided.')).toHaveLength(2);
      expect(splitIntoRedactableUnits('Did it work? We think so.')).toHaveLength(2);
    });

    it('the split stays LOSSLESS under the new rules', () => {
      for (const sample of [
        'Compare Hire vs. Hold on cost. Then decide.',
        'Use the baseline, i.e. the current plan.\n\n• A bullet, no claim.\nTrailing',
        'Did it work? Yes! Definitely.',
      ]) {
        expect(splitIntoRedactableUnits(sample).join('')).toBe(sample);
      }
    });

    it('an abbreviation INSIDE a claim no longer leaves an orphaned fragment', () => {
      // ⭐ THE END-TO-END CONSEQUENCE, and the reason this is a P1-adjacent fix
      // rather than a cosmetic one. The claim is ONE sentence containing "vs.".
      // Before the guard the splitter cut it in two, surgery removed only the
      // first half, and the user received the tail as a free-standing sentence:
      //
      //   "No single option can be put forward yet. roughly 28% for the alternative."
      //
      // Half a claim, mid-clause, presented as prose. With the guard the sentence
      // is one unit and goes whole.
      const claimWithAbbrev = `${LEADER} leads at 72% vs. roughly 28% for the alternative.`;
      expect(
        splitIntoRedactableUnits(claimWithAbbrev),
        'fixture check — this must be ONE unit, or the arm is not testing the guard',
      ).toHaveLength(1);

      const { response } = enforceLeadingOptionClaimsAtWire(envelope(claimWithAbbrev), {
        ...OPTS,
        leaderClaimPolicy: 'designation_withheld',
      });
      expect(response.assistant_text).toBe(WIRE_WITHHELD_LEADER_REPLACEMENT);
      expect(
        response.assistant_text,
        'the orphaned tail is what the false boundary used to leave behind',
      ).not.toContain('roughly 28%');
    });
  });

  describe('⭐ P2 — COLLAPSED REPLACEMENTS DO NOT GLUE THE NEXT SENTENCE ON', () => {
    it('keeps the separator across a collapsed run', () => {
      // ⚠ PRE-EXISTING, INHERITED WITH THE MOVE, AND INVISIBLE TO THE FOUR PROBES
      // IN `withheld-history-redaction.ts` — none of them has TWO consecutive
      // offending units followed by surviving prose. It produced "…yet.Done."
      const glued = `${LEADER} leads at 72%. ${LEADER} comes out ahead. Done.`;
      const { response } = enforceLeadingOptionClaimsAtWire(envelope(glued), {
        ...OPTS,
        leaderClaimPolicy: 'designation_withheld',
      });
      expect(response.assistant_text).not.toContain('yet.Done');
      expect(response.assistant_text).toBe(`${WIRE_WITHHELD_LEADER_REPLACEMENT} Done.`);
    });

    it('INSTRUMENT: the run really did collapse to one replacement', () => {
      const glued = `${LEADER} leads at 72%. ${LEADER} comes out ahead. Done.`;
      const { response } = enforceLeadingOptionClaimsAtWire(envelope(glued), {
        ...OPTS,
        leaderClaimPolicy: 'designation_withheld',
      });
      const occurrences =
        response.assistant_text.split(WIRE_WITHHELD_LEADER_REPLACEMENT).length - 1;
      expect(occurrences).toBe(1);
    });
  });
});
