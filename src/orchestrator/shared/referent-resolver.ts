/**
 * ⭐⭐ THE REFERENT RESOLVER — the ONE authority for "which stored element does
 * this phrase name?".
 *
 * WHY THIS MODULE EXISTS (the finding, measured at `1690c1f3`).
 * This estate already built a correct label→id resolver. It lived inside the
 * 3,664-line `orchestrator-v5/compose/phase3-blocks.ts`, and its only three
 * non-test importers were PROSE and DISPLAY modules (`projection-summaries`,
 * `structural-pair-evidence`, `sanitise`). A contrast-controlled sweep of the
 * eight server-side WRITE lanes found `resolveLabelToId|buildLabelIndex|
 * AMBIGUOUS_LABEL` = **0 in every one**, against a live `label` contrast of
 * 196 / 100 / 77 / 53 / 41 / 37 / 22 / 19. The instrument could see; there was
 * nothing to see.
 *
 * Instead fourteen private normalisers decided identity per lane. Measured over
 * a ten-label corpus they produce **eight disagreements**; `"Churn rate (%)"`
 * gets three distinct normalisations, a CJK label normalises to the EMPTY
 * STRING under two of them, and the contrast `"Gross margin"` agrees under all
 * fourteen — so the comparison is capable of returning agreement.
 *
 * ⭐ The defect in one sentence: we resolved entity names carefully when
 * writing prose, and carelessly when deciding what to mutate.
 *
 * ⚠ SCOPE — THE SUBJECT AXIS ONLY. This module answers WHICH element a phrase
 * names. It does not answer what ROLE a stated number plays: a correctly
 * resolved subject can still receive a stated limit stored as an observation,
 * because role is rebuilt field-by-field at `src/cee/transforms/schema-v3.ts`.
 * Do not read a green referent result as a correct write.
 *
 * ⛔ THIS FILE IS A FOLD, NOT A REWRITE. Every normalisation, rail and matching
 * primitive below was MOVED verbatim from `phase3-blocks.ts`; `phase3-blocks`
 * re-exports them, so prose output is byte-identical. The only NEW code is
 * {@link Resolution} / {@link resolveReferent} / {@link buildReferentIndex},
 * which ADD a three-state answer without changing any existing one.
 */

import type { TargetRef, TargetRefKindLiteral } from "@talchain/schemas/boundary";

export interface GraphNodeRef {
  readonly id: string;
  readonly label: string;
  readonly kind: TargetRefKindLiteral;
}

/** factor_id → {id, label, kind} resolved from `enrichment.graph.nodes[]`. */
export type GraphNodeLookup = ReadonlyMap<string, GraphNodeRef>;

/**
 * Minimum lever-label length used for the NAMING scan below. A 1–2 char label
 * (an unlabelled or degenerate node) would over-match arbitrary prose, so it is
 * ignored for detection — structural membership (`isLeverFactor`) is unaffected.
 * The length is measured on the NORMALISED, punctuation-stripped label so a
 * label like `"C#"` (one letter after normalisation) is treated as too short.
 */
export const LEVER_LABEL_MIN_LEN = 3;

/**
 * Finding 5 (over-suppression): generic single-word lever labels that collide
 * with ordinary decision prose. A lever whose WHOLE label normalises to just
 * one of these bare words ("Cost", "Time") cannot be distinguished from
 * incidental use of the word in a NON-lever assumption ("Implementation cost
 * estimates are uncertain"), so the free-text NAME scan refuses to suppress on
 * such a label alone — stronger identity (a multi-word phrase, or a distinctive
 * single word) is required. This is a fail-closed choice: err toward keeping an
 * honest surface over silently dropping it on a weak-identity match. STRUCTURAL
 * factor_id suppression (`isLeverFactor`, used by the evidence surfaces) is
 * unaffected — this guard only tempers label-based detection in free text.
 */
export const GENERIC_LEVER_TOKENS: ReadonlySet<string> = new Set([
  'cost', 'costs', 'time', 'price', 'prices', 'value', 'values', 'risk',
  'risks', 'quality', 'revenue', 'budget', 'scope', 'speed', 'effort',
  'resource', 'resources', 'team', 'size', 'rate', 'growth', 'demand',
  'supply', 'margin', 'profit', 'sales', 'people', 'timeline', 'timelines',
]);

