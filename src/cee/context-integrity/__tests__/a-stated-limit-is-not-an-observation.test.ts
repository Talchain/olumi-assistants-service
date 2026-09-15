/**
 * ⭐⭐ A STATED LIMIT IS NOT A STATEMENT ABOUT WHAT IS CURRENTLY TRUE.
 *
 * The defect, measured on live staging 14 Sep 2026 across 11 fresh drafts of
 * one brief containing *"…while keeping monthly churn under 4%…"*: the 4%
 * reached the wire as the churn node's `observed_state.value`, the field whose
 * own declaration reads *"current or proposed value"*. The model therefore
 * asserts **churn IS 4%** when the user said **keep it under 4%**.
 *
 * The capture under `fixtures/live-churn-limit-as-observation-2026-09-14.json`
 * is the served bytes of one of those drafts — an APPEND-ONLY record of what
 * the product actually emitted on a dated build, never a fixture to keep
 * current (CLAUDE.md trap 14b).
 *
 * Every assertion below binds to its object by NODE ID. Not one of them counts
 * nodes or figures: the product's own manifest already counts this graph's
 * figures as "in the model" while the 4% sits in the wrong role, so a count is
 * exactly the instrument that cannot see this defect.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  deriveStatedQuantityRoles,
  deriveNotModelledManifest,
  STATED_KINDS,
  STATED_KIND_PRODUCERS,
} from "../not-modelled-manifest.js";
import { OBSERVED_STATE_STATED_ROLES } from "../stated-role-vocabulary.js";
import { ObservedStateV3, NodeV3 } from "../../../schemas/cee-v3.js";
import { NodeV3Schema, ObservedStateSchema } from "@talchain/schemas";
import { compactGraph } from "../../../orchestrator/context/graph-compact.js";
import { editCompactGraph } from "../../../orchestrator/context/serialise.js";
import { computeAnalysisAffectingGraphHash } from "../../../orchestrator-v5/context/graph-hash.js";
import type { GraphV3T } from "../../../schemas/cee-v3.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const CAPTURE = JSON.parse(
  readFileSync(join(HERE, "fixtures/live-churn-limit-as-observation-2026-09-14.json"), "utf8"),
) as { _provenance: { brief: string }; draft_graph: Record<string, unknown> };

const LIVE_BRIEF = CAPTURE._provenance.brief;
const LIVE_GRAPH = CAPTURE.draft_graph;
/** The node the served capture put the user's LIMIT on as its observed level. */
const CHURN_NODE = "ab78e513";

/** A minimal graph in the shape the boundary stamp reads. */
function graphWith(
  nodes: Array<Record<string, unknown>>,
  goalConstraints: Array<Record<string, unknown>>,
): Record<string, unknown> {
  return { nodes, edges: [], options: [], goal_constraints: goalConstraints };
}

const churnRow = (over: Record<string, unknown> = {}) => ({
  constraint_id: "constraint_churn_max",
  node_id: "n_churn",
  operator: "<=",
  value: 0.04,
  unit: "fraction",
  label: "Keep monthly churn at or below 4%",
  source_quote: "keeping monthly churn under 4%",
  value_frame: "level",
  ...over,
});

const churnNode = (observed: Record<string, unknown> | null) => ({
  id: "n_churn",
  kind: "factor",
  label: "Monthly Churn Rate",
  ...(observed === null ? {} : { observed_state: observed }),
});

describe("the defect: a stated limit recorded as an observation", () => {
  it("binds the served capture's churn node as a stated limit, by node id", () => {
    const roles = deriveStatedQuantityRoles(LIVE_BRIEF, LIVE_GRAPH);

    expect(roles).toEqual([{ node_id: CHURN_NODE, stated_role: "constraint" }]);

    // And the thing being described is real: that node's `observed_state.value`
    // IS the limit's threshold, which is the whole defect.
    const node = (LIVE_GRAPH.nodes as Array<Record<string, unknown>>).find(
      (n) => n.id === CHURN_NODE,
    )!;
    expect((node.observed_state as Record<string, unknown>).value).toBe(0.04);
    const row = (LIVE_GRAPH.goal_constraints as Array<Record<string, unknown>>)[0]!;
    expect(row.node_id).toBe(CHURN_NODE);
    expect(row.value).toBe(0.04);
    expect(row.operator).toBe("<=");
  });

  it("takes the binding from the producer's row, never from a magnitude it matched back", () => {
    // Same graph, same brief, but the row names a DIFFERENT node — the shape a
    // fourth live draft actually produced. A function that re-matched 0.04 to
    // whichever node happens to carry it would still stamp `n_churn`.
    const roles = deriveStatedQuantityRoles(
      "keeping monthly churn under 4%",
      graphWith(
        [churnNode({ value: 0.04, unit: "%" }), { id: "n_other", kind: "risk", label: "Churn Spike" }],
        [churnRow({ node_id: "n_other" })],
      ),
    );
    expect(roles).toEqual([]);
  });
});

