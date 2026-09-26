/**
 * A defensive, typed VIEW over one captured Agent-lane response (`/proxy/v5/turn`
 * → `agent_lane_v1`), exactly as the construction witness recorded it.
 *
 * Nothing here interprets text. It only lifts the fields the scorer needs off
 * the wire, tolerating absence (older builds omit fields; a 502 has no body).
 * Every field the capture does NOT carry stays `null` — never defaulted to a
 * value a check could mistake for evidence.
 *
 * ⚠ What a capture does NOT contain (and so what no check may assume):
 *   - the model's raw output (the server strips completion claims and rewrites
 *     proposal ids before this text exists);
 *   - the model's inputs (instructions, history, tool RESULTS). `_agent.tool_calls`
 *     carries only {name, ok, mutated, refusal} — not what a tool returned.
 */

export interface ToolCallView {
  readonly name: string;
  readonly ok: boolean | null;
  readonly mutated: boolean | null;
  readonly refusal: string | null;
  /** Runtime PR-B puts claim permissions on run/first-analysis RESULTS. Read only if a wire ever carries them here. */
  readonly leaderMayBeNamed: boolean | null;
}

export interface ChipView {
  readonly id: string;
  readonly label: string;
  readonly actionType: string | null;
}

export interface ObservedStateView {
  readonly unit: string | null;
  readonly value: number | null;
  readonly rawValue: number | null;
  readonly source: string | null;
}

export interface GraphNodeView {
  readonly id: string;
  readonly kind: string;
  readonly label: string;
  readonly provenance: string | null;
  readonly displayValue: string | null;
  readonly observed: ObservedStateView | null;
}

/** One option's level on one factor, joined from draft_graph (source) and analysis_ready (raw value, unit). */
export interface OptionLevelView {
  readonly optionId: string;
  readonly optionLabel: string;
  readonly factorId: string;
  readonly factorLabel: string | null;
  readonly source: string | null;
  readonly rawValue: number | null;
  readonly unit: string | null;
}

export interface LeaderClaimView {
  readonly permitted: boolean | null;
  readonly withheldReason: string | null;
  readonly separation: string | null;
}

export interface ReplyView {
  readonly http: number | null;
  /** `assistant_text` exactly as served — the FINAL user-visible reply. */
  readonly text: string;
  readonly hasBody: boolean;
  readonly chips: readonly ChipView[];
  readonly toolCalls: readonly ToolCallView[];
  readonly agentMutated: boolean | null;
  readonly exitPath: string | null;
  readonly fastPath: string | null;
  readonly replayed: boolean;
  /** Provider calls recorded on the wire (`_provider_calls`), or null when the field is absent. */
  readonly providerCalls: number | null;
  /** Forwarded-path (`agent_lane_forwarded`) LLM calls from the trace, or null when absent. */
  readonly forwardedLlmCalls: number | null;
  /** Completion-claim sentences the server removed from the model text (trace), or null when absent. */
  readonly writeClaimsRemoved: number | null;
  readonly leaderClaim: LeaderClaimView | null;
  readonly permittedAnalysisMode: string | null;
  readonly runStateKind: string | null;
  readonly runStateCause: string | null;
  readonly robustnessLevel: string | null;
  readonly nearTie: boolean | null;
  readonly hasAnalysisResult: boolean;
  readonly hasGraphPatch: boolean;
  readonly blockSummary: string | null;
  readonly graphHash: string | null;
  readonly nodes: readonly GraphNodeView[];
  readonly optionLabels: readonly string[];
  readonly optionLevels: readonly OptionLevelView[];
  /** Trace evidence that a server-run first analysis happened this turn (Runtime PR-B), or null when absent. */
  readonly firstAnalysisRan: boolean | null;
}

type Rec = Record<string, unknown>;

const rec = (v: unknown): Rec | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);

function observedOf(v: unknown): ObservedStateView | null {
  const o = rec(v);
  if (o === null) return null;
  return { unit: str(o.unit), value: num(o.value), rawValue: num(o.raw_value), source: str(o.source) };
}

function nodesOf(draftGraph: unknown): GraphNodeView[] {
  return arr(rec(draftGraph)?.nodes)
    .map(rec)
    .filter((n): n is Rec => n !== null && typeof n.label === 'string')
    .map((n) => ({
      id: String(n.id ?? ''),
      kind: String(n.kind ?? ''),
      label: String(n.label),
      provenance: str(n.provenance),
      displayValue: str(n.display_value),
      observed: observedOf(n.observed_state),
    }));
}

