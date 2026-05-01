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
}

export interface PostAnalysisWrapperResult {
  readonly chips: readonly SuggestedAction[];
  readonly fact: HandlerFact | null;
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
 * Generate post-analysis coaching chips and the accompanying fact.
 *
 * Trigger conditions:
 *   - stage must be 'analyse'
 *   - latest successful run_analysis fact must exist
 *   - freshness 'fresh' → mine review_cards for coaching chips
 *   - freshness 'stale' → emit single rerun chip (no coaching mix)
 *   - freshness 'none' / 'unknown' → skip the wrapper entirely
 *
 * Does NOT re-derive freshness — the caller is expected to pass the
 * verdict already computed by deriveAnalysisFreshness.
 */
export function generatePostAnalysisCoaching(
  input: PostAnalysisWrapperInput,
): PostAnalysisWrapperResult {
  if (input.stage !== 'analyse') {
    return skip(input, 'non_analyse_stage');
  }

  if (input.freshness === 'none' || input.freshness === 'unknown') {
    return skip(input, 'freshness_unknown');
  }

  const selected = selectRunAnalysisFact(input.priorFacts);
  if (selected === null) {
    return skip(input, 'no_run_fact');
  }

  if (input.freshness === 'stale') {
    return {
      chips: [STALE_RERUN_CHIP],
      fact: buildFact(input, [STALE_RERUN_CHIP], [], 'stale'),
      fired: true,
    };
  }

  const fact = selected.fact as RunAnalysisHandlerFact;
  const enrichment = (fact.result.enrichment ?? {}) as Record<string, unknown>;
  const reviewCards = readReviewCards(enrichment);
  if (reviewCards.length === 0) {
    return skip(input, 'no_review_cards');
  }

  const generation = generateChipsFromCards(reviewCards);
  if (generation.unsupportedCount > 0) {
    emit(TelemetryEvents.PostAnalysisDirectAnswerRecoverySkipped, {
      request_id: input.requestId,
      session_id: input.scenarioId,
      reason: 'unsupported_chip_actions' satisfies SkipReason,
      unsupported_count: generation.unsupportedCount,
    });
  }

  if (generation.chips.length === 0) {
    return skip(input, 'no_review_cards');
  }

  emit(TelemetryEvents.PostAnalysisDirectAnswerRecovered, {
    request_id: input.requestId,
    session_id: input.scenarioId,
    chip_count: generation.chips.length,
    selected_card_count: generation.selectedCardIds.length,
  });

  return {
    chips: generation.chips,
    fact: buildFact(input, generation.chips, generation.selectedCardIds, 'fresh'),
    fired: true,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────────

function skip(
  input: PostAnalysisWrapperInput,
  reason: SkipReason,
): PostAnalysisWrapperResult {
  emit(TelemetryEvents.PostAnalysisDirectAnswerRecoverySkipped, {
    request_id: input.requestId,
    session_id: input.scenarioId,
    reason,
  });
  return { chips: [], fact: null, fired: false, skipReason: reason };
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
}

function generateChipsFromCards(
  cards: ReadonlyArray<ReviewCard>,
): GenerationResult {
  const chips: SuggestedAction[] = [];
  const selectedCardIds: string[] = [];
  const seen = new Set<string>();
  let unsupportedCount = 0;

  for (const card of cards) {
    if (chips.length >= MAX_CHIPS) break;

    const built = buildChipFromCard(card);
    if (!built) {
      unsupportedCount += 1;
      continue;
    }

    if (seen.has(built.dedupeKey)) continue;
    seen.add(built.dedupeKey);

    chips.push(built.chip);
    if (card.card_id && typeof card.card_id === 'string') {
      selectedCardIds.push(card.card_id);
    }
  }

  return { chips, selectedCardIds, unsupportedCount };
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

  // Path 2: unknown card_type → conversational prefill chip with card prose.
  const message = pickConversationalMessage(card);
  if (!message) return null;

  const label = truncateLabel(card.title ?? message);
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
  // Prefer the card's first item suggested_evidence (specific) over a
  // generic phrasing. Both are sanitised at the enrichment layer.
  const firstItemEvidence = card.items?.[0]?.suggested_evidence;
  if (typeof firstItemEvidence === 'string' && firstItemEvidence.length > 0) {
    return firstItemEvidence;
  }

  const subject = factorLabel ?? 'this factor';
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
  const firstItemNodeId = card.items?.[0]?.node_id;
  if (typeof firstItemNodeId === 'string' && firstItemNodeId.length > 0) {
    return firstItemNodeId;
  }
  return null;
}

function pickFactorLabel(card: ReviewCard): string | null {
  const firstItemLabel = card.items?.[0]?.factor_label;
  if (typeof firstItemLabel === 'string' && firstItemLabel.length > 0) {
    return firstItemLabel;
  }
  return null;
}

function pickConversationalMessage(card: ReviewCard): string | null {
  if (typeof card.title === 'string' && card.title.length > 0) {
    return `Tell me more about: ${card.title}`;
  }
  if (typeof card.what === 'string' && card.what.length > 0) {
    return card.what;
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

// ─── fact builder ─────────────────────────────────────────────────────────

function buildFact(
  input: PostAnalysisWrapperInput,
  chips: readonly SuggestedAction[],
  selectedCardIds: readonly string[],
  freshnessAtResponse: 'fresh' | 'stale',
): HandlerFact {
  const answerHash = createHash('sha256')
    .update(input.answerText)
    .digest('hex');

  // The HandlerFact union in @talchain/schemas does not include a
  // `post_analysis_coaching` variant in the current pinned version. We
  // construct the fact as an unknown-cast HandlerFact so it persists
  // through the existing commit pipeline (the ledger column is JSONB —
  // shape is enforced at boundary, not in storage). Schema bump to add
  // the variant is a follow-up.
  const fact = {
    fact_type: 'post_analysis_coaching',
    fact_version: 1,
    noop: false,
    result: {
      answer_text_hash: answerHash,
      selected_review_card_ids: [...selectedCardIds],
      generated_chip_ids: chips.map((c) => c.id),
      freshness_at_response: freshnessAtResponse,
      invalidates: [] as string[],
    },
  } as unknown as HandlerFact;
  return fact;
}
