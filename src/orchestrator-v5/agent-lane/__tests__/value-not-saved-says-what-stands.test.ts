/**
 * ⛔ A VALUE THE APPROVAL DID NOT SAVE SAYS WHAT STILL STANDS (AIQ 5924015300; DL 5924014025; 52f8cd 5923996794).
 *
 * Served `7686dc0`, guest `61a8c07c` (Paul's funding brief): "About 3 a month." → card "Record your figure" → pressed →
 * "Not saved: the starting value." The model still held Olumi's 5 a month, and nothing said so. The root is a stored
 * link outside [-1, 1] (deals closed → funding secured, mean 1.67), so the writer's base check (`isEditableGraph`)
 * refuses every compound value write (`canonical_graph_unavailable`); MG's persist invariant owns that root. These rows
 * own the WORDS: the figure not saved and whose it is, and the figure the model still uses and whose THAT is.
 *
 * FIXTURE: that guest's stored graph, read cold before the refused approval.
 *   · WORDS: a revision proposed on the in-contract copy, refused by the writer (`canonical_graph_unavailable`, the
 *     served code) → the figure not saved and the figure still used, each with its owner. CONTROL: the same write saved.
 *   · WITHHELD (DL 5924061304): on the SERVED base, which fails the writer's own check, no proposal is made, so no
 *     "Record your figure" card is offered. CONTROL: the in-contract copy gets its proposal.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';
import { isEditableGraph } from '../../system-events/editable-graph.js';
import { ProposalStore } from '../proposal.js';
import { narrateWriteOutcome } from '../write-outcome.js';
import { sayFigureExactly } from '../say-figure.js';
import { levelsPortOver } from './fixtures/levels-port.js';

type Node = { id: string; kind: string; label: string; observed_state?: Record<string, unknown> | null };
type Edge = { from: string; to: string; strength?: { mean?: number; std?: number } };
const served = JSON.parse(readFileSync(new URL('./fixtures/served-unwritable-base-61a8c07c.json', import.meta.url), 'utf8')) as { nodes: Node[]; edges: Edge[] };
const TARGET = 'investment_firm_warm_connections_pursued';
const LABEL = 'Investment-firm warm connections pursued';
const ctx = { scenario_id: '61a8c07c-026a-45b3-8e13-1d859169df03', authenticated_user_id: null, request_id: 'r', user_text: 'About 3 a month.', user_turn_text: 'About 3 a month.' };

/** The same model with its one out-of-contract link brought inside [-1, 1]: the control the base check admits. */
const inContract = (g: typeof served) => ({ ...g, edges: g.edges.map((e) => (Math.abs(e.strength?.mean ?? 0) > 1 ? { ...e, strength: { ...e.strength, mean: 1 } } : e)) });

function product(graph: typeof served) {
  let nodes: Node[] = structuredClone(graph.nodes);
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Record<string, unknown>;
    if (path.endsWith('/graph/register')) {
      nodes = (b as { graph: { nodes: Node[] } }).graph.nodes;
      rev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    return { status: 200, json: { graph: { nodes, edges: graph.edges }, graph_hash: `h${rev}` } };
  };
  return { d, nodes: () => nodes };
}

async function approveRevision(graph: typeof served, writerRefuses: boolean) {
  const p = product(graph);
  const door = levelsPortOver(p.d);
  // The served refusal (the writer's base check) or the product's door.
  const port = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> =>
    writerRefuses ? { status: 'refused', reason: 'canonical_graph_unavailable' } : door(input);
  const caps = createAgentCapabilities(p.d, new ProposalStore(), undefined, 'full', undefined, { commitOptionLevels: port });
  const r = await caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: LABEL, value: 3, unit: 'connections/month', basis: 'their contacts’ capacity', revise: true }] } as never);
  expect(r.ok, JSON.stringify(r)).toBe(true);
  const out = await caps.authoriseChange(ctx, { proposal_id: String(r.proposal_id) });
  const status = narrateWriteOutcome('', [{ name: 'authorise_change' }], [out], { versioned: false }).status ?? '';
  return { out, status, node: p.nodes().find((n) => n.id === TARGET)! };
}

