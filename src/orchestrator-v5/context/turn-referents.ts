/**
 * `turn_referents` — THE REFERENT REGISTER (spec §3, minimum for §4.1 rank 2).
 *
 * THE QUESTION THIS ANSWERS, written down before anything is named, because
 * this estate's signature defect is two questions under one name:
 *
 *   > What can the user point at with a word, right now — and where did each
 *   > candidate come from?
 *
 * Named apart from its neighbours, deliberately:
 *
 *   | `graph` / `display_graph` | What is the model?                        |
 *   | `focus`                   | What did the user click?                  |
 *   | `recent_changes`          | What changed in the model?                |
 *   | `analysis` / `run_delta`  | What did the last run say?                |
 *   | `turn_referents` (this)   | What is available to be referred to, and  |
 *   |                           | by whom was it introduced?                |
 *
 * CONSUMERS (the sentence here used to read "no production consumer yet",
 * which was true of the PR that added this module and false from the next PR
 * on): `handlers/edit-graph-dispatch.ts` (the anaphoric no-op recovery) and
 * `turn-executor.ts` (the value pre-route), both through
 * `projectTurnReferentsFromWindow` below and the one resolver in
 * `compose/edit-clarify-response.ts`. The spec's sequencing constraint (§4.3)
 * is why the module landed alone first:
 *
 *   > Removing pronouns from `VAGUE_EDIT_PATTERNS` before the register exists
 *   > sends those messages to the `ambiguous` branch (`assistantText: null`,
 *   > preserve existing copy) — a different bad answer, not a better one.
 *   > Register first, then the routing change, in that order, in separate PRs.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * 1. **No value extraction from LLM prose.** Spec §3.4 splits producers in two
 *    and the split is load-bearing. A deterministic composer knows the entity
 *    and the value BY CONSTRUCTION and may record both. LLM-authored prose gets
 *    a strictly weaker treatment: refs whose label matches EXACTLY against the
 *    graph's own closed label set, and nothing else. `asserted_values` is
 *    therefore always empty for `authored: 'llm'` — asserted by test. Running an
 *    extractor over open natural language is the predicate-breadth trap this
 *    estate has paid for repeatedly, and it is not in this module.
 *
 * 2. **No coreference model, no NLP layer, no entity linking** (spec §9). The
 *    register makes a deterministic bind possible in the unique case and an
 *    honest question possible otherwise. That is the whole ambition.
 *
 * 3. **Absence means unknown, never "no referent"** — hence `source`. An empty
 *    `referents` list is an authoritative "nothing to point at" ONLY when
 *    `source === 'complete'`. This mirrors `recent_changes_status`, and §4.2
 *    routes a `'degraded'` source to ASK rather than to a confident zero.
 *
 * @see spec-context-mgmt.md §3 (the component) and §4 (the contract)
 */

import { NodeKindV3, type NodeKindV3T } from '../../schemas/cee-v3.js';

/**
 * Referent kinds.
 *
 * ⚠ CORRECTION TO SPEC §3.3, derived at the contract bytes rather than
 * inherited: the spec's kind union is
 * `'factor'|'option'|'goal'|'outcome'|'risk'|'decision'|'edge'|'run'|'claim'`,
 * which OMITS `action` — a real member of `NodeKindV3` (`src/schemas/cee-v3.ts`
 * `NodeKindV3 = z.enum(['goal','factor','outcome','decision','risk','action',
 * 'option'])`). A node of kind `action` is a thing a user can point at, so
 * dropping it would make the register silently blind to a whole node class.
 * Included here; the spec is wrong on this point.
 *
 * `edge` / `run` / `claim` are declared so the union does not have to be
 * widened later (a widening would be a breaking change for every exhaustive
 * switch over it), but NO producer in this PR emits them — see the module
 * header on scope.
 */
export type ReferentKind = NodeKindV3T | 'edge' | 'run' | 'claim';

/**
 * How a referent got into the register. The full §3.4 ladder is declared; only
 * `last_assistant_claim` has a producer in this PR (see `RANK_ORDER`).
 */
