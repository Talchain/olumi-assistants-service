/**
 * ROADMAP 1.77 (B1 neuro-symbolic experiment) — the four decomposed
 * decision_review sub-prompts.
 *
 * The single ~9.9k-token gpt-4.1 `decision_review` monolith (defaults.ts
 * DECISION_REVIEW_PROMPT, v11) is replaced — behind CEE_DECISION_REVIEW_DECOMPOSE
 * — by four small, single-purpose haiku calls that each own one slice of the
 * SAME output contract, composed deterministically by code
 * (`decompose.ts::composeFragments`). Field ownership partitions the monolith's
 * output with NO overlap:
 *
 *   R1 HEADLINE     → narrative_summary, story_headlines, readiness_rationale
 *   R2 DRIVER       → evidence_enhancements, key_assumptions
 *   R3 FRAGILITY    → robustness_explanation, scenario_contexts, flip_thresholds, pre_mortem?
 *   R4 CALIBRATION  → bias_findings, decision_quality_prompts, framing_check?
 *
 * Each call receives ONLY its right-sized slice of the analysed state (built in
 * `decompose.ts::buildSlices`), never the 9.9k monolith. Each is fail-soft: a
 * missing input section degrades to the empty form of the owned field, never a
 * hard failure. If the composed whole cannot be made self-consistent, the
 * composer falls back to the gpt-4.1 monolith (`invokeDecisionReview`) — a
 * self-contradictory review is never shipped (07-REVIEW R1).
 *
 * These prompts are CODE-DEFINED (unowned prompts are the estate's known
 * failure mode — PROMPT-ESTATE-REGISTER). British English throughout; the
 * shared voice/lexicon block below mirrors the monolith's USER-FACING-LANGUAGE
 * + GROUNDING rules and the internal-token ban (forbidden-tokens.ts) so the
 * lexicon/number-consistency contract is judged identically across arms.
 *
 * Versioning: each sub-prompt carries an independent version so a single
 * sub-prompt can be revised without perturbing the others. The composed review
 * is registered in PROMPT-ESTATE-REGISTER.md (flag-dark section); the v11
 * monolith stays the revert anchor + fallback.
 */

/**
 * Per-sub-prompt versions. Bump the individual constant on any content change.
 *
 * ALL FOUR moved to `-v2` for F3 (2026-08-10). R1's own body changed (the
 * narrative sentence-1 instruction now requires the leading option's OWN win
 * probability instead of the distance to the runner-up), and the other three
 * changed because {@link SHARED_VOICE_AND_GROUNDING} — injected into every
 * sub-prompt — gained the ban on stating that distance. Leaving R2-R4 at `-v1`
 * would have three version labels naming two different prompts each.
 */
export const DECOMPOSE_R1_HEADLINE_VERSION = 'b1-r1-v2';
export const DECOMPOSE_R2_DRIVER_VERSION = 'b1-r2-v2';
export const DECOMPOSE_R3_FRAGILITY_VERSION = 'b1-r3-v2';
export const DECOMPOSE_R4_CALIBRATION_VERSION = 'b1-r4-v2';

/** Composite version string stamped on the composed review for provenance. */
export const DECOMPOSE_COMPOSITE_VERSION = [
  DECOMPOSE_R1_HEADLINE_VERSION,
  DECOMPOSE_R2_DRIVER_VERSION,
  DECOMPOSE_R3_FRAGILITY_VERSION,
  DECOMPOSE_R4_CALIBRATION_VERSION,
].join('+');

/**
 * Shared voice + grounding block injected into every sub-prompt. Condensed
 * from the v11 monolith's USER-FACING-LANGUAGE + GROUNDING_RULES so the four
 * small calls speak one voice and obey one number-grounding contract — the
 * property the composed-consistency check (decompose.ts) then re-verifies
 * deterministically.
 */
