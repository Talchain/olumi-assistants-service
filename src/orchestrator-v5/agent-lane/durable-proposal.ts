/**
 * ⛔ A PENDING APPROVAL SURVIVES A RESTART.
 *
 * Root cause of Paul's failing test (24 Sep 09:39–09:53Z, scenario `d41e2c21`, #63 5811981438): the
 * Agent lane held proposals only in process memory (`agent-v1-turn.ts` `new ProposalStore()`), every
 * staging merge redeploys the one instance, and three redeploys landed inside his session. His "yes"
 * reached a fresh process, `authorise` returned `unknown_proposal`, nothing was saved, and the model
 * stayed unanalysable.
 *
 * The exact stored proposal now travels with the answer row that offered it, on the carrier the product
 * already persists atomically with that row (`pending_actions`, no schema change): an
 * `apply_proposed_change` pending action whose `proposal_ref` is the approve chip's id and whose
 * `inline_patch` carries the proposal.
 *
 * ⚠ WHO ELSE READS THIS CARRIER. An earlier version of this note said that, having no `handler_id`, the
 * carrier made the conventional short-confirm resumer "fall through". That was FALSE. The resumer PREFERS
 * a live `apply_proposed_change` (F-HELD consent priority, `deterministic-short-confirm.ts` ~:653-656),
 * and `decideProposedChangeSynthesis` then refuses it — `superseded` if the conventional graph hash
 * differs from `preconditions.graph_hash`, otherwise `invalid` / `unknown_handler_id`
 * (`proposed-change-synthesis.ts` ~:506-507) — so TurnExecutor answers with a recovery ("The offer I had
 * open is no longer valid. …") and writes nothing.
 *   · What keeps the Agent lane's OWN traffic away from that resumer is where its internal dispatches go,
 *     not the carrier's shape: every Agent write is a `system_event`, which returns at `route-v2.ts`
 *     ~:3405→3558, and the Agent's Run is a deterministic `run_analysis` chip click, dispatched at ~:3612.
 *     Both return before `runTurnExecutor`, so neither ever reaches short-confirm.
 *   · ⚠ THE ONE KNOWN LIMIT: a human "yes" sent on the CONVENTIONAL route in the same scenario while a
 *     carrier is live — the Agent lane's `?ai=openai` lost on a navigation — reaches short-confirm and is
 *     answered "The offer I had open is no longer valid." Nothing is written, and the Agent lane can still
 *     apply the proposal. The longer carrier lifetime below keeps that window open for longer.
 *
 * A fresh process rehydrates a proposal only when it still HASHES TO ITS ID (the store's own integrity
 * rule — a stored copy that was altered is refused), belongs to THIS scenario and subject, and has not
 * expired. Everything after that is unchanged: `authorise` still refuses a model that moved since
 * (`superseded`), and the writes still use deterministic turn ids, so a re-applied approval replays.
 */
import { randomUUID } from 'node:crypto';

import {
  PENDING_ACTION_ASK_TURN_TTL,
  PENDING_ACTION_ASK_WALL_TTL_MS,
  type PendingAction,
} from '../session/pending-action.js';
import { log } from '../../utils/telemetry.js';
import { approvalChipIdFor } from './approval-chips.js';
import { computeProposalId, type ProposalStore, type StructuredProposal } from './proposal.js';

/**
 * ⭐ THE CARRIER LIVES FOR 12 TURNS / 30 MINUTES — the recorded-ask bounds, NOT the 2 turns / 10 minutes
 * an ordinary offer gets.
 *
 * Why the default was wrong here: those bounds exist so a stale OFFER cannot hijack a later bare "yes"
 * (`pending-action.ts`, the two-dial note). This carrier is not resolved by a bare "yes" on its own lane:
 * the Agent approves only by the typed chip id or an `authorise_change` naming the proposal, and
 * `ProposalStore.authorise` re-checks subject, integrity, applied-ness and the base revision at that
 * moment. What the carrier bounds is how long a RESTART may keep what a live process would still hold —
 * and the in-process store keeps a proposal with no clock at all. Ten minutes lost the approval of a user
 * who read the proposal, asked about it and came back.
 *
 * ⚠ STAMPED HERE, AT EMISSION, ON THE CARRIER ITSELF. `apply_proposed_change` is NOT made a recorded ask
 * in the shared `PENDING_KIND_IS_RECORDED_ASK` map: that would widen every conventional
 * `apply_proposed_change` offer too, and a bare "yes" DOES resolve those. The shared machinery respects a
 * stamped carrier as it stands — `parsePendingAction` accepts any finite count and any ISO expiry;
 * `withRecordedAskLifetime` and `clampRecordedAskWindow` act only on recorded-ask kinds, so both return
 * this carrier by identity; `commit.ts` carry-forward decrements its count by one per conventional commit
 * and keeps its wall expiry. Pinned by `proposal-survives-a-restart.test.ts`.
 */
