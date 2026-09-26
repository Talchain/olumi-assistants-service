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
import type { ToolResult } from './runtime/agent-tools.js';

const APPROVE: Readonly<Record<string, { label: string; message: string }>> = {
  propose_starting_point: { label: 'Use as starting assumptions', message: 'Yes, use those.' },
  propose_assumptions: { label: 'Use as starting assumptions', message: 'Yes, use those.' },
  propose_option_interventions: { label: 'Use as starting option levels', message: 'Yes, use those.' },
  propose_model_change: { label: 'Make this change', message: 'Yes, make that change.' },
  // #1788's add-option proposal: the same typed, zero-call approval as every other proposal.
  propose_new_option: { label: 'Add this option', message: 'Yes, add that option.' },
  // The goal's current level, as the user stated it (`goal-current-level.ts`).
  propose_goal_current_level: { label: 'Record this current level', message: 'Yes, record it.' },
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
  if (tool === 'propose_new_option' && /^gmh_/.test(proposalId) && held !== undefined) {
    const label = typeof held.public_label === 'string' && held.public_label.trim() !== '' ? held.public_label : approve.label;
    const message = typeof held.held_message === 'string' && held.held_message.trim() !== '' ? held.held_message : approve.message;
    return [{ id: approvalChipIdFor(proposalId), label, message }, AMEND_CHIP];
  }
  return [{ id: approvalChipIdFor(proposalId), label: approvalLabelFor(tool, labelSourceFor?.(proposalId)), message: approve.message }, AMEND_CHIP];
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

/** The figure in the user's units, exactly as stored, or null when it cannot be shown exactly. */
function figureInUserUnits(value: unknown, unit: unknown): string | null {
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

/** `head + entity + tail` within the cap, shortening only the entity; null when it cannot fit legibly. */
function fitted(head: string, entity: unknown, tail: string): string | null {
  const name = typeof entity === 'string' ? entity.trim() : '';
  const room = APPROVAL_LABEL_MAX - head.length - tail.length;
  if (name === '' || room < MIN_ENTITY_CHARS) return null;
  return `${head}${name.length <= room ? name : `${name.slice(0, room - 1).trimEnd()}\u2026`}${tail}`;
}

export function approvalLabelFor(tool: string, source: ApprovalLabelSource | undefined): string {
  const fallback = APPROVE[tool]?.label ?? 'Make this change';
  const proposal = source?.proposal;
  const result = source?.result;
  if (proposal === undefined || result === undefined || result.ok !== true || result.proposal_id !== proposal.proposal_id) return fallback;
  const ops = proposal.operations;
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
  // `gmh_…` is a held add-option on the product's own seam (C52): the same typed, zero-call approval.
  return /^prop_[0-9a-f]{6,64}$/.test(proposalId) || /^gmh_[0-9a-f]{12}$/.test(proposalId) ? proposalId : undefined;
}
