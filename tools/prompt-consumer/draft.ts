/** Deterministic draft contract probes. Authored fixtures are not model-behaviour evidence. */
import assert from "node:assert/strict";
import { Ajv } from "ajv";
import { buildDraftRecordsSchema, type DraftRecordSet } from "../../src/cee/draft/records/grammar.js";
import { projectDraftRecords, findGrammarFieldsDroppedBySeam } from "../../src/cee/draft/records/seam.js";
import { LLMDraftResponse } from "../../src/adapters/llm/shared-schemas.js";
import { projectGraphAndOptionsToV3 } from "../../src/cee/transforms/schema-v3.js";
import type { V1Graph } from "../../src/cee/transforms/schema-v2.js";
import {
  component, runContractProbe, runSemanticMutationFamily,
  type SemanticProbeResult, type MutationFamilyResult,
} from "./contract.js";

export const DRAFT_COMPONENTS = {
  schema: component({ path: "src/cee/draft/records/grammar.ts", exportName: "buildDraftRecordsSchema" }, buildDraftRecordsSchema),
  parser: component({ path: "src/cee/draft/records/seam.ts", exportName: "projectDraftRecords" }, projectDraftRecords),
  graphSchema: component({ path: "src/adapters/llm/shared-schemas.ts", exportName: "LLMDraftResponse.parse" }, LLMDraftResponse.parse.bind(LLMDraftResponse)),
  consumer: component({ path: "src/cee/transforms/schema-v3.ts", exportName: "projectGraphAndOptionsToV3" }, projectGraphAndOptionsToV3),
};

type DraftStages = { [K in keyof typeof DRAFT_COMPONENTS]: (typeof DRAFT_COMPONENTS)[K]["implementation"] };
const actualStages: DraftStages = {
  schema: buildDraftRecordsSchema,
  parser: projectDraftRecords,
  graphSchema: LLMDraftResponse.parse.bind(LLMDraftResponse),
  consumer: projectGraphAndOptionsToV3,
};

export interface DraftFixture { brief: string; records: DraftRecordSet }
export interface DraftObservation {
  schema: Record<string, unknown>;
  schemaAccepted: boolean;
  schemaErrors: unknown;
  seam: ReturnType<typeof projectDraftRecords>;
  consumer?: ReturnType<typeof projectGraphAndOptionsToV3>;
}

/** The same accepted graph is passed to the real semantic consumer, never rebuilt by a test. */
export function inspectDraftRecords(
  raw: unknown,
  brief: string,
  stages: DraftStages = actualStages,
): DraftObservation {
  const schema = stages.schema();
  const validate = new Ajv().compile(schema);
  const schemaAccepted = validate(raw) === true;
  const seam = stages.parser(raw, brief);
  if (!seam.ok) return { schema, schemaAccepted, schemaErrors: validate.errors, seam };
  const accepted = stages.graphSchema(seam.projection.graph);
  const consumer = stages.consumer(accepted as unknown as V1Graph, { brief });
  return { schema, schemaAccepted, schemaErrors: validate.errors, seam, consumer };
}

export function makeDraftFixture(): DraftFixture {
  return {
    brief: "Improve resilience. Fund the programme. Current churn is 12%.",
    records: {
      stated_items: [
        { kind: "goal", source_quote: "Improve resilience" },
        { kind: "option", source_quote: "Fund the programme" },
        { kind: "figure", source_quote: "Current churn is 12%", value: 12, unit: "%" },
      ],
      claims: [
        { claim_kind: "prior", label: "Coordination effort", value: 4 },
        { claim_kind: "causal_link", label: "Programme changes churn", from_stated: 1, to_stated: 2, sets_to: 8, effect: "negative" },
        { claim_kind: "causal_link", label: "Churn affects resilience", from_stated: 2, to_stated: 0, effect: "negative" },
        { claim_kind: "causal_link", label: "Effort affects resilience", from_claim: 0, to_stated: 0, effect: "negative" },
      ],
    },
  };
}

/** Distilled from FQ's authored figureRich case, not a captured LLM response. */
export function makeClaimMediatedFixture(): DraftFixture {
  return {
    brief: "Improve support reliability. Current churn is 12%.",
    records: {
      stated_items: [
        { kind: "goal", source_quote: "Improve support reliability" },
        { kind: "figure", source_quote: "Current churn is 12%.", value: 12, unit: "%" },
      ],
      claims: [
        { claim_kind: "factor", label: "Current churn", value: 12, basis: [1] },
        { claim_kind: "causal_link", label: "Churn affects reliability", from_claim: 0, to_stated: 0, effect: "negative" },
      ],
    },
  };
}

