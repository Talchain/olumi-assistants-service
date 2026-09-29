/**
 * ⭐⭐ THE SHAPE GATE'S OWN WITHDRAWALS ARE NAMED APART FROM THE MODEL'S SILENCE.
 *
 * ── THE DEFECT, MEASURED ON THE BANKED LIVE EMISSION ────────────────────────
 * Replaying `live-emission-round11-set12.json` at `20a5cd85`, three causal links
 * the model DID emit are refused `ref_kind_illegal` before connectivity is
 * computed:
 *
 *   claims[17] "LLM serving cost erodes copilot revenue contribution"
 *   claims[18] "Legal clearance gates enterprise copilot revenue"
 *   claims[22] "Competitive window pressure reduces revenue upside if delayed"
 *
 * Their factor nodes — `LLM Serving Cost` (which carries the stated £3/seat/month),
 * `Data-Processing Legal Clearance`, `Competitive Window` — are then withdrawn by
 * the connectivity prune with `reason: "unconnected_to_goal"`.
 *
 * **That label answers a different question than the one that was asked.**
 *   Q1 "the model never connected this record"        → an honest report of the model's silence.
 *   Q2 "the model connected it and WE cut the link"   → a report of the projector's own decision.
 * Both were minting Q1's name. Trap 21: two questions under one name is how a
 * disclosure vocabulary starts lying — and this file's neighbour
 * `endpoint_demoted_duplicate` already exists for exactly this reason, which is
 * the precedent this change follows rather than a new idea.
 *
 * ── ⚠ THE REFUSAL ITSELF IS CORRECT AND IS NOT CHANGED HERE ────────────────
 * Derived at the consumer's bytes and then EXECUTED (evidence
 * `refkind-gate-lane-2026-08-14/02-COUNTERFACTUAL-gate-off-experiment.md`):
 * `ALLOWED_EDGES` (`graph-validator.types.ts:293-302`) admits `factor → factor`
 * only when the TARGET is `observable`/`external`, and `inferFactorCategories`
 * (`graph-validator.ts:83-134`) makes a factor `controllable` exactly when an
 * option edge points at it — read STRUCTURALLY at `:499-514`, never from the
 * model's declared `category`. With the gate disabled in an isolated worktree the
 * three edges reach the validator untouched by any repair stage and raise
 * `INVALID_EDGE_TYPE` ×3. So the gate is protective; only its CONSEQUENCE was
 * mislabelled. `illegal shapes stay refused` below is the twin that pins this.
 *
 * ── EVERY ASSERTION BINDS BY IDENTITY (trap 19) ────────────────────────────
 * Links are located by their EXACT emitted label, nodes by the projector's own
 * minted id or exact label — never by "the drop whose reason is X", which any
 * other drop could satisfy.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { projectRecordsToGraph } from "../projector.js";
import { enumerateCompletionAsk } from "../completion.js";
import type { DraftRecordSet } from "../grammar.js";

const BANKED = JSON.parse(
  readFileSync(join(__dirname, "fixtures", "live-emission-round11-set12.json"), "utf8"),
) as DraftRecordSet;

/** The three links the model emitted and the shape gate refused — by exact label. */
const GATE_REFUSED_LINKS = [
  "LLM serving cost erodes copilot revenue contribution",
  "Legal clearance gates enterprise copilot revenue",
  "Competitive window pressure reduces revenue upside if delayed",
] as const;

/** Their subject factors — by exact label. These are the withdrawals under test. */
const DISCONNECTED_FACTORS = [
  "LLM Serving Cost",
  "Data-Processing Legal Clearance",
  "Competitive Window",
] as const;

/**
 * ⭐ THE OPPOSITE-DIRECTION TWIN POPULATION (trap 22b). Records the model
 * genuinely never linked — PROVEN by the gate-off counterfactual, in which both
 * priors are STILL withdrawn `unconnected_to_goal`. If a fix relabels these, it
 * has stopped reporting the model's real silence and started excusing it.
 */
const GENUINELY_UNCONNECTED = [
  "LLM serving cost prior: wide uncertainty, finance midpoint £3/seat/month, could be £1.50 to £9",
  "Legal clearance probability is binary and unconfirmed — treat as coin-flip until legal responds",
  "Win rate lift from 22% to 30% is based on 15 AE Slack poll — high uncertainty, treat as optimistic prior",
  "Rewrite duration likely 18-24 months given historical doubling pattern on this codebase",
  "up to £7.2m a year if attach were 100%",
  "deploys take 45 minutes",
] as const;

const project = (records: DraftRecordSet) => projectRecordsToGraph(records);

