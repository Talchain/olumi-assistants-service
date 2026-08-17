/**
 * ⭐⭐ ROADMAP 2.1265 (D2) — NO REPLY MAY ASSERT THE MODEL ALREADY HOLDS A
 * VALUE IT DID NOT READ FROM THE PERSISTED GRAPH.
 *
 * THE DEFECT, wire-witnessed on deployed CEE `8be62df`
 * (`olumi-docs/witness-acceptance-2026-08-17/`, scenario
 * `289c2690-f605-4f3c-8e43-465b339fda1e`, J4 turn 2, turn_id
 * `2211b6b7-37a3-48c5-afa5-c508e3db3c99`, capture `j4-t2-event-final.json`):
 *
 *   REQUEST  "The subcontractor cost should be 12% of revenue on the affected
 *            routes."
 *   RESPONSE 200, `exit_path: "turn_executor"`, ONE `routing` LLM call
 *            (prompt 120, hash adcc5128d4e6e6bc) —
 *            **"Your model already reflects subcontractor cost at 12% of
 *            affected-route revenue, so no change is needed there."**
 *            plus two confident bullets anchored on it, and a closing
 *            "The subcontracting option's costs are modelled using this 12%
 *            figure already".
 *
 * And in the SAME payload, `analysis_state.readiness.blockers[0]`:
 *
 *   { code: "MISSING_OPTION_VALUE",
 *     option_label: "subcontracting inner-city deliveries to a green courier",
 *     factor_label: "Subcontractor cost as share of affected-route revenue",
 *     message: "Choose the missing effect value for …" }
 *
 * The persisted draft carried NO 0.12 and NO 12% anywhere (absence sweep with a
 * positive control on the 0.5 defaults); the factor sat at `0.5`, source
 * `cee_inference`; no edit fact preceded the turn. **A reply that contradicts
 * its own payload's blocker is unconditionally wrong.**
 *
 * ⚠ WHY THE IDENTITY BINDING IS ON THE VALUE, NOT THE LABEL — and this was
 * measured, not assumed. The obvious guard binds the claim to a blocker's
 * `factor_label` in the same sentence (trap 19's ordinary shape). Run against
 * the witnessed bytes it NEVER FIRES: the fabricating reply says "subcontractor
 * cost at 12% of affected-route revenue" and "as a share of affected-route
 * revenue" — the persisted label is "Subcontractor cost as share of
 * affected-route revenue", and neither paraphrase contains it. A guard bound
 * that way would be correct and pointed at the wrong bytes (CLAUDE.md trap 22,
 * the `£1.5 million` shape). What the claim genuinely asserts is a NUMBER the
 * model supposedly holds, and whether the model holds it is a server-side FACT.
 * So the decisive conjunct is the brief's own rule: *unless it read that value
 * from the persisted graph*.
 *
 * ⭐ THE PREDICATE, AND WHY IT CAN ONLY DECLINE (traps 22 / 22b / 22f — four
 * rounds of open-ended NL predicates oscillated on a neighbouring seam):
 *
 *   1. A live `MISSING_OPTION_VALUE` blocker on THIS payload. Absent ⇒ the
 *      product is not in the asking-for-a-value state and this guard has no
 *      opinion. Read off the SAME readiness payload that composes the blocker
 *      copy the user is looking at (trap 12 — derived, never mirrored).
 *   2. A closed "already holds" ANCHOR in one sentence: the word `already`,
 *      a holding verb from a closed list, and a NUMERIC token. All three are
 *      required — bare `already` is ordinary English ("you already told me"),
 *      a holding verb without `already` is an instruction, and a claim with no
 *      number asserts no value.
 *   3. THE GRAPH SWEEP: not one numeric token in that sentence occurs anywhere
 *      in the persisted graph, in value form or in display-string form, with
 *      percent/share equivalence (12 ≡ 12% ≡ 0.12). If ANY of them is found the
 *      guard stands down — the strongest available stand-down, and the same
 *      method the witness used, with the same positive control.
 *   4. AN OPPOSITE-DIRECTION ESCAPE (trap 22b — every case gets its twin): a
 *      sentence that ALSO says the value is not set is making the TRUE claim.
 *
 * ⚠ SENTENCE SPLITTING DOES NOT SPLIT ON A DECIMAL POINT, and that is not a
 * detail: CEE has already shipped a guard that was correct and pointed at the
 * wrong bytes because `[.!?]` cut `£1.5 million` down to `1`. A `.` between two
 * digits is never a sentence end here.
 *
 * SAFE DIRECTION, stated explicitly. A false positive costs one honest clarify
 * turn about a value the blocker says is missing anyway. A false negative is the
 * product asserting a figure the user never gave, about the user's own model —
 * the estate's worst defect class. Where they conflict, this module fires.
 */

