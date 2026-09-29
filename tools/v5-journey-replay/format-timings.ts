/**
 * V5 latency observability — evidence row formatter for the optional
 * `_timings` block returned by the server when `V5_TIMING_DEBUG=true`.
 *
 * The block is additive — defined in
 * `src/orchestrator-v5/telemetry/turn-timings.ts`. When absent, this
 * formatter returns an empty string so legacy runs render unchanged.
 *
 * Output is a single space-separated key=value fragment that is appended
 * to the existing evidence string, e.g.:
 *
 *   timings={total:6123,ctx:84,ctx_pack:12,routing:5230,handler:104,commit:642,
 *            cache:hit,llm_calls:1} plot={req:7820,status:computed,cold:false}
 *            draft={total:51812,parse:32144,parse_llm:31870,enrich:1023,
 *                   repair:6311,repair_fired:true,boundary:84}
 *
 * The compact key naming intentionally diverges from the wire schema to
 * keep evidence rows under the markdown-column character budget. Full
 * fidelity remains in the `_timings` JSON on the response body itself.
 */

import type { TurnResponse } from './types.js';

interface AnyTimings {
  turn?: Record<string, unknown>;
  draft_graph?: Record<string, unknown>;
  run_analysis?: Record<string, unknown>;
}

function extractTimings(body: TurnResponse | undefined): AnyTimings | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const raw = (body as Record<string, unknown>)._timings;
  if (!raw || typeof raw !== 'object') return undefined;
  return raw as AnyTimings;
}

function num(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? String(Math.round(value)) : undefined;
}

function pair(key: string, value: unknown): string | undefined {
  const v = num(value);
  return v === undefined ? undefined : `${key}:${v}`;
}

function pairString(key: string, value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length === 0) return undefined;
  return `${key}:${value}`;
}

function pairBool(key: string, value: unknown): string | undefined {
  if (typeof value !== 'boolean') return undefined;
  return `${key}:${value}`;
}

function joinBlock(label: string, parts: ReadonlyArray<string | undefined>): string | undefined {
  const filtered = parts.filter((p): p is string => p !== undefined);
  if (filtered.length === 0) return undefined;
  return `${label}={${filtered.join(',')}}`;
}

function formatTurn(turn: Record<string, unknown> | undefined): string | undefined {
  if (!turn) return undefined;
  return joinBlock('timings', [
    pair('total', turn.total_ms),
    pair('ctx', turn.build_turn_context_ms),
    pair('ctx_pack', turn.context_pack_assembly_ms),
    pair('ctx_chars', turn.context_pack_chars),
    pair('routing', turn.routing_llm_ms),
    pair('handler', turn.handler_execute_ms),
    pair('compose', turn.compose_ms),
    pair('commit', turn.commit_ms),
    pairString('handler_id', turn.handler_id),
    pairString('cache', turn.routing_cache),
    pair('cache_read_tokens', turn.cache_read_input_tokens),
    pair('cache_create_tokens', turn.cache_creation_input_tokens),
    pair('input_tokens', turn.total_input_tokens),
    pair('llm_calls', turn.llm_calls_used),
  ]);
}

function formatPlot(plot: Record<string, unknown> | undefined): string | undefined {
  if (!plot) return undefined;
  return joinBlock('plot', [
    pair('handler_total', plot.handler_total_ms),
    pair('req', plot.plot_request_ms),
    pairString('status', plot.plot_status),
    // Renamed from `plot_cold_likely` (review fix round 2). Field rendered
    // as `slow:` in evidence rows to match the wire schema and avoid the
    // false-precision implication of "cold". Reading from the wire field
    // name is the contract — the row label is a separate readability choice.
    pairBool('slow', plot.plot_slow_likely),
  ]);
}

function formatDraft(draft: Record<string, unknown> | undefined): string | undefined {
  if (!draft) return undefined;
  return joinBlock('draft', [
    pair('total', draft.total_ms),
    pair('parse', draft.parse_ms),
    pair('parse_llm', draft.parse_llm_ms),
    pair('normalise', draft.normalise_ms),
    pair('enrich', draft.enrich_ms),
    pair('repair', draft.repair_ms),
    pairBool('repair_fired', draft.repair_fired),
    pair('repair_attempts', draft.repair_attempts),
    pairString('repair_reason', draft.repair_reason),
    pair('validation', draft.validation_pipeline_ms),
    pair('threshold', draft.threshold_sweep_ms),
    pair('package', draft.package_ms),
    pair('boundary', draft.boundary_ms),
  ]);
}

export function formatTimingsEvidence(body: TurnResponse | undefined): string {
  const timings = extractTimings(body);
  if (!timings) return '';
  const fragments = [
    formatTurn(timings.turn),
    formatPlot(timings.run_analysis),
    formatDraft(timings.draft_graph),
  ].filter((f): f is string => Boolean(f));
  if (fragments.length === 0) return '';
  return fragments.join(' ');
}
