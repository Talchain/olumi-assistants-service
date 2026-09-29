/**
 * ⭐ THE CONFIRM CARD, RUNTIME'S ISSUE POINT (DL 5888399097 / 5888631168; `../identity-card.ts`).
 *
 * R3's detector (#2296) reads the stored model; Runtime offers its words as ONE proposal whose button shows them exactly;
 * "Yes" on that button writes the identity through Canonical's approved-card door (#2292), one append, alone, and runs
 * nothing. Every write here goes through the REAL door (`applyIdentityConfirmEdit`), so the token Runtime sends is checked
 * by the writer's own recomputation, not by this test.
 *
 * Fixture: the stored graphs of Paul's MRR brief served on CEE `ed49d44` (R3 #72 5888379558): run 0 has MRR's two parents
 * as the user's £49 (price written "£/month", no per-item unit) and 1,500, and no identity; run 1 already carries it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { createAgentCapabilities, type InternalDispatch } from '../runtime/agent-capabilities.js';
import { dispatchTool, MUTATION_TOOLS } from '../runtime/agent-tools.js';
import { ProposalStore } from '../proposal.js';
import { computeAnalysisAffectingGraphHash } from '../../context/graph-hash.js';
import { applyIdentityConfirmEdit, identityConfirmReadingToken } from '../../system-events/identity-confirm-edit.js';
import { proposeProductIdentity } from '../identity-proposal.js';
import { approvalChipsFor, approvalChipIdFor } from '../approval-chips.js';
import { readingOfIdentityApproval } from '../identity-card.js';
import type { CommitOptionLevelsInput, CommitOptionLevelsResult } from '../../system-events/dispatch.js';

type Json = Record<string, any>;
const FX = JSON.parse(readFileSync(new URL('./fixtures/served-paul-mrr-ed49d44.json', import.meta.url), 'utf8')) as { runs: { run: number; graph: Json }[] };
const served = (run: number): Json => structuredClone(FX.runs.find((r) => r.run === run)!.graph);
const hashOf = (g: Json): string => computeAnalysisAffectingGraphHash(g as never) ?? '';
const ctxSaying = (user_text: string) => ({ scenario_id: '550e8400-e29b-41d4-a716-4466554400c9', authenticated_user_id: null, request_id: 'r', user_text });
const ctxPressing = (proposalId: string, words: string) => ({ ...ctxSaying(words), typed_approval_of: proposalId, typed_approval_words: words });
const cardFor = (store: ProposalStore, r: Json) => approvalChipsFor([{ name: 'propose_identity', ok: true, mutated: false, proposal_id: String(r.proposal_id) }],
  (id) => ({ proposal: store.get(id), result: r as never }));

// A Run whose every option sits at P(goal) 0 — Paul's served "£59 does not reach £85k" — so the Run reads the model after.
const STATE = { run_state: { kind: 'complete_current', computed_at: '2026-09-29T10:20:00.000Z' }, leader_claim: { permitted: true } };
const READY = { status: 'ready', analysis_admission: { admitted: true, permitted_analysis_mode: 'comparative_leader' } };
const ROWS = [
  { option_id: 'raise_59', option_label: 'Raise to £59', win_probability: 0.5, probability_of_goal: 0 },
  { option_id: 'keep_49', option_label: 'Keep £49', win_probability: 0.5, probability_of_goal: 0 },
];

/** One scenario: the stored model, the read route, the Run, and the level door running Canonical's real identity writer. */
function world(start: Json, scriptedRefusal?: string) {
  const s = { graph: start, writes: 0, sent: [] as CommitOptionLevelsInput[] };
  const store = new ProposalStore();
  const d: InternalDispatch = async (path) => {
    if (path.endsWith('/graph')) return { status: 200, json: { graph: s.graph, graph_hash: hashOf(s.graph), analysis_state: STATE } };
    if (path === '/orchestrate/v2/turn') {
      return { status: 200, json: { assistant_text: '', analysis_state: STATE, analysis_ready: READY,
        blocks: [{ type: 'analysis_result', summary: 's', computed_against_hash: hashOf(s.graph).slice(0, 16), enrichment: { option_comparison: ROWS } }] } };
    }
    throw new Error(`unexpected dispatch ${path}`);
  };
  const commitOptionLevels = async (input: CommitOptionLevelsInput): Promise<CommitOptionLevelsResult> => {
    s.sent.push(input);
    if (scriptedRefusal !== undefined) return { status: 'refused', reason: scriptedRefusal };
    const ic = input.identity_confirm!;
    const r = applyIdentityConfirmEdit({ persistedGraph: s.graph, outcome_id: ic.outcome_id, factor_ids: ic.factor_ids, words: ic.words,
      expected_graph_hash: input.base_graph_hash, reading_token: ic.reading_token });
    if (r.kind === 'refused') return { status: 'refused', reason: `identity_${r.reason}` };
    s.graph = r.mutatedGraph as Json;
    s.writes += 1;
    return { status: 'committed', graph_hash: hashOf(s.graph), already_applied: false, committed_levels: [], links_resized: [],
      receipt: { version: 2, version_id: 'v2', mutation_id: 'm2', source_turn_id: 't' } };
  };
  const caps = createAgentCapabilities(d, store, undefined, 'full', undefined, { commitOptionLevels });
  return { s, store, caps };
}

