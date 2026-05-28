/**
 * V5 deterministic analysis-result headline builder.
 *
 * Pure helper consumed by the run_analysis handler. Builds a short
 * British-English headline (one or two sentences) from the already-
 * available PLoT V2RunResponseEnvelope fields (leading option label,
 * top driver, fragility) when sufficient data is present. Returns null
 * when data is too thin — the handler then falls back to the locked
 * RUN_ANALYSIS_ASSISTANT_TEMPLATES string.
 *
 * Invariants:
 *  - No LLM call. No I/O. No telemetry side effects. No graph mutation.
 *  - No raw decimals in output (win_probability is rendered as integer %).
 *  - No internal IDs leak (winner / driver / fragility labels are guarded
 *    against ID-shaped strings).
 *  - One short sentence, or one + one status-suffix sentence — never more.
 *    Maximum {@link MAX_HEADLINE_CHARS} characters including any suffix.
 *  - Uses "currently leads", "provisional", "sensitive to" — never
 *    "best" / "recommended" / "winner".
 *  - "currently leads" is emitted ONLY when the leading option has a
 *    finite win_probability ≥ {@link MIN_LEAD_PROBABILITY} AND, if a
 *    runner-up exists in the same source, the margin is at least
 *    {@link MIN_LEAD_MARGIN}. Near-ties and weak leaders fall back to
 *    the locked template by returning null.
 *
 * The registry forwarder ({@link isAllowedRunAnalysisAssistantText})
 * is exported here so the only strings the wire ever sees from
 * run_analysis are either a locked template literal or a string this
 * helper could have emitted. The handler is trusted to call into this
 * module; the registry is the second line of defence.
 */

import {
  readResultsArraySources,
  selectWinner,
  readGraph,
  readRecord,
  readNumber,
  readRobustnessLevel,
  buildNodeLabelMap,
} from './decision-review-enricher.js';

export const MAX_HEADLINE_CHARS = 220;

/**
 * Minimum win_probability for the leading option before the headline
 * may say "currently leads". A leader below this threshold is treated
 * as too weak to assert a lead, regardless of any margin to the
 * runner-up — fall back to the locked template instead. Calibrated
 * against typical 3-way decision races: 40% is a plausible plurality;
 * anything below would read as "no real leader".
 */
const MIN_LEAD_PROBABILITY = 0.4;

/**
 * Minimum margin (winner.win_probability − runner_up.win_probability)
 * required before the headline may say "currently leads". Pads above
 * the existing 1pp near-tie threshold used by the advice-gate copy in
 * post-analysis-advice-gate.ts so headline copy is consistently more
 * conservative than free-text follow-ups. When no runner-up entry
 * carries a finite probability (single-option result) the margin
 * check is waived and only {@link MIN_LEAD_PROBABILITY} applies.
 */
const MIN_LEAD_MARGIN = 0.05;

const PARTIAL_SUFFIX =
  ' The run was flagged as partial — treat as provisional.';
const UNKNOWN_SUFFIX =
  ' The analysis engine reported an unfamiliar status — treat the result with caution.';

const ID_PREFIX_PATTERN = /^(opt_|goal_|fac_|node_|edge_|n_|e_)/i;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface AnalysisResultHeadlineInput {
  readonly enrichment: Record<string, unknown>;
  readonly leading_option_id: string;
  readonly status_kind: 'ok' | 'partial' | 'unknown';
}

/**
 * Returns a deterministic headline sentence, or null when fallback to the
 * locked template is the safe choice. The handler should treat null as
 * "use the existing template" — never invent a string from nothing.
 */
