/**
 * PR2 COMPLETE LOOP — L1: the two judgement tiers gain an ACTION.
 *
 * Design: `olumi-docs/parallel-briefs/PR2-COMPLETE-LOOP-DESIGN.md` §2.1. This
 * spec is the ROUTING evidence for the two composed prompts — the half a green
 * block-mint test cannot see, because a prompt that ships is not the same claim
 * as a prompt that DISPATCHES (2.770: no inert chips, ever).
 *
 * ── WHAT THE DESIGN GOT WRONG, AND — MEASURED — WHAT IT DID NOT ──────────────
 * §2.1 proposed *"Show me what would flip the result if the link from {from} to
 * {to} were different."* and named `route-v2.ts:262` as the route it clears.
 *
 *   (a) THE NAMED ROUTE IS REFUTED. `route-v2.ts:262`
 *       (`detectChipClickResumeIntent`) gates on
 *       `ingress.chip?.action_type === 'what_would_flip'`, and the coaching-card
 *       ActionChip sends NO `action_type` (design §1.1). The TYPED route is
 *       structurally unreachable from this card. The reachable route is the
 *       FREE-TEXT one — `tryPostAnalysisAdviceGate`'s `what_would_flip_free_text`
 *       class — and §3 drives THAT gate directly rather than a proxy for it.
 *
 *   (b) ⚠ THE PROMPT ITSELF IS **NOT** BROADLY REFUTED, AND THIS LANE'S FIRST
 *       WRITE-UP OF IT WAS AN OVERCLAIM, CORRECTED BY MEASUREMENT BEFORE IT
 *       SHIPPED. The claim written here first was *"the gate returns
 *       mutation_signal on EVERY pair"*, generalised from an aggregate count.
 *       Measured pair-by-pair against the real gate: on all 22 live-capture
 *       pairs the two phrasings are IDENTICAL (20 matched, the same 2 rejected,
 *       differ = 0), because `/\bfrom\s+\S+\s+to\s+\S+/i` admits exactly ONE
 *       token between `from` and `to` and real endpoint labels are multi-word.
 *       The phrasings diverge on 2 of the 8 adversarial pairs — `Set Up Cost` and
 *       `Change Rate`, where the LABEL's edit verb plus the phrasing's own `to`
 *       forms a `<verb> … to <X>` span the flip exception cannot forgive.
 *       So the honest finding is not "refuted" but STRICTLY MORE FRAGILE: the
 *       proposed phrasing turns a live route into a dead button whenever a
 *       producer label carries an edit verb, and the `→` spelling — which
 *       `target_refs[].label` already uses — removes that class at no cost.
 *       §3 pins the divergence, in the direction it was measured.
 *
 * ── WHY T1'S POLARITY IS INVERTED, DERIVED AT THE BYTES ──────────────────────
 * `route-v2.ts:4128` — `editVerbCandidate = positiveEditRegexHit &&
 * !negativeEditRegexHit && !valueUpdatePhrasingHit && !analyticalQuestionDetected
 * && !stateQuerySuppressed`. So "will this message mutate the graph?" is NOT
 * `EDIT_GRAPH_POSITIVE_REGEX` alone; the design's stated gate (prompt must NOT
 * match the positive regex) is one conjunct of five, and MEASURABLY over-strict:
 * on this corpus it fails 11/30, including 5 REAL live-capture pairs whose goal
 * label is "Add £2M Net New ARR Within 12 Months" — a producer label, not our
 * copy. The gate this spec asserts is the route's own composite predicate
 * (`isEditGraphDispatchable` — the same two regex objects `route-v2` imports)
 * plus `isAnalyticalQuestion`, which is the conjunct that actually suppresses
 * edit dispatch for a question, and which holds 30/30 here.
 *
 * ── CORPUS, AND WHAT IT EXCLUDES (trap 13d(c) / trap 22) ─────────────────────
 * C-A: every `edge_e_values` endpoint-label PAIR from the two COMMITTED live
 *      staging captures (`fixtures/dsk-walk/*.enrichment.json`) — producer data,
 *      not this lane's fixtures.
 * C-B: adversarial ordinary-business-English labels chosen against the veto set
 *      and the mutation patterns.
 * EXCLUDED, stated rather than discovered later: non-Latin labels; labels
 * containing `→` themselves; labels longer than the body cap (§5 constructs one
 * synthetic over-long pair and asserts the LENGTH gate only). The T1 assertions
 * are NEGATIVE-polarity ("must not dispatch") and the T2 assertions are
 * POSITIVE — every corpus member is run through BOTH, so the direction that a
 * copied test would get backwards is exercised on the same inputs.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

import {
  COACHING_ACTION_PROMPT_MAX,
  COACHING_BLOCK_BODY_MAX,
  composeFragileEdgeActionPrompt,
  isEditGraphDispatchable,
  isFragileEdgeOfferComposable,
} from '../../coaching/fragile-edge-offer-text.js';
import {
  DISAGREEMENT_ACTION_LABEL,
  OVERRIDE_STRESS_TEST_ACTION_LABEL,
  composeDisagreementActionPrompt,
  composeDisagreementNaming,
  composeOverrideActionPrompt,
  composeOverrideNaming,
  isDisagreementActionComposable,
  isDisagreementOfferComposable,
  isOverrideActionComposable,
  isOverrideOfferComposable,
} from '../../coaching/judgement-offer-text.js';
import {
  EDIT_GRAPH_NEGATIVE_REGEX,
  EDIT_GRAPH_POSITIVE_REGEX,
} from '../../../orchestrator/routing/edit-graph-intent-regex.js';
import { shouldSuppressEditDispatchForValueUpdate } from '../../../orchestrator/routing/value-update-gate.js';
import {
  classifyAnalyticalIntent,
  hasIndependentMutationSignal,
} from '../../routing/analytical-intent.js';
import { isAnalyticalQuestion } from '../../routing/analytical-question-guard.js';
import { isStateQueryQuestionShape } from '../../routing/state-query-guard.js';
import {
  tryPostAnalysisAdviceGate,
  type AdviceGateAnalysis,
} from '../../routing/post-analysis-advice-gate.js';

// ============================================================================
// The corpus
// ============================================================================

type LabelPair = readonly [string, string];

/** C-A — every endpoint-label pair in the committed live captures. */
function liveCapturePairs(): LabelPair[] {
  const dir = new URL('./fixtures/dsk-walk/', import.meta.url);
  const out: LabelPair[] = [];
  for (const file of readdirSync(dir).sort()) {
    const json = JSON.parse(readFileSync(new URL(file, dir), 'utf8')) as {
      edge_e_values?: readonly { from_label?: unknown; to_label?: unknown }[];
    };
    for (const edge of json.edge_e_values ?? []) {
      if (typeof edge.from_label === 'string' && typeof edge.to_label === 'string') {
        out.push([edge.from_label, edge.to_label]);
      }
    }
  }
  return out;
}

