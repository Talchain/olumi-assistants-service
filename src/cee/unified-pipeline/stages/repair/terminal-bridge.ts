/**
 * Terminal-bridge synthesis (ROADMAP 2.1099, R1).
 *
 * THE DEFECT THIS CLOSES, measured over 9 live drafts across two builds
 * (`olumi-docs/PHASE0-EVIDENCE-2026-07-28/draft-reliability-2026-08-12/
 * DIAGNOSIS-ENFORCEMENT.md`): the drafter emits `decision → options → factors`
 * and no bridge layer. `MISSING_BRIDGE` fires — its predicate is literally
 * `outcomes.length === 0 && risks.length === 0` — and because `ALLOWED_EDGES`
 * has no `factor→goal` rule, `outcome` and `risk` are the ONLY routes to the
 * goal. Zero of them makes the goal unreachable BY CONSTRUCTION: one
 * `NO_PATH_TO_GOAL` per node, one `NO_EFFECT_PATH` per option, and
 * `applyDeterministicEnforcement` throws the whole draft away on
 * `errors.length > 0`. S3 failed 7/7 and S4 2/2; a user waits ~48s for nothing.
 *
 * WHY A NEW REPAIR RATHER THAN A WIDER OLD ONE. Six connectivity repairs
 * already exist and EVERY ONE presupposes at least one outcome/risk node:
 * `wireOutcomesToGoal` iterates an empty set, `fixStatusQuoConnectivity` needs a
 * `mostCommonTarget` among them, `handleUnreachableFactors` only wires an
 * EXISTING one, `fixBridgeChaining` only bridges endpoints of a removed
 * outcome↔risk edge, and `fixFactorGoalEdges` needs an existing `factor→goal`
 * edge. The one graph shape with no bridge is the one shape none of them can
 * repair — and `ensureGoalNode` makes it worse by MINTING the goal that is then
 * judged unreachable. The product creates the violation it fails closed on.
 *
 * ⚠ WHY IT RUNS AT SUBSTEP 8 AND NOT INSIDE THE SUBSTEP-1 SWEEP. `ensureGoalNode`
 * runs at substep 8 (`connectivity.ts`). A repair sited in the sweep cannot see a
 * goal minted seven substeps later, so it would leave the `ensureGoalNode`
 * incoherence — the sharpest form of the defect — untouched. Substep 8 is the
 * last connectivity-owning step before the gate.
 *
 * ⛔ THE NODE THIS MINTS IS ONE THE USER NEVER WROTE, so what it is marked with
 * matters — and so does what a user can actually SEE. Those are different
 * questions, and an earlier version of this comment answered the second with the
 * first. The measured position, by channel:
 *
 *   REACHES A USER (verified by execution through the real `transformGraphToV3`,
 *   `tests/unit/cee.terminal-bridge-synthesis.test.ts`):
 *     - `label` — "…(added by Olumi)", a required V3 node field;
 *     - `body` → V3 `description` (`schema-v3.ts`), a declared V3 node field,
 *       carrying "…It is not from your brief — review or replace it."
 *   These two are the disclosure. Everything else below is defence in depth.
 *
 *   ON THE WIRE BUT NOT RENDERED (reported stripped by the UI adapter allowlist —
 *   an independent review's measurement, NOT re-derived here, and the UI is not
 *   this seam): node `provenance` (`ai_inferred`, and it can never be
 *   `from_brief` because this node has no `extractionType` / `observed_state` /
 *   `data` for `mayClaimFromBrief` to read) and the edges' `origin: "repair"` /
 *   `provenance.source: "synthetic"`.
 *
 *   ⚠ DOES NOT REACH A USER AT ALL — do not describe either as an audit trail:
 *     - the `node_added` CORRECTION below. `corrections` is not a declared field
 *       on the V3 response (`schemas/cee-v3.ts`: 0 occurrences, against 18 for
 *       `nodes` as a contrast control), so it is dropped at the V1→V3 boundary.
 *       It is kept because it is the convention every sibling repair follows and
 *       it is real telemetry — not because a human sees it.
 *     - the `TERMINAL_BRIDGE_SYNTHESISED` repair via
 *       `trace.repair_summary.deterministic_repairs`. Its only consumer,
 *       `extractRepairsApplied` (`orchestrator/tools/draft-graph.ts`), requires
 *       `typeof rec.reason === "string"` before it will build a `RepairEntry` —
 *       and ALL FOUR `Repair` interfaces in this tree are `{code, path, action}`.
 *       Measured with a complete manifest and a contrast control: 0 producers
 *       emit `reason`, 44 emit `action`; `reason` appears only in that consumer's
 *       own test fixtures. That whole limb is dead for every deterministic
 *       repair, not just this one. Rowed, not fixed here.
 *
 * RUNG: MOUNTED. The wire values are asserted by execution; no fresh-journey
 * witness has been taken on a deployed build carrying this code. Not "live".
 */

