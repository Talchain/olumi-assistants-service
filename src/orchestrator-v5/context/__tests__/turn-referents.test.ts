/**
 * `turn_referents` — the referent register (spec §3, minimum for §4.1 rank 2).
 *
 * ⚠ THE CORPUS IN THIS FILE COMES FROM OUTSIDE THE AUTHOR'S HEAD, deliberately.
 * `FOUNDER_RUN_NODES` and `TURN_4_ASSISTANT_TEXT` are transcribed VERBATIM from
 * a real wire capture — a fresh-guest founder journey driven against deployed
 * staging on 5 Sep 2026 (CEE `1af54f6c`, UI `53dbd616`), the run in which this
 * defect was witnessed. They are not fixtures the author invented to suit the
 * predicate. Spec §1.1 / trap 22: a corpus drawn from the author's head cannot
 * see the class the author did not imagine, and a full mutant kit will happily
 * certify it.
 *
 * Two properties of this real graph are load-bearing and were NOT designed in:
 *
 *   1. It contains a genuine CONTAINMENT PAIR. The decision node's label,
 *      "Hire a Dedicated Sales Team or Continue With Founder-Led Sales",
 *      literally contains both option labels, "Hire a Dedicated Sales Team"
 *      and "Continue With Founder-Led Sales", as whole-word runs. A naive
 *      matcher yields three candidates where the world has one. This is the
 *      false-ambiguity case, found in real data rather than imagined.
 *
 *   2. Several labels are long sentence fragments (a separate, already-rowed
 *      draft-quality defect). They are kept verbatim rather than tidied, per
 *      the append-only rule for captured evidence: a corpus that pins what the
 *      product actually produced is EVIDENCE, not a fixture to keep current.
 *
 * Every assertion binds by IDENTITY — the node id `919d7f50`, the exact label
 * string — never by a value predicate another node could satisfy.
 */

import { describe, expect, it } from 'vitest';

import {
  CLAIM_SENTENCE_CAP,
  RANK_ORDER,
  TURN_REFERENTS_CAP,
  candidatesAtTopPopulatedRank,
  nodeRef,
  projectTurnReferents,
  type ReferentNode,
} from '../turn-referents.js';

/**
 * The 16 nodes of the captured founder run, verbatim from
 * `live-20260905T165205Z.captures.json` → `turns[0].body.draft_graph.nodes`.
 */
const FOUNDER_RUN_NODES: readonly ReferentNode[] = Object.freeze([
  { id: '05f973ef', label: 'Hire a Dedicated Sales Team', kind: 'option' },
  {
    id: '15f7737d',
    label:
      'hiring a part-time SDR (£40k) to handle top-of-funnel while the founder stays on closing',
    kind: 'option',
  },
  {
    id: '18845c32',
    label:
      'three churned customers that they left because of missing integrations, not price - so we think product gaps mediate the relationship between customer satisfaction and churn',
    kind: 'factor',
  },
  {
    id: '3b37f66e',
    label:
      'we believe is partly driven by product quality and partly by how much attention each trial gets from the founder',
    kind: 'factor',
  },
  { id: '428612e0', label: 'Runway Depletion Risk', kind: 'risk' },
  { id: '501e2731', label: 'ICP Validation Sprint Before Hiring', kind: 'option' },
  { id: '552bd1c0', label: 'Reach £30k MRR Within 18 Months', kind: 'goal' },
  { id: '5a596708', label: 'MRR Growth', kind: 'outcome' },
  { id: '65f6ae27', label: 'Founder Time on Product', kind: 'factor' },
  { id: '7dc44ba7', label: 'Competitive Pressure', kind: 'factor' },
  { id: '919d7f50', label: 'Sales Headcount Investment', kind: 'factor' },
  { id: '94b13741', label: 'Continue With Founder-Led Sales', kind: 'option' },
  {
    id: 'aba596f3',
    label:
      "we suspect churn and customer acquisition cost are both influenced by the same underlying factor: how well we understand our ICP (ideal customer profile), which we haven't formally validated",
    kind: 'factor',
  },
  { id: 'd429965a', label: 'Monthly Churn Rate', kind: 'risk' },
  { id: 'df595562', label: 'CAC Overshoot Risk', kind: 'risk' },
  {
    id: 'fe61007c',
    label: 'Hire a Dedicated Sales Team or Continue With Founder-Led Sales',
    kind: 'decision',
  },
]);

