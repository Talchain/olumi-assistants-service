import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Ajv } from "ajv";
import { buildDraftRecordsSchema, type DraftRecordSet } from "../../src/cee/draft/records/grammar.js";
import { projectDraftRecords } from "../../src/cee/draft/records/seam.js";
import { LLMDraftResponse } from "../../src/adapters/llm/shared-schemas.js";
import type { ExecutableRuntimeTask } from "../../src/config/model-routing.js";
import {
  assertExactCaseIds, component, runContractProbe, runSemanticMutationFamily,
  sha256, type ProbeIdentity, type SemanticProbeResult,
} from "./contract.js";

const RAW: DraftRecordSet = {
  stated_items: [{ kind: "goal", source_quote: "Improve service" }],
  claims: [
    { claim_kind: "prior", label: "Capacity", value: 0.4, basis: [0] },
    { claim_kind: "causal_link", label: "Capacity improves service", from_claim: 0, to_stated: 0, effect: "positive" },
  ],
};
const components = {
  schema: component({ path: "src/cee/draft/records/grammar.ts", exportName: "buildDraftRecordsSchema" }, buildDraftRecordsSchema),
  parser: component({ path: "src/cee/draft/records/seam.ts", exportName: "projectDraftRecords" }, projectDraftRecords),
  consumer: component({ path: "src/adapters/llm/shared-schemas.ts", exportName: "LLMDraftResponse.parse" }, LLMDraftResponse.parse.bind(LLMDraftResponse)),
};
const identity: ProbeIdentity = {
  task: "draft_graph", sourceHead: "1".repeat(40),
  prompt: { task: "draft_graph", id: "draft_graph_default", version: 9001, disposition: "candidate", content: "Test-only prompt fixture.", sha256: sha256("Test-only prompt fixture.") },
  model: { id: "claude-sonnet-4-6", resolutionSource: "store_model_config" },
  bound: { task: "draft_graph", sourceHead: "1".repeat(40), promptSha256: sha256("Test-only prompt fixture."), schemaSha256: sha256(JSON.stringify(buildDraftRecordsSchema())), model: "claude-sonnet-4-6", modelResolutionSource: "store_model_config", requestId: "test-only-boundary" },
};

function probe(raw = RAW, options: { identity?: ProbeIdentity; deadVerifier?: boolean; bypassParser?: boolean; expectation?: "accept" | "reject" } = {}) {
  return runContractProbe({
    id: "draft-scalar-carriage", task: "draft_graph", components,
    identity: options.identity, expectation: options.expectation,
    execute: (stage) => {
      const schema = stage.schema();
      const schemaAccepted = new Ajv().compile(schema)(raw);
      const seam = options.bypassParser ? projectDraftRecords(raw, "Improve service") : stage.parser(raw, "Improve service");
      const consumed = seam.ok ? stage.consumer(seam.projection.graph) : undefined;
      return { schemaAccepted, seam, consumed };
    },
    verify: (output) => {
      if (options.deadVerifier) return;
      if (options.expectation === "reject") {
        expect(output.schemaAccepted).toBe(false);
        expect(output.seam.ok).toBe(false);
        expect(output.consumed).toBeUndefined();
        return;
      }
      expect(output.schemaAccepted).toBe(true);
      expect(output.seam.ok).toBe(true);
      const capacity = output.consumed?.nodes.find((node) => node.label === "Capacity");
      expect(capacity?.data).toMatchObject({ value: 0.4 });
      expect(capacity?.provenance).toMatchObject({ provenance_class: "ai_inferred" });
    },
  });
}
function loss(): DraftRecordSet { const raw = structuredClone(RAW); delete raw.claims[0].value; return raw; }
function unrelated(): DraftRecordSet { const raw = structuredClone(RAW); raw.claims[1].label = "A different causal explanation"; return raw; }
const caseIds = ["baseline", "drop-value", "unrelated-explanation"] as const;
function mutationCases(deadVerifier = false) {
  return [
    { id: caseIds[0], kind: "baseline" as const, run: () => probe(RAW, { deadVerifier }) },
    { id: caseIds[1], kind: "semantic_break" as const, run: () => probe(loss(), { deadVerifier }) },
    { id: caseIds[2], kind: "unrelated" as const, run: () => probe(unrelated(), { deadVerifier }) },
  ];
}

const executed: string[] = [];
beforeEach(() => expect.hasAssertions());
afterAll(() => assertExactCaseIds([
  "real-chain", "loss-controls", "dead-verifier", "participation", "negative-case",
  "runtime-binding", "wrong-identity", "collection", "forged-result", "same-task",
], executed));