import type { GraphT, NodeT, EdgeT } from "../../../../schemas/graph.js";
import type { EdgeFormat } from "../../utils/edge-format.js";
import { neutralCausalEdge, patchEdgeNumeric } from "../../utils/edge-format.js";
// ⭐ THE ONE SCAFFOLDING-BADGE AUTHORITY, shared with the projector and the
// deterministic sweep. Three mint sites, one constructor.
import { scaffoldingProvenance } from "../../../draft/records/projector.js";

/** Id of the synthetic bridge node. Stable so tests can bind by IDENTITY, not by a predicate. */
export const SYNTHETIC_BRIDGE_NODE_ID = "out_synthetic_bridge";

/**
 * The label a user reads on the canvas. It names the addition in the label
 * itself, because a badge elsewhere in the UI is a promise about a surface this
 * module does not own.
 */
export const SYNTHETIC_BRIDGE_LABEL = "Overall impact (added by Olumi)";

/**
 * Projected to the V3 wire as `NodeV3.description` (schemas/cee-v3.ts).
 * `Node.body` is `z.string().max(200)` — keep this under that bound.
 */
export const SYNTHETIC_BRIDGE_BODY =
  "Added by Olumi because the drafted model had no outcome connecting your options to this goal. " +
  "It is not from your brief — review or replace it.";

/** Bridge edge numerics: the identical constructor call `fixFactorGoalEdges` already makes. */
const BRIDGE_TO_GOAL = { mean: 0.5, std: 0.15, existence: 0.9 } as const;

/** Kinds that can carry causal flow onwards towards the goal. */
const DOWNSTREAM_KINDS = new Set(["factor", "outcome", "risk"]);

interface Repair {
  code: string;
  path: string;
  action: string;
}

interface TerminalBridgeOptions {
  /**
   * CorrectionCollector — the channel every sibling repair writes to. Telemetry
   * only: `corrections` is dropped at the V1→V3 boundary and never reaches a
   * user (see the header). Written for consistency with the siblings, not as a
   * disclosure.
   */
  collector?: {
    addByStage(
      stage: number,
      type: string,
      target: Record<string, unknown>,
      reason: string,
      before?: unknown,
      after?: unknown,
    ): void;
  };
}

export interface TerminalBridgeResult {
  repairs: Repair[];
  /** Id of the node minted this call, or undefined when the repair declined. */
  bridgeNodeId?: string;
  edgesAdded: number;
}

function nodesOf(graph: GraphT): NodeT[] {
  return (((graph as any).nodes ?? []) as NodeT[]);
}

function edgesOf(graph: GraphT): EdgeT[] {
  return (((graph as any).edges ?? []) as EdgeT[]);
}

