/**
 * STATED-VALUE CARRIAGE + `is_baseline` EXPRESSIBILITY — the two P0s this suite pins.
 *
 * ── WHAT WAS MEASURED, AND WHERE EACH DEFECT LIVED ─────────────────────────
 * On the deployed build `41156fc` (12 fresh draws, `first-use-acceptance-2026-08-14`):
 *
 *   · **0 of 18 stated money magnitudes reached the wire.** NOT a grammar gap and
 *     NOT a generation gap — both were healthy. The grammar has carried
 *     `stated_items[].value`/`unit` and a `figure` kind throughout, and the banked
 *     live emission carries a value AND a unit on 12 of its 20 stated items
 *     (£7.2m, £1.8m, £1.2m, £700k, 45 minutes, 6 engineers). Two mechanisms
 *     destroyed them, and only ONE is in scope here (trap 21 — they are different
 *     questions and must not be fixed as one):
 *       M1a  the projector's connectivity prune withdraws every stated figure
 *            nothing links to the goal (`unconnected_to_goal`). Replaying the
 *            banked emission loses 12 of 12 values this way. DELIBERATE prior
 *            decision (`completion.ts:559-577`), needs a validator exemption to
 *            repair safely, and is NOT touched by this suite.
 *       M1b  there was NO value branch for a stated `goal` at all — the
 *            projector's own comment has said so since the R1 cutover. The
 *            C_pricing goal carried "our target for next year is £3,000,000" with
 *            `data: null, observed_state: null`: the user's success criterion held
 *            as PROSE. That is what `goal target` below pins.
 *
 *   · **`is_baseline` occurred ZERO times in the entire records path** — grammar,
 *     projector and instruction alike (contrast control in the same sweep:
 *     `option` → 28 in `grammar.ts`), while the served prompt v195:282-283 makes
 *     it MANDATORY. An enforced structured-output grammar does not degrade an
 *     inexpressible fact; it deletes it deterministically.
 *
 *   · **AND THE ABSENCE WAS NOT NEUTRAL.** With no honest channel the consumer
 *     guessed from labels and guessed INVERTED on every measured draw:
 *     `"replace our current CRM with HubSpot next quarter"` was flagged the status
 *     quo and `"keep what we have"` was not, 3/3 `B_crm` draws, because the flat
 *     keyword list held the bare token `"current"` and took the first match by
 *     array index. `baseline tiering` pins that.
 *
 * ── EVERY ASSERTION BINDS BY IDENTITY (trap 19) ────────────────────────────
 * Nodes are located by the projector's own minted id, or by the EXACT verbatim
 * quote the projector uses as a stated node's label — never by "the node whose
 * value is 3000000", which a second node could satisfy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildDraftRecordsSchema,
  buildDraftClaimItemSchema,
  draftClaimSchemaKeys,
  draftStatedItemSchemaKeys,
  measureDraftRecordsSchemaBudget,
  ANTHROPIC_OPTIONAL_PARAM_LIMIT,
  ANTHROPIC_UNION_PARAM_LIMIT,
  SERIALIZED_BYTES_BUDGET,
  DRAFT_RECORDS_INSTRUCTION,
  type DraftRecordSet,
} from "../index.js";
import { goalValueIsATarget, projectRecordsToGraph, type ProjectedNode } from "../projector.js";
import { projectDraftRecords } from "../seam.js";
import { replayRecordSet } from "../replay.js";
import { resolveGoalThresholdCap, CEE_GOAL_THRESHOLD_FRAME } from "../../../../utils/goal-threshold-cap.js";
import {
  BASELINE_IDIOMS,
  AMBIGUOUS_CURRENT_STATE_TOKENS,
  buildAnalysisReadyPayload,
  labelMatchesBaseline,
} from "../../../transforms/analysis-ready.js";

const FIXTURES = join(__dirname, "fixtures");

function loadBankedEmission(): DraftRecordSet {
  return JSON.parse(
    readFileSync(join(FIXTURES, "live-emission-round11-set12.json"), "utf8"),
  ) as DraftRecordSet;
}

/**
 * Locate a projected node by the EXACT quote the user stated.
 *
 * ⚠ BOUND ON `provenance.source_quote`, NOT ON THE LABEL. It read the label
 * until the goal's display label became an AUTHORED objective (quality bar §8
 * A1); `source_quote` is where the verbatim now lives, and it is the stronger
 * binding in any case — a label is a display string and can be re-cased or
 * re-worded, while the quote is the record's identity.
 */
