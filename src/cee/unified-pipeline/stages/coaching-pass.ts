/**
 * Stage 4.5: Post-draft coaching pass (v12 — 2026-07-23, lean-draft contract, ROADMAP 1.197)
 *
 * The lean draft call (v12) emits STRUCTURE ONLY — `coaching` and
 * `causal_claims` are removed from the draft grammar because they are ~30% of
 * draft output tokens and the two most prose-heavy / most-runaway-prone
 * surfaces, and no compute consumer reads them. This stage RE-PRODUCES them
 * from the already-drafted (and repaired) structure in a SEPARATE, bounded LLM
 * call, then attaches them to `ctx` so the existing Stage-5 (Package) narrow +
 * validate path emits them on the response envelope exactly as before. The UI
 * (their only consumer) therefore sees the same response shape.
 *
 * DESIGN INVARIANTS (why this is safe):
 *  - STRICTLY NON-FATAL. Any failure/timeout/parse-error leaves `ctx.coaching`
 *    untouched (undefined), so Stage 5 emits its canonical-empty coaching block
 *    — identical to a draft whose LLM produced no coaching. The structural
 *    graph is IDENTICAL with or without this pass; the draft NEVER fails
 *    because of it.
 *  - BUDGET-GATED. Skipped when the remaining request budget cannot fit another
 *    LLM call (mirrors the parse-stage retry budget gate), and its own timeout
 *    is capped to the remaining window — it can never push a draft past the
 *    request budget / browser-proxy deadline.
 *  - IDEMPOTENT ON THE FALLBACK PATH. On the rare structured-outputs prompt-only
 *    fallback the draft may already carry coaching (the served prompt still
 *    describes it there); this pass then no-ops rather than overwriting it.
 *
 * Runs AFTER Stage 4 (Repair) so coaching references the FINAL structure, and
 * BEFORE Stage 5 (Package), which reads `ctx.coaching` / `ctx.causalClaims`.
 */

import type { StageContext } from "../types.js";
import { log } from "../../../utils/telemetry.js";
import { extractJson } from "../../../utils/json-extractor.js";
import { normaliseLegacyCoachingValues } from "../../../adapters/llm/normalise-legacy-coaching.js";
import {
  DRAFT_REQUEST_BUDGET_MS,
  LLM_POST_PROCESSING_HEADROOM_MS,
} from "../../../config/timeouts.js";

// Bounded so the pass cannot itself run away or blow the request budget. The
// coaching payload is small (b2b anatomy: coaching ~529 tok + causal ~209 tok),
// so 2500 is comfortable headroom without inviting a prose runaway.
const COACHING_PASS_MAX_TOKENS = 2_500;
// Skip if less than this remains — a coaching call that cannot FINISH inside the
// request budget only adds latency to a response Stage 5 emits canonical-empty
// anyway, and eats the budget the draft retry loop needs.
//
// DERIVED (Lane C2, 2026-07-23) from the coaching pass's own measured completion
// time: n=40 live successful captures (wave1 + lanec builds), `coaching_pass_ms`
// = min 19.0s / mean 21.6s / median 20.8s / MAX 26.0s. The pass needs its FULL
// duration to produce coaching; started with less it times out having produced
// nothing (→ canonical-empty regardless) while burning ~20s of latency. So the
// floor is the pass's worst-case completion time + a small provider margin:
// 26.0s + ~2s = 28s. The prior 20s floor sat BELOW the mean (21.6s) and the max
// (26.0s), so a pass launched at that floor timed out a large fraction of the
// time — wasted latency, zero coaching, and margin pressure on the 120s deadline.
// At 28s, a pass that STARTS will (barring provider tail) COMPLETE; otherwise it
// SKIPS cleanly → the drafted graph returns ~20s sooner with canonical-empty
// coaching + a coaching_status='skipped_budget' marker. Because the skip fires
// only when draft(+validation) elapsed > ~82s (110s − 28s), it triggers ONLY on
// heavy-retry turns — normal ~30-48s drafts keep their coaching.
const COACHING_PASS_MIN_BUDGET_MS = 28_000;
// Own timeout ceiling; capped to the remaining window below.
const COACHING_PASS_TIMEOUT_MS = 30_000;

