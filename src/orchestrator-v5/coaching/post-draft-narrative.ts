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
 *      {@link ../coaching/copy-quality-gate.ts}, readiness remains the final
 *      authority over its next step. A ready, in-budget summary is used
 *      verbatim. Every non-ready or readiness-missing summary is discarded;
 *      the deterministic builder supplies the canonical typed recovery.
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
 *        Block 4 — Readiness-derived next step
 *          Run analysis only when the typed payload is ready; otherwise name
 *          one typed blocker/recovery without choosing a value for the user.
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

import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';

import { isDirectionClarificationId } from '../../cee/compound-goal/direction-gate.js';

import {
  gateAssumptionFragment,
  gateCoachingCardBody,
  gateFullResponse,
  type GateRejectReason,
} from './copy-quality-gate.js';
import { buildReadinessNextStep } from './readiness-recovery.js';
import { elideLabelAtWordBoundary } from '../../utils/label-elision.js';

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
 * The second sentence of the opener when the projector framed the decision
 * itself. See {@link buildConfirmSentence} for why its subject is the product
 * and never the user's brief.
 */
const PROVISIONAL_FRAMING_SENTENCE =
  "I've framed the decision provisionally, so tell me if it isn't the one you're weighing.";

/**
 * ⭐⭐ THE MODEL IS ONE OF SEVERAL THE SYSTEM COULD HAVE BUILT, AND UNTIL NOW
 * NOTHING SAID SO.
 *
 * ── THE MEASURED FACT ──────────────────────────────────────────────────────
 * The same brief produces materially different models. Five of five runs gave
 * DISTINCT option sets and the journeys inverted (retain 66% → 45% → blocked →
 * 75% → CLOSE 52%), on a request that was BYTE-IDENTICAL every time
 * (`temperature: 0`, same prompt hash). The analysis solver downstream is
 * bit-identical to 16 significant figures, so all of that variance is in the
 * DRAFT.
 *
 * ── ⛔ THERE IS NO FIX, WHICH IS PRECISELY WHY THERE IS COPY ────────────────
 * The Anthropic API exposes no seed parameter and temperature is already 0.
 * This is a property of the system, not a defect awaiting a lane. The product
 * already hedges honestly WITHIN a model; what was missing is that the model
 * ITSELF is one draw. Two colleagues comparing notes each saw honest hedging
 * and no hint that their models differ.
 *
 * ── WHY IT LIVES HERE AND NOT IN THE PROMPT ────────────────────────────────
 * Prompts are store-managed with a per-instance TTL, so a re-pin serves a
 * mixture of two prompts for ~5 minutes and no acceptance run inside that
 * window means anything. A deterministic sentence composed after the draft is
 * served identically by every instance from the moment it deploys. It also
 * touches no generation: this is what we SAY about the result.
 *
 * ── WHY IT IS NOT AT THE TOP ───────────────────────────────────────────────
 * Read together with the provisional opener, a variance note in block 1 would
 * open the reply with two hedges in a row. It is the CLOSING frame instead,
 * placed BEFORE the call to action so the reader still ends on the next step.
 * It states what the thing is; it does not apologise for it.
 */
export const MODEL_VARIANCE_NOTE =
  'This is one of several models I could build from your brief: a starting point to argue with, not an answer. Ask me again and you would get a different one.';

/**
 * Cap on EXTRA "check" bullets surfaced in the weighing section beyond the
 * single primary assumption bullet. One keeps the section at most one line
 * longer than today — enough to add a second high-value point without
 * overwhelming the reader.
 */
const MAX_ADDITIONAL_CHECKS = 1;

/**
 * How many direction clarifications may occupy their own slot.
 *
 * ⚠⚠ WHY A DEDICATED SLOT AND NOT A PRIORITY TWEAK. A direction clarification
 * is the only coaching item that represents a LIMIT THE USER STATED AND THE
 * PRODUCT DECLINED TO ENFORCE. Measured at 32f06dd with the live brief: the
 * gate built the card correctly, `package.ts` appended it correctly — and then
 * the served turn contained no trace of it, because the clarification is
 * appended LAST, `pickAssumption` reads `strengthenItems[0]` only, and the
 * single "worth a look" slot went to the second LLM item. Competing for a
 * general-purpose budget means position decides whether a board-level limit is
 * mentioned at all.
 *
 * Making it the ASSUMPTION bullet instead would have been the other wrong
 * answer: it is not an assumption, and taking that slot would silence real
 * coaching to surface the question (the opposite-direction defect — trap 22b).
 * Its own slot costs one line and settles both.
 */
const MAX_DIRECTION_BULLETS = 2;

