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
 *
 * Wave 1–3 extension: assertions return an optional `warnings` array
 * (warn-not-fail signals like "coaching absent" or "decision-review
 * enrichment not observable on wire") and an optional `captured` payload
 * for cross-step state (e.g. step 7 captures the rerun chip for step 8).
 * Assertions remain pure — the runner is the only writer to journey
 * context.
 */

import type { FetchResult } from './client.js';
import { findForbiddenMatches } from './forbidden-terms.js';
import {
  scanForEntityIds,
  scanInternalTerms,
  type EntityIdMatch,
  type InternalTermMatch,
} from './output-safety.js';

/**
 * Canonical staleness prefix produced by V5 explanation handlers when the
 * analysis projection carries a `staleness_reason`. Hard-coded copy of
 * `STALENESS_PREFIX` from
 * `src/orchestrator-v5/tools/handlers/staleness-prefix.ts:24-25`. Kept as
 * a string literal (not imported) so the harness remains an external
 * contract test rather than a tautology.
 */
export const STALENESS_PREFIX =
  'These results are from a prior run and may not reflect recent changes to the decision model. Treat any figures below as directional rather than definitive.';

const PROVENANCE_DISPLAY_VALUES: ReadonlySet<string> = new Set([
  'from_brief',
  'ai_inferred',
  'user_set',
]);

export interface CapturedRerunChip {
  readonly id: string;
  readonly label: string;
  readonly message: string;
  readonly action_type: string;
}

export type AssertionResult =
  | {
      readonly ok: true;
      readonly evidence: string;
      readonly warnings?: ReadonlyArray<string>;
      readonly features_observed?: ReadonlyArray<string>;
      readonly captured?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly ok: false;
      readonly failing_contract: string;
      readonly evidence: string;
      readonly warnings?: ReadonlyArray<string>;
      readonly features_observed?: ReadonlyArray<string>;
    };

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

// ───────────────────────────────────────────────────────────────────────────
// Wave 1–3 assertion helpers — coaching, provenance, staleness, recovery,
// output safety. Additive; existing assertions above are unchanged.
// ───────────────────────────────────────────────────────────────────────────

function entityIdEvidence(matches: ReadonlyArray<EntityIdMatch>): string {
  return matches.map((m) => `${m.path}:${m.match}`).join(', ');
}

function internalTermEvidence(matches: ReadonlyArray<InternalTermMatch>): string {
  return matches.map((m) => `${m.path}:${m.match}`).join(', ');
}

/**
 * Step 1a — direct /assist/v1/draft-graph response. Asserts the contract
 * shipped in commit a555cf7: every node carries `provenance` ∈ enum, every
 * edge carries `provenance_display` ∈ enum, and `coaching` (when present)
 * matches the `DraftCoachingWire` shape with no entity-id leaks in its
 * text fields. Coaching itself is warn-not-fail when absent — CEE may
 * not produce coaching on every draft.
 */
export function assertAssistDraftGraph(result: FetchResult): AssertionResult {
  if (result.status !== 200) {
    return {
      ok: false,
      failing_contract: `assist_draft_graph http ${result.status} (expected 200)`,
      evidence: `status=${result.status} body_code=${String(result.body?.code ?? '')}`,
    };
  }
  const body = result.body as Record<string, unknown> | undefined;
  if (body?.__body_parse_failed) {
    return {
      ok: false,
      failing_contract: 'assist_draft_graph body_parse_failed',
      evidence: `body_length=${String(body.__body_length ?? 0)}`,
    };
  }
  const status = body?.['status'];
  if (status !== undefined && status !== 'ok') {
    return {
      ok: false,
      failing_contract: `assist_draft_graph unexpected status="${String(status)}" (expected "ok" or absent)`,
      evidence: `status_field=${String(status)}`,
    };
  }

  // /assist/v1/draft-graph returns V3 wire shape with `nodes` / `edges`
  // at the response ROOT (verified live against build a555cf7 on
  // 2026-04-30 — see Step 1a parity probe). The route's
  // `DraftGraphSuccessResponse` type still documents a V1-style
  // `graph: { nodes, edges }` wrapper, so we accept both shapes for
  // forward/backward compat: prefer V3 root, fall back to V1 nested.
  const rootNodes = Array.isArray(body?.['nodes']) ? (body!['nodes'] as Array<Record<string, unknown>>) : null;
  const rootEdges = Array.isArray(body?.['edges']) ? (body!['edges'] as Array<Record<string, unknown>>) : null;
  const graph = (body?.['graph'] ?? {}) as Record<string, unknown>;
  const graphNodes = Array.isArray(graph['nodes']) ? (graph['nodes'] as Array<Record<string, unknown>>) : null;
  const graphEdges = Array.isArray(graph['edges']) ? (graph['edges'] as Array<Record<string, unknown>>) : null;
  const nodes = rootNodes ?? graphNodes ?? [];
  const edges = rootEdges ?? graphEdges ?? [];

  if (nodes.length === 0) {
    return {
      ok: false,
      failing_contract: 'assist_draft_graph empty graph.nodes',
      evidence: `node_count=0 edge_count=${edges.length}`,
    };
  }

  // Node provenance: every node must declare provenance ∈ enum.
  let nodesWithProvenance = 0;
  for (const node of nodes) {
    const p = node['provenance'];
    if (p === undefined) {
      return {
        ok: false,
        failing_contract: 'assist_draft_graph node missing provenance',
        evidence: `node_id=${String(node['id'] ?? '?')} provenance=undefined`,
      };
    }
    if (typeof p !== 'string' || !PROVENANCE_DISPLAY_VALUES.has(p)) {
      return {
        ok: false,
        failing_contract: 'assist_draft_graph node provenance not in enum',
        evidence: `node_id=${String(node['id'] ?? '?')} provenance="${String(p)}"`,
      };
    }
    nodesWithProvenance++;
  }

  // Edge provenance_display: every edge must declare it ∈ enum. We
  // deliberately do NOT inspect edge.provenance (the structural object).
  let edgesWithProvenanceDisplay = 0;
  for (const edge of edges) {
    const p = edge['provenance_display'];
    if (p === undefined) {
      return {
        ok: false,
        failing_contract: 'assist_draft_graph edge missing provenance_display',
        evidence: `edge_id=${String(edge['id'] ?? '?')}`,
      };
    }
    if (typeof p !== 'string' || !PROVENANCE_DISPLAY_VALUES.has(p)) {
      return {
        ok: false,
        failing_contract: 'assist_draft_graph edge provenance_display not in enum',
        evidence: `edge_id=${String(edge['id'] ?? '?')} provenance_display="${String(p)}"`,
      };
    }
    edgesWithProvenanceDisplay++;
  }

  // Coaching shape — warn-not-fail when absent, hard-fail on bad shape.
  const warnings: string[] = [];
  const features: string[] = ['node_provenance', 'edge_provenance_display'];
  const coaching = body?.['coaching'] as Record<string, unknown> | undefined;
  if (coaching === undefined) {
    warnings.push('coaching_absent (CEE may not produce coaching on every draft)');
  } else {
    features.push('coaching');
    const summary = coaching['summary'];
    if (summary !== null && typeof summary !== 'string') {
      return {
        ok: false,
        failing_contract: 'coaching.summary not string|null',
        evidence: `coaching.summary type=${typeof summary}`,
      };
    }
    const strengthen = coaching['strengthen_items'];
    if (!Array.isArray(strengthen)) {
      return {
        ok: false,
        failing_contract: 'coaching.strengthen_items not array',
        evidence: `coaching.strengthen_items type=${typeof strengthen}`,
      };
    }
    const widening = coaching['widening_log'];
    if (widening !== undefined && !Array.isArray(widening)) {
      return {
        ok: false,
        failing_contract: 'coaching.widening_log present but not array',
        evidence: `coaching.widening_log type=${typeof widening}`,
      };
    }
    const bias = coaching['bias_signals'];
    if (bias !== undefined && !Array.isArray(bias)) {
      return {
        ok: false,
        failing_contract: 'coaching.bias_signals present but not array',
        evidence: `coaching.bias_signals type=${typeof bias}`,
      };
    }
  }

  // Output safety: scan the whole body for raw entity ids in user-facing
  // text. Structural fields (id, target, etc.) are skipped via the
  // EXCLUDED_FIELD_NAMES allowlist in output-safety.ts.
  const idLeaks = scanForEntityIds(body);
  if (idLeaks.length > 0) {
    return {
      ok: false,
      failing_contract: 'assist_draft_graph entity_id_leak',
      evidence: `leaks=[${entityIdEvidence(idLeaks).slice(0, 200)}]`,
    };
  }

  const provenanceCoverageNodes = `${nodesWithProvenance}/${nodes.length}`;
  const provenanceCoverageEdges =
    edges.length === 0 ? 'n/a' : `${edgesWithProvenanceDisplay}/${edges.length}`;

  return {
    ok: true,
    evidence:
      `status=200 nodes=${nodes.length} edges=${edges.length} ` +
      `node_provenance=${provenanceCoverageNodes} edge_provenance_display=${provenanceCoverageEdges} ` +
      `coaching=${coaching ? 'present' : 'absent'}`,
    warnings,
    features_observed: features,
  };
}

/**
 * Step 4 extension — runs the existing `assertAnalysisRun` first, then
 * additionally probes for decision-review enrichment opacity and runs
 * an entity-id leak scan over the whole response body.
 */
export function assertAnalysisRunExtended(result: FetchResult): AssertionResult {
  const base = assertAnalysisRun(result);
  if (!base.ok) return base;

  const body = result.body as Record<string, unknown> | undefined;
  const blocks = Array.isArray(body?.['blocks']) ? (body!['blocks'] as Array<Record<string, unknown>>) : [];
  let enrichmentObserved = false;
  let enrichmentBadShape = false;
  for (const block of blocks) {
    const enrichment = block['enrichment'];
    if (enrichment === undefined) continue;
    if (enrichment === null || typeof enrichment !== 'object') {
      enrichmentBadShape = true;
      continue;
    }
    if ('decision_review' in (enrichment as Record<string, unknown>)) {
      enrichmentObserved = true;
    }
  }
  if (enrichmentBadShape) {
    return {
      ok: false,
      failing_contract: 'analysis_run enrichment present but not an object',
      evidence: 'enrichment_shape=invalid',
    };
  }

  const idLeaks = scanForEntityIds(body);
  if (idLeaks.length > 0) {
    return {
      ok: false,
      failing_contract: 'analysis_run entity_id_leak',
      evidence: `leaks=[${entityIdEvidence(idLeaks).slice(0, 200)}]`,
    };
  }

  const features = ['analysis_ready', 'options_minimum'];
  const warnings: string[] = [];
  if (enrichmentObserved) {
    features.push('decision_review_enrichment');
  } else {
    warnings.push('review_enrichment=not_observable_from_wire');
  }

  return {
    ok: true,
    evidence: `${base.evidence} review_enrichment=${enrichmentObserved ? 'observed' : 'opaque'}`,
    warnings,
    features_observed: features,
  };
}

/**
 * Step 5 fresh path — graph has NOT been edited since analysis, so the
 * explanation must NOT carry the staleness prefix and must NOT include a
 * rerun chip. Wraps the existing `assertExplainLeader` (denial-phrase +
 * substance + label-reference checks).
 */
export function assertExplainLeaderFresh(
  result: FetchResult,
  ctx?: { step1OptionLabels?: readonly string[] },
): AssertionResult {
  const base = assertExplainLeader(result, ctx);
  if (!base.ok) return base;

  const text = result.body?.assistant_text ?? '';
  if (textStartsWithStalenessPrefix(text)) {
    return {
      ok: false,
      failing_contract: 'step_5_unexpected_staleness_prefix',
      evidence: 'fresh explanation must not begin with staleness prefix',
    };
  }
  const chips = result.body?.suggested_actions ?? [];
  const rerunChips = chips.filter((c) => c.action_type === 'run_analysis');
  if (rerunChips.length > 0) {
    return {
      ok: false,
      failing_contract: 'step_5_unexpected_rerun_chip',
      evidence: `rerun_chip_count=${rerunChips.length} (graph not edited yet — no rerun chip should appear)`,
    };
  }

  const idLeaks = scanForEntityIds(result.body);
  if (idLeaks.length > 0) {
    return {
      ok: false,
      failing_contract: 'step_5_entity_id_leak',
      evidence: `leaks=[${entityIdEvidence(idLeaks).slice(0, 200)}]`,
    };
  }

  const lenientHits = scanInternalTerms(result.body, 'lenient');
  const warnings: string[] = [];
  if (lenientHits.length > 0) {
    warnings.push(`lenient_internal_terms=[${internalTermEvidence(lenientHits).slice(0, 200)}]`);
  }

  return {
    ok: true,
    evidence: `${base.evidence} fresh_path=ok`,
    warnings,
    features_observed: ['fresh_explanation', 'no_staleness_prefix'],
  };
}

/**
 * Step 5 recovery inspector — used when step 5 returns a failure shape
 * (HTTP 500 or HTTP 200 with error envelope). The wire shape on chip-click
 * commit failures is a `BoundaryError` body (`error`, `boundary`,
 * `validator`, `details.retryable`); the wire shape on TurnExecutor egress
 * fallback is an `OlumiResponse` with `blocks[0].error_code` and a recovery
 * chip in `suggested_actions`. This assertion accepts either shape and
 * counts recovery signals (error_code present, chip present, friendly
 * assistant_text, no internal terms) — passes when at least 2 of 4
 * signals are present, hard fails on internal terminology in user-facing
 * text.
 */
export function assertExplainLeaderRecovery(result: FetchResult): AssertionResult {
  const body = (result.body ?? {}) as Record<string, unknown>;
  const friendlyOpenings = [
    'That took longer than usual.',
    "I couldn't complete that just now.",
    "I couldn't complete that step.",
    "Analysis couldn't complete right now.",
    'The analysis took longer than expected.',
  ];

  // Signal 1: error_code preserved (either on blocks[0] or as BoundaryError.error).
  const blocks = Array.isArray(body['blocks']) ? (body['blocks'] as Array<Record<string, unknown>>) : [];
  const errorCode =
    (blocks[0]?.['error_code'] as string | undefined) ??
    (typeof body['error'] === 'string' ? (body['error'] as string) : undefined);
  const errorCodeSignal = typeof errorCode === 'string' && errorCode.length > 0;

  // Signal 2: at least one recovery chip.
  const chips = Array.isArray(body['suggested_actions']) ? (body['suggested_actions'] as Array<Record<string, unknown>>) : [];
  const chipSignal = chips.length > 0;

  // Signal 3: friendly assistant_text (matches one of the canonical recovery openings).
  const text = typeof body['assistant_text'] === 'string' ? (body['assistant_text'] as string) : '';
  const friendlySignal = friendlyOpenings.some((opening) => text.startsWith(opening));

  // Signal 4: no strict-mode internal terms anywhere user-facing.
  const strictHits = scanInternalTerms(body, 'strict');
  const cleanCopySignal = strictHits.length === 0;

  if (!cleanCopySignal) {
    return {
      ok: false,
      failing_contract: 'recovery_response_internal_terms',
      evidence: `terms=[${internalTermEvidence(strictHits).slice(0, 200)}]`,
    };
  }

  const signalCount =
    (errorCodeSignal ? 1 : 0) + (chipSignal ? 1 : 0) + (friendlySignal ? 1 : 0) + (cleanCopySignal ? 1 : 0);

  if (signalCount < 2) {
    return {
      ok: false,
      failing_contract: 'recovery_signals_insufficient',
      evidence:
        `signals: error_code=${errorCodeSignal} chip=${chipSignal} ` +
        `friendly_text=${friendlySignal} clean_copy=${cleanCopySignal} (need ≥ 2)`,
    };
  }

  const features = ['recovery_response'];
  if (errorCodeSignal) features.push('error_code_preserved');
  if (chipSignal) features.push('recovery_chip');
  if (friendlySignal) features.push('friendly_text');

  return {
    ok: true,
    evidence:
      `status=${result.status} error_code=${String(errorCode ?? '?')} ` +
      `chip_count=${chips.length} text_len=${text.length} signals=${signalCount}/4`,
    features_observed: features,
  };
}

/**
 * Step 7 — post-edit explanation question. The graph was just edited
 * in step 6, so the analysis is now stale. Asserts the canonical
 * staleness prefix, exactly one rerun chip with `action_type='run_analysis'`,
 * substance, and entity-id cleanliness. Returns the captured rerun chip
 * via `captured.rerunChip` so step 8 can replay the click — assertions
 * remain pure; the runner copies the captured value onto the journey
 * context.
 */
export function assertStaleExplanation(result: FetchResult): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;

  const text = result.body?.assistant_text ?? '';
  if (!textStartsWithStalenessPrefix(text)) {
    return {
      ok: false,
      failing_contract: 'step_7_missing_staleness_prefix',
      evidence: `text_starts="${text.slice(0, 80).replace(/\n/g, ' ')}" expected_prefix_first_30="${STALENESS_PREFIX.slice(0, 30)}"`,
    };
  }
  if (text.length <= 200) {
    return {
      ok: false,
      failing_contract: 'step_7_text_too_short',
      evidence: `text_len=${text.length} (expected > 200, even when stale)`,
    };
  }

  const chips = result.body?.suggested_actions ?? [];
  const rerunChips = chips.filter((c) => c.action_type === 'run_analysis');
  if (rerunChips.length === 0) {
    return {
      ok: false,
      failing_contract: 'step_7_missing_rerun_chip',
      evidence: `chip_count=${chips.length} rerun_chips=0`,
    };
  }
  if (rerunChips.length > 1) {
    return {
      ok: false,
      failing_contract: 'step_7_duplicate_rerun_chips',
      evidence: `rerun_chips=${rerunChips.length} (expected exactly 1)`,
    };
  }
  const chip = rerunChips[0]!;
  if (typeof chip.id !== 'string' || typeof chip.message !== 'string' || typeof chip.label !== 'string') {
    return {
      ok: false,
      failing_contract: 'step_7_rerun_chip_malformed',
      evidence: `chip_id=${typeof chip.id} chip_message=${typeof chip.message} chip_label=${typeof chip.label}`,
    };
  }

  const captured: CapturedRerunChip = {
    id: chip.id,
    label: chip.label,
    message: chip.message,
    action_type: 'run_analysis',
  };

  const idLeaks = scanForEntityIds(result.body);
  if (idLeaks.length > 0) {
    return {
      ok: false,
      failing_contract: 'step_7_entity_id_leak',
      evidence: `leaks=[${entityIdEvidence(idLeaks).slice(0, 200)}]`,
    };
  }

  const lenientHits = scanInternalTerms(result.body, 'lenient');
  const warnings: string[] = [];
  if (lenientHits.length > 0) {
    warnings.push(`lenient_internal_terms=[${internalTermEvidence(lenientHits).slice(0, 200)}]`);
  }

  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} stale_prefix=present ` +
      `rerun_chip_label="${chip.label}" rerun_chip_action_type=run_analysis`,
    warnings,
    features_observed: ['staleness_prefix', 'rerun_chip'],
    captured: { rerunChip: captured },
  };
}

/**
 * Step 8 — replay the captured rerun chip. Two pass paths:
 *  (A) Fresh analysis: 200, `analysis_ready.status === 'ready'`, no
 *      staleness prefix on the response.
 *  (B) Recovery: failure envelope with recovery shape (handled by
 *      `assertExplainLeaderRecovery`). Permits soft pass on transient
 *      LLM/PLoT failure paths.
 */
export function assertRerunViaChip(result: FetchResult): AssertionResult {
  const body = (result.body ?? {}) as Record<string, unknown>;
  // Path B: failure / recovery shape.
  if (result.status >= 400 || typeof body['error'] === 'string' || hasErrorBlock(body)) {
    const recovery = assertExplainLeaderRecovery(result);
    if (recovery.ok) {
      return {
        ok: true,
        evidence: `recovery_path: ${recovery.evidence}`,
        warnings: ['rerun_returned_recovery_shape'],
        features_observed: recovery.features_observed,
      };
    }
    return recovery;
  }

  // Path A: fresh analysis.
  const core = coreAssertions(result);
  if (core) return core;

  const text = (body['assistant_text'] as string | undefined) ?? '';
  if (textStartsWithStalenessPrefix(text)) {
    return {
      ok: false,
      failing_contract: 'step_8_unexpected_staleness_prefix',
      evidence: 'rerun should clear staleness; response still begins with staleness prefix',
    };
  }

  const ar = body['analysis_ready'] as
    | { readonly status?: unknown; readonly options?: unknown }
    | undefined;
  if (ar?.status !== 'ready') {
    return {
      ok: false,
      failing_contract: 'step_8_analysis_ready_not_ready',
      evidence: `analysis_ready_status="${String(ar?.status)}"`,
    };
  }

  const idLeaks = scanForEntityIds(body);
  if (idLeaks.length > 0) {
    return {
      ok: false,
      failing_contract: 'step_8_entity_id_leak',
      evidence: `leaks=[${entityIdEvidence(idLeaks).slice(0, 200)}]`,
    };
  }

  const lenientHits = scanInternalTerms(body, 'lenient');
  const warnings: string[] = [];
  if (lenientHits.length > 0) {
    warnings.push(`lenient_internal_terms=[${internalTermEvidence(lenientHits).slice(0, 200)}]`);
  }

  return {
    ok: true,
    evidence:
      `status=200 fresh_analysis=ready options=${Array.isArray(ar.options) ? ar.options.length : '?'} ` +
      `text_len=${text.length} no_staleness_prefix=true`,
    warnings,
    features_observed: ['fresh_analysis_after_rerun'],
  };
}

/**
 * Step 9 — "What would need to change for the runner-up to perform best?".
 * Substantive narrative referencing factors / options by label; no entity
 * id leaks; soft warnings on lenient internal terms.
 */
export function assertWhatWouldFlip(
  result: FetchResult,
  ctx?: { step1OptionLabels?: readonly string[] },
): AssertionResult {
  const core = coreAssertions(result);
  if (core) return core;

  const text = result.body?.assistant_text ?? '';
  if (text.length <= 200) {
    return {
      ok: false,
      failing_contract: 'step_9_text_too_short',
      evidence: `text_len=${text.length} (expected > 200)`,
    };
  }

  const labels = ctx?.step1OptionLabels ?? [];
  const warnings: string[] = [];
  let labelMatched = false;
  if (labels.length > 0) {
    const lower = text.toLowerCase();
    labelMatched = labels.some((l) => lower.includes(l.toLowerCase()));
    if (!labelMatched) {
      warnings.push('step_9_no_option_label_referenced (expected substring match on at least one option)');
    }
  } else {
    warnings.push('step_9_label_check_skipped (step1OptionLabels empty)');
  }

  const idLeaks = scanForEntityIds(result.body);
  if (idLeaks.length > 0) {
    return {
      ok: false,
      failing_contract: 'step_9_entity_id_leak',
      evidence: `leaks=[${entityIdEvidence(idLeaks).slice(0, 200)}]`,
    };
  }

  const lenientHits = scanInternalTerms(result.body, 'lenient');
  if (lenientHits.length > 0) {
    warnings.push(`lenient_internal_terms=[${internalTermEvidence(lenientHits).slice(0, 200)}]`);
  }

  return {
    ok: true,
    evidence:
      `status=200 text_len=${text.length} labels_checked=${labels.length} ` +
      `option_referenced=${labelMatched}`,
    warnings,
    features_observed: ['flip_narrative', labelMatched ? 'option_label_referenced' : 'no_label_match'],
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Internal helpers
// ───────────────────────────────────────────────────────────────────────────

function textStartsWithStalenessPrefix(text: string): boolean {
  // Match the source's `APPROVED_OPENINGS` predicate: case-insensitive,
  // allow leading whitespace.
  const trimmed = text.replace(/^\s+/, '');
  return trimmed.toLowerCase().startsWith(STALENESS_PREFIX.toLowerCase());
}

function hasErrorBlock(body: Record<string, unknown>): boolean {
  const blocks = body['blocks'];
  if (!Array.isArray(blocks)) return false;
  return blocks.some((b) => {
    if (b == null || typeof b !== 'object') return false;
    return (b as { type?: string }).type === 'error';
  });
}