const COACHING_SYSTEM = [
  "You are a decision-analysis coach. You are given a decision brief and the",
  "causal decision graph that was drafted from it (nodes + edges). Produce",
  "concise coaching that helps the user strengthen their decision, plus the",
  "explicit causal claims the graph encodes. Do NOT restate the graph. Do NOT",
  "invent nodes that are not in the graph.",
  "",
  "Return ONLY a single JSON object (no prose, no markdown fences) with this shape:",
  "{",
  '  "coaching": {',
  '    "summary": string | null,                // 1-2 sentence orientation, or null',
  '    "strengthen_items": [                     // 0-4 items, most impactful first',
  "      {",
  '        "id": string,                         // short slug, e.g. "add-status-quo"',
  '        "label": string,                      // short imperative title',
  '        "detail": string,                     // one sentence of why/how',
  '        "action_type": string,                // one of: add_option, add_factor, add_constraint, add_edge, clarify_goal, quantify',
  '        "bias_category": string               // optional, e.g. anchoring, overconfidence, availability',
  "      }",
  "    ],",
  '    "widening_log": {',
  '      "elements_added": [],                   // node ids you would add (may be empty)',
  '      "elements_considered_but_excluded": [], // brief reasons (may be empty)',
  '      "brief_completeness": "complete" | "partial" | "thin"',
  "    },",
  '    "bias_signals": [                          // 0-3, may be empty',
  '      { "type": string, "detail": string, "target": string }',
  "    ]",
  "  },",
  '  "causal_claims": [                           // 0-8 claims present in the graph, may be empty',
  '    { "type": "direct", "from": string, "to": string, "stated_strength": "weak" | "moderate" | "strong" }',
  "  ]",
  "}",
  "",
  "Keep it terse. Every strengthen_item MUST carry an action_type from the list.",
  "Use only node ids that appear in the provided graph.",
].join("\n");

function buildCoachingUserMessage(brief: string, graph: unknown): string {
  const g = graph as { nodes?: unknown[]; edges?: unknown[] };
  // Project a MINIMAL structural view (id/kind/label + edge from/to) so the
  // coaching call is cheap and the model coaches on structure, not prose.
  const nodes = Array.isArray(g?.nodes)
    ? g.nodes.map((n) => {
        const node = n as { id?: unknown; kind?: unknown; label?: unknown };
        return { id: node.id, kind: node.kind, label: node.label };
      })
    : [];
  const edges = Array.isArray(g?.edges)
    ? g.edges.map((e) => {
        const edge = e as { from?: unknown; to?: unknown };
        return { from: edge.from, to: edge.to };
      })
    : [];
  return [
    "BRIEF:",
    brief,
    "",
    "GRAPH (structure only):",
    JSON.stringify({ nodes, edges }),
  ].join("\n");
}

