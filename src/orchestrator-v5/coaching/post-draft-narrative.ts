/**
 * Deterministic post-draft coaching narrative — gated sectioned composer.
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
 *   2. Sectioned narrative. When the summary is missing or rejected,
 *      the builder assembles up to four blocks separated by blank
 *      lines so the UI can render short paragraphs and bullets:
 *
 *        Block 1 — Confirm sentence
 *          Names the goal where available, otherwise a short generic
 *          confirmation.
 *
 *        Block 2 — `Options compared` section
 *          One bullet per named option (up to 4); for 5+ the first
 *          three are bulleted and a closing `Other variants are on
 *          the canvas.` bullet covers the rest. For a single-option
 *          model the block degrades to an inline sentence.
 *
 *        Block 3 — `What the model is weighing` section
 *          One bullet for the main trade-off, one for an assumption
 *          worth checking. Assumption source priority chain:
 *          strengthen.detail → strengthen.label → bias_finding.
 *          explanation → coaching_bias_signal.detail → uncertainty
 *          driver → fixed-generic. Each candidate passes a copy-
 *          quality gate before being adopted. The block is omitted
 *          entirely when no factor / risk / assumption survives.
 *
 *        Block 4 — Run-analysis nudge
 *          A short call-to-action.
 *
 * Style invariants enforced by construction and by the gate:
 *   - British English ("summarise", "favour", "behaviour").
 *   - No em / en dashes.
 *   - No internal IDs — only human labels survive.
 *   - No jargon (intervention, schema, payload, analysis_ready, …).
 *   - No raw counts as the lead value.
 *   - No recommendation / winner / best-option language — the analysis
 *     has not run yet.
 *   - No markdown formatting — section labels are plain text on their
 *     own line, bullets use `• ` (U+2022). The wire field is a plain
 *     string; the UI renders newlines as visual line breaks.
 *   - Under 140 words. Sections are dropped (weighing first, then
 *     options) when over budget. Confirm and next-step never drop.
 *
 * The builder is defensive: every field is treated as best-effort, and
 * a graceful single-line fallback covers the case where the graph is
 * null or has no usable structure. The function returns a
 * {@link PostDraftNarrativeResult} with both the rendered `text` and a
 * lightweight `telemetry` payload describing which source filled the
 * assumption bullet. The caller emits the telemetry — this module
 * never logs.
 */

import type { GraphV3T, DraftCoachingWideningLog } from '../../orchestrator/types.js';

import {
  gateAssumptionFragment,
  gateFullResponse,
  type GateRejectReason,
} from './copy-quality-gate.js';

/**
 * RC4 proportionate remedies: run a candidate through
 * {@link gateAssumptionFragment} and return the SANITISED text to render
 * (style offences such as em/en dashes are rewritten in place by the
 * gate), or null on rejection. Callers must render the returned text,
 * never the raw candidate.
 */
function gatedFragmentText(candidate: string): string | null {
  if (candidate.length === 0) return null;
  const gated = gateAssumptionFragment(candidate);
  return gated.accept ? (gated.text ?? candidate) : null;
}

const MAX_WORDS = 140;
const MAX_LABEL_CHARS = 40;
const MAX_GOAL_CHARS = 80;
const MAX_NAMED_OPTIONS = 4;
const MAX_LISTED_WHEN_OVER = 3;

/**
 * Cap on EXTRA "check" bullets surfaced in the weighing section beyond the
 * single primary assumption bullet. One keeps the section at most one line
 * longer than today — enough to add a second high-value point without
 * overwhelming the reader.
 */
const MAX_ADDITIONAL_CHECKS = 1;

/**
 * Calm advisory phrases mapped from the widening_log `brief_completeness`
 * enum. The enum value is NEVER emitted verbatim — it selects a phrase.
 * `complete` surfaces nothing (no nudge needed). Hard-coded trusted copy
 * (same pattern as {@link FIXED_GENERIC_ASSUMPTION}): British English, no
 * graph-shape words, no schema terms, no sentence-leading commit verbs, no
 * em / en dashes — so it passes both the assumption-fragment gate and the
 * egress success-claim / forbidden-phrase guards by construction.
 */