describe('PRECONDITIONS — the served bytes and R3\'s card', () => {
  it('run 0 has a card; run 1 (already minted) has none', () => {
    expect(proposeProductIdentity(served(0))?.words).toMatch(/^Is “.+” your “.+” × “.+”\? £49 × 1,500 = £73,500, close to your £75,000\. If yes, .+and you can run the analysis again\.$/);
    expect(proposeProductIdentity(served(1))).toBeNull();
  });
});

describe('the issue point: a Run offers the card once per revision', () => {
  it('a Run on run 0\'s model tells the Agent a reading is waiting; on run 1\'s model it says nothing', async () => {
    const r0 = await world(served(0)).caps.runAnalysis(ctxSaying('Run it'), { reason: 'Run it.' }) as Json;
    expect(r0.identity_card).toEqual(expect.objectContaining({ available: true }));
    expect(String(r0.identity_card.note)).toMatch(/propose_identity/);
    const r1 = await world(served(1)).caps.runAnalysis(ctxSaying('Run it'), { reason: 'Run it.' }) as Json;
    expect(r1).not.toHaveProperty('identity_card');
  });

  it('once offered on this revision, a later Run does not offer it again', async () => {
    const w = world(served(0));
    await w.caps.proposeIdentity!(ctxSaying('Is MRR price times subscribers?'));
    const again = await w.caps.runAnalysis(ctxSaying('Run it'), { reason: 'Run it.' }) as Json;
    expect(again).not.toHaveProperty('identity_card');
  });
});

describe('propose_identity: R3\'s words verbatim, on a button that shows them', () => {
  it('holds ONE proposal of the exact reading; nothing is written; the button carries the words', async () => {
    const w = world(served(0));
    const r = await w.caps.proposeIdentity!(ctxSaying('x')) as Json;
    const card = proposeProductIdentity(served(0))!;
    expect(r).toEqual(expect.objectContaining({ ok: true, mutated: false, card: { words: card.words }, base_revision: hashOf(served(0)) }));
    expect(w.s.writes).toBe(0);
    const chips = cardFor(w.store, r);
    expect(chips[0]).toEqual(expect.objectContaining({ id: approvalChipIdFor(String(r.proposal_id)), label: 'Yes, calculate it that way', detail: card.words }));
    expect(readingOfIdentityApproval(chips[0]!.message)).toBe(card.words);
  });

  it('no card when the proposer\'s result shows other words (never the Agent\'s prose)', async () => {
    const w = world(served(0));
    const r = await w.caps.proposeIdentity!(ctxSaying('x')) as Json;
    expect(cardFor(w.store, { ...r, card: { words: `${r.card.words} ` } })).toEqual([]);
  });

  it('a model with no reading to confirm offers nothing', async () => {
    const r = await world(served(1)).caps.proposeIdentity!(ctxSaying('x')) as Json;
    expect(r).toEqual(expect.objectContaining({ ok: false, mutated: false, refusal: 'no_reading_to_confirm' }));
  });

  it('the tool is registered and is a mutation tool (refused in the read-only preview)', async () => {
    expect(MUTATION_TOOLS).toContain('propose_identity');
    const w = world(served(0));
    const r = await dispatchTool('propose_identity', '{}', ctxSaying('x'), w.caps) as Json;
    expect(r.ok).toBe(true);
    const preview = await dispatchTool('propose_identity', '{}', ctxSaying('x'), w.caps, 'preview') as Json;
    expect(preview).toEqual(expect.objectContaining({ ok: false, refusal: 'read_only_preview' }));
  });
});

