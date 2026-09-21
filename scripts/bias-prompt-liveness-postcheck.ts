/**
 * BIAS-SURFACE LIVENESS GATE — leg 4: served-prompt behavioural postcheck.
 *
 * Design record binding: AI-EXPERIENCE-DESIGN-DRAFT-2026-07-14.md §1.5 +
 * BIAS-COACHING-PROPOSAL-2026-07-16.md §4 leg 4. Companion legs:
 * tests/unit/cee.bias-liveness-gate.test.ts (engine + review-card) and
 * tests/unit/cee.bias-liveness-gate.pipeline.test.ts (draft wire).
 *
 * WHY BEHAVIOURAL, NOT GREP: the repo cannot see PMS-served prompt bodies.
 * Only a live check against the deployed service can catch the next
 * "nobody asked the LLM" regression (est. #15 class: schema + pipeline +
 * UI all live while the served prompt silently stops asking for
 * bias_signals). Run this ON EVERY PROMPT PROMOTION touching
 * draft_graph_default or decision_review_default (rev 3 §6), and after
 * any staging re-pin.
 *
 * Checks (each has a positive control so absence assertions are never
 * vacuous — trap-13):
 *   A. DRAFT (§1.5(1) FRAME): a fixture brief with a blatant anchor +
 *      sunk-cost framing must yield >=1 `coaching.bias_signals` entry.
 *      Positive control: the same response must carry a real graph
 *      (>=5 nodes) and a coaching block — if we cannot see the draft,
 *      we cannot claim anything about its bias signals.
 *   B. REVIEW (§1.5(3) REALITY-TEST): a fixture decision-review package
 *      built from the same biased scenario must yield >=1 `bias_findings`
 *      entry carrying the fields (`type`, `description`) that
 *      buildBiasCards requires to emit a `review_card` with
 *      `card_kind: 'bias'`. Positive control: the response must parse and
 *      carry a non-empty narrative/summary surface.
 *
 * PII: this script prints bias TYPES and COUNTS only — never the prose
 * details, node labels, or values. The scenario is fully synthetic and
 * audit-tagged.
 *
 * Usage:
 *   ASSIST_API_KEY=... npx tsx scripts/bias-prompt-liveness-postcheck.ts
 *
 * Environment:
 *   CEE_BASE_URL   — service base URL (default: https://cee-staging.onrender.com)
 *   ASSIST_API_KEY — X-Olumi-Assist-Key value (required)
 *   BIAS_POSTCHECK_AUDIT_TAG — audit tag baked into the fixture brief
 *                    (default: a1_bias_liveness_<YYYYMMDD>)
 *   BIAS_POSTCHECK_SKIP_REVIEW=1 — run the draft leg only (e.g. when the
 *                    decision_review flag is off in the target env)
 *
 * Exit code: 0 = all legs green · 1 = any leg red or unreachable.
 */

const CEE_URL = process.env.CEE_BASE_URL || process.env.CEE_STAGING_URL || "https://cee-staging.onrender.com";
const API_KEY = process.env.ASSIST_API_KEY || process.env.CEE_API_KEY || "";
const AUDIT_TAG =
  process.env.BIAS_POSTCHECK_AUDIT_TAG ||
  `a1_bias_liveness_${new Date().toISOString().slice(0, 10).replace(/-/g, "")}`;
const TIMEOUT_MS = 180_000;

