/**
 * ⭐⭐ KIND NARROWING MAY CONFIRM A WINNER. IT MAY NEVER CREATE ONE.
 *
 * ── THE DEFECT THIS CLOSES ───────────────────────────────────────────────────
 * Live journey witness, deployed staging. The user's brief said the platform
 * team is SIX. Both drafted options carried "10 people". The user asked three
 * questions at once (VERBATIM):
 *
 *   "Where did 10 people come from? I told you the platform team is six.
 *    Both your options say 10 people. What else in this model did you make up?"
 *
 * The COMPLETE reply was:
 *
 *   "Keep Platform Team as-is (Status Quo)" was my suggestion, not something
 *   you wrote.
 *
 * Three questions, zero answered, and provenance about a DIFFERENT element than
 * the one asked about.
 *
 * ── THE MECHANISM, DERIVED AT THE BYTES AND REPRODUCED BY EXECUTION ──────────
 * `resolveElement` narrows by the kind word the user typed BEFORE it scores. The
 * third sentence contains "options", so `namedKinds` resolves to `['option']`
 * and the factor `Platform Team Headcount` — the actual subject of "where did 10
 * come from" — is filtered OUT of the candidate set. Among the surviving options
 * one clears the strict-maximum test, and the module returns a canned sentence
 * about it.
 *
 * ⚠ NOTE THE DIRECTION, because it is what makes this worse than a tie. This is
 * NOT a tie the resolver failed to detect. **The right answer was never a
 * candidate**, so the strict-maximum safety net — the module's own defence
 * against answering about the wrong element (trap 19) — could not fire. The
 * header defends the SCORING against exactly this trap; the kind filter runs
 * BEFORE the scoring and is not covered by that defence.
 *
 * ── WHY THIS RULE, AND NOT A PHRASING PREDICATE ──────────────────────────────
 * The containment is purely STATE-DERIVED and fail-closed: score the graph BOTH
 * ways, and if narrowing changes which node wins, that disagreement IS the
 * ambiguity — decline. No natural-language predicate is added, so this cannot
 * start another CEE #888 oscillation (trap 22f).
 *
 * Declining costs a fall-through to the reasoning layer, which this module's own
 * sibling records as "the best provenance answer witnessed on either build"
 * (`state-query-guard.ts`). So the fall-through is strictly BETTER than the
 * canned sentence it replaces — the trade is not "an answer for silence", it is
 * "a confident wrong answer for a real one".
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO (scope boundary) ──────────────────────
 * It does not compose a real answer to the user's question. Answering "where did
 * 10 people come from" from `observed_state.source` is the rowed capability; it
 * needs a ruling on twelve vocabulary literals and one of its candidate
 * discriminators is a natural-language predicate. This lane stops at the
 * boundary: it stops the product asserting a falsehood about the user's own
 * model, and hands the turn to the layer that can answer it.
 */
import { describe, it, expect } from 'vitest';
import { tryStructureOriginAnswer } from '../structure-origin-answer.js';

/**
 * The witnessed shape. Ids are the binding: every assertion below resolves its
 * expectation FROM the node carrying the id, never from a copied string literal,
 * so a test that passes is a test that resolved THAT node (trap 19).
 */
const FACTOR_HEADCOUNT = 'n-factor-platform-headcount';
const OPTION_STATUS_QUO = 'n-option-status-quo';
const OPTION_HIRE = 'n-option-hire';

const WITNESS_NODES = [
  {
    id: FACTOR_HEADCOUNT,
    kind: 'factor',
    label: 'Platform Team Headcount',
    provenance: 'from_brief',
    source_quote: 'the platform team is six',
  },
  {
    id: OPTION_STATUS_QUO,
    kind: 'option',
    label: 'Keep Platform Team as-is (Status Quo)',
    provenance: 'ai_inferred',
  },
  {
    id: OPTION_HIRE,
    kind: 'option',
    label: 'Hire 4 more platform engineers',
    provenance: 'ai_inferred',
  },
] as const;

const WITNESS_GRAPH = { nodes: WITNESS_NODES, edges: [] };

const nodeById = (id: string) => {
  const found = WITNESS_NODES.find((n) => n.id === id);
  if (found === undefined) throw new Error(`fixture has no node ${id}`);
  return found;
};

/** The witness's challenge turn, VERBATIM. Its third sentence says "options". */
const WITNESS_CHALLENGE =
  'Where did 10 people come from? I told you the platform team is six. ' +
  'Both your options say 10 people. What else in this model did you make up?';