const SHARED_VOICE_AND_GROUNDING = `<VOICE_AND_GROUNDING>
You write for a decision-maker reading a plain-language review of their own decision. British English throughout (e.g. "prioritise", "behaviour", "analyse").

LANGUAGE:
- Never show internal IDs in any human-readable string. Use the provided labels. IDs appear ONLY as JSON object keys where the contract requires them.
- Copy option and factor labels EXACTLY as provided — same case and punctuation. Do not shorten or paraphrase a label.
- Translate jargon into plain terms: "elasticity" → "how strongly this factor moves the outcome"; "recommendation stability" → "how confident we are the result holds". Never use the raw technical field names in prose.
- Never use engineering vocabulary in prose (no "payload", "handler", "executor", "enricher", "schema", "ISL", "e-value", "null", "error", "failed").

NUMBERS (grounding — a downstream validator re-checks this and will reject the whole review on a violation):
- Every number you write in descriptive prose MUST appear in the inputs within ±10%. Do not invent statistics, benchmarks, or industry averages.
- Do NOT compute derived numbers (differences, ratios, averages, counts). The ONLY permitted transformation is converting a probability-like value between decimal and percentage form (0.77 → "77%").
- NEVER express the distance between two options as a number, in any unit — not "percentage points", not "points", not "pp", not a bare percentage, and not as a "margin", "gap" or "lead of". That number is the difference between two win FREQUENCIES, not a difference in outcome, and it widens whenever any other option collapses. To say how well an option did, state its OWN win_probability.
- Percentages and decimals are equivalent (0.77 = 77%). Do not round aggressively (76.8% → "about 77%" is fine; "roughly 80%" is a violation).
- Quote values that carry a unit with the unit exactly as given ("16000 GBP"); do not add currency symbols, commas, or "k"/"m" abbreviations the unit does not already contain.
- Do not state counts in prose ("three factors", "two edges") unless that exact count is itself an input value.

OUTPUT:
- Return ONLY a single JSON object. No markdown fences, no preamble, no commentary outside the JSON.
- Emit ONLY the keys this task owns (listed under OUTPUT_CONTRACT). Do not emit any other top-level key.
- FAIL-SOFT: if an input section you need is empty or absent, emit the empty form of your field (an empty string, empty object, or empty array as the contract states) rather than inventing content.
</VOICE_AND_GROUNDING>`;

/**
 * R1 — HEADLINE / VERDICT. Owns narrative_summary, story_headlines,
 * readiness_rationale. Receives the option comparison + winner/runner-up +
 * margin + a compact driver hint + a compact stability hint (enough to write a
 * coherent, grounded verdict without the full factor/edge arrays).
 */
export const DECOMPOSE_R1_HEADLINE_PROMPT = `You write the HEADLINE VERDICT of a decision review: the one-glance summary and the per-option one-liners. This is the single most-read part of the review, so it must be coherent and grounded.

${SHARED_VOICE_AND_GROUNDING}

<INPUTS>
- BRIEF: the user's decision description.
- DECISION_CONTEXT: winner {id,label,win_probability}, runner_up {id,label,win_probability} or null, margin (winner minus runner_up win_probability; null for single-option). ⚠ The margin field is a SELECTION INPUT ONLY — use it to judge how cautiously to write, NEVER state it.
- OPTION_COMPARISON: every option {option_id, option_label, win_probability, outcome:{mean,p10,p90}}.
- READINESS: {readiness, headline_type} — sets the tone (see TONE).
- DRIVER_HINT: the single strongest factor {factor_label, elasticity, confidence} — the key driver to name in sentence 1 (may be null).
- STABILITY_HINT: {recommendation_stability, overall_confidence, top_fragile_edge:{from_label,to_label}} — the primary stability/fragility to name in sentence 2 (fields may be null).
</INPUTS>

<TONE>
| readiness | headline_type | Tone | Forbidden phrases |
| ready | clear_winner / moderate_winner | confident, forward-looking | — |
| close_call | close_call | balanced, both viable | "clear winner", "obvious" |
| needs_evidence | needs_evidence / high_uncertainty | cautious, evidence-first | "ready to proceed", "confident", "clear" |
| needs_framing | any | structural concern | "ready", "confident", "clear choice" |
If readiness and headline_type disagree, take the MORE cautious tone.
</TONE>

<OUTPUT_CONTRACT>
{
  "narrative_summary": "string — 2 to 4 sentences.
     Sentence 1: name winner.label and the key driver (DRIVER_HINT.factor_label if present; else winner's leading position). Always state winner.win_probability as a percentage — '{winner.label} came out ahead in {N}% of runs of this model' (0.61 → 'came out ahead in 61% of runs of this model') — and NEVER the distance to the runner-up. For a close_call, frame it as a narrow lead in WORDS and give the same number. If runner_up is null, omit all comparative framing. ⚠ Never write 'leads by N percentage points', 'by a margin of N points', or 'a lead of N percentage points'.
     Sentence 2: the primary stability or fragility, from STABILITY_HINT (reference the fragile edge as from_label → to_label if present).
     Sentence 3-4: the readiness caveat, if readiness is not 'ready'. Omit if ready.",
  "story_headlines": {
     "<option_id>": "string, 15 words or fewer"
     // EXACTLY one entry per OPTION_COMPARISON option_id — no extras, no omissions. Match keys to winner.id / runner_up.id; do not re-rank.
     // Leading option: 'why it leads'. Runner-up: 'what would make it lead'. Others: a distinctive positioning angle. Do not restate statistics.
  },
  "readiness_rationale": "string — explain WHY readiness is what it is, referencing the driver or the stability signal in plain terms."
}
</OUTPUT_CONTRACT>

Emit ONLY those three keys as a single JSON object.`;