const C_A: readonly LabelPair[] = liveCapturePairs();

/** C-B — ordinary business English aimed at the veto set / mutation patterns. */
const C_B: readonly LabelPair[] = [
  ['Flip Risk Threshold', 'Revenue'],
  ['Why Customers Churn', 'Retention'],
  ['Compare Group Uptake', 'Adoption'],
  ['Show Me The Money', 'Cash Flow'],
  ['Set Up Cost', 'Margin'],
  ['Change Rate', 'Throughput'],
  ['Add Context Budget', 'Spend'],
  ['Increase 20% Uptake', 'Growth'],
];

const CORPUS: readonly LabelPair[] = [...C_A, ...C_B];

/** The corpus is EVIDENCE, so its own size is pinned — a fixture that stops
 *  loading must RED here rather than making every table below vacuous
 *  (trap 13: an absence probe needs a positive control). */
it('the corpus loaded: live-capture pairs are present and non-trivial', () => {
  expect(C_A.length).toBeGreaterThanOrEqual(20);
  expect(CORPUS.length).toBe(C_A.length + C_B.length);
  // A real producer label, read from the capture — proves these are not ours.
  expect(C_A.some(([, to]) => to === 'Net New ARR Generated')).toBe(true);
});

// ============================================================================
// §1 — the copy
// ============================================================================

