/**
 * THE RUN-TURN NO-FLAGGED-LINK CARD — the second run-turn coaching card
 * (contract `run-turn-coaching/v1`, beside `fragile-link-challenge.ts`).
 *
 * For a run whose robustness check marked NO link as fragile. It says only
 * that, names the check's limits, and hands the user a question turn: what in
 * the model are they least sure of, and what does the model leave out.
 *
 * ── WHERE IT RUNS ──────────────────────────────────────────────────────────
 * `runTurnCoaching` calls it only after `buildFragileLinkChallenge` returned
 * `no_groundable_fragile_edge`, so the run-this-turn and identity gates have
 * passed and the two cards exclude each other. It still repeats the identity
 * gate, so it is total on its own.
 *
 * ── WHAT THE RUN ESTABLISHES, AND WHAT IT DOES NOT ────────────────────────
 * Measured against ISL main 3cfadcfc (src/services/robustness_analyzer_v2.py;
 * the SERVED ISL build is UNVERIFIED):
 *   · per-link sensitivity is computed only when "sensitivity" is requested
 *     (:773-777; PLoT /v2/run always requests it) and loops over the graph's
 *     edges one at a time (:1141);
 *   · each link's elasticity is the relative change in the expected goal value
 *     of the FIRST-LISTED option only (`ref_option = request.options[0]`,
 *     :1138/:1203/:1257; `raw_elasticity = outcome_diff / baseline_denom`,
 *     :1237-1240) — not a measure of which option leads;
 *   · a link is fragile when max|elasticity| > 0.1 and robust when < 0.05;
 *     links in [0.05, 0.1] go in NEITHER list (:2047-2059);
 *   · PLoT drops decision/option links and bidirected links before calling ISL,
 *     so links the user can see may never have been tested.
 * So a non-empty `robust_edges` is evidence that the per-link test RAN, not
 * that it could detect anything, nor that it covered every link. On both spec
 * fixtures (c10 @016acda0, c11 @0ff062a4) every robust link has a parent valued
 * zero under options[0] — a reimplementation of ISL's semantics, UNVERIFIED
 * against the served ISL. That is why the words claim only the FLAG ("didn't
 * mark any single link … as fragile"), never that the result is insensitive,
 * and why they keep both directions open (the estimates in the model, and what
 * it leaves out).
 *
 * ── WHAT IT READS ──────────────────────────────────────────────────────────
 * Positive evidence: `fragile_edges` (an array, empty) and `robust_edges` (at
 * least one row object). Refusal guards, which must be OBSERVABLE:
 * `display_verdict` present and not 'not_assessed', and `normalization_errors`
 * absent or empty. The first-pass confinement keeps only fragile_edges,
 * robust_edges and near_tie (`UNREQUESTED_ROBUSTNESS_KEPT_MEMBERS`), so on the
 * confined first pass the guards cannot be seen and the card fails closed —
 * a PLoT normaliser that dropped a fragile row into `normalization_errors`
 * would otherwise make "didn't mark any link" false. `near_tie`, `is_robust`,
 * `level` and `win_probabilities` are never inputs.
 *
 * ── NO SCIENCE BADGE ───────────────────────────────────────────────────────
 * No `dsk_claim_provenance`: no protocol in data/dsk/v1.json fits. P-001 needs
 * fragile edges or evidence gaps and an identified winner; P-002 needs the
 * user's own estimates and is an outside-view exercise; P-003 needs a clear
 * winner and is contraindicated on a close call; P-004 is frame/ideate only;
 * P-005 is contraindicated where robustness is already fragile; P-006 is for
 * after a decision.
 *
 * Pure: no clock, no LLM, no telemetry.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import { deterministicBlockId } from '../compose/block-id.js';
import { classifyClaimUsable, TIER2_ACTIVATION_ENABLED } from '../compose/claim-safety-cage.js';
import { deriveCompanionClaimSafe } from '../compose/phase3-blocks.js';
import {
  FIRST_PASS_PREFIX,
  RUN_TURN_COACHING_CONTRACT,
  copyPasses,
  isAutomaticRun,
  readRecord,
  type FragileLinkChallengeCopy,
  type FragileLinkChallengeInput,
  type RunTurnCoachingReason,
  type RunTurnTrigger,
} from './fragile-link-challenge.js';

export const NO_FLAGGED_LINK_SIGNAL_ID_PREFIX = 'coach:no_flagged_link:';
/** The enrichment field this card claims about — the cage decides on it. */
const CLAIM_FIELD = 'robustness';

/** The card's block contract, as data (the shared bounds live on RUN_TURN_COACHING_CONTRACT). */
export const NO_FLAGGED_LINK_CARD_CONTRACT = Object.freeze({
  signal_id: `${NO_FLAGGED_LINK_SIGNAL_ID_PREFIX}<graph_hash>:<run computed_at>:<effective trigger>`,
  block_id: 'deterministicBlockId(signal_id)',
  target_refs: '[]',
  dsk_claim_provenance: 'absent',
  action_intent: 'absent',
});

/**
 * The card's words, fixed per effective trigger (so one block_id always carries
 * one body). The first-pass variant leads with the check's limit so that the
 * no-flag finding never reads as a reason to rely on the first pass.
 */
