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
import { findForbiddenMatches } from './forbidden-terms.js';

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
 * The pattern is intentionally broad — past-tense mutation verbs OR
 * "now has/shows" forward-looking phrasing. Anchoring on these forms
 * proves the response is acknowledging a change, not deflecting via
 * clarification. Combined with the clarification-back negative check,
 * this gives replay-side proof that the edit step actually mutated.
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
        `status=200 but no mutation-ack phrasing in response ` +
        `(expected "Updated X", "X now has...", "Adjusted ...", etc.). ` +
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
        `status=200 but no mutation-ack phrasing in response ` +
        `(expected "Updated X", "X now has...", "Adjusted ...", etc.). ` +
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
  const core = coreAssertions(result);
  if (core) return core;
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
      evidence: `status=200 text_len=0`,
    };
  }
  // Substance gate — same threshold as Step 5 explain-leader. Below
  // this, the answer is almost certainly a stub/precondition fallback
  // rather than a real flip-driver answer.
  if (text.length <= 200) {
    return {
      ok: false,
      failing_contract: 'what_would_flip_text_too_short',
      evidence: `status=200 text_len=${text.length} (expected > 200)`,
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
      evidence: `text_len=0`,
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
          `chip_count=${(result.body?.suggested_actions ?? []).length}`,
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
        `chip_count=${(result.body?.suggested_actions ?? []).length}`,
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
          `labels_checked=${labels.length} mentioned=0`,
      };
    }
  }
  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} ` +
      `labels_checked=${labels.length} ` +
      `chip_count=${(result.body?.suggested_actions ?? []).length}`,
  };
}
