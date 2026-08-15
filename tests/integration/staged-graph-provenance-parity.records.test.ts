/**
 * Typed-record compiler → staged V3 graph → terminal V3 graph provenance parity.
 *
 * A deployed 10-draw corpus found stable node identity but 3–5 authorship
 * disagreements per affected draw: GRAPH_READY called every stated goal/option
 * `ai_inferred`, then COMPLETE changed the same ids to `from_brief`. These tests
 * replay the compiler seam without an LLM and bind the fix to the whole chain,
 * rather than to either projection in isolation.
 */
import { describe, expect, it } from "vitest";

import type { DraftRecordSet } from "../../src/cee/draft/records/grammar.js";
import { projectDraftRecords } from "../../src/cee/draft/records/seam.js";
import {
  transformResponseToV3,
  type V3DraftGraphResponse,
} from "../../src/cee/transforms/schema-v3.js";
import type { V1DraftGraphResponse } from "../../src/cee/transforms/schema-v2.js";
import { projectGraphForStagedFrame } from "../../src/cee/unified-pipeline/staged-graph-projection.js";

interface RecordCase {
  readonly name: string;
  readonly brief: string;
  readonly records: DraftRecordSet;
  readonly expectedFromBrief: readonly string[];
  readonly expectedAiInferred: readonly string[];
}

const CASES: readonly RecordCase[] = [
  {
    name: "hiring",
    brief: "Should I hire a Tech lead or two developers to increase productivity?",
    records: {
      stated_items: [
        { kind: "goal", source_quote: "increase productivity" },
        { kind: "option", source_quote: "hire a Tech lead" },
        { kind: "option", source_quote: "two developers" },
      ],
      claims: [
        { claim_kind: "factor", label: "Engineering Throughput", basis: [0] },
        { claim_kind: "outcome", label: "Feature Delivery Rate", basis: [0] },
        { claim_kind: "risk", label: "Coordination Overhead", basis: [0] },
        { claim_kind: "causal_link", label: "lead changes throughput", from_stated: 1, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "developers change throughput", from_stated: 2, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "throughput changes delivery", from_claim: 0, to_claim: 1, effect: "positive" },
        { claim_kind: "causal_link", label: "delivery reaches goal", from_claim: 1, to_stated: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "coordination threatens goal", from_claim: 2, to_stated: 0, effect: "negative" },
      ],
    },
    expectedFromBrief: ["increase productivity", "hire a Tech lead", "two developers"],
    expectedAiInferred: ["Decision", "Engineering Throughput", "Coordination Overhead"],
  },
  {
    name: "crm",
    brief:
      "Should we replace HubSpot or keep our current CRM? We want higher productivity within budget and need to minimise disruption for 30 people.",
    records: {
      stated_items: [
        { kind: "goal", source_quote: "higher productivity within budget" },
        { kind: "option", source_quote: "replace HubSpot" },
        { kind: "option", source_quote: "keep our current CRM", is_baseline: true },
        { kind: "constraint", source_quote: "minimise disruption for 30 people" },
      ],
      claims: [
        { claim_kind: "factor", label: "Workflow Efficiency", basis: [0] },
        { claim_kind: "outcome", label: "Team Productivity", basis: [0] },
        { claim_kind: "causal_link", label: "replace changes workflow", from_stated: 1, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "keep changes workflow", from_stated: 2, to_claim: 0, effect: "negative" },
        { claim_kind: "causal_link", label: "workflow changes productivity", from_claim: 0, to_claim: 1, effect: "positive" },
        { claim_kind: "causal_link", label: "productivity reaches goal", from_claim: 1, to_stated: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "disruption threatens goal", from_stated: 3, to_stated: 0, effect: "negative" },
      ],
    },
    expectedFromBrief: [
      "higher productivity within budget",
      "replace HubSpot",
      "keep our current CRM",
      "minimise disruption for 30 people",
    ],
    expectedAiInferred: ["Decision", "Workflow Efficiency", "Team Productivity"],
  },
  {
    name: "pricing with a value-bearing target",
    brief:
      "Our target for next year is £3,000,000. Options are raise enterprise pricing by 30% or hold price and push volume instead.",
    records: {
      stated_items: [
        {
          kind: "goal",
          source_quote: "Our target for next year is £3,000,000",
          value: 3_000_000,
          unit: "£",
          role: "target",
        },
        { kind: "option", source_quote: "raise enterprise pricing by 30%" },
        { kind: "option", source_quote: "hold price and push volume instead", is_baseline: true },
      ],
      claims: [
        { claim_kind: "factor", label: "Enterprise Contract Value", basis: [0] },
        { claim_kind: "outcome", label: "Annual Recurring Revenue", basis: [0] },
        { claim_kind: "causal_link", label: "raise changes contract value", from_stated: 1, to_claim: 0, effect: "positive" },
        { claim_kind: "causal_link", label: "hold changes contract value", from_stated: 2, to_claim: 0, effect: "negative" },
        { claim_kind: "causal_link", label: "contract value changes ARR", from_claim: 0, to_claim: 1, effect: "positive" },
        { claim_kind: "causal_link", label: "ARR reaches target", from_claim: 1, to_stated: 0, effect: "positive" },
      ],
    },
    // The typed projector has already verified the quote AND its number. That
    // stronger evidence wins before the legacy value-bearing label fallback.
    expectedFromBrief: [
      "Our target for next year is £3,000,000",
      "raise enterprise pricing by 30%",
      "hold price and push volume instead",
    ],
    expectedAiInferred: ["Decision"],
  },
];

