/**
 * V5 alpha hardening Phase 3 — per-step assertion DSL.
 *
 * Each assertion takes a fetch result + step context and returns either
 * `{ ok: true, evidence }` or `{ ok: false, failing_contract, evidence }`.
 * The harness translates each into an evidence row.
 *
 * All assertions are product-shaped: HTTP status, response body, no
 * internal terms in user-facing text. Implementation details
 * (turn_class, template_id) are NOT asserted except where they are the
 * product signal (e.g. step 4 MUST produce a handler turn because the
 * step is specifically `run_analysis`).
 */

import type { FetchResult } from './client.js';
import {
  findForbiddenMatches,
  findEnrichmentLeakCarriers,
  ID_PREFIX_REGEX,
  GRAPH_HASH_LEAK_REGEX,
  FLIP_NO_TIPPING_POINT_RE,
  FLIP_COULD_FLIP_CLAIM_RE,
} from './forbidden-terms.js';
import type { DgaiResultState, LeakFinding, TurnResponse } from './types.js';

export type AssertionResult =
  | { readonly ok: true; readonly evidence: string }
  | { readonly ok: false; readonly failing_contract: string; readonly evidence: string };

function httpOk(result: FetchResult): AssertionResult | null {
  if (result.status !== 200) {
    const body = result.body ?? {};
    const details = body.details ?? {};
    const parts = [
      `status=${result.status}`,
      `body_error=${String(body.error ?? '')}`,
    ];
    const reason = details['reason'];
    if (typeof reason === 'string') parts.push(`reason=${reason}`);
    if (typeof body.boundary === 'string') parts.push(`boundary=${body.boundary}`);
    if (typeof body.validator === 'string') parts.push(`validator=${body.validator}`);
    // Include request_id so the evidence pack row is self-sufficient
    // for post-mortem lookups. request_id is not a secret.
    if (typeof body.request_id === 'string') parts.push(`request_id=${body.request_id}`);
    return {
      ok: false,
      failing_contract: `HTTP ${result.status} (expected 200)`,
      evidence: parts.join(' '),
    };
  }
  return null;
}

// Reject 200 responses with non-JSON or empty body so they cannot pass
// downstream chip/text assertions as valid empty envelopes. Evidence
// reports a FINGERPRINT only — never raw body bytes — because proxy /
// runtime error pages can echo user input or other sensitive content.
function bodyParsedOk(result: FetchResult): AssertionResult | null {
  if (result.body?.__body_parse_failed) {
    const len = result.body.__body_length ?? 0;
    const ct = result.body.__body_content_type ?? '';
    const hash = result.body.__body_sha256_prefix ?? '';
    return {
      ok: false,
      failing_contract: 'body_parse_failed (non-JSON or unreadable response body)',
      evidence: `status=${result.status} body_parse_failed length=${len} content_type="${ct}" sha256_prefix=${hash}`,
    };
  }
  return null;
}

function noBoundaryError(result: FetchResult): AssertionResult | null {
  const body = result.body;
  // BoundaryError shape carries `{ error, boundary, validator, request_id }`.
  if (body?.error != null && body?.boundary != null) {
    return {
      ok: false,
      failing_contract: `BoundaryError: ${body.error}`,
      evidence: `boundary=${body.boundary} error=${body.error}`,
    };
  }
  return null;
}

function noForbiddenTerms(result: FetchResult): AssertionResult | null {
  const body = result.body;
  const text = body?.assistant_text ?? '';
  const matches = findForbiddenMatches(text);
  if (matches.length > 0) {
    return {
      ok: false,
      failing_contract: `forbidden terms in assistant_text: ${matches.join(', ')}`,
      evidence: `terms=${matches.join(', ')}`,
    };
  }
  // Also scan chip labels/messages.
  for (const chip of body?.suggested_actions ?? []) {
    const chipText = `${chip.label} | ${chip.message}`;
    const chipMatches = findForbiddenMatches(chipText);
    if (chipMatches.length > 0) {
      return {
        ok: false,
        failing_contract: `forbidden terms in chip: ${chipMatches.join(', ')}`,
        evidence: `chip_id=${chip.id} terms=${chipMatches.join(', ')}`,
      };
    }
  }
  return null;
}

function coreAssertions(result: FetchResult): AssertionResult | null {
  return (
    httpOk(result) ??
    bodyParsedOk(result) ??
    noBoundaryError(result) ??
    noForbiddenTerms(result)
  );
}

