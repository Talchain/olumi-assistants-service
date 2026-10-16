/** TL11:51: a retained human figure stays human across turns and windows; field binding is a separate
 * Olumi reading. Keep the old another-subject/multiple-figure negatives as explicit own-card bindings,
 * and retain a genuine new-AI-estimate contrast through the writer.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import type { ToolResult } from '../runtime/agent-tools.js';
import { ProposalStore, hasCardOnlyOperations } from '../proposal.js';
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
    { scenario_id: '550e8400-e29b-41d4-a716-446655440c03', authenticated_user_id: null, request_id: 'r', user_text: typed.join('\n'), verified_user_messages: typed,
      ...(turnText !== undefined ? { user_turn_text: turnText } : {}) } as never,
    { assumptions: [{ user_stated: true, factor_label: LABEL, value: 25, unit: '%', basis: "your team's quote", revise: true }] } as never) as Json;
  expect(r.proposal_id, 'a proposal is prepared').toEqual(expect.any(String));
  const op = store.get(r.proposal_id)!.operations[0] as Json;
  const chip = approvalChipsFor([{ name: 'propose_assumptions', ok: true, mutated: false, proposal_id: r.proposal_id }],
    (id) => ({ proposal: store.get(id), result: id === r.proposal_id ? (r as ToolResult) : undefined }))[0] as Json | undefined;
  return { author: op.value?.authored_by as string, value: op.value?.value as number, chip,
    bindingAuthor: store.get(r.proposal_id)!.provenance.authored_by, confirmation: op.value.confirmation,
    cardOnly: hasCardOnlyOperations(store.get(r.proposal_id)!.operations) };
}

const explicitReading = (t: Awaited<ReturnType<typeof revise>>, source: string): void => {
  expect(t.author).toBe('user_stated'); expect(t.bindingAuthor).toBe('model_proposed'); expect(t.cardOnly).toBe(true);
  expect(t.chip?.detail).toContain(source);
  expect(t.chip?.detail).toContain('field bindings are Olumi’s reading, including after approval');
  expect(t.confirmation.source).toContain(source);
};

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

  it('CONTROL — a chip never reauthors the retained human figure; the binding stays an own-card reading', async () => {
    explicitReading(await revise([BRIEF, R2.sentence], undefined), R2.sentence);
  });

  it('CONTROL — another subject is never silently declared the original field binding', async () => {
    const said = 'Move 25% of our workloads to GCP first.';
    explicitReading(await revise([BRIEF, said], said), said);
  });

  it('CONTROL — two figures keep their human source and the proposed binding needs its own card', async () => {
    const said = 'GCP would be about 25% cheaper than AWS for our workload, and we would move 60% of workloads.';
    explicitReading(await revise([BRIEF, said], said), said);
  });

  it('CONTROL — a short acknowledgement neither reauthors nor loses an earlier human figure', async () => {
    const said = 'Yes, go ahead.';
    explicitReading(await revise([BRIEF, R2.sentence, said], said), R2.sentence);
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

async function cardThenPress(cardTurn: { typed: readonly string[]; turn?: string }, pressTyped: readonly string[], userStated = true) {
  const p = product();
  const store = new ProposalStore();
  const caps = createAgentCapabilitiesWithLevelsPort(p.d, store);
  const base = { scenario_id: p.SID, authenticated_user_id: null, request_id: 'r' };
  const r = await caps.proposeAssumptions({ ...base, user_text: cardTurn.typed.join('\n'), verified_user_messages: cardTurn.typed, ...(cardTurn.turn !== undefined ? { user_turn_text: cardTurn.turn } : {}) } as never,
    { assumptions: [{ user_stated: userStated, factor_label: LABEL, value: 25, unit: '%', basis: userStated ? "your team's quote" : 'An explicitly new Olumi estimate', revise: true }] } as never) as Json;
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

  it('ROW A CONTRAST: the card keeps an earlier human figure human when the current turn has no text', async () => {
    const t = await cardThenPress({ typed: [BRIEF, R2.sentence] }, [BRIEF, R2.sentence, 'Yes, use those.']);
    expect(t.shown).toBe('user_stated');
    expect(t.written).toBe('user_override');
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
  it('genuine new Olumi estimate → press → still an Olumi assumption, never an original user figure', async () => {
    const invite = 'Please estimate the GCP unit-cost saving.';
    const t = await cardThenPress({ typed: [BRIEF, invite], turn: invite }, [BRIEF, invite, 'Use that estimate.'], false);
    expect(t.shown).toBe('model_proposed'); expect(t.written).toBe('user_assumption');
  });

});
