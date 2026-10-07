/**
 * ⭐ ONE CLICK TO APPROVE THE PROPOSAL THE USER IS LOOKING AT.
 *
 * Measured on served `30a9968` (#63, 08:13): the Agent lane held its proposals
 * for consent, honestly, but returned `suggested_actions: []`, so approval
 * worked only by typing — and the reply told the user to type a 32-hex id.
 *
 * A chip here is ordinary text: the UI sends its `message` on the same Agent
 * route (DecisionGuideAI `buildPayload.ts:199-221` at served `fa84d226`), and a
 * chip without an `action_type` always renders (`SuggestedChips.tsx:256`). So
 * clicking "Use as starting assumptions" is EXACTLY the user typing "Yes, use
 * those." — the consent path is unchanged, and the Agent still resolves it
 * against `awaiting_your_approval` and calls `authorise_change`.
 *
 * Offered only when it cannot be ambiguous: exactly ONE proposal was offered this
 * turn, and nothing was authorised this turn. With two pending, "yes" would make
 * the Agent ask which — a chip must not pretend to have chosen.
 */
import type { SuggestedAction } from '../compose/types.js';
import { formatFactorValueApprox } from '../compose/format-factor-value.js';
import { hasCardOnlyOperations, type StructuredProposal } from './proposal.js';
import { CANVAS_BAND_WORD } from '../format/edge-strength-bands.js';
import type { InfluenceBand } from '../format/influence-bands.js';
import type { ToolResult } from './runtime/agent-tools.js';
import { SCOPE_APPROVE_PREFIX } from './goal-scope.js';
import { identityApproveMessage, identityReadingOf } from './identity-card.js';
import { linkEffectSourceLevels } from './link-effect-figures.js';
import { namesSourceOf } from './stated-by-user.js';
import { POINTS_SPELLINGS } from '../../utils/unit-alphabet.js';
import { statedInOneOf } from '../system-events/link-effect-edit.js';

/**
 * ⭐ RT-18 (served dental draft, 74cc7aea): a % level's change is said in POINTS, the writer's own rule (`POINTS_STATED`,
 * link-effect-edit.ts), so "percentage points" meets a "%" reading. Without it the card for a points answer through a %
 * gauge was never built, and the prepared change had no Approve.
 */
const POINTS_SAID: readonly string[] = [...POINTS_SPELLINGS, 'points'];
// ⛔ Codex r1 #2652 P1: the card takes the WRITER's own unit rule (`statedInOneOf`), so an answer the door writes ("GBP/month"
// against a £/month reading) never loses its card. Exact where the writer is exact: points never meet "% of appointments",
// and £ never meets % (#2641's twins).
const meetsReading = (stated: unknown, reading: string): boolean => stated === reading || statedInOneOf(stated, [reading])
  || (reading.trim() === '%' && typeof stated === 'string' && POINTS_SAID.includes(stated.trim().toLowerCase().replace(/\s+/g, ' ')));

const APPROVE: Readonly<Record<string, { label: string; message: string }>> = {
  propose_starting_point: { label: 'Use as starting assumptions', message: 'Yes, use those.' },
  propose_assumptions: { label: 'Use as starting assumptions', message: 'Yes, use those.' },
  propose_option_interventions: { label: 'Use as starting option levels', message: 'Yes, use those.' },
  propose_model_change: { label: 'Make this change', message: 'Yes, make that change.' },
  // #1788's add-option proposal: the same typed, zero-call approval as every other proposal.
  propose_new_option: { label: 'Add this option', message: 'Yes, add that option.' },
  // The goal's current level, as the user stated it (`goal-current-level.ts`).
  reconcile_goal_scope: { label: 'Record this goal reading', message: 'Yes, record this reading.' },
  propose_goal_current_level: { label: 'Record this current level', message: 'Yes, record it.' },
  // A link's strength recorded as the user's own (challenge → authorised revision): one button, carried like the rest.
  propose_link_strength: { label: 'Record this link', message: 'Yes, record that.' },
  // A set of link strengths: ONE button records the whole set, as one commit (DL #72 5871594233).
  propose_link_strengths: { label: 'Record these links', message: 'Yes, record those.' },
  // The user's own stated effect on one link ("every £1 loses us about 50"), written through the level door's link_effect.
  propose_link_effect: { label: 'Record this reading', message: 'Yes, record that reading.' },
  // The goal's success target the user stated, written through the product's typed target writer.
  propose_goal_target: { label: 'Set this target', message: 'Yes, set that target.' },
  // S-E GOALS (Science ruling 7 Oct §3): the user's deadline as a date. Two buttons: [Yes] [Change date].
  propose_goal_deadline: { label: 'Yes', message: 'Yes, that is my deadline.' },
  // MG F1 T6: one option out of (or back into) the comparison, through the ONE option-status writer (`option_status_edit`).
  propose_option_status: { label: 'Make this change', message: 'Yes, make that change.' },
  // SLICE C2: a new risk, held on the product's own seam like the add-option (`gmh_`, the product's words on the button).
  propose_new_risk: { label: 'Add this risk', message: 'Yes, add that risk.' },
  // PJ-E-FIG: new factors carrying the user's figures, held on the same seam as the add-risk (`gmh_`).
  propose_new_factor: { label: 'Add these factors', message: 'Yes, add them.' },
  // SLICE C2: a new figure for a limit the model already holds, written through the product's limit door.
  propose_limit_change: { label: 'Change this limit', message: 'Yes, change that limit.' },
  // The user confirms Olumi's reading of their goal as a product of two of their figures (`identity-card.ts`).
  propose_identity: { label: 'Yes, calculate it that way', message: 'Yes, calculate it that way.' },
};

/** The proposers whose change is HELD on the product's own seam (`gmh_`): the button carries the product's own words. */
const HELD_ON_THE_PRODUCT_SEAM: ReadonlySet<string> = new Set(['propose_new_option', 'propose_new_risk', 'propose_new_factor']);

