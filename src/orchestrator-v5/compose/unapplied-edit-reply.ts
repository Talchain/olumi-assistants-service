/**
 * ⭐⭐ WHAT TO SAY WHEN AN EDIT TURN WROTE NOTHING — TWO QUESTIONS, NAMED APART.
 *
 * ── THE WITNESSED HARM (deployed build, 4 Sep 2026) ────────────────────────
 * Four consecutive user messages received the SAME sentence:
 *
 *   "I haven't changed anything from that. Tell me the specific factor,
 *    edge, option, or value to change, and I'll apply it directly."
 *
 *   1. "Change the uncertainty range for Team coordination overhead to low"
 *   2. "Change the team coordination overhead to low."
 *   3. "Do you think we should add the risk about spending money on the
 *       resource and still not hitting our launch date?"
 *   4. "Do you agree that we should add this as a risk?"
 *
 * MEASURED at CEE `a401cc9a` by running the shipped predicates on the shipped
 * bytes (`tryVagueEditGuard` → `no_vague_edit_shape` for all four;
 * `tryChipSimplifyIntercept` → no match for all four; contrast controls
 * "Change this" → vague MATCHED and "What could change the outcome?" →
 * analytical DETECTED, so the probe discriminates). All four therefore reach
 * `editVerbCandidate === true`, dispatch to the V4 `edit_graph` LLM, the LLM
 * returns ZERO operations, and the sole reachable producer of that sentence is
 * `buildEditClarifyFallbackParts` at `orchestrator/tools/edit-graph.ts`.
 *
 * ── WHY ONE SENTENCE SERVED FOUR MESSAGES: ONE NAME, TWO QUESTIONS ─────────
 * This estate's signature defect. `buildEditClarifyFallbackParts` is a single
 * composer answering two questions that have different right answers:
 *
 *   Q1 — "was this turn an INSTRUCTION to change something, or a request for
 *         my VIEW on whether to change it?"
 *   Q2 — "given it WAS an instruction we could not apply, what did we
 *         actually understand from it?"
 *
 * Rows 1–2 are Q2: the user named the object AND the value and was told to
 * name the object and the value. Rows 3–4 are Q1: they are questions, and an
 * edit-refusal is the wrong KIND of answer, not merely wrongly worded.
 *
 * The two are exported as SEPARATE predicates with separate names, and the
 * composer consumes both. They are NOT one predicate with two defaults —
 * aligning defaults is the fix that recreates the defect (CLAUDE.md trap 21).
 * `__tests__/unapplied-edit-reply.test.ts` mutates them back into one and
 * asserts RED.
 *
 * ── WHY THIS IS NOT ANOTHER ROUND OF THE OSCILLATING PREDICATE ─────────────
 * ROADMAP 2.1361 measured four rounds of imperative-vs-noun tuning on
 * `EDIT_GRAPH_POSITIVE_REGEX`, each closing one direction and reopening the
 * other, and ran the obvious fifth round in advance to show it oscillates too.
 * **This module does not touch that predicate and cannot.** It runs AFTER the
 * edit LLM has already declined to write, so its fail-safe direction is safe
 * in BOTH directions:
 *
 *   false POSITIVE (we call an instruction a deliberation) → the user gets a
 *       differently-worded honest reply and a one-move path to the change.
 *       NOTHING is written that would not otherwise have been written.
 *   false NEGATIVE (we call a deliberation an instruction) → the user gets
 *       today's copy, i.e. exactly the status quo.
 *
 * Neither branch can mutate the graph, because no branch here reaches a
 * handler. A routing predicate cannot make that promise; that is the whole
 * reason this lives here and not there.
 *
 * ── THE QUALITATIVE-LEVEL BOUNDARY (rows 1–2), AND WHY WE DO NOT COERCE ────
 * "low" is a LEVEL, not a value. `cee/factor-extraction/display-value.ts`
 * exports `qualitativeBand`, the product's own value → label mapping
 * (0–0.25 Low · 0.25–0.5 Moderate · 0.5–0.75 High · 0.75–1 Very high) — it is
 * how the user was SHOWN the word "low" in the first place. Inverting it
 * yields a RANGE, never a point, so writing a number the user never gave
 * would invent precision. The repo's own mutation-warrant NEGATIVE corpus
 * already rules on this: "Keep churn low." is listed there as "deontic frame
 * but NO quantity — nothing to write."
 *
 * So we state the mapping and OFFER points inside the band as chips. A chip is
 * the estate's ratified consent channel: the user picks the number, we do not.
 * The offered points are DERIVED by round-tripping a grid through
 * `qualitativeBand` (never a hand-copied band table — trap 12), and the chip
 * copy is pinned to route: `Set <label> to <n>` satisfies
 * `isValueUpdatePhrasing`, which suppresses `edit_graph` dispatch and sends
 * the turn to the deterministic value lane where `set_factor_value` lives.
 * The spec asserts that routing by execution, so this module can never
 * advertise an action that terminates in refusal.
 *
 * ── AND ONE THING THE PRODUCT SIMPLY CANNOT DO (row 1) ─────────────────────
 * Row 1 asks to change an UNCERTAINTY RANGE. `edit-graph.ts`'s LEGACY_FIELDS
 * set STRIPS `confidence` from every operation, and the V5 registry's seven
 * handlers (`run_analysis`, `explain_from_structure`, `explain_results`,
 * `what_would_flip`, `set_factor_value`, `add_constraint`,
 * `adjust_edge_strength`) contain no uncertainty editor. Sweep at
 * `a401cc9a`: `set_confidence`/`update_confidence`/`set_uncertainty` → 0
 * occurrences, contrast control `add_node`/`add_edge`/`update_edge`/
 * `update_node`/`delete_node`/`delete_edge` → 11/11/8/4/2/2, so the absence is
 * measured, not blind.
 *
 * Today's copy — "Tell me the specific factor … and I'll apply it directly" —
 * is therefore FALSE on row 1 in the strongest way available: it promises to
 * apply a change the product has no route for. Saying so plainly is the fix.
 *
 * ── KNOWN-DROPPED IS EXPLICIT, NOT INVISIBLE ──────────────────────────────
 * `resolveUnappliedEditUnderstanding` returns `null` for anything it cannot
 * ground, and the composer then returns `null` so the CALLER keeps today's
 * copy unchanged. The set of shapes we knowingly do not improve is pinned in
 * the spec as `KNOWN_DROPPED_CORPUS` with an EXACT-set assertion, so the suite
 * REDs if that set grows OR shrinks (CLAUDE.md trap 22f).
 *
 * Pure. No I/O, no telemetry, no side effects.
 */

