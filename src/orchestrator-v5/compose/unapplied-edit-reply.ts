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
 *
 * ⚠ WHAT THE SPEC ACTUALLY DOES, stated precisely because the previous version
 * of this sentence overstated it. `__tests__/unapplied-edit-reply.test.ts`'s
 * "TWO QUESTIONS, NOT ONE" cases (`:452-486` before this change) SIMULATE a
 * merged predicate inline — they call the two real predicates and show the
 * verdicts diverge. They do not rewrite this module, so nothing there "mutates
 * them back into one and asserts RED". The merge is proven by a MUTANT applied
 * to this file in a throwaway worktree and recorded on the PR, not by the
 * suite. A false comment describing verification is the finding, not a
 * footnote: it tells the next reader a guard exists where none does.
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
 * `shouldSuppressEditDispatchForValueUpdate`
 * (`orchestrator/routing/value-update-gate.ts:411`), which suppresses
 * `edit_graph` dispatch and sends the turn to the deterministic value lane
 * where `set_factor_value` lives. The spec asserts that routing by execution,
 * so this module can never advertise an action that terminates in refusal.
 *
 * ⚠ THIS SENTENCE PREVIOUSLY NAMED `isValueUpdatePhrasing`
 * (`value-update-gate.ts:382`) AS THE SUPPRESSING PREDICATE. It is not: that
 * file's own header at `:386-388` calls
 * `shouldSuppressEditDispatchForValueUpdate` "Route-v2's ACTUAL suppression
 * predicate", and `isValueUpdatePhrasing` is one of its two conjuncts. The
 * spec asserted the weaker conjunct too, so the mixed value+structural case
 * was never measured. Both are now asserted, and they are genuinely different:
 * "Update the churn rate to 5% and delete the status quo option" passes the
 * weak one and fails the real one (measured; the mixed example quoted in
 * `value-update-gate.ts`'s own header no longer separates them, because that
 * comment predates a tightening of the regex).
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
import { SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS } from '../tools/handlers/set-factor-value.js';
import type { SuggestedAction } from './types.js';

/**
 * Minimal structural node shape. Compatible with GraphV3 nodes and with the
 * projected id/kind/label triples the edit-clarify composer already takes.
 *
 * ⚠⚠ `unit` AND `raw_value` ARE NOT NODE-LEVEL FIELDS, AND READING THEM THERE
 * IS THE DEFECT THIS INTERFACE ONCE SHIPPED. `NodeV3Schema`
 * (`@talchain/schemas` 0.50.0, `dist/graph.js:256` — the Zod runtime, not just
 * the `.d.ts`) declares `id, kind, label, body, type, categories, category,
 * observed_state, state_space, goal_threshold, goal_threshold_frame`. `unit`
 * lives at `observed_state.unit` (`ObservedStateSchema`, `dist/graph.js:139`);
 * `raw_value` is not in the published schema at all and rides its
 * `.passthrough()`.
 *
 * Because `.passthrough()` cannot prove absence, the claim was settled at the
 * PRODUCERS instead — 491 graph nodes across every `*.json` under `src/`, with
 * a contrast control at the same level:
 *
 *   node.unit       (top level) ...   0 / 491
 *   node.raw_value  (top level) ...   0 / 491
 *   node.label      (top level) ... 491 / 491   <- CONTRAST
 *   node.observed_state.unit ......  23
 *   node.observed_state.raw_value .  26
 *
 * The colliding names belong to `DisplayValueInput`
 * (`cee/factor-extraction/display-value.ts:30-36`) — the very module this file
 * imports `qualitativeBand` from. One name, two objects.
 */
export interface UnappliedEditNode {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  /** GraphV3's `observed_state`. Where a unit and a magnitude actually live. */
  readonly observed_state?: unknown;
  /** A legacy sibling carrier some persisted shapes still use. */
  readonly data?: unknown;
  /** Legacy top-level carriers. 0/491 in every capture; read defensively only. */
  readonly unit?: unknown;
  readonly cap?: unknown;
}

// ═══════════════════════════════════════════════════════════════════════════
// WHAT SCALE IS THIS FACTOR ON? — three answers, because absence is one of them
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⭐⭐ THREE STATES, NOT TWO, AND THE THIRD IS THE DOMINANT ONE.
 *
 * The obvious repair for the wrong field path — read `observed_state.unit`
 * instead of `node.unit` — fixes the 31 measured nodes and leaves the majority
 * of real nodes still receiving a false claim. Measured over the same 491:
 *
 *   no `observed_state` at all ................... 403 (82%)  scale UNKNOWABLE
 *   `observed_state` with unit or raw_value ......  31        MEASURED
 *   `observed_state` with cap, no unit/raw .......   1        normalised from raw
 *   `observed_state.value` in [0,1], nothing else .  56       provably 0-1
 *   `observed_state.value` outside [0,1] .........   0
 *
 * Telling 403 nodes "On this factor's 0-1 scale…" is the SAME harm as F1 — a
 * false claim about the user's own model — one class wider. Absence of
 * `observed_state` is UNDECLARED, never "unitless": the contract's own
 * `declared_scale` doc states the rule, and `declared_scale` itself appears on
 * 0 of the 491, so it cannot be the discriminator either.
 *
 * A numeric claim is licensed by POSITIVE EVIDENCE, never by the absence of
 * counter-evidence.
 */