/**
 * ⛔ ONE APPROVAL CARRIES ONE CHANGE, SO A TURN LEAVES AT MOST ONE PROPOSAL OPEN (AI Conversation #70 5847130065 (a);
 * DL `bf-20260926T113645Z` turns[3]: a link and a level both proposed, "Approve both changes?", and no control —
 * the chip rule below rightly offers none for two, since approving one supersedes the other). `agent-loop.ts` refuses
 * a second proposing call with this code while one from the same turn awaits the user's yes; nothing is stored.
 */
export const ONE_CHANGE_PER_APPROVAL = 'one_change_per_approval';
export const ONE_CHANGE_PER_APPROVAL_DETAIL =
  'A change from this turn is already awaiting the user\u2019s approval, and one approval carries one change: approving '
  + 'it moves the model, so a second proposal made now could never be approved after it. Nothing was stored. If both '
  + 'belong to one operation, propose them in ONE call instead (propose_new_option carries up to 4 options in `options`; '
  + 'propose_starting_point carries starting values and option levels together; propose_option_interventions adds the '
  + 'link a level needs; propose_link_strengths carries several links\u2019 strengths). Otherwise present the change '
  + 'already proposed, and tell the user this further change is not proposed yet \u2014 they can ask for it once they '
  + 'have answered. Never ask them to approve both.';

/** Whether a tool leaves a proposal awaiting the user's yes — the approve chip's own list. */
export const isProposingTool = (name: string): boolean => APPROVE[name] !== undefined;

/**
 * ⛔ A CHANGE THE AGENT DISOWNS IS NEVER LEFT OFFERED (P2 of the A16 defect, DL #72 5863691992): served `137d3a5` A16
 * prepared a link change, then replied "do not approve that proposal" with its approve button still offered. A reply
 * cannot take a button away, so the Agent withdraws the change by this tool, before it replies. Only a change THIS
 * turn proposed and still offers can be withdrawn (`agent-loop.ts`); what an earlier turn showed the user stays theirs.
 */
export const WITHDRAW_PROPOSAL = 'withdraw_proposal';
export const NOT_PROPOSED_THIS_TURN = 'not_proposed_this_turn';

/** The ids this turn's own `withdraw_proposal` calls withdrew. A refused call withdrew nothing. */
export function withdrawnThisTurn(toolCalls: readonly { name: string; ok: boolean; proposal_id?: string }[]): ReadonlySet<string> {
  return new Set(toolCalls.filter((c) => c.name === WITHDRAW_PROPOSAL && c.ok && typeof c.proposal_id === 'string').map((c) => c.proposal_id as string));
}

/** S-E GOALS: the deadline card's second button (Science ruling §3: "[Yes] [Change date]"). */
export const DEADLINE_CHANGE_CHIP: SuggestedAction = {
  id: 'agent-deadline-change',
  label: 'Change date',
  message: 'That is not my deadline. I will give you the date.',
};

export const AMEND_CHIP: SuggestedAction = {
  id: 'agent-amend-proposal',
  label: 'Change something first',
  message: 'Before you apply it, I want to change some of it.',
};

/**
 * The proposals a turn's own tool calls leave awaiting the user's yes, each with the tool that made it —
 * the ONE rule the approve chip and the build's save line (`write-outcome.ts`) both read. Empty when any
 * authorisation's identity is unknown: never a guess about which proposal it consumed.
 */
export function proposalsAwaitingApproval(
  toolCalls: readonly { name: string; ok: boolean; mutated: boolean; proposal_id?: string }[],
): ReadonlyMap<string, string> {
  /**
   * A turn that authorised something consumes THOSE proposals only: one that approved A and proposed
   * B offers B (measured on served `6dfb56f`: "Yes, make that change" applied a link and proposed its
   * level, and the reply had no chip). If any authorisation's identity is unknown, nothing is offered —
   * never a chip on a guess about which proposal was consumed.
   *
   * ⛔ ORDER DECIDES VALIDITY. A proposal is bound to the revision it was made on, and any call that
   * moved the model after it makes it stale: `ProposalStore.authorise` refuses it as `superseded`
   * (Codex #1806 5807933515: propose B on H0, then approve A → H1, offered a chip that could not
   * commit). So only a proposal made AFTER the turn's last model change is still offerable.
   */
  const authorisations = toolCalls.filter((c) => c.name === 'authorise_change');
  if (authorisations.some((c) => typeof c.proposal_id !== 'string')) return new Map();
  const consumed = new Set(authorisations.map((c) => c.proposal_id as string));
  // A change the Agent withdrew this turn is neither offered nor carried (`WITHDRAW_PROPOSAL`).
  for (const id of withdrawnThisTurn(toolCalls)) consumed.add(id);
  const lastChange = toolCalls.map((c) => c.mutated).lastIndexOf(true);
  const offered = new Map<string, string>();
  toolCalls.forEach((c, i) => {
    if (i > lastChange && c.ok && typeof c.proposal_id === 'string' && APPROVE[c.name] !== undefined && !consumed.has(c.proposal_id)) offered.set(c.proposal_id, c.name);
  });
  return offered;
}

/** What a chip's words are composed from: the STORED proposal it approves, and its proposer's own result. */
export interface ApprovalLabelSource {
  readonly proposal: StructuredProposal | undefined;
  readonly result: ToolResult | undefined;
}

