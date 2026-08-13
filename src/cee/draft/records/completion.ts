/**
 * THE COMPLETION PASS — one focused turn that closes the gaps pass 1 left.
 *
 * ── WHY A SECOND PASS AT ALL, AND WHAT SETTLED IT ──────────────────────────
 * Not a hunch: a decisive probe (2026-08-12, `round6/PROBE-RESULT.md`) showed
 * the missing connectivity was PRESENT IN THE BRIEF and simply not stated. Shown
 * its own emission and the verdict on it, the model cleared EVERY blocking class
 * on both long briefs in one turn — B1's `MISSING_BRIDGE ×1 · NO_PATH_TO_GOAL ×6
 * · NO_EFFECT_PATH ×6` and B3's `INVALID_EDGE_TYPE ×3` all went to zero, with 0
 * unresolvable references across 63 new claims. The alternative branch — asking
 * the USER for the missing links — was pre-committed and NOT reached, because on
 * these briefs the information was never absent.
 *
 * ── THE FOUR PROPERTIES THIS MODULE EXISTS TO HOLD ─────────────────────────
 *
 * 1. **CLAIMS ONLY.** The completion grammar has no `stated_items` at all, so a
 *    fabricated user quote is STRUCTURALLY IMPOSSIBLE rather than merely
 *    forbidden. Reusing the draft grammar would have been easier and is exactly
 *    wrong: `stated_items` carries `minItems: 1`, so the second turn would be
 *    REQUIRED to re-emit the user's words — an invitation to paraphrase them,
 *    with the paraphrase then wearing a `stated` provenance badge. The schema is
 *    built from `buildDraftClaimItemSchema()`, never restated (trap 12).
 *
 * 2. **APPEND-ONLY.** Existing claims keep their indices, so every reference
 *    already on the wire stays valid; new claims land at `base + k` and the
 *    model is TOLD `base` so it can reference its own additions. `stated_items`
 *    is carried through untouched and the merge asserts it.
 *
 * 3. **THE VERDICT, NEVER AN ANSWER.** The model is shown what did not resolve
 *    and what shape is illegal — derived from the projector's own disclosures —
 *    and the legal vocabulary. It is never shown a suggested edge. A completion
 *    pass that proposed the answer would be the machine authoring the user's
 *    causal model, which is the failure this whole mechanism exists to prevent.
 *
 * 4. **BOTH CLASSES IN ONE ASK.** The probe's round 1 asked only about orphaned
 *    references; the three illegal shapes the projector already knew about
 *    survived the merge and re-appeared as `INVALID_EDGE_TYPE ×3`. A one-class
 *    ask leaves the other class standing, and we knew about it the whole time.
 *
 * ── ⚠⚠ HOW PASS 2 IS BOUNDED, AND WHY IT IS NOT THE RUNAWAY DETECTOR ───────
 * The streaming runaway detector cannot bound this call, and pretending it does
 * would be the worst kind of imaginary guarantee. Measured (#923 review): the
 * completion pass emits `claim_kind` at roughly character 12, so EVERY
 * detector gate — stall, hard ceiling, total chars — lifts on the first delta.
 * The detector gives pass 2 essentially no protection.
 *
 * So pass 2 does not rely on it. **The call is NON-STREAMING**, which removes
 * the streaming detector from the picture entirely rather than leaving a
 * lifted one in place looking like a bound, and it is held by two limits this
 * module owns and states:
 *
 *   RECORDS_COMPLETION_MAX_TOKENS  — an output ceiling (the probe's largest
 *                                    completion was 35 claims)
 *   RECORDS_COMPLETION_WALL_MS     — a hard wall-clock abort the caller applies
 *                                    with an AbortSignal (probe: 19.2 s for the
 *                                    35-claim completion, 4.0 s for the 3-claim
 *                                    one)
 *
 * On ANY failure — abort, provider error, unparseable output, a merge that would
 * disturb `stated_items` — the caller keeps PASS 1's projection unchanged. The
 * completion is strictly additive, so its failure mode is "no improvement",
 * never "worse than not trying". That property is asserted by a test whose cases
 * CAN trigger the transformation, not by two cases that could never have been
 * changed either way (trap 13d).
 */
import {
  buildDraftClaimItemSchema,
  type DraftInferenceClaim,
  type DraftRecordSet,
} from "./grammar.js";
import {
  type RecordProjection,
  UNRESCUABLE_EDGE_SHAPES,
  projectedKindAfterNormalisation,
} from "./projector.js";
import { buildInterventionSignature } from "../../../validators/graph-validator.js";
import { ALLOWED_EDGES } from "../../../validators/graph-validator.types.js";
import { BUCKET_C_CODES } from "../../unified-pipeline/stages/repair/bucket-c-codes.js";

/**
 * Output ceiling for the completion turn. The probe's largest real completion
 * was 35 claims; this is a comfortable multiple of that and well under any
 * budget the draft call itself uses.
 */
export const RECORDS_COMPLETION_MAX_TOKENS = 3000;

/**
 * Hard wall-clock bound the caller enforces with an AbortSignal. The probe
 * measured 19.2 s (35 claims) and 4.0 s (3 claims) for this turn against a
 * ~8–9k-character focused prompt.
 *
 * ⚠ This number is also a GATE-5 commitment, not just a safety limit. Gate 5
 * compares the TWO-PASS TOTAL against arm A's committed p50, so an unbounded
 * second call could pass every correctness gate and fail the latency one.
 */
export const RECORDS_COMPLETION_WALL_MS = 35_000;

/** One thing the completion turn is asked about. */
export interface CompletionAskItem {
  readonly kind:
    | "unresolved_reference"
    | "illegal_shape"
    | "unconnected_record"
    | "option_without_chain"
    | "no_chain_reaches_goal"
    | "no_outcome_or_risk"
    | "options_indistinguishable";
  readonly detail: string;
  /**
   * ⭐⭐ THE VALIDATOR CODE THIS ITEM PREDICTS, or `null` when the item is a
   * projector DISCLOSURE about something the validator will never see.
   *
   * **REQUIRED, not optional, and that is the whole mechanism.** A new ask kind
   * cannot be added without an explicit decision about which of the two it is —
   * the compiler refuses the push site otherwise. An optional field would
   * default a new kind to "harmless" silently, which is the fail-OPEN direction
   * and the exact hand-maintained-mirror shape this estate keeps paying for.
   *
   * The two classes are distinguished STRUCTURALLY, not by judgement:
   *
   * - `null` — the item was built from `projection.dropped`. Those edges are
   *   NOT in `projection.graph`, so no validator stage can raise anything about
   *   them. The disclosure exists for the user and for this ask; it carries no
   *   consequence for the draft's validity.
   * - a code — the item was computed on `projection.graph`, i.e. on the exact
   *   structure the validator receives. The code names what it will raise.
   *
   * Whether a named code BLOCKS is then read from the sweep's own routing
   * (`BUCKET_C_CODES`), never restated here: see `isBlockingAskItem`.
   */
  readonly validatorCode: string | null;
}