describe("negative controls — a fix that reclassifies everything is worse than the defect", () => {
  it("leaves a genuinely observed value stated as an observation alone", () => {
    // "churn is currently 1.9%" — an observation, no limit anywhere.
    const roles = deriveStatedQuantityRoles(
      "monthly churn is currently 1.9% and we want to grow revenue",
      graphWith([churnNode({ value: 0.019, unit: "%" })], []),
    );
    expect(roles).toEqual([]);
  });

  it("leaves a node whose level is independent of the limit alone", () => {
    // Both stated: the observation is 1.9%, the ceiling is 4%. The node holds a
    // real measurement, so nothing here has anything to say about it.
    const roles = deriveStatedQuantityRoles(
      "monthly churn is currently 1.9%, and we are keeping monthly churn under 4%",
      graphWith([churnNode({ value: 0.019, unit: "%" })], [churnRow()]),
    );
    expect(roles).toEqual([]);
  });

  it("refuses when the same magnitude is stated twice, in two roles", () => {
    // ⛔ THE LIE DIRECTION. "churn is currently 4% and we must keep it under 4%"
    // — the observed 0.04 genuinely IS an observation here, and stamping it
    // would tell a user that a rate they measured is only a cap.
    const roles = deriveStatedQuantityRoles(
      "monthly churn is currently 4%, and we are keeping monthly churn under 4%",
      graphWith([churnNode({ value: 0.04, unit: "%" })], [churnRow()]),
    );
    expect(roles).toEqual([]);
  });

  it("says nothing about a node that carries no observed value at all", () => {
    const roles = deriveStatedQuantityRoles(
      "keeping monthly churn under 4%",
      graphWith([churnNode(null)], [churnRow()]),
    );
    expect(roles).toEqual([]);
  });

  it("discards a source_quote that is not in the brief — the fabrication gate", () => {
    const roles = deriveStatedQuantityRoles(
      "keeping monthly churn under 4%",
      graphWith(
        [churnNode({ value: 0.04, unit: "%" })],
        [churnRow({ source_quote: "we agreed a hard ceiling of 4% at the board meeting" })],
      ),
    );
    expect(roles).toEqual([]);
  });

  it("refuses a row whose quoted sentence carries no number at all", () => {
    // ⛔ NOT AN EQUIVALENT MUTANT — DEMONSTRATED. Removing `inSpan.length === 0`
    // from the derivation left the whole suite green until this case existed,
    // and the branch it guards is reachable: a row can quote a sentence with no
    // magnitude in it ("keep monthly churn low") while carrying a threshold the
    // model supplied from elsewhere. Then the row's number did not come from the
    // words it quotes, so there is no evidence the node's level IS that
    // threshold — and the coincidence of two 0.04s is not that evidence.
    const roles = deriveStatedQuantityRoles(
      "we are keeping monthly churn low while we grow",
      graphWith(
        [churnNode({ value: 0.04, unit: "%" })],
        [churnRow({ source_quote: "keeping monthly churn low" })],
      ),
    );
    expect(roles).toEqual([]);
  });

  it("says nothing when there is no brief to check the quote against", () => {
    expect(
      deriveStatedQuantityRoles(null, graphWith([churnNode({ value: 0.04 })], [churnRow()])),
    ).toEqual([]);
    expect(deriveStatedQuantityRoles("keeping monthly churn under 4%", null)).toEqual([]);
  });
});

