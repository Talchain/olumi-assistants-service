/**
 * ⭐ PATH-B: THE ONE CANONICAL-CONTEXT READER (C5, 19 Oct 2026; outbox/PATH-B-DESIGN.md). One fresh read of the saved
 * scenario, used twice: as the `read_canonical_context` tool and as the runner's turn-start input. It is never served from
 * conversation history or a cache: each call reads the product's own graph route afresh.
 *
 * It carries typed facts only, never host words:
 *  · revision: the read's analysis hash, identity hash and scenario revision;
 *  · a core scenario's living model as saved, with what its engine graph withholds and why (`livingViewOf`); it IS the
 *    meaning, so the readers below are not run on it. Otherwise:
 *  · the model as stored (nodes, option settings, links) with each figure's source as the ONE authority answers it
 *    (`provenanceOf` / `authorshipOf`: origin human | ai | unknown, `accepted` kept apart from origin, the role) and each
 *    node's kept claims (who said it and the verbatim quote, `claimRecordsOn`, the one claim reader since #3427). Unknown stays unknown; a person's
 *    figure whose role is unverified says what its carrier does not record (`observed_not_recorded`);
 *  · readiness: the run admission's verdict and the typed blocking codes (`resolveRunAdmission`), with no ask text;
 *  · the selected Run: its id, the hash it ran on, its currency and leader permission, and the licensed Run facts
 *    (`runFactsOf`, the packet every AI call after a Run reads).
 */
import { linkDefaultAssumptionsOf } from '../../../cee/magnitude/link-default-assumptions.js';
import { z } from 'zod-v4';
import type { AgentToolContext } from '../../agent-lane/runtime/agent-tools.js';
import type { InternalDispatch } from '../../agent-lane/runtime/agent-capabilities.js';
import { isNoModelYet, isSavedRead, readSaved, type SavedRead } from '../../model-program-turn/saved-read.js';
import { readRunEvidence } from '../../agent-lane/run-evidence.js';
import { runFactsOf } from '../../agent-lane/run-facts.js';
import { claimRecordsOn } from '../../statement-door/statements.js';
import { resolveRunAdmission } from '../../tools/handlers/analysis-ready-core.js';
import { authorshipOf, provenanceOf } from '../../../cee/provenance/provenance-of.js';
import { ok, type ToolOutcome } from './outcome.js';
import { livingViewOf } from '../living-model/view.js';

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
  const observedSource = observed === undefined ? undefined : provenanceOf({ value: observed });
  const statements = claimRecordsOn(n).map((r) => ({ subject_key: r.subject_key, field: r.field,
    ...(r.history?.some((s) => s.form === 'range') ? { history: r.history } : {}),
    statements: r.statements.map((s) => s.form === 'range' ? s : pick(s, ['speaker', 'said_by', 'party', 'relayed_by', 'quote', 'form', 'low', 'high', 'unit', 'period', 'conditions', 'qualifier', 'negated', 'stance', 'status'])) }));
  return {
    ...pick(n, ['id', 'kind', 'label', 'description', 'proposed_by', 'analysis_participation', 'option_status']),
    ...(n.provenance === undefined ? {} : { added_by: authorshipOf({ nodeTag: n.provenance }) }),
    ...(observed === undefined ? {} : { observed: pick(observed, ['value', 'raw_value', 'unit', 'cap', 'range']), observed_source: observedSource,
      // A person's figure whose role is unverified: its carrier keeps neither who said it, their words, nor how they put it
      // forward (PL AMEND 15:35; AIE stance 15:54).
      ...(observedSource?.origin === 'human' && observedSource.role === 'unverified' ? { observed_not_recorded: ['speaker', 'words', 'stance'] } : {}) }),
    ...(settings.length === 0 ? {} : { settings }),
    ...(statements.length === 0 ? {} : { statements }),
  };
}

function linkOf(e: Rec, byId: ReadonlyMap<string, Rec>): Rec {
  const defaults = linkDefaultAssumptionsOf(e);
  return {
    ...pick(e, ['from', 'to', 'effect_direction', 'strength', 'exists_probability']),
    ...(defaults.length === 0 ? {} : { default_assumptions: defaults }),
    ...(isRec(e.provenance) ? { point_source: pick(e.provenance, ['source_quote', 'natural_effect']) } : {}),
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
    inputs_used: evidence?.runId === runId ? evidence?.inputSnapshot ?? null : null,
    graph_hash_at_run: str(run.graph_hash_at_run),
    stale: bool(isRec(view.staleness) ? view.staleness.stale : undefined),
    run_state: runState ?? null,
    leader_claim_permitted: bool(isRec(state?.leader_claim) ? state.leader_claim.permitted : undefined),
    facts: runFactsOf(json.analysis_result ?? null, graph, current,
      { analysisState: json.analysis_state, analysisReady, selectedRunId: runId, ...(evidence === undefined ? {} : { runEvidence: evidence }),
        impliedQuantity: json.analysis_implied_quantity }),
  };
}

export { readSaved, isSavedRead, NO_MODEL_YET, isNoModelYet, type SavedRead } from '../../model-program-turn/saved-read.js';
const NO_MODEL: Pick<SavedRead, 'json' | 'graph'> & { readonly graphHash: null; readonly identity: null } = { json: {}, graph: { nodes: [], edges: [] }, graphHash: null, identity: null };

/** The ONE reader's AI view: a fresh read of the saved scenario, as typed facts. Mutates nothing. */
export async function readCanonicalContext(deps: { readonly dispatch: InternalDispatch }, ctx: Pick<AgentToolContext, 'scenario_id'>): Promise<ToolOutcome> {
  const saved = await readSaved(deps, ctx.scenario_id);
  if (!isSavedRead(saved) && !isNoModelYet(saved)) return saved;
  // No model yet: the same view of an empty model, revision none.
  const { json, graph, graphHash, identity } = isSavedRead(saved) ? saved : NO_MODEL;
  const nodes = recs(graph.nodes);
  const byId = new Map(nodes.filter((n) => typeof n.id === 'string').map((n) => [n.id as string, n]));
  const view = isRec(json.canonical_analysis_view) ? json.canonical_analysis_view : {};
  const admission = resolveRunAdmission(graph);
  const living = livingViewOf(graph);
  return ok({
    scenario_id: ctx.scenario_id,
    revision: { graph_hash: graphHash, graph_identity_hash: identity,
      scenario_revision: int(isRec(view.staleness) ? view.staleness.revision : undefined) },
    empty: nodes.length === 0,
    ...(living ?? { nodes: nodes.map((n) => nodeOf(n, byId)), links: recs(graph.edges).map((e) => linkOf(e, byId)) }),
    readiness: {
      will_run: admission.willProceed,
      safe_to_analyse: admission.assessment.safeToAnalyse,
      blocking: admission.assessment.blockingIssues.map((i) =>
        pick(i, ['code', 'category', 'repairability', 'factor_id', 'option_id', 'obligation'])),
    },
    selected_run: selectedRunOf(json, graph),
  });
}