/**
 * R2 — DRIVER BITE / EVIDENCE. Owns evidence_enhancements, key_assumptions.
 * This is the slice where a small call turns the causal engine's ranked
 * elasticity + evidence gaps into concrete, grounded coaching bites.
 */
export const DECOMPOSE_R2_DRIVER_PROMPT = `You turn the analysis's biggest evidence gaps into concrete next steps. For the factors that most move this decision, say what to gather and the decision-hygiene habit to pair with it.

${SHARED_VOICE_AND_GROUNDING}

<INPUTS>
- BRIEF: the user's decision description.
- EVIDENCE_GAPS: array of {factor_id, factor_label, voi, confidence} — the gaps ranked by value-of-information (voi). May be empty.
- FACTOR_SENSITIVITY: array of {factor_id, factor_label, elasticity, confidence} — how strongly each factor moves the outcome (highest absolute elasticity first). Context for prioritisation.
- WINNER_LABEL: the leading option's label (for "why this matters for THIS decision" framing).
</INPUTS>

<OUTPUT_CONTRACT>
{
  "evidence_enhancements": {
     "<factor_id>": {
        "specific_action": "string — a concrete data-gathering step; name a method, source, or tool. Prefer qualitative phrasing; numbers only if quoted from the brief.",
        "rationale": "string — why closing this gap matters for THIS decision (reference the winner or the factor in plain terms).",
        "evidence_type": "one of: internal_data | market_research | expert_input | customer_research",
        "decision_hygiene": "string — a behavioural-science habit to pair with the data-gathering, e.g. 'Estimate the answer before looking at the data', 'Assign someone to argue the opposite assumption'."
     }
     // Cover the top 3 EVIDENCE_GAPS by voi. If fewer than 3 exist, cover all of them.
     // Every key MUST be a factor_id present in EVIDENCE_GAPS. Do not invent factors.
     // If EVIDENCE_GAPS is empty, emit {} (an empty object).
  },
  "key_assumptions": [
     "string"
     // Up to 5. A mix of model assumptions ("Edge strengths assume current market conditions hold") and framing assumptions read from the brief ("The brief assumes the competitor timeline is predictable"). Plain language, no IDs, no invented numbers.
  ]
}
</OUTPUT_CONTRACT>

Emit ONLY those two keys as a single JSON object.`;

/**
 * R3 — FRAGILITY / CAVEAT. Owns robustness_explanation, scenario_contexts,
 * flip_thresholds, pre_mortem (optional). Receives the fragile edges + flip
 * thresholds + robustness + option comparison (for alternative-winner label
 * resolution).
 */
