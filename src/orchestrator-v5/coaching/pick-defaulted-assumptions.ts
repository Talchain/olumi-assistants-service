/**
 * V5 coaching — pick the ENGINE's own `enrichment.defaulted_assumptions`
 * disclosure from the SAME run_analysis fact every other grounding layer reads.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS — A DISCLOSURE THE PRODUCER ALREADY SHIPS AND NOBODY READ
 *
 * ⚠⚠ THE SENTENCE THAT USED TO OPEN THIS BLOCK WAS FALSE, AND IT IS THE WHOLE
 * F6 DEFECT — REPLACED RATHER THAN QUIETLY DELETED (CLAUDE.md trap 14). It
 * read: "ISL/PLoT emit a TOP-LEVEL `enrichment.defaulted_assumptions[]` on
 * every analysis…". PLoT has only ever emitted it NESTED:
 *
 *     enrichment.decision_brief.defaulted_assumptions
 *
 * (PLoT `assembly/decision-brief.ts`, returned at `run.ts`; the key is NOT in
 * `ISL_TOPLEVEL_ENRICHMENT_KEYS` and there is no wholesale spread that would
 * hoist it). CEE persists PLoT's response BYTE-FOR-BYTE into the `run_analysis`
 * fact's `result.enrichment` (`tools/handlers/run-analysis.ts`), so the nesting
 * survives verbatim onto every later turn — which is exactly why the disclosure
 * is available at all, and exactly which key it is under.
 *
 * The cost of the wrong path: this selector returned `null` on EVERY real
 * payload from the day it shipped, so `defaulted_disclosure` was always `null`,
 * the stability axis was never collapsed, and NO surface ever disclosed
 * anything — while the suite that shipped it was fully green.
 *
 * ⭐ HOW A GREEN SUITE MISSED IT, because that is the reusable part. The
 * original suite DID source from a real capture — it cites
 * `fixtures/dsk-walk/session-a.enrichment.json:949` — but it copied the ARRAY
 * ENTRY and then authored the ENVELOPE around it by hand
 * (`enrichment: { defaulted_assumptions: … }`). Line 949 sits at four-space
 * indentation INSIDE `decision_brief`. The entry was the producer's; the PATH
 * was the author's model of the producer. CLAUDE.md trap 16-inverse, verbatim:
 * *a fixture you wrote yourself is not evidence about the wire.* The guard
 * against a repeat is `coaching/__tests__/defaulted-assumptions-producer-path.
 * test.ts`, which loads the captured envelope VERBATIM and refuses to construct
 * an enrichment object at all.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ TWO ENTRY SHAPES, AND ONLY ONE OF THEM NAMES A FACTOR
 *
 * The sentence that used to sit here read: "Each entry carries a
 * `factor_label`, a `source` (`"value_defaulted"`) and a user-facing `note`."
 * That is true of ONE of the two shapes the producer emits, and the other one
 * is the shape every live capture since 10 Aug 2026 actually carries — so the
 * premise was inverted against reality. Replaced rather than deleted
 * (CLAUDE.md trap 14). Read verbatim off dated captures:
 *
 *   FACTOR-LEVEL   { factor_label: 'Market Conditions',
 *                    source: 'value_defaulted', note: 'No starting value…' }
 *                  — `__tests__/fixtures/dsk-walk/session-a.enrichment.json`
 *
 *   ENGINE-LEVEL   { factor_label: null, code: 'ROOT_NODE_DEFAULT_VALUE',
 *                    source: 'default_disclosure',
 *                    note: "No observed value provided for root node
 *                           '099f7ecf'; defaulted to 0.0…" }
 *                  — `compose/__tests__/fixtures/analysis-result-live-
 *                    2026-09-03.json`, `cee/decision-review/__tests__/fixtures/
 *                    live-decision-review-2026-09-03.json`,
 *                    `compose/__tests__/fixtures/c2-context-response-
 *                    20260907T203538Z.json`
 *
 * ⭐ AN ENGINE-LEVEL ENTRY NAMES NO FACTOR. It discloses that the ENGINE
 * substituted a value for a node it could not read — identified by a raw node
 * id, which is not a factor and is not showable. Counting one as a factor is
 * how the product came to tell people "2 of the factors in your model have no
 * value set" when neither entry was a factor (the sentence is preserved in the
 * `c2-context-response` capture). A tool whose job is to help someone reason
 * about their own model must not miscount that model back at them.
 *
 * ⚠ THE TWO SHAPES ARE TWO QUESTIONS (CLAUDE.md trap 21) AND THE FIX NAMES
 * THEM APART RATHER THAN RECONCILING THEM: `count` answers "how many defaults
 * did the engine disclose?" (the evidence that suppresses a stability claim);
 * `factorCount` answers "how many of them can we truthfully call a factor in
 * your model?" (the only number the sentence may spend). They were one field,
 * and one field spent on two questions is exactly this estate's dominant
 * defect. Do NOT re-merge them, and do NOT remap an engine code into a
 * factor-shaped claim — where nothing nameable arrived, the sentence says so
 * and asserts no count at all.
 *
 * ⚠ SEPARATE, OWNED ELSEWHERE: the reason only engine-level codes survive
 * today is the `factor_sensitivity[].value_defaulted` regression of 10 Aug
 * 2026, which is an ISL/PLoT restore. This module makes the count and the noun
 * truthful given WHATEVER arrives; it does not, and must not, manufacture the
 * factor-level entries back.
 *
 * The cost of that was measured on the deployed build. With
 * `analysis_ready.options[].status = needs_encoding` on the same payload, an
 * ORDINARY CHAT TURN emitted:
 *
 *   "'…HubSpot next quarter' currently leads, with a probability of 96%.
 *    '…migrate to Salesforce instead' is the most likely contender to overtake
 *    it, with a probability of 2%. This result looks stable, so smaller
 *    changes are less likely to flip the outcome on their own."
 *
 * The ANALYSE turn discloses its placeholders correctly (the scaffold
 * disclosure, `coaching/scaffold-disclosure.ts`). The CONVERSATIONAL
 * recitation dropped the disclosure and then added a STABILITY ASSERTION on
 * top of the same numbers — a confidence claim about values the product itself
 * calls placeholders.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY NOT THE SCAFFOLD CHANNEL
 *
 * `HandlerOutcome.__scaffolded_options` (the analyse turn's disclosure input)
 * has ONE writer (`tools/handlers/run-analysis.ts`) and two SAME-TURN sinks
 * (the configure chip and the decision-review prompt). It is never persisted,
 * never projected into `ContextPackAnalysis`, and absent from
 * `AnalysisProjectionSummary` — so a later conversational turn structurally
 * cannot consult it. `defaulted_assumptions` is the signal that DOES survive,
 * because it rides the persisted enrichment.
 *
 * ⚠ THE TWO ARE NOT THE SAME QUESTION AND ARE DELIBERATELY NOT UNIFIED
 * (CLAUDE.md trap 21). `__scaffolded_options` answers "which OPTIONS did CEE
 * scaffold on this turn?"; `defaulted_assumptions` answers "which FACTORS did
 * the ENGINE compute on a defaulted value?". Different producers, different
 * objects, different lifetimes. This module reads only the second and makes no
 * claim about the first.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SAME SELECTOR, NOT A SECOND ONE
 *
 * Deliberately built as the exact sibling of `pick-raw-robustness.ts`: it
 * routes through the SAME `selectRunAnalysisFact`, so the defaulted-value
 * verdict and the robustness verdict can never be read off two different runs.
 * That drift class is why `pickLatestRawRobustness` was centralised, and the
 * same reasoning applies unchanged here.
 *
 * Returns `null` when no successful run_analysis fact exists, when the fact
 * carries no enrichment, or when the array is absent/empty/unusable — i.e.
 * "no evidence of defaulting", which every caller treats as the pre-existing
 * behaviour (fail-safe: it makes no new claim).
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import { selectRunAnalysisFact } from '../context/freshness.js';
import { sanitiseLabel } from '../context/enrichment-graph-labels.js';

/**
 * Maximum factor labels named in the disclosure sentence. Beyond this the
 * sentence states the COUNT rather than a truncated list — a half-list reads
 * as a complete one, which is the same under-disclosure the scaffold module's
 * plural form exists to avoid.
 */