export function approvalChipsFor(
  toolCalls: readonly { name: string; ok: boolean; mutated: boolean; proposal_id?: string }[],
  labelSourceFor?: (proposalId: string) => ApprovalLabelSource | undefined,
): SuggestedAction[] {
  const offered = proposalsAwaitingApproval(toolCalls);
  if (offered.size !== 1) return [];
  const [proposalId, tool] = [...offered.entries()][0]!;
  const approve = APPROVE[tool]!;
  // ⭐ THE CHIP CARRIES THE PROPOSAL'S IDENTITY (fast path 2, RC #63 5803995225). The
  // UI echoes `chip.id` verbatim on the click, so the route applies EXACTLY this
  // proposal with no model call. The id is never rendered (label/message are).
  /**
   * A held add-option (C52) carries the product's OWN words for its confirm: its label, and the exact message
   * the hold was minted with — so if the click ever reaches the product's route directly, the exact copy still
   * resolves the hold instead of reading as new words for the edit model.
   */
  const source = labelSourceFor?.(proposalId);
  const held = source?.result;
  if (HELD_ON_THE_PRODUCT_SEAM.has(tool) && /^gmh_/.test(proposalId) && held !== undefined) {
    const label = typeof held.public_label === 'string' && held.public_label.trim() !== '' ? held.public_label : approve.label;
    const message = typeof held.held_message === 'string' && held.held_message.trim() !== '' ? held.held_message : approve.message;
    /**
     * ⛔ THE BUTTON NEVER CUTS THE OPTION'S NAME (Paul's test, 27 Sep, B3): the product's label is clamped to 57
     * characters ("Add option '£59 for new Pro customers; grandfather existi...") and its full sentence rides in
     * `detail`, which the UI shows on the button. The Agent's copy of the chip dropped it; it carries it now.
     */
    const detail = typeof held.held_detail === 'string' && held.held_detail.trim() !== '' ? held.held_detail : undefined;
    return [{ id: approvalChipIdFor(proposalId), label, message, ...(detail !== undefined ? { detail } : {}) }, AMEND_CHIP];
  }
  // Adoption is a proposal about an EXISTING Olumi option. The card, including every displayed
  // level, is derived from the stored proposal; only its exact pressed words authorise the write.
  const stored = source?.proposal;
  // A real label-source lookup that cannot recover the stored levels card
  // cannot prove that its omitted operations were gap-free. Offer no approval.
  if (labelSourceFor !== undefined && stored === undefined
    && (tool === 'propose_option_interventions' || tool === 'propose_starting_point')) return [];
  if (stored !== undefined && hasCardOnlyOperations(stored.operations)) {
    // This must precede every generic/special chip path: the exact stored gap
    // card and its operands are the subject of the existing typed approval.
    if (stored!.proposal_id !== proposalId || held?.ok !== true || held.proposal_id !== proposalId
      || typeof stored!.public_label !== 'string' || stored!.public_label.trim() === ''
      || held.public_label !== stored!.public_label) return [];
    return [{ id: approvalChipIdFor(proposalId), label: approvalLabelFor(tool, source),
      message: approve.message, detail: stored!.public_label }, AMEND_CHIP];
  }
  if (stored?.operations.some(op => (op.value as { goal_scope?: unknown } | undefined)?.goal_scope !== undefined)) {
    return [{ id: approvalChipIdFor(proposalId), label: 'Record this goal reading', message: SCOPE_APPROVE_PREFIX + stored.public_label, detail: stored.public_label }, AMEND_CHIP];
  }
  const adoption = stored?.operations.length === 1 && stored.operations[0]?.op === 'adopt_olumi_option'
    ? stored.operations[0].value as { approval_message?: unknown } | undefined : undefined;
  if (adoption !== undefined && typeof adoption.approval_message === 'string' && adoption.approval_message !== '') {
    // DGAI discloses `detail` above consent chips with this exact id prefix.
    // Keep the short button label separate so decimal levels do not trigger
    // the egress rule for unvalidated figures in chip labels.
    return [{ id: approvalChipIdFor(proposalId), label: 'Add this suggestion to my comparison',
      message: adoption.approval_message, detail: stored!.public_label }, AMEND_CHIP];
  }
  const reading = readingShownFor(tool, labelSourceFor?.(proposalId));
  if (reading !== undefined) return [{ id: approvalChipIdFor(proposalId), ...reading, message: approve.message }, AMEND_CHIP];
  // ⛔ A reading of the goal is confirmed ONLY on a card showing its exact words (`identity-card.ts`): none, no button.
  if (tool === 'propose_identity') {
    const words = identityWordsFor(labelSourceFor?.(proposalId));
    return words === undefined ? []
      : [{ id: approvalChipIdFor(proposalId), label: approve.label, message: identityApproveMessage(words), detail: words }, AMEND_CHIP];
  }
  // ⛔ A link's stated effect is approvable ONLY on a card showing its exact reading (PR Review's fifth CR): none, no button.
  if (tool === 'propose_link_effect') {
    const effectReading = linkEffectReadingFor(tool, labelSourceFor?.(proposalId));
    return effectReading === undefined ? []
      : [{ id: approvalChipIdFor(proposalId), label: approve.label, message: linkEffectApproveMessage(effectReading), detail: effectReading }, AMEND_CHIP];
  }
  // ⭐ A KEEP CHANGES NO FIGURE (52f8cd #2436): the button says what the Yes records — the user's acceptance — never
  // "Set … to"; the card with the figure rides in `detail`.
  const keep = keepCardFor(tool, labelSourceFor?.(proposalId));
  if (keep !== undefined) return [{ id: approvalChipIdFor(proposalId), ...keep }, AMEND_CHIP];
  // ⭐ A GOAL TARGET WHOSE DIRECTION IS THE AGENT'S READING IS A DECISION (DL 380e54 on #2447; ruling 5930770727 (c)):
  // the user's words said neither way, so the reading is the primary button and the other direction the alternative —
  // never a typed magic word. The primary approves the stored card; the alternative asks for the other direction.
  const choice = directionChoiceFor(tool, labelSourceFor?.(proposalId));
  if (choice !== undefined) {
    const card = labelSourceFor?.(proposalId)?.proposal?.public_label;
    return [
      { id: approvalChipIdFor(proposalId), label: DIRECTION_CHOICE_LABEL[choice.chosen], message: approve.message, ...(card !== undefined ? { detail: card } : {}) },
      { id: 'agent-direction-alternative', label: DIRECTION_CHOICE_LABEL_INSTEAD[choice.alternative], message: DIRECTION_CHOICE_MESSAGE[choice.alternative] },
      AMEND_CHIP,
    ];
  }
  // ⭐ S-E GOALS: the deadline card asks "Is your deadline 7 April 2027 (6 months from today)?" — the STORED card's words ride
  // in `detail`, only when the proposer's own result for that id returned the same words; the buttons are [Yes] [Change date].
  if (tool === 'propose_goal_deadline') {
    const source = labelSourceFor?.(proposalId);
    const card = source?.proposal !== undefined && source.result?.ok === true && source.result.proposal_id === source.proposal.proposal_id
      && source.result.public_label === source.proposal.public_label ? source.proposal.public_label : undefined;
    return [{ id: approvalChipIdFor(proposalId), label: approve.label, message: approve.message, ...(card !== undefined ? { detail: card } : {}) },
      DEADLINE_CHANGE_CHIP];
  }
  const detail = usersOwnCardFor(tool, labelSourceFor?.(proposalId))
    ?? (tool === 'propose_link_strengths' ? linkStrengthCardFor(proposalId, labelSourceFor?.(proposalId)?.proposal) : undefined);
  return [{ id: approvalChipIdFor(proposalId), label: approvalLabelFor(tool, labelSourceFor?.(proposalId)), message: approve.message, ...(detail !== undefined ? { detail } : {}) }, AMEND_CHIP];
}

