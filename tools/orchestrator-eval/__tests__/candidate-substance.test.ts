/**
 * orchestrator-eval — SUBSTANCE + flagged-extraction scoring (the reviewer's
 * three-arm defect, pinned as a permanent fixture).
 *
 * THE DEFECT (confirmed at fb7993636, reviewer-constructed, injected model,
 * zero network, all 6 fixtures): every floor-pack dimension is an ABSENCE
 * check, so repurposing the pack as a RANKING rewarded emptiness —
 *
 *   - an EMPTY envelope ({"text":""}) scored 6/6 PASS, unflagged
 *     (extraction=json_text) and ranked FIRST;
 *   - a GARBAGE arm (plain prose, flagged raw_unparsed on every turn) also
 *     scored 6/6;
 *   - an HONEST arm tripping one forbidden-terms dimension scored 5/6 and
 *     ranked LAST.
 *
 *   RANKING: empty > garbage > honest.
 *
 * Empty answer_text is EXACTLY the live prompt-defect class measured
 * pre-v42.2g (0/6 populated): a coach-arm candidate that regressed to empty
 * text would have WON the A/B this seam exists to gate.
 *
 * THE PIN (this file goes RED if either mechanism is disabled):
 *
 *   1. SUBSTANCE dimension (`substance_present`, scorer.ts): empty /
 *      whitespace-only scored text fails the dimension. Fail-closed in
 *      candidate-run.ts: an unextractable (raw_unparsed) turn counts as
 *      EMPTY, never as absent-from-scoring.
 *   2. FLAGGED TURNS ARE SCORED (`extraction_contract`, candidate-run.ts): a
 *      raw_unparsed turn fails the extraction-contract dimension, so it can
 *      never be a PASS — and `flaggedTurnCount` is a ranking key ahead of
 *      failedDimensionCount, so a flagged arm never ties past an unflagged
 *      one. Direction invariant: a flagged turn never ranks above an
 *      unflagged honest one.
 *
 * MUTATION-CHECK (throwaway worktree, performed before merge): force
 * `substance_present` to pass in scorer.ts -> the empty-arm assertions below
 * go RED (empty is 6/6 again); force `extraction_contract` to pass in
 * candidate-run.ts -> the garbage-arm assertions go RED.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCandidateEval, type CandidateEvalReport, type CandidateModel } from '../src/candidate-run.js';
import { parsePromptSpec } from '../src/prompt-source.js';
import { loadFixtures } from '../src/run.js';
import { scoreCandidate } from '../src/scorer.js';

// ── network instrument (same discipline as candidate-eval.test.ts) ──────────
let fetchCalls = 0;
const countingFetch = vi.fn(async (..._args: unknown[]) => {
  fetchCalls += 1;
  throw new Error('network disabled in orchestrator-eval tests');
});

beforeEach(() => {
  fetchCalls = 0;
  vi.stubGlobal('fetch', countingFetch);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

// ── the three arms, reconstructed exactly as the reviewer built them ─────────
// Injected model dispatching on the candidate prompt text (each arm is a file
// ref whose content names the arm); per-fixture honest text comes from the
// fixture's own recorded `good` candidate, keyed by user_message.

const JSON_FORCING_SUFFIX = '\n\nRespond with valid JSON only.';
const envelope = (text: string): string => JSON.stringify({ text, insights: [], recommended_actions: [] });

const GARBAGE_PROSE = 'Plainly, the weather is lovely and the options all seem fine to me today.';
// The honest arm's single defect: a forbidden-terms trip ("ContextPack" is on
// the runtime FORBIDDEN_STRINGS list) on exactly one fixture.
const HONEST_TRIPPED_TEXT =
  'The ContextPack shows raising prices wins 89% of the time but is only about 29% likely to meet the £20k target.';

let promptDir: string;
let armFiles: { empty: string; garbage: string; honest: string };

beforeAll(() => {
  promptDir = mkdtempSync(join(tmpdir(), 'orchestrator-eval-substance-'));
  const arm = (name: string): string => {
    const p = join(promptDir, `${name}.txt`);
    writeFileSync(p, `ARM:${name}`);
    return p;
  };
  armFiles = { empty: arm('empty'), garbage: arm('garbage'), honest: arm('honest') };
});

afterAll(() => {
  rmSync(promptDir, { recursive: true, force: true });
});

async function runThreeArms(): Promise<CandidateEvalReport> {
  const fixtures = loadFixtures();
  const goodTextByUserMessage = new Map(
    fixtures.map((f) => {
      const good = f.candidates.find((c) => c.label === 'good');
      if (!good) throw new Error(`fixture ${f.id} has no recorded good candidate`);
      return [f.user_message, good.text] as const;
    }),
  );
  const tripped = fixtures.find((f) => f.id === 'goal-fit-conflation');
  if (!tripped) throw new Error('goal-fit-conflation fixture not found');

  const model: CandidateModel = async (system, user) => {
    if (system.startsWith('ARM:empty')) return { ok: true, text: envelope(''), error: null };
    if (system.startsWith('ARM:garbage')) return { ok: true, text: GARBAGE_PROSE, error: null };
    const userMessage = user.endsWith(JSON_FORCING_SUFFIX)
      ? user.slice(0, -JSON_FORCING_SUFFIX.length)
      : user;
    if (userMessage === tripped.user_message) return { ok: true, text: envelope(HONEST_TRIPPED_TEXT), error: null };
    const good = goodTextByUserMessage.get(userMessage);
    if (good === undefined) throw new Error(`no recorded good candidate for user message: ${userMessage}`);
    return { ok: true, text: envelope(good), error: null };
  };

  return runCandidateEval({
    specs: [
      parsePromptSpec(`empty-arm=${armFiles.empty}`),
      parsePromptSpec(`garbage-arm=${armFiles.garbage}`),
      parsePromptSpec(`honest-arm=${armFiles.honest}`),
    ],
    fixtures,
    gateInput: { env: { ORCHESTRATOR_EVAL_LIVE_CANDIDATES: '1' }, argv: ['--live'] },
    modelId: 'injected-three-arm-model',
    createLiveModel: async () => model,
  });
}

describe('substance dimension — the scorer floor', () => {
  const analysis = loadFixtures()[0]!.analysis;

  it('empty text fails substance_present (and ONLY emptiness is the defect)', () => {
    const score = scoreCandidate(analysis, { label: 'x', note: '', source: 'recorded', text: '' });
    const substance = score.dimensions.find((d) => d.name === 'substance_present');
    expect(substance).toBeDefined();
    expect(substance?.pass).toBe(false);
    expect(score.pass).toBe(false);
    // every OTHER dimension passes on empty text — proving the five absence
    // checks alone cannot see this defect class (why substance must exist).
    for (const d of score.dimensions) {
      if (d.name !== 'substance_present') expect(d.pass).toBe(true);
    }
  });

  it('whitespace-only text fails substance_present', () => {
    const score = scoreCandidate(analysis, { label: 'x', note: '', source: 'recorded', text: '  \n\t ' });
    expect(score.dimensions.find((d) => d.name === 'substance_present')?.pass).toBe(false);
    expect(score.pass).toBe(false);
  });

  it('real prose passes substance_present', () => {
    const score = scoreCandidate(analysis, {
      label: 'x',
      note: '',
      source: 'recorded',
      text: 'Raising prices wins 89% of the time but is only about 29% likely to meet the £20k target.',
    });
    expect(score.dimensions.find((d) => d.name === 'substance_present')?.pass).toBe(true);
    expect(score.pass).toBe(true);
  });
});

describe('the reviewer\'s three arms — permanent reconstruction (zero network)', () => {
  it('empty > garbage > honest is DEAD: honest ranks first; empty and garbage fail every turn', async () => {
    const report = await runThreeArms();
    expect(fetchCalls).toBe(0);
    expect(report.turnsUsed).toBe(3 * 6);

    const empty = report.candidates.find((c) => c.label === 'empty-arm');
    const garbage = report.candidates.find((c) => c.label === 'garbage-arm');
    const honest = report.candidates.find((c) => c.label === 'honest-arm');
    if (!empty || !garbage || !honest) throw new Error('missing candidate reports');

    // EMPTY ARM: envelope parses (unflagged json_text) but carries no prose —
    // substance_present fails on every turn; 0/6, was 6/6 at fb7993636.
    expect(empty.passCount).toBe(0);
    for (const r of empty.results) {
      expect(r.extraction).toBe('json_text');
      expect(r.pass).toBe(false);
      expect(r.score?.dimensions.find((d) => d.name === 'substance_present')?.pass).toBe(false);
    }

    // GARBAGE ARM: flagged raw_unparsed on every turn — the flag is now
    // SCORED (extraction_contract fails) and fail-closed substance treats
    // unextractable output as empty; 0/6, was 6/6 at fb7993636.
    expect(garbage.passCount).toBe(0);
    expect(garbage.flaggedTurnCount).toBe(6);
    for (const r of garbage.results) {
      expect(r.extraction).toBe('raw_unparsed');
      expect(r.pass).toBe(false);
      expect(r.score?.dimensions.find((d) => d.name === 'extraction_contract')?.pass).toBe(false);
      expect(r.score?.dimensions.find((d) => d.name === 'substance_present')?.pass).toBe(false);
    }

    // HONEST ARM: still scores its TRUE 5/6 — the one forbidden-terms trip
    // (and nothing else) fails, exactly as at fb7993636.
    expect(honest.passCount).toBe(5);
    expect(honest.flaggedTurnCount).toBe(0);
    const honestFailure = honest.results.find((r) => !r.pass);
    expect(honestFailure?.fixtureId).toBe('goal-fit-conflation');
    expect(honestFailure?.score?.dimensions.filter((d) => !d.pass).map((d) => d.name)).toEqual([
      'no_forbidden_terms',
    ]);

    // THE DIRECTION INVARIANT: the honest arm ranks first; the arm flagged on
    // every turn ranks below the unflagged arms.
    expect(report.ranking[0]).toBe('honest-arm');
    expect(report.ranking).toEqual(['honest-arm', 'empty-arm', 'garbage-arm']);
  });

  it('a flagged arm never ranks above an unflagged arm it ties with on every other key', async () => {
    // Two arms, identical pass/fail profile except one is flagged: at
    // fb7993636 the tie broke ALPHABETICALLY (flagged "a-flagged" would beat
    // unflagged "b-clean"). flaggedTurnCount now breaks the tie first.
    const fixtures = [loadFixtures().find((f) => f.id === 'goal-fit-conflation')!];
    const model: CandidateModel = async (system) => {
      if (system.startsWith('ARM:garbage')) return { ok: true, text: GARBAGE_PROSE, error: null };
      return { ok: true, text: envelope(''), error: null };
    };
    const report = await runCandidateEval({
      specs: [
        parsePromptSpec(`a-flagged=${armFiles.garbage}`),
        parsePromptSpec(`b-clean=${armFiles.empty}`),
      ],
      fixtures,
      gateInput: { env: { ORCHESTRATOR_EVAL_LIVE_CANDIDATES: '1' }, argv: ['--live'] },
      modelId: 'injected-tie-model',
      createLiveModel: async () => model,
    });
    expect(fetchCalls).toBe(0);
    // Both 0/1 — but the flagged arm must sort BELOW the unflagged one
    // despite winning alphabetically.
    expect(report.candidates.every((c) => c.passCount === 0)).toBe(true);
    expect(report.ranking).toEqual(['b-clean', 'a-flagged']);
  });
});
