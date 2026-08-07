/**
 * ROADMAP 2.236 — Stop-route AUTHORIZATION (Codex audit C finding C-1).
 *
 * THE DEFECT, re-verified at the bytes on staging tip `6421985c`:
 * `POST /proxy/v5/turn/stop` is PUBLIC by the auth plugin's prefix rule
 * (`/proxy/v5/turn` + every subpath) and `recordExplicitTurnStop` read NO
 * identity of any kind. It checked scenario-id SYNTAX and scenario EXISTENCE
 * and stopped there. The only other defences were a forgeable `Origin`
 * allowlist and a 30/min per-IP limit — neither is authority.
 *
 * ⚠ THE DAMAGE IS NOT A NUISANCE TOMBSTONE. `v5_turn_fence.generation` is a
 *   BIGSERIAL and `v5_mark_turn_stopped` UPSERTS, so a caller-INVENTED
 *   `turn_id` INSERTS a row at a HIGHER generation than every in-flight turn on
 *   that scenario. A legitimate graph-bearing turn admitted at generation G
 *   then reaches its commit, reads max = G+1, raises `OLTF2` and LOSES ITS
 *   GRAPH WRITE. `THE HARM CASE` below pins exactly that, end to end, with a
 *   positive control that proves the harness can SEE the harm before asserting
 *   its absence (CLAUDE.md trap 13).
 *
 * WHAT IS PINNED HERE, and why each one is load-bearing:
 *   · every negative case answers the SAME BYTES — a refusal that named its
 *     reason would rebuild the state oracle the pre-fix 200 body was;
 *   · the OWNER's Stop still works, on both the guest and the owned path, so
 *     the fix cannot pass by refusing everything (the positive control);
 *   · the fail-OPEN branches still fail open — a DB blip must not cost a
 *     legitimate user their Stop.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { FastifyRequest } from "fastify";
import Fastify, { type FastifyInstance } from "fastify";

const STAGING_ORIGIN = "https://staging--olumi.netlify.app";
const SCENARIO = "a6ccf5cf-aab0-4f01-b889-e0d6c072067c";
const TURN = "dcfc3b50-03b0-4b74-bc56-6dd0ce1531d7";
const ATTACKER_TURN = "11111111-2222-3333-4444-555555555555";
const OWNER = "0f8a1b2c-3d4e-4f50-9a6b-7c8d9e0f1a2b";
const OTHER_USER = "9e8d7c6b-5a49-4382-b716-0c5d4e3f2a1b";

const mockConfig = {
  proxy: {
    browserProxyEnabled: true,
    browserProxyAllowedOrigins: STAGING_ORIGIN,
    browserProxyTimeoutMs: 5_000,
  },
  auth: { assistApiKey: "test-assist-key", requireUserJwt: false },
};
vi.mock("../../config/index.js", () => ({ config: mockConfig }));

vi.mock("../../utils/telemetry.js", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
  emit: vi.fn(),
  TelemetryEvents: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

const verifySupabaseUserJwt = vi.fn();
vi.mock("../../utils/supabase-user-jwt.js", () => ({
  // Shape-only: a JWT is three dot-separated segments. The real predicate is
  // not what this suite is about; the VERIFIER is mocked so identity can be
  // driven deterministically.
  looksLikeJwt: (t: string) => t.split(".").length === 3,
  verifySupabaseUserJwt: (...args: unknown[]) => verifySupabaseUserJwt(...args),
}));

// ── The store double ────────────────────────────────────────────────────────
// `ensureScenarioExists` is what the SHARED ownership pre-flight reads, so the
// REAL `preflightEnsureScenario` logic runs in every test below rather than a
// stubbed verdict. That is the point: the fix reuses that function, so the
// suite must exercise it.
const markTurnStopped = vi.fn();
const scenarioExists = vi.fn();
const turnFenceRowExists = vi.fn();
const ensureScenarioExists = vi.fn();
let storeMethods = {
  markTurnStopped: true,
  scenarioExists: true,
  turnFenceRowExists: true,
};
vi.mock("../../orchestrator-v5/session/index.js", () => ({
  getSessionStore: () => ({
    ensureScenarioExists,
    ...(storeMethods.markTurnStopped ? { markTurnStopped } : {}),
    ...(storeMethods.scenarioExists ? { scenarioExists } : {}),
    ...(storeMethods.turnFenceRowExists ? { turnFenceRowExists } : {}),
  }),
}));

const { recordExplicitTurnStop, MAX_TURN_ID_LENGTH } = await import("../turn-stop.js");
const { proxyV5TurnRoute } = await import("../proxy-v5-turn.js");
const { classifyTurnFence } = await import(
  "../../orchestrator-v5/session/turn-fence.js"
);

/** A minimal request: the handler reads only `body` and `headers`. */
function req(body: unknown, headers: Record<string, string> = {}): FastifyRequest {
  return { body, headers } as unknown as FastifyRequest;
}