/**
 * The assistant's turn-4 reply, verbatim from the capture. This is the sentence
 * whose referent the very next turn failed to resolve. Note the product names
 * the factor in LOWER CASE ("the sales headcount investment") while the graph
 * label is title case — the match must be case-insensitive or the witnessed
 * case does not resolve at all.
 */
const TURN_4_ASSISTANT_TEXT =
  'That figure was pulled from your brief as a placeholder, since you mentioned '
  + 'an £80 to 120k range for the first hire plus £20k tooling, but only £80 got '
  + 'captured as the set value. What would you like the sales headcount investment '
  + 'set to: the low end of £80k, the high end of £120k, or a blended figure like £100k?';

const LAST_ASSISTANT_CLAIM_RANK = RANK_ORDER.indexOf('last_assistant_claim');

describe('projectTurnReferents — the witnessed case (5 Sep 2026 founder run)', () => {
  it('recovers exactly one referent, and it is node 919d7f50 Sales Headcount Investment', () => {
    const register = projectTurnReferents({
      lastAssistantMessage: TURN_4_ASSISTANT_TEXT,
      lastAssistantTurnIndex: 4,
      nodes: FOUNDER_RUN_NODES,
    });

    expect(register.source).toBe('complete');
    // BIND BY IDENTITY. Not "length === 1 and kind is factor" — five nodes in
    // this graph are factors and any of them would satisfy that.
    expect(register.referents.map((r) => r.ref)).toEqual(['node:919d7f50']);
    const [referent] = register.referents;
    expect(referent!.label).toBe('Sales Headcount Investment');
    expect(referent!.kind).toBe('factor');
    expect(referent!.introduced_by).toBe('last_assistant_claim');
    expect(referent!.introduced_at_turn).toBe(4);
    expect(referent!.recency_rank).toBe(LAST_ASSISTANT_CLAIM_RANK);
  });

  it('records the claim as llm-authored with NO asserted values', () => {
    const register = projectTurnReferents({
      lastAssistantMessage: TURN_4_ASSISTANT_TEXT,
      lastAssistantTurnIndex: 4,
      nodes: FOUNDER_RUN_NODES,
    });

    const claim = register.referents[0]!.claim;
    expect(claim).toBeDefined();
    // ⚠ THE LOAD-BEARING SPLIT (spec §3.4). The captured sentence names three
    // separate money figures (£80k, £120k, £100k). A producer that inferred a
    // value from this prose would have to pick one, and it would be guessing.
    // The register records the ENTITY and refuses the VALUE.
    expect(claim!.asserted_values).toEqual([]);
    expect(claim!.authored).toBe('llm');
    expect(claim!.about).toEqual(['node:919d7f50']);
    expect(claim!.sentence).toBe(TURN_4_ASSISTANT_TEXT);
  });

  it('defaults authorship to the WEAKER llm treatment when the caller does not say', () => {
    // A caller that cannot prove determinism must not be handed the stronger
    // treatment by omission.
    const register = projectTurnReferents({
      lastAssistantMessage: TURN_4_ASSISTANT_TEXT,
      lastAssistantTurnIndex: 4,
      nodes: FOUNDER_RUN_NODES,
    });
    expect(register.referents[0]!.claim!.authored).toBe('llm');
  });

  it('honours an explicit deterministic authorship', () => {
    const register = projectTurnReferents({
      lastAssistantMessage: TURN_4_ASSISTANT_TEXT,
      lastAssistantTurnIndex: 4,
      lastAssistantAuthored: 'deterministic',
      nodes: FOUNDER_RUN_NODES,
    });
    expect(register.referents[0]!.claim!.authored).toBe('deterministic');
  });
});

