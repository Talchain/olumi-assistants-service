/**
 * Added for the approved bounded retention successor; execution is resource-gated.
 * Base: edaeebaea5bc6b9046dc7ce78068cf6d00ff9625 (#1278 acceptance bank).
 *
 * These controls extend the bank to the next specific consumer boundary:
 * post-enrichment simpleRepair -> unreachable classification -> isolated-node
 * pruning -> factor reachability admission. A composed control also drives
 * post-enrichment stabilisation, the real sweep and canonical/context ingress.
 * It does NOT call the provider/enricher, persistence or a routed later turn.
 *
 * The repair-isolation input is the connected control minus its single authored
 * pricing link. It does not reinsert a node already deleted by the projector.
 * The separate records-entry control retains that earlier failure boundary.
 */
import { describe, expect, it } from "vitest";
import corpus from "./fixtures/class-b-semantic-boundary.json";
import { projectDraftRecords } from "../seam.js";
import { normaliseDraftResponse } from "../../../../adapters/llm/normalisation.js";
import { FactorData, Graph, OptionData, type GraphT } from "../../../../schemas/graph.js";
import { LLMDraftResponse } from "../../../../adapters/llm/shared-schemas.js";
import { GraphV3 } from "../../../../schemas/cee-v3.js";
import { simpleRepair } from "../../../../services/repair.js";
import { handleUnreachableFactors } from "../../../unified-pipeline/stages/repair/unreachable-factors.js";
import { fixDisconnectedObservables, runDeterministicSweep } from "../../../unified-pipeline/stages/repair/deterministic-sweep.js";
import type { StageContext } from "../../../unified-pipeline/types.js";
import { ensureDagAndPrune, stabiliseGraph } from "../../../../orchestrator/index.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";
import { GraphStateIngressSchema } from "../../../../orchestrator-v5/boundary/request-extensions.js";
import { compactGraphForContextPack } from "../../../../orchestrator-v5/context/compact-graph-for-contextpack.js";
import { resolveRunAdmission } from "../../../../orchestrator-v5/tools/handlers/analysis-ready-core.js";
import { detectEdgeFormat } from "../../../unified-pipeline/utils/edge-format.js";
import { validateGraph } from "../../../../validators/graph-validator.js";
import { pathsNameNode } from "../../../../validators/violation-paths.js";
import { retainedDecisionFreeFactorIds } from "../../../../validators/decision-free-retention.js";

const requestId = "class-b-retention-repair";
const connectedFixture = corpus.cases.nonaction_connected;
const disconnectedFixture = corpus.cases.nonaction_disconnected;
const subjectId = disconnectedFixture.oracle.disconnected_subject_id;

function project(fixture: { brief: string; records: unknown }): GraphT {
  const seam = projectDraftRecords(fixture.records, fixture.brief);
  if (!seam.ok) throw new Error(`Existing records rejected: ${seam.reason}`);
  return Graph.parse(normaliseDraftResponse(structuredClone(seam.projection.graph)));
}

function subject(graph: GraphT, id = subjectId) {
  const matches = graph.nodes.filter((node) => node.id === id);
  expect(matches, `exact retained identity ${id}`).toHaveLength(1);
  const node = matches[0];
  if (!node) throw new Error(`Missing subject ${id}`);
  return node;
}

function incident(graph: GraphT, id = subjectId) {
  return graph.edges.filter((edge) => edge.from === id || edge.to === id);
}

function connectedAndDisconnected() {
  const connected = project(connectedFixture);
  subject(connected);
  expect(incident(connected)).toHaveLength(1);
  const disconnected = structuredClone(connected);
  disconnected.edges = disconnected.edges.filter(
    (edge) => edge.from !== subjectId && edge.to !== subjectId,
  );
  expect(disconnected.nodes).toStrictEqual(connected.nodes);
  expect(disconnected.edges).toHaveLength(connected.edges.length - 1);
  return { connected, disconnected };
}

