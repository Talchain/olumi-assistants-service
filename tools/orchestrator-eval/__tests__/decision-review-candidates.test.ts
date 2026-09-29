/**
 * decision_review through SEAM-1 — the chassis guarantees must be INHERITED,
 * not reimplemented.
 *
 * The task-adapter seam exists so a second task cannot opt out of the
 * fail-closed live gate, the pre-call turn cap, or the extraction contract. A
 * seam nobody tests is a seam that can quietly grow an exception, so this file
 * re-proves each guarantee THROUGH the decision_review adapter rather than
 * assuming the routing tests cover it.
 *
 * Every test in this file runs under a fetch counter that throws on any network
 * call, with a POSITIVE CONTROL proving the counter can actually see a call.
 * Without that control the zero-network assertions would pass on a counter that
 * was never wired up — the same vacuity the pack's absence dimensions guard
 * against, one level up.
 */

import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCandidateEval, ROUTING_ADAPTER, type CandidateModel } from '../src/candidate-run.js';
import { DECISION_REVIEW_ADAPTER } from '../src/decision-review/adapter.js';
import { loadDecisionReviewFixtures } from '../src/decision-review/run.js';
import { HARD_MAX_LIVE_TURNS_PER_RUN, LIVE_ENV_KEY } from '../src/live-gate.js';
import { parsePromptSpec, type CandidatePromptSpec } from '../src/prompt-source.js';
import { DECISION_REVIEW_DIMENSIONS } from '../src/decision-review/scorer.js';

// ── network instrument: every test in this file runs under this counter ─────
let fetchCalls = 0;
const countingFetch = vi.fn(async (..._args: unknown[]) => {
  fetchCalls += 1;
  throw new Error('network disabled in decision_review eval tests');
});
const realFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = countingFetch as unknown as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = realFetch;
});
beforeEach(() => {
  fetchCalls = 0;
});
afterEach(() => {
  delete process.env[LIVE_ENV_KEY];
});

const fixtures = loadDecisionReviewFixtures();
const OFFLINE = { env: {}, argv: ['node', 'cli'] } as const;

/**
 * A file-kind candidate spec built in memory. `parsePromptSpec` reads a file
 * ref eagerly (so a typo fails before any turn is planned), which is the right
 * behaviour for the CLI and the wrong one for a test that only needs the SHAPE
 * of a live candidate. Constructing the spec keeps these tests off the
 * filesystem entirely.
 */
const fileSpec = (label: string, promptText: string): CandidatePromptSpec => ({
  label,
  ref: 'test://in-memory-candidate',
  kind: 'file',
  promptText,
  mockLabel: null,
  pmsVersion: null,
});

describe('the fetch counter can see a call (POSITIVE CONTROL)', () => {
  it('counts a deliberate fetch', async () => {
    await expect(globalThis.fetch('https://example.invalid')).rejects.toThrow();
    expect(fetchCalls).toBe(1);
  });
});

describe('offline mock playback', () => {
  it('scores every fixture with ZERO network calls', async () => {
    const report = await runCandidateEval({
      specs: [parsePromptSpec('A=mock:good')],
      adapter: DECISION_REVIEW_ADAPTER,
      fixtures,
      gateInput: OFFLINE,
    });
    expect(fetchCalls).toBe(0);
    expect(report.task).toBe('decision_review');
    expect(report.live).toBe(false);
    expect(report.model).toBeNull();
    expect(report.turnsUsed).toBe(fixtures.length);
    expect(report.candidates[0].passCount).toBe(fixtures.length);
  });

  it('exercises the JSON extraction path even in mock mode', async () => {
    // Fixtures store the output OBJECT; playback re-serialises it, so a mock run
    // proves the plumbing, not just the scorer. If playback ever short-circuited
    // straight to the object, `extraction` would not be `json_text`.
    const report = await runCandidateEval({
      specs: [parsePromptSpec('A=mock:good')],
      adapter: DECISION_REVIEW_ADAPTER,
      fixtures,
      gateInput: OFFLINE,
    });
    for (const r of report.candidates[0].results) expect(r.extraction).toBe('json_text');
  });

  it('ranks a seeded-bad arm BELOW the good arm', async () => {
    const withTone = fixtures.filter((f) => f.candidates.some((c) => c.label === 'tone_breach'));
    const report = await runCandidateEval({
      specs: [parsePromptSpec('good=mock:good'), parsePromptSpec('bad=mock:tone_breach')],
      adapter: DECISION_REVIEW_ADAPTER,
      fixtures: withTone,
      gateInput: OFFLINE,
    });
    expect(report.ranking[0]).toBe('good');
    expect(fetchCalls).toBe(0);
  });
});

