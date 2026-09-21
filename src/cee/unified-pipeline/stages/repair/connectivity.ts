/**
 * Stage 4 Substep 8: Connectivity + goal repair
 *
 * Source: Pipeline A lines 1495-1696
 * Ensures minimum structure (goal, decision, option), infers goal if missing,
 * wires outcomes to goal if unreachable, builds validationSummary.
 */

import type { StageContext } from "../../types.js";
import {
  validateMinimumStructure,
  MINIMUM_STRUCTURE_REQUIREMENT,
} from "../../../transforms/structure-checks.js";
import {
  ensureGoalNode,
  hasGoalNode,
  wireOutcomesToGoal,
} from "../../../structure/index.js";
import { fixTerminalBridge } from "./terminal-bridge.js";
import { detectEdgeFormat } from "../../utils/edge-format.js";
import type { EdgeFormat } from "../../utils/edge-format.js";
import type { EdgeT } from "../../../../schemas/graph.js";
import { isProduction } from "../../../../config/index.js";
import { log, emit, TelemetryEvents } from "../../../../utils/telemetry.js";

export function runConnectivity(ctx: StageContext): void {
  if (!ctx.graph) return;

  // Fault injection (dev-only)
  if (!isProduction()) {
    const forceMissingHeader = (ctx.request.headers as any)["x-debug-force-missing-kinds"];
    if (typeof forceMissingHeader === "string" && forceMissingHeader.length > 0) {
      const kindsToStrip = forceMissingHeader.split(",").map((k: string) => k.trim().toLowerCase());
      const originalNodeCount = (ctx.graph as any).nodes.length;
      ctx.graph = {
        ...(ctx.graph as any),
        nodes: (ctx.graph as any).nodes.filter((n: any) => !kindsToStrip.includes(n.kind?.toLowerCase())),
      } as any;
      log.info({
        request_id: ctx.requestId,
        kinds_stripped: kindsToStrip,
        nodes_before: originalNodeCount,
        nodes_after: (ctx.graph as any).nodes.length,
        event: "cee.fault_injection.applied",
      }, "Fault injection: stripped node kinds for testing");
    }
  }

  const graph = ctx.graph!;
  let structure = validateMinimumStructure(graph);

  // Goal inference when goal is missing
  if (!structure.valid && structure.missing.includes("goal")) {
    const explicitGoal = Array.isArray((ctx.input as any).context?.goals) && (ctx.input as any).context.goals.length > 0
      ? (ctx.input as any).context.goals[0]
      : undefined;

    const goalResult = ensureGoalNode(graph, ctx.input.brief, explicitGoal, ctx.collector);

    if (goalResult.goalAdded) {
      ctx.graph = goalResult.graph;
      structure = validateMinimumStructure(ctx.graph!);

      emit(TelemetryEvents.CeeGoalInferred, {
        request_id: ctx.requestId,
        inferred_from: goalResult.inferredFrom,
        goal_node_id: goalResult.goalNodeId,
      });

      log.info({
        request_id: ctx.requestId,
        goal_added: true,
        inferred_from: goalResult.inferredFrom,
        goal_node_id: goalResult.goalNodeId,
      }, "Goal node added to graph via inference");
    }
  }

  // Wire outcomes/risks to goal when connectivity fails
  const goalExistsButUnreachable =
    !structure.valid &&
    structure.connectivity_failed &&
    (structure as any).connectivity?.reachable_goals?.length === 0 &&
    hasGoalNode(ctx.graph);

  if (goalExistsButUnreachable) {
    const goalNode = (ctx.graph as any).nodes.find((n: any) => n.kind === "goal");
    const goalId = goalNode?.id as string | undefined;

    if (goalId) {
      const edgeCountBefore = (ctx.graph as any).edges.length;
      ctx.graph = wireOutcomesToGoal(ctx.graph!, goalId, ctx.collector);
      const edgesAdded = (ctx.graph as any).edges.length - edgeCountBefore;

      if (edgesAdded > 0) {
        structure = validateMinimumStructure(ctx.graph!);
        log.info({
          request_id: ctx.requestId,
          edges_added: edgesAdded,
          goal_node_id: goalId,
        }, "Edge repair: wired outcomes/risks to goal");
      }
    }
  }

  // Terminal-bridge synthesis (ROADMAP 2.1099). MUST run after `ensureGoalNode`
  // above: when the model omits the goal, CEE mints it here and the enforcement
  // gate then rejects the graph because that freshly-minted node is unreachable.
  // Sited in the sweep instead, this repair could not see that goal at all.
  //
  // `wireOutcomesToGoal` has just run and, on this shape, wired nothing — its
  // outcome/risk set is empty. That is the whole failure class: six connectivity
  // repairs, all presupposing a bridge node that does not exist. See
  // terminal-bridge.ts for the measured evidence and the honesty contract on the
  // node it mints.
  {
    const liveFormat = detectEdgeFormat((ctx.graph as any).edges as EdgeT[]);
    const format: EdgeFormat = liveFormat === "NONE" ? (ctx.detectedEdgeFormat ?? "V1_FLAT") : liveFormat;

    const bridgeResult = fixTerminalBridge(ctx.graph as any, format, { collector: ctx.collector });

    if (bridgeResult.repairs.length > 0) {
      ctx.deterministicRepairs = [...(ctx.deterministicRepairs ?? []), ...bridgeResult.repairs];
      ctx.repairTrace = {
        ...(ctx.repairTrace ?? {}),
        terminal_bridge: {
          ran: true,
          bridge_node_id: bridgeResult.bridgeNodeId,
          edges_added: bridgeResult.edgesAdded,
        },
      };

      structure = validateMinimumStructure(ctx.graph!);

      log.info({
        event: "cee.connectivity.terminal_bridge_synthesised",
        request_id: ctx.requestId,
        bridge_node_id: bridgeResult.bridgeNodeId,
        edges_added: bridgeResult.edgesAdded,
        goal_node_id: (ctx.graph as any).nodes.find((n: any) => n.kind === "goal")?.id,
      }, "Connectivity: synthesised terminal bridge (draft had no outcome or risk node)");
    }
  }

  // Build validationSummary
  const requiredKinds = Object.keys(MINIMUM_STRUCTURE_REQUIREMENT);
  const presentKinds = Object.keys(structure.counts).filter((k) => (structure.counts[k] ?? 0) > 0);

  if (!structure.valid) {
    ctx.validationSummary = {
      status: "invalid",
      required_kinds: requiredKinds,
      present_kinds: presentKinds,
      missing_kinds: structure.missing,
      message: (structure as any).outcome_or_risk_missing
        ? "Graph missing required outcome or risk nodes"
        : structure.connectivity_failed
          ? "Graph has all required node types but they are not connected via edges"
          : `Graph missing required elements: ${structure.missing.join(", ")}`,
      suggestion: (structure as any).outcome_or_risk_missing
        ? "Add at least one outcome or risk node to connect factors to your goal"
        : structure.connectivity_failed
          ? "Ensure there is a path from decision through options to outcomes/risks and finally to goal"
          : `Add at least ${structure.missing.map((k: string) => `1 ${k} node`).join(", ")}`,
    };
  } else {
    ctx.validationSummary = {
      status: "valid",
      required_kinds: requiredKinds,
      present_kinds: presentKinds,
      missing_kinds: [],
    };
  }
}