describe("the shape gate's own withdrawals are named apart from the model's silence", () => {
  it("names the three gate-disconnected factors with the shape-gate reason, NOT unconnected_to_goal", () => {
    const { dropped } = project(BANKED);

    for (const label of DISCONNECTED_FACTORS) {
      const drop = dropped.find((d) => d.label === label);
      expect(drop, `no disclosure for "${label}"`).toBeDefined();
      expect(drop!.reason, `"${label}" must not be reported as the model's failure`).toBe(
        "disconnected_by_shape_gate",
      );
      // The disclosure must still be resolvable and still say it left the graph.
      expect(typeof drop!.node_id).toBe("string");
    }
  });

  it("PRECONDITION: those three factors are disconnected because the gate refused THEIR links", () => {
    // Pins the test's own premise in-test (trap 13b): if the fixture ever stops
    // producing these refusals, the assertion above would pass vacuously on a
    // record set that no longer exercises the seam.
    const { dropped } = project(BANKED);
    for (const label of GATE_REFUSED_LINKS) {
      const drop = dropped.find((d) => d.label === label);
      expect(drop, `link "${label}" is not in the fixture's drops`).toBeDefined();
      expect(drop!.reason).toBe("ref_kind_illegal");
      expect(drop!.from_kind).toBe("factor");
      expect(drop!.to_kind).toBe("factor");
    }
  });

  it("OPPOSITE-DIRECTION TWIN: records the model never linked still read unconnected_to_goal", () => {
    const { dropped } = project(BANKED);

    for (const label of GENUINELY_UNCONNECTED) {
      const drop = dropped.find((d) => d.label === label);
      expect(drop, `no disclosure for "${label}"`).toBeDefined();
      expect(drop!.reason, `"${label}" was never linked by the model — the honest label is unchanged`).toBe(
        "unconnected_to_goal",
      );
    }
  });

  it("relabels EXACTLY three withdrawals on the banked emission — not the whole population", () => {
    // A count assertion in BOTH directions. Too few means the fix missed a case;
    // too many means it is excusing the model's real silence somewhere else.
    const { dropped } = project(BANKED);
    const shapeGate = dropped.filter((d) => d.reason === "disconnected_by_shape_gate");
    expect(shapeGate.map((d) => d.label).sort()).toEqual([...DISCONNECTED_FACTORS].sort());

    // 23 withdrawals at pristine; 3 move; 20 remain. DERIVED from the producer,
    // not arithmetic done in my head — the first version of this line guessed 21.
    const stillUnconnected = dropped.filter((d) => d.reason === "unconnected_to_goal");
    expect(stillUnconnected.length).toBe(20);
  });

  it("leaves PR #951's stated-magnitude carriage exactly where it was", () => {
    // ⚠ THE SUBJECT FACTOR AND THE STATED FIGURE ARE DIFFERENT NODES, and an
    // earlier draft of this test asserted the £3 onto the wrong one. The model's
    // `LLM Serving Cost` claim carries NO value (`{claim_kind:"factor", basis:[10]}`);
    // the £3/seat/month lives on the stated figure it cites, which is its own node
    // and is genuinely unconnected. Pinning both halves so the distinction cannot
    // quietly collapse later.
    const { dropped } = project(BANKED);

    const factor = dropped.find((d) => d.label === "LLM Serving Cost");
    expect(factor?.reason).toBe("disconnected_by_shape_gate");
    expect(factor?.value, "the claim never carried a magnitude — inventing one would be fabrication").toBeUndefined();

    const statedFigure = dropped.find((d) =>
      d.label.startsWith("LLM serving cost is the thing nobody can pin down"),
    );
    expect(statedFigure?.reason, "the user's own figure was never linked — that label is correct").toBe(
      "unconnected_to_goal",
    );
    expect(statedFigure?.value).toBe(3);
    expect(statedFigure?.unit).toBe("£/seat/month");
  });

  it("every stated magnitude PR #951 carries is byte-identical after the relabel", () => {
    // Byte-stability on the seam #951 owns: the reason re-route must not add,
    // remove or alter a single carried value/unit anywhere in the population.
    const { dropped } = project(BANKED);
    const carried = dropped
      .filter((d) => typeof d.value === "number")
      .map((d) => `${d.label}|${d.value}|${d.unit ?? ""}`)
      .sort();
    expect(carried.length).toBe(12);
    expect(carried).toMatchInlineSnapshot(`
      [
        "+£15/seat/month on our 40,000 seats|15|£/seat/month",
        "25% attach feels honest, call it £1.8m|1800000|£",
        "Elena's team said 6 engineers for 8 months once you include evals and the safety review|6|engineers",
        "LLM serving cost is the thing nobody can pin down: finance modelled £3 per seat per month, could be half that or triple depending on caching|3|£/seat/month",
        "deploys take 45 minutes|45|minutes",
        "lift win rate from 22% to 30%|30|%",
        "rewrite = 10 engineers, 12 months, and history says double whatever engineering estimates on this codebase|10|engineers",
        "the board approved £2m for strategic initiatives. Realistically it's £1.2m after the security remediation eats its share|1200000|£",
        "the monolith adds roughly 30% drag to every feature|30|%",
        "up to £7.2m a year if attach were 100%|7200000|£",
        "we lost two staff engineers to it last year|2|engineers",
        "year one is more like 10%, so £700k in year one — the £1.8m is a year-three number|700000|£",
      ]
    `);
  });

  it("records the rule that fired on every refusal, so the ask can name it", () => {
    const { dropped } = project(BANKED);
    const refused = dropped.filter((d) => d.reason === "ref_kind_illegal");
    expect(refused.length).toBe(3);
    for (const d of refused) expect(d.refusal_rule).toBe("option_controlled_target");
  });
});

