/**
 * ⭐⭐ ROADMAP 2.427 — BIND THE OUTCOME TO THE INTENT.
 *
 * THE DEFECT, measured at the bytes on deployed CEE `98f2476` (diagnosis lane,
 * 8 Aug, 71 fresh-scenario captures; capture `P3r7_4_phrasing.json`):
 *
 *   REQUEST  "Under the Cloud-Native CRM option, set its effect on Adoption
 *            Complexity to 0.7."
 *   RESPONSE 200 — "Updated the Cloud-Native CRM to Adoption Complexity edge
 *            strength from 1.0 to 0.7. Rerun analysis to see the effect."
 *            `blocks: []` — **ZERO error blocks.**
 *            `draft_graph`: edge `opt_cloud_native → fac_adoption_complexity`
 *            now `strength.mean = 0.7` … and `opt_cloud_native.interventions`
 *            still **absent**.
 *            `analysis_ready`: `opt_cloud_native` still **`needs_encoding`**,
 *            `interventions: {}`.
 *
 * The user asked to configure an OPTION. The product wrote an EDGE, told them
 * it had succeeded, offered no error, and left the option exactly as blocked as
 * it was. Every sentence in that reply is individually true. The reply as a
 * whole is a false success — the PC2 class.
 *
 * ⚠ WHY THE EXISTING FALSE-SUCCESS GUARD IS STRUCTURALLY BLIND TO THIS, and
 * this is the whole reason a new guard is needed rather than a wider regex.
 * `edit-graph-dispatch.ts`'s V5 H5 invariant is gated on
 * `!successfulAppliedMutation` — it asks *"did anything land?"*. Here something
 * DID land. It was the wrong thing. **A guard that asks whether AN operation
 * landed cannot ever see a wrong-entity write**, and no amount of phrasing
 * patterns fixes that, because the phrasing was accurate about the entity it
 * described. The question has to change from *did an op land* to *did an op
 * land FOR THE THING THE USER NAMED* — which is why the check below is bound to
 * `optionId` by IDENTITY and can never be satisfied by "an op landed"
 * (standing rule, trap 19).
 *
 * WHAT IS COMPARED, and why it is the graph rather than the operation list.
 * The obvious implementation is to scan `editResult.operations` for an
 * `update_node` on `/nodes/<opt>/data/interventions/<factor>`. That would be a
 * MIRROR of the served prompt's sanctioned vocabulary (trap 12) — it would go
 * stale the day the prompt gains a second accepted shape — and worse, it would
 * pass on an operation that was SUBMITTED and then canonicalised away, which is
 * precisely the `OPERATION_DID_NOT_LAND` shape the sibling failure capture
 * (`P3_4_phrasing.json`) recorded. So the comparison is on the applied GRAPH,
 * through `mergeInterventionSources` — the same reader that composes the
 * readiness payload the user is looking at. Consequences that matter:
 *   - it is vocabulary-independent (any operation shape that really writes an
 *     intervention satisfies it);
 *   - it cannot be satisfied by an intent that did not survive to the graph;
 *   - it cannot disagree with the `needs_encoding` badge, because it reads the
 *     same three intervention sources that badge is derived from.
 *
 * SAFE-BIASED. Every uncertainty returns `not_applicable`, which leaves the
 * pre-existing response untouched. In particular an option this module cannot
 * pin down by identity produces NO verdict at all — a guard that guessed which
 * option the user meant would be the same confident-wrong-answer failure it
 * exists to remove.
 */

import { GraphV3, type GraphV3T } from '../../schemas/cee-v3.js';
import { mergeInterventionSources } from '../../orchestrator/tools/analysis-ready-helper.js';
import {
  buildConfigureOptionRecoveryCopy,
  resolveConfigureOptionTarget,
  type ConfigureOptionClarifyDeclineReason,
  type ConfigureOptionTargetDeclineReason,
} from './configure-option-clarify.js';
import {
  detectConfigureOptionIntent,
  projectOptionLabels,
} from './configure-option-intent.js';

