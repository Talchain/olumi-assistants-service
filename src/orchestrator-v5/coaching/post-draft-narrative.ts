/**
 * Deterministic post-draft coaching narrative — gated hybrid composer.
 *
 * Builds the `assistant_text` for a successful draft_graph turn from
 * already-available response data — the persisted graph plus the
 * analysis_ready payload and the LLM-authored coaching fields
 * (`coachingSummary`, `strengthenItems`, `coachingBiasSignals`).
 *
 * Two output paths:
 *
 *   1. coachingSummary replacement. When `coachingSummary` is present
 *      and passes the strict whole-response gate in
 *      {@link ../coaching/copy-quality-gate.ts}, the summary is used
 *      verbatim as the entire assistant_text. No deterministic opener
 *      is prepended — the summary stands alone or it does not run.
 *
 *   2. Five-sentence hybrid. When the summary is missing or rejected,
 *      a deterministic five-sentence narrative is assembled:
 *        1. Confirm the model was built (names the goal where available).
 *        2. Summarise the main options.
 *        3. Frame the key trade-off in plain decision language.
 *        4. Name one assumption worth checking. Source picked through a
 *           strict priority chain (strengthen.detail → strengthen.label
 *           → bias_finding.explanation → coaching_bias_signal.detail →
 *           uncertainty_driver → fixed-generic), each candidate passing
 *           a deterministic copy-quality gate before being adopted.
 *        5. Point the user at running the analysis.
 *
 * Style invariants enforced by construction and by the gate:
 *   - British English ("summarise", "favour", "behaviour").
 *   - No em / en dashes.
 *   - No internal IDs — only human labels survive.
 *   - No jargon (intervention, schema, payload, analysis_ready, …).
 *   - No raw counts as the lead value.
 *   - No recommendation / winner / best-option language — the analysis
 *     has not run yet.
 *   - Under 140 words. Trailing sentences are dropped when over budget.
 *
 * The builder is defensive: every field is treated as best-effort, and
 * a graceful single-line fallback covers the case where the graph is
 * null or has no usable structure. The function returns a
 * {@link PostDraftNarrativeResult} with both the rendered `text` and a
 * lightweight `telemetry` payload describing which source filled
 * sentence 4. The caller emits the telemetry — this module never logs.
 */

import type { GraphV3T } from '../../orchestrator/types.js';

import {
  gateAssumptionFragment,
  gateFullResponse,
  type GateRejectReason,
} from './copy-quality-gate.js';

const MAX_WORDS = 140;
const MAX_LABEL_CHARS = 40;
const MAX_GOAL_CHARS = 80;
const MAX_NAMED_OPTIONS = 4;
const MAX_LISTED_WHEN_OVER = 3;

/** Length window for an acceptable uncertainty driver phrase. */
const DRIVER_MIN_CHARS = 5;
const DRIVER_MAX_CHARS = 80;

/**
 * Lowercase first-word tokens that flag the driver string as
 * question-shaped and unsuitable for use as the tail of
 * "One assumption worth checking: …". Kept narrow on purpose —
 * deterministic, easy to extend, and explicitly tested.
 */
const INTERROGATIVE_PREFIXES: ReadonlySet<string> = new Set([
  'what', 'why', 'how', 'when', 'where', 'which', 'who',
  'is', 'are', 'does', 'do', 'can', 'should', 'would',
]);

/**
 * Internal-jargon substrings (case-insensitive) for uncertainty drivers.
 * Mirrors the broader copy gate but kept colocated for the
 * driver-specific grammar guard exported as
 * {@link validateUncertaintyDriver}.
 */
const FORBIDDEN_DRIVER_SUBSTRINGS: readonly string[] = [
  'intervention',
  'schema',
  'graph node',
  'graph_node',
  'payload',
  'analysis_ready',
  'factor id',
  'factor_id',
  'node id',
  'node_id',
  'model adjustment',
  'model_adjustment',
  'bias finding',
  'bias_finding',
];

/**
 * Fixed-generic assumption-line fallback used when no source passes
 * its respective gate. Wording is deliberately broad and
 * decision-coach in tone so it never reads as a substitute for a
 * specific signal — it reads as a deliberate prompt.
 */
