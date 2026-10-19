/**
 * ⭐ PATH-B: THE ONE CANONICAL-CONTEXT READER (C5, 19 Oct 2026; outbox/PATH-B-DESIGN.md). One fresh read of the saved
 * scenario, used twice: as the `read_canonical_context` tool and as the runner's turn-start input. It is never served from
 * conversation history or a cache: each call reads the product's own graph route afresh.
 *
 * It carries typed facts only, never host words:
 *  · revision: the read's analysis hash, identity hash and scenario revision;
 *  · the model as stored (nodes, option settings, links) with each figure's source as the ONE authority answers it
 *    (`provenanceOf` / `authorshipOf`: origin human | ai | unknown, `accepted` kept apart from origin, the role) and each
 *    node's kept statements (speaker and verbatim quote, `recordsWithUnknownSpeakerOn`). Unknown stays unknown;
 *  · readiness: the run admission's verdict and the typed blocking codes (`resolveRunAdmission`), with no ask text;
 *  · the selected Run: its id, the hash it ran on, its currency and leader permission, and the licensed Run facts
 *    (`runFactsOf`, the packet every AI call after a Run reads).
 */
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { FRESH_READ } from '../../agent-lane/turn-read-cache.js';
import { readRunEvidence } from '../../agent-lane/run-evidence.js';
import { runFactsOf } from '../../agent-lane/run-facts.js';
import { recordsWithUnknownSpeakerOn } from '../../statement-door/statements.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { authorshipOf, provenanceOf } from '../../../cee/provenance/provenance-of.js';
import { ok, refused, unavailable, type ToolOutcome } from './outcome.js';

export const READ_CANONICAL_CONTEXT = 'read_canonical_context';
export const ReadCanonicalContextParams = z.object({}).strict();

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => v !== null && typeof v === 'object' && !Array.isArray(v);
const recs = (v: unknown): Rec[] => (Array.isArray(v) ? v.filter(isRec) : []);
const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);
const int = (v: unknown): number | null => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : null);
const bool = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null);
/** The stored fields a figure is read from, copied as stored (never converted here). */
const pick = (o: object, keys: readonly string[]): Rec => {
  const r = o as Rec;
  return Object.fromEntries(keys.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));
};

function nodeOf(n: Rec, byId: ReadonlyMap<string, Rec>): Rec {
  const observed = isRec(n.observed_state) ? n.observed_state : undefined;
  const settings = isRec(n.interventions) ? Object.entries(n.interventions).map(([factorId, cell]) => ({
    factor_id: factorId, cell, source: provenanceOf({ setting: cell, target: byId.get(factorId) }),
  })) : [];
  const statements = recordsWithUnknownSpeakerOn(n).map((r) => ({ subject_key: r.subject_key, field: r.field,
    statements: r.statements.map((s) => pick(s, ['speaker', 'quote', 'form', 'low', 'high', 'unit', 'period', 'conditions', 'qualifier', 'negated'])) }));
  return {
    ...pick(n, ['id', 'kind', 'label', 'description', 'proposed_by', 'analysis_participation', 'option_status']),
    ...(n.provenance === undefined ? {} : { added_by: authorshipOf({ nodeTag: n.provenance }) }),
    ...(observed === undefined ? {} : { observed: pick(observed, ['value', 'raw_value', 'unit', 'cap', 'range']), observed_source: provenanceOf({ value: observed }) }),
    ...(settings.length === 0 ? {} : { settings }),
    ...(statements.length === 0 ? {} : { statements }),
  };
}

function linkOf(e: Rec, byId: ReadonlyMap<string, Rec>): Rec {
  return {
    ...pick(e, ['from', 'to', 'effect_direction', 'strength', 'exists_probability']),
    source: provenanceOf({ link: e, context: { fromKind: byId.get(String(e.from))?.kind } }),
  };
}

