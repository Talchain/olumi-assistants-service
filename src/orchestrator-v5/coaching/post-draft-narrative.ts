/**
 * Deterministic post-draft coaching narrative.
 *
 * Builds the `assistant_text` for a successful draft_graph turn from
 * already-available response data — the persisted graph plus the
 * analysis_ready payload. No LLM call. No new context fetch.
 *
 * Replaces the prior thin "Your decision model for X is ready, with N
 * options, M factors, and K risks to consider." copy. The new shape is
 * five short sentences:
 *
 *   1. Confirm the model was built (names the goal where available).
 *   2. Summarise the main options.
 *   3. Frame the key trade-off in plain decision language.
 *   4. Name one or two assumptions worth checking.
 *   5. Point the user at running the analysis.
 *
 * Style invariants enforced by construction:
 *   - British English ("summarise", "favour", "behaviour").
 *   - No em dashes.
 *   - No internal IDs — only human labels.
 *   - No jargon: "intervention", "schema", "graph node", "payload",
 *     "analysis_ready", "factor IDs", "model adjustment", "bias finding".
 *   - No raw counts as the lead value.
 *   - No recommendation — analysis has not run yet.
 *   - Under 140 words. Trailing sentences are dropped when over budget.
 *
 * The builder is defensive: every field is treated as best-effort, and a
 * graceful single-line fallback covers the case where the graph is null
 * or has no usable structure.
 */

import type { GraphV3T } from '../../orchestrator/types.js';

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
 * Internal-jargon substrings (case-insensitive). Mirrors the
 * forbidden-list enforced by the dispatch unit tests' `assertCleanCopy`
 * helper. Any match disqualifies the driver and routes us to the fixed
 * generic fallback.
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
 * Fixed-generic assumption-line fallback used when an uncertainty driver
 * candidate exists but fails the grammar guard. Wording is deliberately
 * broad and decision-coach in tone so it never reads as a substitute for
 * a missing signal — it reads as a deliberate prompt.
 */
const FIXED_GENERIC_ASSUMPTION =
  "One assumption worth checking is whether the model's key inputs reflect your real delivery constraints.";

/**
 * Pure deterministic heuristic — accepts an uncertainty driver phrase
 * iff every condition holds:
 *
 *   1. After trimming, the length is between {@link DRIVER_MIN_CHARS}
 *      and {@link DRIVER_MAX_CHARS} characters (inclusive).
 *   2. The final character is a word character (letter, digit or
 *      underscore). Trailing punctuation that breaks sentence flow —
 *      `.`, `?`, `!`, `,`, `;` — disqualifies the phrase, because the
 *      builder appends a `.` already and the user would otherwise see
 *      a doubled stop.
 *   3. The first whitespace-delimited token (case-insensitive) is not
 *      one of {@link INTERROGATIVE_PREFIXES}. Question-shaped phrases
 *      do not read naturally after "One assumption worth checking:".
 *   4. No {@link FORBIDDEN_DRIVER_SUBSTRINGS} appears anywhere in the
 *      phrase (case-insensitive). Mirrors the broader copy ban on
 *      internal jargon and IDs.
 *
 * Returns `true` when the phrase is safe to embed verbatim; `false`
 * otherwise. Exported so the unit tests can pin specific pass/fail
 * fixtures.
 */
export function validateUncertaintyDriver(driver: string): boolean {
  if (typeof driver !== 'string') return false;
  const text = driver.trim();
  if (text.length < DRIVER_MIN_CHARS || text.length > DRIVER_MAX_CHARS) return false;
  if (!/\w/.test(text.charAt(text.length - 1))) return false;
  const firstToken = text.split(/\s+/, 1)[0]?.toLowerCase() ?? '';
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

export interface BuildPostDraftNarrativeInput {
  readonly graph: GraphV3T | null;
  readonly analysisReady?: PostDraftAnalysisReadyLite | null;
}

/**
 * Build the deterministic post-draft assistant_text.
 *
 * Pure function. Never throws. Always returns a non-empty string.
 */
export function buildPostDraftNarrative(input: BuildPostDraftNarrativeInput): string {
  const { graph, analysisReady } = input;
  const nodes = (graph?.nodes ?? []) as readonly NodeLite[];

  if (nodes.length === 0) {
    return 'Your decision model is ready to explore.';
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

  const assumptionSentence = buildAssumptionSentence(nodes, analysisReady);
  if (assumptionSentence) sentences.push(assumptionSentence);

  sentences.push(
    'Next, run the analysis to see how the options compare and what could shift the outcome.',
  );

  return enforceWordBudget(sentences);
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

function buildAssumptionSentence(
  nodes: readonly NodeLite[],
  analysisReady: PostDraftAnalysisReadyLite | null | undefined,
): string | null {
  // Priority 1: factor-level uncertainty drivers — user-facing phrases
  // produced upstream in the unified pipeline. We additionally enforce
  // the deterministic grammar guard so a malformed phrase can never
  // produce awkward copy. When a driver candidate exists but fails the
  // guard we DELIBERATELY short-circuit to the fixed-generic copy
  // instead of falling through to priorities 2 or 3: the presence of a
  // driver signal already attests to relevant uncertainty in the graph,
  // so the right response is a generic prompt, not a different topic.
  const driver = pickUncertaintyDriver(nodes);
  if (driver) {
    if (validateUncertaintyDriver(driver)) {
      return `One assumption worth checking: ${cleanLeadIn(driver)}.`;
    }
    return FIXED_GENERIC_ASSUMPTION;
  }

  // Priority 2: one model_adjustment, translated through its `reason`
  // field (which is the human-readable narrative the pipeline already
  // produced). We never expose `code`, `field`, `before` or `after`.
  const adjustmentReason = pickAdjustmentReason(analysisReady);
  if (adjustmentReason) {
    return `One assumption worth checking: ${cleanLeadIn(adjustmentReason)}.`;
  }

  // Priority 3: one bias_finding explanation — same principle as above.
  const biasExplanation = pickBiasExplanation(analysisReady);
  if (biasExplanation) {
    return `One assumption worth checking: ${cleanLeadIn(biasExplanation)}.`;
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

function pickAdjustmentReason(
  analysisReady: PostDraftAnalysisReadyLite | null | undefined,
): string | null {
  const adjustments = analysisReady?.model_adjustments;
  if (!adjustments || adjustments.length === 0) return null;
  for (const adj of adjustments) {
    if (typeof adj !== 'object' || adj === null) continue;
    const reason = (adj as { reason?: unknown }).reason;
    if (typeof reason === 'string' && reason.trim().length > 0) return reason.trim();
  }
  return null;
}

function pickBiasExplanation(
  analysisReady: PostDraftAnalysisReadyLite | null | undefined,
): string | null {
  const findings = analysisReady?.bias_findings;
  if (!findings || findings.length === 0) return null;
  for (const f of findings) {
    if (typeof f !== 'object' || f === null) continue;
    const explanation = (f as { explanation?: unknown }).explanation;
    if (typeof explanation === 'string' && explanation.trim().length > 0) {
      return explanation.trim();
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
  // Strip any leading bullet / dash glyph the pipeline may have left in
  // place and any sentence-ending punctuation we are about to add back.
  const trimmed = s.trim().replace(/^[-•*]+\s*/, '').trim();
  return trimmed.endsWith('.') || trimmed.endsWith('!') || trimmed.endsWith('?')
    ? trimmed.slice(0, -1)
    : trimmed;
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