export type ReferentIntroducedBy =
  | 'user_selection'
  | 'last_assistant_claim'
  | 'last_edit'
  | 'last_analysis'
  | 'pending_question';

/**
 * ⚠ LOAD-BEARING (spec §3.4). `'deterministic'` means a composer that knew the
 * entity and the value by construction recorded them — zero inference.
 * `'llm'` means the ref was recovered by exact label match against the graph's
 * own closed label set, which is enough to ASK and never enough to apply an
 * edit silently. §4 must never bind on an `'llm'`-authored claim without
 * disclosing what it is binding to.
 */
export type ClaimAuthorship = 'deterministic' | 'llm';

export interface ReferentClaim {
  /**
   * A verbatim, bounded EXCERPT of the assistant message the user read — the
   * first `CLAIM_SENTENCE_CAP` characters, not the whole message.
   *
   * ⚠ "EXCERPT", not "the sentence", and the distinction is load-bearing. The
   * label matching that produces `referents` runs over the WHOLE message,
   * because the whole message is what the user read. Only this record is cut.
   * `sentence_truncated` says when the two differ.
   */
  readonly sentence: string;
  /**
   * Refs named INSIDE `sentence` — that is, inside the recorded excerpt, by the
   * same whole-word match that produced the register.
   *
   * ⚠ THIS IS NOT "every ref the message named". Measured on the 5 Sep founder
   * capture at the register's own producer: on 4 of the 9 turns that yield a
   * referent, the assistant message is longer than `CLAIM_SENTENCE_CAP` and
   * names its ref PAST the cut, so an `about` built from whole-message matches
   * named refs this excerpt does not contain. `about` is now computed from the
   * excerpt, so the field is true of the string it sits beside.
   *
   * ⚠ ABSENCE SEMANTICS, the same discipline this module applies to `source`:
   * when `sentence_truncated` is true, a ref MISSING from `about` means "not in
   * the recorded excerpt", never "the message did not name it". The referent
   * itself is still in the register — the cut changes the record, not the
   * candidate set.
   */
  readonly about: readonly string[];
  /**
   * `true` when `sentence` is a cut of a longer message. Absent when the
   * excerpt IS the message.
   */
  readonly sentence_truncated?: true;
  /**
   * Values the sentence asserted about those refs.
   *
   * ⚠ ALWAYS EMPTY when `authored === 'llm'`. See the module header, point 1.
   */
  readonly asserted_values: readonly { readonly ref: string; readonly display: string }[];
  readonly authored: ClaimAuthorship;
}

export interface TurnReferent {
  /** The §3.2 address grammar. Nodes are `node:<id>`. */
  readonly ref: string;
  readonly kind: ReferentKind;
  /** The user's own vocabulary — the node's label, verbatim from the graph. */
  readonly label: string;
  readonly introduced_by: ReferentIntroducedBy;
  /**
   * Turn index for recency ordering; larger is more recent.
   *
   * ⚠ NOT a conversation-wide absolute. It is derived from the loaded
   * conversation WINDOW, which is all any producer can see — so it orders
   * correctly within one turn's own register, and two registers from different
   * turns are not comparable on it. Spec §3.3 calls this "absolute turn index";
   * that is not derivable at either consumer, and a plausible-looking absolute
   * would be a fabricated number.
   */
  readonly introduced_at_turn: number;
  /** 0 = most recent; ties allowed. */
  readonly recency_rank: number;
  /** Present ONLY for `introduced_by === 'last_assistant_claim'`. */
  readonly claim?: ReferentClaim;
}

export interface TurnReferents {
  readonly referents: readonly TurnReferent[];
  /**
   * `'complete'` — the register saw everything it claims to cover.
   * `'capped'`   — the cap cut entries; `referents_omitted` says how many.
   * `'degraded'` — a source could not be read. An empty list under `'degraded'`
   *                is NOT evidence that there is nothing to point at.
   */
  readonly source: 'complete' | 'capped' | 'degraded';
  /** Present only when the cap cut entries. */
  readonly referents_omitted?: number;
}

