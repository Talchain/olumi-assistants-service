/**
 * draft-option-widening-blocks — emit AT MOST ONE `coaching_kind: 'widening'`
 * block on a draft turn, naming an option the drafter itself recorded that it
 * set aside, when the option set it actually built is narrow.
 *
 * Built as a copy of the proven draft-time sibling `draft-bias-signal-blocks.ts`
 * (same shape, same gates, same egress): pure, never throws, returns `[]` on
 * every doubt, and emits at most one block.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * The drafting model already writes down what it considered and left out, in
 * the brief's own terms, at `graph.coaching.widening_log
 * .elements_considered_but_excluded`. `cee/context-integrity/
 * not-modelled-manifest.ts` (which reads it REACTIVELY, only when the user asks
 * a past-tense audit question) states the case better than this header can:
 *
 *   "The model said what it dropped, and why, in the user's own terms. Nothing
 *    ever read it. That is a plumbing failure, not a knowledge failure."
 *
 * The renderer for the card that would show it proactively is already complete
 * and mounted: DGAI `V5CoachingBlock.tsx` KIND_SENTENCE already maps
 * `widening` → "Widening the options", the `v5_coaching` case has no flag
 * guard, and `guidanceSignalsForCoachingKind('widening')` already resolves to
 * `could_fix`. The producer has simply never emitted one. This is the producer.
 *
 * ── ⭐⭐ WHAT THE FIELD IS FOR — READ THIS BEFORE CHANGING ANY GATE BELOW ────
 * **`elements_considered_but_excluded` HOLDS REASON PROSE BY DESIGN, NOT ENTITY
 * NAMES.** Derived from the two places that WRITE it, which is the only way to
 * learn a field's meaning:
 *   - the instruction that generates it — `cee/unified-pipeline/stages/
 *     coaching-pass.ts:108` tells the drafting model the field holds
 *     **"brief reasons (may be empty)"**;
 *   - the legacy normaliser — `adapters/llm/normalise-legacy-coaching.ts`
 *     collects each legacy entry's `reason` string into this same field, its
 *     header naming it **"the canonical 'reason descriptions' surface"**.
 *
 * ⚠ THIS MODULE'S FIRST REVISION GOT THAT WRONG, AND THE WAY IT GOT IT WRONG IS
 * NOW STANDING DOCTRINE (`STANDING-BRIEF-PREAMBLE.md` P7). It audited 4,922
 * census entries, observed that the field SOMETIMES names options, and built an
 * entity-class gate on that distribution. Selecting a predicate from the same
 * corpus you intend to gate is circular: the corpus shows what the field
 * *happens to contain*, never what it is *for*. The gate then admitted whole
 * sentences, and the product told users it had "set aside" options that were not
 * options — **10 of 13 adversarial inputs, with a 48-test suite green
 * throughout**, e.g. `I set aside an option when I built this model: "Cost
 * differences between".` A census tells you the distribution; only the producer
 * tells you the meaning, and where they disagree the PRODUCER WINS.
 *
 * So the extraction below is not "find the option-ish entries". It is: **accept
 * only an entry whose own grammar DESIGNATES a named option** — a quoted name
 * followed by its class word, or a designation that CLOSES on its class word
 * before a real separator, whose residue reads as a name. Everything else is
 * reason prose and is dropped. The three conjuncts on shape B are each there
 * because its absence produced a fabricated claim; see them inline.
 *
 * ── FIRING RATE (RE-DERIVED UNDER THE FIXED PREDICATE) ─────────────────────
 * ⚠ The figures this header first carried (0.6% at floor 3, 7.7% at floor 4)
 * were measured under the FABRICATING predicate and were therefore UPPER
 * BOUNDS, not rates — P7's corollary. Re-derived on the same 2,977-row census
 * after the B1 fix, over 2,165 exclusion-bearing drafts:
 *
 *   floor 3:  12 drafts   0.6%
 *   floor 4:  84 drafts   3.9%   <-- SHIPPED   (was reported as 7.7%: ~2x too high)
 *   floor 5: 372 drafts  17.2%
 *
 * Entry-level acceptance also fell, 526 → 491 of 4,922 (10.7% → 10.0%).
 *
 * ⭐ WHY FLOOR 4 AND NOT 3, and it is not the rate. DSK-B-007's own
 * contraindication says do not flag "when the decision genuinely has only two
 * viable options after thorough analysis". Option-node counts observed are
 * 0, 2, 3, 4, 5, 6 — NEVER 1 — so a floor of 3 aimed the card EXCLUSIVELY at
 * 2-option drafts: precisely the population its own science is most cautious
 * about. At floor 4 the firing set is {2 options: 12, 3 options: 72}, so 86% of
 * cards land on 3-option drafts where Nutt's finding is live.
 *
 * ── WHAT THIS MODULE WILL NOT DO ───────────────────────────────────────────
 * It never GENERATES an option. DSK-B-007's own boundary conditions forbid it
 * ("generating weak alternatives to fill a quota degrades rather than improves
 * quality"). Every option it offers is one the product already wrote down, and
 * the body quotes the record rather than paraphrasing it.
 *
 * It also does not parse the record into a name and a reason with a general
 * natural-language rule. CLAUDE.md trap 22f is explicit that a punctuation
 * predicate over free text oscillates. The two shapes accepted here are the two
 * in which the record's own grammar DESIGNATES a name; an entry matching neither
 * is DROPPED rather than guessed at. Because the field is reason prose by
 * design, dropping is the common case and that is correct.
 *
 * ── FAIL-CLOSED GATES (all of them, in order) ──────────────────────────────
 *   1. `analysisReady.status !== 'ready'`  → [] (the sibling's own first gate:
 *      sole admission authority for a user-visible draft card)
 *   2. option-node count is 0, or >= OPTION_WIDENING_FLOOR → []
 *   3. no `widening_log.elements_considered_but_excluded` entry survives the
 *      entity-class extraction → []
 *   4. `deriveIntakeOptionReconciliation` is in `options_missing` → [] — the
 *      trap-21 anti-collision gate; see the block comment on `isRepairState`
 *   5. every surviving entry's tokens match an option the graph ALREADY has
 *      → [] (never offer the user an option they can see)
 *   6. the composed body fails `gateCoachingCardBody` → []
 *
 * Copy: entity-id leaks in `title`/`body` are scrubbed downstream by the
 * central egress chokepoint (sanitiseOlumiResponseForEgress → sanitiseBlock
 * 'coaching'), exactly as for every other coaching block.
 */