const COMPLETENESS_ADVISORY: Record<DraftCoachingWideningLog['brief_completeness'], string | null> = {
  complete: null,
  partial:
    'Your brief covered the main points; adding detail on the lighter areas would sharpen the comparison.',
  thin: 'Your brief was light on detail, so adding specifics will make the comparison more reliable.',
};

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
  /**
   * RC4 proportionate remedies: true when the accepted coachingSummary was
   * shipped with a deterministic STYLE rewrite applied in place (em/en
   * dashes). False when the summary shipped verbatim, was rejected, or was
   * absent. Ops visibility for the rewrite-don't-drop remedy.
   */
  readonly coaching_summary_style_rewritten: boolean;
  readonly fallback_reason: FallbackReason;
  readonly strengthen_items_count: number;
  readonly bias_findings_count: number;
  readonly coaching_bias_signals_count: number;
  // ── Copy-source delivery diagnostics (additive; category/count only,
  //    never raw coaching text or IDs) ──────────────────────────────────
  /** Whether a canonical widening_log object was supplied to the builder. */
  readonly widening_log_present: boolean;
  /**
   * The widening_log `brief_completeness` enum value, or null when absent.
   * The enum value is telemetry-only — it is never emitted into user copy
   * verbatim (it is mapped to an advisory phrase first).
   */
  readonly brief_completeness: 'complete' | 'partial' | 'thin' | null;
  /** Whether the brief-completeness advisory line survived into the rendered
   *  text (false for `complete`, when absent, or when dropped under budget). */
  readonly brief_completeness_surfaced: boolean;
  /** Count of EXTRA "check" bullets surfaced in the rendered text beyond the
   *  single primary assumption bullet (0 or 1 under the current cap). */
  readonly additional_checks_surfaced: number;
  /** Source category of the extra check bullet, or null when none surfaced. */
  readonly additional_check_source: 'strengthen_item' | 'coaching_bias_signal' | null;
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
  /**
   * Canonical (v0.11.0+) coaching.widening_log object. Only `brief_completeness`
   * is surfaced (mapped to an advisory phrase); `elements_considered_but_excluded`
   * and especially `elements_added` (NODE IDs) are never rendered raw.
   */
  readonly wideningLog?: DraftCoachingWideningLog | null;
}

/**
 * Build the deterministic post-draft assistant_text and its source
 * telemetry. Pure function. Never throws. Always returns a non-empty
 * `text`.
 */
