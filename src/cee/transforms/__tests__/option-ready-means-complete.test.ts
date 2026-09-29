/**
 * ⭐⭐ SLICE A1b (DL #70 5855068711) — AN OPTION WITH A MISSING LEVEL IS NEVER
 * `ready`; ONE FIELD, ONE MEANING FOR OPTION STATUS.
 *
 * THE DEFECT, ON THE WIRE (Paul's staging export `90b8f080`, fixture beside
 * this file). Option `146aa89d` "£59 for new Pro customers; grandfather
 * existing customers" is wired to the controllable factor
 * `fac_existing_customers_grandfathered` with NO level. The same
 * `analysis_ready` payload said BOTH:
 *   · `options[146aa89d].status = "ready"` — decided from the interventions
 *     COUNT alone (it carries one, `pro_plan_price`); and
 *   · `blockers[]` → `missing_value` for (146aa89d, grandfathered), which
 *     `deriveMissingEffectPairs` returns as the one outstanding pair.
 * Every consumer that reads per-option `ready` as "complete" therefore asked
 * nothing about the missing level.
 *
 * THE RULE (Canonical's design, P0A-CANONICAL-DESIGN.md A1): `ready` ⇔ no
 * option-scoped `missing_value` blocker names the option. Such an option
 * becomes the EXISTING `needs_encoding` ("connected, magnitude outstanding"),
 * KEEPS its interventions, and says which factor it is waiting on. The held
 * baseline is never demoted. No new status value, no new field, no schemas
 * change — and the model-level Run verdict does not move.
 *
 * BINDING IS BY IDENTITY (trap 19): every assertion names THE option id.
 */

import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import {
  buildCanonicalAnalysisReadyFromGraph,
  projectOptionForCanonicalBuilder,
  type AnalysisReadyPayload,
} from "../../../orchestrator/tools/analysis-ready-helper.js";
import { deriveMissingEffectPairs } from "../../../orchestrator-v5/routing/repair-value-binding.js";
import {
  deriveBlockedConfiguredOptions,
  deriveUnconfiguredOptionLabels,
} from "../../../orchestrator-v5/handlers/gm-held-execute.js";
import { buildAnalysisAbsentTemplate } from "../../../orchestrator-v5/tools/handlers/no-op-helpers.js";
import { GraphV3, type GraphV3T, type OptionV3T } from "../../../schemas/cee-v3.js";
import { AnalysisReadyPayload as AnalysisReadyPayloadSchema, type AnalysisReadyPayloadT } from "../../../schemas/analysis-ready.js";
import { buildAnalysisReadyPayload, validateAnalysisReadyPayload } from "../analysis-ready.js";
import { rebindRecordedAnalysisHash } from "../../../../tests/helpers/legacy-analysis-hash-v2.js";

// ---------------------------------------------------------------------------
// The served graph (APPEND-ONLY HISTORIC RECORD — see its `_source`).
// ---------------------------------------------------------------------------

type Rec = Record<string, unknown>;
interface Fixture {
  readonly _source: string;
  readonly graph: { nodes: Rec[]; edges: Rec[]; goal_constraints: Rec[] };
}

const FIXTURE = JSON.parse(
  readFileSync(new URL("./fixtures/paul-mrr-grandfather-option.served-90b8f080.json", import.meta.url), "utf8"),
) as Fixture;

const GRANDFATHER_OPTION = "146aa89d";
const GRANDFATHER_FACTOR = "fac_existing_customers_grandfathered";
const GRANDFATHER_FACTOR_LABEL = "Existing customers grandfathered";
const BASELINE = "keep_current_49_price";
/** The five options the served graph holds complete — each must stay `ready`. */
const COMPLETE_OPTIONS = [
  "keep_current_49_price",
  "increase_price_to_59",
  "increase_price_to_54",
  "6dbac00d",
  "ca47b368",
] as const;

function servedGraph(): Fixture["graph"] {
  return structuredClone(FIXTURE.graph);
}

type Canonical = AnalysisReadyPayload;
type WireOption = Canonical["options"][number];

