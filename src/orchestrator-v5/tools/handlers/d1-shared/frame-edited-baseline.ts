/**
 * ⭐⭐ THE EDIT SEAM'S BASELINE FRAME — "same number, same factor, one outcome".
 *
 * ── THE DEFECT THIS CLOSES ──────────────────────────────────────────────────
 * A magnitude stated in the BRIEF gets framed by the records projector (pass
 * 3d: `value = raw / frame`, `raw_value = raw`, frame deliberately not stored)
 * and analyses. The IDENTICAL magnitude typed into the EDITOR does not: with no
 * cap and no prior frame, `normaliseFactorValue` writes `{raw_value: x, value:
 * x}` — raw === value BY CONSTRUCTION — which fails `recoverScaleFrame`'s
 * `raw > value` precondition BY CONSTRUCTION, so the analysis gate
 * (`findScaleIncoherentBaselineFactorIds`) refuses the very state the edit path
 * just manufactured. The product accepts the edit and then declines to analyse
 * it, and its own refusal copy says "Telling me the same amount again won't
 * clear it" — which is true, and is the whole problem: the product advises the
 * user to set a real value, and then refuses the value they set.
 *
 * ── THE GUARD IS THE WHOLE JOB, AND IT HAS THREE CONJUNCTS ─────────────────
 * Two OPPOSITE harms are in play, and trap 22b's ruling is that two harms
 * cannot share one window:
 *
 *   · GAP  — failing to frame a magnitude that needs it leaves the refusal
 *            standing. The user loses an answer they should have had.
 *   · LIE  — framing a magnitude that does NOT need it silently rescales a
 *            number the user stated. NRR 1.10 framed on
 *            `nextNiceNumberAbove(1.10) = 2` becomes 0.55 — a 2× distortion
 *            under a green suite; on other magnitudes the same mistake is a
 *            100× class of error.
 *
 * So there are separate parameters, never one tuned window. THREE, in the end —
 * and the third was NOT foreseen: it was forced by the estate's own standing
 * corpus after the first two shipped a green suite that reframed a headcount
 * from 20 to 0.4. That is trap 22 landing on this very PR, and it is recorded
 * here rather than tidied away.
 *
 *   SCOPE  (anti-gap, anti-regression) — `wouldAnalysisRefuse` LITERALLY CALLS
 *          `findScaleIncoherentBaselineFactorIds`, the analysis gate's own
 *          function, on the prospective post-write nodes. We frame only a write
 *          the gate WOULD HAVE REFUSED. This is derivation, not
 *          re-implementation: capless / outside-[0,1] / frameless / not
 *          self-framed are never restated here, so the predicate CANNOT drift
 *          from the gate — if the gate gains or loses a condition, this seam
 *          follows in the same commit, with no list to hand-maintain (trap 12).
 *          Its consequence is the load-bearing safety property: a factor that
 *          analyses today is untouched, because the gate does not refuse it.
 *
 *   EVIDENCE (anti-lie) — `factorCarriesNormalisedInterventions`. A baseline can
 *          only be INCOHERENT WITH something: if the factor's options carry no
 *          normalised interventions, there is no convention it has fallen out
 *          of, and framing it is gratuitous. Derived from the gate's own
 *          rationale, not fitted to the corpus that exposed the need.
 *
 *   SAFETY (anti-lie) — `magnitudeIsUnambiguouslyScaleBearing`. Being refused
 *          is NOT on its own a licence to frame: the refusal set also contains
 *          magnitudes the estate's own doctrine says must stay raw. Every
 *          exclusion here falls back to today's refusal — an honest "I can't"
 *          rather than a confident wrong number, which is trap 22f's ruling
 *          (make the ambiguity the product) applied to arithmetic.
 *
 * ⚠ A guard keyed on "no prior pair" instead of on the gate's own predicate
 * would satisfy neither: it would frame factors the gate exempts (self-framed
 * ones, capped ones), i.e. break things that work today.
 *
 * Pure, total, no I/O.
 */

import {
  extractNumericInterventionValue,
  findScaleIncoherentBaselineFactorIds,
} from '../../plot-intervention-scale.js';
import {
  deriveFactorScaleFrame,
  isBasisPointsUnit,
  isPercentScaledUnit,
} from './scale-frame.js';

