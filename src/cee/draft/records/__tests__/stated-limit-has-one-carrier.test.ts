/**
 * ⭐⭐ ONE USER LIMIT, ONE CARRIER — the interlock that has to exist BEFORE the
 * projector's bound row is carried out of the adapter.
 *
 * ── WHAT WAS MEASURED, AND WHY THIS FILE IS NOT A FIX ─────────────────────
 * The premise this lane was dispatched on — *"the draft does not reliably
 * create a node for the limit's subject"* — was tested against every banked
 * corpus of REAL staging drafts in this repo and did not survive:
 *
 *   · `unified-pipeline/stages/repair/__tests__/fixtures/`
 *     `staging-budget-brief-node-sets-2026-08-30.json` — **10 captures, of
 *     which 9 are genuine drafts of that budget brief**; the 10th (`4fd953`)
 *     is a 4-node CRM/sales-adoption graph mis-filed in the corpus. Across the
 *     9: a node naming the limit's subject is present in **9 of 9**, and the
 *     limit is still recorded correctly in **0** of them.
 *   · `transforms/__tests__/fixtures/sendable-variance-draws-2026-08-19.json`
 *     — 3 draws: the `Burn Rate` subject node is present in **3 of 3**.
 *
 * So the subject node is not the missing thing. TWO binders compete for the
 * user's limit, and the one that cannot be wrong is the one that is thrown
 * away:
 *
 *   (1) THE PROJECTOR'S, by INTEGER INDEX (`applies_to_stated` /
 *       `applies_to_claim`). Structurally incapable of naming a record that
 *       does not exist. It lands in `RecordProjection.goalConstraints` — a
 *       SIBLING of `.graph`, and `anthropic.ts` copies only `.graph`, so it
 *       reaches no consumer. `ProjectedGraph` has no `goal_constraints` field.
 *   (2) `runCompoundGoals`' brief-text extractor, which binds by STRING
 *       against node ids. It is the only one a user ever sees.
 *
 * ── THE HAZARD THIS FILE EXISTS TO CATCH ──────────────────────────────────
 * `parse.ts:895` already assigns `ctx.llmGoalConstraints = draftResult
 * .goal_constraints`, and `compound-goals.ts:370` already merges it. The whole
 * consumer chain is live. So the carrier looks like a one-line change — and
 * MEASURED, that one line is not safe on its own:
 *
 *   without the carrier → 1 row, on the CONSTRAINT node (value 0.04
 *                         `fraction`) — the node that is the limit's TEXT
 *   with    the carrier → 2 rows, on TWO different nodes, at TWO different
 *                         scales (0.04 `fraction` and 4 `%`), for ONE limit
 *                         the user stated once
 *
 * The merge dedupes on `node_id::operator`, and the two rows disagree on
 * exactly `node_id` — so nothing joins them. Paul's binding rule is to NAME
 * THE CANONICAL OWNER AND SUPERSEDE THE COMPETING LOGIC, never to add a
 * parallel rule; carrying (1) while (2) still speaks is the parallel rule.
 *
 * ── ⛔⛔ TWO OPPOSITE HARMS MAY NOT SHARE ONE BOUND (trap 22b) ─────────────
 * The first version of this file asserted `<= 1`. That guards only the INVENT
 * direction — two rows for one limit — and **it is satisfied by ZERO**. An
 * independent review proved it by execution: suppress the string-matched row
 * while the carrier is still absent at either discard hop, and the user's
 * stated limit leaves the graph entirely (`wire_row_count = 0`) while this
 * file stayed GREEN. Strictly worse than today, and silent.
 *
 * Not a hypothetical class — THIS repo's measured prior failure. CEE #888
 * suppressed too widely and dropped **13 of 14 legitimate ceilings** under a
 * green suite. And DROP is the direction the eventual fix will fail in,
 * because every candidate fix here is a SUPERSEDE.
 *
 * So the bound is `toBe(1)`: never two, and never none.
 *
 * ── WHAT THE INVARIANT BELOW IS, AND WHY IT IS SHAPED THIS WAY ────────────
 * It is deliberately NOT "the carrier has not landed". An assertion of that
 * shape is satisfied by DELETING it, so the lane that lands the carrier would
 * take the hazard check out with the gap check. The invariant is instead a
 * property of the END STATE that is true today, stays true once the carrier
 * lands CORRECTLY, and is false for exactly the naive version:
 *
 *   THE NUMBER A USER STATED ONCE AS A LIMIT IS RECORDED AGAINST EXACTLY ONE
 *   NODE.
 *
 * ⚠ WHAT IT DELIBERATELY DOES NOT ASSERT, stated rather than glossed. Today's
 * single row is bound to the WRONG node — a `constraint`/`risk` node outside
 * `MINTABLE_TARGET_KINDS` (`{outcome, factor}`) which carries no observed
 * value, so the analysis cannot evaluate it. That is a real, separate defect
 * and it is REPORTED, not pinned here: pinning it would ship a red suite for a
 * fix this lane is not making. This file's job is to stop the repair for it
 * making things worse.
 */