export interface CompletionAsk {
  readonly items: readonly CompletionAskItem[];
  /** `claims.length` at the time of the ask — the index the model's first new claim will take. */
  readonly baseClaimIndex: number;
}

/**
 * ⭐⭐ IS THIS ASK ITEM ONE THAT BLOCKS A DRAFT?
 *
 * Derived twice over, so neither derivation has to be trusted alone:
 *   1. the item must name a validator code at all (built from the graph the
 *      validator sees, not from the projector's dropped list), and
 *   2. that code must be routed to **Bucket C** by
 *      `bucket-c-codes.ts` — the sweep's single authority for "cannot be
 *      repaired deterministically; the draft does not pass on this".
 *
 * `BUCKET_C_CODES` is IMPORTED, never retyped. When a code leaves Bucket C —
 * `CYCLE_DETECTED` already did, to Bucket A — this classification moves with it
 * on the next build, with nothing for anyone to remember.
 */
export function isBlockingAskItem(item: CompletionAskItem): boolean {
  return item.validatorCode !== null && BUCKET_C_CODES.has(item.validatorCode);
}

/**
 * ⭐⭐ THE KEEP/DISCARD MEASURE FOR A COMPLETION PASS.
 *
 * Counts only the ask items that correspond to a blocking validator class. The
 * non-blocking disclosures are excluded BY DERIVATION (they carry `null`
 * because the projector already dropped their edges), not by a list of kinds
 * someone has to keep current.
 *
 * ── WHY THIS EXISTS, MEASURED ─────────────────────────────────────────────
 * The first comparator counted NODES, and read the option-duplication merge's
 * legitimate 8→6 collapse as harm. The second counted ALL ask items, and in the
 * round-7 acceptance block DISCARDED 7 of 11 completion passes — including two
 * whose graphs plainly improved (`ask 5→8` while `nodes 6→9`, `edges 4→12`; and
 * `ask 2→2` while `edges 17→25`). Both were counting the artefact instead of
 * the harm (trap 23), and the second did it because the ask mixes two classes
 * that do not carry the same consequence. Two rounds on one predicate is the
 * signal to stop guessing and DERIVE the thing being measured (trap 22f) —
 * which is what the `validatorCode`/`BUCKET_C_CODES` pair does.
 */
export function countBlockingAskItems(ask: CompletionAsk): number {
  return ask.items.filter(isBlockingAskItem).length;
}

/**
 * ⭐⭐ THE DECISION ITSELF — keep this completion pass, or throw it away?
 *
 * **KEEP IFF IT DOES NOT INCREASE THE BLOCKING CLASSES. A TIE IS A KEEP.**
 *
 * ── WHY NON-WORSENING RATHER THAN STRICT IMPROVEMENT ───────────────────────
 * The property the completion has to hold is stated at its own call site:
 * *"the completion can only ever add; it can never be the reason a draft got
 * worse"*. That is a NON-WORSENING property, so the test that enforces it is
 * `<=`. Requiring strict improvement enforces a DIFFERENT property — "the
 * completion must have fixed something" — which is not a safety property at
 * all, and it is what threw away run 18's `edges 17→25` at an unchanged
 * blocking count of 2→0… and run 14's, and run 10's.
 *
 * The merge is append-only and already refuses an empty completion, so a tie
 * with claims added is a strictly richer causal model at no validity cost.
 *
 * ── WHY IT LIVES HERE AND NOT AT THE CALL SITE ─────────────────────────────
 * It was an inline expression in the adapter through two wrong versions, where
 * no test could reach it: a spec could only RESTATE the comparison, and a
 * restatement agrees with itself whatever the adapter does. Naming it puts the
 * real decision under the mutants.
 */
/**
 * ⭐⭐ THE IDENTITY OF AN ASK ITEM — what it is ABOUT, not how many there are.
 *
 * Built from the same two fields the ask's own de-duplicator uses (`kind` +
 * `detail`), so an item's identity here and its uniqueness there cannot drift
 * apart. `detail` is what names the entity — the option, the record, the
 * reference — which is exactly the part a count throws away.
 */
export function askItemIdentity(item: CompletionAskItem): string {
  return JSON.stringify([item.kind, item.detail]);
}

/**
 * ⭐⭐ DID PASS 2 REGRESS ANY PROTECTED PASS-1 CONTENT?
 *
 * ── WHY A SEPARATE QUESTION FROM THE ASK COMPARISON ────────────────────────
 * The ask measures VALIDITY — will the draft be blocked? This measures
 * PRESERVATION — is the user's first-pass content still theirs? A completion can
 * leave validity untouched (or improve it) while quietly rewriting pass 1, and
 * an audit produced all three shapes: an intervention on a stated option
 * overwritten; a stated figure removed from the graph entirely; a stated option's
 * merged refinement reclassified back out, taking the option's intervention with
 * it and leaving it disconnected. Two questions, and answering both with the ask
 * count is how all three passed (trap 21).
 *
 * ── THE THREE INVARIANTS, WRITTEN AGAINST THE SPEC ─────────────────────────
 * The property at the call site is *"the completion can only ever ADD"*. So the
 * invariants are stated as append-only over pass 1, NOT as the negation of the
 * three failures above — a guard written to the shape of the failure in hand is
 * blind to the fourth shape (trap 13d):
 *
 *   (a) EXISTENCE — every node on the pass-1 graph is still on the pass-2 graph.
 *   (b) NO OVERWRITE — every intervention pass 1 established still holds its
 *       pass-1 value. New keys are free; changed ones are not.
 *   (c) NO RECLASSIFICATION — every refinement pass 1 merged into a node is
 *       still merged into it.
 *
 * Additions are unconstrained in all three. That is the whole asymmetry: this
 * cannot refuse a completion for being richer, only for being destructive.
 */