import { CoachingBlockSchema, type CoachingBlock } from '@talchain/schemas/boundary';

import {
  deriveIntakeOptionReconciliation,
  normaliseOptionTokens,
  readGraphOptionLabels,
} from '../../orchestrator/context/intake-option-reconciliation.js';
import type { GraphV3T } from '../../orchestrator/types.js';
import { deterministicBlockId } from '../compose/block-id.js';
import { resolveDskClaimProvenance } from '../compose/dsk-claim-record.js';
import { gateCoachingCardBody } from '../coaching/copy-quality-gate.js';
import { guidanceSignalsForCoachingKind } from '../compose/guidance-signals.js';

/**
 * ⭐ PAUL FORK 1 (brief §9.1). The option-set size at or above which the card
 * stays silent. Proposed 3 on DSK-B-007's own subject ("insufficient option
 * generation") and DSK-TR-004's kin threshold (`option_count >= 3`). Reversible
 * constant; measured firing rates for 3/4/5 are in this file's header.
 */
export const OPTION_WIDENING_FLOOR = 4;

/**
 * ⭐ PAUL FORK 2 (brief §9.2) — the copy. The three JOBS are doctrine
 * (`coaching/intake-option-disclosure.ts:11-30`): name the gap WITH ITS
 * SUBJECT, state the consequence SCOPED, offer the repair IN BOTH HALVES. The
 * sentences below are not doctrine and Paul may replace them.
 *
 * Derived copy constraints each of these obeys:
 *   - THE SUBJECT IS NOT THE USER'S BRIEF. `post-draft-narrative.ts:199-202`
 *     carries a standing instruction: a nudge's subject "must be this service
 *     or the model we built". Every sentence below has the subject "I".
 *   - IT ASSERTS NO REASON OF ITS OWN. `intake-option-disclosure.ts:32-36` —
 *     the product cannot distinguish "the drafter dropped it" from "the user
 *     removed it". The reason is only ever QUOTED from the record, never
 *     characterised, and it is omitted entirely when it cannot be quoted.
 *   - BOTH HALVES OF THE REPAIR. "add it" AND "I meant to leave it out";
 *     omitting the second "would tell half of all affected users to undo a
 *     decision they made on purpose" (`intake-option-disclosure.ts:26-29`).
 *   - IT DOES NOT REPEAT THE UNCONFIGURED-OPTION DISCLOSURE. The add path
 *     already says it on both branches (`add-option-dispatch.ts:90-93`,
 *     `:182-188`); a second copy is a second thing to drift (trap 12).
 *   - NO EM-DASHES of our own: `gateCoachingCardBody` rewrites them, and this
 *     module ships the gate's approved text, so avoiding them keeps our
 *     composed bytes and the shipped bytes identical.
 */
