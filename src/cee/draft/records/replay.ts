/**
 * THE FIXED-INPUT REPLAY SEAM — a captured record set, replayed to a readiness
 * verdict with NO LLM in the loop.
 *
 * ── WHY THIS EXISTS, STATED AS THE DEFECT IT WOULD HAVE CAUGHT ─────────────
 * The 12 Aug R1 cutover replaced a graph grammar with a records grammar whose
 * DRAFTABLE subset omitted `risk` and `outcome`. Nothing went red. The
 * consequence was only observable END TO END: risks arrived flattened into
 * factors, the projector emitted zero outcomes, and
 * `deterministic-sweep.fixFactorGoalEdges` minted a synthetic
 * "<Factor> Impact" outcome for every factor→goal edge — so 100 % of the
 * outcome layer in five live draws on the pinned brief was scaffolding.
 *
 * Every unit test in the tree passed, because each one is pointed at ONE hop.
 * The property that failed is a property of the CHAIN: *what does a record set
 * become by the time a user could analyse it?* This module makes that chain
 * runnable on a fixed input, so the question can be asked in CI instead of on a
 * deployed build.
 *
 * ── ⚠ WHAT IT REPLAYS, AND — MORE IMPORTANTLY — WHAT IT DOES NOT ───────────
 * A harness that is mistaken for the whole pipeline is worse than no harness
 * (trap 22: a journey witness proves the journey it walks and nothing else). So
 * the scope is declared, not implied. It runs, in the pipeline's own order and
 * through the pipeline's own functions:
 *
 *   1. the POST-LLM SEAM      `projectDraftRecords` — wire validation + projection
 *   2. NORMALISATION          `normaliseDraftResponse` — the adapter's next step,
 *                             and the one that maps `constraint → risk`
 *   3. the COMPLETION ASK     `enumerateCompletionAsk` — pass 2's DETERMINISTIC
 *                             half: what would be asked. The LLM call itself is
 *                             deliberately absent; a replay that invented a
 *                             completion would be measuring a fixture, not the
 *                             product.
 *   4. REPAIR substep 1       `runDeterministicSweep`
 *   5. REPAIR substep 8       `runConnectivity` (incl. terminal-bridge synthesis)
 *   6. READINESS              `validateGraph`, the verdict the enforcement gate
 *                             reads
 *
 * NOT replayed, and each absence is a fact about the harness a reader must have:
 *   · repair substep 1b (orchestrator validation) — LLM-backed;
 *   · repair substep 2 (PLoT validation) — an external service;
 *   · the completion LLM turn itself (step 3 above stops at the ask);
 *   · substeps 3–7 and 9b–10, which are edge-id/goal-merge/enforcement stages
 *     this seam does not own and whose inclusion would make the harness a
 *     second, drifting copy of `runStageRepair`.
 * A claim about the harness's output is therefore a claim about steps 1–6 and
 * nothing else.
 *
 * ── DETERMINISM IS THE POINT ───────────────────────────────────────────────
 * Same record set ⇒ byte-identical result, run after run. That is asserted by a
 * test rather than promised here. It is what lets a semantic regression be
 * measured as a DIFF instead of as a vibe.
 */
import { normaliseDraftResponse } from "../../../adapters/llm/normalisation.js";
import { validateGraph } from "../../../validators/graph-validator.js";
import { runDeterministicSweep } from "../../unified-pipeline/stages/repair/deterministic-sweep.js";
import { runConnectivity } from "../../unified-pipeline/stages/repair/connectivity.js";
import { enumerateCompletionAsk, type CompletionAsk } from "./completion.js";
import { PROJECTOR_STRUCTURAL_CLASS } from "./projector.js";
import type { DraftRecordSet } from "./grammar.js";
import type { RecordProjection } from "./projector.js";
import { projectDraftRecords } from "./seam.js";

/** A node as it stands at the end of the replay. Structural, not the V3 wire shape. */
interface ReplayNode {
  id: string;
  kind: string;
  label?: string;
  provenance?: { provenance_class?: string };
}

/**
 * ⭐ THE SEMANTIC TABLE — the report's own measurements, computed from a graph.
 *
 * Deliberately the SAME function the staging acceptance runner uses
 * (`scripts/records-pinned-brief-acceptance.ts` imports it), so a fixture
 * measurement and a live measurement cannot answer the same question two
 * different ways. That is the whole reason it is exported from here rather than
 * written twice.
 */
