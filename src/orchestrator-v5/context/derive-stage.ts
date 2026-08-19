/**
 * AUTHORITATIVE STAGE DERIVATION — CEE decides the reasoning stage from the
 * model it holds, instead of echoing the client's guess back at it.
 *
 * ─── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 *
 * Before this module the stage was a CLOSED CLIENT LOOP. The UI computed a
 * stage from canvas state (`src/v5/stageMapper.ts:deriveV5Stage`), sent it on
 * the turn, CEE echoed it back as `stage_indicator`, the UI stored it and
 * painted the pill. CEE — the only party holding authoritative model state —
 * never derived one.
 *
 * The measured consequence (derived at CEE `877affe2` / UI `4d1e650b`, with a
 * complete writer manifest): the loop could only ever produce `frame` and
 * `analyse`. `deriveV5Stage` emits only those two unless the UI store ALREADY
 * holds something further on, and the only writer that could put `decide` into
 * that store — the `setStage` RPC — is plumbed through `useScenario` and has
 * ZERO product call sites (proven with a contrast control: sibling mutators
 * `persistAnalysisSuccess`/`flushPendingSaves`/`createSharedBrief` return
 * 5/3/1 consumer files, `setStage` returns 0). Neither end could ORIGINATE
 * `decide`, so the stage had a fixed point at frame/analyse.
 *
 * Downstream, `compose/chip-generator.ts` carries coaching rules gated on
 * `input.stage === 'decide'` (`:906`, `:923`) and `=== 'review'` (`:934`).
 * Written, tested, deployed — and structurally unreachable, because no input
 * could put the generator into those stages. THE CODE PATH WAS LIVE AND THE
 * DATA COULD NOT REACH IT.
 *
 * ─── THE ONE AUTHORITY ───────────────────────────────────────────────────────
 *
 * `StageType` comes from `@talchain/schemas/boundary`, whose `Stage` enum
 * declares itself the canonical `stage_indicator` vocabulary and explicitly
 * instructs consumers to derive from it rather than re-declare it (a consumer
 * typing its own union is the named drift defect there). This module therefore
 * imports the type and mints no vocabulary of its own.
 *
 * Two OTHER stage vocabularies exist in the estate and are deliberately NOT
 * touched here: UI `ScenarioStage` (`frame|ideate|evaluate|decide|optimise`)
 * and CEE V4 `DecisionStage` (same five). Both already map to/from the wire
 * enum at their own edges (`src/v5/stageMapper.ts`). Reconciling all three is
 * a contract change and separate work.
 *
 * ─── THE PREDICATE, AND WHY IT IS THIS SMALL ─────────────────────────────────
 *
 * `decide` iff the analysis is FRESH and the model offers a genuine choice.
 *
 * The freshness verdict is NOT recomputed here. It is passed in from
 * `deriveAnalysisFreshness` — the estate's single freshness authority — because
 * a second derivation of the same fact is the hand-maintained-mirror defect
 * this codebase keeps paying for. That one word carries a great deal:
 * `'fresh'` already means a SUCCESSFUL `run_analysis` fact was selected AND its
 * `graph_hash_at_run` matches the current persisted graph (and, under
 * `CEE_OPTION_IDENTITY_FRESHNESS_GUARD`, that the analysed option set matches
 * too). A failed, refused or missing analysis derives `'none'`/`'unknown'`; a
 * mutated model derives `'stale'`. So freshness alone screens out every
 * not-really-analysed case without this module re-asking any of it.
 *
 * The second conjunct is the only thing freshness does not cover: a decision
 * needs something to decide BETWEEN. One option is not a choice, so the bar is
 * two or more options in the current graph.
 *
 * A goal check is deliberately ABSENT rather than forgotten: `run_analysis`
 * cannot succeed without a goal, so `'fresh'` already implies one. Re-deriving
 * it here would create a second authority that could disagree with the first.
 *
 * ─── ADDITIVE BY CONSTRUCTION (the "lose no affordance" ruling) ───────────────
 *
 * The stage model is flexible and user-adaptable: Olumi COACHES good practice
 * and never enforces a pipeline. The stage picks fallback copy and chips and
 * GATES NOTHING, and this module preserves that exactly — it returns a label,
 * never a permission.
 *
 * The rules are therefore ordered so that a turn which does not clear the
 * `decide` bar behaves EXACTLY as it did before: the requested stage is passed
 * through untouched. Nothing is demoted, no affordance is withdrawn, and a user
 * working out of order keeps everything they had.
 *
 * The single exception is the opposite-direction twin, and it exists because
 * without it this module would create the very lie it removes. Once CEE can
 * emit `decide`, the UI stores it and sends it back on the NEXT turn. If the
 * user has since edited the model, that turn arrives claiming `decide` while
 * the analysis under it has gone stale. Passing it through would leave the
 * product asserting a decision-ready state about a model it can no longer
 * vouch for — a sticky lie manufactured by the promotion itself. So a
 * `decide` request that no longer clears the bar, on a scenario that HAS a
 * graph, corrects to `analyse`.
 *
 * That branch is unreachable at the moment it ships (nothing can send `decide`
 * yet) and becomes live only as a consequence of this module's own promotion —
 * which is precisely why it is written now rather than after the first report
 * of a pill that will not come down.
 *
 * ─── WHAT THIS DOES NOT DO ───────────────────────────────────────────────────
 *
 * `review` STAYS UNREACHABLE, and that is a scope statement, not an oversight.
 * `review` means "a decision was taken and is being looked back on", and NO
 * signal for that exists anywhere in the persisted model — there is no
 * decision-recorded fact, no commitment marker, nothing to derive it from.
 * Inventing a trigger (say, "an analysis that has been fresh for N turns")
 * would fabricate a state the model does not contain and would light
 * `chip-generator.ts:934` on a lie. The honest position is that the `review`
 * chip remains dark until a decision-recording capability exists to ground it.
 */