describe('projectTurnReferents — the containment rule and its opposite-direction twin', () => {
  // ⚠ THIS PAIR IS THE POINT. One case alone proves nothing: the first shows
  // the false ambiguity is closed, the second shows closing it did not swallow
  // a REAL ambiguity. A rule that collapses everything to one candidate would
  // pass the first test and fail the second.

  it('CONTAINED: a sentence naming the decision yields ONE candidate, not three', () => {
    // "Hire a Dedicated Sales Team or Continue With Founder-Led Sales" contains
    // both option labels as whole-word runs. Longest wins.
    const register = projectTurnReferents({
      lastAssistantMessage:
        'The decision on the table is Hire a Dedicated Sales Team or Continue With Founder-Led Sales.',
      lastAssistantTurnIndex: 2,
      nodes: FOUNDER_RUN_NODES,
    });
    expect(register.referents.map((r) => r.ref)).toEqual(['node:fe61007c']);
  });

  it('DISTINCT: two genuinely different labels still yield TWO candidates', () => {
    const register = projectTurnReferents({
      lastAssistantMessage:
        'Sales Headcount Investment moves MRR Growth more than anything else does.',
      lastAssistantTurnIndex: 3,
      nodes: FOUNDER_RUN_NODES,
    });
    expect(register.referents.map((r) => r.ref).sort()).toEqual([
      'node:5a596708',
      'node:919d7f50',
    ]);
  });

  it('CONTAINED, the narrower half: naming only the option does NOT pull in the decision', () => {
    const register = projectTurnReferents({
      lastAssistantMessage: 'You could Hire a Dedicated Sales Team.',
      lastAssistantTurnIndex: 1,
      nodes: FOUNDER_RUN_NODES,
    });
    expect(register.referents.map((r) => r.ref)).toEqual(['node:05f973ef']);
  });
});

describe('projectTurnReferents — matching is whole-word and case-insensitive', () => {
  it('matches across a case difference (the witnessed lower-case mention)', () => {
    const register = projectTurnReferents({
      lastAssistantMessage: 'I have set the sales headcount investment for you.',
      lastAssistantTurnIndex: 1,
      nodes: FOUNDER_RUN_NODES,
    });
    expect(register.referents.map((r) => r.ref)).toEqual(['node:919d7f50']);
  });

  it('does NOT match a label glued inside a longer word', () => {
    // Strictness here fails SAFE: a miss yields zero candidates, which §4.2
    // routes to ASK. It can never produce a wrong bind.
    const register = projectTurnReferents({
      lastAssistantMessage: 'Quarterly MRR Growths are up.',
      lastAssistantTurnIndex: 1,
      nodes: FOUNDER_RUN_NODES,
    });
    expect(register.referents.map((r) => r.ref)).toEqual([]);
    expect(register.source).toBe('complete');
  });

  it('does not crash on a label carrying regex metacharacters', () => {
    // Real label: "hiring a part-time SDR (£40k) to handle top-of-funnel ..."
    const register = projectTurnReferents({
      lastAssistantMessage:
        'One option is hiring a part-time SDR (£40k) to handle top-of-funnel while the founder stays on closing.',
      lastAssistantTurnIndex: 1,
      nodes: FOUNDER_RUN_NODES,
    });
    expect(register.referents.map((r) => r.ref)).toEqual(['node:15f7737d']);
  });
});