function repairBoundaries(input: GraphT) {
  const graph = simpleRepair(structuredClone(input), requestId, {
    deferSweepOwnedPatterns: true,
  });
  const afterSimpleRepair = structuredClone(graph);
  const unreachable = handleUnreachableFactors(graph, detectEdgeFormat(graph.edges));
  const afterUnreachable = structuredClone(graph);
  fixDisconnectedObservables(graph, unreachable.repairs);
  return [afterSimpleRepair, afterUnreachable, structuredClone(graph)];
}

function expectRetainedNumberlessFactor(graph: GraphT, input: GraphT, id = subjectId) {
  const before = subject(input, id);
  const retained = subject(graph, id);
  expect(retained).toMatchObject({ id: before.id, kind: "factor", label: before.label });
  expect(before).not.toHaveProperty("data.value");
  expect(retained).not.toHaveProperty("data.value");
  expect(retained).not.toHaveProperty("observed_state.value");
  expect(retained).not.toHaveProperty("data.interventions");
  expect(retained).not.toHaveProperty("interventions");
  if ("provenance" in before) expect(retained).toHaveProperty("provenance", before.provenance);
  if ("prior" in before) expect(retained).toHaveProperty("prior", before.prior);
  else expect(retained).not.toHaveProperty("prior");
  expect(graph.nodes.filter((node) => node.kind === "option" || node.kind === "decision")).toEqual([]);
}

function hasNoPathError(graph: GraphT, id: string) {
  const result = validateGraph({ graph, requestId });
  const paths = new Set(result.errors.filter((error) => error.code === "NO_PATH_TO_GOAL")
    .flatMap((error) => error.path ? [error.path] : []));
  return pathsNameNode(paths, id);
}

function minimalSpine(withPeer = false): GraphT {
  return project({
    brief: "We want to understand retention.",
    records: {
      stated_items: [{ kind: "goal", source_quote: "understand retention" }],
      claims: [
        { claim_kind: "factor", label: "Pricing may explain churn", basis: [0] },
        { claim_kind: "outcome", label: "Retained customers", basis: [0] },
        ...(withPeer ? [{ claim_kind: "factor", label: "Onboarding may explain churn", basis: [0] }] : []),
        { claim_kind: "causal_link", label: "retention reaches goal", from_claim: 1, to_stated: 0, effect: "positive" },
      ],
    },
  });
}

