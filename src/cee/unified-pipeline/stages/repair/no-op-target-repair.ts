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
 * The load-bearing conjunct is that **CQE's FROM QUANTITY — its magnitude on
 * the factor's frame AND its unit — must match what the factor INDEPENDENTLY
 * RECORDS.** Two records written by different producers — the model's label and
 * the factor's own `unit` + `observed_state` — must agree before either is
 * believed. Nothing infers intent; a structural consistency check does the work.
 *
 * ⚠ THE UNIT HALF IS NOT DECORATION, AND ITS ABSENCE WAS A MEASURED DEFECT.
 * Corroborating the MAGNITUDE alone binds the write to a bare number, so a
 * label about an entirely different quantity that happens to share the
 * factor's digits was silently written through. Both of these were measured on
 * the mounted path against a factor at `{value: 0.49, raw_value: 49}`:
 *
 *   · `"move the deadline from 49 days to 59 days"` → CQE `unit: "day"`,
 *     against "Pro Plan Monthly Price" `unit: "£"` — wrote **0.59**;
 *   · `"extend the free trial from 14 to 30 days"` → CQE `unit: "day"`,
 *     against "Trial-to-paid conversion rate" `unit: "%"` — wrote **0.30**.
 *
 * De-configuring is a VISIBLE omission; those writes are SILENT wrongness —
 * the same harm class this module exists to end, so magnitude agreement alone
 * is not corroboration. **What must agree is a QUANTITY, not a MAGNITUDE.**
 *
 * It is also what makes the INVERTED TWIN safe without a second rule.
 * `"Cut the price from £59 to £49"` against a factor sitting at £49 has
 * FROM = 59 ≠ 49, so it is REFUSED rather than raised to £59. The case that
 * would invert a user's intent cannot reach the write.
 *
 * ⚠ AND IT VALIDATES THE FRAME — FOR EVERY `from` EXCEPT ZERO. Where the
 * divisor resolved here is wrong, the FROM normally fails to corroborate and
 * the repair declines, so the frame is tested rather than trusted. **That
 * argument does not hold at `from === 0`**: `0 / frame === 0` for every finite
 * non-zero frame, so a zero FROM corroborates a factor sitting at level 0 on
 * ANY divisor and the frame goes untested. The write is still bounded by the
 * unit conjunct, by `levelsAreIdentical` and by the `[0, 1]` check, and
 * `readStatedTransition` refuses `from === to` so the TO is never also zero —
 * but the frame is not evidence in that one case, and this sentence no longer
 * claims it is.
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
import { unitsAreCompatible } from "../../../factor-extraction/merge.js";
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
  /**
   * CQE's own normalised unit for the transition, or `null` where the label
   * states none. Read, never parsed: `normaliseUnit` (`cqe/rules.ts:209`) has
   * already mapped `£`→`GBP`, `%`→`percentage`, `days`→`day` before this
   * module sees it.
   */
  readonly unit: string | null;
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
 * ⚠ NOT WRAPPED IN A TRY, AND THAT IS DERIVED RATHER THAN ASSUMED. A throw
 * here would reach the draft enforcement stage and could kill a turn, so it
 * was checked at the producer: `extractQuantities` declares *"the contract
 * says it never throws"* and implements it with a defence-in-depth catch that
 * logs `cqe.extraction_failed` and returns an EMPTY result set
 * (`extract-quantities.ts:275-291`). An empty set fails the single-result
 * requirement below, so a CQE failure degrades to a decline — which is
 * today's behaviour — rather than to an exception.
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

  return { from, to, unit: only.unit };
}

/**
 * The unit this factor records for itself, or `undefined` where it records
 * none.
 *
 * ⚠ THE PRECEDENCE IS THE OPPOSITE OF `readFactorLevelFrame`'S, DELIBERATELY,
 * AND THE TWO ARE NAMED APART FOR IT (trap 21). That one reads the
 * `{value, raw_value}` PAIR, whose declaring schema is `FactorObservedState`
 * (`schemas/graph.ts:261`), so it consults `observed_state` first. `unit` is
 * declared on `FactorData` (`:160`) and NOT on `FactorObservedState`, which
 * admits it only through `.passthrough()` — so `data` is the declaring surface
 * here and is read first. Each reader prefers the schema that DECLARES its own
 * field; the differing order is that rule applied twice, not a copy-paste slip.
 */
