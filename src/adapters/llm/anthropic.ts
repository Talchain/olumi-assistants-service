import type { DocPreview } from "../../services/docProcessing.js";
import type { GraphT } from "../../schemas/graph.js";

export type DraftArgs = {
  brief: string;
  docs: DocPreview[];
  seed: number;
};

export async function draftGraphWithAnthropic(
  _args: DraftArgs
): Promise<{ graph: GraphT; rationales: { target: string; why: string }[] }> {
  const graph: GraphT = {
    version: "1",
    default_seed: 17,
    nodes: [
      { id: "goal_1", kind: "goal", label: "Increase Pro upgrades" },
      { id: "dec_1", kind: "decision", label: "Which levers?" },
      { id: "opt_1", kind: "option", label: "Extend trial" },
      { id: "out_upgrade", kind: "outcome", label: "Upgrade rate" }
    ],
    edges: [
      {
        id: "opt_1::out_upgrade::0",
        from: "opt_1",
        to: "out_upgrade",
        belief: 0.7,
        weight: 0.2,
        provenance: "Hypothesis based on trial effect",
        provenance_source: "hypothesis"
      }
    ],
    meta: {
      roots: ["goal_1"],
      leaves: ["out_upgrade"],
      suggested_positions: {},
      source: "assistant"
    }
  };

  return {
    graph,
    rationales: [
      {
        target: "edge:opt_1::out_upgrade::0",
        why: "Experiential value improves conversion"
      }
    ]
  };
}