/**
 * ⭐ A LINK-STRENGTH APPROVAL SAYS WHAT IT RECORDS (CODEX_CLI_OVERFLOW P1 + DL ruling on #2481; ONE projection, shared
 * with #2480's card): the button alone read "Record these links", so the band and whose estimate it is were hidden. The
 * STORED proposal's own card — each link, its band and "Olumi's estimate" or "your estimate", as `proposeLinkStrengths`
 * minted it — rides in `detail`. Identity: the store's proposal for THIS chip's id, every operation a link strength.
 * Never the Agent's prose. Used live and on a replay, which rebuilds the chip from the same stored proposal.
 */
export function linkStrengthCardFor(proposalId: string, proposal: StructuredProposal | undefined): string | undefined {
  if (proposal === undefined || proposal.proposal_id !== proposalId || proposal.operations.length === 0
    || proposal.operations.some((o) => o.op !== 'set_link_strength')) return undefined;
  return typeof proposal.public_label === 'string' && proposal.public_label.trim() !== '' ? proposal.public_label : undefined;
}

type Direction = 'at_least' | 'at_most';
const DIRECTION_CHOICE_LABEL: Readonly<Record<Direction, string>> = { at_least: 'Yes, at least', at_most: 'Yes, at most' };
const DIRECTION_CHOICE_LABEL_INSTEAD: Readonly<Record<Direction, string>> = { at_least: 'At least instead', at_most: 'At most instead' };
const DIRECTION_CHOICE_MESSAGE: Readonly<Record<Direction, string>> = {
  at_least: 'No, the goal should be at least that figure.',
  at_most: 'No, the goal should be at most that figure.',
};
/** The proposer's own typed choice for a goal target the Agent read the direction of (`proposeGoalTarget`). */
function directionChoiceFor(tool: string, source: ApprovalLabelSource | undefined): { chosen: Direction; alternative: Direction } | undefined {
  if (tool !== 'propose_goal_target') return undefined;
  const c = (source?.result as { direction_choice?: { chosen?: unknown; alternative?: unknown } } | undefined)?.direction_choice;
  const ok = (d: unknown): d is Direction => d === 'at_least' || d === 'at_most';
  return c !== undefined && ok(c.chosen) && ok(c.alternative) && c.chosen !== c.alternative ? { chosen: c.chosen, alternative: c.alternative } : undefined;
}

/** The stored basis of a keep proposal (`proposeAssumptions` `keep: true`) — the authority the keep button binds to. */
export const KEEP_PROPOSAL_BASIS = 'Olumi\u2019s current estimates, unchanged, for the user to accept';
export const isKeepProposal = (proposal: StructuredProposal): boolean =>
  proposal.provenance.basis === KEEP_PROPOSAL_BASIS || proposal.provenance.original_basis === KEEP_PROPOSAL_BASIS;


/**
 * The keep button, ONLY when the STORED proposal is a keep (its basis) and the proposer's own result for that same id
 * returned the same card — never the Agent's prose.
 */
function keepCardFor(tool: string, source: ApprovalLabelSource | undefined): { label: string; message: string; detail: string } | undefined {
  const proposal = source?.proposal;
  const result = source?.result;
  if (tool !== 'propose_assumptions' || proposal === undefined || result === undefined || result.ok !== true || result.proposal_id !== proposal.proposal_id) return undefined;
  if (!isKeepProposal(proposal) || typeof proposal.public_label !== 'string' || result.public_label !== proposal.public_label) return undefined;
  const n = proposal.operations.length;
  return n === 1
    ? { label: 'Keep Olumi\u2019s estimate', message: 'Yes, keep Olumi\u2019s estimate.', detail: proposal.public_label }
    : { label: `Keep Olumi\u2019s ${n} estimates`, message: 'Yes, keep those estimates.', detail: proposal.public_label };
}

/** Every op sets a factor value the USER wrote (`authored_by: 'user_stated'`, the write's own predicate). */
const allUsersOwnValues = (proposal: StructuredProposal): boolean =>
  proposal.operations.length > 0
  && proposal.operations.every((o) => o.op === 'set_factor_value' && (o.value as { authored_by?: unknown } | undefined)?.authored_by === 'user_stated');

/**
 * ⛔ THE USER'S OWN FIGURE IS SHOWN AS THEIRS AT THE APPROVAL (AIQ 5909998288, R3 candidate-2 witness R2): the card
 * ("GCP unit-cost saving: 20% → 25% (your figure, in your words: …)") was built and stored, but the chip carried only
 * "Use as starting assumptions", so the user approved their own figure under words that called it a starting estimate
 * while the Agent said "Olumi's estimate". The STORED proposal's own card rides in `detail`, only when the proposer's
 * result for that same id returned the same words — never the Agent's prose.
 */
function usersOwnCardFor(tool: string, source: ApprovalLabelSource | undefined): string | undefined {
  const proposal = source?.proposal;
  const result = source?.result;
  if (tool !== 'propose_assumptions' || proposal === undefined || result === undefined || result.ok !== true || result.proposal_id !== proposal.proposal_id) return undefined;
  if (!allUsersOwnValues(proposal) || typeof proposal.public_label !== 'string' || proposal.public_label.trim() === '' || result.public_label !== proposal.public_label) return undefined;
  return proposal.public_label;
}