export const AGENT_PROPOSAL_CARRIER_TURN_TTL = PENDING_ACTION_ASK_TURN_TTL;
export const AGENT_PROPOSAL_CARRIER_WALL_TTL_MS = PENDING_ACTION_ASK_WALL_TTL_MS;

type ApproveChip = { readonly id: string; readonly label: string; readonly message: string };

/**
 * ⛔ WHETHER THE ANSWER THIS ROW RECORDS SHOWED THE APPROVE CHIP. A carrier rides a row for two reasons: the
 * turn OFFERED the chip (a proposal, or a Run that kept it), or the turn only CARRIED it forward so a restart
 * can still find it (a plain question, whose answer showed no chip). A replay re-offers only what the original
 * answer offered (#1792's rule for the Run offer), so it needs to tell the two apart — see
 * {@link offeredApproveChipOnRow}.
 */
const OFFERED_ON_THIS_ROW = 'offered_on_this_row';

/** The pending action that carries one offered proposal with its answer row. */
export function proposalPendingAction(
  proposal: StructuredProposal,
  chip: ApproveChip,
  ctx: { readonly scenario_id: string; readonly emitted_at_iso: string },
  offeredOnThisRow = true,
): PendingAction {
  const emitted = Date.parse(ctx.emitted_at_iso);
  return {
    id: randomUUID(),
    scenario_id: ctx.scenario_id,
    chip_id: chip.id,
    action: {
      kind: 'apply_proposed_change',
      proposal_ref: chip.id,
      inline_patch: {
        agent_proposal: JSON.parse(JSON.stringify(proposal)) as Record<string, unknown>,
        ...(offeredOnThisRow ? { [OFFERED_ON_THIS_ROW]: true } : {}),
      },
      public_label: chip.label,
      public_message: chip.message,
    },
    // REQUIRED by the production read: `parsePendingAction` drops an `apply_proposed_change` without a
    // non-empty `preconditions.graph_hash` (Codex #1823 5812296935). It is the proposal's own base revision,
    // so the carrier also states the freshness it was offered against.
    preconditions: { graph_hash: proposal.base_graph_identity_hash },
    expires_at_turn_count: AGENT_PROPOSAL_CARRIER_TURN_TTL,
    expires_at_iso: new Date((Number.isFinite(emitted) ? emitted : Date.now()) + AGENT_PROPOSAL_CARRIER_WALL_TTL_MS).toISOString(),
    emitted_at_iso: ctx.emitted_at_iso,
  };
}

/**
 * The carrier this process last put on an answer row for one scenario and subject: which proposal, the
 * chip that offered it (so a carried copy says exactly what the offer said), and when that copy lapses.
 */
export interface LiveCarrier {
  readonly proposal_id: string;
  readonly chip: ApproveChip;
  readonly expires_at_ms: number;
}

/** The {@link LiveCarrier} a persisted pending action describes, when it is one of ours. */
function liveCarrierOf(pa: PendingAction, proposalId: string): LiveCarrier | undefined {
  if (pa.action.kind !== 'apply_proposed_change') return undefined;
  const expires = Date.parse(pa.expires_at_iso);
  if (!Number.isFinite(expires)) return undefined;
  const { public_label: label, public_message: message } = pa.action as { public_label?: unknown; public_message?: unknown };
  if (typeof label !== 'string' || typeof message !== 'string') return undefined;
  return { proposal_id: proposalId, chip: { id: pa.chip_id, label, message }, expires_at_ms: expires };
}

