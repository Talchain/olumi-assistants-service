/**
 * A spec's own per-event fake product, presented as the whole-scope level port (`CommitOptionLevelsInput`), for specs
 * whose subject is NOT atomicity: each link, then each level, goes to the fake as today's typed event
 * (`structural_add_edge`, `option_intervention_edit`), CAS-chained on the revision the previous one reported.
 *
 * ⚠ NOT ATOMIC: a refusal part-way leaves the fake's earlier commits in place. The port's all-or-nothing contract is
 * asserted by `whole-request-is-one-commit.test.ts` against a fake that commits the whole scope at once.
 */
import { createAgentCapabilities, receiptSummaryOf, type InternalDispatch } from '../../runtime/agent-capabilities.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../../system-events/dispatch.js';
import { runWithApprovedAdoption, runWithApprovedLevelAdoption } from '../../approved-adoption-context.js';
import { applyFactorValueEdit } from '../../../system-events/factor-value-edit.js';

/** The level a per-event write's own committed post-state (`draft_graph`) holds for the pair, if it says. */
function committedLevelOf(json: Record<string, unknown>, optionId: string, factorId: string): number | undefined {
  const nodes = ((json.draft_graph ?? {}) as { nodes?: unknown }).nodes;
  if (!Array.isArray(nodes)) return undefined;
  const iv = (nodes.find((n) => (n as { id?: unknown }).id === optionId) as { interventions?: Record<string, unknown> } | undefined)?.interventions?.[factorId];
  const v = typeof iv === 'number' ? iv : (iv as { value?: unknown } | undefined)?.value;
  return typeof v === 'number' ? v : undefined;
}