export interface SemanticTable {
  readonly nodeCount: number;
  readonly edgeCount: number;
  readonly byKind: Readonly<Record<string, number>>;
  readonly riskCount: number;
  readonly riskLabels: readonly string[];
  readonly outcomeCount: number;
  readonly outcomeLabels: readonly string[];
  /**
   * Outcome nodes carrying the machine-readable scaffolding marker — i.e. nodes
   * a repair minted because the drafted model had no outcome layer for that
   * path. Derived from the marker, NEVER from the `" Impact"` label suffix: a
   * label predicate would also match an outcome a model legitimately named
   * "Revenue Impact" (trap 19 — bind by identity, not by a predicate another
   * object could satisfy).
   */
  readonly scaffoldedOutcomeIds: readonly string[];
  /**
   * Scaffolded outcomes as a share of all outcomes. `null` when there are no
   * outcomes at all — a share of zero and "no outcome layer exists" are
   * different findings and must not be reported as the same number.
   */
  readonly scaffoldedOutcomeShare: number | null;
  /**
   * A SECOND, INDEPENDENT reading of the same population: outcomes whose id
   * matches the mint's own `out_<factorId>_impact` pattern. Kept alongside the
   * marker count as a CONTRAST, not as the measure — if the two disagree, one
   * of the two mint sites is not marking, and a single number could never say
   * so.
   */
  readonly impactPatternOutcomeIds: readonly string[];
  readonly optionCount: number;
  readonly optionProvenance: readonly { id: string; label: string; provenance_class: string | null }[];
}

/** Ids minted by `fixFactorGoalEdges` / `fixOptionGoalShortcut`. */
const IMPACT_MINT_ID = /^out_.+_impact(_\d+)?$/;