/**
 * Should a terminal bridge be synthesised?
 *
 * ⚠ WRITTEN AGAINST THE VALIDATOR'S SPEC, NOT AGAINST THE OBSERVED FAILURE.
 * `MISSING_BRIDGE` is `outcomes.length === 0 && risks.length === 0`, so THAT is
 * the trigger. The S3 sample also happened to have a goal with zero inbound
 * edges, but conditioning on that would be conditioning on where we came in: a
 * graph with a surviving `factor→goal` edge and still no outcome is equally
 * blocked, and would be skipped by the narrower rule (trap 13d).
 *
 * Two further conjuncts, each of which prevents trading one blocking code for
 * another rather than describing the sample:
 *  - a goal must exist — there is nothing to bridge to otherwise, and
 *    `ensureGoalNode` has already had its turn by the time this runs;
 *  - at least one factor must exist — a bridge with no inbound edge is itself
 *    `UNREACHABLE_FROM_DECISION`, so minting one would swap a code, not clear it.
 */
export function needsTerminalBridge(graph: GraphT): boolean {
  const nodes = nodesOf(graph);
  if (nodes.length === 0) return false;

  let hasGoal = false;
  let hasFactor = false;
  for (const node of nodes) {
    const kind = (node as { kind?: string }).kind;
    // Any existing bridge — or a previous run of this repair — means no.
    if (kind === "outcome" || kind === "risk") return false;
    if (kind === "goal") hasGoal = true;
    else if (kind === "factor") hasFactor = true;
  }

  return hasGoal && hasFactor;
}

/**
 * Synthesise the missing bridge layer: one outcome node, `factor→outcome` edges
 * from every terminal factor, and one `outcome→goal` edge.
 *
 * No-op unless `needsTerminalBridge` holds, so it is idempotent and cannot
 * touch a graph that already has a bridge.
 */