/**
 * Why no verdict was reached. Every value leaves the response untouched.
 *
 * ⭐ THESE ARE THE TARGET RESOLVER'S OWN REASONS, NOT A CATCH-ALL. This union
 * used to flatten every resolver decline into `option_not_identified` — so
 * `no_unconfigured_option`, `no_readiness`, `graph_unparseable` and
 * `no_candidate_factor` all surfaced under a name that says *the option could
 * not be resolved* when in fact resolution had never been attempted. That
 * misdirection is what `configure-option-outcome-configured-domain.test.ts`
 * pinned, and aiming a lane at a resolver that did not decide anything is
 * exactly what it cost.
 *
 * ⚠ `option_not_named` IS RETIRED, not renamed. It existed because the shared
 * resolver could fall back to "the sole unconfigured option" and this guard had
 * to reject the guess afterwards. `resolveConfigureOptionTarget` has no
 * fallback, so the state is now unreachable by construction rather than
 * rejected after the fact — the stronger of the two.
 */
export type ConfigureOptionOutcomeSkipReason =
  | 'not_configure_intent'
  | 'pre_graph_unparseable'
  | 'no_readiness'
  | 'option_not_identified'
  /** The message named two or more options; a guess is not an identity. */
  | 'option_label_ambiguous';

/**
 * Why the protecting verdict carries NO copy. Either the copy predicate
 * declined on its own domain, or the two resolutions disagreed.
 */
export type ConfigureOptionNoCopyReason =
  | ConfigureOptionClarifyDeclineReason
  | 'recovery_target_diverged';

/**
 * The target resolver's declines, in this module's vocabulary. Only
 * `graph_unparseable` needs a name change: this module has already parsed the
 * pre-edit graph, so its own reason is the more precise one.
 */
function skipReasonFor(
  reason: ConfigureOptionTargetDeclineReason,
): ConfigureOptionOutcomeSkipReason {
  return reason === 'graph_unparseable' ? 'pre_graph_unparseable' : reason;
}

export type ConfigureOptionOutcomeVerdict =
  | { readonly status: 'not_applicable'; readonly reason: ConfigureOptionOutcomeSkipReason }
  /** An interventions write landed for the option the user named. */
  | { readonly status: 'honoured'; readonly optionId: string }
  /**
   * The turn was a configure-option turn for a resolvable option, and the
   * applied graph carries NO interventions write for that option id. The
   * response must not claim success, and `recovery` is the copy that replaces
   * it — the option by name, its still-unset factors, and the routable
   * sentence.
   */
  | {
      readonly status: 'not_honoured';
      readonly optionId: string;
      readonly optionLabel: string;
      readonly factorLabels: readonly string[];
    }
  /**
   * ⭐⭐ PROTECTION WITHOUT COPY — the verdict a REVISION gets.
   *
   * Everything `not_honoured` says about the WRITE is true here: this was a
   * configure-option turn, the option is resolved BY NAME, and the applied
   * graph carries no interventions write for it. What is NOT available is an
   * honest sentence. The recovery copy asserts *"this option has no effect
   * values yet, so the analysis cannot compare it"* — false of an option
   * already carrying a value, which is every option on a drafted graph.
   *
   * So the two consumers are deliberately split at the status:
   *
   *   `option-intervention-write-guard.ts`  accepts BOTH → the write is
   *                                         withheld on a revision.
   *   `edit-graph-dispatch.ts`              matches `=== 'not_honoured'` only
   *                                         → no new sentence is composed.
   *
   * It carries NO `factorLabels`, so a consumer cannot compose the untrue
   * sentence even by accident. Widening the copy instead would have traded a
   * false success for a false NOTICE: the same harm, opposite sign.
   */
  | {
      readonly status: 'not_honoured_no_copy';
      readonly optionId: string;
      readonly optionLabel: string;
      readonly copyDeclineReason: ConfigureOptionNoCopyReason;
    };

/**
 * Read an option node's effective interventions.
 *
 * DERIVED (trap 12): `mergeInterventionSources` is the SAME reader
 * `computeStructuralReadiness` uses to decide `needs_encoding` vs `ready`, so
 * this guard and the badge on the user's screen can never disagree about
 * whether an option has values. Re-spelling the three-source precedence here
 * would be a mirror of exactly the kind this estate keeps paying for.
 */