type FactorScale = 'measured' | 'unit_interval' | 'unknown';

function firstString(...candidates: readonly unknown[]): string | undefined {
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim().length > 0) return c.trim();
  }
  return undefined;
}

function firstFiniteNumber(...candidates: readonly unknown[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return undefined;
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' ? (v as Record<string, unknown>) : undefined;
}

/**
 * Resolve a factor's scale using the SAME candidate order as the shipped
 * resolver `buildFactorScaleMap`
 * (`orchestrator-v5/tools/plot-intervention-scale.ts:419-422`) — including its
 * asymmetry, which is deliberate and is not tidied here: `unit` has a
 * top-level fallback, `raw_value` does not.
 *
 * Deriving the paths from the shipped reader rather than minting a fourth one
 * is what stops this becoming another list to keep in sync.
 *
 * The top-level fallbacks read 0/491 in every capture and are kept only
 * because they are FAIL-SAFE: a hit can move a factor from `unit_interval` to
 * `measured`, i.e. towards fewer numeric claims and fewer chips, never towards
 * more.
 */
function resolveFactorScale(node: UnappliedEditNode): FactorScale {
  const observed = asRecord(node.observed_state);
  const data = asRecord(node.data);

  const unit = firstString(observed?.unit, data?.unit, node.unit);
  const raw = firstFiniteNumber(observed?.raw_value, data?.raw_value);
  // A cap means the 0-1 number is a NORMALISATION of a user-scale magnitude,
  // so the word the user said ("low") is about that magnitude, not about the
  // normalised number. Treated as measured — the fail-safe direction.
  const cap = firstFiniteNumber(observed?.cap, data?.cap, node.cap);
  if (unit !== undefined || raw !== undefined || cap !== undefined) return 'measured';

  const value = firstFiniteNumber(observed?.value, data?.value);
  if (value !== undefined && value >= 0 && value <= 1) return 'unit_interval';

  return 'unknown';
}

/** The user-facing unit, when there is one. Same candidate order as above. */
function resolveUnitLabel(node: UnappliedEditNode): string | undefined {
  const observed = asRecord(node.observed_state);
  const data = asRecord(node.data);
  return firstString(observed?.unit, data?.unit, node.unit);
}

// ═══════════════════════════════════════════════════════════════════════════
// A DIFFERENT QUESTION ABOUT THE SAME NODE — "will the value lane WRITE to a
// node of this kind at all?"  Not a fourth `FactorScale` state.
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ⭐⭐ TWO QUESTIONS, NAMED APART — AND WHY THIS IS NOT A WIDER WINDOW ON
 * `resolveFactorScale`.
 *
 * ── THE OPEN COUNTEREXAMPLE ───────────────────────────────────────────────
 * An independent reviewer, rebinding against the merged #1346 at `e977f6db`:
 * "option-kind protection is partial — a schema-valid option with an existing
 * value still gets factor-value chips."
 *
 * There was no option-kind protection here to be partial. `kind` was DECLARED
 * on `UnappliedEditNode` and never READ, and `findNamedNode` binds by LABEL
 * ALONE. What looked like protection was `resolveFactorScale` answering an
 * unrelated question well: an option carrying no `observed_state` resolves
 * `unknown`, and that branch emits no chips. An option was spared only for as
 * long as it happened to hold no value.
 *
 * ── THE TWO QUESTIONS ─────────────────────────────────────────────────────
 *   Q-SCALE  `resolveFactorScale` — "what scale is this node's value on?"
 *            A question about `observed_state`. UNCHANGED, and correct: an
 *            option carrying `observed_state.value = 0.3` genuinely IS on a
 *            0-1 scale. That answer is right and IRRELEVANT.
 *   Q-KIND   this predicate — "will `set_factor_value` write a value to a node
 *            of this kind at all?" A question about `kind`.
 *
 * Widening Q-SCALE to a fourth state would put two questions under one name
 * and align their defaults — the estate's signature defect (CLAUDE.md trap
 * 21), and the fix that recreates the harm. They stay two.
 *
 * ── WHY THIS IS A LIE, NOT ONLY A WRONG WORD ──────────────────────────────
 * `buildValueOfferChips`'s message shape is pinned to satisfy
 * `shouldSuppressEditDispatchForValueUpdate`, which suppresses `edit_graph`
 * dispatch and routes the resubmitted turn to the deterministic value lane
 * where `set_factor_value` lives. That handler REFUSES every kind outside its
 * allowed set at `tools/handlers/set-factor-value.ts:336-347`, throwing
 * `ENTITY_KIND_MISMATCH` — "Cannot set value on a option — set_factor_value
 * only accepts factors."
 *
 * So this module's own header promise — "this module can never advertise an
 * action that terminates in refusal" — was FALSE for every non-factor node.
 *
 * ── THE ANSWER IS NOT MINTED HERE ─────────────────────────────────────────
 * `SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS` is the handler's own exported
 * constant, which its header calls "the SINGLE source of truth for
 * `set_factor_value`'s target-kind capability" and which its execute-time gate
 * reads. Importing it means this module widens automatically if the handler
 * ever accepts another kind, instead of becoming a fourth list to keep in step
 * (CLAUDE.md trap 12). A hardcoded `kind === 'option'` would ALSO be the wrong
 * shape: measured over every `*.json` under `src/` (44 files, 44 parsed, 0
 * unparseable, 662 nodes, bucketed BY KIND) `risk` and `outcome` nodes ALREADY
 * carry unit-interval values — 1/95 and 3/81, against a `factor` contrast of
 * 120/228 — so an option-only guard closes the instance the reviewer named and
 * leaves its siblings open.
 *
 * FAIL-SAFE DIRECTION: a node whose `kind` is missing or not a string is
 * treated as NOT value-editable. Withholding an offer from a node we cannot
 * classify costs a chip; offering one costs a promise the handler refuses.
 * Every `NodeV3` carries `kind`, so this is a floor, not a behaviour.
 */
