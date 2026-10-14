/**
 * ⛔ AN AI ADD CANNOT AUTHOR AN OPTION'S LIFECYCLE (F1 T6; CODEX overflow #2467 5935234950 P1-1).
 *
 * The option-status writer infers ADOPTION from `proposed_by: 'olumi'` + participation + the user's own exclusion
 * (`isUnadoptedOlumiSuggestion`). A generic `add_node` carrying `proposed_by: 'olumi', option_status: 'removed'` forged
 * "an Olumi suggestion the user took out", which "put it back" would then INCLUDE without the adoption door ever being
 * pressed. The three fields are CEE-owned: stripped from an AI add (`stripPipelineOwnedFromAddOperations`, the
 * `edit_graph` tool's path) and refused anywhere else on the add path (`refereeMutation`).
 */
import { describe, expect, it } from 'vitest';

import { PIPELINE_OWNED_ROOTS, stripPipelineOwnedFromAddOperations } from '../field-safety.js';
import { refereeMutation } from '../referee.js';
import { PIPELINE_OWNED_FIELD, STRUCTURAL_APPLY_HELD } from '../reason-codes.js';
import { buildReadyGraph, frameFor, hashOf, makeEnvelope } from './fixtures.js';

const G = buildReadyGraph();
const addOption = (screened: Record<string, unknown>) => refereeMutation(
  makeEnvelope('add_node', { node: { id: 'opt-forged', kind: 'option', label: 'Launch AI reporting' }, screened_value: screened },
    { base_graph_hash: hashOf(G) }),
  G, frameFor(G));

describe('an AI add_node never authors proposed_by / option_status / analysis_participation', () => {
  it('RED: the forged pair (proposed_by olumi + option_status removed) is REJECTED at the referee', () => {
    const v = addOption({ proposed_by: 'olumi', option_status: 'removed', interventions: {} });
    expect(v.verdict).toBe('rejected');
    expect(v.blocker?.code).toBe(PIPELINE_OWNED_FIELD);
  });

  it.each(['proposed_by', 'option_status', 'analysis_participation'])('RED: %s alone is REJECTED (each is CEE-owned)', (field) => {
    const v = addOption({ [field]: field === 'proposed_by' ? 'olumi' : field === 'option_status' ? 'removed' : 'included' });
    expect(v.blocker?.code, field).toBe(PIPELINE_OWNED_FIELD);
    expect(PIPELINE_OWNED_ROOTS.has(field)).toBe(true);
  });

  it('CONTROL: the same option add without them still reaches its HELD verdict (no capability revoked)', () => {
    const v = addOption({ interventions: {}, description: 'A new option' });
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(STRUCTURAL_APPLY_HELD);
  });

  it('RED: the edit_graph tool STRIPS the three from an add_node op, keeping the node and every other key by identity', () => {
    const op = { op: 'add_node', path: 'opt-forged', value: { id: 'opt-forged', kind: 'option', label: 'Launch AI reporting',
      description: 'kept', proposed_by: 'olumi', option_status: 'removed', analysis_participation: 'retained_excluded' } };
    const other = { op: 'add_node', path: 'f-new', value: { id: 'f-new', kind: 'factor', label: 'New factor' } };
    const out = stripPipelineOwnedFromAddOperations([op, other] as never) as unknown as { operations?: unknown[] } | unknown[];
    const ops = (Array.isArray(out) ? out : (out as { operations: unknown[] }).operations) as { value: Record<string, unknown> }[];
    expect(ops[0]!.value).toEqual({ id: 'opt-forged', kind: 'option', label: 'Launch AI reporting', description: 'kept' });
    expect(ops[1]).toBe(other);
  });
});