beforeEach(() => {
  markTurnStopped.mockReset();
  markTurnStopped.mockResolvedValue({
    stopped: true,
    claimed: true,
    alreadyCommitted: false,
  });
  scenarioExists.mockReset();
  scenarioExists.mockResolvedValue(true);
  turnFenceRowExists.mockReset();
  turnFenceRowExists.mockResolvedValue(true);
  ensureScenarioExists.mockReset();
  // Default = GUEST scenario. This is the staging-representative case: measured
  // 2026-08-01, ALL 727 `v5_turn_fence` rows, all 171 fenced scenarios and all
  // 12 recorded Stops on staging are on scenarios with `user_id IS NULL`.
  ensureScenarioExists.mockResolvedValue({ user_id: null });
  verifySupabaseUserJwt.mockReset();
  storeMethods = {
    markTurnStopped: true,
    scenarioExists: true,
    turnFenceRowExists: true,
  };
  mockConfig.auth.requireUserJwt = false;
});

// ════════════════════════════════════════════════════════════════════════════
// 1. THE NEGATIVE CASES — what an attacker can no longer do
// ════════════════════════════════════════════════════════════════════════════

describe("recordExplicitTurnStop — identity and scenario ownership", () => {
  // THE HEADLINE PIN. Pre-fix this answered 200 and wrote a fence row.
  it("an UNAUTHENTICATED Stop on an OWNED scenario is refused and writes NOTHING", async () => {
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }),
      "req-anon-owned",
    );
    expect(reply.status).toBe(404);
    expect(markTurnStopped).not.toHaveBeenCalled();
  });

  // The audit's exact scenario: a caller who knows the UUID and supplies a
  // GUESSED user_id is still not the owner.
  it("a Stop from a DIFFERENT user on an owned scenario is refused and writes NOTHING", async () => {
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN, user_id: OTHER_USER }),
      "req-cross-tenant",
    );
    expect(reply.status).toBe(404);
    expect(markTurnStopped).not.toHaveBeenCalled();
  });

  // ORIGIN IS NOT AUTHORITY. Driven through the REAL route so the allowlist is
  // genuinely satisfied — the request is indistinguishable from a browser's.
  it("an ALLOWED Origin without identity does not authorize a Stop on an owned scenario", async () => {
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
    const app: FastifyInstance = Fastify({ logger: false });
    await proxyV5TurnRoute(app);
    await app.ready();
    try {
      const res = await app.inject({
        method: "POST",
        url: "/proxy/v5/turn/stop",
        headers: { origin: STAGING_ORIGIN, "content-type": "application/json" },
        payload: { scenario_id: SCENARIO, turn_id: TURN },
      });
      // Not a 403: the origin check PASSED. The refusal is the authorization
      // one, which is the whole point — the two must not be conflated.
      expect(res.statusCode).toBe(404);
      expect(markTurnStopped).not.toHaveBeenCalled();
    } finally {
      await app.close();
    }
  });

  // The ownership ORACLE being down must not open the door. Fail CLOSED, and
  // it matches the turn route: when the oracle is down no turn can be admitted
  // either, so no admissible turn loses its Stop.
  it("an ownership read that THROWS fails CLOSED — the Stop is refused", async () => {
    ensureScenarioExists.mockRejectedValue(new Error("scenarios unreachable"));
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }),
      "req-oracle-down",
    );
    expect(reply.status).toBe(404);
    expect(markTurnStopped).not.toHaveBeenCalled();
  });
});

