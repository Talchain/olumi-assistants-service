/**
 * OPTION_NO_OP NEUTRALISATION — one bad option must not destroy the list.
 *
 * ## What was wrong, measured
 *
 * `#1446` (`ccb7188`) gave `OPTION_NO_OP` severity `error`, so the
 * post-enforcement gate in `graph-enforcement.ts` set `earlyReturn` and the
 * DRAFT was refused. A wire walk on the deployed build (n=10, Paul's demo
 * brief) measured **3 refusals in 10** after two auto-retries, and the recovery
 * copy told the user to reword a brief that was never at fault.
 *
 * **The predicate is right. The consequence was wrong.** Refusing to ACCUSE is
 * the safe direction; refusing to DRAFT is not. Detection is unchanged and
 * still runs — this module changes only what happens next.
 *
 * ## The consequence: de-configure, and let the ratified gate exclude
 *
 * The no-op option's MODEL-AUTHORED intervention map is DELETED, so the option
 * ships in the user's graph as UNCONFIGURED. Every downstream protection
 * already exists and is already ruled on, so nothing new is invented here:
 *
 *   - **It cannot be compared or named a leader.**
 *     `analysable-option-gate.ts` excludes an option with no interventions from
 *     the PLoT submission entirely — *"no rank, no win probability, by
 *     construction rather than by suppression downstream"* (Paul's ruling,
 *     2026-08-14). The trust catastrophe `#1446` closed stays closed.
 *   - **It is disclosed by name**, through the existing omitted-suffix
 *     machinery (`coaching/scaffold-disclosure.ts`).
 *   - **The all-no-op case is already owned**, by `run-analysis.ts` §2.5, whose
 *     reviewed copy reads *"…doesn't say what it changes yet, so I can't score
 *     it — it won't appear in the comparison until you tell me. Tell me what it
 *     changes and I'll write it into the model."* Honest, actionable, and not
 *     a 500.
 *
 * ## Why not DROP the option, and why not MARK it `is_baseline`
 *
 * **DROP** deletes an alternative the user named. In the measured defect the
 * no-op option was labelled with the user's question VERBATIM — dropping it
 * removes the very thing they asked about from their own model. The sibling
 * precedent (`options-identical-graceful-dedup.ts`) drops only because its
 * duplicates are *"an AI artefact the user never asked for and never saw"*,
 * which is not true here; and its Guard 4 declines below two survivors, which
 * would return the all-no-op case to a refusal.
 *
 * **MARK `is_baseline: true`** does not remove the harm, and this was checked
 * at the bytes rather than reasoned about: `analysable-option-gate.ts` HOLDS an
 * `is_baseline` option at its factors' observed values and still SUBMITS it, so
 * the same arm would still be compared and could still win — now under a flag
 * saying "current arrangement" while its label says "increase the price". A
 * remedy that relabels the lie is not a remedy.
 *
 * De-configuring claims only what is true: the option's stated numbers do not
 * specify any change, so we cannot score it. It puts no words in the user's
 * mouth about their sentence, and it keeps the option on their canvas.
 *
 * ## ⚠ THE PROPERTY IS DELETED, NEVER SET TO `{}`
 *
 * `OPTIONS_IDENTICAL` SKIPS an option with no `interventions` key
 * (`graph-validator.ts:1011`, `if (!data?.interventions) continue`) but SIGNS an
 * empty object as the empty string. Neutralising two no-ops to `{}` would
 * therefore collide them on signature `""` and refuse the draft anyway, one
 * code to the left — trading `OPTION_NO_OP` for `OPTIONS_IDENTICAL` and fixing
 * nothing. Pinned by `tests/unit/cee.option-no-op-neutralisation.test.ts`.
 *
 * Edges are deliberately UNTOUCHED. `NO_EFFECT_PATH` reads `adjacency.forward`
 * — edges, not interventions (`graph-validator.ts:986`) — so the option keeps
 * its causal wiring and its path to the goal, and the gate's
 * `buildOptionFactorEdgeMap` can still see what it points at.
 */

import { findNoOpOptions } from "../../../../validators/option-no-op.js";
import type { GraphT, NodeT } from "../../../../schemas/graph.js";
import { log, TelemetryEvents } from "../../../../utils/telemetry.js";

interface Repair {
  code: string;
  path: string;
  action: string;
}

export interface NoOpNeutralisationResult {
  readonly repairs: Repair[];
  /** Option ids de-configured, in graph node order. */
  readonly neutralisedOptionIds: string[];
}

/**
 * De-configure every non-baseline option that changes nothing.
 *
 * Mutates `graph` in place, like its enforcement siblings. Returns the empty
 * result — and touches nothing — when no option is a no-op, so a healthy draft
 * is unchanged to the byte.
 */
export function neutraliseNoOpOptions(
  graph: GraphT,
  requestId?: string,
): NoOpNeutralisationResult {
  const repairs: Repair[] = [];
  const neutralisedOptionIds: string[] = [];

  const nodes = graph.nodes as NodeT[];
  const nodeById = new Map<string, NodeT>();
  for (const node of nodes) nodeById.set(node.id, node);
  const options = nodes.filter((n) => n.kind === "option");

  // THE SAME AUTHORITY THE VALIDATOR REPORTS FROM. Not a second copy of the
  // rule — the reporter and the repairer cannot disagree about what a no-op is.
  for (const finding of findNoOpOptions(options, nodeById)) {
    const option = nodeById.get(finding.optionId);
    const data = option?.data as Record<string, unknown> | undefined;
    if (!data || !("interventions" in data)) continue;

    delete data.interventions;
    neutralisedOptionIds.push(finding.optionId);
    repairs.push({
      code: "OPTION_NO_OP",
      path: `nodes[${finding.optionId}].data.interventions`,
      action:
        `De-configured an option whose stated levels matched the current level on every factor it touches `
        + `(${finding.factorIds.length} factor(s)); it ships in the graph and is excluded from comparative ranking`,
    });
  }

  if (neutralisedOptionIds.length > 0) {
    log.warn({
      event: TelemetryEvents.CeeOptionNoOpNeutralised,
      request_id: requestId,
      // Ids only — no labels and no magnitudes. Labels are drafted from the
      // user's brief (`retry-directive.ts`, reason 1) and magnitudes are held
      // off diagnostics by the rule `schema-v3.ts:1095` states.
      option_ids: neutralisedOptionIds,
      neutralised_count: neutralisedOptionIds.length,
    }, `De-configured ${neutralisedOptionIds.length} option(s) that changed nothing`);
  }

  return { repairs, neutralisedOptionIds };
}