export const OPTION_WIDENING_TITLE = 'Options you set aside';

/**
 * The DSK claim this card cites. Its citations (Nutt 2004; Tversky & Kahneman)
 * are already attached at `data/dsk/v1.json`.
 *
 * ⭐⭐ THE ID IS ALL WE HARD-CODE, AND THAT IS THE POINT. The title, the
 * evidence strength and any protocol id are RESOLVED from the hash-verified
 * bundle by `resolveDskClaimProvenance` (`compose/dsk-claim-record.ts:135`),
 * never written here.
 *
 * An earlier revision hand-typed the whole triple and defended it on the
 * grounds that "no generation protocol exists, so the emitter's restraint is
 * the only guard". **That was wrong on both halves.** The resolver already
 * fails closed on unknown, deprecated and non-claim ids, and already attaches a
 * protocol ONLY when one genuinely links — so restraint was never the only
 * guard, and hand-typing actively BYPASSED the real one. `dsk-claim-record.ts`
 * states the rule the hand-typed version broke:
 *
 *   "Every byte the user sees under the bundle's authority comes from
 *    `data/dsk/v1.json`. A title written into this file could drift from the
 *    science it names and nothing would notice."
 *
 * Concretely: a future `deprecated: true` on DSK-B-007 would be honoured by
 * every other coaching card and IGNORED by this one. Resolved through the
 * resolver, the badge is simply omitted when the bundle says it must be.
 */
export const OPTION_WIDENING_DSK_CLAIM_ID = 'DSK-B-007';

/**
 * A PRE-FILTER, NOT THE AUTHORITY. `CoachingBlockSchema` is the authority and
 * this module validates every candidate block against it before returning
 * (see `firstValidBlock`) — so this number can only ever cost a card, never
 * ship an invalid one. That matters because the contract's bounds
 * (`PHASE3_BODY_MAX`, `PHASE3_ACTION_LABEL_MAX`, …) are module-private in
 * `@talchain/schemas` and CANNOT be imported: a mirrored constant is exactly
 * the hand-maintained mirror trap 12 warns about, so the mirror is not allowed
 * to be load-bearing.
 */
const BODY_BUDGET = 300;

/** A designation longer than this is prose, not an option name. */
const DESIGNATION_MAX = 90;
const DESIGNATION_MIN = 3;

/**
 * The entry's own option vocabulary. An entry qualifies ONLY when the record
 * designates it one of these — this is the entity-class gate the Step-0 census
 * forced (see header). Deliberately NARROW: "route", "path" and "choice" were
 * measured to admit factors ("Tax treatment of each route").
 */
const OPTION_DESIGNATOR = /\b(?:option|options|alternative|alternatives)\b/i;

/**
 * ⭐ CONJUNCT 2 of the B1 fix. The class word must CLOSE the designation, modulo
 * the same closed boilerplate tail `DESIGNATION_TAIL` strips. A class word
 * buried mid-sentence means the entry is prose ABOUT options, not the name of
 * one — which is what the field actually holds (see the header's P7 note).
 */
const OPTION_DESIGNATOR_CLOSES_HEAD = new RegExp(
  [
    '\\b(?:option|options|alternative|alternatives)',
    '(?:\\s+(?:excluded|omitted|dropped|considered))?',
    '(?:\\s+(?:routed|surfaced)\\s+(?:to|in)\\s+coaching)?',
    '\\s*$',
  ].join(''),
  'i',
);

/**
 * ⭐ CONJUNCT 3 of the B1 fix. Function words that cannot END a name. A residue
 * closing on one of these is a severed clause, not a designation ("Cost
 * differences between", "Tax treatment of").
 *
 * ⚠ THIS IS A HAND-WRITTEN CLOSED SET — trap 12's shape, and it is named as such
 * rather than hidden. It is tolerable here ONLY because its failure direction is
 * a GAP: a missing word costs a card, never a false claim. It is pinned by
 * fixtures rather than trusted.
 */
const TRAILING_FUNCTION_WORDS: ReadonlySet<string> = new Set([
  'between', 'of', 'the', 'a', 'an', 'and', 'or', 'nor', 'for', 'with', 'without',
  'in', 'on', 'to', 'by', 'as', 'at', 'from', 'than', 'across', 'about', 'into',
  'either', 'both', 'which', 'that', 'this', 'these', 'those', 'is', 'are', 'was',
  'were', 'be', 'been', 'but', 'if', 'per', 'via', 'over', 'under', 'versus', 'vs',
]);

