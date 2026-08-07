/**
 * ROADMAP 2.725 — MOUNT-PATH coverage for the route-egress doctrine scan.
 *
 * ## Why this file exists (adversarial review of PR #849, finding F2)
 *
 * The scanner module (`src/services/doctrine/route-egress-doctrine-scan.ts`) had a
 * thorough unit spec and a 16-mutant kit, and the producers had a fail-loud doctrine
 * spec — but **nothing exercised the two CALL SITES**. Deleting both mounts
 * (`assist.v1.review.ts` and `assist.v1.isl-synthesis.ts`) left the entire suite
 * green: every instrument agreed with every other and none of them touched the seam
 * the change exists to add (CLAUDE.md trap 3b in its general form).
 *
 * So these tests drive the REAL route through `app.inject`, capture the REAL logger,
 * and assert the emitted event. Three binding rules are deliberate:
 *
 * 1. **Bound by IDENTITY, never by a predicate another path could satisfy**
 *    (trap 19). The assertion pins the exact `event` name, the exact `route` literal
 *    — which is the mount path itself, so moving a call site to another route fails
 *    loud — the exact dotted `path` of the offending leaf, and the exact matched
 *    `term`. It further pins `request_id` to the `X-CEE-Request-ID` header of THIS
 *    response, so the log line cannot be satisfied by some other request's event.
 *
 * 2. **The precondition is pinned IN-TEST** (trap 13b, third face). Before asserting
 *    the warning, each test asserts that the response leaf really carries the planted
 *    banned term. Without that, a producer change that stopped carrying the string
 *    would silently reduce this test to a non-discriminating shape — green, and
 *    proving nothing.
 *
 * 3. **Each route gets a CLEAN-PAYLOAD control.** A test that only ever sees the
 *    event cannot tell "the mount fired" from "something always fires".
 *
 * The proof obligation is the deletion mutant, and it is a DISCRIMINATING PAIR:
 * deleting the `/assist/v1/isl-synthesis` call site must RED the isl-synthesis test
 * and leave the review test GREEN, and vice versa. A single biting mutant proves
 * sensitivity to something; the pair proves sensitivity to the named mount.
 *
 * Both planted strings are USER-AUTHORED fields (a VoI research note, an option
 * label), which is the realistic shape of a hit and the reason the scanner is
 * detection-only rather than rewriting (see the scanner module header).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";

vi.stubEnv("LLM_PROVIDER", "fixtures");
// One key per test group: the routes are rate-limited per key.
vi.stubEnv(
  "ASSIST_API_KEYS",
  "doctrine-mount-isl,doctrine-mount-isl-clean,doctrine-mount-review,doctrine-mount-review-clean",
);

vi.mock("../../src/services/validateClient.js", () => ({
  validateGraph: vi.fn().mockResolvedValue({ ok: true, violations: [], normalized: undefined }),
}));

import { build } from "../../src/server.js";
import { log } from "../../src/utils/telemetry.js";

/** The exact event name the two mounts emit. Not a substring match. */
const DOCTRINE_EVENT = "cee.route_egress.doctrine_hit";

interface DoctrineLogPayload {
  event: string;
  route: string;
  request_id: string;
  hit_count: number;
  hits: Array<{ path: string; term: string }>;
}

/**
 * Sort hits by dotted path so the assertion pins the exact SET of offending
 * leaves without also pinning the response object's key-insertion order.
 */
const byPath = (hits: DoctrineLogPayload["hits"]): DoctrineLogPayload["hits"] =>
  [...hits].sort((a, b) => a.path.localeCompare(b.path));