describe("recordExplicitTurnStop — the turn must have been ADMITTED", () => {
  // REFUSED, not ignored: nothing is written, so no generation is allocated.
  it("a caller-INVENTED turn_id is refused and writes NOTHING", async () => {
    turnFenceRowExists.mockResolvedValue(false);
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: ATTACKER_TURN }),
      "req-invented-turn",
    );
    expect(reply.status).toBe(404);
    expect(turnFenceRowExists).toHaveBeenCalledWith(SCENARIO, ATTACKER_TURN);
    expect(markTurnStopped).not.toHaveBeenCalled();
  });

  it("bounds the turn id length and refuses an over-long one without touching the store", async () => {
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: "x".repeat(MAX_TURN_ID_LENGTH + 1) }),
      "req-long-turn-id",
    );
    expect(reply.status).toBe(404);
    expect(scenarioExists).not.toHaveBeenCalled();
    expect(ensureScenarioExists).not.toHaveBeenCalled();
    expect(markTurnStopped).not.toHaveBeenCalled();
  });

  it("accepts a turn id AT the length bound (the boundary is not off by one)", async () => {
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: "x".repeat(MAX_TURN_ID_LENGTH) }),
      "req-boundary-turn-id",
    );
    expect(reply.status).toBe(200);
  });

  // FAIL-OPEN on a FAILED read, exactly as the scenario-existence check does:
  // a clean `false` is a fact, a throw is an unknown, and the P0 protection
  // (a legitimate Stop must land) outranks the hardening.
  it("an admitted-turn read that THROWS fails OPEN: the Stop is still recorded", async () => {
    turnFenceRowExists.mockRejectedValue(new Error("fence table unreachable"));
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }),
      "req-fence-read-blip",
    );
    expect(reply.status).toBe(200);
    expect(markTurnStopped).toHaveBeenCalledWith(SCENARIO, TURN);
  });

  // ⚠ THIS TEST IS ABOUT DOUBLES, NOT ABOUT PRODUCTION, AND ON ITS OWN IT
  //   WOULD BLESS THE DEFECT'S RETURN. Dozens of hand-rolled doubles across the
  //   repo do not implement `turnFenceRowExists`, so the handler fails OPEN when
  //   the method is absent — but on the PRODUCTION store that same absence would
  //   restore the graph-destruction defect under a fully green suite. The thing
  //   that makes this assertion safe is the prototype pin in
  //   `session/__tests__/turn-fence-guards.test.ts` ("SupabaseSessionStore has
  //   claimTurnFence and markTurnStopped"), which REDs if the method ever leaves
  //   the class. Do not read this test without that one.
  it("a store without turnFenceRowExists skips the check (fail-open) and records", async () => {
    storeMethods.turnFenceRowExists = false;
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }),
      "req-no-fence-method",
    );
    expect(reply.status).toBe(200);
    expect(markTurnStopped).toHaveBeenCalledWith(SCENARIO, TURN);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. THE RESPONSE-SHAPE PIN — "not yours" and "doesn't exist" are one answer
// ════════════════════════════════════════════════════════════════════════════