export function buildAnalysisResultHeadline(
  input: AnalysisResultHeadlineInput,
): string | null {
  const { enrichment, leading_option_id, status_kind } = input;

  // Same-source resolution: the winner label, winner probability, and
  // runner-up probability ALL come from the SAME source array (one of
  // results[], option_comparison[], decision_brief.options[] in priority
  // order). This guards against the round-2 cross-source mixing risk —
  // a clean label from one source paired with stale or inconsistent
  // probability maths from another.
  const winner = resolveWinner(enrichment, leading_option_id);
  if (winner === null) return null;

  // Probability/margin guard — applied to ALL "currently leads" cases.
  // The headline never says "leads" unless the leading option holds a
  // finite probability above MIN_LEAD_PROBABILITY AND (when a runner-up
  // probability is present in the same source) the margin is at least
  // MIN_LEAD_MARGIN. Near-ties (e.g. 0.34 / 0.33 / 0.33) and weak
  // leaders (e.g. winner at 0.30 with no clear plurality) fall through
  // to the locked template.
  if (!hasMeaningfulLead(winner)) return null;

  const winnerLabel = winner.label;
  const winnerProbability = winner.winnerProb;

  const driverLabel = resolveTopDriverLabel(enrichment);
  const fragileLabel = resolveFragileLabel(enrichment);
  const suffix = statusSuffix(status_kind);

  // Case A: winner + driver + fragility (with length-aware retry).
  if (driverLabel !== null && fragileLabel !== null) {
    const caseA =
      `${winnerLabel} currently leads because ${driverLabel} is the strongest driver,` +
      ` but the result is sensitive to ${fragileLabel}.${suffix}`;
    if (caseA.length <= MAX_HEADLINE_CHARS) return caseA;
    // Retry as Case B (drop fragility clause).
    const caseB =
      `${winnerLabel} currently leads because ${driverLabel} is the strongest driver.${suffix}`;
    if (caseB.length <= MAX_HEADLINE_CHARS) return caseB;
    return null;
  }

  // Case B: winner + driver, no fragility.
  if (driverLabel !== null) {
    const caseB =
      `${winnerLabel} currently leads because ${driverLabel} is the strongest driver.${suffix}`;
    return caseB.length <= MAX_HEADLINE_CHARS ? caseB : null;
  }

  // Case C: winner + fragility, no driver.
  if (fragileLabel !== null) {
    const caseC =
      `${winnerLabel} currently leads, but the result is sensitive to ${fragileLabel}.${suffix}`;
    return caseC.length <= MAX_HEADLINE_CHARS ? caseC : null;
  }

  // Case D: winner + win_probability, no driver/fragility. The probability
  // guard above already enforced winnerProbability ≥ MIN_LEAD_PROBABILITY,
  // so the rendered integer percentage is always ≥ 40%.
  const pct = Math.round(winnerProbability * 100);
  const caseD =
    `${winnerLabel} currently leads with ${pct}% probability.` +
    ` Run the follow-up checks before treating this as final.${suffix}`;
  return caseD.length <= MAX_HEADLINE_CHARS ? caseD : null;
}

interface ResolvedWinner {
  /** Sanitised label (no ID-shape, trimmed, non-empty). */
  readonly label: string;
  /** Finite winner probability, in [0, 1]. */
  readonly winnerProb: number;
  /**
   * Finite runner-up probability from the SAME source, in [0, 1],
   * or null when no other entry in that source carries a finite
   * probability (e.g., a single-option source, or a runner-up
   * missing its probability field). When null the margin guard is
   * waived; only the absolute probability check applies.
   */
  readonly runnerUpProb: number | null;
}

/**
 * Resolve the leading option's label, its win_probability, AND the
 * runner-up probability — all from the SAME source array in a single
 * pass. Iterates sources in priority order
 * ({@link readResultsArraySources}); a source is accepted only when
 * BOTH the candidate winner has a non-ID-shaped label AND a finite,
 * in-range win_probability. Sources that fail either check are
 * skipped (continue) so a thin/ID-shaped first source can be rescued
 * by a richer subsequent source — but each accepted source provides
 * the full triple, never a label from one and a probability from
 * another.
 *
 * Returns null when no source provides all three signals — the
 * caller treats null as "fall back to the locked template".
 */
function resolveWinner(
  enrichment: Record<string, unknown>,
  leadingOptionId: string,
): ResolvedWinner | null {
  const sources = readResultsArraySources(enrichment);
  if (sources.length === 0) return null;

  const id = leadingOptionId.trim();
  for (const source of sources) {
    const winner = selectWinner(source, id.length > 0 ? id : null);
    if (winner === null) continue;
    const cleanedLabel = sanitiseLabel(winner.label, winner.id);
    if (cleanedLabel === null) continue;

    // Re-read the winner's probability directly from the source.
    // `selectWinner` calls `projectOptionAsWinner` which coerces a
    // missing/non-finite `win_probability` to 0 — that conceals the
    // difference between "explicitly 0" (a legitimate, finite signal
    // for a dominated option) and "missing entirely" (a thin source
    // that should be skipped so a richer downstream source can carry
    // both label and probability). Reading raw lets the skip path
    // fire when the source can't supply a finite probability at all.
    const winnerRaw = source.find((r) => {
      const rId =
        (typeof r.option_id === 'string' && r.option_id) ||
        (typeof r.id === 'string' && r.id) ||
        '';
      return rId === winner.id;
    });
    const winnerProb = winnerRaw ? readNumber(winnerRaw.win_probability) : null;
    if (winnerProb === null || winnerProb < 0 || winnerProb > 1) continue;

    let runnerUpProb: number | null = null;
    for (const raw of source) {
      const rId =
        (typeof raw.option_id === 'string' && raw.option_id) ||
        (typeof raw.id === 'string' && raw.id) ||
        '';
      if (rId === winner.id) continue;
      const p = readNumber(raw.win_probability);
      if (p === null || p < 0 || p > 1) continue;
      if (runnerUpProb === null || p > runnerUpProb) runnerUpProb = p;
    }
    return { label: cleanedLabel, winnerProb, runnerUpProb };
  }
  return null;
}

