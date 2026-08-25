import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { _resetConfigCache } from "../../config/index.js";
import { commitDirectAnswer } from "../commit.js";
import { composeDirectAnswerResponse } from "../compose.js";
import { OlumiResponseWithModelVersionReceiptLocalSchema } from "../model-management/mutation-receipt.js";
import { computeGraphIdentityHash } from "../context/graph-identity.js";
import { decideModelVersionCreation } from "../model-management/version-creation-policy.js";
import { GraphV3 } from "../../schemas/cee-v3.js";
import * as telemetry from "../../utils/telemetry.js";
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
    // The PUBLIC receipt is the GraphV3 PROJECTION of the persisted graph, not
    // a byte copy of it. The receipt schema's `GraphV3.passthrough()` is
    // ROOT-only, so additive NESTED node fields (here `fac_y.value`) are
    // stripped on the way to the wire while remaining in `scenarios.graph`.
    //
    // This assertion used to read `toEqual(writes[0]!.graph)` and passed only
    // because C8 ALSO persisted that same lossy parse output — the two agreed
    // because both were stripped. Persisting the projected form (the B3
    // "appended graph IS the projected form" invariant) makes the persisted
    // bytes richer than the wire view, so the honest relationship is stated
    // here rather than left as an equality that held by defect.
    expect(wire.model_version_receipt!.graph).toEqual(
      GraphV3.passthrough().parse(writes[0]!.graph)
    );
    expect(
      (writes[0]!.graph as { nodes: Array<Record<string, unknown>> }).nodes.find(
        (n) => n.id === "fac_y"
      )!.value
    ).toBe(10);
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



/**
 * C8-A: versionable vs non-versionable, pinned in BOTH directions.
 *
 * The rule: a valid semantic commit on a versionable graph MUST still produce
 * the durable version; only genuinely non-versionable state may skip, and never
 * silently. A one-sided guard — asserting only that non-conformant graphs skip
 * — is exactly what would let a versionable graph quietly stop producing
 * history, so the "a version IS written" twin is the load-bearing half here.
 *
 * Fixtures are taken from the REAL failing corpus, not invented: each
 * non-conformance below was observed coming out of an actual commit path. Every
 * case PINS ITS OWN PRECONDITION so it provably is the case it claims to be
 * rather than passing because the fixture stopped reproducing it.
 */