import { qualitativeBand } from '../../cee/factor-extraction/display-value.js';
import type { SuggestedAction } from './types.js';

/**
 * Minimal structural node shape. Compatible with GraphV3 nodes and with the
 * projected id/kind/label triples the edit-clarify composer already takes.
 */
export interface UnappliedEditNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  /** Present when the factor is measured in something (£, %, days). */
  readonly unit?: unknown;
  /** Present when the factor carries a user-scale magnitude beside its level. */
  readonly raw_value?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// QUESTION 1 — "was this an INSTRUCTION, or a request for my VIEW?"
// ═══════════════════════════════════════════════════════════════════════════

/**
 * The two answers to Question 1. Named as a type so the composer cannot
 * silently treat the absence of one as the presence of the other.
 */
export type UnappliedEditFrame = 'deliberation' | 'instruction';

/**
 * Deliberative frames — the user asking what we THINK about a change.
 *
 * ⚠ EVERY PATTERN REQUIRES AN EXPLICIT SECOND-PERSON OR FIRST-PERSON-PLURAL
 * DELIBERATIVE FRAME. A bare question mark is NOT enough and must never be:
 * "Can you change the churn rate to 5%?" is an instruction wearing a question
 * mark, and treating punctuation as the discriminator is precisely the
 * oscillation ROADMAP 2.1361 measured. The frame — "do you think", "do you
 * agree", "should we", "is it worth" — is a request for a JUDGEMENT, and no
 * imperative edit carries one.
 *
 * Sourced from the witnessed session (rows 3–4) plus the deliberative shapes
 * in the repo's existing mutation-warrant NEGATIVE corpus. The spec's
 * opposite-direction twins are imperative edits carrying the same verbs.
 */
const DELIBERATIVE_FRAME_PATTERNS: readonly RegExp[] = [
  // "Do you think we should add …" · "What do you think about removing …"
  /\b(?:do|would)\s+you\s+(?:think|reckon|say|feel)\b/i,
  /\bwhat\s+do\s+you\s+(?:think|reckon)\b/i,
  // "Do you agree that we should add this as a risk?"
  /\bdo\s+you\s+agree\b/i,
  // "Should we add a risk for …?" · "Ought we to remove …?"
  /\b(?:should|shall|ought)\s+(?:we|i)\b/i,
  // "Is it worth adding …?" · "Would it be worth removing …?"
  /\b(?:is|would)\s+it\s+(?:be\s+)?worth\b/i,
  // "Does it make sense to add …?"
  /\b(?:does|would)\s+it\s+make\s+sense\b/i,
  // "Any thoughts on adding …?" · "Thoughts on removing …?"
  /\b(?:any\s+)?thoughts\s+on\b/i,
  // "Am I right that we should …" · "Are we right to add …"
  /\b(?:am\s+i|are\s+we)\s+right\b/i,
];