/**
 * Finding 5 (under-suppression + Unicode): normalise a label / free-text body
 * for whole-phrase matching. NFKC folds Unicode compatibility forms (curly
 * apostrophes, full-width chars, non-breaking spaces); lower-casing folds case;
 * every run of non-letter/non-number is collapsed to a single space so
 * punctuation cannot block a match — `"Time-to-market"` and `"Time to market"`
 * both normalise to `"time to market"`. Result is trimmed; interior words are
 * single-space separated.
 */
export function normaliseForPhraseMatch(s: string): string {
  return s
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Offset of the FIRST whole-phrase occurrence of `needle` in `haystack`, with
 * letter/number word boundaries on BOTH ends — or `-1` when there is none.
 * Both arguments are expected to be pre-normalised via `normaliseForPhraseMatch`
 * (so only Unicode letters/numbers and single spaces remain). Scans every
 * occurrence so a first boundary-failing hit cannot mask a later valid one.
 * Boundaries use the Unicode letter/number classes so accented words ("café")
 * are bounded correctly.
 *
 * The offset is into the NORMALISED haystack, not the original prose. That is
 * sufficient for ORDERING and nothing else reads it: `normaliseForPhraseMatch`
 * is monotone (NFKC, lower-case, collapse non-alphanumeric runs, trim all map a
 * prefix to a prefix), so relative order is preserved exactly even though
 * absolute positions shift.
 */
export function firstBoundedPhraseAt(haystack: string, needle: string, from = 0): number {
  if (needle.length === 0) return -1;
  for (;;) {
    const at = haystack.indexOf(needle, from);
    if (at < 0) return -1;
    const before = at === 0 ? '' : haystack[at - 1]!;
    const afterIdx = at + needle.length;
    const after = afterIdx >= haystack.length ? '' : haystack[afterIdx]!;
    const boundedBefore = before === '' || !/[\p{L}\p{N}]/u.test(before);
    const boundedAfter = after === '' || !/[\p{L}\p{N}]/u.test(after);
    if (boundedBefore && boundedAfter) return at;
    from = at + 1;
  }
}

/**
 * Whole-phrase containment — the boolean face of {@link firstBoundedPhraseAt},
 * which is the single owner of the scan (one derivation, two read points, so a
 * boundary-rule change can never apply to one caller and not the other).
 *
 * A bare shared token must NOT match a DIFFERENT phrase — on live staging the
 * lever "Equity Offered to CTO" and a non-lever assumption both contain "CTO",
 * so a token match would over-suppress.
 *
 * ⚠ NOTE WHAT THIS DOES NOT DO, because a docstring here previously claimed it
 * did: bounded matching stops "CTO" matching inside "director", it does NOT
 * stop a node genuinely LABELLED "CTO" from matching prose that names "Equity
 * Offered to CTO" — there, "CTO" is a bounded whole word and both labels match.
 * Choosing between them is an ORDERING question, settled in
 * {@link resolveProseEntityRefs} by the longer-label tie-break.
 */
export function containsWholePhrase(haystack: string, needle: string): boolean {
  return firstBoundedPhraseAt(haystack, needle) >= 0;
}

// ============================================================================
// Wave-4 δ1 — the ONE shared entity→node-id resolver (ROADMAP 1.202 + 1.135).
//
// DERIVED (not mirrored, trap-12) from the forward `GraphNodeLookup` above: the
// reverse `label → id` index is a pure O(nodes) derivation of the SAME map, so it
// cannot desync — it has no independent source. Two consumers share it:
//   - 1.202 (the ui_directive emitter, δ2) uses the FORWARD path (id → ref) it
//     already has — every deterministic fact names its subject by id;
//   - 1.135 (clickable coach copy) uses this REVERSE path (label → id) to link
//     entity NAMES inside LLM-authored prose to their nodes.
// Fail-closed everywhere: a duplicate normalised label is AMBIGUOUS → never
// linked (we do not guess which node the prose meant); a too-short / bare-generic
// label is not linked in prose (reusing the shipped over-match rails); a miss is
// unlinked. Reuses `normaliseForPhraseMatch` + `containsWholePhrase` +
// `LEVER_LABEL_MIN_LEN` + `GENERIC_LEVER_TOKENS` — the exact matching rails the
// lever-naming guard already ships, so a producer label change or new node kind
// flows through automatically (one input, no second list to maintain).
// ============================================================================

/**
 * Sentinel: a normalised label shared by TWO OR MORE nodes. Such a label resolves
 * to nothing (fail-closed unlinked) — the required ambiguity ruling. A unique
 * `symbol` so it can never collide with a real string id.
 */
export const AMBIGUOUS_LABEL: unique symbol = Symbol('AMBIGUOUS_LABEL');

/** Reverse index: normalised label → the single node id that owns it, or
 *  `AMBIGUOUS_LABEL` when two+ nodes share the normalised label. */
export type LabelIndex = ReadonlyMap<string, string | typeof AMBIGUOUS_LABEL>;

/**
 * Narrow override for a caller that already carries a typed canonical-identity
 * warrant. Generic single-word labels stay blocked by default because ordinary
 * prose cannot establish that a word such as "cost" names a model element.
 */
export interface ProseEntityReferenceOptions {
  readonly allowGenericSingleWordLabels?: boolean;
  readonly genericAllowedIds?: ReadonlySet<string>;
  readonly preferLongestMention?: boolean;
}

/**
 * Build the reverse `label → id` index from a forward `GraphNodeLookup`.
 * Duplicate normalised label → `AMBIGUOUS_LABEL`. Pure + deterministic.
 *
 * ⭐ NOW A PROJECTION, NOT A SECOND PASS. This used to walk the lookup itself,
 * which would have made it a hand-maintained mirror of
 * {@link buildReferentIndex} the moment the two normalisations drifted. It is
 * now the {@link deriveLabelIndex} view of the one multimap, so there is
 * nothing to keep in step (trap 12).
 *
 * Behaviour is unchanged and pinned both ways: the shipped
 * `entity-resolver.test.ts` suite was written against the original walk, and
 * `referent-resolver.test.ts` asserts this projection against an independent
 * hand-written corpus (a derived guard proves agreement and can never prove
 * completeness — trap 12d, so both guards ship).
 */
export function buildLabelIndex(lookup: GraphNodeLookup): LabelIndex {
  return deriveLabelIndex(buildReferentIndex(lookup));
}

/**
 * Resolve a single candidate label token to its node id, or `null`. Fail-closed
 * on: too-short / bare-generic label (would over-match), ambiguous (duplicate)
 * label, or a miss. Reuses the shipped normalisation + over-match rails so a lone
 * "Cost" / "AI" / "C#" never links.
 */
export function resolveLabelToId(index: LabelIndex, rawLabel: string): string | null {
  const key = normaliseForPhraseMatch(rawLabel);
  if (key.length < LEVER_LABEL_MIN_LEN) return null;
  if (!key.includes(' ') && GENERIC_LEVER_TOKENS.has(key)) return null;
  const resolved = index.get(key);
  if (resolved === undefined || resolved === AMBIGUOUS_LABEL) return null;
  return resolved;
}

/**
 * True when prose names a label that the canonical reverse index marks as
 * ambiguous. This is the fail-closed companion to
 * {@link resolveProseEntityRefs}: that resolver deliberately omits ambiguous
 * references, while callers answering an explicit relationship question need
 * to distinguish "no second model element was named" from "a named element
 * maps to more than one canonical identity".
 *
 * Uses the exact same normalisation, whole-phrase and over-match rails as the
 * resolver. It does not create a second label-matching authority.
 */
export function hasAmbiguousProseEntityReferenceWithOptions(
  index: LabelIndex,
  prose: string,
  options: ProseEntityReferenceOptions = {},
): boolean {
  const hay = normaliseForPhraseMatch(prose);
  if (hay.length === 0) return false;
  for (const [needle, resolved] of index) {
    if (resolved !== AMBIGUOUS_LABEL) continue;
    if (needle.length < LEVER_LABEL_MIN_LEN) continue;
    if (
      options.allowGenericSingleWordLabels !== true &&
      !needle.includes(' ') &&
      GENERIC_LEVER_TOKENS.has(needle)
    ) continue;
    if (firstBoundedPhraseAt(hay, needle) >= 0) return true;
  }
  return false;
}

export function hasAmbiguousProseEntityReference(
  index: LabelIndex,
  prose: string,
): boolean {
  return hasAmbiguousProseEntityReferenceWithOptions(index, prose);
}

/**
 * 1.135 — scan LLM-authored prose for the graph node labels it NAMES and return
 * one deduped `TargetRef` per unambiguously-resolved node, **ordered by first
 * mention in the prose**.
 *
 * Whole-phrase, both-ends-bounded matching; too-short / bare-generic
 * single-word labels are skipped; a label shared by two nodes
 * (`AMBIGUOUS_LABEL`) links to NEITHER. Pure; no producer value is read — only
 * the node's own display label.
 *
 * ⭐ WHY THE ORDER IS PROSE ORDER AND NOT LOOKUP ORDER (ROADMAP 2.1023).
 * This function used to return refs in `lookup.values()` order — i.e. the order
 * the PRODUCER happened to emit its nodes in, which the reader cannot see and
 * which has nothing to do with the sentence. Two consumers read `[0]` as "the
 * entity this card is about": the card's own `target_refs` pills, and
 * `ui_directive` row 7, which MOVES THE USER'S VIEWPORT. Measured across the 14
 * committed captures (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/
 * mutation-witness-2026-08-10`): **12 of 21 multi-ref coaching cards listed
 * their entities in an order that contradicted their own sentence**, the
 * dominant shape being `"The link from <factor> to <goal> assumes…"` rendered
 * as `[goal, factor]`.
 *
 * ⚠ THIS IS A PURE REORDERING. The set of resolved refs is byte-identical —
 * every rail above still decides membership, and this function still cannot
 * add, drop, or invent a ref. Only the sequence changes. That is deliberate:
 * salience is NOT inferred from graph structure (influence, degree, rank).
 * The card named these entities in prose; the prose is the only evidence, and a
 * structural salience score would be a fabricated number wearing computed
 * clothes.
 *
 * TIE-BREAK — LONGER LABEL FIRST, and it is load-bearing. When a node labelled
 * `"CTO"` and one labelled `"Equity Offered to CTO"` both exist, prose naming
 * the longer phrase matches BOTH (see {@link containsWholePhrase} — bounded
 * matching does not prevent this). Ordering by offset alone already prefers the
 * longer one whenever the shorter sits INSIDE it and starts later; the
 * tie-break covers the remaining case, prefix containment
 * (`"Onboarding"` vs `"Onboarding friction"`), where both start at the same
 * offset. Together they make a separate longest-match rule unnecessary.
 *
 * Final tie-break is the original lookup order, so the result stays TOTAL and
 * DETERMINISTIC (never dependent on `Array.prototype.sort` stability).
 */
export function resolveProseEntityRefsWithOptions(
  lookup: GraphNodeLookup,
  index: LabelIndex,
  prose: string,
  options: ProseEntityReferenceOptions = {},
): readonly TargetRef[] {
  const hay = normaliseForPhraseMatch(prose);
  if (hay.length === 0) return [];
  const matched: Array<{
    ref: TargetRef;
    at: number;
    len: number;
    ordinal: number;
  }> = [];
  const seen = new Set<string>();
  let ordinal = 0;
  for (const ref of lookup.values()) {
    ordinal++;
    const needle = normaliseForPhraseMatch(ref.label);
    if (needle.length < LEVER_LABEL_MIN_LEN) continue;
    // A bare generic single word ("cost") over-matches ordinary decision prose —
    // require a distinctive single word or a multi-word phrase (same rule as the
    // lever-naming guard's Finding-5 tempering).
    if (
      !needle.includes(' ') &&
      GENERIC_LEVER_TOKENS.has(needle) &&
      !(
        options.allowGenericSingleWordLabels === true &&
        options.genericAllowedIds?.has(ref.id) === true
      )
    ) continue;
    let at = firstBoundedPhraseAt(hay, needle);
    if (at < 0) continue;
    // Fail-closed on ambiguity: a duplicate normalised label resolves to
    // AMBIGUOUS_LABEL → link to neither node.
    const resolved = index.get(needle);
    if (resolved === undefined || resolved === AMBIGUOUS_LABEL) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    do {
      matched.push({
        ref: { id: ref.id, label: ref.label, kind: ref.kind },
        at,
        len: needle.length,
        ordinal,
      });
      // A second standalone "Cost" must remain visible even when its first
      // occurrence was nested inside "Engineering Build Cost".
      at = options.preferLongestMention === true
        ? firstBoundedPhraseAt(hay, needle, at + needle.length)
        : -1;
    } while (at >= 0);
  }
  matched.sort(
    (a, b) => a.at - b.at || b.len - a.len || a.ordinal - b.ordinal,
  );
  if (options.preferLongestMention !== true) return matched.map((m) => m.ref);
  let coveredUntil = -1;
  const visibleIds = new Set<string>();
  const visible: TargetRef[] = [];
  for (const match of matched) {
    const end = match.at + match.len;
    if (end <= coveredUntil) continue;
    coveredUntil = end;
    if (visibleIds.has(match.ref.id)) continue;
    visibleIds.add(match.ref.id);
    visible.push(match.ref);
  }
  return visible;
}

export function resolveProseEntityRefs(
  lookup: GraphNodeLookup,
  index: LabelIndex,
  prose: string,
): readonly TargetRef[] {
  return resolveProseEntityRefsWithOptions(lookup, index, prose);
}

// ============================================================================
// ⭐⭐ THE THREE-STATE ANSWER — the load-bearing addition.
//
// `resolveLabelToId` returns `string | null`, and `null` means BOTH "nothing
// matched" AND "two things matched". For the prose question those collapse
// harmlessly: either way you decline to link, and a wrong link costs a bad
// hyperlink. For the WRITE question they are opposite findings with opposite
// remedies — "I do not hold that element" needs a different sentence from
// "I hold two and cannot tell which you mean", and only the second can be
// settled by ASKING. Flattening them is precisely why the ratified exit (ask
// the user) could only ever be taken in one lane.
// ============================================================================

/** One node that a normalised phrase could name. */
export interface ReferentCandidate {
  readonly id: string;
  readonly label: string;
}

/**
 * The answer to "which stored element does this phrase name?".
 *
 * `ambiguous` CARRIES ITS CANDIDATES, because a caller that must ask the user
 * has to name the options; an ask that cannot list them is not an exit.
 */
export type Resolution =
  | { readonly kind: "bound"; readonly id: string; readonly label: string }
  | { readonly kind: "ambiguous"; readonly candidates: readonly ReferentCandidate[] }
  | { readonly kind: "unknown" };

/**
 * ⭐⭐ THE RAILS ARE A PROPERTY OF THE QUESTION, NOT OF THE CALLER — and this
 * distinction is the whole reason moving the resolver is not itself the
 * two-authorities trap.
 *
 * `resolveLabelToId` refuses a label that is under {@link LEVER_LABEL_MIN_LEN}
 * normalised characters, and refuses a bare generic single word ("cost").
 * Those rails are NOT facts about identity. They exist because the prose path
 * performs a HAYSTACK SCAN: it hunts for labels *inside* a sentence an LLM
 * wrote, where "cost" appears incidentally in text that was not referring to
 * anything. Fail-closed is free there — a wrong answer costs a bad hyperlink.
 *
 * A caller that holds a CANDIDATE — the phrase the user themselves used to
 * refer to something — has no incidental-match risk to defend against, because
 * the user typed the word *in order to* name the element. Applying the scan
 * rails there answers a question that caller never asked, and fail-closed is
 * expensive: a wrong answer costs the user their edit.
 *
 * ⛔⛔ AND HERE IS THE CORRECTION THAT MATTERS, because the first version of
 * this docstring got it wrong in a way that would have made the product WORSE.
 *
 * It said "a WRITE LANE is not scanning a haystack". **That is false, and it is
 * false for the lane this module was extracted to serve.** Measured at the
 * bytes:
 *
 * TWO SCAN AND CARRY THEIR OWN RAIL:
 *   - `option-effect-write.ts` — `matchLabels` runs `phraseOccurrences` over
 *     `params.message`, gated by `normalised.length < 3`;
 *   - `repair-value-binding.ts:932` — `padded.includes(...)` gated by
 *     `label.length < 3`, and its comment states the incidental-collision
 *     rationale outright: *"shorter labels collide with ordinary words and
 *     would decline every sentence containing one"*.
 *
 * ⛔ AND TWO SCAN WITH NO RAIL AT ALL — which is the more important half, and
 * an earlier version of this very docstring got it wrong by lumping all four
 * together as "already carry the rail". That error ran in the direction that
 * makes the estate look SAFER than it is, so it is corrected explicitly:
 *   - `whatif/resolve-target-option.ts:290` — variable literally named
 *     `haystack`; **it has no label-length rail.** Every `label.length` in that
 *     file is span arithmetic (`haystack.length - label.length`,
 *     `start + label.length`), not a minimum-length guard;
 *   - `edit-graph.ts:992` — **UNGATED**:
 *     `normalisedMessage.includes(normaliseMatchingText(target.label))`, a bare
 *     substring containment with no length bound, which then SHORT-CIRCUITS on
 *     `exactMatches.length > 0`. The `length > 2` + stopword rail in this file
 *     lives at `:917`/`:924`, inside `resolveTokenOverlapMatches` — a path this
 *     scan returns before ever reaching.
 *
 * **So: four of the eight write lanes scan haystacks; two of those four are
 * unprotected today.** ⇒ Converting a RAILED one to `candidate` would strip its
 * rail and produce MORE WRONG BINDING — worse than the "more asking" failure
 * this design was written to avoid, and in the opposite direction. The two
 * UNRAILED ones are a separate, pre-existing exposure that this module does not
 * fix and must not be read as fixing.
 *
 * ⭐ **The scope is a property of WHAT THE CALL SITE DOES, never of which layer
 * it lives in.** Ask of each site: does it hold a referring phrase, or is it
 * hunting labels inside a sentence? `post-analysis-label-intercept.ts:150` is
 * the write-side site that genuinely holds a candidate — and applies the rail
 * anyway. That is the shape `candidate` exists for.
 *
 * ⚠ TWO LIMITS ON THE "STRICTLY MORE" PROPERTY, both load-bearing:
 *  1. It is proven against `scan` — **a comparator no write lane uses today.**
 *     Against the matcher those lanes actually use (`fuzzyMatchNodeId`),
 *     `candidate` is NARROWER in 5 of 16 realistic cases, and in 0 of 5 does it
 *     return `ambiguous`: all five are `unknown`, **which cannot be settled by
 *     asking.** Before converting any lane, re-prove the property against the
 *     matcher THAT LANE uses, and treat a move from a binding to `unknown` as a
 *     REGRESSION, not a safe refusal.
 *
 *     ⭐ THAT CONSTRAINT HAS ALREADY EARNED ITS KEEP. Run pre-emptively against
 *     `post-analysis-label-intercept.ts`'s own matcher over 14 cases:
 *     **5 WIDENED** (edits users lose today, recovered), 4 agree, 2 bind→ask
 *     (honest, recoverable), and **2 bind→`unknown` REGRESSIONS** — symbol-only
 *     labels that normalise to the EMPTY STRING, which cannot be settled by
 *     asking. The conversion also FIXES A SILENT WRONG-BIND: on a genuine
 *     duplicate that lane binds to the FIRST match, where the resolver asks.
 *     ⛔ Close the empty-normalisation case BEFORE move 3, not after — it is
 *     concrete, it is fixable, and it is the whole reason the constraint exists.
 *  2. The three-state answer exists only on the EXACT-KEY path, so it is
 *     unavailable to the four haystack lanes as they stand — the ask it was
 *     meant to enable cannot fire there without a span-matching entry point.
 *
 * Ambiguity and miss are genuine identity facts and are reported in BOTH
 * scopes. Only their CONSEQUENCE differs, and that belongs to the caller.
 */
export type ReferentScope =
  /**
   * Hunting labels inside text we did not write (LLM prose, or a user message
   * scanned for any label it happens to contain). Over-match rails ON.
   */
  | "scan"
  /**
   * The caller already holds this phrase as a referring expression. Rails OFF.
   * ⛔ Not "a write lane" — four of the eight write lanes are `scan` sites.
   */
  | "candidate";

/**
 * Normalised label → EVERY node that owns it. The single derivation both
 * {@link LabelIndex} and {@link resolveReferent} read, so the two can never
 * disagree — there is no second pass to keep in step (trap 12).
 */
export type ReferentIndex = ReadonlyMap<string, readonly ReferentCandidate[]>;

/**
 * Build the multimap. Same normalisation and same empty-key skip as
 * {@link buildLabelIndex}, which is now DERIVED from this (see
 * {@link deriveLabelIndex}) rather than computed alongside it.
 */
export function buildReferentIndex(lookup: GraphNodeLookup): ReferentIndex {
  const index = new Map<string, ReferentCandidate[]>();
  for (const ref of lookup.values()) {
    const key = normaliseForPhraseMatch(ref.label);
    if (key.length === 0) continue;
    const bucket = index.get(key);
    if (bucket === undefined) index.set(key, [{ id: ref.id, label: ref.label }]);
    else bucket.push({ id: ref.id, label: ref.label });
  }
  return index;
}

/**
 * Project the multimap onto the legacy {@link LabelIndex}.
 *
 * Exactly one owner ⇒ that id (the first writer, i.e. lookup order — the same
 * node `buildLabelIndex` chose). Two or more ⇒ `AMBIGUOUS_LABEL`, which
 * `buildLabelIndex` also never reverted once set. This is a projection of one
 * source, not a mirror of a second pass.
 */
export function deriveLabelIndex(referents: ReferentIndex): LabelIndex {
  const index = new Map<string, string | typeof AMBIGUOUS_LABEL>();
  for (const [key, bucket] of referents) {
    index.set(key, bucket.length === 1 ? bucket[0]!.id : AMBIGUOUS_LABEL);
  }
  return index;
}

/**
 * ⭐ Resolve one referring phrase to a stored element, in three states.
 *
 * `scope` selects the calibration described on {@link ReferentScope}: same
 * authority, same normalisation, same ambiguity fact — question-specific rails.
 */
export function resolveReferent(
  referents: ReferentIndex,
  rawLabel: string,
  scope: ReferentScope = "scan",
): Resolution {
  const key = normaliseForPhraseMatch(rawLabel);
  if (key.length === 0) return { kind: "unknown" };
  if (scope === "scan") {
    // Haystack-scan rails. See {@link ReferentScope} for why these are absent
    // from `candidate`: they defend against incidental matches in prose we did
    // not write, and a user-supplied referring phrase is not that.
    if (key.length < LEVER_LABEL_MIN_LEN) return { kind: "unknown" };
    if (!key.includes(" ") && GENERIC_LEVER_TOKENS.has(key)) return { kind: "unknown" };
  }
  const bucket = referents.get(key);
  if (bucket === undefined || bucket.length === 0) return { kind: "unknown" };
  if (bucket.length > 1) return { kind: "ambiguous", candidates: bucket };
  return { kind: "bound", id: bucket[0]!.id, label: bucket[0]!.label };
}

// ============================================================================
// ⭐⭐ SELF-REFERENCE — the discriminator for "this node IS the sentence".
//
// ⛔⛔ DEFINED HERE, DELIBERATELY NOT WIRED. Read this before using it.
// ============================================================================

/**
 * Does a candidate target node merely RESTATE the constraint that is looking
 * for a target?
 *
 * ⭐ WHY THIS EXISTS. A sibling lane settled, at the bytes and by execution,
 * that a correctly-stored limit never reaches compute — and that the root cause
 * is BINDING, not transport (CEE forwards `snapshot.goal_constraints`, and PLoT
 * names our own constraint id back). The mechanism is a matcher of exactly the
 * kind this module exists to replace: `fuzzyMatchNodeId`'s label fallback
 * (`src/validators/structural-reconciliation.ts:392`) is substring-based and
 * requires exactly one match. The node CEE itself minted FROM the limit
 * sentence contains the user's subject verbatim; the real factor, named
 * slightly differently, does not. **The self-referential node wins uniquely,
 * and wins precisely because the correct node is named differently.**
 *
 * ⭐ NOTE THE PERVERSITY, because it is the case this module's three-state
 * answer exists for: the VAGUER phrase matches both nodes and is dropped, so
 * the user gets asked; the MORE SPECIFIC and more correct phrase binds
 * silently to the wrong node. Fail-closed fires on the vague input and fails
 * OPEN on the precise one — the exact inversion of what we want.
 *
 * ⛔ `kind` IS NOT THE DISCRIMINATOR, and that has been measured and rejected
 * TWICE. `MINTABLE_TARGET_KINDS` excludes `risk` by name, and the filter looks
 * irresistible. It is wrong: a prior lane measured it removing the bad
 * bindings and buying a binding to "Remaining Annual Budget" — trading a silent
 * gap for a confident wrong number — and an independent run binds a limit to a
 * `risk` node that is a LEGITIMATE metric ("Voluntary Attrition Rate"), which
 * the filter would have broken. Do not re-propose it.
 *
 * ⭐ THIS PREDICATE IS PROVENANCE IDENTITY, NOT STRING SIMILARITY. It does not
 * ask whether two labels look alike — it asks whether the node's own recorded
 * `source_quote` IS the constraint's. That is why it needs no new
 * natural-language predicate, and why it does not proxy for `kind`.
 *
 * MEASURED: target arm 3/3 TRUE (the three refusals); contrast arm 1/1 FALSE
 * on a node of the SAME `risk` kind carrying a real metric; 0 hits across 105
 * nodes / 36 distinct labels in the very corpus that killed the kind-based fix.
 *
 * ⚠⚠ AND HERE IS WHY IT IS NOT WIRED, which is the honest part:
 *  1. **n = 4 constraint-bearing runs, one battery, one build.** Strong, and
 *     not yet sufficient. The intended contrast arm — a run that bound to a
 *     quantity-bearing target AND ran an analysis — was DEAD. Per doctrine, a
 *     predicate like this is settled by a REVIEWER's corpus, not the author's.
 *  2. Wiring it changes the shared resolver's binding for EVERY producer, and
 *     the blast radius has not been measured.
 *  3. Its two call sites are held tonight: `compound-goals.ts` is modified on
 *     open PR #1469, and `projector.ts` is on this wave's do-not-touch list.
 *
 * ⛔ AND THE CLAIM IT DOES *NOT* SUPPORT: rebinding does not make the limit
 * computable. The correct factor carries `prior` + `scale_frame` but no
 * `observed_state`, and PLoT's PU injection reads `observed_state.value`
 * specifically. A correct rebind moves the failure from WRONG TARGET to
 * UNMEASURED TARGET. Better, and still not an answer.
 *
 * @param nodeSourceQuote       the candidate node's recorded provenance, if any
 * @param constraintSourceQuote the constraint's own provenance, if any
 */
export function isSelfReferentialTarget(
  nodeSourceQuote: string | null | undefined,
  constraintSourceQuote: string | null | undefined,
): boolean {
  if (typeof nodeSourceQuote !== 'string' || typeof constraintSourceQuote !== 'string') {
    // Absent provenance is NOT evidence of self-reference. The contrast case —
    // a legitimate metric on a `risk` node — is exactly a `null` here, and
    // treating absence as a hit would re-break the binding the kind filter broke.
    return false;
  }
  const node = normaliseForPhraseMatch(nodeSourceQuote);
  const constraint = normaliseForPhraseMatch(constraintSourceQuote);
  if (node.length === 0 || constraint.length === 0) return false;
  return node === constraint;
}
