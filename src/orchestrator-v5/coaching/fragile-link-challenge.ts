/**
 * THE RUN-TURN FRAGILE-LINK CHALLENGE — contract `run-turn-coaching/v1`.
 *
 * DSK-P-003 (the disconfirmation / consider-the-opposite exercise) re-expressed
 * as ONE `type:'coaching'` block with ONE action, produced from the hash-bound
 * READBACK `analysis_result` of a run that completed in THIS turn — on the
 * automatic first pass and on explicit Runs alike, with or without a permitted
 * leader.
 *
 * ── WHAT IS REUSED, NOT RE-DERIVED ─────────────────────────────────────────
 *   · the relationship: `selectGroundedCounterCase` (grounded-counter-case.ts)
 *     — the same metric-selected fragile edge the DSK-P-003 exercise argues
 *     against. Its COMPOSED SENTENCE is deliberately NOT reused: it presumes
 *     "the option in front", and this card must read the same whether or not a
 *     leader may be named.
 *   · the prose gates: `passesGroundedProseGates` — the same imported gate
 *     objects `isComposable` uses (forbidden phrase, raw decimal, id leak).
 *   · the claim decision: `classifyClaimUsable('robustness', …)` — the cage's
 *     single fork, with the companion status from `deriveCompanionClaimSafe`.
 *   · the identity: `deterministicBlockId(signal_id)`.
 *   · the science badge: `resolveDskClaimProvenance` over DSK-P-003's OWN
 *     `linked_claim_id`, read from the verified bundle — no id typed here but
 *     the protocol's.
 *
 * ── LEADER-FREE BY CONSTRUCTION ────────────────────────────────────────────
 * The copy never names, ranks or implies a leading option, never reads
 * `switch_probability` into prose and never reads `alternative_winner_label`.
 * An endpoint label that IS (or contains) an option's label is refused: a card
 * that names an option would name one on a withheld turn.
 *
 * Pure apart from the memoised, integrity-checked DSK bundle read: no clock, no
 * LLM, no telemetry. The caller (the agent-lane pass-through) owns the
 * run-this-turn and identity gates and hands this module a bound readback.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';
import type { RunAnalysisHandlerFact } from '@talchain/schemas/orchestrator';

import type { DSKProtocol } from '../../dsk/types.js';
import { deterministicBlockId } from '../compose/block-id.js';
import { classifyClaimUsable, TIER2_ACTIVATION_ENABLED } from '../compose/claim-safety-cage.js';
import { loadVerifiedDskBundle } from '../compose/dsk-bundle-record.js';
import { resolveDskClaimProvenance, type DskClaimProvenance } from '../compose/dsk-claim-record.js';
import { deriveCompanionClaimSafe } from '../compose/phase3-blocks.js';
import type { AnalysisFreshness } from '../context/freshness.js';
import { AUTO_RUN_POST_DRAFT_INITIATOR, RUN_PROVENANCE_ENRICHMENT_KEY } from '../context/run-initiator.js';
import { passesGroundedProseGates, selectGroundedCounterCase } from './grounded-counter-case.js';

/** How the run that completed this turn was started. Closed. */
export const RUN_TURN_TRIGGERS = ['explicit_run', 'auto_first_pass'] as const;
export type RunTurnTrigger = (typeof RUN_TURN_TRIGGERS)[number];

/** Why no fragile-link card was produced. Closed; the order is the gate order. */
export const RUN_TURN_COACHING_REASONS = [
  'no_run_this_turn',
  'identity_mismatch',
  'no_groundable_fragile_edge',
  'claim_not_usable',
  'copy_gate',
] as const;
export type RunTurnCoachingReason = (typeof RUN_TURN_COACHING_REASONS)[number];

export type RunTurnCoachingEligibility =
  | { readonly eligible: true }
  | { readonly eligible: false; readonly reason: RunTurnCoachingReason };

export function isRunTurnTrigger(value: unknown): value is RunTurnTrigger {
  return typeof value === 'string' && (RUN_TURN_TRIGGERS as readonly string[]).includes(value);
}

const DSK_PROTOCOL_ID = 'DSK-P-003';
const SIGNAL_ID_PREFIX = 'coach:fragile_link:';
/** The enrichment field this card claims about — the cage decides on it. */
const CLAIM_FIELD = 'robustness';