function accepted(observation: DraftObservation) {
  assert.equal(observation.schemaAccepted, true, "attached grammar rejects the representation");
  assert.equal(observation.seam.ok, true, "real records parser refused the representation");
  assert.ok(observation.consumer, "semantic consumer did not receive the graph");
  return { seam: observation.seam, consumer: observation.consumer };
}

function nodeByLabel(observation: DraftObservation, label: string) {
  const { consumer } = accepted(observation);
  const matches = consumer.graph.nodes.filter(node => node.label === label);
  assert.equal(matches.length, 1, `expected one consumed node: ${label}`);
  return matches[0]!;
}

export function verifyStatedPercent(observation: DraftObservation, label = "Current churn is 12%") {
  const node = nodeByLabel(observation, label);
  assert.equal(node.observed_state?.raw_value, 12, "stated raw magnitude was lost");
  assert.equal(node.observed_state?.unit, "%", "stated percent unit was lost");
  assert.equal(node.observed_state?.value, 0.12, "percentage is on the wrong model scale");
  assert.equal(node.scale_frame, 100, "percentage's declared unit must determine its frame");
  assert.equal(node.display_value, "12%", "display changed the quantity's meaning");
  assert.equal(node.observed_state?.source, "brief_extraction", "stated source ownership was lost");
  assert.equal(node.provenance, "from_brief", "stated quantity lost its verified user attribution");
}

export function verifyInferredScalar(observation: DraftObservation) {
  const node = nodeByLabel(observation, "Coordination effort");
  assert.equal(node.observed_state?.raw_value, 4, "inferred scalar never reached the consumer");
  assert.equal(node.provenance, "ai_inferred", "inferred node was relabelled as a user fact");
}

export function verifyInferredScalarOwnership(observation: DraftObservation) {
  verifyInferredScalar(observation);
  const node = nodeByLabel(observation, "Coordination effort");
  assert.notEqual(node.observed_state?.source, "brief_extraction", "V3 falsely attributes an uncited AI scalar to the brief");
}

export function verifyOptionEffect(observation: DraftObservation, value = 8, source = "cee_hypothesis") {
  const target = nodeByLabel(observation, "Current churn is 12%");
  const { seam, consumer } = accepted(observation);
  assert.equal(consumer.options.length, 1, "option vanished or multiplied before consumption");
  const option = consumer.options[0]!;
  const effect = option.interventions[target.id];
  assert.ok(effect, "sets_to was accepted but no consumer intervention exists");
  assert.equal(effect.value, value / 100, "option effect changed scale");
  assert.equal(effect.raw_value, value, "option effect lost its raw magnitude");
  assert.equal(effect.source, source, "option effect source ownership changed");
  const projectedOptions = seam.projection.graph.nodes.filter(node => node.kind === "option");
  assert.equal(projectedOptions.length, 1, "expected the same single option before V3");
  const details = projectedOptions[0]!.data?.intervention_details as
    Record<string, { source: string; raw_value: number }> | undefined;
  assert.equal(details?.[target.id]?.source, source, "projected source ownership differs from the final consumer");
}

export function verifyAbsentScalar(observation: DraftObservation) {
  const node = nodeByLabel(observation, "Coordination effort");
  assert.equal(node.observed_state?.value, undefined, "absence was replaced with a number");
  assert.equal(node.observed_state?.raw_value, undefined, "absence acquired an invented raw value");
  // This is absent scalar carriage, not a typed refusal/rationale/unknown carrier.
}

export function verifyRequestedConfidence(observation: DraftObservation) {
  accepted(observation);
  const node = nodeByLabel(observation, "Coordination effort");
  assert.equal((node as unknown as { confidence?: number }).confidence, 0.8, "requested factor confidence was not consumed");
}

export const DRAFT_CASE_IDS = [
  "draft.required-fields", "draft.grammar-carriage", "draft.stated-percent",
  "draft.inferred-scalar", "draft.inferred-scalar-ownership", "draft.option-effect",
  "draft.cited-option-effect", "draft.absent-scalar", "draft.requested-confidence",
  "draft.claim-mediated-percent",
] as const;
export type DraftCaseId = (typeof DRAFT_CASE_IDS)[number];
type FixtureMutation = (fixture: DraftFixture) => void;

