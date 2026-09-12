/**
 * THE PRODUCT MUST NOT TELL A USER ITS MODEL CONTAINS NO REFERENT FOR A STATED
 * LIMIT WHEN THE MODEL PLAINLY CONTAINS ONE.
 *
 * ⚠⚠ THE DEFECT, REPRODUCED ON THE DEPLOYED BUILD (2212ae0, 2026-09-13). A
 * founder's first brief opened with:
 *
 *     "…while keeping monthly churn under 4%…"
 *
 * and his drafted model contained a node labelled `Pro Subscriber Churn Rate`.
 * The product's FIRST message to him was:
 *
 *     "Limit to confirm: You set a limit of 4% in your brief and I could not
 *      match it to anything on the model."
 *
 * It had built the node, named it almost exactly as he said it, and then told
 * him it could not find it.
 *
 * ⭐ THREE CASES, AND ONLY ONE OF THEM MAKES THAT SENTENCE FALSE:
 *   (a) the DIRECTION is genuinely ambiguous  → ask. Correct today; ratified.
 *   (b) the referent is genuinely ABSENT      → ask, and the sentence is TRUE.
 *   (c) the referent is PRESENT and BINDING FAILED → the sentence is a FALSE
 *       STATEMENT ABOUT THE MODEL'S OWN CONTENTS.
 *
 * ⭐ CASE (c) IS PROVEN HERE ON CAPTURED DEPLOYED DATA, NOT ON AN AUTHORED NODE
 * SET (trap 16-inverse). The sibling fixture `staging-budget-brief-node-sets-
 * 2026-08-30.json` is transcribed verbatim from 10 real staging runs. In all
 * SEVEN drop runs the model carries TWO OR THREE nodes whose labels contain the
 * user's own word "budget" (`Annual Support Budget Consumed`, `Budget Overrun
 * Risk`, `Remaining Annual Budget`) — and the constraint is dropped anyway,
 * because the binder matches on the node-ID stem and a hand-maintained alias
 * table rather than on the label the user reads. The card then announces that
 * nothing on the model matched. That is case (c), captured, seven times over.
 *
 * ⭐ AND THE ADMIT TWIN IS CAPTURED TOO: run `4fd953` carries ZERO budget-family
 * nodes — genuine case (b). The ask must still fire there. A corpus containing
 * only (c) could not see (b) being broken, and a corpus containing neither (a)
 * nor (b) could not see the ratified behaviours being damaged.
 *
 * ⚠ THE INVARIANT IS WRITTEN AGAINST THE SPEC, NOT AGAINST THE FAILURE MODE IN
 * HAND (trap 13d). The rule is "do not make an existential claim about the
 * model's contents", so the assertion screens a FAMILY of absence phrasings —
 * not just the one clause shipped today. A fix that merely rewords the same lie
 * must still go red.
 *
 * Assertions bind to the record by `reason` IDENTITY (trap 19): the item under
 * test is selected as the `target_unmatched` record and rendered ALONE, so the
 * asserted card cannot be some other row that happens to carry a similar string.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { runCompoundGoals } from '../compound-goals.js';
import { renderDirectionClarifications } from '../../../../compound-goal/direction-gate.js';

const HERE = dirname(fileURLToPath(import.meta.url));

interface CapturedNode {
  readonly id: string;
  readonly kind?: string;
  readonly label?: string;
}

const NODE_SETS = JSON.parse(
  readFileSync(resolve(HERE, 'fixtures/staging-budget-brief-node-sets-2026-08-30.json'), 'utf-8'),
) as Record<string, CapturedNode[]>;

/** Byte-identical to the brief all 10 captured runs were driven with. */
const BRIEF =
  'Should we hire three more support engineers next quarter, or hold the headcount we have? ' +
  'Our support budget for the year is £240,000 and each engineer costs about £65,000 fully loaded. ' +
  'Ticket backlog has roughly doubled since January. ' +
  'The goal is to bring first-response time back under four hours without going over budget.';