export function completionRegressesProtectedContent(
  before: RecordProjection,
  after: RecordProjection,
): readonly string[] {
  const violations: string[] = [];
  const afterById = new Map(after.graph.nodes.map((n) => [n.id, n]));

  // ⭐⭐ A DISAPPEARANCE IS NOT AUTOMATICALLY A LOSS — AND THE FIRST VERSION OF
  // THIS FUNCTION GOT THAT WRONG, WHICH IS WHY THIS NOTE EXISTS.
  //
  // Written as a flat "every pass-1 node must still be on the pass-2 graph", it
  // reported three violations on `round7-completion-pass07` — a HISTORIC CAPTURE
  // whose completion took blocking items 7 → 0. The nodes had not been lost: they
  // had been MERGED into their stated options, which is the projector's own
  // deliberate, disclosed, content-preserving operation (`merged_refinements`
  // records exactly what was folded and into what). The guard would have thrown
  // away one of the best completion passes on record, for doing its job.
  //
  // The property is not "nothing may disappear" — the projector legitimately
  // merges and demotes — it is "nothing may disappear SILENTLY". So a node's
  // absence is a violation only when nothing in the pass-2 projection accounts
  // for it. That is the same distinction this codebase draws everywhere else:
  // the harm was never the operation, it was the silence.
  // ⭐⭐ ABSORBED, NOT MERELY MENTIONED — AND THE DIFFERENCE IS THE WHOLE GUARD.
  //
  // The first version of this set was built from `after.dropped`, i.e. "anything
  // the projection said something about". That is too weak by exactly the case
  // this function exists to catch: a pass-1 stated figure pruned as
  // `unconnected_to_goal` IS in `dropped` — and it has still been DELETED. The
  // completion invalidated the edge that held it to the goal, the figure left the
  // user's graph, and a disclosure-shaped test would have called that accounted
  // for and kept the pass.
  //
  // Absorption is the narrower, correct question: was this content FOLDED INTO A
  // SURVIVING NODE? Only two operations do that, and both record it on the
  // survivor's provenance — a merge writes `merged_refinements`, a demote writes
  // `undeveloped_duplicates`. A prune writes neither, because nothing absorbed
  // it. So the set is built from the ABSORPTION RECORDS alone, which are also the
  // only entries that can name a survivor to point at.
  const accountedFor = new Set<string>();
  for (const prov of Object.values(after.provenance)) {
    for (const label of prov.merged_refinements ?? []) accountedFor.add(label);
    for (const label of prov.undeveloped_duplicates ?? []) accountedFor.add(label);
  }

  for (const node of before.graph.nodes) {
    // ⚠ PROTECTED CONTENT IS THE USER'S AND THE MODEL'S — NOT THE PROJECTOR'S
    // OWN SCAFFOLDING. The `decision` node ("Decision-to-option scaffold minted
    // by the projector", `provenance_class: "projector_structural"`) is minted
    // FRESH on every projection and its id is derived from the option set, so it
    // legitimately changes id the moment an option is added — which a completion
    // is supposed to do. Counting that as destroyed content made the guard fire
    // on both historic captures for the one node neither pass had anything to do
    // with. The three classes are distinguished for exactly this kind of
    // question; a two-class reading of them is what the sidecar's own note warns
    // about.
    if (before.provenance[node.id]?.provenance_class === "projector_structural") continue;
    const survivor = afterById.get(node.id);
    if (!survivor) {
      if (!accountedFor.has(node.label)) {
        violations.push(`removed_undisclosed:${node.id}:${node.label}`);
      }
      continue;
    }
    const beforeInterventions = (node.data as { interventions?: Record<string, number> } | undefined)
      ?.interventions;
    if (beforeInterventions) {
      const afterInterventions =
        (survivor.data as { interventions?: Record<string, number> } | undefined)?.interventions ?? {};
      for (const [factorId, value] of Object.entries(beforeInterventions)) {
        if (!(factorId in afterInterventions)) {
          violations.push(`intervention_removed:${node.id}:${factorId}`);
        } else if (afterInterventions[factorId] !== value) {
          violations.push(
            `intervention_overwritten:${node.id}:${factorId}:${value}->${afterInterventions[factorId]}`,
          );
        }
      }
    }
    const beforeMerged = before.provenance[node.id]?.merged_refinements ?? [];
    if (beforeMerged.length > 0) {
      const afterMerged = new Set(after.provenance[node.id]?.merged_refinements ?? []);
      for (const label of beforeMerged) {
        if (!afterMerged.has(label)) violations.push(`refinement_reclassified:${node.id}:${label}`);
      }
    }
  }
  return violations;
}

/**
 * ⭐⭐ THE DECISION ITSELF — keep this completion pass, or throw it away?
 *
 * **KEEP IFF IT ADDS NO NEW BLOCKING CLASS *AND* REGRESSES NO PROTECTED PASS-1
 * CONTENT.**
 *
 * ── WHY NON-WORSENING RATHER THAN STRICT IMPROVEMENT ───────────────────────
 * The property the completion has to hold is stated at its own call site:
 * *"the completion can only ever add; it can never be the reason a draft got
 * worse"*. That is a NON-WORSENING property, so the test that enforces it is
 * `<=`. Requiring strict improvement enforces a DIFFERENT property — "the
 * completion must have fixed something" — which is not a safety property at
 * all, and it is what threw away run 18's `edges 17→25` at an unchanged
 * blocking count of 2→0… and run 14's, and run 10's.
 *
 * ── ⭐⭐ WHY A COUNT WAS NOT ENOUGH, AND THIS IS THE R1 REMEDIATION ──────────
 * The previous version was `countBlockingAskItems(after) <= countBlockingAskItems(before)`.
 * An audit walked straight through it: a completion took the blocking item from
 * `hold` to `hire` — **1 → 1** — and the comparator, seeing only the count,
 * called that unchanged. A blocking problem had not been fixed; a DIFFERENT
 * option had been broken, and the arithmetic could not tell the two apart. This
 * estate has a name for that shape: an assertion bound to a VALUE PREDICATE that
 * another object satisfies, rather than to the OBJECT ITSELF (trap 19) — here
 * raised from a test to the comparator that gates the merge.
 *
 * So the test is now on the SET of blocking identities: no identity may appear
 * after that was not there before. A count can be held equal by a swap; a set
 * cannot. Note this is still non-worsening, not strict improvement — resolving
 * one blocking item and introducing none is a keep, and resolving none while
 * introducing none is also a keep.
 *
 * ── WHY THE PROJECTIONS ARE A REQUIRED ARGUMENT ────────────────────────────
 * Because the preservation question CANNOT be asked without them, and an
 * optional parameter would let a call site skip it silently — defaulting the
 * dangerous case to "fine", which is the fail-OPEN direction and the exact
 * hand-maintained-mirror shape this file already refuses elsewhere. Required
 * means the compiler asks every call site the question.
 */