function readInterventions(
  graph: GraphV3T,
  optionId: string,
): Readonly<Record<string, number>> {
  const node = graph.nodes.find((n) => n.id === optionId);
  if (node === undefined) return {};
  // Single cast, matching `computeStructuralReadiness`'s own call site
  // verbatim (`const nodeAny = opt as Record<string, unknown>`). Deliberately
  // NOT an `as unknown as` double-cast: that is one of the three high-risk
  // boundary patterns the forbidden-boundary ratchet freezes, and the reader
  // this feeds is duck-typed precisely so callers do not need to force it.
  return mergeInterventionSources(node as Record<string, unknown>) ?? {};
}

/**
 * Did an interventions write land for THIS option — by identity?
 *
 * A write counts when the option gained a factor key it did not have, or when
 * an existing key's value changed. Both are needed: the P3r7 capture's option
 * had NO interventions at all (a pure gain would have been enough), but the
 * same wrong-entity failure is reachable on an option that already carries one
 * value and is being given a second, or having its first revised.
 *
 * ⚠ IDENTITY, NEVER "AN OP LANDED" (trap 19). `optionId` is the only node this
 * function reads. A write on any other option — the ordinary success shape for
 * a DIFFERENT turn — is invisible to it by construction, and the discriminating
 * mutant pair in `configure-option-outcome.test.ts` proves that: loosening the
 * check to "any option gained a write" turns the wrong-option case RED, while
 * loosening it for one unrelated option leaves it GREEN.
 */
function interventionsWriteLandedFor(
  optionId: string,
  before: GraphV3T,
  after: GraphV3T,
): boolean {
  const pre = readInterventions(before, optionId);
  const post = readInterventions(after, optionId);
  for (const [factorId, value] of Object.entries(post)) {
    if (!(factorId in pre)) return true;
    if (pre[factorId] !== value) return true;
  }
  return false;
}

/**
 * Evaluate whether a configure-option turn's OUTCOME honoured its INTENT.
 *
 * `before` is the pre-edit graph the turn was dispatched against; `after` is
 * the applied graph, or `null` when the edit produced none (the
 * `OPERATION_DID_NOT_LAND` shape — treated as "after === before", which is
 * exactly what the user's canvas shows).
 *
 * Pure: no I/O, no LLM, no telemetry. The caller owns emission and the response
 * rewrite.
 */