export function levelsPortOver(d: InternalDispatch): (input: CommitOptionLevelsInput) => Promise<CommitOptionLevelsResult> {
  return async (input) => {
    let base = input.base_graph_hash;
    let last: Record<string, unknown> = {};
    const send = (i: string, event: Record<string, unknown>) => d('/orchestrate/v2/turn', {
      kind: 'system_event', turn_id: `${input.turn_id}#${i}`, scenario_id: input.scenario_id, stage: 'frame', event: { ...event, base_graph_hash: base },
    });
    /**
     * A compound's values and ranges (the door, CEE #2031, applies them in the SAME commit). This fake applies them as the
     * door does — the canonical value writer, the factor's range, the adoption authority for Olumi's — and persists them
     * through the product's own whole-graph write BEFORE the links and levels. Not atomic, like the rest of this fake:
     * atomicity is pinned against the REAL door in `tests/integration/orchestrator/agent-compound-is-one-commit.test.ts`.
     */
    if ((input.values?.length ?? 0) + (input.frames?.length ?? 0) > 0) {
      const read = await d(`/assist/v1/scenarios/${input.scenario_id}/graph`, {});
      let working = (read.json.graph ?? {}) as { nodes: { id: string; kind?: string; observed_state?: Record<string, unknown> }[] };
      for (const v of input.values ?? []) {
        const node = working.nodes.find((n) => n.id === v.factor_id);
        const cap = typeof node?.observed_state?.cap === 'number' && (node.observed_state.cap as number) > 0 ? node.observed_state.cap as number : undefined;
        const event = { kind: 'factor_value_edit' as const, target_id: v.factor_id,
          ...(cap !== undefined ? { value: v.value / cap, raw_value: v.value } : { value: v.value }), ...(v.unit !== undefined ? { unit: v.unit } : {}) };
        const write = () => applyFactorValueEdit({
          payload: { kind: 'system_event', turn_id: input.turn_id, scenario_id: input.scenario_id, stage: 'frame', event } as never,
          event: event as never, requestId: 'levels-port-fake', persistedGraph: working, priorFacts: [],
        });
        const res = v.author === 'model_proposed'
          ? await runWithApprovedAdoption({ scenarioId: input.scenario_id, proposalId: input.turn_id, targetId: v.factor_id, rawValue: v.value }, write)
          : await write();
        if (res.kind !== 'mutated') return { status: 'refused', reason: `value_${res.reason}`, value: { factor_id: v.factor_id } };
        working = res.mutatedGraph as typeof working;
      }
      for (const f of input.frames ?? []) {
        working = { ...working, nodes: working.nodes.map((n) => {
          if (n.id !== f.factor_id) return n;
          const os = (n.observed_state ?? {}) as { value?: number; raw_value?: number };
          const raw = typeof os.raw_value === 'number' ? os.raw_value : os.value;
          return typeof raw !== 'number' ? n : { ...n, observed_state: { ...os, value: raw / f.cap, raw_value: raw, cap: f.cap, declared_scale: 'unit_interval' } };
        }) };
      }
      const reg = await d(`/assist/v1/scenarios/${input.scenario_id}/graph/register`, { graph: working, expected_graph_hash: base });
      if (reg.status === 409) return { status: 'stale' };
      if (reg.status !== 200) return { status: 'refused', reason: `http ${reg.status}` };
      // The revision the write itself reports (as the door's commit carries its own); a read only when it reports none.
      const reported = reg.json.graph_hash;
      if (typeof reported === 'string' && reported !== '') base = reported;
      else {
        const after = await d(`/assist/v1/scenarios/${input.scenario_id}/graph`, {});
        if (typeof after.json.graph_hash === 'string' && after.json.graph_hash !== '') base = after.json.graph_hash;
      }
      last = reg.json;
    }
    for (const [i, k] of input.links.entries()) {
      const r = await send(`link${i}`, { kind: 'structural_add_edge', from: k.option_id, to: k.factor_id, magnitude: 0.5, effect_direction: 'positive' });
      if (r.status === 409) return { status: 'stale' };
      const h = r.json.graph_hash;
      if (r.status !== 200 || typeof h !== 'string' || h === '') return { status: 'refused', reason: `http ${r.status}`, pair: k };
      base = h;
      last = r.json;
    }
    const committed_levels: { option_id: string; factor_id: string; value: number }[] = [];
    for (const [i, l] of input.levels.entries()) {
      // The per-event product stamps an Olumi-authored level from the approved adoption in context, as it did before the port.
      const write = () => send(`level${i}`, { kind: 'option_intervention_edit', option_id: l.option_id, factor_id: l.factor_id, value: l.value });
      const r = l.author === 'model_proposed'
        ? await runWithApprovedLevelAdoption({ scenarioId: input.scenario_id, proposalId: input.turn_id, optionId: l.option_id, factorId: l.factor_id, modelValue: l.value }, write)
        : await write();
      if (r.status === 409) return { status: 'stale' };
      if (r.status !== 200) return { status: 'refused', reason: `http ${r.status}`, pair: { option_id: l.option_id, factor_id: l.factor_id } };
      const h = r.json.graph_hash;
      if (typeof h === 'string' && h !== '') { base = h; last = r.json; }
      const stored = committedLevelOf(r.json, l.option_id, l.factor_id);
      if (stored !== undefined) committed_levels.push({ option_id: l.option_id, factor_id: l.factor_id, value: stored });
    }
    const receipt = receiptSummaryOf(last).summary ?? { version: 0, version_id: '', mutation_id: '', source_turn_id: input.turn_id };
    return { status: 'committed', graph_hash: base, receipt, already_applied: false, committed_levels };
  };
}

/**
 * `createAgentCapabilities` with the spec's own fake behind the level port — a drop-in for specs written before the
 * port existed. An explicit `opts.commitOptionLevels` wins.
 */
export const createAgentCapabilitiesWithLevelsPort: typeof createAgentCapabilities = (dispatch, proposals, callStructured, mode, onAnalysis, opts = {}) =>
  createAgentCapabilities(dispatch, proposals, callStructured, mode, onAnalysis, { commitOptionLevels: levelsPortOver(dispatch), ...opts });