export function shouldKeepCompletion(
  before: CompletionAsk,
  after: CompletionAsk,
  projections: { readonly before: RecordProjection; readonly after: RecordProjection },
): boolean {
  const blockingBefore = new Set(before.items.filter(isBlockingAskItem).map(askItemIdentity));
  for (const item of after.items) {
    if (!isBlockingAskItem(item)) continue;
    if (!blockingBefore.has(askItemIdentity(item))) return false;
  }
  return completionRegressesProtectedContent(projections.before, projections.after).length === 0;
}

/**
 * THE ORACLE, derived from the projection's OWN disclosures plus the two
 * connectivity predicates, read at the validator's bytes.
 *
 * ⚠ DELIBERATELY NOT THE FULL VALIDATOR, AND NOT THE ENUMERATION ORACLE. Both
 * over-report against the live pipeline: measured on one identical 18-node /
 * 23-edge graph, the live `post_sweep_authoritative` phase reported 3 errors
 * where the enumeration oracle raised 4 blocking and 15 total, because the
 * oracle runs only one stage of the deterministic sweep. Asking the model to fix
 * a class the live pipeline would never have raised spends a turn manufacturing
 * claims for a problem that does not exist — and every one of those claims is a
 * causal assertion presented to the user.
 *
 * So the ask is built ONLY from things this projector itself observed:
 * references it refused, shapes it rejected, records it could not place, and
 * reachability computed on its own emitted edges.
 *
 * ── ⚠ THE THREE NAMED COVERAGE LIMITS, CLOSED (round 9) ────────────────────
 * The v4 version of this note listed three Bucket-C codes as invisible to the
 * ask. Each is now adjudicated rather than left open.
 *
 * ⭐⭐ MISSING_BRIDGE — **NOW PREDICTED. The v4 note was WRONG about it**, and
 * said so in the strongest terms: *"a bare draft fails this on inventory, not on
 * connectivity"* and *"no completion pass can see that coming"*. Derived at the
 * sweep's bytes: `fixFactorGoalEdges` (`deterministic-sweep.ts:963-1059`) RUNS
 * UNCONDITIONALLY and **MINTS AN `outcome` NODE** for every `factor → goal`
 * edge. `MISSING_BRIDGE` (`graph-validator.ts:384`) is
 * `outcomes.length === 0 && risks.length === 0`. So one surviving `factor → goal`
 * edge makes it structurally unable to fire, and the code is a CONNECTIVITY
 * symptom after all — entailed by the same collapse that produces
 * `NO_PATH_TO_GOAL`, not an independent inventory gap.
 *
 * MEASURED before this item was written, on the eleven banked round-7 passes at
 * both phases (22 rows, `round9/instruments/r9-d2-missing-bridge.ts`): the
 * predicate below and the oracle's `MISSING_BRIDGE` agree **22/22, with ZERO
 * rows where a bridge was available and the code still fired**. The
 * refutation question was stated before the run, and a contrast control
 * (`NO_PATH_TO_GOAL`, present in 10 rows) proves the probe discriminates rather
 * than reading blind zeros (trap 13e).
 *
 * INVALID_EDGE_TYPE — **askable in principle, DELIBERATELY NOT ASKED.** Every
 * shape the projector's kind gate ADMITS is admitted because a NAMED repair
 * rescues it (`projector.ts` UNRESCUABLE_EDGE_SHAPES derivation). Asking the
 * model to restate a shape the pipeline repairs spends a turn manufacturing
 * causal claims for a problem that does not exist, and every such claim is an
 * assertion shown to the user. ⚠ ONE ADMITTED SHAPE IS FLAG-GATED: `option →
 * goal` is rescued by `fixOptionGoalShortcut` behind `optionShortcutRepair`
 * (default true). Under a posture where that flag is false the code becomes
 * reachable and unasked. Named rather than glossed; the deployed value of that
 * flag is not derived here.
 *
 * INSUFFICIENT_OPTIONS — **two harms under one code (trap 21), and they split.**
 * `graph-validator.ts:366-382` raises it for BOTH `< MIN_OPTIONS` and
 * `> MAX_OPTIONS`.
 *   · too many  — UNASKABLE BY DESIGN. The projector already caps by dropping
 *                 REFINEMENTS and never a stated option, because dropping one
 *                 narrows the user's own choice set. The only repair left is
 *                 amputating an option the user named. Refused.
 *   · too few   — ASKABLE (the completion can mint an option via
 *                 `option_refinement`) and deliberately NOT asked here: it means
 *                 asking the model to AUTHOR an alternative the user did not
 *                 name, which is a product-authorship decision outside this
 *                 lane's remit. Rowed, not silently skipped.
 */
