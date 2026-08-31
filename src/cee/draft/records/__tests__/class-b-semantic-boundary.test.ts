/**
 * Class-B acceptance boundaries, using synthetic records in the CURRENT grammar.
 *
 * The fixture's oracle is outside `records` and is never sent to the projector.
 * The deliberately misfiled option and the origin pair expose missing producer
 * information; they do not license lexical classification, repurposing `basis`,
 * or adding an undeclared field. The producer-role/source witnesses must be
 * rebound to approved producer output before becoming successor regressions;
 * they cannot be made green by a projector-only change. No failure masking.
 *
 * This is a deterministic carriage/readiness test, not a provider capture,
 * persisted journey, model evaluation, or completed analysis. The formatter
 * receives its ordinary input shape assembled from the real compactor output;
 * this does not claim a complete live ContextPack routing witness. Origin is
 * asserted only through V3: compact/display origin has a separate known loss.
 * A retained factor proves a current non-action carrier, not a hypothesis enum.
 */
import { describe, expect, it } from "vitest";

import corpus from "./fixtures/class-b-semantic-boundary.json";
import { projectDraftRecords } from "../seam.js";
import { normaliseDraftResponse } from "../../../../adapters/llm/normalisation.js";
import { Graph } from "../../../../schemas/graph.js";
import { GraphV3 } from "../../../../schemas/cee-v3.js";
import { projectGraphAndOptionsToV3 } from "../../../transforms/schema-v3.js";
import { assessCanonicalAnalysisReadiness } from "../../../../orchestrator/tools/analysis-ready-helper.js";
import { GraphStateIngressSchema } from "../../../../orchestrator-v5/boundary/request-extensions.js";
import { compactGraphForContextPack } from "../../../../orchestrator-v5/context/compact-graph-for-contextpack.js";
import { formatGraphForContext } from "../../../../orchestrator-v5/format/format-graph-for-context.js";

type RecordFixture = { readonly brief: string; readonly records: unknown };

function drive(fixture: RecordFixture) {
  const seam = projectDraftRecords(fixture.records, fixture.brief);
  if (!seam.ok) throw new Error(`Current-record fixture rejected: ${seam.reason}`);
  const normalised = Graph.parse(
    normaliseDraftResponse(structuredClone(seam.projection.graph)),
  );
  const projected = projectGraphAndOptionsToV3(normalised, { brief: fixture.brief });
  const graph = GraphV3.parse(JSON.parse(JSON.stringify(projected.graph)));
  const compaction = compactGraphForContextPack(GraphStateIngressSchema.parse(graph), {
    requestId: "class-b-semantic-boundary",
  });
  expect(compaction.kind, "the context probe must see a graph").toBe("compacted");
  if (compaction.kind !== "compacted") throw new Error("Context compaction was absent");
  expect(compaction.via, "no fallback defaults may satisfy these controls").toBe("strict_parse");

  const compact = compaction.compact;
  const options = compact.nodes.filter((node) => node.kind === "option");
  const goals = compact.nodes.filter((node) => node.kind === "goal");
  const constraints = graph.goal_constraints ?? [];
  const display = formatGraphForContext({
    nodes: compact.nodes,
    edges: compact.edges,
    options,
    goals,
    constraints,
    counts: {
      nodes: compact.nodes.length,
      edges: compact.edges.length,
      options: options.length,
      goals: goals.length,
      constraints: constraints.length,
    },
  });
  return {
    records: seam.records,
    projection: seam.projection,
    graph,
    options: projected.options,
    compact,
    display,
    readiness: assessCanonicalAnalysisReadiness(graph),
  };
}

type Chain = ReturnType<typeof drive>;

function oneById<T extends { readonly id: string }>(values: readonly T[], id: string): T {
  const matching = values.filter((value) => value.id === id);
  expect(matching, `exactly one retained object with frozen id ${id}`).toHaveLength(1);
  const value = matching[0];
  if (value === undefined) throw new Error(`Missing fixture identity ${id}`);
  return value;
}

