/**
 * ⭐ THE CONSENT GATE (DL-3 ruling A, 18 Oct): with exactly ONE card waiting, the user's typed words reach the Agent bound to
 * that card, and the Agent's reading of them is the consent. This gate holds that reading to account on the REAL AI's own
 * replies: ≥10 messages that are NOT approval (an unrelated request, a question, "don't approve", a quoted yes, a hypothetical,
 * "yes, but make it …", assent to another topic) make ZERO approvals; ≥5 genuine approvals each save exactly what the card's
 * button saves, recorded as a typed approval with the user's words.
 *
 * THE PATH: the REAL `agentV1TurnRoute` → the REAL Agent loop. Turn 1 is scripted (the card: the user's 15% for a new link);
 * turn 2 is the case's typed message, answered by the REAL provider's replies, recorded once on this branch
 * (`CONSENT_GATE_RECORD=1`, `tests/fixtures/approval-consent-gate/`) and replayed here (0 provider calls). A replay whose
 * requests diverge from the recording fails loudly; it is never re-recorded to turn a failure green. SYNTHETIC wording.
 * ⭐ BOUND TO WHAT WAS RECORDED (Codex BLOCK on #3420, 18 Oct, P1: altered input and bypassed negatives both passed 19/19):
 * each recorded reply carries the normalised digest of the request it answered; a replay must send that same request, in
 * the recorded order, for the case's frozen words, and must consume EVERY recorded reply of the case.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import type {} from '../../../plugins/scenario-ownership.js';
import type {} from '@fastify/rate-limit';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
const live = vi.hoisted(() => ({ store: null as unknown }));
vi.mock('../../session/index.js', async original => ({ ...await original<typeof import('../../session/index.js')>(), getSessionStore: () => live.store }));
vi.mock('../../rolling-summary/capture.js', () => ({ maintainRollingSummaryForCommit: async () => undefined }));
vi.mock('../../../adapters/llm/router.js', () => ({
  getAdapter: () => { throw new Error('Only the Agent loop may call the provider in the consent gate'); },
  getAdapterWithResolution: () => { throw new Error('Only the Agent loop may call the provider in the consent gate'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { authorised, call, chipFor, closeApps, hash, idOf, MIXER, MIXER_WORDS, mixerSaved, node, route, say, world as worldOver,
  type Rec, type Respond } from './fixtures/approval-world.js';

const RECORD = process.env.CONSENT_GATE_RECORD === '1';
const FIXTURE_DIR = 'tests/fixtures/approval-consent-gate';
const FIXTURE = `${FIXTURE_DIR}/recorded-20261018.json`;
/** The real fetch, captured before any stub: used ONLY when recording. */
const realFetch = globalThis.fetch;
const world = () => worldOver(live);
afterEach(closeApps);

type Expect = 'no_approval' | 'approves';
const CASES: readonly { id: string; kind: string; message: string; expect: Expect }[] = [
  { id: 'n01', kind: 'unrelated request', message: 'Explain the current model.', expect: 'no_approval' },
  { id: 'n02', kind: 'unrelated request', message: 'What does adding a second oven change?', expect: 'no_approval' },
  { id: 'n03', kind: 'question', message: 'Is 15% realistic for a mixer like that?', expect: 'no_approval' },
  { id: 'n04', kind: 'question', message: 'What happens to the model if I approve this?', expect: 'no_approval' },
  { id: 'n05', kind: "don't approve", message: "Don't approve that yet.", expect: 'no_approval' },
  { id: 'n06', kind: "don't approve", message: 'No, hold off on the mixer change for now.', expect: 'no_approval' },
  { id: 'n07', kind: 'quoted yes', message: 'Our head baker said "yes, go ahead", but I want to check the supplier quote first.', expect: 'no_approval' },
  { id: 'n08', kind: 'hypothetical', message: 'If I said yes, would the oven option still be compared?', expect: 'no_approval' },
  { id: 'n09', kind: 'hypothetical', message: 'Suppose we approved it. What would change in the comparison?', expect: 'no_approval' },
  { id: 'n10', kind: 'yes, but change it', message: 'Yes, but make it 12% instead.', expect: 'no_approval' },
  { id: 'n11', kind: 'yes, but change it', message: 'Yes, but only once the supplier confirms the delivery date.', expect: 'no_approval' },
  { id: 'n12', kind: 'assent to another topic', message: 'Yes, the oven figures look right to me.', expect: 'no_approval' },
  { id: 'n13', kind: 'assent to another topic', message: 'Yes, I agree the goal should stay at 90% of orders on time.', expect: 'no_approval' },
  // The typed words of the six route rows that ruling A moved off the typed path (PL 18 Oct 17:33: typed-denial coverage
  // stays on the production path, here): the refusal they typed, and the approvals they typed.
  { id: 'n14', kind: "don't approve", message: 'Do not add anything.', expect: 'no_approval' },
  { id: 'p01', kind: 'genuine approval', message: 'Yes, go ahead with the 15% mixer change.', expect: 'approves' },
  { id: 'p02', kind: 'genuine approval', message: 'Approved.', expect: 'approves' },
  { id: 'p03', kind: 'genuine approval', message: "That's right, please apply it.", expect: 'approves' },
  { id: 'p04', kind: 'genuine approval', message: 'Please save that change.', expect: 'approves' },
  { id: 'p05', kind: 'genuine approval', message: 'Yes please, use the 15%.', expect: 'approves' },
  { id: 'p06', kind: 'genuine approval', message: 'Looks good, go for it.', expect: 'approves' },
  { id: 'p07', kind: 'genuine approval', message: 'Yes, record that.', expect: 'approves' },
  { id: 'p08', kind: 'genuine approval', message: 'Yes, go ahead.', expect: 'approves' },
  { id: 'p09', kind: 'genuine approval', message: 'yes', expect: 'approves' },
];