export function buildPostDraftNarrative(input: BuildPostDraftNarrativeInput): PostDraftNarrativeResult {
  const { graph, analysisReady, strengthenItems, coachingSummary, coachingBiasSignals, wideningLog } = input;

  const wideningLogPresent = wideningLog != null;
  const briefCompleteness = wideningLog?.brief_completeness ?? null;

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
  // RC4: render the gate's SANITISED text (style offences such as em/en
  // dashes are rewritten in place), never the raw candidate.
  if (summaryGateResult && summaryGateResult.accept) {
    return {
      text: summaryGateResult.text ?? summaryCandidate,
      telemetry: {
        assumption_source: 'coaching_summary',
        coaching_summary_present: true,
        coaching_summary_passed_gate: true,
        coaching_summary_reject_reason: null,
        coaching_summary_style_rewritten: summaryGateResult.styleRewritten === true,
        fallback_reason: null,
        strengthen_items_count: strengthenItemsCount,
        bias_findings_count: biasFindingsCount,
        coaching_bias_signals_count: coachingBiasSignalsCount,
        // Verbatim-summary path renders no deterministic blocks.
        widening_log_present: wideningLogPresent,
        brief_completeness: briefCompleteness,
        brief_completeness_surfaced: false,
        additional_checks_surfaced: 0,
        additional_check_source: null,
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
        coaching_summary_style_rewritten: false,
        fallback_reason: 'no_candidate',
        strengthen_items_count: strengthenItemsCount,
        bias_findings_count: biasFindingsCount,
        coaching_bias_signals_count: coachingBiasSignalsCount,
        // Graphless single-line fallback renders no deterministic blocks.
        widening_log_present: wideningLogPresent,
        brief_completeness: briefCompleteness,
        brief_completeness_surfaced: false,
        additional_checks_surfaced: 0,
        additional_check_source: null,
      },
    };
  }

  const goalLabel = findGoalLabel(nodes);
  const options = collectLabels(nodes, 'option');
  const factors = collectLabels(nodes, 'factor');
  const risks = collectLabels(nodes, 'risk');

  const confirmSentence = buildConfirmSentence(goalLabel);

  const optionsBlock = buildOptionsBlock(options);

  const tradeOffBullet = buildTradeOffBullet(factors, risks);

  const assumption = pickAssumption({
    nodes,
    analysisReady,
    strengthenItems,
    coachingBiasSignals,
  });
  const assumptionBullet = assumption.text ? toAssumptionBullet(assumption.text) : null;

  // One extra "check" bullet from the next unused coaching signal. Seed the
  // dedup set with the text the assumption bullet already used (label stripped)
  // so the same signal is never surfaced twice.
  const usedTexts = new Set<string>();
  if (assumptionBullet) usedTexts.add(normaliseForDedup(stripBulletLabel(assumptionBullet)));
  const additionalChecks = pickAdditionalChecks({
    strengthenItems,
    coachingBiasSignals,
    alreadyUsed: usedTexts,
    limit: MAX_ADDITIONAL_CHECKS,
  });
  const additionalBullets = additionalChecks.map((c) => toCheckBullet(c.text));

  const coreBullets = [
    ...(tradeOffBullet ? [tradeOffBullet] : []),
    ...(assumptionBullet ? [assumptionBullet] : []),
  ];
  const weighingBlockCore = renderBulletSection('What the model is weighing', coreBullets);
  const weighingBlock = renderBulletSection('What the model is weighing', [
    ...coreBullets,
    ...additionalBullets,
  ]);

  // Brief-completeness advisory (own droppable block). Only the enum is read;
  // it is mapped to a calm advisory phrase and never emitted verbatim.
  const completenessBlock = buildBriefCompletenessLine(wideningLog);

  const nextStep =
    'Next, run the analysis to see how the options compare and what could shift the outcome.';

  const sectioned = assembleSectionedNarrative({
    confirm: confirmSentence,
    optionsBlock,
    weighingBlock,
    weighingBlockCore,
    completenessBlock,
    nextStep,
  });

  return {
    text: sectioned.text,
    telemetry: {
      assumption_source: assumption.source,
      coaching_summary_present: coachingSummaryPresent,
      coaching_summary_passed_gate: false,
      coaching_summary_reject_reason: summaryRejectReason,
      coaching_summary_style_rewritten: false,
      fallback_reason: assumption.fallbackReason,
      strengthen_items_count: strengthenItemsCount,
      bias_findings_count: biasFindingsCount,
      coaching_bias_signals_count: coachingBiasSignalsCount,
      widening_log_present: wideningLogPresent,
      brief_completeness: briefCompleteness,
      brief_completeness_surfaced: sectioned.includedCompleteness,
      additional_checks_surfaced: sectioned.includedWeighingExtra ? additionalBullets.length : 0,
      additional_check_source: additionalChecks[0]?.source ?? null,
    },
  };
}

// ----- F1 model-understanding receipt summary -------------------------------

/**
 * Input for {@link buildModelReceiptSummary}. A subset of
 * {@link BuildPostDraftNarrativeInput} — only the fields the gated assumption
 * tier reads. `coachingSummary` and `wideningLog` are intentionally absent:
 * the receipt summary is the single "assumption to check" line, not the
 * whole-narrative replacement.
 */
