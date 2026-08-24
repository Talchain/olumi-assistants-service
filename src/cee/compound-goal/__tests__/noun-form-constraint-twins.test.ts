/**
 * NOUN-FORM LIMITS — EVERY RECOGNISED FORM PAIRED WITH ITS OPPOSITE-DIRECTION TWIN.
 *
 * ⚠ WHY THE PAIRS AND NOT A LIST OF POSITIVES (CLAUDE.md trap 22b).
 * This extractor guards against two OPPOSITE harms with one decision. Failing
 * to mint a stated limit is a GAP — the user's constraint is silently absent
 * and the product crowns an option the user has ruled out. Minting an unstated
 * one is a LIE — the product records a limit the user never set and then
 * withholds a leader on the strength of it. They are not symmetric and they
 * cannot share a corpus: a suite of positives goes green while the recogniser
 * eats the whole language, and a suite of negatives goes green while it
 * recognises nothing.
 *
 * So every row below is a PAIR over the SAME lexical form. The `fire` half
 * fails at 77e2e7d9 and passes here. The `silent` half passes in BOTH — and
 * that is exactly its job: it is the case a naive widening of the recogniser
 * breaks, and it is pinned so the widening cannot happen quietly. FIFTEEN of the
 * seventeen silent halves are lifted from a reviewer's corpus and are ORACLE;
 * two are this lane's own and are labelled as such, because a twin an author
 * writes for their own fix is a development aid, never the evidence (trap 22c).
 *
 * ⚠ AND THE LIMIT OF THIS FILE, LEARNED THE EXPENSIVE WAY: A TWIN TABLE PROVES
 * ONLY WHAT ITS PAIRS HAPPEN TO SPAN. The first twelve pairs were all green
 * while the noun path was putting EIGHTEEN false positives on the wire, because
 * every pair was drawn from a corpus with only nine silent cases in this path's
 * actual input space. Six screens, nine cases: each screen right about the one
 * construction that produced it, blind to its concept's other realisations. The
 * instrument that found that is an 88-case adversarial corpus measured AT THE
 * WIRE (`noun-form-wire-corpora.test.ts`) — not this file. Read this table as a
 * regression pin, never as coverage.
 */

import { describe, it, expect } from "vitest";
import {
  extractCompoundGoals,
  toGoalConstraints,
  normaliseConstraintUnits,
} from "../index.js";

function rows(brief: string) {
  const r = extractCompoundGoals(brief, { includeProxies: false });
  return toGoalConstraints(normaliseConstraintUnits(r.constraints));
}

interface Twin {
  form: string;
  screen: string;
  fire: string;
  /** The value the FIRE half must record — bound by identity, not "some row exists". */
  value: number;
  target: string;
  silent: string;
  /** `oracle` = the reviewer's corpus. `lane` = written by this lane. */
  provenance: "oracle" | "lane";
}

