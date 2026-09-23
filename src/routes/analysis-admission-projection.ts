/**
 * ⭐⭐ WHAT A RELOAD MAY KNOW ABOUT ADMISSIBILITY — MACHINE CODES ONLY.
 *
 * ⛔ THE GAP, MEASURED. The scenario-graph READ route already answers *"has a
 * fact landed for this graph, and is it current?"* — it ships `analysis_state`,
 * `analysis_result`, `graph_hash`, `layout_present` and `not_modelled`
 * (`assist.v1.scenario-graph.ts:576-604`). It does NOT answer *"may a run be
 * admitted right now?"*. So after a page reload a client could learn that no
 * analysis had landed and still not learn whether one COULD be started, or what
 * stands in the way. Admission was reachable only by taking a whole turn.
 *
 * ⚠ I PREVIOUSLY RECORDED THIS ROUTE AS HAVING "NO READINESS VERDICT AT ALL",
 * and that was wrong — I measured the key `analysis_ready` (0 occurrences) and
 * read its absence as the absence of readiness, when `analysis_state` was
 * sitting on the same response. The gap is real but far narrower than I filed
 * it, and the correction is recorded here rather than quietly dropped.
 *
 * ⛔ WHY NOT `analysis_ready` ITSELF. The suite pins that key OFF this route
 * (`assist.v1.scenario-graph.analysis-read.test.ts:448`) alongside
 * `assistant_text`, `blocks` and `suggested_actions` — i.e. the pin is about
 * keeping TURN-SHAPED keys off a read, and `AnalysisReadyPayload` is also the
 * prose carrier (`status_reason`, `user_questions`). Both reasons hold. This is
 * a route-local projection under its own name instead.
 *
 * ⛔ EVERY USER-FACING STRING IS DROPPED, and the types say which they are:
 *   · `AnalysisAdmissionReason.message` — "⚠ `message` IS USER-FACING … `code`
 *     is for consumers and telemetry" (`analysis-admission.ts:422-423`);
 *   · `MissingImportantInput.why_it_matters` — "User-facing"
 *     (`analysis-admission.ts:456`).
 * A read route ships no enforceable prose, so it ships none at all. A consumer
 * that needs words asks for a turn, which is where the words are governed.
 *
 * ⚠ `graph_hash` HERE IS THE 64-HEX SUBJECT BINDING, not the 16-hex freshness
 * token the response's own top-level `graph_hash` carries. Same projection,
 * same normaliser, different truncation — comparable only after truncating this
 * one, never by string equality (`analysis-admission.ts:605-615`). It is
 * included so a client can tell a verdict about a DIFFERENT graph from a
 * current one.
 *
 * ⭐ PURE. One synchronous call over bytes the route already holds: no I/O, no
 * model, no clock.
 */
import {
  resolveAnalysisAdmission,
  type AdmissionReasonCode,
  type PermittedAnalysisMode,
} from '../orchestrator-v5/admission/analysis-admission.js';

/** Admissibility as a reload may learn it: verdicts and codes, never prose. */
export interface AnalysisAdmissionProjection {
  /** Can the engine execute this at all, right now? */
  readonly admitted: boolean;
  /** The upper bound on what the product may claim if it did run. */
  readonly permitted_analysis_mode: PermittedAnalysisMode;
  /** Whether the model represents the brief well enough to carry a confidence claim. */
  readonly semantic_quality_sufficient: boolean;
  /** Why, as machine codes. De-duplicated, order preserved. Empty when admitted. */
  readonly reason_codes: readonly AdmissionReasonCode[];
  /** The machine codes of what is missing — never the `why_it_matters` prose,
   *  and never the user's own option/factor LABELS, which are their words and
   *  already travel with the graph. */
  readonly missing_input_codes: readonly string[];
  /** The 64-hex subject this verdict is about; `null` when it could not be read. */
  readonly graph_hash: string | null;
}

/**
 * Project the admission verdict for a graph, or `null` when there is no graph
 * to judge. `null` is "this leg did not answer" and never a state — the same
 * contract `analysis_state` follows on this route.
 */
export function projectAnalysisAdmission(
  graph: unknown,
  graphPresent: boolean,
): AnalysisAdmissionProjection | null {
  if (!graphPresent) return null;
  const a = resolveAnalysisAdmission(graph);

  const seen = new Set<AdmissionReasonCode>();
  const reason_codes: AdmissionReasonCode[] = [];
  for (const r of a.reasons) {
    if (seen.has(r.code)) continue;
    seen.add(r.code);
    reason_codes.push(r.code);
  }

  // ⛔ `code`, NOT `field`: `MissingImportantInput` has no `field` (its shape is
  // `issue_id`/`code`/`option_id`/`factor_id`/`why_it_matters`), so reading one
  // would have shipped a permanently empty array that looked like "nothing is
  // missing". Checked against the interface at `analysis-admission.ts:448-458`.
  const seenCode = new Set<string>();
  const missing_input_codes: string[] = [];
  for (const m of a.missing_important_inputs) {
    const c = m.code;
    if (typeof c !== 'string' || c === '' || seenCode.has(c)) continue;
    seenCode.add(c);
    missing_input_codes.push(c);
  }

  return {
    admitted: a.structurally_analysable,
    permitted_analysis_mode: a.permitted_analysis_mode,
    semantic_quality_sufficient: a.semantic_quality_sufficient,
    reason_codes,
    missing_input_codes,
    graph_hash: a.graph_hash,
  };
}