/**
 * Calm advisory phrases mapped from the widening_log `brief_completeness`
 * enum. The enum value is NEVER emitted verbatim — it selects a phrase.
 * Hard-coded trusted copy (same pattern as {@link FIXED_GENERIC_ASSUMPTION}):
 * British English, no graph-shape words, no schema terms, no sentence-leading
 * commit verbs, no em / en dashes — so it passes both the assumption-fragment
 * gate and the egress success-claim / forbidden-phrase guards by construction.
 *
 * ⚠⚠ TWO OF THE THREE ARMS SURFACE NOTHING, AND THAT IS THE DESIGN, NOT AN
 * OVERSIGHT. `complete` never had a nudge to give. `partial` was WITHDRAWN on
 * 2026-08-13 — see below. Only `thin` still speaks, and only when
 * {@link buildBriefCompletenessLine} cannot refute it.
 *
 * ── ROADMAP 2.972(d): why `partial` is now silent ─────────────────────────
 *
 * It used to read:
 *
 *     "Your brief covered the main points; adding detail on the lighter areas
 *      would sharpen the comparison."
 *
 * WITNESSED on deployed staging 2026-08-13 (UI `5deee0cf` / CEE `219490e`,
 * `WITNESS-20260813-EVENING.md`, scenario `e17089bf`): the product emitted
 * that sentence verbatim for a 52-CHARACTER brief — "Should we move the whole
 * company to a four-day week?" — that it had itself, two messages earlier,
 * declared insufficient, asking three clarifying questions because it had no
 * goal, no options and no timeframe.
 *
 * THE GOVERNING RULE: the product may describe what IT did; it may not tell
 * the user what THEY said. A false COMPLIMENT breaches that rule exactly as a
 * false criticism does, and it is WORSE in company: a user who reads a
 * compliment about their brief directly above our own question about the same
 * brief concludes we are not paying attention.
 *
 * THE DISAGREEMENT IS DERIVED, NOT ARGUED. `assessBriefCompleteness`
 * (clarify-v2/rubric.ts) is a pure function over the brief text and returns
 * `complete: false, missing: [goal, options, timeframe]` for that exact
 * string — pinned in `provenance/__tests__/brief-completeness-claim.test.ts`.
 * `widening_log.brief_completeness` is an LLM-AUTHORED enum that nothing
 * derives and nothing can refute, and it returned `partial`. Two authorities,
 * one question, opposite answers, same screen.
 *
 * ⚠ AND THE TREE ALREADY KNEW. `context/intake-option-reconciliation.ts`
 * classifies this very enum as THE WRONG ORACLE, in its own words: `partial`
 * "was measured TRUE in the failing run" and "fires on most briefs". A value
 * that fires on most briefs cannot discriminate, and copy selected by it
 * cannot be a finding about any particular brief.
 *
 * WHY WITHDRAWN AND NOT GATED. A gate could only make the sentence less OFTEN
 * false; it could not make it TRUE. The rubric tests four named dimensions
 * and "covered the main points" is unbounded, so even a clean rubric pass
 * would not establish it (traps 13e / 22 — a narrow probe cannot support a
 * broad claim). The sentence is prohibited by its SUBJECT, not by its
 * accuracy, and a gate leaves the same lie shipping less often.
 *
 * WHY WITHDRAWN AND NOT REPHRASED. The estate has settled this choice twice,
 * in opposite directions, on a principle that decides it here. `preflight.ts`
 * REPHRASED its draft-first disclosure onto ourselves because "disclosure is
 * its whole job" — it must say something. This advisory must not: it is the
 * block {@link assembleSectionedNarrative} sheds at RUNG 3, ahead of
 * everything but the options list, so the builder's own priority ladder
 * already ranks it the least load-bearing content in the message. ROADMAP
 * 2.972(c) is the matching precedent — silence where the claim cannot be
 * established.
 *
 * NOTHING OF VALUE IS LOST, because the honest version already ships. The
 * DERIVED surface — `composeDraftFirstDisclosure` — names the exact dimension
 * we guessed ("I've assumed the goal in this draft, and I haven't confirmed it
 * with you"). This advisory was a second, underived authority answering the
 * same question. Removing it deletes a contradiction, not a capability.
 *
 * ⚠ FOR ANYONE RESTORING A PHRASE HERE: telemetry still reports the enum
 * (`brief_completeness`), so ops keeps the signal. What may not return is a
 * SENTENCE WHOSE SUBJECT IS THE USER'S BRIEF. If a nudge is wanted, its
 * subject must be this service or the model we built.
 */
