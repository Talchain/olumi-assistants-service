/**
 * THE CLASS-CLOSING INSTRUMENT — CEE's own graph validator as the projector's
 * acceptance oracle.
 *
 * Four consecutive rounds of this slice each discovered ONE rule of the
 * validator's grammar, live, at the cost of a measured block. That is the
 * defect: the consumer's predicate was being learned one instance at a time.
 * This module runs the ACTUAL `graph-validator.ts` in-process over projected
 * record sets, so every rule rounds 5..N would have discovered is discovered in
 * one run.
 *
 * ⚠ IT IMPORTS THE REAL VALIDATOR AND THE REAL REPAIRS. Nothing here mirrors a
 * rule, restates a rule, or re-implements a category inference — a mirror would
 * drift and would agree with itself while the product disagreed.
 *
 * ⚠ AND IT VALIDATES THE GRAPH THE GATE SEES, not the raw projection. The live
 * order is: project → normalise kinds → simpleRepair (with the enrich path's
 * `deferSweepOwnedPatterns`) → the sweep's `fixFactorGoalEdges` → validate.
 * Validating earlier would enumerate violations that a downstream authority
 * legitimately owns and repairs, which is how a probe manufactures a finding.
 */
import { NODE_KIND_MAP } from "../src/adapters/llm/normalisation.js";
import { simpleRepair } from "../src/services/repair.js";
import { fixFactorGoalEdges } from "../src/cee/unified-pipeline/stages/repair/deterministic-sweep.js";
import { detectEdgeFormat } from "../src/cee/unified-pipeline/utils/edge-format.js";
import { validateGraph } from "../src/validators/graph-validator.js";
import { projectRecordsToGraph } from "../src/cee/draft/records/projector.js";
import type { DraftRecordSet } from "../src/cee/draft/records/grammar.js";
import type { GraphT } from "../src/schemas/graph.js";

export interface OracleViolation {
  /** The validator's own code. */
  readonly code: string;
  /**
   * For edge-type violations, the SHAPE that was rejected, expressed in the
   * validator's own vocabulary (kind + the category it INFERRED, never a
   * category we declared — the projector declares none).
   */
  readonly shape?: string;
}

export interface OracleResult {
  readonly ok: boolean;
  readonly violations: readonly OracleViolation[];
  /** Records the projector declined to place, with its stated reason. */
  readonly disclosed: readonly string[];
  readonly nodes: number;
  readonly edges: number;
}

/** Reproduce the live pre-validation sequence with the real functions. */
export function projectAndValidate(records: DraftRecordSet): OracleResult {
  const projection = projectRecordsToGraph(records);
  const graph = {
    ...projection.graph,
    nodes: projection.graph.nodes.map((n) => ({
      ...n,
      kind: NODE_KIND_MAP[n.kind.toLowerCase().trim()] ?? n.kind,
    })),
  } as unknown as GraphT;

  const repaired = simpleRepair(graph, "records-oracle", { deferSweepOwnedPatterns: true });
  fixFactorGoalEdges(repaired, detectEdgeFormat(repaired.edges as never));

  const result = validateGraph({
    graph: repaired,
    requestId: "records-oracle",
    phase: "post_sweep_authoritative",
  });

  // The category the validator INFERRED, re-derived from the same structural
  // facts it uses, so a shape label names what the validator saw.
  const kindOf = new Map(repaired.nodes.map((n) => [n.id, n.kind]));
  const optionIds = new Set(repaired.nodes.filter((n) => n.kind === "option").map((n) => n.id));
  const fedByOption = new Set(repaired.edges.filter((e) => optionIds.has(e.from)).map((e) => e.to));
  const hasValue = new Set(
    repaired.nodes
      .filter((n) => (n.data as { value?: unknown } | undefined)?.value !== undefined)
      .map((n) => n.id),
  );
  const catOf = (id: string): string | undefined => {
    if (kindOf.get(id) !== "factor") return undefined;
    if (fedByOption.has(id)) return "controllable";
    return hasValue.has(id) ? "observable" : "external";
  };
  const describe = (id: string): string => {
    const k = kindOf.get(id) ?? "?";
    const c = catOf(id);
    return c ? `${k}[${c}]` : k;
  };

  const violations: OracleViolation[] = result.errors.map((issue) => {
    const ctx = (issue as { context?: { fromId?: string; toId?: string } }).context;
    if (issue.code === "INVALID_EDGE_TYPE" && ctx?.fromId && ctx?.toId) {
      return { code: issue.code, shape: `${describe(ctx.fromId)}→${describe(ctx.toId)}` };
    }
    return { code: issue.code };
  });

  return {
    ok: result.valid,
    violations,
    disclosed: projection.dropped.map((d) => `${d.reason}:${d.label}`),
    nodes: repaired.nodes.length,
    edges: repaired.edges.length,
  };
}

/**
 * The acceptance predicate the projector is held to: PASS OR DISCLOSED.
 *
 * A record set may legitimately fail to become a legal graph — but only if the
 * projector said so. Silence is the defect; a named `dropped[]` entry is the
 * honest outcome and becomes a coaching moment rather than a synthesis.
 */
export function passesOrIsDisclosed(records: DraftRecordSet): boolean {
  const r = projectAndValidate(records);
  return r.ok || r.disclosed.length > 0;
}
