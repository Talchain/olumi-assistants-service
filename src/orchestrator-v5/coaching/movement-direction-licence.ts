/**
 * MAY THE PROSE REPORT A **DIRECTION** FOR THE MOVEMENT BETWEEN TWO RUNS?
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠⚠ THIS IS A THIRD QUESTION, AND NAMING IT APART IS THE WHOLE POINT
 * (CLAUDE.md trap #21). Three authorities now speak about "the movement
 * between two runs" and they answer three different questions:
 *
 *   `ContentSafeRunDelta.margin_direction` (`coaching/compare-runs.ts`)
 *     — "did the INTEGER percentage-point margin move by at least
 *       `MARGIN_EPSILON_PP` (0.5)?" A rounding threshold. It knows nothing
 *       about sample size and cannot know whether the movement is real.
 *
 *   `RunDelta.win_probabilities[].noise_verdict` (`coaching/build-run-delta.ts`)
 *     — "is THIS OPTION's win-probability movement distinguishable from
 *       sampling noise?" Per option, on the WIRE, and refused entirely when a
 *       producer echo is missing.
 *
 *   THIS MODULE
 *     — "may a SENTENCE say the lead widened / narrowed?" That sentence rests
 *       on two options at once (the margin is leader minus runner-up), so it
 *       needs a verdict about the PAIR, and it must fail closed when it cannot
 *       get one.
 *
 * ⛔ DO NOT "SIMPLIFY" BY DELETING THIS AND BRANCHING ON `margin_direction`.
 * That is the state the product shipped on 2026-09-03 and it produced the
 * defect this module exists to close: on the real capture
 * (`olumi-programme-docs` `artefacts/manual-test-2026-09-03/`) the leading
 * option moved 62% → 62.6% at n = 10,000, `margin_direction` read `widened`,
 * and the product told the user *"its lead has widened by about 1 percentage
 * point"*. The 2-SE band on that pair is 1.37 pp. The movement was inside it.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ⭐ WHAT THIS IS **NOT**: a noise band for the MARGIN. `Var(p_leader −
 * p_runnerUp)` needs the within-run covariance of two multinomial cells, and
 * no reviewed implementation of it exists in this repo. Rather than invent one
 * under a name that would then be read as authoritative, this module applies
 * the SHIPPED per-proportion band
 * ({@link noiseVerdictForProportions}) to BOTH options the margin is composed
 * of, and licenses a direction only when BOTH movements are `signal`. That is a
 * NECESSARY condition for the margin claim, deliberately conservative, and it
 * is stated as such rather than dressed up as a margin band.
 *
 * The asymmetry that justifies the conservatism is the estate's standing one:
 * a false *"your lead widened"* rewrites the user's understanding of their own
 * decision and (measured, same capture) gets elaborated into an invented causal
 * mechanism by the next model-authored turn; a false *"unchanged"* merely
 * withholds.
 *
 * PURE AND TOTAL. No I/O, no LLM, no clock. Reads two persisted PLoT
 * envelopes and returns a discriminated verdict.
 */

import type { HandlerFact } from '@talchain/schemas/orchestrator';

import {
  isUsableWinProbability,
  winnerOptionResultSource,
} from '../../orchestrator/context/option-result-source.js';

import { noiseVerdictForProportions } from './win-probability-noise-band.js';

/**
 * What the evidence supports. THREE states, DISCRIMINATED rather than a
 * boolean, for the reason `RunDeltaRefusal` gives: *"we had no pair"*, *"we had
 * a pair and both movements were inside the band"* and *"we had a pair and the
 * two disagreed"* are different facts about the product, and each licenses a
 * DIFFERENT sentence. A consumer that cannot tell them apart will say one
 * sentence in all three cases, and it will be false in two of them.
 */
