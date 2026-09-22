/**
 * Replacement conversation layer — durable conversation memory.
 *
 * WHY THIS EXISTS
 * ---------------
 * Measured on two live sessions (20 Sep 2026, CEE `3f238b1`): the context pack
 * already carries the brief, the graph, the analysis and readiness. What it
 * does NOT carry is anything the user established *during* the conversation.
 * Three consequences, all witnessed:
 *
 *   1. A user supplied hard evidence — a budget figure, a past campaign's
 *      response rate, a conversion change — and two turns later the product
 *      answered "tell me what you want to change". The evidence existed only
 *      as conversation text, so a window slice dropped it.
 *   2. The assistant proposed a specific change, the user said "yes, make that
 *      update now", and the reply was "I don't have a pending suggested update
 *      to apply". The proposal was never a durable object.
 *   3. The user contradicted the model's reading twice; neither contradiction
 *      survived into any later turn.
 *
 * So this module holds the conversation's ESTABLISHED STATE as typed records,
 * separately from the transcript, so it survives summarisation, later turns
 * and reopening.
 *
 * THE RULE THIS MODULE EXISTS TO ENFORCE
 * --------------------------------------
 * A summary may compress history. It may NEVER collapse epistemic state.
 * A thing the user asserted, a thing the assistant merely suggested, an
 * unresolved question, a disagreement, and a change the user actually
 * authorised are five different kinds of thing. Flattening "the assistant
 * proposed X" into "X" is a fabrication route straight into the next prompt,
 * and it is exactly how an unapplied suggestion becomes a stated fact.
 *
 * Therefore:
 *   · kinds are closed and never promoted in place (see {@link recordItem});
 *   · corrections SUPERSEDE, they never overwrite — the store is append-only;
 *   · every context projection emits the kind alongside the text, and
 *     {@link renderItemsForContext} is the only sanctioned projection.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 * It does not decide consent, it does not write to the graph, and it does not
 * assert that an `authorised_change` actually persisted. Authorisation and
 * save receipts are the mutation path's job; this module only records that a
 * receipt was observed, and stores the receipt's own identifiers so a later
 * turn can reconcile its claim against the store rather than against memory.
 */

/**
 * The five distinct epistemic states, plus the authorised-change terminal.
 *
 * ⚠ CLOSED SET, AND ORDER-INDEPENDENT. Do not add a kind that means "probably
 * true" or "the user seemed to agree" — a hedge kind re-opens exactly the
 * collapse this type exists to prevent. If a new distinction is genuinely
 * needed, it gets its own member and its own rendering label.
 */
export type ConversationItemKind =
  /** The user asserted this as true of their world. Highest standing. */
  | 'user_fact'
  /** What the user wants, will not accept, or is constrained by. */
  | 'user_preference'
  /** The assistant put this forward. NOT a fact and NOT authorised. */
  | 'ai_suggestion'
  /** Raised and unresolved — by either party. Carries no truth claim. */
  | 'open_question'
  /** The user contradicted the model, the analysis or the assistant. */
  | 'disagreement'
  /** The user authorised a change AND a save receipt was observed. */
  | 'authorised_change';

/** Lifecycle. Records are never deleted, only moved out of `live`. */
export type ConversationItemStatus = 'live' | 'superseded' | 'withdrawn';

export interface ConversationItem {
  readonly id: string;
  readonly kind: ConversationItemKind;
  /** The user's own words where possible; never a model paraphrase of a fact. */
  readonly text: string;
  /** Provenance: the turn that introduced it. Required — an item with no
   *  source cannot be reconciled later, and an unreconcilable claim is the
   *  defect this module was written for. */
  readonly source_turn_id: string;
  readonly recorded_at: string;
  readonly status: ConversationItemStatus;
  /** Set when a later item replaces this one. Points forward, never back. */
  readonly superseded_by?: string;
  /**
   * `authorised_change` only. The proposal this change was authorised from and
   * the receipt that proved it persisted. Both are required for the kind —
   * see {@link recordItem}, which refuses the kind without them.
   */
  readonly proposal_id?: string;
  readonly receipt_id?: string;
}