/**
 * Answers Question 1 for a turn that wrote nothing.
 *
 * Returns `'deliberation'` ONLY when the message carries an explicit
 * deliberative frame. Everything else is `'instruction'` — including bare
 * questions, because a question mark alone cannot distinguish "Can you set X
 * to 5?" from "Should we set X to 5?" and guessing on punctuation is the
 * measured oscillation.
 */
export function classifyUnappliedEditFrame(message: string): UnappliedEditFrame {
  if (typeof message !== 'string') return 'instruction';
  for (const re of DELIBERATIVE_FRAME_PATTERNS) {
    if (re.test(message)) return 'deliberation';
  }
  return 'instruction';
}

// ═══════════════════════════════════════════════════════════════════════════
// QUESTION 2 — "what did we UNDERSTAND from the instruction we could not
// apply?"  A different question with a different answer; see the header.
// ═══════════════════════════════════════════════════════════════════════════

/** The four things we can ground. Anything else is `null` — known-dropped. */
export type UnappliedEditUnderstanding =
  | {
      /** The user named an aspect the product has no route to edit at all. */
      readonly kind: 'unsupported_aspect';
      readonly node: UnappliedEditNode;
      readonly aspect: 'uncertainty';
      /**
       * The level word the same message carried, when it carried one. Row 1
       * of the witnessed session did ("… to low"), and it is the ONLY thing
       * that makes a numeric offer here honest: the user's own word bounds
       * the band, so the chip proposes a number from inside it rather than
       * out of thin air. `null` when they named no level — and then this
       * branch offers no number at all.
       */
      readonly level: string | null;
      readonly offers: readonly number[];
    }
  | {
      /** A level word against a unitless 0–1 factor — invertible to a BAND. */
      readonly kind: 'level_on_unitless_factor';
      readonly node: UnappliedEditNode;
      readonly level: string;
      readonly offers: readonly number[];
    }
  | {
      /** A level word against a factor measured in something — not invertible. */
      readonly kind: 'level_on_measured_factor';
      readonly node: UnappliedEditNode;
      readonly level: string;
    }
  | {
      /** The object was named; no value we could read. */
      readonly kind: 'named_target_no_value';
      readonly node: UnappliedEditNode;
    };

/**
 * The aspect words that name something the product cannot edit. Narrow by
 * construction: each is a NOUN naming the spread around a value, never the
 * value itself. `edit-graph.ts` strips `confidence` from every operation and
 * no V5 handler edits it — see the header's sweep.
 */
const UNCERTAINTY_ASPECT_PATTERN =
  /\b(?:uncertainty|confidence)\s+(?:range|band|interval|level|bounds?)\b|\b(?:uncertainty|confidence)\b/i;

/**
 * The level vocabulary, taken from the product's OWN band labels rather than
 * invented here: `qualitativeBand` returns exactly Low / Moderate / High /
 * Very high, and these are the words a user reads them back to us as.
 * `medium` and `mid` are folded onto `moderate` because the product shows
 * "Moderate" and users say "medium" — a synonym, not a new band.
 */
const LEVEL_SYNONYMS: ReadonlyMap<string, string> = new Map([
  ['low', 'Low'],
  ['moderate', 'Moderate'],
  ['medium', 'Moderate'],
  ['mid', 'Moderate'],
  ['high', 'High'],
  ['very high', 'Very high'],
]);

const LEVEL_REQUEST_PATTERN =
  /\bto\s+(very\s+high|low|moderate|medium|mid|high)\b/i;

/**
 * Candidate points offered inside a band. DERIVED, never a copied band table:
 * every value is round-tripped through `qualitativeBand` and kept only if it
 * lands in the requested band. If the banding rule moves, these move with it.
 */
const OFFER_GRID: readonly number[] = Object.freeze([
  0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9,
]);

function offersForBand(band: string): readonly number[] {
  return OFFER_GRID.filter((v) => qualitativeBand(v) === band).slice(0, 2);
}