function canonical(graph: unknown): Canonical {
  const payload = buildCanonicalAnalysisReadyFromGraph(graph);
  if (payload === undefined) throw new Error("canonical readiness returned undefined for a served graph");
  return payload;
}

function optionRow(payload: Canonical, id: string): WireOption {
  const row = payload.options.find((o) => o.option_id === id);
  if (row === undefined) throw new Error(`option ${id} absent from analysis_ready.options`);
  return row;
}

function optionNode(graph: Fixture["graph"], id: string): Rec {
  const node = graph.nodes.find((n) => n.id === id && n.kind === "option");
  if (node === undefined) throw new Error(`option node ${id} absent`);
  return node;
}

function pairsFor(payload: Canonical, optionId: string): string[] {
  return deriveMissingEffectPairs(payload)
    .filter((p) => p.optionId === optionId)
    .map((p) => p.factorId);
}

// ---------------------------------------------------------------------------
// 1. The producer — Paul's graph.
// ---------------------------------------------------------------------------

describe("A1b — Paul's served graph: the option with a missing level is not `ready`", () => {
  it("PRECONDITION: the served payload names exactly one outstanding pair, on 146aa89d", () => {
    const r = canonical(servedGraph());
    expect(deriveMissingEffectPairs(r).map((p) => [p.optionId, p.factorId])).toEqual([
      [GRANDFATHER_OPTION, GRANDFATHER_FACTOR],
    ]);
  });

  it("146aa89d is `needs_encoding`, KEEPS {pro_plan_price}, and its status_reason names the missing factor", () => {
    const row = optionRow(canonical(servedGraph()), GRANDFATHER_OPTION);
    expect(row.status).toBe("needs_encoding");
    expect(Object.keys(row.interventions)).toEqual(["pro_plan_price"]);
    expect(row.interventions.pro_plan_price).toBe(0.295);
    expect(row.status_reason).toContain(GRANDFATHER_FACTOR_LABEL);
  });

  it("the other five options stay `ready` (named one by one)", () => {
    const r = canonical(servedGraph());
    for (const id of COMPLETE_OPTIONS) {
      expect({ id, status: optionRow(r, id).status }).toEqual({ id, status: "ready" });
    }
  });

  it("INVARIANT over the payload: a non-baseline option is `ready` exactly when no missing_value pair names it", () => {
    const r = canonical(servedGraph());
    for (const o of r.options) {
      if (o.is_baseline === true) continue;
      expect({ id: o.option_id, ready: o.status === "ready" }).toEqual({
        id: o.option_id,
        ready: pairsFor(r, o.option_id).length === 0,
      });
    }
  });

  it("DISCRIMINATOR: the SAME graph with the level supplied → 146aa89d is `ready`", () => {
    const graph = servedGraph();
    const node = optionNode(graph, GRANDFATHER_OPTION);
    node.interventions = {
      ...(node.interventions as Rec),
      [GRANDFATHER_FACTOR]: {
        value: 1,
        source: "user_specified",
        target_match: { node_id: GRANDFATHER_FACTOR, confidence: "high", match_type: "exact_id" },
      },
    };
    const r = canonical(graph);
    expect(pairsFor(r, GRANDFATHER_OPTION)).toEqual([]);
    const row = optionRow(r, GRANDFATHER_OPTION);
    expect(row.status).toBe("ready");
    expect(Object.keys(row.interventions).sort()).toEqual([GRANDFATHER_FACTOR, "pro_plan_price"].sort());
  });

  it("the HELD BASELINE wired to an unlevelled factor is NOT demoted", () => {
    const graph = servedGraph();
    // A non-repair (user-authored) edge from the status quo to the unlevelled
    // factor: the blocker loop DOES mint a missing_value pair for it, so the
    // only thing that can keep it `ready` is the baseline guard.
    graph.edges.push({
      from: BASELINE,
      to: GRANDFATHER_FACTOR,
      strength: { mean: 1, std: 0.01 },
      exists_probability: 1,
      effect_direction: "positive",
      provenance: { source: "user_specified" },
    });
    const r = canonical(graph);
    expect(pairsFor(r, BASELINE)).toEqual([GRANDFATHER_FACTOR]);
    const row = optionRow(r, BASELINE);
    expect(row.is_baseline).toBe(true);
    expect(row.status).toBe("ready");
  });
});