describe('projectTurnReferents — absence semantics', () => {
  it('a DEGRADED conversation read is an empty register that proves nothing', () => {
    const register = projectTurnReferents({
      lastAssistantMessage: TURN_4_ASSISTANT_TEXT,
      lastAssistantTurnIndex: 4,
      nodes: FOUNDER_RUN_NODES,
      conversationRead: 'degraded',
    });
    expect(register.source).toBe('degraded');
    expect(register.referents).toEqual([]);
  });

  it('NO PRIOR TURN is a COMPLETE answer of zero — the opposite-direction twin', () => {
    // Conflating these two is exactly how an unreadable source becomes a
    // confident "there is nothing to point at".
    const register = projectTurnReferents({
      lastAssistantMessage: null,
      lastAssistantTurnIndex: null,
      nodes: FOUNDER_RUN_NODES,
    });
    expect(register.source).toBe('complete');
    expect(register.referents).toEqual([]);
  });

  it('an empty graph yields a complete, empty register', () => {
    const register = projectTurnReferents({
      lastAssistantMessage: TURN_4_ASSISTANT_TEXT,
      lastAssistantTurnIndex: 4,
      nodes: [],
    });
    expect(register.source).toBe('complete');
    expect(register.referents).toEqual([]);
  });

  it('caps the register and discloses how many entries it dropped', () => {
    const many: ReferentNode[] = [];
    const words: string[] = [];
    for (let i = 0; i < TURN_REFERENTS_CAP + 3; i += 1) {
      const label = `Distinct Referent Number ${String(i).padStart(2, '0')}`;
      many.push({ id: `n${i}`, label, kind: 'factor' });
      words.push(label);
    }
    const register = projectTurnReferents({
      lastAssistantMessage: words.join(', ') + '.',
      lastAssistantTurnIndex: 7,
      nodes: many,
    });
    expect(register.source).toBe('capped');
    expect(register.referents).toHaveLength(TURN_REFERENTS_CAP);
    expect(register.referents_omitted).toBe(3);
  });

  it('bounds the recorded claim sentence', () => {
    const long = `Sales Headcount Investment ${'x'.repeat(CLAIM_SENTENCE_CAP * 2)}`;
    const register = projectTurnReferents({
      lastAssistantMessage: long,
      lastAssistantTurnIndex: 4,
      nodes: FOUNDER_RUN_NODES,
    });
    expect(register.referents[0]!.claim!.sentence).toHaveLength(CLAIM_SENTENCE_CAP);
  });
});

describe('candidatesAtTopPopulatedRank', () => {
  it('returns the witnessed single candidate', () => {
    const register = projectTurnReferents({
      lastAssistantMessage: TURN_4_ASSISTANT_TEXT,
      lastAssistantTurnIndex: 4,
      nodes: FOUNDER_RUN_NODES,
    });
    expect(candidatesAtTopPopulatedRank(register).map((r) => r.ref)).toEqual([
      'node:919d7f50',
    ]);
  });

  it('returns nothing for an empty register, whatever its source', () => {
    expect(candidatesAtTopPopulatedRank({ referents: [], source: 'complete' })).toEqual([]);
    expect(candidatesAtTopPopulatedRank({ referents: [], source: 'degraded' })).toEqual([]);
  });

  it('prefers a lower rank number and never mixes ranks', () => {
    // Proves the selection is generic over RANK_ORDER rather than hardcoded to
    // the one rank this PR populates — so rank 1/3/4 producers need no call-site
    // change when they land.
    const selectionRank = RANK_ORDER.indexOf('user_selection');
    const register = {
      source: 'complete' as const,
      referents: [
        {
          ref: 'node:919d7f50',
          kind: 'factor' as const,
          label: 'Sales Headcount Investment',
          introduced_by: 'last_assistant_claim' as const,
          introduced_at_turn: 4,
          recency_rank: LAST_ASSISTANT_CLAIM_RANK,
        },
        {
          ref: 'node:5a596708',
          kind: 'outcome' as const,
          label: 'MRR Growth',
          introduced_by: 'user_selection' as const,
          introduced_at_turn: 5,
          recency_rank: selectionRank,
        },
      ],
    };
    expect(selectionRank).toBeLessThan(LAST_ASSISTANT_CLAIM_RANK);
    expect(candidatesAtTopPopulatedRank(register).map((r) => r.ref)).toEqual([
      'node:5a596708',
    ]);
  });
});

describe('nodeRef', () => {
  it('uses the spec §3.2 address grammar', () => {
    expect(nodeRef('919d7f50')).toBe('node:919d7f50');
  });
});
