/**
 * Post-analysis coaching wrapper (Phase 2 workstream A).
 *
 * Trigger: `analyse` stage produces a `direct_answer` (LLM emitted text-
 * only or routed to coach intent) AND a successful run_analysis fact
 * exists in prior facts AND freshness is `fresh`.
 *
 * Without this wrapper, the existing chip generator returns no chips on
 * the analyse-stage direct_answer path (no handler ran this turn → no
 * post-handler chip rule fires). The user gets coaching prose with no
 * structured next step.
 *
 * The wrapper reads `enrichment.review_cards` from the latest successful
 * run_analysis fact and derives chips defensively from the fields that
 * are actually present (`card_type`, `title`, `what`, `items[]`). The
 * brief originally referenced a `card.suggested_action` field which does
 * not exist on real review_cards — we derive defensively from the
 * confirmed shape (per ChatGPT's correction) and fall back to safe
 * conversational text-prompt chips for unknown shapes.
 *
 * Wire-contract notes:
 *   - The boundary `Action` schema only carries
 *     `{ id, label, message, action_type? }` — there is no `type` field.
 *   - `action_type` is a closed enum: `run_analysis`, `set_factor_value`,
 *     `add_constraint`, `adjust_edge_strength`, `explain_result`,
 *     `explain_results`, `explain_from_structure`, `compare_options`,
 *     `what_would_flip`. Anything outside this set fails egress
 *     validation, so coaching action types like `add_evidence` /
 *     `validate_factor` / `challenge_assumption` ship as **prefill
 *     chips** (no `action_type`) — UI populates the composer with
 *     `chip.message`.
 *   - Only `run_analysis` and `compare_options` from the brief's
 *     adopted set are dispatchable as executable chips.
 */

import { createHash } from 'node:crypto';

