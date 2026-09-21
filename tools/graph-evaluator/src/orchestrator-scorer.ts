/**
 * Orchestrator prompt scorer — v30.5 (JSON output contract).
 *
 * Scores LLM responses against the orchestrator v30.5 prompt spec.
 * The response format is JSON: { text, insights[], recommended_actions[] }.
 * Actions have no parameters field (removed in v30.5).
 *
 * Dimensions (7, weighted):
 * 1. valid_json          (0.15) — parses as JSON with exactly 3 root keys
 * 2. text_quality        (0.15) — non-empty, >=1 sentence, <200 words, no markdown/HTML/dashes
 * 3. insight_compliance   (0.10) — 0-3 insights with valid type/severity/target_id
 * 4. action_eligibility   (0.25) — 0-3 actions, action_type from eligible_actions, valid fields
 * 5. fabrication_check    (0.15) — no invented numbers/drivers/mechanisms/target_ids
 * 6. banned_terms         (0.10) — no internal terms in user-facing text
 * 7. scenario_specific    (0.10) — per-fixture assertions
 *
 * Plus ONE NON-SCORING DIAGNOSTIC: `scale_conversions`.
 * It records percentages the response rendered from model values whose scale
 * nothing attests (a bare unitless `0.5` shown as "50%"). It carries NO weight
 * and gates NOTHING — the remedy for that rendering is an open product
 * decision, and a gate that failed on the class before the decision was made
 * would block every promotion. Its only job is to let a promotion run tell an
 * improvement from a regression on this class, which it previously could not:
 * the grounding corpus contained both `0.5` and `50`, so `fabrication_check`
 * certified "50%" as grounded and the gate blessed the transformation it
 * should have been measuring.
 */

import type {
  OrchestratorFixture,
  OrchestratorScore,
  TurnContext,
  ScenarioAssertion,
  ScaleAttestation,
  ScaleConversionRecord,
} from "./types.js";

// =============================================================================
// Banned terms (from v30.3 prompt VOICE anti-patterns)
// =============================================================================

const BANNED_TERMS = [
  "TurnContext",
  "pipeline",
  "blocks",
  "chips",
  "zones",
  "CEE",
  "PLoT",
  "ISL",
  "Layer 0",
  "Layer 1",
  "Layer 2",
  "action_type",
  "chip_metadata",
  "response_version",
  "eligible_actions",
  "target_id",
  "exists_probability",
  "voi",
  "factor_sensitivity",
  "recommendation_stability",
  "attribution_stability",
  "rank_flip_rate",
  "model_critiques",
  "canonical_state",
  "headline_type",
  "edge_e_values",
  "dsk_claim_id",
  "evidence_strength",
  "E-value",
  "e_value",
  "EVPI",
  "evpi_percentage_points",
  "conditional_winners",
  "inference_warnings",
];

const BANNED_FILLER = [
  "Great question!",
  "That's a great",
];

// Short terms that need word-boundary matching to avoid false positives.
// "voi" must not match "avoids", "invoice", "devoid".
// "ISL" must not match "island".
// "CEE" must not match "proceed".
const WORD_BOUNDARY_TERMS = new Set([
  "voi",
  "ISL",
  "CEE",
  "PLoT",
  "chips",
  "blocks",
  "zones",
  "EVPI",
]);

// =============================================================================
// Valid enums from the output contract
// =============================================================================

const VALID_INSIGHT_TYPES = [
  "bias_detected",
  "missing_perspective",
  "assumption_risk",
  "opportunity",
  "calibration_concern",
  "structural_gap",
];

const VALID_SEVERITIES = ["info", "warning", "important"];

const VALID_PRIORITIES = ["high", "medium", "low"];

// =============================================================================
// Helpers
// =============================================================================