export interface ConversationMemory {
  readonly items: readonly ConversationItem[];
}

export const EMPTY_CONVERSATION_MEMORY: ConversationMemory = { items: [] };

/** Thrown for a programming error that would corrupt epistemic state. */
export class EpistemicStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EpistemicStateError';
  }
}

export interface RecordItemInput {
  readonly id: string;
  readonly kind: ConversationItemKind;
  readonly text: string;
  readonly source_turn_id: string;
  readonly recorded_at: string;
  /** Required when `kind === 'authorised_change'`. */
  readonly proposal_id?: string;
  /** Required when `kind === 'authorised_change'`. */
  readonly receipt_id?: string;
  /** When set, that item moves to `superseded` and points at this new one. */
  readonly supersedes?: string;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Append one item. Pure — returns a new memory, never mutates the input.
 *
 * Refusals are deliberate and are the point of the module:
 *
 * · `authorised_change` WITHOUT both a proposal id and a receipt id is
 *   refused. That combination is the only evidence that a user authorised
 *   something and that it landed. Permitting it "just this once" is how
 *   "Updated Monthly Churn Rate" was emitted for a turn the product then
 *   denied twice.
 * · Superseding an item that does not exist is refused, because a dangling
 *   supersede silently leaves the stale item live.
 * · Superseding across kinds is refused. A correction replaces a claim of the
 *   SAME kind; an `ai_suggestion` cannot supersede a `user_fact`, which would
 *   let the assistant overwrite what the user said.
 */
export function recordItem(
  memory: ConversationMemory,
  input: RecordItemInput,
): ConversationMemory {
  if (!isNonEmpty(input.id)) throw new EpistemicStateError('item id is required');
  if (!isNonEmpty(input.text)) throw new EpistemicStateError('item text is required');
  if (!isNonEmpty(input.source_turn_id)) {
    throw new EpistemicStateError('source_turn_id is required — an item with no provenance cannot be reconciled');
  }
  if (memory.items.some((i) => i.id === input.id)) {
    throw new EpistemicStateError(`duplicate item id: ${input.id}`);
  }

  if (input.kind === 'authorised_change') {
    if (!isNonEmpty(input.proposal_id) || !isNonEmpty(input.receipt_id)) {
      throw new EpistemicStateError(
        'authorised_change requires BOTH proposal_id and receipt_id — ' +
          'consent without a receipt is a claim, not a change',
      );
    }
  }

  let items = memory.items;

  if (input.supersedes !== undefined) {
    const target = items.find((i) => i.id === input.supersedes);
    if (target === undefined) {
      throw new EpistemicStateError(`cannot supersede unknown item: ${input.supersedes}`);
    }
    if (target.kind !== input.kind) {
      throw new EpistemicStateError(
        `cannot supersede a ${target.kind} with a ${input.kind} — ` +
          'a correction replaces a claim of the same kind',
      );
    }
    items = items.map((i) =>
      i.id === input.supersedes
        ? { ...i, status: 'superseded' as const, superseded_by: input.id }
        : i,
    );
  }

  const item: ConversationItem = {
    id: input.id,
    kind: input.kind,
    text: input.text,
    source_turn_id: input.source_turn_id,
    recorded_at: input.recorded_at,
    status: 'live',
    ...(input.proposal_id === undefined ? {} : { proposal_id: input.proposal_id }),
    ...(input.receipt_id === undefined ? {} : { receipt_id: input.receipt_id }),
  };

  return { items: [...items, item] };
}

/** Withdraw an item without replacing it. Append-only: status change, no delete. */
export function withdrawItem(
  memory: ConversationMemory,
  id: string,
): ConversationMemory {
  if (!memory.items.some((i) => i.id === id)) {
    throw new EpistemicStateError(`cannot withdraw unknown item: ${id}`);
  }
  return {
    items: memory.items.map((i) => (i.id === id ? { ...i, status: 'withdrawn' as const } : i)),
  };
}

export function liveItems(memory: ConversationMemory): readonly ConversationItem[] {
  return memory.items.filter((i) => i.status === 'live');
}

export function liveItemsOfKind(
  memory: ConversationMemory,
  kind: ConversationItemKind,
): readonly ConversationItem[] {
  return liveItems(memory).filter((i) => i.kind === kind);
}

/**
 * The label each kind renders under. These reach a prompt, so they are written
 * to be unambiguous to a model reading them cold — not to be terse.
 *
 * ⚠ Every kind MUST have a distinct label. Two kinds sharing a label is the
 * collapse this module prevents, so {@link renderItemsForContext} asserts it.
 */
const KIND_LABELS: Readonly<Record<ConversationItemKind, string>> = {
  user_fact: 'THE USER STATED AS FACT',
  user_preference: 'THE USER WANTS OR REQUIRES',
  ai_suggestion: 'YOU SUGGESTED (not agreed, not applied)',
  open_question: 'STILL OPEN',
  disagreement: 'THE USER DISAGREED',
  authorised_change: 'THE USER AUTHORISED AND THIS WAS SAVED',
};

/** Stable render order: what the user established first, what is unresolved
 *  next, and what is merely proposed last — so a model skimming the top of the
 *  section reads the strongest claims first. */
const RENDER_ORDER: readonly ConversationItemKind[] = [
  'user_fact',
  'user_preference',
  'disagreement',
  'authorised_change',
  'open_question',
  'ai_suggestion',
];

/**
 * The ONLY sanctioned projection of conversation memory into a prompt.
 *
 * Every line carries its kind. There is deliberately no "just the text"
 * accessor on this module: a caller that wants the strings without the kinds
 * is building the exact flattening this module exists to prevent, and it
 * should have to write that itself and justify it in review.
 *
 * Returns `null` when there is nothing live, so the caller omits the whole
 * section rather than emitting an empty heading that reads as "nothing was
 * established" — absence of a section and an empty section are different
 * claims, and the second one is false.
 */
export function renderItemsForContext(memory: ConversationMemory): string | null {
  const live = liveItems(memory);
  if (live.length === 0) return null;

  const seen = new Set<string>();
  for (const kind of Object.keys(KIND_LABELS) as ConversationItemKind[]) {
    const label = KIND_LABELS[kind];
    if (seen.has(label)) {
      throw new EpistemicStateError(
        `two kinds share the render label "${label}" — kinds must stay distinguishable in the prompt`,
      );
    }
    seen.add(label);
  }

  const sections: string[] = [];
  for (const kind of RENDER_ORDER) {
    const ofKind = live.filter((i) => i.kind === kind);
    if (ofKind.length === 0) continue;
    const lines = ofKind.map((i) => `- ${i.text}`).join('\n');
    sections.push(`${KIND_LABELS[kind]}:\n${lines}`);
  }
  return sections.join('\n\n');
}

/**
 * Reconcile a claim the assistant is about to make about what it changed,
 * against what the memory actually records.
 *
 * This is the "protections cannot live only at the tool boundary" check: a
 * valid tool call does not make the sentence describing it true. A turn that
 * asserts it applied something must name an `authorised_change` that exists.
 *
 * Returns the ids that could not be substantiated. Empty means the claim is
 * supported by the record.
 */
export function unsubstantiatedChangeClaims(
  memory: ConversationMemory,
  claimedChangeIds: readonly string[],
): readonly string[] {
  const authorised = new Set(
    liveItemsOfKind(memory, 'authorised_change').map((i) => i.id),
  );
  return claimedChangeIds.filter((id) => !authorised.has(id));
}