import type { HandlerFact, RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';
import type { SuggestedAction } from '../compose/types.js';
import { emit, TelemetryEvents } from '../../utils/telemetry.js';
import { selectRunAnalysisFact } from '../context/freshness.js';
import type { AnalysisFreshness } from '../context/freshness.js';
import { sanitiseChipProse } from './chip-prose-sanitiser.js';

const MAX_CHIPS = 3;

/**
 * Map known PLoT review_card.card_type values to a coaching intent. The
 * codebase has confirmed exactly one value (`evidence_priority`); other
 * entries are conservative best-effort mappings that may be updated
 * when staging captures expand the set. Unknown card_types fall through
 * to a generic conversational chip using card prose.
 */
const CARD_TYPE_TO_INTENT: ReadonlyMap<string, CoachingIntent> = new Map([
  ['evidence_priority', 'add_evidence'],
  ['validate', 'validate_factor'],
  ['challenge', 'challenge_assumption'],
  ['compare', 'compare_options'],
]);

type CoachingIntent =
  | 'run_analysis'
  | 'compare_options'
  | 'add_evidence'
  | 'validate_factor'
  | 'challenge_assumption';

interface ReviewCard {
  readonly card_id?: string;
  readonly card_type?: string;
  readonly title?: string;
  readonly what?: string;
  readonly why?: string;
  readonly items?: ReadonlyArray<ReviewCardItem>;
  readonly node_id?: string;
}

interface ReviewCardItem {
  readonly node_id?: string;
  readonly factor_label?: string;
  readonly suggested_evidence?: string;
}

export type SkipReason =
  | 'no_run_fact'
  | 'stale_analysis'
  | 'no_review_cards'
  | 'unsupported_chip_actions'
  | 'non_analyse_stage'
  | 'freshness_unknown';

export interface PostAnalysisWrapperInput {
  readonly stage: string;
  readonly priorFacts: readonly HandlerFact[];
  readonly freshness: AnalysisFreshness;
  readonly requestId: string;
  readonly scenarioId: string;
  readonly answerText: string;
  /**
   * ROADMAP 1.16j — 1.20(b) chip-sameness guard for the wrapper path.
   * Chip ids offered on the IMMEDIATELY PRIOR turn; the call site
   * (turn-executor) derives this from `context.most_recent_pending_actions`
   * via the same memoised `recentlyOfferedChipIds()` helper the
   * `generateChips` call sites read — one authority, one window (N=1
   * prior turn, undecremented-TTL recency signal; see the FIX 3/F11 doc
   * comment on that helper). A generated chip whose id is in this set is
   * suppressed during card selection so a later review card can fill the
   * freed MAX_CHIPS slot (an alternative card over an identical repeat);
   * when every candidate is suppressed the wrapper ships an honest empty
   * set (`fired: false`). Suppression is recorded via the guard's own
   * existing `v5.chips.recently_offered_suppressed` event. Optional +
   * additive: omitted → zero behaviour change (mirrors
   * `ChipGeneratorInput.recentlyOfferedChipIds`). The 11 Jul manual test
   * (edf2a4d9) showed the wrapper bypassing the guard entirely — the
   * identical chip re-offered on all 6 post-analysis turns.
   */
  readonly recentlyOfferedChipIds?: ReadonlySet<string>;
}

export interface PostAnalysisWrapperResult {
  readonly chips: readonly SuggestedAction[];
  /**
   * The wrapper does NOT emit a HandlerFact. The strict-parse path in
   * `supabase-store.ts:readFactsFor` validates every persisted fact
   * through `HandlerFactSchema`; an unschemaed `post_analysis_coaching`
   * variant would poison the entire scenario's fact chain (one bad row
   * → SessionReadError → degraded prior_facts → broken freshness
   * derivation). Recovery state is emitted via the
   * PostAnalysisDirectAnswerRecovered telemetry event instead, which
   * carries the same structured fields (answer_text_hash, chip ids,
   * selected card ids, freshness at response).
   *
   * KNOWN LIMITATION (deliberate, documented for review): telemetry
   * does NOT ride on `prior_facts`. The next turn cannot read what
   * happened on this turn — the original brief implied a persisted
   * cross-turn signal, and that part of the contract is deferred.
   * Two follow-up paths:
   *   1. Bump `@talchain/schemas` to add `PostAnalysisCoachingFactSchema`
   *      to the `HandlerFactSchema` discriminated union. After it
   *      lands, swap this telemetry-only emission for a typed fact
   *      and drop the TODO. Test
   *      `tests/contract/post-analysis-wrapper.test.ts >
   *      cross-turn limitation` will start failing — that test is
   *      pinned to the CURRENT behaviour and should flip when the
   *      schema bump lands, forcing the wiring update.
   *   2. If a cross-turn signal is needed before the schema bump
   *      ships, attach the recovery state to the most recent
   *      run_analysis fact's enrichment via a new optional field —
   *      pass-through is already the contract for enrichment, so
   *      no schema change required. This is a more invasive change
   *      and should not happen without explicit alignment.
   */
  readonly fired: boolean;
  readonly skipReason?: SkipReason;
}

const STALE_RERUN_CHIP: SuggestedAction = {
  id: 'chip_action_run_analysis',
  action_type: 'run_analysis',
  label: 'Run analysis',
  message: 'Re-run the analysis on the updated graph.',
};

/**
 * Generate post-analysis coaching chips.
 *
 * Trigger conditions:
 *   - stage must be 'analyse'
 *   - latest successful run_analysis fact must exist
 *   - freshness 'fresh' → mine review_cards for coaching chips
 *   - freshness 'stale' → emit single rerun chip (no coaching mix)
 *   - freshness 'none' / 'unknown' → silent skip (pre-analysis turn)
 *
 * Telemetry policy: skip events only fire when the wrapper was
 * EXPECTED to fire and was blocked by something diagnostic
 * (no_run_fact, no_review_cards, unsupported_chip_actions). Trivial
 * non-trigger paths (non_analyse_stage, freshness_unknown) are silent
 * — every direct_answer turn passes through here, so noise on those
 * paths would dwarf the signal.
 *
 * Does NOT re-derive freshness — the caller passes the verdict already
 * computed by deriveAnalysisFreshness.
 */
export function generatePostAnalysisCoaching(
  input: PostAnalysisWrapperInput,
): PostAnalysisWrapperResult {
  // Silent non-trigger paths — the wrapper was never expected to fire.
  if (input.stage !== 'analyse') {
    return silentSkip('non_analyse_stage');
  }
  if (input.freshness === 'none' || input.freshness === 'unknown') {
    return silentSkip('freshness_unknown');
  }

  // From here down, the wrapper WAS expected to fire. Skips are diagnostic.
  const selected = selectRunAnalysisFact(input.priorFacts);
  if (selected === null) {
    return diagnosticSkip(input, 'no_run_fact');
  }

  if (input.freshness === 'stale') {
    // ROADMAP 1.16j — the rerun chip is subject to the same 1.20(b)
    // guard as every other chip: offered on the immediately-prior turn
    // → honest empty set, recorded via the guard's own event.
    if (input.recentlyOfferedChipIds?.has(STALE_RERUN_CHIP.id)) {
      emit(TelemetryEvents.V5ChipsRecentlyOfferedSuppressed, {
        suppressed_ids: [STALE_RERUN_CHIP.id],
        survived_count: 0,
      });
      return { chips: [], fired: false };
    }
    return {
      chips: [STALE_RERUN_CHIP],
      fired: true,
    };
  }

  const fact = selected.fact as RunAnalysisHandlerFact;
  const enrichment = (fact.result.enrichment ?? {}) as Record<string, unknown>;
  const reviewCards = readReviewCards(enrichment);
  if (reviewCards.length === 0) {
    return diagnosticSkip(input, 'no_review_cards');
  }

  const generation = generateChipsFromCards(reviewCards, input.recentlyOfferedChipIds);
  // ROADMAP 1.16j — suppression record. Same event + payload shape as
  // chip-generator.ts's excludeRecentlyOfferedChips (the 1.20(b) guard
  // this wrapper previously bypassed); fires whether or not any chip
  // survived, so ops can see exactly which repeat offers were withheld.
  if (generation.suppressedRecentlyOfferedIds.length > 0) {
    emit(TelemetryEvents.V5ChipsRecentlyOfferedSuppressed, {
      suppressed_ids: [...generation.suppressedRecentlyOfferedIds],
      survived_count: generation.chips.length,
    });
  }
  if (generation.chips.length === 0) {
    // Guard-empty — every candidate chip was offered on the immediately-
    // prior turn. An honest empty set beats an identical repeat
    // (1.20(b) convention). NOT a RecoverySkipped: the wrapper did not
    // fail and the producer did not regress — the guard held; the
    // V5ChipsRecentlyOfferedSuppressed event above is the record.
    if (generation.suppressedRecentlyOfferedIds.length > 0) {
      return { chips: [], fired: false };
    }
    // Terminal skip — single event, accurate semantics.
    //   - cards existed but every one was unmappable / had no usable
    //     prose / leaked tokens → unsupported_chip_actions
    //   - cards existed and at least one was structurally valid but
    //     the producer routed them all to dedupe collisions or other
    //     non-emit paths → no_review_cards (rare; defensive default)
    if (generation.unsupportedCount > 0) {
      emit(TelemetryEvents.PostAnalysisDirectAnswerRecoverySkipped, {
        request_id: input.requestId,
        session_id: input.scenarioId,
        reason: 'unsupported_chip_actions' satisfies SkipReason,
        unsupported_count: generation.unsupportedCount,
      });
      return { chips: [], fired: false, skipReason: 'unsupported_chip_actions' };
    }
    return diagnosticSkip(input, 'no_review_cards');
  }

  if (generation.unsupportedCount > 0) {
    // Cards produced ≥1 valid chip AND ≥1 unsupported; emit a partial-
    // skip event alongside the Recovered event so ops still sees the
    // unsupported count without the misleading terminal-skip semantic.
    emit(TelemetryEvents.PostAnalysisDirectAnswerRecoverySkipped, {
      request_id: input.requestId,
      session_id: input.scenarioId,
      reason: 'unsupported_chip_actions' satisfies SkipReason,
      unsupported_count: generation.unsupportedCount,
    });
  }

  // Fact-equivalent payload travels on the recovered event so the
  // ledger does not have to carry an unschemaed fact_type.
  //
  // NAMING CAUTION (1.16j): `v5.post_analysis.direct_answer_recovered` is
  // the SUCCESS telemetry of the post-analysis chip wrapper — "recovered"
  // means the analyse-stage direct_answer gained structured chips it
  // would otherwise lack. It is NOT an empty-answer salvage (that is
  // `v5.coaching.empty_answer_recovered` / V5CoachingEmptyAnswerRecovered).
  // Conflating the two caused a real misdiagnosis in the 11 Jul manual
  // test. The name is frozen in the telemetry registry
  // (deliberate-update-only) — do not "fix" this by renaming.
  const answerHash = createHash('sha256').update(input.answerText).digest('hex');
  emit(TelemetryEvents.PostAnalysisDirectAnswerRecovered, {
    request_id: input.requestId,
    session_id: input.scenarioId,
    chip_count: generation.chips.length,
    selected_card_count: generation.selectedCardIds.length,
    answer_text_hash: answerHash,
    generated_chip_ids: generation.chips.map((c) => c.id),
    selected_review_card_ids: [...generation.selectedCardIds],
    freshness_at_response: 'fresh',
  });

  return {
    chips: generation.chips,
    fired: true,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────

/**
 * Silent skip for trivial non-trigger paths (non_analyse_stage,
 * freshness_unknown). Every direct_answer turn passes through here,
 * so emitting a skip event on these paths would generate per-turn
 * noise with no diagnostic value.
 */
function silentSkip(reason: SkipReason): PostAnalysisWrapperResult {
  return { chips: [], fired: false, skipReason: reason };
}

/**
 * Diagnostic skip for paths where the wrapper was EXPECTED to fire
 * but was blocked. These are operationally interesting and warrant a
 * telemetry event so ops can investigate (no_run_fact suggests a
 * fact-loading bug; no_review_cards suggests a producer regression;
 * unsupported_chip_actions suggests a card_type drift).
 */
function diagnosticSkip(
  input: PostAnalysisWrapperInput,
  reason: SkipReason,
): PostAnalysisWrapperResult {
  emit(TelemetryEvents.PostAnalysisDirectAnswerRecoverySkipped, {
    request_id: input.requestId,
    session_id: input.scenarioId,
    reason,
  });
  return { chips: [], fired: false, skipReason: reason };
}

function readReviewCards(enrichment: Record<string, unknown>): ReadonlyArray<ReviewCard> {
  const raw = enrichment.review_cards;
  if (!Array.isArray(raw)) return [];
  const out: ReviewCard[] = [];
  for (const entry of raw) {
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      out.push(entry as ReviewCard);
    }
  }
  return out;
}

interface GenerationResult {
  readonly chips: readonly SuggestedAction[];
  readonly selectedCardIds: readonly string[];
  readonly unsupportedCount: number;
  /**
   * ROADMAP 1.16j — chip ids that WOULD have been offered but were
   * suppressed because they were offered on the immediately-prior turn
   * (1.20(b) sameness guard). Deduplicated; does not overlap `chips`.
   */
  readonly suppressedRecentlyOfferedIds: readonly string[];
}

function generateChipsFromCards(
  cards: ReadonlyArray<ReviewCard>,
  recentlyOfferedChipIds?: ReadonlySet<string>,
): GenerationResult {
  const chips: SuggestedAction[] = [];
  const selectedCardIds: string[] = [];
  const seen = new Set<string>();
  const suppressedRecentlyOffered = new Set<string>();
  let unsupportedCount = 0;

  for (const card of cards) {
    if (chips.length >= MAX_CHIPS) break;

    const built = buildChipFromCard(card);
    if (!built) {
      unsupportedCount += 1;
      continue;
    }

    // ROADMAP 1.16j — 1.20(b) chip-sameness guard, applied during
    // selection (not as a post-filter) so a later review card can fill
    // the freed MAX_CHIPS slot: an alternative card over an identical
    // repeat. Key is chip.id — the same key the generateChips guard
    // filters on (chip-generator.ts excludeRecentlyOfferedChips).
    if (recentlyOfferedChipIds?.has(built.chip.id)) {
      suppressedRecentlyOffered.add(built.chip.id);
      continue;
    }

    if (seen.has(built.dedupeKey)) continue;
    seen.add(built.dedupeKey);

    chips.push(built.chip);
    if (card.card_id && typeof card.card_id === 'string') {
      selectedCardIds.push(card.card_id);
    }
  }

  return {
    chips,
    selectedCardIds,
    unsupportedCount,
    suppressedRecentlyOfferedIds: [...suppressedRecentlyOffered],
  };
}

interface BuiltChip {
  readonly chip: SuggestedAction;
  readonly dedupeKey: string;
}

function buildChipFromCard(card: ReviewCard): BuiltChip | null {
  const cardType = typeof card.card_type === 'string' ? card.card_type : null;
  const targetNodeId = pickTargetNodeId(card);
  const factorLabel = pickFactorLabel(card);

  // Path 1: known card_type → mapped intent (executable or prefill).
  if (cardType !== null) {
    const intent = CARD_TYPE_TO_INTENT.get(cardType);
    if (intent !== undefined) {
      return buildIntentChip(intent, targetNodeId, factorLabel, card);
    }
  }

  // Path 2: unknown card_type → conversational prefill chip with card
  // prose. Both the message AND the label must come from sanitised
  // sources — using `card.title` raw for the label would leak whatever
  // the sanitiser rejected for the message (e.g. dirty title + clean
  // `what` would silently route the dirty title into the user-visible
  // chip label). Sanitise the title independently for the label slot;
  // fall back to the already-sanitised message when the title fails.
  const message = pickConversationalMessage(card);
  if (!message) return null;

  const cleanedTitle = typeof card.title === 'string' && card.title.length > 0
    ? sanitiseChipProse(card.title)
    : null;
  const labelSource = cleanedTitle && !cleanedTitle.suppressed
    ? cleanedTitle.text
    : message;
  const label = truncateLabel(labelSource);
  return {
    chip: {
      id: chipIdForText(message),
      label,
      message,
    },
    dedupeKey: `prefill:${message}`,
  };
}

function buildIntentChip(
  intent: CoachingIntent,
  targetNodeId: string | null,
  factorLabel: string | null,
  card: ReviewCard,
): BuiltChip | null {
  // Narrow to the wire-enum subset before using `intent` as `action_type`.
  if (intent === 'run_analysis' || intent === 'compare_options') {
    const label = intent === 'run_analysis' ? 'Run analysis' : 'Compare options';
    const message =
      intent === 'run_analysis'
        ? 'Re-run the analysis.'
        : 'Compare the leading options side by side.';
    return {
      chip: {
        id: `chip_action_${intent}_${targetNodeId ?? 'all'}`,
        action_type: intent,
        label,
        message,
      },
      dedupeKey: `${intent}:${targetNodeId ?? '*'}`,
    };
  }

  // Prefill chip — no action_type (intents like add_evidence are not
  // in the wire action_type enum). UI populates composer with `message`.
  const message = buildPrefillMessage(intent, factorLabel, card);
  if (!message) return null;
  const label = labelForPrefillIntent(intent);
  return {
    chip: {
      id: chipIdForText(`${intent}:${message}`),
      label,
      message,
    },
    dedupeKey: `${intent}:${targetNodeId ?? message}`,
  };
}

function buildPrefillMessage(
  intent: CoachingIntent,
  factorLabel: string | null,
  card: ReviewCard,
): string | null {
  // Prefer card-derived suggested_evidence (specific) over a generic
  // phrasing. Scan ALL items (not just items[0]) to find the first
  // usable suggested_evidence — multi-item cards otherwise lose
  // signal. Each candidate goes through the local sanitiser; entity-id
  // leaks and HARD_BAN matches are suppressed.
  if (Array.isArray(card.items)) {
    for (const item of card.items) {
      const candidate = item?.suggested_evidence;
      if (typeof candidate === 'string' && candidate.length > 0) {
        const cleaned = sanitiseChipProse(candidate);
        if (!cleaned.suppressed) {
          return cleaned.text;
        }
      }
    }
  }

  // Fallback: deterministic phrasing keyed on factor_label. The
  // factorLabel candidate is already a label (not a prose blob), so
  // it gets a lighter sanitiser treatment via the wrapping prose.
  const subjectLabel = factorLabel
    ? sanitiseChipProse(factorLabel)
    : null;
  const subject = subjectLabel && !subjectLabel.suppressed
    ? subjectLabel.text
    : 'this factor';
  switch (intent) {
    case 'add_evidence':
      return `Help me add evidence about ${subject}.`;
    case 'validate_factor':
      return `Help me validate ${subject}.`;
    case 'challenge_assumption':
      return `What assumptions about ${subject} should I challenge?`;
    default:
      return null;
  }
}

function labelForPrefillIntent(intent: CoachingIntent): string {
  switch (intent) {
    case 'add_evidence':
      return 'Add evidence';
    case 'validate_factor':
      return 'Validate factor';
    case 'challenge_assumption':
      return 'Challenge assumption';
    default:
      return 'Discuss';
  }
}

function pickTargetNodeId(card: ReviewCard): string | null {
  if (typeof card.node_id === 'string' && card.node_id.length > 0) {
    return card.node_id;
  }
  // Scan ALL items, not just items[0]. The first item with a node_id
  // wins; the field is structural (not user-visible prose), so no
  // sanitisation needed.
  if (Array.isArray(card.items)) {
    for (const item of card.items) {
      const id = item?.node_id;
      if (typeof id === 'string' && id.length > 0) {
        return id;
      }
    }
  }
  return null;
}

function pickFactorLabel(card: ReviewCard): string | null {
  // Scan ALL items, not just items[0]. The first item with a
  // factor_label wins.
  if (Array.isArray(card.items)) {
    for (const item of card.items) {
      const label = item?.factor_label;
      if (typeof label === 'string' && label.length > 0) {
        return label;
      }
    }
  }
  return null;
}

function pickConversationalMessage(card: ReviewCard): string | null {
  // `title` and `what` are user-visible prose. Sanitise before use;
  // suppress the chip when the candidate fails the safety check
  // (caller treats null as "no usable prose").
  if (typeof card.title === 'string' && card.title.length > 0) {
    const cleaned = sanitiseChipProse(card.title);
    if (!cleaned.suppressed) {
      return `Tell me more about: ${cleaned.text}`;
    }
  }
  if (typeof card.what === 'string' && card.what.length > 0) {
    const cleaned = sanitiseChipProse(card.what);
    if (!cleaned.suppressed) {
      return cleaned.text;
    }
  }
  return null;
}

function truncateLabel(text: string, max = 32): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function chipIdForText(text: string): string {
  const hash = createHash('sha256').update(text).digest('hex').slice(0, 12);
  return `chip_text_${hash}`;
}

