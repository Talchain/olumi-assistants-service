/**
 * Part-accounting conservation law — intake-side decomposition of an edit
 * message into countable sub-requests, and attribution of the operations
 * that came back (LLM or deterministic) against those sub-requests.
 *
 * WHY THIS EXISTS (rehearsal defect A + B's CEE half, 2026-07-20 —
 * REHEARSAL-DEFECT-TRIAGE-2026-07-20.md, byte-verified):
 *
 *   "Change Support cost to 30, and add a new factor called Shipping costs
 *    that reduces Gross margin."
 *
 * On the live wire the value half VANISHED: #549's deterministic compound
 * batch only engages for >= 2 label+quantity VALUE pairings (value +
 * structural mixes return `not_compound`), so the whole message went to the
 * LLM edit lane, where prompt v11 routes missing-target sub-instructions to
 * `warnings` — a channel the held branch discards by contract
 * (edit-graph.ts Mode-B). The user was never told half their ask
 * evaporated. Worse (defect B), the link target 'Gross margin' did not
 * exist in the server graph and the LLM silently substituted a different
 * outcome node.
 *
 * THE LAW (fail-closed): every decomposed part must terminate in exactly
 * one of {applied, held, refused-with-reason, clarify}, and the compose
 * step must account for ALL of them in the user-visible reply. When the
 * operations that came back cannot be attributed to cover every part, the
 * uncovered parts go to CLARIFY — never silence. When a user-NAMED target
 * is absent from the graph and the ops link to a different existing node
 * instead, that is a SUBSTITUTION and the batch fails closed to clarify —
 * never a silent stand-in. This makes the guarantee a checked invariant,
 * independent of LLM emission behaviour and prompt wording.
 *
 * DESIGN CONSTRAINTS:
 *  - EXTEND, don't fork: #549's `tryCompoundValueUpdate` +
 *    `compound-value-update-chain.ts` remain the sole owners of the
 *    value+value batch lifecycle. This module only covers what that
 *    machinery is scope-blind to (value+structural / N-part mixes), and
 *    its disclosure copy follows the same DISCLOSED-PARTIAL doctrine.
 *  - CONSERVATIVE detection: every detector MISS degrades to today's
 *    behaviour (no accounting), never worse; every detection ADDS
 *    accounting. Single-part messages must never grow a disclosure
 *    (the false-compound trap), so accounting only engages at >= 2
 *    accountable parts.
 *  - Numeric token grammar derives from CQE's source strings
 *    (CURRENCY_SYMBOL_SOURCE / NUMERIC_SUFFIX_SOURCE) — derive, don't
 *    mirror (the hand-maintained-mirror defect class).
 *  - 'constraint' is deliberately NOT a structural noun here: constraint
 *    phrasings are owned by the value-update-gate's clause D routing and
 *    the edit_graph lane has no constraint operation at all — claiming
 *    them here would reroute them into a known dead end.
 *
 * All copy builders in this file: British English, no em dashes, no
 * internal vocabulary, and phrasing swept against BOTH
 * FORBIDDEN_USER_FACING_PHRASES (lexical denial) and SUCCESS_CLAIM_PATTERNS
 * (lexical success) — "I haven't taken that forward" is deliberate: it is
 * neither a denial-of-any-change nor a success claim.
 */

import {
  CURRENCY_SYMBOL_SOURCE,
  NUMERIC_SUFFIX_SOURCE,
} from '../context/cqe/rules.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EditPartKind =
  | 'value'
  | 'structural_add'
  | 'structural_remove'
  | 'link'
  /** A clause with a conjunction seam but no recognisable edit intent
   *  ("run the analysis", "tell me more"). NEVER accounted — other
   *  machinery owns those; failing closed on low confidence here would
   *  spray clarifies over legitimate messages. */
  | 'other';

export interface DecomposedEditPart {
  /** Document-order index over ALL segments (including 'other'). */
  readonly index: number;
  /** The raw clause text (trimmed slice of the user message). */
  readonly text: string;
  readonly kind: EditPartKind;
  /**
   * Names of EXISTING model elements the user pointed at: the value-edit
   * target ("Support cost"), the relational object ("Gross margin" in
   * "that reduces Gross margin"), the removal target. These are the
   * defect-B check inputs: a named target absent from graph AND ops is a
   * refuse-or-clarify, never a silent stand-in.
   */
  readonly namedTargets: readonly string[];
  /**
   * Names the user is CREATING ("called Shipping costs"). Never treated
   * as graph references; used to match add_node operations to this part.
   */
  readonly newLabels: readonly string[];
}

export interface EditPartDecomposition {
  readonly parts: readonly DecomposedEditPart[];
  /** Parts that participate in conservation accounting (kind !== 'other'). */
  readonly accountableParts: readonly DecomposedEditPart[];
  /**
   * True when the message mixes >= 1 value part with >= 1 structural/link
   * part — the exact scope #549's compound VALUE detector is blind to.
   * Used by route-v2 to stand the value-update suppressor down so the
   * whole message reaches the one lane that can serve both halves.
   */
  readonly mixedValueStructural: boolean;
}

// ---------------------------------------------------------------------------
// Detection grammar
// ---------------------------------------------------------------------------

