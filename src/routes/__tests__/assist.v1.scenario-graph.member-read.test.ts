/**
 * ACCOUNTS "Invite a colleague to this decision" (DL #85 5947426886; lease 5947474393): a VIEWER MEMBER may READ the
 * graph (and its Run) through THIS route, and nowhere else.
 *
 * Runs the REAL route through Fastify with the suite's store double; membership is the store port
 * `isScenarioMember` (production: the service_role SQL `is_scenario_member`, applied by the DL, md5-verified).
 * Rows bind by identity: exact call arguments, exact refusal bytes, presence/absence of the conversation key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";
const OWNER = "0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b";
const MEMBER = "9e8d7c6b-5a49-4382-b716-0c5d4e3f2a1b";

const { mockConfig } = vi.hoisted(() => ({ mockConfig: { value: null as unknown } }));
vi.mock("../../config/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../config/index.js")>();
  mockConfig.value = { ...actual.config, auth: { ...actual.config.auth, requireUserJwt: false } };
  return { ...actual, config: mockConfig.value };
});
vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const readExistingScenario = vi.fn();
const isScenarioMember = vi.fn();
const readRecent = vi.fn();
const ensureScenarioExists = vi.fn();
const store = {
  readMostRecentPendingActions: async () => [],
  readExistingScenario,
  isScenarioMember,
  readRecent,
  ensureScenarioExists,
  scenarioExists: vi.fn(),
  loadGraphAndBriefText: vi.fn(),
  getScenarioOwner: vi.fn(),
};
vi.mock("../../orchestrator-v5/session/index.js", () => ({ getSessionStore: () => store }));

const { resolveUserIdentity } = vi.hoisted(() => ({ resolveUserIdentity: vi.fn() }));
vi.mock("../../orchestrator/user-identity.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity };
});

import scenarioGraphRoute, { CONVERSATION_ROWS_READ } from "../assist.v1.scenario-graph.js";

const GRAPH = {
  nodes: [
    { id: "n1", label: "Hire", category: "option" },
    { id: "n2", label: "Runway", category: "factor" },
  ],
  edges: [{ from: "n1", to: "n2", weight: 0.4 }],
  options: [{ id: "n1", label: "Hire" }],
};
const ownedRow = () => ({ userId: OWNER, graph: GRAPH, briefText: "Should we hire?", analysisInvalidatedAt: null });

let app: FastifyInstance;
async function read(body: Record<string, unknown> = {}) {
  return await app.inject({ method: "POST", url: `/assist/v1/scenarios/${SCENARIO}/graph`, payload: body });
}
const strip = (r: { json: () => Record<string, unknown> }) => ({ ...r.json(), request_id: undefined });
const as = (userId: string | null) =>
  resolveUserIdentity.mockResolvedValue(userId === null ? { mode: "off" } : { mode: "verified", userId });

beforeEach(async () => {
  vi.clearAllMocks();
  readExistingScenario.mockResolvedValue(ownedRow());
  isScenarioMember.mockResolvedValue(false);
  readRecent.mockResolvedValue([]);
  app = Fastify();
  await scenarioGraphRoute(app);
  await app.ready();
});
afterEach(async () => { await app.close(); });

describe("a viewer member reads the graph through the graph-read route", () => {
  it("a MEMBER (verified, membership true) gets the graph; membership is asked exactly once with (scenario, verified sub)", async () => {
    as(MEMBER);
    isScenarioMember.mockResolvedValue(true);
    const res = await read();
    expect(res.statusCode).toBe(200);
    expect(res.json().graph).toEqual(GRAPH);
    expect(isScenarioMember.mock.calls).toEqual([[SCENARIO, MEMBER]]);
    expect(ensureScenarioExists).not.toHaveBeenCalled();
  });

  it("a NON-member gets the SAME 404 bytes as an absent scenario", async () => {
    as(MEMBER);
    const notMember = await read();
    readExistingScenario.mockResolvedValue(null);
    const absent = await read();
    expect(notMember.statusCode).toBe(404);
    expect(absent.statusCode).toBe(404);
    expect(strip(notMember)).toEqual(strip(absent));
  });

  it("a membership read that FAILS is the same 404 bytes (fail closed, no existence oracle), never 503", async () => {
    as(MEMBER);
    isScenarioMember.mockRejectedValue(new Error("db down"));
    const failed = await read();
    readExistingScenario.mockResolvedValue(null);
    const absent = await read();
    expect(failed.statusCode).toBe(404);
    expect(strip(failed)).toEqual(strip(absent));
  });

  it("the OWNER and a GUEST row read without ever asking membership", async () => {
    as(OWNER);
    expect((await read()).statusCode).toBe(200);
    readExistingScenario.mockResolvedValue({ ...ownedRow(), userId: null });
    as(MEMBER);
    expect((await read()).statusCode).toBe(200);
    expect(isScenarioMember).not.toHaveBeenCalled();
  });

  it("an UNVERIFIED caller on an owned row is refused and membership is never asked", async () => {
    as(null);
    isScenarioMember.mockResolvedValue(true);
    expect((await read()).statusCode).toBe(404);
    expect(isScenarioMember).not.toHaveBeenCalled();
  });

  it("a member gets the model and the Run, NEVER the owner's conversation; the owner's same request does get it", async () => {
    readRecent.mockResolvedValue([]);
    as(MEMBER);
    isScenarioMember.mockResolvedValue(true);
    const member = await read({ include_conversation_turns: true });
    expect(member.statusCode).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(member.json(), "conversation_turns")).toBe(false);
    // The conversation reader's OWN call is (scenario, CONVERSATION_ROWS_READ); other parts of the read use readRecent too.
    const conversationReads = () => readRecent.mock.calls.filter((c) => c[0] === SCENARIO && c[1] === CONVERSATION_ROWS_READ).length;
    expect(conversationReads()).toBe(0);
    as(OWNER);
    const owner = await read({ include_conversation_turns: true });
    expect(owner.statusCode).toBe(200);
    expect(Object.prototype.hasOwnProperty.call(owner.json(), "conversation_turns")).toBe(true);
    expect(conversationReads()).toBe(1);
  });
});

describe("the member grant reaches NO other door", () => {
  // Every source file outside the store layer that names the grant. Only the graph-read route may.
  const root = join(__dirname, "..", "..");
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) { if (name !== "__tests__" && name !== "node_modules") walk(p); }
      else if (/\.ts$/.test(name)) files.push(p);
    }
  };
  walk(root);
  const naming = files.filter((p) => /isScenarioMember|is_scenario_member/.test(readFileSync(p, "utf8")));
  const rel = naming.map((p) => p.slice(root.length + 1)).sort();

  it("POSITIVE CONTROL: the scan sees the source tree (and the route that uses the grant)", () => {
    expect(files.length).toBeGreaterThan(500);
    expect(rel).toContain("routes/assist.v1.scenario-graph.ts");
  });

  it("only the graph-read route and the store layer name it: no turn, register, versions, save, stop or Run path", () => {
    expect(rel).toEqual([
      "orchestrator-v5/session/store.ts",
      "orchestrator-v5/session/supabase-store.ts",
      "routes/assist.v1.scenario-graph.ts",
    ]);
  });
});