import { describe, it, expect, vi } from "vitest";

import { projectDraftRecords } from "../seam.js";
import { runCompoundGoals } from "../../../unified-pipeline/stages/repair/compound-goals.js";

const h = vi.hoisted(() => ({ payload: { text: "" }, bodies: [] as unknown[] }));

vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      stream: (body: Record<string, unknown>) => {
        h.bodies.push(body);
        const payload = h.payload.text;
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
    };
  }
  return { default: MockAnthropic };
});

/** The brief the whole estate has used for this defect since #1469. */
const BRIEF =
  "Should we invest in onboarding or in win-back campaigns? " +
  "We need to grow net revenue while keeping monthly churn under 4%.";

/**
 * The model's OWN name for the bounded quantity. It shares no usable token
 * with the user's phrase "monthly churn" — that mismatch is the entire reason
 * the index reference exists, and it is why every assertion below binds to
 * THIS LABEL's node id rather than to "the node carrying a 4" (trap 19).
 */
const SUBJECT_LABEL = "Subscriber Churn Rate";
/** The user's own words. The constraint node's label IS this string. */
const LIMIT_QUOTE = "keeping monthly churn under 4%";
/** What the user typed, once. */
const STATED_PERCENT = 4;

const RECORDS = {
  stated_items: [
    { kind: "goal", source_quote: "grow net revenue", role: "target" },
    { kind: "option", source_quote: "invest in onboarding" },
    { kind: "option", source_quote: "invest in win-back campaigns" },
    {
      kind: "constraint",
      source_quote: LIMIT_QUOTE,
      value: STATED_PERCENT,
      unit: "%",
      direction: "ceiling",
      // The model says WHAT IT LIMITS, by index into `claims`.
      applies_to_claim: 0,
    },
  ],
  claims: [
    { claim_kind: "factor", label: SUBJECT_LABEL, category: "controllable" },
    { claim_kind: "causal_link", label: "onboarding lowers churn", from_stated: 1, to_claim: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "win-back lowers churn", from_stated: 2, to_claim: 0, effect: "negative" },
    { claim_kind: "causal_link", label: "churn erodes revenue", from_claim: 0, to_stated: 0, effect: "negative" },
    // ⚠ LOAD-BEARING: without this the connectivity prune withdraws the
    // constraint node in every arm, the arms agree, and the file measures the
    // prune instead of the carrier.
    { claim_kind: "causal_link", label: "the churn limit bears on revenue", from_stated: 3, to_stated: 0, effect: "negative" },
  ],
};

interface Projectedish {
  readonly graph: { nodes: Array<{ id: string; kind: string; label: string }>; edges: unknown[] };
  readonly goalConstraints: ReadonlyArray<Record<string, unknown>>;
}

function project(): Projectedish {
  const seam = projectDraftRecords(RECORDS as never, BRIEF) as unknown as
    { ok: boolean; reason?: string; projection: Projectedish };
  expect(seam.ok, `the record set did not project: ${seam.reason ?? "unknown"}`).toBe(true);
  return seam.projection;
}