/**
 * ⭐⭐ THE INDEPENDENT CORPUS THAT FOUND THE DEFECT, ADOPTED INTO THIS SUITE.
 *
 * Authored by Codex, executed against `007e4265` on 14 Sep 2026 — NOT by the
 * author of the implementation. At that head the author's own 23 tests passed
 * 23/23 and the first two cases below passed; **the last two FAILED**, each
 * withdrawing a genuine user observation. Both are reproduced here in the
 * signature they failed with:
 *
 *     AssertionError: expected [ { node_id: 'n_churn', …(1) } ] to deeply equal []
 *
 * They live here permanently, controls included. The two passing controls are
 * not decoration: they are what stops the repair over-correcting into silence,
 * which would trade a lie for a gap and delete this change's whole value
 * (CLAUDE.md trap 22b — a corpus testing one direction is a guard watching one
 * door). The graph shape is the reviewer's, kept as written.
 */
const codexChurnGraph = (quote: string) => ({
  nodes: [
    {
      id: "n_churn",
      kind: "factor",
      label: "Monthly Churn Rate",
      observed_state: {
        value: 0.04,
        unit: "%",
        source: "brief_extraction",
        extractionType: "explicit",
      },
    },
  ],
  edges: [],
  options: [],
  goal_constraints: [
    {
      constraint_id: "churn_max",
      node_id: "n_churn",
      operator: "<=",
      value: 0.04,
      unit: "fraction",
      value_frame: "level",
      source_quote: quote,
    },
  ],
});

const CAP = "keeping monthly churn under 4%";
const STAMPED = [{ node_id: "n_churn", stated_role: "constraint" }];

describe("the reviewer's corpus — a genuine observation must survive the stamp", () => {
  it("positive control: limit alone retains the new classification", () => {
    expect(deriveStatedQuantityRoles(CAP, codexChurnGraph(CAP))).toEqual(STAMPED);
  });

  it("negative control: same written number in an observation remains an observation", () => {
    expect(
      deriveStatedQuantityRoles(`monthly churn is currently 4%, while ${CAP}`, codexChurnGraph(CAP)),
    ).toEqual([]);
  });

  it("a decimal spelling must not erase a genuinely stated observation", () => {
    // ⛔ RED AT `007e4265`. The guard compared LITERALS, so `"4.0%"` was not the
    // string `"4%"`, no restatement was detected, and the user's measured rate
    // was demoted to an assumption. Literal identity is not quantity identity.
    expect(
      deriveStatedQuantityRoles(
        `monthly churn is currently 4.0%, while ${CAP}`,
        codexChurnGraph(CAP),
      ),
    ).toEqual([]);
  });

  it("a whole-sentence source quote must not erase a genuinely stated observation", () => {
    // ⛔ RED AT `007e4265`, and for a different reason: when the row quotes the
    // whole sentence there is no "outside the span" left to search, so a guard
    // that only looked outside it passed VACUOUSLY. Both roles are legitimately
    // inside one quote.
    const brief = `monthly churn is currently 4%, while ${CAP}`;
    expect(deriveStatedQuantityRoles(brief, codexChurnGraph(brief))).toEqual([]);
  });

  // ── the reviewer's SECOND round, at the repaired head ────────────────────
  // The four cases above were answered by counting occurrences of a magnitude.
  // That is still reasoning from an ABSENCE, and this pair is what showed the
  // limit of it: one occurrence can carry both roles at once. It is the reason
  // the guard now asks for the words that make a number a bound.

  it("one written magnitude may explicitly carry both observation and limit roles", () => {
    // ⛔ RED against the occurrence-count rule alone. `4%` is written ONCE, so
    // nothing is restated — and the user still plainly stated the observation.
    const brief = "monthly churn is currently 4%, and that is also our maximum";
    expect(deriveStatedQuantityRoles(brief, codexChurnGraph(brief))).toEqual([]);
  });

  it("positive twin: one limit with an unknown observation remains a limit", () => {
    // The reviewer's own twin, and the control that stops the repair above
    // degenerating into "a whole-brief quote never stamps". Same quote extent,
    // same single occurrence — the wording is the whole difference.
    const brief = "monthly churn must stay below 4%; its current value is unknown";
    expect(deriveStatedQuantityRoles(brief, codexChurnGraph(brief))).toEqual(STAMPED);
  });
});