/**
 * Predicate: does the resolved winner support a "currently leads"
 * headline? Two gates:
 *   1. Winner probability ≥ MIN_LEAD_PROBABILITY (an absolute floor —
 *      a leader below 40% is a "no real leader" race regardless of
 *      margin).
 *   2. If a runner-up probability exists in the same source, the
 *      margin must be ≥ MIN_LEAD_MARGIN. Single-option sources
 *      (runnerUpProb === null) waive the margin check.
 */
function hasMeaningfulLead(winner: ResolvedWinner): boolean {
  if (winner.winnerProb < MIN_LEAD_PROBABILITY) return false;
  if (winner.runnerUpProb !== null) {
    const margin = winner.winnerProb - winner.runnerUpProb;
    if (margin < MIN_LEAD_MARGIN) return false;
  }
  return true;
}

function statusSuffix(kind: AnalysisResultHeadlineInput['status_kind']): string {
  if (kind === 'partial') return PARTIAL_SUFFIX;
  if (kind === 'unknown') return UNKNOWN_SUFFIX;
  return '';
}

interface DriverCandidate {
  readonly label: string;
  readonly score: number;
}

function resolveTopDriverLabel(enrichment: Record<string, unknown>): string | null {
  const arr = enrichment.factor_sensitivity;
  if (!Array.isArray(arr)) return null;

  let best: DriverCandidate | null = null;
  for (const raw of arr) {
    const entry = readRecord(raw);
    if (!entry) continue;
    const idGuess =
      (typeof entry.factor_id === 'string' && entry.factor_id) ||
      (typeof entry.id === 'string' && entry.id) ||
      '';
    const rawLabel =
      (typeof entry.factor_label === 'string' && entry.factor_label) ||
      (typeof entry.label === 'string' && entry.label) ||
      '';
    const label = sanitiseLabel(rawLabel, idGuess);
    if (label === null) continue;

    const score = computeDriverScore(entry);
    if (score === null) continue;
    if (best === null || score > best.score) {
      best = { label, score };
    } else if (score === best.score && label.localeCompare(best.label) < 0) {
      best = { label, score };
    }
  }
  return best?.label ?? null;
}

function computeDriverScore(entry: Record<string, unknown>): number | null {
  const sensitivity = readNumber(entry.sensitivity_score);
  if (sensitivity !== null) return Math.abs(sensitivity);
  const elasticity = readNumber(entry.elasticity);
  if (elasticity === null) return null;
  const confidence = readNumber(entry.confidence);
  return Math.abs(elasticity) * (confidence ?? 1);
}

function resolveFragileLabel(enrichment: Record<string, unknown>): string | null {
  // Robust scenarios skip the fragility clause entirely.
  const level = readRobustnessLevel(enrichment);
  if (level === 'high') return null;

  const rob = readRecord(enrichment.robustness);
  if (!rob) return null;
  const fragile = rob.fragile_edges;
  if (!Array.isArray(fragile) || fragile.length === 0) return null;

  const labelMap = buildNodeLabelMap(readGraph(enrichment));

  let bestLabel: string | null = null;
  let bestProb = -Infinity;
  for (const raw of fragile) {
    const entry = readRecord(raw);
    if (!entry) continue;
    const prob = readNumber(entry.switch_probability) ?? 0;
    const label = pickFragileEdgeLabel(entry, labelMap);
    if (label === null) continue;
    if (prob > bestProb) {
      bestProb = prob;
      bestLabel = label;
    }
  }
  return bestLabel;
}