export async function runStageCoachingPass(ctx: StageContext): Promise<void> {
  // Idempotent on the fallback path: if the draft already produced coaching
  // (rare structured-outputs prompt-only fallback), keep it and skip.
  if (ctx.coaching !== undefined && ctx.coaching !== null) {
    return;
  }
  if (!ctx.draftAdapter || typeof ctx.draftAdapter.chat !== "function") {
    return;
  }
  if (!ctx.graph || !Array.isArray((ctx.graph as any).nodes)) {
    return;
  }

  // ── Budget gate (mirrors parse.ts retry-budget discipline) ────────────────
  const requestStartMs = ctx.opts.requestStartMs ?? ctx.start;
  const elapsed = Date.now() - requestStartMs;
  const remaining = DRAFT_REQUEST_BUDGET_MS - elapsed - LLM_POST_PROCESSING_HEADROOM_MS;
  if (remaining < COACHING_PASS_MIN_BUDGET_MS) {
    // PROBE- + INGEST-READABLE MARKER: record the budget-skip on the pipeline
    // outcome, which rides to the response body as `_pipeline_outcome.
    // coaching_status`. This is the channel A2's async coaching-ingest lane and
    // the acceptance probes read (they cannot see Render logs). The final
    // pipeline `coaching_status = 'complete'` assignments (index.ts) preserve
    // this marker rather than clobbering it. Distinct from a pass that ran and
    // errored ('failed_degraded') — a budget-skip means "not attempted", so the
    // async lane knows to fill it. (pipelineOutcome is initialised at pipeline
    // start and typed non-optional on StageContext.)
    ctx.pipelineOutcome.coaching_status = "skipped_budget";
    // OBSERVABILITY HONESTY: structured pino LOG (Render-log searchable,
    // event:cee.coaching_pass.skipped_budget), alongside the response marker.
    log.warn(
      {
        event: "cee.coaching_pass.skipped_budget",
        remaining_ms: remaining,
        min_budget_ms: COACHING_PASS_MIN_BUDGET_MS,
        request_id: ctx.requestId,
      },
      "Post-draft coaching pass skipped — remaining request budget cannot fit the pass to completion (coaching canonical-empty; draft unaffected, returns sooner)",
    );
    return;
  }
  const timeoutMs = Math.min(COACHING_PASS_TIMEOUT_MS, remaining);

  const startTime = Date.now();
  try {
    const result = await ctx.draftAdapter.chat(
      {
        system: COACHING_SYSTEM,
        userMessage: buildCoachingUserMessage(ctx.effectiveBrief, ctx.graph),
        temperature: 0,
        maxTokens: COACHING_PASS_MAX_TOKENS,
      },
      {
        requestId: `coaching_${Date.now()}`,
        timeoutMs,
        signal: ctx.opts.signal,
      },
    );

    const parsed = extractJson(result.content) as
      | { coaching?: unknown; causal_claims?: unknown }
      | undefined;
    if (!parsed || typeof parsed !== "object") {
      log.warn(
        { event: "cee.coaching_pass.no_json", request_id: ctx.requestId },
        "Post-draft coaching pass returned no parseable JSON — coaching stays canonical-empty",
      );
      return;
    }

    let attached = false;
    if (parsed.coaching !== undefined && parsed.coaching !== null) {
      // Run the SAME legacy-value normalisation the draft ingress path applies
      // (mutates in place; safe when shape-invalid), then hand the raw object
      // to Stage 5, whose narrowCoachingForResponse + sanitise path validates
      // it exactly as it did the draft-produced coaching.
      const wrapper = { coaching: parsed.coaching };
      normaliseLegacyCoachingValues(wrapper, ctx.requestId);
      ctx.coaching = wrapper.coaching;
      attached = true;
    }
    if (Array.isArray(parsed.causal_claims)) {
      // Stage 5 validates causal_claims item-wise (validateCausalClaims), so an
      // imperfect claim is dropped, never shipped.
      ctx.causalClaims = parsed.causal_claims;
      attached = true;
    }

    log.info(
      {
        event: "cee.coaching_pass.completed",
        attached,
        model: result.model,
        elapsed_ms: Date.now() - startTime,
        completion_tokens: result.usage?.output_tokens,
        request_id: ctx.requestId,
      },
      attached
        ? "Post-draft coaching pass produced coaching/causal_claims"
        : "Post-draft coaching pass returned JSON without usable coaching — canonical-empty",
    );
  } catch (error) {
    // STRICTLY NON-FATAL: never let a coaching failure break an otherwise-valid
    // draft. Leave ctx.coaching undefined → Stage 5 emits canonical-empty.
    const err = error instanceof Error ? error : new Error(String(error));
    log.warn(
      {
        event: "cee.coaching_pass.failed",
        error_name: err.name,
        elapsed_ms: Date.now() - startTime,
        request_id: ctx.requestId,
      },
      "Post-draft coaching pass failed (non-fatal) — coaching will be canonical-empty; draft is unaffected",
    );
  }
}
