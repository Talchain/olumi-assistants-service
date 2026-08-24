import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetConfigCache } from "../../config/index.js";
import { commitDirectAnswer } from "../commit.js";
import { composeDirectAnswerResponse } from "../compose.js";
import { OlumiResponseWithModelVersionReceiptLocalSchema } from "../model-management/mutation-receipt.js";
import { computeGraphIdentityHash } from "../context/graph-identity.js";
import { createNoopSessionStore } from "../session/__tests__/fixtures.js";
import type {
  AtomicCommittedModelVersionReceipt,
  SessionStore,
  SessionTurnWrite,
} from "../session/store.js";

const SCENARIO_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const TURN_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const ROOT_ID = "22222222-2222-4222-8222-222222222222";

const META = {
  scenario_id: SCENARIO_ID,
  turn_id: TURN_ID,
  turn_class: "direct_answer" as const,
  handler_id: null,
  request_hash: "sha256:test",
  llm_calls_used: 1,
  duration_ms: 42,
  handler_facts: [],
};

const GRAPH = {
  nodes: [
    { id: "goal_x", kind: "goal", label: "Goal" },
    { id: "fac_y", kind: "factor", label: "Factor", value: 10 },
  ],
  edges: [
    {
      from: "fac_y",
      to: "goal_x",
      strength: { mean: 0.5, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: "positive",
    },
  ],
  options: [{ id: "option-root", interventions: {} }],
  goal_node_id: "goal_x",
  custom_persisted_field: { retained: true },
};

function composed() {
  return composeDirectAnswerResponse({
    answerKind: "functional",
    assistant_text: "hi",
    stage: "frame",
  });
}

function setFlag(on: boolean): void {
  vi.stubEnv("OLUMI_ENV", "staging");
  vi.stubEnv("CEE_MODEL_VERSIONS_ENABLED", on ? "true" : "false");
  _resetConfigCache();
}

function receiptFor(write: SessionTurnWrite): AtomicCommittedModelVersionReceipt {
  const version = write.modelVersion!;
  return {
    ...version,
    version_id: VERSION_ID,
    version_number: 1,
    actor_kind: version.actor_kind,
    authored_by: version.authored_by,
    creation_kind: "initial",
    source_version_id: null,
    parent_version_id: null,
    root_version_id: ROOT_ID,
    undo_version_id: null,
    graph: write.graph,
    event_id: `model_version_created_mutation_${version.mutation_id}`,
  };
}

function capturingStore(options: { receipt?: boolean; fail?: Error } = {}) {
  const writes: SessionTurnWrite[] = [];
  const base = createNoopSessionStore();
  const store: SessionStore = {
    ...base,
    async append(write) {
      writes.push(write);
      if (options.fail) throw options.fail;
      return {
        id: "row-1",
        ...(options.receipt === true && write.modelVersion !== undefined
          ? { modelVersionReceipt: receiptFor(write) }
          : {}),
      };
    },
  };
  return { store, writes };
}

beforeEach(() => setFlag(true));
afterEach(() => {
  vi.unstubAllEnvs();
  _resetConfigCache();
});

describe("atomic semantic model-version commit", () => {
  it("folds the carrier into the one canonical append and exposes the strict public receipt", async () => {
    const { store, writes } = capturingStore({ receipt: true });
    const result = await commitDirectAnswer(
      composed(),
      { ...META, graph: GRAPH },
      store
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]!.modelVersion).toMatchObject({
      creation_kind: "committed_mutation",
      source_turn_id: TURN_ID,
      actor_kind: "unknown",
      authored_by: null,
    });
    expect(writes[0]!.modelVersion!.graph_identity_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(writes[0]!.modelVersion!.analysis_affecting_hash).toMatch(
      /^[0-9a-f]{64}$/
    );
    expect(writes[0]!.graph).toMatchObject({
      goal_node_id: "goal_x",
      custom_persisted_field: { retained: true },
    });
    expect((writes[0]!.graph as { options: unknown[] }).options).toHaveLength(1);
    expect(writes[0]!.modelVersion!.graph_identity_hash).toBe(
      computeGraphIdentityHash(writes[0]!.graph as never)!.value
    );
    expect(result.modelVersionReceipt?.version_id).toBe(VERSION_ID);
    const wire = OlumiResponseWithModelVersionReceiptLocalSchema.parse(
      result.response
    );
    expect(wire.model_version_receipt).toMatchObject({
      schema: "model_version_mutation_receipt.v1",
      scenario_id: SCENARIO_ID,
      version_id: VERSION_ID,
      sequence: 1,
      actor: { kind: "unknown" },
      creation: { kind: "initial" },
      lineage: { kind: "known", parent_version_id: null, root_version_id: ROOT_ID },
      undo_version_id: null,
    });
    expect(wire.model_version_receipt!.graph).toEqual(writes[0]!.graph);
  });

  it("uses a deterministic mutation id for an idempotent turn re-drive", async () => {
    const a = capturingStore();
    const b = capturingStore();
    await commitDirectAnswer(composed(), { ...META, graph: GRAPH }, a.store);
    await commitDirectAnswer(composed(), { ...META, graph: GRAPH }, b.store);
    expect(a.writes[0]!.modelVersion!.mutation_id).toBe(
      b.writes[0]!.modelVersion!.mutation_id
    );
  });

  it("creates no carrier for flag-off, graph-free, exact no-op, or pure layout", async () => {
    setFlag(false);
    const off = capturingStore();
    await commitDirectAnswer(composed(), { ...META, graph: GRAPH }, off.store);
    expect(off.writes[0]!.modelVersion).toBeUndefined();

    setFlag(true);
    const graphFree = capturingStore();
    await commitDirectAnswer(composed(), META, graphFree.store);
    expect(graphFree.writes[0]!.modelVersion).toBeUndefined();

    const noOp = capturingStore();
    await commitDirectAnswer(
      composed(),
      { ...META, graph: GRAPH, baseGraphForInvariants: structuredClone(GRAPH) },
      noOp.store
    );
    expect(noOp.writes[0]!.modelVersion).toBeUndefined();

    const layout = structuredClone(GRAPH) as typeof GRAPH & {
      nodes: Array<(typeof GRAPH.nodes)[number] & { position?: { x: number; y: number } }>;
    };
    layout.nodes[0]!.position = { x: 12, y: 34 };
    const presentation = capturingStore();
    await commitDirectAnswer(
      composed(),
      { ...META, graph: layout, baseGraphForInvariants: GRAPH },
      presentation.store
    );
    expect(presentation.writes[0]!.modelVersion).toBeUndefined();
  });

  it("treats label/evidence changes as semantic and persists explicit actor only", async () => {
    const changed = structuredClone(GRAPH) as typeof GRAPH & {
      nodes: Array<(typeof GRAPH.nodes)[number] & { provenance?: "user_set" }>;
    };
    changed.nodes[0]!.label = "Updated goal";
    changed.nodes[0]!.provenance = "user_set";
    const { store, writes } = capturingStore();
    await commitDirectAnswer(
      composed(),
      {
        ...META,
        graph: changed,
        baseGraphForInvariants: GRAPH,
        versionActor: { kind: "known", authored_by: "assistant" },
      },
      store
    );
    expect(writes[0]!.modelVersion).toMatchObject({
      actor_kind: "known",
      authored_by: "assistant",
    });
  });

  it("keeps guest/no-version success honest and propagates append failure", async () => {
    const guest = capturingStore();
    const guestResult = await commitDirectAnswer(
      composed(),
      { ...META, graph: GRAPH },
      guest.store
    );
    expect(guestResult.performed).toBe(true);
    expect(guestResult.modelVersionReceipt).toBeNull();
    expect(
      (guestResult.response as Record<string, unknown>).model_version_receipt
    ).toBeUndefined();

    const failing = capturingStore({ fail: new Error("atomic rollback") });
    await expect(
      commitDirectAnswer(composed(), { ...META, graph: GRAPH }, failing.store)
    ).rejects.toThrow("atomic rollback");
    expect(failing.writes).toHaveLength(1);
  });
});