import { CONFIGURE_OPTION_EXAMPLE_VALUE } from './configure-option-clarify-response.js';
import { buildConfigureOptionAdvisedFormat } from '../configure-option-chip-text.js';
import { mergeInterventionSources } from '../../orchestrator/tools/analysis-ready-helper.js';

/**
 * The closed holding-verb set. A member, together with `already` and a number,
 * asserts that the model CARRIES that number now.
 *
 * Deliberately ABSENT: `knows`, `mentions`, `names`, `lists`, `shows` — those
 * describe the model containing the FACTOR, which is true (the factor exists).
 * The defect is the claim that its effect value is already set.
 */
export const ALREADY_HOLDS_VERBS: readonly string[] = [
  'reflect',
  'reflects',
  'reflected',
  'reflecting',
  'set',
  'sets',
  'carries',
  'carry',
  'carried',
  'holds',
  'hold',
  'held',
  'has',
  'have',
  'uses',
  'use',
  'using',
  'used',
  'models',
  'modelled',
  'modeled',
  'modelling',
  'captures',
  'captured',
  'records',
  'recorded',
  'includes',
  'include',
  'included',
  'contains',
  'contain',
  'at',
];

/**
 * The opposite-direction escape. A sentence naming a value AND saying it is
 * absent is the HONEST shape — the blocker copy itself reads this way — and
 * must never be swapped.
 */
export const VALUE_ABSENT_MARKERS: readonly string[] = [
  'not set',
  'not yet set',
  "isn't set",
  'is not set',
  'unset',
  'no value',
  'no values',
  'no effect value',
  'missing',
  'without a value',
  'needs a value',
  'not carrying',
  'blank',
  'empty',
];

/**
 * ⭐ Trap 22f's honest-gap protocol — claim shapes carrying the SAME harm that
 * are KNOWINGLY NOT CLAIMED, pinned as data so the suite REDs if the predicate
 * silently widens to claim one OR narrows past a claimed form. Each keeps
 * today's behaviour. A gap recorded in the suite is honest; a gap invisible to
 * it is how four rounds happen.
 */
export const MISSING_VALUE_CLAIM_KNOWN_DROPPED: readonly string[] = [
  // The claim carries NO number — it asserts the factor is represented, which
  // is true; only a value assertion is a value fabrication.
  'Your model already reflects subcontractor cost, so no change is needed there.',
  // The number and the `already` anchor sit in DIFFERENT sentences. Joining
  // them needs coreference, not a predicate.
  'Your model is already correct here. The figure is 12%.',
  // Present-tense assertion with no `already` anchor.
  'Your model reflects subcontractor cost at 12% of affected-route revenue.',
  // Future/conditional framing asserts nothing about the current model.
  'Setting subcontractor cost to 12% would already match your brief.',
];

export type MissingValueClaimStandDownReason =
  | 'no_text'
  | 'no_readiness'
  | 'no_missing_value_blocker'
  | 'no_graph'
  | 'no_already_holds_claim'
  | 'value_present_in_graph';

/** A live missing-effect-value blocker, projected to the two labels we name. */
export interface MissingValuePair {
  readonly optionLabel: string;
  readonly factorLabel: string;
}

export type MissingValueClaimDecision =
  | { readonly verdict: 'stand_down'; readonly reason: MissingValueClaimStandDownReason }
  | {
      readonly verdict: 'swap';
      /** The live pairs, in payload order. `[0]` supplies the worked example. */
      readonly pairs: readonly MissingValuePair[];
      /** The asserted numbers the graph does not hold, as written. */
      readonly assertedValues: readonly string[];
      /** The offending sentence, for telemetry only — never re-emitted. */
      readonly sentence: string;
      /** The honest replacement, composed from blocker facts only. */
      readonly text: string;
    };

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Word-only projection, space-padded — the coordinate space for every
 * whole-word and phrase test here.
 *
 * ⚠ IT MUST BE APPLIED TO BOTH SIDES. The first version padded the raw
 * normalised text and matched `" not set "`, which the sentence *"…the effect
 * value is not set."* fails on, because the marker is followed by the full stop.
 * The honest negation twin therefore SWAPPED — over-suppression, caught by its
 * own opposite-direction test rather than by inspection. Punctuation and
 * apostrophes collapse to spaces on the haystack AND on the needle, so
 * `isn't set` and `is not set.` both land.
 */