/**
 * Put back every persisted proposal this process no longer holds — when, and only when, it still hashes
 * to its id, belongs to this scenario and subject, and has not expired. Returns how many were restored.
 * `onRestored` receives the carrier of each one restored, so the caller can keep carrying it forward.
 */
export function rehydrateProposals(
  pending: readonly unknown[],
  store: ProposalStore,
  subject: { readonly scenario_id: string; readonly user_id: string | null },
  nowMs: number = Date.now(),
  onRestored?: (carrier: LiveCarrier) => void,
): number {
  let restored = 0;
  for (const raw of pending) {
    const pa = raw as { scenario_id?: unknown; expires_at_iso?: unknown; action?: { kind?: unknown; inline_patch?: { agent_proposal?: unknown } } };
    if (pa?.action?.kind !== 'apply_proposed_change') continue;
    if (pa.scenario_id !== subject.scenario_id) continue;
    const expires = typeof pa.expires_at_iso === 'string' ? Date.parse(pa.expires_at_iso) : Number.NaN;
    if (!Number.isFinite(expires) || expires <= nowMs) continue;
    const p = pa.action.inline_patch?.agent_proposal as StructuredProposal | undefined;
    if (p === undefined || p === null || typeof p !== 'object' || typeof p.proposal_id !== 'string') continue;
    if (p.scenario_id !== subject.scenario_id || p.user_id !== subject.user_id) continue;
    const { proposal_id: _id, ...content } = p;
    if (computeProposalId(content) !== p.proposal_id) {
      // Never silent again: a silent skip here is what hid the JSONB key-order loss (#69 5833864687).
      log.warn({ proposal_id: p.proposal_id, scenario_id: subject.scenario_id }, 'agent-lane: a persisted proposal does not match its content — not restored');
      continue;
    }
    if (store.get(p.proposal_id) !== undefined) continue;
    store.put(p);
    restored += 1;
    const carrier = liveCarrierOf(raw as PendingAction, p.proposal_id);
    if (carrier !== undefined) onRestored?.(carrier);
  }
  return restored;
}

/**
 * ⭐ THE CARRIER RIDES EVERY ANSWER ROW WHILE ITS PROPOSAL IS STILL OUTSTANDING.
 *
 * A restart reads only the LATEST answer row (`readMostRecentPendingActions`). The carrier used to ride
 * only the row that offered the approve chip, so one intervening question — "what would that change?" —
 * wrote a row without it, and a restart after that lost the approval exactly as before this fix.
 *
 * So the row a turn writes carries, in order of preference:
 *   1. the proposal THIS turn offers an approve chip for (a newer offer supersedes the older carrier —
 *      the durable slot holds the offer the user is looking at, as the chip does); else
 *   2. the carrier this process last persisted for this scenario and subject, re-stamped with a fresh
 *      lifetime — ONLY while that carrier has not lapsed and `ProposalStore.authorise` would EXECUTE the
 *      proposal, from its own base, on the revision read back THIS turn. That one call is the authority
 *      for "still outstanding": applied → `already_applied`; model moved → `superseded`; evicted →
 *      `unknown_proposal`; another subject → `not_authorised`; altered → `integrity_failed`. A partly
 *      applied proposal (`continuation`) is not carried: its progress lives in this process only, so a
 *      restarted one would refuse it as `superseded` anyway. An unknown revision carries nothing.
 *
 * Returns the carrier to persist, or `undefined`. The caller keeps the result as the new
 * {@link LiveCarrier} (or forgets it), so a carrier dropped once is never resurrected — not even if an
 * undo later returns the model to the proposal's base.
 */