describe("the gate is unchanged — genuinely illegal shapes are still refused", () => {
  /**
   * ⭐ FIVE shapes from the grammar's OWN domain, each drawn from a derivation
   * already written into `UNRESCUABLE_EDGE_SHAPES`, plus the one-edge rule itself.
   * These prove the change is a RELABEL and not a widening (trap 22b: a fix that
   * closes a gap must be re-measured against the defect it was written to close).
   */
  const illegal: ReadonlyArray<{ name: string; records: DraftRecordSet; from: string; to: string }> = [
    {
      name: "factor -> option (nothing may point into an option)",
      from: "factor",
      to: "option",
      records: {
        stated_items: [
          { kind: "goal", source_quote: "grow ARR", role: "target" },
          { kind: "option", source_quote: "ship the copilot", role: "target" },
        ],
        claims: [
          { claim_kind: "factor", label: "Serving Cost", basis: [], category: "external" },
          {
            claim_kind: "causal_link",
            label: "cost points at the option",
            basis: [],
            effect: "negative",
            from_claim: 0,
            to_stated: 1,
          },
        ],
      } as unknown as DraftRecordSet,
    },
    {
      name: "goal -> factor (nothing may leave a goal)",
      from: "goal",
      to: "factor",
      records: {
        stated_items: [
          { kind: "goal", source_quote: "grow ARR", role: "target" },
          { kind: "option", source_quote: "ship the copilot", role: "target" },
        ],
        claims: [
          { claim_kind: "factor", label: "Serving Cost", basis: [], category: "external" },
          {
            claim_kind: "causal_link",
            label: "goal drives the factor",
            basis: [],
            effect: "positive",
            from_stated: 0,
            to_claim: 0,
          },
        ],
      } as unknown as DraftRecordSet,
    },
    {
      name: "risk -> risk (SIMPLE_REMOVE_PATTERNS deletes it)",
      from: "risk",
      to: "risk",
      records: {
        stated_items: [
          { kind: "goal", source_quote: "grow ARR", role: "target" },
          { kind: "option", source_quote: "ship the copilot", role: "target" },
        ],
        claims: [
          { claim_kind: "risk", label: "Legal Risk", basis: [] },
          { claim_kind: "risk", label: "Attrition Risk", basis: [] },
          {
            claim_kind: "causal_link",
            label: "risk drives risk",
            basis: [],
            effect: "positive",
            from_claim: 0,
            to_claim: 1,
          },
        ],
      } as unknown as DraftRecordSet,
    },
    {
      name: "outcome -> option (the added-2026-08-14 limb of the same rule)",
      from: "outcome",
      to: "option",
      records: {
        stated_items: [
          { kind: "goal", source_quote: "grow ARR", role: "target" },
          { kind: "option", source_quote: "ship the copilot", role: "target" },
        ],
        claims: [
          { claim_kind: "outcome", label: "Revenue Impact", basis: [] },
          {
            claim_kind: "causal_link",
            label: "outcome points at the option",
            basis: [],
            effect: "positive",
            from_claim: 0,
            to_stated: 1,
          },
        ],
      } as unknown as DraftRecordSet,
    },
    {
      name: "risk -> factor (no rule; nothing rewrites it)",
      from: "risk",
      to: "factor",
      records: {
        stated_items: [
          { kind: "goal", source_quote: "grow ARR", role: "target" },
          { kind: "option", source_quote: "ship the copilot", role: "target" },
        ],
        claims: [
          { claim_kind: "risk", label: "Legal Risk", basis: [] },
          { claim_kind: "factor", label: "Serving Cost", basis: [], category: "external" },
          {
            claim_kind: "causal_link",
            label: "risk drives the factor",
            basis: [],
            effect: "positive",
            from_claim: 0,
            to_claim: 1,
          },
        ],
      } as unknown as DraftRecordSet,
    },
  ];

  for (const c of illegal) {
    it(`still refuses ${c.name}`, () => {
      const { dropped } = project(c.records);
      const drop = dropped.find((d) => d.reason === "ref_kind_illegal");
      expect(drop, `${c.name} was NOT refused`).toBeDefined();
      expect(drop!.from_kind).toBe(c.from);
      expect(drop!.to_kind).toBe(c.to);
      // These are shape-level refusals, NOT the one edge rule — the discriminator
      // must say so, or the completion copy would name the wrong rule.
      expect(drop!.refusal_rule).toBe("unrescuable_shape");
    });
  }

  it("still refuses factor -> option-controlled factor (the one edge rule itself)", () => {
    const records = {
      stated_items: [
        { kind: "goal", source_quote: "grow ARR", role: "target" },
        { kind: "option", source_quote: "ship the copilot", role: "target" },
      ],
      claims: [
        { claim_kind: "factor", label: "Revenue", basis: [], category: "controllable" },
        { claim_kind: "factor", label: "Serving Cost", basis: [], category: "external" },
        {
          claim_kind: "causal_link",
          label: "option sets revenue",
          basis: [],
          effect: "positive",
          sets_to: 1,
          from_stated: 1,
          to_claim: 0,
        },
        {
          claim_kind: "causal_link",
          label: "cost erodes revenue",
          basis: [],
          effect: "negative",
          strength: 0.4,
          from_claim: 1,
          to_claim: 0,
        },
      ],
    } as unknown as DraftRecordSet;

    const { dropped } = project(records);
    const drop = dropped.find((d) => d.label === "cost erodes revenue");
    expect(drop?.reason).toBe("ref_kind_illegal");
    expect(drop?.refusal_rule).toBe("option_controlled_target");
  });

  it("CONTRAST: factor -> NON-option-controlled factor is still HELD, not refused", () => {
    // The discriminating half of the pair (trap 19). Same shape, different target
    // category — must survive. Bound to the banked emission's own claims[19],
    // `Engineering Capacity Consumed → Engineering Attrition Risk`, by node label.
    const { graph, dropped } = project(BANKED);
    const nodes = (graph as { nodes: { id: string; label?: string }[] }).nodes;
    const capacity = nodes.find((n) => n.label === "Engineering Capacity Consumed");
    const attrition = nodes.find((n) => n.label === "Engineering Attrition Risk");
    expect(capacity, "fixture precondition: capacity factor is on the graph").toBeDefined();
    expect(attrition, "fixture precondition: attrition factor is on the graph").toBeDefined();

    const edges = (graph as { edges: { from: string; to: string }[] }).edges;
    expect(
      edges.some((e) => e.from === capacity!.id && e.to === attrition!.id),
      "a legal factor→factor link must survive the gate",
    ).toBe(true);
    expect(dropped.find((d) => d.label === "Engineering capacity consumed increases attrition risk")).toBeUndefined();
  });
});

