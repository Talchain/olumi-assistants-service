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
    expectedFromBrief: ["raise enterprise pricing by 30%", "hold price and push volume instead"],
    // Label containment alone must not certify authorship of a value-bearing
    // node. Its number keeps the existing value-aware, fail-closed path.
    expectedAiInferred: ["Our target for next year is £3,000,000", "Decision"],
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

function compile(recordCase: RecordCase): {
  readonly staged: { readonly nodes: readonly unknown[] };
  readonly final: V3DraftGraphResponse;
} {
  const seam = projectDraftRecords(recordCase.records, recordCase.brief);
  expect(seam.ok, `${recordCase.name}: record seam rejected fixture`).toBe(true);
  if (!seam.ok) throw new Error(seam.reason);

  const graph = seam.projection.graph;
  const staged = projectGraphForStagedFrame(
    graph as never,
    "v3",
    `parity-${recordCase.name}`,
    recordCase.brief,
  ) as { readonly nodes: readonly unknown[] };
  const response = {
    graph,
    quality: { overall: 8, structure: 8, coverage: 8, structural_proxy: 8 },
    trace: { request_id: `parity-${recordCase.name}`, correlation_id: "records-replay" },
  } as unknown as V1DraftGraphResponse;
  const final = transformResponseToV3(response, {
    brief: recordCase.brief,
    requestId: `parity-${recordCase.name}`,
  });

  return { staged, final };
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