export function carrierForAnswerRow(input: {
  readonly offered: { readonly proposal: StructuredProposal; readonly chip: ApproveChip } | undefined;
  readonly carried: LiveCarrier | undefined;
  readonly store: ProposalStore;
  readonly subject: { readonly scenario_id: string; readonly user_id: string | null };
  readonly currentGraphHash: string | undefined;
  readonly emittedAtIso: string;
}): PendingAction | undefined {
  const ctx = { scenario_id: input.subject.scenario_id, emitted_at_iso: input.emittedAtIso };
  if (input.offered !== undefined) return proposalPendingAction(input.offered.proposal, input.offered.chip, ctx);
  const carried = input.carried;
  if (carried === undefined) return undefined;
  const nowMs = Date.parse(input.emittedAtIso);
  if (!Number.isFinite(nowMs) || nowMs >= carried.expires_at_ms) return undefined;
  if (input.currentGraphHash === undefined) return undefined;
  const decision = input.store.authorise({
    proposal_id: carried.proposal_id,
    scenario_id: input.subject.scenario_id,
    authenticated_user_id: input.subject.user_id,
    current_graph_identity_hash: input.currentGraphHash,
  });
  if (decision.status !== 'execute' || decision.continuation !== undefined) return undefined;
  // Carried, not offered: this turn's answer showed no approve chip, so a replay of it shows none either.
  return proposalPendingAction(decision.proposal, carried.chip, ctx, false);
}

/**
 * ⛔ THE APPROVE CHIP A REPLAY RE-OFFERS, READ FROM THE REPLAYED ROW ITSELF (Codex #1823 5819308426).
 *
 * A proposing answer lost in transit is retried with the same `turn_id`, and the retry can reach a restarted
 * process. The replay re-offered the approve chip only from the process-local `offeredActions`, so it showed
 * the proposal's words with no way to approve them — although the row it replays had persisted the exact
 * chip beside the proposal.
 *
 * This returns only the chip's WORDS — its id, label and message exactly as the original answer offered
 * them — and only when THAT answer offered it (a carried-forward carrier returns nothing). Whether it is
 * still offered is not decided here: the caller applies the same predicate as every replay, which admits
 * it only while its proposal is the one awaiting a yes for this subject and the store would execute it on
 * today's revision. The store is refilled from the latest answer row BEFORE the replay, so a proposal
 * applied, superseded or dropped since is never re-offered.
 */
export function offeredApproveChipOnRow(
  pending: readonly PendingAction[] | undefined,
  subject: { readonly scenario_id: string; readonly user_id: string | null },
): ApproveChip | undefined {
  for (const pa of pending ?? []) {
    if (pa.action.kind !== 'apply_proposed_change' || pa.scenario_id !== subject.scenario_id) continue;
    const patch = pa.action.inline_patch as { agent_proposal?: { proposal_id?: unknown; scenario_id?: unknown; user_id?: unknown } } & Record<string, unknown>;
    if (patch[OFFERED_ON_THIS_ROW] !== true) continue;
    const p = patch.agent_proposal;
    if (typeof p?.proposal_id !== 'string' || p.scenario_id !== subject.scenario_id || p.user_id !== subject.user_id) continue;
    if (pa.chip_id !== approvalChipIdFor(p.proposal_id)) continue;
    const { public_label: label, public_message: message } = pa.action as { public_label?: unknown; public_message?: unknown };
    if (typeof label !== 'string' || typeof message !== 'string') continue;
    return { id: pa.chip_id, label, message };
  }
  return undefined;
}

/**
 * The carrier this process last persisted per scenario and subject — a per-process cache, bounded like the
 * route's other offer caches. After a restart it is refilled by {@link rehydrateProposals}.
 */
export class CarriedProposals {
  private readonly slots = new Map<string, LiveCarrier>();

  constructor(private readonly max: number = 500) {}

  get(key: string): LiveCarrier | undefined {
    return this.slots.get(key);
  }

  /** Record what the answer row just persisted: its carrier, or none (which forgets the slot). */
  persisted(key: string, carrier: PendingAction | undefined): void {
    this.slots.delete(key);
    if (carrier === undefined) return;
    const proposal = (carrier.action as { inline_patch?: { agent_proposal?: { proposal_id?: unknown } } }).inline_patch?.agent_proposal;
    const live = typeof proposal?.proposal_id === 'string' ? liveCarrierOf(carrier, proposal.proposal_id) : undefined;
    if (live === undefined) return;
    this.remember(key, live);
  }

  remember(key: string, carrier: LiveCarrier): void {
    this.slots.delete(key);
    if (this.slots.size >= this.max) {
      const oldest = this.slots.keys().next().value;
      if (oldest !== undefined) this.slots.delete(oldest);
    }
    this.slots.set(key, carrier);
  }
}
