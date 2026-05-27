/**
 * V5 deterministic analysis-result headline builder.
 *
 * Pure helper consumed by the run_analysis handler. Builds a one-sentence
 * British-English headline from the already-available PLoT V2RunResponseEnvelope
 * fields (leading option label, top driver, fragility) when sufficient data is
 * present. Returns null when data is too thin — the handler then falls back to
 * the locked RUN_ANALYSIS_ASSISTANT_TEMPLATES string.
 *
 * Invariants:
 *  - No LLM call. No I/O. No telemetry side effects. No graph mutation.
 *  - No raw decimals in output (win_probability is rendered as integer %).
 *  - No internal IDs leak (winner / driver / fragility labels are guarded
 *    against ID-shaped strings).
 *  - One sentence — max ~220 chars including the status suffix.
 *  - Uses "currently leads", "provisional", "sensitive to" — never
 *    "best" / "recommended".
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

const MAX_HEADLINE_CHARS = 220;

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

  const winnerLabel = resolveWinnerLabel(enrichment, leading_option_id);
  if (winnerLabel === null) return null;

  const winnerProbability = resolveWinnerProbability(
    enrichment,
    leading_option_id,
  );

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

  // Case D: winner + win_probability (≥ 50%), no driver/fragility.
  if (winnerProbability !== null && winnerProbability >= 0.5) {
    const pct = Math.round(winnerProbability * 100);
    const caseD =
      `${winnerLabel} currently leads with ${pct}% probability.` +
      ` Run the follow-up checks before treating this as final.${suffix}`;
    return caseD.length <= MAX_HEADLINE_CHARS ? caseD : null;
  }

  // Winner alone (no driver, fragility, or usable probability) — fall back.
  return null;
}

function statusSuffix(kind: AnalysisResultHeadlineInput['status_kind']): string {
  if (kind === 'partial') return PARTIAL_SUFFIX;
  if (kind === 'unknown') return UNKNOWN_SUFFIX;
  return '';
}

function resolveWinnerLabel(
  enrichment: Record<string, unknown>,
  leadingOptionId: string,
): string | null {
  const sources = readResultsArraySources(enrichment);
  if (sources.length === 0) return null;

  const id = leadingOptionId.trim();
  for (const source of sources) {
    const winner = selectWinner(source, id.length > 0 ? id : null);
    if (winner === null) continue;
    const cleaned = sanitiseLabel(winner.label, winner.id);
    if (cleaned !== null) return cleaned;
    // Winner found but label is ID-shaped — bail out rather than headline an ID.
    return null;
  }
  return null;
}

function resolveWinnerProbability(
  enrichment: Record<string, unknown>,
  leadingOptionId: string,
): number | null {
  const sources = readResultsArraySources(enrichment);
  if (sources.length === 0) return null;

  const id = leadingOptionId.trim();
  for (const source of sources) {
    const winner = selectWinner(source, id.length > 0 ? id : null);
    if (winner === null) continue;
    const p = readNumber(winner.win_probability);
    if (p !== null) return p;
  }
  return null;
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