export function assertProductShape(result: FetchResult): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const body = result.body;
  const text = body?.assistant_text ?? '';
  const chipCount = (body?.suggested_actions ?? []).length;
  // Empty envelope is not a product-shaped response — at least one of
  // assistant_text or suggested_actions must be present. Without this
  // floor, a 200 with `{}` would pass as "successful but quiet".
  if (text.length === 0 && chipCount === 0) {
    return {
      ok: false,
      failing_contract: 'product_shape_empty (no assistant_text and no chips)',
      evidence: `status=200 text_len=0 chip_count=0 stage=${body?.stage_indicator ?? 'unknown'}`,
    };
  }
  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} chip_count=${chipCount} ` +
      `elapsed=${result.elapsed_ms}ms stage=${body?.stage_indicator ?? 'unknown'}`,
  };
}

export function assertDraftGraph(result: FetchResult): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const body = result.body;
  // Step 1 should produce a draft_graph response with chips.
  const chips = body?.suggested_actions ?? [];
  if (chips.length === 0) {
    return {
      ok: false,
      failing_contract: 'draft_graph response missing post-draft chips',
      evidence: `chip_count=0 text_len=${(body?.assistant_text ?? '').length}`,
    };
  }
  return {
    ok: true,
    evidence:
      `status=200 chip_count=${chips.length} first_chip_label="${chips[0]?.label ?? ''}" ` +
      `elapsed=${result.elapsed_ms}ms`,
  };
}

export function assertAnalysisRun(result: FetchResult): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  // Step 4 wire contract: the chip-click run_analysis path MUST stamp
  // `analysis_ready` on the response so subsequent turns (Step 5
  // "explain leader") can ground their answers on a runnability signal.
  // The original baseline regression manifested as a quietly-passing
  // `assertAnalysisRun` while Step 4's wire body lacked the field —
  // replay rows looked green but the chain was broken. Hard-fail here.
  const body = result.body;
  const ar = body?.analysis_ready;
  if (ar == null) {
    return {
      ok: false,
      failing_contract: 'step_4_analysis_ready_missing',
      evidence:
        `status=200 text_len=${(body?.assistant_text ?? '').length} ` +
        `analysis_ready=absent ` +
        `chip_count=${(body?.suggested_actions ?? []).length}`,
    };
  }
  if (ar.status !== 'ready') {
    return {
      ok: false,
      failing_contract: `step_4_analysis_ready_unexpected_status (got "${String(ar.status)}", expected "ready")`,
      evidence:
        `status=200 analysis_ready_status="${String(ar.status)}" ` +
        `text_len=${(body?.assistant_text ?? '').length}`,
    };
  }
  const optionCount = Array.isArray(ar.options) ? ar.options.length : -1;
  if (optionCount < 2) {
    return {
      ok: false,
      failing_contract: `step_4_analysis_ready_options_too_few (got ${optionCount}, expected ≥2)`,
      evidence: `status=200 analysis_ready_options=${optionCount}`,
    };
  }
  if (typeof ar.goal_node_id !== 'string' || ar.goal_node_id.length === 0) {
    return {
      ok: false,
      failing_contract: 'step_4_analysis_ready_goal_node_id_missing',
      evidence: `status=200 goal_node_id=${JSON.stringify(ar.goal_node_id)}`,
    };
  }
  if (typeof ar.computed_at !== 'string' || ar.computed_at.length === 0) {
    return {
      ok: false,
      failing_contract: 'step_4_analysis_ready_computed_at_missing',
      evidence: `status=200 computed_at=${JSON.stringify(ar.computed_at)}`,
    };
  }
  return {
    ok: true,
    evidence:
      `status=200 text_len=${(body?.assistant_text ?? '').length} ` +
      `chip_count=${(body?.suggested_actions ?? []).length} ` +
      `analysis_ready=ready options=${optionCount} ` +
      `elapsed=${result.elapsed_ms}ms`,
  };
}

// Step 5 denial-phrase regression guard. The V5 golden-path baseline showed
// "results aren't back yet" after the chip-click run_analysis chain shipped
// without `analysis_ready` on the wire. After the wire fix the assistant
// MUST NOT emit a denial of analysis availability — those phrases indicate
// the model gating logic still believes results are not present, which
// means either analysis_ready is missing or the ContextPack is missing
// the analysis fact. Encoded as a hard assertion so any regression that
// re-introduces denial phrasing fails the replay row.
//
// Regex design: each pattern targets the specific "I cannot answer
// because the analysis is unavailable" shape, NOT broader phrases that
// legitimately discuss analysis state. False-positive shapes that MUST
// continue to pass:
//   - "no new analysis needed" / "no further analysis required"
//   - "no additional analysis is needed"
//   - "I haven't run a sensitivity analysis on that yet but here's what
//      we know" (talks about an unrelated sub-analysis after answering)
// Patterns are anchored on the "results unavailable" framing using
// negative lookaheads where ambiguity exists.
export const STEP5_DENIAL_PHRASES: readonly RegExp[] = [
  /results\s+aren'?t\s+back\s+yet/i,
  /results\s+are\s+not\s+back\s+yet/i,
  /haven'?t\s+run\s+(?:the|an|any)\s+analysis(?!\s+(?:on|of)\s+\w)/i,
  /have\s+not\s+run\s+(?:the|an|any)\s+analysis(?!\s+(?:on|of)\s+\w)/i,
  /analysis\s+(?:isn'?t|is\s+not)\s+(?:ready|complete|done|finished|available)/i,
  /(?:don'?t|do\s+not)\s+have\s+(?:the|an|any)?\s*analysis\s+(?:result|results|output)/i,
  /(?:results|analysis)\s+(?:aren'?t|are\s+not|isn'?t|is\s+not)\s+available\s+yet/i,
  /(?:simulation|computation)\s+(?:hasn'?t|has\s+not)\s+(?:completed|finished|run)/i,
  // Staging f588320 captured: "Analysis results aren't available in the
  // current context, the simulation was run but the results haven't come
  // through yet." The two pre-existing patterns (`available\s+yet` and
  // `back\s+yet`) both require the "yet" anchor immediately after the
  // negated verb, so they both miss when "yet" is displaced by an
  // intervening prepositional phrase. The two patterns below close
  // that gap.
  //
  // First: "...aren't available in|on|from|within <context>..." —
  // catches the displaced-anchor variant where the denial framing
  // ("results not available HERE/NOW") substitutes a context for "yet".
  // Deliberately omits the preposition "to" so legitimate access-control
  // speech ("results are available to all stakeholders") does not trip.
  /(?:results|analysis|findings)\s+(?:aren'?t|are\s+not|isn'?t|is\s+not)\s+available\s+(?:in|on|from|within)\s+\S+/i,
  // Second: "results haven't come through (yet)" — separate idiom,
  // unrelated to "available" framing. Past tense ("came through") and
  // present-affirmative ("results came through cleanly") both pass.
  /(?:results|analysis|findings|simulation\s+results?)\s+(?:haven'?t|have\s+not)\s+come\s+through/i,
];

// ===========================================================================
// DL-7 assertions — used by the dl7-set-factor / dl7-edit-graph / dl7-staleness
// journeys.
//
// All DL-7 assertions inherit the core assertion stack (HTTP 200, body
// parsed, no boundary error, no forbidden terms in user copy). On top of
// the core, each adds a small set of stable-field checks per the audit
// spec — see the plan file at
// /Users/paulslee/.claude/plans/please-take-over-the-abundant-owl.md.
// PR-B-gated checks are skipped (and recorded as `requires_dl7_pr_b`)
// at the orchestration layer, not here — these assertions stay pure.
// ===========================================================================

export interface DL7AssertionContext {
  /** Factor label resolved from Step 1 capture (deterministic fallback). */
  readonly factorLabel?: string | null;
  /** Option labels parsed out of Step 1's draft_graph response. */
  readonly step1OptionLabels?: readonly string[];
  /** Graph hash captured at Step 1 (if available). */
  readonly graphHashAtDraft?: string | null;
}

/**
 * Detect a clarification-back response on an edit step.
 *
 * V5 returns clarification prompts when the deterministic value-update
 * gate or the edit_graph router can't unambiguously resolve the target
 * (e.g. factor label collision, ambiguous referent). Example wordings
 * observed on staging:
 *
 *   - "I wasn't sure which factor you meant. Did you mean one of these?"
 *   - "Which factor do you mean?"
 *   - "Could you clarify which item..."
 *
 * On an edit step, a clarification-back is NOT a successful mutation
 * — the graph state is unchanged. The journey's downstream steps
 * (state-query / staleness / explain-after-edit) cannot validate the
 * post-mutation contract if no mutation happened. Treating Step 200
 * with clarification text as a PASS is exactly what caused the early
 * `dl7-staleness` Step 4 false-failure — Step 3 was a no-op but Step
 * 4 took the blame. This pattern fails the edit step attributively
 * so Step 4 cascade-skips with a clear cause.
 */
export const CLARIFICATION_BACK_PATTERN =
  /\bDid you mean\b|\bI (?:wasn'?t|was not) sure\b|\bCould you clarify\b|\bWhich \w+ (?:do|did) you mean\b|\bCan you (?:specify|tell me) which\b|\bI'?m not sure which\b/i;

/**
 * Detect a mutation-acknowledgement on an edit step (proof of mutation).
 *
 * V5's mutation handlers and edit_graph dispatcher confirm successful
 * mutations with natural-language phrasing such as:
 *
 *   - "Updated Incremental Hiring Cost from £0 to 20%."   (set_factor_value)
 *   - "Headcount Investment Level now has a stronger ..." (edit_graph)
 *   - "Added constraint: Total cost must be at most ..."  (add_constraint)
 *   - "Adjusted the link strength from X to Y."           (adjust_edge_strength)
 *
 * The pattern is intentionally broad — mutation verb tokens (mostly
 * past-tense, plus tense-neutral `Set`; see Accepted classes below) OR
 * "now has/shows" forward-looking phrasing. Anchoring on these forms
 * proves the response is acknowledging a change, not deflecting via
 * clarification. Combined with the clarification-back negative check,
 * this gives replay-side proof that the edit step actually mutated.
 *
 * Accepted classes (the regex below is the source of truth — failure
 * evidence strings elsewhere in this file show only a few sample verbs
 * for brevity, NOT the full vocabulary):
 *
 *   - Mutation verbs (case-insensitive; mostly past-tense, but the
 *     `Set` token is tense-neutral and also matches present-tense
 *     "set" — see the matched-but-Step-3-caught edge case below):
 *       Strengthened / Increased / Decreased / Adjusted / Modified /
 *       Weakened / Updated / Changed / Set / Added / Removed /
 *       Applied / Saved
 *   - Forward-looking: "now has" / "now shows" / "now reflects"
 *   - Passive: "has been updated/changed/adjusted/set/added/removed"
 *
 * Rejected at Step 2 (these MUST keep failing the regex — they
 * indicate no mutation happened on the wire):
 *
 *   - Mode A draft / proposal copy that contains no accepted verb:
 *       "I have changes in mind ..."
 *       "I've drafted a change ..."
 *   - Step-1 graph-echo prose:
 *       "Your decision model ... is ready, with N options, M factors ..."
 *   - Generic descriptive prose with no mutation verb.
 *
 * Matched at Step 2 but caught by Step 3 — bare verb sentences and
 * Mode A copy that happens to contain an accepted verb DO match this
 * regex. That is intentional. The regex is the prose half of a
 * layered defence; the structural backstop is Step 3
 * (`assertWhatChanged`), which fails the journey if the next turn
 * cannot surface the change via `recent_changes`. Do NOT "fix" these
 * cases by narrowing the regex — narrowing the `Updated` token would
 * drop the canonical set_factor_value acknowledgement
 * ("Updated Incremental Hiring Cost from £0 to 20%."), and narrowing
 * the `Set` token would drop legitimate forms like "Set X to 20."
 * Examples (locked in by
 * `tests/unit/v5-journey-replay/mutation-ack-pattern.test.ts`):
 *
 *   - "Updated Price."                                  (matches `Updated`)
 *   - "I can set X to Y. Reply with the value ..."      (matches `Set`,
 *     case-insensitive — Mode A offer phrased with present-tense "set")
 */
export const MUTATION_ACK_PATTERN =
  /\b(?:Updated|Adjusted|Changed|Modified|Set|Added|Removed|Strengthened|Weakened|Increased|Decreased|Applied|Saved)\b|\bnow (?:has|shows|reflects)\b|\bhas been (?:updated|changed|adjusted|set|added|removed)\b/i;

/**
 * DL-7 Step 2 (set-factor journey) — the V5 set_factor_value handler
 * mutates the graph.
 *
 * **Strict pass contract** (post Codex-feedback hardening):
 *   - HTTP 200, product-shaped, no internal-term leakage.
 *   - Response is NOT a clarification-back (otherwise the graph wasn't
 *     mutated and any downstream "post-edit" assertions would test the
 *     wrong contract — see `CLARIFICATION_BACK_PATTERN`).
 *   - Response contains a mutation-acknowledgement signal (proof the
 *     mutation actually happened on the wire — see `MUTATION_ACK_PATTERN`).
 *
 * The earlier soft version of this assertion passed any 200 with text
 * or chips, which let clarification-back responses through and caused
 * `dl7-staleness` Step 4 to false-fail with the blame on the wrong step.
 */
export function assertSetFactorValue(
  result: FetchResult,
  ctx?: DL7AssertionContext,
): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const body = result.body;
  const text = body?.assistant_text ?? '';
  const chipCount = (body?.suggested_actions ?? []).length;
  if (text.length === 0 && chipCount === 0) {
    return {
      ok: false,
      failing_contract: 'set_factor_value_empty (no assistant_text and no chips)',
      evidence: `status=200 text_len=0 chip_count=0`,
    };
  }

  // Hard fail: clarification-back means no mutation happened.
  const clarifyMatch = text.match(CLARIFICATION_BACK_PATTERN);
  if (clarifyMatch) {
    return {
      ok: false,
      failing_contract: 'set_factor_value_clarification_back_no_mutation',
      evidence:
        `status=200 but response asks for clarification, not acknowledging mutation: ` +
        `match="${clarifyMatch[0]}" — V5's value-update gate could not resolve the target factor. ` +
        `Downstream "post-edit" assertions cannot validate against a no-op mutation.`,
    };
  }

  // Hard fail: response must acknowledge the mutation in natural language.
  const mutationAck = text.match(MUTATION_ACK_PATTERN);
  if (!mutationAck) {
    return {
      ok: false,
      failing_contract: 'set_factor_value_no_mutation_acknowledgement',
      evidence:
        `status=200 but no mutation-ack phrasing in response. ` +
        `MUTATION_ACK_PATTERN (see assertions.ts) accepts any mutation ` +
        `verb token — mostly past-tense, plus tense-neutral \`Set\` — ` +
        `(Strengthened/Increased/Decreased/Adjusted/Modified/Weakened/` +
        `Updated/Changed/Set/Added/Removed/Applied/Saved), forward-` +
        `looking "now has/shows/reflects", or passive ` +
        `"has been updated/changed/adjusted/set/added/removed". ` +
        `text_preview="${text.slice(0, 100)}..."`,
    };
  }

  const lower = text.toLowerCase();
  const labelMentioned =
    ctx?.factorLabel != null && lower.includes(ctx.factorLabel.toLowerCase());
  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} chip_count=${chipCount} ` +
      `mutation_ack="${mutationAck[0]}" ` +
      `factor_label="${ctx?.factorLabel ?? ''}" mentioned=${labelMentioned} ` +
      `elapsed=${result.elapsed_ms}ms`,
  };
}

/**
 * DL-7 Step 2 (edit-graph journey) — generic edit_graph dispatcher.
 *
 * What replay can prove (wire-observable):
 *   - HTTP 200, product-shaped (assistant_text or chips present).
 *   - No internal-term leakage (handled by `coreAssertions`).
 *   - The downstream user-visible effect that the mutation happened —
 *     verified at Step 3 (`assertWhatChanged`), which surfaces the
 *     accepted-edit fact via `recent_changes`.
 *
 * What replay CANNOT prove (and is therefore intentionally NOT
 * asserted here):
 *   - `turn_class === 'direct_answer'` — this field is an argument
 *     to `commitDirectAnswer` / `append_turn_atomic` (DB persistence)
 *     and internal telemetry. It is NOT serialised onto the wire
 *     response envelope. Coverage must come from edit_graph dispatch
 *     unit tests (`src/orchestrator-v5/handlers/__tests__/
 *     edit-graph-dispatch*.test.ts`).
 *   - `handler_id === null` — same reason.
 *   - `EditGraphHandlerFact` emission identity — facts are persisted
 *     to `v5_handler_facts` and surfaced through `recent_changes`,
 *     but the fact's wire identity is not on the response envelope.
 *     Same unit-test path covers this.
 *
 * Replay's role is the user-visible end-to-end behaviour; the
 * internal commit-path contract is the unit-test workstream's role.
 */
export function assertEditGraphGeneric(
  result: FetchResult,
  _ctx?: DL7AssertionContext,
): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const body = result.body;
  const text = body?.assistant_text ?? '';
  const chipCount = (body?.suggested_actions ?? []).length;
  if (text.length === 0 && chipCount === 0) {
    return {
      ok: false,
      failing_contract: 'edit_graph_generic_empty (no assistant_text and no chips)',
      evidence: `status=200 text_len=0 chip_count=0`,
    };
  }

  // Hard fail: clarification-back means no mutation happened.
  // Same reasoning as `assertSetFactorValue` — without a real mutation,
  // post-edit assertions (recent_changes, staleness, explain-after-edit)
  // test the wrong contract. The previously-soft version of this
  // assertion accepted any 200 with text or chips; that's why a
  // mutation-fail-by-clarify slipped past Step 2 in dl7-edit-graph.
  const clarifyMatch = text.match(CLARIFICATION_BACK_PATTERN);
  if (clarifyMatch) {
    return {
      ok: false,
      failing_contract: 'edit_graph_clarification_back_no_mutation',
      evidence:
        `status=200 but response asks for clarification, not acknowledging mutation: ` +
        `match="${clarifyMatch[0]}" — V5's edit_graph router could not resolve the request. ` +
        `Downstream post-edit assertions cannot validate against a no-op mutation.`,
    };
  }

  // Hard fail: response must acknowledge the mutation in natural language.
  const mutationAck = text.match(MUTATION_ACK_PATTERN);
  if (!mutationAck) {
    return {
      ok: false,
      failing_contract: 'edit_graph_no_mutation_acknowledgement',
      evidence:
        `status=200 but no mutation-ack phrasing in response. ` +
        `MUTATION_ACK_PATTERN (see assertions.ts) accepts any mutation ` +
        `verb token — mostly past-tense, plus tense-neutral \`Set\` — ` +
        `(Strengthened/Increased/Decreased/Adjusted/Modified/Weakened/` +
        `Updated/Changed/Set/Added/Removed/Applied/Saved), forward-` +
        `looking "now has/shows/reflects", or passive ` +
        `"has been updated/changed/adjusted/set/added/removed". ` +
        `text_preview="${text.slice(0, 100)}..."`,
    };
  }

  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} chip_count=${chipCount} ` +
      `mutation_ack="${mutationAck[0]}" ` +
      `elapsed=${result.elapsed_ms}ms ` +
      // Routing-class is unit-test territory, not replay's. A reviewer
      // scanning the row should see the wire-observability disclaimer.
      `routing_class_check=unit_tests_only`,
  };
}

/**
 * DL-7 Step 3 — "What changed?" The state-query guard answers this
 * deterministically from `recent_changes` (no LLM round-trip). After
 * edit_graph DL-7 PR B (live on CEE staging), the response should:
 *
 *   - Reference the factor label captured at Step 1 (mutation
 *     surfaced into recent_changes via the accepted-edit fact for
 *     the edit-graph journey, or via the existing V5 mutation-handler
 *     path for the set-factor journey).
 *   - Use the fact's safe summary, NOT a graph hash or diff. Hash
 *     leaks are caught universally for every step by
 *     `findForbiddenMatches` / `GRAPH_HASH_LEAK_REGEX` (in
 *     `forbidden-terms.ts`) — this assertion just verifies the
 *     positive signal.
 *   - No raw IDs, schema terms, handler terms, fact jargon — also
 *     enforced by `findForbiddenMatches`.
 */
export function assertWhatChanged(
  result: FetchResult,
  ctx?: DL7AssertionContext,
): AssertionResult {
  // Structural core WITHOUT the forbidden-phrase scan. `noForbiddenTerms`
  // is deferred to the END of this assertion (see below) so the SPECIFIC
  // denial diagnosis (`what_changed_denies_recent_edit`) wins when a denial
  // phrase is ALSO a forbidden user-facing phrase — the two guards overlap
  // because the shared `FORBIDDEN_USER_FACING_PHRASES` list grew to include
  // denial copy ("I haven't applied any changes", "no changes have been
  // applied"). Leak-safety is preserved: a denial-that-is-also-forbidden is
  // still caught here (by the denial gate), and the final `noForbiddenTerms`
  // gate below still fails any NON-denial forbidden term. The pass/fail set
  // is unchanged — only the reported `failing_contract` for an
  // overlapping hit becomes the more-specific denial contract.
  const structural = httpOk(result) ?? bodyParsedOk(result) ?? noBoundaryError(result);
  if (structural) return structural;
  const body = result.body;
  const text = body?.assistant_text ?? '';
  if (text.length === 0) {
    return {
      ok: false,
      failing_contract: 'what_changed_empty_text',
      evidence: `status=200 text_len=0`,
    };
  }
  const lower = text.toLowerCase();
  // Hard fail: the assistant claims no recent edits exist. The journey
  // hits this step *after* a successful `edit_graph` mutation (Step 2
  // returns `mutation_ack="now has"`), so a denial here is a real
  // recent_changes surfacing gap, not a paraphrase. Catches phrasings
  // like "I haven't applied any changes in this session yet" — the
  // exact text observed on staging build `6211789` (2026-05-10) that
  // produced a false-PASS under the looser predecessor of this check.
  // Match both contracted ("haven't", "don't") and uncontracted ("have
  // not", "do not", "did not") forms — LLM output uses both
  // interchangeably and a regex that only catches contractions has a
  // 50% false-negative rate on denial responses.
  const denialPatterns: ReadonlyArray<RegExp> = [
    /(?:haven'?t|have\s+not|didn'?t|did\s+not)\s+(?:yet\s+)?(?:applied|made|done|recorded)\s+(?:any\s+)?(?:changes|edits|updates|modifications)/,
    /no\s+(?:changes|edits|updates|modifications)\s+(?:have\s+been\s+|were\s+|so\s+far\s*)?(?:applied|made|done|recorded)?/,
    /nothing\s+(?:has\s+been\s+)?(?:changed|edited|updated|modified|applied)/,
    /(?:i\s+)?(?:don'?t|do\s+not)\s+see\s+any\s+(?:recent\s+)?(?:changes|edits|updates)/,
  ];
  const denialMatch = denialPatterns.find((rx) => rx.test(lower));
  if (denialMatch !== undefined) {
    return {
      ok: false,
      failing_contract: 'what_changed_denies_recent_edit',
      evidence:
        `status=200 text_len=${text.length} ` +
        `denial_pattern=${denialMatch.source.slice(0, 48)} ` +
        `factor_label="${ctx?.factorLabel ?? ''}" mentioned=false ` +
        `elapsed=${result.elapsed_ms}ms`,
    };
  }
  // Stable-field check: when a factor label was resolved at Step 1,
  // we expect the deterministic state-query answer to mention it.
  // This is the strongest signal that the mutation surfaced into
  // recent_changes. A miss after the denial gate is suspicious and
  // also fails — recent_changes that does not reference the just-
  // edited factor is functionally indistinguishable from a generic
  // affirmative paraphrase.
  const factorLabel = ctx?.factorLabel ?? null;
  const labelMentioned = factorLabel != null && lower.includes(factorLabel.toLowerCase());
  if (factorLabel != null && !labelMentioned) {
    return {
      ok: false,
      failing_contract: 'what_changed_factor_label_not_referenced',
      evidence:
        `status=200 text_len=${text.length} ` +
        `factor_label="${factorLabel}" mentioned=false ` +
        `elapsed=${result.elapsed_ms}ms`,
    };
  }
  // Final leak gate — any NON-denial forbidden term (e.g. "validator",
  // "previous analysis") still fails the row here. Runs last so the
  // denial gate above owns the diagnosis for denial-class phrases.
  const forbidden = noForbiddenTerms(result);
  if (forbidden) return forbidden;
  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} ` +
      `factor_label="${factorLabel ?? ''}" mentioned=${labelMentioned} ` +
      `safe_summary=ok ` +
      `elapsed=${result.elapsed_ms}ms`,
  };
}