/**
 * Priority order from spec §4.1. `projectTurnReferents` assigns
 * `recency_rank` from this array's index, so `topPopulatedRank` stays correct
 * as later ranks gain producers — no call site changes when they do.
 *
 * ⚠ Rank 1 (`user_selection`) is deliberately ranked ABOVE the last assistant
 * claim in the spec, but ONLY when the selection changed since the previous
 * turn — which needs a UI-side `selection_changed_at` that does not exist
 * (spec §3.5, a UI change and out of this lane's scope). No producer here.
 */
export const RANK_ORDER: readonly ReferentIntroducedBy[] = Object.freeze([
  'user_selection',
  'last_assistant_claim',
  'last_edit',
  'last_analysis',
  'pending_question',
]);

/** Cap on register entries. Bounded like every other pack slice. */
export const TURN_REFERENTS_CAP = 8;

/**
 * Cap on the recorded claim excerpt, in characters. Bounded at the source
 * rather than at the surface, like every other pack slice.
 *
 * ⚠ NOT A CAP ON WHAT IS MATCHED. Labels are matched against the whole message;
 * only the recorded excerpt is cut, and `ReferentClaim.about` is derived from
 * the excerpt so the record cannot claim more than it holds.
 */
export const CLAIM_SENTENCE_CAP = 400;

export interface ReferentNode {
  readonly id: string;
  readonly label: string;
  readonly kind?: string;
}

export interface ProjectTurnReferentsInput {
  /**
   * The FINAL public assistant answer of the most recent prior turn — the
   * egress-validated prose the user actually read (`assistant_message` as
   * persisted by `commitDirectAnswer`). `null` when there is no prior turn.
   */
  readonly lastAssistantMessage: string | null;
  /** Absolute index of the turn that message belongs to. */
  readonly lastAssistantTurnIndex: number | null;
  /**
   * Who authored that message. Defaults to `'llm'`, which is the WEAKER
   * treatment — a caller that cannot prove determinism must not get the
   * stronger one by omission.
   */
  readonly lastAssistantAuthored?: ClaimAuthorship;
  /** The persisted graph's nodes — the closed label set matching runs against. */
  readonly nodes: readonly ReferentNode[];
  /**
   * `'degraded'` when the conversation read failed. Distinct from "there is no
   * prior turn", which is a complete answer of zero. Conflating the two is how
   * an unreadable source becomes a confident "nothing to point at".
   */
  readonly conversationRead?: 'ok' | 'degraded';
}

/** An empty, authoritative register. */
const EMPTY_COMPLETE: TurnReferents = Object.freeze({
  referents: Object.freeze([]),
  source: 'complete',
});

/** An empty register that proves nothing. */
const EMPTY_DEGRADED: TurnReferents = Object.freeze({
  referents: Object.freeze([]),
  source: 'degraded',
});

/** `node:<id>` per the §3.2 address grammar. */
export function nodeRef(id: string): string {
  return `node:${id}`;
}

/**
 * `node:<id>` → `<id>`, the inverse of {@link nodeRef}. A ref that is not a
 * node address is returned unchanged: both consumers use the result only to
 * address a node the register already named, so a non-node ref degrades to a
 * still-unique id rather than throwing.
 */
export function nodeIdFromRef(ref: string): string {
  return ref.startsWith('node:') ? ref.slice('node:'.length) : ref;
}

/** The one field of a conversation-window turn the producer below reads. */
export interface ConversationWindowTurn {
  readonly assistant_message?: string | null;
}

/**
 * THE PRODUCER'S ENTRY FOR A CONVERSATION WINDOW — the single place that
 * decides which prior turn is "the last assistant claim".
 *
 * `turnsNewestFirst` is the session store's read order (`created_at DESC`).
 * The first entry carrying a non-empty `assistant_message` is the product's own
 * last claim; the current turn is never in the window because its commit
 * happens after dispatch. The index handed to `projectTurnReferents` is
 * WINDOW-RELATIVE (see `TurnReferent.introduced_at_turn`).
 *
 * Two consumers call this with the same window shape so they cannot disagree
 * about which message the register was built from.
 */