/**
 * ⭐ CONJUNCT 3's length bound. The reconciler already uses `MAX_CANDIDATE_WORDS
 * = 10` for exactly this purpose (an option name is short; a clause is not).
 * Eight is tighter because a designation here also carries its class word.
 */
const DESIGNATION_MAX_WORDS = 8;

/**
 * Explicit NON-option entity words. Their presence in the DESIGNATION half
 * disqualifies the entry however the rest of it reads — the model routinely
 * writes "A 'customer leverage' factor was considered but…" in the same
 * sentence shape as the option form, and calling that an option would be the
 * fabrication this gate exists to prevent.
 */
const NON_OPTION_ENTITY =
  /\b(?:factor|factors|risk|risks|constraint|constraints|driver|drivers|node|nodes|outcome|outcomes|goal|goals|metric|metrics)\b/i;

/**
 * A quoted name followed by its class word: "A 'phased rollout' option was
 * considered but…". 62 of the 526 accepted entries take this shape.
 */
const QUOTED_DESIGNATION =
  /["'‘’“”]([^"'‘’“”]{2,90})["'‘’“”]\s+(?:option|alternative)\b/i;

/**
 * The separator between the designation and the reason. Measured on the census:
 * an em-dash, en-dash or hyphen surrounded by spaces, or a colon followed by
 * space. 82.6% of option-mentioning entries carry one.
 */
const DESIGNATION_SEPARATOR = /\s+[—–-]\s+|:\s+/;

/**
 * Structural boilerplate the model appends to a designation. A CLOSED set,
 * stripped in ONE pass (never iterated — trap 22f: a rule applied repeatedly
 * over free text is how a predicate starts oscillating). Derived from the
 * census: "Colocation option excluded", "Franchise option routed to coaching",
 * "Phased rollout as a third option".
 */
const DESIGNATION_TAIL = new RegExp(
  [
    // " as a third", " as a separate", " as an additional" …
    '(?:\\s+as\\s+(?:a|an|the)?\\s*(?:second|third|fourth|fifth|sixth|separate|distinct|additional|further)?)?',
    // " option" / " options" / " alternative" / " alternatives"
    '(?:\\s+(?:option|alternative)s?)?',
    // " excluded" / " omitted" / " dropped" / " considered"
    '(?:\\s+(?:excluded|omitted|dropped|considered))?',
    // " routed to coaching" / " surfaced in coaching"
    '(?:\\s+(?:routed|surfaced)\\s+(?:to|in)\\s+coaching)?',
    '\\s*$',
  ].join(''),
  'i',
);

/** Structural words that carry no OPTION IDENTITY, so they must not create a false duplicate match. */
const NON_IDENTIFYING_TOKENS: ReadonlySet<string> = new Set([
  'option',
  'alternative',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'excluded',
  'considered',
  'omitted',
  'dropped',
]);

interface GraphNodeShape {
  readonly id: string;
  readonly kind?: unknown;
  readonly label?: unknown;
}