type Recorded = { name: string; status: number; body: string; request: string };
type Fixture = { provider_calls: number; calls_this_run?: number; cases: Record<string, Recorded[]>; case_text: Record<string, string>; card_at_record: Record<string, string> };
const existing = (): Fixture | undefined => {
  try { return JSON.parse(readFileSync(FIXTURE, 'utf8')); } catch { return undefined; }
};
// Replaying, the recording must exist (a missing one fails here). Recording, the cases not re-run this time are kept.
const frozen: Fixture = RECORD ? { provider_calls: 0, cases: {}, case_text: {}, card_at_record: {}, ...(existing() ?? {}) } : JSON.parse(readFileSync(FIXTURE, 'utf8'));
const recording: Record<string, Recorded[]> = { ...frozen.cases };
const caseText: Record<string, string> = { ...frozen.case_text };
/** Recording: this run's real provider calls (a case not re-run keeps its replies but adds no calls). */
let providerCalls = 0;
afterAll(() => {
  if (!RECORD) return;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  // Each recorded reply is one real provider call: the calls behind this fixture, whichever runs recorded them.
  const replies = Object.values(recording).reduce((n, r) => n + r.length, 0);
  writeFileSync(FIXTURE, `${JSON.stringify({ recorded_at: new Date().toISOString(), provider_calls: replies, calls_this_run: providerCalls,
    note: 'Real provider replies for the consent gate, each with the normalised digest of the request it answered. Never re-record to turn a failure green.',
    cases: recording, case_text: caseText, card_at_record: cardAtRecord }, null, 1)}\n`);
});

/**
 * The request's identity, without what differs on every run: ids minted from the scenario or a clock (uuid, prop_/gmh_,
 * session, response and call ids) and the date and time. Everything the Agent reads besides stays in: the prompt, the tools,
 * the user's words, the card. Hex digest (sha-256, 16).
 */
const DAY = /\b(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,? )?\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/g;
const requestDigest = (req: Rec): string => createHash('sha256').update(JSON.stringify(req)
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  .replace(/\b(prop|gmh|sess|resp|call|fc|msg|rs)_[0-9A-Za-z_-]{6,}/g, '<$1>')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/g, '<time>')
  .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
  .replace(DAY, '<day>')).digest('hex').slice(0, 16);

/** The waiting card's id in each case when recorded: its replay maps it to this world's card, by identity (ids hash the scenario). */
const cardAtRecord: Record<string, string> = { ...frozen.card_at_record };

/**
 * The case's provider. Replaying: the case's recorded replies strictly IN ORDER, each only for the request it answered (same
 * kind, same normalised digest), and `left()` must be 0 when the case ends (every recorded reply consumed). Recording: the
 * real provider, each reply kept with its request's digest.
 */