/**
 * The contract, as data. `limits` restate the boundary schema's own bounds
 * (`PHASE3_TITLE_MAX` / `PHASE3_BODY_MAX` / `PHASE3_ACTION_LABEL_MAX` /
 * `PHASE3_ACTION_PROMPT_MAX`, not exported by `@talchain/schemas`); the final
 * `CoachingBlockSchema.safeParse` enforces them again, so a drift REFUSES the
 * card rather than shipping an over-long one.
 */
export const RUN_TURN_COACHING_CONTRACT = Object.freeze({
  version: 'run-turn-coaching/v1',
  block: Object.freeze({
    type: 'coaching',
    coaching_kind: 'bias_signal',
    source: 'deterministic_signal',
    source_handler: 'run_analysis',
    freshness: 'fresh',
    priority_rank: 15,
    signal_id: `${SIGNAL_ID_PREFIX}<edgeIdentity>:<graph_hash>:<run computed_at>`,
    block_id: 'deterministicBlockId(signal_id)',
    graph_hash_at_generation: 'readback graph_hash === analysis_result.computed_against_hash',
    created_at: 'analysis_state.run_state.computed_at',
    target_refs: "[{ kind: 'edge', id: edgeIdentity, label: 'From → To' }]",
    dsk_protocol_id: DSK_PROTOCOL_ID,
    action_intent: 'absent',
  }),
  triggers: RUN_TURN_TRIGGERS,
  reasons: RUN_TURN_COACHING_REASONS,
  claim_field: CLAIM_FIELD,
  limits: Object.freeze({ title_max: 80, body_max: 300, action_label_max: 40, action_prompt_max: 300 }),
});

/** Leader language this card must never carry, whatever a label contains. */
const LEADER_LANGUAGE_RE = /option in front|winner|recommend|best option|leading option/i;

const FIRST_PASS_PREFIX = 'Before relying on this first pass on Olumi\'s estimates, note that ';

export interface FragileLinkChallengeCopy {
  readonly title: string;
  readonly body: string;
  readonly action_label: string;
  readonly action_prompt: string;
}

/**
 * The card's words. ONE definition, so the strings the gates see are the
 * strings that ship.
 */