/**
 * ⭐ THE RAW-PERMITTED CEILING, QUOTED FROM THE PRODUCER'S OWN DOCTRINE — not
 * an invented constant (trap 22f bans settling an ambiguity with arbitrary
 * numbers). `prompts/defaults-v187.ts` NORMALISATION section, verbatim:
 *
 *   "Small unitless counts (0-10) may remain raw."
 *
 * and the same file's PERCENTAGE AND RATIO CONVENTION:
 *
 *   "Ratios that can exceed 100% (e.g., NRR, growth rate, ROI): value: raw
 *    ratio (e.g., 1.10 for 110%) … Do NOT normalise to 0-1."
 *
 * Both raw-permitted classes live at or below 10 as a VALUE (a small count is
 * 0–10 by the text; NRR/growth/ROI as a raw ratio is 1.1, 1.5, 3 — a metric at
 * 10 is already 1000%). Above 10 the same file's rule takes over without
 * exception: "Always normalise: cost, revenue, salary, users, time horizons,
 * headcount beyond small teams, budgets, and any value with real-world units."
 *
 * So 10 is the producer's stated boundary between the two regimes, read off the
 * prompt that authored the data — the same discipline trap 13c requires of an
 * expectation (derive it from the producer's declared semantics, never from our
 * own reading of what a number ought to mean).
 */
export const RAW_PERMITTED_MAGNITUDE_CEILING = 10;

/**
 * Is this magnitude one the doctrine above says MUST be normalised, with no
 * competing raw-permitted reading?
 *
 * Three exclusions, each falling back to today's honest refusal:
 *
 *  1. `magnitude <= 10` — the small-unitless-count class AND the raw-ratio
 *     class (NRR 1.10, growth 1.5, ROI 3). This is the exclusion that keeps the
 *     2× distortion out: 1.10 is refused today and stays refused, rather than
 *     being silently rewritten to 0.55.
 *
 *  2. a percent-scaled unit above 100 — `deriveFactorScaleFrame`'s percent
 *     branch is bounded at `max <= 100`, so a '%' magnitude ABOVE that bound
 *     has left the derivation's own declared percent convention and falls onto
 *     the generic {1,2,5} ladder. That fall-through IS the unbounded-ratio
 *     class the prompt names (NRR stated as 110 percentage points), where the
 *     ladder yields frame 200 → 0.55. Derived from the derivation's own bound,
 *     not from a second guess about units.
 *
 *  3. a basis-points unit above 10000 — the same reasoning, at the bps bound.
 *
 * ⚠ THE SPEC, WRITTEN AGAINST THE SPEC AND NOT AGAINST THE SYMPTOM (trap 13d):
 * this predicate answers "does the producer's doctrine mandate a frame for this
 * magnitude?", NOT "is this the money case I set out to fix?". Both directions
 * are pinned by tests, because a guard that only watches one door is how this
 * estate has traded one silent failure for its inverse.
 */
export function magnitudeIsUnambiguouslyScaleBearing(
  magnitude: number,
  unit: string | undefined,
): boolean {
  if (typeof magnitude !== 'number' || !Number.isFinite(magnitude)) return false;
  if (!(magnitude > RAW_PERMITTED_MAGNITUDE_CEILING)) return false;
  if (isPercentScaledUnit(unit) && magnitude > 100) return false;
  if (isBasisPointsUnit(unit) && magnitude > 10000) return false;
  return true;
}

/** The observed-state pair a prospective write would persist. */
export interface BaselinePair {
  readonly value: number;
  readonly raw_value: number;
}

const SLASH_INTERVENTION_RE = /^data\/interventions\/(.+)$/;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Every per-option intervention bundle reachable in these graphs, in the
 * spellings `encode-option-interventions.ts` enumerates as the ones the estate
 * actually persists: canonical top-level `interventions`, `data.interventions`,
 * and slash-keyed `data/interventions/<factor>`.
 *
 * ⭐ OVER-COLLECTION IS THE FAIL-SAFE DIRECTION, AND THAT IS WHY IT SCANS EVERY
 * SPELLING AND EVERY SUPPLIED GRAPH. The gate's self-framing test is a
 * `.some()` over these bundles: MORE bundles can only make a factor MORE likely
 * to count as self-framed, hence more likely to be EXEMPT from refusal, hence
 * LESS likely to be framed here — i.e. every collection error pushes toward
 * today's behaviour. Under-collection is the dangerous direction (it would let
 * us frame a factor the analysis gate exempts), so both the PARSED graph and
 * the RAW pre-parse graph are scanned: `NodeV3` strips undeclared keys, so
 * `data.interventions` survives only on the raw one.
 *
 * ⚠ THE SECOND CONSUMER PULLS THE OTHER WAY, AND THAT IS STATED RATHER THAN
 * GLOSSED: `factorCarriesNormalisedInterventions` reads this same list, and for
 * IT more bundles mean more evidence TO frame. The asymmetry is benign for two
 * structural reasons: the same bundle collected twice cannot change a boolean,
 * and a bundle enters here only if the graph genuinely persists an intervention
 * on this factor in one of the spellings above — which IS the evidence being
 * sought, not a fabricated stand-in for it. And an out-of-unit value in ANY
 * collected bundle makes that predicate return false outright, so the one
 * direction that could mislead is closed.
 */
