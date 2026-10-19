/**
 * ⭐ THE K6 GATE (PL amendment 2; DL ack 18 Oct): a one-line brief that states no aim was refused and asked (turn 1); on turn 2
 * the REAL AI reads the user's words. On an explicit "draft it now" it quotes them as `explicit_draft_request`, and a
 * labelled provisional draft is saved (the aim an open question). On anything else it does not, and nothing is drafted.
 *
 * THE PATH: the REAL `agentV1TurnRoute` → the REAL Agent loop → `build_model_from_brief` → the REAL construction
 * (`buildModelFromBrief`) → the graph register route. Scripted: turn 1 (the Agent's build call and its question) and the
 * drafter (the same one-line-brief answer each time: the action as an event goal). Turn 2's Agent replies are the REAL
 * provider's, recorded once (`K6_GATE_RECORD=1`, `tests/fixtures/k6-draft-now-gate/`), each with the normalised digest of the
 * request it answered, and replayed here strictly in order with every reply consumed. SYNTHETIC wording (a café).
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
  getAdapter: () => { throw new Error('Only the Agent loop may call the provider in the K6 gate'); },
  getAdapterWithResolution: () => { throw new Error('Only the Agent loop may call the provider in the K6 gate'); }, getMaxTokensFromConfig: () => undefined,
}));
vi.mock('../../../orchestrator/user-identity.js', async original => ({ ...await original<Record<string, unknown>>(), resolveUserIdentity: async () => ({ mode: 'off' }) }));
import { call, closeApps, route, say, world as worldOver, type Rec, type Respond } from './fixtures/approval-world.js';
import { OPEN_AIM_GOAL_LABEL } from '../runtime/build-model.js';
import { OPEN_AIM_SAVED_LINE } from '../write-outcome.js';

const RECORD = process.env.K6_GATE_RECORD === '1';
const FIXTURE_DIR = 'tests/fixtures/k6-draft-now-gate';
const FIXTURE = `${FIXTURE_DIR}/recorded.json`;
const realFetch = globalThis.fetch;
afterEach(closeApps);

const BRIEF = 'Should we open a second café in Bristol next spring?';
const EVENT = 'Open a second café';
/** The drafter's answer for this one-line brief, every time: the action as an event goal (the K6 shape). */
const DRAFT = JSON.stringify({
  goal: { kind: 'event_by_date', deliverable: 'second café', metric: EVENT, operator: '>=', target_stated: false, value: null, unit: '',
    horizon_months: 6, provenance: 'explicit', frame: 'level', baseline_known: false, baseline_value: null, baseline_provenance: 'inferred',
    scope: null, quantity_frame: 'level', basis: null, source_quote: 'open a second café in Bristol' },
  constraints: [],
  options: [
    { label: 'Open in Bristol next spring', provenance: 'ai_proposed', changes: [], interventions: [
      { factor_label: 'Number of cafés', value: 2, value_kind: 'absolute', unit: 'cafés', provenance: 'ai_proposed', stated_evidence: null }] },
    { label: 'Keep one café', provenance: 'ai_proposed', changes: [], interventions: [
      { factor_label: 'Number of cafés', value: 1, value_kind: 'absolute', unit: 'cafés', provenance: 'ai_proposed', stated_evidence: null }] },
  ],
  factors: [
    { label: 'Number of cafés', role: 'controllable', baseline_known: false, baseline_evidence: null, baseline_value: 1, unit: 'cafés', provenance: 'ai_proposed', plausible_max: 5 },
    { label: 'Monthly customers', role: 'external', baseline_known: false, baseline_evidence: null, baseline_value: 3000, unit: 'customers', provenance: 'ai_proposed', plausible_max: 20000 },
  ],
  risks: [], outcomes: [],
  links: [
    { from: 'Number of cafés', to: 'Monthly customers', direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
    { from: 'Monthly customers', to: EVENT, direction: 'positive', provenance: 'inferred', effect_amount: null, effect_per_source_change: null, effect_provenance: null, definitional: null, basis: null, source_quote: null },
  ],
  identities: [], unknowns: [], decision_question: BRIEF, unknown_concerns: [],
});
const drafterReply = () => new Response(JSON.stringify({ output: [{ type: 'message', content: [{ type: 'output_text', text: DRAFT }] }] }), { status: 200 });

type Expect = 'drafts' | 'no_draft';
const CASES: readonly { id: string; kind: string; message: string; expect: Expect }[] = [
  { id: 'd01', kind: 'draft now', message: 'Just use your best guesses and draft the model now.', expect: 'drafts' },
  { id: 'd02', kind: 'draft now', message: 'Go ahead and draft it anyway; I will fill in the aim later.', expect: 'drafts' },
  { id: 'd03', kind: 'draft now', message: 'Please draft it now with whatever you think is sensible.', expect: 'drafts' },
  { id: 'n01', kind: 'not yet', message: 'Not yet. I want to think about what we are aiming for first.', expect: 'no_draft' },
  { id: 'n02', kind: 'question', message: 'What would you need from me before drafting it?', expect: 'no_draft' },
  { id: 'n03', kind: 'hypothetical', message: 'If I asked you to draft it now, what would the model leave open?', expect: 'no_draft' },
  { id: 'n04', kind: 'quoted request', message: 'My manager said "just draft it now", but I would rather state the aim first.', expect: 'no_draft' },
  { id: 'n05', kind: 'unrelated', message: 'How busy is our first café on a typical Saturday?', expect: 'no_draft' },
];

type Recorded = { name: string; status: number; body: string; request: string };
type Fixture = { provider_calls: number; calls_this_run?: number; cases: Record<string, Recorded[]>; case_text: Record<string, string> };
const existing = (): Fixture | undefined => { try { return JSON.parse(readFileSync(FIXTURE, 'utf8')); } catch { return undefined; } };
const frozen: Fixture = RECORD ? { provider_calls: 0, cases: {}, case_text: {}, ...(existing() ?? {}) } : JSON.parse(readFileSync(FIXTURE, 'utf8'));
const recording: Record<string, Recorded[]> = { ...frozen.cases };
const caseText: Record<string, string> = { ...frozen.case_text };
let providerCalls = 0;
afterAll(() => {
  if (!RECORD) return;
  mkdirSync(FIXTURE_DIR, { recursive: true });
  const replies = Object.values(recording).reduce((n, r) => n + r.length, 0);
  writeFileSync(FIXTURE, `${JSON.stringify({ recorded_at: new Date().toISOString(), provider_calls: replies, calls_this_run: providerCalls,
    note: 'Real provider replies for the K6 gate (turn 2 only), each with the normalised digest of the request it answered. Never re-record to turn a failure green.',
    cases: recording, case_text: caseText }, null, 1)}\n`);
});
/** The request's identity without what differs on every run (the consent gate's normalisation). */
const DAY = /\b(?:(?:Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day,? )?\d{1,2} (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/g;
const requestDigest = (req: Rec): string => createHash('sha256').update(JSON.stringify(req)
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>')
  .replace(/\b(prop|gmh|sess|resp|call|fc|msg|rs)_[0-9A-Za-z_-]{6,}/g, '<$1>')
  .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?/g, '<time>')
  .replace(/\d{4}-\d{2}-\d{2}/g, '<date>')
  .replace(DAY, '<day>')).digest('hex').slice(0, 16);

/** Turn 2's provider: the drafter scripted; the Agent's replies recorded (replayed in order, every one consumed). */
function provider(id: string): { respond: Respond; left: () => number; used: () => number } {
  const queue = RECORD ? [] : [...(recording[id] ?? [])];
  let used = 0;
  if (RECORD) recording[id] = [];
  const respond: Respond = async (req, url, init) => {
    if (req.text?.format?.type === 'json_schema') return drafterReply();
    const name = String(req.text?.format?.name ?? 'turn');
    const request = requestDigest(req);
    if (!RECORD) {
      const hit = queue[0];
      if (hit === undefined) throw new Error(`${id}: the replay diverged — no recorded reply left for a "${name}" request`);
      if (hit.name !== name || hit.request !== request) throw new Error(`${id}: the replay diverged at reply ${used + 1}: sent "${name}" ${request}, recorded "${hit.name}" ${hit.request}`);
      queue.shift(); used += 1;
      return new Response(hit.body, { status: hit.status });
    }
    providerCalls += 1; used += 1;
    const res = await realFetch(url, init as Parameters<typeof fetch>[1]);
    const body = await res.text();
    if (res.status === 429 || res.status === 402) throw new Error(`${id}: provider ${res.status} — the recording run aborts`);
    (recording[id] ??= []).push({ name, status: res.status, body, request });
    return new Response(body, { status: res.status });
  };
  return { respond, left: () => queue.length, used: () => used };
}

describe('the K6 gate: the real AI reading turn 2 after a one-line brief with no stated aim was asked about', () => {
  it.each(CASES)('$id ($kind): "$message" → $expect', async ({ id, message, expect: want }) => {
    if (RECORD) caseText[id] = message; else expect(message, `${id}: the case's words are not the recorded ones`).toBe(caseText[id]);
    const recorded = provider(id);
    const w = worldOver(live, { brief: BRIEF }); const turn = await route(w, recorded.respond);
    // Turn 1, scripted: the Agent builds; the drafter takes the action as the goal twice; construction refuses and it asks.
    const first = await turn({ message: BRIEF, source: 'composer' },
      [call('build_model_from_brief', { brief: BRIEF, whole_request: true }), say('Before I draft it: what would a second café need to achieve for you?')]);
    expect((first._agent.tool_calls as Rec[]).find((c) => c.name === 'build_model_from_brief'), 'the control: turn 1 was refused and asked')
      .toMatchObject({ ok: false, refusal: 'construction_needs_redraft' });
    expect(w.read().nodes).toEqual([]);
    const used = recorded.used();
    // Turn 2: the real AI reads the user's words.
    const reply = await turn({ message, source: 'composer', agent_session_id: first._agent.session_id });
    if (!RECORD) { expect(recorded.left(), `${id}: recorded replies left unconsumed`).toBe(0); expect(recorded.used(), `${id}: no recorded reply consumed`).toBeGreaterThan(used); }
    const why = `${id}: ${JSON.stringify(reply._agent.tool_calls)} — ${String(reply.assistant_text).slice(0, 400)}`;
    const goal = (w.read().nodes as Rec[]).find((n) => n.kind === 'goal');
    if (want === 'drafts') {
      expect(goal?.label, why).toBe(OPEN_AIM_GOAL_LABEL);
      expect(goal?.provenance, why).toBe('ai_inferred');
      // Said once the save is confirmed, in the AIE's words.
      expect(String(reply.assistant_text), why).toContain(OPEN_AIM_SAVED_LINE);
    } else {
      expect(goal, why).toBeUndefined();
    }
  }, 240_000);
});