function selectedRunOf(json: Rec, graph: Rec): Rec | null {
  const view = isRec(json.canonical_analysis_view) ? json.canonical_analysis_view : {};
  const run = isRec(view.run) ? view.run : {};
  const state = isRec(json.analysis_state) ? json.analysis_state : undefined;
  const runState = isRec(state?.run_state) ? state.run_state : undefined;
  const runId = str(run.run_id);
  if (runId === null && (runState === undefined || runState.kind === 'never_run')) return null;
  const current = runState?.kind === 'complete_current';
  const evidence = readRunEvidence(json.analysis_run_evidence);
  const analysisReady = isRec(json.current_read) ? json.current_read.analysis_ready : undefined;
  return {
    run_id: runId,
    graph_hash_at_run: str(run.graph_hash_at_run),
    stale: bool(isRec(view.staleness) ? view.staleness.stale : undefined),
    run_state: runState ?? null,
    leader_claim_permitted: bool(isRec(state?.leader_claim) ? state.leader_claim.permitted : undefined),
    facts: runFactsOf(json.analysis_result ?? null, graph, current,
      { analysisState: json.analysis_state, analysisReady, ...(evidence === undefined ? {} : { runEvidence: evidence }) }),
  };
}

/** The saved scenario as the product's graph route returns it: the FULL graph, for mutation and readback. */
export interface SavedRead {
  readonly json: Rec;
  readonly graph: Rec;
  readonly graphHash: string;
  readonly identity: string | null;
}

/** ONE fresh read of the saved scenario. The full graph stays internal; `readCanonicalContext` is the AI's view of it. */
export async function readSaved(deps: { readonly dispatch: InternalDispatch }, scenarioId: string): Promise<SavedRead | ToolOutcome> {
  let r: Awaited<ReturnType<InternalDispatch>>;
  try {
    r = await deps.dispatch(`/assist/v1/scenarios/${scenarioId}/graph`, { ...FRESH_READ });
  } catch {
    return unavailable('read_failed');
  }
  if (r.status === 404) return refused('not_found');
  if (r.status !== 200) return unavailable('read_failed', 'none', `HTTP ${r.status}`);
  const graphHash = str(r.json.graph_hash);
  if (graphHash === null || !isRec(r.json.graph)) return unavailable('read_malformed');
  const identity = isRec(r.json.graph_identity_hash) ? str(r.json.graph_identity_hash.value) : str(r.json.graph_identity_hash);
  return { json: r.json, graph: r.json.graph, graphHash, identity };
}
export const isSavedRead = (v: SavedRead | ToolOutcome): v is SavedRead => 'graphHash' in v;

/** The ONE reader's AI view: a fresh read of the saved scenario, as typed facts. Mutates nothing. */
export async function readCanonicalContext(deps: { readonly dispatch: InternalDispatch }, ctx: Pick<AgentToolContext, 'scenario_id'>): Promise<ToolOutcome> {
  const saved = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(saved)) return saved;
  const { json, graph, graphHash, identity } = saved;
  const nodes = recs(graph.nodes);
  const byId = new Map(nodes.filter((n) => typeof n.id === 'string').map((n) => [n.id as string, n]));
  const view = isRec(json.canonical_analysis_view) ? json.canonical_analysis_view : {};
  const admission = resolveRunAdmission(graph);
  return ok({
    scenario_id: ctx.scenario_id,
    revision: { graph_hash: graphHash, graph_identity_hash: identity,
      scenario_revision: int(isRec(view.staleness) ? view.staleness.revision : undefined) },
    empty: nodes.length === 0,
    nodes: nodes.map((n) => nodeOf(n, byId)),
    links: recs(graph.edges).map((e) => linkOf(e, byId)),
    readiness: {
      will_run: admission.willProceed,
      safe_to_analyse: admission.assessment.safeToAnalyse,
      blocking: admission.assessment.blockingIssues.map((i) =>
        pick(i, ['code', 'category', 'repairability', 'factor_id', 'option_id', 'obligation'])),
    },
    selected_run: selectedRunOf(json, graph),
  });
}
