/**
 * ⛔ No raw proposal id reaches the user (display-ids.ts).
 *
 * The corpus is every served reply line that printed one — extracted from real
 * witness captures, not written for this test — and the route case drives the
 * served J1 reply through `/agent/v1/turn`.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { readFileSync } from 'node:fs';
import { withoutProposalIds } from '../display-ids.js';

const corpus = JSON.parse(
  readFileSync(new URL('./fixtures/served-proposal-id-lines.json', import.meta.url), 'utf8'),
) as { lines: string[] };

const RAW_ID = /prop_[0-9a-f]{6,}/;

describe('a served reply never shows the user a proposal id', () => {
  it('vacuity: the corpus is the served one, and every line carries a raw id', () => {
    expect(corpus.lines.length).toBe(49);
    for (const l of corpus.lines) expect(l).toMatch(RAW_ID);
  });

  it('RED: no line of the served corpus keeps a raw id, or a dangling "Proposal ID:" label', () => {
    for (const l of corpus.lines) {
      const out = withoutProposalIds(l);
      expect(out, l).not.toMatch(RAW_ID);
      expect(out, l).not.toMatch(/Proposal\s+ID/i);
      expect(out, l).not.toMatch(/``|“\s*approve\s*”|approve\s*\*\*\s*$/i);
    }
  });

  it('keeps what each served sentence MEANT', () => {
    const cases: [string, string][] = [
      [
        '**Proposal `prop_cd27cdb223bd936d5fbad3c791834e5c`** would adopt all of those values and option levels in one step.',
        '**This proposal** would adopt all of those values and option levels in one step.',
      ],
      [
        'If you approve this exact proposal, say **“approve `prop_b44af6f69a8560a8aaab2a929082d8b8`”** and I’ll apply it.',
        'If you approve this exact proposal, say **“approve this proposal”** and I’ll apply it.',
      ],
      [
        'Nothing has changed yet. Approve **proposal `prop_9f97d2a34d891ddb11057e4ba639bb3c`** and I’ll apply it.',
        'Nothing has changed yet. Approve **this proposal** and I’ll apply it.',
      ],
      [
        'Applied proposal **`prop_7584aa939980c0257ad2ef0b58d9f2ad`** successfully.',
        'Applied this proposal successfully.',
      ],
      [
        'Reply **“approve proposal prop_deebdd9cd79091a3768175eebe215d39”** to store this exact set, or tell me which figures you want changed.',
        'Reply **“approve this proposal”** to store this exact set, or tell me which figures you want changed.',
      ],
    ];
    for (const [served, shown] of cases) expect(withoutProposalIds(served)).toBe(shown);
  });

  it('a label-only line is dropped when there is one proposal, and the rest of the reply is untouched', () => {
    const served = 'Starting values:\n- Team size: 8\n\n**Proposal ID:** `prop_2217ca64daee28a95b7e8b46d19fd87b`\n\nApprove it if these are reasonable.';
    expect(withoutProposalIds(served)).toBe('Starting values:\n- Team size: 8\n\nApprove it if these are reasonable.');
  });

  it('several proposals are numbered by first mention, consistently across the reply', () => {
    const served = [
      '1. `prop_1237919932422ce0f2de13f089f49aff` — the option levels',
      '2. `prop_dbef2fd09facfea3cf337d9caae077ee` — the positive coverage → average price link',
      '',
      '> Approve proposals `prop_1237919932422ce0f2de13f089f49aff` and `prop_dbef2fd09facfea3cf337d9caae077ee`',
    ].join('\n');
    expect(withoutProposalIds(served)).toBe([
      '1. proposal 1 — the option levels',
      '2. proposal 2 — the positive coverage → average price link',
      '',
      '> Approve proposals 1 and 2',
    ].join('\n'));
  });

  it('CONTRAST: a reply with no id is returned unchanged, including the word "proposal"', () => {
    const text = 'Nothing has changed yet. Approve this proposal and I’ll apply it.\n\n**Proposed levels:** Tech lead = 1';
    expect(withoutProposalIds(text)).toBe(text);
  });
});

/* ── the ROUTE: the served J1 reply reaches the user without its id ── */
const store = {
  ensureScenarioExists: vi.fn(async () => ({ user_id: null })),
  readCommittedTurn: vi.fn(async () => null),
  append: vi.fn(async () => ({ id: 'row-1' })),
};
vi.mock('../../session/index.js', () => ({ getSessionStore: () => store }));
vi.mock('../../../orchestrator/user-identity.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveUserIdentity: async () => ({ mode: 'off' }) };
});

const SERVED_J1 =
  'These are starting assumptions, mine to test—not facts about your team.\n\n' +
  '**Proposal `prop_cd27cdb223bd936d5fbad3c791834e5c`** would adopt all of those values and option levels in one step. ' +
  'Approve it if they are reasonable, or tell me what to change.';

describe('the route shows no proposal id', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      output: [{ type: 'message', content: [{ type: 'output_text', text: SERVED_J1 }] }],
    }), { status: 200 })));
    vi.resetModules();
    process.env.AGENT_LANE_ENABLED = 'true';
    process.env.AGENT_LANE_PREVIEW = 'false';
    const { agentV1TurnRoute } = await import('../../../routes/agent-v1-turn.js');
    app = Fastify({ logger: false });
    app.post('/assist/v1/scenarios/:id/graph', async () => ({ graph: { nodes: [{ id: 'g', kind: 'goal', label: 'Goal' }], edges: [] }, graph_hash: 'h1' }));
    await app.register(agentV1TurnRoute);
    await app.ready();
  }, 60_000);
  afterAll(async () => { await app.close(); vi.unstubAllGlobals(); delete process.env.AGENT_LANE_ENABLED; delete process.env.AGENT_LANE_PREVIEW; });

  it('RED: the served J1 reply reaches the user as "This proposal", with its meaning intact', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', message: 'Should I hire a Tech lead or two developers to increase velocity?' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { assistant_text: string };
    expect(body.assistant_text).not.toMatch(RAW_ID);
    expect(body.assistant_text).toContain('**This proposal** would adopt all of those values and option levels in one step.');
  });
});
