/**
 * ⭐ Wave A2 (DL witness, 7 Oct 02:41Z, staging CEE 86ccaf3, guest T1b draws D and H): pressing "Suggest options" ended
 * in a question and no card. Render log: `propose_new_option` refused `widen_gate`, `gate_failed: ["WD-COUNT"]`,
 * `gate_options: []`, `proposed: { label: … }`. A strict provider fills every key, so the model's ONE option arrived as
 * `{ label, acts_on, options: [] }`. The door reads `options` only when it is non-empty (agent-capabilities.ts,
 * proposeNewOption); the gate read `[]` as "no options" and refused before checking anything.
 *
 * Graph: the captured scout draft (fixtures/w10-scout-graph.json, unchanged). The call shape is the logged one; its
 * `acts_on` content is author-written (the log keeps top-level scalars only), so the rows below pin the SHAPE.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  widenGate, widenNotAdded, widenOptionsOf, widenPassingArgs, widenTurnForReadback, WIDEN_PRESS_ID, type RunWidenTurn,
  type WidenGateResult,
} from '../widen-turn.js';
import { createAgentCapabilities, type InternalDispatch } from '../../runtime/agent-capabilities.js';
import { ProposalStore } from '../../proposal.js';
import type { AgentCapabilities } from '../../runtime/agent-tools.js';
import { buildAddOptionsTransaction } from '../../../routing/add-option-transaction.js';
import { gmHeldProposalRef } from '../../../handlers/edit-graph-referee-gate.js';

type Args = Parameters<AgentCapabilities['proposeNewOption']>[1];
type Rec = Record<string, unknown>;
const graph = JSON.parse(readFileSync(new URL('./fixtures/w10-scout-graph.json', import.meta.url), 'utf8')) as { nodes: Rec[]; edges: Rec[] };
const failedOf = (g: WidenGateResult): readonly string[] => ('failed' in g ? g.failed : []);
const turn = (): RunWidenTurn => widenTurnForReadback(WIDEN_PRESS_ID, { graph }) as RunWidenTurn;
const level = (value: number, unit?: string) => ({ value, ...(unit === undefined ? {} : { unit }), estimate: true, basis: 'a typical mix' });
const ACTS = [
  { factor_label: 'Price change from today', direction: 'positive', level: level(5, '%') },
  { factor_label: 'Starter-tier availability', direction: 'positive', level: level(1) },
];
/** The logged strict-provider shape: one option, every key present. */
const strictOne = (): Args => ({ label: 'Starter tier with smaller rise', acts_on: ACTS, options: [], rationale: 'r' } as unknown as Args);

describe('a strict provider\'s ONE option (`options: []` beside `label`) is read as the door reads it', () => {
  it('PRECONDITION: the scout turn is a Run widen turn and the shape is the logged one', () => {
    expect(turn()?.kind).toBe('run');
    expect(Array.isArray((strictOne() as Rec).options) && ((strictOne() as Rec).options as unknown[]).length === 0).toBe(true);
  });

  it('RED at base: the gate checks the option instead of refusing WD-COUNT with nothing checked', () => {
    const gate = widenGate(turn(), strictOne());
    expect(failedOf(gate)).not.toContain('WD-COUNT');
    expect(gate.per_option).toHaveLength(1);
    expect(gate.ok).toBe(true);
    expect(gate.passing_indices).toEqual([0]);
  });

  it('the passing args still reach the door as the single label (options stay empty), and nothing is reported dropped', () => {
    const args = strictOne();
    const gate = widenGate(turn(), args);
    const passing = widenPassingArgs(gate, args) as Rec;
    expect(passing.label).toBe('Starter tier with smaller rise');
    expect(widenOptionsOf(passing)).toHaveLength(1);
    const result = widenNotAdded({ ok: true, mutated: false }, gate, args);
    expect(result.not_added).toBeUndefined();
  });

  it('through the real door: ONE held card, built from the label; nothing written before Approve', async () => {
    const snapshot = structuredClone(graph);
    const posts: unknown[] = [];
    const dispatch: InternalDispatch = async (path, body) => {
      if (path.endsWith('/graph')) return { status: 200, json: { graph: snapshot, graph_hash: 'a'.repeat(64) } };
      posts.push(body);
      const parameters = (body as { chip: { parameters: unknown } }).chip.parameters;
      const batch = buildAddOptionsTransaction(parameters, { nodes: snapshot.nodes as never, edges: snapshot.edges as never });
      if (!batch.matched) throw new Error('transaction refused');
      const first = batch.operations.find((o) => o.op === 'add_node' && (o.value as Rec)?.kind === 'option');
      return { status: 200, json: { suggested_actions: [{ id: gmHeldProposalRef('w10-strict', `node:${first!.path}`), label: 'Approve', message: 'Yes' }] } };
    };
    const door = createAgentCapabilities(dispatch, new ProposalStore());
    const args = strictOne();
    const gate = widenGate(turn(), args);
    expect(gate.ok).toBe(true);
    const result = await door.proposeNewOption({ scenario_id: 'w10-strict', authenticated_user_id: null, request_id: 'r', user_text: '' } as never,
      widenPassingArgs(gate, args));
    expect(result.ok).toBe(true);
    expect(posts).toHaveLength(1);
    expect(JSON.stringify(snapshot)).toBe(JSON.stringify(graph));
  });

  it('CONTROL: an empty `options` with no label is still WD-COUNT', () => {
    expect(failedOf(widenGate(turn(), { options: [], rationale: 'r' } as unknown as Args))).toContain('WD-COUNT');
  });

  it('CONTROL: four options are still WD-COUNT', () => {
    const o = { label: 'x', acts_on: ACTS };
    expect(failedOf(widenGate(turn(), { options: [o, o, o, o], rationale: 'r' } as unknown as Args))).toContain('WD-COUNT');
  });

  it('CONTROL: a non-empty `options` wins over a stray `label`, as at the door', () => {
    const a = { label: 'ignored', acts_on: ACTS, options: [{ label: 'Starter tier with smaller rise', acts_on: ACTS }] } as Rec;
    expect(widenOptionsOf(a)).toEqual(a.options);
  });
});
