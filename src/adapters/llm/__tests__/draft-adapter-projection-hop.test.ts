/**
 * ⭐⭐ THE HOP NOBODY TESTED: `AnthropicAdapter.draftGraph`'s RETURN PROJECTION.
 *
 * ── THE GAP THIS FILE CLOSES ───────────────────────────────────────────────
 * `AnthropicAdapter.draftGraph` (`anthropic.ts`) does not return the direct
 * function's result. It returns an EXPLICIT OBJECT LITERAL naming six keys:
 * `graph`, `rationales`, `usage`, and conditional spreads of `coaching`,
 * `debug`, `meta`. Anything `draftGraphWithAnthropic` produces under any other
 * name is discarded there, silently, and `DraftGraphResult` cannot catch it —
 * every one of those fields is `?: unknown`, so a narrowed literal typechecks.
 *
 * `record_disclosures` is such a field, and it is the one that mattered: built
 * unconditionally inside the direct function from `activeProjection.dropped` +
 * `optionFraming.unresolved`, declared on `DraftGraphResult` as
 * "Carried adapter → parse → package → V3 boundary", read at
 * `unified-pipeline/stages/parse.ts` into `ctx.recordDisclosures`, and consumed
 * there by `optionFramingRecovery` and later by `package.ts`
 * (`optionFramingWarnings`, and the `record_disclosures` wire key itself).
 *
 * **It never arrived.** The projection dropped it one hop before its reader.
 *
 * ── WHY NO EXISTING TEST SAW IT ────────────────────────────────────────────
 * The estate had a guard at each END of the hop and none ACROSS it:
 *   · `cee/draft/records/__tests__/r1-disclosure-carrier.e2e.test.ts` drives
 *     `draftGraphWithAnthropic` — the DIRECT function, i.e. the producer, one
 *     level BELOW the projection;
 *   · `unified-pipeline/stages/__tests__/record-disclosures-parse-hop.test.ts`
 *     drives `runStageParse` against a `vi.fn()` adapter returning a
 *     HAND-BUILT `draftResult` — i.e. the consumer, fed a payload that asserts
 *     the projection's output rather than measuring it.
 * Producer green, consumer green, the seam between them unobserved for seven
 * months. A hand-built fixture standing in for a real producer is the shape
 * this file exists to forbid: **the adapter below is REAL, and the only thing
 * mocked is the Anthropic HTTP client.**
 *
 * ── SCOPE, STATED SO NOTHING HERE IS OVER-READ ─────────────────────────────
 * Three sibling fields named on `DraftGraphResult` are ALSO absent from the
 * projection and are DELIBERATELY NOT restored. They are not being dropped —
 * they are not produced on this path, and RESTORING THEM WOULD SHIP AN EMPTY
 * CARRIER. `R2` below pins that derivation so it fails loud if it ever stops
 * being true:
 *   · `topology_plan`  — deleted from the draft grammar unconditionally
 *     (`cee/draft/anthropic-graph-schema.ts` v11); top-level
 *     `additionalProperties: false` makes the key UNEMITTABLE, not merely
 *     unrequired.
 *   · `causal_claims`  — removed from the draft grammar with `coaching` in v12
 *     (lean-draft contract, ROADMAP 1.197); re-produced by the post-draft
 *     coaching pass, never by this adapter.
 *   · `goal_constraints` — the draft call emits a RECORD SET
 *     (`cee/draft/records/grammar.ts`), which declares no `goal_*` field at
 *     all, AND a second hop kills it regardless: `anthropic.ts` replaces
 *     `rawJson` with `{ ...activeProjection.graph }` BEFORE the response is
 *     parsed, and `records/projector.ts` builds that graph as an explicit
 *     literal of `version` / `default_seed` / `nodes` / `edges` / `meta`. The
 *     `...(parsed as any).goal_constraints` spread inside the direct function
 *     is therefore ALREADY dead on the Anthropic path — restoring it here
 *     would repair nothing and would read as a repair, which is worse.
 *
 * RUNG: this file is a UNIT+STAGE witness of the adapter→parse hop. It is not
 * a wire witness and not a journey witness.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { projectDraftRecords } from "../../../cee/draft/records/seam.js";
import type { StageContext } from "../../../cee/unified-pipeline/types.js";

const h = vi.hoisted(() => ({
  payload: "",
  completionPayload: JSON.stringify({ claims: [] }),
  adapter: null as unknown as {
    draftGraph: (args: unknown, opts: unknown) => Promise<Record<string, unknown>>;
    name: string;
    model: string;
  },
}));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      stream: () => {
        const payload = h.payload;
        return {
          async *[Symbol.asyncIterator]() {
            yield { type: "content_block_delta", delta: { type: "text_delta", text: payload } };
          },
          async finalMessage() {
            return {
              content: [{ type: "text", text: payload }],
              usage: { input_tokens: 100, output_tokens: 50 },
              stop_reason: "end_turn",
            };
          },
        };
      },
      create: async () => ({
        content: [{ type: "text", text: h.completionPayload }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: "end_turn",
      }),
    };
  }
  return { default: MockAnthropic };
});

// `importOriginal`-spread rather than a hand-listed replacement module: the
// router carries exports other modules in this graph import, and a factory that
// REPLACES the module would drop them silently (the estate's dominant defect).
// Only the one function `parse.ts` calls is overridden, and it hands back the
// REAL adapter constructed in `beforeAll`.
vi.mock("../router.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../router.js")>()),
  getAdapterWithResolution: () => ({
    adapter: h.adapter,
    resolution: {
      task: "draft_graph",
      resolved_model: "claude-sonnet-5",
      resolution_source: "default",
      provider: "anthropic",
    },
  }),
}));

/**
 * A brief whose constraint DIRECTION the model omits. The projector refuses to
 * guess `<=` — which would have been the opposite constraint — and records the
 * refusal. Deliberately the same shape the producer-side e2e uses, so the two
 * files are measuring one behaviour at two depths rather than two behaviours.
 */