/** Try to parse the response as JSON. Returns null on failure. */
function tryParseJson(raw: string): Record<string, unknown> | null {
  try {
    // Strip markdown fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith("```json")) {
      cleaned = cleaned.slice(7);
    } else if (cleaned.startsWith("```")) {
      cleaned = cleaned.slice(3);
    }
    if (cleaned.endsWith("```")) {
      cleaned = cleaned.slice(0, -3);
    }
    cleaned = cleaned.trim();

    const parsed = JSON.parse(cleaned);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Count words in text. */
function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/** Check if text contains at least one sentence (has a period, exclamation, or question mark). */
function hasSentence(text: string): boolean {
  return /[.!?]/.test(text);
}

/** Get all entity IDs from the TurnContext. */
function getAllEntityIds(ctx: TurnContext): Set<string> {
  const ids = new Set<string>();
  for (const d of ctx.entities.decisions) ids.add(d.id);
  for (const o of ctx.entities.options) ids.add(o.id);
  for (const f of ctx.entities.factors) ids.add(f.id);
  for (const o of ctx.entities.outcomes) ids.add(o.id);
  for (const r of ctx.entities.risks) ids.add(r.id);
  for (const g of ctx.entities.goals) ids.add(g.id);
  return ids;
}

// =============================================================================
// Grounding corpus with PROVENANCE
// =============================================================================
//
// The corpus used to exist as a bare `Set<number>`. That set is what makes
// `fabrication_check` pass, and it silently contained BOTH a model value and
// its x100 form — so a unitless `0.5` rendered as `"50%"` was certified as
// grounded, and the promotion gate blessed the very transformation it should
// have been measuring. Keeping only the numbers threw away the one fact needed
// to tell a legitimate percentage from an invented one: WHERE each number came
// from, and whether that source attests the 0-1 -> % scale at all.
//
// The numeric CONTENT of the corpus is unchanged — `groundedValueSet()` below
// reproduces the old set exactly, so `fabrication_check` scores identically.
// The provenance is additive, and is used only for the non-scoring diagnostic.

/** How a grounded number relates to the model value that supplied it. */
type GroundingRoute =
  /** The model value itself, as-is. */
  | "direct"
  /** The model value multiplied by 100 — a 0-1 -> percentage conversion. */
  | "scaled_percent"
  /** The model value divided by 1000 — the "£20k" abbreviation. */
  | "scaled_thousand";

interface GroundedNumber {
  /** The number as it enters the grounding corpus. */
  value: number;
  /** The model value it derives from. */
  source_value: number;
  /** Which context field supplied it, e.g. "factor:fac_retention". */
  ref: string;
  route: GroundingRoute;
  /** Only meaningful for `scaled_percent`. */
  attestation: ScaleAttestation;
}

/**
 * Units that attest a 0-1 -> percentage rendering.
 *
 * Deliberately TIGHT. An unrecognised unit falls through to `unit_conflict`,
 * which is REPORTED — so the failure direction of this list is to over-report,
 * never to hide. A short list that fails loud beats a long one that goes stale.
 */
const PERCENT_UNITS = new Set(["%", "percent", "percentage", "pct"]);

function classifyUnit(unit: string | undefined): ScaleAttestation {
  if (unit == null || unit.trim().length === 0) return "unattested";
  return PERCENT_UNITS.has(unit.trim().toLowerCase()) ? "unit_percent" : "unit_conflict";
}

/** An attested scale conversion is one we do NOT report. */
function isAttestedPercentScale(a: ScaleAttestation): boolean {
  return a === "probability" || a === "unit_percent";
}

/**
 * Get all numbers present in the analysis context + entity labels, each tagged
 * with the source that supplied it and how it was derived.
 */
function getGroundedNumbers(ctx: TurnContext): GroundedNumber[] {
  const out: GroundedNumber[] = [];
  const direct = (value: number, ref: string) =>
    out.push({ value, source_value: value, ref, route: "direct", attestation: "unattested" });
  const percent = (source_value: number, ref: string, attestation: ScaleAttestation) =>
    out.push({
      value: Math.round(source_value * 100),
      source_value,
      ref,
      route: "scaled_percent",
      attestation,
    });

  // Analysis results. `probability` is a declared probability — a percentage
  // rendering of it is the correct presentation, not an invented scale.
  if (ctx.analysis.winner) {
    direct(ctx.analysis.winner.probability, "analysis.winner.probability");
    percent(ctx.analysis.winner.probability, "analysis.winner.probability", "probability");
  }
  if (ctx.analysis.runner_up) {
    direct(ctx.analysis.runner_up.probability, "analysis.runner_up.probability");
    percent(ctx.analysis.runner_up.probability, "analysis.runner_up.probability", "probability");
  }
  for (const d of ctx.analysis.top_drivers) {
    direct(d.sensitivity, `top_driver:${d.id}.sensitivity`);
    // Only derive percentage form if sensitivity is a 0-1 decimal.
    // A sensitivity is a bare elasticity-like number: it carries no unit and is
    // not a probability, so its percentage form is UNATTESTED.
    if (d.sensitivity > 0 && d.sensitivity < 1) {
      percent(d.sensitivity, `top_driver:${d.id}.sensitivity`, "unattested");
    }
  }

  // Edge strengths + exists_probability (both raw and percentage forms)
  for (const e of ctx.entities.edges) {
    const eref = `edge:${e.from}->${e.to}`;
    direct(e.strength_mean, `${eref}.strength_mean`);
    direct(Math.abs(e.strength_mean), `${eref}.strength_mean`);
    // A causal strength is unitless and is NOT a probability.
    percent(Math.abs(e.strength_mean), `${eref}.strength_mean`, "unattested");
    direct(e.exists_probability, `${eref}.exists_probability`);
    percent(e.exists_probability, `${eref}.exists_probability`, "probability");
  }

  // Factor values (both raw and percentage forms).
  // THE DEFECT SITE: `f.value` is a bare number. Unless the factor attests a
  // unit, its percentage form invents a scale the model never claimed.
  for (const f of ctx.entities.factors) {
    if (f.value != null) {
      direct(f.value, `factor:${f.id}`);
      if (f.value > 0 && f.value < 1) {
        percent(f.value, `factor:${f.id}`, classifyUnit(f.unit));
      }
    }
  }

  // Goal thresholds (in all common formats: raw, /1000 for "Xk")
  for (const g of ctx.entities.goals) {
    if (g.threshold != null) {
      direct(g.threshold, `goal:${g.id}.threshold`);
      if (g.threshold >= 1000) {
        out.push({
          value: g.threshold / 1000,
          source_value: g.threshold,
          ref: `goal:${g.id}.threshold`,
          route: "scaled_thousand",
          attestation: "unattested",
        });
      }
    }
  }

  // Constraints
  for (const c of ctx.entities.constraints) {
    direct(c.value, `constraint:${c.id}`);
    if (c.value > 0 && c.value < 1) {
      percent(c.value, `constraint:${c.id}`, classifyUnit(c.unit));
    }
  }

  // Numbers embedded in entity labels (e.g. "£20k MRR", "Raise Prices to £59")
  const allLabels: Array<{ label: string; ref: string }> = [];
  for (const list of [ctx.entities.decisions, ctx.entities.options, ctx.entities.factors,
                       ctx.entities.outcomes, ctx.entities.risks, ctx.entities.goals]) {
    for (const ent of list) {
      if ("label" in ent && typeof ent.label === "string") {
        allLabels.push({ label: ent.label, ref: `label:${ent.id}` });
      }
    }
  }
  for (const { label, ref } of allLabels) {
    const labelNums = label.match(/\d+\.?\d*/g) ?? [];
    for (const ln of labelNums) {
      const v = parseFloat(ln);
      if (!isNaN(v)) direct(v, ref);
    }
  }

  return out;
}

/**
 * The grounding corpus as the fabrication check consumes it.
 *
 * Reproduces the pre-existing `getContextNumbers` set EXACTLY. Deriving it from
 * the provenance list rather than building it separately means the two can
 * never drift apart — there is no second hand-maintained copy to go stale.
 */
function groundedValueSet(grounded: GroundedNumber[]): Set<number> {
  return new Set(grounded.map((g) => g.value));
}

/**
 * DIAGNOSTIC — find numbers whose ONLY grounding route was an unattested
 * 0-1 -> percentage conversion.
 *
 * This answers a DIFFERENT question from `fabrication_check`. That one asks
 * "is this number grounded at all?"; this asks "was it grounded only by
 * inventing a scale?". They are deliberately kept apart: the fabrication
 * check's small-number allowance (`<= 5`, `10`, `100`) is a property of the
 * grounding question and has no bearing on whether a scale was invented, so it
 * is not applied here.
 *
 * A number is reported only when EVERY route that grounds it is an unattested
 * percentage conversion. If it is also grounded directly (a label carries it,
 * say), no scale was invented and nothing is reported.
 *
 * REPORTED, NOT SCORED — the caller must not gate on this.
 */
function detectUnattestedScaleRenders(
  text: string,
  grounded: GroundedNumber[]
): ScaleConversionRecord[] {
  const out: ScaleConversionRecord[] = [];
  const seen = new Set<string>();

  const tokens = text.match(/\d+\.?\d*%?/g) ?? [];
  for (const token of tokens) {
    const value = parseFloat(token.replace("%", ""));
    if (isNaN(value)) continue;

    // Same tolerance the fabrication check uses, so this reports on exactly the
    // numbers that check certifies rather than on a differently-drawn set.
    const matches = grounded.filter((g) => Math.abs(g.value - value) < 0.5);

    // Ungrounded entirely — that is the fabrication check's business, not ours.
    if (matches.length === 0) continue;
    // Grounded by some route that invented no scale.
    if (matches.some((m) => m.route !== "scaled_percent")) continue;
    // Grounded by a percentage conversion the source actually attests.
    if (matches.some((m) => isAttestedPercentScale(m.attestation))) continue;

    const m = matches[0];
    const key = `${token}|${m.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);

    out.push({
      rendered: token,
      rendered_value: value,
      source_value: m.source_value,
      source_ref: m.ref,
      attestation: m.attestation,
    });
  }

  return out;
}

// =============================================================================
// Scenario-specific assertion evaluator
// =============================================================================

function evaluateScenarioAssertion(
  assertion: ScenarioAssertion,
  parsed: Record<string, unknown>
): boolean {
  const text = (parsed.text as string ?? "").toLowerCase();
  const actions = parsed.recommended_actions as Array<Record<string, unknown>> ?? [];

  switch (assertion.check) {
    case "action_type_absent":
      return !actions.some((a) => a.action_type === assertion.value);

    case "action_type_present":
      return actions.some((a) => a.action_type === assertion.value);

    case "target_id_omitted":
      // All actions should omit target_id (or it should be null/undefined)
      return actions.every((a) => a.target_id == null);

    case "text_contains":
      return text.includes((assertion.value as string).toLowerCase());

    case "text_not_contains":
      return !text.includes((assertion.value as string).toLowerCase());

    case "max_actions":
      return actions.length <= (assertion.value as number);

    case "min_actions":
      return actions.length >= (assertion.value as number);

    case "asks_question":
      return text.includes("?");

    case "no_rubber_stamp": {
      // Should not just say "go ahead" without probing readiness/reversibility
      const rubberStampPhrases = ["go ahead", "you're ready", "proceed with confidence", "nothing to worry about"];
      return !rubberStampPhrases.some((p) => text.includes(p));
    }

    case "proposes_structural_fix":
      // Should recommend a structural action (add_factor, add_constraint, adjust_edge_strength, set_factor_value, edit_graph)
      return actions.some((a) => {
        const at = a.action_type as string;
        return ["add_factor", "add_constraint", "adjust_edge_strength", "set_factor_value", "add_option", "edit_graph"].includes(at);
      });

    default:
      return true;
  }
}

// =============================================================================
// Main scorer
// =============================================================================

export function scoreOrchestrator(
  fixture: OrchestratorFixture,
  raw: string | null
): OrchestratorScore {
  if (!raw || raw.trim().length === 0) {
    return {
      valid_json: false,
      text_quality: false,
      insight_compliance: false,
      action_eligibility: false,
      fabrication_check: false,
      banned_terms: false,
      scenario_specific: false,
      overall: 0,
      scale_conversions: [],
    };
  }

  const ctx = fixture.turn_context;
  const entityIds = getAllEntityIds(ctx);
  const eligibleActions = new Set(ctx.eligible_actions);

  // ── 1. valid_json ──────────────────────────────────────────────────────────
  const parsed = tryParseJson(raw);
  let valid_json = false;
  if (parsed) {
    const keys = Object.keys(parsed).sort();
    valid_json =
      keys.length === 3 &&
      keys.includes("text") &&
      keys.includes("insights") &&
      keys.includes("recommended_actions");
  }

  // If JSON doesn't parse, remaining dimensions get conservative scores
  if (!parsed || !valid_json) {
    return {
      valid_json: false,
      text_quality: false,
      insight_compliance: false,
      action_eligibility: false,
      fabrication_check: false,
      banned_terms: false,
      scenario_specific: false,
      overall: 0,
      scale_conversions: [],
    };
  }

  // ── 2. text_quality ────────────────────────────────────────────────────────
  const textVal = parsed.text;
  let text_quality = false;
  if (typeof textVal === "string" && textVal.trim().length > 0) {
    const text = textVal.trim();
    const wc = wordCount(text);
    const oneSentence = hasSentence(text);
    const under200 = wc <= 200;
    // No markdown headers (# ##), fences (```), HTML tags
    const noMarkdownHeaders = !/^#{1,6}\s/m.test(text);
    const noFences = !text.includes("```");
    const noHtml = !/<\/?[a-z][^>]*>/i.test(text);
    // No em dashes, en dashes, double hyphens
    const noEmDash = !text.includes("\u2014"); // —
    const noEnDash = !text.includes("\u2013"); // –
    const noDoubleHyphen = !/ -- /.test(text) && !/--/.test(text.replace(/<!--[\s\S]*?-->/g, ""));

    text_quality = oneSentence && under200 && noMarkdownHeaders && noFences && noHtml && noEmDash && noEnDash && noDoubleHyphen;
  }

  // ── 3. insight_compliance ──────────────────────────────────────────────────
  const insights = parsed.insights;
  let insight_compliance = true;
  if (!Array.isArray(insights)) {
    insight_compliance = false;
  } else if (insights.length > 3) {
    insight_compliance = false;
  } else {
    for (const insight of insights) {
      if (typeof insight !== "object" || insight === null) {
        insight_compliance = false;
        break;
      }
      const i = insight as Record<string, unknown>;
      if (!VALID_INSIGHT_TYPES.includes(i.type as string)) {
        insight_compliance = false;
        break;
      }
      if (!VALID_SEVERITIES.includes(i.severity as string)) {
        insight_compliance = false;
        break;
      }
      if (typeof i.description !== "string" || (i.description as string).trim().length === 0) {
        insight_compliance = false;
        break;
      }
      // target_id must be from entity list or omitted
      if (i.target_id != null && !entityIds.has(i.target_id as string)) {
        insight_compliance = false;
        break;
      }
    }
  }

  // ── 4. action_eligibility ──────────────────────────────────────────────────
  const actions = parsed.recommended_actions;
  let action_eligibility = true;
  if (!Array.isArray(actions)) {
    action_eligibility = false;
  } else if (actions.length > 3) {
    action_eligibility = false;
  } else {
    for (const action of actions) {
      if (typeof action !== "object" || action === null) {
        action_eligibility = false;
        break;
      }
      const a = action as Record<string, unknown>;
      // action_type must be from eligible_actions
      if (!eligibleActions.has(a.action_type as string)) {
        action_eligibility = false;
        break;
      }
      // target_id must be from entity list or omitted
      if (a.target_id != null && !entityIds.has(a.target_id as string)) {
        action_eligibility = false;
        break;
      }
      // priority must be valid
      if (!VALID_PRIORITIES.includes(a.priority as string)) {
        action_eligibility = false;
        break;
      }
      // rationale must be non-empty string
      if (typeof a.rationale !== "string" || (a.rationale as string).trim().length === 0) {
        action_eligibility = false;
        break;
      }
    }
  }

  // ── 5. fabrication_check ───────────────────────────────────────────────────
  let fabrication_check = true;
  const textStr = (parsed.text as string).toLowerCase();

  // Check for fabricated numbers: extract all percentages and decimals from text
  const numberMatches = textStr.match(/\d+\.?\d*%?/g) ?? [];
  const groundedNumbers = getGroundedNumbers(ctx);
  const knownNums = groundedValueSet(groundedNumbers);
  // Also include numbers from user messages (single-turn + multi-turn)
  const userMsgs: string[] = [];
  if (fixture.user_message) userMsgs.push(fixture.user_message);
  if (fixture.turns) {
    for (const turn of fixture.turns) {
      if (turn.content) userMsgs.push(turn.content);
    }
  }
  for (const msg of userMsgs) {
    const msgNums = msg.match(/\d+\.?\d*/g) ?? [];
    for (const un of msgNums) {
      const v = parseFloat(un);
      if (!isNaN(v)) {
        knownNums.add(v);
        // Also a DIRECT grounding route for the diagnostic below. A number the
        // user themselves stated is attested by the user, so echoing it back is
        // not an invented scale even when a unitless model value happens to sit
        // at v/100. Without this the diagnostic would report the user's own
        // figure as a fabricated percentage.
        groundedNumbers.push({
          value: v,
          source_value: v,
          ref: "user_message",
          route: "direct",
          attestation: "unattested",
        });
      }
    }
  }
  for (const numStr of numberMatches) {
    const numVal = parseFloat(numStr.replace("%", ""));
    if (isNaN(numVal)) continue;
    // Allow common non-data numbers (ordinals, small counts)
    if (numVal <= 5 || numVal === 10 || numVal === 100) continue;
    // Allow the number if it's in our known set (or close)
    const isKnown = [...knownNums].some(
      (k) => Math.abs(k - numVal) < 0.5
    );
    if (!isKnown) {
      fabrication_check = false;
      break;
    }
  }

  // Check for drivers mentioned when top_drivers is empty
  if (ctx.analysis.top_drivers.length === 0) {
    // Quantified driver claims ("drives 42%") are always fabrication
    if (/drives?\s+\d+%/.test(textStr)) {
      fabrication_check = false;
    }
    // Unquantified but specific driver claims ("the primary driver is X")
    const namedDriverPattern = /(?:primary|biggest|main|top|key|most influential)\s+(?:driver|factor)\s+(?:is|being|remains)/i;
    if (namedDriverPattern.test(textStr)) {
      fabrication_check = false;
    }
  }

  // ── DIAGNOSTIC (non-scoring): unattested 0-1 -> percentage renders ─────────
  // Deliberately computed AFTER the grounding corpus is complete and kept OUT
  // of every dimension above. It changes no score and gates nothing.
  const scale_conversions = detectUnattestedScaleRenders(textStr, groundedNumbers);

  // Check for invented target_ids in insights and actions
  const allInsights = (parsed.insights as Array<Record<string, unknown>>) ?? [];
  const allActions = (parsed.recommended_actions as Array<Record<string, unknown>>) ?? [];
  for (const item of [...allInsights, ...allActions]) {
    if (item.target_id != null && !entityIds.has(item.target_id as string)) {
      fabrication_check = false;
      break;
    }
  }

  // ── 6. banned_terms ────────────────────────────────────────────────────────
  let banned_terms = true;
  // Check all user-facing text: text + insight descriptions + action rationales
  const userFacingParts: string[] = [parsed.text as string];
  for (const insight of allInsights) {
    if (typeof insight.description === "string") userFacingParts.push(insight.description);
  }
  for (const action of allActions) {
    if (typeof action.rationale === "string") userFacingParts.push(action.rationale);
  }
  const userFacingText = userFacingParts.join(" ");

  for (const term of BANNED_TERMS) {
    if (WORD_BOUNDARY_TERMS.has(term)) {
      const re = new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(userFacingText)) {
        banned_terms = false;
        break;
      }
    } else {
      if (userFacingText.toLowerCase().includes(term.toLowerCase())) {
        banned_terms = false;
        break;
      }
    }
  }

  // Check filler phrases
  if (banned_terms) {
    for (const filler of BANNED_FILLER) {
      if (userFacingText.includes(filler)) {
        banned_terms = false;
        break;
      }
    }
  }

  // Also check uncertainty language compliance via forbidden phrases
  if (fixture.expected.expects_uncertainty_language) {
    const absolutePhrases = ["definitely", "guaranteed", "it's impossible", "certainly will"];
    for (const phrase of absolutePhrases) {
      if (userFacingText.toLowerCase().includes(phrase)) {
        banned_terms = false;
        break;
      }
    }
  }

  // Check fixture-specific forbidden phrases
  if (fixture.expected.forbidden_phrases && fixture.expected.forbidden_phrases.length > 0) {
    for (const phrase of fixture.expected.forbidden_phrases) {
      if (userFacingText.toLowerCase().includes(phrase.toLowerCase())) {
        banned_terms = false;
        break;
      }
    }
  }

  // ── 7. scenario_specific ───────────────────────────────────────────────────
  let scenario_specific = true;

  // Check must_contain
  if (fixture.expected.must_contain && fixture.expected.must_contain.length > 0) {
    for (const substr of fixture.expected.must_contain) {
      if (!userFacingText.toLowerCase().includes(substr.toLowerCase())) {
        scenario_specific = false;
        break;
      }
    }
  }

  // Check scenario_assertions
  if (scenario_specific && fixture.expected.scenario_assertions) {
    for (const assertion of fixture.expected.scenario_assertions) {
      if (!evaluateScenarioAssertion(assertion, parsed)) {
        scenario_specific = false;
        break;
      }
    }
  }

  // ── Overall weighted score ─────────────────────────────────────────────────
  const weights: Record<string, number> = {
    valid_json: 0.15,
    text_quality: 0.15,
    insight_compliance: 0.10,
    action_eligibility: 0.25,
    fabrication_check: 0.15,
    banned_terms: 0.10,
    scenario_specific: 0.10,
  };

  const dims: Record<string, boolean> = {
    valid_json,
    text_quality,
    insight_compliance,
    action_eligibility,
    fabrication_check,
    banned_terms,
    scenario_specific,
  };

  let overall = 0;
  for (const [key, weight] of Object.entries(weights)) {
    if (dims[key]) overall += weight;
  }

  return {
    valid_json,
    text_quality,
    insight_compliance,
    action_eligibility,
    fabrication_check,
    banned_terms,
    scenario_specific,
    overall,
    scale_conversions,
  };
}
