/**
 * ⛔ "THE ONE FIGURE WRITTEN IN THIS MESSAGE" IS READ FROM THIS MESSAGE (MG SUCCESSOR #75 5911974162).
 *
 * Served #2359 row on CEE 660befa4 (R3's cut-costs share graph, seeded): the user typed "Our team's quote shows GCP would
 * be about 25% cheaper than AWS for our workload.", the Agent asked, the user said "Yes, use 25%.", and the revision was
 * recorded "as an Olumi assumption" with the chip "Use as starting assumptions". The revise door's pairing rule (AIQ
 * 5902884139: one figure written, one value proposed, the card shows the user's own sentence and their Yes makes it
 * theirs) counted figures over the SESSION's typed words (`user_text`): on the real journey the brief is typed first, so
 * its £45k, 20% and 2 weeks, or the user's own 25% written twice, made every revision Olumi's.
 *
 * It now reads THIS turn's typed message (`user_turn_text`, bound by the route, never a chip's text). With two figures
 * or more in it, the strict matcher decides as before; with no typed message, the session's words are read as before.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { approvalChipsFor } from '../approval-chips.js';
import { createAgentCapabilitiesWithLevelsPort } from './fixtures/levels-port.js';
import { GraphStateIngressSchema } from '../../boundary/request-extensions.js';
import { projectGraphForPersistence } from '../../persisted-graph-projection.js';

type Json = Record<string, any>;
const R2 = JSON.parse(readFileSync(new URL('./fixtures/served-share-unit-r2-20260930.json', import.meta.url), 'utf8')) as { sentence: string; graph: Json };
const BRIEF = 'Should we switch our cloud provider from AWS to GCP? Monthly spend is £45k; we want to cut costs by 20% without more than 2 weeks of migration downtime risk.';
const YES = 'Yes, use 25%.';
const LABEL = 'GCP unit-cost saving';

/** The revise door as the served Agent called it: 25 "%" on the share factor, `revise: true`. */
async function revise(typed: readonly string[], turnText: string | undefined) {
  const graph = structuredClone(R2.graph);
  const d: InternalDispatch = async (path) => { if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: 'h0' } }; throw new Error(path); };
  const store = new ProposalStore();
  const r = await createAgentCapabilities(d, store).proposeAssumptions(
    { scenario_id: '550e8400-e29b-41d4-a716-446655440c03', authenticated_user_id: null, request_id: 'r', user_text: typed.join('\n'),
      ...(turnText !== undefined ? { user_turn_text: turnText } : {}) } as never,
    { assumptions: [{ factor_label: LABEL, value: 25, unit: '%', basis: "your team's quote", revise: true }] } as never) as Json;
  expect(r.proposal_id, 'a proposal is prepared').toEqual(expect.any(String));
  const op = store.get(r.proposal_id)!.operations[0] as Json;
  const chip = approvalChipsFor([{ name: 'propose_assumptions', ok: true, mutated: false, proposal_id: r.proposal_id }],
    (id) => ({ proposal: store.get(id), result: id === r.proposal_id ? (r as ToolResult) : undefined }))[0] as Json | undefined;
  return { author: op.value?.authored_by as string, value: op.value?.value as number, chip };
}

describe('the revise door reads the one figure from THIS message', () => {
  it('the served journey, quote turn: brief typed first, then "about 25% cheaper" → the user\'s 25%, shown in their words', async () => {
    const t = await revise([BRIEF, R2.sentence], R2.sentence);
    expect(t).toMatchObject({ author: 'user_stated', value: 0.25 });
    expect(t.chip?.label).toBe('Record your figure');
    expect(t.chip?.detail).toContain('20% → 25%');
    expect(t.chip?.detail).toContain(R2.sentence);
  });

  it('the served journey, "Yes, use 25%." turn (their 25% now written twice in the session) → still the user\'s', async () => {
    const t = await revise([BRIEF, R2.sentence, YES], YES);
    expect(t).toMatchObject({ author: 'user_stated', value: 0.25 });
    expect(t.chip?.label).toBe('Record your figure');
  });

  it('CONTROL — no typed message this turn (a chip press): the session\'s words are read as before → Olumi\'s', async () => {
    expect((await revise([BRIEF, R2.sentence], undefined)).author).toBe('model_proposed');
  });

  it('CONTROL — the figure beside ANOTHER quantity\'s words ("25% of our workloads") is never this factor\'s', async () => {
    const said = 'Move 25% of our workloads to GCP first.';
    expect((await revise([BRIEF, said], said)).author).toBe('model_proposed');
  });

  it('CONTROL — two different figures in this message: the pairing does not apply (the strict matcher decides, as before)', async () => {
    const said = 'GCP would be about 25% cheaper than AWS for our workload, and we would move 60% of workloads.';
    expect((await revise([BRIEF, said], said)).author).toBe('model_proposed');
  });

  it('CONTROL — a figure the user did not write this turn is never theirs by this door ("Yes, go ahead.")', async () => {
    const said = 'Yes, go ahead.';
    expect((await revise([BRIEF, R2.sentence, said], said)).author).toBe('model_proposed');
  });
});