describe("Class-B numberless retention: next repair/admission boundaries", () => {
  it("MINIMAL_SPINE — keeps the admitted no-inbound hypothesis through real repair without inventing a feeder", async () => {
    const input = minimalSpine();
    const ids = input.nodes.filter((node) => node.kind === "factor").map((node) => node.id);
    expect(ids).toHaveLength(1);
    expect([...retainedDecisionFreeFactorIds(input)]).toEqual(ids);
    const graph = simpleRepair(structuredClone(input), requestId, { deferSweepOwnedPatterns: true });
    const ctx = { graph, requestId, repairTrace: {} } as StageContext;
    await runDeterministicSweep(ctx);
    const after = Graph.parse(ctx.graph);
    expectRetainedNumberlessFactor(after, input, ids[0]);
    expect(incident(after, ids[0])).toEqual([]);
    expect(after.edges).toHaveLength(input.edges.length);
    expect(validateGraph({ graph: after, requestId }).valid).toBe(true);
  });

  it.each([false, true])("PEER_IDENTITY — protects both unresolved hypotheses regardless of node order (reversed=%s)", (reverse) => {
    const input = minimalSpine(true);
    if (reverse) input.nodes.reverse();
    const ids = input.nodes.filter((node) => node.kind === "factor").map((node) => node.id);
    expect(ids).toHaveLength(2);
    const after = simpleRepair(structuredClone(input), requestId);
    for (const id of ids) {
      expectRetainedNumberlessFactor(after, input, id);
      expect(incident(after, id)).toEqual([]);
    }
  });

  it("EXISTING_FEEDER — leaves a connected numberless peer eligible for the existing repair", () => {
    const input = minimalSpine();
    const unresolved = input.nodes.find((node) => node.kind === "factor")!;
    const outcome = input.nodes.find((node) => node.kind === "outcome")!;
    const goal = input.nodes.find((node) => node.kind === "goal")!;
    input.nodes.push({ id: "existing_feeder", kind: "factor", label: "Existing connected cause" },
      { id: "other_outcome", kind: "outcome", label: "Other outcome" });
    input.edges.push({ ...input.edges[0], id: "existing_input", from: "existing_feeder", to: outcome.id },
      { ...input.edges[0], id: "other_goal_path", from: "other_outcome", to: goal.id });
    expect([...retainedDecisionFreeFactorIds(input)]).toEqual([unresolved.id]);
    const after = simpleRepair(structuredClone(input), requestId);
    expect(incident(after, unresolved.id)).toEqual([]);
    expect(after.edges.filter((edge) => edge.to === "other_outcome")).toEqual([
      expect.objectContaining({ from: "existing_feeder", strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.75 }),
    ]);
  });

  it.each([0, 0.5])("VALUED_FEEDER — leaves the existing repair for supplied value %s unchanged", (value) => {
    const input = minimalSpine();
    const factor = input.nodes.find((node) => node.kind === "factor")!;
    factor.data = { value, extractionType: "explicit" };
    expect(retainedDecisionFreeFactorIds(input).size).toBe(0);
    const after = simpleRepair(structuredClone(input), requestId);
    expect(subject(after, factor.id).data).toStrictEqual(factor.data);
    expect(incident(after, factor.id)).toEqual([
      expect.objectContaining({ from: factor.id, strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.75 }),
    ]);
  });

  it.each([
    { distribution: "uniform" as const, range_min: 0.4, range_max: 0.8 },
    { distribution: "uniform" as const, range_min: 0, range_max: 1, prior_is_unquantified: true },
  ])("PRIOR_FEEDER — preserves the supplied distribution and existing feeder behaviour ($range_min,$range_max)", (prior) => {
    const input = minimalSpine();
    const factor = input.nodes.find((node) => node.kind === "factor")!;
    factor.prior = prior;
    expect(retainedDecisionFreeFactorIds(input).size).toBe(0);
    const after = simpleRepair(structuredClone(input), requestId);
    expect(subject(after, factor.id).prior).toStrictEqual(prior);
    expect(incident(after, factor.id)).toEqual([
      expect.objectContaining({ from: factor.id, strength_mean: 0.5, strength_std: 0.2, belief_exists: 0.75 }),
    ]);
  });

  it("COMPOSED_REPAIR — actual sweep retains the unresolved factor through strict canonical/context ingress while analysis stays blocked", async () => {
    const input = project(disconnectedFixture);
    const stabilised = stabiliseGraph(ensureDagAndPrune(input));
    const repaired = simpleRepair(stabilised, requestId, { deferSweepOwnedPatterns: true });
    // Only the fields consumed by this deterministic stage are needed. No
    // provider, request, enrichment or store is mocked into the assertion path.
    const ctx = {
      graph: stabiliseGraph(ensureDagAndPrune(repaired)), requestId, repairTrace: {},
    } as StageContext;
    await runDeterministicSweep(ctx);
    const after = Graph.parse(ctx.graph);
    expectRetainedNumberlessFactor(after, input);
    expect(incident(after)).toEqual([]);
    expect(validateGraph({ graph: after, requestId }).valid).toBe(true);

    const normalised = LLMDraftResponse.parse(after);
    const transformInput = {
      ...normalised,
      nodes: normalised.nodes.map(({ data, ...node }) => data === undefined ? node : {
        ...node, data: node.kind === "option" ? OptionData.parse(data) : FactorData.parse(data),
      }),
    };
    expect(JSON.parse(JSON.stringify(transformInput))).toStrictEqual(JSON.parse(JSON.stringify(normalised)));
    const projected = projectGraphAndOptionsToV3(transformInput, { brief: disconnectedFixture.brief });
    const canonical = GraphV3.parse(JSON.parse(JSON.stringify(projected.graph)));
    expect(canonical.nodes.find((node) => node.id === subjectId)).toMatchObject({
      kind: "factor", label: subject(input).label, provenance: "ai_inferred",
    });
    expect(canonical.edges.filter((edge) => edge.from === subjectId || edge.to === subjectId)).toEqual([]);
    expect(projected.options).toEqual([]);
    expect(resolveRunAdmission(canonical).willProceed).toBe(false);

    const compact = compactGraphForContextPack(GraphStateIngressSchema.parse(canonical), { requestId });
    expect(compact.kind).toBe("compacted");
    if (compact.kind !== "compacted") throw new Error("Expected strict context ingress");
    expect(compact.via).toBe("strict_parse");
    expect(compact.compact.nodes.find((node) => node.id === subjectId)).toMatchObject({
      kind: "factor", label: subject(input).label,
    });
  });

  it("RECORDS_ENTRY — the actual disconnected records survive projection and subsequent repair helpers", () => {
    const input = project(disconnectedFixture);
    // Fail at the real first loss; never inject a lost factor to green this arm.
    subject(input);
    expect(incident(input)).toEqual([]);
    for (const graph of repairBoundaries(input)) {
      expectRetainedNumberlessFactor(graph, input);
      expect(incident(graph)).toEqual([]);
    }
  });

  it("REPAIR_COUNTERPART — removing one causal link preserves the same unresolved proposition", () => {
    const { connected, disconnected } = connectedAndDisconnected();
    for (const graph of repairBoundaries(connected)) {
      expectRetainedNumberlessFactor(graph, connected);
      expect(incident(graph)).toStrictEqual(incident(connected));
    }
    for (const graph of repairBoundaries(disconnected)) {
      expectRetainedNumberlessFactor(graph, disconnected);
      expect(incident(graph)).toEqual([]);
    }
  });

  it("FACTOR_ADMISSION — a numberless unresolved factor does not require a fabricated path in the bounded zero-option shape", () => {
    const { connected, disconnected } = connectedAndDisconnected();
    expect(hasNoPathError(connected, subjectId)).toBe(false);
    expect(hasNoPathError(disconnected, subjectId)).toBe(false);
  });

  it("ACTION_COUNTERPART — an action graph still requires its target factor to reach the goal", () => {
    const fixture = corpus.cases.genuine_alternatives;
    const graph = project(fixture);
    expect(graph.nodes.filter((node) => node.kind === "option")).toHaveLength(2);
    subject(graph, fixture.oracle.target_factor_id);
    const disconnected = structuredClone(graph);
    disconnected.edges = disconnected.edges.filter((edge) => edge.from !== fixture.oracle.target_factor_id);
    expect(hasNoPathError(disconnected, fixture.oracle.target_factor_id)).toBe(true);
  });

  it("BRIDGE_GUARD — the first slice does not disable the existing outcome/risk requirement", () => {
    const { disconnected } = connectedAndDisconnected();
    const removed = new Set(disconnected.nodes.filter((node) => node.kind === "outcome" || node.kind === "risk")
      .map((node) => node.id));
    expect(removed.size).toBeGreaterThan(0);
    disconnected.nodes = disconnected.nodes.filter((node) => !removed.has(node.id));
    disconnected.edges = disconnected.edges.filter((edge) => !removed.has(edge.from) && !removed.has(edge.to));
    expect(validateGraph({ graph: disconnected, requestId }).errors
      .some((error) => error.code === "MISSING_BRIDGE")).toBe(true);
  });

  it("ACTION_RETENTION — stated and AI-proposed actions keep their distinct identities and interventions", () => {
    const input = project(corpus.cases.genuine_alternatives);
    const actions = (graph: GraphT) => graph.nodes.filter((node) => node.kind === "option")
      .map((node) => ({ id: node.id, label: node.label, data: node.data }))
      .sort((a, b) => a.id.localeCompare(b.id));
    const expected = actions(input);
    expect(expected).toHaveLength(2);
    expect(expected.map((node) => node.id).sort()).toEqual(
      corpus.cases.genuine_alternatives.oracle.options.map((node) => node.id).sort(),
    );
    for (const graph of repairBoundaries(input)) expect(actions(graph)).toStrictEqual(expected);
  });
});