const FIXED_GENERIC_ASSUMPTION =
  "One assumption worth checking is whether the model's key inputs reflect your real delivery constraints.";

/**
 * Pure deterministic heuristic — accepts an uncertainty driver phrase
 * iff every condition holds (length, trailing punctuation,
 * question-shape, jargon). Kept as a narrower guard than the broader
 * {@link gateAssumptionFragment}, since drivers come from the
 * pipeline's own factor-level annotations and have historically been
 * tested at the same calibration. Exported so unit tests can pin
 * specific pass/fail fixtures.
 */
export function validateUncertaintyDriver(driver: string): boolean {
  if (typeof driver !== 'string') return false;
  const text = driver.trim();
  if (text.length < DRIVER_MIN_CHARS || text.length > DRIVER_MAX_CHARS) return false;
  if (!/\w/.test(text.charAt(text.length - 1))) return false;
  // Strip a trailing `'s` contraction before lookup so "What's the
  // bottleneck" trips the question-shape guard the same as "What is
  // the bottleneck". Mirror of the same handling in copy-quality-
  // gate.ts so both surfaces behave consistently.
  const firstToken = (text.split(/\s+/, 1)[0] ?? '')
    .toLowerCase()
    .replace(/['’]s$/, '');
  if (INTERROGATIVE_PREFIXES.has(firstToken)) return false;
  const lower = text.toLowerCase();
  for (const term of FORBIDDEN_DRIVER_SUBSTRINGS) {
    if (lower.includes(term)) return false;
  }
  return true;
}

interface NodeLite {
  readonly id?: string;
  readonly kind?: string;
  readonly label?: string;
  readonly observed_state?: {
    readonly uncertainty_drivers?: readonly string[];
  };
}

/**
 * Structural subset of the analysis_ready payload that this builder
 * actually reads. Declared locally so callers can pass either the V5
 * `AnalysisReadyPayloadT` (from `src/schemas/analysis-ready.ts`) or the
 * `GraphPatchBlockData['analysis_ready']` shape — whose `options[]`
 * entries use `option_id` instead of `id` — without a type-cast at the
 * call site. Neither `options` nor any option-keyed field is read here.
 */
export interface PostDraftAnalysisReadyLite {
  readonly model_adjustments?: ReadonlyArray<unknown> | undefined;
  readonly bias_findings?: ReadonlyArray<unknown> | undefined;
}

/**
 * Telemetry source labels emitted alongside the rendered text. Closed
 * set — see {@link PostDraftNarrativeTelemetry}. Category-only; the
 * caller never logs the underlying source text.
 */
export type AssumptionSource =
  | 'coaching_summary'
  | 'strengthen_item_detail'
  | 'strengthen_item_label'
  | 'bias_finding'
  | 'coaching_bias_signal'
  | 'uncertainty_driver'
  | 'deterministic_fallback';

/**
 * Coarse fallback category emitted alongside {@link AssumptionSource}.
 *   - `gate_rejected`: a higher-priority candidate existed but failed
 *     the copy-quality gate.
 *   - `no_candidate`: no higher-priority candidate was available at all.
 *   - `null`: the highest-priority available source was used cleanly.
 */
export type FallbackReason = 'gate_rejected' | 'no_candidate' | null;

export interface PostDraftNarrativeTelemetry {
  readonly assumption_source: AssumptionSource;
  readonly coaching_summary_present: boolean;
  readonly coaching_summary_passed_gate: boolean;
  /**
   * When `coachingSummary` was present but rejected by
   * {@link gateFullResponse}, the category of the first failing rule.
   * `null` when the summary was missing or accepted. Category-only —
   * never carries raw user or coaching text.
   */
  readonly coaching_summary_reject_reason: GateRejectReason | null;
  readonly fallback_reason: FallbackReason;
  readonly strengthen_items_count: number;
  readonly bias_findings_count: number;
  readonly coaching_bias_signals_count: number;
}

export interface PostDraftNarrativeResult {
  readonly text: string;
  readonly telemetry: PostDraftNarrativeTelemetry;
}

export interface BuildPostDraftNarrativeInput {
  readonly graph: GraphV3T | null;
  readonly analysisReady?: PostDraftAnalysisReadyLite | null;
  readonly strengthenItems?: ReadonlyArray<unknown> | null;
  readonly coachingSummary?: string | null;
  readonly coachingBiasSignals?: ReadonlyArray<unknown> | null;
}

/**
 * Build the deterministic post-draft assistant_text and its source
 * telemetry. Pure function. Never throws. Always returns a non-empty
 * `text`.
 */
export function buildPostDraftNarrative(input: BuildPostDraftNarrativeInput): PostDraftNarrativeResult {
  const { graph, analysisReady, strengthenItems, coachingSummary, coachingBiasSignals } = input;

  const strengthenItemsCount = Array.isArray(strengthenItems) ? strengthenItems.length : 0;
  const biasFindingsCount = Array.isArray(analysisReady?.bias_findings)
    ? (analysisReady?.bias_findings?.length ?? 0)
    : 0;
  const coachingBiasSignalsCount = Array.isArray(coachingBiasSignals) ? coachingBiasSignals.length : 0;

  const summaryCandidate =
    typeof coachingSummary === 'string' ? coachingSummary.trim() : '';
  const coachingSummaryPresent = summaryCandidate.length > 0;

  // Run the full-response gate once so we can capture both the
  // pass/fail and (on fail) the categorical reject reason for ops
  // telemetry — without re-running the gate.
  const summaryGateResult = coachingSummaryPresent
    ? gateFullResponse(summaryCandidate)
    : null;
  const summaryRejectReason: GateRejectReason | null =
    summaryGateResult && !summaryGateResult.accept
      ? (summaryGateResult.rejectReason ?? null)
      : null;

  // Short-circuit: coachingSummary may replace the WHOLE response when
  // it passes the strict full-response gate. No deterministic opener is
  // prepended — the summary stands alone or it does not run.
  if (summaryGateResult && summaryGateResult.accept) {
    return {
      text: summaryCandidate,
      telemetry: {
        assumption_source: 'coaching_summary',
        coaching_summary_present: true,
        coaching_summary_passed_gate: true,
        coaching_summary_reject_reason: null,
        fallback_reason: null,
        strengthen_items_count: strengthenItemsCount,
        bias_findings_count: biasFindingsCount,
        coaching_bias_signals_count: coachingBiasSignalsCount,
      },
    };
  }

  const nodes = (graph?.nodes ?? []) as readonly NodeLite[];

  if (nodes.length === 0) {
    return {
      text: 'Your decision model is ready to explore.',
      telemetry: {
        assumption_source: 'deterministic_fallback',
        coaching_summary_present: coachingSummaryPresent,
        coaching_summary_passed_gate: false,
        coaching_summary_reject_reason: summaryRejectReason,
        fallback_reason: 'no_candidate',
        strengthen_items_count: strengthenItemsCount,
        bias_findings_count: biasFindingsCount,
        coaching_bias_signals_count: coachingBiasSignalsCount,
      },
    };
  }

  const goalLabel = findGoalLabel(nodes);
  const options = collectLabels(nodes, 'option');
  const factors = collectLabels(nodes, 'factor');
  const risks = collectLabels(nodes, 'risk');

  const sentences: string[] = [];
  sentences.push(buildConfirmSentence(goalLabel));

  const optionSentence = buildOptionsSentence(options);
  if (optionSentence) sentences.push(optionSentence);

  const tradeOffSentence = buildTradeOffSentence(factors, risks);
  if (tradeOffSentence) sentences.push(tradeOffSentence);

  const assumption = pickAssumption({
    nodes,
    analysisReady,
    strengthenItems,
    coachingBiasSignals,
  });
  if (assumption.text) sentences.push(assumption.text);

  sentences.push(
    'Next, run the analysis to see how the options compare and what could shift the outcome.',
  );

  return {
    text: enforceWordBudget(sentences),
    telemetry: {
      assumption_source: assumption.source,
      coaching_summary_present: coachingSummaryPresent,
      coaching_summary_passed_gate: false,
      coaching_summary_reject_reason: summaryRejectReason,
      fallback_reason: assumption.fallbackReason,
      strengthen_items_count: strengthenItemsCount,
      bias_findings_count: biasFindingsCount,
      coaching_bias_signals_count: coachingBiasSignalsCount,
    },
  };
}

// ----- sentence builders ----------------------------------------------------

function buildConfirmSentence(goalLabel: string | null): string {
  if (!goalLabel) {
    return "I've built a first decision model from your brief.";
  }
  const safe = truncate(goalLabel, MAX_GOAL_CHARS);
  return `I've built a first decision model for "${safe}".`;
}

function buildOptionsSentence(options: readonly string[]): string | null {
  if (options.length === 0) return null;
  const trimmed = options.map((label) => truncate(label, MAX_LABEL_CHARS));

  if (trimmed.length === 1) {
    return `The model so far includes one route: ${trimmed[0]}.`;
  }
  if (trimmed.length <= MAX_NAMED_OPTIONS) {
    const word = numberWord(trimmed.length);
    return `I'm comparing ${word} routes: ${formatList(trimmed)}.`;
  }
  // 5+ options — summarise the leading three.
  const headline = formatList(trimmed.slice(0, MAX_LISTED_WHEN_OVER));
  return `The main routes include ${headline}, with further variants on the canvas.`;
}

function buildTradeOffSentence(
  factors: readonly string[],
  risks: readonly string[],
): string | null {
  const trimmedFactors = factors.map((l) => truncate(l, MAX_LABEL_CHARS));
  if (trimmedFactors.length >= 2) {
    return `The main trade-off centres on ${trimmedFactors[0]} balanced against ${trimmedFactors[1]}.`;
  }
  if (trimmedFactors.length === 1 && risks.length >= 1) {
    const risk = truncate(risks[0], MAX_LABEL_CHARS);
    return `The main trade-off weighs ${trimmedFactors[0]} against the risk of ${risk}.`;
  }
  if (trimmedFactors.length === 1) {
    return `A key consideration is ${trimmedFactors[0]}.`;
  }
  if (risks.length >= 1) {
    const risk = truncate(risks[0], MAX_LABEL_CHARS);
    return `A key consideration is the risk of ${risk}.`;
  }
  return null;
}

interface AssumptionPick {
  readonly text: string;
  readonly source: AssumptionSource;
  readonly fallbackReason: FallbackReason;
}

/**
 * Strict source-priority chain for sentence 4:
 *   1. strengthenItems[0].detail (then .label)
 *   2. first acceptable analysisReady.bias_findings[*].explanation
 *   3. first acceptable coachingBiasSignals[*].detail
 *   4. uncertainty_driver (with grammar guard)
 *   5. fixed-generic
 *
 * For priorities 2 and 3 the picker iterates the array and returns the
 * first element whose extracted text (or first-sentence slice)
 * survives {@link gateAssumptionFragment}. Strengthen always reads
 * `[0]` only — first item is the highest-confidence coaching signal
 * the pipeline produced.
 *
 * `fallback_reason` distinguishes `gate_rejected` (a higher-priority
 * candidate existed but failed) from `no_candidate` (nothing was
 * available at all, so we fell through to the generic).
 */
function pickAssumption(input: {
  readonly nodes: readonly NodeLite[];
  readonly analysisReady: PostDraftAnalysisReadyLite | null | undefined;
  readonly strengthenItems: ReadonlyArray<unknown> | null | undefined;
  readonly coachingBiasSignals: ReadonlyArray<unknown> | null | undefined;
}): AssumptionPick {
  const { nodes, analysisReady, strengthenItems, coachingBiasSignals } = input;
  let anyCandidateRejected = false;

  // Priority 1: strengthenItems — prefer .detail, fall back to .label.
  const strengthen = pickStrengthenAssumption(strengthenItems);
  if (strengthen) {
    return {
      text: `One assumption worth checking: ${strengthen.text}.`,
      source: strengthen.source,
      fallbackReason: null,
    };
  }
  if (Array.isArray(strengthenItems) && strengthenItems.length > 0) {
    anyCandidateRejected = true;
  }

  // Priority 2: bias_findings.explanation
  const biasFinding = pickBiasFindingAssumption(analysisReady);
  if (biasFinding) {
    return {
      text: `One assumption worth checking: ${biasFinding}.`,
      source: 'bias_finding',
      fallbackReason: anyCandidateRejected ? 'gate_rejected' : null,
    };
  }
  if (Array.isArray(analysisReady?.bias_findings) && (analysisReady?.bias_findings?.length ?? 0) > 0) {
    anyCandidateRejected = true;
  }

  // Priority 3: coachingBiasSignals.detail
  const coachingBias = pickCoachingBiasSignalAssumption(coachingBiasSignals);
  if (coachingBias) {
    return {
      text: `One assumption worth checking: ${coachingBias}.`,
      source: 'coaching_bias_signal',
      fallbackReason: anyCandidateRejected ? 'gate_rejected' : null,
    };
  }
  if (Array.isArray(coachingBiasSignals) && coachingBiasSignals.length > 0) {
    anyCandidateRejected = true;
  }

  // Priority 4: uncertainty_driver (factor-level, with grammar guard).
  const driver = pickUncertaintyDriver(nodes);
  if (driver) {
    if (validateUncertaintyDriver(driver)) {
      return {
        text: `One assumption worth checking: ${cleanLeadIn(driver)}.`,
        source: 'uncertainty_driver',
        fallbackReason: anyCandidateRejected ? 'gate_rejected' : null,
      };
    }
    anyCandidateRejected = true;
  }

  // Priority 5: fixed-generic.
  return {
    text: FIXED_GENERIC_ASSUMPTION,
    source: 'deterministic_fallback',
    fallbackReason: anyCandidateRejected ? 'gate_rejected' : 'no_candidate',
  };
}

// ----- assumption-source pickers --------------------------------------------

function pickStrengthenAssumption(
  items: ReadonlyArray<unknown> | null | undefined,
):
  | { readonly text: string; readonly source: 'strengthen_item_detail' | 'strengthen_item_label' }
  | null {
  if (!Array.isArray(items) || items.length === 0) return null;
  const first = items[0];
  if (typeof first !== 'object' || first === null) return null;

  const detail = (first as { detail?: unknown }).detail;
  const label = (first as { label?: unknown }).label;

  // Try the full detail first (richer coaching value). If too long /
  // gate-rejected, try the first-sentence slice of the detail.
  if (typeof detail === 'string') {
    const candidate = cleanLeadIn(detail);
    if (candidate.length > 0 && gateAssumptionFragment(candidate).accept) {
      return { text: candidate, source: 'strengthen_item_detail' };
    }
    const firstSentence = extractFirstSentence(detail);
    if (firstSentence) {
      const cleaned = cleanLeadIn(firstSentence);
      if (cleaned.length > 0 && gateAssumptionFragment(cleaned).accept) {
        return { text: cleaned, source: 'strengthen_item_detail' };
      }
    }
  }

  // Fall back to label.
  if (typeof label === 'string') {
    const cleaned = cleanLeadIn(label);
    if (cleaned.length > 0 && gateAssumptionFragment(cleaned).accept) {
      return { text: cleaned, source: 'strengthen_item_label' };
    }
  }

  return null;
}

function pickBiasFindingAssumption(
  analysisReady: PostDraftAnalysisReadyLite | null | undefined,
): string | null {
  const findings = analysisReady?.bias_findings;
  if (!Array.isArray(findings) || findings.length === 0) return null;
  for (const f of findings) {
    if (typeof f !== 'object' || f === null) continue;
    const explanation = (f as { explanation?: unknown }).explanation;
    if (typeof explanation !== 'string') continue;
    const candidate = cleanLeadIn(explanation);
    if (candidate.length > 0 && gateAssumptionFragment(candidate).accept) {
      return candidate;
    }
    const firstSentence = extractFirstSentence(explanation);
    if (firstSentence) {
      const cleaned = cleanLeadIn(firstSentence);
      if (cleaned.length > 0 && gateAssumptionFragment(cleaned).accept) return cleaned;
    }
  }
  return null;
}

function pickCoachingBiasSignalAssumption(
  signals: ReadonlyArray<unknown> | null | undefined,
): string | null {
  if (!Array.isArray(signals) || signals.length === 0) return null;
  for (const s of signals) {
    if (typeof s !== 'object' || s === null) continue;
    const detail = (s as { detail?: unknown }).detail;
    if (typeof detail !== 'string') continue;
    const candidate = cleanLeadIn(detail);
    if (candidate.length > 0 && gateAssumptionFragment(candidate).accept) {
      return candidate;
    }
    const firstSentence = extractFirstSentence(detail);
    if (firstSentence) {
      const cleaned = cleanLeadIn(firstSentence);
      if (cleaned.length > 0 && gateAssumptionFragment(cleaned).accept) return cleaned;
    }
  }
  return null;
}

// ----- data accessors -------------------------------------------------------

function findGoalLabel(nodes: readonly NodeLite[]): string | null {
  for (const n of nodes) {
    if (n.kind === 'goal' && typeof n.label === 'string' && n.label.trim().length > 0) {
      return n.label.trim();
    }
  }
  return null;
}

function collectLabels(nodes: readonly NodeLite[], kind: string): string[] {
  const out: string[] = [];
  for (const n of nodes) {
    if (n.kind !== kind) continue;
    if (typeof n.label !== 'string') continue;
    const trimmed = n.label.trim();
    if (trimmed.length === 0) continue;
    out.push(trimmed);
  }
  return out;
}

function pickUncertaintyDriver(nodes: readonly NodeLite[]): string | null {
  for (const n of nodes) {
    if (n.kind !== 'factor') continue;
    const drivers = n.observed_state?.uncertainty_drivers;
    if (!drivers || drivers.length === 0) continue;
    for (const d of drivers) {
      if (typeof d === 'string' && d.trim().length > 0) return d.trim();
    }
  }
  return null;
}

// ----- text utilities -------------------------------------------------------

function truncate(label: string, max: number): string {
  const trimmed = label.trim();
  if (trimmed.length <= max) return trimmed;
  const cut = trimmed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > Math.floor(max / 2) ? cut.slice(0, lastSpace).trim() : cut.trim();
}

function formatList(items: readonly string[]): string {
  if (items.length === 0) return '';
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  const last = items[items.length - 1];
  const rest = items.slice(0, -1).join(', ');
  return `${rest} and ${last}`;
}

function numberWord(n: number): string {
  switch (n) {
    case 2: return 'two';
    case 3: return 'three';
    case 4: return 'four';
    default: return String(n);
  }
}

function cleanLeadIn(s: string): string {
  // Strip leading bullet / dash glyph the pipeline may have left in
  // place, then strip ALL trailing sentence-end punctuation
  // (handles doubled-punct cases like "Foo.!" or "Foo!?" — single-
  // char .slice(-1) would only strip one).
  const trimmed = s.trim().replace(/^[-•*]+\s*/, '').trim();
  return trimmed.replace(/[.!?]+$/, '').trim();
}

/**
 * Return the prefix of `text` up to (but not including) the first
 * sentence-terminating punctuation (`.`, `!`, `?`) that is followed by
 * whitespace OR end-of-string. The whitespace/EOS lookahead avoids
 * splitting on decimal numbers (`$1.5M`, `1.2x`) and abbreviations
 * with no following space. Returns `null` when no such terminator
 * exists or the resulting prefix is empty after trimming.
 *
 * Examples:
 *   - "Hello world. How are you?" → "Hello world"
 *   - "The estimate is $1.5M. Recast it." → "The estimate is $1.5M"
 *   - "No terminator here"            → null
 */
function extractFirstSentence(text: string): string | null {
  const m = text.match(/^(.*?)[.!?](?=\s|$)/);
  if (!m) return null;
  const candidate = m[1].trim();
  return candidate.length > 0 ? candidate : null;
}

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

/**
 * Join sentences and, if over the 140-word ceiling, drop the
 * assumption sentence first (penultimate) and then the trade-off
 * sentence. The confirmation, options summary, and the "run the
 * analysis" guide are load-bearing and always kept.
 */
function enforceWordBudget(initial: string[]): string {
  const sentences = [...initial];
  // Indexes from front: 0=confirm, 1=options, 2=tradeoff, 3=assumption, 4=next
  // Drop order: assumption (3), then trade-off (2). Never drop 0, 1 or 4.
  const dropOrder = [3, 2];
  let joined = sentences.join(' ');
  for (const idx of dropOrder) {
    if (countWords(joined) <= MAX_WORDS) break;
    if (idx >= sentences.length) continue;
    sentences.splice(idx, 1);
    joined = sentences.join(' ');
  }
  return joined;
}