describe("bounded executable contract runner", () => {
  it("executes actual schema, seam and semantic consumer, without claiming deployment", () => {
    executed.push("real-chain");
    const result = probe();
    expect(result.status).toBe("PASS");
    expect(result.participation.components.map(({ role, calls }) => ({ role, calls })))
      .toEqual([{ role: "schema", calls: 1 }, { role: "parser", calls: 1 }, { role: "consumer", calls: 1 }]);
    expect(result.participation.identity.status).toBe("UNVERIFIED");
  });

  it("dropping a scalar fails the same verifier; unrelated explanation remains green", () => {
    executed.push("loss-controls");
    const result = runSemanticMutationFamily({ id: "scalar-carriage", expectedCaseIds: caseIds, cases: mutationCases() });
    expect(result.status, result.issues.join("; ")).toBe("PASS");
    expect(result.cases.map(({ result: entry }) => entry.status)).toEqual(["PASS", "FAIL", "PASS"]);
    expect(result.cases[1].result.failureStages).toContain("semantic");
  });

  it("a dead verifier cannot earn semantic compatibility even when every component runs", () => {
    executed.push("dead-verifier");
    const result = runSemanticMutationFamily({ id: "dead-check", expectedCaseIds: caseIds, cases: mutationCases(true) });
    expect(result.status).toBe("FAIL");
    expect(result.issues.join("; ")).toContain("drop-value: expected FAIL, got PASS");
  });

  it("a direct parser bypass fails participation even when its labels and answer look correct", () => {
    executed.push("participation");
    const result = probe(RAW, { bypassParser: true });
    expect(result.status).toBe("FAIL");
    expect(result.issues).toContain("participation: parser did not execute");
    const arms = mutationCases();
    arms[1].run = () => result;
    const family = runSemanticMutationFamily({ id: "not-semantic", expectedCaseIds: caseIds, cases: arms });
    expect(family.status).toBe("FAIL");
    expect(family.issues.join("; ")).toContain("identity/participation failure alone is not a semantic-loss control");
  });

  it("required-field rejection is explicit and proves the consumer was not reached", () => {
    executed.push("negative-case");
    const missing = structuredClone(RAW) as unknown as { claims: Array<Record<string, unknown>> };
    delete missing.claims[0].label;
    const result = probe(missing as unknown as DraftRecordSet, { expectation: "reject" });
    expect(result.status).toBe("PASS");
    expect(result.participation.components.find((entry) => entry.role === "consumer")?.calls).toBe(0);
    expect(probe(RAW, { expectation: "reject" }).status).toBe("FAIL");
  });

  it("keeps stored/configured and actually-bound identities distinct", () => {
    executed.push("runtime-binding");
    expect(probe(RAW, { identity }).participation.identity.status).toBe("PASS");
    const configured = { ...identity, bound: undefined };
    const result = probe(RAW, { identity: configured });
    expect(result.status).toBe("PASS");
    expect(result.participation.identity.status).toBe("UNVERIFIED");
  });

  it("false identity is FAIL, never downgraded to missing evidence", () => {
    executed.push("wrong-identity");
    const wrongIdentities: ProbeIdentity[] = [
      { ...identity, task: "edit_graph" },
      { ...identity, sourceHead: "1234567" },
      { ...identity, prompt: { ...identity.prompt, content: "Teapot prose plus label." } },
      { ...identity, prompt: { ...identity.prompt, task: "edit_graph" } },
      { ...identity, bound: { ...identity.bound!, task: "edit_graph" } },
      { ...identity, bound: { ...identity.bound!, model: "different-model" } },
      { ...identity, bound: { ...identity.bound!, schemaSha256: "0".repeat(64) } },
    ];
    for (const wrong of wrongIdentities) {
      const result = probe(RAW, { identity: wrong });
      expect(result.status).toBe("FAIL");
      expect(result.participation.identity.status).toBe("FAIL");
    }
  });

  it("missing, duplicate, unexpected and empty collection all fail closed", () => {
    executed.push("collection");
    for (const actual of [[], ["baseline"], [...caseIds, "unexpected"], [...caseIds, "baseline"]]) {
      expect(() => assertExactCaseIds(caseIds, actual)).toThrow();
    }
    expect(() => assertExactCaseIds([], [])).toThrow();
    expect(() => assertExactCaseIds(["duplicate", "duplicate"], ["duplicate", "duplicate"])).toThrow();
    expect(() => assertExactCaseIds(caseIds, [...caseIds].reverse())).not.toThrow();
    const result = runSemanticMutationFamily({ id: "missing-control", expectedCaseIds: caseIds, cases: mutationCases().slice(0, 2) });
    expect(result.status).toBe("FAIL");
  });

  it("handwritten or copied PASS receipts cannot replace an executable run", () => {
    executed.push("forged-result");
    const arms = mutationCases();
    const actual = probe();
    arms[0].run = () => ({ ...actual });
    expect(runSemanticMutationFamily({ id: "forgery", expectedCaseIds: caseIds, cases: arms }).status).toBe("FAIL");
    expect(() => Object.assign(actual, { status: "PASS", task: "edit_graph" })).toThrow();
  });

  it("wrong runtime task cannot hide behind a successful local parser", () => {
    executed.push("same-task");
    const wrong = runContractProbe({
      id: "unregistered-task", task: "invented_estimator" as ExecutableRuntimeTask, components,
      execute: (stage) => { stage.schema(); const parsed = stage.parser(RAW, "Improve service"); return parsed.ok ? stage.consumer(parsed.projection.graph) : undefined; },
      verify: (result) => expect(result?.nodes.length).toBeGreaterThan(0),
    });
    expect(wrong.status).toBe("FAIL");
    expect(wrong.failureStages).toContain("identity");
    const arms = mutationCases();
    arms[1].run = () => wrong as SemanticProbeResult;
    expect(runSemanticMutationFamily({ id: "wrong-target", expectedCaseIds: caseIds, cases: arms }).status).toBe("FAIL");
    const unrelatedContract = runContractProbe({
      id: "different-semantic-contract", task: "draft_graph", components,
      execute: (stage) => { stage.schema(); const parsed = stage.parser(RAW, "Improve service"); return parsed.ok ? stage.consumer(parsed.projection.graph) : undefined; },
      verify: () => { throw new Error("An unrelated failing contract cannot stand in for a mutation"); },
    });
    arms[1].run = () => unrelatedContract;
    const mismatched = runSemanticMutationFamily({ id: "wrong-contract", expectedCaseIds: caseIds, cases: arms });
    expect(mismatched.status).toBe("FAIL");
    expect(mismatched.issues).toContain("mutation arms did not exercise the same contract probe");
  });
});