export interface ModelReceiptSummaryInput {
  readonly graph: GraphV3T | null;
  readonly analysisReady?: PostDraftAnalysisReadyLite | null;
  readonly strengthenItems?: ReadonlyArray<unknown> | null;
  readonly coachingBiasSignals?: ReadonlyArray<unknown> | null;
}

/**
 * Derive the short, pre-analysis "assumption to check" sentence for the F1
 * model-understanding receipt (`analysis_ready.coaching_summary`). Reuses the
 * SAME gated source-priority chain as the post-draft narrative's assumption
 * bullet ({@link pickAssumption}: strengthen → bias finding → coaching bias
 * signal → uncertainty driver), so the structured receipt insight and the
 * chat narrative stay consistent and copy-safe by construction — every
 * non-fallback candidate has passed {@link gateAssumptionFragment} (no IDs,
 * no graph-shape words, no recommendation / winner language).
 *
 * Returns `null` when only the deterministic generic fallback applies — the
 * receipt must not surface a weak, contentless insight. (The chat narrative
 * still shows the generic assumption bullet; the structured receipt field
 * stays empty and DGAI renders the card without a top-insight.)
 *
 * Pure. Never throws. Callers MUST still apply the egress scrub
 * (`sanitiseCoachingProse`) before the value ships on the wire — this helper
 * does not scrub, mirroring how the narrative `text` is scrubbed at the
 * dispatch site rather than inside the builder.
 */
export function buildModelReceiptSummary(input: ModelReceiptSummaryInput): string | null {
  const nodes = (input.graph?.nodes ?? []) as readonly NodeLite[];
  const pick = pickAssumption({
    nodes,
    analysisReady: input.analysisReady ?? null,
    strengthenItems: input.strengthenItems,
    coachingBiasSignals: input.coachingBiasSignals,
  });
  if (pick.source === 'deterministic_fallback') return null;
  return pick.text;
}

// ----- sentence builders ----------------------------------------------------

function buildConfirmSentence(goalLabel: string | null): string {
  if (!goalLabel) {
    return "I've built a first decision model from your brief.";
  }
  const safe = truncate(goalLabel, MAX_GOAL_CHARS);
  return `I've built a first decision model for "${safe}".`;
}

/**
 * Returns either `null` (no options) or a rendered "Options compared"
 * section. For 1 option we keep a single inline confirmation line (no
 * bullets); for 2+ options we render `Options compared\n• …` with one
 * bullet per option. For 5+ we list the first three and add a closing
 * `• Other variants are on the canvas.` bullet so the reader sees the
 * spread without enumerating every variant.
 */
function buildOptionsBlock(options: readonly string[]): string | null {
  if (options.length === 0) return null;
  const trimmed = options.map((label) => truncate(label, MAX_LABEL_CHARS));

  if (trimmed.length === 1) {
    return `The model so far includes one route: ${trimmed[0]}.`;
  }
  if (trimmed.length <= MAX_NAMED_OPTIONS) {
    return renderBulletSection('Options compared', trimmed);
  }
  // 5+ options — name the first three, signal that more exist on canvas.
  const named = trimmed.slice(0, MAX_LISTED_WHEN_OVER);
  return renderBulletSection('Options compared', [
    ...named,
    'Other variants are on the canvas.',
  ]);
}

/**
 * Return a single bullet-ready trade-off fragment (no leading bullet
 * glyph; no trailing full stop — the renderer adds those). Returns null
 * when no factor/risk material is available, so the caller can omit the
 * bullet without leaving an empty section.
 */
function buildTradeOffBullet(
  factors: readonly string[],
  risks: readonly string[],
): string | null {
  const trimmedFactors = factors.map((l) => truncate(l, MAX_LABEL_CHARS));
  if (trimmedFactors.length >= 2) {
    return `Main trade-off: ${trimmedFactors[0]} balanced against ${trimmedFactors[1]}`;
  }
  if (trimmedFactors.length === 1 && risks.length >= 1) {
    const risk = truncate(risks[0], MAX_LABEL_CHARS);
    return `Main trade-off: ${trimmedFactors[0]} against the risk of ${risk}`;
  }
  if (trimmedFactors.length === 1) {
    return `Key consideration: ${trimmedFactors[0]}`;
  }
  if (risks.length >= 1) {
    const risk = truncate(risks[0], MAX_LABEL_CHARS);
    return `Key consideration: the risk of ${risk}`;
  }
  return null;
}

