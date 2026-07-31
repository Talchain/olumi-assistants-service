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
  WIRE_ENFORCED_PROSE_FIELDS,
  WIRE_WITHHELD_LEADER_REPLACEMENT,
} from '../leading-option-wire-enforcement.js';
import {
  textAssertsLeadingOption,
  textNamesLeadingOption,
} from '../leading-option-egress-guard.js';
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

const OPTS = { requestId: 'req-2149', exitPath: 'edit_graph' as const };

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
      mayNameLeadingOption: true,
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
      mayNameLeadingOption: false,
    });
    expect(result.changed).toBe(true);
    expect(result.editedFields).toEqual(['assistant_text']);
  });

  it('a withheld turn whose prose designates NOTHING also returns the same reference', () => {
    const input = envelope('Added the risk. Higher capacity leads to faster delivery.');
    const result = enforceLeadingOptionClaimsAtWire(input, {
      ...OPTS,
      mayNameLeadingOption: false,
    });
    expect(
      result.response,
      'causal "leads to" is the documented carve-out — deleting it is over-suppression',
    ).toBe(input);
  });
});

describe('SURGERY — only the offending unit goes', () => {
  it('the surviving sentence is byte-identical and the claim is gone', () => {
    const { response } = enforceLeadingOptionClaimsAtWire(envelope(`${RECEIPT} ${CLAIM}`), {
      ...OPTS,
      mayNameLeadingOption: false,
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
      { ...OPTS, mayNameLeadingOption: false },
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
      mayNameLeadingOption: false,
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
      mayNameLeadingOption: false,
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
      mayNameLeadingOption: false,
    });
    expect(response.assistant_text.length).toBeGreaterThan(0);
    expect(response.assistant_text).toBe(WIRE_WITHHELD_LEADER_REPLACEMENT);
  });

  it('IDEMPOTENT: a second pass over the output changes nothing', () => {
    const once = enforceLeadingOptionClaimsAtWire(envelope(`${RECEIPT} ${CLAIM}`), {
      ...OPTS,
      mayNameLeadingOption: false,
    });
    const twice = enforceLeadingOptionClaimsAtWire(once.response, {
      ...OPTS,
      mayNameLeadingOption: false,
    });
    expect(twice.changed).toBe(false);
    expect(twice.response).toBe(once.response);
  });
});

describe('framing_question — the second covered surface', () => {
  it('is projected, and reported separately from the answer', () => {
    const { response, editedFields } = enforceLeadingOptionClaimsAtWire(
      envelope(RECEIPT, { framing_question: `Should you take ${LEADER}, which leads at 72%?` }),
      { ...OPTS, mayNameLeadingOption: false },
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
      mayNameLeadingOption: false,
    });
    expect('framing_question' in (response as Record<string, unknown>)).toBe(false);
  });
});

describe('the whole_field LAST RESORT — bounded, coded, and not the normal path', () => {
  it('fires only when no single unit carries the claim, and says so on the wire', () => {
    // The claim straddles a unit boundary: the splitter cuts on the newline, so
    // "leading" and "option" land in different units and neither asserts alone.
    const straddling = 'The leading\noption is clear.';
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
      mayNameLeadingOption: false,
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

  it('and the ordinary case is NOT coded whole_field', () => {
    enforceLeadingOptionClaimsAtWire(envelope(`${RECEIPT} ${CLAIM}`), {
      ...OPTS,
      mayNameLeadingOption: false,
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
      mayNameLeadingOption: false,
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

describe('SCOPE — stated, asserted, and not implied by which arms exist', () => {
  it('exactly two prose fields are covered', () => {
    // ⚠ THIS ARM IS A CONVERSATION, NOT A RUBBER STAMP. If it goes red, the
    // covered surface moved — and moving it is legitimate, but it must be
    // DELIBERATE. Widening pulls block prose and enrichment under a SECOND
    // authority (the producer projection `withheld-claim-projection.ts` already
    // owns them, and two authorities over one question is the trap-#12 shape
    // this estate has paid for twice); narrowing leaves a model-authored
    // channel unguarded. Either way, update the module's SCOPE block, the PR
    // body's scope statement and this list together.
    expect([...WIRE_ENFORCED_PROSE_FIELDS]).toEqual(['assistant_text', 'framing_question']);
  });

  it('block prose is NOT edited — the alarm keeps observing it', () => {
    // The producer owns Phase-3 block prose. A wire-level edit here would mask
    // the producer defect the Layer-3 alarm exists to measure.
    const withBlock = envelope(RECEIPT, {
      blocks: [{ type: 'analysis_result', summary: `${LEADER} leads by 18 points.` }],
    });
    const { response, changed } = enforceLeadingOptionClaimsAtWire(withBlock, {
      ...OPTS,
      mayNameLeadingOption: false,
    });
    expect(changed).toBe(false);
    expect(response).toBe(withBlock);
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
});