/** Value-edit verbs (base forms — imperative voice). The inflected
 *  third-person forms ("reduces") are RELATIONAL, not imperative, and are
 *  deliberately excluded here — see RELATIONAL_VERB_PATTERN. */
const VALUE_EDIT_VERB_PATTERN =
  /\b(?:set|change|update|increase|decrease|reduce|raise|lower|adjust)\b/i;

/** A CQE-shaped numeric token: optional currency symbol, digits (with
 *  thousands separators / decimals), optional multiplier suffix or percent.
 *  Both optional pieces reuse the CQE source grammars verbatim. */
const NUMERIC_TOKEN_SOURCE =
  `(?:${CURRENCY_SYMBOL_SOURCE})?\\s*\\d[\\d,]*(?:\\.\\d+)?\\s*(?:%|(?:${NUMERIC_SUFFIX_SOURCE}))?`;

/** "to <number>" / "by <number>" — the connector that makes a clause a
 *  VALUE edit rather than a kind-change or structural request. */
const VALUE_CONNECTOR_PATTERN = new RegExp(
  `\\b(?:to|by)\\s+${NUMERIC_TOKEN_SOURCE}`,
  'i',
);

/** Target extraction for a value clause: the noun phrase between the edit
 *  verb (plus optional determiner) and the to/by connector. */
const VALUE_TARGET_PATTERN =
  /\b(?:set|change|update|increase|decrease|reduce|raise|lower|adjust)\s+(?:the\s+|my\s+|our\s+|its\s+|their\s+)?(.{1,60}?)\s+(?:to|by)\s/i;

const STRUCTURAL_ADD_VERB_PATTERN = /\b(?:add|create|introduce)\b/i;
const STRUCTURAL_REMOVE_VERB_PATTERN = /\b(?:remove|delete)\b/i;

/** Node-kind nouns that make an add/remove clause a STRUCTURAL request.
 *  'constraint' deliberately absent — see the module doc. */
const STRUCTURAL_NOUN_PATTERN =
  /\b(?:factor|risk|option|outcome|driver|goal|node|variable|lever|edge|link|connection)s?\b/i;

