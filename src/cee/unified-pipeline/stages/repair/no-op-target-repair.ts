/**
 * OPTION_NO_OP TARGET REPAIR — write the number the option's own label states,
 * instead of withdrawing the option.
 *
 * ## THE MEASURED DEFECT (Paul's session, 11 Sep 2026, `olumi-debug-5b41f0eb`)
 *
 * He asked *"should we increase the Pro plan price from £49 to £59 per month
 * with the next Pro feature release?"*. The draft promoted his question to an
 * option node, and the model emitted that option's intervention as **0.49 — the
 * FROM value — against a 0.49 baseline**. Two model-INVENTED siblings (£59,
 * £54) carried correct numbers. The analysis therefore recommended **£54, a
 * price he never mentioned**, and excluded his own question from the comparison.
 *
 * ## WHY THE MODEL WROTE 49, AND WHY THIS IS THE WRITER'S DEFECT
 *
 * The intervention value is an LLM emission passed through verbatim:
 * `draft/anthropic-graph-schema.ts` declares `option.data.interventions` as an
 * unconstrained `{type: "number"}`, and `extraction/intervention-extractor.ts`
 * early-returns to `buildInterventionsFromV4Data` whenever the option already
 * carries interventions — which it always does on this path — so every text
 * extractor beneath it is dead here.
 *
 * The deployed draft prompt carries Paul's brief verbatim as its own canonical
 * worked example, and **the example is correct** (`prompts/defaults.ts`):
 * `"Increase to £59 with Release" → 59` and `"Maintain £49 Price" → 49`. The
 * model followed it for the options it authored. **The defect is the THIRD
 * option — the user's own question promoted to an option node, which the worked
 * example does not cover.** The only rule anywhere matching *"from £49 to £59"*
 * is the BASELINE rule (*"parse raw value 49"*), and the only concrete
 * option-intervention rule is *"Set Status Quo interventions to baseline
 * values"*. An option wearing the user's from-to sentence as its name has ONE
 * worked rule producing 49 and NONE producing 59, so it lands in the status-quo
 * slot.
 *
 * ## ⛔ THIS IS NOT ANOTHER DETECTOR, AND IT MAKES NOTHING REFUSE MORE
 *
 * `OPTION_NO_OP` already detects the shape and `no-op-neutralisation.ts`
 * de-configures it. Detection is correct and is UNCHANGED — this module
 * consumes the very same authority (`findNoOpOptions`) rather than asking the
 * question a second time, so the repairer and the reporter cannot drift apart
 * (trap 12). It runs IMMEDIATELY BEFORE neutralisation:
 *
 *   · an option it repairs is no longer a no-op, so neutralisation skips it;
 *   · an option it declines falls through to neutralisation UNCHANGED.
 *
 * Every refusal direction therefore lands on today's behaviour, never on a new
 * one. The set of drafts that survive can only GROW.
 *
 * ## ⭐⭐ THE PREDICATE IS STRUCTURAL, NOT LINGUISTIC
 *
 * This estate oscillated FOUR consecutive rounds on a hand-written predicate
 * over natural language, and the ruling that ended it was to stop writing them
 * (trap 22f). So no regex over the label is minted here. **CQE** — the estate's
 * ratified quantity extractor, whose P11 `from X to Y` rule is itself the
 * product of four documented reviewer rounds against real briefs — is asked,
 * and only its STRUCTURED output is read (`source`, `operator`, `range_min`,
 * `value`). Measured at `extractQuantities`, every hazard is refused by CQE's
 * own grammar rather than by a preposition list of mine:
 *
 *   · `"Cut costs by £10,000"`      → `operator: "decrement"`, `range_min: null`
 *   · `"Raise Price to £59"`        → `range_min: null` (a bare `to` has no FROM)
 *   · `"from month 3 to month 6"`   → no CQE from-to at all; two loose
 *                                     `source: "compromise"` numerals instead
 *   · two from-tos in one label     → two results, and this refuses on count
 *
 * That is the whole reason the delta case and the wrong-quantity case need no
 * judgement from me: CQE never reports them as a from-to `set`.
 *
 * ⚠ THREE OF THE FOUR CONJUNCTS BELOW ARE CURRENTLY REDUNDANT, AND THEY STAY.
 * A mutation kit found that removing the `source`, the `operator` or the
 * empty-label gate leaves the whole suite green. Each was then settled by
 * ENUMERATING THE PRODUCERS AT THE BYTES rather than by noting that a corpus
 * failed to find a counter-example (an equivalent mutant must be demonstrated,
 * never asserted — trap 13c):
 *
 *   · `range_min` is emitted finite at exactly three sites in `cqe/rules.ts` —
 *     P1 (`:338`) and P2 (`:389`), both `comparator: "between"` and both
 *     passing NO `value`, and P11 (`:1028`), which hardcodes `operator: 'set'`.
 *     So no result carries a finite `range_min`, a finite `value` AND a
 *     non-`set` operator.
 *   · `compromise-backstop.ts:143,145` sets `operator: null` and
 *     `range_min: null` UNCONDITIONALLY.
 *   · `extractQuantities` returns nothing for an empty or whitespace string.
 *
 * They are kept because they fail CLOSED, they are free, and CQE is a module
 * this one does not own — a new rule there must not silently widen what gets
 * repaired. The derivation is pinned as its own tests in
 * `cee.no-op-target-repair.test.ts`, so a CQE change that makes any of them
 * load-bearing REDs there instead of passing unnoticed.
 *
 * ## ⭐⭐ THE TARGET IS NEVER GUESSED — IT IS CORROBORATED
 *
 * The load-bearing conjunct is that **CQE's FROM value, put on the factor's
 * frame, must equal the level the factor INDEPENDENTLY RECORDS as its current
 * one.** Two records written by different producers — the model's label and the
 * factor's `observed_state` — must agree before either is believed. Nothing
 * infers intent; an arithmetic consistency check does the work.
 *
 * It is also what makes the INVERTED TWIN safe without a second rule.
 * `"Cut the price from £59 to £49"` against a factor sitting at £49 has
 * FROM = 59 ≠ 49, so it is REFUSED rather than raised to £59. The case that
 * would invert a user's intent cannot reach the write.
 *
 * And it VALIDATES THE FRAME for free: if the divisor resolved here is wrong,
 * the FROM will not corroborate, and the repair declines. The frame is not
 * trusted, it is tested.
 *
 * ## THE BOUND, DERIVED AT THE CONSUMER'S BYTES
 *
 * A repaired level must sit within `[0, 1]`. This is not a house rule: at
 * `orchestrator-v5/tools/plot-intervention-scale.ts:348` a value outside the
 * unit interval is treated as **already-raw and passed through verbatim** to
 * PLoT. Writing 1.59 for *"from £49 to £159"* on a 100-frame factor would
 * therefore ship a raw magnitude where its siblings are levels. Written against
 * the consumer's declared predicate, not against the failure mode in hand
 * (trap 13d).
 *
 * ## STATUS-QUO OPTIONS ARE EXEMPT, BY IDENTITY
 *
 * Inherited, not re-implemented: `findNoOpOptions` already `continue`s on
 * `readIsBaseline(option) === true`, the estate's single authority for the two
 * surfaces the flag arrives on (the draft model emits them DISAGREEING in 5 of
 * 30 measured samples). Because this module consumes that function's findings,
 * a baseline option is never even a candidate here. There is no second copy of
 * the reconciliation rule to drift.
 *
 * ## ⚠ WHAT THIS DELIBERATELY DOES NOT DO — AND THE COLLISION IT MUST NOT CAUSE
 *
 * A repair that gives the user's option the same signature as another option
 * would re-open `OPTIONS_IDENTICAL` — `severity: "error"`
 * (`graph-validator.ts:981`) — at the post-enforcement re-validation that runs
 * immediately after this stage, and the DRAFT WOULD DIE. That is the exact harm
 * `#1446` caused and `no-op-neutralisation.ts` was written to end, so it is
 * refused here: a repair whose resulting signature collides with any other
 * option's is declined, and the option falls through to neutralisation. The
 * user keeps today's outcome rather than losing the whole draft.
 *
 * ⚠ CONSEQUENCE, STATED PLAINLY BECAUSE IT LIMITS THE FIX: where the model
 * invented a sibling option that already carries the user's stated target,
 * the user's own option is NOT repaired. Paul's measured graph is exactly that
 * shape (his 0.49, an invented 0.59, an invented 0.54), so on that graph this
 * module improves the VALUE but cannot rescue the option — see the partition
 * pinned in `tests/unit/cee.no-op-target-repair.test.ts`. Widening this needs a
 * ruling on which of two colliding options survives, which belongs to
 * `options-identical-graceful-dedup.ts` (whose Guard 3b deliberately DECLINES
 * to drop a differently-labelled duplicate) and not to this module.
 */