describe("route-egress doctrine scan — MOUNT coverage (ROADMAP 2.725 / review F2)", () => {
  let app: FastifyInstance;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  /**
   * Every `cee.route_egress.doctrine_hit` payload emitted since the last reset.
   * Filtered by the exact event name — the routes' request lifecycle emits other
   * `log.warn` lines (cache warming, auth), and a test that counted all warnings
   * would pass on the wrong object.
   */
  const doctrineEvents = (): DoctrineLogPayload[] =>
    warnSpy.mock.calls
      // `ReturnType<typeof vi.spyOn>` (unparameterised) resolves `mock.calls` to
      // `any`, so these two callbacks had no contextual type and tripped
      // `noImplicitAny` in the FULL typecheck (tsconfig.json), which
      // `tsconfig.build.json` excludes tests from and therefore cannot see.
      // Annotating here keeps the narrowing below honest — `unknown` forces the
      // type predicate to do the work rather than inheriting `any`.
      .map((call: unknown[]) => call[0])
      .filter(
        (arg: unknown): arg is DoctrineLogPayload =>
          typeof arg === "object" &&
          arg !== null &&
          (arg as { event?: unknown }).event === DOCTRINE_EVENT,
      );

  beforeAll(async () => {
    app = await build();
    await app.ready();
  });

  afterAll(async () => {
    warnSpy?.mockRestore();
    await app.close();
  });

  beforeEach(() => {
    warnSpy?.mockRestore();
    warnSpy = vi.spyOn(log, "warn");
  });

  // ===========================================================================
  // /assist/v1/isl-synthesis
  // ===========================================================================

  describe("POST /assist/v1/isl-synthesis", () => {
    /**
     * `voi[].recommended_research` is echoed verbatim into `voi_narrative`
     * (assist.v1.isl-synthesis.ts, VoI branch), so this is a user-authored string
     * reaching a 200 body — exactly what the scanner is mounted to observe.
     */
    const plantedPayload = {
      goal_label: "Maximise revenue",
      recommendation_label: "Raise price",
      voi: [
        {
          factor_id: "f_churn",
          factor_label: "Churn Rate",
          voi: 12000,
          recommended_research: "Commission the recommended churn survey.",
        },
      ],
    };

    it("emits cee.route_egress.doctrine_hit naming this mount, this leaf and this request", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/isl-synthesis",
        headers: { "X-Olumi-Assist-Key": "doctrine-mount-isl" },
        payload: plantedPayload,
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as { voi_narrative?: string };

      // PRECONDITION PIN — if the producer ever stops carrying the planted term,
      // this fails here rather than silently becoming a test that proves nothing.
      expect(body.voi_narrative).toContain("the recommended churn survey");

      const events = doctrineEvents();
      expect(events).toHaveLength(1);

      const payload = events[0];
      expect(payload.route).toBe("/assist/v1/isl-synthesis");
      // Binds the event to THIS request, not to any doctrine hit anywhere.
      expect(payload.request_id).toBe(res.headers["x-cee-request-id"]);
      expect(payload.hit_count).toBe(1);
      expect(byPath(payload.hits)).toEqual([{ path: "voi_narrative", term: "recommended" }]);
    });

    it("emits NO doctrine event for a clean 200 on the same mount", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/isl-synthesis",
        headers: { "X-Olumi-Assist-Key": "doctrine-mount-isl-clean" },
        payload: {
          goal_label: "Maximise revenue",
          recommendation_label: "Raise price",
          voi: [
            {
              factor_id: "f_churn",
              factor_label: "Churn Rate",
              voi: 12000,
              recommended_research: "Commission a churn survey.",
            },
          ],
        },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).voi_narrative).toContain("Commission a churn survey.");
      expect(doctrineEvents()).toEqual([]);
    });
  });

  // ===========================================================================
  // /assist/v1/review
  // ===========================================================================

  describe("POST /assist/v1/review", () => {
    const graph = {
      nodes: [
        { id: "g1", kind: "goal", label: "Maximise Revenue" },
        { id: "d1", kind: "decision", label: "Pricing Strategy" },
        { id: "o1", kind: "option", label: "Premium Pricing" },
        { id: "o2", kind: "option", label: "Economy Pricing" },
        { id: "f1", kind: "factor", label: "Market Size" },
      ],
      edges: [
        { from: "d1", to: "o1" },
        { from: "d1", to: "o2" },
        { from: "o1", to: "g1", weight: 0.8 },
        { from: "o2", to: "g1", weight: 0.6 },
        { from: "f1", to: "g1", weight: 0.7 },
      ],
    };

    /**
     * `robustness_data.recommended_option.label` is a user-authored option label and
     * is echoed verbatim into three leaves of the 200 body — `robustness_synthesis.
     * headline`, `rationale.summary` and `rationale.goal_alignment` (set derived by
     * execution, not assumed). A user whose option is literally named "The
     * recommended tier" is the exact case the scanner module header cites as the
     * reason this surface DETECTS rather than REWRITES.
     */
    it("emits cee.route_egress.doctrine_hit naming this mount, this leaf and this request", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": "doctrine-mount-review" },
        payload: {
          graph,
          brief: "Should we raise the subscription price?",
          robustness_data: {
            recommendation_stability: 0.87,
            recommended_option: { id: "o1", label: "The recommended tier" },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      const body = JSON.parse(res.body) as {
        robustness_synthesis?: { headline?: string };
      };

      // PRECONDITION PIN — see the isl-synthesis case.
      expect(body.robustness_synthesis?.headline).toContain("The recommended tier");

      const events = doctrineEvents();
      expect(events).toHaveLength(1);

      const payload = events[0];
      expect(payload.route).toBe("/assist/v1/review");
      expect(payload.request_id).toBe(res.headers["x-cee-request-id"]);
      // The label reaches three distinct leaves. Pinning the EXACT set (not a
      // count, and not "contains one of them") is what makes a producer that
      // starts or stops carrying it into a fourth leaf fail loud here.
      expect(payload.hit_count).toBe(3);
      expect(byPath(payload.hits)).toEqual([
        { path: "rationale.goal_alignment", term: "recommended" },
        { path: "rationale.summary", term: "recommended" },
        { path: "robustness_synthesis.headline", term: "recommended" },
      ]);
    });

    it("emits NO doctrine event for a clean 200 on the same mount", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/assist/v1/review",
        headers: { "X-Olumi-Assist-Key": "doctrine-mount-review-clean" },
        payload: {
          graph,
          brief: "Should we raise the subscription price?",
          robustness_data: {
            recommendation_stability: 0.87,
            recommended_option: { id: "o1", label: "Premium Pricing" },
          },
        },
      });

      expect(res.statusCode).toBe(200);
      expect(JSON.parse(res.body).robustness_synthesis?.headline).toContain("Premium Pricing");
      expect(doctrineEvents()).toEqual([]);
    });
  });
});
