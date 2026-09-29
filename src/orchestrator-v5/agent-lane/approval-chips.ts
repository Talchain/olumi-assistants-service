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
import type { StructuredProposal } from './proposal.js';
import { CANVAS_BAND_WORD } from '../format/edge-strength-bands.js';
import type { InfluenceBand } from '../format/influence-bands.js';
import type { ToolResult } from './runtime/agent-tools.js';
import { identityApproveMessage, identityReadingOf } from './identity-card.js';
import { optionAdoptionApproveMessage, optionAdoptionReadingOf } from './option-adoption-card.js';

const APPROVE: Readonly<Record<string, { label: string; message: string }>> = {
  propose_starting_point: { label: 'Use as starting assumptions', message: 'Yes, use those.' },
  propose_assumptions: { label: 'Use as starting assumptions', message: 'Yes, use those.' },
  propose_option_interventions: { label: 'Use as starting option levels', message: 'Yes, use those.' },
  propose_model_change: { label: 'Make this change', message: 'Yes, make that change.' },
  // #1788's add-option proposal: the same typed, zero-call approval as every other proposal.
  propose_new_option: { label: 'Add this option', message: 'Yes, add that option.' },
  // The goal's current level, as the user stated it (`goal-current-level.ts`).
  propose_goal_current_level: { label: 'Record this current level', message: 'Yes, record it.' },
  // A link's strength recorded as the user's own (challenge → authorised revision): one button, carried like the rest.
  propose_link_strength: { label: 'Record this link', message: 'Yes, record that.' },
  // A set of link strengths: ONE button records the whole set, as one commit (DL #72 5871594233).
  propose_link_strengths: { label: 'Record these links', message: 'Yes, record those.' },
  // The user's own stated effect on one link ("every £1 loses us about 50"), written through the level door's link_effect.
  propose_link_effect: { label: 'Record this reading', message: 'Yes, record that reading.' },
  // The goal's success target the user stated, written through the product's typed target writer.
  propose_goal_target: { label: 'Set this target', message: 'Yes, set that target.' },
  // SLICE C2: a new risk, held on the product's own seam like the add-option (`gmh_`, the product's words on the button).
  propose_new_risk: { label: 'Add this risk', message: 'Yes, add that risk.' },
  // PJ-E-FIG: new factors carrying the user's figures, held on the same seam as the add-risk (`gmh_`).
  propose_new_factor: { label: 'Add these factors', message: 'Yes, add them.' },
  // SLICE C2: a new figure for a limit the model already holds, written through the product's limit door.
  propose_limit_change: { label: 'Change this limit', message: 'Yes, change that limit.' },
  // The user confirms Olumi's reading of their goal as a product of two of their figures (`identity-card.ts`).
  propose_identity: { label: 'Yes, calculate it that way', message: 'Yes, calculate it that way.' },
  propose_option_adoption: { label: 'Add to comparison', message: 'Yes, add it to the comparison.' },
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
  const held = labelSourceFor?.(proposalId)?.result;
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
  const reading = readingShownFor(tool, labelSourceFor?.(proposalId));
  if (reading !== undefined) return [{ id: approvalChipIdFor(proposalId), ...reading, message: approve.message }, AMEND_CHIP];
  // ⛔ A reading of the goal is confirmed ONLY on a card showing its exact words (`identity-card.ts`): none, no button.
  if (tool === 'propose_identity') {
    const words = identityWordsFor(labelSourceFor?.(proposalId));
    return words === undefined ? []
      : [{ id: approvalChipIdFor(proposalId), label: approve.label, message: identityApproveMessage(words), detail: words }, AMEND_CHIP];
  }
  if (tool === 'propose_option_adoption') {
    const source = labelSourceFor?.(proposalId);
    const reading = source?.proposal === undefined ? undefined : optionAdoptionReadingOf(source.proposal);
    const shown = (source?.result?.card as { words?: unknown } | undefined)?.words;
    return reading === undefined || source?.result?.ok !== true || source.result.proposal_id !== proposalId || shown !== reading.words
      ? [] : [{ id: approvalChipIdFor(proposalId), label: approve.label,
        message: optionAdoptionApproveMessage(reading.words), detail: reading.words }, AMEND_CHIP];
  }
  // ⛔ A link's stated effect is approvable ONLY on a card showing its exact reading (PR Review's fifth CR): none, no button.
  if (tool === 'propose_link_effect') {
    const effectReading = linkEffectReadingFor(tool, labelSourceFor?.(proposalId));
    return effectReading === undefined ? []
      : [{ id: approvalChipIdFor(proposalId), label: approve.label, message: linkEffectApproveMessage(effectReading), detail: effectReading }, AMEND_CHIP];
  }
  return [{ id: approvalChipIdFor(proposalId), label: approvalLabelFor(tool, labelSourceFor?.(proposalId)), message: approve.message }, AMEND_CHIP];
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
  const op = proposal.operations.length === 1 && proposal.operations[0]!.op === 'set_link_effect' ? proposal.operations[0]!.value as
    { effect?: { amount?: unknown; amount_unit?: unknown; per_source_change?: unknown; per_source_change_unit?: unknown }; quote?: unknown } : undefined;
  const link = result.link as { from?: unknown; to?: unknown; your_words?: unknown } | undefined;
  if (op === undefined || link === undefined || link.your_words !== op.quote) return undefined;
  return linkEffectReadingOf(proposal, { from: link.from, to: link.to });
}

/**
 * The reading a link-effect card shows and its approval records: the STORED change with its signs, both ends by their
 * labels, and the user's one sentence. The writer recomputes it from the same stored proposal (`applyLinkEffect`).
 */
export function linkEffectReadingOf(proposal: StructuredProposal, labels: { readonly from: unknown; readonly to: unknown }): string | undefined {
  const op = proposal.operations.length === 1 && proposal.operations[0]!.op === 'set_link_effect' ? proposal.operations[0]!.value as
    { effect?: { amount?: unknown; amount_unit?: unknown; per_source_change?: unknown; per_source_change_unit?: unknown }; quote?: unknown } : undefined;
  const e = op?.effect;
  if (e === undefined || typeof op?.quote !== 'string' || typeof labels.from !== 'string' || typeof labels.to !== 'string'
    || typeof e.amount !== 'number' || typeof e.per_source_change !== 'number' || typeof e.amount_unit !== 'string' || typeof e.per_source_change_unit !== 'string') return undefined;
  const signed = (v: number, unit: string): string => `${v < 0 ? '\u2212' : '+'}${figureInUserUnits(Math.abs(v), unit) ?? `${Math.abs(v)} ${unit}`}`;
  return `Record: ${signed(e.per_source_change, e.per_source_change_unit)} on "${labels.from}" \u2192 ${signed(e.amount, e.amount_unit)} in "${labels.to}" `
    + `\u2014 from your words: "${op.quote}"`;
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
  return typeof message === 'string' && message.startsWith(`${LINK_EFFECT_APPROVE_PREFIX}Record: `)
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
  if (ops.length > 1) {
    // A revision the user asked for replaces figures already there: it is not a set of starting figures.
    const revises = ops.some((o) => o.op === 'set_factor_value' && (o.value as { authored_by?: unknown } | undefined)?.authored_by === 'user_stated');
    return revises ? fallback : `Use these ${ops.length} starting figures`;
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
  if (shown === undefined || typeof stored.value !== 'number' || shown.value !== stored.value || shown.unit !== stored.unit) return fallback;
  const figure = figureInUserUnits(stored.value, stored.unit);
  return (figure !== null ? fitted('Set ', shown.factor, ` to ${figure}`) : null) ?? fallback;
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