/** One option the drafter recorded that it set aside. */
export interface SetAsideOption {
  /**
   * The option's designation, in the record's own words, boilerplate tails
   * stripped. This is what the chip names. NEVER synthesised.
   */
  readonly designation: string;
  /**
   * The reason half, verbatim, when the entry carries one — otherwise `null`.
   * Quoted or omitted; never paraphrased and never characterised.
   */
  readonly reason: string | null;
  /** The whole entry, verbatim, for identity and diagnostics. */
  readonly entry: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Identity tokens for duplicate detection: the shared normaliser (reused, never
 * re-implemented — brief §2 step 1.5) minus the structural words above.
 */
function identityTokens(value: string): string[] {
  return normaliseOptionTokens(value).filter((t) => !NON_IDENTIFYING_TOKENS.has(t));
}

/**
 * Does this designation name an option the graph ALREADY carries?
 *
 * ⚠ THE DIRECTION OF ERROR IS NOT SYMMETRIC, AND THAT DICTATES THE PREDICATE
 * (trap 22b: one predicate guarding two opposite harms). A false MATCH costs a
 * card the user might have valued — a gap. A false NON-MATCH offers the user an
 * option already on their canvas — the 14 Aug Regression Shield P0 "the model
 * duplicates the user's own option", a LIE. So this predicate is deliberately
 * MORE GENEROUS than the reconciler's private `sameOption`: any shared identity
 * token counts.
 *
 * That generosity is also what makes this safe to state WITHOUT mirroring
 * `sameOption` (which is not exported, and which this lane's fences forbid it
 * from exporting). `sameOption` requires `shared >= 1` before any of its
 * further tests, so EVERY pair `sameOption` calls the same, this predicate also
 * calls the same. The containment is provable from its code rather than
 * maintained by hand, so there is no mirror here to drift (trap 12).
 */
function matchesExistingOption(designation: string, existingLabels: readonly string[]): boolean {
  const tokens = identityTokens(designation);
  if (tokens.length === 0) return true; // nothing identifying left: fail closed
  const tokenSet = new Set(tokens);
  for (const label of existingLabels) {
    for (const labelToken of identityTokens(label)) {
      if (tokenSet.has(labelToken)) return true;
    }
  }
  return false;
}

/**
 * Extract the entries the record ITSELF designates as set-aside options.
 *
 * Exported for its own tests, for the same reason the reconciler exports its
 * extractor: the extractor and the emitter fail in different ways, and a corpus
 * that can only see them composed cannot say which one was wrong.
 *
 * Two shapes, both measured on the census; anything else is dropped:
 *   A. quoted   — `A 'phased rollout' option was considered but …`
 *   B. designation-first — `Phased rollout as a third option — not referenced …`
 */
export function extractSetAsideOptions(entries: unknown): SetAsideOption[] {
  if (!Array.isArray(entries)) return [];
  const out: SetAsideOption[] = [];
  const seen = new Set<string>();
  for (const raw of entries) {
    if (typeof raw !== 'string') continue;
    const entry = raw.trim();
    if (entry.length === 0) continue;

    let designation: string | null = null;
    let reason: string | null = null;

    // Shape A — the model named the option in quotes and then classed it.
    const quoted = QUOTED_DESIGNATION.exec(entry);
    if (quoted !== null) {
      const name = quoted[1]!.trim();
      if (name.length >= DESIGNATION_MIN && !NON_OPTION_ENTITY.test(name)) {
        designation = name;
        // The reason half of shape A is whatever follows the class word. It is
        // only ever QUOTED, so a shape whose remainder cannot be isolated
        // cleanly simply has no reason rather than a guessed one.
        const afterMatch = entry.slice(quoted.index + quoted[0].length);
        const sep = DESIGNATION_SEPARATOR.exec(afterMatch);
        reason = sep === null ? null : afterMatch.slice(sep.index + sep[0].length).trim() || null;
      }
    }

    // Shape B — designation before the first separator, reason after it.
    if (designation === null) {
      const parts = entry.split(DESIGNATION_SEPARATOR);
      const head = (parts[0] ?? '').trim();
      if (
        // ⭐ CONJUNCT 1 — A REAL SEPARATOR MUST HAVE BEEN FOUND.
        // Without this, `split` returns the WHOLE SENTENCE as `parts[0]`, and a
        // reason sentence that merely contains the word "option" and no veto
        // word becomes a "designation". That is the B1 blocker: the card said
        // `I set aside an option when I built this model: "Cost differences
        // between"` and `Add "Supplier concentration, which could bite either
        // option, is absent from the brief" as an option on the model.` ~17.4%
        // of option-mentioning entries carry no separator at all.
        parts.length > 1 &&
        head.length >= DESIGNATION_MIN &&
        head.length <= DESIGNATION_MAX &&
        // ⭐ CONJUNCT 2 — THE CLASS WORD MUST CLOSE THE HEAD (modulo the closed
        // boilerplate tail). "Phased rollout as a third option" and
        // "Colocation option excluded" designate; "Supplier concentration,
        // which could bite either option, is absent…" does not. A class word
        // buried mid-sentence is prose ABOUT options, not the name of one.
        OPTION_DESIGNATOR_CLOSES_HEAD.test(head) &&
        !NON_OPTION_ENTITY.test(head)
      ) {
        designation = head;
        reason = entry.slice(head.length).replace(DESIGNATION_SEPARATOR, '').trim() || null;
      }
    }

    if (designation === null) continue;

    // Strip the closed boilerplate set in one pass. If nothing identifying is
    // left, the entry named no option we can honestly print.
    const cleaned = designation.replace(DESIGNATION_TAIL, '').trim();
    if (cleaned.length < DESIGNATION_MIN || cleaned.length > DESIGNATION_MAX) continue;
    if (NON_OPTION_ENTITY.test(cleaned)) continue;

    // ⭐ CONJUNCT 3 of the B1 fix — the RESIDUE must read as a name.
    // `DESIGNATION_TAIL` strips a trailing class word that was sometimes the
    // grammatical HEAD NOUN, which produced truncated fragments ("Cost
    // differences between") while the copy claimed to quote the record's own
    // words. A residue that ends on a function word is a severed clause, and a
    // residue longer than a short phrase is prose.
    const words = cleaned.split(/\s+/).filter((w) => w.length > 0);
    if (words.length === 0 || words.length > DESIGNATION_MAX_WORDS) continue;
    const lastWord = words[words.length - 1]!.toLowerCase().replace(/[^a-z]/g, '');
    if (TRAILING_FUNCTION_WORDS.has(lastWord)) continue;

    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ designation: cleaned, reason, entry });
  }
  return out;
}