export const DECOMPOSE_R3_FRAGILITY_PROMPT = `You explain how solid the result is and what could change it: the stability story, the scenarios that would flip the leader, the tipping points, and a pre-mortem when one is warranted.

${SHARED_VOICE_AND_GROUNDING}

<INPUTS>
- DECISION_CONTEXT: winner {id,label}, runner_up {id,label} or null.
- ROBUSTNESS: {recommendation_stability, overall_confidence, level}.
- FRAGILE_EDGES: array of {edge_id, from_label, to_label, switch_probability, marginal_switch_probability?, alternative_winner_id?, alternative_winner_label?} — most fragile first. May be empty.
- FLIP_THRESHOLD_DATA: array of {factor_id, factor_label, current_value, flip_value, direction, unit?} — tipping points. May be empty.
- OPTION_COMPARISON: options {option_id, option_label} — used only to resolve an alternative_winner_id to a label.
- READINESS: {readiness, headline_type} — sets tone.
</INPUTS>

<OUTPUT_CONTRACT>
{
  "robustness_explanation": {
     "summary": "string — one sentence on how stable the result is. If you cite recommendation_stability, quote it as its percentage equivalent (0.71 → 'about 71%').",
     "primary_risk": "string — the single biggest threat, a specific edge or factor named by its label.",
     "stability_factors": ["string"],   // up to 3 — what anchors the result
     "fragility_factors": ["string"]     // up to 3 — what could flip it; reference edges as from_label → to_label
  },
  "scenario_contexts": {
     "<edge_id>": {
        "trigger_description": "string — 'If [condition using from_label / to_label]…'. Avoid numerals unless they appear in the brief.",
        "consequence": "string — MUST name BOTH the resolved alternative-winner label AND winner.label exactly, e.g. '…then [alternative label] overtakes [winner.label]'."
     }
     // Selection: keep only FRAGILE_EDGES that have an alternative_winner_label OR an alternative_winner_id resolvable via OPTION_COMPARISON. Rank by marginal_switch_probability (fallback switch_probability). Take up to 3. Keys MUST be edge_ids from FRAGILE_EDGES. Do not restate switch probabilities in prose — use 'could flip if…'. If none qualify, emit {}.
  },
  "flip_thresholds": [
     {
        "factor_id": "string (from FLIP_THRESHOLD_DATA)",
        "factor_label": "string",
        "current_display": "string — the DISPLAY form of current_value. TWO CASES, and only two. (1) The value carries a unit: quote it verbatim with the unit appended ('16000 GBP', '800 customers'). (2) The value carries no unit and lies between 0 and 1: it is probability-like, so use the PERCENTAGE form ('35%', never '0.35'). A bare decimal here is a banned raw decimal and discards the card.",
        "flip_display": "string — the DISPLAY form of flip_value, same two cases, same rule",
        "narrative": "string — 1-2 sentences: 'If [factor_label] moves from [current_display] to [flip_display], the result changes.' Restate the values in the SAME display form used in those two fields, never the raw input value. Use the label, never the id."
     }
     // Take the first 2 FLIP_THRESHOLD_DATA entries (in order) whose flip_value is not null. Never invent a unit the input did not carry, and never convert between units. If none qualify, emit [] (do not omit).
  ],
  "pre_mortem": {
     // OPTIONAL — include ONLY when readiness is 'ready' or 'close_call' AND (FRAGILE_EDGES is non-empty OR there is at least one input risk to ground in). Omit the key entirely otherwise.
     "failure_scenario": "string — a specific 'it failed because…' referencing an actual edge or factor.",
     "warning_signs": ["string"],   // up to 3, observable and actionable
     "mitigation": "string — one concrete risk-reduction step.",
     "grounded_in": ["string"],     // MUST be non-empty — edge_ids from FRAGILE_EDGES or factor_ids from the inputs
     "review_trigger": "string, optional — 'Reconvene if [condition] [qualitative timeframe]'. Use qualitative timeframes ('before launch', 'next planning cycle'); no invented durations or percentages."
  }
}
</OUTPUT_CONTRACT>

If FRAGILE_EDGES is empty, set robustness_explanation from ROBUSTNESS alone, scenario_contexts: {}, and omit pre_mortem. Emit ONLY the keys above as a single JSON object.`;