export function measureSemanticTable(graph: unknown): SemanticTable {
  const nodes = ((graph as { nodes?: ReplayNode[] })?.nodes ?? []) as ReplayNode[];
  const edges = ((graph as { edges?: unknown[] })?.edges ?? []) as unknown[];

  const byKind: Record<string, number> = {};
  for (const node of nodes) byKind[node.kind] = (byKind[node.kind] ?? 0) + 1;

  const risks = nodes.filter((n) => n.kind === "risk");
  const outcomes = nodes.filter((n) => n.kind === "outcome");
  const scaffolded = outcomes.filter(
    (n) => n.provenance?.provenance_class === PROJECTOR_STRUCTURAL_CLASS,
  );
  const options = nodes.filter((n) => n.kind === "option");

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    byKind,
    riskCount: risks.length,
    riskLabels: risks.map((n) => n.label ?? n.id).sort(),
    outcomeCount: outcomes.length,
    outcomeLabels: outcomes.map((n) => n.label ?? n.id).sort(),
    scaffoldedOutcomeIds: scaffolded.map((n) => n.id).sort(),
    scaffoldedOutcomeShare: outcomes.length === 0 ? null : scaffolded.length / outcomes.length,
    impactPatternOutcomeIds: outcomes.filter((n) => IMPACT_MINT_ID.test(n.id)).map((n) => n.id).sort(),
    optionCount: options.length,
    optionProvenance: options
      .map((n) => ({
        id: n.id,
        label: n.label ?? n.id,
        provenance_class: n.provenance?.provenance_class ?? null,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
}

export interface ReplayFailure {
  readonly ok: false;
  /** The seam's own reason, unchanged — never re-worded into a second vocabulary. */
  readonly reason: string;
  readonly detail: string;
}

export interface ReplaySuccess {
  readonly ok: true;
  /** The record set exactly as it entered — echoed so a diff names its input. */
  readonly records: DraftRecordSet;
  /** Step 1's output, before normalisation or any repair. */
  readonly projection: RecordProjection;
  /** Step 3: what pass 2 WOULD be asked. The LLM turn is not replayed. */
  readonly ask: CompletionAsk;
  /** The graph after steps 2, 4 and 5. */
  readonly graph: unknown;
  /** Deterministic repair records accumulated across steps 4 and 5. */
  readonly repairs: readonly { code: string; path: string; action: string }[];
  /** Step 6 — the verdict the enforcement gate reads. */
  readonly readiness: {
    readonly errorCodes: readonly string[];
    readonly warningCodes: readonly string[];
    readonly blocking: boolean;
  };
  readonly semantics: SemanticTable;
}

export type ReplayResult = ReplaySuccess | ReplayFailure;

export interface ReplayOptions {
  /**
   * The brief, as read-only evidence for the provenance claim. Optional and
   * FAIL-CLOSED exactly as the seam is: omit it and stated items bind
   * `unchecked` rather than claiming the brief.
   */
  readonly brief?: string;
  /**
   * Request id carried into the sweep's telemetry. Fixed by default so two
   * replays of one record set are byte-identical (a clock- or random-derived id
   * would make every run differ and quietly destroy the property this module
   * exists to provide).
   */
  readonly requestId?: string;
}

/**
 * Replay a captured record set through the deterministic chain.
 *
 * `async` because `runDeterministicSweep` is; nothing here awaits I/O.
 */
export async function replayRecordSet(
  records: DraftRecordSet,
  options: ReplayOptions = {},
): Promise<ReplayResult> {
  const brief = options.brief;
  const requestId = options.requestId ?? "records-replay";

  // ── 1. The post-LLM seam. The LIVE path, not `projectRecordsToGraph`: the
  // seam is where `sets_to` was once silently dropped while every projector
  // test agreed (trap 3b/19 — bind the harness to the surface the product runs).
  const seam = projectDraftRecords(records, brief);
  if (!seam.ok) return { ok: false, reason: seam.reason, detail: seam.detail };

  // ── 2. Normalisation, the adapter's own next step. Load-bearing here: it is
  // what maps a projected `constraint` node to `risk`, and the repair stages
  // below judge kinds AFTER it has run.
  const normalised = normaliseDraftResponse(
    JSON.parse(JSON.stringify(seam.projection.graph)) as unknown,
  );

  // ── 3. The completion ask — pass 2's deterministic half, computed from the
  // PRE-repair projection, which is where the real caller computes it.
  const ask = enumerateCompletionAsk(seam.records, seam.projection);

  // ── 4/5. Repair substeps 1 and 8, through the pipeline's own entry points.
  // A minimal context is the repo's existing convention for these two functions
  // (see tests/unit/cee.no-path-to-goal-duplicate-suppression.test.ts).
  const ctx = {
    graph: normalised,
    requestId,
    repairTrace: {},
    deterministicRepairs: [] as { code: string; path: string; action: string }[],
    input: { brief: brief ?? "", context: {} },
    request: { headers: {} },
  };
  // ⚠ `as any` and not `as unknown as StageContext`: the double cast is a
  // forbidden boundary pattern in this repo (it is the ratcheted marker for a
  // silently-drifting seam). This is a TEST/measurement harness supplying the
  // minimal context these two substeps read — the same minimal-context
  // convention the repo's own sweep tests use — not a wire boundary.
  await runDeterministicSweep(ctx as any);
  runConnectivity(ctx as any);

  const graph = ctx.graph as { nodes: ReplayNode[]; edges: unknown[] };

  // ── 6. Readiness.
  const verdict = validateGraph({
    graph: graph as Parameters<typeof validateGraph>[0]["graph"],
    requestId,
    // The replay's final read is the same question the pipeline asks after its
    // deterministic repairs, so it uses that phase label rather than minting a
    // new one — `ValidatorPhase` is a closed union and a harness has no business
    // widening a production vocabulary to name itself.
    phase: "post_sweep_authoritative",
  });

  return {
    ok: true,
    records: seam.records,
    projection: seam.projection,
    ask,
    graph,
    repairs: ctx.deterministicRepairs,
    readiness: {
      errorCodes: verdict.errors.map((e) => e.code).sort(),
      warningCodes: (verdict.warnings ?? []).map((w) => w.code).sort(),
      blocking: verdict.errors.length > 0,
    },
    semantics: measureSemanticTable(graph),
  };
}

/**
 * A stable, comparable digest of a replay — what a determinism assertion and a
 * regression diff both read.
 *
 * Excludes nothing on the grounds of noise: if a field is not stable, that is a
 * finding about the chain, not a field to hide. The one thing left out is the
 * echoed input, because comparing a replay's own input to itself proves nothing.
 */
export function replayDigest(result: ReplayResult): string {
  if (!result.ok) return JSON.stringify({ ok: false, reason: result.reason, detail: result.detail });
  return JSON.stringify({
    ok: true,
    graph: result.graph,
    repairs: result.repairs,
    readiness: result.readiness,
    semantics: result.semantics,
    ask: result.ask,
    dropped: result.projection.dropped,
  });
}