export type MovementDirectionLicence =
  /** BOTH margin-defining options moved by more than the band. Say the direction. */
  | { readonly kind: 'licensed' }
  /**
   * BOTH moved by LESS than the band. The only state in which prose may say
   * "the figures moved by less than this model varies between runs" — that
   * sentence is a claim about both quantities, and it is false the moment one
   * of them cleared the band.
   */
  | { readonly kind: 'within_noise' }
  /**
   * Neither claim is supported. Either no band could be computed, or the two
   * constituents DISAGREED — one cleared the band and the other did not.
   *
   * ⚠ THE MIXED CASE LIVES HERE, NOT UNDER `within_noise`, AND THAT IS A
   * CORRECTION TO THIS MODULE'S FIRST CUT. It originally folded "not both
   * signal" into `within_noise`, which made the consumer emit "the figures
   * moved by less than this model varies between runs" on a pair where one
   * figure had moved by MORE — a false statement produced by a guard written
   * to prevent false statements. One predicate cannot carry two harms
   * (CLAUDE.md trap 22b); the third state is what keeps each sentence true of
   * exactly its own case.
   */
  | { readonly kind: 'indeterminate'; readonly reason: MovementLicenceIndeterminateReason };

export type MovementLicenceIndeterminateReason =
  /**
   * Fewer than two options carry an identity-bound win probability in BOTH
   * runs, so the margin's two constituents cannot both be tracked across the
   * pair.
   */
  | 'no_identity_bound_pair'
  /**
   * At least one of the two options carries no usable sample size on at least
   * one side. Without `n` there is no band — and a default `n` would be a
   * fabricated one.
   */
  | 'sample_size_unavailable'
  /**
   * The normal approximation does not hold for at least one of the four
   * proportion/`n` combinations, so the band itself is not defensible.
   */
  | 'not_noise_qualified'
  /**
   * A band existed for both, and they disagreed: one movement cleared it and
   * the other did not. The margin is their DIFFERENCE, so neither "it moved"
   * nor "it did not" is established.
   */
  | 'mixed_verdicts';

/**
 * One option's cross-run pair: its win probability and sample size on each
 * side. Carried as a single value rather than two parallel maps so a caller
 * cannot pair one run's probability with the other run's `n` — the same
 * construction `RunEchoes` uses in `build-run-delta.ts`.
 */
