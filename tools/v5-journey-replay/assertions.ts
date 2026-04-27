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
  const ar = body?.analysis_ready as
    | {
        readonly status?: unknown;
        readonly options?: unknown;
        readonly goal_node_id?: unknown;
        readonly computed_at?: unknown;
      }
    | undefined;
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
const STEP5_DENIAL_PHRASES: readonly RegExp[] = [
  /results\s+aren'?t\s+back\s+yet/i,
  /results\s+are\s+not\s+back\s+yet/i,
  /haven'?t\s+run\s+(?:the|an|any)\s+analysis(?!\s+(?:on|of)\s+\w)/i,
  /have\s+not\s+run\s+(?:the|an|any)\s+analysis(?!\s+(?:on|of)\s+\w)/i,
  /analysis\s+(?:isn'?t|is\s+not)\s+(?:ready|complete|done|finished|available)/i,
  /(?:don'?t|do\s+not)\s+have\s+(?:the|an|any)?\s*analysis\s+(?:result|results|output)/i,
  /(?:results|analysis)\s+(?:aren'?t|are\s+not|isn'?t|is\s+not)\s+available\s+yet/i,
  /(?:simulation|computation)\s+(?:hasn'?t|has\s+not)\s+(?:completed|finished|run)/i,
];

export function assertExplainLeader(result: FetchResult): AssertionResult {
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
  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} ` +
      `chip_count=${(result.body?.suggested_actions ?? []).length}`,
  };
}