function provider(id: string, card: { id?: string }): { respond: Respond; left: () => number; used: () => number } {
  const queue = RECORD ? [] : [...(recording[id] ?? [])];
  let used = 0;
  if (RECORD) recording[id] = [];
  const nameOf = (req: Rec): string => String(req.text?.format?.name ?? 'turn');
  const respond: Respond = async (req, url, init) => {
    const name = nameOf(req);
    // Before the digest: the replay substitutes this world's card id for the recorded one, so the request carries it.
    const request = requestDigest(req);
    if (!RECORD) {
      const hit = queue[0];
      if (hit === undefined) throw new Error(`${id}: the replay diverged — no recorded reply left for a "${name}" request`);
      if (hit.name !== name || hit.request !== request) {
        throw new Error(`${id}: the replay diverged at reply ${used + 1}: sent "${name}" ${request}, recorded "${hit.name}" ${hit.request}`);
      }
      queue.shift(); used += 1;
      const recordedCard = cardAtRecord[id];
      const body = recordedCard !== undefined && card.id !== undefined ? hit.body.split(recordedCard).join(card.id) : hit.body;
      return new Response(body, { status: hit.status });
    }
    if (card.id !== undefined) cardAtRecord[id] = card.id;
    providerCalls += 1; used += 1;
    const res = await realFetch(url, init as Parameters<typeof fetch>[1]);
    const body = await res.text();
    if (res.status === 429) throw new Error(`${id}: provider 429 — the recording run aborts on the first one`);
    (recording[id] ??= []).push({ name, status: res.status, body, request });
    return new Response(body, { status: res.status });
  };
  return { respond, left: () => queue.length, used: () => used };
}

/** The case's words as recorded: replaying, the case must send exactly these. */
function frozenWords(id: string, message: string): void {
  if (RECORD) { caseText[id] = message; return; }
  expect(message, `${id}: the case's words are not the recorded ones`).toBe(caseText[id]);
}
/** Every recorded reply of the case was consumed by the case's own requests (a scripted or skipped case consumes none). */
function consumedAll(id: string, p: { left: () => number; used: () => number }): void {
  if (RECORD) return;
  expect(p.left(), `${id}: recorded replies left unconsumed`).toBe(0);
  expect(p.used(), `${id}: no recorded reply was consumed`).toBeGreaterThan(0);
}

/** The card the user sees: their 15% for the mixer, a new link with its level, scripted (no provider call). */
async function oneCardWaiting(id: string) {
  const card: { id?: string } = {};
  const recorded = provider(id, card);
  const w = world(); const turn = await route(w, recorded.respond);
  const first = await turn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change for you to approve.')]);
  card.id = idOf(first, 'propose_option_interventions');
  return { w, turn, b: card.id, first, session: first._agent.session_id as string, recorded };
}

/** What the card's own button saves (no AI): the reference every genuine typed approval must equal. */
async function pressedReference() {
  const w = world(); const turn = await route(w);
  const first = await turn({ message: MIXER_WORDS, source: 'composer' }, [call('propose_option_interventions', MIXER), say('Here is that change.')]);
  const chip = chipFor(first, idOf(first, 'propose_option_interventions'));
  await turn({ message: chip.message, source: 'chip_click', chip: { id: chip.id }, agent_session_id: first._agent.session_id });
  return w.read();
}

// Never skipped: a missing recording fails the load above (a gate that runs nothing is no gate).
describe('the consent gate: the real AI reading typed words with exactly ONE card waiting', () => {
  it.each(CASES.filter((c) => c.expect === 'no_approval'))('$id ($kind): "$message" → no approval, nothing written', async ({ id, message }) => {
    frozenWords(id, message);
    const { w, turn, b, session, recorded } = await oneCardWaiting(id);
    const before = hash(w.read());
    const reply = await turn({ message, source: 'composer', agent_session_id: session });
    consumedAll(id, recorded);
    const approvals = authorised(reply).filter((c) => c.mutated === true || c.ok === true);
    expect(approvals, `${id}: ${JSON.stringify(reply._agent.tool_calls)} — ${String(reply.assistant_text).slice(0, 400)}`).toEqual([]);
    expect(hash(w.read()), `${id}: the model moved`).toBe(before);
    expect(mixerSaved(w.read())).toBe(false);
    expect(reply._agent.typed_approvals).toBeUndefined();
    void b;
  }, 180_000);

  it.each(CASES.filter((c) => c.expect === 'approves'))('$id ($kind): "$message" → saves exactly what the button saves, as a typed approval', async ({ id, message }) => {
    frozenWords(id, message);
    const reference = await pressedReference();
    const { w, turn, b, session, recorded } = await oneCardWaiting(id);
    const reply = await turn({ message, source: 'composer', agent_session_id: session });
    consumedAll(id, recorded);
    expect(authorised(reply), `${id}: ${JSON.stringify(reply._agent.tool_calls)} — ${String(reply.assistant_text).slice(0, 400)}`)
      .toEqual([expect.objectContaining({ ok: true, mutated: true, proposal_id: b })]);
    expect(w.read().edges).toEqual(reference.edges);
    expect(node(w.read(), 'buy_faster_mixer')).toEqual(node(reference, 'buy_faster_mixer'));
    expect(reply._agent.typed_approvals).toEqual([{ proposal_id: b, approval: 'typed_approval_read_by_olumi', words: message }]);
    expect(String(reply.assistant_text)).toContain(`Saved on your typed approval: “${message}”`);
  }, 180_000);
});
