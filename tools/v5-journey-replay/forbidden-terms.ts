/**
 * V5 alpha hardening Phase 3 — forbidden-term list.
 *
 * Terms that must NEVER appear in user-facing `assistant_text` or chip
 * labels/messages. Scan each step's response against this list; any
 * match fails the evidence row with `failing_contract: "internal term leak"`.
 *
 * Sources:
 *   - Paul's brief forbids: ContextPack, analysis is null, handler,
 *     state_commit, validator, kind_mismatch
 *   - Real staging PLoT capture (2d2aab36...) contains raw ID prefixes:
 *     opt_1, fac_churn_rate_2, goal_1, risk_1, out_1, out_2
 *
 * The id-prefix regex allows the underscored literal `analysis_status`
 * inside log JSON but blocks raw entity ids leaking into user text.
 */

export const FORBIDDEN_STRINGS: readonly string[] = [
  'ContextPack',
  'analysis is null',
  'state_commit',
  'kind_mismatch',
  'HANDLER_INVOCATION_FAILED',
  'STATE_COMMIT_FAILED',
  'ENTITY_KIND_MISMATCH',
  'ENTITY_NOT_FOUND',
  'ENTITY_RESOLUTION_AMBIGUOUS',
  'ENTITY_RESOLUTION_SUSPICIOUS',
  'PARAMETER_INVALID',
  'PRECONDITION_UNMET',
  'HANDLER_NOT_FOUND',
  // P0 V5 golden-path repair (Wave 6) — extend the wordlist with the
  // terms the brief explicitly forbids in user-facing text. Each
  // term either names internal mechanics (Zod, normalised, fact_type)
  // or names a specific handler / function (set_factor_value,
  // explain_results, selectRunAnalysisFact, analysisProjection)
  // that must never reach the wire as user copy.
  'BUDGET_TARGET',
  'Zod',
  'noop',
  'fact_type',
  'analysis_status',
  'graph_hash',
  'set_factor_value',
  'explain_results',
  'what_would_flip',
  'run_analysis',
  'edit_graph',
  'selectRunAnalysisFact',
  'analysisProjection',
  'analysisFreshness',
  'normalised',
  'normalized',
  // Patch language — surfaces in pre-repair drafts; user-facing copy
  // must speak in plain product terms.
  'patch_id',
];

// Raw internal ID patterns (`opt_1`, `goal_1`, `fac_churn`, `risk_1`, `out_2`).
export const ID_PREFIX_REGEX = /\b(opt|fac|goal|risk|out)_[A-Za-z0-9]+/;

// Developer terms that may appear as chip labels but not in ASSISTANT_TEXT
// narration. These are softer — "handler" in isolation is developer talk;
// "handler.run_analysis" is definitely a leak. We scan for the developer
// phrasing.
export const DEVELOPER_PHRASES: readonly RegExp[] = [
  /\bhandler[ _](id|failed|error|registered)\b/i,
  /\bvalidator\b/i,
];

export function findForbiddenMatches(text: string): readonly string[] {
  const matches: string[] = [];
  for (const needle of FORBIDDEN_STRINGS) {
    if (text.includes(needle)) matches.push(needle);
  }
  const idMatch = text.match(ID_PREFIX_REGEX);
  if (idMatch) matches.push(`raw_id:${idMatch[0]}`);
  for (const re of DEVELOPER_PHRASES) {
    const m = text.match(re);
    if (m) matches.push(`dev_phrase:${m[0]}`);
  }
  return matches;
}