describe("recordExplicitTurnStop — every refusal is INDISTINGUISHABLE", () => {
  // The pre-fix 200 body carried `claimed` / `already_committed` for ANY
  // guessed turn id — a free oracle over another user's turn state. A refusal
  // that named its reason would rebuild that oracle one bit at a time, so the
  // five refusal paths must be byte-identical.
  it("unknown scenario, non-UUID scenario, not-your-scenario, unknown turn and over-long turn id all answer the SAME bytes", async () => {
    const RID = "req-shape";

    ensureScenarioExists.mockResolvedValue({ user_id: null });
    scenarioExists.mockResolvedValue(false);
    const unknownScenario = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }),
      RID,
    );

    scenarioExists.mockResolvedValue(true);
    const nonUuidScenario = await recordExplicitTurnStop(
      req({ scenario_id: "not-a-uuid-at-all", turn_id: TURN }),
      RID,
    );

    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
    const notYours = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }),
      RID,
    );

    ensureScenarioExists.mockResolvedValue({ user_id: null });
    turnFenceRowExists.mockResolvedValue(false);
    const unknownTurn = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: ATTACKER_TURN }),
      RID,
    );

    turnFenceRowExists.mockResolvedValue(true);
    const overLongTurn = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: "x".repeat(MAX_TURN_ID_LENGTH + 1) }),
      RID,
    );

    const all = [unknownScenario, nonUuidScenario, notYours, unknownTurn, overLongTurn];
    for (const reply of all) {
      expect(reply.status).toBe(all[0].status);
      expect(reply.body).toStrictEqual(all[0].body);
    }
    // …and the shared answer carries no state fields at all.
    expect(all[0].body).not.toHaveProperty("claimed");
    expect(all[0].body).not.toHaveProperty("already_committed");
    expect(all[0].body).not.toHaveProperty("stopped");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. THE POSITIVE CONTROL — the fix must not pass by refusing everything
// ════════════════════════════════════════════════════════════════════════════

describe("recordExplicitTurnStop — the OWNER's Stop is unchanged", () => {
  // The staging-representative path: every Stop staging has ever recorded was
  // on a GUEST scenario, where ownership is carved out by design — on both
  // rungs, identically. This is the "no regression" pin.
  it("a GUEST (unowned) scenario records the Stop exactly as before", async () => {
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }),
      "req-guest",
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({
      stopped: true,
      claimed: true,
      already_committed: false,
      scenario_id: SCENARIO,
      turn_id: TURN,
    });
    expect(markTurnStopped).toHaveBeenCalledWith(SCENARIO, TURN);
  });

  it("the OWNER of an owned scenario can stop their own admitted turn", async () => {
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN, user_id: OWNER }),
      "req-owner",
    );
    expect(reply.status).toBe(200);
    expect(markTurnStopped).toHaveBeenCalledWith(SCENARIO, TURN);
  });

  it("reports already_committed for the owner's own turn, so the UI copy still has three states", async () => {
    markTurnStopped.mockResolvedValue({
      stopped: true,
      claimed: true,
      alreadyCommitted: true,
    });
    const reply = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }),
      "req-committed",
    );
    expect(reply.status).toBe(200);
    expect(reply.body).toMatchObject({ already_committed: true });
  });

  // With CEE_REQUIRE_USER_JWT ON, identity is DERIVED from the verified `sub`
  // and the owner is authorized without supplying a body user_id.
  it("with the JWT flag ON, a VERIFIED owner can stop their own turn", async () => {
    mockConfig.auth.requireUserJwt = true;
    ensureScenarioExists.mockResolvedValue({ user_id: OWNER });
    verifySupabaseUserJwt.mockResolvedValue({ ok: true, userId: OWNER });
    const reply = await recordExplicitTurnStop(
      req(
        { scenario_id: SCENARIO, turn_id: TURN },
        { authorization: "Bearer head.payload.sig" },
      ),
      "req-jwt-owner",
    );
    expect(reply.status).toBe(200);
    expect(markTurnStopped).toHaveBeenCalledWith(SCENARIO, TURN);
  });

  // A caller who PRESENTED a token asked to be verified; a bad one is a 401
  // about the TOKEN. It is surfaced as itself ONLY because it is reached before
  // any read of server state — see the next test, which is what makes that true
  // rather than merely claimed.
  it("with the JWT flag ON, a present-but-INVALID token is refused 401 before the scenario is read", async () => {
    mockConfig.auth.requireUserJwt = true;
    verifySupabaseUserJwt.mockResolvedValue({ ok: false, reason: "invalid_token" });
    const reply = await recordExplicitTurnStop(
      req(
        { scenario_id: SCENARIO, turn_id: TURN },
        { authorization: "Bearer head.payload.sig" },
      ),
      "req-jwt-bad",
    );
    expect(reply.status).toBe(401);
    // ⭐ THE ORDERING, ASSERTED RATHER THAN NAMED. The test above was called
    //   "before the scenario is read" for a whole revision without checking it,
    //   and it was FALSE: `scenarioExists` ran first, so with a deliberately
    //   junk token an EXISTING scenario answered 401 and an ABSENT one answered
    //   404 — the refusal status was a free scenario-existence oracle for any
    //   caller, requiring no valid credential at all. A title is not a pin.
    expect(scenarioExists).not.toHaveBeenCalled();
    expect(ensureScenarioExists).not.toHaveBeenCalled();
    expect(turnFenceRowExists).not.toHaveBeenCalled();
    expect(markTurnStopped).not.toHaveBeenCalled();
  });

  // THE ORACLE ITSELF, pinned as an equivalence rather than as an ordering:
  // a bad token must get the SAME answer whether the scenario exists or not.
  it("with the JWT flag ON, a junk token answers IDENTICALLY for an existing and an absent scenario", async () => {
    mockConfig.auth.requireUserJwt = true;
    verifySupabaseUserJwt.mockResolvedValue({ ok: false, reason: "invalid_token" });
    const headers = { authorization: "Bearer head.payload.sig" };

    scenarioExists.mockResolvedValue(true);
    const onExisting = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }, headers),
      "req-oracle",
    );

    scenarioExists.mockResolvedValue(false);
    const onAbsent = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }, headers),
      "req-oracle",
    );

    // Pre-hoist these were 401 and 404 respectively.
    expect(onExisting.status).toBe(onAbsent.status);
    expect(onExisting.body).toStrictEqual(onAbsent.body);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. ⭐ THE HARM CASE, END TO END — a legitimate graph-bearing turn survives
