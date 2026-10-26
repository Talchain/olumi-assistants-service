/**
 * ⭐ A MODEL PROGRAM'S CARD HOLDS WHILE ITS OWN REVISION DOES (inventory F6, part a). A program card is made on one revision of the
 * model: its canonical model and the person's words, the digest a Run receipt carries (`revisionDigest`). It still applies
 * exactly while the saved program's digest is that one, and at no other time:
 *  · not on the analysis hash of the display projection, which misses moves in labels, quotes, approval and the person's
 *    words: the card was served as approvable there, and its press refused `superseded`;
 *  · not on the full graph identity, which moves with a Run stored on an unchanged model (an engine update): the card was
 *    served as approvable, and its press refused `superseded` although nothing of the person's had moved.
 * A card held before this digest was recorded carries none, and keeps the rule it was made under (`undefined` below).
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { PendingAction } from '../session/pending-action.js';
import type { SuggestedAction } from '../compose/types.js';
import type { StructuredProposal } from '../agent-lane/proposal.js';
import type { ToolResult } from '../agent-lane/runtime/agent-tools.js';
import { revisionDigest, type StoredRun } from './run-receipt.js';
import { livingModelOf, savedProgramOf, type SavedProgram } from './program-store.js';

/** The program's own revision: the digest of its canonical model and the person's words, as the store reads it back. */
export function programDigestOf(program: SavedProgram): string {
  // Read back through the store's own reader, so a card held from a program built in memory and one checked against the
  // saved program agree after any format migration on read.
  const read = savedProgramOf({ living_model: livingModelOf(program) }) ?? program;
  return revisionDigest(read.canonical, read.person_words);
}

/**
 * A saved model program's revision, read off its saved graph: the digest its Run receipts bind (`receipt.revision_digest`), and the
 * `graph_hash` every read and save of a program serves (DL ruling 26 Oct, inventory F7). Undefined when the graph holds no readable
 * program: its readers keep the graph's own hash.
 */