export function evaluateConfigureOptionOutcome(params: {
  readonly message: string;
  readonly before: unknown;
  readonly after: unknown;
}): ConfigureOptionOutcomeVerdict {
  const parsedBefore = GraphV3.safeParse(params.before);
  if (!parsedBefore.success) {
    return { status: 'not_applicable', reason: 'pre_graph_unparseable' };
  }
  const before = parsedBefore.data;

  // The applied graph, when there is one AND it strict-parses. A graph that
  // does not parse degrades to "nothing landed", which is the conservative
  // direction: it can only make the guard ASK for a recovery, never suppress
  // one, and the recovery copy is always true of a graph with no write in it.
  const parsedAfter = GraphV3.safeParse(params.after);
  const after = parsedAfter.success ? parsedAfter.data : before;

  // Was this turn about configuring an option at all? Derived from the SHIPPED
  // detector with the pre-edit graph's own labels — the same resolution
  // route-v2 performs, not a second reading of the message.
  const detection = detectConfigureOptionIntent(
    params.message,
    projectOptionLabels(before.nodes),
  );
  if (!detection.matched) {
    return { status: 'not_applicable', reason: 'not_configure_intent' };
  }

  // WHICH option — resolved against the PRE-edit graph, because that is the
  // state in which the user's target was still `needs_encoding` and therefore
  // identifiable. Resolving against `after` would lose a target that the edit
  // had (correctly) just completed.
  //
  // ⭐⭐ RESOLVED BY THE TARGET RESOLVER, NOT THE COPY PREDICATE — this is the
  // split. `buildConfigureOptionRecoveryCopy` answers *what copy replaces the
  // response?*, and asking it *which option did the user name?* imported its
  // COPY domain into the IDENTITY question: a revision has no outstanding slot,
  // so the copy predicate declined and the guard abstained on 46 of 46 real
  // captured turns — never reaching a verdict in EITHER direction, so a
  // successful revision was as invisible to it as a wrong-entity one.
  const target = resolveConfigureOptionTarget({
    message: params.message,
    detection,
    graph: before,
  });
  if (!target.matched) {
    return { status: 'not_applicable', reason: skipReasonFor(target.reason) };
  }

  // ⭐⭐ P1 (adversarial review of `572f7ea9`) — A GUESS IS NOT AN IDENTITY.
  //
  // ⚠ THE CHECK THIS NOTE GUARDED IS GONE, AND THE NOTE STAYS BECAUSE THE
  // REASONING IS WHAT MATTERS. It used to read
  // `if (target.optionSource !== 'named_in_message') return option_not_named`,
  // rejecting the shared resolver's sole-unconfigured fallback AFTER the fact.
  // `resolveConfigureOptionTarget` carries no fallback at all, so the state is
  // now unreachable BY CONSTRUCTION. Anything that reintroduces a
  // "pick the only candidate" tie-break into that resolver reopens exactly the
  // defect described below, with no check left here to catch it.
  //
  // `resolveConfigureOptionFacts` will fall back to "the sole unconfigured
  // option" when the message names none. That is a good heuristic for the
  // INTERCEPT — a value-less "Help me configure one of my options." genuinely
  // means the only blocked one — and it is unsound here, for a reason that is
  // pure trap-21 residue: the 2.427 split moved the `value_payload` conjunct
  // out of the recovery path and left the resolver's OTHER intercept-domain
  // assumption travelling unexamined.
  //
  // In recovery, value-bearing messages flow in, and they routinely name a
  // CONFIGURED option — which is absent from the unconfigured list, so the
  // fallback silently retargets the verdict onto a different option. Proven by
  // execution: "Under the Cloud-Native CRM option, set its effect on Adoption
  // Complexity to 0.9", with CRM already at 0.7 and Basic Platform the sole
  // blocked option, LANDS the revision and still returned `not_honoured` for
  // `opt_basic` — so the dispatcher swapped a TRUE success confirmation for
  // recovery copy about an option the user never mentioned, and logged
  // `applied_something: true`, counting the guard's own mistake as a product
  // defect in the very meter that measures the defect.
  //
  // Note the harm is the INVERSE of the one this module exists to fix, and note
  // what it defeated: the identity mutant pair varies which option the
  // WRITE-CHECK reads, and this defect is in which option the target RESOLVES
  // to. Both mutants agreed; neither was pointed at the resolution step.
  //
  // So: this guard may only speak about an option the USER NAMED. Its whole
  // doctrine is identity binding (trap 19), and a sole-unconfigured guess is
  // not an identity.
  if (interventionsWriteLandedFor(target.optionId, before, after)) {
    return { status: 'honoured', optionId: target.optionId };
  }

  // NOT HONOURED. Recompose the copy against the POST-edit graph so the factors
  // named are the ones still unset after whatever the edit DID land.
  const recovery = buildConfigureOptionRecoveryCopy({
    message: params.message,
    detection,
    graph: after,
  });
  if (!recovery.matched) {
    // ⭐ NO HONEST COPY — AND THAT IS NOT A REASON TO ABSTAIN. This used to
    // return `not_applicable`, which switched the WRITE guard off along with
    // the sentence. The two are separable: the option is resolved by name and
    // no write landed for it, so the protection is owed whether or not a true
    // sentence exists. The copy's own decline reason travels with the verdict
    // instead of being flattened away.
    return {
      status: 'not_honoured_no_copy',
      optionId: target.optionId,
      optionLabel: target.optionLabel,
      copyDeclineReason: recovery.reason,
    };
  }

  // The post-edit re-resolution is a SECOND resolution, against a DIFFERENT
  // graph, and nothing structurally forces it to land on the same option as the
  // one whose write was just checked — the unconfigured set can change shape
  // between `before` and `after`. Pinned rather than assumed: a verdict that
  // named one option and carried copy about another would be the same
  // wrong-entity harm this module exists to remove, reintroduced two lines from
  // the end of it.
  if (recovery.optionId !== target.optionId) {
    // Same reasoning as the decline above: the copy is unusable, the
    // protection is not. The verdict keeps the TARGET's identity — the option
    // the message named, resolved against the pre-edit graph — and drops the
    // copy that would have carried the other option's name and factors.
    return {
      status: 'not_honoured_no_copy',
      optionId: target.optionId,
      optionLabel: target.optionLabel,
      copyDeclineReason: 'recovery_target_diverged',
    };
  }

  return {
    status: 'not_honoured',
    optionId: recovery.optionId,
    optionLabel: recovery.optionLabel,
    factorLabels: recovery.factorLabels,
  };
}