describe("the completion ask tells the truth about what was refused", () => {
  it("does NOT tell the model that factor→factor is unholdable", () => {
    // MEASURED FALSE on this very fixture: claims[19] is a factor→factor link and
    // the model held it. Copy that generalises a category-sensitive refusal into a
    // shape-level prohibition teaches the model away from a legal, useful shape.
    const projection = project(BANKED);
    const ask = enumerateCompletionAsk(BANKED, projection as never);
    const shapeItems = ask.items.filter((i) => i.kind === "illegal_shape");
    expect(shapeItems.length).toBeGreaterThan(0);
    for (const item of shapeItems) {
      expect(item.detail).not.toMatch(/a link from a factor to a factor is not a shape/i);
    }
  });

  it("names the ACTUAL rule — a link into a factor an option already sets", () => {
    const projection = project(BANKED);
    const ask = enumerateCompletionAsk(BANKED, projection as never);
    const item = ask.items.find(
      (i) => i.kind === "illegal_shape" && i.detail.includes("LLM serving cost erodes copilot revenue contribution"),
    );
    expect(item, "the refused link must still be asked about").toBeDefined();
    expect(item!.detail).toMatch(/option/i);
  });

  it("adds NO second ask item for the relabelled withdrawal", () => {
    // The link-level `illegal_shape` ask already covers this record. Asking again
    // at the node level would duplicate the ask and invite the model to re-add a
    // link the projector has already refused, deliberately.
    const projection = project(BANKED);
    const ask = enumerateCompletionAsk(BANKED, projection as never);
    for (const label of DISCONNECTED_FACTORS) {
      expect(
        ask.items.some((i) => i.detail.includes(label) && i.kind === "unconnected_record"),
        `"${label}" must not raise a second, node-level ask`,
      ).toBe(false);
    }
  });
});