/** Mutations are for probe self-tests, never applied to production code or callers. */
export function runDraftContractProbe(id: DraftCaseId, mutate?: FixtureMutation): SemanticProbeResult {
  const fixture = id === "draft.claim-mediated-percent" ? makeClaimMediatedFixture() : makeDraftFixture();
  if (id === "draft.absent-scalar") delete fixture.records.claims[0]!.value;
  if (id === "draft.cited-option-effect") {
    fixture.records.claims[1]!.sets_to = 12;
    fixture.records.claims[1]!.basis = [2];
  }
  if (id === "draft.requested-confidence") {
    (fixture.records.claims[0] as unknown as Record<string, unknown>).confidence = 0.8;
  }
  mutate?.(fixture);
  return runContractProbe({
    id,
    task: "draft_graph",
    components: DRAFT_COMPONENTS,
    execute: stages => {
      const observation = inspectDraftRecords(fixture.records, fixture.brief, stages);
      if (id !== "draft.required-fields") return { observation, missingRequired: [] };
      const schema = observation.schema as {
        required: string[];
        properties: Record<"stated_items" | "claims", { items: { required: string[] } }>;
      };
      const missing: unknown[] = [];
      for (const key of schema.required) {
        const mutant = structuredClone(fixture.records) as unknown as Record<string, unknown>;
        delete mutant[key];
        missing.push(mutant);
      }
      for (const collection of ["stated_items", "claims"] as const) {
        for (const key of schema.properties[collection].items.required) {
          const mutant = structuredClone(fixture.records) as unknown as Record<string, Array<Record<string, unknown>>>;
          delete mutant[collection]![0]![key];
          missing.push(mutant);
        }
      }
      return { observation, missingRequired: missing.map(raw => inspectDraftRecords(raw, fixture.brief, stages)) };
    },
    verify: ({ observation, missingRequired }) => {
      switch (id) {
        case "draft.required-fields":
          accepted(observation);
          assert.equal(missingRequired.length, 6, "required-field cases disappeared");
          for (const missing of missingRequired) {
            assert.equal(missing.schemaAccepted, false, "grammar accepted a missing required field");
            assert.equal(missing.seam.ok, false, "parser accepted a missing required field");
          }
          break;
        case "draft.grammar-carriage":
          assert.deepEqual(accepted(observation).seam.records, fixture.records, "grammar field silently dropped at the seam");
          assert.deepEqual(findGrammarFieldsDroppedBySeam(), { claims: [], statedItems: [] });
          break;
        case "draft.stated-percent": verifyStatedPercent(observation); break;
        case "draft.inferred-scalar": verifyInferredScalar(observation); break;
        case "draft.inferred-scalar-ownership": verifyInferredScalarOwnership(observation); break;
        case "draft.option-effect": verifyOptionEffect(observation); break;
        case "draft.cited-option-effect": verifyOptionEffect(observation, 12, "brief_extraction"); break;
        case "draft.absent-scalar": verifyAbsentScalar(observation); break;
        case "draft.requested-confidence": verifyRequestedConfidence(observation); break;
        case "draft.claim-mediated-percent": verifyStatedPercent(observation, "Current churn"); break;
      }
    },
  });
}

/** No live PMS identity is inferred from these deterministic, fixture-bound checks. */
export function runDraftContractProbes(): SemanticProbeResult[] {
  return DRAFT_CASE_IDS.map(id => runDraftContractProbe(id));
}

/** These controls falsify the actual relationship; they do not mutate prompt keywords. */
export function runDraftMutationFamilies(): MutationFamilyResult[] {
  const changes: Array<{ id: DraftCaseId; breakMeaning: FixtureMutation }> = [
    { id: "draft.stated-percent", breakMeaning: fixture => { delete fixture.records.stated_items[2]!.unit; } },
    { id: "draft.inferred-scalar", breakMeaning: fixture => { delete fixture.records.claims[0]!.value; } },
    { id: "draft.option-effect", breakMeaning: fixture => { delete fixture.records.claims[1]!.sets_to; } },
    { id: "draft.cited-option-effect", breakMeaning: fixture => { delete fixture.records.claims[1]!.basis; } },
    { id: "draft.absent-scalar", breakMeaning: fixture => { fixture.records.claims[0]!.value = 0; } },
  ];
  return changes.map(({ id, breakMeaning }) => runSemanticMutationFamily({
    id,
    expectedCaseIds: ["baseline", "semantic-loss", "unrelated-content"],
    cases: [
      { id: "baseline", kind: "baseline", run: () => runDraftContractProbe(id) },
      { id: "semantic-loss", kind: "semantic_break", run: () => runDraftContractProbe(id, breakMeaning) },
      { id: "unrelated-content", kind: "unrelated", run: () => runDraftContractProbe(id, fixture => {
        fixture.records.claims[2]!.label = "An unrelated caption containing the word teapot";
      }) },
    ],
  }));
}
