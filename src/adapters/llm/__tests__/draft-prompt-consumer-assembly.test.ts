/**
 * Hermetic production-assembly witness for #1228.
 *
 * Real file-backed PMS → governed election → prompt loader/cache → Anthropic
 * adapter → wire parser → projector → adapter graph consumer. Only the SDK
 * transport is intercepted. The candidate is version 9001 in this TEST store,
 * not a claim it has been promoted or served by a deployed instance.
 *
 * Canned provider responses prove transport/consumer mechanics, NEVER natural-
 * language compliance. Incumbent/candidate/destroyed prompt behaviour has its
 * own live-model corpus; an identity check is not a semantic score.
 */
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Ajv } from "ajv";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildDraftRecordsSchema, type DraftRecordSet } from "../../../cee/draft/records/grammar.js";
import { DRAFT_RECORDS_INSTRUCTION } from "../../../cee/draft/records/instruction.js";
import {
  buildRecordsCompletionPrompt,
  buildRecordsCompletionSchema,
  enumerateCompletionAsk,
} from "../../../cee/draft/records/completion.js";
import { projectDraftRecords } from "../../../cee/draft/records/seam.js";
import { DRAFT_LEAN_RETRY_DIRECTIVE, STRENGTH_DEFAULT_RETRY_NUDGE } from "../../../cee/constants.js";
import { wrapUntrusted } from "../untrusted-envelope.js";

const streamSpy = vi.hoisted(() => vi.fn());
const createSpy = vi.hoisted(() => vi.fn());
vi.mock("@anthropic-ai/sdk", () => ({
  default: class TransportBoundary {
    messages = { stream: streamSpy, create: createSpy };
  },
}));

const ROOT = resolve(__dirname, "../../../..");
const INCUMBENT = readFileSync(join(ROOT, "Prompts/canonical/draft_graph.txt"), "utf8");
const CANDIDATE = readFileSync(join(ROOT, "Prompts/candidates/draft_graph_records.txt"), "utf8");
const INCUMBENT_HASH = "152998b447819c2e9e797b1727f8e05b34480486dca6f672a5d2839facd2353f";
const MODEL = "claude-sonnet-4-6";
const BRIEF = "Reduce delivery delays. Add a support team. Keep current staffing. Delivery time is 12 days.";
const RECORDS: DraftRecordSet = {
  stated_items: [
    { kind: "goal", source_quote: "Reduce delivery delays" },
    { kind: "option", source_quote: "Add a support team" },
    { kind: "option", source_quote: "Keep current staffing" },
    { kind: "figure", source_quote: "Delivery time is 12 days", value: 12, unit: "days", role: "baseline" },
  ],
  claims: [
    { claim_kind: "prior", label: "Coordination effort", value: 4, basis: [0] },
    { claim_kind: "causal_link", label: "Support improves delivery", from_stated: 1, to_stated: 3, effect: "negative", sets_to: 8 },
    { claim_kind: "causal_link", label: "Current staffing maintains delivery", from_stated: 2, to_stated: 3, effect: "positive", sets_to: 12 },
    { claim_kind: "causal_link", label: "Delivery time bears on delays", from_stated: 3, to_stated: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "Coordination bears on delays", from_claim: 0, to_stated: 0, effect: "negative" },
  ],
};

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
type RequestBody = {
  model: string;
  system?: Array<{ type: string; text: string }>;
  messages: Array<{ role: string; content: string }>;
  output_config?: { format: { schema: object } };
};
function stream(records: unknown) {
  const text = JSON.stringify(records);
  return {
    async *[Symbol.asyncIterator]() {
      yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } };
    },
    finalMessage: async () => ({
      content: [{ type: "text", text }], stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 200 },
    }),
    abort() {},
  };
}