/** A factor is unitless-0–1 when it carries neither a unit nor a magnitude. */
function isUnitlessFactor(node: UnappliedEditNode): boolean {
  const hasUnit = typeof node.unit === 'string' && node.unit.trim().length > 0;
  const hasRaw = typeof node.raw_value === 'number' && Number.isFinite(node.raw_value);
  return !hasUnit && !hasRaw;
}

/**
 * Longest-label-first so "Team coordination overhead" wins over a shorter
 * label that happens to be a substring of it. Binding is by the node's own
 * label — an IDENTITY match, never a value predicate another node could
 * satisfy (CLAUDE.md trap 19).
 */
function findNamedNode(
  message: string,
  nodes: readonly UnappliedEditNode[] | null | undefined,
): UnappliedEditNode | null {
  if (!nodes || nodes.length === 0) return null;
  const lower = message.toLowerCase();
  let best: UnappliedEditNode | null = null;
  for (const node of nodes) {
    const label = typeof node.label === 'string' ? node.label.trim() : '';
    if (label.length < 3) continue;
    if (!lower.includes(label.toLowerCase())) continue;
    if (best === null || label.length > best.label.trim().length) best = node;
  }
  return best;
}

/**
 * Answers Question 2. Returns `null` when nothing can be grounded — the
 * caller must then keep its existing copy, and the spec pins exactly which
 * shapes fall here.
 */
export function resolveUnappliedEditUnderstanding(
  message: string,
  nodes: readonly UnappliedEditNode[] | null | undefined,
): UnappliedEditUnderstanding | null {
  if (typeof message !== 'string' || message.trim().length === 0) return null;
  const node = findNamedNode(message, nodes);
  if (node === null) return null;

  // The level read is hoisted ABOVE the aspect branch because both branches
  // need it: an unsupported aspect stated WITH a level can still offer a
  // consented number, and one stated without a level must offer none.
  const levelMatch = LEVEL_REQUEST_PATTERN.exec(message);
  const band =
    levelMatch !== null
      ? LEVEL_SYNONYMS.get(levelMatch[1].toLowerCase().replace(/\s+/g, ' ')) ?? null
      : null;

  if (UNCERTAINTY_ASPECT_PATTERN.test(message)) {
    const offerable = band !== null && isUnitlessFactor(node);
    return {
      kind: 'unsupported_aspect',
      node,
      aspect: 'uncertainty',
      level: band,
      offers: offerable ? offersForBand(band) : [],
    };
  }

  if (levelMatch) {
    if (band !== null) {
      if (!isUnitlessFactor(node)) {
        return { kind: 'level_on_measured_factor', node, level: band };
      }
      return {
        kind: 'level_on_unitless_factor',
        node,
        level: band,
        offers: offersForBand(band),
      };
    }
  }

  return { kind: 'named_target_no_value', node };
}

// ═══════════════════════════════════════════════════════════════════════════
// THE COMPOSER — consumes BOTH answers. Returns `null` to mean "I have
// nothing better than the caller's existing copy", never a guess.
// ═══════════════════════════════════════════════════════════════════════════

export interface UnappliedEditReplyParts {
  readonly text: string;
  readonly chips: readonly SuggestedAction[];
}

/**
 * The one sentence every branch must be able to say truthfully: the turn
 * wrote nothing. TURN-SCOPED on purpose — "from that" means "from the message
 * you just sent". See `edit-clarify-response.ts`'s header: a session-scoped
 * qualifier here has twice contradicted the product's own UI.
 *
 * ⚠ "no change was made" / "nothing changed" / "previous analysis" are BANNED
 * at egress (`forbidden-user-facing-phrases.ts`). Every string in this module
 * is checked against that guard BY EXECUTION in the spec, not by inspection.
 */
const NOTHING_WRITTEN = "I haven't changed anything from that.";

function chip(id: string, label: string, message: string): SuggestedAction {
  return Object.freeze({ id, label, message });
}

/**
 * Turn band-derived offers into chips.
 *
 * ⚠ THE CHIP MESSAGE SHAPE IS LOAD-BEARING, NOT COSMETIC. `Set <label> to <n>`
 * satisfies `isValueUpdatePhrasing`, which suppresses `edit_graph` dispatch and
 * routes the re-submitted turn to the deterministic value lane where
 * `set_factor_value` writes. Change the wording and the chip becomes an
 * advertised action that terminates in refusal — the exact defect class this
 * estate keeps shipping. The spec asserts the routing BY EXECUTION against the
 * real gate, so a reworded chip goes RED.
 *
 * An empty `offers` array yields no chips: a number nobody bounded is never
 * offered.
 */