export function collectPerOptionInterventionObjects(
  graphs: readonly unknown[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const graph of graphs) {
    if (!isPlainObject(graph)) continue;
    const nodes = graph.nodes;
    if (!Array.isArray(nodes)) continue;
    for (const n of nodes) {
      if (!isPlainObject(n)) continue;
      if (isPlainObject(n.interventions)) out.push(n.interventions);
      const data = isPlainObject(n.data) ? n.data : undefined;
      if (data !== undefined && isPlainObject(data.interventions)) {
        out.push(data.interventions);
      }
      const slash: Record<string, unknown> = {};
      let sawSlash = false;
      for (const [key, value] of Object.entries(n)) {
        const m = SLASH_INTERVENTION_RE.exec(key);
        if (m?.[1] !== undefined) {
          slash[m[1]] = value;
          sawSlash = true;
        }
      }
      if (sawSlash) out.push(slash);
    }
  }
  return out;
}

/**
 * The prospective node array: `nodes` with the target factor's observed_state
 * replaced by what the write would persist. Mirrors the handler's own `merged`
 * construction (spread the existing observed_state, then override the pair and
 * the resolved unit/cap) so the gate judges the state that will actually exist,
 * not an approximation of it.
 */
function withProspectiveObservedState(
  nodes: readonly unknown[],
  targetFactorId: string,
  pair: BaselinePair,
  unit: string | undefined,
  cap: number | undefined,
): unknown[] {
  return nodes.map((n) => {
    if (!isPlainObject(n) || n.id !== targetFactorId) return n;
    const existing = isPlainObject(n.observed_state) ? n.observed_state : {};
    return {
      ...n,
      observed_state: {
        ...existing,
        value: pair.value,
        raw_value: pair.raw_value,
        ...(unit !== undefined ? { unit } : {}),
        ...(cap !== undefined ? { cap } : {}),
      },
    };
  });
}

/**
 * ⭐⭐ THE EVIDENCE CONJUNCT — does a normalised convention exist for THIS
 * factor at all?
 *
 * ⚠ ADDED AFTER THE ESTATE'S OWN CORPUS REFUTED THE MAGNITUDE-ONLY GUARD, and
 * that refutation is the reason it is here rather than an idea I had. The
 * magnitude rule alone reframed `f-uncapped` — `{value: 12, raw_value: 12,
 * unit: 'people'}`, a HEADCOUNT — from 20 to 0.4, breaking two standing tests
 * that pin "a legitimate small-COUNT edit on a unit-bearing count factor"
 * (`set-factor-value-scale-redeclaration.test.ts:123,166`). A corpus written
 * from outside the author's head found the class the author did not imagine
 * (trap 22); the fix is a new PARAMETER, never a tuned constant, because the
 * constant would just move the cliff (trap 22f).
 *
 * ── WHY THIS IS THE PRINCIPLED DISCRIMINATOR, NOT A CURVE FIT ───────────────
 * Derived from the GATE'S OWN RATIONALE. A capless out-of-unit baseline is
 * refused because it sits beside NORMALISED siblings and PLoT would sum a raw
 * magnitude into a linear combination of levels. That harm requires the
 * siblings: if a factor's options carry no normalised interventions, the
 * baseline is not incoherent WITH anything, and inventing a frame for it is
 * gratuitous rescaling of a number the user stated. The money case has
 * `{opt_a: 0.6, opt_b: 0.3}` beside a 600,000 baseline — the baseline is
 * demonstrably the odd one out. The headcount factor's only option carries no
 * interventions at all (measured: zero occurrences of `interventions` in that
 * whole fixture), so nothing establishes a convention it has fallen out of.
 *
 * Uses the gate's OWN `extractNumericInterventionValue`, so the two seams read
 * an intervention the same way.
 *
 * ⚠ The out-of-unit branch is currently unreachable from
 * `frameEditedBaselineForAnalysis` — the SCOPE guard has already established
 * the factor is not self-framed, which means no intervention lies outside
 * [0,1]. It is written anyway, and stated as fail-closed rather than trimmed,
 * so that this predicate remains true standing alone if the gate's
 * self-framing rule ever changes.
 */
export function factorCarriesNormalisedInterventions(
  perOptionInterventions: readonly Record<string, unknown>[],
  factorId: string,
): boolean {
  let seen = 0;
  for (const bundle of perOptionInterventions) {
    const v = extractNumericInterventionValue(bundle[factorId]);
    if (v === null) continue;
    if (v < 0 || v > 1) return false; // not a normalised convention
    seen += 1;
  }
  return seen > 0;
}