let testDirectory: string;
const executed = new Set<string>();
beforeEach(() => {
  expect.hasAssertions();
  vi.resetModules();
  testDirectory = mkdtempSync(join(tmpdir(), "draft-prompt-assembly-"));
  vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
  vi.stubEnv("PROMPTS_ENABLED", "true");
  vi.stubEnv("PROMPTS_STORE_TYPE", "file");
  vi.stubEnv("PROMPTS_STORE_PATH", join(testDirectory, "prompts.json"));
  vi.stubEnv("PROMPTS_USE_STAGING", "true");
  vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", "true");
  vi.stubEnv("CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED", "true");
  // Never let a developer's local DB configuration escape a hermetic test.
  for (const key of ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "PROMPTS_POSTGRES_URL"]) vi.stubEnv(key, undefined);
  streamSpy.mockImplementation(() => stream(RECORDS));
  createSpy.mockResolvedValue({ content: [{ type: "text", text: '{"claims":[]}' }] });
});
afterEach(() => {
  streamSpy.mockReset();
  createSpy.mockReset();
  vi.unstubAllEnvs();
  rmSync(testDirectory, { recursive: true, force: true });
});
afterAll(() => {
  expect([...executed].sort()).toEqual([
    "candidate-prompt-only", "candidate-structured", "completion-prompt-only", "completion-structured",
    "default-fallback", "identity-controls", "incumbent", "invalid-wire", "provider-degradation", "retry-lean", "retry-strength",
  ]);
});

async function seedStore(selectedContent = CANDIDATE, selectedVersion = 9001) {
  const at = "2026-08-30T00:00:00.000Z";
  const definition = (taskId: string, content: string) => ({
    id: `${taskId}_default`, name: `Hermetic ${taskId}`, taskId,
    status: "production", activeVersion: 195, stagingVersion: selectedVersion,
    versions: [
      { version: 195, content: INCUMBENT, contentHash: sha(INCUMBENT), createdBy: "test", createdAt: at },
      ...(selectedVersion === 195 ? [] : [{ version: selectedVersion, content, contentHash: sha(content), createdBy: "test", createdAt: at }]),
    ],
    createdAt: at, updatedAt: at,
    modelConfig: { staging: MODEL, production: "claude-sonnet-5" },
  });
  // Test data is loaded through the production backend, not a mocked loader.
  writeFileSync(join(testDirectory, "prompts.json"), JSON.stringify({
    version: 1, lastModified: at,
    prompts: {
      draft_graph_default: definition("draft_graph", selectedContent),
      edit_graph_default: definition("edit_graph", "Edit-only decoy: a porcelain teapot with a label."),
    },
  }));
  const { initializePromptStore } = await import("../../../prompts/store.js");
  await initializePromptStore();
}

async function invoke(options: { forceDefault?: boolean; systemDirective?: string } = {}) {
  const { getSystemPromptSnapshot } = await import("../prompt-loader.js");
  const snapshot = await getSystemPromptSnapshot("draft_graph", { forceDefault: options.forceDefault });
  const { draftGraphWithAnthropic } = await import("../anthropic.js");
  const result = await draftGraphWithAnthropic({
    brief: BRIEF, docs: [], seed: 17, model: MODEL, systemDirective: options.systemDirective,
  }, { preloadedSystemPrompt: { operation: "draft_graph", ...snapshot } });
  return { snapshot, result };
}

function assertAssembled(body: RequestBody, expectedPrompt: string, structured: boolean) {
  const { system = [] } = body;
  expect(body.model).toBe(MODEL);
  expect(body.messages).toHaveLength(1);
  expect(body.messages[0].role).toBe("user");
  expect(body.messages[0].content.startsWith(wrapUntrusted("## Brief", BRIEF))).toBe(true);
  // Exact blocks, not incidental occurrences of a grammar property name.
  expect(system.map((block) => block.text)).toEqual([expectedPrompt, DRAFT_RECORDS_INSTRUCTION]);
  const blocks = system[1].text.match(/<DRAFT_RECORDS_MACHINE_SCHEMA>\s*([\s\S]*?)\s*<\/DRAFT_RECORDS_MACHINE_SCHEMA>/g);
  expect(blocks).toHaveLength(1);
  const rawSchema = blocks![0].replace(/<\/?DRAFT_RECORDS_MACHINE_SCHEMA>/g, "").trim();
  const taughtSchema = JSON.parse(rawSchema) as object;
  expect(taughtSchema).toEqual(buildDraftRecordsSchema());
  expect(new Ajv().compile(taughtSchema)(RECORDS)).toBe(true);
  if (structured) expect(body.output_config?.format.schema).toEqual(taughtSchema);
  else expect(body.output_config).toBeUndefined();
}