interface OptionMovement {
  readonly prior: number;
  readonly current: number;
  readonly priorN: number;
  readonly currentN: number;
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * The option's Monte-Carlo sample size.
 *
 * ⚠ READ FROM `outcome.n_samples`, NOT FROM `meta.n_samples` — and that is a
 * MEASUREMENT, not a preference. On the 2026-09-03 capture the PLoT envelope
 * CEE persisted carried `enrichment.meta === null` and `enrichment._meta ===
 * null`, while every entry of `option_comparison[]` carried
 * `outcome.n_samples: 10000`. A reader keyed on `meta` therefore finds nothing
 * on the live path (which is exactly why `buildRunDelta` refuses with
 * `echoes_incomplete` there and the wire `run_delta` block is dark).
 *
 * The two readers are NOT redundant and must not be converged: `readRunEchoes`
 * needs a RUN-LEVEL `n` to compare against the other run's for `n_equal`, and
 * absence there is a legitimate refusal of the whole provenance record. This
 * one needs a PER-OPTION `n` to size a band, and it is available.
 */
function readOptionSampleSize(entry: Record<string, unknown>): number | null {
  const outcome = readRecord(entry.outcome);
  const raw = outcome === null ? undefined : outcome.n_samples;
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0 ? raw : null;
}

interface OptionReading {
  readonly winProbability: number;
  /** null when the envelope carries no usable per-option sample size. */
  readonly nSamples: number | null;
}

/**
 * Identity-bound win probability + sample size per option.
 *
 * Identity discipline is `identityBoundWinProbabilities`': `option_id` only
 * (never a label — trap 19), and a DUPLICATE ID DROPS BOTH ENTRIES, because
 * picking either would attach a number to an option by guess.
 */
function readOptionReadings(
  enrichment: Record<string, unknown>,
): ReadonlyMap<string, OptionReading> {
  const found = new Map<string, OptionReading>();
  const ambiguous = new Set<string>();

  for (const entry of winnerOptionResultSource(enrichment)) {
    const id = entry.option_id;
    if (typeof id !== 'string' || id.length === 0) continue;
    if (!isUsableWinProbability(entry.win_probability)) continue;
    if (found.has(id)) {
      ambiguous.add(id);
      continue;
    }
    found.set(id, {
      winProbability: entry.win_probability,
      nSamples: readOptionSampleSize(entry),
    });
  }

  for (const id of ambiguous) found.delete(id);
  return found;
}

/**
 * The two options whose difference IS the margin the sentence quantifies: the
 * CURRENT run's highest and second-highest win probability.
 *
 * Ties break on `option_id` so the selection is deterministic and a replayed
 * capture gives the same answer forever.
 */
function currentMarginPair(
  current: ReadonlyMap<string, OptionReading>,
): readonly [string, string] | null {
  const ordered = [...current.entries()].sort((a, b) => {
    if (b[1].winProbability !== a[1].winProbability) {
      return b[1].winProbability - a[1].winProbability;
    }
    return a[0].localeCompare(b[0]);
  });
  if (ordered.length < 2) return null;
  return [ordered[0]![0], ordered[1]![0]];
}

/**
 * May the prose report that the lead widened or narrowed?
 *
 * @param priorEnrichment   the PLoT envelope of the run being compared against
 * @param currentEnrichment the PLoT envelope of the run just completed
 */
export function licenceToReportMovementDirection(input: {
  readonly priorEnrichment: Record<string, unknown>;
  readonly currentEnrichment: Record<string, unknown>;
}): MovementDirectionLicence {
  const prior = readOptionReadings(input.priorEnrichment);
  const current = readOptionReadings(input.currentEnrichment);

  const pair = currentMarginPair(current);
  if (pair === null) return { kind: 'indeterminate', reason: 'no_identity_bound_pair' };

  const movements: OptionMovement[] = [];
  for (const optionId of pair) {
    const currentReading = current.get(optionId);
    const priorReading = prior.get(optionId);
    // The option must exist on BOTH sides: a margin constituent that was not
    // in the earlier run has no movement to bound, and treating its absence as
    // a movement from zero would fabricate one.
    if (currentReading === undefined || priorReading === undefined) {
      return { kind: 'indeterminate', reason: 'no_identity_bound_pair' };
    }
    if (currentReading.nSamples === null || priorReading.nSamples === null) {
      return { kind: 'indeterminate', reason: 'sample_size_unavailable' };
    }
    movements.push({
      prior: priorReading.winProbability,
      current: currentReading.winProbability,
      priorN: priorReading.nSamples,
      currentN: currentReading.nSamples,
    });
  }

  const verdicts = movements.map((m) =>
    noiseVerdictForProportions(m.prior, m.current, m.priorN, m.currentN),
  );

  // `not_noise_qualified` is NOT "within noise" — it is "no band exists here".
  // Folding it into `within_noise` would report a bound we did not compute.
  if (verdicts.some((v) => v === 'not_noise_qualified')) {
    return { kind: 'indeterminate', reason: 'not_noise_qualified' };
  }
  // BOTH, not either — three times over. The margin is a DIFFERENCE of these
  // two quantities, so: both clearing the band licenses a direction; both
  // sitting inside it licenses the "less than this model varies" sentence; and
  // one of each licenses NEITHER, because the difference of a moved quantity
  // and an unmoved one is a movement we have not bounded.
  if (verdicts.every((v) => v === 'signal')) return { kind: 'licensed' };
  if (verdicts.every((v) => v === 'within_noise')) return { kind: 'within_noise' };
  return { kind: 'indeterminate', reason: 'mixed_verdicts' };
}

/**
 * The PLoT envelope persisted on a `run_analysis` fact, or null.
 *
 * ⭐ ONE READER, EXPORTED. Both consumers of this module need to get from a
 * `HandlerFact` to the envelope, and two private copies of a shape-narrowing
 * read is a hand-maintained mirror waiting to drift (CLAUDE.md trap #12) —
 * one that would drift SILENTLY, because a copy that stopped recognising an
 * envelope would simply hand back `null` and the licence would fail closed
 * without anything going red.
 */
export function readRunAnalysisEnrichment(
  fact: HandlerFact,
): Record<string, unknown> | null {
  if (fact.fact_type !== 'run_analysis') return null;
  const enrichment = fact.result.enrichment;
  return enrichment !== null && typeof enrichment === 'object' && !Array.isArray(enrichment)
    ? (enrichment as Record<string, unknown>)
    : null;
}