const VALUE_EDITABLE_KINDS: ReadonlySet<string> = new Set(
  SET_FACTOR_VALUE_ALLOWED_TARGET_KINDS,
);

/** Answers Q-KIND. `true` only when the value lane would accept this node. */
export function isValueEditableTarget(node: UnappliedEditNode): boolean {
  return typeof node.kind === 'string' && VALUE_EDITABLE_KINDS.has(node.kind);
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
      /**
       * A level word against a factor whose scale NOTHING IN THE PAYLOAD
       * DECLARES — the dominant real class (403 of 491 nodes). We understood
       * the object and the word; we cannot say what the word maps to, and
       * saying "0-1 scale" here would be inventing a fact about the user's
       * model. No number is claimed and none is offered.
       */
      readonly kind: 'level_on_unknown_scale';
      readonly node: UnappliedEditNode;
      readonly level: string;
    }
  | {
      /**
       * ⭐⭐ THE NAMED NODE IS NOT SOMETHING THE VALUE LANE WILL WRITE TO.
       *
       * Answers Q-KIND, and it outranks everything the MESSAGE said, because
       * it is a fact about the node rather than about the words. Placed above
       * the aspect branch and the level branch in the resolver for exactly
       * that reason: both of those reach `buildValueOfferChips`, so a guard
       * inside one of them would close one escape and leave the other open.
       *
       * `nodeKind` is `null` when the payload carried no readable kind — the
       * fail-safe floor, not a class we expect to see.
       */
      readonly kind: 'value_edit_unsupported_kind';
      readonly node: UnappliedEditNode;
      readonly nodeKind: string | null;
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

  // ⭐⭐ Q-KIND IS ASKED BEFORE EVERY BRANCH THAT CAN OFFER OR PROMISE A VALUE,
  // AND THAT PLACEMENT IS THE FIX.
  //
  // THREE branches below reach a value offer or a value promise:
  //   `unsupported_aspect`          -> buildValueOfferChips
  //   `level_on_unitless_factor`    -> buildValueOfferChips
  //   `named_target_no_value`       -> "Give me the value and I'll write it"
  // ...plus `level_on_measured_factor` and `level_on_unknown_scale`, which
  // both say "Give me the amount/value and I'll write it".
  //
  // A guard placed inside any ONE of them closes one escape and leaves the
  // rest open — the estate's most common repeat. Asked here, once, above all
  // of them, it closes the class.
  //
  // It is asked BEFORE the scale read on purpose: the scale answer for a
  // valued option is `unit_interval` and it is CORRECT. Q-SCALE is not wrong
  // about this node; nobody was asking Q-KIND.
  if (!isValueEditableTarget(node)) {
    return {
      kind: 'value_edit_unsupported_kind',
      node,
      nodeKind: typeof node.kind === 'string' && node.kind.trim().length > 0
        ? node.kind.trim()
        : null,
    };
  }

  // ⭐ ONE scale read, shared by both branches below. Two branches deciding
  // the same question with their own predicates is how one name comes to
  // answer two questions; there is exactly one answer here and both consume it.
  const scale = resolveFactorScale(node);

  if (UNCERTAINTY_ASPECT_PATTERN.test(message)) {
    // A number may be offered ONLY where the band is real: the user's own word
    // bounded it AND the factor is provably on the 0-1 scale that word maps to.
    const offerable = band !== null && scale === 'unit_interval';
    return {
      kind: 'unsupported_aspect',
      node,
      aspect: 'uncertainty',
      level: band,
      offers: offerable ? offersForBand(band) : [],
    };
  }

  if (levelMatch !== null && band !== null) {
    switch (scale) {
      case 'measured':
        return { kind: 'level_on_measured_factor', node, level: band };
      case 'unknown':
        return { kind: 'level_on_unknown_scale', node, level: band };
      case 'unit_interval':
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
    const answerChip = chip(
      'unapplied_edit_deliberation_answer',
      'Give me your view first',
      "Set the model aside for a moment and tell me what you think about that.",
    );

    // ⭐⭐ F2 — Q1 MUST NOT SHORT-CIRCUIT Q2.
    //
    // The first version of this composer returned here without ever reading
    // the understanding it had already resolved one line above. So
    // "Do you agree? Change the team coordination overhead to low." — which
    // grounds the node AND the level — was answered "That read as a question",
    // discarding both. That is the witnessed harm (a user who named the object
    // and the value told to name the object and the value) reproduced inside
    // the fix written for it.
    //
    // The two questions stay two: Q1 still decides the KIND of answer (this is
    // a question, so we do not demand an instruction), and Q2 supplies WHAT WE
    // UNDERSTOOD. Both are said. Merging them back into one predicate is what
    // the spec's merge cases assert against.
    if (understanding !== null) {
      const named = understanding.node.label.trim();
      const levelSuffix =
        'level' in understanding && typeof understanding.level === 'string'
          ? ` to ${understanding.level.toLowerCase()}`
          : '';
      return {
        text:
          `${NOTHING_WRITTEN} That read as a question about whether to make a ` +
          `change rather than an instruction to make one, so I treated it as a ` +
          `question and left the model alone. I did understand what you named ` +
          `— "${named}"${levelSuffix}. Tell me to go ahead and I'll take it ` +
          `from there, or ask me again and I'll give you my read on it first.`,
        chips: [
          answerChip,
          chip(
            'unapplied_edit_deliberation_proceed',
            `Yes — change ${named}`,
            `Change ${named}${levelSuffix}.`,
          ),
        ],
      };
    }

    return {
      text:
        `${NOTHING_WRITTEN} That read as a question about whether to make a ` +
        `change rather than an instruction to make one, so I treated it as a ` +
        `question. Ask me again and I'll give you my read on it — or, if you ` +
        `already want it in, tell me what to add and I'll add it.`,
      chips: [
        answerChip,
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

    case 'level_on_unknown_scale':
      // ⭐ THE DOMINANT CLASS (403 of 491 real nodes). We understood the object
      // and the word. We do NOT know what scale the factor is on, so we say
      // that, claim no scale, and offer no number. An offer here would be a
      // number invented from an absence.
      return {
        text:
          `${NOTHING_WRITTEN} I understood it: set "${label}" to ` +
          `${understanding.level.toLowerCase()}. But I don't have a value on ` +
          `"${label}" yet, so I can't tell what that word maps to without ` +
          `guessing. Give me the value and I'll write it.`,
        chips: [],
      };

    case 'level_on_measured_factor': {
      const unit = resolveUnitLabel(understanding.node) ?? '';
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

    case 'value_edit_unsupported_kind': {
      // ⚠ NO NUMERIC CHIP, AND NO "I'll write it" PROMISE. `set_factor_value`
      // refuses this kind outright, so a value offer here would be an
      // advertised action that terminates in refusal — and so would the
      // promise, which is the same lie without the click.
      //
      // Chips are deliberately EMPTY rather than absent: the caller
      // (`edit-graph.ts`) substitutes the generic label chips when this list
      // is empty, so the user keeps an affordance and none of it carries a
      // number this module invented.
      //
      // The only capability named is the one measured: `set_factor_value`
      // writes a value on a FACTOR. Nothing else is promised, because
      // promising an option-effect route we have not routed here by execution
      // would be this same defect one surface over.
      const isA =
        understanding.nodeKind !== null
          ? `that's ${/^[aeiou]/i.test(understanding.nodeKind) ? 'an' : 'a'} ` +
            `${understanding.nodeKind}, not a factor`
          : `I can't tell that it's a factor`;
      return {
        text:
          `${NOTHING_WRITTEN} I understood which one you meant — "${label}" — ` +
          `but ${isA}, and setting a value is something I can only do on a ` +
          `factor. If you meant a factor it affects, name that factor and the ` +
          `value, and I'll write that.`,
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