function assertConsumed(result: Awaited<ReturnType<typeof invoke>>["result"]) {
  const figure = result.graph.nodes.find((node) => node.label === "Delivery time is 12 days");
  const prior = result.graph.nodes.find((node) => node.label === "Coordination effort");
  const option = result.graph.nodes.find((node) => node.label === "Add a support team");
  expect(figure?.data).toMatchObject({ raw_value: 12, unit: "days" });
  expect(figure?.provenance).toMatchObject({ provenance_class: "stated", brief_binding: "verified" });
  expect(prior?.data).toMatchObject({ raw_value: 4 });
  expect(prior?.provenance).toMatchObject({ provenance_class: "ai_inferred" });
  expect(figure).toBeDefined();
  expect(option?.data).toMatchObject({
    raw_interventions: { [figure!.id]: 8 },
    intervention_details: { [figure!.id]: { raw_value: 8, source: "cee_hypothesis" } },
  });
  expect(result.graph.nodes.filter((node) => node.kind === "option")).toHaveLength(2);
}

describe("draft_graph production assembly and consumption", () => {
  it.each([true, false])("candidate through the real PMS with structured outputs=%s", async (structured) => {
    executed.add(structured ? "candidate-structured" : "candidate-prompt-only");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", String(structured));
    await seedStore();
    const { snapshot, result } = await invoke();
    expect(streamSpy).toHaveBeenCalledOnce();
    expect(snapshot.meta).toMatchObject({ taskId: "draft_graph", promptId: "draft_graph_default", version: 9001, source: "store", prompt_hash: sha(CANDIDATE) });
    expect(snapshot.content).toBe(CANDIDATE);
    assertAssembled(streamSpy.mock.calls[0][0], CANDIDATE, structured);
    expect(result.meta).toMatchObject({ prompt_hash: sha(CANDIDATE), prompt_store_version: 9001, prompt_source: "store", structured_outputs_used: structured });
    assertConsumed(result);
  });

  it("the actual served export keeps its own identity, separate from the candidate", async () => {
    executed.add("incumbent");
    expect(sha(INCUMBENT)).toBe(INCUMBENT_HASH);
    expect(sha(CANDIDATE)).not.toBe(INCUMBENT_HASH);
    await seedStore(INCUMBENT, 195);
    const { snapshot, result } = await invoke();
    expect(snapshot.meta).toMatchObject({ version: 195, source: "store", prompt_hash: INCUMBENT_HASH });
    assertAssembled(streamSpy.mock.calls[0][0], INCUMBENT, true);
    assertConsumed(result); // transport/consumer proof only; does NOT bless incumbent prose
  });

  it("provider rejection rebuilds a prompt-only request without losing records instructions", async () => {
    executed.add("provider-degradation");
    await seedStore();
    streamSpy.mockImplementationOnce(() => { throw Object.assign(new Error("Unexpected key 'output_config'"), { status: 400 }); });
    const { result } = await invoke();
    expect(streamSpy).toHaveBeenCalledTimes(2);
    assertAssembled(streamSpy.mock.calls[0][0], CANDIDATE, true);
    assertAssembled(streamSpy.mock.calls[1][0], CANDIDATE, false);
    expect(result.meta?.structured_outputs_used).toBe(false);
    assertConsumed(result);
  });

  it("a registered-default fallback still receives the current records schema and consumer", async () => {
    executed.add("default-fallback");
    await seedStore();
    const { snapshot, result } = await invoke({ forceDefault: true });
    expect(snapshot.meta.source).toBe("default");
    expect(snapshot.content).not.toBe(CANDIDATE);
    expect(snapshot.content).not.toBe(INCUMBENT);
    assertAssembled(streamSpy.mock.calls[0][0], snapshot.content, true);
    assertConsumed(result);
  });

  it.each([
    ["lean", DRAFT_LEAN_RETRY_DIRECTIVE],
    ["strength", STRENGTH_DEFAULT_RETRY_NUDGE],
  ])("the actual %s retry directive stays outside user-owned text and cannot replace records shape", async (kind, directive) => {
    executed.add(`retry-${kind}`);
    await seedStore();
    const { result } = await invoke({ systemDirective: directive });
    const body = streamSpy.mock.calls[0][0] as RequestBody;
    assertAssembled(body, CANDIDATE, true);
    const { DRAFT_COMPLIANCE_REMINDER } = await import("../anthropic.js");
    expect(body.messages[0].content).toBe(`${wrapUntrusted("## Brief", BRIEF)}${DRAFT_COMPLIANCE_REMINDER}\n\n${directive}`);
    expect(body.messages[0].content.endsWith(directive)).toBe(true);
    expect(body.messages[0].content.indexOf("[END_UNTRUSTED_USER_CONTENT]")).toBeGreaterThan(0);
    expect(body.messages[0].content.indexOf(directive)).toBeGreaterThan(body.messages[0].content.indexOf("[END_UNTRUSTED_USER_CONTENT]"));
    assertConsumed(result);
  });

  it("wrong prompt/schema/consumer identity breaks the probe; unrelated appendix content does not", async () => {
    executed.add("identity-controls");
    await seedStore();
    const { result } = await invoke({ systemDirective: "There is a ceramic teapot on the desk." });
    const body = streamSpy.mock.calls[0][0] as RequestBody;
    assertAssembled(body, CANDIDATE, true);
    assertConsumed(result);
    const wrongPrompt = structuredClone(body);
    wrongPrompt.system![0].text = "A teapot. label stated_items claims.";
    expect(() => assertAssembled(wrongPrompt, CANDIDATE, true)).toThrow();
    const wrongSchema = structuredClone(body);
    wrongSchema.output_config!.format.schema = { type: "object", properties: { nodes: { type: "array" } } };
    expect(() => assertAssembled(wrongSchema, CANDIDATE, true)).toThrow();
    const lostConsumer = structuredClone(result);
    lostConsumer.graph.nodes = [];
    expect(() => assertConsumed(lostConsumer)).toThrow();
  });

  it("provider-emitted missing label and old graph shape are rejected by the actual adapter seam", async () => {
    executed.add("invalid-wire");
    await seedStore();
    const missing = structuredClone(RECORDS) as unknown as { claims: Array<Record<string, unknown>> };
    delete missing.claims[0].label;
    streamSpy.mockImplementationOnce(() => stream(missing));
    await expect(invoke()).rejects.toThrow("draft_records_not_a_record_set");
    streamSpy.mockImplementationOnce(() => stream({ nodes: [], edges: [] }));
    await expect(invoke()).rejects.toThrow("draft_records_graph_shaped_response");
    const { result } = await invoke({ systemDirective: "An unrelated teapot." });
    assertConsumed(result);
    expect(streamSpy).toHaveBeenCalledTimes(3);
  });

  it.each([true, false])("reachable completion teaches and consumes claims-only shape with structured outputs=%s", async (structured) => {
    executed.add(structured ? "completion-structured" : "completion-prompt-only");
    vi.stubEnv("CEE_ANTHROPIC_STRUCTURED_OUTPUTS", String(structured));
    await seedStore();
    const incomplete = structuredClone(RECORDS);
    const [missingLink] = incomplete.claims.splice(3, 1);
    streamSpy.mockImplementation(() => stream(incomplete));
    createSpy.mockResolvedValue({ content: [{ type: "text", text: JSON.stringify({ claims: [missingLink] }) }] });
    const { result } = await invoke();
    expect(createSpy).toHaveBeenCalledOnce();
    const first = streamSpy.mock.calls[0][0] as RequestBody;
    const second = createSpy.mock.calls[0][0] as RequestBody;
    assertAssembled(first, CANDIDATE, structured);
    const seam = projectDraftRecords(incomplete, BRIEF);
    expect(seam.ok).toBe(true);
    if (!seam.ok) throw new Error("completion precondition failed");
    expect(second.messages[0].content).toBe(buildRecordsCompletionPrompt({
      brief: first.messages[0].content, records: seam.records,
      ask: enumerateCompletionAsk(seam.records, seam.projection),
    }));
    const schemaLines = second.messages[0].content.split("\n").filter((line) => line.startsWith('{"type":"object"'));
    expect(schemaLines).toHaveLength(1);
    expect(JSON.parse(schemaLines[0])).toEqual(buildRecordsCompletionSchema());
    const validate = new Ajv().compile(JSON.parse(schemaLines[0]));
    expect(validate({ claims: [missingLink] })).toBe(true);
    expect(validate({ stated_items: RECORDS.stated_items, claims: [missingLink] })).toBe(false);
    expect(validate({ claims: [{ claim_kind: "causal_link" }] })).toBe(false);
    if (structured) expect(second.output_config?.format.schema).toEqual(buildRecordsCompletionSchema());
    else expect(second.output_config).toBeUndefined();
    assertConsumed(result);
  });
});