/**
 * AIQ 5912007439, rows A and B: authorship is decided when the card is ISSUED. The press writes what the card showed;
 * a later figure-less "yes" never re-counts, so it cannot demote the user's figure (nor promote Olumi's).
 */
function product() {
  const SID = '550e8400-e29b-41d4-a716-446655440c04';
  let graph = structuredClone(R2.graph) as { nodes: Json[]; edges: Json[] };
  let rev = 0;
  const d: InternalDispatch = async (path, body) => {
    const b = (body ?? {}) as Json;
    if (path.endsWith('/graph/register')) {
      if (typeof b.expected_graph_hash === 'string' && b.expected_graph_hash !== `h${rev}`) return { status: 409, json: { details: { code: 'GRAPH_STALE' } } };
      const parsed = GraphStateIngressSchema.safeParse(b.graph);
      if (!parsed.success) return { status: 400, json: { code: 'GRAPH_CONTRACT_INVALID' } };
      graph = projectGraphForPersistence(parsed.data, { scenarioId: SID, turnClass: 'direct_answer', source: 'graph_registration' }) as typeof graph;
      rev += 1;
      return { status: 200, json: { registered: true, graph_hash: `h${rev}` } };
    }
    if (path.endsWith('/graph')) return { status: 200, json: { graph, graph_hash: `h${rev}` } };
    return { status: 400, json: {} };
  };
  const source = () => graph.nodes.find((n) => n.label === LABEL)?.observed_state?.source;
  return { SID, d, source };
}

async function cardThenPress(cardTurn: { typed: readonly string[]; turn?: string }, pressTyped: readonly string[]) {
  const p = product();
  const store = new ProposalStore();
  const caps = createAgentCapabilitiesWithLevelsPort(p.d, store);
  const base = { scenario_id: p.SID, authenticated_user_id: null, request_id: 'r' };
  const r = await caps.proposeAssumptions({ ...base, user_text: cardTurn.typed.join('\n'), ...(cardTurn.turn !== undefined ? { user_turn_text: cardTurn.turn } : {}) } as never,
    { assumptions: [{ factor_label: LABEL, value: 25, unit: '%', basis: "your team's quote", revise: true }] } as never) as Json;
  expect(r.proposal_id, JSON.stringify(r)).toEqual(expect.any(String));
  const shown = (store.get(r.proposal_id)!.operations[0] as Json).value.authored_by as string;
  // The press: a chip, so no typed text this turn; the session's words now end with a figure-less yes.
  const applied = await caps.authoriseChange({ ...base, user_text: pressTyped.join('\n'), typed_approval_of: r.proposal_id } as never, { proposal_id: r.proposal_id }) as Json;
  expect(applied.ok, JSON.stringify(applied)).toBe(true);
  return { shown, written: p.source() };
}

describe('AIQ rows A/B: the card decides whose figure it is; the press writes it', () => {
  it('ROW A: card on the quote turn → a later figure-less press ("Yes, use those.") writes the user\'s own figure, never Olumi\'s assumption', async () => {
    const t = await cardThenPress({ typed: [BRIEF, R2.sentence], turn: R2.sentence }, [BRIEF, R2.sentence, 'Yes, use those.']);
    expect(t.shown).toBe('user_stated');
    // The writer's own user-figure stamp, bound by its literal (never "anything but user_assumption").
    expect(t.written).toBe('user_override');
  });

  it('ROW A CONTRAST: a card issued as Olumi\'s (no typed message on its turn) is written as the user\'s ASSUMPTION', async () => {
    const t = await cardThenPress({ typed: [BRIEF, R2.sentence] }, [BRIEF, R2.sentence, 'Yes, use those.']);
    expect(t.shown).toBe('model_proposed');
    expect(t.written).toBe('user_assumption');
  });

  it('ROW B: one figure about ANOTHER subject ("our support team grew 25%") shows the factor AND the user\'s own sentence on the card', async () => {
    const said = 'Our support team grew 25% this year.';
    const t = await revise([BRIEF, said], said);
    // Only the displayed pairing can make it theirs, and only by a press: the card names the factor and quotes them.
    expect(t.author).toBe('user_stated');
    expect(t.chip?.label).toBe('Record your figure');
    expect(t.chip?.detail).toContain(LABEL);
    expect(t.chip?.detail).toContain(said);
  });
});