export function enumerateCompletionAsk(
  records: DraftRecordSet,
  projection: RecordProjection,
): CompletionAsk {
  const items: CompletionAskItem[] = [];
  const seen = new Set<string>();
  const push = (item: CompletionAskItem) => {
    const key = `${item.kind}|${item.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    items.push(item);
  };

  for (const d of projection.dropped) {
    switch (d.reason) {
      case "unparseable_ref":
      case "ref_out_of_range":
      case "ref_target_not_a_node":
      case "missing_ref":
      case "ambiguous_ref":
        push({
          kind: "unresolved_reference",
          detail: `"${d.label}" — ${d.from_ref ?? "(no from)"} → ${d.to_ref ?? "(no to)"} did not resolve (${d.reason})`,
          // NON-BLOCKING BY CONSTRUCTION: this edge is in `projection.dropped`,
          // which is disjoint from `projection.graph.edges`. The validator is
          // handed the graph, so it cannot raise anything about an edge that
          // never entered it.
          validatorCode: null,
        });
        break;
      case "ref_kind_illegal":
        push({
          kind: "illegal_shape",
          detail: `"${d.label}" — a link from a ${d.from_kind} to a ${d.to_kind} is not a shape this model can hold`,
          // NON-BLOCKING BY CONSTRUCTION, same reason: the projector's kind gate
          // refused this edge AT EMISSION. It is disclosed, not carried.
          validatorCode: null,
        });
        break;
      // ⚠⚠ `unconnected_to_goal` IS DELIBERATELY NOT ASKED ABOUT, and the first
      // version of this function did ask. MEASURED on B1: it produced an ask of
      // 40 items of which 24 were stated figures — "£3.1m cash", "NRR is 112%",
      // "TAM is supposedly €400m" — that the model had correctly declined to
      // connect because they do not bear on the goal.
      //
      // Three things are wrong with asking:
      //   · The projector WITHHOLDS these records from the graph precisely so
      //     they cannot manufacture `NO_PATH_TO_GOAL`. The validator never sees
      //     them, so they are not a failure — they are the disclosure that
      //     PREVENTS one.
      //   · Asking is PRESSURE TO INVENT a causal link for a figure that has
      //     none, and zero false authorship is the property this whole mechanism
      //     exists to defend. The grammar refuses to floor `claims` for exactly
      //     this reason; an ask that lists every unconnected figure would
      //     reintroduce the pressure the grammar declined to apply.
      //   · Fidelity does not depend on it. Stated content survives in
      //     `stated_items` whether or not it becomes a node, and that is what the
      //     fidelity postcondition measures.
      //
      // `option_budget_exceeded` and `refinement_merged_into_stated_option` are
      // likewise projector DECISIONS, not gaps: asking about either would ask the
      // model to undo a deliberate, disclosed choice.
      //
      // ⭐ AND THE THREE DEMOTE REASONS ARE LISTED EXPLICITLY BELOW rather than
      // left to `default`, so their silence is a DECISION. A demote is a
      // projector RESOLUTION, not a gap in the record set: the model gave two
      // options the same intervention signature, and the projector has already
      // withdrawn the one the user did not write, disclosed it, and recorded it
      // on the survivor's provenance. Asking would invite the model to re-add
      // the alternative it just lost — and round 9 (D4) MEASURED that the
      // append-only completion cannot retract, so the ask would create the
      // duplication it was written to remove. `endpoint_demoted_duplicate` goes
      // with them: that link resolved perfectly well and the projector withdrew
      // what it pointed at. The coaching question — "what would make these two
      // different?" — belongs to the USER, not to a second model turn.
      case "unconnected_to_goal":
      case "undeveloped_duplicate_of_stated":
      case "undeveloped_duplicate_of_model":
      case "endpoint_demoted_duplicate":
      default:
        break;
    }
  }

  // The two connectivity predicates, derived at `graph-validator.ts`:
  //   NO_EFFECT_PATH  (:822) — each option needs ≥1 DIRECT factor target that
  //                            reaches the goal.
  //   NO_PATH_TO_GOAL (:620) — every node except the decision must reach the
  //                            goal. When nothing terminates at the goal at
  //                            all, this fires on essentially every node.
  //
  // ⚠ CORRECTED HERE, at the validator's bytes. The v4 version of this comment
  // named `MISSING_BRIDGE (:384)` as "satisfied by ANY chain terminating at the
  // goal". It is not: `:384` reads
  //   `if (outcomes.length === 0 && risks.length === 0)` → "Graph must have at
  //   least 1 outcome or risk node"
  // — a NODE-INVENTORY check with nothing to do with reachability. Both codes
  // are Bucket C so the keep/discard verdict is unchanged either way, but a
  // wrong code in the one place a later reader looks up the mapping is how the
  // next lane inherits a false premise. `MISSING_BRIDGE` is NOT predicted by
  // any item this function emits — see the coverage note on `enumerateCompletionAsk`.
  const { nodes, edges } = projection.graph;
  const kindById = new Map(nodes.map((n) => [n.id, n.kind]));
  const incoming = new Map<string, string[]>();
  for (const e of edges) {
    const list = incoming.get(e.to);
    if (list) list.push(e.from);
    else incoming.set(e.to, [e.from]);
  }
  const goalIds = nodes.filter((n) => n.kind === "goal").map((n) => n.id);
  const reachesGoal = new Set<string>();
  const stack = [...goalIds];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (reachesGoal.has(current)) continue;
    reachesGoal.add(current);
    for (const from of incoming.get(current) ?? []) stack.push(from);
  }

  for (const node of nodes) {
    if (node.kind !== "option") continue;
    const hasEffectPath = edges.some(
      (e) => e.from === node.id && kindById.get(e.to) === "factor" && reachesGoal.has(e.to),
    );
    if (!hasEffectPath) {
      push({
        kind: "option_without_chain",
        detail: `the option "${node.label}" has no chain of causal_links that reaches the goal`,
        validatorCode: "NO_EFFECT_PATH",
      });
    }
  }
  // ⭐⭐ THE GOAL IS NAMED BY ITS STATED INDEX AND ITS FIELD — round 9.
  //
  // Run 8 collapsed a 5-node graph to nothing because the ONE link intended for
  // the goal was written with `to_claim`. It resolved successfully, to a factor;
  // nothing reached the goal; every derived factor was withheld as
  // `unconnected_to_goal`; and all ten of the completion's links died attached
  // to a withheld node, disclosed once rather than once each.
  //
  // The grammar CANNOT prevent this and no schema can: `{"to_claim": 0}` is
  // well-formed, in range, and denotes a real node of a legal kind. Its
  // wrongness is a fact about what the model MEANT. A schema constrains
  // documents, not intentions (round9/DERIVATIONS.md D1). So the ask carries the
  // target explicitly instead — the stated index AND the field name — which is
  // the one thing the v4 prompt never said.
  const goalStatedIndices = records.stated_items
    .map((s, i) => (s.kind === "goal" ? i : -1))
    .filter((i) => i >= 0);
  const goalTargetPhrase =
    goalStatedIndices.length > 0
      ? goalStatedIndices.map((i) => `\`to_stated: ${i}\` (${JSON.stringify(records.stated_items[i]!.source_quote)})`).join(" or ")
      : null;

  if (goalIds.length > 0 && !edges.some((e) => reachesGoal.has(e.from) && e.from !== e.to && reachesGoal.has(e.to))) {
    push({
      kind: "no_chain_reaches_goal",
      detail:
        goalTargetPhrase === null
          ? "nothing you emitted terminates at the goal"
          : `nothing you emitted terminates at the goal — the goal is ${goalTargetPhrase}, and a link reaches it with that exact field, never with \`to_claim\``,
      validatorCode: "NO_PATH_TO_GOAL",
    });
  }

  // ⭐⭐ MISSING_BRIDGE, PREDICTED — see the derivation on this function.
  //
  // Post-normalisation kinds, taken from the projector's own exported map rather
  // than a second copy of `normalisation.ts` NODE_KIND_MAP. A bridge exists if
  // the graph already carries an outcome/risk node, OR if any `factor → goal`
  // edge survives — because the sweep mints an outcome for every one of those.
  if (goalIds.length > 0) {
    const hasBridgeNode = nodes.some((n) => {
      const k = projectedKindAfterNormalisation(n.kind);
      return k === "outcome" || k === "risk";
    });
    const sweepWillMintOutcome = edges.some(
      (e) =>
        projectedKindAfterNormalisation(kindById.get(e.from) ?? "") === "factor" &&
        projectedKindAfterNormalisation(kindById.get(e.to) ?? "") === "goal",
    );
    if (!hasBridgeNode && !sweepWillMintOutcome) {
      push({
        kind: "no_outcome_or_risk",
        // The ask is for the OUTCOME the options produce, stated as the model's
        // own `factor` claim and linked to the goal. It is NOT an invitation to
        // restate the user: the completion grammar has no `stated_items` at all,
        // so a fabricated user quote is structurally impossible here rather than
        // merely forbidden, and the claim carries the `ai_inferred` badge the
        // projector gives every claim-derived node.
        detail:
          goalTargetPhrase === null
            ? "nothing in this model is an outcome or a risk — name the outcome the options produce as a factor claim, and link it to the goal"
            : `nothing in this model is an outcome or a risk, so there is nothing between the options and the goal — name the outcome(s) these options actually produce as your own \`factor\` claim, and link that factor to the goal with ${goalTargetPhrase}`,
        validatorCode: "MISSING_BRIDGE",
      });
    }
  }

  // OPTIONS_IDENTICAL (`graph-validator.ts:841`) — two options the analysis
  // cannot tell apart. The signature is computed with the validator's OWN
  // EXPORTED `buildInterventionSignature`, never a retyped copy: that function's
  // docblock records that measurement harnesses previously restated its
  // semantics and drifted out of agreement with the thing they measured.
  //
  // MEASURED on B3: "finally do the platform rewrite" and the refinement
  // "Rewrite First, Then Copilot (Sequenced)" carry byte-identical signatures
  // (`475a18b9:1.0000|dbc7be0a:0.0000`). They are genuinely different
  // alternatives — one sequences the work, one does not — and the model simply
  // never said how they differ. That is a gap the brief can close, so it is
  // askable; the ask is phrased to permit "it does not", because a difference
  // invented to satisfy a validator is a number the user will read as their own.
  {
    const bySignature = new Map<string, string[]>();
    for (const node of nodes) {
      if (node.kind !== "option") continue;
      const interventions = (node.data as { interventions?: Record<string, number> } | undefined)?.interventions;
      if (!interventions) continue;
      const signature = buildInterventionSignature(interventions);
      const list = bySignature.get(signature);
      if (list) list.push(node.label);
      else bySignature.set(signature, [node.label]);
    }
    for (const labels of bySignature.values()) {
      if (labels.length < 2) continue;
      push({
        kind: "options_indistinguishable",
        detail: `${labels.map((l) => `"${l}"`).join(" and ")} change the same factors to the same levels, so nothing can tell them apart`,
        validatorCode: "OPTIONS_IDENTICAL",
      });
    }
  }

  return { items, baseClaimIndex: records.claims.length };
}