function expectRetainedFactor(chain: Chain, subject: { readonly id: string; readonly label: string }) {
  const source = oneById(chain.projection.graph.nodes, subject.id);
  expect(source).toMatchObject({ kind: "factor", label: subject.label });
  expect(source.data ?? {}).not.toHaveProperty("interventions");

  const node = oneById(chain.graph.nodes, subject.id);
  expect(node).toMatchObject({ kind: "factor", label: subject.label });
  expect(node).not.toHaveProperty("interventions");
  expect(node).not.toHaveProperty("raw_interventions");
  expect(chain.options.some((option) => option.id === subject.id)).toBe(false);
  expect(oneById(chain.compact.nodes, subject.id)).toMatchObject({
    kind: "factor", label: subject.label,
  });
  expect(oneById(chain.display.nodes, subject.id)).toMatchObject({
    kind: "factor", label: subject.label,
  });
  expect(chain.display.options.some((option) => option.id === subject.id)).toBe(false);
  return node;
}

function expectFramingWithoutOptions(chain: Chain) {
  expect(chain.graph.nodes.length, "absence checks require a nonempty reasoning model").toBeGreaterThan(0);
  expect(chain.graph.nodes.filter((node) => node.kind === "option")).toEqual([]);
  expect(chain.graph.nodes.filter((node) => node.kind === "decision")).toEqual([]);
  expect(chain.options).toEqual([]);
  expect(chain.display.options).toEqual([]);
  expect(chain.readiness.safeToAnalyse).toBe(false);
}