import type { StageType } from '@talchain/schemas/boundary';

import type { AnalysisFreshness } from './freshness.js';

/**
 * The minimum number of options that constitutes a choice. Two is not a tuning
 * knob — it is the definition: with one option there is nothing to decide.
 */
export const MIN_OPTIONS_FOR_DECIDE = 2;

export interface StageDerivationInput {
  /**
   * The stage the client asked for. Used as the PASS-THROUGH value whenever the
   * model does not support a promotion, so every pre-existing turn keeps its
   * current behaviour byte-for-byte.
   */
  readonly requestedStage: StageType;
  /**
   * The turn's freshness verdict from `deriveAnalysisFreshness` — the single
   * freshness authority. Never recomputed here.
   */
  readonly freshness: AnalysisFreshness;
  /**
   * Count of options in the CURRENT persisted graph, from
   * `extractGraphOptionIds`. `null` means "no options source in the graph"
   * (indeterminate), which is treated as not-a-choice.
   */
  readonly optionCount: number | null;
  /**
   * Whether a persisted graph was read for this scenario. Bounds the
   * stale-`decide` correction so it cannot fire on a scenario with no model at
   * all (where the honest answer is the requested stage, typically `frame`).
   */
  readonly hasGraph: boolean;
}

/**
 * Pure and total. Returns the stage this turn should carry.
 *
 * Both the response's `stage_indicator` (the pill) and the chip generator read
 * the SAME `context.stage`, so a single return value moves the pill and the
 * coaching chips together — they cannot disagree about which stage the user is
 * in, which is the two-authorities defect this estate has shipped before.
 */
export function deriveAuthoritativeStage(input: StageDerivationInput): StageType {
  const { requestedStage, freshness, optionCount, hasGraph } = input;

  const modelSupportsDecide =
    freshness === 'fresh' && (optionCount ?? 0) >= MIN_OPTIONS_FOR_DECIDE;

  // PROMOTION — the capability this module exists to add.
  if (modelSupportsDecide) return 'decide';

  // THE TWIN — a stale `decide` echo must not outlive the analysis that earned
  // it. Bounded to scenarios that actually have a model, so a graphless turn is
  // never rewritten.
  if (requestedStage === 'decide' && hasGraph) return 'analyse';

  // Everything else is untouched: same stage, same chips, same copy as before.
  return requestedStage;
}