import { extractQuantities } from "../../../../orchestrator-v5/context/cqe/extract-quantities.js";
import { resolveScaleFrame } from "../../../../orchestrator-v5/tools/handlers/d1-shared/scale-frame.js";
import {
  buildInterventionSignature,
} from "../../../../validators/graph-validator.js";
import {
  findNoOpOptions,
  levelsAreIdentical,
  readFactorBaselineLevel,
} from "../../../../validators/option-no-op.js";
import type { GraphT, NodeT } from "../../../../schemas/graph.js";
import { log, TelemetryEvents } from "../../../../utils/telemetry.js";

interface Repair {
  code: string;
  path: string;
  action: string;
}

export interface NoOpTargetRepairResult {
  readonly repairs: Repair[];
  /** Option ids whose stated target was written, in graph node order. */
  readonly repairedOptionIds: string[];
}

/** A transition an option's own label states: a FROM and a TO, in that order. */
interface StatedTransition {
  readonly from: number;
  readonly to: number;
}

function finiteOrUndefined(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

/**
 * The one transition this label states, or `undefined` where it states none,
 * more than one, or anything that is not a positional from-to.
 *
 * ⚠ EVERY CONJUNCT IS A READ OF CQE'S STRUCTURED OUTPUT. None of them inspects
 * the label's words. `source: "cqe"` excludes the `compromise` fallback, whose
 * loose numerals carry no operator and no positional meaning; `operator: "set"`
 * with a finite `range_min` is the shape ONLY P11 (`from X to Y`) emits.
 *
 * The single-result requirement is an AMBIGUITY refusal, not a parsing limit:
 * a label stating two transitions does not say which factor either belongs to,
 * and guessing is the failure mode this whole module exists to stop causing.
 */
function readStatedTransition(label: unknown): StatedTransition | undefined {
  if (typeof label !== "string" || label.trim().length === 0) return undefined;

  const quantities = extractQuantities(label);
  if (quantities.length !== 1) return undefined;

  const only = quantities[0];
  if (only === undefined) return undefined;
  if (only.source !== "cqe") return undefined;
  if (only.operator !== "set") return undefined;

  const from = finiteOrUndefined(only.range_min);
  const to = finiteOrUndefined(only.value);
  if (from === undefined || to === undefined) return undefined;
  if (from === to) return undefined;

  return { from, to };
}

/**
 * The divisor that puts a stated MAGNITUDE onto this factor's LEVEL scale.
 *
 * ⚠ A DIFFERENT QUESTION FROM `readFactorBaselineLevel`, named apart (trap 21):
 * that one answers *"where does this factor sit?"*, this one answers *"what
 * denominator is it sitting on?"*. `resolveScaleFrame` is the estate's single
 * owner of the second question — stored `scale_frame` first, the
 * `{value, raw_value}` pair second — so no private opinion about the divisor is
 * held here (trap 12).
 *
 * `observed_state` is consulted before `data` for the same reason
 * `readFactorBaselineLevel` prefers it: the projector writes both and they
 * agree by construction, so the precedence only decides a partially-projected
 * graph. `undefined` from both means UNFRAMED, and the caller uses 1 — the
 * already-fractional convention (`"from 85% to 95%"` against `{value: 0.85}`).
 *
 * Nothing here needs to be RIGHT for the module to be safe: a wrong divisor
 * makes the FROM fail to corroborate, and the repair declines.
 */
function readFactorLevelFrame(node: NodeT): number | undefined {
  const storedFrame = (node as { scale_frame?: unknown }).scale_frame;
  const observed = (node as { observed_state?: { value?: unknown; raw_value?: unknown } })
    .observed_state;
  const fromObserved = resolveScaleFrame({
    storedFrame,
    value: observed?.value,
    raw_value: observed?.raw_value,
  });
  if (fromObserved !== undefined) return fromObserved;

  const data = node.data as { value?: unknown; raw_value?: unknown } | undefined;
  return resolveScaleFrame({ storedFrame, value: data?.value, raw_value: data?.raw_value });
}

/**
 * The level this factor should be set to for the stated transition, or
 * `undefined` where this factor is not the one the transition is about.
 *
 * The corroboration is the whole predicate: the transition's FROM, on this
 * factor's frame, must be INDISTINGUISHABLE from the level the factor records
 * — at `levelsAreIdentical`, the same shared resolution `OPTION_NO_OP` uses to
 * decide two levels are the same number, so the two cannot drift apart about
 * what "the same" means.
 */
function resolveRepairedLevel(
  factor: NodeT,
  transition: StatedTransition,
): number | undefined {
  const currentLevel = readFactorBaselineLevel(factor);
  if (currentLevel === undefined) return undefined;

  const frame = readFactorLevelFrame(factor) ?? 1;
  const fromLevel = transition.from / frame;
  const toLevel = transition.to / frame;
  if (!Number.isFinite(fromLevel) || !Number.isFinite(toLevel)) return undefined;

  // CORROBORATION — the label's origin must match the factor's own record.
  if (!levelsAreIdentical(fromLevel, currentLevel)) return undefined;
  // A "repair" that lands back on the current level repairs nothing, and would
  // leave the option a no-op for neutralisation to take anyway.
  if (levelsAreIdentical(toLevel, currentLevel)) return undefined;
  // The consumer's own predicate (`plot-intervention-scale.ts:348`): outside
  // the unit interval a value is read as already-raw and passed through.
  if (toLevel < 0 || toLevel > 1) return undefined;

  return toLevel;
}

/**
 * Give every repairable no-op option the target its own label states.
 *
 * Mutates `graph` in place, like its enforcement siblings, and touches nothing
 * when no option is repairable — so a healthy draft is unchanged to the byte.
 */
export function repairNoOpOptionTargets(
  graph: GraphT,
  requestId?: string,
): NoOpTargetRepairResult {
  const repairs: Repair[] = [];
  const repairedOptionIds: string[] = [];

  const nodes = graph.nodes as NodeT[];
  const nodeById = new Map<string, NodeT>();
  for (const node of nodes) nodeById.set(node.id, node);
  const options = nodes.filter((n) => n.kind === "option");

  // THE SAME AUTHORITY THE VALIDATOR REPORTS FROM AND NEUTRALISATION ACTS ON.
  // Baseline options are excluded inside it, by identity, through
  // `readIsBaseline` — never re-decided here.
  for (const finding of findNoOpOptions(options, nodeById)) {
    const option = nodeById.get(finding.optionId);
    const data = option?.data as { interventions?: Record<string, number> } | undefined;
    const interventions = data?.interventions;
    if (option === undefined || interventions === undefined) continue;

    const transition = readStatedTransition((option as { label?: unknown }).label);
    if (transition === undefined) continue;

    // Which of the factors this option touches is the transition about? Exactly
    // one must corroborate. Zero means the label is about something else; two
    // or more means the label does not say which, and a guess there is the
    // defect this module exists to stop making.
    let targetFactorId: string | undefined;
    let targetLevel: number | undefined;
    let ambiguous = false;
    for (const factorId of finding.factorIds) {
      const factor = nodeById.get(factorId);
      if (factor === undefined) continue;
      const level = resolveRepairedLevel(factor, transition);
      if (level === undefined) continue;
      if (targetFactorId !== undefined) { ambiguous = true; break; }
      targetFactorId = factorId;
      targetLevel = level;
    }
    if (ambiguous || targetFactorId === undefined || targetLevel === undefined) continue;

    // ⚠ A REPAIR MUST NOT RE-OPEN `OPTIONS_IDENTICAL` (severity `error`) at the
    // post-enforcement re-validation that runs directly after this stage — that
    // would kill the whole draft, which is `#1446`'s harm and strictly worse
    // than the de-configuring this replaces. Signed with the validator's OWN
    // exported key, so the two cannot disagree about what a collision is.
    const candidate = { ...interventions, [targetFactorId]: targetLevel };
    const candidateSignature = buildInterventionSignature(candidate);
    const collides = options.some((other) => {
      if (other.id === option.id) return false;
      const otherInterventions = (other.data as { interventions?: Record<string, number> } | undefined)
        ?.interventions;
      if (otherInterventions === undefined) return false;
      return buildInterventionSignature(otherInterventions) === candidateSignature;
    });
    if (collides) continue;

    interventions[targetFactorId] = targetLevel;
    repairedOptionIds.push(finding.optionId);
    repairs.push({
      // ⚠ NAMED APART FROM `OPTION_NO_OP` (trap 21). That code, in the repair
      // trace, means "this option was DE-CONFIGURED". This one means the
      // opposite — the option was KEPT and given a number. Two actions under
      // one code would leave every trace consumer unable to tell a withdrawal
      // from a repair. (`inferProvenanceSource` classifies both as `structure`,
      // its conservative default for an unrecognised code — measured, and
      // unchanged from what `OPTION_NO_OP` already receives there.)
      code: "OPTION_NO_OP_TARGET_SET",
      path: `nodes[${finding.optionId}].data.interventions.${targetFactorId}`,
      action:
        "Set an option's intervention to the target its own label states, where the label's "
        + "stated starting point matched the factor's recorded current level; it stays in the "
        + "graph and in the comparison instead of being de-configured",
    });
  }

  if (repairedOptionIds.length > 0) {
    log.warn({
      event: TelemetryEvents.CeeOptionNoOpTargetRepaired,
      request_id: requestId,
      // Ids only — no labels and no magnitudes. Labels are drafted from the
      // user's brief and magnitudes are held off diagnostics by the rule
      // `schema-v3.ts:1095` states.
      option_ids: repairedOptionIds,
      repaired_count: repairedOptionIds.length,
    }, `Wrote the stated target for ${repairedOptionIds.length} option(s) that would otherwise change nothing`);
  }

  return { repairs, repairedOptionIds };
}