describe("the stamp asks for the words that make a number a bound", () => {
  it("withholds where the magnitude's own clause states a reading", () => {
    // "is currently 4%" — a reading. No cue, no stamp, however the row is
    // worded: the producer's `operator` is its claim, the user's words are the
    // oracle.
    const brief = "monthly churn is currently 4% and we plan to hold it there";
    expect(deriveStatedQuantityRoles(brief, codexChurnGraph(brief))).toEqual([]);
  });

  it("will not borrow a cue from a neighbouring clause", () => {
    // ⚠ THE CLAUSE CUT IS LOAD-BEARING. "keep ... under" sits in the first
    // clause and the magnitude in the second; a cue search over the whole quote
    // would find it and stamp a reading.
    const brief = "we must keep spend under control, monthly churn is currently 4%";
    expect(deriveStatedQuantityRoles(brief, codexChurnGraph(brief))).toEqual([]);
  });

  it("recognises a floor as a limit, not only a ceiling", () => {
    // A bound is a bound in both directions. A cue list carrying only ceiling
    // words would silently drop every floor a user states.
    const brief = "monthly churn must not fall below 4%; its current value is unknown";
    expect(deriveStatedQuantityRoles(brief, codexChurnGraph(brief))).toEqual(STAMPED);
  });
});

describe("the opposite direction — the repair must not answer a lie with silence", () => {
  // Every case above demands SILENCE. On its own that corpus is satisfied by a
  // function that returns `[]` for everything, which is the over-correction the
  // review explicitly refused to accept. Each twin below is the same shape with
  // the one discriminating fact changed, and every one of them must STAMP.

  it("an unrelated magnitude elsewhere in the brief does not withhold the stamp", () => {
    // Twin of the positive control. The rule counts occurrences of THIS
    // magnitude, not "is there a second number anywhere".
    expect(
      deriveStatedQuantityRoles(`${CAP} and reaching £20k MRR`, codexChurnGraph(CAP)),
    ).toEqual(STAMPED);
  });

  it("an observation stating a DIFFERENT magnitude does not withhold the stamp", () => {
    // Twin of the negative control: 7% is an independent observation, and the
    // 4% is still stated exactly once.
    expect(
      deriveStatedQuantityRoles(`monthly churn is currently 7%, while ${CAP}`, codexChurnGraph(CAP)),
    ).toEqual(STAMPED);
  });

  it("a nearby decimal that is a different magnitude does not withhold the stamp", () => {
    // Twin of the decimal case. The repair must recognise `4.0%` as four
    // percent WITHOUT collapsing `4.5%` into it.
    expect(
      deriveStatedQuantityRoles(
        `monthly churn is currently 4.5%, while ${CAP}`,
        codexChurnGraph(CAP),
      ),
    ).toEqual(STAMPED);
  });

  it("a whole-sentence quote is not itself disqualifying", () => {
    // Twin of the whole-sentence case. What withheld the stamp there was the
    // magnitude occurring twice, not the quote's extent — so the same extent
    // with ONE occurrence must still stamp.
    const brief = `we are ${CAP}`;
    expect(deriveStatedQuantityRoles(brief, codexChurnGraph(brief))).toEqual(STAMPED);
  });

  it("a bare number match of a different KIND does not withhold the stamp", () => {
    // ⚠ THE RULE IS NOT `value === value`. "4 people" and "4%" share a number
    // and state nothing in common; collapsing them would be the unframed
    // comparison this repair exists to avoid, one level down.
    expect(
      deriveStatedQuantityRoles(`we have 4 people, while ${CAP}`, codexChurnGraph(CAP)),
    ).toEqual(STAMPED);
  });
});

describe("equivalent notation is recognised beyond the percent case", () => {
  // The decimal case is one instance of a general rule, and a corpus that only
  // ever exercises `4.0%` cannot show the rule is general. Money carries the
  // same hazard in a different notation: a magnitude suffix.
  const spendGraph = (quote: string) => ({
    nodes: [
      {
        id: "n_spend",
        kind: "factor",
        label: "Annual Spend",
        observed_state: { value: 2_000_000, unit: "gbp", source: "brief_extraction" },
      },
    ],
    edges: [],
    options: [],
    goal_constraints: [
      {
        constraint_id: "spend_max",
        node_id: "n_spend",
        operator: "<=",
        value: 2_000_000,
        unit: "gbp",
        source_quote: quote,
      },
    ],
  });
  const SPEND_CAP = "keeping annual spend under £2m";
  const SPEND_STAMPED = [{ node_id: "n_spend", stated_role: "constraint" }];

  it("withholds where a magnitude suffix restates the same amount", () => {
    // "£2,000,000" and "£2m" are one amount written two ways. The literal test
    // could not see this either.
    expect(
      deriveStatedQuantityRoles(
        `annual spend is £2,000,000 today, while ${SPEND_CAP}`,
        spendGraph(SPEND_CAP),
      ),
    ).toEqual([]);
  });

  it("stamps where the restated amount is different", () => {
    expect(
      deriveStatedQuantityRoles(
        `annual spend is £3m today, while ${SPEND_CAP}`,
        spendGraph(SPEND_CAP),
      ),
    ).toEqual(SPEND_STAMPED);
  });

  it("stamps where the same number carries a different currency", () => {
    // ⚠ $2m is not £2m. Equivalence requires the currency symbol to agree, or
    // the guard would withhold on a magnitude the user never restated.
    expect(
      deriveStatedQuantityRoles(
        `annual spend is $2m today, while ${SPEND_CAP}`,
        spendGraph(SPEND_CAP),
      ),
    ).toEqual(SPEND_STAMPED);
  });
});

