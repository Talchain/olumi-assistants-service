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
import { buildConfigureOptionRecoveryCopy } from './configure-option-clarify.js';
import {
  detectConfigureOptionIntent,
  projectOptionLabels,
} from './configure-option-intent.js';

/** Why no verdict was reached. Every value leaves the response untouched. */
export type ConfigureOptionOutcomeSkipReason =
  | 'not_configure_intent'
  | 'pre_graph_unparseable'
  | 'option_not_identified'
  | 'recovery_copy_unavailable';

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
  return mergeInterventionSources(node as unknown as Record<string, unknown>) ?? {};
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
  const target = buildConfigureOptionRecoveryCopy({
    message: params.message,
    detection,
    graph: before,
  });
  if (!target.matched) {
    return { status: 'not_applicable', reason: 'option_not_identified' };
  }

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
    // The option is no longer resolvable in the applied graph (e.g. it left
    // `needs_encoding` by some route other than an interventions write). No
    // honest copy is available, so say nothing rather than guess.
    return { status: 'not_applicable', reason: 'recovery_copy_unavailable' };
  }

  return {
    status: 'not_honoured',
    optionId: recovery.optionId,
    optionLabel: recovery.optionLabel,
    factorLabels: recovery.factorLabels,
  };
}
