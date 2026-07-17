/**
 * orchestrator-eval — SEAM-1 candidate-evaluation test suite.
 *
 * What this file PROVES (and how it stays honest):
 *
 *   1. FAIL-CLOSED GATE — live mode needs BOTH the env key and the --live
 *      flag; each combination is pinned. MUTATION-CHECK: delete the env-key
 *      check in live-gate.ts and the zero-network test below goes RED (the
 *      pipeline would construct the real model factory and hit the fetch
 *      counter). Performed and verified in a throwaway tree before merge.
 *
 *   2. ZERO NETWORK ON THE DEFAULT PATH — a fetch counter wraps
 *      globalThis.fetch for every test here; the default/offline runs must
 *      leave it at 0. POSITIVE CONTROL (per the "an absence assertion needs a
 *      positive control" rule): the injected-live test proves the SAME
 *      counter observes calls when the pipeline is opted in — so a 0 is a
 *      measured absence, not a blind instrument.
 *
 *   3. END-TO-END MOCK PIPELINE — produce (mock playback) -> extract (v30.3
 *      envelope) -> score (the real five-dimension scorer) -> rank, across
 *      every checked-in fixture, offline.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  buildCandidateRequest,
  extractAssistantText,
  runCandidateEval,
  type CandidateModel,
} from '../src/candidate-run.js';
import { enforceTurnCap, HARD_MAX_LIVE_TURNS_PER_RUN, LIVE_ENV_KEY, resolveLiveGate } from '../src/live-gate.js';
import { parsePromptSpec } from '../src/prompt-source.js';
import { loadFixtures } from '../src/run.js';

// ── network instrument: every test in this file runs under this counter ─────
let fetchCalls = 0;
const countingFetch = vi.fn(async (..._args: unknown[]) => {
  fetchCalls += 1;
  throw new Error('network disabled in orchestrator-eval tests');
});

let promptDir: string;
let promptFile: string;

beforeAll(() => {
  promptDir = mkdtempSync(join(tmpdir(), 'orchestrator-eval-candidate-'));
  promptFile = join(promptDir, 'candidate-prompt.txt');
  writeFileSync(promptFile, 'You are the Olumi decision orchestrator. Answer honestly.');
});

afterAll(() => {
  rmSync(promptDir, { recursive: true, force: true });
});

beforeEach(() => {
  fetchCalls = 0;
  vi.stubGlobal('fetch', countingFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const goalFitFixture = () => {
  const fx = loadFixtures().find((f) => f.id === 'goal-fit-conflation');
  if (!fx) throw new Error('goal-fit-conflation fixture not found');
  return fx;
};

describe('live gate — fail-closed double opt-in', () => {
  it('OFF by default (no env key, no flag)', () => {
    const r = resolveLiveGate({ env: {}, argv: [] });
    expect(r.live).toBe(false);
  });

  it('flag alone is refused, naming the missing env key', () => {
    const r = resolveLiveGate({ env: {}, argv: ['--live'] });
    expect(r.live).toBe(false);
    expect(r.reason).toContain(LIVE_ENV_KEY);
  });

  it('env key alone is refused, naming the missing flag', () => {
    const r = resolveLiveGate({ env: { [LIVE_ENV_KEY]: '1' }, argv: [] });
    expect(r.live).toBe(false);
    expect(r.reason).toContain('--live');
  });

  it('env key values other than "1" do not count', () => {
    const r = resolveLiveGate({ env: { [LIVE_ENV_KEY]: 'true' }, argv: ['--live'] });
    expect(r.live).toBe(false);
  });

  it('ON only when both halves are present', () => {
    const r = resolveLiveGate({ env: { [LIVE_ENV_KEY]: '1' }, argv: ['--live'] });
    expect(r.live).toBe(true);
  });
});

describe('cost guard — hard per-run turn cap', () => {
  it('allows a plan at the hard cap and refuses one over it', () => {
    expect(() => enforceTurnCap(HARD_MAX_LIVE_TURNS_PER_RUN)).not.toThrow();
    expect(() => enforceTurnCap(HARD_MAX_LIVE_TURNS_PER_RUN + 1)).toThrow(/exceed the cap/);
  });

  it('--max-turns can only LOWER the cap, never raise it', () => {
    expect(() => enforceTurnCap(12, 5)).toThrow(/exceed the cap/);
    expect(() => enforceTurnCap(HARD_MAX_LIVE_TURNS_PER_RUN + 6, 999)).toThrow(/exceed the cap/);
  });

  it('rejects nonsense --max-turns values', () => {
    expect(() => enforceTurnCap(1, 0)).toThrow(/positive integer/);
    expect(() => enforceTurnCap(1, 1.5)).toThrow(/positive integer/);
  });
});

describe('prompt refs', () => {
  it('parses file refs eagerly (typo fails before any turn is planned)', () => {
    const spec = parsePromptSpec(`A=${promptFile}`);
    expect(spec.kind).toBe('file');
    expect(spec.promptText).toContain('decision orchestrator');
    expect(() => parsePromptSpec('A=/nonexistent/prompt.txt')).toThrow();
  });

  it('parses mock and pms refs; rejects malformed values', () => {
    expect(parsePromptSpec('A=mock:good')).toMatchObject({ kind: 'mock', mockLabel: 'good' });
    expect(parsePromptSpec('B=pms:115')).toMatchObject({ kind: 'pms', pmsVersion: 115 });
    expect(() => parsePromptSpec('no-equals')).toThrow(/label>=<ref/);
    expect(() => parsePromptSpec('A=pms:not-a-number')).toThrow(/positive integer/);
    expect(() => parsePromptSpec('A=mock:')).toThrow(/recorded-candidate label/);
  });
});

describe('request shaping + extraction (the SEAM-1 wire shape)', () => {
  it('system = candidate prompt + TURN_CONTEXT with the ASSEMBLED analysis', () => {
    const { system, user } = buildCandidateRequest(goalFitFixture(), 'CANDIDATE PROMPT TEXT');
    expect(system.startsWith('CANDIDATE PROMPT TEXT')).toBe(true);
    expect(system).toContain('<TURN_CONTEXT>');
    // Assembled (production-formatter) values, not raw probabilities: the
    // prompt is grounded on the same projection the runtime uses.
    expect(system).toContain('"win_probability": "89%"');
    expect(system).toContain('"target_fit": "29%"');
    expect(user).toContain('Respond with valid JSON only.');
  });

  it('extracts `text` from the v30.3 envelope, fenced or bare', () => {
    const bare = extractAssistantText('{"text":"hello","insights":[],"recommended_actions":[]}');
    expect(bare).toEqual({ text: 'hello', extraction: 'json_text' });
    const fenced = extractAssistantText('```json\n{"text":"hi","insights":[],"recommended_actions":[]}\n```');
    expect(fenced).toEqual({ text: 'hi', extraction: 'json_text' });
  });

  it('falls back to the RAW output — flagged, never silent — when the envelope does not parse', () => {
    const r = extractAssistantText('plain prose, no JSON');
    expect(r.extraction).toBe('raw_unparsed');
    expect(r.text).toBe('plain prose, no JSON');
  });
});

describe('ZERO NETWORK on the default path (mutation-checked)', () => {
  it('a file-ref candidate without the env key is refused BEFORE any model call — zero fetch', async () => {
    // A dummy key is deliberately present: if the gate were mutated away, the
    // pipeline would construct the real provider and hit the fetch counter —
    // that is exactly the RED this test is built to produce under mutation.
    vi.stubEnv('ANTHROPIC_API_KEY', 'test-dummy-key-never-real');
    vi.stubEnv(LIVE_ENV_KEY, '');

    await expect(
      runCandidateEval({
        specs: [parsePromptSpec(`A=${promptFile}`)],
        fixtures: [goalFitFixture()],
        gateInput: { env: { ...process.env }, argv: ['--live'] }, // flag alone — must NOT go live
        modelId: 'claude-test-model',
      }),
    ).rejects.toThrow(/live mode is off/);

    expect(fetchCalls).toBe(0);
  });

  it('a pms-ref candidate is refused offline the same way — zero fetch', async () => {
    await expect(
      runCandidateEval({
        specs: [parsePromptSpec('A=pms:115')],
        fixtures: [goalFitFixture()],
        gateInput: { env: {}, argv: [] },
      }),
    ).rejects.toThrow(/live mode is off/);
    expect(fetchCalls).toBe(0);
  });

  it('the turn cap fires BEFORE any call — zero fetch even when opted in', async () => {
    vi.stubEnv(LIVE_ENV_KEY, '1');
    const factory = vi.fn();
    await expect(
      runCandidateEval({
        specs: [parsePromptSpec(`A=${promptFile}`)],
        fixtures: Array.from({ length: HARD_MAX_LIVE_TURNS_PER_RUN + 1 }, () => goalFitFixture()),
        gateInput: { env: { [LIVE_ENV_KEY]: '1' }, argv: ['--live'] },
        modelId: 'claude-test-model',
        createLiveModel: factory,
      }),
    ).rejects.toThrow(/exceed the cap/);
    expect(factory).not.toHaveBeenCalled();
    expect(fetchCalls).toBe(0);
  });
});

describe('POSITIVE CONTROL — the fetch counter can see a presence', () => {
  it('an opted-in run with a network-touching model registers on the SAME counter', async () => {
    vi.stubEnv(LIVE_ENV_KEY, '1');
    // Injected factory: touches globalThis.fetch (the instrumented seam) once
    // per turn, then returns a well-formed envelope. Hermetic — the counting
    // stub throws, so nothing can reach a real network even here.
    const probeModel: CandidateModel = async () => {
      try {
        await fetch('https://positive-control.invalid/probe');
      } catch {
        // the counting stub throws by design; the count is what matters
      }
      return {
        ok: true,
        text: JSON.stringify({
          text: 'Raising prices wins 89% of the time but is only about 29% likely to meet the £20k target.',
          insights: [],
          recommended_actions: [],
        }),
        error: null,
      };
    };

    const report = await runCandidateEval({
      specs: [parsePromptSpec(`A=${promptFile}`)],
      fixtures: [goalFitFixture()],
      gateInput: { env: { [LIVE_ENV_KEY]: '1' }, argv: ['--live'] },
      modelId: 'probe-model',
      createLiveModel: async () => probeModel,
    });

    expect(fetchCalls).toBe(1); // the instrument SEES presences → its zeros are meaningful
    expect(report.live).toBe(true);
    expect(report.model).toBe('probe-model');
    expect(report.candidates[0]?.results[0]?.extraction).toBe('json_text');
    expect(report.candidates[0]?.results[0]?.pass).toBe(true);
  });
});

describe('END-TO-END offline mock pipeline (the dry-run proof)', () => {
  it('a good-candidate arm passes on EVERY checked-in fixture, zero network', async () => {
    // Every fixture ships a recorded `good` candidate with expected=true.
    const fixtures = loadFixtures();
    const report = await runCandidateEval({
      specs: [parsePromptSpec('good-arm=mock:good')],
      fixtures,
      gateInput: { env: {}, argv: [] },
    });

    expect(report.live).toBe(false);
    expect(report.turnsUsed).toBe(fixtures.length);
    expect(fetchCalls).toBe(0);
    expect(report.candidates[0]?.passCount).toBe(fixtures.length);
    // The extraction path (v30.3 envelope) is exercised on every mock turn.
    for (const r of report.candidates[0]?.results ?? []) expect(r.extraction).toBe('json_text');
  });

  it('ranks a good arm above a regression arm on the fixtures that carry both, zero network', async () => {
    // `stale-and-recommendation-vocabulary` labels its regressions
    // `regression_stale`/`regression_recommendation`, so the A/B runs over the
    // fixtures that carry a `regression` label (5 of 6 today) — mock playback
    // is by exact label, and a missing label fails VISIBLY (tested below).
    const fixtures = loadFixtures().filter((f) => f.candidates.some((c) => c.label === 'regression'));
    expect(fixtures.length).toBeGreaterThanOrEqual(2);

    const report = await runCandidateEval({
      specs: [parsePromptSpec('good-arm=mock:good'), parsePromptSpec('regression-arm=mock:regression')],
      fixtures,
      gateInput: { env: {}, argv: [] },
    });

    expect(report.live).toBe(false);
    expect(report.turnsUsed).toBe(2 * fixtures.length);
    expect(fetchCalls).toBe(0);

    const good = report.candidates.find((c) => c.label === 'good-arm');
    const bad = report.candidates.find((c) => c.label === 'regression-arm');
    if (!good || !bad) throw new Error('missing candidate reports');

    expect(good.passCount).toBe(fixtures.length);
    expect(bad.passCount).toBe(0);
    expect(report.ranking).toEqual(['good-arm', 'regression-arm']);

    for (const c of report.candidates) {
      for (const r of c.results) expect(r.extraction).toBe('json_text');
    }
  });

  it('a mock ref naming a candidate a fixture does not carry fails VISIBLY (model_error), not silently', async () => {
    const report = await runCandidateEval({
      specs: [parsePromptSpec('x=mock:not-a-real-label')],
      fixtures: [goalFitFixture()],
      gateInput: { env: {}, argv: [] },
    });
    expect(report.candidates[0]?.results[0]?.extraction).toBe('model_error');
    expect(report.candidates[0]?.results[0]?.pass).toBe(false);
    expect(report.candidates[0]?.results[0]?.error).toContain('not-a-real-label');
    expect(fetchCalls).toBe(0);
  });

  it('duplicate candidate labels are refused', async () => {
    await expect(
      runCandidateEval({
        specs: [parsePromptSpec('a=mock:good'), parsePromptSpec('a=mock:regression')],
        fixtures: [goalFitFixture()],
        gateInput: { env: {}, argv: [] },
      }),
    ).rejects.toThrow(/unique/);
  });
});