export const MAX_NAMED_DEFAULTED_FACTORS = 3;

/**
 * The engine's defaulted-value verdict for one analysis.
 *
 * THREE NUMBERS, THREE QUESTIONS, DELIBERATELY NOT COLLAPSED:
 *
 *   `count`        how many defaults the engine DISCLOSED — the EVIDENCE that
 *                  its results rest on substituted inputs. Every gate in this
 *                  feature reads this one, and it counts engine-level codes,
 *                  because a code is still evidence.
 *   `factorCount`  how many of those disclosures ATTRIBUTE the default to a
 *                  factor in the user's model. The ONLY number the sentence
 *                  may spend. `factorCount <= count`, and it is 0 on every
 *                  payload that carries engine-level codes alone.
 *   `named.length` how many of those factors we can SHOW, capped at
 *                  {@link MAX_NAMED_DEFAULTED_FACTORS}. `factorCount >
 *                  named.length` is the builder's signal not to present the
 *                  list as exhaustive.
 *
 * ⚠ `count` IS NOT A COUNT OF FACTORS. It was spent as one, and that is the
 * defect this shape exists to make unrepeatable — pinned by
 * `__tests__/defaulted-code-is-not-a-factor.test.ts`, which asserts the
 * sentence is INVARIANT to `count`.
 */