interface ComparableNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly provenance: unknown;
  readonly is_baseline: unknown;
  readonly goal_threshold: unknown;
  readonly goal_threshold_raw: unknown;
  readonly goal_threshold_unit: unknown;
}

function comparableNodes(nodes: readonly unknown[]): ComparableNode[] {
  return nodes
    .map((value) => {
      const node = value as Record<string, unknown>;
      return {
        id: String(node.id),
        kind: String(node.kind),
        label: String(node.label),
        provenance: node.provenance,
        is_baseline: node.is_baseline,
        goal_threshold: node.goal_threshold,
        goal_threshold_raw: node.goal_threshold_raw,
        goal_threshold_unit: node.goal_threshold_unit,
      };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

interface StagedV3Graph {
  readonly nodes: readonly unknown[];
  readonly edges: readonly unknown[];
  readonly options: readonly unknown[];
  readonly goal_node_id: string;
}

function compileRecords(
  records: DraftRecordSet,
  brief: string | undefined,
  name: string,
): {
  readonly sourceGraph: { readonly nodes: readonly unknown[]; readonly edges: readonly unknown[] };
  readonly staged: StagedV3Graph;
  readonly final: V3DraftGraphResponse;
} {
  const seam = projectDraftRecords(records, brief);
  expect(seam.ok, `${name}: record seam rejected fixture`).toBe(true);
  if (!seam.ok) throw new Error(seam.reason);

  const graph = seam.projection.graph;
  const staged = projectGraphForStagedFrame(
    graph as never,
    "v3",
    `parity-${name}`,
    brief,
  ) as StagedV3Graph;
  const response = {
    graph,
    quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
    trace: { request_id: `parity-${name}`, correlation_id: "records-replay" },
  } as unknown as V1DraftGraphResponse;
  const final = transformResponseToV3(response, {
    brief,
    requestId: `parity-${name}`,
  });

  return { sourceGraph: graph, staged, final };
}

function compile(recordCase: RecordCase): {
  readonly staged: StagedV3Graph;
  readonly final: V3DraftGraphResponse;
} {
  return compileRecords(recordCase.records, recordCase.brief, recordCase.name);
}

const TERMINAL_AUTHORITY_BRIEF = [
  "Our revenue target is £3,000,000.",
  "Compare two developers with enterprise CRM while monitoring Operational Effectiveness and Delivery Risk.",
].join(" ");

const TERMINAL_AUTHORITY_RECORDS = {
  stated_items: [
    {
      kind: "goal",
      source_quote: "Our revenue target is £3,000,000",
      value: 3_000_000,
      unit: "£",
      role: "target",
    },
    { kind: "option", source_quote: "two developers", is_baseline: false },
    { kind: "option", source_quote: "enterprise CRM", is_baseline: true },
    // Deliberately absent from the brief and with no baseline field: this is
    // the unverified + absent branch of both three-state contracts.
    { kind: "option", source_quote: "Invented Backdoor Control" },
  ],
  claims: [
    { claim_kind: "factor", label: "Developer Capacity", basis: [1] }, // 0
    { claim_kind: "factor", label: "CRM Adoption", basis: [2] }, // 1
    // Exact brief labels, but model-inferred: typed provenance must win over
    // the legacy containment fallback.
    { claim_kind: "outcome", label: "Operational Effectiveness", basis: [0] }, // 2
    { claim_kind: "risk", label: "Delivery Risk", basis: [0] }, // 3
    // Valid grammar records with no parent link. They therefore become model
    // option nodes and exercise the one conservative terminal absorption.
    { claim_kind: "option_refinement", label: "Hire Two Developers Only" }, // 4
    { claim_kind: "option_refinement", label: "Adopt Enterprise CRM Option" }, // 5
    { claim_kind: "causal_link", label: "developers set capacity", from_stated: 1, to_claim: 0, effect: "positive", sets_to: 12 },
    { claim_kind: "causal_link", label: "CRM sets adoption", from_stated: 2, to_claim: 1, effect: "positive", sets_to: 1 },
    { claim_kind: "causal_link", label: "unverified control sets capacity", from_stated: 3, to_claim: 0, effect: "positive", sets_to: 6 },
    { claim_kind: "causal_link", label: "developer rephrase sets capacity", from_claim: 4, to_claim: 0, effect: "positive" },
    { claim_kind: "causal_link", label: "CRM rephrase sets adoption", from_claim: 5, to_claim: 1, effect: "positive" },
    { claim_kind: "causal_link", label: "capacity improves operations", from_claim: 0, to_claim: 2, effect: "positive" },
    { claim_kind: "causal_link", label: "adoption improves operations", from_claim: 1, to_claim: 2, effect: "positive" },
    { claim_kind: "causal_link", label: "operations reaches revenue target", from_claim: 2, to_stated: 0, effect: "positive" },
    { claim_kind: "causal_link", label: "delivery risk threatens target", from_claim: 3, to_stated: 0, effect: "negative" },
  ],
} satisfies DraftRecordSet;

function record(value: unknown): Record<string, unknown> {
  return value as Record<string, unknown>;
}

function byLabel(values: readonly unknown[], label: string): Record<string, unknown> {
  const found = values.map(record).find((value) => value.label === label);
  expect(found, `missing ${label}`).toBeDefined();
  return found!;
}

describe("typed records → GRAPH_READY → COMPLETE provenance parity", () => {
  for (const recordCase of CASES) {
    it(`${recordCase.name}: emits one exact identity/semantics/provenance view`, () => {
      const { staged, final } = compile(recordCase);

      const stagedView = comparableNodes(staged.nodes);
      const finalView = comparableNodes(final.nodes);
      expect(stagedView.length).toBeGreaterThan(3);
      expect(stagedView).toEqual(finalView);

      const provenanceByLabel = new Map(finalView.map((node) => [node.label, node.provenance]));
      for (const label of recordCase.expectedFromBrief) {
        expect(provenanceByLabel.get(label), `${recordCase.name}: ${label}`).toBe("from_brief");
      }
      for (const label of recordCase.expectedAiInferred) {
        expect(provenanceByLabel.get(label), `${recordCase.name}: ${label}`).toBe("ai_inferred");
      }

      // The terminal option list is a third carrier of the same authorship
      // fact. It must derive from the node result, not run another predicate.
      const nodeById = new Map(finalView.map((node) => [node.id, node]));
      for (const option of final.options) {
        const node = nodeById.get(option.id);
        expect(node, `${recordCase.name}: option ${option.id} has no graph node`).toBeDefined();
        expect(option.provenance?.source).toBe(
          node?.provenance === "from_brief" ? "brief_extraction" : "cee_hypothesis",
        );
      }
    });
  }

  it("negative control: removing the brief evidence withdraws every label-bound badge on both surfaces", () => {
    const source = CASES[0];
    const noEvidence: RecordCase = {
      ...source,
      name: "hiring-without-evidence",
      brief: "We need a staffing recommendation.",
      expectedFromBrief: [],
      expectedAiInferred: [],
    };
    const { staged, final } = compile(noEvidence);
    expect(comparableNodes(staged.nodes)).toEqual(comparableNodes(final.nodes));

    for (const node of comparableNodes(final.nodes)) {
      if (["goal", "option", "risk", "outcome", "decision"].includes(node.kind)) {
        expect(node.provenance, node.label).toBe("ai_inferred");
      }
    }
  });

  it("variance control: three full compiler replays are byte-identical", () => {
    const draws = Array.from({ length: 3 }, () => {
      const { staged, final } = compile(CASES[1]);
      return JSON.stringify({ staged: comparableNodes(staged.nodes), final: comparableNodes(final.nodes) });
    });
    expect(draws[1]).toBe(draws[0]);
    expect(draws[2]).toBe(draws[0]);
    expect(draws[0].length).toBeGreaterThan(500);
  });
});

describe("one terminal V3 graph/options projection authority", () => {
  it("projects exact graph/options semantics and absorbs two rephrases before both wire phases", () => {
    const { sourceGraph, staged, final } = compileRecords(
      TERMINAL_AUTHORITY_RECORDS,
      TERMINAL_AUTHORITY_BRIEF,
      "terminal-authority",
    );

    // Non-vacuity: both model rephrases existed before the V3 authority ran.
    const absorbedIds = ["Hire Two Developers Only", "Adopt Enterprise CRM Option"].map(
      (label) => String(byLabel(sourceGraph.nodes, label).id),
    );
    expect(absorbedIds).toHaveLength(2);
    expect(new Set(absorbedIds).size).toBe(2);

    // Exact same-input agreement, not an edge-count proxy.
    expect(staged.nodes).toEqual(final.nodes);
    expect(staged.edges).toEqual(final.edges);
    expect(staged.options).toEqual(final.options);
    expect(staged.goal_node_id).toBe(final.goal_node_id);

    for (const absorbedId of absorbedIds) {
      expect(staged.nodes.map((node) => record(node).id)).not.toContain(absorbedId);
      expect(final.nodes.map((node) => record(node).id)).not.toContain(absorbedId);
      for (const edge of [...staged.edges, ...final.edges].map(record)) {
        expect([edge.from, edge.to], `incident edge survived for ${absorbedId}`).not.toContain(absorbedId);
      }
      expect(staged.options.map((option) => record(option).id)).not.toContain(absorbedId);
      expect(final.options.map((option) => option.id)).not.toContain(absorbedId);
    }
  });

  it("carries false/true/absent baseline and full intervention target identity on nodes and options", () => {
    const { staged, final } = compileRecords(
      TERMINAL_AUTHORITY_RECORDS,
      TERMINAL_AUTHORITY_BRIEF,
      "baseline-intervention",
    );

    const expectedBaselines = new Map<string, boolean | undefined>([
      ["two developers", false],
      ["enterprise CRM", true],
      ["Invented Backdoor Control", undefined],
    ]);
    for (const [label, expected] of expectedBaselines) {
      const node = byLabel(staged.nodes, label);
      const option = final.options.find((candidate) => candidate.id === node.id);
      expect(option, `${label}: missing option carrier`).toBeDefined();
      expect(node.is_baseline, `${label}: staged node`).toBe(expected);
      expect(option?.is_baseline, `${label}: terminal option`).toBe(expected);
      expect(Object.hasOwn(node, "is_baseline"), `${label}: node presence`).toBe(
        expected !== undefined,
      );
      expect(Object.hasOwn(option ?? {}, "is_baseline"), `${label}: option presence`).toBe(
        expected !== undefined,
      );

      const nodeInterventions = record(node.interventions);
      const optionInterventions = record(option?.interventions);
      expect(nodeInterventions).toEqual(optionInterventions);
      expect(Object.keys(nodeInterventions).length, `${label}: intervention non-vacuity`).toBeGreaterThan(0);
      for (const [key, intervention] of Object.entries(nodeInterventions)) {
        expect(record(record(intervention).target_match).node_id).toBe(key);
      }
    }
  });

  it("remaps source intervention and goal ids to the canonical V3 identities", () => {
    const seam = projectDraftRecords(TERMINAL_AUTHORITY_RECORDS, TERMINAL_AUTHORITY_BRIEF);
    expect(seam.ok).toBe(true);
    if (!seam.ok) throw new Error(seam.reason);
    const source = seam.projection.graph;
    const factor = byLabel(source.nodes, "Developer Capacity");
    const option = byLabel(source.nodes, "two developers");
    const goal = byLabel(source.nodes, "Our revenue target is £3,000,000");
    const renamed = new Map<string, string>([
      [String(factor.id), "Factor Target / A"],
      [String(option.id), "Option Choice / A"],
      [String(goal.id), "Goal Target / A"],
    ]);
    const graph = {
      ...source,
      nodes: source.nodes.map((node) => {
        const nextId = renamed.get(node.id) ?? node.id;
        if (!node.data || typeof node.data !== "object") {
          return { ...node, id: nextId };
        }
        const data = node.data as Record<string, unknown>;
        const interventions = data.interventions;
        return {
          ...node,
          id: nextId,
          data: {
            ...data,
            ...(interventions && typeof interventions === "object"
              ? {
                  interventions: Object.fromEntries(
                    Object.entries(interventions).map(([id, value]) => [
                      renamed.get(id) ?? id,
                      value,
                    ]),
                  ),
                }
              : {}),
          },
        };
      }),
      edges: source.edges.map((edge) => ({
        ...edge,
        from: renamed.get(edge.from) ?? edge.from,
        to: renamed.get(edge.to) ?? edge.to,
      })),
    };

    const staged = projectGraphForStagedFrame(
      graph as never,
      "v3",
      "canonical-id-remap",
      TERMINAL_AUTHORITY_BRIEF,
    ) as StagedV3Graph;
    const final = transformResponseToV3(
      { graph } as unknown as V1DraftGraphResponse,
      { brief: TERMINAL_AUTHORITY_BRIEF, requestId: "canonical-id-remap" },
    );

    expect(staged.goal_node_id).toBe(byLabel(staged.nodes, goal.label as string).id);
    expect(final.goal_node_id).toBe(byLabel(final.nodes, goal.label as string).id);
    const stagedOption = byLabel(staged.nodes, option.label as string);
    const stagedInterventions = record(stagedOption.interventions);
    expect(Object.keys(stagedInterventions)).toHaveLength(1);
    const [canonicalFactorId] = Object.keys(stagedInterventions);
    expect(byLabel(staged.nodes, factor.label as string).id).toBe(canonicalFactorId);
    expect(record(record(stagedInterventions[canonicalFactorId!]).target_match).node_id).toBe(
      canonicalFactorId,
    );
    expect(staged.nodes).toEqual(final.nodes);
    expect(staged.options).toEqual(final.options);
  });

  it("honours typed provenance before label binding, including verified numeric and unverified controls", () => {
    const { staged, final } = compileRecords(
      TERMINAL_AUTHORITY_RECORDS,
      TERMINAL_AUTHORITY_BRIEF,
      "typed-provenance",
    );
    const expected = new Map<string, "from_brief" | "ai_inferred">([
      ["Our revenue target is £3,000,000", "from_brief"],
      ["two developers", "from_brief"],
      ["enterprise CRM", "from_brief"],
      ["Operational Effectiveness", "ai_inferred"],
      ["Delivery Risk", "ai_inferred"],
      ["Invented Backdoor Control", "ai_inferred"],
    ]);

    for (const [label, provenance] of expected) {
      expect(byLabel(staged.nodes, label).provenance, `${label}: staged`).toBe(provenance);
      expect(byLabel(final.nodes, label).provenance, `${label}: terminal`).toBe(provenance);
    }

    for (const option of final.options) {
      const node = final.nodes.find((candidate) => candidate.id === option.id);
      expect(option.provenance?.source).toBe(
        node?.provenance === "from_brief" ? "brief_extraction" : "cee_hypothesis",
      );
    }
  });

  it("declines unchecked typed controls when no brief is available", () => {
    const { staged, final } = compileRecords(
      TERMINAL_AUTHORITY_RECORDS,
      undefined,
      "typed-provenance-unchecked",
    );
    for (const label of ["two developers", "enterprise CRM", "Invented Backdoor Control"]) {
      expect(byLabel(staged.nodes, label).provenance, `${label}: staged`).toBe("ai_inferred");
      const terminalNode = byLabel(final.nodes, label);
      expect(terminalNode.provenance, `${label}: terminal`).toBe("ai_inferred");
      const option = final.options.find((candidate) => candidate.id === terminalNode.id);
      expect(option?.provenance?.source, `${label}: option`).toBe("cee_hypothesis");
    }
  });

  it("keeps legacy label binding only when typed record provenance is absent", () => {
    const seam = projectDraftRecords(TERMINAL_AUTHORITY_RECORDS, TERMINAL_AUTHORITY_BRIEF);
    expect(seam.ok).toBe(true);
    if (!seam.ok) throw new Error(seam.reason);
    const legacyGraph = structuredClone(seam.projection.graph);
    for (const node of legacyGraph.nodes) delete (node as { provenance?: unknown }).provenance;

    const staged = projectGraphForStagedFrame(
      legacyGraph as never,
      "v3",
      "legacy-fallback",
      TERMINAL_AUTHORITY_BRIEF,
    ) as StagedV3Graph;
    expect(byLabel(staged.nodes, "Operational Effectiveness").provenance).toBe("from_brief");
    expect(byLabel(staged.nodes, "Delivery Risk").provenance).toBe("from_brief");
    expect(byLabel(staged.nodes, "two developers").provenance).toBe("from_brief");
  });
});