const COMPLETENESS_ADVISORY: Record<DraftCoachingWideningLog['brief_completeness'], string | null> = {
  complete: null,
  partial: null,
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
  /**
   * TRUE when the producer authored this node's display label rather than
   * carrying the user's own words. On a `decision` node this is the only
   * signal available here that the projector managed to derive a decision
   * STATEMENT from the brief at all — see {@link hasProvisionalDecision}.
   *
   * ⚠ NODE LEVEL, NOT `provenance.label_authored`. The projector writes the
   * flag into a structured provenance OBJECT, but `NodeV3.provenance` is a
   * bare string enum (`schemas/cee-v3.ts:255`) and `NodeV3` strips undeclared
   * keys; `projectNodeProvenance` (`transforms/schema-v3.ts:1183`) lifts the
   * flag to node level, where `cee-v3.ts:284` declares it and it survives to
   * this builder. Reading it off `provenance` here would read a property off a
   * string and yield `undefined` on every draft.
   */
  readonly label_authored?: boolean;
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
 * call site. The narrative reads status as the sole Run authority, then at
 * most one typed blocker (or one non-ready option fallback) for its CTA.
 */
export interface PostDraftAnalysisReadyLite {
  /** Sole authority for whether a Run instruction may be served. */
  readonly status?: string | undefined;
  /** Ordered typed recovery candidates; the narrative names at most one. */
  readonly blockers?: ReadonlyArray<unknown> | undefined;
  /** Used only for a named fallback when a non-ready payload has no blocker. */
  readonly options?: ReadonlyArray<unknown> | undefined;
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

/** Copy-gate failures plus a typed-readiness contradiction after acceptance. */
export type CoachingSummaryRejectReason = GateRejectReason | 'readiness_conflict';

export interface PostDraftNarrativeTelemetry {
  readonly assumption_source: AssumptionSource;
  readonly coaching_summary_present: boolean;
  /** True only when the accepted whole response shipped verbatim. */
  readonly coaching_summary_passed_gate: boolean;
  /**
   * The first copy-gate failure, or `readiness_conflict` when typed readiness
   * prevents an otherwise acceptable summary from shipping. `null` when
   * missing or when the whole response shipped unchanged.
   */
  readonly coaching_summary_reject_reason: CoachingSummaryRejectReason | null;
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
  /**
   * How many direction clarifications reached the served narrative.
   *
   * Ops needs this separately from `additional_checks_surfaced` for one
   * reason: a clarification that is BUILT and then not SURFACED is invisible in
   * every other signal — the gate logs it as withheld-and-asked, the package
   * stage logs it as appended, and the served text simply does not mention it.
   * That is exactly how the defect this slot fixes survived a full adversarial
   * review. A zero here beside a non-zero withheld count is the alarm.
   */
  readonly direction_clarifications_surfaced: number;
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
  /**
   * The text the user submitted (ROADMAP 2.972). READ-ONLY, and read for exactly one
   * purpose: to refuse the `thin` brief-completeness advisory when the brief
   * itself refutes it. No content is ever lifted out of it into copy.
   */
  readonly briefText?: string | null;
}

/**
 * Build the deterministic post-draft assistant_text and its source
 * telemetry. Pure function. Never throws. Always returns a non-empty
 * `text`.
 */
export function buildPostDraftNarrative(input: BuildPostDraftNarrativeInput): PostDraftNarrativeResult {
  const { graph, analysisReady, strengthenItems, coachingSummary, coachingBiasSignals, wideningLog, briefText } = input;

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
  const nodes = (graph?.nodes ?? []) as readonly NodeLite[];

  // The projector mints a decision node from whatever options exist, so its
  // presence says nothing about the brief. An UNAUTHORED label is the signal
  // that no decision could be derived from what the user actually wrote.
  //
  // ⭐ DERIVED HERE, ABOVE THE NUDGE, ON PURPOSE. The next-step sentence is
  // assembled LAST but chosen FIRST, and it must be chosen by the SAME signal
  // as the options heading four lines above it — otherwise the heading says
  // "Options on the canvas" while the sentence beneath it promises to "see how
  // the options compare", which is the claim the heading was changed away from.
  // Two authorities answering one question under similar names is this estate's
  // chronic defect (`CLAUDE.md` trap 21); there is one authority here.
  const provisionalDecision = hasProvisionalDecision(nodes);
  const nextStep = buildReadinessNextStep(analysisReady, nodes, { provisionalDecision });

  // Run the full-response gate once so we can capture both the
  // pass/fail and (on fail) the categorical reject reason for ops
  // telemetry — without re-running the gate.
  const summaryGateResult = coachingSummaryPresent
    ? gateFullResponse(summaryCandidate)
    : null;
  let summaryRejectReason: CoachingSummaryRejectReason | null =
    summaryGateResult && !summaryGateResult.accept
      ? (summaryGateResult.rejectReason ?? null)
      : null;

  // The copy gate is necessary but not sufficient: typed readiness is the sole
  // authority for the whole-summary shortcut. Only an exact `ready` status may
  // ship the gate's sanitised summary. Every non-ready or missing status drops
  // all model-authored summary bytes and falls through to the deterministic
  // builder, whose final action is derived only from typed readiness.
  if (summaryGateResult && summaryGateResult.accept) {
    const acceptedSummary = summaryGateResult.text ?? summaryCandidate;
    const isReady = analysisReady?.status === 'ready';

    if (isReady && countWords(acceptedSummary) <= MAX_WORDS) {
      return {
        // ⭐ THE VARIANCE NOTE RIDES BOTH PATHS, AND THIS IS THE ONE THAT
        // MATTERS MOST. This shortcut ships the model's own summary verbatim
        // and is the MAJORITY path — the deterministic opener carried only 146
        // of 688 replies in the 18 Aug live capture. A note added solely to the
        // sectioned builder below would be DARK for most users while every
        // register said the truthfulness gap was closed, which is this
        // estate's single most repeated failure ("we build more than we plug
        // in"). Appended, never interleaved: the summary's own bytes are
        // untouched and the deterministic opener is still not prepended.
        //
        // The narrative word budget is deliberately NOT re-checked against the
        // note here. Tightening the acceptance test would change WHICH PATH
        // serves a 110-140 word summary, and a copy change may not silently
        // re-route composition.
        text: nodes.length > 0
          ? `${acceptedSummary}\n\n${MODEL_VARIANCE_NOTE}`
          : acceptedSummary,
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
          // Verbatim-summary paths render no deterministic evidence blocks.
          widening_log_present: wideningLogPresent,
          brief_completeness: briefCompleteness,
          brief_completeness_surfaced: false,
          additional_checks_surfaced: 0,
          additional_check_source: null,
          direction_clarifications_surfaced: 0,
        },
      };
    }

    summaryRejectReason = isReady ? 'too_long' : 'readiness_conflict';
  }

  if (nodes.length === 0) {
    return {
      text: analysisReady?.status === 'ready'
        ? 'Your decision model is ready to explore.'
        : nextStep,
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
        direction_clarifications_surfaced: 0,
      },
    };
  }

  const goalLabel = findGoalLabel(nodes);
  const options = collectLabels(nodes, 'option');
  const factors = collectLabels(nodes, 'factor');
  const risks = collectLabels(nodes, 'risk');

  const confirmSentence = buildConfirmSentence(
    goalLabel,
    provisionalDecision,
    hasAuthoredGoalLabel(nodes),
  );

  const optionsBlock = buildOptionsBlock(options, provisionalDecision);

  const tradeOffBullet = buildTradeOffBullet(factors, risks);
  const mayServeFreeformCoaching = analysisReady?.status === 'ready';

  // A direction clarification gets its OWN slot and is therefore removed from
  // the general-purpose pickers below. Leaving it in both would surface the
  // same question twice, and leaving it ONLY in the generic pool is the defect
  // being fixed — see `pickDirectionClarifications`. Non-ready turns cannot
  // trust it, however: at this boundary a producer-built clarification and an
  // LLM item are distinguished only by a spoofable ID prefix, and package
  // deduplication can let the latter occupy that ID. Until provenance is
  // carried structurally, direction copy follows the same ready-only policy.
  const directionBullets = mayServeFreeformCoaching
    ? pickDirectionClarifications(strengthenItems, MAX_DIRECTION_BULLETS).map(
        (text) => toDirectionBullet(text),
      )
    : [];
  const generalStrengthenItems = mayServeFreeformCoaching && Array.isArray(strengthenItems)
    ? strengthenItems.filter((i) => !isDirectionClarificationItem(i))
    : [];

  // Freeform coaching fragments can contain action copy that the fragment gate
  // is not designed to classify. For every non-ready or missing status, do not
  // inspect those bytes at all: graph labels/trade-off, the fixed generic
  // assumption and typed readiness recovery are the complete narrative.
  const assumption: AssumptionPick = mayServeFreeformCoaching
    ? pickAssumption({
        nodes,
        analysisReady,
        strengthenItems: generalStrengthenItems,
        coachingBiasSignals,
      })
    : {
        text: FIXED_GENERIC_ASSUMPTION,
        source: 'deterministic_fallback',
        fallbackReason: 'no_candidate',
      };
  const assumptionBullet = assumption.text ? toAssumptionBullet(assumption.text) : null;

  // One extra "check" bullet from the next unused coaching signal. Seed the
  // dedup set with the text the assumption bullet already used (label stripped)
  // so the same signal is never surfaced twice.
  const usedTexts = new Set<string>();
  if (assumptionBullet) usedTexts.add(normaliseForDedup(stripBulletLabel(assumptionBullet)));
  const additionalChecks = mayServeFreeformCoaching
    ? pickAdditionalChecks({
        strengthenItems: generalStrengthenItems,
        coachingBiasSignals,
        alreadyUsed: usedTexts,
        limit: MAX_ADDITIONAL_CHECKS,
      })
    : [];
  const additionalBullets = additionalChecks.map((c) => toCheckBullet(c.text));

  // ⭐ DIRECTION BULLETS LEAD THE SECTION AND SIT IN THE CORE. A limit the user
  // stated and the product declined to enforce outranks a coaching suggestion,
  // and the core block is the one the word-budget ladder sheds LAST.
  const coreBullets = [
    ...directionBullets,
    ...(tradeOffBullet ? [tradeOffBullet] : []),
    ...(assumptionBullet ? [assumptionBullet] : []),
  ];
  const weighingBlockCore = renderBulletSection('What the model is weighing', coreBullets);
  const weighingBlock = renderBulletSection('What the model is weighing', [
    ...coreBullets,
    ...additionalBullets,
  ]);
  const weighingBlockDirectionOnly =
    directionBullets.length > 0
      ? renderBulletSection('What the model is weighing', directionBullets)
      : null;

  // Brief-completeness advisory (own droppable block). Only the enum is read;
  // it is mapped to a calm advisory phrase and never emitted verbatim.
  const completenessBlock = buildBriefCompletenessLine(wideningLog, briefText);

  const sectioned = assembleSectionedNarrative({
    confirm: confirmSentence,
    optionsBlock,
    weighingBlock,
    weighingBlockCore,
    weighingBlockDirectionOnly,
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
      // Reported from what the ASSEMBLER kept, never from what was built: the
      // word-budget ladder can shed the whole weighing block, and a count of
      // bullets that were composed but not served is the optimism this
      // telemetry exists to catch.
      direction_clarifications_surfaced: sectioned.includedWeighing ? directionBullets.length : 0,
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
 * model-understanding receipt (`analysis_ready.coaching_summary`). Exact typed
 * readiness is the admission authority: non-ready, missing and unknown states
 * return `null` before any freeform source is read. Ready states reuse the same
 * gated source-priority chain as the post-draft narrative's assumption bullet
 * ({@link pickAssumption}: strengthen → bias finding → coaching bias signal →
 * uncertainty driver).
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
  if (input.analysisReady?.status !== 'ready') return null;

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

// ----- readiness-controlled next step --------------------------------------

// ----- sentence builders ----------------------------------------------------

/**
 * ⭐⭐ QUOTE THE GOAL WHOLE, OR DO NOT QUOTE IT (UX gate 4, 20 Aug 2026).
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 *   I've built a first decision model for "Several of our largest enterprise
 *   customers are asking for a self-hosted…".
 *
 * The product's first sentence to a customer quoted their own goal, cut
 * mid-phrase. Reproduced byte-for-byte at pristine through this very function
 * by `__tests__/goal-quotation-whole-or-none.test.ts`.
 *
 * ── ⛔ WHAT THIS IS NOT, AND THE ROAD THAT STAYS CLOSED ─────────────────────
 * It is NOT an elider defect, and this change does not touch the elider.
 * `utils/label-elision.ts` cuts at a word boundary and admits the cut, which
 * is all it claims. The obvious extension — reject a head whose second-to-last
 * token is a determiner — was RUN BEFORE BEING COMMISSIONED and REFUSED: it
 * fixes this string and breaks `"Defend and hold the line…"` in the same move
 * (`label-elision.ts:215-232`, pinned executably by the KNOWN-LIMIT case in
 * `label-elision.test.ts`, which must stay GREEN). Two harms cannot share one
 * window, and that predicate has had its round.
 *
 * ── WHAT THE DEFECT ACTUALLY IS ────────────────────────────────────────────
 * `cee/draft/records/objective-label.ts` (`deriveGoalObjectiveLabel`) REFUSES
 * to author an objective when the user stated a DECISION where a goal was
 * expected ("evaluating whether to invest £800k … or to hire 15 additional
 * staff"), because promoting one branch of a choice to "the team's goal" would
 * be a fabrication. Refusal is the feature — and on refusal THE VERBATIM QUOTE
 * STAYS AS THE LABEL.
 *
 * ⭐ THAT HALF IS STRUCTURAL, not a corpus observation: ALL NINE goal refusal
 * reasons return `{ label: source }` (`objective-label.ts:681-723`). So
 * "refused ⇒ verbatim ⇒ long whenever the quote is long" holds by
 * construction, for every refusal reason, not just the ones anyone has seen.
 *
 * So an over-budget label is typically one the product's own authority has
 * DECLINED to call an objective — and this sentence was announcing a mangled
 * half of it as the objective the model was built for.
 *
 * ── ⚠⚠ WHAT THIS FUNCTION MUST NOT BE BELIEVED TO GUARANTEE ────────────────
 * An earlier version of this comment claimed "a goal authored AS A GOAL is
 * short and never needs eliding", from a corpus measurement. THREE PARTS OF
 * THAT WERE FALSE, and they are corrected here because a doc-comment is what
 * every later session inherits.
 *
 * (a) ⛔ `deriveGoalObjectiveLabel` IS NOT THE ONLY AUTHORITY THAT MINTS THIS
 *     LABEL. At least three do, and two never pass through it:
 *       · `structure/goal-inference.ts:69` `inferGoalFromBrief`, reached via
 *         `ensureGoalNode` from `unified-pipeline/stages/repair/
 *         connectivity.ts:58` — a REGEX extraction capped at 200 CHARS
 *         (`goal-inference.ts:85`) and merely capitalised. Measured: the brief
 *         "My goal is to reduce total landed cost per unit across our
 *         international manufacturing subsidiaries and distribution
 *         partnerships before the next fiscal year." mints a 143-CHARACTER
 *         label, `found: true, source: "brief"` — a user writing a goal AS A
 *         GOAL, suppressed by the rule below. The exact inverse of the
 *         withdrawn claim.
 *       · the `explicitGoal` limb (`goal-inference.ts:289-291`) passes
 *         `context.goals` through `createGoalNode` with a bare `.trim()`.
 *       · `structure/compound-goal-label.ts` composes a label with no cap.
 *     A sweep for callers of `deriveGoalObjectiveLabel` answers a question
 *     about THAT FUNCTION, never "what mints the goal label" (platform trap
 *     20 — a probe proves what it was pointed at).
 *
 * (b) ⛔ "AUTHORED ⇒ INSIDE THE BUDGET" IS NOT STRUCTURAL. The authoring bound
 *     is `GOAL_WORD_BOUND = 9` — a WORD bound, not a character bound. Measured:
 *     "Standardise Procurement Across International Manufacturing Subsidiaries
 *     and Distribution Partnerships" is AUTHORED at 101 chars. The governed
 *     corpus's authored maximum of 62 is an 18-char MARGIN, not a guarantee.
 *
 * (c) The corpus exhibits ONE of the nine refusal reasons
 *     (`deliberation_frame`). It bounds nothing about the other eight.
 *
 * CONSEQUENCE, stated plainly: this rule suppresses the quotation for
 * over-budget labels REGARDLESS of how they were minted. For a refusal that is
 * clearly right. For an authored-but-long objective, or a 143-char inferred
 * one, it suppresses a label the product itself considers a good objective —
 * a weaker trade, rowed with a trigger (revisit if a witness or the live wire
 * shows authored-long labels arriving).
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * Quotation marks promise the user "these are your words". A fragment cannot
 * keep that promise, so where no whole quotation exists the opener falls back
 * to the sentence this function ALREADY ships when there is no goal at all.
 *
 * ⚠ THIS DELIBERATELY SAYS LESS IN ONE SENTENCE, AND THE TRADE IS ARGUED
 * RATHER THAN SLID INTO. Quoting the user's own words does real work — it
 * shows the model was built from what they actually said. What is given up is
 * a quotation that was never a whole one: the user was being shown a mangled
 * fragment, not their own words. The fallback still credits `your brief`.
 *
 * ⚠ AND THE COMPENSATION IS CORPUS-SPECIFIC, NOT A PROPERTY OF THIS FIX.
 * "The user's own words still reach them one line below in `Options compared`"
 * was VERIFIED for both governed cases — but it holds there ONLY because both
 * over-budget labels are DELIBERATION FRAMES whose branches ARE the options
 * ("… invest £800k in robotic picking … OR hire 15 QC staff"), so the goal's
 * words genuinely reappear as option labels. For an authored-but-long
 * objective, or a 143-char `inferGoalFromBrief` label, THE GOAL'S WORDS APPEAR
 * NOWHERE ELSE ON THAT SCREEN. Do not restate this as a general guarantee.
 *
 * RATE, stated as a number rather than an adjective (governed corpus): the
 * no-quotation opener goes from 3 of 14 drafts to 5 of 14 — 21% → 36%. On the
 * live wire at least 3 of 50 distinct goals were already being cut. The
 * `inferGoalFromBrief` limb is UNMEASURED and could be materially higher.
 *
 * ⚠ THE BUDGET DECISION IS DELEGATED, NEVER MIRRORED. "Is there a whole
 * quotation?" is answered by asking {@link elideLabelAtWordBoundary} itself
 * and seeing whether it had to cut — its contract is to return the trimmed
 * label UNCHANGED when it already fits. A second `length > MAX_GOAL_CHARS`
 * test here would be the hand-maintained mirror trap 12 exists to remove, and
 * would drift the day the elider's budget arithmetic changes.
 *
 * ⚠ SCOPE — WHICH OPENER THIS GOVERNS. `buildPostDraftNarrative`'s
 * whole-summary shortcut (`:459-466`) means this function is NEVER CALLED when
 * the model's own summary passes the gate and readiness is `ready`. In the
 * 18 Aug live capture the deterministic opener carried 146 of 688 replies
 * (21%). This fix governs the path on which the defect was witnessed; the
 * other path is UNMEASURED for this defect.
 *
 * ⚠ THE EMPTY-STRING GUARD BELOW IS UNREACHABLE, NOT DEAD — do not delete it.
 * A mutant removing it SURVIVES the suite, and that survivor is UNREACHABLE
 * rather than EQUIVALENT (demonstrated, not assumed): this function has one
 * caller, and `findGoalLabel` already filters `label.trim().length > 0`. It is
 * defensive against a second caller arriving, which is exactly when a
 * `for ""` opener would ship.
 */
function buildConfirmSentence(
  goalLabel: string | null,
  provisionalDecision = false,
  goalLabelAuthored = false,
): string {
  // ── THE OPEN-BRIEF OPENER ──────────────────────────────────────────────────
  // Every clause below is a claim about something this builder can see:
  //   "I've built a first model"          — nodes.length > 0 is checked above.
  //   "for <goal>"                        — a goal node's own label.
  //   "I've framed the decision
  //    provisionally"                     — the decision node exists and its
  //                                         statement is OURS: the projector
  //                                         minted it deterministically because
  //                                         `deriveDecisionLabel` declined to
  //                                         author one from the brief.
  //   "tell me if it isn't the one
  //    you're weighing"                   — an invitation, not a promise about
  //                                         a mechanism this builder cannot see.
  //
  // ⚠⚠ THE SUBJECT OF THIS SENTENCE IS THE PRODUCT, NEVER THE BRIEF, AND THAT
  // IS THE WHOLE FIX. The sentence that stood here read:
  //
  //   "I couldn't pin down a single decision in your brief, so I've framed one
  //    provisionally."
  //
  // Measured on the deployed build over 16 signed-in runs / 84 turns, it fired
  // on 7 OF 9 DRAFTS — including briefs that literally open "Should we A, or B,
  // or C?" — and the product then built a perfectly good model of exactly that
  // decision. It is the FIRST thing anyone reads, and it is refuted by the
  // screen underneath it.
  //
  // The old comment here defended it as "about our extraction, not about their
  // brief", and as prose that is arguable. It is beside the point: a sentence
  // whose SUBJECT is the user's brief reads as a verdict on the user's brief
  // whatever its modality, and the reader is the only person qualified to
  // judge that verdict. So the subject changed. The verb was not softened.
  //
  // ⚠ WHY THIS CANNOT BE FALSE IN EITHER DIRECTION. Reaching this branch means
  // `hasProvisionalDecision` held: the decision node carries the projector's
  // placeholder and no authored flag, so its statement was composed HERE and
  // not lifted from the brief. That is true whether or not the brief posed a
  // decision — which is exactly why the claim is safe to make and the old one
  // was not.
  //
  // ⛔ THE ROAD THAT STAYS CLOSED. Widening `deriveDecisionLabel` so it stops
  // declining on "Should we A or B?" is the OPPOSITE-DIRECTION HARM of the
  // change that stopped the product falsely CLAIMING a decision on briefs
  // posing none (18/18 → 1/18 on an independent corpus). Two harms cannot
  // share one window; the extraction breadth is rowed separately
  // (ROADMAP 2.1341) with two arbitrary length constants and hard cliffs, and
  // "one more rule" on it has already been shown to oscillate. Nothing in this
  // function touches the classifier.
  //
  // ⚠ IT DOES NOT PROMISE A DECISION-FREE MODEL. The product cannot express
  // one, so copy implying the decision could be dropped would be a second lie.
  // The sentence says a decision WAS framed, and marks it provisional.
  const trimmedGoal = goalLabel?.trim() ?? '';
  // ⛔ AUTHORSHIP GATES THE QUOTATION, AND IT IS CHECKED FIRST.
  //
  // Every branch below that renders `for "<goal>"` makes the promise this
  // function's header states: quotation marks tell the user THESE ARE YOUR
  // WORDS. When the drafter emits no goal, `ensureGoalNode` mints one — from a
  // regex over the brief, or from the placeholder "Achieve the best outcome for
  // this decision" — and before this conjunct the product quoted that straight
  // back at the user. Measured verbatim at pristine:
  //
  //   I've built a first decision model for "Achieve the best outcome for this
  //   decision".
  //
  // 42 characters, comfortably inside the 80-char budget, so the elision guard
  // above could never catch it: THAT guard asks "is this quotation WHOLE?",
  // which is a question about length, and this one asks "is it OURS TO QUOTE?",
  // which is a question about authorship. A short invented label passes the
  // first and must fail the second. Two harms, two conjuncts (trap 22b).
  //
  // The fallback is the sentence this builder ALREADY ships for the no-whole-
  // quotation case — ratified copy, no new claim. It still credits `your
  // brief`, which stays true: the MODEL was built from the brief even when the
  // GOAL was not taken from it.
  //
  // ⚠ FAIL-SAFE DIRECTION. Withholding a quotation costs a little warmth;
  // inventing one costs the user's trust in every other attribution on screen.
  const hasWholeQuotation =
    trimmedGoal.length > 0 &&
    !goalLabelAuthored &&
    elideLabelAtWordBoundary(trimmedGoal, MAX_GOAL_CHARS) === trimmedGoal;

  if (provisionalDecision) {
    return hasWholeQuotation
      ? `I've built a first model for "${trimmedGoal}". ${PROVISIONAL_FRAMING_SENTENCE}`
      : `I've built a first model from your brief. ${PROVISIONAL_FRAMING_SENTENCE}`;
  }

  if (!goalLabel) {
    return "I've built a first decision model from your brief.";
  }
  if (trimmedGoal.length === 0) {
    return "I've built a first decision model from your brief.";
  }
  // Ask the canonical elider whether a whole quotation exists. It returns the
  // trimmed label unchanged iff nothing had to be removed.
  if (!hasWholeQuotation) {
    return "I've built a first decision model from your brief.";
  }
  return `I've built a first decision model for "${trimmedGoal}".`;
}

/**
 * Returns either `null` (no options) or a rendered "Options compared"
 * section. For 1 option we keep a single inline confirmation line (no
 * bullets); for 2+ options we render `Options compared\n• …` with one
 * bullet per option. For 5+ we list the first three and add a closing
 * `• Other variants are on the canvas.` bullet so the reader sees the
 * spread without enumerating every variant.
 */
function buildOptionsBlock(
  options: readonly string[],
  provisionalDecision = false,
): string | null {
  if (options.length === 0) return null;
  const trimmed = options.map((label) => elideLabelAtWordBoundary(label, MAX_LABEL_CHARS));

  // ⚠ THE OPTIONS ARE NEVER WITHHELD, ONLY RE-TITLED. They are rendered on the
  // user's canvas either way; a narrative that omitted them while the canvas
  // showed them would be a second false claim, not a fix for the first.
  //
  // "Options compared" asserts two things that are untrue of an open brief:
  // that these are alternatives the user chose between, and that a comparison
  // has happened. On the provisional path the heading asserts only where they
  // are — which is verifiable by looking at the screen.
  const heading = provisionalDecision ? 'Options on the canvas' : 'Options compared';

  if (trimmed.length === 1) {
    // ⚠ KNOWN HOLE, RECORDED SO THE NEXT READER DOES NOT HAVE TO REDISCOVER IT.
    // This branch ignores `provisionalDecision` entirely. It happens to be
    // benign today — "one route" names where the thing is and asserts no
    // comparison and no chosen alternative, which is exactly the standard the
    // heading below was changed to meet — so there is nothing to fix, and a
    // speculative reword would be an unmeasured copy change. But the omission
    // is silent: if this line is ever rewritten to speak about a decision or a
    // comparison, the provisional gate will NOT be guarding it.
    return `The model so far includes one route: ${trimmed[0]}.`;
  }
  if (trimmed.length <= MAX_NAMED_OPTIONS) {
    return renderBulletSection(heading, trimmed);
  }
  // 5+ options — name the first three, signal that more exist on canvas.
  const named = trimmed.slice(0, MAX_LISTED_WHEN_OVER);
  return renderBulletSection(heading, [
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
  const trimmedFactors = factors.map((l) => elideLabelAtWordBoundary(l, MAX_LABEL_CHARS));
  if (trimmedFactors.length >= 2) {
    return `Main trade-off: ${trimmedFactors[0]} balanced against ${trimmedFactors[1]}`;
  }
  if (trimmedFactors.length === 1 && risks.length >= 1) {
    const risk = elideLabelAtWordBoundary(risks[0], MAX_LABEL_CHARS);
    return `Main trade-off: ${trimmedFactors[0]} against the risk of ${risk}`;
  }
  if (trimmedFactors.length === 1) {
    return `Key consideration: ${trimmedFactors[0]}`;
  }
  if (risks.length >= 1) {
    const risk = elideLabelAtWordBoundary(risks[0], MAX_LABEL_CHARS);
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

// ----- direction-clarification picker (its own weighing slot) ---------------

/**
 * Collect the direction clarifications from `strengthen_items`, rendered from
 * their OWN copy rather than through the assumption-fragment pipeline.
 *
 * ⚠⚠ THE GATE CHOICE IS THE FIX, NOT A DETAIL. {@link gateAssumptionFragment}
 * is shaped for the tail of "One assumption worth checking: …": it caps at 150
 * chars and rejects trailing punctuation, so it rejects EVERY clarification the
 * gate emits — and the caller's fallback then takes the detail's FIRST
 * SENTENCE, which is exactly where the question is not. Measured: the user read
 * "Assumption to check: You mentioned 85% for CSAT" and was never asked which
 * direction the limit ran.
 *
 * {@link gateCoachingCardBody} is the right instrument and already exists for
 * precisely this situation (its own header sets out the argument, for
 * `bias_signals[].detail`): it keeps every SHARED CONTENT rule — internal-id
 * leaks, schema terms, graph-shape language, premature recommendation — and
 * drops only the fragment-splicing presentation rules that do not apply to a
 * complete sentence standing on its own.
 *
 * FAILS CLOSED. `metric_text` comes from the USER'S OWN WORDS, so this copy is
 * not trusted the way the fixed fallbacks are: a card that trips the content
 * gate is DROPPED, never rewritten and never partially rendered.
 *
 * Items are identified by ID PREFIX, imported from the producer — never by a
 * text predicate another item could satisfy (trap 19), and never by a second
 * copy of the string (trap 12).
 */
function pickDirectionClarifications(
  items: ReadonlyArray<unknown> | null | undefined,
  limit: number,
): string[] {
  if (!Array.isArray(items) || items.length === 0) return [];
  const out: string[] = [];
  for (const item of items) {
    if (out.length >= limit) break;
    if (typeof item !== 'object' || item === null) continue;
    if (!isDirectionClarificationId((item as { id?: unknown }).id)) continue;
    const detail = (item as { detail?: unknown }).detail;
    if (typeof detail !== 'string' || detail.trim().length === 0) continue;
    const gated = gateCoachingCardBody(detail);
    if (!gated.accept) continue;
    out.push(gated.text ?? detail.trim());
  }
  return out;
}

/** Is this item a direction clarification? Used to keep it out of the generic pickers. */
function isDirectionClarificationItem(item: unknown): boolean {
  return (
    typeof item === 'object' &&
    item !== null &&
    isDirectionClarificationId((item as { id?: unknown }).id)
  );
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
 * Render a direction clarification as a bullet.
 *
 * The label names what the user must DO, and is deliberately distinct from
 * `Assumption to check:` — this is not an assumption the model made, it is a
 * limit the user stated that is not being enforced until they say which way it
 * runs. The body is rendered WHOLE: it already carries the question, and
 * clipping it is the defect this slot exists to end.
 */
function toDirectionBullet(text: string): string {
  return `Limit to confirm: ${text}`;
}

/**
 * Map the widening_log `brief_completeness` enum to a calm advisory line, or
 * null when the log is absent or the brief is `complete`. The enum value is
 * never emitted verbatim. `elements_added` (NODE IDs) and
 * `elements_considered_but_excluded` are intentionally NOT read here.
 */
function buildBriefCompletenessLine(
  wideningLog: DraftCoachingWideningLog | null | undefined,
  briefText?: string | null,
): string | null {
  if (!wideningLog) return null;
  // ROADMAP 2.972 — DO NOT TELL A USER THEIR BRIEF WAS LIGHT ON DETAIL WHEN
  // THEIR BRIEF CONTAINS DETAIL.
  //
  // `brief_completeness` is an LLM-authored enum. Measured on staging
  // 2026-08-08 it returned `thin` for the DENSEST of three briefs — 2,563
  // characters carrying ~14 quantitative atoms — and the product told its
  // author their brief was light on detail and that adding specifics would
  // help. That is the same defect class as the rest of this row wearing the
  // opposite sign: a confident, underived claim about what the user did or
  // did not say.
  //
  // The refusal is deliberately not a threshold. The sentence's REMEDY is
  // "add specifics"; a brief that already states an amount has already
  // supplied specifics, so the advice is unearned however few there are. The
  // honest output where the claim cannot be established is SILENCE, never the
  // stronger claim.
  //
  // ⚠ THE SECOND CLAUSE OF THIS COMMENT USED TO READ: "`partial` is left
  // alone: it makes no negative claim about the user's input and nothing
  // measured it false." ROADMAP 2.972(d) falsified the second half on
  // 2026-08-13 and retired the first as never having been the rule — the
  // rule is about the SUBJECT of the sentence, not its sign. `partial` now
  // resolves to null in {@link COMPLETENESS_ADVISORY}, where the witness and
  // the reasoning are recorded. NOTE THE CONSEQUENCE FOR THIS FUNCTION: the
  // refutation below is now the ONLY conditional arm, and it guards the ONLY
  // arm that still emits.
  if (wideningLog.brief_completeness === "thin" && findStatedAmounts(briefText).length > 0) {
    return null;
  }
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

/**
 * The generic label `deriveDecisionLabel` falls back to when it declines to
 * author a decision statement (`objective-label.ts:807`). Mirrored here because
 * the narrative cannot import the projector's draft-records layer; the mirror is
 * held honest by a test that calls `deriveDecisionLabel` itself and asserts this
 * exact string, so drift REDs rather than silently disabling the gate.
 */
const UNAUTHORED_DECISION_LABEL = 'Decision';

/**
 * TRUE when the model carries a decision node whose label the projector could
 * NOT derive from the brief — i.e. the decision exists because the pipeline
 * always mints one, not because the user posed one.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Measured: three open strategic briefs, each explicitly disclaiming a choice
 * between fixed options, were each organised as 1 decision + 3-5 options, and
 * the narrative announced "I've built a first decision model from your brief"
 * over an "Options compared" block. A genuine-decision control was clean, so
 * the product ALWAYS decides rather than deciding appropriately.
 *
 * ⚠ THE MODEL SHAPE IS NOT FIXED HERE AND CANNOT BE. `option` is the records
 * grammar's only bucket for "a thing under consideration"
 * (`grammar.ts:172`), the decision node is minted deterministically from
 * whatever options exist (`projector.ts:3207-3282`), and a decision-free model
 * is not expressible — `graph-validator.ts:348-382` raises `MISSING_DECISION`
 * and `INSUFFICIENT_OPTIONS` at ERROR severity and
 * `analysis-ready-helper.ts:1487` forces `needs_user_input` below two options.
 * Changing that is a `NodeKind` contract train across four repos. This gate
 * changes only the CLAIM the product makes about the model it built.
 *
 * ⚠ SCOPED TO AN EXISTING DECISION NODE, not to the flag's absence. A graph
 * with no decision node has had nothing framed provisionally, so saying so
 * would be a fresh false claim in the opposite direction.
 *
 * ⚠⚠ TWO SIGNALS, NOT ONE — AND THE SECOND IS WHAT STOPS THIS OVER-FIRING.
 * `label_authored` alone is NOT sufficient. The field is documented
 * RESPONSE-ONLY and "recomputed from the source node on every response"
 * (`cee-v3.ts:250-254`), so a hand-built, user-edited or round-tripped graph
 * can carry a perfectly good decision — "Launch product?" — with no flag on
 * it. Gating on the flag alone told that user "I couldn't pin down a single
 * decision in your brief", which is a NEW false claim in place of the old one.
 * (Caught by an existing integration fixture, not by this lane's own tests,
 * whose control set the flag explicitly and so could not see the class.)
 *
 * The producer's actual signature for "could not derive" is BOTH: the flag
 * absent AND the label left as the generic placeholder. `deriveDecisionLabel`
 * returns exactly `{ label: "Decision", authored: false }` when nothing yields
 * a faithful statement (`objective-label.ts:807`) — derived there, not assumed
 * here, and pinned by a test that calls that producer directly so this
 * constant cannot silently drift out of agreement with it.
 *
 * If that literal ever changes, this gate STOPS FIRING and the copy reverts to
 * today's wording — the safe direction: a lost hedge, never a fresh lie.
 *
 * ⚠ KNOWN GAP, STATED RATHER THAN PAPERED OVER: this catches the cases where
 * `deriveDecisionLabel` DECLINED to author. It does NOT catch a brief whose
 * disclaimer was itself run through the sentence-stripper into a confident
 * label (observed: a decision labelled "Choose Between Fixed Options Yet",
 * authored from a NEGATED sentence). Those set `label_authored` and are
 * indistinguishable here — the fix for that class belongs in
 * `deriveDecisionLabel`'s handling of negation, upstream of this file.
 *
 * ⚠ RESIDUAL — THE OTHER OPENER IS UNGOVERNED. This whole builder is bypassed
 * when the model's own coaching summary passes the copy gate AND readiness is
 * exactly `ready` (`:459-466`), in which case the LLM's sentences ship
 * verbatim and nothing here can vet them. All four turns in which this defect
 * was captured took the deterministic path, so this is the right site for what
 * was witnessed — but a model-authored summary asserting a decision on an open
 * brief would still ship, and is UNMEASURED for this defect.
 */
function hasProvisionalDecision(nodes: readonly NodeLite[]): boolean {
  for (const n of nodes) {
    if (n.kind !== 'decision') continue;
    // The FIRST decision node is authoritative: the projector mints exactly one.
    return (
      n.label_authored !== true &&
      n.label?.trim() === UNAUTHORED_DECISION_LABEL
    );
  }
  return false;
}

function findGoalLabel(nodes: readonly NodeLite[]): string | null {
  for (const n of nodes) {
    if (n.kind === 'goal' && typeof n.label === 'string' && n.label.trim().length > 0) {
      return n.label.trim();
    }
  }
  return null;
}

/**
 * TRUE when the goal on this graph carries a label CEE authored rather than the
 * user's own words — so the opener must not put it in quotation marks.
 *
 * ⛔ WHY THIS IS SEPARATE FROM {@link findGoalLabel}. That function answers
 * "what is the goal called", which the opener needs either way. This answers
 * "may we attribute it", and they are DIFFERENT QUESTIONS (trap 21: two
 * questions under one name is how a permission seam silently inverts). Folding
 * the authorship test into the label lookup would make an unattributable goal
 * indistinguishable from NO goal, and the two take different openers.
 *
 * ⚠ BOUND TO THE SAME NODE THE LABEL CAME FROM — the FIRST goal node, matching
 * `findGoalLabel`'s own scan order. Reading `label_authored` off any goal node
 * on the graph would be a value predicate another object could satisfy
 * (standing brief §3: bind by identity), and would misreport the moment a graph
 * carries two goals.
 *
 * `label_authored` is set by `projectNodeProvenance` (`schema-v3.ts:1183`) from
 * the typed record the producer minted — `MINTED_GOAL_PROVENANCE` for a goal
 * CEE chose (`structure/goal-inference.ts`), and the projector's own authored
 * objective labels. A goal carrying the user's words has no such record and
 * reads `undefined` here, which is the fail-safe direction: quotation is
 * withheld only on an explicit authored claim.
 */
function hasAuthoredGoalLabel(nodes: readonly NodeLite[]): boolean {
  for (const n of nodes) {
    if (n.kind === 'goal' && typeof n.label === 'string' && n.label.trim().length > 0) {
      return n.label_authored === true;
    }
  }
  return false;
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

// N26: the local label truncator that used to live here is DELETED. It cut
// user labels mid-token and appended no ellipsis, producing witnessed strings
// such as `double down on enterprise sales (higher`. Label elision now has
// exactly one owner in CEE — `src/utils/label-elision.ts`. Do not reintroduce
// a local copy here; add the case to the canonical module instead.

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
  /**
   * Weighing block reduced to the direction clarifications alone, or `null`
   * when there are none. The last rung before the block is shed entirely.
   */
  readonly weighingBlockDirectionOnly: string | null;
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
  /**
   * Whether ANY weighing block survived — the direction bullets live in it, so
   * telemetry must report what was SERVED rather than what was composed.
   */
  readonly includedWeighing: boolean;
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

  /**
   * ⭐⭐ THE VARIANCE NOTE IS A FIXED FOOTER, AND IT IS DELIBERATELY OUTSIDE
   * THE WORD BUDGET THE LADDER SPENDS.
   *
   * ⚠ IT WAS INSIDE IT FOR ONE ROUND, AND TWO INDEPENDENT TESTS CAUGHT WHAT
   * THAT COSTS. Charging 31 words of the 140 to the note makes it COMPETE with
   * the coaching, and the ladder pays out of content the product has already
   * committed to delivering:
   *   · on the real staging fixture the `Worth a look:` bullet was shed
   *     (108 words of content -> 143 with the note -> rung 2);
   *   · on the direction-clarification integration path the ORDINARY coaching
   *     bullet was shed while the clarification survived — which is precisely
   *     the trade `route-v2-direction-clarification-served.test.ts` exists to
   *     forbid ("a fix that surfaces the question by silencing the coaching is
   *     a trade, not a fix").
   * The first was recoverable by trimming four words. The second was not: it
   * would have needed a note of roughly zero. That is the signal — a footer
   * about what the artefact IS must not be priced against the artefact's
   * content, or every future coaching addition silently trades against the
   * truthfulness statement, invisibly.
   *
   * So the ladder below measures and sheds EXACTLY as it did before this
   * change, over the content alone, and the note is spliced in afterwards.
   * Nothing the product had committed to delivering is displaced by it.
   *
   * ⭐ SPLICED SECOND-TO-LAST, not appended. `nextStep` stays terminal so the
   * reply still ends on the action; placing the note first would open every
   * draft with two hedges in a row (see the opener in `buildConfirmSentence`).
   */
  const withNote = (text: string): string => {
    const blocks = text.split('\n\n');
    blocks.splice(blocks.length - 1, 0, MODEL_VARIANCE_NOTE);
    return blocks.join('\n\n');
  };

  const hasCompleteness = input.completenessBlock !== null;
  const hasExtra = input.weighingBlock !== input.weighingBlockCore;

  // Rung 1 — everything.
  let text = tryAssemble(input.weighingBlock, true, true);
  if (countWords(text) <= MAX_WORDS) {
    return { text: withNote(text), includedWeighingExtra: hasExtra, includedCompleteness: hasCompleteness, includedWeighing: true };
  }
  // Rung 2 — drop the extra check bullet.
  text = tryAssemble(input.weighingBlockCore, true, true);
  if (countWords(text) <= MAX_WORDS) {
    return { text: withNote(text), includedWeighingExtra: false, includedCompleteness: hasCompleteness, includedWeighing: true };
  }
  // Rung 3 — drop the completeness advisory.
  text = tryAssemble(input.weighingBlockCore, true, false);
  if (countWords(text) <= MAX_WORDS) {
    return { text: withNote(text), includedWeighingExtra: false, includedCompleteness: false, includedWeighing: true };
  }
  // Rung 3b — reduce the weighing block to the direction clarifications alone.
  //
  // ⭐ A LIMIT THE USER STATED OUTRANKS EVERY COACHING SUGGESTION IN THE BLOCK.
  // Without this rung a long options list could shed the whole section, and the
  // one thing in it the user is REQUIRED to answer would vanish with it — the
  // same silent loss, arriving through the word budget instead of through
  // position.
  if (input.weighingBlockDirectionOnly !== null) {
    text = tryAssemble(input.weighingBlockDirectionOnly, true, false);
    if (countWords(text) <= MAX_WORDS) {
      return { text: withNote(text), includedWeighingExtra: false, includedCompleteness: false, includedWeighing: true };
    }
  }
  // Rung 4 — drop the whole weighing block.
  text = tryAssemble(null, true, false);
  if (countWords(text) <= MAX_WORDS) {
    return { text: withNote(text), includedWeighingExtra: false, includedCompleteness: false, includedWeighing: false };
  }
  // Rung 5 — drop options too.
  return {
    text: withNote(tryAssemble(null, false, false)),
    includedWeighingExtra: false,
    includedCompleteness: false,
    includedWeighing: false,
  };
}