describe('§1 the action copy', () => {
  it('T1 offers a PROBE and T2 offers a CHANGE — different questions, different labels', () => {
    expect(OVERRIDE_STRESS_TEST_ACTION_LABEL).toBe('Test this value');
    expect(DISAGREEMENT_ACTION_LABEL).toBe('Adjust this relationship');
  });

  it('T1 names the edge with the `→` spelling and asks what would flip', () => {
    expect(composeOverrideActionPrompt('Sales Effort', 'Revenue')).toBe(
      'Show me what would flip the result if the Sales Effort → Revenue link were different.',
    );
  });

  it('T2 IS the proven fragile-edge string — one definition, never a hand copy', () => {
    // Byte equality against the fragile-edge composer, over the whole corpus:
    // ROADMAP 2.1004 measured THAT sentence at 3/3, and a re-typed twin would
    // drift the first time either is reworded (trap 12).
    for (const [from, to] of CORPUS) {
      expect(composeDisagreementActionPrompt(from, to)).toBe(
        composeFragileEdgeActionPrompt(from, to),
      );
    }
  });

  it('T2 names the edge in the RIGHT DIRECTION (a literal, not a derivation)', () => {
    // ⚠ THIS ASSERTION EXISTS BECAUSE THE ONE ABOVE CANNOT SEE A REVERSAL, AND A
    // MUTANT PROVED IT. Reversing `composeFragileEdgeActionPrompt`'s arguments
    // left the equality above GREEN on all 30 corpus members — both sides move
    // together, so it is a guard agreeing with itself (trap 13b). The delegation
    // check answers "are these the same sentence?"; only a literal answers "is
    // the sentence right?". Distinguishable endpoint labels, so a swap REDs.
    expect(composeDisagreementActionPrompt('Sales Effort', 'Revenue')).toBe(
      'Adjust the strength of the link from Sales Effort to Revenue in my model.',
    );
  });

  it('the T1 copy itself trips the meta-question veto — why one conjunct is currently inert', () => {
    // DISCLOSURE, MADE FAIL-LOUD. `isOverrideActionComposable` also asserts
    // `isAnalyticalQuestion`, and a mutant proved that conjunct is currently
    // NON-DISCRIMINATING: the shipped copy contains "show me", "what would" and
    // "flip", all in `EDIT_GRAPH_NEGATIVE_REGEX`, so `isEditGraphDispatchable`
    // is already false for every label and the analytical conjunct can never be
    // the deciding one. It stays because it binds to the conjunct of
    // `route-v2`'s `editVerbCandidate` that actually suppresses edit dispatch
    // for a question — but a redundancy nobody can see is how a guard quietly
    // stops meaning anything, so the PRECONDITION for its redundancy is pinned
    // here instead: reword the copy past the veto set and this REDs, pointing
    // the next reader at the conjunct that has just become load-bearing.
    for (const [from, to] of CORPUS) {
      const prompt = composeOverrideActionPrompt(from, to);
      expect(/\b(?:flip|show me|what would)\b/i.test(prompt)).toBe(true);
      expect(isEditGraphDispatchable(prompt)).toBe(false);
    }
  });

  it('no causal connective in either prompt (temporal-not-causal is binding)', () => {
    const causal = /\b(because|caused|is why|as a result of|due to)\b/i;
    for (const [from, to] of CORPUS) {
      expect(causal.test(composeOverrideActionPrompt(from, to))).toBe(false);
      expect(causal.test(composeDisagreementActionPrompt(from, to))).toBe(false);
    }
  });
});

// ============================================================================
// §2 — polarity, on the route's OWN predicates, both directions on one corpus
// ============================================================================

describe('§2 the two prompts have OPPOSITE routing polarity', () => {
  it('T1 can never be read as an edit instruction, on every corpus member', () => {
    for (const [from, to] of CORPUS) {
      const prompt = composeOverrideActionPrompt(from, to);
      // The route's composite edit-dispatch predicate (positive ∧ ¬negative).
      expect(isEditGraphDispatchable(prompt)).toBe(false);
      // …and the conjunct that suppresses edit dispatch for a question, which is
      // what keeps this true even when a PRODUCER label supplies an edit verb.
      expect(isAnalyticalQuestion(prompt)).toBe(true);
    }
  });

  it('OPPOSITE TWIN: T2 IS an edit instruction on every capture pair', () => {
    // The same corpus, the opposite expectation. C-B is excluded from the
    // must-dispatch half BY CONSTRUCTION: those labels exist to trip the veto,
    // and §4 asserts they drop the action rather than shipping it inert.
    //
    // ⚠ NOTE WHAT THIS DOES AND DOES NOT PROVE. `isEditGraphDispatchable` is the
    // body of `isDisagreementActionComposable`, so on its own this is a guard
    // agreeing with itself: it covers 2 of `route-v2`'s 5 conjuncts and is blind
    // to the other three. §6 rebuilds the route's whole predicate and pins the
    // residue. This assertion stays as the DIRECTIONAL twin of T1's — it is the
    // polarity claim, not the routing claim.
    for (const [from, to] of C_A) {
      expect(isEditGraphDispatchable(composeDisagreementActionPrompt(from, to))).toBe(true);
    }
  });

  it('T1 classifies as the flip probe; T2 does not classify as one', () => {
    for (const [from, to] of CORPUS) {
      expect(classifyAnalyticalIntent(composeOverrideActionPrompt(from, to))).toBe(
        'what_would_flip',
      );
      expect(classifyAnalyticalIntent(composeDisagreementActionPrompt(from, to))).not.toBe(
        'what_would_flip',
      );
    }
  });
});