/** Count the option nodes the drafter actually built. */
function countOptionNodes(graph: GraphV3T | null | undefined): number {
  const rawNodes = graph?.nodes;
  if (!Array.isArray(rawNodes)) return 0;
  let count = 0;
  for (const node of rawNodes as GraphNodeShape[]) {
    if (node !== null && typeof node === 'object' && node.kind === 'option') count += 1;
  }
  return count;
}

/**
 * ⭐⭐ THE TRAP-21 ANTI-COLLISION GATE. Two authorities now speak about the
 * option set and THEY ANSWER DIFFERENT QUESTIONS:
 *
 *   `intake-option-reconciliation.ts` (row 2.579, live)
 *      "Did the intake keep every option the user NAMED?"  → withhold the
 *      ranking. A DEFECT to repair.
 *   this module
 *      "Which options did the drafter SET ASIDE, that the user never named?"
 *      → offer a widening. An OPPORTUNITY to take.
 *
 * These are near-inverses, and the estate has been bitten by exactly this
 * shape: #709 and #737 fixed one harm a day apart and re-opened it between
 * them, because one answered "did this run's verdict withhold?" and the other
 * "may this turn name a leader on screen?" — and nothing in the code, the
 * names, or the reviews said so. So it is said here: when an option the user
 * NAMED is missing, the product is in a REPAIR state, and this card is SILENT.
 * A card saying "here are more options to consider" on a turn withheld
 * BECAUSE the product lost one of the user's own options would be the product
 * changing the subject away from its own error.
 *
 * `intake-option-reconciliation.ts:41-43` also already adjudicated the
 * tempting shortcut, and its ruling binds this module: `strengthen_items
 * .action_type === 'add_option'` "fires as WIDENING advice … which is the
 * OPPOSITE claim". This module never reads `strengthen_items`.
 */
function isRepairState(briefText: string | null | undefined, graph: GraphV3T | null | undefined): boolean {
  return (
    deriveIntakeOptionReconciliation(briefText, readGraphOptionLabels(graph)).state ===
    'options_missing'
  );
}

/** Compose the body. Returns null when nothing that fits can be said honestly. */
function composeBody(chosen: SetAsideOption, optionCount: number): string | null {
  const head = `I set aside an option when I built this model: "${chosen.designation}".`;
  const tail =
    `With ${optionCount} options on the canvas it is worth a second look, ` +
    `or tell me you meant to leave it out and I will stop asking.`;

  // The reason clause is a BONUS, not a requirement. It is quoted verbatim or
  // omitted — never paraphrased. It is dropped when it does not fit, and (via
  // the gate below) when the model's own wording would fail the copy gate: the
  // recorded reasons frequently say "no such option node exists", and
  // `GRAPH_SHAPE_REGEX` correctly refuses graph vocabulary on a coaching card.
  // `GateResult.text` is the value callers MUST render, not the original
  // candidate ("a style offence (em/en dash) is repaired in place instead of
  // costing the user the generated coaching"). It is optional on the type, so
  // fall back to the candidate we composed — shipping our own bytes is correct
  // when the gate accepted them and offered no rewrite.
  const shipped = (candidate: string): string | null => {
    const gated = gateCoachingCardBody(candidate);
    return gated.accept ? (gated.text ?? candidate) : null;
  };

  if (chosen.reason !== null) {
    const withReason = `${head} My note at the time: "${chosen.reason}". ${tail}`;
    if (withReason.length <= BODY_BUDGET) {
      const accepted = shipped(withReason);
      if (accepted !== null) return accepted;
    }
  }

  const plain = `${head} ${tail}`;
  if (plain.length > BODY_BUDGET) return null;
  return shipped(plain);
}

