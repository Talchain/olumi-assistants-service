/**
 * ⛔ WHAT WAS SAVED IS STATED BY THE SERVER, FROM THE TOOL RESULTS.
 *
 * Release Control, 23 Sep 2026 (olumi-programme-docs#63 5788648244). Every
 * sentence below is VERBATIM from a real served Agent reply — the corpus in
 * output/paul-test-20260923/{repro,construction-witness/raw} and
 * output/openai-agent-lane/evidence — never an invented string.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { assertsCompletedWrite, narrateWriteOutcome, withWriteOutcome } from '../write-outcome.js';

// Served success claims (each must be caught when nothing landed).
const CLAIMS = [
  'Applied proposal `prop_7584aa939980c0257ad2ef0b58d9f2ad` successfully.',
  'Applied: **Pro plan price → Monthly churn** is now a positive relationship.',
  'Applied all 7 assumptions.',
  'Added the four adopted assumptions.',
  'Added: **Competitor pricing → Monthly churn** (positive).',
  'Updated: all **8 assumptions** were adopted.',
  'Recorded assumptions:',
  'The direction is now recorded: a discount campaign is expected to increase churn.',
  'All others were recorded as approved:',
];
// Served sentences that are NOT write claims (each must survive).
const NOT_CLAIMS = [
  'Nothing has been changed yet.',
  'Nothing has been saved.',
  'I haven’t added a duplicate.',
  'Proposed — not applied:',
  'Approve this specific link if you want it added.',
  'It was not recorded because that factor has no stated range, so “−0.3” has no interpretable meaning yet.',
  '### Updated analysis',
  '- Recorded by the model: **£59/month**',
  'The practical question is whether the extra **£10 per Pro customer per month** offsets any reduction in new demand and any added churn, while staying below the 4% cap.',
  'This is not yet represented in the decision model: it currently has price, churn and price-sensitivity factors, but no recorded prior-rise amount, date, or measured subscriber-loss outcome.',
];

describe('which served sentences assert a completed write', () => {
  it.each(CLAIMS)('CLAIM: %s', (s) => expect(assertsCompletedWrite(s)).toBe(true));
  it.each(NOT_CLAIMS)('NOT A CLAIM: %s', (s) => expect(assertsCompletedWrite(s)).toBe(false));
});

const APPLIED = { ok: true, mutated: true, applied: true, receipts: [{ version: 11, version_id: 'v-11', mutation_id: 'm', source_turn_id: 't' }] };
const REFUSED = { ok: false, mutated: false, refusal: 'superseded' };

describe('the write-status line is composed from the tool results', () => {
  it('RED: nothing landed + the model claims a save → the claim is removed and the server says nothing was saved', () => {
    const text = 'Applied proposal `prop_7584aa939980c0257ad2ef0b58d9f2ad` successfully. The comparison can now run.';
    const n = narrateWriteOutcome(text, [{ name: 'authorise_change' }], [REFUSED]);
    expect(n.text).not.toMatch(/Applied proposal/);
    expect(n.text).toContain('The comparison can now run.');
    expect(n.status).toMatch(/^Not saved: the model changed after this was proposed/);
    expect(n.stripped).toEqual(['Applied proposal `prop_7584aa939980c0257ad2ef0b58d9f2ad` successfully.']);
  });

  it('no write tool ran at all, but the model claims one → removed, and "Nothing was saved this turn."', () => {
    const n = narrateWriteOutcome('Added: **Competitor pricing → Monthly churn** (positive).', [{ name: 'get_canonical_state' }], [{ ok: true, mutated: false }]);
    expect(n.text).toBe('');
    expect(withWriteOutcome(n.text, n.status)).toBe('Nothing was saved this turn.');
  });

  it('applied with a receipt → the version comes from the RECEIPT, and the SERVER states it (the model’s own claim is removed)', () => {
    const n = narrateWriteOutcome('Applied all 7 assumptions. The biggest driver is churn.', [{ name: 'authorise_change' }], [APPLIED]);
    // The completion claim is the server's to make on every turn; reasoning is kept.
    expect(n.text).toBe('The biggest driver is churn.');
    expect(n.status).toBe('Saved as version 11.');
  });

  it('RED: a PARTIAL compound (values landed, levels refused) + the model claims everything saved → the claim is removed and the extent is stated', () => {
    const PARTIAL = {
      ok: false, mutated: true, applied: false, refusal: 'partially_applied',
      parts: [
        { part: 'values', ok: true, mutated: true, recorded_count: 1, requested_count: 1, receipts: [{ version: 2 }] },
        { part: 'option_levels', ok: false, mutated: false, recorded_count: 0, requested_count: 2, reason: 'unresolved_effect_relationship' },
      ],
    };
    const n = narrateWriteOutcome('Saved all values and option levels. Tech Lead now leads.', [{ name: 'authorise_change' }], [PARTIAL as never]);
    expect(n.text).not.toMatch(/Saved all values and option levels/);
    expect(n.text).toBe('Tech Lead now leads.');
    // The part's reason in words, never its code (fix/agent-never-shows-instructions-or-codes; was "(unresolved effect relationship)").
    // ⛔ And the count says what did NOT land (round-2 review): "Not saved: 0 of 2" read as "none of the 2 were not saved".
    expect(n.status).toBe('Saved 1 of 1 starting values as version 2. Not saved: none of the 2 option levels (the option does not act on that factor, so no level could be set for it).');
  });

  /**
   * ⛔ WHAT LANDED AND WHAT DID NOT, EACH COUNTED UNDER ITS OWN WORD (round-2 review of
   * fix/agent-never-shows-instructions-or-codes, blocker 1). `recorded_count` is what LANDED, so printing it under
   * "Not saved:" told the user the opposite of what happened. The input is the exact shape `applyCompound` returns when
   * its third level stops (`agent-capabilities.ts`, parts): 2 of the 3 levels WERE saved and 1 was not — the user read
   * "Not saved: 2 of 3 option levels."
   */
  describe('a part that landed only in part says how many were saved AND how many were not', () => {
    const status = (parts: Record<string, unknown>[]) =>
      narrateWriteOutcome('', [{ name: 'authorise_change' }], [{ ok: false, mutated: true, applied: false, refusal: 'partially_applied', parts } as never]).status;

    it('RED (#2004 B1\'s `links` part, served shape): a link that landed before its level was refused is SAID as a link, never "changes"', () => {
      expect(status([
        { part: 'links', ok: true, recorded_count: 1, requested_count: 1 },
        { part: 'option_levels', ok: false, recorded_count: 0, requested_count: 1 },
      ])).toBe('Saved 1 of 1 links. Not saved: the option level.');
    });

    it('RED (the reviewer\'s input, verbatim): values 4 of 4, levels 2 of 3 → "Saved 2 of 3 option levels; 1 was not saved."', () => {
      expect(status([
        { part: 'values', ok: true, recorded_count: 4, requested_count: 4 },
        { part: 'option_levels', ok: false, recorded_count: 2, requested_count: 3 },
      ])).toBe('Saved 4 of 4 starting values. Saved 2 of 3 option levels; 1 was not saved.');
    });

    it('RED: 1 of 4 landed → "3 were not saved" (the missing count, pluralised), never "Not saved: 1 of 4"', () => {
      expect(status([{ part: 'option_levels', ok: false, recorded_count: 1, requested_count: 4 }]))
        .toBe('Saved 1 of 4 option levels; 3 were not saved.');
    });

    it('RED: 0 of 1 landed → "Not saved: the option level." (no count the user could misread)', () => {
      expect(status([{ part: 'option_levels', ok: false, recorded_count: 0, requested_count: 1 }]))
        .toBe('Not saved: the option level.');
    });

    it('RED: a part name nobody has worded is never shown as a code', () => {
      const s = String(status([{ part: 'some_new_part', ok: false, recorded_count: 0, requested_count: 2 }]));
      expect(s).toBe('Not saved: none of the 2 changes.');
    });

    it('CONTRAST (passes at base): every part landed → "Saved N of N" for each, unchanged', () => {
      expect(narrateWriteOutcome('', [{ name: 'authorise_change' }], [{ ok: true, mutated: true, applied: true, parts: [
        { part: 'values', ok: true, recorded_count: 3, requested_count: 3 },
        { part: 'option_levels', ok: true, recorded_count: 2, requested_count: 2 },
      ] } as never]).status).toBe('Saved 3 of 3 starting values. Saved 2 of 2 option levels.');
    });
  });

  it('already applied → says so, with the original version, and that nothing was written again', () => {
    const n = narrateWriteOutcome('', [{ name: 'authorise_change' }], [{ ok: true, mutated: false, applied: true, already_applied: true, receipts: [{ version: 4 }] }]);
    expect(n.status).toBe('That change was already saved (version 4); nothing was written again.');
  });

  it('CONTRAST: a turn that neither wrote nor claimed to adds no status line and changes no words', () => {
    const text = 'Nothing has been changed yet. Approve this specific link if you want it added.';
    const n = narrateWriteOutcome(text, [{ name: 'propose_model_change' }], [{ ok: true, mutated: false, proposal_id: 'prop_1' }]);
    expect(n.text).toBe(text);
    expect(n.status).toBeNull();
  });
});