/**
 * Convert the assumption text returned by {@link pickAssumption} into a
 * weighing-section bullet. The picker emits sentences like
 * `"One assumption worth checking: …."` (with trailing period). For a
 * bullet we strip the trailing period and lift the lead-in `One` →
 * `Assumption to check:` so the section reads as a label, not a
 * complete sentence.
 *
 * For the fixed-generic fallback `"One assumption worth checking is
 * whether…"`, the same lead-in stripping yields `Assumption to check:
 * whether…` — no period, parallel structure with the trade-off bullet.
 */
function toAssumptionBullet(assumptionSentence: string): string {
  const trimmed = assumptionSentence.trim().replace(/\.$/, '');
  // `One assumption worth checking: <fragment>` (priority-1..4 sources)
  const colonForm = trimmed.match(/^One assumption worth checking:\s*(.+)$/i);
  if (colonForm) return `Assumption to check: ${colonForm[1].trim()}`;
  // `One assumption worth checking is whether <fragment>` (fixed-generic)
  const isForm = trimmed.match(/^One assumption worth checking is\s+(.+)$/i);
  if (isForm) return `Assumption to check: ${isForm[1].trim()}`;
  // Defensive: keep the text as-is if neither form matches.
  return trimmed;
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
    const candidate = gatedFragmentText(cleanLeadIn(detail));
    if (candidate !== null) {
      return { text: candidate, source: 'strengthen_item_detail' };
    }
    const firstSentence = extractFirstSentence(detail);
    if (firstSentence) {
      const cleaned = gatedFragmentText(cleanLeadIn(firstSentence));
      if (cleaned !== null) {
        return { text: cleaned, source: 'strengthen_item_detail' };
      }
    }
  }

  // Fall back to label.
  if (typeof label === 'string') {
    const cleaned = gatedFragmentText(cleanLeadIn(label));
    if (cleaned !== null) {
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
    const candidate = gatedFragmentText(cleanLeadIn(explanation));
    if (candidate !== null) {
      return candidate;
    }
    const firstSentence = extractFirstSentence(explanation);
    if (firstSentence) {
      const cleaned = gatedFragmentText(cleanLeadIn(firstSentence));
      if (cleaned !== null) return cleaned;
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
    const candidate = gatedFragmentText(cleanLeadIn(detail));
    if (candidate !== null) {
      return candidate;
    }
    const firstSentence = extractFirstSentence(detail);
    if (firstSentence) {
      const cleaned = gatedFragmentText(cleanLeadIn(firstSentence));
      if (cleaned !== null) return cleaned;
    }
  }
  return null;
}

// ----- additional-check picker (second weighing point) ----------------------

interface AdditionalCheckPick {
  readonly text: string;
  readonly source: 'strengthen_item' | 'coaching_bias_signal';
}

/**
 * Collect up to `limit` extra coaching points beyond the single primary
 * assumption bullet, drawn from the next unused `strengthen_items` then
 * `coaching_bias_signals`. Each candidate passes the SAME
 * {@link gateAssumptionFragment} the primary picker uses, and is deduped by
 * normalised text against `alreadyUsed` (seeded with the assumption bullet's
 * text) so the same signal is never surfaced twice. Iterates from index 0 and
 * relies on text-dedup — not index skipping — because the primary assumption
 * may have come from a bias finding / uncertainty driver, leaving
 * `strengthen[0]` legitimately unused.
 */
function pickAdditionalChecks(input: {
  readonly strengthenItems: ReadonlyArray<unknown> | null | undefined;
  readonly coachingBiasSignals: ReadonlyArray<unknown> | null | undefined;
  readonly alreadyUsed: ReadonlySet<string>;
  readonly limit: number;
}): AdditionalCheckPick[] {
  const { strengthenItems, coachingBiasSignals, alreadyUsed, limit } = input;
  const out: AdditionalCheckPick[] = [];
  const used = new Set<string>(alreadyUsed);

  const tryAdd = (text: string | null, source: AdditionalCheckPick['source']): void => {
    if (out.length >= limit || text === null) return;
    const key = normaliseForDedup(text);
    if (key.length === 0 || used.has(key)) return;
    used.add(key);
    out.push({ text, source });
  };

  if (Array.isArray(strengthenItems)) {
    for (const item of strengthenItems) {
      if (out.length >= limit) break;
      tryAdd(extractStrengthenText(item), 'strengthen_item');
    }
  }
  if (Array.isArray(coachingBiasSignals)) {
    for (const signal of coachingBiasSignals) {
      if (out.length >= limit) break;
      tryAdd(extractBiasSignalText(signal), 'coaching_bias_signal');
    }
  }
  return out;
}

/**
 * Extract a gated, cleaned coaching fragment from a single strengthen item
 * (detail preferred, then the detail's first sentence, then label). Returns
 * null when nothing survives {@link gateAssumptionFragment}. Mirrors the
 * detail/label precedence in {@link pickStrengthenAssumption} but for one item.
 */
function extractStrengthenText(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const detail = (item as { detail?: unknown }).detail;
  const label = (item as { label?: unknown }).label;
  if (typeof detail === 'string') {
    const candidate = gatedFragmentText(cleanLeadIn(detail));
    if (candidate !== null) return candidate;
    const firstSentence = extractFirstSentence(detail);
    if (firstSentence) {
      const cleaned = gatedFragmentText(cleanLeadIn(firstSentence));
      if (cleaned !== null) return cleaned;
    }
  }
  if (typeof label === 'string') {
    const cleaned = gatedFragmentText(cleanLeadIn(label));
    if (cleaned !== null) return cleaned;
  }
  return null;
}

/**
 * Extract a gated, cleaned coaching fragment from a single bias signal
 * (`detail`, then its first sentence). Returns null when nothing survives
 * {@link gateAssumptionFragment}.
 */
function extractBiasSignalText(signal: unknown): string | null {
  if (typeof signal !== 'object' || signal === null) return null;
  const detail = (signal as { detail?: unknown }).detail;
  if (typeof detail !== 'string') return null;
  const candidate = gatedFragmentText(cleanLeadIn(detail));
  if (candidate !== null) return candidate;
  const firstSentence = extractFirstSentence(detail);
  if (firstSentence) {
    const cleaned = gatedFragmentText(cleanLeadIn(firstSentence));
    if (cleaned !== null) return cleaned;
  }
  return null;
}

/**
 * Render an extra weighing point as a bullet-ready fragment. The label is
 * deliberately distinct from `Assumption to check:` (so two such bullets do
 * not read identically) and is NOT a sentence-leading commit verb (which
 * would trip the egress success-claim guard).
 */
function toCheckBullet(text: string): string {
  return `Worth a look: ${text}`;
}

/**
 * Map the widening_log `brief_completeness` enum to a calm advisory line, or
 * null when the log is absent or the brief is `complete`. The enum value is
 * never emitted verbatim. `elements_added` (NODE IDs) and
 * `elements_considered_but_excluded` are intentionally NOT read here.
 */
function buildBriefCompletenessLine(
  wideningLog: DraftCoachingWideningLog | null | undefined,
): string | null {
  if (!wideningLog) return null;
  return COMPLETENESS_ADVISORY[wideningLog.brief_completeness];
}

/** Normalise a fragment for dedup: lowercase, collapse whitespace, trim. */
function normaliseForDedup(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Strip a known weighing-bullet label prefix so dedup compares the underlying
 * signal text rather than the label. Matches the labels emitted by
 * {@link toAssumptionBullet}, {@link buildTradeOffBullet} and
 * {@link toCheckBullet}.
 */
function stripBulletLabel(bullet: string): string {
  return bullet
    .replace(/^(?:Assumption to check|Main trade-off|Key consideration|Worth a look):\s*/i, '')
    .trim();
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
 * Render a section as `Label\n• item\n• item …`. Returns an empty
 * string when no bullets are supplied so the caller can drop the
 * section without leaving an orphan label.
 */
function renderBulletSection(label: string, bullets: readonly string[]): string {
  if (bullets.length === 0) return '';
  return `${label}\n${bullets.map((b) => `• ${b}`).join('\n')}`;
}

interface SectionedNarrativeInput {
  readonly confirm: string;
  readonly optionsBlock: string | null;
  /** Full weighing block including any extra "check" bullet. */
  readonly weighingBlock: string;
  /** Weighing block with only the trade-off + primary assumption bullets. */
  readonly weighingBlockCore: string;
  /** Brief-completeness advisory line, or null when absent / `complete`. */
  readonly completenessBlock: string | null;
  readonly nextStep: string;
}

interface SectionedNarrativeResult {
  readonly text: string;
  /** Whether the FULL weighing block (with the extra check bullet) survived. */
  readonly includedWeighingExtra: boolean;
  /** Whether the brief-completeness advisory block survived. */
  readonly includedCompleteness: boolean;
}

/**
 * Assemble the block slots into the final sectioned narrative, separating
 * blocks with `\n\n`, and report which optional blocks survived so the caller
 * can record honest copy-source telemetry. Enforce the 140-word ceiling by
 * shedding the lowest-value content first:
 *
 *   1. full (extra check bullet + completeness + options)
 *   2. drop the extra check bullet (weighing core)
 *   3. drop the completeness advisory
 *   4. drop the whole weighing block
 *   5. drop options too (confirm + next-step only)
 *
 * The confirm sentence and next-step nudge are load-bearing and never drop.
 * When there is no extra bullet and no completeness block, `weighingBlock ===
 * weighingBlockCore` and `completenessBlock === null`, so rungs 1-3 collapse
 * to the original two-outcome behaviour (output is byte-identical to before).
 */
function assembleSectionedNarrative(input: SectionedNarrativeInput): SectionedNarrativeResult {
  const tryAssemble = (
    weighing: string | null,
    includeOptions: boolean,
    includeCompleteness: boolean,
  ): string => {
    const blocks: string[] = [input.confirm];
    if (includeOptions && input.optionsBlock !== null) {
      blocks.push(input.optionsBlock);
    }
    if (weighing !== null && weighing.length > 0) {
      blocks.push(weighing);
    }
    if (includeCompleteness && input.completenessBlock !== null) {
      blocks.push(input.completenessBlock);
    }
    blocks.push(input.nextStep);
    return blocks.join('\n\n');
  };

  const hasCompleteness = input.completenessBlock !== null;
  const hasExtra = input.weighingBlock !== input.weighingBlockCore;

  // Rung 1 — everything.
  let text = tryAssemble(input.weighingBlock, true, true);
  if (countWords(text) <= MAX_WORDS) {
    return { text, includedWeighingExtra: hasExtra, includedCompleteness: hasCompleteness };
  }
  // Rung 2 — drop the extra check bullet.
  text = tryAssemble(input.weighingBlockCore, true, true);
  if (countWords(text) <= MAX_WORDS) {
    return { text, includedWeighingExtra: false, includedCompleteness: hasCompleteness };
  }
  // Rung 3 — drop the completeness advisory.
  text = tryAssemble(input.weighingBlockCore, true, false);
  if (countWords(text) <= MAX_WORDS) {
    return { text, includedWeighingExtra: false, includedCompleteness: false };
  }
  // Rung 4 — drop the whole weighing block.
  text = tryAssemble(null, true, false);
  if (countWords(text) <= MAX_WORDS) {
    return { text, includedWeighingExtra: false, includedCompleteness: false };
  }
  // Rung 5 — drop options too.
  return {
    text: tryAssemble(null, false, false),
    includedWeighingExtra: false,
    includedCompleteness: false,
  };
}