function pickFragileEdgeLabel(
  edge: Record<string, unknown>,
  labelMap: Map<string, string>,
): string | null {
  const directFrom =
    typeof edge.from_label === 'string' && edge.from_label.length > 0
      ? edge.from_label
      : null;
  const directTo =
    typeof edge.to_label === 'string' && edge.to_label.length > 0
      ? edge.to_label
      : null;
  const fromId =
    typeof edge.from_node_id === 'string' && edge.from_node_id.length > 0
      ? edge.from_node_id
      : null;
  const toId =
    typeof edge.to_node_id === 'string' && edge.to_node_id.length > 0
      ? edge.to_node_id
      : null;

  const resolvedFrom = directFrom ?? (fromId ? labelMap.get(fromId) ?? null : null);
  const resolvedTo = directTo ?? (toId ? labelMap.get(toId) ?? null : null);

  const idGuessFrom = fromId ?? '';
  const idGuessTo = toId ?? '';

  const cleanFrom = resolvedFrom !== null ? sanitiseLabel(resolvedFrom, idGuessFrom) : null;
  if (cleanFrom !== null) return cleanFrom;
  const cleanTo = resolvedTo !== null ? sanitiseLabel(resolvedTo, idGuessTo) : null;
  return cleanTo;
}

function sanitiseLabel(rawLabel: string, idGuess: string): string | null {
  if (typeof rawLabel !== 'string') return null;
  const trimmed = rawLabel.trim();
  if (trimmed.length === 0) return null;
  if (idGuess.length > 0 && trimmed === idGuess) return null;
  if (ID_PREFIX_PATTERN.test(trimmed)) return null;
  if (UUID_PATTERN.test(trimmed)) return null;
  return trimmed;
}

// ============================================================================
// Registry-side allowlist for run_analysis assistant_text
// ============================================================================
//
// The validation-registry forwarder ({@link
// ../routing/validation-registry.ts}) calls into this module so the wire
// only ever sees strings the handler is permitted to emit:
//   1. An exact match for one of the locked RUN_ANALYSIS_ASSISTANT_TEMPLATES
//      values (kept in sync below — see the `RUN_ANALYSIS_LOCKED_TEMPLATES`
//      constant), OR
//   2. A string that satisfies the deterministic headline grammar
//      defined here (single-line, length-capped, no forbidden vocabulary,
//      no internal-ID prefixes, no raw decimals, must contain the
//      "currently leads" anchor, must end with a period).
//
// A regressed handler emitting arbitrary prose — even if the prose
// happens to contain the substring "currently leads" — is rejected by
// the structural rules below and falls back to the locked template.

/**
 * Exact-match set mirroring `RUN_ANALYSIS_ASSISTANT_TEMPLATES` in
 * `../tools/handlers/run-analysis.ts`. Kept here as a frozen
 * compile-time constant so the registry forwarder can do a strict
 * `.has()` membership test without importing the handler module
 * (which would cause an undesirable dependency cycle). The pinned
 * test `analysis-result-headline.test.ts > locked templates kept in
 * sync` verifies these values match the handler's source of truth.
 */
export const RUN_ANALYSIS_LOCKED_TEMPLATES: ReadonlySet<string> = new Set([
  'Ran analysis on your current scenario.',
  'Ran analysis on your current scenario. No options were compared.',
  'Ran analysis on your current scenario. Some results may be incomplete — treat with caution.',
  'Ran analysis on your current scenario. The analysis engine reported an unfamiliar status — treat the result with caution.',
  'Ran analysis on your current scenario. The engine flagged the run as partial and produced no option comparisons — treat with caution.',
]);

/**
 * Forbidden vocabulary in any run_analysis assistant_text. Case-
 * insensitive substring / word-boundary checks; mirrors the spirit of
 * the broader forbidden-user-facing-phrases list but narrowed to the
 * headline-relevant prescriptive terms.
 */
const FORBIDDEN_HEADLINE_VOCABULARY_REGEX =
  /\b(?:recommend(?:s|ed|ation|ations)?|winners?|best|optimal|preferred)\b/i;

/**
 * Slug-shape ID prefixes. Mirrors the runtime ID-prefix detector used
 * by {@link sanitiseLabel}, but applied to the whole assistant_text
 * — a regressed handler that interpolates `opt_a` into its prose
 * would be caught here even when the headline builder's label
 * sanitiser was bypassed.
 */
const ASSISTANT_TEXT_ID_REGEX = /\b(?:opt|goal|fac|node|edge|n|e)_[a-z0-9_]+/i;

/**
 * Raw decimals: `\d+\.\d+`. The headline only emits integer
 * percentages ("62%"); any decimal in the text suggests improvised
 * prose.
 */
const RAW_DECIMAL_REGEX = /\d+\.\d+/;