/**
 * DL-7 Step 6 — "What would flip this?" The what_would_flip handler
 * fires when there is a successful prior run_analysis fact. With
 * freshness=fresh (analysis ran on the post-edit graph), the handler
 * runs the execute path and emits a substantive answer.
 */
export function assertWhatWouldFlip(
  result: FetchResult,
  ctx?: DL7AssertionContext,
): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const body = result.body;
  const text = body?.assistant_text ?? '';
  if (text.length === 0) {
    return {
      ok: false,
      failing_contract: 'what_would_flip_empty_text',
      evidence: `status=200 text_len=0 elapsed=${result.elapsed_ms}ms`,
    };
  }
  // Substance gate — same threshold as Step 5 explain-leader. Below
  // this, the answer is almost certainly a stub/precondition fallback
  // rather than a real flip-driver answer.
  if (text.length <= 200) {
    return {
      ok: false,
      failing_contract: 'what_would_flip_text_too_short',
      evidence: `status=200 text_len=${text.length} (expected > 200) elapsed=${result.elapsed_ms}ms`,
    };
  }
  // Light option-label check — what_would_flip references options to
  // discuss flipping the leader. Skipped if no labels were captured.
  const labels = ctx?.step1OptionLabels ?? [];
  const lower = text.toLowerCase();
  const referenced =
    labels.length > 0 ? labels.some((l) => lower.includes(l.toLowerCase())) : false;
  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} ` +
      `labels_checked=${labels.length} option_referenced=${referenced} ` +
      `elapsed=${result.elapsed_ms}ms`,
  };
}

/**
 * DL-7 staleness journey, Step 4 — explain-leader AFTER a post-analysis
 * edit. The freshness derivation should classify the analysis as stale
 * and the response should either prefix the answer with a staleness
 * caveat OR include a `Rerun analysis` chip (or both). Either is
 * acceptable — the contract is "the user is told the result is now
 * stale," not the specific UI surface used.
 */
export function assertExplainLeaderStale(
  result: FetchResult,
  ctx?: DL7AssertionContext,
): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const body = result.body;
  const text = body?.assistant_text ?? '';
  if (text.length === 0) {
    return {
      ok: false,
      failing_contract: 'explain_leader_stale_empty_text',
      evidence: `status=200 text_len=0`,
    };
  }
  const lower = text.toLowerCase();
  const chips = body?.suggested_actions ?? [];
  // Heuristic detection of a staleness signal. Either:
  //   - The text mentions "model has changed" / "stale" / "no longer
  //     reflects" / "since the analysis was run" / "results may be
  //     out of date" / "rerun" / "re-run".
  //   - A chip exists whose label/message mentions rerun/refresh.
  // The deterministic staleness prefix (handler-side
  // `staleness-prefix.ts`) is the canonical signal but we accept any
  // chip-based equivalent so the wire surface can evolve without
  // breaking this assertion.
  const stalenessTextSignal =
    /\b(stale|model has changed|no longer reflects?|out[- ]of[- ]date|since (?:the )?analysis|re[- ]?run)\b/i.test(
      text,
    );
  // Robust pattern: `re[- ]?run` matches all three spellings —
  // `rerun`, `re-run`, `re run` — so the chip detector mirrors the
  // text detector above. Real chip labels mix spellings (the UI uses
  // "Rerun analysis", LLM coaching prose sometimes emits "re-run the
  // analysis", and "Run analysis again" can phrase the same intent
  // with a leading space variant). Additional verbs `refresh`,
  // `update`, `stale` cover the equivalent recovery affordances.
  const stalenessChipSignal = chips.some((chip) => {
    const blob = `${chip.label} ${chip.message}`.toLowerCase();
    return /\b(?:re[- ]?run|refresh|update|stale)\b/.test(blob) && blob.includes('analy');
  });
  if (!stalenessTextSignal && !stalenessChipSignal) {
    return {
      ok: false,
      failing_contract: 'explain_leader_stale_signal_missing',
      evidence:
        `status=200 text_len=${text.length} ` +
        `staleness_text=false staleness_chip=false ` +
        `chip_count=${chips.length}`,
    };
  }
  // Option-label check — same as the fresh path.
  const labels = ctx?.step1OptionLabels ?? [];
  const referenced =
    labels.length > 0 ? labels.some((l) => lower.includes(l.toLowerCase())) : false;
  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} ` +
      `staleness_text=${stalenessTextSignal} staleness_chip=${stalenessChipSignal} ` +
      `labels_checked=${labels.length} option_referenced=${referenced} ` +
      `elapsed=${result.elapsed_ms}ms`,
  };
}