function optionLevelsOf(draftGraph: unknown, analysisReady: unknown, nodes: readonly GraphNodeView[]): OptionLevelView[] {
  const labelOf = new Map(nodes.map((n) => [n.id, n.label]));
  const readyOptions = new Map(
    arr(rec(analysisReady)?.options)
      .map(rec)
      .filter((o): o is Rec => o !== null)
      .map((o) => [String(o.option_id ?? ''), rec(o.intervention_details)] as const),
  );
  const out: OptionLevelView[] = [];
  for (const n of arr(rec(draftGraph)?.nodes).map(rec)) {
    if (n === null || n.kind !== 'option') continue;
    const optionId = String(n.id ?? '');
    const interventions = rec(n.interventions);
    if (interventions === null) continue;
    const details = readyOptions.get(optionId) ?? null;
    for (const [factorId, cell] of Object.entries(interventions)) {
      const c = rec(cell);
      const d = rec(details?.[factorId]);
      out.push({
        optionId,
        optionLabel: String(n.label ?? ''),
        factorId,
        factorLabel: labelOf.get(factorId) ?? null,
        source: str(c?.source),
        rawValue: num(d?.raw_value),
        unit: str(d?.unit),
      });
    }
  }
  return out;
}

export function viewOf(wire: unknown, http: number | null = null): ReplyView {
  const w = rec(wire) ?? {};
  const hasBody = rec(wire) !== null;
  const agent = rec(w._agent);
  const trace = rec(w._diagnostic_trace);
  const state = rec(w.analysis_state);
  const ready = rec(w.analysis_ready);
  const claim = rec(state?.leader_claim);
  const blocks = arr(w.blocks).map(rec).filter((b): b is Rec => b !== null);
  const result = blocks.find((b) => b.type === 'analysis_result') ?? null;
  const enrichment = rec(result?.enrichment);
  const blockRobustness = rec(enrichment?.robustness);
  const stateRobustness = rec(state?.robustness);
  const nodes = nodesOf(w.draft_graph);
  const firstAnalysis = rec(trace?.first_analysis);
  const llmCalls = trace?.llm_calls;
  return {
    http,
    text: typeof w.assistant_text === 'string' ? w.assistant_text : '',
    hasBody,
    chips: arr(w.suggested_actions)
      .map(rec)
      .filter((c): c is Rec => c !== null)
      .map((c) => ({ id: String(c.id ?? ''), label: String(c.label ?? ''), actionType: str(c.action_type) })),
    toolCalls: arr(agent?.tool_calls)
      .map(rec)
      .filter((t): t is Rec => t !== null)
      .map((t) => ({
        name: String(t.name ?? ''),
        ok: bool(t.ok),
        mutated: bool(t.mutated),
        refusal: str(t.refusal),
        leaderMayBeNamed: bool(rec(t.claim_permissions)?.leader_may_be_named),
      })),
    agentMutated: bool(agent?.mutated),
    exitPath: str(trace?.exit_path),
    fastPath: str(trace?.fast_path),
    replayed: trace?.replayed === true,
    providerCalls: Array.isArray(w._provider_calls) ? w._provider_calls.length : null,
    forwardedLlmCalls: Array.isArray(llmCalls) ? llmCalls.length : num(llmCalls),
    writeClaimsRemoved: num(trace?.write_claims_removed),
    leaderClaim:
      claim === null
        ? null
        : { permitted: bool(claim.permitted), withheldReason: str(claim.withheld_reason), separation: str(claim.separation) },
    permittedAnalysisMode: str(rec(ready?.analysis_admission)?.permitted_analysis_mode),
    runStateKind: str(rec(state?.run_state)?.kind),
    runStateCause: str(rec(state?.run_state)?.cause),
    robustnessLevel: str(blockRobustness?.level) ?? str(stateRobustness?.aggregate_level),
    nearTie: bool(rec(blockRobustness?.near_tie)?.is_tie),
    hasAnalysisResult: result !== null,
    hasGraphPatch: blocks.some((b) => b.type === 'graph_patch'),
    blockSummary: str(result?.summary),
    graphHash: str(w.graph_hash),
    nodes,
    optionLabels: nodes.filter((n) => n.kind === 'option').map((n) => n.label),
    optionLevels: optionLevelsOf(w.draft_graph, w.analysis_ready, nodes),
    firstAnalysisRan: firstAnalysis === null ? null : bool(firstAnalysis.ran),
  };
}

/**
 * An analysis RESULT was produced this turn: a run tool succeeded AND the response carries
 * a result. A blocked run also returns `ok: true` (the tool answered; the analysis did not
 * run), so the tool call alone is not evidence of a run.
 */
export function ranAnalysisThisTurn(v: ReplyView): boolean {
  const attempted =
    v.toolCalls.some((t) => (t.name === 'run_analysis' || t.name === 'first_analysis') && t.ok === true) || v.firstAnalysisRan === true;
  return attempted && (v.hasAnalysisResult || v.runStateKind === 'complete_current');
}

/** A run was requested this turn but produced no result (blocked / refused). */
export function runBlockedThisTurn(v: ReplyView): boolean {
  const requested = v.toolCalls.some((t) => t.name === 'run_analysis');
  if (v.runStateKind === 'blocked') return true;
  return requested && !v.hasAnalysisResult;
}
