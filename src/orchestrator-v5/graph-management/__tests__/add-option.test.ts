import { describe, it, expect } from 'vitest';
import { classifyProposal } from '../classify-proposal.js';
import { currentAnalysisHash } from '../base-hash-gate.js';
import { buildReadyGraph, buildReadyGraphWithTopLevelOptions } from './fixtures.js';
import {
  OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE,
  ADD_OPTION_APPLY_UNWIRED,
  OPTION_ID_COLLISION,
} from '../proposal-types.js';
import type { AddOptionProposal, AddOptionInterventionSpec } from '../proposal-types.js';

function addOption(
  baseHash: string | null,
  opts: { id?: string; interventions?: Record<string, AddOptionInterventionSpec> } = {},
): AddOptionProposal {
  return {
    kind: 'add_option',
    base_graph_hash: baseHash,
    option: {
      id: opts.id ?? 'o-c',
      label: 'Plan C',
      parent_decision_id: 'd-choice',
      edges: [{ to_factor_id: 'f-spend' }],
      ...(opts.interventions ? { interventions: opts.interventions } : {}),
    },
  };
}

describe('add_option — never would_apply (held with an accurate reason, or stale)', () => {
  it('NO top-level options[] -> held ADD_OPTION_APPLY_UNWIRED (no divergence is claimed)', () => {
    const graph = buildReadyGraph(); // node-only options; no top-level options[]
    const r = classifyProposal(addOption(currentAnalysisHash(graph), { interventions: { 'f-spend': { value: 0.5 } } }), graph);

    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(ADD_OPTION_APPLY_UNWIRED);

    // The option exists as a node, and EP2 (node-derived, like run-analysis) reads
    // it as ready — yet the spike still holds (apply path not built). No false positive.
    const cand = r.candidate as { nodes: Array<{ id: string; kind: string }> };
    expect(cand.nodes.some((n) => n.id === 'o-c' && n.kind === 'option')).toBe(true);
    expect(['ready', 'repaired_for_analysis']).toContain(r.ep2_state);
  });

  it('WITH top-level options[] -> held OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE (real split state)', () => {
    const graph = buildReadyGraphWithTopLevelOptions();
    const r = classifyProposal(addOption(currentAnalysisHash(graph), { interventions: { 'f-spend': { value: 0.5 } } }), graph);

    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE);
    expect(['ready', 'repaired_for_analysis']).toContain(r.ep2_state);
  });

  it('held (unwired) when interventions are missing', () => {
    const graph = buildReadyGraph();
    const r = classifyProposal(addOption(currentAnalysisHash(graph)), graph);
    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(ADD_OPTION_APPLY_UNWIRED);
  });

  it('never returns would_apply for add_option (with or without top-level options[])', () => {
    for (const graph of [buildReadyGraph(), buildReadyGraphWithTopLevelOptions()]) {
      const baseHash = currentAnalysisHash(graph);
      for (const interventions of [undefined, { 'f-spend': { value: 0.5 } }, { 'f-spend': { raw_value: 999 } }]) {
        const r = classifyProposal(addOption(baseHash, { interventions }), graph);
        expect(r.verdict).not.toBe('would_apply');
      }
    }
  });

  it('P1 regression: reusing an existing option id is HELD (id collision), never would_apply', () => {
    const graph = buildReadyGraphWithTopLevelOptions();
    const r = classifyProposal(addOption(currentAnalysisHash(graph), { id: 'o-a' }), graph);
    expect(r.verdict).toBe('held');
    expect(r.verdict).not.toBe('would_apply');
    expect(r.blocker?.code).toBe(OPTION_ID_COLLISION);
  });

  it('a stale add_option returns `stale` (INV-1 applies to every kind), never would_apply', () => {
    const graph = buildReadyGraphWithTopLevelOptions();
    const r = classifyProposal(addOption('deadbeef-not-matching'), graph);
    expect(r.verdict).toBe('stale');
    expect(r.verdict).not.toBe('would_apply');
  });

  it('same id in top-level options[] with DIFFERENT content still DIVERGES (id equality != content convergence)', () => {
    // Reviewer's case: top-level options[] o-c = "Old plan" (value 0.1); proposal adds
    // node o-c = "Plan C" (value 0.5). The merge keeps the old options[] entry AND adds
    // the new node -> the two views disagree. Must NOT be claimed convergent/unwired.
    const base = buildReadyGraph();
    const graph = {
      ...base,
      options: [{ id: 'o-c', label: 'Old plan', status: 'ready', interventions: { 'f-spend': { value: 0.1 } } }],
    };
    const r = classifyProposal(
      addOption(currentAnalysisHash(graph), { interventions: { 'f-spend': { value: 0.5 } } }),
      graph,
    );
    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE);
  });

  it('an EMPTY top-level options[] still DIVERGES (context-pack reads [] = 0; run-analysis reads the option nodes)', () => {
    const base = buildReadyGraph();
    const graph = { ...base, options: [] as unknown[] };
    const r = classifyProposal(
      addOption(currentAnalysisHash(graph), { interventions: { 'f-spend': { value: 0.5 } } }),
      graph,
    );
    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(OPTION_TOP_LEVEL_OPTIONS_DIVERGENCE);
  });

  it('a non-array (malformed) `options` is treated as no options[] array -> ADD_OPTION_APPLY_UNWIRED', () => {
    const base = buildReadyGraph();
    const graph = { ...base, options: { not: 'an array' } };
    const r = classifyProposal(
      addOption(currentAnalysisHash(graph), { interventions: { 'f-spend': { value: 0.5 } } }),
      graph,
    );
    expect(r.verdict).toBe('held');
    expect(r.blocker?.code).toBe(ADD_OPTION_APPLY_UNWIRED);
  });
});
