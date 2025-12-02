import type { GraphV1 } from "../../../contracts/plot/engine.js";
import type { VerificationContext, VerificationResult, VerificationStage } from "../types.js";

export class BranchProbabilityValidator implements VerificationStage<unknown, unknown> {
  readonly name = "branch_probabilities" as const;

  async validate(
    payload: unknown,
    _context?: VerificationContext,
  ): Promise<VerificationResult<unknown>> {
    const graph = (payload as any)?.graph as GraphV1 | undefined;
    if (!graph || !Array.isArray((graph as any).nodes) || !Array.isArray((graph as any).edges)) {
      return {
        valid: true,
        stage: this.name,
        skipped: true,
      };
    }

    const nodes = (graph as any).nodes as any[];
    const edges = (graph as any).edges as any[];

    const kinds = new Map<string, string>();
    for (const node of nodes) {
      const id = typeof (node as any)?.id === "string" ? ((node as any).id as string) : undefined;
      const kind = typeof (node as any)?.kind === "string" ? ((node as any).kind as string) : undefined;
      if (!id || !kind) continue;
      kinds.set(id, kind);
    }

    const groups = new Map<string, number[]>();
    for (let index = 0; index < edges.length; index += 1) {
      const edge = edges[index] as any;
      const from = typeof edge?.from === "string" ? (edge.from as string) : undefined;
      const to = typeof edge?.to === "string" ? (edge.to as string) : undefined;
      if (!from || !to) continue;

      const fromKind = kinds.get(from);
      const toKind = kinds.get(to);
      if (fromKind === "decision" && toKind === "option") {
        const existing = groups.get(from);
        if (existing) {
          existing.push(index);
        } else {
          groups.set(from, [index]);
        }
      }
    }

    if (groups.size === 0) {
      return {
        valid: true,
        stage: this.name,
        skipped: true,
      };
    }

    const epsilon = 0.01;
    const issues: Array<{ decision_id: string; outgoing_edges: number; sum_belief: number }> = [];

    for (const [decisionId, indices] of groups) {
      if (indices.length < 2) continue;

      let sum = 0;
      let numericCount = 0;

      for (const index of indices) {
        const raw = (edges[index] as any).belief;
        if (typeof raw === "number" && Number.isFinite(raw)) {
          sum += raw;
          numericCount += 1;
        }
      }

      if (numericCount < 2) continue;
      if (!(sum > 0)) continue;

      if (Math.abs(sum - 1) > epsilon) {
        issues.push({
          decision_id: decisionId,
          outgoing_edges: indices.length,
          sum_belief: Number(sum.toFixed(4)),
        });
      }
    }

    if (issues.length === 0) {
      return {
        valid: true,
        stage: this.name,
      };
    }

    return {
      valid: true,
      stage: this.name,
      severity: "warning",
      code: "BRANCH_PROBABILITIES_UNNORMALIZED",
      message: "Some decision branch beliefs do not sum to 1.0",
      details: {
        affected_decisions: issues.slice(0, 10),
        total_decisions_with_issue: issues.length,
      },
    };
  }
}
