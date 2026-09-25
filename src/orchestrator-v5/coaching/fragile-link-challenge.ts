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
 *     the protocol's. The badge is kept ONLY on an explicit Run whose readback
 *     positively shows the protocol's required input, a clear winner — never on
 *     a close call, which P-003 and T-003 both contraindicate
 *     (`runShowsClearWinnerForP003`). The card itself never depends on it.
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
    coaching_kind: 'assumption_check',
    source: 'deterministic_signal',
    source_handler: 'run_analysis',
    freshness: 'fresh',
    priority_rank: 15,
    signal_id: `${SIGNAL_ID_PREFIX}<edgeIdentity>:<graph_hash>:<run computed_at>:<effective trigger>`,
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
 * The body's wordings, preferred first. The contract's sentence names both
 * endpoints twice; when that does not fit `body_max` (the first-pass prefix
 * pushes ordinary served labels past it: 9 of 49 groundable runs in the
 * 24 Sep served sample), the
 * second clause says "this link" instead of repeating the labels. That short
 * form fits every label pair `selectGroundedCounterCase` admits (its own
 * 400-char sentence bound caps the two labels at 87 characters together), so
 * a length refusal can only come from a bound this module does not own.
 *
 * ⛔ WHAT THE WORDS MAY CLAIM. A `fragile_edges` row means the OUTCOME is
 * sensitive to the link (ISL: elasticity above `FRAGILE_THRESHOLD = 0.1`).
 * Whether the ranking flips is a separate measurement (`is_robust`,
 * `switch_probability`) this card never reads, and ISL states "robust but
 * sensitive to …" runs outright. So no wording says the options could swap,
 * nor sizes the change that would do it: on a decisive run whose perturbations
 * never switched the winner, that sentence would be false (#1855 review).
 */
export function fragileLinkBodyForms(fromLabel: string, toLabel: string, firstPass: boolean): readonly string[] {
  const flagged = `the robustness check found the result sensitive to the link from ${fromLabel} to ${toLabel} — `;
  const findings = [
    `${flagged}worth checking what the estimate of how strongly ${fromLabel} drives ${toLabel} rests on.`,
    `${flagged}worth checking what this link's estimated strength rests on.`,
  ];
  return findings.map((finding) => (firstPass ? `${FIRST_PASS_PREFIX}${finding}` : `T${finding.slice(1)}`));
}

/**
 * The card's words. ONE definition, so the strings the gates see are the
 * strings that ship. The body is the first form within `body_max`; when none
 * fits, the last is returned and the copy gate refuses it.
 */
export function composeFragileLinkChallenge(
  fromLabel: string,
  toLabel: string,
  firstPass: boolean,
): FragileLinkChallengeCopy {
  const forms = fragileLinkBodyForms(fromLabel, toLabel, firstPass);
  const body = forms.find((form) => form.length <= RUN_TURN_COACHING_CONTRACT.limits.body_max) ?? forms[forms.length - 1]!;
  return {
    title: 'Pressure-test a sensitive link',
    body,
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

/**
 * The run's option labels: the readback's `win_probabilities` keys, PLUS the
 * labels the caller supplies (the run's `analysis_ready.options`). The second
 * source matters on an automatic run, whose confinement drops
 * `win_probabilities` — without it the option-name guard would see nothing.
 */
function optionLabelsOf(result: Record<string, unknown>, supplied: readonly string[] = []): string[] {
  const wins = readRecord(result.win_probabilities);
  const fromWins = wins === null ? [] : Object.keys(wins);
  return [...fromWins, ...supplied].filter((l) => typeof l === 'string' && l.trim().length > 0);
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
 * PLoT's "clearly ahead" leader gap (`CLEARLY_AHEAD_GAP_THRESHOLD`,
 * plot-lite-service src/assembly/decision-brief.ts @6d143fb1): the smallest
 * top-two win-probability gap PLoT itself will call a clear lead.
 */
export const DSK_P003_MIN_LEADER_GAP = 0.25;
/** TR-003's robustness clause: "robustness = 'robust' or 'moderate'" (data/dsk/v1.json). */
const DSK_P003_ROBUSTNESS_VERDICTS: readonly string[] = Object.freeze(['robust', 'moderate']);

/**
 * Does THIS readback positively show what DSK-P-003 needs — "analysis results
 * showing a clear winner with high win probability" (its required input), and
 * not "a close call" (its first contraindication, and T-003's)? TR-003 is the
 * bundle's observable form: "win probability >70% AND robustness = 'robust' or
 * 'moderate'", never on "a close call (separation <10%)".
 *
 * Every conjunct must be SHOWN; an absent or malformed member fails it:
 *   · an explicit Run — the first pass confines win probabilities, is_robust,
 *     the verdict and the runner-up away, and always withholds the leader;
 *   · `near_tie.is_tie === false` — PLoT's is_tie is top-two gap < 0.10
 *     (`computeNearTie`, `NEAR_TIE_THRESHOLD`, src/trust/result-coherence.ts).
 *     Reading it as TR-003's "separation <10%" is an INTERPRETATION: the bundle
 *     never defines "separation";
 *   · a real comparison — a named runner-up and a gap that is not PLoT's
 *     single-option sentinel (`is_tie:false, gap:1.0`, "No comparison possible");
 *   · `near_tie.gap >= DSK_P003_MIN_LEADER_GAP`;
 *   · `is_robust === true` — ISL: recommendation_stability >= 0.7, the leader's
 *     win share (TR-003 says ">70%"; the 0.7 boundary itself is included);
 *   · `display_verdict` 'robust' or 'moderate' (TR-003's robustness clause);
 *   · a named leader (`leading_option_id`).
 * TR-003's other conditions (no pre-mortem or devil's advocate this stage;
 * once per stage per decision) need conversation state this pure builder does
 * not have, and are left to the science owner.
 */
function runShowsClearWinnerForP003(
  result: Record<string, unknown>,
  robustness: Record<string, unknown> | null,
  trigger: RunTurnTrigger,
): boolean {
  if (trigger !== 'explicit_run') return false;
  const nearTie = readRecord(robustness?.near_tie);
  if (nearTie === null) return false;
  if (nearTie.is_tie !== false) return false;
  if (typeof nearTie.second_option_id !== 'string' || nearTie.second_option_id.length === 0) return false;
  const gap = nearTie.gap;
  if (typeof gap !== 'number' || !Number.isFinite(gap)) return false;
  if (gap === 1) return false;
  if (gap < DSK_P003_MIN_LEADER_GAP) return false;
  if (robustness?.is_robust !== true) return false;
  if (typeof robustness.display_verdict !== 'string' || !DSK_P003_ROBUSTNESS_VERDICTS.includes(robustness.display_verdict)) return false;
  if (typeof result.leading_option_id !== 'string' || result.leading_option_id.length === 0) return false;
  return true;
}

/**
 * DSK-P-003's claim badge: the protocol's OWN `linked_claim_id`, resolved from
 * the verified bundle, and kept only when the bundle links that claim back to
 * this protocol AND the run positively shows a clear winner
 * ({@link runShowsClearWinnerForP003}). Anything else withholds the badge,
 * never the card.
 */
function resolveFragileLinkDskProvenance(
  result: Record<string, unknown>,
  robustness: Record<string, unknown> | null,
  trigger: RunTurnTrigger,
): DskClaimProvenance | null {
  if (!runShowsClearWinnerForP003(result, robustness, trigger)) return null;
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
  /** The run's option labels from `analysis_ready.options` (see `optionLabelsOf`). */
  readonly optionLabels?: readonly string[];
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
  const optionLabels = optionLabelsOf(result, input.optionLabels);
  if (namesAnOption(fromLabel, optionLabels) || namesAnOption(toLabel, optionLabels)) {
    return { block: null, reason: 'copy_gate' };
  }
  // The copy variant actually shipped. It is part of the identity: one
  // block_id must never name two different bodies.
  const effectiveTrigger: RunTurnTrigger =
    input.trigger === 'auto_first_pass' || isAutomaticRun(enrichment) ? 'auto_first_pass' : 'explicit_run';
  const copy = composeFragileLinkChallenge(fromLabel, toLabel, effectiveTrigger === 'auto_first_pass');
  if (!copyPasses(copy)) return { block: null, reason: 'copy_gate' };

  const signalId = `${SIGNAL_ID_PREFIX}${edgeIdentity}:${input.graphHash}:${input.computedAt}:${effectiveTrigger}`;
  // The badge reads the run's own close-call and clear-winner facts. It never
  // changes the identity: near_tie and the verdict are fixed for one
  // (graph_hash, computed_at) run, so one block_id still names one card.
  const dsk = resolveFragileLinkDskProvenance(result, readRecord(enrichment?.robustness), effectiveTrigger);
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
