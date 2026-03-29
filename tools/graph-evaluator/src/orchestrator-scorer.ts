/**
 * Orchestrator prompt scorer — v30.3 (JSON output contract).
 *
 * Scores LLM responses against the orchestrator v30.3 prompt spec.
 * The response format is JSON: { text, insights[], recommended_actions[] }.
 *
 * Dimensions (8, weighted):
 * 1. valid_json          (0.15) — parses as JSON with exactly 3 root keys
 * 2. text_quality        (0.15) — non-empty, >=1 sentence, <200 words, no markdown/HTML/dashes
 * 3. insight_compliance   (0.10) — 0-3 insights with valid type/severity/target_id
 * 4. action_eligibility   (0.20) — 0-3 actions, action_type from eligible_actions, valid fields
 * 5. parameter_validity   (0.05) — parameters match user-stated values, no fabrication
 * 6. fabrication_check    (0.15) — no invented numbers/drivers/mechanisms/target_ids
 * 7. banned_terms         (0.10) — no internal terms in user-facing text
 * 8. scenario_specific    (0.10) — per-fixture assertions
 */

import type { OrchestratorFixture, OrchestratorScore, TurnContext, ScenarioAssertion } from "./types.js";

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

/** Get all numbers present in the analysis context + entity labels. */
function getContextNumbers(ctx: TurnContext): Set<number> {
  const nums = new Set<number>();

  // Analysis results
  if (ctx.analysis.winner) {
    nums.add(ctx.analysis.winner.probability);
    nums.add(Math.round(ctx.analysis.winner.probability * 100));
  }
  if (ctx.analysis.runner_up) {
    nums.add(ctx.analysis.runner_up.probability);
    nums.add(Math.round(ctx.analysis.runner_up.probability * 100));
  }
  for (const d of ctx.analysis.top_drivers) {
    nums.add(d.sensitivity);
    // Only derive percentage form if sensitivity is a 0-1 decimal
    if (d.sensitivity > 0 && d.sensitivity < 1) {
      nums.add(Math.round(d.sensitivity * 100));
    }
  }

  // Edge strengths + exists_probability (both raw and percentage forms)
  for (const e of ctx.entities.edges) {
    nums.add(e.strength_mean);
    nums.add(Math.abs(e.strength_mean));
    nums.add(Math.round(Math.abs(e.strength_mean) * 100));
    nums.add(e.exists_probability);
    nums.add(Math.round(e.exists_probability * 100));
  }

  // Factor values (both raw and percentage forms)
  for (const f of ctx.entities.factors) {
    if (f.value != null) {
      nums.add(f.value);
      if (f.value > 0 && f.value < 1) nums.add(Math.round(f.value * 100));
    }
  }

  // Goal thresholds (in all common formats: raw, /1000 for "Xk")
  for (const g of ctx.entities.goals) {
    if (g.threshold != null) {
      nums.add(g.threshold);
      if (g.threshold >= 1000) nums.add(g.threshold / 1000);
    }
  }

  // Constraints
  for (const c of ctx.entities.constraints) {
    nums.add(c.value);
    if (c.value > 0 && c.value < 1) nums.add(Math.round(c.value * 100));
  }

  // Numbers embedded in entity labels (e.g. "£20k MRR", "Raise Prices to £59")
  const allLabels: string[] = [];
  for (const list of [ctx.entities.decisions, ctx.entities.options, ctx.entities.factors,
                       ctx.entities.outcomes, ctx.entities.risks, ctx.entities.goals]) {
    for (const ent of list) {
      if ("label" in ent && typeof ent.label === "string") allLabels.push(ent.label);
    }
  }
  for (const label of allLabels) {
    const labelNums = label.match(/\d+\.?\d*/g) ?? [];
    for (const ln of labelNums) {
      const v = parseFloat(ln);
      if (!isNaN(v)) nums.add(v);
    }
  }

  return nums;
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
      parameter_validity: false,
      fabrication_check: false,
      banned_terms: false,
      scenario_specific: false,
      overall: 0,
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
      parameter_validity: false,
      fabrication_check: false,
      banned_terms: false,
      scenario_specific: false,
      overall: 0,
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

  // ── 5. parameter_validity ──────────────────────────────────────────────────
  // When parameters are present, they should not contain fabricated values.
  // Since we can't know what the user "stated" from fixture alone, we check
  // that parameters is either absent, empty, or contains only known values.
  let parameter_validity = true;
  if (Array.isArray(actions)) {
    for (const action of actions) {
      const a = action as Record<string, unknown>;
      if (a.parameters != null && typeof a.parameters === "object") {
        const params = a.parameters as Record<string, unknown>;
        // Null values are acceptable (means "please provide")
        // But if a numeric value is present, it should be traceable to context
        const paramKnownNums = getContextNumbers(ctx);
        for (const [, v] of Object.entries(params)) {
          if (typeof v === "number") {
            // Allow null and common round numbers (0, 1, 100)
            if (!paramKnownNums.has(v) && v !== 0 && v !== 1 && v !== 100) {
              // Only fail if the number is suspiciously specific
              // (fabricated parameters like 0.35 when no such value exists)
              // Allow integers that could be user-referenced (from the brief text)
              if (!Number.isInteger(v) || v > 1000) {
                parameter_validity = false;
              }
            }
          }
        }
      }
    }
  }

  // ── 6. fabrication_check ───────────────────────────────────────────────────
  let fabrication_check = true;
  const textStr = (parsed.text as string).toLowerCase();

  // Check for fabricated numbers: extract all percentages and decimals from text
  const numberMatches = textStr.match(/\d+\.?\d*%?/g) ?? [];
  const knownNums = getContextNumbers(ctx);
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
      if (!isNaN(v)) knownNums.add(v);
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

  // Check for invented target_ids in insights and actions
  const allInsights = (parsed.insights as Array<Record<string, unknown>>) ?? [];
  const allActions = (parsed.recommended_actions as Array<Record<string, unknown>>) ?? [];
  for (const item of [...allInsights, ...allActions]) {
    if (item.target_id != null && !entityIds.has(item.target_id as string)) {
      fabrication_check = false;
      break;
    }
  }

  // ── 7. banned_terms ────────────────────────────────────────────────────────
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

  // ── 8. scenario_specific ───────────────────────────────────────────────────
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
    action_eligibility: 0.20,
    parameter_validity: 0.05,
    fabrication_check: 0.15,
    banned_terms: 0.10,
    scenario_specific: 0.10,
  };

  const dims: Record<string, boolean> = {
    valid_json,
    text_quality,
    insight_compliance,
    action_eligibility,
    parameter_validity,
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
    parameter_validity,
    fabrication_check,
    banned_terms,
    scenario_specific,
    overall,
  };
}