// ---------------------------------------------------------------------------
// 2. The Run is NOT refused because of this.
// ---------------------------------------------------------------------------

/**
 * RECORDED on origin/staging `339ed343a383e85fde06e627e2d345dd9f3c19a2` — i.e.
 * with this slice's rule ABSENT — by running `buildCanonicalAnalysisReadyFromGraph`
 * on the fixture above. Key order is the producer's, so a `JSON.stringify`
 * comparison is a byte-identity claim about the published verdict.
 */
const RECORDED_WITH_RULE_OFF = {
  status: "needs_user_input",
  may_run: true,
  analysis_admission: {
    structurally_analysable: true,
    missing_important_inputs: [
      {
        issue_id: "semantic_1",
        code: "MISSING_OPTION_VALUE",
        option_id: "146aa89d",
        option_label: "£59 for new Pro customers; grandfather existing customers",
        factor_id: "fac_existing_customers_grandfathered",
        factor_label: "Existing customers grandfathered",
        why_it_matters:
          'Factor "Existing customers grandfathered" needs a numeric value for option "£59 for new Pro customers; grandfather existing customers"',
        obligation: "offered",
        waived_by_exclusion: false,
      },
    ],
    semantic_quality_sufficient: true,
    permitted_analysis_mode: "comparative_leader",
    reasons: [
      { field: "structurally_analysable", code: "READY_TO_COMPARE", message: "Analysis can run on this model as it stands." },
      {
        field: "missing_important_inputs",
        code: "MODEL_HAS_BLOCKERS",
        message: "Olumi filled in the gaps here itself; you can review them, and nothing is required of you.",
      },
      {
        field: "semantic_quality_sufficient",
        code: "CONFIDENCE_PARAMETERS_PARTLY_USER_STATED",
        message: "At least one of the estimates this comparison rests on is yours, so a leading option can be named.",
      },
      {
        field: "permitted_analysis_mode",
        code: "CONFIDENCE_PARAMETERS_PARTLY_USER_STATED",
        message: "At least one of the estimates this comparison rests on is yours, so a leading option can be named.",
      },
    ],
    graph_hash: "a6ed1bff40367766d02b64df98cccbfa22bbb5c26ee4307c4d71235440d08591",
    semantic_signals: {
      confidence_parameters_total: 18,
      confidence_parameters_user_stated: 2,
      confidence_parameters_machine_authored: 14,
      confidence_parameters_unattributed: 2,
      material_parameters_total: 11,
      material_parameters_user_stated: 1,
      intervened_factor_baselines_total: 3,
      intervened_factor_baselines_user_stated: 1,
      material_parameters_awaiting_user_node_ids: ["pro_paying_subscribers", "monthly_churn", "monthly_new_pro_subscribers"],
      goal_target_stated: true,
    },
  },
  readiness_issues: [
    {
      issue_id: "semantic_1",
      repairability: "human_input_required",
      option_id: "146aa89d",
      option_label: "£59 for new Pro customers; grandfather existing customers",
      factor_id: "fac_existing_customers_grandfathered",
      factor_label: "Existing customers grandfathered",
      code: "MISSING_OPTION_VALUE",
      category: "option_values",
      message:
        'Factor "Existing customers grandfathered" needs a numeric value for option "£59 for new Pro customers; grandfather existing customers"',
      provenance: "unattributed",
      obligation: "offered",
    },
  ],
} as const;

/**
 * placeholder-zero (48f2e12f): the served graph gives `fac_existing_customers_grandfathered` — a goal root no
 * option sets — no status-quo level, so readiness now also refuses the Run on it, which is not what A1b is about.
 * This test therefore holds it at 0 (today no existing customer is grandfathered; that is what the new option
 * would change). A disclosed in-test patch: the fixture file is not edited.
 *
 * That one input moves exactly two things in the record, and neither is the verdict: the graph's hash, and the
 * missing-value ask, which now quotes the level (`analysis-ready.ts`: "is currently N. What should option … set it
 * to?"). Everything else must still be byte-identical to the 339ed343 record. The hash below is the same hash
 * function on the patched graph — the CONTROL in the test pins that the unpatched graph still hashes to the
 * recorded value, so the two are comparable.
 */