export function composeFragileLinkChallenge(
  fromLabel: string,
  toLabel: string,
  firstPass: boolean,
): FragileLinkChallengeCopy {
  const finding =
    `the robustness check flagged the link from ${fromLabel} to ${toLabel} as fragile — ` +
    `a modest change in how strongly ${fromLabel} drives ${toLabel} could change how the options compare.`;
  return {
    title: 'Pressure-test a fragile link',
    body: firstPass ? `${FIRST_PASS_PREFIX}${finding}` : `T${finding.slice(1)}`,
    action_label: 'Pressure-test this link',
    action_prompt:
      `Talk me through what would change if the link from ${fromLabel} to ${toLabel} were weaker or stronger. ` +
      'Don\'t change the model or re-run anything yet.',
  };
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The run's option labels, as the readback states them (`win_probabilities` keys). */
function optionLabelsOf(result: Record<string, unknown>): string[] {
  const wins = readRecord(result.win_probabilities);
  return wins === null ? [] : Object.keys(wins).filter((l) => l.trim().length > 0);
}

function namesAnOption(label: string, optionLabels: readonly string[]): boolean {
  return optionLabels.some((option) =>
    new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(option.trim())}(?![\\p{L}\\p{N}])`, 'iu').test(label),
  );
}

function isAutomaticRun(enrichment: Record<string, unknown> | null): boolean {
  const provenance = readRecord(enrichment?.[RUN_PROVENANCE_ENRICHMENT_KEY]);
  return provenance?.initiated_by === AUTO_RUN_POST_DRAFT_INITIATOR;
}

function copyPasses(copy: FragileLinkChallengeCopy): boolean {
  const { limits } = RUN_TURN_COACHING_CONTRACT;
  if (copy.title.length > limits.title_max || copy.body.length > limits.body_max) return false;
  if (copy.action_label.length > limits.action_label_max || copy.action_prompt.length > limits.action_prompt_max) return false;
  return [copy.title, copy.body, copy.action_label, copy.action_prompt].every(
    (text) => passesGroundedProseGates(text) && !LEADER_LANGUAGE_RE.test(text),
  );
}

/**
 * DSK-P-003's claim badge: the protocol's OWN `linked_claim_id`, resolved from
 * the verified bundle, and kept only when the bundle links that claim back to
 * this protocol. Anything else withholds the badge, never the card.
 */
function resolveFragileLinkDskProvenance(): DskClaimProvenance | null {
  const protocol = loadVerifiedDskBundle()?.objects.find(
    (o) => o.id === DSK_PROTOCOL_ID && o.type === 'protocol' && !o.deprecated,
  ) as DSKProtocol | undefined;
  const claimId = protocol?.linked_claim_id;
  if (typeof claimId !== 'string' || claimId.length === 0) return null;
  const provenance = resolveDskClaimProvenance(claimId);
  return provenance?.protocol_id === DSK_PROTOCOL_ID ? provenance : null;
}

export interface FragileLinkChallengeInput {
  /** The READBACK `analysis_result` block, already bound to this turn's run by the caller. */
  readonly analysisResult: unknown;
  /** The readback `graph_hash`; must equal `analysisResult.computed_against_hash`. */
  readonly graphHash: string;
  /** The run's `analysis_state.run_state.computed_at`. */
  readonly computedAt: string;
  readonly trigger: RunTurnTrigger;
  /**
   * The canonical freshness verdict for this readback. At the agent-lane seam
   * there is no fact list to derive it from, so the caller states it from
   * `run_state.kind === 'complete_current'` (⇔ `freshness === 'fresh'`,
   * `compose/analysis-state-v1.ts`) plus the hash binding; anything else is null.
   */
  readonly freshness: AnalysisFreshness | null;
}

export type FragileLinkChallengeDecision =
  | { readonly block: CoachingBlock; readonly reason: null }
  | { readonly block: null; readonly reason: Exclude<RunTurnCoachingReason, 'no_run_this_turn'> };

/** Build the one fragile-link card, or say which gate refused it. Total. */
export function buildFragileLinkChallenge(input: FragileLinkChallengeInput): FragileLinkChallengeDecision {
  const result = readRecord(input.analysisResult);
  if (result === null || result.type !== 'analysis_result' || result.computed_against_hash !== input.graphHash) {
    return { block: null, reason: 'identity_mismatch' };
  }
  const enrichment = readRecord(result.enrichment);

  // (3) one metric-selected fragile edge, with both endpoint labels.
  const decision = selectGroundedCounterCase(enrichment);
  if (decision.grounded === null) {
    // `not_composable` is a prose-gate hit on the labels; every other refusal
    // is the absence of a nameable relationship.
    return {
      block: null,
      reason: decision.refusalReason === 'not_composable' ? 'copy_gate' : 'no_groundable_fragile_edge',
    };
  }
  const { edgeIdentity, fromLabel, toLabel } = decision.grounded;

  // (4) may this surface claim about `robustness` at all?
  // `deriveCompanionClaimSafe` reads ONLY `fact.result.enrichment`
  // (compose/phase3-blocks.ts); the readback block's enrichment is that
  // record after the transport keep-list.
  const factView = { result: { enrichment: enrichment ?? undefined } } as RunAnalysisHandlerFact;
  const claim = classifyClaimUsable(CLAIM_FIELD, {
    tier2Enabled: TIER2_ACTIVATION_ENABLED,
    companionStatusClaimSafe: deriveCompanionClaimSafe(factView, CLAIM_FIELD),
    freshness: input.freshness,
  });
  if (!claim.usable) return { block: null, reason: 'claim_not_usable' };

  // (5) the words: leader-free, option-free, gated, bounded.
  if (namesAnOption(fromLabel, optionLabelsOf(result)) || namesAnOption(toLabel, optionLabelsOf(result))) {
    return { block: null, reason: 'copy_gate' };
  }
  const copy = composeFragileLinkChallenge(
    fromLabel,
    toLabel,
    input.trigger === 'auto_first_pass' || isAutomaticRun(enrichment),
  );
  if (!copyPasses(copy)) return { block: null, reason: 'copy_gate' };

  const signalId = `${SIGNAL_ID_PREFIX}${edgeIdentity}:${input.graphHash}:${input.computedAt}`;
  const dsk = resolveFragileLinkDskProvenance();
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
    target_refs: [{ id: edgeIdentity, kind: 'edge', label: `${fromLabel} → ${toLabel}` }],
    priority_rank: RUN_TURN_COACHING_CONTRACT.block.priority_rank,
    ...copy,
    ...(dsk !== null ? { dsk_claim_provenance: dsk } : {}),
  });
  if (!parsed.success) return { block: null, reason: 'copy_gate' };
  return { block: parsed.data, reason: null };
}
