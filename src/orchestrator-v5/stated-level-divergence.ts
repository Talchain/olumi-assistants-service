/**
 * Stated-level divergence — the disclosure owed when a person's contribution
 * lands as PROSE on a node whose number is still the product's guess.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE WITNESSED DEFECT (deployed staging, capture `d9c4066c`, 2026-09-19,
 * turns 10:48Z-10:51Z; node `cc057894`, quoted from the export's `full_graph`)
 *
 *   user      : "We are confident that the product quality WILL BE very high."
 *   user      : "Yes, please add 'very high' to product quality."
 *   product   : "Added a note to Product Quality"
 *
 *   what the graph then held:
 *     description    : "Current product quality IS assessed as very high."
 *     observed_state : { value: 0.5, unit: "scale", source: "cee_inference" }
 *     display_value  : "0.5 scale"
 *
 * Two harms, and the second is the one this module exists for.
 *
 *   1. THE PROSE RE-TENSED THE PERSON. They stated a forward expectation
 *      ("will be"); the note asserts a fact about today ("Current ... is"),
 *      with no attribution. That is a producer defect in the prose-writing
 *      lane, NOT something a disclosure can repair after the fact. What a
 *      disclosure CAN do is carry the person's own sentence, verbatim, so the
 *      tense survives on the surface they actually read. See `userQuote`.
 *
 *   2. THE RECEIPT WAS SILENT ABOUT THE NUMBER. "Added a note" is true and
 *      tells the person nothing about what they plainly meant to change. Six
 *      minutes later they ran the analysis; the run used 0.5. They only
 *      learned the truth by asking a direct follow-up ("will that now be
 *      incorporated?"), at which point the product answered honestly. ⭐ THE
 *      HONEST SENTENCE ALREADY EXISTED. It was reachable only by interrogation.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * NAMED APART FROM `label-value-divergence.ts`, DELIBERATELY
 *
 * That module answers: *did a LABEL's embedded QUANTITY diverge from the
 * modelled value?* This one answers: *did a person's PROSE land on a node
 * whose number is still ours?* Same family, same harm class, DIFFERENT
 * QUESTION — and this estate's trap 21 is two questions sharing one name,
 * where the tempting fix (reconcile them) is the wrong one. So: a sibling
 * module, its own type, its own predicate, and the SAME ratified three-carrier
 * shape, which is reused rather than reinvented.
 *
 * ⭐ THE THREE CARRIERS, AND WHY THE CHAT ONE IS THE WEAK ONE. Adopted from
 * `label-value-divergence.ts`'s header, which measured it: the finaliser
 * egress guard in `edit-graph-dispatch.ts` can replace the WHOLE
 * `assistant_text` when any part of it trips a fatal-class phrase, so a
 * chat-only disclosure can die with it. {@link buildStatedLevelDivergenceNote}
 * is therefore the PROBABILISTIC carrier;
 * {@link buildStatedLevelDivergenceDescription} (the applied-changes receipt)
 * and {@link buildStatedLevelDivergenceActions} (the typed chip) survive that
 * rewrite and are the RELIABLE ones.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⛔ NO BAND IS ASSERTED, AND THAT IS A RULING, NOT A SIMPLIFICATION
 *
 * The obvious copy here is *"'very high' sits in the top quarter"*. It is
 * banned, twice over.
 *
 *   · `parameter-user-phrasing.ts` measured, at this tip, that "high" resolves
 *     to THREE DIFFERENT NUMBERS across the estate: CEE `qualitativeBand`
 *     (0.5, 0.75] -> 0.625; UI `qualitativeTierLabel` (0.6, 0.8] -> 0.7; UI
 *     `FactorExternalPanel` 0.6-1.0 -> 0.8. There is no established anchor for
 *     what a level word means on a `scale` factor, so a quarter-claim would be
 *     a number this product chose, dressed as a fact about the person's words.
 *   · The ratified policy is **QUALITATIVE -> recognised, NEVER interpreted**
 *     (`missing-value-answer.ts`, adopted verbatim by `parameter-user-phrasing.ts`).
 *
 * So this module RECOGNISES that a contribution arrived and REFUSES to price
 * it. Consistent with that: ⛔ THE ANCHOR IS QUOTED, NEVER COMPUTED. The only
 * number that may appear is the node's own persisted `display_value`, and when
 * the caller cannot supply a trustworthy one the sentence is DROPPED rather
 * than synthesised.
 *
 * ⚠ AND THAT IS NOT A CONTRADICTION OF `modelledMagnitudeOf`, WHICH REFUSES TO
 * QUOTE AN UNDENOMINATED SCORE. Read quickly, the two rules look opposed: that
 * one drops "Moderate (0.4)" as unquotable, this one happily says "still 0.5
 * scale". They answer different questions, and conflating them would break one
 * of them. `modelledMagnitudeOf` is building one half of a QUANTITY
 * COMPARISON — "the label now asserts £63,000, the model holds X" — where a
 * bare score is not a commensurable X and naming it would be a category error.
 * Nothing here compares anything. The sentence is about the MODEL'S OWN STATE,
 * rendered in the product's OWN display string — the same string the canvas
 * already shows in `value_displayed`, and the same `currentDisplay` the
 * ratified qualitative path quotes back
 * (`compose/parameter-user-phrasing.ts`, `buildQualitativeValueRefusalText`).
 * Quoting the product's own read surface to the person reading it is the one
 * move that cannot drift from what they can see.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * THE PREDICATE IS STRUCTURAL, AND THAT IS THE POINT
 *
 * The tempting predicate is *"does this note assert a level?"* — a natural
 * language question over free prose. This estate has lost four consecutive
 * rounds to exactly that shape, each round fixing one direction and reopening
 * the other, until a reviewer ran the next round in advance and proved it
 * oscillates too. So the predicate here reads STRUCTURE AND PROVENANCE ONLY;
 * there is no word list, no band ladder, no tense parsing, and nothing for a
 * corpus to disagree with:
 *
 *   1. an `update_node` whose changed keys are PROSE KEYS ONLY (the key set is
 *      PASSED IN by the caller, never copied — see `proseKeys`);
 *   2. the op changes no modelled value, and no OTHER op in the batch moved
 *      that node's value either;
 *   3. the node actually carries a modelled numeric value (a purely nominal
 *      node has no number to be silent about);
 *   4. that value is NOT already the person's own — if they authored the
 *      number, they do not need telling it did not move;
 *   5. a quotable `display_value` exists and is not a label echo.
 *
 * (4) is what keeps this off ordinary annotation of a settled model, and (5)
 * is what stops it speaking when it cannot name a true number.
 *
 * Known-dropped BY NAME, so the gap stays visible and REDs if the set grows or
 * shrinks (the honest-gap protocol this repo already uses two modules over):
 *   · a note on a node with NO modelled value — nothing is being left behind;
 *   · a note on a node whose value the person already authored;
 *   · a note landing in the SAME batch as a real value change on that node;
 *   · a note whose node has no trustworthy `display_value` to quote.
 *
 * ⛔⛔ AND IT CLAIMS ONLY WHAT IT PROVES — WHICH IS NARROWER THAN THE FIRST
 * VERSION SAID, and the correction came from independent review (Codex,
 * CHANGES_REQUIRED on this module's own PR).
 *
 * The copy used to read "a re-run still uses <display>". That asserted
 * DOWNSTREAM CONSUMPTION, and this predicate establishes no such thing: it
 * proves a prose-only op, an unchanged machine-authored stored value, and a
 * quotable display string. It does NOT establish what the calculation
 * consumes. ⭐ A factor can carry OPTION INTERVENTIONS that override the
 * stored baseline — Paul's own afternoon model has one cost factor with option
 * values 0 / 10,000 / 45,000 / 55,000 — so a single baseline display string
 * cannot describe what each option's run would use, and a prose-only note on
 * such a node passes every condition here.
 *
 * That is the EXACT distinction this module exists to protect: recorded is not
 * used. Asserting consumption from a stored value would have committed, in the
 * disclosure, the error the disclosure is about. The sentence is now bounded to
 * the two facts that are proven — the note was recorded, and the stored value
 * did not change — and naming what a run would consume is deliberately left to
 * a consumed-input witness this module does not have and does not invent.
 *
 * DISCLOSURE ONLY: nothing here writes to a graph, an op, or a value. Turning
 * a level word into a number is a different consent class and belongs to the
 * value path, which exists to get the unit and the derivation right. The chip
 * this module offers therefore CARRIES NO NUMBER — see
 * `routing/readiness-answer-chips.ts`, THE FABRICATION BOUNDARY: *a chip may
 * carry a value the USER has stated; a chip may never carry a value the
 * PRODUCT chose.*
 */

