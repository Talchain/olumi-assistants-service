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
import { runWithApprovedLevelAdoption } from '../../approved-adoption-context.js';

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