/**
 * The identity card's words: R3's reading from the STORED proposal (what `authorise_change` will write), shown only when
 * the proposer's own result for that same id returned the SAME words — never the Agent's prose.
 */
function identityWordsFor(source: ApprovalLabelSource | undefined): string | undefined {
  const proposal = source?.proposal;
  const result = source?.result;
  if (proposal === undefined || result === undefined || result.ok !== true || result.proposal_id !== proposal.proposal_id) return undefined;
  const reading = identityReadingOf(proposal);
  const shown = (result.card as { words?: unknown } | undefined)?.words;
  return reading !== undefined && shown === reading.words ? reading.words : undefined;
}

/**
 * ⭐ THE LINK-EFFECT CARD SHOWS THE READING IT APPROVES (AIQ 5884881500, "proposer, not stamper"): the figures, units and
 * sentence from the STORED proposal (what `authorise_change` will write), the two labels from the proposer's own result
 * for that same id — never the Agent's prose. The user approves THIS reading; a wrong one costs a "no".
 */
function linkEffectReadingFor(tool: string, source: ApprovalLabelSource | undefined): string | undefined {
  const proposal = source?.proposal;
  const result = source?.result;
  if (tool !== 'propose_link_effect' || proposal === undefined || result === undefined || result.ok !== true || result.proposal_id !== proposal.proposal_id) return undefined;
  if (proposal.operations.length === 0 || proposal.operations.some((op) => op.op !== 'set_link_effect')) return undefined;
  if (proposal.operations.length === 1) {
    const op = proposal.operations[0]!.value as
      { effect?: { amount?: unknown; amount_unit?: unknown; per_source_change?: unknown; per_source_change_unit?: unknown }; quote?: unknown };
    // A grouped request can prepare just one operation (including when its other rows refuse).
    // It returns `links`, but approval still records the same single-operation reading.
    const link = (result.link ?? (Array.isArray(result.links) && result.links.length === 1 ? result.links[0] : undefined)) as
      { from?: unknown; to?: unknown; your_words?: unknown } | undefined;
    if (link === undefined || link === null || link.your_words !== op.quote) return undefined;
    return linkEffectReadingOf(proposal, { from: link.from, to: link.to });
  }
  const links = result.links;
  if (!Array.isArray(links) || links.length !== proposal.operations.length) return undefined;
  const labels = links.map((link) => link as { from: unknown; to: unknown; your_words?: unknown });
  if (labels.some((link, i) => link.your_words !== (proposal.operations[i]!.value as { quote?: unknown }).quote)) return undefined;
  return linkEffectReadingsOf(proposal, labels);
}

/**
 * The reading a link-effect card shows and its approval records: the STORED change with its signs, both ends by their
 * labels, and the user's one sentence. The writer recomputes it from the same stored proposal (`applyLinkEffect`).
 */