describe("Class-B semantic boundary: external oracle over current records", () => {
  it("ORACLE_CONTROL — provenance expectations are external to otherwise identical hypothesis records", () => {
    const stated = corpus.cases.user_stated_explanation;
    const inferred = corpus.cases.ai_inferred_explanation;
    expect(stated.records).toEqual(inferred.records);
    expect(stated.brief).toContain(stated.oracle.source_quote);
    expect(inferred.brief).not.toContain(stated.oracle.source_quote);
    expect(stated.oracle.expected_provenance).toBe("from_brief");
    expect(inferred.oracle.expected_provenance).toBe("ai_inferred");
    for (const fixture of Object.values(corpus.cases)) {
      expect(fixture.records).not.toHaveProperty("oracle");
      const seam = projectDraftRecords(fixture.records, fixture.brief);
      expect(seam.ok, "every fixture must be accepted by the actual records seam").toBe(true);
    }
  });

  it("PRODUCER_ROLE_WITNESS — current wrongly typed records violate the external non-action requirement", () => {
    const fixture = corpus.cases.misfiled_explanation;
    const chain = drive(fixture);
    const subject = oneById(chain.graph.nodes, fixture.oracle.subject_id);
    expect(subject).toHaveProperty("source_quote", fixture.oracle.source_quote);
    // This deliberately red boundary needs a producer semantic verdict; quote
    // matching proves the words, not the action role. Do not repair it with regex.
    expect.soft(subject.kind).not.toBe("option");
    expect.soft(subject).not.toHaveProperty("interventions");
    expect.soft(chain.options.some((option) => option.id === subject.id)).toBe(false);
    expect.soft(chain.display.options.some((option) => option.id === subject.id)).toBe(false);
    expect.soft(chain.readiness.safeToAnalyse).toBe(false);
  });

  it("PRODUCER_ORIGIN_WITNESS — current records cannot retain explicit user origin through V3", () => {
    const statedFixture = corpus.cases.user_stated_explanation;
    const inferredFixture = corpus.cases.ai_inferred_explanation;
    const stated = drive(statedFixture);
    const inferred = drive(inferredFixture);
    expect(stated.records).toEqual(inferred.records);
    const statedNode = expectRetainedFactor(stated, {
      id: statedFixture.oracle.subject_id, label: statedFixture.oracle.subject_label,
    });
    const inferredNode = expectRetainedFactor(inferred, {
      id: inferredFixture.oracle.subject_id, label: inferredFixture.oracle.subject_label,
    });
    expect(inferredNode.provenance).toBe(inferredFixture.oracle.expected_provenance);
    expect.soft(statedNode.provenance).toBe(statedFixture.oracle.expected_provenance);
    expect.soft(statedNode).toHaveProperty("source_quote", statedFixture.oracle.source_quote);
    expectFramingWithoutOptions(stated);
    expectFramingWithoutOptions(inferred);
  });

  it("INFERENCE_CONTROL — an AI explanation remains a non-action with AI origin", () => {
    const fixture = corpus.cases.ai_inferred_explanation;
    const chain = drive(fixture);
    const subject = expectRetainedFactor(chain, {
      id: fixture.oracle.subject_id, label: fixture.oracle.subject_label,
    });
    expect(subject.provenance).toBe(fixture.oracle.expected_provenance);
    expect(subject).not.toHaveProperty("source_quote");
    expectFramingWithoutOptions(chain);
  });

  it("CONNECTED_CONTROL — competing non-action explanations and a stated diagnostic fact survive without ranking", () => {
    const fixture = corpus.cases.nonaction_connected;
    const chain = drive(fixture);
    expect(fixture.oracle.subjects).toHaveLength(2);
    for (const subject of fixture.oracle.subjects) expectRetainedFactor(chain, subject);
    const fact = oneById(chain.graph.nodes, fixture.oracle.stated_fact_id);
    expect(fact).toMatchObject({ kind: "factor", provenance: "from_brief" });
    expect(fact).toHaveProperty("source_quote", fixture.oracle.stated_fact_quote);
    expectFramingWithoutOptions(chain);
  });

  it("NORMATIVE_RETENTION — removing a causal link does not erase an unresolved explanation from reasoning/context", () => {
    const connectedFixture = corpus.cases.nonaction_connected;
    const disconnectedFixture = corpus.cases.nonaction_disconnected;
    expect(disconnectedFixture.records.stated_items).toEqual(connectedFixture.records.stated_items);
    expect(disconnectedFixture.records.claims).toEqual(
      connectedFixture.records.claims.filter((claim) => claim.label !== "pricing hypothesis bears on retention"),
    );
    const connected = drive(connectedFixture);
    const disconnected = drive(disconnectedFixture);
    expectRetainedFactor(connected, connectedFixture.oracle.subjects[1]);
    expectFramingWithoutOptions(disconnected);
    const subjectId = disconnectedFixture.oracle.disconnected_subject_id;
    const incident = (edge: { readonly from: string; readonly to: string }) =>
      edge.from === subjectId || edge.to === subjectId;
    expect(connected.projection.graph.edges.filter(incident)).toHaveLength(1);
    expect(connected.graph.edges.filter(incident)).toHaveLength(1);
    expect(connected.compact.edges.filter(incident)).toHaveLength(1);
    expect(disconnected.projection.graph.edges.filter(incident)).toEqual([]);
    expect(disconnected.graph.edges.filter(incident)).toEqual([]);
    expect(disconnected.compact.edges.filter(incident)).toEqual([]);
    // A disclosure is not canonical/context retention. Do not satisfy this by
    // inventing a causal edge or pointing to the untouched input record alone.
    for (const subject of disconnectedFixture.oracle.subjects) {
      expectRetainedFactor(disconnected, subject);
    }
  });

  it("ACTION_CONTROL — genuine stated and AI-proposed actions retain distinct interventions and origins", () => {
    const fixture = corpus.cases.genuine_alternatives;
    const chain = drive(fixture);
    const target = oneById(chain.graph.nodes, fixture.oracle.target_factor_id);
    expect(target).toMatchObject({ kind: "factor", label: fixture.oracle.target_factor_label });
    expect(chain.options.map((option) => option.id).sort()).toEqual(
      fixture.oracle.options.map((option) => option.id).sort(),
    );
    for (const expected of fixture.oracle.options) {
      const node = oneById(chain.graph.nodes, expected.id);
      expect(node).toMatchObject({ kind: "option", label: expected.label, provenance: expected.provenance });
      const option = oneById(chain.options, expected.id);
      expect(Object.keys(option.interventions)).toEqual([fixture.oracle.target_factor_id]);
      expect(option.interventions[fixture.oracle.target_factor_id]).toMatchObject({
        value: expected.intervention,
        source: "cee_hypothesis",
      });
      expect(oneById(chain.display.options, expected.id).label).toBe(expected.label);
    }
    expect(chain.readiness.safeToAnalyse).toBe(fixture.oracle.expected_ready);
  });
});