const BRIEF =
  "We need to protect runway. Cash must stay above 1000 pounds. We can expand or hold.";

const RECORDS = {
  stated_items: [
    { kind: "goal", source_quote: "protect runway" },
    { kind: "option", source_quote: "expand" },
    { kind: "option", source_quote: "hold" },
    // No `direction` — grammar-admitted, and the reason a disclosure exists.
    { kind: "constraint", source_quote: "Cash must stay above 1000 pounds", value: 1000 },
  ],
  claims: [
    { claim_kind: "factor", label: "Cash use", basis: [0] },
    { claim_kind: "causal_link", label: "expand changes cash use", from_stated: 1, to_claim: 0, sets_to: 0.8 },
    { claim_kind: "causal_link", label: "hold changes cash use", from_stated: 2, to_claim: 0, sets_to: 0.4 },
    { claim_kind: "causal_link", label: "Cash use affects runway", from_claim: 0, to_stated: 0 },
    { claim_kind: "causal_link", label: "Cash floor protects runway", from_stated: 3, to_stated: 0 },
  ],
};

/**
 * A record set the projector accepts with NOTHING refused. It is what proves
 * the fix is ADDITIVE: where the field is absent the adapter must not mint the
 * key. Its emptiness is asserted, not assumed — see `R3`.
 */
const CLEAN_RECORDS = {
  stated_items: [
    { kind: "goal", source_quote: "grow revenue" },
    { kind: "option", source_quote: "launch now" },
    { kind: "option", source_quote: "wait a quarter" },
  ],
  claims: [
    { claim_kind: "factor", label: "Marketing spend", basis: [0] },
    { claim_kind: "causal_link", label: "launch now changes marketing spend", from_stated: 1, to_claim: 0, sets_to: 0.7 },
    { claim_kind: "causal_link", label: "wait a quarter changes marketing spend", from_stated: 2, to_claim: 0, sets_to: 0.3 },
    { claim_kind: "causal_link", label: "Marketing spend affects revenue", from_claim: 0, to_stated: 0 },
  ],
};

const CLEAN_BRIEF =
  "We want to grow revenue. Marketing spend is the lever. We can launch now or wait a quarter.";

const DRAFT_OPTS = { timeoutMs: 120_000, forceDefault: true } as const;

const prior: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const key of ["ANTHROPIC_API_KEY", "CEE_ANTHROPIC_STRUCTURED_OUTPUTS"]) {
    prior[key] = process.env[key];
  }
  process.env.ANTHROPIC_API_KEY = "sk-ant-projection-hop";
  process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = "true";
  const { _resetConfigCache } = await import("../../../config/index.js");
  _resetConfigCache();
  const { AnthropicAdapter } = await import("../anthropic.js");
  h.adapter = new AnthropicAdapter("claude-sonnet-5") as unknown as typeof h.adapter;
});

afterAll(async () => {
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const { _resetConfigCache } = await import("../../../config/index.js");
  _resetConfigCache();
});

/**
 * The precondition, PINNED IN-TEST rather than trusted. Without it every
 * assertion below could pass forever against a fixture that silently stopped
 * producing a disclosure — a guard whose discrimination depends on a fixture
 * nothing pins is a guard agreeing with itself.
 */
function assertFixtureRefusesSomething(): void {
  const seam = projectDraftRecords(RECORDS, BRIEF);
  expect(seam.ok, "fixture must project").toBe(true);
  if (!seam.ok) return;
  expect(
    seam.projection.dropped.some((d) => d.reason === "constraint_direction_unstated"),
    "PRECONDITION: the fixture must make the projector refuse at least one thing",
  ).toBe(true);
}