/**
 * The completion turn's grammar — CLAIMS ONLY.
 *
 * `stated_items` is absent, so the second turn cannot restate the user's words
 * even if it wanted to. Built from the draft grammar's own claim-item builder,
 * so a change to the claim shape moves both passes together.
 */
export function buildRecordsCompletionSchema(): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      claims: { type: "array", items: buildDraftClaimItemSchema() },
    },
    required: ["claims"],
    additionalProperties: false,
  };
}

/**
 * ⭐⭐ THE LEGAL EDGE VOCABULARY THE COMPLETION TURN IS SHOWN — DERIVED, NEVER
 * RESTATED.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 * Round 6 PROVED the model restates within the legal vocabulary when it is shown
 * one: B3's three `INVALID_EDGE_TYPE` links were re-pointed correctly in 3.9 s
 * with nothing invented. The v4 completion prompt then HAND-RESTATED the shapes
 * in prose, and on the round-7 block **14 completion links across runs 16 and 22
 * were dropped `ref_kind_illegal` in bulk** — 7 and 7, almost all `factor →
 * factor` into an option-controlled factor. The prompt stated that rule and the
 * model broke it anyway. A restatement is a hand-maintained mirror of three
 * different authorities (trap 12), and this one had already drifted from all of
 * them.
 *
 * ── ⭐ TWO AUTHORITIES, EACH ASKED THE QUESTION IT ACTUALLY ANSWERS ────────
 * It would be easy — and wrong — to derive this from the projector's own gate
 * alone. `UNRESCUABLE_EDGE_SHAPES` answers *"what will I refuse to carry?"*. The
 * model needs the answer to *"what should I emit?"*, and those are two questions
 * under one name (trap 21). `option → goal` is the case that separates them: the
 * projector ADMITS it, but it is rescued only by `fixOptionGoalShortcut` behind
 * the `optionShortcutRepair` flag, and an option that shortcuts to the goal has
 * no direct factor target, which is exactly what `NO_EFFECT_PATH` (:822) fires
 * on. Telling the model that shape is legal would buy one class of failure with
 * another.
 *
 * So:
 *   · what to EMIT comes from `ALLOWED_EDGES` — the validator's own matrix —
 *     restricted to the kinds a model-emitted reference can actually land on,
 *     plus the one shape an UNCONDITIONAL repair extends it by;
 *   · what is DROPPED OUTRIGHT comes from the projector's own
 *     `UNRESCUABLE_EDGE_SHAPES` — the set that actually did the dropping.
 * Neither is retyped, and each classification is asserted COMPLETE below, so a
 * new rule in either authority fails loud instead of silently going unstated.
 */