export function linkEffectReadingOf(proposal: StructuredProposal, labels: { readonly from: unknown; readonly to: unknown }): string | undefined {
  const op = proposal.operations.length === 1 && proposal.operations[0]!.op === 'set_link_effect' ? proposal.operations[0]!.value as
    { from?: unknown; to?: unknown; effect?: { amount?: unknown; amount_unit?: unknown; per_source_change?: unknown; per_source_change_unit?: unknown };
      quote?: unknown; unit_readings?: unknown; label_readings?: unknown; mediator_readings?: unknown; reversal?: unknown; link_selected?: unknown } : undefined;
  const e = op?.effect;
  if (e === undefined || typeof op?.quote !== 'string' || typeof labels.from !== 'string' || typeof labels.to !== 'string'
    || typeof e.amount !== 'number' || !Number.isFinite(e.amount) || e.amount === 0
    || typeof e.per_source_change !== 'number' || !Number.isFinite(e.per_source_change) || e.per_source_change === 0
    || typeof e.amount_unit !== 'string' || typeof e.per_source_change_unit !== 'string'
    || (op.link_selected !== undefined && op.link_selected !== true)) return undefined;
  const unsigned = (v: number, unit: string): string => figureInUserUnits(Math.abs(v), unit) ?? `${Math.abs(v)} ${unit}`;
  const signed = (v: number, unit: string): string => `${v < 0 ? '\u2212' : '+'}${unsigned(v, unit)}`;
  let reversal = '';
  if (op.reversal !== undefined) {
    const r = op.reversal as { from?: unknown; to?: unknown } | null;
    const direction = Math.sign(e.amount) * Math.sign(e.per_source_change) < 0 ? 'negative' : 'positive';
    if (r === null || typeof r !== 'object' || Object.keys(r).length !== 2
      || (r.from !== 'positive' && r.from !== 'negative') || r.to !== direction || r.from === r.to) return undefined;
    reversal = `REVERSAL: this changes the link from ${r.from} to ${r.to}. `;
  }
  // ⭐ No-dead-end (B)/(C) (Science #87 6006425419, 6006548763, 6006685510): a level-less mediator's reading, said for
  // approval. Strict: each item names one end, in the unit that end's figure now carries; anything else, no card.
  if (op.mediator_readings !== undefined && (!Array.isArray(op.mediator_readings) || op.mediator_readings.length > 2)) return undefined;
  const mediated: string[] = [];
  let through: { readonly child: string; readonly mediator: string } | undefined;
  for (const raw of (op.mediator_readings ?? []) as unknown[]) {
    const item = raw as { node_id?: unknown; via?: unknown; unit?: unknown; other_label?: unknown; replaces?: unknown } | null;
    if (item === null || typeof item !== 'object' || typeof item.node_id !== 'string' || (item.node_id !== op.from && item.node_id !== op.to)
      || typeof item.unit !== 'string' || item.unit.trim() === '' || typeof item.other_label !== 'string' || item.other_label.trim() === ''
      || Object.keys(item).some((k) => !['node_id', 'via', 'unit', 'other_label', 'replaces'].includes(k))
      || (item.replaces !== undefined && (item.replaces !== true || item.via !== 'gauge'))) return undefined;
    const end = item.node_id === op.from ? labels.from : labels.to;
    if (item.via === 'sized_parents' && meetsReading(item.node_id === op.from ? e.per_source_change_unit : e.amount_unit, item.unit)) {
      mediated.push(`Olumi measures \u2018${end}\u2019 in ${item.unit}, from its own estimate of the link from \u2018${item.other_label}\u2019; correct that if it\u2019s wrong.`);
    } else if (item.via === 'definitional_part' && meetsReading(item.node_id === op.from ? e.per_source_change_unit : e.amount_unit, item.unit)) {
      // FA1 (Science d5, 6 Oct): the part's unit is read off its definition, said here for approval.
      mediated.push(`Olumi treats \u2018${end}\u2019 as part of \u2018${item.other_label}\u2019, so it\u2019s measured in ${item.unit}; correct that if it\u2019s wrong.`);
    } else if (item.via === 'product' && meetsReading(item.node_id === op.from ? e.per_source_change_unit : e.amount_unit, item.unit)) {
      // FA1-3 (DL, 6 Oct): a product's unit is read off its operands' units, said here for approval.
      mediated.push(`Olumi measures \u2018${end}\u2019 in ${item.unit}, as ${item.other_label}; correct that if it\u2019s wrong.`);
    } else if (item.via === 'gauge' && item.node_id === op.to && meetsReading(e.amount_unit, item.unit) && through === undefined) {
      through = { child: item.other_label, mediator: end };
      mediated.push(`Olumi treats \u2018${end}\u2019 as part of how \u2018${labels.from}\u2019 moves \u2018${item.other_label}\u2019, so your answer sizes the whole path.`
        + (item.replaces === true ? ` Your answer replaces Olumi\u2019s own estimate for the link from \u2018${labels.from}\u2019 to \u2018${end}\u2019.` : ''));
    } else return undefined;
  }
  // Through a gauge the user sized the PATH: the record names the quantity it reaches, through the mediator.
  const reached = through === undefined ? `"${labels.to}"` : `"${through.child}" through "${through.mediator}"`;
  // G1b answer door: a switch (the sizer's "switch", ±1) is turned on or off, never "raised by 1 switch".
  const turning = e.per_source_change_unit === 'switch' && Math.abs(e.per_source_change) === 1
    ? `${e.per_source_change < 0 ? 'turning off' : 'turning on'} "${labels.from}"` : undefined;
  const words = `${turning ?? `${e.per_source_change < 0 ? 'lowering' : 'raising'} "${labels.from}" by ${unsigned(e.per_source_change, e.per_source_change_unit)}`} `
    + `${e.amount < 0 ? 'lowers' : 'raises'} ${reached} by ${unsigned(e.amount, e.amount_unit)}`;
  const levels = linkEffectSourceLevels(op.quote, namesSourceOf({ source: labels.from, target: labels.to }));
  const transition = levels !== undefined && levels.change === e.per_source_change
    ? ` Source change: ${levels.from}% \u2192 ${levels.to}% = ${signed(levels.change, levels.unit)}.` : '';
  const head = `${reversal}Record: ${turning ?? `${signed(e.per_source_change, e.per_source_change_unit)} on "${labels.from}"`} \u2192 ${signed(e.amount, e.amount_unit)} in ${reached}: ${words}.${transition}`;
  if (op.unit_readings !== undefined && (!Array.isArray(op.unit_readings) || op.unit_readings.length > 2)) return undefined;
  const disclosures: string[] = [];
  const seen = new Set<string>();
  for (const raw of (op.unit_readings ?? []) as unknown[]) {
    const item = raw as { node_id?: unknown; unit_reading?: { unit?: unknown; source?: unknown; source_quote?: unknown } } | null;
    const reading = item?.unit_reading;
    if (item === null || typeof item !== 'object' || Object.keys(item).length !== 2 || typeof item.node_id !== 'string'
      || (item.node_id !== op.from && item.node_id !== op.to) || seen.has(item.node_id)
      || reading === undefined || reading === null || typeof reading !== 'object' || Object.keys(reading).length !== 3
      || typeof reading.unit !== 'string' || reading.unit.length < 1 || reading.unit.length > 40 || reading.source !== 'user_stated'
      || typeof reading.source_quote !== 'string' || reading.source_quote.length < 1 || reading.source_quote.length > 500
      || !op.quote.includes(reading.source_quote)) return undefined;
    seen.add(item.node_id);
    disclosures.push(`I've taken "${item.node_id === op.from ? labels.from : labels.to}" to be in ${reading.unit}, from your words.`);
  }
  // ⭐ RT-6 row 1b (Science #87 6005615422): an end the user named by its node's own LABEL is said back in that node's
  // unit, for approval, never silently: "I've read that as +1 percentage point per 10 cafés (the unit of "Café
  // subscribers")". Each reading must be exactly the unit the effect now carries at its end; anything else, no card.
  if (op.label_readings !== undefined && (!Array.isArray(op.label_readings) || op.label_readings.length > 2)) return undefined;
  const labelled: string[] = [];
  for (const raw of (op.label_readings ?? []) as unknown[]) {
    const item = raw as { node_id?: unknown; said?: unknown; unit?: unknown } | null;
    if (item === null || typeof item !== 'object' || Object.keys(item).length !== 3 || typeof item.node_id !== 'string'
      || (item.node_id !== op.from && item.node_id !== op.to) || typeof item.said !== 'string' || item.said.trim() === ''
      || typeof item.unit !== 'string' || (item.node_id === op.from ? e.per_source_change_unit : e.amount_unit) !== item.unit) return undefined;
    const label = item.node_id === op.from ? labels.from : labels.to;
    if (labelled.includes(label)) return undefined;
    labelled.push(label);
  }
  if (labelled.length > 0) {
    // Codex r1: a negative source change keeps its sign ("−1 percentage point per −10 cafés"), never a reversed ratio.
    const perWords = e.per_source_change < 0 ? signed(e.per_source_change, e.per_source_change_unit) : unsigned(e.per_source_change, e.per_source_change_unit);
    disclosures.push(`I've read that as ${signed(e.amount, e.amount_unit)} per ${perWords} `
      + `(the unit${labelled.length > 1 ? 's' : ''} of ${labelled.map((l) => `"${l}"`).join(' and ')}).`);
  }
  disclosures.push(...mediated);
  // One clean quote (no doubled full stop); "as you confirmed" is said AFTER approval, in the receipt, never before it.
  return `${head} From your words: "${op.quote}"${/[.!?]$/.test(op.quote) ? '' : '.'}`
    + (disclosures.length > 0 ? ` ${disclosures.join(' ')}` : '')
    + ' Approve, or correct.';
}

