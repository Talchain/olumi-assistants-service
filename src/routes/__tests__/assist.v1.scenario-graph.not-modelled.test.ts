/**
 * ROADMAP 2.973 — THE NOT-MODELLED MANIFEST ON THE COLD-READ SEAM.
 *
 * The cold read (`POST /assist/v1/scenarios/:id/graph`, reached by the UI as
 * `/bff/cee/scenarios/:id/graph`) already returns the verbatim `brief_text` and
 * the canonical graph. The 2026-08-08 context-integrity trace measured that
 * nothing reads the brief, and that the user is never told what of it failed to
 * reach the model. This suite pins the manifest that tells them.
 *
 * ── WHAT IS PINNED HERE, AND WHY EACH ONE IS LOAD-BEARING ──────────────────
 *
 *  1. THE MANIFEST IS ON THE WIRE AT ALL. Without this the whole capability is
 *     a module nobody can reach — the estate's most-repeated defect (built, not
 *     plugged in). Asserted on the RESPONSE BYTES, not on the derivation.
 *
 *  2. "WE DID NOT LOOK" MUST NOT RENDER AS "NOTHING WAS DROPPED". This is the
 *     one that matters. When the brief is absent the manifest reports
 *     `status: "unavailable"` with `quantities: null` — NOT a zero tally. A
 *     zeroed tally on a scenario we know nothing about would be a new lie, and
 *     a more damaging one than the silence it replaces, because it carries the
 *     authority of a measurement. Both absent-input cases are pinned, and the
 *     `quantities === null` assertion is the discriminator: an implementation
 *     that returned `{total: 0, absent: 0}` passes every OTHER assertion here.
 *
 *  3. THE UNTRACKED CLASSES TRAVEL WITH IT, ALWAYS — including on the
 *     unavailable path. The manifest's honesty depends on the consumer knowing
 *     the list is partial by construction; a payload that carried the findings
 *     without the caveat would read as exhaustive.
 *
 *  4. THE DERIVATION RUNS ON THE BYTES BEING RETURNED. Pinned by driving two
 *     different graphs through the same brief and requiring the verdict to
 *     MOVE. A manifest computed from anything other than the response's own
 *     graph — a cache, a draft-time snapshot, a constant — cannot do that, and
 *     would start lying the moment the user edited the model.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";

const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";

// `vi.hoisted` + a SPREAD of the real config: a `vi.mock` factory REPLACES the
// module, so a hand-listed stub silently drops every config key added since it
// was written (CLAUDE.md trap 12). Same shape as the sibling suite.
const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  mockConfig.value = {
    ...actual.config,
    auth: { ...actual.config.auth, requireUserJwt: false },
  };
  return { ...actual, config: mockConfig.value };
});

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const scenarioExists = vi.fn();
const loadGraphAndBriefText = vi.fn();
const ensureScenarioExists = vi.fn();
const getScenarioOwner = vi.fn();
const store = { scenarioExists, loadGraphAndBriefText, ensureScenarioExists, getScenarioOwner };
vi.mock("../../orchestrator-v5/session/index.js", () => ({ getSessionStore: () => store }));

import scenarioGraphRoute from "../assist.v1.scenario-graph.js";

const BRIEF =
  "We need £4m out of opex by March 2027. Marketing is capped at £1.5m and the " +
  "board quoted €250k for the licence.";

/** Carries £4m (as an expanded cap) and £1.5m (as a mantissa with a £m unit) —
 *  the two representations a real draft produces. Carries neither March 2027
 *  nor €250k. */
const GRAPH_WITH_TWO_KEPT = {
  nodes: [
    { id: "out_savings", label: "Opex savings", cap: 4000000, unit: "£" },
    { id: "fac_marketing", label: "Marketing spend", cap: 1.5, unit: "£m" },
  ],
  edges: [],
  options: [],
};

/** Same brief, a model that kept NOTHING. Used as the moving half of pin (4). */
const GRAPH_WITH_NONE_KEPT = {
  nodes: [{ id: "fac_generic", label: "Cost pressure", prior: { lo: 0.2, hi: 0.8 } }],
  edges: [],
  options: [],
};

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
  return app;
}