/** Captured runs that DROPPED the £240,000 while budget-labelled nodes existed. */
const CASE_C_RUNS = ['272c16', 'f887d4', 'f869d0', '75900a', '63d377', '150852', 'd2a1e8'] as const;
/** The captured run carrying NO budget-family node at all — genuine case (b). */
const CASE_B_RUN = '4fd953';

/**
 * The family of EXISTENTIAL ABSENCE claims about the model's contents. Saying
 * any of these is a statement about what the model HOLDS, which the product is
 * not entitled to make when it only knows that its own binder failed.
 */
const EXISTENTIAL_ABSENCE_CLAIMS: readonly RegExp[] = [
  /match(ed)? it to anything on the model/i,
  /nothing on the model/i,
  /no(thing)? part of (the|your) model/i,
  /(isn't|is not|not) on (the|your) model/i,
  /(couldn't|could not|cannot|can't) find it on (the|your) model/i,
  /there is nothing (on|in) (the|your) model/i,
];

function drive(nodes: readonly CapturedNode[]) {
  const ctx: any = {
    requestId: 'test-target-unmatched-copy-honesty',
    effectiveBrief: BRIEF,
    graph: { nodes: nodes.map((n) => ({ ...n })), edges: [] },
    llmGoalConstraints: undefined,
    goalConstraints: undefined,
    directionUnresolved: undefined,
  };
  runCompoundGoals(ctx);
  const wire = (ctx.goalConstraints ?? []) as Array<{ node_id: string; value: number }>;
  const items = (ctx.directionUnresolved ?? []) as Array<{ reason: string; value: number | null }>;
  const unmatched = items.find((i) => i.reason === 'target_unmatched');
  // Render the ONE record under test alone — the card cannot be another row's.
  const card = unmatched ? renderDirectionClarifications([unmatched] as any)[0] : undefined;
  return { wire, items, unmatched, card };
}

/** How many nodes of this captured set a user would read as "budget"? */
function budgetLabelCount(nodes: readonly CapturedNode[]): number {
  return nodes.filter((n) => String(n.label ?? '').toLowerCase().includes('budget')).length;
}

describe('a limit that failed to bind must not be reported as absent from the model', () => {
  it.each(CASE_C_RUNS)(
    'CASE (c) — run %s: the model HOLDS a budget node, the limit is dropped, and the card must not claim otherwise',
    (id) => {
      const nodes = NODE_SETS[id]!;

      // ── Preconditions pinned IN-TEST (trap 13b), so this cannot pass
      //    vacuously if the fixture or the binder ever stops reproducing (c).
      const referents = budgetLabelCount(nodes);
      expect(referents, `run ${id} must carry a plausible referent for this to be case (c)`)
        .toBeGreaterThanOrEqual(1);

      const { wire, unmatched, card } = drive(nodes);
      expect(wire.filter((c) => c.value === 240000), `run ${id} must still DROP the limit`)
        .toHaveLength(0);
      expect(unmatched, `run ${id} must ask about the unbindable limit`).toBeDefined();
      expect(card, `run ${id} must render a coaching card`).toBeDefined();

      // ── THE ACCEPTANCE: no existential claim about the model's contents.
      for (const claim of EXISTENTIAL_ABSENCE_CLAIMS) {
        expect(
          card!.detail,
          `run ${id}: the model holds ${referents} budget-labelled node(s), so "${claim}" is a FALSE statement about the model`,
        ).not.toMatch(claim);
      }
    },
  );

  it('CASE (c) — the card still ASKS, still says the limit is unenforced, and still offers the action', () => {
    // Removing the false clause must not remove the card's job. Without this,
    // deleting the whole sentence would satisfy the acceptance above.
    const { card } = drive(NODE_SETS['272c16']!);
    expect(card).toBeDefined();
    // ⚠ BIND TO THE COMPOSED QUESTION ITSELF (trap 19). An earlier draft of this
    // spec asserted `toContain('part of')` — which the honest clause "I could
    // not attach it to the right part of the model" ALSO satisfies, so a mutant
    // that deleted the question outright SURVIVED. The assertion must name the
    // question, not a substring two different sentences share.
    expect(card!.detail).toContain('Which part of your model does £240,000 apply to?');
    expect(card!.detail.toLowerCase()).toContain('not being enforced');
    expect(card!.action_type).toBe('add_constraint');
    expect(card!.label).toContain('Say which part of the model');
  });

  /**
   * ⭐⭐ THE COPY IS CHARACTER-BUDGETED, AND THE COUPLING IS INVISIBLE FROM HERE.
   * The post-draft narrative's direction-only rung has a length budget. The
   * FIRST draft of this fix made the sentence six characters LONGER, which blew
   * that budget and silently dropped the SECOND limit question from short
   * drafts — a user-visible regression, caught only because
   * `first-response-stated-limit-order.test.ts` pins a deliberately short
   * fixture. Growing the fixed content ADDS a block; that spec's own comment
   * says so.
   *
   * This guard puts the constraint in the file that OWNS the copy, so the next
   * person to reword it fails here rather than in a distant ordering spec. 242
   * is the length of the copy this fix replaced, measured on this fixture — the
   * replacement must not be longer than the sentence it replaced.
   */
  it('the card copy must not grow past the copy it replaced — the rung is character-budgeted', () => {
    const { card } = drive(NODE_SETS['272c16']!);
    expect(card).toBeDefined();
    expect(
      card!.detail.length,
      'a longer sentence blows the direction-only rung budget and drops a limit question',
    ).toBeLessThanOrEqual(242);
  });

  it('ADMIT TWIN, CASE (b) — a run with NO budget node still asks about the limit', () => {
    const nodes = NODE_SETS[CASE_B_RUN]!;
    // Precondition: this is genuinely case (b) — the referent really is absent.
    expect(budgetLabelCount(nodes), 'run 4fd953 must carry NO budget-family node').toBe(0);

    const { wire, unmatched, card } = drive(nodes);
    expect(wire.filter((c) => c.value === 240000)).toHaveLength(0);
    expect(unmatched, 'an absent referent must STILL be asked about').toBeDefined();
    expect(card, 'case (b) must still render a card').toBeDefined();
    expect(card!.detail).toContain('Which part of your model does £240,000 apply to?');
    expect(card!.detail.toLowerCase()).toContain('not being enforced');
  });

  it('ADMIT TWIN, CASE (a) — a genuinely direction-ambiguous limit still gets the floor-or-ceiling question', () => {
    // ⭐ THE CASE THIS FIX MUST NOT DAMAGE. Case (a) is working and ratified;
    // a corpus testing only (c) cannot see it being broken.
    const ctx: any = {
      requestId: 'test-case-a-twin',
      effectiveBrief:
        'We are weighing two plans. Do not, and this is firm, let gross margin drop below 78%.',
      graph: {
        nodes: [
          { id: 'fac_gross_margin', kind: 'factor', label: 'Gross Margin' },
          { id: 'opt_plan_a', kind: 'option', label: 'Plan A' },
        ],
        edges: [],
      },
      goalConstraints: undefined,
      directionUnresolved: undefined,
    };
    runCompoundGoals(ctx);
    const items = (ctx.directionUnresolved ?? []) as Array<{ reason: string }>;
    const directional = items.find((i) => i.reason !== 'target_unmatched');
    expect(directional, 'a direction-ambiguous limit must still be raised').toBeDefined();

    const card = renderDirectionClarifications([directional] as any)[0]!;
    // The ratified case-(a) copy, unchanged.
    expect(card.detail).toContain('at or above');
    expect(card.detail).toContain('I could not tell from the wording');
    expect(card.label).toContain('Confirm the direction');
  });
});