export function fixTerminalBridge(
  graph: GraphT,
  format: EdgeFormat,
  opts: TerminalBridgeOptions = {},
): TerminalBridgeResult {
  if (!needsTerminalBridge(graph)) return { repairs: [], edgesAdded: 0 };

  const nodes = nodesOf(graph);
  const edges = edgesOf(graph);

  const goalNode = nodes.find((n) => (n as { kind?: string }).kind === "goal");
  if (!goalNode) return { repairs: [], edgesAdded: 0 };
  const goalId = goalNode.id;

  const nodeKindMap = new Map<string, string>();
  for (const node of nodes) nodeKindMap.set(node.id, (node as { kind?: string }).kind ?? "");

  // `out_synthetic_bridge` is MINTED, not reserved — the id may already be held
  // by an unrelated node. (Same policy as `fixFactorGoalEdges` /
  // `fixOptionGoalShortcut`, and for the same reason: reusing it blindly wires
  // factor→<non-outcome>.) `needsTerminalBridge` has already excluded an
  // existing outcome, so any squatter is some other kind.
  let bridgeId: string = SYNTHETIC_BRIDGE_NODE_ID;
  if (nodeKindMap.has(bridgeId)) {
    let suffix = 2;
    while (nodeKindMap.has(`${SYNTHETIC_BRIDGE_NODE_ID}_${suffix}`)) suffix++;
    bridgeId = `${SYNTHETIC_BRIDGE_NODE_ID}_${suffix}`;
  }

  // A TERMINAL factor is one with no outgoing edge into anything that could
  // carry flow onwards. Non-terminal factors reach the bridge transitively
  // through their factor→factor chains, so wiring every factor would add edges
  // that say nothing. Sorted for deterministic output.
  const hasDownstream = new Set<string>();
  for (const edge of edges) {
    const fromKind = nodeKindMap.get(edge.from);
    const toKind = nodeKindMap.get(edge.to);
    if (fromKind === "factor" && toKind !== undefined && DOWNSTREAM_KINDS.has(toKind)) {
      hasDownstream.add(edge.from);
    }
  }

  const allFactorIds = nodes
    .filter((n) => (n as { kind?: string }).kind === "factor")
    .map((n) => n.id)
    .sort();
  const terminalFactorIds = allFactorIds.filter((id) => !hasDownstream.has(id));

  // Every factor feeding another factor and nothing else would leave the chain
  // with no exit (only reachable through a cycle, which the sweep removes).
  // Falling back to every factor keeps the bridge inbound-connected.
  const sourceFactorIds = terminalFactorIds.length > 0 ? terminalFactorIds : allFactorIds;
  if (sourceFactorIds.length === 0) return { repairs: [], edgesAdded: 0 };

  const bridgeNode = {
    id: bridgeId,
    kind: "outcome",
    label: SYNTHETIC_BRIDGE_LABEL,
    body: SYNTHETIC_BRIDGE_BODY,
    // ⭐ THE MACHINE-READABLE MARKER, added 2026-08-14 alongside the two sweep
    // mint sites. The label and body already tell a HUMAN this node is ours;
    // this is the half a MEASUREMENT can read, so "what share of this outcome
    // layer is scaffolding?" is answerable without a label predicate (which
    // would also match an outcome a model legitimately named "… Impact").
    //
    // ⚠ It does NOT weaken the note below. `provenance_class` is not a field
    // `nodeProvenanceDisplay` or `mayClaimFromBrief` read, and
    // `scaffoldingProvenance` sets `source: "synthetic"`, which
    // `mapToV3ProvenanceSource`'s substring matcher routes nowhere near
    // `from_brief` / `user_set`.
    provenance: scaffoldingProvenance("Synthetic bridge to goal (draft had no outcome node)"),
    // DELIBERATELY ABSENT: `extractionType`, `observed_state`, `data`. Those are
    // exactly the fields `nodeProvenanceDisplay` / `mayClaimFromBrief` read to
    // decide whether a node may claim `from_brief`. A value-free node with no
    // extraction type resolves to `ai_inferred`, which is the truth.
  } as NodeT;

  const newEdges: EdgeT[] = [];

  // factor→outcome, one per terminal factor. `neutralCausalEdge` is the
  // "we do not know this relationship" constructor (|mean| 0.3, std 0.2,
  // existence 0.7) — the honest strength for a link nobody stated. If their sum
  // exceeds the inbound budget, `applyBudgetRescale` at the gate rescales them,
  // which is the existing contract for causal inbound edges.
  for (const factorId of sourceFactorIds) {
    const edge = neutralCausalEdge(format, { from: factorId, to: bridgeId, sign: "positive" });
    newEdges.push({
      ...edge,
      id: `${factorId}__${bridgeId}__terminal_bridge`,
      provenance: { source: "synthetic", quote: "Synthetic bridge to goal (draft had no outcome node)" },
    } as EdgeT);
  }

  // outcome→goal, the identical constructor call `fixFactorGoalEdges` makes at
  // deterministic-sweep.ts:1026.
  newEdges.push(
    patchEdgeNumeric(
      {
        id: `${bridgeId}__${goalId}__terminal_bridge`,
        from: bridgeId,
        to: goalId,
        effect_direction: "positive",
        origin: "repair",
        provenance: { source: "synthetic", quote: "Synthetic bridge to goal (draft had no outcome node)" },
        provenance_source: "synthetic",
      } as EdgeT,
      format,
      BRIDGE_TO_GOAL,
    ),
  );

  (graph as any).nodes = [...nodes, bridgeNode];
  (graph as any).edges = [...edges, ...newEdges];

  // Stage 18 is "Outcome→Goal Wiring" (cee/corrections.ts STAGE_DEFINITIONS) —
  // the same stage `wireOutcomesToGoal` records under.
  opts.collector?.addByStage(
    18,
    "node_added",
    { node_id: bridgeId, kind: "outcome" },
    "Added a synthetic outcome node bridging your factors to the goal — the drafted model had no outcome or risk node, so the goal was unreachable. Not from the brief.",
    undefined,
    { id: bridgeId, kind: "outcome", label: SYNTHETIC_BRIDGE_LABEL },
  );

  const repairs: Repair[] = [
    {
      code: "TERMINAL_BRIDGE_SYNTHESISED",
      path: `nodes[${bridgeId}]`,
      action:
        `Minted synthetic outcome "${bridgeId}" and wired ${sourceFactorIds.length} terminal factor(s) ` +
        `to it and it to goal "${goalId}" (draft had no outcome or risk node)`,
    },
  ];

  return { repairs, bridgeNodeId: bridgeId, edgesAdded: newEdges.length };
}