export function projectTurnReferentsFromWindow(input: {
  readonly turnsNewestFirst: readonly ConversationWindowTurn[];
  readonly nodes: readonly ReferentNode[];
  readonly conversationRead?: 'ok' | 'degraded';
}): TurnReferents {
  const lastAssistantIdx = input.turnsNewestFirst.findIndex(
    (t) => (t.assistant_message ?? '').trim().length > 0,
  );
  return projectTurnReferents({
    lastAssistantMessage:
      lastAssistantIdx >= 0
        ? (input.turnsNewestFirst[lastAssistantIdx]!.assistant_message ?? null)
        : null,
    lastAssistantTurnIndex:
      lastAssistantIdx >= 0 ? input.turnsNewestFirst.length - 1 - lastAssistantIdx : null,
    nodes: input.nodes,
    ...(input.conversationRead !== undefined
      ? { conversationRead: input.conversationRead }
      : {}),
  });
}

/**
 * DERIVED from `NodeKindV3.options`, never restated.
 *
 * ⚠ THIS REPLACED A HAND-WRITTEN SWITCH, and the reason is worth keeping. The
 * switch listed all seven members with a `default: 'factor'`, so an EIGHTH
 * `NodeKindV3` member would have silently become `factor` — a whole node class
 * mis-kinded, with nothing red anywhere, in the module whose own header
 * complains that spec §3.3 omitted `action`. `structural-add.ts` already uses
 * this derived form for the same enum (`PERSISTABLE_NODE_KINDS`); this is that
 * pattern, not a new one.
 *
 * ⚠ DERIVATION PROVES AGREEMENT, NOT COMPLETENESS (CLAUDE.md trap 12d). What it
 * removes is the drift between this module and the enum. What it cannot tell
 * you is whether the ENUM is right — that is `cee-v3.ts`'s problem, and the
 * `ReferentKind` union type is what keeps the two in step at compile time.
 */
const NODE_REFERENT_KINDS: ReadonlySet<string> = new Set<string>(NodeKindV3.options);

function isNodeReferentKind(kind: string): kind is NodeKindV3T {
  return NODE_REFERENT_KINDS.has(kind);
}

function toReferentKind(kind: string | undefined): ReferentKind {
  // Closed-set check against the contract's own enum members. An unrecognised
  // kind falls back to 'factor' rather than widening the union at runtime.
  return kind !== undefined && isNodeReferentKind(kind) ? kind : 'factor';
}

