// RED-FIRST STUB — replaced by the real implementation in the next commit.
import type { GraphT } from "../../../../schemas/graph.js";

interface Repair { code: string; path: string; action: string }

export function neutraliseNoOpOptions(
  _graph: GraphT,
  _requestId?: string,
): { repairs: Repair[]; neutralisedOptionIds: string[] } {
  return { repairs: [], neutralisedOptionIds: [] };
}