function wordsOnly(text: string): string {
  return ` ${normalise(text).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;
}

/**
 * Split into sentences WITHOUT cutting a decimal.
 *
 * A terminator counts only when it is not sitting between two digits, so
 * `0.12`, `£1.5 million` and `12.5%` survive intact — the exact failure that
 * made a sibling guard read `1` where the message said `£1.5 million`.
 */
export function splitSentencesPreservingDecimals(text: string): string[] {
  const out: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i]!;
    if (ch !== '.' && ch !== '!' && ch !== '?' && ch !== '\n') continue;
    if (ch === '.') {
      const prev = text[i - 1];
      const next = text[i + 1];
      if (
        prev !== undefined &&
        next !== undefined &&
        prev >= '0' &&
        prev <= '9' &&
        next >= '0' &&
        next <= '9'
      ) {
        continue;
      }
    }
    const piece = text.slice(start, i + 1).trim();
    if (piece.length > 0) out.push(piece);
    start = i + 1;
  }
  const tail = text.slice(start).trim();
  if (tail.length > 0) out.push(tail);
  return out;
}

/** Whole-word membership over a space-padded, lower-cased haystack. */
function containsWord(paddedHaystack: string, word: string): boolean {
  return paddedHaystack.includes(` ${word} `);
}

/**
 * The two discriminators a missing-effect-value blocker is spelled with, and
 * they are NOT interchangeable spellings of one field.
 *
 * ⚠⚠ THIS COST A NEAR-MISS, CAUGHT BY MEASUREMENT AND RECORDED RATHER THAN
 * QUIETLY FIXED (CLAUDE.md trap 14). The guard was written against the WIRE
 * projection — `analysis_state.readiness.blockers[].code ===
 * "MISSING_OPTION_VALUE"`, which is what the witness captures carry, so the unit
 * spec was fully green. The payload the executor actually holds
 * (`buildCanonicalAnalysisReadyFromGraph`, the value threaded as
 * `analysisReadyForTurn`) spells the same fact `blocker_type ===
 * "missing_value"` and carries NO `code` field at all. Reading only `code` meant
 * ZERO pairs in production and a guard that could never fire — green tests, dead
 * guard, the estate's dominant defect shape (trap 3b at payload grain).
 *
 * Both are accepted, and the spec asserts BOTH shapes over the SAME witnessed
 * graph so neither reading can rot alone.
 */
const MISSING_VALUE_DISCRIMINATORS: readonly (readonly [string, string])[] = [
  // Canonical, in-process — what the turn-executor and the edit dispatcher hold.
  ['blocker_type', 'missing_value'],
  // Wire projection — what `analysis_state.readiness.blockers` carries.
  ['code', 'MISSING_OPTION_VALUE'],
];

/**
 * Project the LIVE missing-effect-value pairs off the readiness payload.
 *
 * DERIVED, NOT MIRRORED (trap 12): the pairs come off the SAME blockers that
 * compose the blocker copy the user is reading, so this guard cannot disagree
 * with the product about what is missing. Duck-typed deliberately — it must read
 * both the canonical payload and the wire projection, so an unrecognised shape
 * yields NO pairs and the guard stands down.
 */
export function projectMissingValuePairs(readiness: unknown): MissingValuePair[] {
  if (readiness === null || typeof readiness !== 'object') return [];
  const blockers = (readiness as { blockers?: unknown }).blockers;
  if (!Array.isArray(blockers)) return [];
  const pairs: MissingValuePair[] = [];
  for (const raw of blockers) {
    if (raw === null || typeof raw !== 'object') continue;
    const b = raw as Record<string, unknown>;
    const isMissingValue = MISSING_VALUE_DISCRIMINATORS.some(
      ([field, value]) => b[field] === value,
    );
    if (!isMissingValue) continue;
    const optionLabel = b.option_label;
    const factorLabel = b.factor_label;
    if (typeof optionLabel !== 'string' || optionLabel.trim().length === 0) continue;
    if (typeof factorLabel !== 'string' || factorLabel.trim().length < 3) continue;
    pairs.push({ optionLabel: optionLabel.trim(), factorLabel: factorLabel.trim() });
  }
  return pairs;
}

/** A number as written in the claim, plus every value it could denote. */
interface AssertedNumber {
  readonly asWritten: string;
  /** `12%` ⇒ {12, 0.12}; `0.12` ⇒ {0.12, 12}. Share/percent are the same claim. */
  readonly candidates: readonly number[];
}

const NUMBER_TOKEN = /(\d[\d,]*(?:\.\d+)?)\s*(%)?/g;

/** Extract every number in a sentence with its percent/share equivalents. */
export function extractAssertedNumbers(sentence: string): AssertedNumber[] {
  const out: AssertedNumber[] = [];
  for (const m of sentence.matchAll(NUMBER_TOKEN)) {
    const raw = m[1]!;
    const value = Number(raw.replace(/,/g, ''));
    if (!Number.isFinite(value)) continue;
    const candidates = new Set<number>([value]);
    if (m[2] === '%') candidates.add(value / 100);
    // A bare share reads as its percent twin and vice versa: the claim
    // "already at 0.12" and "already at 12%" are the same assertion about the
    // same slot, so a graph holding EITHER stands the guard down.
    if (value > 0 && value < 1) candidates.add(value * 100);
    else if (value >= 1 && value <= 100) candidates.add(value / 100);
    out.push({ asWritten: m[0].trim(), candidates: [...candidates] });
  }
  return out;
}

/**
 * Sweep the values the persisted MODEL holds in the slots a "your model already
 * reflects X" claim can be about: every option's effect values (interventions)
 * and every node's own observed value, in numeric and display-string form.
 *
 * ⚠⚠ A WHOLE-OBJECT NUMERIC SWEEP WAS TRIED FIRST AND MEASURED WRONG — recorded
 * rather than quietly replaced (CLAUDE.md trap 14). Run over the witnessed draft
 * graph (`captures/j4-t1-event-final.json`) it reports the asserted `0.12` as
 * PRESENT, from two sources that have nothing to do with any value the user
 * could mean: digit runs inside hex node ids (`21ea9b80` → `21`, `80`) and
 * twelve edges carrying `strength.std = 0.11999999999999998`, which matches 0.12
 * inside any sane tolerance. The guard would have stood down on the exact
 * fabrication it exists to catch, silently, and its "no numeric match" reading
 * would have looked like a clean absence result (trap 13e: a sweep that cannot
 * distinguish coincidence from evidence is reporting on itself).
 *
 * So the scope is the CLAIM'S DOMAIN, not the object graph. Intervention values
 * are read through `mergeInterventionSources` — the SAME reader that composes
 * the readiness payload whose blocker triggered this guard, so the two can never
 * disagree about what the model holds (trap 12: derived, never mirrored).
 */
export function collectModelValueNumbers(graph: unknown): Set<number> {
  const found = new Set<number>();
  if (graph === null || typeof graph !== 'object') return found;
  const nodes = (graph as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return found;

  const addNumber = (value: unknown): void => {
    if (typeof value === 'number' && Number.isFinite(value)) found.add(value);
  };
  const addFromDisplayString = (value: unknown): void => {
    if (typeof value !== 'string') return;
    for (const m of value.matchAll(NUMBER_TOKEN)) {
      const parsed = Number(m[1]!.replace(/,/g, ''));
      if (!Number.isFinite(parsed)) continue;
      found.add(parsed);
      if (m[2] === '%') found.add(parsed / 100);
    }
  };
  const addObservedState = (holder: unknown): void => {
    if (holder === null || typeof holder !== 'object') return;
    const observed = (holder as Record<string, unknown>).observed_state;
    if (observed !== null && typeof observed === 'object') {
      addNumber((observed as Record<string, unknown>).value);
      addFromDisplayString((observed as Record<string, unknown>).display_value);
    }
    addFromDisplayString((holder as Record<string, unknown>).display_value);
  };

  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    // The node's OWN value — the "baseline" a factor carries.
    addObservedState(record);
    addObservedState(record.data);
    // Every effect value this node carries, through the readiness reader.
    const interventions = mergeInterventionSources(record);
    if (interventions !== undefined) {
      for (const value of Object.values(interventions)) addNumber(value);
    }
  }
  return found;
}

/** Floating-point-safe membership (0.12 must match a stored 0.12). */
function graphHolds(numbers: ReadonlySet<number>, candidate: number): boolean {
  for (const held of numbers) {
    if (held === candidate) return true;
    if (Math.abs(held - candidate) <= 1e-9 * Math.max(1, Math.abs(candidate))) return true;
  }
  return false;
}

/**
 * The honest replacement, composed from BLOCKER FACTS ONLY.
 *
 * ⚠ It does NOT echo the asserted number. The blocker says the effect value is
 * missing and the graph sweep says the model does not hold it, so this turn
 * holds no evidence about what the number should be — and repeating it beside
 * "I have not set it" is how a correction turns back into a claim. The routable
 * next step is the product's OWN advised format
 * (`buildConfigureOptionAdvisedFormat` = probe P1), so the sentence this reply
 * suggests returns to the lane that suggested it.
 */
export function composeMissingValueClaimCorrection(
  pairs: readonly MissingValuePair[],
): string {
  const primary = pairs[0]!;
  const example = buildConfigureOptionAdvisedFormat(
    primary.optionLabel,
    primary.factorLabel,
    CONFIGURE_OPTION_EXAMPLE_VALUE,
  );
  const head =
    pairs.length === 1
      ? `Your model does not carry that figure — "${primary.optionLabel}" still has no effect value on ${primary.factorLabel}, which is exactly what this turn is asking you for.`
      : `Your model does not carry that figure anywhere yet, and ${pairs.length} effect values are still unset — so I cannot tell you it is already reflected.`;
  return [
    head,
    `Tell me what it changes, like this: ${example}`,
    `Use a number from 0 (this option does nothing to it) to 1 (this option drives it fully).`,
  ].join(' ');
}

/**
 * Classify an assistant reply against its OWN payload's missing-value blockers
 * and the persisted graph.
 *
 * Pure: no I/O, no LLM, no telemetry. The caller owns emission and the swap.
 */
export function classifyMissingValueClaim(params: {
  readonly assistantText: string;
  readonly readiness: unknown;
  readonly persistedGraph: unknown;
}): MissingValueClaimDecision {
  const { assistantText, readiness, persistedGraph } = params;
  if (typeof assistantText !== 'string' || assistantText.trim().length === 0) {
    return { verdict: 'stand_down', reason: 'no_text' };
  }
  if (readiness === null || readiness === undefined) {
    return { verdict: 'stand_down', reason: 'no_readiness' };
  }
  const pairs = projectMissingValuePairs(readiness);
  if (pairs.length === 0) {
    return { verdict: 'stand_down', reason: 'no_missing_value_blocker' };
  }
  // No graph ⇒ the "did it read this from the model" question is unanswerable,
  // and a guard that cannot answer it must not swap. Fail-open here is the only
  // honest direction: swapping on an unread graph would replace true claims.
  if (persistedGraph === null || persistedGraph === undefined) {
    return { verdict: 'stand_down', reason: 'no_graph' };
  }

  const graphNumbers = collectModelValueNumbers(persistedGraph);
  let sawClaim = false;
  for (const sentence of splitSentencesPreservingDecimals(assistantText)) {
    const padded = wordsOnly(sentence);
    if (!containsWord(padded, 'already')) continue;
    if (!ALREADY_HOLDS_VERBS.some((verb) => containsWord(padded, verb))) continue;
    if (VALUE_ABSENT_MARKERS.some((marker) => padded.includes(wordsOnly(marker)))) continue;
    const asserted = extractAssertedNumbers(sentence);
    if (asserted.length === 0) continue;
    sawClaim = true;
    const anyHeld = asserted.some((n) =>
      n.candidates.some((candidate) => graphHolds(graphNumbers, candidate)),
    );
    if (anyHeld) continue;
    return {
      verdict: 'swap',
      pairs,
      assertedValues: asserted.map((n) => n.asWritten),
      sentence,
      text: composeMissingValueClaimCorrection(pairs),
    };
  }
  return {
    verdict: 'stand_down',
    reason: sawClaim ? 'value_present_in_graph' : 'no_already_holds_claim',
  };
}