/**
 * R4 — CALIBRATION / BIAS FRAMING. Owns bias_findings, decision_quality_prompts,
 * framing_check (optional). The calibrated-uncertainty framing the v11 monolith
 * predates. Receives the model critiques + brief + confidence signals.
 */
export const DECOMPOSE_R4_CALIBRATION_PROMPT = `You add the reflective, calibration layer of the review: grounded bias questions, named decision-quality prompts matched to this situation, and a framing check when the options do not fit the stated goal.

${SHARED_VOICE_AND_GROUNDING}

<INPUTS>
- BRIEF: the user's decision description.
- MODEL_CRITIQUES: array of {type, severity, message, suggested_action?, affected_node_ids?} — structural critiques from the engine. May be empty.
- FACTOR_SENSITIVITY: array of {factor_label, elasticity} — to spot a single dominant factor.
- CALIBRATION: {overall_confidence, headline_type, winner_win_probability, readiness, option_count}.
</INPUTS>

<OUTPUT_CONTRACT>
{
  "bias_findings": [
     {
        "type": "string — a bias type",
        "source": "structural | semantic",
        "description": "string — framed as a REFLECTIVE QUESTION ('One factor appears to dominate — is that concentration intentional?'), never an accusation.",
        "affected_elements": [],   // leave [] unless you can cite a valid node/edge id; never guess ids
        "suggested_action": "string — qualitative, no invented numbers",
        "linked_critique_code": "string — REQUIRED for source 'structural'; must equal the MODEL_CRITIQUES entry's type",
        "brief_evidence": "string — REQUIRED for source 'semantic'; an EXACT substring of the brief, 12 characters or more, copied verbatim"
     }
     // Up to 3. Prefer structural findings grounded in MODEL_CRITIQUES. Only emit a semantic finding if you can copy a clean exact substring (>=12 chars) from the brief. If you cannot ground a finding, do not emit it. If nothing is grounded, emit [].
     // If FACTOR_SENSITIVITY shows one factor's absolute elasticity far above the rest, you may raise a DOMINANT_FACTOR reflective question ONLY as a semantic-free structural note if a matching critique exists; otherwise raise it in the question text without a synthetic critique code.
  ],
  "decision_quality_prompts": [
     {
        "question": "string — MUST end with '?'",
        "principle": "string — a named principle (see table)",
        "applies_because": "string — why it fits this decision"
     }
     // Up to 3. Match to context:
     //   readiness ready|close_call        → Pre-mortem (Klein): 'This failed because…?'
     //   overall_confidence < 0.5          → Outside View (Kahneman): 'Base rate for decisions like this?'
     //   clear_winner & win_prob > 0.7     → Disconfirmation: 'What would make you switch?'
     //   close_call                        → 10-10-10 (Welch): 'How will you feel in 10 minutes / months / years?'
     //   option_count >= 3                 → Opportunity Cost: 'What are you giving up?'
  ],
  "framing_check": {
     // OPTIONAL — include ONLY if the options do not address the stated goal, or the goal is framed as an action rather than an outcome. Omit the key entirely otherwise.
     // POLARITY: because the key exists ONLY when there IS a framing concern, "addresses_goal" is ALWAYS false when you emit this object. Never emit "addresses_goal": true — if the options do address the stated goal, omit the whole key.
     "addresses_goal": false,
     "concern": "string — REQUIRED whenever you emit this key: name which framing problem you found, in one sentence. Say plainly whether the OPTIONS do not address the stated goal, or the GOAL is stated as an action rather than an outcome — a reader must be able to tell which without guessing.",
     "suggested_reframe": "string, optional — if the goal is stated as an action, restate it as the outcome the team actually wants"
  }
}
</OUTPUT_CONTRACT>

Emit ONLY the keys above as a single JSON object; omit framing_check unless a concern is detected.`;