describe('the live gate is INHERITED, not re-decided', () => {
  it('refuses a file/pms candidate when the gate is off — no network call', async () => {
    await expect(
      runCandidateEval({
        specs: [parsePromptSpec('A=pms:14')],
        adapter: DECISION_REVIEW_ADAPTER,
        fixtures,
        gateInput: OFFLINE,
      }),
    ).rejects.toThrow(/require LIVE model production/);
    expect(fetchCalls).toBe(0);
  });

  it('refuses on the env half alone', async () => {
    await expect(
      runCandidateEval({
        specs: [parsePromptSpec('A=pms:14')],
        adapter: DECISION_REVIEW_ADAPTER,
        fixtures,
        gateInput: { env: { [LIVE_ENV_KEY]: '1' }, argv: ['node', 'cli'] },
      }),
    ).rejects.toThrow(/require LIVE model production/);
    expect(fetchCalls).toBe(0);
  });

  it('refuses on the flag half alone', async () => {
    await expect(
      runCandidateEval({
        specs: [parsePromptSpec('A=pms:14')],
        adapter: DECISION_REVIEW_ADAPTER,
        fixtures,
        gateInput: { env: {}, argv: ['node', 'cli', '--live'] },
      }),
    ).rejects.toThrow(/require LIVE model production/);
    expect(fetchCalls).toBe(0);
  });
});

