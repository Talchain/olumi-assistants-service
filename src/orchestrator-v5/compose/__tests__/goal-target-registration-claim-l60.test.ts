/**
 * L64 — the ALREADY-REGISTERED paraphrase class (L60 diagnosis OBS 3).
 *
 * LIVE DEFECT, persisted-truth-verified (staging, guest session 2026-08-03,
 * scenario 04f53491-2fc1-4681-8ff5-faf58e255649 "Grow MRR to £250,000"):
 * the user stated an explicit success target through the Hero success field;
 * the turn routed `direct_answer` with `handler = null`, and the assistant
 * replied that the target was ALREADY in place. The persisted graph at that
 * moment (fixture below, taken from the real `scenarios.graph` row) carried a
 * BARE goal node — no `goal_threshold_raw` — and exactly one constraint
 * (gross margin), no churn ceiling. The false "already recorded" claim
 * CANCELLED the registration the Save-success flow exists to perform: the
 * user's target never reached the server in either captured scenario.
 *
 * The receipt-honesty gate for this exact claim (`decideGoalTargetReceipt`)
 * already existed at `a6f52ac6` and was already wired PRE-COMMIT at the
 * turn-executor STEP 7 chokepoint, which is NOT handler-gated — so it ran on
 * this turn. It did not FIRE because its detector required the literal
 * bigram "success target"; both live claims paraphrase the noun ("that
 * target", "the ARR growth target") and one uses a verb ("built in") the
 * list did not carry.
 *
 * These pins are IDENTITY-BOUND: the claim strings are the verbatim live
 * assistant prose, and the "not registered" side is the real persisted graph,
 * asserted through the same `goal_threshold_raw` marker `has_goal_target` /
 * the UI goal chip / PLoT's explicit-threshold path key on — never a value
 * predicate another object could satisfy.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  GOAL_TARGET_NOT_SAVED_TEXT,
  claimsGoalTargetRegistration,
  decideGoalTargetReceipt,
  graphRegistersGoalTarget,
} from '../goal-target-receipt-guard.js';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
} from '../forbidden-user-facing-phrases.js';

/**
 * The real persisted `scenarios.graph` for the pricing scenario, verbatim
 * from `PHASE0-EVIDENCE-2026-07-28/l60-artefacts/scenario-pricing.json`
 * (L60's Supabase pull). Subset taken: `schema_version`, `goal_node_id`,
 * `nodes`, `edges`, `goal_constraints` — the guard reads `nodes` only; the
 * dropped keys (`meta`, `trace`, `coaching`, `analysis_ready`, `quality`,
 * timings) are not read by any code under test and are disclosed here so the
 * fixture is not mistaken for the whole row.
 */