export interface DefaultedAssumptionsSignal {
  /** Uncapped number of `defaulted_assumptions` entries on the analysis. */
  readonly count: number;
  /** Uncapped number of those entries that name a factor. Never > `count`. */
  readonly factorCount: number;
  /** Up to {@link MAX_NAMED_DEFAULTED_FACTORS} sanitised factor labels. */
  readonly named: readonly string[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (value == null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Normalise a RAW `defaulted_assumptions` value into
 * {@link DefaultedAssumptionsSignal}, or `null` when it carries no usable
 * evidence.
 *
 * Shape-agnostic like {@link import('./pick-raw-robustness.js')}'s normaliser
 * and for the same reason: the array is a passthrough field on an untyped
 * enrichment seam (CLAUDE.md hazard 2 — the PLoT→CEE enrichment payload is
 * `z.record`, so its shape is NOT enforced by the contract). Every entry is
 * therefore read defensively.
 *
 * ⭐ COUNTED BY ENTRY, ATTRIBUTED BY LABEL, NAMED BY SANITISED LABEL — three
 * separate readings of the same entry, and each one is load-bearing:
 *
 *   EVIDENCE (`count`) — every object entry counts, including an engine-level
 *   code. It is evidence that a value was defaulted, which is the claim the
 *   stability suppression rests on. Dropping one from the evidence count would
 *   let a code silently restore a confidence assertion over guessed inputs —
 *   the mirror harm, and strictly the worse of the two (trap 22b).
 *
 *   ATTRIBUTION (`factorCount`) — an entry names a factor iff it carries a
 *   non-blank `factor_label` STRING. Derived from the entry itself, never from
 *   a list of known engine codes: a hand-kept code vocabulary is the mirror
 *   this estate keeps paying for (trap 12), and it would mis-classify the
 *   first code nobody has met yet. `factor_label: null` ⇒ names no factor,
 *   whatever the `source` or `code` says.
 *
 *   DISPLAY (`named`) — the stricter {@link sanitiseLabel} guard, which also
 *   rejects raw ids and UUIDs. An id-shaped label still ATTRIBUTES the default
 *   to a factor (the engine identified one) while being unshowable, so such an
 *   entry raises `factorCount` and not `named` — and the sentence truthfully
 *   says "one of the factors in your model" without inventing a name.
 */
export function readDefaultedAssumptions(
  defaultedValue: unknown,
): DefaultedAssumptionsSignal | null {
  if (!Array.isArray(defaultedValue) || defaultedValue.length === 0) return null;

  const named: string[] = [];
  let count = 0;
  let factorCount = 0;
  for (const raw of defaultedValue) {
    const entry = asObject(raw);
    if (entry === null) continue;
    count += 1;
    const label = entry['factor_label'];
    // NAMES NO FACTOR — an engine-level disclosure. Evidence, never a factor.
    if (typeof label !== 'string' || label.trim().length === 0) continue;
    factorCount += 1;
    if (named.length >= MAX_NAMED_DEFAULTED_FACTORS) continue;
    const clean = sanitiseLabel(label, '');
    if (clean === null || clean.length === 0) continue;
    named.push(clean);
  }

  if (count === 0) return null;
  return { count, factorCount, named: Object.freeze(named) };
}

/**
 * Read the defaulted-value array off a persisted enrichment envelope.
 *
 * ⭐ TWO PATHS, ONE OF THEM REAL, AND DELIBERATELY NOT THREE. The nested path
 * is the producer's and is tried FIRST; the top-level read is retained ONLY as
 * a tolerated alternative, so that (a) if PLoT ever hoists the key into
 * `ISL_TOPLEVEL_ENRICHMENT_KEYS` this reader keeps working across the deploy
 * skew rather than going dark for a window, and (b) the historic facts written
 * by any future hoist are still readable. Nothing else may be added here: a
 * third speculative path would make this function unfalsifiable — it would
 * "work" against any envelope anyone imagined, which is precisely the property
 * that let the original defect ship.
 *
 * Exported so the producer-path suite can bind to THIS function by identity
 * rather than re-implementing the traversal (CLAUDE.md trap 19).
 */
export function readDefaultedAssumptionsFromEnrichment(
  enrichment: unknown,
): DefaultedAssumptionsSignal | null {
  const envelope = asObject(enrichment);
  if (envelope === null) return null;

  // The producer's real path.
  const brief = asObject(envelope['decision_brief']);
  const nested =
    brief === null ? null : readDefaultedAssumptions(brief['defaulted_assumptions']);
  if (nested !== null) return nested;

  // Tolerated alternative — see the note above.
  return readDefaultedAssumptions(envelope['defaulted_assumptions']);
}

export function pickLatestDefaultedAssumptions(
  priorFacts: readonly HandlerFact[],
): DefaultedAssumptionsSignal | null {
  const selected = selectRunAnalysisFact(priorFacts);
  if (selected === null) return null;
  const fact = selected.fact;
  if (fact.fact_type !== 'run_analysis') return null;
  return readDefaultedAssumptionsFromEnrichment(fact.result.enrichment);
}

/**
 * THE SINGLE SOURCE of the conversational-layer defaulted-value disclosure.
 *
 * Deliberately ONE builder, in ONE module, for the same reason
 * `coaching/scaffold-disclosure.ts` owns the analyse turn's sentence: a second
 * copy of the words drifts, and a drifted disclosure is worse than none
 * because it reads as oversight (CLAUDE.md trap 12).
 *
 * ⚠ THE VOCABULARY IS INHERITED, NOT INVENTED. "the comparison is illustrative
 * until …" is the ratified scaffold-disclosure phrasing (P2-4, A1 execution
 * ruling): placeholder values shift EVERY option's relative position, so the
 * caveat names the WHOLE comparison, never just the option that carries the
 * default. Scoping it narrower would under-disclose.
 *
 * ⚠ IT DESCRIBES WHAT THE PRODUCT DID, NEVER WHAT THE USER DID (the standing
 * ruling). "The analysis used a default for X" is a statement about our own
 * computation; "you did not set X" would be a statement about the user, and is
 * also false where the drafter, not the user, owned the omission.
 */
/**
 * The disclosure's INVARIANT TAIL — the substring that is identical for every
 * subject/count permutation the builder can produce.
 *
 * ⭐ IT EXISTS SO THE EGRESS LAYER CAN RECOGNISE THIS SENTENCE WITHOUT OWNING A
 * COPY OF IT (CLAUDE.md trap 12: derive, don't mirror). `compose/
 * defaulted-value-egress.ts` must answer "is the canonical disclosure already
 * in this text?" to keep it to EXACTLY ONE. A hand-copied fragment there would
 * drift the moment the words here change, and the drift is silent in the worst
 * direction: the egress layer stops recognising the deterministic composers'
 * disclosure and appends a SECOND one.
 *
 * `buildDefaultedAssumptionsDisclosure` is required to end with this string —
 * pinned by the builder/tail agreement test, which fails if either side moves.
 */
/*
 * ⚠ NUMBER AGREEMENT. This tail must read correctly for EVERY count the
 * builder can produce, because it is invariant BY DESIGN while the subject and
 * verb before it are not. It previously ended `until THOSE VALUES are set`,
 * which is anaphoric and demands a plural antecedent — so the singular
 * permutation shipped `…a default value for ONE of the factors in your model,
 * which HAS no value set, so the comparison is illustrative until THOSE VALUES
 * are set`, observed on the 2026-09-05 founder journey. `real values` is a
 * GENERIC plural with no antecedent to agree with, so it reads correctly at
 * count 1 and at count N, and the tail stays a single invariant string.
 */
export const DEFAULTED_DISCLOSURE_TAIL =
  'so the comparison is illustrative until real values are set.';

/**
 * The clause for defaults the engine disclosed WITHOUT attributing them to a
 * factor.
 *
 * ⛔ IT DELIBERATELY ASSERTS NO COUNT AND NO NAME. An engine-level code carries
 * a raw node id, not a factor; turning it into "one of the factors in your
 * model" would be the fabrication this whole module exists to prevent, one
 * level down. Where nothing nameable arrived, the honest sentence says exactly
 * that — the absence IS the disclosure, and the user's next move (open the
 * model and look) is the same either way.
 *
 * ⚠ NUMBER AGREEMENT, for the same reason {@link DEFAULTED_DISCLOSURE_TAIL}
 * says `real values`: `defaults` here is a GENERIC plural with no antecedent,
 * so it reads correctly over one unattributed disclosure and over five, and no
 * count has to be smuggled in to make the grammar work.
 */
const UNATTRIBUTED_DEFAULTS_CLAUSE = 'used defaults it did not attribute to a named factor';

/**
 * ⚠ EVERY NUMBER IN THIS SENTENCE COMES FROM `factorCount`. `count` is read
 * here ONCE, and only as a BOOLEAN — "is there an unattributed remainder?" —
 * never as a quantity in the copy. Spending it as a quantity is precisely the
 * defect that shipped "2 of the factors in your model" over two engine-level
 * codes that named no factor at all.
 *
 * Pinned by `__tests__/defaulted-code-is-not-a-factor.test.ts`: raising `count`
 * while holding `factorCount` fixed may add the remainder clause and may NEVER
 * change the number of factors claimed.
 */
export function buildDefaultedAssumptionsDisclosure(
  signal: DefaultedAssumptionsSignal,
): string {
  const { count, factorCount, named } = signal;
  /** Engine-level disclosures riding alongside — a boolean, never a quantity. */
  const hasUnattributed = count > factorCount;

  // NOTHING NAMEABLE ARRIVED — engine-level disclosures only.
  if (factorCount <= 0) {
    return `The analysis ${UNATTRIBUTED_DEFAULTS_CLAUSE}, ${DEFAULTED_DISCLOSURE_TAIL}`;
  }

  const subject =
    named.length > 0 && factorCount === named.length
      ? named.length === 1
        ? `'${named[0]}'`
        : `${named.slice(0, -1).map((l) => `'${l}'`).join(', ')} and '${named[named.length - 1]}'`
      : factorCount === 1
        ? 'one of the factors in your model'
        : `${Math.min(factorCount, 99)} of the factors in your model`;
  const verb = factorCount === 1 ? 'has' : 'have';
  // MIXED — real factors AND unattributed engine-level defaults. Naming only
  // the factors would present a half-list as a complete one, which is the same
  // under-disclosure MAX_NAMED_DEFAULTED_FACTORS exists to avoid; inflating the
  // factor count to cover both is the defect this function was repaired for.
  // So: count what is a factor, and disclose the rest as what it is.
  const remainder = hasUnattributed ? ` and also ${UNATTRIBUTED_DEFAULTS_CLAUSE},` : '';
  return (
    `The analysis used a default value for ${subject}, which ${verb} no value set,${remainder} `
    + DEFAULTED_DISCLOSURE_TAIL
  );
}