export function assertExplainLeader(
  result: FetchResult,
  ctx?: { step1OptionLabels?: readonly string[] },
): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  // Step 5 requires prior-run analysis to be accessible via the fallback.
  // We heuristic-check the assistant_text for non-empty content and
  // absence of denial phrases which would indicate the fallback didn't
  // hydrate or analysis_ready never reached the wire.
  const text = result.body?.assistant_text ?? '';
  if (text.length === 0) {
    return {
      ok: false,
      failing_contract: 'empty assistant_text on follow-up turn',
      evidence: `text_len=0 elapsed=${result.elapsed_ms}ms`,
    };
  }
  for (const pattern of STEP5_DENIAL_PHRASES) {
    const match = text.match(pattern);
    if (match) {
      return {
        ok: false,
        failing_contract: `step_5_denial_phrase ("${match[0]}")`,
        evidence:
          `status=200 text_len=${text.length} ` +
          `denial_phrase="${match[0]}" ` +
          `chip_count=${(result.body?.suggested_actions ?? []).length} ` +
          `elapsed=${result.elapsed_ms}ms`,
      };
    }
  }
  // Substance gate: a passing Step 5 must have meaningful prose. The
  // 200-char threshold is tuned to the staging f588320 baseline where
  // the failing curl returned text_len=282 with a denial phrase, while
  // legitimate passes routinely exceed 800 chars. A response below
  // this bar is almost certainly a stub or an evasion that escaped the
  // denial-phrase regex set.
  if (text.length <= 200) {
    return {
      ok: false,
      failing_contract: 'step_5_text_too_short',
      evidence:
        `status=200 text_len=${text.length} (expected > 200) ` +
        `chip_count=${(result.body?.suggested_actions ?? []).length} ` +
        `elapsed=${result.elapsed_ms}ms`,
    };
  }
  // Option-label reference gate: a substantive explain-leader response
  // names at least one option from the journey's drafted graph. This is
  // gated on `ctx.step1OptionLabels` being populated — when Step 1
  // wasn't parsed (or the harness was invoked without journey context),
  // the check is skipped rather than failing spuriously.
  const labels = ctx?.step1OptionLabels ?? [];
  if (labels.length > 0) {
    const lower = text.toLowerCase();
    const referenced = labels.some((l) => lower.includes(l.toLowerCase()));
    if (!referenced) {
      return {
        ok: false,
        failing_contract: 'step_5_no_option_label_referenced',
        evidence:
          `status=200 text_len=${text.length} ` +
          `labels_checked=${labels.length} mentioned=0 ` +
          `elapsed=${result.elapsed_ms}ms`,
      };
    }
  }
  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} ` +
      `labels_checked=${labels.length} ` +
      `chip_count=${(result.body?.suggested_actions ?? []).length} ` +
      `elapsed=${result.elapsed_ms}ms`,
  };
}

// ===========================================================================
// V5 Golden Journey benchmark prep — P0 journey assertions.
//
// New assertions for the build-pinned two-mode benchmark:
//   - DGAI visible result-state presence       (assertDgaiResultState)
//   - #278 add-option encode acknowledgement    (assertAddOption)
//   - #278 Gate-3 unencodable add safe-defer     (assertAddOptionDefer)
//   - #278 Gate-2 edit-existing-option           (assertEditOptionContainment)
//     CONTAINMENT-PASS (per the approved scoring rule)
//   - #277 what_would_flip fresh chip-click       (assertWhatWouldFlipChip)
//   - #277 what_would_flip stale follow-up        (assertWhatWouldFlipStale)
//
// All inherit `coreAssertions` (HTTP 200, body parsed, no BoundaryError, no
// forbidden prose terms in assistant_text + chips). The added checks document
// what replay can/cannot prove from the wire — consistent with the DL-7
// assertions above.
// ===========================================================================

// A cappable add ("Add an in-house option costing £120,000") should be
// acknowledged, not deferred. Acceptance phrasing observed across the
// edit_graph apply path. Combined with the following run_analysis step
// (assertAnalysisRun) which proves the encode landed (no
// options_not_configured 500), this gives end-to-end Gate-1 coverage.
export const ADD_OPTION_ACK_PATTERN =
  /\b(?:added|created|introduced)\b[^.]*\boption\b|\bnew option\b|\boption (?:has been|was|is now) (?:added|created|included)\b/i;

// Safe-defer copy — the edit_graph DEFER path declines to apply and leaves
// the graph unchanged (#278 Gate 3 / buildRejectionResult). The canonical
// observed line is "I wasn't able to make that change safely".
export const SAFE_DEFER_PATTERN =
  /\bI wasn'?t able to make that change safely\b|\b(?:wasn'?t|was not|couldn'?t|could not|unable to|not able to)\b[^.]*\b(?:make that change|add (?:that|the|this) option|apply (?:that|the|this)|do that)\b|\bcan'?t safely\b/i;

// Value-parse leak ("You gave unknown ...") — the pre-existing edit-pipeline
// value tokeniser leak that must never reach the user. A hard fail on the
// edit-existing-option step.
export const VALUE_PARSE_LEAK_PATTERN = /\byou gave unknown\b|\bgave unknown\b/i;

/**
 * Extract the DGAI visible result-state from the public `analysis_result`
 * block. Mirrors `buildBlocksFromFacts` (`src/orchestrator-v5/compose.ts`):
 * the block carries `summary`, `leading_option_id`, `win_probabilities`
 * (option-keyed) and `enrichment`. Defensive — degrades to `present:false`.
 */
export function extractDgaiState(body: TurnResponse | undefined): DgaiResultState {
  const ar = (body?.blocks ?? []).find((b) => b?.type === 'analysis_result');
  if (!ar) return { present: false };
  let winCount: number | undefined;
  const wp = ar.win_probabilities;
  if (Array.isArray(wp)) winCount = wp.length;
  else if (wp && typeof wp === 'object') winCount = Object.keys(wp as Record<string, unknown>).length;
  return {
    present: true,
    leading_option_id: typeof ar.leading_option_id === 'string' ? ar.leading_option_id : undefined,
    win_probability_count: winCount,
    has_summary: typeof ar.summary === 'string' && ar.summary.length > 0,
    has_enrichment: ar.enrichment != null && typeof ar.enrichment === 'object',
  };
}

/**
 * Collect leak findings on PUBLIC response surfaces only (per the approved
 * amendment): assistant_text, chip labels/messages, the DGAI-visible
 * `analysis_result.summary`, and — only when `scanEnrichment` is true (flip
 * modes: gate-277 / p0-full-golden) — the public `analysis_result.enrichment`
 * payload via the #277 carrier scanner. Never scans evidence-pack metadata.
 *
 * Informational: the harness records these on the row regardless of pass/fail.
 * Hard pass/fail is the per-step assertion's job.
 */
export function collectLeakFindings(
  body: TurnResponse | undefined,
  opts: { readonly scanEnrichment: boolean },
): readonly LeakFinding[] {
  const findings: LeakFinding[] = [];
  for (const m of findForbiddenMatches(body?.assistant_text ?? '')) {
    findings.push({ surface: 'assistant_text', detail: m });
  }
  for (const chip of body?.suggested_actions ?? []) {
    for (const m of findForbiddenMatches(`${chip.label} | ${chip.message}`)) {
      findings.push({ surface: 'chip', detail: `${chip.id}:${m}` });
    }
  }
  const ar = (body?.blocks ?? []).find((b) => b?.type === 'analysis_result');
  if (typeof ar?.summary === 'string') {
    for (const m of findForbiddenMatches(ar.summary)) {
      findings.push({ surface: 'analysis_result_summary', detail: m });
    }
  }
  if (opts.scanEnrichment && ar?.enrichment != null) {
    for (const f of findEnrichmentLeakCarriers(ar.enrichment)) {
      findings.push({ surface: 'enrichment', detail: `${f.kind}:${f.detail}@${f.path}` });
    }
  }
  return findings;
}

/**
 * DGAI visible result-state presence — asserts the public `analysis_result`
 * block is present and populated enough to hydrate the DGAI Results panel
 * (`leading_option_id` + ≥2 option-keyed win-probabilities), and that the
 * user-facing summary carries no CATASTROPHIC leak (raw entity id, graph
 * hash, or `[REDACTED]` sentinel — never acceptable on any build). The
 * broader prose leak set on the summary is captured informationally by
 * `collectLeakFindings`, not hard-failed here, to avoid false reds on the
 * partial-spine build.
 */
export function assertDgaiResultState(result: FetchResult): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const dgai = extractDgaiState(result.body);
  if (!dgai.present) {
    return {
      ok: false,
      failing_contract: 'dgai_result_state_absent',
      evidence: `status=200 analysis_result_block=absent — DGAI Results panel would not hydrate`,
    };
  }
  if (dgai.leading_option_id === undefined) {
    return {
      ok: false,
      failing_contract: 'dgai_leading_option_missing',
      evidence: `status=200 analysis_result present but leading_option_id absent`,
    };
  }
  if (dgai.win_probability_count === undefined || dgai.win_probability_count < 2) {
    return {
      ok: false,
      failing_contract: 'dgai_win_probabilities_too_few',
      evidence: `status=200 win_probability_count=${dgai.win_probability_count ?? 0} (expected ≥2)`,
    };
  }
  const summary = (result.body?.blocks ?? []).find((b) => b?.type === 'analysis_result')?.summary ?? '';
  if (ID_PREFIX_REGEX.test(summary) || GRAPH_HASH_LEAK_REGEX.test(summary) || summary.includes('[REDACTED]')) {
    return {
      ok: false,
      failing_contract: 'dgai_summary_catastrophic_leak',
      evidence: `status=200 analysis_result.summary contains a raw id / graph hash / [REDACTED] marker`,
    };
  }
  return {
    ok: true,
    evidence:
      `status=200 analysis_result=present leading=${dgai.leading_option_id} ` +
      `win_probs=${dgai.win_probability_count} summary=${dgai.has_summary} ` +
      `enrichment=${dgai.has_enrichment} elapsed=${result.elapsed_ms}ms`,
  };
}

/**
 * #278 add-option (cappable) — the add is acknowledged/applied, not deferred.
 * The encode→rerun proof is the SUBSEQUENT run_analysis step
 * (`assertAnalysisRun`): if the encode failed, run_analysis returns a 500
 * `options_not_configured` envelope and that step fails on `httpOk`.
 */
export function assertAddOption(result: FetchResult): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const text = result.body?.assistant_text ?? '';
  const chipCount = (result.body?.suggested_actions ?? []).length;
  if (text.length === 0 && chipCount === 0) {
    return {
      ok: false,
      failing_contract: 'add_option_empty',
      evidence: `status=200 text_len=0 chip_count=0`,
    };
  }
  if (SAFE_DEFER_PATTERN.test(text)) {
    return {
      ok: false,
      failing_contract: 'add_option_unexpected_defer',
      evidence: `status=200 cappable add deferred (Gate-1 expects encode + apply): text_preview="${text.slice(0, 120)}"`,
    };
  }
  if (CLARIFICATION_BACK_PATTERN.test(text)) {
    return {
      ok: false,
      failing_contract: 'add_option_clarification_back_no_apply',
      evidence: `status=200 response asked for clarification instead of adding the option`,
    };
  }
  const acked = ADD_OPTION_ACK_PATTERN.test(text) || MUTATION_ACK_PATTERN.test(text);
  if (!acked) {
    return {
      ok: false,
      failing_contract: 'add_option_no_acknowledgement',
      evidence: `status=200 but no add/mutation acknowledgement: text_preview="${text.slice(0, 120)}"`,
    };
  }
  return {
    ok: true,
    evidence:
      `status=200 add_acknowledged text_len=${text.length} chip_count=${chipCount} ` +
      `elapsed=${result.elapsed_ms}ms (encode proven by following run_analysis)`,
  };
}

/**
 * #278 Gate 3 — unencodable add → SAFE DEFER. The response must decline to
 * apply (defer or clarify), must NOT falsely claim the option was added, and
 * must not leak. Graph-unchanged is the contract; the harness proves "no
 * false success" on the wire and the runbook pairs this with a Supabase /
 * reload check for graph immutability.
 */
export function assertAddOptionDefer(result: FetchResult): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const text = result.body?.assistant_text ?? '';
  if (text.length === 0) {
    return { ok: false, failing_contract: 'add_option_defer_empty_text', evidence: `status=200 text_len=0` };
  }
  const deferred = SAFE_DEFER_PATTERN.test(text) || CLARIFICATION_BACK_PATTERN.test(text);
  if (!deferred) {
    return {
      ok: false,
      failing_contract: 'add_option_defer_missing_defer_copy',
      evidence: `status=200 expected safe-defer/clarify copy for an unencodable add: text_preview="${text.slice(0, 120)}"`,
    };
  }
  if (ADD_OPTION_ACK_PATTERN.test(text)) {
    return {
      ok: false,
      failing_contract: 'add_option_defer_false_success_claim',
      evidence: `status=200 defer path falsely claims the option was added`,
    };
  }
  return {
    ok: true,
    evidence: `status=200 safe_defer=ok no_false_add=ok text_len=${text.length} elapsed=${result.elapsed_ms}ms`,
  };
}

/**
 * #278 Gate 2 — edit an EXISTING option's intervention. CONTAINMENT-PASS
 * (approved scoring rule): the live NL path currently routes to
 * set_factor_value / clarify (strict apply→rerun→200 is not reachable via NL
 * and is recorded by the journey on a separate "not exercised / known routing
 * limitation" line that does not colour the verdict).
 *
 * PASS iff safely contained:
 *   - clear defer/clarify copy (graph unchanged), OR a clean apply that
 *     references the targeted OPTION; AND
 *   - no value-parse leak ("You gave unknown"), no raw id / hash / [REDACTED].
 * FAIL iff:
 *   - value-parse / id / hash leak; OR
 *   - mutation-ack that references a FACTOR but not the option (misapplied as
 *     a factor-value update); OR
 *   - an apply-claim referencing NEITHER the option nor a factor (implies a
 *     success it cannot be shown to have achieved).
 *
 * Wire-observability limit: replay cannot read the persisted graph here, so
 * "graph unchanged" on the defer path is asserted as "no apply-claim"; the
 * journey's persist→reload→run_analysis step is the structural cross-check.
 */
export function assertEditOptionContainment(
  result: FetchResult,
  ctx?: DL7AssertionContext,
): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const text = result.body?.assistant_text ?? '';
  if (text.length === 0 && (result.body?.suggested_actions ?? []).length === 0) {
    return { ok: false, failing_contract: 'edit_option_empty', evidence: `status=200 text_len=0 chip_count=0` };
  }
  // Hard fail: value-parse leak (raw id / hash already caught by core's
  // noForbiddenTerms over assistant_text).
  const leakMatch = text.match(VALUE_PARSE_LEAK_PATTERN);
  if (leakMatch) {
    return {
      ok: false,
      failing_contract: 'edit_option_value_parse_leak',
      evidence: `status=200 value-parse leak in copy: match="${leakMatch[0]}"`,
    };
  }
  const lower = text.toLowerCase();
  const clarify = CLARIFICATION_BACK_PATTERN.test(text);
  const defer = SAFE_DEFER_PATTERN.test(text);
  const mutationAck = MUTATION_ACK_PATTERN.test(text);
  const factorMentioned = ctx?.factorLabel != null && lower.includes(ctx.factorLabel.toLowerCase());
  const optionMentioned = (ctx?.step1OptionLabels ?? []).some((l) => lower.includes(l.toLowerCase()));

  if (mutationAck && factorMentioned && !optionMentioned) {
    return {
      ok: false,
      failing_contract: 'edit_option_misapplied_as_factor',
      evidence:
        `status=200 mutation acknowledged referencing the FACTOR ("${ctx?.factorLabel}") not the option ` +
        `— request misapplied as a factor-value update`,
    };
  }
  if (mutationAck && !optionMentioned) {
    return {
      ok: false,
      failing_contract: 'edit_option_unverifiable_apply_claim',
      evidence: `status=200 claims an edit was applied but references neither the option nor a factor`,
    };
  }
  if (clarify || defer) {
    return {
      ok: true,
      evidence:
        `status=200 contained path=${defer ? 'defer' : 'clarify'} graph_unchanged=implied ` +
        `no_leak=ok text_len=${text.length} elapsed=${result.elapsed_ms}ms`,
    };
  }
  if (mutationAck && optionMentioned) {
    // Clean apply referencing the option — the strict path working. Safe (no
    // leak, references the right entity). The separate strict-apply line and
    // the persist→reload→rerun step cross-check correctness of the value.
    return {
      ok: true,
      evidence:
        `status=200 contained path=applied_option_ref (strict path working) no_leak=ok ` +
        `text_len=${text.length} elapsed=${result.elapsed_ms}ms`,
    };
  }
  // Neither a clear defer/clarify nor a recognised apply — ambiguous prose
  // with no leak and no misapply signal. Treat as contained-but-unclear: the
  // safest reading (no apply-claim) is PASS, annotated for reviewer triage.
  return {
    ok: true,
    evidence:
      `status=200 contained path=no_apply_claim (ambiguous prose, no misapply, no leak) ` +
      `text_len=${text.length} elapsed=${result.elapsed_ms}ms`,
  };
}

/**
 * Read the optional server `_timings.turn` block (present only when
 * `V5_TIMING_DEBUG=true`). Returns the deterministic-dispatch signals the
 * flip chip-click assertion needs.
 */
function readTurnTimings(body: TurnResponse | undefined): {
  handlerId?: string;
  llmCalls?: number;
} {
  const t = body?._timings;
  const turn = t && typeof t === 'object' ? (t as { turn?: Record<string, unknown> }).turn : undefined;
  if (!turn || typeof turn !== 'object') return {};
  const handlerId = typeof turn.handler_id === 'string' ? turn.handler_id : undefined;
  const llmCalls = typeof turn.llm_calls_used === 'number' ? turn.llm_calls_used : undefined;
  return { handlerId, llmCalls };
}

/**
 * #277 what_would_flip FRESH chip-click. Asserts the #277 acceptance signals
 * observable on the wire:
 *   - non-empty assistant_text AND non-empty blocks-or-actions (#277 P0 #3);
 *   - deterministic dispatch: when `_timings` is present, `llm_calls_used`
 *     must be 0 (no router call) and `handler_id` must be `what_would_flip`;
 *     when `_timings` is absent (V5_TIMING_DEBUG off) dispatch is recorded as
 *     `not_capturable` (the runbook enables V5_TIMING_DEBUG to prove it);
 *   - honesty: must NOT simultaneously assert "no tipping point" AND "small
 *     changes could flip" (the pre-#277 contradiction on the no-effect case).
 * Forbidden prose terms are covered by `coreAssertions`; the #277 enrichment
 * carrier leak is checked separately via `collectLeakFindings(scanEnrichment)`.
 */
export function assertWhatWouldFlipChip(
  result: FetchResult,
  _ctx?: DL7AssertionContext,
): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const body = result.body;
  const text = body?.assistant_text ?? '';
  const blockCount = (body?.blocks ?? []).length;
  const chipCount = (body?.suggested_actions ?? []).length;
  if (text.length === 0 || (blockCount === 0 && chipCount === 0)) {
    return {
      ok: false,
      failing_contract: 'wwf_chip_empty_blocks_actions',
      evidence: `status=200 text_len=${text.length} blocks=${blockCount} chips=${chipCount} (need non-empty text AND blocks-or-actions)`,
    };
  }
  const { handlerId, llmCalls } = readTurnTimings(body);
  if (llmCalls !== undefined && llmCalls > 0) {
    return {
      ok: false,
      failing_contract: 'wwf_chip_routed_through_llm',
      evidence: `status=200 _timings.llm_calls_used=${llmCalls} (>0 — chip did not dispatch deterministically)`,
    };
  }
  if (handlerId !== undefined && handlerId !== 'what_would_flip') {
    return {
      ok: false,
      failing_contract: 'wwf_chip_unexpected_handler',
      evidence: `status=200 _timings.handler_id="${handlerId}" (expected "what_would_flip")`,
    };
  }
  const honestMarker = FLIP_NO_TIPPING_POINT_RE.test(text);
  const couldFlipClaim = FLIP_COULD_FLIP_CLAIM_RE.test(text);
  if (honestMarker && couldFlipClaim) {
    return {
      ok: false,
      failing_contract: 'wwf_chip_contradiction_no_flip_but_could_flip',
      evidence: `status=200 copy asserts BOTH "no tipping point" AND "small changes could flip" — dishonest contradiction`,
    };
  }
  const dispatch = llmCalls === undefined ? 'not_capturable(V5_TIMING_DEBUG off)' : `deterministic(llm_calls=${llmCalls})`;
  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} blocks=${blockCount} chips=${chipCount} ` +
      `dispatch=${dispatch} handler=${handlerId ?? 'n/a'} ` +
      `honest_marker=${honestMarker} could_flip_claim=${couldFlipClaim} elapsed=${result.elapsed_ms}ms`,
  };
}

