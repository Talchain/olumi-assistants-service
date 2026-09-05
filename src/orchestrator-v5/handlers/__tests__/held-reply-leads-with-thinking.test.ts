/**
 * ⭐⭐ THE HELD REPLY LED WITH A CHANGELOG.
 *
 * ── WITNESSED, VERBATIM (founder session, 5 Sep 2026, deployed UI a9c2e050) ─
 * Asked for THOUGHTS on context he had just supplied, the reply's first line
 * was the changeset:
 *
 *   "I'm holding these changes rather than applying them straight away: add
 *    option 'Hire a Temporary Technical Lead', …"
 *
 * Paul's ruling: "I like that it's action-oriented, but this doesn't feel
 * right. It should start by providing its initial thoughts, recommendations
 * and questions concisely, and THEN offer the update."
 *
 * The HOLDING BEHAVIOUR is correct and is not touched here. Its POSITION is
 * the defect.
 *
 * ── THE CORPUS IS NOT FROM THIS AUTHOR'S HEAD ─────────────────────────────
 * `live-assistant-text-corpus-2026-08-17/digit-bearing-replies.json` is a
 * frozen record of 688 assistant replies actually emitted on dated builds.
 * Eight carry a hold ask. Measured at d818ef5d: 8/8 LEAD with the hold ask,
 * 8/8 carry the needs-encoding disclosure, and in 8/8 that disclosure sits
 * ~80% of the way through — dead last, after the enumeration AND after the
 * consent sentence. That is the prevalence evidence for this change, and it
 * is a HISTORIC RECORD: append-only, never edited (CLAUDE.md trap 14b).
 *
 * ── WHY THE FIX IS A REORDER OF DETERMINISTIC PARTS AND NOT A RESCUE OF THE
 *    LLM'S OWN NARRATION ─────────────────────────────────────────────────
 * The obvious larger fix — stop discarding the edit LLM's `coaching.summary`
 * at `edit-graph-dispatch.ts:3407` and lead with it — was MEASURED and
 * REJECTED. Running the shipped guards over the product's own prompt
 * exemplars (`src/prompts/edit-graph-v6.ts`, n=7, extracted not invented):
 *
 *   findSuccessClaimHit  TRIPS on 2/7 ("Added competitor response as an
 *                        external factor…", "Removed brand perception…")
 *   findSuccessClaimHit  PASSES "Churn now has a stronger negative effect on
 *                        revenue." and "Raise price now also reduces
 *                        marketing spend to 25k."
 *
 * Those last two are PRESENT-TENSE STATE CLAIMS. On a held turn they are
 * false — the change was NOT applied — and every shipped guard lets them
 * through, because `findSuccessClaimHit` is calibrated for the perfective
 * "I've applied" family on the ZERO-OPERATION path. Leading with narration
 * would therefore have shipped a lie under a green suite. Separating true
 * from false state claims is a new predicate over natural language, i.e.
 * exactly the oscillating-predicate class ROADMAP 2.1361 measured over four
 * rounds. This change does not go near it.
 *
 * ── ROUND COUNT ───────────────────────────────────────────────────────────
 * Round 1, and structurally not an oscillator: `composeHeldReply` is a pure
 * ordering of two already-composed strings. It classifies nothing, so it has
 * no direction to reverse.
 *
 * ── KNOWN-DROPPED, EXPLICIT ───────────────────────────────────────────────
 * A held batch with NO disclosure (e.g. a pure value/edge edit, or an add
 * that already carries interventions) still opens with the hold ask. There
 * is nothing true and deterministic to put in front of it, and inventing a
 * preamble would be new copy making new claims. `leaves a hold with nothing
 * to disclose byte-identical` pins that set exactly, so this suite REDs if
 * the behaviour widens into "always prepend something".
 */
import { describe, it, expect } from 'vitest';

import {
  buildGmHeldAssistantText,
  buildNeedsEncodingAddNotice,
  composeHeldReply,
  describeHeldOperationsSubject,
  evaluateEditGraphMutations,
} from '../edit-graph-referee-gate.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../../compose/forbidden-user-facing-phrases.js';
import LIVE_REPLIES from '../../compose/__tests__/fixtures/live-assistant-text-corpus-2026-08-17/digit-bearing-replies.json' with { type: 'json' };