/** The subject's minted id, located by its EXACT label — never by kind, never by value. */
function subjectIdOf(projection: Projectedish): string {
  const matches = projection.graph.nodes.filter((n) => n.label === SUBJECT_LABEL);
  expect(matches, `no node labelled "${SUBJECT_LABEL}" — the fixture stopped reproducing its own precondition`)
    .toHaveLength(1);
  return matches[0]!.id;
}

/**
 * Every row that records THE USER'S ONE LIMIT, found by the two axes that
 * survive both producers' normalisations: the quote the user wrote, and the
 * magnitude they wrote it with. The extractor stores 0.04 `fraction` and the
 * projector stores 4 `%`, so a value-only predicate would match neither
 * reliably and a unit-only one would match both wrongly.
 */
function rowsForTheStatedLimit(rows: ReadonlyArray<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.filter((r) => {
    const quote = typeof r.source_quote === "string" ? r.source_quote : "";
    const carriesTheQuote = quote.includes(LIMIT_QUOTE);
    const v = typeof r.value === "number" ? r.value : Number.NaN;
    const carriesTheMagnitude = v === STATED_PERCENT || v === STATED_PERCENT / 100;
    return carriesTheQuote && carriesTheMagnitude;
  });
}

/** Runs the ONE stage a user's limit actually reaches, over a real projection. */
function wireAfterCompoundGoals(
  projection: Projectedish,
  llmGoalConstraints: unknown,
): Array<Record<string, unknown>> {
  const ctx = {
    requestId: "stated-limit-one-carrier",
    effectiveBrief: BRIEF,
    graph: {
      nodes: projection.graph.nodes.map((n) => ({ ...n })),
      edges: (projection.graph.edges as Array<Record<string, unknown>>).map((e) => ({ ...e })),
    },
    llmGoalConstraints,
    goalConstraints: undefined as unknown,
    directionUnresolved: undefined as unknown,
  } as never as Parameters<typeof runCompoundGoals>[0];
  runCompoundGoals(ctx);
  return ((ctx as unknown as { goalConstraints?: Array<Record<string, unknown>> }).goalConstraints ?? []);
}