function nodeByQuote(nodes: readonly ProjectedNode[], quote: string): ProjectedNode | undefined {
  // ⚠ NO `|| n.label === quote` FALLBACK. A review showed the disjunct is dead
  // (the file runs green without it) and actively harmful: if the identity
  // binding ever broke, the label branch would keep the suite green — trap 19
  // reopened by the very helper written to close it.
  return nodes.find((n) => n.provenance?.source_quote === quote);
}

// ───────────────────────────────────────────────────────────────────────────
describe("M1b — a stated numeric goal registers a success target", () => {
  const GOAL_QUOTE = "our target for next year is £3,000,000";

  /** The C_pricing goal as the model emitted it, verbatim from the measured brief. */
  function pricingRecords(role: "target" | "baseline" | "context" | "constraint" | undefined): DraftRecordSet {
    return {
      stated_items: [
        {
          kind: "goal",
          source_quote: GOAL_QUOTE,
          value: 3_000_000,
          unit: "£",
          ...(role !== undefined ? { role } : {}),
        },
      ],
      claims: [],
    } as DraftRecordSet;
  }

  it("carries raw, cap, normalised value, frame and unit — as ONE set, from ONE derivation", () => {
    const { graph } = projectRecordsToGraph(pricingRecords("target"));
    const goal = nodeByQuote(graph.nodes, GOAL_QUOTE);
    expect(goal).toBeDefined();
    expect(goal!.kind).toBe("goal");

    // The user's own number, unrounded and unrescaled.
    expect(goal!.goal_threshold_raw).toBe(3_000_000);
    expect(goal!.goal_threshold_unit).toBe("£");

    // ⭐ THE CAP COMES FROM THE SHARED AUTHORITY, NOT FROM ARITHMETIC WRITTEN
    // HERE. Asserted against `resolveGoalThresholdCap` itself so this test
    // cannot pass while the projector quietly grows its own cap rule — which is
    // the exact divergence (~5x on one target) that module was extracted to end.
    const expectedCap = resolveGoalThresholdCap(undefined, 3_000_000, "£", undefined);
    expect(expectedCap).not.toBeNull();
    expect(goal!.goal_threshold_cap).toBe(expectedCap);

    // Normalised against THAT cap, never against a separately-derived one: ISL
    // subtracts a baseline scored on this denominator, and a mismatch does not
    // fail — it silently returns a wrong probability (`graph.ts:325-330`).
    expect(goal!.goal_threshold).toBe(3_000_000 / expectedCap!);
    expect(goal!.goal_threshold_frame).toBe(CEE_GOAL_THRESHOLD_FRAME);
  });

  it("never lands the degenerate `cap === raw` that would force goal_threshold = 1.0", () => {
    const { graph } = projectRecordsToGraph(pricingRecords("target"));
    const goal = nodeByQuote(graph.nodes, GOAL_QUOTE)!;
    expect(goal.goal_threshold_cap).toBeGreaterThan(goal.goal_threshold_raw!);
    expect(goal.goal_threshold).toBeLessThan(1);
  });

  it("⚠ NEVER mints `goal_baseline` — the mirror harm, and the whole point of the branch", () => {
    // The C_pricing brief DOES state a current level ("£2,400,000") and it
    // arrives as a SEPARATE record. Pairing the two would assert a number the
    // user gave about one thing as the baseline of another — the fabrication
    // class this lane exists to remove. Absent is honest; ISL then refuses with
    // `missing_goal_baseline` and renders no probability.
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: GOAL_QUOTE, value: 3_000_000, unit: "£", role: "target" },
        {
          kind: "figure",
          source_quote: "Annual recurring revenue is currently £2,400,000",
          value: 2_400_000,
          unit: "£",
          role: "baseline",
        },
      ],
      claims: [],
    } as DraftRecordSet;
    const { graph } = projectRecordsToGraph(records);
    for (const node of graph.nodes) {
      expect(node).not.toHaveProperty("goal_baseline");
      expect(node).not.toHaveProperty("goal_baseline_raw");
    }
  });

  it("honours the RAW-PERCENT convention `resolveGoalThresholdCap` declares", () => {
    // The doctrine is explicit: `raw` is the raw percent NUMBER (30 for "30%"),
    // and routing a pre-divided fraction through it double-divides (a 100x
    // regression it warns about by name). The grammar emits the raw number —
    // the banked emission carries `{value: 30, unit: '%'}` for "22% to 30%" —
    // so the two conventions agree, and this pins that they still do.
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "goal", source_quote: "lift win rate to 30%", value: 30, unit: "%", role: "target" },
      ],
      claims: [],
    } as DraftRecordSet;
    const { graph } = projectRecordsToGraph(records);
    const goal = nodeByQuote(graph.nodes, "lift win rate to 30%")!;
    expect(goal.goal_threshold_cap).toBe(100);
    expect(goal.goal_threshold).toBeCloseTo(0.3, 10);
    expect(goal.goal_threshold_raw).toBe(30);
  });

  // ⭐ THE OPPOSITE-DIRECTION TWINS. A carriage fix must be shown NOT to register
  // a target where the user stated a current level — registering "where we are"
  // as "where we want to be" inverts the objective.
  it.each([
    ["baseline", false],
    ["context", false],
    ["constraint", false],
    ["target", true],
    [undefined, true],
  ] as const)("role %s ⇒ registers a threshold: %s", (role, shouldRegister) => {
    expect(goalValueIsATarget(role as never)).toBe(shouldRegister);
    const { graph } = projectRecordsToGraph(pricingRecords(role as never));
    const goal = nodeByQuote(graph.nodes, GOAL_QUOTE)!;
    if (shouldRegister) {
      expect(goal.goal_threshold_raw).toBe(3_000_000);
    } else {
      expect(goal.goal_threshold_raw).toBeUndefined();
      expect(goal.goal_threshold).toBeUndefined();
      expect(goal.goal_threshold_cap).toBeUndefined();
      // A refusal is never a regression: the number stays in the user's own words.
      expect(goal.label).toContain("£3,000,000");
    }
  });

  it("survives THE SEAM, not merely the projector", () => {
    // `sets_to` shipped in the grammar, instruction and projector while the seam
    // silently discarded it, and every interventions test agreed because they all
    // call the projector directly (trap 3b/19). The live path runs through here.
    const seam = projectDraftRecords(pricingRecords("target"), undefined);
    expect(seam.ok).toBe(true);
    if (!seam.ok) return;
    const goal = nodeByQuote(seam.projection.graph.nodes, GOAL_QUOTE)!;
    expect(goal.goal_threshold_raw).toBe(3_000_000);
    expect(goal.goal_threshold_frame).toBe(CEE_GOAL_THRESHOLD_FRAME);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("F2a — `is_baseline` is expressible and carried", () => {
  it("is declared on BOTH grammar surfaces, derived from the schemas themselves", () => {
    expect(draftStatedItemSchemaKeys()).toContain("is_baseline");
    expect(draftClaimSchemaKeys()).toContain("is_baseline");
    // Typed as a boolean, so a string cannot be smuggled through the decoder.
    const stated = buildDraftRecordsSchema() as any;
    expect(stated.properties.stated_items.items.properties.is_baseline).toEqual({ type: "boolean" });
    expect((buildDraftClaimItemSchema() as any).properties.is_baseline).toEqual({ type: "boolean" });
  });

  it("stays inside every budget that binds — including the unpublished one", () => {
    // A grammar that satisfies the static limits can still draw 400 "compiled
    // grammar too large", at which point the adapter SILENTLY falls back to
    // prompt-only JSON on every draft. Two optional booleans add no object
    // schema and no union, which is why that boundary is untouched.
    const b = measureDraftRecordsSchemaBudget();
    expect(b.serializedBytes).toBeLessThanOrEqual(SERIALIZED_BYTES_BUDGET);
    expect(b.optionalParams).toBeLessThanOrEqual(ANTHROPIC_OPTIONAL_PARAM_LIMIT);
    expect(b.unionParams).toBeLessThanOrEqual(ANTHROPIC_UNION_PARAM_LIMIT);
    expect(b.forbiddenKeywords).toEqual([]);
    expect(b.objectsMissingAdditionalPropertiesFalse).toEqual([]);
    expect(b.objectSchemas).toBe(3);
  });

  it("the instruction teaches the mandate block 2 was silent on", () => {
    // Block 1 (the served PMS prompt) has always mandated Status Quo; block 2 —
    // the 15,777-char block sitting NEAREST the output shape — named options 21
    // times and status quo ZERO. That silence is removed.
    expect(DRAFT_RECORDS_INSTRUCTION).toMatch(/is_baseline/);
    expect(DRAFT_RECORDS_INSTRUCTION.toLowerCase()).toContain("status quo");
  });

  it.each([
    [true, true],
    [false, false],
  ])("carries a stated option's own flag %s to the node", (flag, expected) => {
    const records: DraftRecordSet = {
      stated_items: [
        { kind: "option", source_quote: "keep what we have", is_baseline: flag },
        { kind: "option", source_quote: "replace our current CRM with HubSpot next quarter" },
      ],
      claims: [],
    } as DraftRecordSet;
    const { graph } = projectRecordsToGraph(records);
    expect(nodeByQuote(graph.nodes, "keep what we have")!.is_baseline).toBe(expected);
    // An option the model said nothing about stays SILENT — "considered and
    // rejected" and "never spoken" are different facts downstream.
    expect(
      nodeByQuote(graph.nodes, "replace our current CRM with HubSpot next quarter")!.is_baseline,
    ).toBeUndefined();
  });

  it("carries a MODEL-added status quo (option_refinement) to the node", () => {
    const records: DraftRecordSet = {
      stated_items: [{ kind: "option", source_quote: "raise enterprise pricing by 30%" }],
      claims: [
        { claim_kind: "option_refinement", label: "Status Quo — hold current pricing", is_baseline: true },
      ],
    } as DraftRecordSet;
    const { graph } = projectRecordsToGraph(records);
    const minted = graph.nodes.find((n) => n.label === "Status Quo — hold current pricing");
    expect(minted).toBeDefined();
    expect(minted!.kind).toBe("option");
    expect(minted!.is_baseline).toBe(true);
  });

  it("survives THE SEAM — the hop that once silently ate `sets_to`", () => {
    const records: DraftRecordSet = {
      stated_items: [{ kind: "option", source_quote: "keep what we have", is_baseline: true }],
      claims: [],
    } as DraftRecordSet;
    const seam = projectDraftRecords(records, undefined);
    expect(seam.ok).toBe(true);
    if (!seam.ok) return;
    // The seam rebuilds field by field, so assert the RECORD kept the field too.
    expect(seam.records.stated_items[0]!.is_baseline).toBe(true);
    expect(nodeByQuote(seam.projection.graph.nodes, "keep what we have")!.is_baseline).toBe(true);
  });

  it("⚠ NEVER mints a bare `data` object on an option — the union hazard", () => {
    // `OptionData` REQUIRES `interventions` (`graph.ts:163-165`) and `NodeData`
    // is a union keyed on a required field per branch, so `data = {is_baseline}`
    // matches NOTHING and rejects the whole draft. This is the wound `role`
    // already took. The flag therefore lives at node level.
    const records: DraftRecordSet = {
      stated_items: [{ kind: "option", source_quote: "keep what we have", is_baseline: true }],
      claims: [],
    } as DraftRecordSet;
    const { graph } = projectRecordsToGraph(records);
    const option = nodeByQuote(graph.nodes, "keep what we have")!;
    if (option.data !== undefined) {
      expect(option.data).toHaveProperty("interventions");
    }
  });

  it("a merged refinement's flag lands on its parent, but NEVER over a stated flag", () => {
    // Merged refinements mint no node, so the flag would vanish with them —
    // the same silent-drop shape as `sets_to`. But the USER saying "this is my
    // status quo" outranks the model's reading of the user's own option.
    const base = (statedFlag?: boolean): DraftRecordSet =>
      ({
        stated_items: [
          {
            kind: "option",
            source_quote: "hold price and push volume instead",
            ...(statedFlag !== undefined ? { is_baseline: statedFlag } : {}),
          },
        ],
        claims: [
          {
            claim_kind: "option_refinement",
            label: "Hold price, drive volume through partners",
            basis: [0],
            is_baseline: true,
          },
        ],
      }) as DraftRecordSet;

    const inherited = projectRecordsToGraph(base(undefined));
    expect(
      nodeByQuote(inherited.graph.nodes, "hold price and push volume instead")!.is_baseline,
    ).toBe(true);

    // The stated `false` must WIN over the claim's `true`.
    const stated = projectRecordsToGraph(base(false));
    expect(nodeByQuote(stated.graph.nodes, "hold price and push volume instead")!.is_baseline).toBe(
      false,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("F2b — baseline tiering: an ambiguous label no longer INVENTS a baseline", () => {
  // ⚠ THE REPO'S OWN FIXTURE SHAPE, not one invented here. A hand-rolled option
  // silently failed to resolve `option_id` at all, so the first version of these
  // assertions was reading `undefined` rather than measuring the detector —
  // exactly the "instrument agrees with nothing" failure a self-authored fixture
  // produces. Copied from `tests/unit/cee.analysis-ready-enrichment.test.ts`.
  const makeOption = (id: string, label: string, extra?: Record<string, unknown>) =>
    ({ id, label, status: "ready", interventions: {}, ...extra }) as never;
  const makeGraph = () =>
    ({
      nodes: [{ id: "goal_1", kind: "goal", label: "Grow revenue" }],
      edges: [],
    }) as never;

  it("⭐ THE MEASURED INVERSION: the real status quo wins, not the change option", () => {
    // Deployed `41156fc`, B_crm, 3/3 draws: `is_baseline: true` sat on the
    // CHANGE option because `"current"` matched at index 0.
    const options = [
      makeOption("opt_change", "replace our current CRM with HubSpot next quarter"),
      makeOption("opt_stay", "keep what we have"),
    ] as never;
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph() as never);
    // ⚠ BOUND BY EXACT LABEL, NOT BY `option_id`. Measured: this fixture shape
    // yields `option_id: undefined`, so an id lookup returned `undefined` and the
    // first version of this assertion was reading a missing object rather than
    // measuring the detector — a test that could only ever have failed, for a
    // reason unrelated to the property. The label is an identity here (both are
    // exact, distinct, verbatim strings from the measured brief), never a value
    // predicate a sibling could satisfy.
    const byLabel = (label: string) => {
      const hit = payload.options.filter((o) => o.label === label);
      expect(hit).toHaveLength(1);
      return hit[0]!;
    };
    const change = byLabel("replace our current CRM with HubSpot next quarter");
    const stay = byLabel("keep what we have");
    // ⚠ EXPECTATIONS DERIVED AT THE PRODUCER, NOT FROM MY READING OF THE FIELD
    // (trap 13c). `buildAnalysisReadyPayload` sets `is_baseline = true` on the
    // detected baseline ONLY and leaves every other option ABSENT — which is
    // exactly what the banked wire shows (`is_baseline: None` on the sibling).
    // ⭐ NOTE THE DIVERGENCE THIS EXPOSES, reported not fixed: the OTHER
    // implementation of this concept (`analysis-ready-helper.ts:293-295`) sets an
    // explicit `false` on non-baselines and its comment at :276 claims that is
    // the contract. Two implementations of one concept disagreeing is the twins
    // defect (trap 21); it is rowed, and asserting the truth here rather than the
    // comment is what keeps this test honest about which one ships.
    expect(stay.is_baseline).toBe(true);
    expect(change.is_baseline).toBeUndefined();
  });

  it("a lone change option that merely MENTIONS the current state gets no baseline", () => {
    // The opposite-direction twin: fixing the inversion must not simply move the
    // flag one slot along. With no genuine status quo present, none is invented.
    const options = [
      makeOption("opt_a", "replace our current CRM with HubSpot next quarter"),
      makeOption("opt_b", "migrate to Salesforce in Q3"),
    ] as never;
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph() as never);
    expect(payload.options.filter((o) => o.is_baseline === true)).toEqual([]);
  });

  it("the model's OWN flag still outranks every label reading (priority 1)", () => {
    // This is what makes tightening priority 2 safe rather than lossy: the
    // records grammar now carries the flag, so the guess is no longer
    // load-bearing. A label with NO idiom at all still resolves when flagged.
    const options = [
      makeOption("opt_a", "raise enterprise pricing by 30%"),
      makeOption("opt_b", "hold price and push volume instead", { is_baseline: true }),
    ] as never;
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph() as never);
    const flagged = payload.options.filter((o) => o.label === "hold price and push volume instead");
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.is_baseline).toBe(true);
    const other = payload.options.filter((o) => o.label === "raise enterprise pricing by 30%");
    expect(other).toHaveLength(1);
    expect(other[0]!.is_baseline).toBeUndefined();
  });

  it("two idiomatic status quos ⇒ NO baseline, rather than an arbitrary pick", () => {
    const options = [
      makeOption("opt_a", "Do nothing"),
      makeOption("opt_b", "Status Quo"),
    ] as never;
    const payload = buildAnalysisReadyPayload(options, "goal_1", makeGraph() as never);
    expect(payload.options.filter((o) => o.is_baseline === true)).toEqual([]);
  });

  it("⚠ the ambiguous tokens are EXCLUDED from detection — asserted, not commented", () => {
    for (const token of AMBIGUOUS_CURRENT_STATE_TOKENS) {
      expect(labelMatchesBaseline(`replace our ${token} vendor with Acme next quarter`)).toBe(false);
    }
    // …and the idioms are all still positive evidence. A tiering that quietly
    // demoted an idiom would pass the exclusion check above on its own.
    for (const idiom of BASELINE_IDIOMS) {
      expect(labelMatchesBaseline(`Option: ${idiom}`)).toBe(true);
    }
  });

  // ⭐⭐ THE LOAD-BEARING CORPUS, AND IT COMES FROM OUTSIDE THE FIX'S OWN HEAD
  // (trap 22). Three sources, none of them the design: the repo's OWN pre-existing
  // spec fixtures, the MEASURED wire (B_crm 3/3 + the banked staging capture), and
  // adversarial cases generated specifically to break the candidate rule.
  //
  // The last two are the reason the shipped predicate is a contiguous PHRASE set
  // rather than a verb-object parser: the parser was run first (trap 22f(b)) and
  // scored 2 of 7 WRONG on exactly those two adversarial labels, reopening the
  // inversion in a new place. Every row carries its OPPOSITE-DIRECTION TWIN — a
  // carriage fix must be shown not to invent a baseline where none was stated,
  // which is the mirror of the harm it repairs.
  it.each([
    // ── must be detected ──────────────────────────────────────────────────────
    ["keep what we have", true, "the B_crm baseline that LOST to a change option"],
    ["Maintain current strategy", true, "repo's own spec fixture"],
    ["Keep existing process", true, "repo's own spec fixture"],
    ["Make No New Hire (Status Quo)", true, "banked staging capture"],
    ["Baseline scenario", true, "repo's own spec fixture"],
    ["Do nothing", true, "idiom"],
    // ── must NOT be detected (the twins) ──────────────────────────────────────
    ["replace our current CRM with HubSpot next quarter", false, "THE MEASURED INVERSION"],
    ["stop maintaining the current system", false, "adversarial — the PARSER form matched this"],
    [
      "migrate off our existing platform, keeping current integrations",
      false,
      "adversarial — the PARSER form matched this",
    ],
    ["keep the rollout on schedule", false, "an action, not a status quo"],
    ["migrate to Salesforce in Q3", false, "plain change"],
    ["raise enterprise pricing by 30%", false, "plain change"],
    // The third element is the WHY, and it is a parameter rather than a comment so
    // a failing row names its own provenance in the test output.
  ] as const)("labelMatchesBaseline(%j) === %s — %s", (label, expected, _why) => {
    expect(labelMatchesBaseline(label)).toBe(expected);
  });

  it("the four banked staging labels are still detected (no regression)", () => {
    // Historic capture — sentences the product actually emitted. Append-only.
    for (const label of [
      "Make No New Hire (Status Quo)",
      "No New Hire (Status Quo)",
      "No Dedicated Marketing (Status Quo)",
      "No Dedicated Campaign (Status Quo)",
    ]) {
      expect(labelMatchesBaseline(label)).toBe(true);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
/**
 * ⭐⭐ THE DERIVED SEAM-COMPLETENESS GUARD — WRITTEN HERE BECAUSE IT DID NOT EXIST.
 *
 * `seam.ts:86-88` says: *"`assertSeamCarriesEveryGrammarField` below now makes the
 * next such omission a red rather than a dark capability."* **That function has
 * never existed.** Swept at this tip with a contrast control: the symbol occurs
 * ONCE in the whole repo — inside the comment promising it — while
 * `draftClaimSchemaKeys` (which `grammar.ts:463-473` calls "the completeness
 * source for `seam.ts`'s field-by-field rebuild") had NO test consumer at all.
 * The estate believed it held a derived guard against the `sets_to` defect class
 * and held a sentence about one instead: guarantee theatre, in the exact place
 * built to prevent a silent drop.
 *
 * ⚠ AND IT WAS NOT HYPOTHETICAL — a mutant proved it live. Deleting the seam's
 * `claim.is_baseline` carriage left this suite at 39/39 GREEN, because the
 * projector tests call the projector DIRECTLY and the live path runs through the
 * seam (trap 3b/19). My own seam test covered the STATED flag and not the CLAIM
 * flag: an invariant written with the same asymmetry as the code it guards
 * (trap 13d). This closes the whole class rather than my one field.
 *
 * DERIVED, never a list: the fixture is BUILT FROM the grammar's own JSON Schema,
 * so a field added to the grammar tomorrow is populated and asserted here without
 * anyone remembering to update a mirror (trap 12).
 */
describe("assertSeamCarriesEveryGrammarField — derived, and it did not exist before", () => {
  /** A value satisfying a declared property schema. Derived from `type`/`enum`. */
  function valueFor(key: string, schema: Record<string, unknown>, index: number): unknown {
    if (Array.isArray(schema.enum)) return schema.enum[0];
    switch (schema.type) {
      case "boolean":
        return true;
      case "integer":
        return 0;
      case "number":
        return 0.5 + index / 100;
      case "array":
        return [0];
      case "string":
        return `derived-${key}`;
      default:
        throw new Error(`unhandled declared type for ${key}: ${JSON.stringify(schema)}`);
    }
  }

  function populateFromSchema(props: Record<string, unknown>): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    let i = 0;
    for (const [key, sub] of Object.entries(props)) {
      out[key] = valueFor(key, sub as Record<string, unknown>, i++);
    }
    return out;
  }

  const statedProps = (buildDraftRecordsSchema() as any).properties.stated_items.items
    .properties as Record<string, unknown>;
  const claimProps = (buildDraftClaimItemSchema() as any).properties as Record<string, unknown>;

  it("carries EVERY declared `stated_items[]` field through the seam", () => {
    const item = populateFromSchema(statedProps);
    const seam = projectDraftRecords({ stated_items: [item], claims: [] } as never, undefined);
    expect(seam.ok).toBe(true);
    if (!seam.ok) return;
    const carried = seam.records.stated_items[0] as unknown as Record<string, unknown>;
    // Assert the KEY SET first, so a missing field names itself rather than
    // surfacing as one confusing value mismatch.
    expect(Object.keys(carried).sort()).toEqual(draftStatedItemSchemaKeys());
    for (const key of draftStatedItemSchemaKeys()) {
      expect(carried[key]).toEqual(item[key]);
    }
  });

  it("carries EVERY declared `claims[]` field through the seam", () => {
    const claim = populateFromSchema(claimProps);
    const seam = projectDraftRecords(
      { stated_items: [{ kind: "goal", source_quote: "a goal" }], claims: [claim] } as never,
      undefined,
    );
    expect(seam.ok).toBe(true);
    if (!seam.ok) return;
    const carried = seam.records.claims[0] as unknown as Record<string, unknown>;
    expect(Object.keys(carried).sort()).toEqual(draftClaimSchemaKeys());
    for (const key of draftClaimSchemaKeys()) {
      expect(carried[key]).toEqual(claim[key]);
    }
  });

  it("the fixture is non-empty and covers every key — the guard's own precondition", () => {
    // A derived guard whose derivation silently yields nothing passes by testing
    // nothing (trap 13). Both key sets must be non-trivial AND must contain the
    // fields whose loss is already on the record.
    expect(draftStatedItemSchemaKeys().length).toBeGreaterThanOrEqual(6);
    expect(draftClaimSchemaKeys().length).toBeGreaterThanOrEqual(12);
    expect(draftClaimSchemaKeys()).toContain("sets_to");
    expect(draftClaimSchemaKeys()).toContain("is_baseline");
    expect(draftStatedItemSchemaKeys()).toContain("is_baseline");
    expect(Object.keys(populateFromSchema(claimProps)).sort()).toEqual(draftClaimSchemaKeys());
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe("fixed-input replay — the banked live emission is unharmed", () => {
  it("still replays, and still loses its stated figures to M1a (scope, stated honestly)", async () => {
    // ⚠ This assertion is a FACT ABOUT THE REMAINING DEFECT, deliberately pinned
    // so the scope of that lane could not be misread as "money carriage is fixed".
    // M1a — the connectivity prune — is untouched, and 12 of 12 stated values in
    // this real emission are still withdrawn with it. If a later lane exempts
    // stated figures from the prune, THIS TEST MUST GO RED and be rewritten,
    // which is the point: the gap is visible in the suite rather than invisible.
    //
    // ⭐ UPDATED 14 Aug, and the pin is deliberately KEPT AS IT STANDS. The M1a
    // lane did NOT exempt these records — it measured that an exemption fails
    // (the sweep re-prunes 11 of 12 silently; see
    // `m1a-frombrief-lane-2026-08-14/01-M1a-SHAPE-PROBE-lane-G-premise-REFUTED.md`)
    // and instead made the withdrawal carry the user's MAGNITUDE, so the number
    // survives on the disclosure that reports its node's absence. The withdrawal
    // is therefore still real and this assertion is still true; what changed is
    // that it is no longer silent. `stated-magnitude-survives-withdrawal.test.ts`
    // pins the other half.
    const result = await replayRecordSet(loadBankedEmission(), { brief: undefined });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const withValue = loadBankedEmission().stated_items.filter(
      (s) => typeof s.value === "number",
    );
    expect(withValue.length).toBe(12);
    const pruned = result.projection.dropped.filter((d) => d.reason === "unconnected_to_goal");
    expect(pruned.length).toBeGreaterThan(0);
  });

  it("is byte-stable across two replays", async () => {
    const a = await replayRecordSet(loadBankedEmission(), { brief: undefined });
    const b = await replayRecordSet(loadBankedEmission(), { brief: undefined });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