const GRANDFATHER_STATUS_QUO_LEVEL = 0;
const GRANDFATHER_LEVELLED_ASK =
  'Factor "Existing customers grandfathered" is currently 0. What should option "£59 for new Pro customers; grandfather existing customers" set it to?';
const RECORDED_WITH_STATUS_QUO_LEVEL = {
  ...RECORDED_WITH_RULE_OFF,
  analysis_admission: {
    ...RECORDED_WITH_RULE_OFF.analysis_admission,
    missing_important_inputs: [
      { ...RECORDED_WITH_RULE_OFF.analysis_admission.missing_important_inputs[0], why_it_matters: GRANDFATHER_LEVELLED_ASK },
    ],
    graph_hash: "7cb3e2432dd50a75b47aaba9c447ffd1badace055e38566b049b0813d60ca342",
  },
  readiness_issues: [{ ...RECORDED_WITH_RULE_OFF.readiness_issues[0], message: GRANDFATHER_LEVELLED_ASK }],
} as const;

function servedGraphWithGrandfatherLevel(): Fixture["graph"] {
  const graph = servedGraph();
  const factor = graph.nodes.find((n) => n.id === GRANDFATHER_FACTOR && n.kind === "factor");
  if (factor === undefined) throw new Error(`factor ${GRANDFATHER_FACTOR} absent`);
  factor.observed_state = { value: GRANDFATHER_STATUS_QUO_LEVEL };
  return graph;
}

describe("A1b — the model-level Run verdict does not move", () => {
  it("may_run, analysis_admission, readiness_issues and payload status are byte-identical to the rule-off record", () => {
    // CONTROL: the records were taken under the pre-0.62.0 projection; `rebindRecordedAnalysisHash` proves each record's
    // hash IS that projection of these bytes (throws otherwise), then gives the current projection's hash of the same
    // bytes. Nothing recorded is edited (Shared Data row 1, projection version 3).
    expect(canonical(servedGraph()).analysis_admission?.graph_hash)
      .toBe(rebindRecordedAnalysisHash(servedGraph(), RECORDED_WITH_RULE_OFF.analysis_admission.graph_hash));
    const recordedPatched = {
      ...RECORDED_WITH_STATUS_QUO_LEVEL.analysis_admission,
      graph_hash: rebindRecordedAnalysisHash(servedGraphWithGrandfatherLevel(), RECORDED_WITH_STATUS_QUO_LEVEL.analysis_admission.graph_hash),
    };
    const r = canonical(servedGraphWithGrandfatherLevel());
    // The demotion really happened in this run — otherwise identity is vacuous.
    expect(optionRow(r, GRANDFATHER_OPTION).status).toBe("needs_encoding");
    expect(r.may_run).toBe(true);
    expect(JSON.stringify(r.may_run)).toBe(JSON.stringify(RECORDED_WITH_STATUS_QUO_LEVEL.may_run));
    expect(JSON.stringify(r.analysis_admission)).toBe(JSON.stringify(recordedPatched));
    expect(JSON.stringify(r.readiness_issues)).toBe(JSON.stringify(RECORDED_WITH_STATUS_QUO_LEVEL.readiness_issues));
    expect(r.status).toBe(RECORDED_WITH_STATUS_QUO_LEVEL.status);
  });
});

// ---------------------------------------------------------------------------
// 3. Consumers.
// ---------------------------------------------------------------------------