/**
 * Headline grammar regex set — mirrors the exact Case A/B/C/D shapes
 * {@link buildAnalysisResultHeadline} can emit, optionally followed
 * by one of the two status-suffix sentences. The placeholders
 * (winner label, driver label, fragility label, integer probability)
 * match any non-newline character sequence; the SURROUNDING tokens
 * are pinned verbatim so improvised prose containing only the
 * "currently leads" anchor (e.g. "Hire A currently leads for reasons
 * outside the deterministic headline grammar.") cannot satisfy the
 * grammar.
 *
 * Defence-in-depth rules (length cap, no newlines, no forbidden
 * vocabulary, no ID prefixes, no raw decimals) still apply on top of
 * the grammar match — a label slot or driver slot that happened to
 * contain forbidden vocabulary would still be rejected after the
 * grammar matches.
 *
 * Each pattern uses lazy `.+?` so the engine prefers shorter slot
 * matches and the trailing `\.${STATUS_SUFFIX}$` anchor pins the
 * terminator. The lazy quantifier prevents the regex from skipping
 * across a legitimate sentence boundary inside an unusual label.
 */
function escapeForRegex(source: string): string {
  return source.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}
const PARTIAL_SUFFIX_RE_SRC = escapeForRegex(PARTIAL_SUFFIX);
const UNKNOWN_SUFFIX_RE_SRC = escapeForRegex(UNKNOWN_SUFFIX);
const STATUS_SUFFIX_PATTERN = `(?:${PARTIAL_SUFFIX_RE_SRC}|${UNKNOWN_SUFFIX_RE_SRC})?`;

const HEADLINE_GRAMMAR_REGEXES: ReadonlyArray<RegExp> = [
  // Case A: winner + driver + fragility.
  new RegExp(
    `^.+? currently leads because .+? is the strongest driver, but the result is sensitive to .+?\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case B: winner + driver.
  new RegExp(
    `^.+? currently leads because .+? is the strongest driver\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case C: winner + fragility.
  new RegExp(
    `^.+? currently leads, but the result is sensitive to .+?\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
  // Case D: winner + integer-percentage probability + follow-up nudge.
  new RegExp(
    `^.+? currently leads with \\d{1,3}% probability\\. Run the follow-up checks before treating this as final\\.${STATUS_SUFFIX_PATTERN}$`,
  ),
];

function matchesHeadlineGrammar(text: string): boolean {
  for (const re of HEADLINE_GRAMMAR_REGEXES) {
    if (re.test(text)) return true;
  }
  return false;
}

/**
 * Returns true when `text` is a string the run_analysis handler is
 * permitted to expose on the wire — either an exact locked-template
 * literal, or a string that satisfies the deterministic headline
 * grammar end-to-end. The validation-registry forwarder uses this as
 * the second line of defence: if a future handler regression emits
 * improvised prose, the forwarder substitutes the locked-template
 * fallback instead of letting the prose through.
 *
 * Rules (in order):
 *   1. Must be a non-empty string.
 *   2. Must be at most {@link MAX_HEADLINE_CHARS}.
 *   3. Must not contain newline characters.
 *   4. Locked-template literals pass exactly (case-sensitive).
 *   5. Otherwise must match one of the four headline grammar regexes
 *      ({@link HEADLINE_GRAMMAR_REGEXES}) — Case A/B/C/D with an
 *      optional partial / unknown status suffix. Anchor-only prose
 *      that lacks the surrounding tokens (e.g. lacking
 *      "because X is the strongest driver" or
 *      ", but the result is sensitive to Y" or
 *      "with N% probability. Run the follow-up checks…") is rejected.
 *   6. Even when the grammar matches, the following defence-in-depth
 *      rules still apply:
 *        - no forbidden vocabulary (recommend / winner / best / …)
 *        - no ID-prefix tokens (opt_, fac_, …)
 *        - no raw decimal numbers (only integer % allowed)
 */
export function isAllowedRunAnalysisAssistantText(text: unknown): boolean {
  if (typeof text !== 'string') return false;
  if (text.length === 0 || text.length > MAX_HEADLINE_CHARS) return false;
  if (text.includes('\n') || text.includes('\r')) return false;
  if (RUN_ANALYSIS_LOCKED_TEMPLATES.has(text)) return true;
  if (!matchesHeadlineGrammar(text)) return false;
  // Defence-in-depth: grammar-shaped but content-leaky strings still
  // fail. A slot filler that happens to contain forbidden vocabulary
  // or an internal ID is caught here even though the surrounding
  // grammar matched.
  if (FORBIDDEN_HEADLINE_VOCABULARY_REGEX.test(text)) return false;
  if (ASSISTANT_TEXT_ID_REGEX.test(text)) return false;
  if (RAW_DECIMAL_REGEX.test(text)) return false;
  return true;
}