// ---------------------------------------------------------------------------
// Fixtures — the A2 held batch, byte-identical to gm-needs-encoding-receipts
// so both suites judge the same shape.
// ---------------------------------------------------------------------------

const CURRENT_GRAPH = {
  nodes: [
    { id: 'dec_eu', kind: 'decision', label: 'EU Expansion' },
    { id: 'opt_berlin', kind: 'option', label: 'Open Berlin Office' },
    {
      id: 'fac_setup_cost',
      kind: 'factor',
      label: 'Setup Cost',
      observed_state: { value: 0.4, raw_value: 1000000, unit: '£', cap: 2500000 },
    },
    { id: 'goal_growth', kind: 'goal', label: 'EU Revenue Growth' },
  ],
  edges: [
    {
      from: 'dec_eu',
      to: 'opt_berlin',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
    {
      from: 'opt_berlin',
      to: 'fac_setup_cost',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
    {
      from: 'fac_setup_cost',
      to: 'goal_growth',
      strength: { mean: -0.4, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'negative',
    },
  ],
};

/** Paul's shape: add an option with NO effect values + its edges. */
const ADD_OPTION_NO_INTERVENTIONS_OPS = [
  {
    op: 'add_node',
    path: 'opt_acquire',
    value: { id: 'opt_acquire', kind: 'option', label: 'Acquire Small German Competitor' },
  },
  {
    op: 'add_edge',
    path: 'dec_eu::opt_acquire',
    value: {
      from: 'dec_eu',
      to: 'opt_acquire',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
  },
  {
    op: 'add_edge',
    path: 'opt_acquire::fac_setup_cost',
    value: {
      from: 'opt_acquire',
      to: 'fac_setup_cost',
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: 'positive',
    },
  },
];

/** OPPOSITE-DIRECTION TWIN: the same add, but it already carries effect values. */
const ADD_OPTION_WITH_INTERVENTIONS_OPS = [
  {
    op: 'add_node',
    path: 'opt_acquire',
    value: {
      id: 'opt_acquire',
      kind: 'option',
      label: 'Acquire Small German Competitor',
      interventions: { fac_setup_cost: { value: 0.8, source: 'user_specified' } },
    },
  },
];

const GATE_INPUT = {
  mode: 'live' as const,
  currentGraph: CURRENT_GRAPH,
  currentGraphHash: 'hash-a',
  baseGraphHash: 'hash-a',
  freshness: 'fresh' as const,
  scenarioId: 'scn-1',
  turnId: 'turn-1',
  requestId: 'req-1',
};

const OFFER_OPENER = "I'm holding";
const DISCLOSURE_OPENER = 'Heads up:';

describe('the held reply leads with what the user needs to decide, not with the changeset', () => {
  it('leads with the disclosure and offers the change LAST', () => {
    const decision = evaluateEditGraphMutations({
      ...GATE_INPUT,
      operations: ADD_OPTION_NO_INTERVENTIONS_OPS as never,
    });
    expect(decision.governing).toBe('held');
    const text = decision.assistantText ?? '';

    // The reply OPENS with the disclosure.
    expect(text.startsWith(DISCLOSURE_OPENER)).toBe(true);
    // …and the offer comes after it, not before.
    expect(text.indexOf(OFFER_OPENER)).toBeGreaterThan(text.indexOf(DISCLOSURE_OPENER));
  });

  it('still offers the change, still applies nothing', () => {
    const decision = evaluateEditGraphMutations({
      ...GATE_INPUT,
      operations: ADD_OPTION_NO_INTERVENTIONS_OPS as never,
    });
    const text = decision.assistantText ?? '';

    // Reordering must not drop the offer, the enumeration, or the consent.
    expect(text).toContain(OFFER_OPENER);
    expect(text).toContain("add option 'Acquire Small German Competitor'");
    expect(text).toContain("link 'EU Expansion' to 'Acquire Small German Competitor'");
    expect(text).toContain("link 'Acquire Small German Competitor' to 'Setup Cost'");
    expect(text).toContain('Nothing in the model moves until you confirm.');
    expect(text).toContain('Reply yes to continue, or tell me what to adjust instead.');
    // Nothing auto-applies, and the consent channel survives.
    expect(decision.blockApply).toBe(true);
    expect(decision.pendingActions?.length ?? 0).toBeGreaterThan(0);
    expect(decision.suggestedActions?.length ?? 0).toBeGreaterThan(0);
  });

  it('emits exactly the two shipped parts, reordered — byte-exact', () => {
    const decision = evaluateEditGraphMutations({
      ...GATE_INPUT,
      operations: ADD_OPTION_NO_INTERVENTIONS_OPS as never,
    });
    const text = decision.assistantText ?? '';

    // Both parts are rebuilt from their OWN shipped owners, so this pins the
    // ORDER without re-stating either party's copy in this file (a restated
    // string would drift into a second authority — CLAUDE.md trap 12).
    const disclosure = buildNeedsEncodingAddNotice(
      ADD_OPTION_NO_INTERVENTIONS_OPS,
      CURRENT_GRAPH,
    );
    const subject = describeHeldOperationsSubject(
      ADD_OPTION_NO_INTERVENTIONS_OPS,
      CURRENT_GRAPH,
    );
    expect(disclosure).not.toBeNull();
    expect(subject).not.toBeNull();
    const offer = buildGmHeldAssistantText(subject, ADD_OPTION_NO_INTERVENTIONS_OPS.length);

    expect(text).toBe(`${disclosure} ${offer}`);
    // Nothing added: the reply is the same length it was before the reorder.
    expect(text.length).toBe(disclosure!.length + 1 + offer.length);
  });

  // ── OPPOSITE-DIRECTION TWIN ───────────────────────────────────────────────
  // GREEN before and after. Proves the change cannot widen into "always
  // prepend something": with nothing true to disclose, the reply is
  // byte-identical to the hold ask alone and still opens with the offer.
  it('leaves a hold with nothing to disclose byte-identical', () => {
    const decision = evaluateEditGraphMutations({
      ...GATE_INPUT,
      operations: ADD_OPTION_WITH_INTERVENTIONS_OPS as never,
    });
    expect(decision.governing).toBe('held');
    expect(buildNeedsEncodingAddNotice(ADD_OPTION_WITH_INTERVENTIONS_OPS, CURRENT_GRAPH)).toBeNull();

    const text = decision.assistantText ?? '';
    expect(text.startsWith(OFFER_OPENER)).toBe(true);
    expect(text).not.toContain(DISCLOSURE_OPENER);
  });

  it('the reordered text still passes the egress guards (with a positive control)', () => {
    const decision = evaluateEditGraphMutations({
      ...GATE_INPUT,
      operations: ADD_OPTION_NO_INTERVENTIONS_OPS as never,
    });
    const text = decision.assistantText ?? '';
    expect(findSuccessClaimHit(text)).toBeNull();
    expect(findForbiddenPhraseHit(text)).toBeNull();
    // POSITIVE CONTROLS in the same run — a blind guard cannot fake these.
    expect(findSuccessClaimHit("I've applied the change.")).not.toBeNull();
    expect(findForbiddenPhraseHit('the context pack says')).not.toBeNull();
  });
});

describe('composeHeldReply — the ordering rule, in isolation', () => {
  it('puts the disclosure first and the offer last', () => {
    expect(composeHeldReply({ disclosure: 'A.', offer: 'B.' })).toBe('A. B.');
  });

  it('returns the offer unchanged when there is nothing to disclose', () => {
    expect(composeHeldReply({ disclosure: null, offer: 'B.' })).toBe('B.');
  });

  it('treats a blank disclosure as nothing to disclose', () => {
    expect(composeHeldReply({ disclosure: '   ', offer: 'B.' })).toBe('B.');
  });
});

describe('HISTORIC RECORD — the harm this change closes (frozen corpus, never edited)', () => {
  const holdReplies = (LIVE_REPLIES as readonly string[]).filter((r) =>
    r.includes(OFFER_OPENER),
  );

  it('every recorded hold reply led with the changeset and buried the disclosure', () => {
    // Contrast control: the corpus is non-empty and the filter discriminates.
    expect((LIVE_REPLIES as readonly string[]).length).toBeGreaterThan(100);
    expect(holdReplies.length).toBe(8);

    for (const reply of holdReplies) {
      expect(reply.startsWith(OFFER_OPENER)).toBe(true);
      const disclosureAt = reply.indexOf(DISCLOSURE_OPENER);
      expect(disclosureAt).toBeGreaterThan(0);
      // Buried: the disclosure sat in the last third of every recorded reply.
      expect(disclosureAt / reply.length).toBeGreaterThan(0.66);
    }
  });
});