describe("the manifest's own classification is untouched", () => {
  it("still reports every figure in the served capture as `figure`", () => {
    // ⚠ A MEASURED FACT ABOUT THE SHIPPED AUTHORITY, PINNED SO THIS CHANGE
    // CANNOT HAVE MOVED IT. `classifyStatedKind` compares the brief-frame
    // magnitude (4, percentage points as written) with the producer-frame value
    // (0.04, `value_frame: "level"`), and `numbersEqual` performs no frame
    // conversion — so for this fraction-framed percent row the `constraint`
    // conjunction cannot hold and every figure classifies `figure`. That is a
    // separate, reported finding; it is NOT repaired here, and this assertion
    // exists so a repair of it is a visible decision rather than a side effect.
    const manifest = deriveNotModelledManifest(LIVE_BRIEF, LIVE_GRAPH);
    expect(manifest.status).toBe("derived");
    const kinds = manifest.quantities!.items.map((i) => `${i.literal}:${i.stated_kind}`);
    expect(kinds).toEqual([
      "£49:figure",
      "£59:figure",
      "4%:figure",
      "£20k:figure",
      "12 months:figure",
    ]);
  });
});

describe("the stamp moves no number, and no verdict", () => {
  it("is excluded from the analysis-affecting graph hash", () => {
    // ⚠ A NEW FIELD ON `observed_state` COULD FLIP EVERY FRESHNESS VERDICT. The
    // projection is a positive whitelist — `projectObservedState` picks exactly
    // `['value','baseline','cap']` — so the stamp is excluded by construction,
    // the same guarantee the ROADMAP 2.972 withdrawal relies on for
    // `extractionType`. Asserted by EXECUTION rather than by reading the list,
    // because a whitelist is only a guarantee while it stays a whitelist.
    const base = {
      nodes: [
        {
          id: "n_churn",
          kind: "factor",
          label: "Monthly Churn Rate",
          observed_state: { value: 0.04, unit: "%", extractionType: "explicit" },
        },
      ],
      edges: [],
    };
    const stamped = {
      ...base,
      nodes: [
        {
          ...base.nodes[0]!,
          observed_state: { ...base.nodes[0]!.observed_state, stated_role: "constraint" },
        },
      ],
    };
    expect(computeAnalysisAffectingGraphHash(stamped)).toBe(
      computeAnalysisAffectingGraphHash(base),
    );

    // Positive control: the hash is not simply constant.
    const moved = {
      ...base,
      nodes: [{ ...base.nodes[0]!, observed_state: { ...base.nodes[0]!.observed_state, value: 0.05 } }],
    };
    expect(computeAnalysisAffectingGraphHash(moved)).not.toBe(
      computeAnalysisAffectingGraphHash(base),
    );
  });
});