/** Escape a label for literal use inside a RegExp. */
function escapeForRegExp(source: string): string {
  return source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Does `haystack` contain `label` as a whole-word, case-insensitive run?
 *
 * Word-bounded on purpose. A bare `includes` would match a label inside an
 * unrelated word, and `\b` alone misbehaves when a label starts or ends with a
 * non-word character (e.g. a label wrapped in brackets), so the boundary is
 * asserted with lookarounds against word characters only.
 *
 * Returns the matched length (so the containment rule below can prefer the
 * longer match) or `null` for no match.
 */
function matchedLength(haystack: string, label: string): number | null {
  const trimmed = label.trim();
  if (trimmed.length === 0) return null;
  const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeForRegExp(trimmed)}(?![\\p{L}\\p{N}])`, 'iu');
  return pattern.test(haystack) ? trimmed.length : null;
}

/**
 * THE PRODUCER — spec §4.1 rank 2 (`last_assistant_claim`).
 *
 * Recovers the entity the product itself just named, by EXACT case-insensitive
 * whole-word label match against the graph's closed label set. Nothing is
 * parsed out of open prose; the only strings compared are labels the graph
 * already owns.
 *
 * ⚠ THE CONTAINMENT RULE, and why it is here. If a graph carries both
 * `Sales` and `Sales Headcount Investment`, a sentence naming the latter
 * literally contains the former, so a naive matcher yields TWO candidates and
 * §4.2 would ASK — a false ambiguity manufactured by the matcher, not present
 * in the world. Candidates whose matched label is strictly contained in another
 * matched label (as a whole-word run) are dropped, longest wins. Both
 * directions are asserted by test: the contained case must yield ONE candidate,
 * and two genuinely distinct labels must still yield TWO.
 */
export function projectTurnReferents(input: ProjectTurnReferentsInput): TurnReferents {
  if (input.conversationRead === 'degraded') {
    return EMPTY_DEGRADED;
  }

  const message = input.lastAssistantMessage;
  const turnIndex = input.lastAssistantTurnIndex;
  if (message === null || message.trim().length === 0 || turnIndex === null) {
    // No prior assistant turn is a COMPLETE answer of zero, not a degraded one.
    return EMPTY_COMPLETE;
  }

  const authored: ClaimAuthorship = input.lastAssistantAuthored ?? 'llm';
  const rank = RANK_ORDER.indexOf('last_assistant_claim');

  // 1. Every node whose label appears as a whole word in the sentence.
  const hits: { node: ReferentNode; length: number }[] = [];
  const seenRefs = new Set<string>();
  for (const node of input.nodes) {
    const ref = nodeRef(node.id);
    if (seenRefs.has(ref)) continue;
    const length = matchedLength(message, node.label);
    if (length === null) continue;
    seenRefs.add(ref);
    hits.push({ node, length });
  }

  // 2. Containment rule — drop a hit whose label is a whole-word substring of
  //    another hit's label. Longest wins.
  const kept = hits.filter(
    (hit) =>
      !hits.some(
        (other) =>
          other !== hit &&
          other.length > hit.length &&
          matchedLength(other.node.label, hit.node.label) !== null,
      ),
  );

  if (kept.length === 0) {
    return EMPTY_COMPLETE;
  }

  // 3. Stable order: longest label first (most specific), then by label for a
  //    deterministic tie-break so the same input always yields the same list.
  kept.sort((a, b) => b.length - a.length || a.node.label.localeCompare(b.node.label));

  const capped = kept.slice(0, TURN_REFERENTS_CAP);
  const omitted = kept.length - capped.length;

  const truncated = message.length > CLAIM_SENTENCE_CAP;
  const sentence = truncated ? message.slice(0, CLAIM_SENTENCE_CAP) : message;
  // ⚠ `about` IS COMPUTED FROM `sentence`, NOT FROM `message`. Candidate
  // detection above deliberately runs over the whole message — that is what the
  // user read — but the claim record only holds the excerpt, and a field
  // documented as "refs named inside this sentence" must be true of THIS
  // string. See `ReferentClaim.about` for the measurement that forced this.
  const about = capped
    .filter((hit) => matchedLength(sentence, hit.node.label) !== null)
    .map((hit) => nodeRef(hit.node.id));

  const referents: TurnReferent[] = capped.map((hit) => ({
    ref: nodeRef(hit.node.id),
    kind: toReferentKind(hit.node.kind),
    label: hit.node.label,
    introduced_by: 'last_assistant_claim',
    introduced_at_turn: turnIndex,
    recency_rank: rank,
    claim: {
      sentence,
      about,
      ...(truncated ? { sentence_truncated: true as const } : {}),
      // ⚠ EMPTY FOR 'llm' BY CONSTRUCTION — see the module header, point 1.
      // A deterministic composer supplies its own values; this producer never
      // infers one from prose.
      asserted_values: Object.freeze([]),
      authored,
    },
  }));

  return omitted > 0
    ? { referents, source: 'capped', referents_omitted: omitted }
    : { referents, source: 'complete' };
}

/**
 * The candidates at the TOP POPULATED RANK — the set §4.2 decides on.
 *
 * Generic over `RANK_ORDER`, so when rank 1 / 3 / 4 gain producers this
 * function starts returning them with no call-site change. Returns an empty
 * array when the register is empty for any reason; callers must consult
 * `source` to tell "nothing to point at" from "could not look".
 */
export function candidatesAtTopPopulatedRank(
  register: TurnReferents,
): readonly TurnReferent[] {
  let best: number | null = null;
  for (const referent of register.referents) {
    if (best === null || referent.recency_rank < best) best = referent.recency_rank;
  }
  if (best === null) return [];
  const top = best;
  return register.referents.filter((referent) => referent.recency_rank === top);
}