/**
 * ⭐ THE CONTRACT IS THE AUTHORITY, AND THIS IS WHERE IT IS ENFORCED.
 *
 * Try each candidate block in preference order and return the FIRST that
 * satisfies the real boundary schema; return `null` when none does.
 *
 * WHY THIS EXISTS AND WHAT IT COST TO LEARN (2026-08-17). The unit fixtures for
 * this module all carried short option names, so they never reached
 * `action_label`'s bound — which is 40 characters, and module-private in the
 * schemas package. Replaying the emitter over all 2,977 captured drafts
 * produced `Add "Franchise or partnership" to the model` at 43 characters. A
 * green unit suite could not see it, because the class was absent from the
 * corpus the author wrote (trap 22). The lesson is not "add 40 to a constants
 * block" — the numbers are not importable, so the SCHEMA has to be the guard.
 *
 * ⚠⚠ AND THE STAKES ARE HIGHER THAN THIS COMMENT FIRST CLAIMED. It cited
 * `phase3-blocks.ts:57-61` as a block-level drop ("never a partial"). **That is
 * the run_analysis composer and the DRAFT PATH NEVER CALLS IT.** The real seam
 * is `route-v2.ts:1056` sanitise → `:1063` `validateEgress`, which is a
 * WHOLE-RESPONSE `OlumiResponseSchema.safeParse`; on failure
 * `validators/b1.ts:124-136` returns `buildEgressFallback()`. So one invalid
 * block does not cost a card — **it costs THE WHOLE DRAFT TURN**, replaced by
 * "The server produced a response that failed validation." A user who would
 * have got a model gets an error instead. This function is the last thing
 * standing between a long option name and that outcome.
 */
function firstValidBlock(candidates: readonly CoachingBlock[]): CoachingBlock | null {
  for (const candidate of candidates) {
    if (CoachingBlockSchema.safeParse(candidate).success) return candidate;
  }
  return null;
}

export interface BuildDraftOptionWideningBlocksParams {
  /**
   * Sole admission authority for a user-visible draft card, mirroring the
   * sibling: missing, unknown and every non-ready status fail closed.
   */
  readonly analysisReady?: { readonly status?: unknown } | null;
  /**
   * The canonical `widening_log` OBJECT off the draft result
   * (`result.coachingWideningLogObject`). Only
   * `elements_considered_but_excluded` is read. `brief_completeness` is
   * deliberately NOT read: it is a withdrawn oracle (an LLM-authored enum that
   * nothing derives and nothing can refute, which "fires on most briefs").
   */
  readonly wideningLog: unknown;
  /** The drafted graph. Supplies the option count, the labels and the target ref. */
  readonly graph: GraphV3T | null | undefined;
  /**
   * The text the pipeline actually drafted from (`effectiveBrief`), so the
   * anti-collision reconciler reads the same brief the drafter did. NOT
   * `payload.message`: on the clarify-v2 intake path that is the user's
   * one-line answer, not the brief (the 2.972 defect).
   */
  readonly briefText: string | null | undefined;
  /** ISO-8601 timestamp with offset, stamped on the emitted block. */
  readonly createdAt: string;
}

/**
 * Build AT MOST ONE `widening` coaching block. Returns `[]` when nothing
 * honest can be shown. Pure; never throws.
 */