describe("the limit this inherits from its oracle, disclosed rather than discovered later", () => {
  it("follows the row onto a subject the brief never mentions", () => {
    // ⚠ MEASURED, AND IT IS NOT A PASS — it is the boundary of what a stamp
    // derived from `goal_constraints[]` can be right about. A row that binds the
    // churn ceiling to "New Customer Conversion Rate" (a real live shape, and a
    // sibling lane's subject) takes this stamp with it: the ROLE is reported
    // correctly and the SUBJECT is the row's error, inherited.
    //
    // The direction matters and is the reason this is disclosed rather than
    // guarded: the stamp LOWERS the authorship claim (`user`/`from_brief` ->
    // `assumption`/`ai_inferred`), so a mis-bound figure is never made to look
    // MORE authoritative by it. Second-guessing the producer's own binding here
    // would be the rival authority this change exists to avoid.
    const roles = deriveStatedQuantityRoles("we are keeping monthly churn under 4% while we grow", {
      nodes: [
        {
          id: "n_conv",
          kind: "factor",
          label: "New Customer Conversion Rate",
          observed_state: { value: 0.04, unit: "%", extractionType: "explicit" },
        },
      ],
      edges: [],
      options: [],
      goal_constraints: [
        {
          constraint_id: "c1",
          node_id: "n_conv",
          operator: "<=",
          value: 0.04,
          unit: "fraction",
          source_quote: "keeping monthly churn under 4%",
        },
      ],
    });
    expect(roles).toEqual([{ node_id: "n_conv", stated_role: "constraint" }]);
  });
});

describe("the vocabulary is a subset of the authority, derived rather than transcribed", () => {
  it("declares only roles the authority knows", () => {
    for (const role of OBSERVED_STATE_STATED_ROLES) {
      expect(STATED_KINDS as readonly string[]).toContain(role);
    }
  });

  it("declares every sourced kind except the authority's own default", () => {
    // Fails loud in BOTH directions: a new live producer in
    // `STATED_KIND_PRODUCERS` that this alphabet cannot express REDs here, and
    // so does a member here the authority does not source.
    const sourced = STATED_KINDS.filter((k) => STATED_KIND_PRODUCERS[k] !== undefined);
    const expressible = sourced.filter((k) => k !== "figure");
    expect([...OBSERVED_STATE_STATED_ROLES].sort()).toEqual([...expressible].sort());
  });
});

describe("the wire carries the role", () => {
  it("accepts the stamp on observed_state", () => {
    const parsed = ObservedStateV3.parse({ value: 0.04, unit: "%", stated_role: "constraint" });
    expect(parsed.stated_role).toBe("constraint");
  });

  it("refuses a role the producer cannot emit", () => {
    expect(ObservedStateV3.safeParse({ value: 0.04, stated_role: "target" }).success).toBe(false);
  });

  it("treats absence as undeclared, not as an observation", () => {
    expect(ObservedStateV3.parse({ value: 0.04 }).stated_role).toBeUndefined();
  });

  it("survives every validator between the stamp and the consumer", () => {
    // ⚠ A DECLARED FIELD CAN STILL SHIP DARK. `GoalConstraintSchema` carries the
    // estate's own account of exactly this: a plain `z.object` "SILENTLY
    // DELETES" an undeclared key "at every parse hop between the mint site and
    // the payload, and the stamp would reach nothing with no error anywhere."
    // The stamp lands at the V3 boundary and is read from the STORED graph, so
    // the hops in between are asserted by execution rather than by reading.
    const stamped = {
      id: "ab78e513",
      kind: "factor",
      label: "Monthly Churn Rate",
      observed_state: {
        value: 0.04,
        unit: "%",
        source: "brief_extraction",
        extractionType: "explicit",
        stated_role: "constraint",
      },
    };

    // CEE's own node validator — a plain `z.object` that strips unknown keys,
    // but whose `observed_state` is the passthrough object declaring the field.
    expect((NodeV3.parse(stamped) as Record<string, any>).observed_state.stated_role).toBe(
      "constraint",
    );
    // The shared contract, both levels.
    expect((ObservedStateSchema.parse(stamped.observed_state) as Record<string, any>).stated_role)
      .toBe("constraint");
    const viaContract = NodeV3Schema.safeParse(stamped);
    expect(viaContract.success).toBe(true);
    expect(
      (viaContract as { data: Record<string, any> }).data.observed_state.stated_role,
    ).toBe("constraint");
  });
});