const TWINS: Twin[] = [
  {
    form: "<amount> cap",
    screen: "substring — a limit noun that is only a PREFIX of a descriptive word",
    fire: "We are choosing a replacement supplier, with a £50,000 cap.",
    value: 50000,
    target: "cost",
    silent: "We are deciding how to deploy a £50,000 capital investment this year.",
    provenance: "oracle",
  },
  {
    form: "<amount> budget",
    screen: "substring — 'budgeting' is a gerund, not a budget",
    fire: "There are three ways this could go wrong and the goal is to avoid downtime on a £90,000 budget.",
    value: 90000,
    target: "budget",
    silent: "Marketing spent £40,000 budgeting for the relaunch last year.",
    provenance: "oracle",
  },
  {
    form: "<limit noun> of <amount>",
    screen: "S1 negation — the limit is denied, not stated",
    fire: "We have a hard limit of £250,000 on the whole programme.",
    value: 250000,
    target: "cost",
    silent: "There is no hard limit of £50,000 on this programme.",
    provenance: "oracle",
  },
  {
    form: "<limit noun> of <amount>",
    screen: "S2 interrogative — asked, not told",
    fire: "The budget of £120,000 is fixed and cannot move.",
    value: 120000,
    target: "budget",
    silent: "Would a budget of £250,000 be enough?",
    provenance: "oracle",
  },
  {
    form: "<limit noun> of <amount>",
    screen: "S3 conditional — supposed, not asserted",
    fire: "We have a hard limit of £250,000 on the whole programme.",
    value: 250000,
    target: "cost",
    silent: "If we had a cap of £50,000 we would have to drop the third option.",
    provenance: "oracle",
  },
  {
    form: "<limit noun> of <amount>",
    screen: "S4 soft intent — preferred, not fixed",
    fire: "The budget of £120,000 is fixed and cannot move.",
    value: 120000,
    target: "budget",
    silent: "Nice to have: a budget of £50,000 or thereabouts.",
    provenance: "oracle",
  },
  {
    form: "<limit noun> of <amount>",
    screen: "S5 third-party possession — somebody else's limit",
    fire: "We have a hard limit of £250,000 on the whole programme.",
    value: 250000,
    target: "cost",
    silent: "Our main competitor has a budget of £2m for this category.",
    provenance: "oracle",
  },
  {
    form: "<limit noun> of <amount>",
    screen: "S6 third-person possessive — explicitly theirs",
    fire: "The budget of £120,000 is fixed and cannot move.",
    value: 120000,
    target: "budget",
    silent: "The consultant said their budget of £2m was typical for this sector.",
    provenance: "oracle",
  },
  {
    form: "<limit noun> is <amount>",
    screen: "S6 genitive clitic — the possessor is not the user",
    fire: "Our budget is £50,000.",
    value: 50000,
    target: "budget",
    silent: "Our main competitor's budget is £2m.",
    provenance: "lane",
  },
  {
    form: "<qualifier> <limit noun>: <amount>",
    screen: "S6 genitive clitic on the colon form",
    fire: "Cost ceiling: £50,000.",
    value: 50000,
    target: "cost",
    silent: "The outgoing vendor's cost ceiling: £50,000.",
    provenance: "lane",
  },
  {
    form: "<amount> max",
    screen: "lexicon — 'max' is admitted, 'maximum' is deliberately not",
    fire: "£50k max.",
    value: 50000,
    target: "cost",
    silent: "Under GDPR the fines can reach a maximum of £17,500,000.",
    provenance: "oracle",
  },
  {
    // ⚠ THIS TWIN PASSED FOR A REASON UNRELATED TO ITS STATED PROPERTY, and it
    // is kept with the label corrected rather than deleted (trap 13b). It was
    // written as evidence that the currency requirement substituted for a
    // descriptive/tense screen. It did not: the silent half carries no `£`, so
    // the recogniser never reached a screen at all. Add a symbol — "The old cost
    // ceiling: £50,000 was lifted in January" — and the class walked straight
    // through until `PAST_TENSE_DESCRIPTIVE_RE` was added. The row now claims
    // only what it actually tests: a RECOGNITION boundary, blind in both
    // directions. The tense property is tested where it lives, in
    // `noun-form-wire-corpora.test.ts`.
    form: "<limit noun> of <amount>",
    screen: "recognition boundary (NOT a screen) — a bare-number noun form is never reached",
    fire: "We have a hard limit of £250,000 on the whole programme.",
    value: 250000,
    target: "cost",
    silent: "The current ceiling of 30 seats was set by the old contract and has now lapsed.",
    provenance: "oracle",
  },
  {
    form: "<qualifier> <limit noun>: <amount>",
    screen: "S7 past tense — the case that proves the currency requirement was NOT a tense screen",
    fire: "Cost ceiling: £50,000.",
    value: 50000,
    target: "cost",
    silent: "The old cost ceiling: £50,000 was lifted in January.",
    provenance: "oracle",
  },
  {
    form: "<limit noun> of <amount>",
    screen: "S7 past tense — subject-independent: first person does not make a past limit current",
    fire: "We have a hard limit of £250,000 on the whole programme.",
    value: 250000,
    target: "cost",
    silent: "In 2024 we had a cap of £30,000 on consultancy.",
    provenance: "oracle",
  },
  {
    form: "<limit noun> of <amount>",
    screen: "S3 sentence-scoped — a conditional AFTER the noun still governs it",
    fire: "The budget of £120,000 is fixed and cannot move.",
    value: 120000,
    target: "budget",
    silent: "A budget of £120,000 would be workable if the board agreed.",
    provenance: "oracle",
  },
  {
    form: "<amount> cap",
    screen: "S3 — 'in the event that'",
    fire: "We are choosing a replacement supplier, with a £50,000 cap.",
    value: 50000,
    target: "cost",
    silent: "In the event that finance imposes a £50,000 cap, we phase it.",
    provenance: "oracle",
  },
  {
    form: "<limit noun> is <amount>",
    screen: "S4 soft intent — morphological siblings (hopefully / indicative / soft / aiming for)",
    fire: "Our budget is £50,000.",
    value: 50000,
    target: "budget",
    silent: "Hopefully the budget is £120,000.",
    provenance: "oracle",
  },
];

describe("noun-form limits — opposite-direction twins", () => {
  it("pins every twin pair (a shrunk table voids the claim this makes)", () => {
    expect(TWINS).toHaveLength(17);
    expect(TWINS.filter((t) => t.provenance === "oracle")).toHaveLength(15);
  });

  for (const twin of TWINS) {
    it(`[${twin.screen}] MINTS the stated limit: ${JSON.stringify(twin.fire.slice(0, 60))}`, () => {
      const minted = rows(twin.fire);
      // ⚠ BOUND BY IDENTITY, NOT BY "a row exists" (CLAUDE.md trap 19). These
      // briefs are short, but a value predicate another row could satisfy is
      // how an extractor gets deleted under a green suite.
      const hit = minted.find(
        (r) => r.value === twin.value && r.node_id === `fac_${twin.target}`,
      );
      expect(
        hit,
        `expected <= ${twin.value} on fac_${twin.target}; got ${JSON.stringify(
          minted.map((r) => `${r.operator}${r.value}@${r.node_id}`),
        )}`,
      ).toBeDefined();
      expect(hit!.operator).toBe("<=");
      expect(hit!.provenance).toBe("explicit");
      // The quote is the evidence shown back to the user for this row.
      expect(twin.fire.toLowerCase()).toContain(hit!.source_quote!.toLowerCase());
    });

    it(`[${twin.screen}] stays SILENT on the twin: ${JSON.stringify(twin.silent.slice(0, 60))}`, () => {
      const minted = rows(twin.silent);
      expect(
        minted.map((r) => `${r.operator}${r.value}@${r.node_id}`),
        "a limit the user never stated is a lie, not a gap",
      ).toEqual([]);
    });
  }
});