describe('resolveElement — kind narrowing may confirm a winner, never create one', () => {
  /**
   * ⭐ THE PRECONDITION PIN, AND IT MUST RUN FIRST (trap 13b).
   *
   * A decline is only evidence about the kind filter if the right answer was
   * genuinely REACHABLE on this message. This asserts it: with the option nodes
   * removed — the only edit being the removal of what the filter selects FOR —
   * the SAME message resolves the factor and answers it honestly from its own
   * persisted record.
   *
   * Without this, the decline below would pass just as well on a fixture that
   * resolves nothing at all, which is a guard agreeing with itself.
   */
  it('PRECONDITION: the factor IS resolvable on this exact message when no option node exists', () => {
    const factor = nodeById(FACTOR_HEADCOUNT);
    const answer = tryStructureOriginAnswer(WITNESS_CHALLENGE, { nodes: [factor], edges: [] });

    expect(answer).toBe(
      `"${factor.label}" came from your brief, not from me. You wrote: "${factor.source_quote}".`,
    );
  });

  /**
   * ⭐ RED-KIND-1 — THE CONTAINMENT.
   *
   * At pristine this returns the witnessed sentence about OPTION_STATUS_QUO,
   * which the precondition above proves is the wrong element. After the fix the
   * disagreement between the narrowed and unnarrowed winners is detected and the
   * turn falls through to the reasoning layer.
   */
  it('RED-KIND-1: declines rather than answering about a node the kind filter selected', () => {
    const answer = tryStructureOriginAnswer(WITNESS_CHALLENGE, WITNESS_GRAPH);

    expect(answer).toBeNull();
  });

  /**
   * ⭐ RED-KIND-2 — THE SAME FACT STATED AS AN IDENTITY, so the failure names the
   * wrong node rather than only reporting "not null".
   *
   * Binds to OPTION_STATUS_QUO by id and reconstructs the exact sentence the
   * composer emits for it. `toBe`, never `toContain`: a containment assertion on
   * a label is satisfiable by any longer string that embeds it.
   */
  it('RED-KIND-2: the answer is not the canned sentence about the status-quo OPTION', () => {
    const wrong = nodeById(OPTION_STATUS_QUO);
    const answer = tryStructureOriginAnswer(WITNESS_CHALLENGE, WITNESS_GRAPH);

    expect(answer).not.toBe(`"${wrong.label}" was my suggestion, not something you wrote.`);
  });

  /**
   * ⭐ RED-KIND-3 — THE SECOND DISAGREEMENT SHAPE, AND IT WAS FOUND BY A
   * SURVIVING MUTANT RATHER THAN BY INSPECTION.
   *
   * The witnessed case is the shape where the unnarrowed read has NO strict
   * maximum (the factor TIES the option), so a containment that only checked
   * `unnarrowed === null` caught it — and a mutant dropping the identity arm
   * survived the whole corpus above, 5/5 green.
   *
   * That survivor is not equivalent, and this is the fixture that settles it
   * rather than asserting it (trap 13c). Here the factor wins OUTRIGHT over the
   * whole graph (3 tokens to the best option's 1), the kind filter excludes it,
   * and a DIFFERENT node wins among the survivors. Both winners exist, both are
   * strict maxima, and they disagree — so it is the identity arm, not the null
   * arm, that must decline.
   *
   * Same defect class as the witness, reached by the other branch: the product
   * would state provenance about an element the user did not ask about.
   */
  it('RED-KIND-3: declines when a node winning outright is excluded and another wins the narrowed set', () => {
    const factor = {
      id: 'n-factor-headcount-outright',
      kind: 'factor',
      label: 'Platform Team Headcount',
      provenance: 'from_brief',
      source_quote: 'the platform team is six',
    };
    const narrowedWinner = {
      id: 'n-option-platform-rollout',
      kind: 'option',
      label: 'Platform Rollout',
      provenance: 'ai_inferred',
    };
    const graph = {
      nodes: [
        factor,
        narrowedWinner,
        { id: 'n-option-sales-push', kind: 'option', label: 'Sales Push', provenance: 'ai_inferred' },
      ],
      edges: [],
    };
    const message =
      'Where did the platform team headcount come from, and which of these options is affected?';

    // PRECONDITION PIN: the factor is the outright winner of the WHOLE graph on
    // this message. Without the option nodes there is nothing to narrow to, and
    // it resolves and answers. So the decline below is the filter's doing.
    expect(tryStructureOriginAnswer(message, { nodes: [factor], edges: [] })).toBe(
      `"${factor.label}" came from your brief, not from me. You wrote: "${factor.source_quote}".`,
    );

    const answer = tryStructureOriginAnswer(message, graph);

    expect(answer).toBeNull();
    expect(answer).not.toBe(
      `"${narrowedWinner.label}" was my suggestion, not something you wrote.`,
    );
  });

  /**
   * ⭐ THE OPPOSITE-DIRECTION TWIN (trap 22b).
   *
   * A containment that declines on everything is not a fix, it is a deletion.
   * Here narrowing is ACTIVE ("option" is typed, and the graph has options) and
   * it CONFIRMS the winner the whole graph already chose — the option outscores
   * its twin factors outright. That must still answer.
   *
   * This is the module's own headline case in miniature: the witnessed graph
   * carries several elements sharing the token "hybrid", and the option beats
   * them rather than tying them.
   */
  it('TWIN: still answers when narrowing CONFIRMS the winner the whole graph chose', () => {
    const option = {
      id: 'n-option-hybrid',
      kind: 'option',
      label: 'Hybrid Phased Approach',
      provenance: 'ai_inferred',
    };
    const graph = {
      nodes: [
        option,
        { id: 'n-factor-hybrid-cost', kind: 'factor', label: 'Hybrid Cost', provenance: 'ai_inferred' },
        { id: 'n-factor-hybrid-risk', kind: 'factor', label: 'Hybrid Risk', provenance: 'ai_inferred' },
      ],
      edges: [],
    };

    const answer = tryStructureOriginAnswer(
      'Why did you add a hybrid phased option? I never mentioned one — where did that come from?',
      graph,
    );

    expect(answer).toBe(`"${option.label}" was my suggestion, not something you wrote.`);
  });

  /**
   * ⭐ THE SECOND TWIN: narrowing INACTIVE must be untouched by this change.
   *
   * No kind word is typed, so the filter never runs and the unnarrowed score is
   * the only one computed. Pins that the fix did not alter the no-narrowing path.
   */
  it('TWIN: unchanged when no kind word is typed and one element wins outright', () => {
    const factor = nodeById(FACTOR_HEADCOUNT);
    const graph = {
      nodes: [factor, nodeById(OPTION_HIRE)],
      edges: [],
    };

    const answer = tryStructureOriginAnswer(
      'Where did the platform team headcount come from?',
      graph,
    );

    expect(answer).toBe(
      `"${factor.label}" came from your brief, not from me. You wrote: "${factor.source_quote}".`,
    );
  });
});