describe("a stated limit has ONE carrier", () => {
  /**
   * The positive control for everything below. If the projector ever stops
   * binding the limit to the subject, "at most one row" would start passing
   * for the wrong reason — there would be nothing to duplicate.
   */
  it("the projector binds the user's limit to the SUBJECT node, by node identity", () => {
    const projection = project();
    const subjectId = subjectIdOf(projection);

    expect(projection.goalConstraints).toHaveLength(1);
    const row = projection.goalConstraints[0]!;
    expect(row.node_id, "the bound row must name the SUBJECT, not the limit's own node").toBe(subjectId);
    expect(row.value).toBe(STATED_PERCENT);
    expect(row.unit).toBe("%");
    expect(row.operator).toBe("<=");
    expect(row.source_quote).toBe(LIMIT_QUOTE);

    // And the node it names is a kind a limit may legally be recorded against.
    const subject = projection.graph.nodes.find((n) => n.id === subjectId)!;
    expect(subject.kind).toBe("factor");
  });

  /**
   * ⭐⭐ THE INTERLOCK.
   *
   * True today (one row, wrongly targeted). True once the carrier lands with a
   * supersede (one row, correctly targeted). FALSE for the naive carrier, which
   * is the only version anyone would write without this file.
   */
  it("INTERLOCK — the number the user stated once is recorded against EXACTLY ONE node", async () => {
    const prior: Record<string, string | undefined> = {};
    for (const k of ["ANTHROPIC_API_KEY", "CEE_ANTHROPIC_STRUCTURED_OUTPUTS"]) prior[k] = process.env[k];
    process.env.ANTHROPIC_API_KEY = "sk-ant-test-one-carrier";
    process.env.CEE_ANTHROPIC_STRUCTURED_OUTPUTS = "true";
    const { _resetConfigCache } = await import("../../../../config/index.js");
    _resetConfigCache();
    try {
      const { AnthropicAdapter } = await import("../../../../adapters/llm/anthropic.js");
      h.payload.text = JSON.stringify(RECORDS);
      const result = (await new AnthropicAdapter("claude-sonnet-4-6").draftGraph(
        { brief: BRIEF, docs: [], seed: 1 } as never,
        { requestId: "stated-limit-one-carrier", timeoutMs: 120_000, forceDefault: true } as never,
      )) as unknown as { graph: Projectedish["graph"]; goal_constraints?: Array<Record<string, unknown>> };

      // PRECONDITION, pinned in-test (trap 13b): the subject node reached the
      // adapter's own output. Without this, "at most one row" could pass on a
      // graph that lost the subject, which is a different world entirely.
      expect(
        result.graph.nodes.filter((n) => n.label === SUBJECT_LABEL),
        "the subject node did not reach the adapter's returned graph",
      ).toHaveLength(1);

      // What `parse.ts:895` will put on `ctx.llmGoalConstraints` — whatever the
      // adapter chooses to hand it, today or after the carrier lands.
      const asParseWouldSee = result.goal_constraints;

      // ⭐ THE WIRE IS BUILT FROM THE ADAPTER'S OWN GRAPH, not a second
      // projection. `parse.ts` carries THIS object downstream; building the
      // graph from one source while taking the rows from another leaves the two
      // free to disagree about node ids for reasons that are the fixture's
      // rather than the code's.
      const wire = wireAfterCompoundGoals(
        { graph: result.graph, goalConstraints: [] },
        asParseWouldSee,
      );
      const wireNodeIds = new Set(result.graph.nodes.map((n) => n.id));

      // ⭐⭐ S1 — THE PRECONDITION THE RED DEPENDS ON, PINNED RATHER THAN
      // ASSUMED (trap 13b). `compound-goals.ts:370` SILENTLY drops any carried
      // row whose `node_id` is not a node on the graph (`existingNodeIds`), so
      // a carrier landing with a divergent id produces EXACTLY the same visible
      // outcome as no carrier at all — measured: `llm_skipped: 1`, suite green.
      // Without this, the interlock's discrimination would be luck of id
      // agreement rather than a property of the code.
      const projectorRow = project().goalConstraints[0]!;
      expect(
        wireNodeIds.has(String(projectorRow.node_id)),
        `the projector binds to ${String(projectorRow.node_id)}, which is not a node on the graph ` +
          "the wire is built from — a correctly-built carrier could not be seen here at all",
      ).toBe(true);

      const forTheUsersLimit = rowsForTheStatedLimit(wire);
      expect(
        forTheUsersLimit.length,
        `one stated limit produced ${forTheUsersLimit.length} rows: ` +
          JSON.stringify(forTheUsersLimit.map((r) => ({ node_id: r.node_id, value: r.value, unit: r.unit }))) +
          " — carrying the projector's bound row WITHOUT superseding the string-matched one records the " +
          "same user limit twice, on two nodes, at two scales; suppressing WITHOUT carrying removes it " +
          "from the graph altogether. EXACTLY one — never two, never none.",
      ).toBe(1);

      // ⭐ S1(b) — NOTHING THE ADAPTER CARRIES FOR THIS LIMIT MAY BE DROPPED IN
      // SILENCE. Scoped to rows describing the USER'S limit: an unrelated row
      // failing the existence filter is not this file's business, and scoping
      // it is what keeps the M2 control honest.
      //
      // ⚠ It iterates an EMPTY list today, by construction — the adapter
      // carries nothing. That is NOT the unreachable-line defect the previous
      // version of this file was pulled up for: that line sat after an
      // assertion which aborts, so it could never run in any world. This one
      // becomes live in exactly the world the file exists to guard, and it is
      // the only assertion here that catches a carrier landing with a divergent
      // id.
      for (const carried of rowsForTheStatedLimit(asParseWouldSee ?? [])) {
        expect(
          wireNodeIds.has(String(carried.node_id)),
          `a carried row for the user's limit names ${String(carried.node_id)}, which is not on the ` +
            "graph — `compound-goals.ts` will drop it in silence and the limit will read as uncarried",
        ).toBe(true);
      }
    } finally {
      for (const [k, v] of Object.entries(prior)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      const { _resetConfigCache: reset } = await import("../../../../config/index.js");
      reset();
    }
  });
});