const MODEL_REACHABLE_KIND_PHRASE: Readonly<Record<string, string>> = {
  option: "an option",
  factor: "a factor",
  risk: "a constraint you recorded",
  goal: "the goal",
};

/**
 * Kinds that appear in the authorities but that NO model-emitted reference can
 * reach. Each carries its reason; the completeness assertion below refuses any
 * kind that is in neither table.
 */
const MODEL_UNREACHABLE_KIND_REASON: Readonly<Record<string, string>> = {
  // The decision node is projector-structural and has no wire reference.
  decision: "projector-structural; the model has no way to name it",
  // Never projected from a record: `fixFactorGoalEdges` mints it.
  outcome: "never emitted by the model; the sweep mints it from a factor→goal edge",
};

/**
 * The ONE shape `ALLOWED_EDGES` omits and an UNCONDITIONAL repair adds back.
 *
 * ⚠ THIS ENTRY IS HAND-WRITTEN, WHICH IS EXACTLY THE THING THIS FILE OTHERWISE
 * REFUSES TO DO — so it is guarded rather than trusted. `assertVocabularyIsComplete`
 * refuses it if it ever appears in `ALLOWED_EDGES` (then it is not an extension)
 * or in `UNRESCUABLE_EDGE_SHAPES` (then it is not legal). Where a list cannot be
 * derived, the mirror must FAIL LOUD on drift rather than assume good (trap 12).
 */
const UNCONDITIONALLY_REPAIRED_SHAPES: readonly { from: string; to: string; note: string }[] = [
  {
    from: "factor",
    to: "goal",
    note: "this is how a chain ends, and every model needs at least one chain that ends here",
  },
];

/** Every kind either authority mentions must be classified. Throws if not. */
function assertVocabularyIsComplete(): void {
  const kinds = new Set<string>();
  for (const rule of ALLOWED_EDGES) {
    kinds.add(rule.fromKind);
    kinds.add(rule.toKind);
  }
  for (const shape of UNRESCUABLE_EDGE_SHAPES) {
    const [from, to] = shape.split("->");
    if (from) kinds.add(from);
    if (to) kinds.add(to);
  }
  const unclassified = [...kinds].filter(
    (k) => !(k in MODEL_REACHABLE_KIND_PHRASE) && !(k in MODEL_UNREACHABLE_KIND_REASON),
  );
  if (unclassified.length > 0) {
    throw new Error(
      `records completion vocabulary is incomplete: unclassified node kind(s) ${unclassified.join(", ")} — ` +
        "classify each as model-reachable or model-unreachable before this prompt can be built",
    );
  }
  for (const ext of UNCONDITIONALLY_REPAIRED_SHAPES) {
    if (ALLOWED_EDGES.some((r) => r.fromKind === ext.from && r.toKind === ext.to)) {
      throw new Error(
        `${ext.from}->${ext.to} is in ALLOWED_EDGES and is therefore not a repair extension — remove it from UNCONDITIONALLY_REPAIRED_SHAPES`,
      );
    }
    if (UNRESCUABLE_EDGE_SHAPES.has(`${ext.from}->${ext.to}`)) {
      throw new Error(
        `${ext.from}->${ext.to} is in UNRESCUABLE_EDGE_SHAPES and is therefore not legal to emit — remove it from UNCONDITIONALLY_REPAIRED_SHAPES`,
      );
    }
  }
}

/**
 * The vocabulary block, rendered in the model's own terms.
 *
 * Exported so a test can assert it against BOTH authorities rather than against
 * a copy of its own output.
 */