describe("AnthropicAdapter.draftGraph return projection", () => {
  it("R1 carries record_disclosures across the adapter hop, not only out of the direct function", async () => {
    assertFixtureRefusesSomething();

    h.payload = JSON.stringify(RECORDS);
    const result = (await h.adapter.draftGraph(
      { brief: BRIEF, docs: [], seed: 17 },
      DRAFT_OPTS,
    )) as Record<string, unknown>;

    // Bound by IDENTITY — the exact reason and the exact label the projector
    // refused — never by "some array is non-empty", which another field could
    // satisfy.
    const carried = result.record_disclosures;
    expect(
      Array.isArray(carried),
      "the ADAPTER must carry the disclosures out; the direct function already did",
    ).toBe(true);
    const reasons = (carried as Array<{ reason: string }>).map((d) => d.reason);
    expect(reasons).toContain("constraint_direction_unstated");
    const direction = (carried as Array<{ reason: string; label?: string }>).find(
      (d) => d.reason === "constraint_direction_unstated",
    );
    expect(direction?.label).toBe("Cash must stay above 1000 pounds");
  });

  it("R2 does NOT mint the three sibling fields that this path cannot produce", async () => {
    h.payload = JSON.stringify(RECORDS);
    const result = (await h.adapter.draftGraph(
      { brief: BRIEF, docs: [], seed: 17 },
      DRAFT_OPTS,
    )) as Record<string, unknown>;

    // ⭐ THE DISCRIMINATION. These absences are asserted in the SAME run that
    // proves the probe can see a PRESENT sibling, so a vacuous pass — an
    // adapter that returned nothing at all — cannot produce this result.
    expect(
      Array.isArray(result.record_disclosures),
      "CONTRAST CONTROL: a genuinely carried field must be visible here, or the absences below prove nothing",
    ).toBe(true);

    // If any of these ever starts arriving, the derivation that justified
    // leaving it out has changed and must be re-done BEFORE a carrier is added.
    expect(result.goal_constraints, "goal_constraints: killed upstream by the record projection").toBeUndefined();
    expect(result.causal_claims, "causal_claims: removed from the draft grammar (v12)").toBeUndefined();
    expect(result.topology_plan, "topology_plan: removed from the draft grammar (v11)").toBeUndefined();
  });

  it("R3 adds no record_disclosures key when the projector refused nothing", async () => {
    // The precondition for THIS case is the mirror of R1's, and is equally
    // pinned: the clean fixture must genuinely produce an empty refusal set.
    const seam = projectDraftRecords(CLEAN_RECORDS, CLEAN_BRIEF);
    expect(seam.ok, "clean fixture must project").toBe(true);
    if (!seam.ok) return;
    expect(
      seam.projection.dropped.length,
      "PRECONDITION: the clean fixture must refuse nothing, or this case is vacuous",
    ).toBe(0);

    h.payload = JSON.stringify(CLEAN_RECORDS);
    const result = (await h.adapter.draftGraph(
      { brief: CLEAN_BRIEF, docs: [], seed: 17 },
      DRAFT_OPTS,
    )) as Record<string, unknown>;

    expect(result.graph, "the draft itself must still succeed").toBeDefined();
    expect(
      Object.prototype.hasOwnProperty.call(result, "record_disclosures"),
      "ADDITIVE ONLY: absent stays absent — no empty array is invented",
    ).toBe(false);
  });
});

describe("adapter → parse stage", () => {
  it("R4 the real adapter's disclosures land on ctx.recordDisclosures, parse.ts's reader", async () => {
    assertFixtureRefusesSomething();

    h.payload = JSON.stringify(RECORDS);
    const { runStageParse } = await import("../../../cee/unified-pipeline/stages/parse.js");

    const ctx = {
      requestId: "adapter-projection-hop",
      input: { brief: BRIEF },
      effectiveBrief: BRIEF,
      rawBody: {},
      opts: { requestStartMs: Date.now(), signal: undefined, forceDefault: true },
      earlyReturn: undefined,
      collector: undefined,
      transforms: [],
      pipelineOutcome: { warnings: [] },
      pipelineCheckpoints: [],
      riskCoefficientCorrections: [],
    } as unknown as StageContext;

    await runStageParse(ctx);

    // `ctx.recordDisclosures` is assigned BEFORE the stage's graph-shape early
    // return, so this assertion is valid whether or not the stage bailed later
    // — and it is the exact property `package.ts` reads.
    const stashed = (ctx as unknown as { recordDisclosures?: unknown }).recordDisclosures;
    expect(
      Array.isArray(stashed),
      "the disclosures must survive the adapter hop AND the parse destructure",
    ).toBe(true);
    expect((stashed as Array<{ reason: string }>).map((d) => d.reason)).toContain(
      "constraint_direction_unstated",
    );
  });
});