import type { SuggestedAction } from '../orchestrator/types.js';
import {
  offersForBand,
  recogniseLevelIn,
  resolveFactorScale,
  type FactorScale,
} from './compose/unapplied-edit-reply.js';
import { isLabelEcho } from '../cee/transforms/label-echo.js';

type Dict = Record<string, unknown>;

export interface StatedLevelDivergence {
  /** Index of the operation within the batch. */
  readonly index: number;
  /** Node id (op.path). Internal — never rendered to the user. */
  readonly path: string;
  /** Render-safe resolved label. */
  readonly label: string;
  /**
   * What the model holds, as the node's OWN persisted display string
   * (e.g. "0.5 scale"). Quoted, never computed; never null by construction —
   * a node without one is not a divergence.
   */
  readonly currentDisplay: string;
  /**
   * The node's OWN kind, verbatim from the graph, or null when it declares
   * none.
   *
   * ⚠ NOT a boolean. The first version carried `isOption` and the copy read
   * `the ${isOption ? 'option' : 'factor'}` — which calls a goal, an outcome
   * or a risk a "factor", because this detector does not gate on kind at all.
   * Naming a node's kind wrongly in a sentence about provenance is the same
   * error one level down, so the copy now uses the graph's own word, or none.
   */
  readonly kind: string | null;
  /**
   * The level the person's OWN prose named ("Very high"), or null when it
   * named none. Drives the offer chips in
   * {@link buildStatedLevelDivergenceActions}.
   *
   * ⛔ A RECOGNISED BAND, NEVER AN INTERPRETED VALUE. This records which band
   * they said; it does not decide what that band is worth. Resolved by
   * `recogniseLevelIn`, whose vocabulary is owned by `unapplied-edit-reply.ts`.
   */
  readonly statedLevel: string | null;
  /**
   * ⭐⭐ THE FACTOR'S SCALE, read by the ONE existing resolver, so a band chip
   * is offered only where the band is a real quantity.
   *
   * ⛔ THE DEFECT THIS CLOSES, and it shipped in this file's first cut. The
   * band offers were built by copying `offersForBand` and leaving behind the
   * gate that guards it — `resolveUnappliedEditUnderstanding` offers a number
   * only when `resolveFactorScale(node) === 'unit_interval'`. Without it,
   * *"Annual Salary is very high"*, on a node whose observed state is
   * **£85,000**, earned chips reading **Set Annual Salary to 0.8 / 0.9**.
   * Nothing establishes that 0.8 denotes that measured amount, and a person
   * clicking the chip does not make it so: consent to a wrongly framed offer
   * repairs nothing, it only launders the frame.
   *
   * ⚠ IMPORTED, NOT RESTATED. `measured` / `unit_interval` / `unknown` is the
   * existing vocabulary and this file adds no second taxonomy — the whole
   * cause here was a second copy of one decision.
   */
  readonly scale: FactorScale;
}