//    a hostile Stop.
//
//    The DB half is simulated from the migration SQL rather than asserted
//    about: `v5_turn_fence` (BIGSERIAL generation, UNIQUE (scenario_id,
//    turn_id)), `v5_mark_turn_stopped`'s UPSERT (`ON CONFLICT DO UPDATE SET
//    stopped_at = COALESCE(...)`, which never touches `generation`), and the
//    `v5_evaluate_turn_fence` payload. The VERDICT is then computed by the
//    REAL production classifier, `classifyTurnFence` — so the simulated half
//    is the storage semantics only, and the decision that costs a user their
//    graph is the shipped one.
//
//    ⚠ The first test is the POSITIVE CONTROL (trap 13): it drives the
//      PRE-FIX path — the tombstone write with no checks in front of it — and
//      proves the harness REPRODUCES the harm. Without it, the second test
//      would be an absence assertion that could pass by testing nothing.
// ════════════════════════════════════════════════════════════════════════════

interface FenceRow {
  generation: number;
  scenarioId: string;
  turnId: string;
  stoppedAt: string | null;
}

/** `v5_turn_fence` + its three functions, per supabase/migrations/20260731120000. */
class FenceDb {
  private seq = 0;
  private readonly rows = new Map<string, FenceRow>();
  private readonly committed = new Set<string>();

  private key(scenarioId: string, turnId: string): string {
    return `${scenarioId} ${turnId}`;
  }

  /** v5_claim_turn_fence — INSERT … ON CONFLICT DO UPDATE (no-op) RETURNING generation. */
  claim(scenarioId: string, turnId: string): { generation: number } {
    const k = this.key(scenarioId, turnId);
    const existing = this.rows.get(k);
    if (existing) return { generation: existing.generation };
    this.seq += 1;
    this.rows.set(k, { generation: this.seq, scenarioId, turnId, stoppedAt: null });
    return { generation: this.seq };
  }

  /**
   * v5_mark_turn_stopped — UPSERT. A MISSING row INSERTs and takes a FRESH
   * generation (this is the defect's mechanism); an EXISTING row takes the
   * DO UPDATE branch, which sets only `stopped_at`.
   */
  stop(
    scenarioId: string,
    turnId: string,
  ): { stopped: boolean; claimed: boolean; alreadyCommitted: boolean } {
    const k = this.key(scenarioId, turnId);
    const existing = this.rows.get(k);
    if (existing) {
      existing.stoppedAt = existing.stoppedAt ?? "now";
    } else {
      this.seq += 1;
      this.rows.set(k, { generation: this.seq, scenarioId, turnId, stoppedAt: "now" });
    }
    return {
      stopped: true,
      claimed: existing !== undefined,
      alreadyCommitted: this.committed.has(k),
    };
  }