function readFactorUnit(node: NodeT): string | undefined {
  const data = node.data as { unit?: unknown } | undefined;
  const observed = (node as { observed_state?: { unit?: unknown } }).observed_state;
  for (const candidate of [data?.unit, observed?.unit]) {
    if (typeof candidate === "string" && candidate.trim().length > 0) return candidate;
  }
  return undefined;
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
 * The corroboration is the whole predicate, and it is a claim about a
 * QUANTITY — a magnitude AND its unit:
 *
 *   · the transition's FROM, on this factor's frame, must be INDISTINGUISHABLE
 *     from the level the factor records — at `levelsAreIdentical`, the same
 *     shared resolution `OPTION_NO_OP` uses to decide two levels are the same
 *     number, so the two cannot drift apart about what "the same" means;
 *   · and where BOTH records state a unit, those units must not disagree.
 *
 * ⚠ THE UNIT CONJUNCT IS STRUCTURAL, LIKE EVERY OTHER ONE HERE. It compares
 * two RECORDED fields — CQE's normalised `unit` and the factor's own `unit` —
 * and reads nothing from the label's words. No regex, no string matching and
 * no private `£`↔`GBP` map is minted: `unitsAreCompatible`
 * (`factor-extraction/merge.ts:203`) is the estate's single exported authority
 * for "are these two units the same kind of quantity", and its groups already
 * span BOTH vocabularies in play — the factor surface's symbols (`£`, `%`) and
 * CQE's normalised codes (`GBP`, `percentage`). Borrowing it rather than
 * copying it is the only way the two cannot drift apart (trap 12).
 *
 * ⚠ IT FIRES ONLY WHERE BOTH SIDES STATE A UNIT, and that bound is deliberate.
 * A factor that records no unit is the common case on the measured fixture, and
 * refusing it would shrink the repaired set to nothing rather than sharpen it.
 * An absent unit is therefore NOT evidence of disagreement — it is silence, and
 * silence falls through to the magnitude corroboration exactly as before.
 *
 * ⚠⚠ DECLARED RESIDUAL, BECAUSE THE BORROWED AUTHORITY IS LENIENT BY DESIGN
 * (and a bound this module cannot tighten without minting the private map it
 * just refused to mint). `unitsAreCompatible` groups ALL currencies together
 * and ALL durations together, so these two still reach the write and are
 * pinned as KNOWN-ADMITTED in `cee.no-op-target-repair.test.ts`:
 *
 *   · `"from $49 to $59"` (CQE `USD`) against a factor recording `£`;
 *   · `"from 49 days to 59 days"` (CQE `day`) against a factor recording
 *     `month`.
 *
 * Both are narrower than the class this closes — they still require the
 * magnitudes to corroborate — and tightening either belongs to
 * `unitsAreCompatible`'s owner, whose grouping other callers depend on. They
 * are recorded here so the next session inherits a KNOWN gap rather than an
 * unnoticed one (trap 22f's known-dropped-set rule).
 */
function resolveRepairedLevel(
  factor: NodeT,
  transition: StatedTransition,
): number | undefined {
  const currentLevel = readFactorBaselineLevel(factor);
  if (currentLevel === undefined) return undefined;

  // QUANTITY AGREEMENT — two recorded units, never the label's words. Checked
  // before the arithmetic because it asks the prior question: is this factor
  // about the same KIND of thing the label is about?
  const factorUnit = readFactorUnit(factor);
  if (
    transition.unit !== null
    && factorUnit !== undefined
    && !unitsAreCompatible(transition.unit, factorUnit)
  ) {
    return undefined;
  }

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