describe('the turn cap is INHERITED', () => {
  it('refuses an over-cap plan BEFORE any call, rather than truncating it', async () => {
    const specs = Array.from({ length: 5 }, (_, i) => parsePromptSpec(`c${i}=mock:good`));
    // 5 candidates x 7 fixtures = 35 > 24.
    expect(specs.length * fixtures.length).toBeGreaterThan(HARD_MAX_LIVE_TURNS_PER_RUN);
    await expect(
      runCandidateEval({ specs, adapter: DECISION_REVIEW_ADAPTER, fixtures, gateInput: OFFLINE }),
    ).rejects.toThrow(/exceed the cap/);
    expect(fetchCalls).toBe(0);
  });

  it('--max-turns can only LOWER the cap', async () => {
    await expect(
      runCandidateEval({
        specs: [parsePromptSpec('A=mock:good')],
        adapter: DECISION_REVIEW_ADAPTER,
        fixtures,
        gateInput: OFFLINE,
        maxTurns: 3,
      }),
    ).rejects.toThrow(/exceed the cap \(3/);
  });
});

describe('the extraction contract is INHERITED (fail-closed)', () => {
  it('a non-JSON live response is a FAILED turn, flagged, not skipped', async () => {
    const prose: CandidateModel = async () => ({ ok: true, text: 'Here is my review in prose.', error: null });
    const report = await runCandidateEval({
      specs: [fileSpec('A', 'CANDIDATE PROMPT')],
      adapter: DECISION_REVIEW_ADAPTER,
      fixtures: fixtures.slice(0, 1),
      gateInput: { env: { [LIVE_ENV_KEY]: '1' }, argv: ['node', 'cli', '--live'] },
      modelId: 'test-model',
      createLiveModel: async () => prose,
    });
    const result = report.candidates[0].results[0];
    expect(result.extraction).toBe('raw_unparsed');
    expect(result.pass).toBe(false);
    expect(report.candidates[0].flaggedTurnCount).toBe(1);
    // Fail-closed substance: no output was extractable, so the turn counts as
    // EMPTY rather than as prose that happened not to parse.
    expect(report.candidates[0].substanceFailedTurnCount).toBe(1);
    expect(result.score?.dimensions.find((d) => d.name === 'extraction_contract')?.pass).toBe(false);
  });

  it('a JSON ARRAY is raw_unparsed — the contract is an OBJECT', async () => {
    const arr: CandidateModel = async () => ({ ok: true, text: '[{"narrative_summary":"x"}]', error: null });
    const report = await runCandidateEval({
      specs: [fileSpec('A', 'CANDIDATE PROMPT')],
      adapter: DECISION_REVIEW_ADAPTER,
      fixtures: fixtures.slice(0, 1),
      gateInput: { env: { [LIVE_ENV_KEY]: '1' }, argv: ['node', 'cli', '--live'] },
      modelId: 'test-model',
      createLiveModel: async () => arr,
    });
    expect(report.candidates[0].results[0].extraction).toBe('raw_unparsed');
  });

  it('a fenced JSON object still parses (real models fence anyway)', async () => {
    const fixture = fixtures[0];
    const good = fixture.candidates.find((c) => c.label === 'good')!;
    const fenced: CandidateModel = async () => ({
      ok: true,
      text: '```json\n' + JSON.stringify(good.output) + '\n```',
      error: null,
    });
    const report = await runCandidateEval({
      specs: [fileSpec('A', 'CANDIDATE PROMPT')],
      adapter: DECISION_REVIEW_ADAPTER,
      fixtures: [fixture],
      gateInput: { env: { [LIVE_ENV_KEY]: '1' }, argv: ['node', 'cli', '--live'] },
      modelId: 'test-model',
      createLiveModel: async () => fenced,
    });
    expect(report.candidates[0].results[0].extraction).toBe('json_text');
    expect(report.candidates[0].results[0].pass).toBe(true);
  });
});

describe('the live request is built by the PRODUCTION assembler', () => {
  it('system = candidate prompt, user = the assembled review message', async () => {
    // The runtime arrangement: getSystemPrompt('decision_review') as system,
    // buildDecisionReviewUserMessage(...) as user. A candidate measured in the
    // wrong slot is not measured at all.
    const seen: Array<{ system: string; user: string }> = [];
    const capture: CandidateModel = async (system, user) => {
      seen.push({ system, user });
      const good = fixtures[0].candidates.find((c) => c.label === 'good')!;
      return { ok: true, text: JSON.stringify(good.output), error: null };
    };
    await runCandidateEval({
      specs: [fileSpec('A', 'CANDIDATE PROMPT TEXT')],
      adapter: DECISION_REVIEW_ADAPTER,
      fixtures: fixtures.slice(0, 1),
      gateInput: { env: { [LIVE_ENV_KEY]: '1' }, argv: ['node', 'cli', '--live'] },
      modelId: 'test-model',
      createLiveModel: async () => capture,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].system).toBe('CANDIDATE PROMPT TEXT');
    expect(seen[0].user).toContain('<BRIEF>');
    expect(seen[0].user).toContain('<DECISION_CONTEXT>');
    // The routing chassis wraps its context in <TURN_CONTEXT> inside the SYSTEM
    // message. decision_review must NOT inherit that shape.
    expect(seen[0].system).not.toContain('<TURN_CONTEXT>');
  });
});

describe('the live path SELF-WITNESSES the prompt it sent (P1b)', () => {
  it('records the sha256 prefix of the prompt text actually sent', async () => {
    // Attribution-by-pointer is not attribution: the first baseline said "the
    // served v14 prompt" on the strength of a manifest pointer read days
    // earlier, which is trap 12c exactly (stagingVersion read 120 while turns
    // were served 119). A run that hashes what it sent is tied to BYTES.
    const capture: CandidateModel = async () => {
      const good = fixtures[0].candidates.find((c) => c.label === 'good')!;
      return { ok: true, text: JSON.stringify(good.output), error: null };
    };
    const report = await runCandidateEval({
      specs: [fileSpec('A', 'CANDIDATE PROMPT TEXT')],
      adapter: DECISION_REVIEW_ADAPTER,
      fixtures: fixtures.slice(0, 1),
      gateInput: { env: { [LIVE_ENV_KEY]: '1' }, argv: ['node', 'cli', '--live'] },
      modelId: 'test-model',
      createLiveModel: async () => capture,
    });
    const sha = report.candidates[0].promptSha16;
    expect(sha).toMatch(/^[0-9a-f]{16}$/);
    // sha256("CANDIDATE PROMPT TEXT") — pinned, so a change to what gets hashed
    // (e.g. hashing the assembled request instead of the prompt) turns this RED.
    expect(sha).toBe(
      createHash('sha256').update('CANDIDATE PROMPT TEXT', 'utf-8').digest('hex').slice(0, 16),
    );
  });

  it('is null for a mock arm, which sends no prompt', async () => {
    const report = await runCandidateEval({
      specs: [parsePromptSpec('A=mock:good')],
      adapter: DECISION_REVIEW_ADAPTER,
      fixtures: fixtures.slice(0, 1),
      gateInput: OFFLINE,
    });
    expect(report.candidates[0].promptSha16).toBeNull();
  });
});

describe('the routing task is untouched by the seam', () => {
  it('defaults to the routing adapter when none is given', async () => {
    const report = await runCandidateEval({
      specs: [parsePromptSpec('A=mock:good')],
      fixtures: ROUTING_ADAPTER.loadFixtures(),
      gateInput: OFFLINE,
    });
    expect(report.task).toBe('routing');
    expect(fetchCalls).toBe(0);
  });

  it('scores routing with the ROUTING dimensions, not the decision_review ones', async () => {
    // The mis-scoring this guards against is silent: a decision_review fixture
    // scored with routing prose dimensions would still produce a number.
    const report = await runCandidateEval({
      specs: [parsePromptSpec('A=mock:good')],
      fixtures: ROUTING_ADAPTER.loadFixtures(),
      gateInput: OFFLINE,
    });
    const names = report.candidates[0].results[0].score!.dimensions.map((d) => d.name);
    expect(names).toContain('no_goal_fit_conflation');
    expect(names).not.toContain('story_headlines_match_options');
  });

  it('and decision_review is scored with ITS dimensions', async () => {
    const report = await runCandidateEval({
      specs: [parsePromptSpec('A=mock:good')],
      adapter: DECISION_REVIEW_ADAPTER,
      fixtures: fixtures.slice(0, 1),
      gateInput: OFFLINE,
    });
    const names = report.candidates[0].results[0].score!.dimensions.map((d) => d.name);
    for (const d of DECISION_REVIEW_DIMENSIONS) expect(names).toContain(d);
    expect(names).not.toContain('no_goal_fit_conflation');
  });
});