  rowExists(scenarioId: string, turnId: string): boolean {
    return this.rows.has(this.key(scenarioId, turnId));
  }

  /** v5_evaluate_turn_fence — the payload the commit chokepoint classifies. */
  evaluate(scenarioId: string, turnId: string): unknown {
    const mine = this.rows.get(this.key(scenarioId, turnId));
    const generations = [...this.rows.values()]
      .filter((r) => r.scenarioId === scenarioId)
      .map((r) => r.generation);
    return {
      claimed: mine !== undefined,
      stopped: mine?.stoppedAt != null,
      generation: mine?.generation ?? null,
      max_generation: generations.length > 0 ? Math.max(...generations) : null,
    };
  }
}

describe("⭐ THE HARM CASE — a hostile Stop must not cost a legitimate turn its graph write", () => {
  // POSITIVE CONTROL: the pre-fix path, which is "call the tombstone writer
  // with nothing in front of it". If this ever stops reproducing `superseded`,
  // the test below is vacuous and must not be trusted.
  it("POSITIVE CONTROL — with the pre-fix path, the hostile Stop DOES supersede the legitimate turn", () => {
    const db = new FenceDb();
    db.claim(SCENARIO, TURN); // the legitimate turn is admitted at generation 1

    db.stop(SCENARIO, ATTACKER_TURN); // pre-fix: no identity, no ownership, no admission check

    const verdict = classifyTurnFence(db.evaluate(SCENARIO, TURN));
    expect(verdict.verdict).toBe("superseded");
    expect(verdict.generation).toBe(1);
    expect(verdict.maxGeneration).toBe(2);
  });

  it("with the fix, the hostile Stop is REFUSED and the legitimate turn still commits its graph write", async () => {
    const db = new FenceDb();
    db.claim(SCENARIO, TURN); // the legitimate turn is admitted at generation 1

    // Wire the store double to the simulated database so the REAL handler
    // drives the REAL storage semantics.
    scenarioExists.mockImplementation(async () => true);
    turnFenceRowExists.mockImplementation(async (s: string, t: string) =>
      db.rowExists(s, t),
    );
    markTurnStopped.mockImplementation(async (s: string, t: string) => db.stop(s, t));

    // The attack, exactly as the audit describes it: no JWT, no knowledge of
    // the victim's turn id, an invented one instead.
    const hostile = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: ATTACKER_TURN }),
      "req-hostile-stop",
    );
    expect(hostile.status).toBe(404);
    expect(markTurnStopped).not.toHaveBeenCalled();

    // THE POINT OF THE WHOLE FIX: the legitimate turn is still current, so its
    // graph write is ALLOWED at the commit chokepoint.
    const verdict = classifyTurnFence(db.evaluate(SCENARIO, TURN));
    expect(verdict.verdict).toBe("current");
    expect(verdict.generation).toBe(1);
    expect(verdict.maxGeneration).toBe(1);
  });

  it("and the legitimate turn's OWN Stop still fences it — the feature is intact", async () => {
    const db = new FenceDb();
    db.claim(SCENARIO, TURN);
    turnFenceRowExists.mockImplementation(async (s: string, t: string) =>
      db.rowExists(s, t),
    );
    markTurnStopped.mockImplementation(async (s: string, t: string) => db.stop(s, t));

    const own = await recordExplicitTurnStop(
      req({ scenario_id: SCENARIO, turn_id: TURN }),
      "req-own-stop",
    );
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ stopped: true });

    const verdict = classifyTurnFence(db.evaluate(SCENARIO, TURN));
    expect(verdict.verdict).toBe("stopped");
    // The owner's own Stop takes the ON CONFLICT branch, so it allocates NO
    // new generation — it fences its own turn and supersedes nothing.
    expect(verdict.maxGeneration).toBe(1);
  });
});