describe("the consumer honours it — the model's own view of the graph", () => {
  const nodeWith = (observed: Record<string, unknown>) =>
    ({
      nodes: [{ id: "n_churn", kind: "factor", label: "Monthly Churn Rate", observed_state: observed }],
      edges: [],
      options: [],
    }) as unknown as GraphV3T;

  const OBSERVED_AS_SERVED = { value: 0.04, unit: "%", source: "brief_extraction", extractionType: "explicit" };

  it("tells the model the magnitude is a limit — in the projection the model reads", () => {
    // ⭐ THE LOAD-BEARING ASSERTION OF THE WHOLE CHANGE. The role must reach the
    // MODEL-FACING object, not merely the stored graph: this is what makes "a
    // limit is not an observation" true for the assistant rather than for a
    // field nobody reads.
    const compact = compactGraph(nodeWith({ ...OBSERVED_AS_SERVED, stated_role: "constraint" }));
    const node = compact.nodes.find((n) => n.id === "n_churn")!;
    expect(node.stated_role).toBe("constraint");
    // The magnitude itself is the user's and is untouched.
    expect(node.value).toBe(0.04);
    expect(node.unit).toBe("%");
  });

  it("⛔ WITHDRAWN: the role no longer rewrites who supplied the number", () => {
    // ⛔ THIS ASSERTED THE OPPOSITE UNTIL THIS COMMIT (`source: 'assumption'`,
    // `provenance: 'ai_inferred'`). An independent review established the case
    // that rewrite cannot survive: *"monthly churn must stay below 4%, and that
    // is where it sits today"* states ONE magnitude in TWO true roles, and
    // demoting there withdraws a claim the user genuinely made.
    //
    // The demotion is justified only where the user stated NO observation, and
    // THAT ABSENCE CANNOT BE ESTABLISHED — the sentence above and the honest
    // limit-only one are identical in graph, quote extent, occurrence count and
    // `operator`, differing only in English. So the evidence the destructive
    // act requires cannot be produced, and the act is unjustified in principle
    // rather than merely unimplemented.
    //
    // This assertion exists so that re-adding the demotion REDs here, and so a
    // future session must answer the evidence argument rather than arrive with
    // a better regex.
    const compact = compactGraph(nodeWith({ ...OBSERVED_AS_SERVED, stated_role: "constraint" }));
    const node = compact.nodes.find((n) => n.id === "n_churn")!;
    expect(node.source).toBe("user");
    expect(node.provenance).toBe("from_brief");
  });

  it("the authorship chain still runs to a verdict for a stamped node", () => {
    // ⚠ NOT A DUPLICATE OF THE ARM ABOVE, AND IT CAUGHT A REAL DEFECT. The
    // withdrawn rewrite was an `if/else if` ARM, so simply deleting its two
    // lines left a stamped node falling into a branch that assigned NOTHING —
    // the role would have survived while `source` and `provenance` vanished
    // entirely. Asserting a value is not the same as asserting the field is
    // present, so both are asserted here.
    const compact = compactGraph(nodeWith({ ...OBSERVED_AS_SERVED, stated_role: "constraint" }));
    const node = compact.nodes.find((n) => n.id === "n_churn")! as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(node, "source")).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(node, "provenance")).toBe(true);
    expect(node.source).not.toBeUndefined();
    expect(node.provenance).not.toBeUndefined();
  });

  it("DISCRIMINATING TWIN — an unstamped node is projected identically but for the role", () => {
    // The pair now proves the stamp changes the ROLE and NOTHING ELSE. Before
    // the withdrawal this twin discriminated authorship; now the whole point is
    // that authorship does NOT move, so the twin must show the two projections
    // differing in exactly one key.
    const stamped = compactGraph(nodeWith({ ...OBSERVED_AS_SERVED, stated_role: "constraint" }))
      .nodes.find((n) => n.id === "n_churn")! as Record<string, unknown>;
    const plain = compactGraph(nodeWith(OBSERVED_AS_SERVED))
      .nodes.find((n) => n.id === "n_churn")! as Record<string, unknown>;

    expect(plain.stated_role).toBeUndefined();
    expect(plain.source).toBe("user");
    expect(plain.provenance).toBe("from_brief");

    const differing = new Set<string>();
    for (const k of new Set([...Object.keys(stamped), ...Object.keys(plain)])) {
      if (JSON.stringify(stamped[k]) !== JSON.stringify(plain[k])) differing.add(k);
    }
    expect([...differing]).toEqual(["stated_role"]);
  });

  // ── the EDIT pack is a SECOND consumer, and it was dark ──────────────────
  // ⚠ THE REASONING PACK IS NOT THE PACK THAT WRITES. `editCompactGraph`
  // (`orchestrator/context/serialise.ts`) builds the graph the EDITING model
  // sees, and its `observed_state` is a CLOSED destructure — a field absent
  // from that list reaches the editing model not at all, with no error
  // anywhere. `stated_role` was declared on the wire, accepted by every
  // validator, and honoured by `compactGraph`, and still arrived at the edit
  // path as nothing. The editing path is where the wrong-entity and
  // non-baseline edit defects were measured, so this is the surface that
  // needed it most. Asserted by EXECUTION against the real projection, never
  // by reading the field list.

  it("reaches the EDITING model, not only the reasoning model", () => {
    const pack = editCompactGraph(nodeWith({ ...OBSERVED_AS_SERVED, stated_role: "constraint" }));
    const node = pack.nodes.find((n) => n.id === "n_churn")!;
    expect(node.observed_state?.stated_role).toBe("constraint");
    // The magnitude still travels — the role qualifies it, it does not replace it.
    expect(node.observed_state?.value).toBe(0.04);
  });

  it("DISCRIMINATING TWIN — an unstamped node carries no role into the edit pack", () => {
    // Without this, the arm above passes on a projection that hardcodes the
    // value, or on one that copies `observed_state` wholesale for every node.
    const pack = editCompactGraph(nodeWith(OBSERVED_AS_SERVED));
    const node = pack.nodes.find((n) => n.id === "n_churn")!;
    expect(node.observed_state?.stated_role).toBeUndefined();
    expect(node.observed_state?.value).toBe(0.04);
  });

  it("DISCLOSED: the edit pack gates observed_state on kind, and the stamp does not", () => {
    // ⚠ MEASURED, AND IT IS A LIMIT RATHER THAN A PASS. The boundary stamp
    // (`boundary.ts`) writes `stated_role` on ANY node carrying a numeric
    // `observed_state.value` — it does not look at `kind`. `compactGraph` also
    // does not. `editCompactGraph` projects `observed_state` only inside
    // `if (node.kind === 'factor')`, so for a constraint bound to a non-factor
    // node the edit pack drops the WHOLE observed_state, this field with it.
    //
    // That gate is pre-existing and far wider than this field — widening it
    // would change the edit pack for `value`, `cap` and nine others — so it is
    // recorded here rather than quietly changed. This assertion REDs if the
    // gate moves, making any such change a visible decision.
    const risk = {
      nodes: [{ id: "n_risk", kind: "risk", label: "Churn Spike",
        observed_state: { ...OBSERVED_AS_SERVED, stated_role: "constraint" } }],
      edges: [], options: [],
    } as unknown as GraphV3T;

    expect(editCompactGraph(risk).nodes.find((n) => n.id === "n_risk")!.observed_state)
      .toBeUndefined();
    // Positive control, same payload: the REASONING pack has no such gate, so
    // this is the edit pack's own exclusion and not an invalid fixture.
    expect(compactGraph(risk).nodes.find((n) => n.id === "n_risk")!.stated_role)
      .toBe("constraint");
  });
});