/** The pipeline producer's own payload for the served graph (what `validateAndLogAnalysisReady` sees). */
function pipelinePayload(graph: Fixture["graph"]): AnalysisReadyPayloadT {
  const parsed: GraphV3T = GraphV3.parse(graph);
  const factorIds = new Set(parsed.nodes.filter((n) => n.kind === "factor").map((n) => n.id));
  const options = graph.nodes
    .filter((n) => n.kind === "option")
    .map((n) => projectOptionForCanonicalBuilder(n, factorIds))
    .filter((o): o is OptionV3T => o !== null);
  return buildAnalysisReadyPayload(options, "mrr", parsed);
}

describe("A1b consumer — validateAnalysisReadyPayload Rule 7 (rebound to the outstanding level)", () => {
  it("a partially configured option with NO raw carrier raises no OPTION_NEEDS_ENCODING_WITHOUT_RAW", () => {
    const graph = servedGraph();
    // Strip the raw carrier so the option has interventions and nothing to encode.
    const node = optionNode(graph, GRANDFATHER_OPTION);
    node.interventions = {
      pro_plan_price: {
        value: 0.295,
        source: "user_specified",
        target_match: { node_id: "pro_plan_price", confidence: "high", match_type: "exact_id" },
      },
    };
    const payload = pipelinePayload(graph);
    const row = payload.options.find((o) => o.id === GRANDFATHER_OPTION);
    // PRECONDITIONS: the option is in the new class, and really has no raw carrier.
    expect(row?.status).toBe("needs_encoding");
    expect(Object.keys(row?.interventions ?? {})).toEqual(["pro_plan_price"]);
    expect(row?.raw_interventions).toBeUndefined();

    const codes = validateAnalysisReadyPayload(payload, GraphV3.parse(graph)).errors
      .filter((e) => e.field === `options[${GRANDFATHER_OPTION}].raw_interventions`)
      .map((e) => e.code);
    expect(codes).toEqual([]);
  });

  it("CONTROL: the rule still fires for a `needs_encoding` option with values, no raw, and no outstanding level", () => {
    const payload: AnalysisReadyPayloadT = AnalysisReadyPayloadSchema.parse({
      options: [
        { id: "opt_a", label: "A", status: "needs_encoding", interventions: { fac_x: 0.5 } },
        { id: "opt_b", label: "B", status: "ready", interventions: { fac_x: 0.2 } },
      ],
      goal_node_id: "goal",
      status: "needs_encoding",
    });
    const graph: GraphV3T = GraphV3.parse({
      nodes: [
        { id: "goal", kind: "goal", label: "Goal" },
        { id: "fac_x", kind: "factor", label: "X" },
        { id: "opt_a", kind: "option", label: "A" },
        { id: "opt_b", kind: "option", label: "B" },
      ],
      edges: [],
    });
    const codes = validateAnalysisReadyPayload(payload, graph).errors
      .filter((e) => e.field === "options[opt_a].raw_interventions")
      .map((e) => e.code);
    expect(codes).toEqual(["OPTION_NEEDS_ENCODING_WITHOUT_RAW"]);
  });
});

describe("A1b consumers LEFT UNCHANGED — each already binds to the true condition", () => {
  it("gm-held receipt: the option is NOT told it has no effect values, and IS disclosed as unsettled, naming the factor", () => {
    const r = canonical(servedGraph());
    const label = optionRow(r, GRANDFATHER_OPTION).label;
    expect(deriveUnconfiguredOptionLabels(r)).not.toContain(label);
    const blocked = deriveBlockedConfiguredOptions(r).find((b) => b.label === label);
    expect(blocked?.reason).toContain(GRANDFATHER_FACTOR_LABEL);
  });

  it("no-op template: the 'has no effect values' branch is not reached — the payload status is needs_user_input", () => {
    const r = canonical(servedGraph());
    expect(r.status).toBe("needs_user_input");
    const blockedLabels = r.options.filter((o) => o.status !== "ready").map((o) => o.label);
    expect(blockedLabels).toEqual([optionRow(r, GRANDFATHER_OPTION).label]);
    const text = buildAnalysisAbsentTemplate(r.options.length, r.status, blockedLabels, r);
    expect(text).not.toMatch(/no effect values/i);
    expect(text).toContain(GRANDFATHER_FACTOR_LABEL);
  });
});