if (!API_KEY) {
  console.error("ERROR: No API key. Set ASSIST_API_KEY (or CEE_API_KEY).");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fixture scenario (synthetic; blatant anchoring + sunk-cost framing)
// ---------------------------------------------------------------------------

const FIXTURE_BRIEF =
  `Audit scenario ${AUDIT_TAG}. We must decide whether to continue our ` +
  `warehouse automation rollout. We have already invested 2.1 million pounds ` +
  `and eighteen months in the current robotics vendor, so walking away now ` +
  `would waste everything we have put in. The board fixated on the 4.5 ` +
  `million pound figure from the vendor's first quote, and every plan since ` +
  `has been built around that number. Our goal is to cut order fulfilment ` +
  `cost per unit by 30 percent within two years. The only option on the ` +
  `table is to proceed with phase two of the existing vendor contract.`;

/** Minimal deterministic package for /assist/v1/decision-review. */
function buildReviewPackage(): Record<string, unknown> {
  return {
    brief: FIXTURE_BRIEF,
    brief_hash: `${AUDIT_TAG}_brief_hash`,
    graph: {
      nodes: [
        { id: "goal_liveness", kind: "goal", label: "Cut fulfilment cost per unit" },
        { id: "opt_continue", kind: "option", label: "Continue current vendor rollout" },
        { id: "fac_invested_spend", kind: "factor", label: "Capital already invested" },
        { id: "fac_vendor_quote", kind: "factor", label: "Vendor phase-two quote" },
      ],
      edges: [
        { id: "e_opt_goal", from: "opt_continue", to: "goal_liveness", weight: 0.6 },
        { id: "e_fac_opt", from: "fac_invested_spend", to: "opt_continue", weight: 0.5 },
      ],
    },
    isl_results: {
      option_comparison: [
        { option_id: "opt_continue", option_label: "Continue current vendor rollout", win_probability: 1.0, outcome_mean: 0.55 },
      ],
      factor_sensitivity: [
        { factor_id: "fac_vendor_quote", factor_label: "Vendor phase-two quote", sensitivity: 0.42 },
        { factor_id: "fac_invested_spend", factor_label: "Capital already invested", sensitivity: 0.31 },
      ],
    },
    deterministic_coaching: {
      readiness: "needs_strengthening",
      headline_type: "single_option",
      evidence_gaps: [],
      model_critiques: [
        { code: "SELECTION_LOW_OPTION_COUNT", detail: "Only one option is modelled." },
      ],
    },
    winner: { id: "opt_continue", label: "Continue current vendor rollout", win_probability: 1.0 },
    runner_up: null,
    correlation_id: `${AUDIT_TAG}_postcheck`,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface LegResult {
  name: string;
  pass: boolean;
  detail: string;
}

async function post(path: string, body: unknown): Promise<{ status: number; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${CEE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Olumi-Assist-Key": API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function summariseTypes(entries: Array<Record<string, unknown>>, key: string): string {
  return entries
    .map((e) => String(e?.[key] ?? "unknown"))
    .slice(0, 5)
    .join(",");
}

// ---------------------------------------------------------------------------
// Leg A: draft bias_signals
// ---------------------------------------------------------------------------

async function checkDraftLeg(): Promise<LegResult> {
  const started = Date.now();
  const { status, json } = await post("/assist/v1/draft-graph", { brief: FIXTURE_BRIEF });
  const elapsed = Math.round((Date.now() - started) / 1000);

  if (status !== 200 || !json) {
    return { name: "draft bias_signals", pass: false, detail: `HTTP ${status} after ${elapsed}s` };
  }

  // Positive control: we must be able to SEE a real draft before claiming
  // anything about its bias signals.
  const nodeCount = Array.isArray(json.nodes) ? json.nodes.length : 0;
  const coaching = json.coaching;
  if (nodeCount < 5 || typeof coaching !== "object" || coaching === null) {
    return {
      name: "draft bias_signals",
      pass: false,
      detail: `positive control failed: nodes=${nodeCount}, coaching=${coaching === null ? "null" : typeof coaching} (${elapsed}s)`,
    };
  }

  const signals = Array.isArray(coaching.bias_signals) ? coaching.bias_signals : [];
  const valid = signals.filter(
    (s: any) => s && typeof s.type === "string" && typeof s.detail === "string" && s.detail.length > 0,
  );
  if (valid.length < 1) {
    return {
      name: "draft bias_signals",
      pass: false,
      detail:
        `RED: served draft prompt yielded ${signals.length} bias_signals for a blatantly ` +
        `anchored + sunk-cost brief (expected >=1). The next "nobody asked the LLM" ` +
        `regression looks exactly like this. (nodes=${nodeCount}, ${elapsed}s)`,
    };
  }
  return {
    name: "draft bias_signals",
    pass: true,
    detail: `${valid.length} signal(s) [${summariseTypes(valid, "type")}], nodes=${nodeCount}, ${elapsed}s`,
  };
}

// ---------------------------------------------------------------------------
// Leg B: decision_review bias_findings → review_card 'bias' feed
// ---------------------------------------------------------------------------

async function checkReviewLeg(): Promise<LegResult> {
  const started = Date.now();
  const { status, json } = await post("/assist/v1/decision-review", buildReviewPackage());
  const elapsed = Math.round((Date.now() - started) / 1000);

  if (status !== 200 || !json) {
    return { name: "review bias_findings", pass: false, detail: `HTTP ${status} after ${elapsed}s` };
  }

  // The route returns the parsed decision_review LLM output (plus trace).
  const body = json.review ?? json.decision_review ?? json;

  // Positive control: the review must carry SOME populated narrative
  // surface before we trust an absence/presence claim about bias.
  const hasNarrative = Boolean(
    (typeof body.narrative_summary === "string" && body.narrative_summary.length > 0) ||
      (typeof body.summary === "string" && body.summary.length > 0) ||
      Array.isArray(body.key_assumptions) ||
      Array.isArray(body.readiness_rationale),
  );
  if (!hasNarrative) {
    return {
      name: "review bias_findings",
      pass: false,
      detail: `positive control failed: no recognisable review surface in response (keys=${Object.keys(body).slice(0, 10).join(",")}) (${elapsed}s)`,
    };
  }

  const findings = Array.isArray(body.bias_findings) ? body.bias_findings : [];
  // These two fields are what buildBiasCards (phase3-blocks.ts) requires
  // to emit a review_card with card_kind 'bias' — assert card-viability,
  // not mere presence.
  const cardViable = findings.filter(
    (f: any) =>
      f &&
      typeof f.type === "string" &&
      f.type.trim().length > 0 &&
      typeof f.description === "string" &&
      f.description.trim().length > 0,
  );
  if (cardViable.length < 1) {
    return {
      name: "review bias_findings",
      pass: false,
      detail:
        `RED: served decision_review prompt yielded ${findings.length} bias_findings ` +
        `(${cardViable.length} card-viable) for a single-option sunk-cost package ` +
        `(expected >=1). (${elapsed}s)`,
    };
  }
  return {
    name: "review bias_findings",
    pass: true,
    detail: `${cardViable.length} card-viable finding(s) [${summariseTypes(cardViable, "type")}], ${elapsed}s`,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log(`bias-prompt-liveness-postcheck → ${CEE_URL} (audit tag: ${AUDIT_TAG})`);

  const results: LegResult[] = [];
  results.push(await checkDraftLeg());

  if (process.env.BIAS_POSTCHECK_SKIP_REVIEW === "1") {
    console.log("review leg SKIPPED (BIAS_POSTCHECK_SKIP_REVIEW=1)");
  } else {
    results.push(await checkReviewLeg());
  }

  let allPass = true;
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}: ${r.detail}`);
    if (!r.pass) allPass = false;
  }

  if (!allPass) {
    console.error(
      "\nGATE RED — a named bias surface (design record §1.5) is not behaving on the served prompts. " +
        "If a prompt promotion just happened, re-pin the previous version and reload before investigating.",
    );
    process.exit(1);
  }
  console.log("\nGATE GREEN — served prompts still feed the §1.5 bias surfaces.");
}

main().catch((err) => {
  console.error(`postcheck errored: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