function isPlainObject(v: unknown): v is Dict {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function finiteNum(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function nodesOf(graph: unknown): Dict[] {
  if (!isPlainObject(graph) || !Array.isArray(graph.nodes)) return [];
  return (graph.nodes as unknown[]).filter(isPlainObject);
}

function nodeById(graph: unknown, id: string): Dict | undefined {
  return nodesOf(graph).find((n) => n.id === id);
}

/** True when an intervention bundle carries at least one finite numeric value. */
function bundleHasNumericValue(bundle: unknown): boolean {
  if (!isPlainObject(bundle)) return false;
  for (const iv of Object.values(bundle)) {
    if (finiteNum(iv) !== undefined) return true;
    if (isPlainObject(iv) && (finiteNum(iv.value) !== undefined || finiteNum(iv.raw_value) !== undefined)) {
      return true;
    }
  }
  return false;
}

/**
 * True when the node carries a modelled numeric value. Same shape as
 * `label-value-divergence.ts`'s check, and for the same reason: a node with no
 * modelled value has no number for a note to be silent about.
 */
function nodeHasModelledValue(node: Dict): boolean {
  if (bundleHasNumericValue(node.interventions)) return true;
  const data = node.data;
  if (isPlainObject(data) && bundleHasNumericValue(data.interventions)) return true;
  const obs = node.observed_state;
  if (isPlainObject(obs) && finiteNum(obs.value) !== undefined) return true;
  if (finiteNum(node.value) !== undefined) return true;
  return false;
}

/** True when this op's value payload changes a modelled value (not just prose). */
function opChangesModelledValue(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  if (finiteNum(value.value) !== undefined) return true;
  if (value.interventions != null) return true;
  if (value.observed_state != null) return true;
  if (finiteNum(value.raw_value) !== undefined) return true;
  const data = value.data;
  if (isPlainObject(data) && data.interventions != null) return true;
  return false;
}

/**
 * ⭐ THE PROVENANCE GATE (condition 4).
 *
 * `false` when the node's number is already the person's own. The literals are
 * read from the node's `observed_state.source`; only the MACHINE-AUTHORED ones
 * are named here, and that direction is deliberate. Naming the user-authored
 * literals in this file would enrol a DISCLOSURE-ONLY module in the reviewed
 * writer manifest that `no-brief-derived-user-override.writers.test.ts` derives
 * from those literals appearing in `src/` — the same trap
 * `parameter-user-phrasing.ts` hit and documented. So the test is: is the
 * source one we KNOW is ours? Anything else, including an unrecognised future
 * literal, is treated as possibly the person's and the module STAYS SILENT.
 * Fail-closed, in the direction that cannot manufacture a false disclosure.
 *
 * ⭐ AND THAT DIRECTION IS LOAD-BEARING, NOT MERELY CAUTIOUS. The user-authored
 * source token is NOT single-meaning: `cee/transforms/provenance-display.ts:220-242`
 * records that `stampUserEditProvenance` applies it to EVERY value-writing
 * update_node op reaching either edit seam, INCLUDING model-authored ones. So
 * it cannot certify that a human acknowledged the number. Testing for the
 * machine-authored set instead means a forged user-authored stamp costs this
 * module a SILENCE (a missed disclosure) rather than a FALSE CLAIM about whose
 * number it is. A miss is recoverable; telling someone their contribution did
 * not land when it did is not.
 *
 * ⛔ AND THE USER-AUTHORED LITERALS ARE DELIBERATELY NOT SPELLED ANYWHERE IN
 * THIS FILE, INCLUDING IN PROSE. `no-brief-derived-user-override.writers.test.ts`
 * derives its reviewed-writer manifest from those tokens appearing anywhere in
 * `src/` — a COMMENT is enough — so naming one would enrol this
 * disclosure-only module in the set of files permitted to claim a value is the
 * user's own. `compose/parameter-user-phrasing.ts` records the same incident
 * and the same remedy: stop saying the word, never widen the manifest. This
 * file said it once and CI caught it; the fix is above.
 */
const MACHINE_AUTHORED_VALUE_SOURCES: ReadonlySet<string> = new Set([
  'cee_inference',
  'cee_hypothesis',
]);

function valueIsStillOurs(node: Dict): boolean {
  const obs = node.observed_state;
  if (!isPlainObject(obs)) return false;
  const source = obs.source;
  if (typeof source !== 'string') return false;
  return MACHINE_AUTHORED_VALUE_SOURCES.has(source);
}

/**
 * The node's own persisted display string, or null when there is nothing
 * trustworthy to quote.
 *
 * `isLabelEcho` is IMPORTED, not restated — its own header records that it once
 * had four call sites hand-copied at three, and a fifth copy here would be that
 * defect committed inside a module written to stop silent drift.
 */
function quotableDisplay(node: Dict): string | null {
  const raw = node.display_value;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const label = typeof node.label === 'string' ? node.label.toLowerCase() : '';
  if (isLabelEcho(label, trimmed)) return null;
  return trimmed;
}

/** The authored prose carried on an op's `value`, or null when there is none. */
function firstProse(value: unknown, proseKeys: readonly string[]): string | null {
  if (!isPlainObject(value)) return null;
  for (const key of proseKeys) {
    const raw = value[key];
    if (typeof raw !== 'string') continue;
    const trimmed = raw.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return null;
}

function detectOne(
  op: unknown,
  index: number,
  graph: unknown,
  proseKeys: readonly string[],
  valueChangedPaths: ReadonlySet<string>,
): StatedLevelDivergence | null {
  if (!isPlainObject(op)) return null;
  if (op.op !== 'update_node') return null;
  if (typeof op.path !== 'string' || op.path.length === 0) return null;

  // (1) PROSE KEYS AND NOTHING ELSE. A compound op that also carries `label`
  // or `value` is a different shape and is left to the existing receipt
  // branches, exactly as `buildOperationDescription` leaves them.
  const value = op.value;
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length === 0) return null;
  const proseKeySet = new Set(proseKeys);
  if (!keys.every((k) => proseKeySet.has(k))) return null;

  // A prose write that REMOVES the note is not a contribution being left
  // behind; there is nothing to disclose alongside it.
  if (firstProse(value, proseKeys) === null) return null;

  // (2) no value moved — on this op, or anywhere in the batch for this node.
  if (opChangesModelledValue(value)) return null;
  if (valueChangedPaths.has(op.path)) return null;

  const node = nodeById(graph, op.path);
  if (!node) return null;

  // (3) there is a number to be silent about.
  if (!nodeHasModelledValue(node)) return null;

  // (4) and it is still ours, not theirs.
  if (!valueIsStillOurs(node)) return null;

  // (5) and we can name it truthfully.
  const currentDisplay = quotableDisplay(node);
  if (currentDisplay === null) return null;

  const label = typeof node.label === 'string' && node.label.trim().length > 0 ? node.label : op.path;

  return {
    index,
    path: op.path,
    label,
    currentDisplay,
    kind: typeof node.kind === 'string' && node.kind.trim().length > 0 ? node.kind.trim() : null,
    statedLevel: recogniseLevelIn(firstProse(value, proseKeys) ?? ''),
    // The node is in hand here, so the scale is read from the SAME object the
    // rest of this detection is about.
    //
    // ⚠ AN EXPLICIT PROJECTION, NOT A DOUBLE CAST. Casting the node straight
    // to the resolver's parameter type compiled and read cleanly, and the CI
    // forbidden-boundary ratchet correctly refused it (59 > baseline 58). The
    // gate is right, and the exemption comment it offers would have been the
    // wrong use of it: a double cast here asserts a shape nothing checks,
    // whereas naming the six fields states exactly what the resolver reads
    // and fails at the type level if that ever changes.
    //
    // ⛔ AND THE PATTERN IS DELIBERATELY NOT SPELLED IN THIS COMMENT. That
    // scanner counts occurrences in TEXT, so a docblock explaining the defect
    // would trip the very gate it is explaining — the third instance of that
    // class in one night, after a provenance literal and a spelled magnitude
    // word. In this estate the token IS the interface.
    //
    // Every field below is optional and defensively parsed in
    // `resolveFactorScale`, so a node missing all of them resolves `unknown`
    // — which withholds the offer, the fail-safe direction.
    scale: resolveFactorScale({
      id: op.path,
      kind: typeof node.kind === 'string' ? node.kind : '',
      label,
      observed_state: node.observed_state,
      data: node.data,
      unit: node.unit,
      cap: node.cap,
    }),
  };
}

/**
 * Detect every operation in the batch that records prose on a node whose
 * modelled value is still the product's own and did not move.
 *
 * `proseKeys` is PASSED IN rather than declared here. Two private copies of
 * that list already exist (`tools/edit-graph.ts` and
 * `routing/edit-outcome-binding.ts`, whose headers acknowledge each other); a
 * third copy in this file would be this estate's dominant defect — the
 * hand-maintained mirror — committed inside a module about silent drift.
 * Taking it as an argument means there is one list at each call site and none
 * here. Consolidating the existing two is a separate, rowed change.
 */
export function detectStatedLevelDivergences(
  operations: unknown,
  graph: unknown,
  proseKeys: readonly string[],
): StatedLevelDivergence[] {
  if (!Array.isArray(operations)) return [];
  if (proseKeys.length === 0) return [];

  const valueChangedPaths = new Set<string>();
  for (const op of operations) {
    if (
      isPlainObject(op) &&
      op.op === 'update_node' &&
      typeof op.path === 'string' &&
      opChangesModelledValue(op.value)
    ) {
      valueChangedPaths.add(op.path);
    }
  }

  const out: StatedLevelDivergence[] = [];
  const seen = new Set<string>();
  operations.forEach((op, index) => {
    const d = detectOne(op, index, graph, proseKeys, valueChangedPaths);
    if (!d) return;
    // One disclosure per node per batch. Two notes on one factor is still one
    // fact the person needs.
    if (seen.has(d.path)) return;
    seen.add(d.path);
    out.push(d);
  });
  return out;
}

/**
 * The receipt line — the RELIABLE carrier. Says what changed AND what did not,
 * which is the whole repair: "Added a note" was true of this apply and of an
 * apply that had moved the number alike.
 */
export function buildStatedLevelDivergenceDescription(d: StatedLevelDivergence): string {
  const subject = d.kind === null ? `"${d.label}"` : `the ${d.kind} "${d.label}"`;
  // ⚠ "A note", NOT "your note". What landed on the node is written by the
  // prose lane and may not be the person's wording — on the capture in this
  // module's header it re-tensed them. Calling the product's paraphrase theirs
  // would be the provenance error this module exists to stop, committed in the
  // receipt that discloses it. The chat carrier quotes them; this one does not
  // claim to.
  return (
    `Recorded a note on ${subject}: wording only. ` +
    `Its stored value is unchanged, still ${d.currentDisplay}.`
  );
}

/**
 * The chat disclosure — the PROBABILISTIC carrier. Returns null when there is
 * nothing to disclose so callers can omit it cleanly.
 *
 * `userQuote` is the person's OWN sentence, already sanitised and length-bounded
 * BY THE CALLER (this module stays dependency-free so `compose` may import it
 * without a cycle). It is what preserves whether they described TODAY or a
 * FUTURE EXPECTATION: the recorded note is written by the prose lane and may
 * re-tense them, as it did on the capture in this module's header. Quoting them
 * costs no model surface and no new field, and when the caller cannot supply a
 * quote the clause is DROPPED rather than paraphrased — better to lose the
 * person's words than to put words in their mouth.
 *
 * ⭐ THE OFFER IS AN OFFER. "Keeping it as your own assessment" is a real
 * answer, stated as one. Calibration is optional by design: a qualitative
 * judgement is a contribution in its own right, not an incomplete number.
 */
export function buildStatedLevelDivergenceNote(
  divergences: readonly StatedLevelDivergence[],
  userQuote: string | null = null,
): string | null {
  if (divergences.length === 0) return null;
  // A trailing stop inside the quotation would double up against the one that
  // closes the sentence ("...very high.".) — trim it, and only it, so the
  // person's own wording is otherwise untouched.
  const trimmedQuote = typeof userQuote === 'string' ? userQuote.trim().replace(/[.\s]+$/u, '') : '';
  const quote = trimmedQuote.length > 0 ? trimmedQuote : null;

  const sentences = divergences.map((d) => {
    const subject = d.kind === null ? `"${d.label}"` : `the ${d.kind} "${d.label}"`;
    // ⚠ The quote is attributed to the PERSON ("You said"), and the note to the
    // PRODUCT ("I recorded that ... as a note"). Two facts, kept apart. Saying
    // "your note" would attribute the prose lane's wording to them, which is
    // the provenance error this module exists to stop.
    const recorded = quote
      ? `You said: "${quote}". I recorded that as a note on ${subject}, not a value.`
      : `I recorded that on ${subject} as a note, not a value.`;
    return (
      `${recorded} ` +
      `Its stored value is unchanged, still ${d.currentDisplay}. ` +
      `Tell me the value you want and I will set it, or keep it as your own assessment and leave the number alone.`
    );
  });
  return sentences.join('\n\n');
}

/**
 * The typed affordance — the other RELIABLE carrier.
 *
 * ⛔ IT CARRIES NO NUMBER. There is no defensible mapping from a level word to
 * a value (three ladders in this estate disagree; see the module header), so a
 * chip that pre-filled one would stamp a product-chosen number as the person's
 * own. The chip asks; the person answers; the existing value path writes. That
 * sequence is what makes the resulting number genuinely theirs.
 */
export function buildStatedLevelDivergenceActions(
  divergences: readonly StatedLevelDivergence[],
): SuggestedAction[] {
  const actions: SuggestedAction[] = [];
  const seen = new Set<string>();
  for (const d of divergences) {
    if (seen.has(d.path)) continue;
    seen.add(d.path);
    // ⭐ THE OFFER, when their own prose named a band. "Set <label> to <n>" —
    // `set` is already a value-lane verb, so this replays into the path that
    // WORKS and stamps the value with the person's own authorship provenance.
    // It deliberately does not widen the routing gate, which is a
    // consent-semantics change owned elsewhere.
    //
    // ⚠ THE PROVENANCE LITERAL IS DELIBERATELY NOT SPELLED HERE. The
    // 2.714 revert guard derives its REVIEWED manifest from which `src/`
    // files carry that token, so naming it in PROSE enrols this file and REDs
    // the required check — which is exactly what it did. Widening the manifest
    // to quiet a comment would be the wrong repair: the manifest is the list
    // of files reviewed for being allowed to STAMP authorship, and this file
    // stamps nothing.
    // ⭐ THE GATE, REUSED NOT REBUILT. A number may be offered ONLY where the
    // band is real: the person's own word bounded it AND the factor is
    // provably on the 0-1 scale that word maps to. This is the identical
    // condition `resolveUnappliedEditUnderstanding` applies
    // (`unapplied-edit-reply.ts`: `band !== null && scale === 'unit_interval'`),
    // and copying `offersForBand` without it is exactly what put
    // "Set Annual Salary to 0.8" in front of someone whose salary is £85,000.
    //
    // `measured` and `unknown` keep the generic clarification below and lose
    // only the numeric chips — fewer claims, never more.
    if (d.statedLevel !== null && d.scale === 'unit_interval') {
      for (const n of offersForBand(d.statedLevel)) {
        actions.push({
          label: `Set ${d.label} to ${n}`,
          prompt: `Set ${d.label} to ${n}`,
          role: 'facilitator',
        });
      }
    }
    // KEPT, always. The offered points are two of the band's; a person who
    // means a different number must not have to fight the chips for it.
    actions.push({
      label: `Set a value for ${d.label}`,
      prompt: `What value should ${d.label} take?`,
      role: 'facilitator',
    });
  }
  return actions;
}