/** The same card reading for one stored operation; kept separate so the single-link wording remains byte-for-byte. */
function linkEffectReadingOfOperation(
  operation: StructuredProposal['operations'][number],
  labels: { readonly from: unknown; readonly to: unknown },
): string | undefined {
  const proposal: StructuredProposal = { ...({} as StructuredProposal), operations: [operation] };
  return linkEffectReadingOf(proposal, labels);
}

/** The card reading for an all-link-effect proposal, one natural sentence per line. */
export function linkEffectReadingsOf(
  proposal: StructuredProposal,
  labels: readonly { readonly from: unknown; readonly to: unknown }[],
): string | undefined {
  if (proposal.operations.length === 0 || proposal.operations.length !== labels.length
    || proposal.operations.some((op) => op.op !== 'set_link_effect')) return undefined;
  const readings = proposal.operations.map((operation, i) => linkEffectReadingOfOperation(operation, labels[i]!));
  return readings.every((reading): reading is string => reading !== undefined) ? readings.join('\n') : undefined;
}

/**
 * ⭐ THE PRESSED CARD CARRIES ITS READING (AIQ 5885290014: "a forged approval without a reading token → the writer
 * refuses"). The card's words ARE its reading, so the approval request carries exactly what the user saw; the durable
 * carrier keeps those words, so a card put back after a restart shows the same reading ({@link readingOfLinkEffectApproval}).
 */
const LINK_EFFECT_APPROVE_PREFIX = 'Yes \u2014 ';
export const linkEffectApproveMessage = (reading: string): string => `${LINK_EFFECT_APPROVE_PREFIX}${reading}`;
/** The reading a link-effect card's words carry, or `undefined` for any other words. */
export function readingOfLinkEffectApproval(message: unknown): string | undefined {
  return typeof message === 'string' && (message.startsWith(`${LINK_EFFECT_APPROVE_PREFIX}Record: `)
    || /^Yes \u2014 REVERSAL: this changes the link from (positive|negative) to (positive|negative)\. Record: /.test(message))
    ? message.slice(LINK_EFFECT_APPROVE_PREFIX.length) : undefined;
}

/** The tools whose proposal can carry Olumi's reading of the user's own words for a link's band (slice C3). */
const READING_TOOLS: ReadonlySet<string> = new Set(['propose_link_strength', 'propose_model_change']);

/**
 * ⭐ THE BUTTON SHOWS THE READING THE USER APPROVES (slice C3). When a link's band was read from the user's own words
 * ("very high" read as very strong), the approval is of that reading, so the button says it: `Record as very strong
 * (your "very high")` when that fits {@link APPROVAL_LABEL_MAX}, else `Record as very strong`, with the whole reading
 * always in `detail` (the boundary `Action`'s optional field). Read from the STORED proposal, and only when the
 * proposer's own result carries the SAME reading — never the Agent's prose.
 */
function readingShownFor(tool: string, source: ApprovalLabelSource | undefined): { label: string; detail: string } | undefined {
  const proposal = source?.proposal;
  const result = source?.result;
  const stored = proposal?.interpretation;
  if (!READING_TOOLS.has(tool) || stored === undefined || result === undefined || result.ok !== true || result.proposal_id !== proposal?.proposal_id) return undefined;
  const shown = result.interpretation as Record<string, unknown> | undefined;
  if (shown === undefined || shown === null || typeof shown !== 'object') return undefined;
  if (shown.field !== stored.field || shown.from_words !== stored.from_words || shown.reading !== stored.reading || shown.shown_as !== stored.shown_as) return undefined;
  const short = `Record as ${CANVAS_BAND_WORD[stored.reading as InfluenceBand] ?? stored.reading}`;
  return { label: stored.shown_as.length <= APPROVAL_LABEL_MAX ? stored.shown_as : short, detail: stored.shown_as };
}

/**
 * ⛔ THE BUTTON NAMES THE FIGURE IT SAVES, READ FROM THE PROPOSAL IT APPROVES (Paul's test on served
 * `d5d5839`, #69 5832088673). The reply asked "Shall I save the £50,000 assumption?" and the chip beside
 * it read "Use as starting option levels": a label fixed per tool, not a description of the action.
 *
 * The words come from the STORED proposal (the figures `authorise_change` will write) and the proposer's
 * own result for that same id (the option and factor labels, the unit) — never from the Agent's prose,
 * which can name a different figure. The two must agree figure for figure, or the chip keeps today's
 * label: one figure → "Save £50,000 for Hire PA" / "Set Churn to 6%"; several starting figures → "Use
 * these 3 starting figures"; anything else (a link, a new option, a revision of several values, a figure
 * that cannot be shown exactly as stored) → the tool's own label. Never longer than
 * {@link APPROVAL_LABEL_MAX}: the entity's label is shortened with an ellipsis, never the figure.
 */
export const APPROVAL_LABEL_MAX = 40;
const FIGURE_OPS: ReadonlySet<string> = new Set(['set_factor_value', 'set_option_intervention']);
const CURRENCY_UNIT = /^(?:gbp|usd|eur|£|\$|€)$/i;
const MIN_ENTITY_CHARS = 6;

const entriesOf = (x: unknown): Record<string, unknown>[] =>
  (Array.isArray(x) ? x.filter((e): e is Record<string, unknown> => e !== null && typeof e === 'object') : []);