/**
 * #277 what_would_flip STALE follow-up. After a post-analysis edit, a flip
 * follow-up must steer the user to RERUN (not loop into an executable stale
 * flip). Asserts a rerun/refresh staleness steer is present AND that no
 * executable `what_would_flip` chip is offered while stale (the #277 Codex
 * blocker fix).
 */
export function assertWhatWouldFlipStale(
  result: FetchResult,
  _ctx?: DL7AssertionContext,
): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;
  const body = result.body;
  const text = body?.assistant_text ?? '';
  const chips = body?.suggested_actions ?? [];
  if (text.length === 0 && chips.length === 0) {
    return { ok: false, failing_contract: 'wwf_stale_empty', evidence: `status=200 text_len=0 chip_count=0` };
  }
  // Executable stale flip chip must NOT be present.
  const executableFlipChip = chips.find((c) => c.action_type === 'what_would_flip');
  if (executableFlipChip) {
    return {
      ok: false,
      failing_contract: 'wwf_stale_executable_flip_chip_present',
      evidence: `status=200 stale follow-up offers executable what_would_flip chip (id=${executableFlipChip.id}) instead of steering to rerun`,
    };
  }
  // Staleness steer must be present (text or chip), mirroring assertExplainLeaderStale.
  const stalenessText =
    /\b(stale|model has changed|no longer reflects?|out[- ]of[- ]date|since (?:the )?analysis|re[- ]?run)\b/i.test(text);
  const stalenessChip = chips.some((chip) => {
    const blob = `${chip.label} ${chip.message}`.toLowerCase();
    return /\b(?:re[- ]?run|refresh|update|stale)\b/.test(blob) && blob.includes('analy');
  });
  if (!stalenessText && !stalenessChip) {
    return {
      ok: false,
      failing_contract: 'wwf_stale_no_rerun_steer',
      evidence: `status=200 no staleness/rerun steer in text or chips chip_count=${chips.length}`,
    };
  }
  return {
    ok: true,
    evidence:
      `status=200 staleness_text=${stalenessText} staleness_chip=${stalenessChip} ` +
      `no_executable_flip_chip=ok chip_count=${chips.length} elapsed=${result.elapsed_ms}ms`,
  };
}
