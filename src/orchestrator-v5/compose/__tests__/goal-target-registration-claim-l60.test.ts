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