export interface EditSeamBaselineFramingInput {
  /** The factor being written. */
  readonly targetFactorId: string;
  /** The pair `normaliseFactorValue` produced for this write. */
  readonly candidate: BaselinePair;
  /** The unit the write will persist (`parsed.unit ?? before.unit`). */
  readonly unit: string | undefined;
  /** The cap the write will persist (`parsed.cap ?? before.cap`). */
  readonly cap: number | undefined;
  /** Nodes of the graph the write lands on — the identity source. */
  readonly nodes: readonly unknown[];
  /**
   * Graphs to scan for option interventions. Pass BOTH the parsed graph and the
   * raw pre-parse graph; see `collectPerOptionInterventionObjects`.
   */
  readonly interventionSources: readonly unknown[];
}

/**
 * The framed pair to write INSTEAD of `candidate`, or `undefined` to leave the
 * write exactly as it is today.
 *
 * ⭐ THE INVARIANT, STATED AGAINST THE SPEC: *a value the drafting path would
 * have framed is framed identically at the edit seam.* `deriveFactorScaleFrame`
 * is called here — the same function, from the same module, that records pass
 * 3d applies to this exact data one seam earlier — so the two seams cannot
 * disagree about a magnitude's frame.
 *
 * ⚠ Returning `undefined` is ALWAYS safe: it is today's behaviour byte for
 * byte. Every guard, every precondition and the postcondition below all fail in
 * that direction, so no failure mode of this function can produce a number the
 * product would not otherwise have produced.
 */
export function frameEditedBaselineForAnalysis(
  input: EditSeamBaselineFramingInput,
): BaselinePair | undefined {
  const { targetFactorId, candidate, unit, cap, nodes, interventionSources } = input;

  if (targetFactorId.length === 0) return undefined;
  if (!Number.isFinite(candidate.value) || !Number.isFinite(candidate.raw_value)) {
    return undefined;
  }
  // A capped factor's cap IS its declared scale — the gate exempts it, and the
  // capped branch of `normaliseFactorValue` already divides by it. Belt and
  // braces: the SCOPE guard below would decline it anyway.
  if (cap !== undefined) return undefined;

  const perOptionInterventions = collectPerOptionInterventionObjects(interventionSources);

  // ── SCOPE GUARD: would the analysis gate refuse this write? ───────────────
  // Not "is there a prior pair", not "is the value big" — the gate's OWN
  // verdict on the prospective state, obtained by calling the gate.
  const refusedAsWritten = findScaleIncoherentBaselineFactorIds(
    withProspectiveObservedState(nodes, targetFactorId, candidate, unit, cap),
    perOptionInterventions,
    // `synthesisedByOption` omitted DELIBERATELY: absent means "nothing was
    // CEE-synthesised", so every out-of-unit intervention counts as user
    // authored and grants self-framing. That is the maximal-exemption reading,
    // i.e. the minimal-framing one — the safe direction at this seam, where we
    // are deciding whether to CHANGE a number.
  );
  if (!refusedAsWritten.includes(targetFactorId)) return undefined;

  // ── EVIDENCE GUARD: is there a normalised convention to be coherent WITH? ─
  if (!factorCarriesNormalisedInterventions(perOptionInterventions, targetFactorId)) {
    return undefined;
  }

  // ── SAFETY GUARD: does the producer's doctrine mandate a frame here? ──────
  const magnitude = candidate.raw_value;
  if (!magnitudeIsUnambiguouslyScaleBearing(magnitude, unit)) return undefined;

  const frame = deriveFactorScaleFrame([magnitude], unit);
  if (frame === undefined) return undefined;

  const framedValue = magnitude / frame;
  if (!Number.isFinite(framedValue)) return undefined;

  // The user's own number is KEPT in `raw_value` — that is what the display
  // chain and the delta operators read, so "£600,000" stays true on screen
  // while the analysis computes on 0.6. Exactly pass 3d's convention.
  const framed: BaselinePair = { value: framedValue, raw_value: magnitude };

  // ── POSTCONDITION: the frame we just derived must actually CLEAR the gate ─
  // Fail CLOSED. If `deriveFactorScaleFrame` and `recoverScaleFrame` ever
  // disagree about what a frame is — they are inverses, in one module, but that
  // is a property to VERIFY rather than assume — we fall back to today's
  // refusal instead of writing a pair the analysis would still decline. A fix
  // that leaves the user refused is a gap; a fix that rescales their number AND
  // leaves them refused is strictly worse than doing nothing.
  const refusedAsFramed = findScaleIncoherentBaselineFactorIds(
    withProspectiveObservedState(nodes, targetFactorId, framed, unit, cap),
    perOptionInterventions,
  );
  if (refusedAsFramed.includes(targetFactorId)) return undefined;

  return framed;
}
