/**
 * ⛔ AN OPTION OLUMI PROPOSED IS NOT COMPARED AS THE USER'S (DL 5887510885; `olumi-option-filter.ts`).
 *
 * The Run's post-gate filter: Olumi's options (MG's typed mark, read on the persisted graph) leave the submission when at
 * least 2 distinct user interventions remain; otherwise they stay provisional. It can never create a refusal.
 */
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { filterOlumiProposedOptions } from '../olumi-option-filter.js';
import { gateAnalysableOptions } from '../analysable-option-gate.js';

type Rec = Record<string, unknown>;
const opt = (id: string, value = 1): Rec => ({ option_id: id, label: id, interventions: { f: value } });
const node = (id: string, proposed = false): Rec => ({ id, kind: 'option', label: id, ...(proposed ? { proposed_by: 'olumi' } : {}) });
const graphOf = (...nodes: Rec[]): Rec => ({ nodes: [{ id: 'dec', kind: 'decision' }, ...nodes], edges: [] });

describe('filterOlumiProposedOptions', () => {
  it('≥2 distinct user options remain → Olumi leaves the submission', () => {
    const r = filterOlumiProposedOptions({
      submitted: [opt('raise_59'), opt('keep_49', 2), opt('phased', 3)],
      graph: graphOf(node('raise_59'), node('keep_49'), node('phased', true)),
    });
    expect(r.options.map((o) => o.option_id)).toEqual(['raise_59', 'keep_49']);
    expect(r.keptOlumiProvisional).toBe(false);
  });

  it('the served W3 held baseline and user price change remain the submitted comparison', () => {
    const served = JSON.parse(readFileSync(new URL(
      '../../../agent-lane/__tests__/fixtures/served-w3-520aab46-cold-read-f074916.json', import.meta.url,
    ), 'utf8')) as { graph: { nodes: Rec[]; edges: Rec[] } };
    const graph = served.graph;
    const options = graph.nodes.filter((n) => n.kind === 'option');
    const gate = gateAnalysableOptions({ options, graph, rawPersistedGraph: graph, scaleNetEnabled: true });
    expect(gate.held.map((h) => h.option_id)).toEqual(['keep_49_price']);
    const filtered = filterOlumiProposedOptions({ submitted: gate.options, graph });
    expect(filtered.options.map((o) => o.option_id ?? o.id)).toEqual(['raise_to_59', 'keep_49_price']);
    expect(filtered.keptOlumiProvisional).toBe(false);
  });

  it('the status quo is the user\'s option: it counts towards the 2', () => {
    const r = filterOlumiProposedOptions({
      submitted: [opt('status_quo'), opt('raise_59', 2), opt('phased', 3)],
      graph: graphOf({ ...node('status_quo'), is_status_quo: true }, node('raise_59'), node('phased', true)),
    });
    expect(r.options.map((o) => o.option_id)).toEqual(['status_quo', 'raise_59']);
  });

  it('<2 submitted user options → Olumi stays provisional', () => {
    const submitted = [opt('raise_59'), opt('phased')];
    const r = filterOlumiProposedOptions({
      submitted,
      graph: graphOf(node('raise_59'), node('keep_49'), node('phased', true)),
    });
    expect(r.options).toBe(submitted);
    expect(r.keptOlumiProvisional).toBe(true);
  });

  it('two user labels with one PLoT-equivalent intervention map do not evict a distinct Olumi comparison', () => {
    const submitted = [opt('user_a', 1), opt('user_b', 1), opt('olumi_c', 2)];
    const r = filterOlumiProposedOptions({
      submitted,
      graph: graphOf(node('user_a'), node('user_b'), node('olumi_c', true)),
    });
    expect(r.options).toBe(submitted);
    expect(r.keptOlumiProvisional).toBe(true);
  });

  it('<2 user options because the brief named only one → Olumi stays provisional', () => {
    const r = filterOlumiProposedOptions({
      submitted: [opt('raise_59'), opt('phased'), opt('tiered')],
      graph: graphOf(node('raise_59'), node('phased', true), node('tiered', true)),
    });
    expect(r.options.map((o) => o.option_id)).toEqual(['raise_59', 'phased', 'tiered']);
    expect(r.keptOlumiProvisional).toBe(true);
  });

  it('a marked option absent from the submission does not affect the submitted pair', () => {
    const r = filterOlumiProposedOptions({
      submitted: [opt('raise_59'), opt('keep_49', 2)],
      graph: graphOf(node('raise_59'), node('keep_49'), node('tiered', true)),
    });
    expect(r.options.map((o) => o.option_id)).toEqual(['raise_59', 'keep_49']);
    expect(r.keptOlumiProvisional).toBe(false);
  });

  it('no mark anywhere → the submission is returned unchanged', () => {
    const submitted = [opt('raise_59'), opt('keep_49')];
    const r = filterOlumiProposedOptions({ submitted, graph: graphOf(node('raise_59'), node('keep_49')) });
    expect(r.options).toBe(submitted);
    expect(r.keptOlumiProvisional).toBe(false);
  });

  it('the submission\'s `id` spelling is read as well as `option_id`', () => {
    const r = filterOlumiProposedOptions({
      submitted: [{ id: 'a', interventions: { f: 1 } }, { id: 'b', interventions: { f: 2 } }, { id: 'phased', interventions: { f: 3 } }],
      graph: graphOf(node('a'), node('b'), node('phased', true)),
    });
    expect(r.options.map((o) => o.id)).toEqual(['a', 'b']);
  });
});