export function renderLegalEdgeVocabulary(): string {
  assertVocabularyIsComplete();

  const phrase = (kind: string): string | null => MODEL_REACHABLE_KIND_PHRASE[kind] ?? null;

  const legal: string[] = [];
  const seen = new Set<string>();
  for (const rule of ALLOWED_EDGES) {
    const from = phrase(rule.fromKind);
    const to = phrase(rule.toKind);
    if (from === null || to === null) continue;
    const key = `${rule.fromKind}->${rule.toKind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    legal.push(`- ${from} → ${to}`);
  }
  for (const ext of UNCONDITIONALLY_REPAIRED_SHAPES) {
    const from = phrase(ext.from);
    const to = phrase(ext.to);
    if (from === null || to === null) continue;
    const key = `${ext.from}->${ext.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    legal.push(`- ${from} → ${to} — ${ext.note}`);
  }

  // The forbidden half, grouped by source kind so the list stays readable. Built
  // from the projector's own set, so a shape that stops being unrescuable stops
  // being listed here on the next build.
  const forbiddenByFrom = new Map<string, string[]>();
  for (const shape of [...UNRESCUABLE_EDGE_SHAPES].sort()) {
    const [from, to] = shape.split("->");
    if (from === undefined || to === undefined) continue;
    const fromPhrase = phrase(from);
    const toPhrase = phrase(to);
    if (fromPhrase === null || toPhrase === null) continue;
    const list = forbiddenByFrom.get(fromPhrase);
    if (list) list.push(toPhrase);
    else forbiddenByFrom.set(fromPhrase, [toPhrase]);
  }
  const forbidden = [...forbiddenByFrom.entries()].map(
    ([from, tos]) => `- ${from} → ${tos.join(", ")}`,
  );

  return [
    // ⚠ DELIBERATELY "use these and no others" RATHER THAN "every other shape is
    // discarded". The second is FALSE: `option → constraint` and `factor →
    // constraint` are neither in this legal list nor in the unrescuable set —
    // the pipeline REPAIRS them. A directive the model should follow is not the
    // same claim as a fact about what the pipeline does, and stating the second
    // when we mean the first is exactly the guarantee-shaped falsehood this
    // estate keeps paying for.
    "Use these shapes and no others:",
    ...legal,
    "",
    "One further rule, and it is the one your last set of links broke most often:",
    "**nothing may point INTO a factor that an option acts on.** A factor an option changes is",
    "where a chain STARTS. If something else bears on it, connect that influence to a factor",
    "FURTHER ALONG the chain, or to the goal.",
    "",
    "These shapes are dropped outright — nothing downstream can rescue them:",
    ...forbidden,
  ].join("\n");
}

/** Render the record set for the model, with the exact indices its references must use. */
function renderRecordsForAsk(records: DraftRecordSet): string {
  const stated = records.stated_items
    .map((s, i) => `  stated_items[${i}] ${s.kind}: ${JSON.stringify(s.source_quote)}${typeof s.value === "number" ? ` (value ${s.value}${s.unit ? ` ${s.unit}` : ""})` : ""}`)
    .join("\n");
  const claims = records.claims
    .map((c, i) => {
      const from = c.from_stated !== undefined ? `stated_items[${c.from_stated}]` : c.from_claim !== undefined ? `claims[${c.from_claim}]` : "";
      const to = c.to_stated !== undefined ? `stated_items[${c.to_stated}]` : c.to_claim !== undefined ? `claims[${c.to_claim}]` : "";
      const link = from || to ? `  ${from} → ${to}` : "";
      return `  claims[${i}] ${c.claim_kind}: ${JSON.stringify(c.label)}${link}`;
    })
    .join("\n");
  return `stated_items:\n${stated}\n\nclaims:\n${claims}`;
}

/**
 * The completion prompt.
 *
 * States the verdict and the legal vocabulary; never a suggested edge. The
 * "do not invent" clause is load-bearing and is phrased as a PERMISSION to
 * return nothing, because a completion turn that feels obliged to produce
 * claims will produce them.
 */
export function buildRecordsCompletionPrompt(args: {
  brief: string;
  records: DraftRecordSet;
  ask: CompletionAsk;
}): string {
  const { brief, records, ask } = args;
  const problems = ask.items.map((i) => `- ${i.detail}`).join("\n");
  // The goal's stated index, named explicitly so pass 2 always has the correct
  // target. Run 8's completion emitted TEN well-formed links and contributed
  // zero nodes and zero edges, because the one link that had to reach the goal
  // used `to_claim`. The v4 prompt's only reference instruction named the claim
  // namespace and nothing else.
  const goalLines = records.stated_items
    .map((s, i) => (s.kind === "goal" ? `- the goal is \`stated_items[${i}]\` ${JSON.stringify(s.source_quote)} — reach it with \`to_stated: ${i}\`` : null))
    .filter((l): l is string => l !== null);
  return [
    "## COMPLETE THE RECORD SET YOU JUST EMITTED",
    "",
    "You emitted the record set below for this brief. Some of it does not join up.",
    "Add the causal_link claims that close the gaps — and ONLY those.",
    "",
    "### The brief",
    brief,
    "",
    "### What you emitted",
    renderRecordsForAsk(records),
    "",
    "### What does not join up",
    problems,
    "",
    "Any link listed above as an illegal shape has already been DISCARDED — it is not on the model",
    "and you cannot edit it. If the connection it was reaching for is real, state it again as a NEW",
    "link with a legal shape.",
    "",
    "### What to emit now",
    `Emit ONLY new claims. Your first new claim will be claims[${ask.baseClaimIndex}], the next`,
    `claims[${ask.baseClaimIndex + 1}], and so on. Everything above keeps the index it already has.`,
    "",
    "### Which list a reference points into — the field says which, and it is not interchangeable",
    "- `from_stated` / `to_stated` — a position in `stated_items`, the list of things the USER said.",
    "- `from_claim` / `to_claim` — a position in `claims`, the list of things YOU said.",
    ...(goalLines.length > 0
      ? [
          "",
          ...goalLines,
          "`to_claim` can never reach the goal: the goal is not in `claims`, so a `to_claim` link",
          "lands on a factor instead and the whole chain behind it is dropped as unconnected.",
        ]
      : []),
    "",
    "### The shapes a link can take",
    renderLegalEdgeVocabulary(),
    "",
    "Set `effect` to `positive` or `negative` on every link. On a link FROM an option TO a factor,",
    "set `sets_to` to the level that factor takes under that option, in the factor's own unit —",
    "but only where the brief gives you the basis for it.",
    "",
    "Where two options are listed above as indistinguishable: the analysis cannot compare them, and",
    "a model carrying such a pair is rejected outright — so leaving them as they are is not a safe",
    "answer. Separate them using what the brief SAYS: a factor one of them acts on and the other",
    "does not, or the same factor at different levels via `sets_to`. Use only levels the brief gives",
    "you the basis for. Do not invent a number to tell them apart — a difference made up here is a",
    "number the user will read as their own, and that is a worse failure than the rejection.",
    "",
    "Do not restate anything the user said; you cannot, and you do not need to.",
    "Do not add a factor or a link the brief does not support. If a gap above cannot be closed from",
    "the brief, leave it open — an honest gap is a better answer than an invented link, and an empty",
    "`claims` list is a valid response.",
  ].join("\n");
}

export type CompletionMergeResult =
  | { ok: true; records: DraftRecordSet; added: number }
  | { ok: false; reason: "stated_items_disturbed" | "no_new_claims" };

/**
 * APPEND-ONLY MERGE. Existing claims keep their indices; `stated_items` is
 * carried through by reference-equality of content and asserted unchanged.
 *
 * The `stated_items_disturbed` branch cannot be reached through the completion
 * grammar (which has no `stated_items`), and exists anyway: the property that
 * the user's own words are untouched is the one this mechanism must never
 * discover it lost, and a guarantee that rests on "the schema wouldn't let it"
 * is a guarantee with no witness.
 */
export function mergeCompletionClaims(
  base: DraftRecordSet,
  completion: { stated_items?: unknown; claims?: DraftInferenceClaim[] },
): CompletionMergeResult {
  if (completion.stated_items !== undefined) return { ok: false, reason: "stated_items_disturbed" };
  const added = completion.claims ?? [];
  if (added.length === 0) return { ok: false, reason: "no_new_claims" };
  return {
    ok: true,
    records: { stated_items: base.stated_items, claims: [...base.claims, ...added] },
    added: added.length,
  };
}