/* ── the ROUTE: the model's claim never reaches the user when nothing was written ── */
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

describe('the route states what was saved', () => {
  let app: FastifyInstance;
  let call = 0;
  beforeAll(async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      call += 1;
      const output = call === 1
        ? [{ type: 'function_call', name: 'authorise_change', arguments: JSON.stringify({ proposal_id: 'prop_nope' }), call_id: 'c1' }]
        : [{ type: 'message', content: [{ type: 'output_text', text: 'Applied proposal `prop_nope` successfully. Your model is ready.' }] }];
      return new Response(JSON.stringify({ output }), { status: 200 });
    }));
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

  it('RED: authorise refused + the model says "Applied…successfully" → the user sees NO save claim, and the refusal', async () => {
    const res = await app.inject({ method: 'POST', url: '/agent/v1/turn', payload: { kind: 'message', scenario_id: '6f1c2a3b-4d5e-4f60-8a7b-9c0d1e2f3a4b', message: 'Yes, apply it.' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { assistant_text: string; _agent: { tool_calls: { name: string; ok: boolean; refusal?: string }[] }; _diagnostic_trace: { write_claims_removed?: number } };
    expect(body._agent.tool_calls).toEqual([{ name: 'authorise_change', ok: false, mutated: false, refusal: 'unknown_proposal' }]);
    expect(body.assistant_text).not.toMatch(/Applied proposal/);
    expect(body.assistant_text).toMatch(/Not saved: that proposal is no longer available, so nothing was changed/);
    expect(body._diagnostic_trace.write_claims_removed).toBe(1);
  });
});

/* ── Panel N7: what compaction left out is stated by the server, as ideas to add back ── */
describe('a compact build names what it left out', () => {
  const built = (extra: Record<string, unknown>) =>
    narrateWriteOutcome('Here is your model.', [{ name: 'build_model_from_brief' }], [{ ok: true, mutated: true, model_version: { version_number: 1 }, ...extra }]);

  it('RED: the status line lists the left-out items and offers to add them back', () => {
    const n = built({ left_out_to_stay_compact: [{ kind: 'factor', label: 'Team morale' }, { kind: 'risk', label: 'Key-person dependency' }] });
    expect(n.status).toBe('The model was saved as version 1. To keep it readable, I left out: Team morale; Key-person dependency. Ask me to add any of them back.');
  });

  it('a long list is capped at five, with the remainder counted', () => {
    const items = Array.from({ length: 8 }, (_, i) => ({ kind: 'factor', label: `Factor ${i + 1}` }));
    expect(built({ left_out_to_stay_compact: items }).status).toMatch(/I left out: Factor 1; Factor 2; Factor 3; Factor 4; Factor 5; and 3 more\. Ask me/);
  });

  it('RED: the questions the build parked are stated as what the model does not answer yet', () => {
    const n = built({ open_questions: ['Is the bottleneck coordination or capacity?', 'What does onboarding cost the team?'] });
    expect(n.status).toBe('The model was saved as version 1. Questions this model does not answer yet: Is the bottleneck coordination or capacity? What does onboarding cost the team?');
  });

  it('CONTRAST: nothing left out → the save line alone', () => {
    expect(built({}).status).toBe('The model was saved as version 1.');
    expect(built({ left_out_to_stay_compact: [] }).status).toBe('The model was saved as version 1.');
  });
});