// ============================================================================
// §3 — the LIVE free-text route, end to end, and the design's refutation
// ============================================================================

const FRESH_ANALYSIS: AdviceGateAnalysis = {
  status: 'ready',
  leading_option: { label: 'Partner-led expansion' },
  runner_up: { label: 'Direct sales build-out' },
  margin_pp: 12,
  robustness_band: 'moderate',
  top_drivers: [{ factor_label: 'Partner Channel Investment' }],
};

function gate(message: string) {
  return tryPostAnalysisAdviceGate({
    message,
    analysis: FRESH_ANALYSIS,
    freshness: 'fresh',
  });
}

describe('§3 T1 reaches the free-text what_would_flip class (the real gate)', () => {
  it('the leaf predicate and the REAL gate agree pair-for-pair, in BOTH directions', () => {
    // This is the load-bearing assertion of the whole spec, and it is an
    // agreement check rather than a restatement: `isOverrideActionComposable` is
    // a cheap pure predicate, `tryPostAnalysisAdviceGate` is the surface that
    // actually answers the turn. If they disagree in EITHER direction the button
    // is wrong — a false `true` ships a dead chip (2.770), a false `false`
    // withholds an action that would have worked.
    let admitted = 0;
    let refused = 0;
    for (const [from, to] of CORPUS) {
      const result = gate(composeOverrideActionPrompt(from, to));
      const composable = isOverrideActionComposable(from, to);
      expect(composable).toBe(result.matched);
      if (result.matched) {
        expect(result.advice_class).toBe('what_would_flip_free_text');
        admitted += 1;
      } else {
        refused += 1;
      }
    }
    // Both arms are non-empty, so neither direction of the agreement is vacuous
    // (a corpus where everything is admitted proves nothing about the refusals).
    expect(admitted).toBeGreaterThanOrEqual(20);
    expect(refused).toBeGreaterThanOrEqual(2);
  });

  it('PHRASING PIN: the `→` spelling survives edit-verb labels the design phrasing does not', () => {
    // Same gate, same fixture, same labels — only the phrasing differs. Kept as a
    // test so a rewrite back to `from … to …` REDs on the class it breaks
    // instead of shipping a button that terminates in the generic router.
    //
    // ⚠ The claim is NARROW and is the corrected one: on the live captures the
    // two phrasings are IDENTICAL. The divergence is a label class, not a
    // universal, and it is asserted where it was measured.
    const designPhrasing = (from: string, to: string) =>
      `Show me what would flip the result if the link from ${from} to ${to} were different.`;

    // Direction 1 — the live captures: no divergence at all.
    for (const [from, to] of C_A) {
      expect(gate(designPhrasing(from, to)).matched).toBe(
        gate(composeOverrideActionPrompt(from, to)).matched,
      );
    }

    // Direction 2 — a producer label carrying an edit verb: the design phrasing
    // forms `<verb> … to <X>`, an INDEPENDENT mutation signal, which is exactly
    // what denies the gate's narrow flip exception. The `→` spelling does not.
    const divergent: readonly LabelPair[] = [
      ['Set Up Cost', 'Margin'],
      ['Change Rate', 'Throughput'],
    ];
    for (const [from, to] of divergent) {
      const design = designPhrasing(from, to);
      const shipped = composeOverrideActionPrompt(from, to);
      expect(hasIndependentMutationSignal(design)).toBe(true);
      expect(hasIndependentMutationSignal(shipped)).toBe(false);
      const designResult = gate(design);
      expect(designResult.matched).toBe(false);
      if (!designResult.matched) expect(designResult.reason).toBe('mutation_signal');
      expect(gate(shipped).matched).toBe(true);
    }
  });
});

// ============================================================================
// §4 — composability: the ACTION drops, the CARD does not
// ============================================================================