export function buildDraftOptionWideningBlocks(
  params: BuildDraftOptionWideningBlocksParams,
): CoachingBlock[] {
  const { analysisReady, wideningLog, graph, briefText, createdAt } = params;

  // Gate 1 — the sibling's own first gate.
  if (analysisReady?.status !== 'ready') return [];

  // Gate 2 — the option set must exist AND be narrow. A zero-option draft is
  // not a narrow option set, it is a draft without options: fail closed rather
  // than lecture a user whose model did not build.
  const optionCount = countOptionNodes(graph);
  if (optionCount === 0 || optionCount >= OPTION_WIDENING_FLOOR) return [];

  // Gate 3 — the record must designate at least one set-aside OPTION.
  if (!isRecord(wideningLog)) return [];
  const candidates = extractSetAsideOptions(wideningLog.elements_considered_but_excluded);
  if (candidates.length === 0) return [];

  // Gate 4 — the trap-21 anti-collision gate.
  if (isRepairState(briefText, graph)) return [];

  // Gate 5 — never offer an option the graph already carries.
  const existingLabels = [...readGraphOptionLabels(graph)];
  for (const node of (Array.isArray(graph?.nodes) ? graph.nodes : []) as GraphNodeShape[]) {
    if (node !== null && typeof node === 'object' && node.kind === 'option') {
      const label = typeof node.label === 'string' ? node.label.trim() : '';
      if (label.length > 0) existingLabels.push(label);
    }
  }
  const chosen = candidates.find((c) => !matchesExistingOption(c.designation, existingLabels));
  if (chosen === undefined) return [];

  // Gate 6 — the composed copy must pass the shared content gate.
  const body = composeBody(chosen, optionCount);
  if (body === null) return [];

  // Identity is the option this card names, so the block id is stable across
  // reruns of the same draft and distinct between different set-aside options.
  const signalId = `draft_option_widening:${chosen.designation.toLowerCase()}`;

  // Resolved from the hash-verified bundle, never hand-typed — see the note on
  // OPTION_WIDENING_DSK_CLAIM_ID. `null` (unknown / deprecated / not a claim)
  // means the badge is omitted, not faked.
  const dskProvenance = resolveDskClaimProvenance(OPTION_WIDENING_DSK_CLAIM_ID);

  /**
   * Chip captions in preference order. The named form is what we want; the
   * generic fallback exists so a LONG option name costs the caption's
   * specificity rather than the whole card — the body and the `action_prompt`
   * still name the option in full, so nothing about the card becomes vague, and
   * nothing about it becomes untrue.
   */
  //
  // ⚠ R3 — AN ID-SHAPED TOKEN IN THE DESIGNATION MUST NOT REACH THE CAPTION.
  // The egress scrub runs BEFORE validation, and its label substitution can
  // LENGTHEN a string (an id is replaced by its human label). So a designation
  // carrying an id-shaped token could push a caption that validated here past
  // the 40-char bound AFTER the scrub — and because the egress parse is
  // whole-response (see `firstValidBlock`), that costs THE ENTIRE TURN. This is
  // the first draft-path block to carry `action_label` at all, so nothing
  // upstream has ever had to think about it.
  //
  // The test is deliberately BROADER than the gate's own id shape: any `_` or
  // `:`, or any of the gate's entity prefixes followed by a separator. Drift in
  // this list can therefore only cost the caption's SPECIFICITY, never a turn
  // and never a true statement — the same provable-containment argument as
  // `matchesExistingOption`, and the reason a mirror is tolerable here.
  const idShaped =
    /[_:]/.test(chosen.designation) ||
    /\b(?:fac|opt|goal|dec|out|risk|con|factor|option|decision|outcome|constraint)[-_:]/i.test(
      chosen.designation,
    );
  const labelCandidates = idShaped
    ? ['Add this option']
    : [`Add "${chosen.designation}"`, 'Add this option'];

  const block = firstValidBlock(
    labelCandidates.map((action_label) => ({
      block_id: deterministicBlockId(signalId),
      signal_id: signalId,
      created_at: createdAt,
      source_handler: 'draft_graph',
      freshness: 'fresh',
      type: 'coaching',
      coaching_kind: 'widening',
      title: OPTION_WIDENING_TITLE,
      body,
      source: 'draft_graph',
      // No node exists for an option that was never added, and the UI surfaces
      // a node marker ONLY for a real canvas node id, so grounding here would
      // be a ref to nothing. `target_refs: []` is schema-legal (no `.min(1)`)
      // and is the sibling's measured lesson: requiring a resolvable target
      // "skipped EVERY real signal and emitted nothing on the wire".
      target_refs: [],
      // ⚠ NOT A FORMALITY. Coaching is in the UI's PHASE3_CARD_TYPES with
      // PHASE3_DEFAULT_EXPANDED = 6, measured live counts are 8-14 cards per
      // turn, and `bias_signal` holds the ONLY visibility exemption. A card
      // ranked 7th or later collapses behind "Show N more" and renders NULL —
      // not in the DOM at all. Rank 1 is the difference between shipping this
      // card and dark-shipping it.
      priority_rank: 1,
      // MANDATORY, not a nicety: `action_label` WITHOUT `action_prompt` renders
      // an inert `<span>` (V5CoachingBlock.tsx:445-455), i.e. a card the user
      // cannot click. `action_prompt` is "the PRODUCER-AUTHORED turn text a
      // chip dispatches VERBATIM".
      action_label,
      // Names exactly ONE option, never "add more options": the UI's
      // ADD_OPTION_IMPERATIVE is singular-only by design.
      action_prompt: `Add "${chosen.designation}" as an option on the model.`,
      // Honest producer metadata ONLY. It reaches the DOM as
      // `data-action-intent` and NOTHING MORE: `ActionChip` passes no meta to
      // `_sendChip`, and `SendChipMeta` has no `intent` field at all, so the
      // chip sends `action_prompt` as an ordinary free-text turn. This is NOT a
      // typed dispatch and no test in this lane asserts one.
      action_intent: 'add_option',
      // Resolved from the hash-verified bundle; OMITTED entirely when the
      // bundle cannot vouch for the claim (unknown / deprecated / not a claim).
      ...(dskProvenance !== null ? { dsk_claim_provenance: dskProvenance } : {}),
      // Producer-owned guidance signals: `widening` already resolves to
      // `could_fix` (compose/guidance-signals.ts). Derived, never hand-typed.
      ...guidanceSignalsForCoachingKind('widening'),
    })),
  );

  // Fail closed rather than hand egress a block it will drop whole.
  return block === null ? [] : [block];
}