describe('"Yes" on the card: one write through the real door, then nothing runs', () => {
  it('RED: pressing the card records MRR = price × subscribers as the user\'s; the door checked the token itself', async () => {
    const w = world(served(0));
    const r = await w.caps.proposeIdentity!(ctxSaying('x')) as Json;
    const chip = cardFor(w.store, r)[0]!;
    const out = await w.caps.authoriseChange(ctxPressing(String(r.proposal_id), chip.message!), { proposal_id: String(r.proposal_id) }) as Json;
    expect(out).toEqual(expect.objectContaining({ ok: true, applied: true, mutated: true }));
    expect(w.s.writes).toBe(1);
    const sent = w.s.sent[0]!;
    expect(sent.links).toEqual([]);
    expect(sent.levels).toEqual([]);
    expect(sent.base_graph_hash).toBe(hashOf(served(0)));
    expect(sent.identity_confirm?.reading_token).toBe(identityConfirmReadingToken({ outcome_id: 'mrr', factor_ids: ['pro_plan_price', 'paying_subscribers'], words: r.card.words }));
    expect(w.s.graph.nodes.find((n: Json) => n.id === 'mrr').nonlinear_identity)
      .toEqual({ operation: 'product', factor_ids: ['pro_plan_price', 'paying_subscribers'], stated_in_brief: true });
    expect(String(out.follow_up)).toMatch(/run the analysis again/);
  });

  it('an approval runs nothing: a Run in the same request after the Yes is not executed', async () => {
    const w = world(served(0));
    const r = await w.caps.proposeIdentity!(ctxSaying('x')) as Json;
    const chip = cardFor(w.store, r)[0]!;
    await w.caps.authoriseChange(ctxPressing(String(r.proposal_id), chip.message!), { proposal_id: String(r.proposal_id) });
    const run = await w.caps.runAnalysis(ctxSaying('x'), { reason: 'Run it.' }) as Json;
    expect(run.ran).not.toBe(true);
  });

  it('words alone never record it; a card with other words is refused; nothing is written', async () => {
    const w = world(served(0));
    const r = await w.caps.proposeIdentity!(ctxSaying('x')) as Json;
    const id = String(r.proposal_id);
    const chip = cardFor(w.store, r)[0]!;
    const byWords = await w.caps.authoriseChange(ctxSaying(chip.message!), { proposal_id: id }) as Json;
    expect(byWords).toEqual(expect.objectContaining({ ok: false, reason: 'approve_on_the_card' }));
    for (const words of ['Yes, calculate it that way.', chip.message!.replace('£73,500', '£75,000')]) {
      const forged = await w.caps.authoriseChange(ctxPressing(id, words), { proposal_id: id }) as Json;
      expect(forged, words).toEqual(expect.objectContaining({ ok: false, reason: 'reading_not_confirmed' }));
    }
    expect(w.s.writes).toBe(0);
  });

  it('the model changed after the card was offered → nothing recorded, said plainly', async () => {
    const w = world(served(0));
    const r = await w.caps.proposeIdentity!(ctxSaying('x')) as Json;
    const chip = cardFor(w.store, r)[0]!;
    w.s.graph.nodes.find((n: Json) => n.id === 'pro_plan_price').observed_state.raw_value = 54;
    const out = await w.caps.authoriseChange(ctxPressing(String(r.proposal_id), chip.message!), { proposal_id: String(r.proposal_id) }) as Json;
    expect(out).toEqual(expect.objectContaining({ ok: false, mutated: false }));
    expect(w.s.sent).toEqual([]);
    expect(w.s.writes).toBe(0);
  });

  it('each door refusal (Canonical 5888513620) is said in plain words, never its code; nothing is written', async () => {
    for (const code of ['reading_not_confirmed', 'superseded', 'not_admissible', 'carrier_conflict', 'already_carried', 'words_invalid']) {
      const w = world(served(0), `identity_${code}`);
      const r = await w.caps.proposeIdentity!(ctxSaying('x')) as Json;
      const chip = cardFor(w.store, r)[0]!;
      const out = await w.caps.authoriseChange(ctxPressing(String(r.proposal_id), chip.message!), { proposal_id: String(r.proposal_id) }) as Json;
      expect(out, code).toEqual(expect.objectContaining({ ok: false, mutated: false, applied: false, reason: `identity_${code}` }));
      expect(String(out.detail), code).not.toMatch(/identity_|_/);
      expect(String(out.detail), code).toMatch(/^Nothing (new )?was recorded/);
      expect(w.s.writes, code).toBe(0);
    }
  });
});