describe('§4 an unphrasable action costs the action, never the card', () => {
  it('the veto-tripping labels drop T2’s action', () => {
    const vetoed = C_B.filter(([from, to]) =>
      /\b(?:explain|compare|flip|why|how does|tell me|show me|describe|set up|add (?:some |any |more )?(?:context|information|detail|details|background))\b/i.test(
        composeDisagreementActionPrompt(from, to),
      ),
    );
    expect(vetoed.length).toBeGreaterThanOrEqual(5);
    for (const [from, to] of vetoed) {
      expect(isDisagreementActionComposable(from, to)).toBe(false);
      // OPPOSITE DIRECTION, same labels: the CARD still composes, so the lens
      // keeps its slot and the user keeps the finding. This is the behaviour
      // that would have regressed had the action gate been folded into the
      // eligibility predicate.
      expect(isDisagreementOfferComposable(from, to)).toBe(true);
    }
  });

  it('a label carrying a magnitude drops T1’s action but keeps T1’s card', () => {
    // "Raise Group Operating Profit by 8% Within 18 Months" is a REAL capture
    // label; verb+digits is an ALWAYS_INDEPENDENT mutation pattern, so the
    // advice gate's flip exception would be denied and the button would be dead.
    const magnitude = C_A.filter(([from, to]) =>
      hasIndependentMutationSignal(composeOverrideActionPrompt(from, to)),
    );
    expect(magnitude.length).toBeGreaterThanOrEqual(1);
    for (const [from, to] of magnitude) {
      expect(isOverrideActionComposable(from, to)).toBe(false);
      expect(isOverrideOfferComposable(from, to)).toBe(true);
      // …and the gate is right to refuse: the real gate rejects it too.
      const result = gate(composeOverrideActionPrompt(from, to));
      expect(result.matched).toBe(false);
    }
  });

  it('every OTHER live pair composes both actions', () => {
    const ok = C_A.filter(([from, to]) => !hasIndependentMutationSignal(composeOverrideActionPrompt(from, to)));
    expect(ok.length).toBeGreaterThanOrEqual(15);
    for (const [from, to] of ok) {
      expect(isOverrideActionComposable(from, to)).toBe(true);
      expect(isDisagreementActionComposable(from, to)).toBe(true);
    }
  });
});

// ============================================================================
// §5 — the length gate: a prompt is never TRUNCATED into a different route
// ============================================================================

// ============================================================================
// §6 — the ROUTE'S OWN predicate, rebuilt from its own imports
// ============================================================================

/**
 * `route-v2.ts:4128`'s `editVerbCandidate`, reconstructed from THE SAME five
 * pure predicates the route imports — never a re-stated regex. All five are
 * `(message: string) => boolean` with no I/O, so the whole conjunction is
 * derivable in a unit test.
 *
 * ⚠ SCOPE: this is `editVerbCandidate`, not the full `editIntentDetected` at
 * `:4432`, which additionally admits `configureOptionIntent` /
 * `structuralRestructureIntent` and subtracts `proposalConfirmSuppressed` and the
 * edge-chip door. Those need turn state a unit test does not have. Stated so the
 * next reader inherits the boundary rather than the number.
 */
function editVerbCandidate(message: string): boolean {
  return (
    EDIT_GRAPH_POSITIVE_REGEX.test(message) &&
    !EDIT_GRAPH_NEGATIVE_REGEX.test(message) &&
    !shouldSuppressEditDispatchForValueUpdate(message) &&
    !isAnalyticalQuestion(message) &&
    !isStateQueryQuestionShape(message)
  );
}