describe("the negative controls fail for the reason they name", () => {
  /**
   * ⚠ PIN THE PRECONDITION IN-TEST (CLAUDE.md trap 13b). Two of the controls
   * above assert an EMPTY result, and an empty result has several possible
   * causes — most cheaply, a `source_quote` that does not locate in the brief,
   * which the fabrication gate discards before any of this module's own logic
   * runs. A control refusing for that reason is not testing what it claims.
   *
   * It happened: the first draft of the two-roles control wrote a brief saying
   * *"we must keep"* against a row quoting *"keeping"*, so the quote never
   * located and the case passed while the guard it was written for was
   * DISARMED — proven by a mutant that removed the guard and stayed green.
   * These assertions are what caught it, and are what stop it recurring.
   */
  const locates = (brief: string, quote: string) => brief.includes(quote);

  it("the two-roles control's quote really is in its brief", () => {
    expect(
      locates(
        "monthly churn is currently 4%, and we are keeping monthly churn under 4%",
        "keeping monthly churn under 4%",
      ),
    ).toBe(true);
  });

  it("the independent-level control's quote really is in its brief", () => {
    expect(
      locates(
        "monthly churn is currently 1.9%, and we are keeping monthly churn under 4%",
        "keeping monthly churn under 4%",
      ),
    ).toBe(true);
  });

  it("and the fabrication-gate control's quote really is NOT — the contrast", () => {
    expect(
      locates(
        "keeping monthly churn under 4%",
        "we agreed a hard ceiling of 4% at the board meeting",
      ),
    ).toBe(false);
  });
});