/** The figure in the user's units, exactly as stored, or null when it cannot be shown exactly. Also names a goal target's figure. */
export function figureInUserUnits(value: unknown, unit: unknown): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
  const u = typeof unit === 'string' ? unit.trim() : '';
  // "GBP/year", "£ per month": the currency figure, then its period.
  const perPeriod = /^(.+?)\s*(?:\/|\bper\b)\s*(.+)$/i.exec(u);
  const currencyPer = perPeriod !== null && CURRENCY_UNIT.test(perPeriod[1]!.trim()) ? perPeriod : null;
  const base = currencyPer !== null ? currencyPer[1]!.trim() : u;
  // Money in whole units only: "£50,000.5" is not a figure anyone says.
  if (CURRENCY_UNIT.test(base) && !Number.isInteger(value)) return null;
  const f = formatFactorValueApprox(value, base);
  // A rounded figure is not the figure the approval writes.
  if (f === null || f.approximate) return null;
  return currencyPer !== null ? `${f.display}/${currencyPer[2]!.trim()}` : f.display;
}

/**
 * `head + entity + tail` within the cap, shortening only the entity, and only at a word: a clipped word
 * ("Set Monthly n… to 60 subscriptions/month", served to Paul 27 Sep, B3) reads as a typo. Null when what is left
 * cannot be read (fewer than {@link MIN_ENTITY_CHARS}), so the chip keeps the tool's own label.
 */
function fitted(head: string, entity: unknown, tail: string): string | null {
  const name = typeof entity === 'string' ? entity.trim() : '';
  const room = APPROVAL_LABEL_MAX - head.length - tail.length;
  if (name === '' || room < MIN_ENTITY_CHARS) return null;
  if (name.length <= room) return `${head}${name}${tail}`;
  const cut = name.slice(0, room - 1);
  const atWord = /\s/.test(name[room - 1]!) ? cut : cut.replace(/\s*\S*$/, '');
  const short = atWord.replace(/[\s,;:.\-\u2013\u2014]+$/, '');
  return short.length < MIN_ENTITY_CHARS ? null : `${head}${short}\u2026${tail}`;
}

export function approvalLabelFor(tool: string, source: ApprovalLabelSource | undefined): string {
  const fallback = APPROVE[tool]?.label ?? 'Make this change';
  const proposal = source?.proposal;
  const result = source?.result;
  if (proposal === undefined || result === undefined || result.ok !== true || result.proposal_id !== proposal.proposal_id) return fallback;
  const ops = proposal.operations;
  /**
   * ⛔ LEVELS THE USER GAVE ARE RECORDED, NOT "STARTING" ONES (AI Conversation #70 5848452740): beside "the levels are
   * your stated figures" the chip read "Use as starting option levels" — the per-tool fallback, since the links the
   * levels need are not figures. Option levels, only the links they need, and every level the user's: it says so.
   */
  const levelOps = ops.filter((o) => o.op === 'set_option_intervention');
  const levelLink = (o: (typeof ops)[number]): boolean => o.op === 'add_edge' && (o.value as { link_for_level?: unknown } | undefined)?.link_for_level === true;
  // One level alone keeps its "Save £X for …" label below.
  const byUser = levelOps.filter((o) => (o.value as { authored_by?: unknown } | undefined)?.authored_by === 'user_stated').length;
  if (ops.length > 1 && levelOps.length > 0 && ops.every((o) => o.op === 'set_option_intervention' || levelLink(o)) && byUser > 0) {
    if (byUser === levelOps.length) return levelOps.length === 1 ? 'Record this level' : `Record these ${levelOps.length} levels`;
    /**
     * ⛔ A MIXED BATCH NAMES BOTH (AI Conversation #70 5850225237 U8, served on 24df058): the user's 6% churn and Olumi's
     * AI-availability estimate were one approval, and the chip read "Use as starting option levels", calling the user's
     * own figure a starting estimate. It says what is recorded and how many of those are Olumi's.
     */
    const olumi = levelOps.length - byUser;
    return `Record ${levelOps.length} levels (${olumi} Olumi estimate${olumi === 1 ? '' : 's'})`;
  }
  if (ops.length === 0 || ops.some((o) => !FIGURE_OPS.has(o.op))) return fallback;
  // ⛔ The user's own figures are RECORDED, never "starting assumptions" (AIQ 5909998288; the card rides in `detail`).
  const usersOwn = tool === 'propose_assumptions' && allUsersOwnValues(proposal);
  const ownFallback = usersOwn ? (ops.length === 1 ? 'Record your figure' : `Record your ${ops.length} figures`) : fallback;
  if (ops.length > 1) {
    // A revision the user asked for replaces figures already there: it is not a set of starting figures.
    const revises = ops.some((o) => o.op === 'set_factor_value' && (o.value as { authored_by?: unknown } | undefined)?.authored_by === 'user_stated');
    return revises ? ownFallback : `Use these ${ops.length} starting figures`;
  }
  const op = ops[0]!;
  const stored = (op.value ?? {}) as { raw?: unknown; value?: unknown; unit?: unknown };
  const levels = [...entriesOf(result.interventions), ...entriesOf(result.option_levels)];
  const values = entriesOf(result.assumptions);
  if (op.op === 'set_option_intervention') {
    const shown = levels.length === 1 && values.length === 0 ? levels[0]! : undefined;
    if (shown === undefined || typeof stored.raw !== 'number' || shown.value !== stored.raw) return fallback;
    const figure = figureInUserUnits(stored.raw, shown.unit);
    return (figure !== null ? fitted(`Save ${figure} for `, shown.option, '') : null) ?? fallback;
  }
  const shown = values.length === 1 && levels.length === 0 ? values[0]! : undefined;
  if (shown === undefined || typeof stored.value !== 'number' || shown.value !== stored.value || shown.unit !== stored.unit) return ownFallback;
  const figure = figureInUserUnits(stored.value, stored.unit);
  return (figure !== null ? fitted('Set ', shown.factor, ` to ${figure}`) : null) ?? ownFallback;
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
  const proposalId = id.slice(APPROVE_PREFIX.length);
  // `gmh_…` is a held add-option or add-risk on the product's own seam (C52, SLICE C2): the same typed, zero-call approval.
  return /^prop_[0-9a-f]{6,64}$/.test(proposalId) || /^gmh_[0-9a-f]{12}$/.test(proposalId) ? proposalId : undefined;
}