function buildValueOfferChips(
  label: string,
  offers: readonly number[],
): readonly SuggestedAction[] {
  return offers.map((v, i) =>
    chip(`unapplied_edit_value_offer_${i}`, `${label}: ${v}`, `Set ${label} to ${v}`),
  );
}

/**
 * Build the honest reply for a turn that wrote nothing.
 *
 * @returns parts, or `null` when neither question yields anything the caller
 *          could say more truthfully than its own fallback.
 */
export function composeUnappliedEditReply(input: {
  readonly message: string;
  readonly nodes: readonly UnappliedEditNode[] | null | undefined;
}): UnappliedEditReplyParts | null {
  const frame = classifyUnappliedEditFrame(input.message);
  const understanding = resolveUnappliedEditUnderstanding(input.message, input.nodes);

  // ── Q1 answered 'deliberation' ────────────────────────────────────────
  // The user asked what we THINK. An edit-refusal is the wrong KIND of
  // answer, so this branch does not ask them to name a factor and a value:
  // they never offered one, and demanding one is what made the witnessed
  // reply read as a non-sequitur.
  if (frame === 'deliberation') {
    return {
      text:
        `${NOTHING_WRITTEN} That read as a question about whether to make a ` +
        `change rather than an instruction to make one, so I treated it as a ` +
        `question. Ask me again and I'll give you my read on it — or, if you ` +
        `already want it in, tell me what to add and I'll add it.`,
      chips: [
        chip(
          'unapplied_edit_deliberation_answer',
          'Give me your view first',
          "Set the model aside for a moment and tell me what you think about that.",
        ),
        chip(
          'unapplied_edit_deliberation_proceed',
          'Yes — put it in the model',
          'Add that to the model.',
        ),
      ],
    };
  }

  // ── Q1 answered 'instruction'; Q2 decides what we understood ──────────
  if (understanding === null) return null; // KNOWN-DROPPED — caller keeps its copy.

  const label = understanding.node.label.trim();

  switch (understanding.kind) {
    case 'unsupported_aspect': {
      const levelClause =
        understanding.level !== null
          ? ` — "${label}", to ${understanding.level.toLowerCase()}`
          : ` — "${label}"`;
      return {
        text:
          `${NOTHING_WRITTEN} I understood what you named${levelClause} — but ` +
          `its uncertainty range isn't something I can edit at all; the only ` +
          `number I can change on a factor is its value. If you meant the ` +
          `value, tell me which and I'll write it.`,
        chips: buildValueOfferChips(label, understanding.offers),
      };
    }

    case 'level_on_unitless_factor': {
      const lo = understanding.offers[0];
      const hi = understanding.offers[1];
      const offerChips = buildValueOfferChips(label, understanding.offers);
      const bandWord = understanding.level.toLowerCase();
      const examples =
        lo !== undefined && hi !== undefined
          ? ` — ${lo} or ${hi}, say`
          : lo !== undefined
            ? ` — ${lo}, say`
            : '';
      return {
        text:
          `${NOTHING_WRITTEN} I understood it: set "${label}" to ${bandWord}. ` +
          `On this factor's 0–1 scale "${bandWord}" covers a range of values` +
          `${examples}, so picking one for you would be putting a number in ` +
          `your model that you never gave me. Tell me which and I'll write it.`,
        chips: offerChips,
      };
    }

    case 'level_on_measured_factor': {
      const unit = typeof understanding.node.unit === 'string' ? understanding.node.unit.trim() : '';
      const measuredIn = unit.length > 0 ? ` in ${unit}` : ' as an amount';
      return {
        text:
          `${NOTHING_WRITTEN} I understood it: set "${label}" to ` +
          `${understanding.level.toLowerCase()}. But "${label}" is measured` +
          `${measuredIn}, so I'd have to invent an amount to act on that word. ` +
          `Give me the amount and I'll write it.`,
        chips: [],
      };
    }

    case 'named_target_no_value':
      // ⚠ NO NUMERIC CHIP HERE, DELIBERATELY. Nothing in the message bounds a
      // value, so any number on a chip would be one this module invented. An
      // offer the user never bounded is the silent coercion this whole module
      // exists to refuse — it is simply wearing a click instead of a write.
      return {
        text:
          `${NOTHING_WRITTEN} I understood which one you meant — "${label}" — ` +
          `but not what to set it to. Give me the value and I'll write it.`,
        chips: [],
      };
  }
}