describe('a revised figure the writer refused says what was not saved and what the model still uses', () => {
  it('PRECONDITION: the served base fails the writer’s check, and the control passes it', () => {
    expect(isEditableGraph(served)).toBe(false);
    expect(isEditableGraph(inContract(served))).toBe(true);
    expect(served.nodes.find((n) => n.id === TARGET)?.observed_state).toMatchObject({ raw_value: 5, source: 'cee_inference' });
  });

  it('RED: names the user’s 3 as not saved and Olumi’s 5 as what the model still uses — never the bare fragment', async () => {
    const { out, status, node } = await approveRevision(inContract(served), true);
    expect(out.ok).toBe(false);
    expect(node.observed_state).toMatchObject({ raw_value: 5, source: 'cee_inference' });
    // The figures in the product's own words (`sayFigureExactly`), bound by identity rather than retyped here.
    const say = (v: number) => sayFigureExactly(v, 'connections/month');
    expect(status.startsWith(`Your ${say(3)} for “${LABEL}” wasn’t saved.`), status).toBe(true);
    expect(status).toContain(`The model still uses Olumi’s estimate of ${say(5)}.`);
    expect(status).not.toContain('Not saved: the starting value');
    // AIQ: the reason only when it is known in words — an unworded code is left out, never shown or guessed.
    expect(status).not.toMatch(/canonical_graph_unavailable|\(\s*\)/);
  });

  it('CONTROL: the same revision on an in-contract base is saved, and nothing says it was not', async () => {
    const { out, status, node } = await approveRevision(inContract(served), false);
    expect(out.ok, JSON.stringify(out)).toBe(true);
    expect(node.observed_state).toMatchObject({ raw_value: 3 });
    expect(status).not.toMatch(/wasn’t saved|Not saved/);
  });
});

describe('what still stands is said with its true owner and in the user\u2019s units (AIQ 5924240860)', () => {
  const withTarget = (observed: Record<string, unknown>) => {
    const g = inContract(served);
    return { ...g, nodes: g.nodes.map((n) => (n.id === TARGET ? { ...n, observed_state: { unit: 'connections/month', ...observed } } : n)) };
  };
  const say = (v: number) => sayFigureExactly(v, 'connections/month');

  it('RED (1): a figure read from the user\u2019s brief (`brief_extraction` + explicit) is the brief\u2019s, never Olumi\u2019s', async () => {
    const { status } = await approveRevision(withTarget({ value: 0.1, raw_value: 5, source: 'brief_extraction', extractionType: 'explicit' }), true);
    expect(status).toContain(`The model still uses the figure from your brief, ${say(5)}.`);
    expect(status).not.toContain('Olumi’s estimate');
  });

  it('RED (2): a capped figure with no raw value is said in the user\u2019s units (value × cap), never the scaled 0.5', async () => {
    const { status } = await approveRevision(withTarget({ value: 0.5, cap: 10, source: 'cee_inference', extractionType: 'inferred' }), true);
    expect(status).toContain(`The model still uses Olumi’s estimate of ${say(5)}.`);
    expect(status).not.toMatch(/0\.5/);
  });
});

describe('no "Record your figure" on a base the writer would refuse (DL 5924061304)', () => {
  const propose = async (graph: typeof served) => {
    const p = product(graph);
    const caps = createAgentCapabilities(p.d, new ProposalStore(), undefined, 'full', undefined, { commitOptionLevels: levelsPortOver(p.d) });
    return caps.proposeAssumptions(ctx, { assumptions: [{ factor_label: LABEL, value: 3, unit: 'connections/month', basis: 'their contacts’ capacity', revise: true }] } as never);
  };

  it('RED: the served base (a stored link at mean 1.67) gets no proposal, so no card', async () => {
    const r = await propose(served);
    expect(r.ok).toBe(false);
    expect(r.refusal).toBe('values_not_writable');
    expect(r.proposal_id).toBeUndefined();
  });

  it('CONTROL: the in-contract copy gets its proposal (the withhold is the writer’s check, nothing wider)', async () => {
    const r = await propose(inContract(served));
    expect(r.ok, JSON.stringify(r)).toBe(true);
    expect(typeof r.proposal_id).toBe('string');
  });
});