describe("C8-A: versionable graphs version; non-versionable graphs skip observably", () => {
  // Missing required fields — an old row written before `label` existed.
  const MISSING_FIELDS_GRAPH = {
    nodes: [{ id: "fac_c", kind: "factor", observed_state: { value: 0.2 } }],
    edges: [],
    goal_node_id: "fac_c",
  };

  // Present-but-unusable: `std: 0`, which the adopt path persists VERBATIM to
  // keep the identity hash stable. A current product graph, not a legacy one.
  const STD_ZERO_GRAPH = {
    nodes: [
      { id: "goal_x", kind: "goal", label: "Goal" },
      { id: "fac_y", kind: "factor", label: "Factor" },
    ],
    edges: [
      {
        from: "fac_y",
        to: "goal_x",
        strength: { mean: 0.5, std: 0 },
        exists_probability: 0.9,
        effect_direction: "positive",
      },
    ],
    goal_node_id: "goal_x",
  };

  let emitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    emitSpy = vi.spyOn(telemetry, "emit");
  });

  afterEach(() => {
    emitSpy.mockRestore();
  });

  function versionEvents() {
    return emitSpy.mock.calls.filter(
      (c: readonly unknown[]) =>
        c[0] === telemetry.TelemetryEvents.V5ModelVersionCreated
    );
  }

  function issuesOf(graph: unknown) {
    const r = GraphV3.passthrough().safeParse(graph);
    return r.success ? null : r.error.issues;
  }

  it("PRECONDITION: all three fixtures clear the creation policy, and only GRAPH is GraphV3-conformant", () => {
    // The policy is NOT the discriminator — it says "create" for all three, so
    // the parse is genuinely doing the work.
    expect(decideModelVersionCreation(undefined, GRAPH).create).toBe(true);
    expect(decideModelVersionCreation(undefined, MISSING_FIELDS_GRAPH).create).toBe(true);
    expect(decideModelVersionCreation(undefined, STD_ZERO_GRAPH).create).toBe(true);

    expect(issuesOf(GRAPH)).toBeNull();

    const missing = issuesOf(MISSING_FIELDS_GRAPH)!;
    expect(missing.length).toBeGreaterThan(0);
    expect(
      missing.every(
        (i) => i.code === "invalid_type" && (i as { received?: string }).received === "undefined"
      )
    ).toBe(true);

    // std:0 fails on a PRESENT field — the case an "all issues are missing
    // fields" predicate would have mis-routed into failing the whole turn.
    const stdZero = issuesOf(STD_ZERO_GRAPH)!;
    expect(stdZero.length).toBeGreaterThan(0);
    expect(
      stdZero.some(
        (i) => !(i.code === "invalid_type" && (i as { received?: string }).received === "undefined")
      )
    ).toBe(true);
  });

  it("VERSIONABLE: the turn commits AND a version IS written (the durable consequence happens)", async () => {
    const { store, writes } = capturingStore({ receipt: true });

    const result = await commitDirectAnswer(
      composed(),
      { ...META, graph: GRAPH },
      store
    );

    expect(result.performed).toBe(true);
    expect(writes).toHaveLength(1);

    // Bound by identity to THIS turn's carrier, not by a value predicate
    // another case could satisfy.
    const version = writes[0]!.modelVersion;
    expect(version).toBeDefined();
    expect(version).toMatchObject({
      creation_kind: "committed_mutation",
      source_turn_id: TURN_ID,
    });
    expect(result.modelVersionReceipt?.version_id).toBe(VERSION_ID);

    // The carrier's hashes describe the bytes actually persisted — what CAS
    // compares on.
    expect(version!.graph_identity_hash).toBe(
      computeGraphIdentityHash(writes[0]!.graph as never)!.value
    );

    // A version was created, so nothing was skipped.
    expect(versionEvents()).toHaveLength(0);
  });

  it("VERSIONABLE regression guard: additive nested node fields survive into the persisted graph", async () => {
    // `.passthrough()` is ROOT-only, so the parse strips unknown keys from the
    // nested NodeV3. Persisting the parse output silently dropped `value: 10`
    // from this factor node and hashed the lossy form, so nothing noticed.
    const { store, writes } = capturingStore();
    await commitDirectAnswer(composed(), { ...META, graph: GRAPH }, store);

    const persisted = writes[0]!.graph as { nodes: Array<Record<string, unknown>> };
    expect(persisted.nodes.find((n) => n.id === "fac_y")!.value).toBe(10);
  });

  it("NON-VERSIONABLE (missing fields): commits, writes no version, and names the skip", async () => {
    const { store, writes } = capturingStore({ receipt: true });

    const result = await commitDirectAnswer(
      composed(),
      { ...META, graph: MISSING_FIELDS_GRAPH },
      store
    );

    // (1) the turn commits — the user's work is not lost to a secondary record
    expect(result.performed).toBe(true);
    expect(writes).toHaveLength(1);

    // (2) no version is written
    expect(writes[0]!.modelVersion).toBeUndefined();
    expect(result.modelVersionReceipt).toBeNull();
    expect(
      (result.response as Record<string, unknown>).model_version_receipt
    ).toBeUndefined();

    // (3) the skip is observable and classified
    const events = versionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]![1]).toMatchObject({
      scenario_id: SCENARIO_ID,
      turn_id: TURN_ID,
      status: "skipped",
      skip_reason: "graph_missing_required_fields",
      provenance: "commit",
    });
  });

  it("NON-VERSIONABLE (std:0, a present-but-unusable field): commits, and is classified apart from a missing field", async () => {
    const { store, writes } = capturingStore({ receipt: true });

    const result = await commitDirectAnswer(
      composed(),
      { ...META, graph: STD_ZERO_GRAPH },
      store
    );

    // The turn must survive: this graph is deliberately persisted verbatim.
    expect(result.performed).toBe(true);
    expect(writes[0]!.modelVersion).toBeUndefined();

    // Distinct reason — the two non-conformance populations stay countable.
    const events = versionEvents();
    expect(events).toHaveLength(1);
    expect(events[0]![1]).toMatchObject({
      status: "skipped",
      skip_reason: "graph_incompatible_with_graph_v3",
    });
  });

  it("stays SILENT for the DESIGNED no-version outcomes (a skip event must mean a fault)", async () => {
    // Identical graph in and out: the policy answers `no_op`, so no version is
    // due and nothing is broken. An event here would make the alarm worthless.
    const { store, writes } = capturingStore();
    await commitDirectAnswer(
      composed(),
      { ...META, graph: GRAPH, baseGraphForInvariants: structuredClone(GRAPH) },
      store
    );

    expect(writes[0]!.modelVersion).toBeUndefined();
    expect(versionEvents()).toHaveLength(0);
  });
});