const PRICING_PERSISTED_GRAPH = JSON.parse(
  readFileSync(
    new URL('./fixtures/l60/pricing-persisted-graph.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

/** Verbatim live assistant prose, pricing turn 2026-08-03T22:28:00Z. */
const LIVE_PRICING_FALSE_CLAIM =
  'The model already has that target in place: growing MRR to £250,000 is ' +
  'set as the goal, alongside your churn ceiling (below 3%) and gross margin ' +
  'floor (above 80%, already recorded as a constraint). There\'s nothing ' +
  'further to add for the MRR figure itself.';

/** Verbatim live assistant prose, people turn 2026-08-03T22:32:51Z. */
const LIVE_PEOPLE_FALSE_CLAIM =
  'The model already has the ARR growth target built in as the goal.';

const registeringGraph = {
  nodes: [{ id: 'goal_mrr', kind: 'goal', label: 'Grow MRR to £250,000', goal_threshold_raw: 250000 }],
  edges: [],
};

describe('L60 OBS 3 — the persisted truth the live claim contradicted', () => {
  it('the REAL pricing goal node is bare: identity-bound on goal_mrr, no goal_threshold_raw, so the graph registers no target', () => {
    const nodes = PRICING_PERSISTED_GRAPH.nodes as Array<Record<string, unknown>>;
    const goal = nodes.find((n) => n.id === 'goal_mrr');
    expect(goal).toBeDefined();
    expect(goal!.kind).toBe('goal');
    expect(goal!.label).toBe('Grow MRR to £250,000');
    expect('goal_threshold_raw' in goal!).toBe(false);
    expect(PRICING_PERSISTED_GRAPH.goal_node_id).toBe('goal_mrr');
    expect(graphRegistersGoalTarget(PRICING_PERSISTED_GRAPH)).toBe(false);
  });

  it('the REAL graph carries ONE constraint (gross margin) and no churn ceiling — the second false clause in the same sentence', () => {
    const constraints = PRICING_PERSISTED_GRAPH.goal_constraints as Array<
      Record<string, unknown>
    >;
    expect(constraints).toHaveLength(1);
    expect(constraints[0]!.constraint_id).toBe('constraint_out_gross_margin_min');
    expect(constraints[0]!.node_id).toBe('out_gross_margin');
    expect(
      constraints.some((c) => typeof c.node_id === 'string' && c.node_id.includes('churn')),
    ).toBe(false);
  });
});

describe('claimsGoalTargetRegistration — ALREADY-REGISTERED paraphrase arm (L64)', () => {
  it('RED-first: the verbatim live PRICING claim is a registration claim', () => {
    expect(claimsGoalTargetRegistration(LIVE_PRICING_FALSE_CLAIM)).toBe(true);
  });

  it('RED-first: the verbatim live PEOPLE claim ("built in as the goal") is a registration claim', () => {
    expect(claimsGoalTargetRegistration(LIVE_PEOPLE_FALSE_CLAIM)).toBe(true);
  });

  it('covers the near-paraphrases of the same class', () => {
    expect(
      claimsGoalTargetRegistration('Your revenue target is already registered on the goal.'),
    ).toBe(true);
    expect(
      claimsGoalTargetRegistration('The model currently has that target recorded.'),
    ).toBe(true);
  });

  it('NEGATIVE CONTROL — a non-goal "target" noun with a mutation verb is NOT a registration claim (a set_factor_value receipt must never be swapped)', () => {
    // No already/currently possession marker: the arm must not reach these.
    expect(
      claimsGoalTargetRegistration('Updated the target factor: Price sensitivity is set to 0.75.'),
    ).toBe(false);
    expect(
      claimsGoalTargetRegistration("I've set the target node's value to 0.75."),
    ).toBe(false);
    // Possession marker present, but the noun is a graph object, not a target.
    expect(
      claimsGoalTargetRegistration('The model already has that target factor set to 0.75.'),
    ).toBe(false);
  });

  it('NEGATIVE CONTROL — offers, questions and negations stay non-claims', () => {
    expect(
      claimsGoalTargetRegistration('Does the model already have that target in place?'),
    ).toBe(false);
    expect(
      claimsGoalTargetRegistration('The model does not already have that target in place.'),
    ).toBe(false);
    expect(
      claimsGoalTargetRegistration('Once that target is already in place I can score it.'),
    ).toBe(false);
  });

  it('NEGATIVE CONTROL — the honest fallbacks are not themselves claims (no swap loop)', () => {
    expect(claimsGoalTargetRegistration(GOAL_TARGET_NOT_SAVED_TEXT)).toBe(false);
  });
});

/**
 * Hand-written boundary CORPUS (trap 12d). The arms above are pinned by the
 * live prose and by targeted controls; those answer "are these consistent?"
 * and can never answer "is the boundary in the right place?". This corpus is
 * the second guard: real sentences either side of the line, including the two
 * COUPLINGS the arms silently depend on —
 *   - the pre-existing sentence-level NEGATION/CONDITIONAL screen (without it,
 *     "you already have a goal, but no target is set yet" — honest coaching —
 *     matches arm A and gets swapped);
 *   - arm B's marker ADJACENCY (without it, a `;`-joined clause carrying an
 *     unrelated "already set" binds to an earlier "target" and swaps a
 *     truthful set_factor_value receipt; `;` is not a sentence boundary in
 *     `sentencesOf`).
 * Delete either coupling and this corpus goes red where the targeted pins do not.
 */
describe('claimsGoalTargetRegistration — hand-written boundary corpus', () => {
  const CORPUS: ReadonlyArray<readonly [string, boolean]> = [
    // In class — a state claim about the persisted model.
    ['The model already has that target in place.', true],
    ['The model already has the ARR growth target built in as the goal.', true],
    ['Your revenue target is already registered on the goal.', true],
    ['We already recorded that target.', true],
    // Out of class — ordinary receipts, honest coaching, offers, questions.
    ['Updated the target factor: Price sensitivity is set to 0.75.', false],
    ['You already have a goal, but no target is set yet.', false],
    ['The target is the goal node; I have already set Price sensitivity to 0.75.', false],
    ['I already updated your target value to 0.75.', false],
    ['Once a target is already in place I can score the options.', false],
    ['Does the model already have that target in place?', false],
    ['You could set a success target of 15% to see your chances.', false],
    ['I have already added two options to the model.', false],
    // Out of class BY DESIGN — a CONSTRAINT-registration claim is a different
    // class this guard does not own (documented residual). It must not be
    // silently absorbed here, where the target state check would judge it.
    ['Your churn ceiling is already recorded as a constraint.', false],
  ];

  for (const [text, isClaim] of CORPUS) {
    it(`${isClaim ? 'CLAIM' : 'not a claim'}: ${text}`, () => {
      expect(claimsGoalTargetRegistration(text)).toBe(isClaim);
    });
  }
});

/**
 * F1 OVER-FIRE CORPUS (review round 2) — the direction that DESTROYS WORK.
 *
 * Every shape below is truthful or neutral prose that a real turn could emit,
 * and every one FIRED the round-1 arms. That is not a cosmetic miss: at the
 * turn-executor STEP 7 call site a swap also withholds `graphForCommit` and the
 * handler facts, so a false positive on a receipt DESTROYS AN APPLIED CHANGE
 * (see the end-to-end pin in
 * `__tests__/turn-executor-direct-answer-registration-claim.test.ts`).
 *
 * G1-G9 are the reviewer's shapes; G10-G13 are in-class siblings this lane
 * added to motivate the agentive-passive screen specifically — mandatory
 * `already|currently` alone does NOT kill them, because they carry it.
 *
 * Grouped by the gap class each one proves, so a future regression names its
 * own cause rather than just "something over-fires".
 */
describe('claimsGoalTargetRegistration — F1 over-fire corpus (must NEVER fire)', () => {
  const OVER_FIRE: ReadonlyArray<readonly [string, string, string]> = [
    // (1) arm B had no already/currently requirement — any passive "targets are set".
    ['G1', 'no-already passive', 'Sales targets are set by the finance team each quarter.'],
    ['G2', 'no-already passive + real edit receipt', 'Stretch targets are set by leadership, so I have added Leadership buy-in as a factor.'],
    ['G3', 'no-already passive, no agent', 'In most SaaS businesses, growth targets are set annually.'],
    ['G4', 'no-already passive, past', 'The target was set by your CFO last year, before this model existed.'],
    ['G5', 'no-already passive + real edit receipt', 'Growth targets are recorded in your tracker spreadsheet, and I have added a growth factor.'],
    // (2) agentive passive — carries already/currently, so ONLY the `by` screen kills it.
    ['G10', 'agentive passive', 'Sales targets are already set by the finance team each quarter.'],
    ['G11', 'agentive passive', 'Budget targets have been recorded by procurement.'],
    ['G12', 'agentive passive', 'The quarterly target is currently set by head office.'],
    ['G13', 'agentive passive', 'Those targets were already captured by the previous consultant.'],
    // (3) conditional — the honest coaching for the UNREGISTERED state.
    ['G6', 'hypothetical', 'If you had already set a target, the analysis would score your options against it.'],
    // (4) phrasal verb — "set out" means described, not registered.
    ['G7', 'phrasal verb', 'Your target is set out in the strategy brief as a three-year ambition.'],
    // (5) object gap — the verb's real object is "feedback", not "target".
    ['G8', 'object boundary', 'I have already recorded your feedback about the target.'],
    // (6) open-class noun after "target" — the blocklist could never be finished.
    ['G9', 'target as modifier', 'The report already has a target section in place.'],
    // G14/G15 were added by THIS lane after the round-2 mutant sweep, which
    // found two guards that NO test distinguished — both mutants survived. The
    // reviewer's own shapes could not isolate them because a different fix
    // already blocked those sentences. Each of these carries `already`, so the
    // named guard is the ONLY thing standing between it and a swap.
    ['G14', 'phrasal verb WITH already (isolates set-out screen)', 'Your target is already set out in the strategy brief.'],
    ['G15', 'already not adjacent to copula (isolates arm B adjacency)', "The target is the figure already recorded in last year's plan."],
  ];

  for (const [id, why, text] of OVER_FIRE) {
    it(`${id} (${why}): ${text}`, () => {
      expect(claimsGoalTargetRegistration(text)).toBe(false);
    });
  }
});

/**
 * The derived head test replaced a hand-listed noun blocklist. These pin the
 * MECHANISM, not the old list: none of these nouns is enumerated anywhere in
 * the module, and each must still fail because it is an open-class noun rather
 * than a closed-class continuation.
 */
describe('TARGET_IS_PHRASE_HEAD — derived, so unlisted nouns are screened too', () => {
  const UNLISTED_NOUNS = ['section', 'spreadsheet', 'workshop', 'committee', 'paragraph', 'dashboard'];
  for (const noun of UNLISTED_NOUNS) {
    it(`"target ${noun}" is not a success target`, () => {
      expect(
        claimsGoalTargetRegistration(`The model already has a target ${noun} in place.`),
      ).toBe(false);
    });
  }

  it('but a target followed by a CLOSED-class continuation still fires', () => {
    expect(claimsGoalTargetRegistration('The model already has that target in place.')).toBe(true);
    expect(claimsGoalTargetRegistration('We already recorded that target.')).toBe(true);
  });
});

describe('decideGoalTargetReceipt on the live turn shape (direct_answer, no handler, no graph write)', () => {
  it('RED-first: the live PRICING claim against the REAL persisted graph is an UNBACKED claim → swap', () => {
    expect(
      decideGoalTargetReceipt({
        assistantText: LIVE_PRICING_FALSE_CLAIM,
        commitGraph: null, // handler = null, no mutation, no graph written
        persistedGraph: PRICING_PERSISTED_GRAPH,
      }),
    ).toEqual({ verdict: 'swap', reason: 'unbacked_claim' });
  });

  it('RED-first: the live PEOPLE claim on a mutating turn whose commit graph registers no target → swap', () => {
    expect(
      decideGoalTargetReceipt({
        assistantText: LIVE_PEOPLE_FALSE_CLAIM,
        commitGraph: PRICING_PERSISTED_GRAPH, // stands in for a write that did not register
        persistedGraph: PRICING_PERSISTED_GRAPH,
      }),
    ).toEqual({ verdict: 'swap', reason: 'unbacked_claim' });
  });

  it('POSITIVE CONTROL — the SAME prose passes untouched when the target IS registered (a truthful confirmation must survive)', () => {
    expect(
      decideGoalTargetReceipt({
        assistantText: LIVE_PRICING_FALSE_CLAIM,
        commitGraph: null,
        persistedGraph: registeringGraph,
      }),
    ).toEqual({ verdict: 'pass', reason: 'backed_by_persisted_graph' });
    expect(
      decideGoalTargetReceipt({
        assistantText: LIVE_PEOPLE_FALSE_CLAIM,
        commitGraph: registeringGraph,
        persistedGraph: null,
      }),
    ).toEqual({ verdict: 'pass', reason: 'backed_by_commit_graph' });
  });

  it('CONTROL — a factor-value receipt on the same bare graph is untouched (reason no_claim), so ordinary edits cannot be collateral', () => {
    expect(
      decideGoalTargetReceipt({
        assistantText: 'Updated Price sensitivity to 0.75.',
        commitGraph: PRICING_PERSISTED_GRAPH,
        persistedGraph: PRICING_PERSISTED_GRAPH,
      }),
    ).toEqual({ verdict: 'pass', reason: 'no_claim' });
  });
});

describe('honest fallback copy safety under the widened detector', () => {
  it('survives the egress guards', () => {
    expect(findForbiddenPhraseHit(GOAL_TARGET_NOT_SAVED_TEXT)).toBeNull();
    expect(findSuccessClaimHit(GOAL_TARGET_NOT_SAVED_TEXT)).toBeNull();
  });
});