/** Naming constructions that carry a NEW label. */
const NAMING_PATTERN =
  /\b(?:called|named|labelled|labeled|titled)\s+["'‘’“”]?(.{1,60}?)["'‘’“”]?(?=$|[,.;:!?]|\s+(?:that|which|to|with|and|so)\b)/i;

/**
 * Third-person relational verbs — the object is a NAMED EXISTING target
 * ("that reduces Gross margin"). Inflected forms only: the base forms
 * double as imperative edit verbs and must not be claimed here.
 */
const RELATIONAL_VERB_PATTERN =
  /\b(?:reduces|increases|decreases|affects|impacts|influences|improves|boosts|lowers|raises|strengthens|weakens|drives|feeds)\s+(?:the\s+)?["'‘’“”]?(.{1,60}?)["'‘’“”]?(?=$|[,.;:!?]|\s+(?:and|by|when|if|because|so|which|that)\b)/i;

/** Standalone link clause ("link it to Gross margin"). */
const LINK_VERB_PATTERN =
  /\b(?:link|connect)\b[^,;.]*?\bto\s+(?:the\s+)?["'‘’“”]?(.{1,60}?)["'‘’“”]?(?=$|[,.;:!?])/i;

/** Removal-target extraction ("remove the Shipping costs factor"). */
const REMOVE_TARGET_PATTERN =
  /\b(?:remove|delete)\s+(?:the\s+|my\s+|our\s+)?(.{1,60}?)(?=\s*(?:$|[,.;:!?])|\s+(?:factor|risk|option|outcome|node|edge|link)s?\b|\s+from\b)/i;

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

/** Sentence-level boundaries; decimals ("3.5") carry no following space so
 *  they never split. */
const SENTENCE_SPLIT = /[.;!?]+\s+/;

/** Conjunction seam candidates within a sentence. */
const CONJUNCTION_SEAM = /,?\s+\b(?:and|then|also|plus)\b\s+/gi;

/** A bare comma directly followed by an edit-verb-initial clause is also a
 *  clause boundary ("Change X to 30, add a factor called Y"). The verb
 *  lookahead keeps ordinary list commas intact. */
const COMMA_VERB_SEAM =
  /,\s+(?=(?:set|change|update|increase|decrease|reduce|raise|lower|adjust|add|create|introduce|remove|delete|link|connect)\b)/gi;

/** True when the seam sits between two numeric tokens ("between 5 and 10",
 *  "by 5 and 10") — a numeric range/list, never a clause boundary. */
function seamIsNumericRange(before: string, after: string): boolean {
  return /\d[\s]*$/.test(before.trimEnd()) && /^\s*(?:£|\$|€)?\d/.test(after);
}

// ---------------------------------------------------------------------------
// Quote-aware scanning (Codex F6)
// ---------------------------------------------------------------------------
//
// A conjunction/comma seam that sits INSIDE a quoted label is not a clause
// boundary, and a quoted label must not be truncated at an interior
// conjunction. Proven live: "add a factor called 'Shipping and handling' and
// set Cost to 3" split on the FIRST interior "and" into a truncated
// structural_add ("…called 'Shipping") plus an orphan "handling'", and the
// replay chip (edit-graph-dispatch.ts) then re-dispatched the truncated clause,
// mutating the user's entity name. The regex grammar had no quote state; this
// stateful scanner supplies it (ASCII straight quotes + smart quotes, with
// backslash-escape handling).

/** Opening quote char → its matching closer. */
const QUOTE_CLOSERS: Readonly<Record<string, string>> = {
  "'": "'",
  '"': '"',
  '‘': '’', // ‘ ’
  '“': '”', // “ ”
};

function isLetterOrDigit(ch: string | undefined): boolean {
  return ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
}

/**
 * Boolean mask, one entry per code unit of `s`, true where the position lies
 * inside a WELL-FORMED quote span (opener + matching closer, inclusive).
 * Escaped quotes (`\'`) inside a span do not close it. ASCII straight quotes
 * are disambiguated from apostrophes: a `'`/`"` with a letter/digit on the
 * inner side is a contraction/possessive, not a quote delimiter, so it never
 * opens or closes a span (keeps "don't" / "it's" from masking real seams).
 * An unbalanced opener masks nothing — the char is treated as ordinary.
 */
function computeQuoteMask(s: string): boolean[] {
  const mask = new Array<boolean>(s.length).fill(false);
  let i = 0;
  while (i < s.length) {
    const ch = s[i]!;
    const closer = QUOTE_CLOSERS[ch];
    if (closer === undefined) {
      i += 1;
      continue;
    }
    const ambiguous = ch === "'" || ch === '"';
    if (ambiguous && isLetterOrDigit(s[i - 1])) {
      i += 1; // mid-word apostrophe/possessive — not a quote opener
      continue;
    }
    // Scan for the matching closer, honouring backslash escapes.
    let j = i + 1;
    let found = -1;
    while (j < s.length) {
      if (s[j] === '\\') {
        j += 2;
        continue;
      }
      if (s[j] === closer) {
        if (ambiguous && isLetterOrDigit(s[j + 1])) {
          j += 1; // mid-word — not a closer
          continue;
        }
        found = j;
        break;
      }
      j += 1;
    }
    if (found === -1) {
      i += 1; // unbalanced opener — treat as ordinary char
      continue;
    }
    for (let k = i; k <= found; k += 1) mask[k] = true;
    i = found + 1;
  }
  return mask;
}

/**
 * Split `text` on every match of `seam` whose delimiter lies entirely OUTSIDE a
 * quoted span, optionally skipping matches for which `skip(before, after)`
 * returns true (delimiter discarded). A fresh globally-flagged clone of `seam`
 * is used so shared module-level `lastIndex` state is never mutated.
 */
function splitOutsideQuotes(
  text: string,
  seam: RegExp,
  skip?: (before: string, after: string) => boolean,
): string[] {
  const mask = computeQuoteMask(text);
  const re = new RegExp(seam.source, seam.flags.includes('g') ? seam.flags : `${seam.flags}g`);
  const pieces: string[] = [];
  let cursor = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const seamStart = m.index;
    const seamEnd = m.index + m[0].length;
    let quoted = false;
    for (let k = seamStart; k < seamEnd; k += 1) {
      if (mask[k]) {
        quoted = true;
        break;
      }
    }
    if (quoted) continue;
    const before = text.slice(cursor, seamStart);
    const after = text.slice(seamEnd);
    if (skip && skip(before, after)) continue;
    pieces.push(before);
    cursor = seamEnd;
  }
  pieces.push(text.slice(cursor));
  return pieces;
}

function splitIntoSegments(message: string): string[] {
  const segments: string[] = [];
  const sentences = splitOutsideQuotes(message, SENTENCE_SPLIT)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  for (const sentence of sentences) {
    const clauses = splitOutsideQuotes(sentence, CONJUNCTION_SEAM, seamIsNumericRange)
      .map((c) => c.trim())
      .filter((c) => c.length > 0);
    for (const clause of clauses) {
      for (const piece of splitOutsideQuotes(clause, COMMA_VERB_SEAM)) {
        const trimmed = piece.trim();
        if (trimmed.length > 0) segments.push(trimmed);
      }
    }
  }
  return segments;
}

// ---------------------------------------------------------------------------
// Per-segment classification
// ---------------------------------------------------------------------------

function cleanCapture(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  const cleaned = raw
    .replace(/["'‘’“”]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    // Trim trailing punctuation the lookaheads may have left behind.
    .replace(/[,.;:!?]+$/, '')
    .trim();
  // Codex F7: a legitimate label can be a single character ('X') or a short
  // non-Latin token ('成本'). Reject only the empty string and pathologically
  // long spans; short-label matchability is enforced downstream in
  // labelMatches (exact equality for 1-2 char, containment reserved for >= 3).
  if (cleaned.length < 1 || cleaned.length > 60) return null;
  return cleaned;
}

/**
 * Quote-aware label capture (Codex F6): when a naming/relational/link/remove
 * VERB is immediately followed by a quoted span, return the FULL quoted content
 * (interior conjunctions and all) rather than letting the regex lookaheads
 * truncate it at the first " and ". Returns null when there is no quote right
 * after the verb (the caller then keeps the plain regex capture). Honours
 * backslash escapes; the opener here is unambiguously a quote (it follows a
 * verb + whitespace), so no contraction disambiguation is needed.
 */
function extractQuotedLabelAfter(segment: string, prefix: RegExp): string | null {
  const m = prefix.exec(segment);
  if (m === null) return null;
  const start = m.index + m[0].length;
  const opener = segment[start];
  if (opener === undefined) return null;
  const closer = QUOTE_CLOSERS[opener];
  if (closer === undefined) return null;
  let j = start + 1;
  while (j < segment.length) {
    if (segment[j] === '\\') {
      j += 2;
      continue;
    }
    if (segment[j] === closer) {
      return cleanCapture(segment.slice(start + 1, j));
    }
    j += 1;
  }
  return null; // unterminated quote — fall back to the regex capture
}

/** Verb prefixes whose trailing quoted span carries the label/target. Kept in
 *  lock-step with the capture regexes above so a quoted argument is taken whole
 *  regardless of interior conjunctions. */
const NAMING_PREFIX = /\b(?:called|named|labelled|labeled|titled)\s+/i;
const RELATIONAL_PREFIX =
  /\b(?:reduces|increases|decreases|affects|impacts|influences|improves|boosts|lowers|raises|strengthens|weakens|drives|feeds)\s+(?:the\s+)?/i;
const LINK_PREFIX = /\b(?:link|connect)\b[^,;.]*?\bto\s+(?:the\s+)?/i;
const REMOVE_PREFIX = /\b(?:remove|delete)\s+(?:the\s+|my\s+|our\s+)?/i;
const VALUE_PREFIX =
  /\b(?:set|change|update|increase|decrease|reduce|raise|lower|adjust)\s+(?:the\s+|my\s+|our\s+|its\s+|their\s+)?/i;

function classifySegment(segment: string, index: number): DecomposedEditPart {
  const namedTargets: string[] = [];
  const newLabels: string[] = [];

  // Prefer the full quoted span when the verb is followed by a quote (Codex
  // F6), else fall back to the plain regex capture.
  const newLabel =
    extractQuotedLabelAfter(segment, NAMING_PREFIX) ??
    cleanCapture(NAMING_PATTERN.exec(segment)?.[1]);
  if (newLabel !== null) newLabels.push(newLabel);

  const relationalTarget =
    extractQuotedLabelAfter(segment, RELATIONAL_PREFIX) ??
    cleanCapture(RELATIONAL_VERB_PATTERN.exec(segment)?.[1]);

  // STRUCTURAL ADD: add/create/introduce verb anchored by a node-kind noun
  // or an explicit naming construction. Checked BEFORE value: "add a new
  // factor called X that reduces Y" contains no value connector, but a
  // hypothetical "add a factor called X set to 30" must stay structural.
  if (
    STRUCTURAL_ADD_VERB_PATTERN.test(segment) &&
    (STRUCTURAL_NOUN_PATTERN.test(segment) || newLabels.length > 0)
  ) {
    if (relationalTarget !== null) namedTargets.push(relationalTarget);
    return { index, text: segment, kind: 'structural_add', namedTargets, newLabels };
  }

  // STRUCTURAL REMOVE: remove/delete verb anchored by a node-kind noun or
  // naming construction (bare "remove doubt"-style figurative uses carry
  // neither and stay 'other').
  if (
    STRUCTURAL_REMOVE_VERB_PATTERN.test(segment) &&
    (STRUCTURAL_NOUN_PATTERN.test(segment) || newLabels.length > 0)
  ) {
    const removeTarget =
      extractQuotedLabelAfter(segment, REMOVE_PREFIX) ??
      cleanCapture(REMOVE_TARGET_PATTERN.exec(segment)?.[1]);
    if (removeTarget !== null) namedTargets.push(removeTarget);
    return { index, text: segment, kind: 'structural_remove', namedTargets, newLabels };
  }

  // VALUE: imperative edit verb + a "to/by <number>" connector.
  if (VALUE_EDIT_VERB_PATTERN.test(segment) && VALUE_CONNECTOR_PATTERN.test(segment)) {
    const target =
      extractQuotedLabelAfter(segment, VALUE_PREFIX) ??
      cleanCapture(VALUE_TARGET_PATTERN.exec(segment)?.[1]);
    if (target !== null) namedTargets.push(target);
    return { index, text: segment, kind: 'value', namedTargets, newLabels };
  }

  // LINK: explicit link/connect clause, or a bare relational clause that
  // survived segmentation on its own.
  const linkTarget =
    extractQuotedLabelAfter(segment, LINK_PREFIX) ??
    cleanCapture(LINK_VERB_PATTERN.exec(segment)?.[1]);
  if (linkTarget !== null) {
    namedTargets.push(linkTarget);
    return { index, text: segment, kind: 'link', namedTargets, newLabels };
  }
  if (relationalTarget !== null && !VALUE_EDIT_VERB_PATTERN.test(segment)) {
    namedTargets.push(relationalTarget);
    return { index, text: segment, kind: 'link', namedTargets, newLabels };
  }

  return { index, text: segment, kind: 'other', namedTargets, newLabels };
}

/**
 * Decompose an edit-turn message into countable sub-requests. Pure and
 * deterministic; sub-millisecond on the <= 2000-char ingress bound.
 */
export function decomposeEditMessage(message: string): EditPartDecomposition {
  const segments = splitIntoSegments(message);
  const parts = segments.map((segment, i) => classifySegment(segment, i));
  const accountableParts = parts.filter((p) => p.kind !== 'other');
  const hasValue = accountableParts.some((p) => p.kind === 'value');
  const hasStructural = accountableParts.some(
    (p) => p.kind === 'structural_add' || p.kind === 'structural_remove' || p.kind === 'link',
  );
  return {
    parts,
    accountableParts,
    mixedValueStructural: hasValue && hasStructural,
  };
}

// ---------------------------------------------------------------------------
// Attribution — operations vs parts
// ---------------------------------------------------------------------------

/** Structural view of a PatchOperation (V4 edit lane). */
export interface PatchOperationLike {
  readonly op: string;
  readonly path: string;
  readonly value?: unknown;
}

export type MissingTargetIssueKind =
  | 'value_target_missing'
  | 'link_target_missing'
  | 'remove_target_missing';

export interface MissingTargetIssue {
  readonly partIndex: number;
  /** The user's own name for the absent target, verbatim (cleaned). */
  readonly name: string;
  readonly kind: MissingTargetIssueKind;
}

export interface SubstitutionIssue {
  readonly partIndex: number;
  /** The named-but-absent target the user asked for. */
  readonly missingName: string;
  /** Label of the existing node the ops linked to instead. */
  readonly substitutedLabel: string;
  /** Index into the operations array of the substituting edge op. */
  readonly opIndex: number;
}

export interface PartFate {
  readonly part: DecomposedEditPart;
  readonly covered: boolean;
}

export interface EditPartAccounting {
  readonly fates: readonly PartFate[];
  readonly uncoveredParts: readonly DecomposedEditPart[];
  readonly missingTargets: readonly MissingTargetIssue[];
  /** Non-empty = defect-B shape proven: fail the batch closed to clarify. */
  readonly substitutions: readonly SubstitutionIssue[];
}

function norm(s: string): string {
  // Codex F7: NFKC-fold then keep Unicode letters/numbers (plus the currency
  // and percent symbols the value grammar cares about) instead of ASCII-only
  // stripping, so non-Latin labels ('成本', '运输', 'Café') survive
  // normalisation rather than collapsing to the empty string.
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}%£$€ ]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match on normalised labels. Codex F7: short labels (1-2 normalised chars —
 * 'X', 'AI', '成本') are legitimate, so they match by EXACT equality; only
 * labels with >= 3 chars on BOTH sides use symmetric containment (so a 2-char
 * fragment can still never claim coverage of a longer label). Empty
 * normalisations never match.
 */
function labelMatches(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const na = norm(a);
  const nb = norm(b);
  if (na.length === 0 || nb.length === 0) return false;
  if (na.length < 3 || nb.length < 3) return na === nb;
  return na.includes(nb) || nb.includes(na);
}

function asRecord(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

interface NodeRef {
  readonly id: string;
  readonly label: string | null;
}

function collectGraphNodes(graphNodes: ReadonlyArray<unknown>): NodeRef[] {
  const out: NodeRef[] = [];
  for (const n of graphNodes) {
    const rec = asRecord(n);
    if (typeof rec.id !== 'string' || rec.id.length === 0) continue;
    out.push({ id: rec.id, label: typeof rec.label === 'string' ? rec.label : null });
  }
  return out;
}

export interface AccountEditPartsInput {
  /** Accountable parts only (kind !== 'other'). */
  readonly parts: readonly DecomposedEditPart[];
  readonly operations: readonly PatchOperationLike[];
  /** PRE-edit graph nodes (frame authority — what the user's names must
   *  resolve against). */
  readonly graphNodes: ReadonlyArray<unknown>;
}

/**
 * Attribute the returned operations to the decomposed parts.
 *
 * Coverage is deliberately GENEROUS (err toward covered — a false
 * "uncovered" sprays clarify noise) while the substitution check is
 * deliberately NARROW (only the anchored, provable shape: an edge from a
 * node THIS part created to an existing node that does not match the
 * part's named-but-absent target).
 */
export function accountEditParts(input: AccountEditPartsInput): EditPartAccounting {
  const existing = collectGraphNodes(input.graphNodes);

  const addNodes: Array<NodeRef & { opIndex: number }> = [];
  const edges: Array<{ from: string; to: string; opIndex: number }> = [];
  // Removal ops carry an entity identity we can (for remove_node) resolve to a
  // pre-edit label; `nodeId` is the bare node id (op.path — see
  // patch-validation.checkReferentialIntegrity) or null for remove_edge and
  // composite paths that cannot be resolved to a single node.
  const removeOps: Array<{ opIndex: number; nodeId: string | null }> = [];
  for (let i = 0; i < input.operations.length; i += 1) {
    const op = input.operations[i]!;
    if (op.op === 'add_node') {
      const value = asRecord(op.value);
      if (typeof value.id === 'string' && typeof value.label === 'string') {
        addNodes.push({ id: value.id, label: value.label, opIndex: i });
      }
    } else if (op.op === 'add_edge') {
      const value = asRecord(op.value);
      if (typeof value.from === 'string' && typeof value.to === 'string') {
        edges.push({ from: value.from, to: value.to, opIndex: i });
      }
    } else if (op.op === 'remove_node') {
      removeOps.push({ opIndex: i, nodeId: typeof op.path === 'string' ? op.path : null });
    } else if (op.op === 'remove_edge') {
      removeOps.push({ opIndex: i, nodeId: null });
    }
  }

  const existingById = new Map(existing.map((n) => [n.id, n]));

  // Conservation law (#577): each removal PART consumes at most ONE removal op,
  // entity-resolved rather than kind-counted. A single removal op must never
  // mark every removal part covered (the accounting-under-count defect).
  // Two-phase, target-priority: parts whose named target resolves to a removal
  // op's pre-edit label claim that op first; the remainder claim any still
  // unconsumed removal op (edge removals / unresolved ids stay generous, but
  // still one-for-one). Order-independent, so the reply discloses the part the
  // op did NOT serve, not merely the last-listed one.
  const removeCoveredPartIndices = new Set<number>();
  const removeParts = input.parts.filter((p) => p.kind === 'structural_remove');
  if (removeParts.length > 0 && removeOps.length > 0) {
    const consumedOps = new Set<number>();
    const removeOpLabel = (r: { nodeId: string | null }): string | null =>
      r.nodeId !== null ? (existingById.get(r.nodeId)?.label ?? null) : null;
    // Phase 1 — target-resolved matches.
    for (const part of removeParts) {
      const target = part.namedTargets[0] ?? null;
      if (target === null) continue;
      const hit = removeOps.find(
        (r) => !consumedOps.has(r.opIndex) && labelMatches(removeOpLabel(r), target),
      );
      if (hit !== undefined) {
        consumedOps.add(hit.opIndex);
        removeCoveredPartIndices.add(part.index);
      }
    }
    // Phase 2 — generous fallback: any still-uncovered removal part claims any
    // remaining removal op (one each).
    for (const part of removeParts) {
      if (removeCoveredPartIndices.has(part.index)) continue;
      const hit = removeOps.find((r) => !consumedOps.has(r.opIndex));
      if (hit !== undefined) {
        consumedOps.add(hit.opIndex);
        removeCoveredPartIndices.add(part.index);
      }
    }
  }
  const nameExistsSomewhere = (name: string): boolean =>
    existing.some((n) => labelMatches(n.label, name)) ||
    addNodes.some((n) => labelMatches(n.label, name));

  const fates: PartFate[] = [];
  const uncoveredParts: DecomposedEditPart[] = [];
  const missingTargets: MissingTargetIssue[] = [];
  const substitutions: SubstitutionIssue[] = [];

  for (const part of input.parts) {
    let covered = false;

    if (part.kind === 'value') {
      const target = part.namedTargets[0] ?? null;
      covered = input.operations.some((op) => {
        if (op.op === 'update_node') {
          if (target === null) return true;
          const node = existingById.get(op.path);
          const valueLabel = asRecord(op.value).label;
          return (
            labelMatches(node?.label ?? null, target) ||
            labelMatches(typeof valueLabel === 'string' ? valueLabel : null, target)
          );
        }
        if (op.op === 'add_node') {
          // The LLM may legitimately serve a value edit on a missing
          // factor by CREATING it with the requested value.
          if (target === null) return false;
          const value = asRecord(op.value);
          return labelMatches(typeof value.label === 'string' ? value.label : null, target);
        }
        return false;
      });
      if (!covered && target !== null && !nameExistsSomewhere(target)) {
        missingTargets.push({ partIndex: part.index, name: target, kind: 'value_target_missing' });
      }
    } else if (part.kind === 'structural_add') {
      const matchedNewNodes =
        part.newLabels.length > 0
          ? addNodes.filter((n) => part.newLabels.some((l) => labelMatches(n.label, l)))
          : addNodes;
      covered = matchedNewNodes.length > 0;

      // Defect-B check: the part NAMES existing targets (relational
      // objects). Each absent name is a missing-target issue; an edge
      // from THIS part's new node to a different existing node is the
      // proven substitution shape and fails the batch closed.
      for (const name of part.namedTargets) {
        if (nameExistsSomewhere(name)) continue;
        const matchedIds = new Set(matchedNewNodes.map((n) => n.id));
        for (const edge of edges) {
          const anchoredEnd = matchedIds.has(edge.from)
            ? 'from'
            : matchedIds.has(edge.to)
              ? 'to'
              : null;
          if (anchoredEnd === null) continue;
          const otherId = anchoredEnd === 'from' ? edge.to : edge.from;
          const otherExisting = existingById.get(otherId);
          if (otherExisting === undefined) continue; // other end is new too
          if (labelMatches(otherExisting.label, name)) continue; // legitimate
          substitutions.push({
            partIndex: part.index,
            missingName: name,
            substitutedLabel: otherExisting.label ?? otherId,
            opIndex: edge.opIndex,
          });
        }
        missingTargets.push({
          partIndex: part.index,
          name,
          kind: 'link_target_missing',
        });
      }
    } else if (part.kind === 'structural_remove') {
      // Coverage is the one-to-one removal match computed above: a removal op
      // covers exactly one removal part, so "remove A and B" with a single
      // remove op leaves one part uncovered (the conservation law), instead of
      // one op silently satisfying both.
      const target = part.namedTargets[0] ?? null;
      covered = removeCoveredPartIndices.has(part.index);
      if (!covered && target !== null && !nameExistsSomewhere(target)) {
        missingTargets.push({
          partIndex: part.index,
          name: target,
          kind: 'remove_target_missing',
        });
      }
    } else if (part.kind === 'link') {
      const target = part.namedTargets[0] ?? null;
      const endpointMatches = (id: string, name: string): boolean => {
        const node = existingById.get(id);
        if (node !== undefined && labelMatches(node.label, name)) return true;
        const added = addNodes.find((n) => n.id === id);
        return added !== undefined && labelMatches(added.label, name);
      };
      covered =
        target === null
          ? edges.length > 0
          : edges.some((e) => endpointMatches(e.from, target) || endpointMatches(e.to, target));
      if (!covered && target !== null && !nameExistsSomewhere(target)) {
        missingTargets.push({ partIndex: part.index, name: target, kind: 'link_target_missing' });
      }
    }

    fates.push({ part, covered });
    if (!covered) uncoveredParts.push(part);
  }

  return { fates, uncoveredParts, missingTargets, substitutions };
}

// ---------------------------------------------------------------------------
// Compose — deterministic disclosure copy (single source for every lane)
// ---------------------------------------------------------------------------

function clampClause(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length > 90 ? `${cleaned.slice(0, 87)}...` : cleaned;
}

/**
 * British-English Oxford-less enumeration join over pre-formatted items:
 * `[a]` → "a", `[a, b]` → "a and b", `[a, b, c]` → "a, b and c". Quote-
 * agnostic — callers pre-format each item (single- or double-quoted, or bare)
 * so this is the single join used by {@link joinQuoted},
 * {@link buildSubstitutionClarify} and {@link buildMultiPartRejectionClarify}.
 */
export function oxfordJoin(items: readonly string[]): string {
  if (items.length === 1) return items[0]!;
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function joinQuoted(names: readonly string[]): string {
  return oxfordJoin(names.map((n) => `'${n}'`));
}

function dedupe(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    const key = norm(n);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(n);
  }
  return out;
}

/**
 * DISCLOSED-PARTIAL disclosure for the uncovered parts of a partially
 * served compound edit. Returns null when there is nothing to disclose OR
 * when NO part was covered (a full no-op turn already carries its own
 * clarify copy; "You also asked..." framing would be false there).
 *
 * Appended by the edit dispatch immediately before the finaliser egress
 * guard, so the guard backstops this copy like every other emit path.
 */
export function buildPartAccountingDisclosure(
  accounting: EditPartAccounting,
): string | null {
  const anyCovered = accounting.fates.some((f) => f.covered);
  if (!anyCovered) return null;
  if (accounting.uncoveredParts.length === 0 && accounting.missingTargets.length === 0) {
    return null;
  }

  const sentences: string[] = [];
  const missingByPart = new Map<number, MissingTargetIssue[]>();
  for (const issue of accounting.missingTargets) {
    const bucket = missingByPart.get(issue.partIndex);
    if (bucket) bucket.push(issue);
    else missingByPart.set(issue.partIndex, [issue]);
  }

  const spokenMissing = new Set<number>();
  for (const part of accounting.uncoveredParts) {
    const issues = missingByPart.get(part.index) ?? [];
    if (issues.length > 0) {
      const names = dedupe(issues.map((i) => i.name));
      sentences.push(
        `You also asked about ${joinQuoted(names)}, but I can't find ` +
          `${names.length === 1 ? 'that' : 'those'} in the current model, so I haven't taken ` +
          `that part forward. Tell me which part of the model you meant and I'll pick it up.`,
      );
      spokenMissing.add(part.index);
    } else {
      sentences.push(
        `I haven't taken forward this part of your request yet: ` +
          `"${clampClause(part.text)}". Tell me that part on its own and I'll pick it up.`,
      );
    }
  }

  // Missing named targets on parts that otherwise counted as covered
  // (e.g. the add landed but its link object does not exist and no edge
  // was emitted at all).
  const residual = accounting.missingTargets.filter((i) => !spokenMissing.has(i.partIndex));
  if (residual.length > 0) {
    const names = dedupe(residual.map((i) => i.name));
    sentences.push(
      `You mentioned ${joinQuoted(names)}, but I can't find ` +
        `${names.length === 1 ? 'that' : 'those'} in the current model, so I haven't linked ` +
        `anything to ${names.length === 1 ? 'it' : 'them'}. Tell me which part of the model you meant.`,
    );
  }

  if (sentences.length === 0) return null;
  return sentences.join(' ');
}

/**
 * Fail-closed clarify for the proven substitution shape (defect B): the
 * user named a target that does not exist and the ops linked to a
 * different existing node instead. The WHOLE batch is blocked (no partial
 * apply, no held pending that would commit the stand-in on confirm) and
 * this copy enumerates every part with its fate, so the reply accounts
 * for the complete request.
 */
export function buildSubstitutionClarify(
  parts: readonly DecomposedEditPart[],
  accounting: EditPartAccounting,
): string {
  const clauses = parts.map((p) => `"${clampClause(p.text)}"`);
  const enumeration = oxfordJoin(clauses);
  const allMissing = dedupe([
    ...accounting.substitutions.map((s) => s.missingName),
    ...accounting.missingTargets.map((i) => i.name),
  ]);
  const missingList = joinQuoted(allMissing);
  return (
    `Before I take this forward I need to check something. You asked for ${enumeration}. ` +
    `I can't find ${missingList} in the current model, and I don't want to guess a ` +
    `stand-in, so I'm holding off on all of it for now. Tell me which part of the model ` +
    `${allMissing.length === 1 ? 'that name refers to' : 'those names refer to'}, ` +
    `and I'll set the whole thing up together.`
  );
}

/**
 * Full-rejection part clarify (F4, 2026-07-22 — mixed-compound dead-end).
 *
 * When a MIXED value+structural (or any >= 2-accountable-part) edit message
 * is forced whole into the LLM edit lane — because the value-update
 * suppressor stands down for mixed messages (value-update-gate.ts
 * `shouldSuppressEditDispatchForValueUpdate`) — and that lane REJECTS the
 * whole thing (SYNTHESIZED_GRAPH_INVALID / parse_failure / structural_
 * validation), the conservation-law accounting in edit-graph-dispatch.ts is
 * bypassed (it is gated on `!wasRejected`). Today the turn then falls to the
 * generic single-cajole ("I wasn't able to make that change safely. Describe
 * what to change") which DISCARDS the known decomposition and forces the user
 * to re-describe the entire compound — which re-enters the same fragile LLM
 * lane and re-fails. That is the observed cajole LOOP.
 *
 * This builder replaces that context-losing cajole with an honest per-part
 * clarify: every accountable part is named, and (paired with per-part replay
 * chips at the dispatch) the user is invited to send each on its own — where
 * its dedicated DETERMINISTIC lane serves it (a single value edit through the
 * value-update path, a single structural remove/add through the referee gate,
 * each of which is live-verified to terminate cleanly on its own). No part is
 * silent-dropped; the loop is broken because each part now has a terminal.
 *
 * Returns null for < 2 accountable parts — a single-part rejection keeps
 * today's generic recovery copy (the false-compound trap: never grow a
 * multi-part disclosure on a single-part message). Copy follows the same
 * DISCLOSED-PARTIAL discipline as the other builders in this file (British
 * English, no em dashes, clause-quoted verbatim, neither a denial-of-any-
 * change nor a success claim).
 */
export function buildMultiPartRejectionClarify(
  decomposition: EditPartDecomposition,
): string | null {
  const parts = decomposition.accountableParts;
  if (parts.length < 2) return null;
  // parts.length >= 2 is guaranteed above, so oxfordJoin's 2- and 3+-item
  // arms produce byte-identical output to the previous inline enumeration.
  const items = parts.map((p) => `"${clampClause(p.text)}"`);
  const enumeration = oxfordJoin(items);
  return (
    "I wasn't able to make those edits together. Let me take them one at a " +
    `time. Tell me each part on its own and I'll pick it up: ${enumeration}.`
  );
}

/**
 * Cross-boundary invariant (Codex F8): the UI's `SuggestedChips` renders at
 * most three chips (`slice(0, 3)`). CEE must cap the replay actions it emits to
 * the same number — an unbounded list is silently truncated on the wire, so a
 * 4th+ replay clause would have a chip that the user never sees. The dispatch
 * emits `<= MAX_REPLAY_CHIPS` chips and discloses any clauses beyond the cap in
 * prose (see {@link buildReplayOverflowNotice}) so none is hidden.
 */
export const MAX_REPLAY_CHIPS = 3;

/**
 * Honest disclosure of the accountable parts that fall BEYOND the replay-chip
 * cap (Codex F8): those clauses have no clickable chip, so they are named in
 * prose with an instruction to send them as a message. Returns null when the
 * part count is within the cap (nothing is hidden). Same DISCLOSED-PARTIAL
 * vocabulary as the other builders here (British English, no em dashes, neither
 * a denial-of-any-change nor a success claim — swept against both egress
 * detectors).
 */
export function buildReplayOverflowNotice(
  parts: readonly DecomposedEditPart[],
  cap: number = MAX_REPLAY_CHIPS,
): string | null {
  if (parts.length <= cap) return null;
  const overflow = parts.slice(cap).map((p) => `"${clampClause(p.text)}"`);
  const enumeration = oxfordJoin(overflow);
  const many = overflow.length > 1;
  return (
    `I can only show the first ${cap} as buttons here. ` +
    `Send ${many ? 'these parts' : 'this part'} as a message and I'll pick ` +
    `${many ? 'them' : 'it'} up too: ${enumeration}.`
  );
}

/**
 * Deterministic-lane remainder notice: the deterministic value path served
 * the value part(s) of a mixed message; the structural remainder must not
 * vanish. One sentence per structural part, same vocabulary as
 * {@link buildPartAccountingDisclosure}'s generic-uncovered sentence.
 */
export function buildStructuralRemainderNotice(
  decomposition: EditPartDecomposition,
): string | null {
  const structuralParts = decomposition.accountableParts.filter(
    (p) => p.kind === 'structural_add' || p.kind === 'structural_remove' || p.kind === 'link',
  );
  if (structuralParts.length === 0) return null;
  return structuralParts
    .map(
      (p) =>
        `I haven't taken forward this part of your request yet: ` +
        `"${clampClause(p.text)}". Tell me that part on its own and I'll pick it up.`,
    )
    .join(' ');
}