describe('§6 measured against the route’s own five-conjunct predicate', () => {
  it('T1 is never an edit under ALL FIVE conjuncts, not merely under two', () => {
    // §2 asserts T1 against `isEditGraphDispatchable`, which is 2 of 5. This is
    // the whole predicate, and it is the assertion that actually says "a probe
    // cannot mutate the graph".
    for (const [from, to] of CORPUS) {
      expect(editVerbCandidate(composeOverrideActionPrompt(from, to))).toBe(false);
    }
  });

  it('KNOWN-DIVERGENT SET: T2 clears our gate but not the route on EXACTLY these pairs', () => {
    // ⚠ THIS EXISTS BECAUSE §2'S T2 ASSERTION WAS A GUARD AGREEING WITH ITSELF.
    // It asserted `isEditGraphDispatchable(prompt) === true` — the predicate's
    // own body — so it could never observe the three conjuncts the predicate
    // does not implement. Rebuilding the route's predicate found real residue.
    //
    // Pinned as an EXACT SET, so it REDs if it GROWS *or* SHRINKS: a gap
    // recorded in the suite is honest, a gap invisible to it is how a wrong
    // guarantee survives. Bound by label identity, never by a count.
    const divergent = CORPUS.filter(
      ([from, to]) =>
        isDisagreementActionComposable(from, to) &&
        !editVerbCandidate(composeDisagreementActionPrompt(from, to)),
    );
    expect(divergent).toStrictEqual([
      ['Operating Profit Uplift', 'Raise Group Operating Profit by 8% Within 18 Months'],
      ['Flour Cost Margin Squeeze', 'Raise Group Operating Profit by 8% Within 18 Months'],
    ]);
    // The MECHANISM, derived rather than described: it is the value-update
    // conjunct, and the phrasing comes from the PRODUCER LABEL ("Raise … by 8%"),
    // not from our copy.
    for (const [from, to] of divergent) {
      const prompt = composeDisagreementActionPrompt(from, to);
      expect(shouldSuppressEditDispatchForValueUpdate(prompt)).toBe(true);
      expect(isAnalyticalQuestion(prompt)).toBe(false);
      expect(isStateQueryQuestionShape(prompt)).toBe(false);
    }
  });

  it('the divergence is INHERITED from the fragile-edge lens, not introduced here', () => {
    // The already-shipped lens composes the IDENTICAL string from the same
    // labels and mis-routes identically. This PR does not create the residue; it
    // makes it visible. Rowed separately.
    for (const [from, to] of CORPUS) {
      const t2 = composeDisagreementActionPrompt(from, to);
      const fragile = composeFragileEdgeActionPrompt(from, to);
      expect(t2).toBe(fragile);
      if (isDisagreementActionComposable(from, to) && !editVerbCandidate(t2)) {
        expect(isFragileEdgeOfferComposable(from, to)).toBe(true);
        expect(editVerbCandidate(fragile)).toBe(false);
      }
    }
  });

  it('POSITIVE CONTROL: the rebuilt predicate DOES say yes to ordinary edit turns', () => {
    // Without this the two assertions above could both pass on a predicate that
    // returns false for everything (trap 13 — an absence probe needs to prove it
    // can see a presence).
    expect(editVerbCandidate('Adjust the strength of the link from Sales Effort to Revenue in my model.')).toBe(true);
    const admitted = CORPUS.filter(
      ([from, to]) =>
        isDisagreementActionComposable(from, to) &&
        editVerbCandidate(composeDisagreementActionPrompt(from, to)),
    );
    expect(admitted.length).toBeGreaterThanOrEqual(20);
  });
});

describe('§5 the action prompt survives the contract cap untruncated', () => {
  it('a pair the naming sentence admits can still overflow the prompt cap — and is refused', () => {
    // DERIVED, not asserted: find the longest label pair the CARD gate admits,
    // then show the T1 prompt built from it exceeds ACTION_PROMPT_MAX. A
    // truncation here could re-cut a word into (or out of) a veto token, which
    // is the exact hazard `buildFragileEdgeOffer` documents.
    const pad = (n: number) => 'A'.repeat(n);
    let longest: LabelPair | null = null;
    for (let n = 300; n > 0; n -= 1) {
      const pair: LabelPair = [pad(n), pad(n)];
      if (isOverrideOfferComposable(pair[0], pair[1])) {
        longest = pair;
        break;
      }
    }
    expect(longest).not.toBeNull();
    const [from, to] = longest!;
    expect(composeOverrideNaming(from, to).length).toBeLessThanOrEqual(COACHING_BLOCK_BODY_MAX);
    expect(composeOverrideActionPrompt(from, to).length).toBeGreaterThan(
      COACHING_ACTION_PROMPT_MAX,
    );
    expect(isOverrideActionComposable(from, to)).toBe(false);
  });

  it('every composable action prompt is within the cap (no truncation reaches the wire)', () => {
    for (const [from, to] of CORPUS) {
      if (isOverrideActionComposable(from, to)) {
        expect(composeOverrideActionPrompt(from, to).length).toBeLessThanOrEqual(
          COACHING_ACTION_PROMPT_MAX,
        );
      }
      if (isDisagreementActionComposable(from, to)) {
        expect(composeDisagreementActionPrompt(from, to).length).toBeLessThanOrEqual(
          COACHING_ACTION_PROMPT_MAX,
        );
      }
      // The naming sentences are untouched by this slice.
      expect(typeof composeDisagreementNaming(from, to)).toBe('string');
    }
  });
});