export function composeNoFlaggedLinkCard(firstPass: boolean): FragileLinkChallengeCopy {
  // ⛔ Never "only looks at links" (ISL also samples factor values), and never the
  // verdict's word "fragile" (the same run's overall verdict usually IS fragile).
  const body = firstPass
    ? `${FIRST_PASS_PREFIX}the robustness check can only test what is already in the model, not what the model leaves out. `
      + 'It didn\'t single out any one link, but that doesn\'t show the estimates are right. Both are worth a look.'
    : 'The robustness check didn\'t single out any one link in the model. That doesn\'t show the estimates are right, '
      + 'and the check can only test what is already in the model, not what the model leaves out. Both are worth a look.';
  return {
    title: 'What the robustness check can\'t show',
    body,
    action_label: 'Look for weak spots and gaps',
    action_prompt:
      'Ask me questions to help me spot which estimates in the model I\'m least sure of, and what matters to this decision '
      + 'but isn\'t in the model, including anything I could still find out. Don\'t choose for me, and don\'t change the '
      + 'model or re-run anything yet.',
  };
}

function isPlainObject(value: unknown): boolean {
  return readRecord(value) !== null;
}

/**
 * The readback shows that the per-link test RAN, flagged nothing, and that the
 * refusal guards can be checked and pass. See the module header for what this
 * does and does not establish.
 */
function edgeSensitivityEvidenced(robustness: Record<string, unknown> | null): boolean {
  if (robustness === null) return false;
  const { fragile_edges: fragile, robust_edges: robust } = robustness;
  if (!Array.isArray(fragile) || fragile.length !== 0) return false;
  if (!Array.isArray(robust) || !robust.some(isPlainObject)) return false;
  // Guards: unobservable counts as failing (the confined first pass drops both).
  if (typeof robustness.display_verdict !== 'string' || robustness.display_verdict === 'not_assessed') return false;
  const errors = robustness.normalization_errors;
  if (errors !== undefined && !(Array.isArray(errors) && errors.length === 0)) return false;
  return true;
}

export type NoFlaggedLinkCardDecision =
  | { readonly block: CoachingBlock; readonly reason: null }
  | { readonly block: null; readonly reason: Exclude<RunTurnCoachingReason, 'no_run_this_turn'> };

/** Build the one no-flagged-link card, or say which gate refused it. Total. */
export function buildNoFlaggedLinkCard(input: FragileLinkChallengeInput): NoFlaggedLinkCardDecision {
  // (0) identity, repeated so the builder is total on its own.
  const result = readRecord(input.analysisResult);
  if (result === null || result.type !== 'analysis_result' || result.computed_against_hash !== input.graphHash) {
    return { block: null, reason: 'identity_mismatch' };
  }
  const enrichment = readRecord(result.enrichment);
  const robustness = readRecord(enrichment?.robustness);

  // (1) the fragile ARRAY decides, not the fragile card's collapsed reason: any
  // fragile row at all — groundable or not — means this card never appears.
  if (Array.isArray(robustness?.fragile_edges) && robustness.fragile_edges.length > 0) {
    return { block: null, reason: 'no_groundable_fragile_edge' };
  }

  // (2) the per-link test ran, flagged nothing, and its guards are observable and pass.
  if (!edgeSensitivityEvidenced(robustness)) return { block: null, reason: 'edge_sensitivity_not_evidenced' };

  // (3) may this surface claim about `robustness` at all? (the same cage as the fragile card)
  const factView = { result: { enrichment: enrichment ?? undefined } } as RunAnalysisHandlerFact;
  const claim = classifyClaimUsable(CLAIM_FIELD, {
    tier2Enabled: TIER2_ACTIVATION_ENABLED,
    companionStatusClaimSafe: deriveCompanionClaimSafe(factView, CLAIM_FIELD),
    freshness: input.freshness,
  });
  if (!claim.usable) return { block: null, reason: 'claim_not_usable' };

  // (4) the words: fixed per effective trigger, gated, bounded.
  const effectiveTrigger: RunTurnTrigger =
    input.trigger === 'auto_first_pass' || isAutomaticRun(enrichment) ? 'auto_first_pass' : 'explicit_run';
  const copy = composeNoFlaggedLinkCard(effectiveTrigger === 'auto_first_pass');
  if (!copyPasses(copy)) return { block: null, reason: 'copy_gate' };

  const signalId = `${NO_FLAGGED_LINK_SIGNAL_ID_PREFIX}${input.graphHash}:${input.computedAt}:${effectiveTrigger}`;
  const parsed = CoachingBlockSchema.safeParse({
    type: 'coaching',
    coaching_kind: RUN_TURN_COACHING_CONTRACT.block.coaching_kind,
    block_id: deterministicBlockId(signalId),
    signal_id: signalId,
    created_at: input.computedAt,
    source_handler: RUN_TURN_COACHING_CONTRACT.block.source_handler,
    graph_hash_at_generation: input.graphHash,
    freshness: 'fresh',
    source: RUN_TURN_COACHING_CONTRACT.block.source,
    target_refs: [],
    priority_rank: RUN_TURN_COACHING_CONTRACT.block.priority_rank,
    ...copy,
  });
  if (!parsed.success) return { block: null, reason: 'copy_gate' };
  return { block: parsed.data, reason: null };
}