async function read(app: FastifyInstance, scenarioId: string = SCENARIO) {
  return await app.inject({
    method: "POST",
    url: `/assist/v1/scenarios/${scenarioId}/graph`,
    payload: {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  scenarioExists.mockResolvedValue(true);
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  getScenarioOwner.mockResolvedValue(null);
  loadGraphAndBriefText.mockResolvedValue({
    graph: GRAPH_WITH_TWO_KEPT,
    briefText: BRIEF,
  });
});

describe("THE MANIFEST IS ON THE WIRE — pin (1)", () => {
  it("returns a not_modelled.v1 manifest on the cold read", async () => {
    const app = await buildApp();
    const body = (await read(app)).json();

    expect(body.not_modelled).toBeDefined();
    expect(body.not_modelled.schema).toBe("not_modelled.v1");
    expect(body.not_modelled.status).toBe("derived");
    await app.close();
  });

  it("reports each stated quantity by IDENTITY — literal plus its offset in the brief", async () => {
    // Bound by identity, never by a value predicate another item could satisfy
    // (trap 19). `char_offset` is what lets the UI point at the user's own
    // words; an item without it is unaddressable.
    const app = await buildApp();
    const body = (await read(app)).json();

    const items: Array<{ literal: string; char_offset: number; verdict: string }> =
      body.not_modelled.quantities.items;

    const euro = items.find((i) => i.char_offset === BRIEF.indexOf("€250k"));
    expect(euro).toBeDefined();
    expect(euro?.literal).toBe("€250k");
    expect(euro?.verdict).toBe("absent");

    const cap = items.find((i) => i.char_offset === BRIEF.indexOf("£1.5m"));
    expect(cap?.literal).toBe("£1.5m");
    expect(cap?.verdict).toBe("in_model");
  });
});

describe('"WE DID NOT LOOK" MUST NOT RENDER AS "NOTHING WAS DROPPED" — pin (2)', () => {
  it("reports quantities as NULL, not a zero tally, when there is no brief", async () => {
    loadGraphAndBriefText.mockResolvedValue({ graph: GRAPH_WITH_TWO_KEPT, briefText: null });

    const app = await buildApp();
    const m = (await read(app)).json().not_modelled;

    expect(m.status).toBe("unavailable");
    expect(m.unavailable_reason).toBe("no_brief_text");
    // THE DISCRIMINATOR. An implementation reporting {total:0, absent:0} would
    // satisfy every other assertion in this file while telling the user their
    // brief survived intact.
    expect(m.quantities).toBeNull();
    await app.close();
  });

  it("reports quantities as NULL when there is no graph", async () => {
    loadGraphAndBriefText.mockResolvedValue({ graph: null, briefText: BRIEF });

    const app = await buildApp();
    const m = (await read(app)).json().not_modelled;

    expect(m.status).toBe("unavailable");
    expect(m.unavailable_reason).toBe("no_graph");
    expect(m.quantities).toBeNull();
    await app.close();
  });
});

describe("THE UNTRACKED CLASSES TRAVEL WITH IT — pin (3)", () => {
  it("names what the derivation cannot see, on the derived path", async () => {
    const app = await buildApp();
    const m = (await read(app)).json().not_modelled;

    expect(m.not_tracked).toContain("competing_or_dissenting_proposals");
    expect(m.not_tracked).toContain("corrections_and_second_thoughts");
    expect(m.not_tracked.length).toBeGreaterThan(0);
    await app.close();
  });

  it("names them on the unavailable path too — where the caveat matters most", async () => {
    loadGraphAndBriefText.mockResolvedValue({ graph: null, briefText: null });

    const app = await buildApp();
    const m = (await read(app)).json().not_modelled;

    expect(m.status).toBe("unavailable");
    expect(m.not_tracked).toContain("competing_or_dissenting_proposals");
    await app.close();
  });
});

describe("THE DERIVATION RUNS ON THE BYTES BEING RETURNED — pin (4)", () => {
  it("moves its verdict when the graph moves under an identical brief", async () => {
    // The precondition is pinned IN-TEST: the two graphs must genuinely differ
    // on this brief, or the assertion below passes by testing nothing (trap 13b
    // — a guard agreeing with itself).
    const app = await buildApp();
    const kept = (await read(app)).json().not_modelled.quantities;

    loadGraphAndBriefText.mockResolvedValue({
      graph: GRAPH_WITH_NONE_KEPT,
      briefText: BRIEF,
    });
    const none = (await read(app)).json().not_modelled.quantities;

    expect(kept.total).toBe(none.total); // same brief ⇒ same quantities found
    expect(kept.in_model).toBeGreaterThan(0); // precondition: the first graph DID keep some
    expect(none.in_model).toBe(0); // and the second kept none
    expect(none.absent).toBe(none.total);
    await app.close();
  });
});