export function programRevisionOf(graph: unknown): string | undefined {
  const program = savedProgramOf(graph);
  return program === undefined ? undefined : programDigestOf(program);
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Whether a held card applies to the saved `graph`, by its program's revision: `undefined` when it is not a program card that
 * carries its base digest (the caller's own rule decides), otherwise whether the saved program's digest is still that base.
 */
export function programCardApplies(proposal: unknown, graph: unknown): boolean | undefined {
  if (!isRec(proposal) || typeof proposal['base_revision_digest'] !== 'string') return undefined;
  if (savedProgramOf({ living_model: proposal['living_model'] }) === undefined) return undefined;
  const saved = savedProgramOf(graph);
  return saved !== undefined && programDigestOf(saved) === proposal['base_revision_digest'];
}

/** `head` is where `runs` began: every Run saved now is one the card's program also carries, in order. */
export function runsExtend(runs: readonly StoredRun[], head: readonly StoredRun[], same: (a: StoredRun, b: StoredRun) => boolean): boolean {
  return head.length <= runs.length && head.every((r, i) => same(r, runs[i]!));
}

const heldProposalOf = (pa: PendingAction): unknown =>
  pa.action.kind === 'apply_proposed_change' ? (pa.action.inline_patch as Rec | undefined)?.['agent_proposal'] : undefined;

/**
 * ⭐ NO SILENT LAPSE (DL-3 18 Oct, PR-2): a held card whose own subject moved is KEPT, marked for review, never dropped. A card
 * under review is never executable (its press is refused by its own base) and never bound by typed words. Its pin and digest
 * are unchanged. The ONE definition of the persisted marker (the legacy seams re-export it from `still-applies.ts`).
 */
const AWAITING_REVIEW = 'awaiting_review';
export function heldCardUnderReview(pa: PendingAction): boolean {
  return pa.action.kind === 'apply_proposed_change' && isRec((pa.action.inline_patch as Rec | undefined)?.[AWAITING_REVIEW]);
}
/** Whether the carrier of `proposalId` among these pendings is kept for review: its approve is never offered (any read). */
export function heldCardUnderReviewIn(pendings: readonly PendingAction[], proposalId: string): boolean {
  return pendings.some((pa) => heldCardUnderReview(pa) && (heldProposalOf(pa) as Rec | undefined)?.['proposal_id'] === proposalId);
}
export function heldCardForReview(pa: PendingAction, modelNow: string | null | undefined): PendingAction {
  if (pa.action.kind !== 'apply_proposed_change' || heldCardUnderReview(pa)) return pa;
  return { ...pa, action: { ...pa.action, inline_patch: { ...pa.action.inline_patch,
    [AWAITING_REVIEW]: { reason: 'model_changed', ...(typeof modelNow === 'string' && modelNow !== '' ? { model: modelNow } : {}) } } } } as PendingAction;
}

/**
 * The card a verified approved write is applying now: its OWN write moves its own subject, and that is never a model change to
 * review, so a retry after an interrupted turn still binds its press and is answered "already saved". One async context for the
 * process, unreachable from outside it.
 */
const applying = new AsyncLocalStorage<{ readonly scenarioId: string; readonly proposalId: string }>();
export function runApplyingHeldCard<T>(scenarioId: string, proposalId: string, fn: () => Promise<T>): Promise<T> {
  return applying.run({ scenarioId, proposalId }, fn);
}
export function isHeldCardBeingApplied(pa: PendingAction): boolean {
  const a = applying.getStore();
  const p = heldProposalOf(pa);
  return a !== undefined && pa.scenario_id === a.scenarioId && isRec(p) && p['proposal_id'] === a.proposalId;
}

/** A held model program's card whose program revision moved (`programCardApplies`); any other pending is never judged here. */
export function heldProgramCardMoved(pa: PendingAction, graph: unknown): boolean {
  return programCardApplies(heldProposalOf(pa), graph) === false;
}

/**
 * Whether a held program card applies to the model read with `graphHash` (inventory F6 part b: the program's own rule, never the
 * Living Model's field-scoped ones). A card kept for review is shown on any model, as review. A card carrying its base revision
 * holds while that revision does; one held before it was recorded holds on its own base model only.
 */
export function programHoldApplies(hold: PendingAction, graph: unknown, graphHash: string | undefined): boolean {
  if (heldCardUnderReview(hold)) return true;
  if (graphHash === undefined || graphHash === '') return false;
  const p = heldProposalOf(hold);
  return programCardApplies(p, graph) ?? (isRec(p) && p['base_graph_identity_hash'] === graphHash);
}

const APPROVE_PREFIX = 'agent-approve-proposal:';

/** The approve chip's id for one proposal. */
export const approvalChipIdFor = (proposalId: string): string => `${APPROVE_PREFIX}${proposalId}`;

/**
 * The proposal a request's chip names, when (and only when) it is the typed approve
 * chip. Words alone never approve on this path: "Yes, use those." typed into the
 * composer still goes to the Agent, which resolves it against what it offered.
 */
export function typedApprovalOf(body: unknown): string | undefined {
  const id = (body as { chip?: { id?: unknown } } | null | undefined)?.chip?.id;
  if (typeof id !== 'string' || !id.startsWith(APPROVE_PREFIX)) return undefined;
  const named = id.slice(APPROVE_PREFIX.length);
  const proposalId = named.endsWith(':reserve') ? named.slice(0, -':reserve'.length)
    : named.endsWith(':one-off') ? named.slice(0, -':one-off'.length) : named;
  // `gmh_…` is a held add-option or add-risk on the product's own seam (C52, SLICE C2): the same typed, zero-call approval.
  return /^prop_[0-9a-f]{6,64}$/.test(proposalId) || /^gmh_[0-9a-f]{12}$/.test(proposalId) ? proposalId : undefined;
}

export const AMEND_CHIP: SuggestedAction = {
  id: 'agent-amend-proposal',
  label: 'Change something first',
  message: 'Before you apply it, I want to change some of it.',
};
/** Step 2: the host's own reading card after a program's first draft. */
export const CONFIRM_READING = 'confirm_reading';
export const READING_APPROVE = { label: 'Yes, that’s what I meant', message: 'Yes, that’s what I meant.' } as const;

/** The program's cards, by the tool that leaves one waiting: what its button says and sends. */
const PROGRAM_APPROVE: Readonly<Record<string, { readonly label: string; readonly message: string }>> = {
  // The SDK pauses `apply_change` for the person's approval; this card is that pause (its press resumes it).
  apply_change: { label: 'Make this change', message: 'Yes, make this change.' },
  propose_change: { label: 'Make this change', message: 'Yes, make that change.' },
  [CONFIRM_READING]: READING_APPROVE,
};

/**
 * The buttons a program turn's own tool calls leave (inventory F6 part b: a program card's rule, never the Living Model's
 * per-tool chip rules). A card is offered only when it was prepared after the turn's last change to the model: a change made
 * after it would make it stale. ⛔ ONE APPROVAL CARRIES ONE CHANGE: two cards waiting from one turn get no button at all,
 * since approving one would make the other stale. The card's own words ride in `detail` only when the proposer's result for
 * that id returned the same words as the stored proposal; never the AI's prose.
 */
export function programChipsFor(
  toolCalls: readonly { name: string; ok: boolean; mutated: boolean; proposal_id?: string }[],
  sourceFor: (proposalId: string) => { readonly proposal: StructuredProposal | undefined; readonly result: ToolResult | undefined },
): SuggestedAction[] {
  const lastChange = toolCalls.map((c) => c.mutated).lastIndexOf(true);
  const offered = new Map<string, string>();
  toolCalls.forEach((c, i) => {
    if (i > lastChange && c.ok && typeof c.proposal_id === 'string' && PROGRAM_APPROVE[c.name] !== undefined) offered.set(c.proposal_id, c.name);
  });
  if (offered.size !== 1) return [];
  const [proposalId, tool] = [...offered.entries()][0]!;
  const approve = PROGRAM_APPROVE[tool]!;
  const { proposal, result } = sourceFor(proposalId);
  const detail = tool === 'propose_change' && proposal?.proposal_id === proposalId && result?.ok === true
    && result.proposal_id === proposalId && result.public_label === proposal.public_label ? proposal.public_label : undefined;
  return [{ id: approvalChipIdFor(proposalId), label: approve.label, message: approve.message, ...(detail !== undefined ? { detail } : {}) }, AMEND_CHIP];
}

/** The idle backstop: a held proposal nobody has touched for a day lapses — said, never silent. */
export const PROPOSAL_IDLE_TTL_MS = 24 * 60 * 60 * 1000;
/**
 * The rows a held proposal survives between two Agent answers (canvas edits commit rows too, and each spends one).
 * Refreshed on every Agent answer row; the conventional bare-confirm never reads it as consent time (see above).
 */
export const HELD_PROPOSAL_TURN_BUDGET = 24;
