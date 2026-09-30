/**
 * ⛔ AN OPTION OLUMI PROPOSED IS NOT COMPARED AS THE USER'S (DL 5887510885; `olumi-option-filter.ts`).
 *
 * The Run's post-gate filter: Olumi's options (MG's typed mark, read on the persisted graph) leave the submission when at
 * least 2 of the user's remain; otherwise they stay, typed `kept_olumi_provisional`. It can never create a refusal.
 */
import { describe, it, expect } from 'vitest';
import { filterOlumiProposedOptions } from '../olumi-option-filter.js';
import type { ExcludedOptionRecord } from '../analysable-option-gate.js';

type Rec = Record<string, unknown>;
const opt = (id: string): Rec => ({ option_id: id, label: id, interventions: { f: 1 } });
const node = (id: string, proposed = false): Rec => ({ id, kind: 'option', label: id, ...(proposed ? { proposed_by: 'olumi' } : {}) });
const graphOf = (...nodes: Rec[]): Rec => ({ nodes: [{ id: 'dec', kind: 'decision' }, ...nodes], edges: [] });
const excludedOf = (...ids: string[]): ExcludedOptionRecord[] => ids.map((option_id) => ({ option_id, label: option_id, reason: 'no_interventions' }));

describe('filterOlumiProposedOptions', () => {
  it('≥2 of the user\'s options remain → Olumi\'s leave the submission, typed excluded_olumi_proposed (no ids)', () => {
    const r = filterOlumiProposedOptions({
      submitted: [opt('raise_59'), opt('keep_49'), opt('phased')],
      graph: graphOf(node('raise_59'), node('keep_49'), node('phased', true)),
      excluded: [],
    });
    expect(r.options.map((o) => o.option_id)).toEqual(['raise_59', 'keep_49']);
    expect(r.participation).toEqual([{ option_id: 'phased', state: 'excluded_olumi_proposed' }]);
  });

  it('the status quo is the user\'s option: it counts towards the 2', () => {
    const r = filterOlumiProposedOptions({
      submitted: [opt('status_quo'), opt('raise_59'), opt('phased')],
      graph: graphOf({ ...node('status_quo'), is_status_quo: true }, node('raise_59'), node('phased', true)),
      excluded: [],
    });
    expect(r.options.map((o) => o.option_id)).toEqual(['status_quo', 'raise_59']);
  });

  it('<2 user options because the gate excluded one → Olumi\'s STAY, provisional, naming the unanalysable user option', () => {
    const submitted = [opt('raise_59'), opt('phased')];
    const r = filterOlumiProposedOptions({
      submitted,
      graph: graphOf(node('raise_59'), node('keep_49'), node('phased', true)),
      excluded: excludedOf('keep_49'),
    });
    expect(r.options).toBe(submitted);
    expect(r.participation).toEqual([{ option_id: 'phased', state: 'kept_olumi_provisional', unanalysable_user_option_ids: ['keep_49'] }]);
  });

  it('<2 user options because the brief named only one → Olumi\'s stay, with NO ids (there is no unanalysable option to name)', () => {
    const r = filterOlumiProposedOptions({
      submitted: [opt('raise_59'), opt('phased'), opt('tiered')],
      graph: graphOf(node('raise_59'), node('phased', true), node('tiered', true)),
      excluded: [],
    });
    expect(r.options.map((o) => o.option_id)).toEqual(['raise_59', 'phased', 'tiered']);
    expect(r.participation).toEqual([
      { option_id: 'phased', state: 'kept_olumi_provisional' },
      { option_id: 'tiered', state: 'kept_olumi_provisional' },
    ]);
  });

  it('an EXCLUDED Olumi option is never named as the user\'s unanalysable option', () => {
    const r = filterOlumiProposedOptions({
      submitted: [opt('raise_59'), opt('phased')],
      graph: graphOf(node('raise_59'), node('phased', true), node('tiered', true)),
      excluded: excludedOf('tiered'),
    });
    expect(r.participation).toEqual([{ option_id: 'phased', state: 'kept_olumi_provisional' }]);
  });

  it('no mark anywhere → the submission is returned unchanged and nothing is typed', () => {
    const submitted = [opt('raise_59'), opt('keep_49')];
    const r = filterOlumiProposedOptions({ submitted, graph: graphOf(node('raise_59'), node('keep_49')), excluded: [] });
    expect(r.options).toBe(submitted);
    expect(r.participation).toEqual([]);
  });

  it('a marked option the gate did not submit is not typed (only the compared set is decided here)', () => {
    const submitted = [opt('raise_59'), opt('keep_49')];
    const r = filterOlumiProposedOptions({
      submitted,
      graph: graphOf(node('raise_59'), node('keep_49'), node('phased', true)),
      excluded: excludedOf('phased'),
    });
    expect(r.options).toBe(submitted);
    expect(r.participation).toEqual([]);
  });

  it('the submission\'s `id` spelling is read as well as `option_id`', () => {
    const r = filterOlumiProposedOptions({
      submitted: [{ id: 'a' }, { id: 'b' }, { id: 'phased' }],
      graph: graphOf(node('a'), node('b'), node('phased', true)),
      excluded: [],
    });
    expect(r.options.map((o) => o.id)).toEqual(['a', 'b']);
  });
});
