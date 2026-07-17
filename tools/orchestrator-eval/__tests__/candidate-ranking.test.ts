/**
 * orchestrator-eval — RANKING-KEY pins (every key must be load-bearing).
 *
 * WHY THIS FILE EXISTS (round-2 review of the substance fix, P2-1): the
 * `flaggedTurnCount` ranking key in candidate-run.ts was UNPINNED — deleting
 * it left all 58 tests green, because every existing scenario that exercised
 * a flagged arm also differed on `failedDimensionCount` in the same
 * direction, so the next key silently rescued the ranking. A ranking key
 * nobody can prove is load-bearing is the guarantee-theatre class: it reads
 * as an invariant but nothing would notice its removal.
 *
 * THE DISCRIMINATING SHAPE (reviewer-constructed): an UNFLAGGED arm that
 * fails MORE dimensions per turn than a flagged arm. Only then does the
 * flagged key have to do the work — with it deleted, the ranking falls
 * through to failedDimensionCount and INVERTS to flagged-first.
 *
 * Every test here names, in a comment, the exact mutation that turns it RED.
 * Mutation-checked in a throwaway worktree before merge.
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runCandidateEval, type CandidateEvalReport, type CandidateModel } from '../src/candidate-run.js';
import { parsePromptSpec } from '../src/prompt-source.js';
import { loadFixtures } from '../src/run.js';

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

// ── deterministic arm texts, each tripping a KNOWN dimension set ─────────────

const JSON_FORCING_SUFFIX = '\n\nRespond with valid JSON only.';
const envelope = (text: string): string => JSON.stringify({ text, insights: [], recommended_actions: [] });

/** raw prose — never parses as the envelope. Per turn: extraction_contract
 * FAILS + substance_present FAILS (fail-closed) = 2 failed dimensions. */
const GARBAGE_PROSE = 'Plainly, the weather is lovely and the options all seem fine to me today.';

/** Parses, substantive, trips THREE dimensions per turn: no_forbidden_terms
 * ("ContextPack"), no_held_science_vocabulary ("robustness"),
 * no_false_success_claim ("I've updated"). Deliberately avoids mutation
 * gerunds, attainment-verb + target-noun clauses and numbers, so the other
 * dimensions PASS. */
const TRIPLE_TRIP_TEXT =
  "The ContextPack robustness data backs this option. I've updated the price factor to reflect it.";

/** Parses, substantive, trips ONE dimension per turn: no_forbidden_terms
 * ("ContextPack") and nothing else. */
const SINGLE_TRIP_TEXT =
  'The ContextPack for this decision keeps both options in play without a clear winner either way.';

let promptDir: string;
const armFile = new Map<string, string>();

beforeAll(() => {
  promptDir = mkdtempSync(join(tmpdir(), 'orchestrator-eval-ranking-'));
  for (const name of ['alpha', 'beta']) {
    const p = join(promptDir, `${name}.txt`);
    writeFileSync(p, `ARM:${name}`);
    armFile.set(name, p);
  }
});

afterAll(() => {
  rmSync(promptDir, { recursive: true, force: true });
});

/**
 * Run a two-arm eval where each arm's behaviour is decided PER FIXTURE by the
 * provided function (dispatch: arm marker from the system prompt, fixture id
 * from the user message). Zero network; injected model.
 */
async function runTwoArms(
  labels: { alpha: string; beta: string },
  respond: (arm: 'alpha' | 'beta', fixtureId: string) => { ok: boolean; text: string | null },
): Promise<CandidateEvalReport> {
  const fixtures = loadFixtures();
  const fixtureIdByUserMessage = new Map(fixtures.map((f) => [f.user_message, f.id] as const));

  const model: CandidateModel = async (system, user) => {
    const arm = system.startsWith('ARM:alpha') ? 'alpha' : 'beta';
    const userMessage = user.endsWith(JSON_FORCING_SUFFIX)
      ? user.slice(0, -JSON_FORCING_SUFFIX.length)
      : user;
    const fixtureId = fixtureIdByUserMessage.get(userMessage);
    if (fixtureId === undefined) throw new Error(`no fixture for user message: ${userMessage}`);
    const r = respond(arm, fixtureId);
    return r.ok ? { ok: true, text: r.text, error: null } : { ok: false, text: null, error: 'injected model_error' };
  };

  return runCandidateEval({
    specs: [
      parsePromptSpec(`${labels.alpha}=${armFile.get('alpha')!}`),
      parsePromptSpec(`${labels.beta}=${armFile.get('beta')!}`),
    ],
    fixtures,
    gateInput: { env: { ORCHESTRATOR_EVAL_LIVE_CANDIDATES: '1' }, argv: ['--live'] },
    modelId: 'injected-ranking-model',
    createLiveModel: async () => model,
  });
}

/** The first half of the fixture pack, deterministic by sorted id (the rest
 * of the pack is "everything not in this set"). */
function firstFixtureHalf(): Set<string> {
  const ids = loadFixtures()
    .map((f) => f.id)
    .sort();
  return new Set(ids.slice(0, Math.ceil(ids.length / 2)));
}

describe('flaggedTurnCount is a LOAD-BEARING ranking key (P2-1)', () => {
  it("an unflagged arm failing MORE dimensions still ranks above a flagged arm failing fewer (RED if the flaggedTurnCount sort term is deleted — the ranking inverts via failedDimensionCount)", async () => {
    // The reviewer's exact discriminating case. Arm names chosen so the
    // flagged arm ALSO wins alphabetically: neither of the two downstream
    // keys can rescue the honest arm — only flaggedTurnCount orders it first.
    const report = await runTwoArms(
      { alpha: 'a-flagged-garbage', beta: 'z-honest-substantive' },
      (arm) =>
        arm === 'alpha'
          ? { ok: true, text: GARBAGE_PROSE } // raw_unparsed on every turn
          : { ok: true, text: envelope(TRIPLE_TRIP_TEXT) },
    );
    expect(fetchCalls).toBe(0);
    expect(report.turnsUsed).toBe(12);

    const flagged = report.candidates.find((c) => c.label === 'a-flagged-garbage');
    const honest = report.candidates.find((c) => c.label === 'z-honest-substantive');
    if (!flagged || !honest) throw new Error('missing candidate reports');

    // Flagged arm: every turn raw_unparsed; 2 failed dimensions per turn
    // (extraction_contract + fail-closed substance_present) = 12.
    expect(flagged.passCount).toBe(0);
    expect(flagged.flaggedTurnCount).toBe(6);
    expect(flagged.failedDimensionCount).toBe(12);
    for (const r of flagged.results) expect(r.extraction).toBe('raw_unparsed');

    // Honest arm: every turn parses (UNFLAGGED) and is substantive, but trips
    // exactly three dimensions per turn = 18 — MORE than the flagged arm.
    expect(honest.passCount).toBe(0);
    expect(honest.flaggedTurnCount).toBe(0);
    expect(honest.failedDimensionCount).toBe(18);
    for (const r of honest.results) {
      expect(r.extraction).toBe('json_text');
      expect(r.score?.dimensions.filter((d) => !d.pass).map((d) => d.name)).toEqual([
        'no_forbidden_terms',
        'no_held_science_vocabulary',
        'no_false_success_claim',
      ]);
    }
    expect(honest.failedDimensionCount).toBeGreaterThan(flagged.failedDimensionCount);

    // THE PIN: both arms pass nothing, the honest arm fails more dimensions
    // AND loses alphabetically — only the flagged-turn key ranks it first.
    // Delete `a.flaggedTurnCount - b.flaggedTurnCount ||` and this inverts.
    expect(report.ranking).toEqual(['z-honest-substantive', 'a-flagged-garbage']);
  });

  it('mixed-turn arms: fewer flagged turns wins even at a higher failed-dimension count (RED if the flaggedTurnCount sort term is deleted; discriminates the key even once substance-failed turns tie)', async () => {
    // Both arms fail substance on the SAME number of turns (3 each), so no
    // substance-level key can order them — this pair keeps flaggedTurnCount
    // pinned independently of the substance ranking key.
    const first = firstFixtureHalf();
    const report = await runTwoArms({ alpha: 'z-part-flagged', beta: 'a-unflagged' }, (arm, fixtureId) => {
      if (arm === 'alpha') {
        // 3 flagged turns (2 dims each) + 3 single-trip turns (1 dim each) = 9.
        return first.has(fixtureId)
          ? { ok: true, text: GARBAGE_PROSE }
          : { ok: true, text: envelope(SINGLE_TRIP_TEXT) };
      }
      // 3 empty turns (substance only, 1 dim each) + 3 triple-trip turns = 12.
      return first.has(fixtureId)
        ? { ok: true, text: envelope('') }
        : { ok: true, text: envelope(TRIPLE_TRIP_TEXT) };
    });
    expect(fetchCalls).toBe(0);

    const partFlagged = report.candidates.find((c) => c.label === 'z-part-flagged');
    const unflagged = report.candidates.find((c) => c.label === 'a-unflagged');
    if (!partFlagged || !unflagged) throw new Error('missing candidate reports');

    expect(partFlagged.passCount).toBe(0);
    expect(partFlagged.flaggedTurnCount).toBe(3);
    expect(partFlagged.failedDimensionCount).toBe(9);

    expect(unflagged.passCount).toBe(0);
    expect(unflagged.flaggedTurnCount).toBe(0);
    expect(unflagged.failedDimensionCount).toBe(12);

    // Tied on passCount (0=0) and on substance-failed turns (3=3); the
    // unflagged arm fails MORE dimensions — only flaggedTurnCount puts it
    // first. Delete that sort term and failedDimensionCount inverts this.
    expect(report.ranking).toEqual(['a-unflagged', 'z-part-flagged']);
  });
});

describe('substanceFailedTurnCount ranking key (P2-2, option a): emptiness never wins a tie', () => {
  it('among all-failing arms, an EMPTY arm ranks strictly below a substantive-but-flawed one — even with far fewer failed dimensions and an alphabetical win (RED if the substanceFailedTurnCount sort term is deleted)', async () => {
    // THE ROUND-2 RESIDUAL (P2-2): with substance priced only into per-turn
    // pass/fail, an empty-envelope arm (1 failed dimension per turn) could
    // still out-rank a substantive-but-flawed arm (3 failed dimensions per
    // turn) on the failedDimensionCount key — emptiness winning by failing
    // FEWER checks, the exact defect class the substance dimension exists to
    // kill, resurfacing one key lower.
    const report = await runTwoArms(
      { alpha: 'a-empty', beta: 'z-substantive-flawed' },
      (arm) => (arm === 'alpha' ? { ok: true, text: envelope('') } : { ok: true, text: envelope(TRIPLE_TRIP_TEXT) }),
    );
    expect(fetchCalls).toBe(0);

    const empty = report.candidates.find((c) => c.label === 'a-empty');
    const substantive = report.candidates.find((c) => c.label === 'z-substantive-flawed');
    if (!empty || !substantive) throw new Error('missing candidate reports');

    // Empty arm: unflagged, 1 failed dimension per turn (substance only) = 6.
    expect(empty.passCount).toBe(0);
    expect(empty.flaggedTurnCount).toBe(0);
    expect(empty.substanceFailedTurnCount).toBe(6);
    expect(empty.failedDimensionCount).toBe(6);

    // Substantive arm: unflagged, substance PASSES everywhere, 3 failed
    // dimensions per turn = 18 — three times the empty arm's count.
    expect(substantive.passCount).toBe(0);
    expect(substantive.flaggedTurnCount).toBe(0);
    expect(substantive.substanceFailedTurnCount).toBe(0);
    expect(substantive.failedDimensionCount).toBe(18);

    // THE PIN: the substantive arm ranks first despite losing on BOTH
    // downstream keys (failed dimensions AND alphabetical order). Delete
    // `a.substanceFailedTurnCount - b.substanceFailedTurnCount ||` and the
    // empty arm wins again via failedDimensionCount.
    expect(report.ranking).toEqual(['z-substantive-flawed', 'a-empty']);
  });

  it('a model_error turn counts as substance-failed (fail-closed): an arm that produced NOTHING cannot out-rank one that produced flawed substance (RED if model_error turns stop counting as substance-failed)', async () => {
    // A model_error turn has NO score, so it contributes ZERO failed
    // dimensions — without fail-closed substance counting, an arm whose every
    // call failed would carry the LOWEST failedDimensionCount in the run and
    // rank above every substantive all-failing arm: total production failure
    // scored as the cleanest candidate. Producing nothing is the emptiness
    // defect class in its purest form.
    const report = await runTwoArms(
      { alpha: 'a-model-error', beta: 'z-substantive-flawed' },
      (arm) => (arm === 'alpha' ? { ok: false, text: null } : { ok: true, text: envelope(TRIPLE_TRIP_TEXT) }),
    );
    expect(fetchCalls).toBe(0);

    const errored = report.candidates.find((c) => c.label === 'a-model-error');
    const substantive = report.candidates.find((c) => c.label === 'z-substantive-flawed');
    if (!errored || !substantive) throw new Error('missing candidate reports');

    expect(errored.passCount).toBe(0);
    expect(errored.flaggedTurnCount).toBe(0);
    expect(errored.failedDimensionCount).toBe(0); // no scores at all
    for (const r of errored.results) expect(r.extraction).toBe('model_error');
    // Fail-closed: every unscored turn counts as an EMPTY turn.
    expect(errored.substanceFailedTurnCount).toBe(6);

    expect(report.ranking).toEqual(['z-substantive-flawed', 'a-model-error']);
  });

  it('PLACEMENT pin: the substance key sits BELOW passCount — an arm that actually passes turns beats an arm that never does, empty turns notwithstanding (RED if substanceFailedTurnCount is hoisted above passCount, or passCount is deleted)', async () => {
    // The deliberate deviation from the review's literal "highest-priority
    // key" phrasing, pinned so it cannot drift silently: substance failure
    // already forces the TURN to fail (it is priced into passCount), so the
    // substance key only needs to adjudicate between arms passing EQUALLY
    // MANY turns. Hoisted above passCount it would rank an arm that never
    // produced a single clean turn above one that passed 1/6 — inverting the
    // pack's primary signal in the name of a tie-breaker.
    const goodTextById = new Map(
      loadFixtures().map((f) => {
        const good = f.candidates.find((c) => c.label === 'good');
        if (!good) throw new Error(`fixture ${f.id} has no recorded good candidate`);
        return [f.id, good.text] as const;
      }),
    );
    const passingFixtureId = [...goodTextById.keys()].sort()[0]!;
    const report = await runTwoArms({ alpha: 'a-mostly-empty', beta: 'z-never-passes' }, (arm, fixtureId) => {
      if (arm === 'alpha') {
        return fixtureId === passingFixtureId
          ? { ok: true, text: envelope(goodTextById.get(fixtureId)!) } // 1 clean pass
          : { ok: true, text: envelope('') }; // 5 empty turns
      }
      return { ok: true, text: envelope(TRIPLE_TRIP_TEXT) }; // substantive, never passes
    });
    expect(fetchCalls).toBe(0);

    const mostlyEmpty = report.candidates.find((c) => c.label === 'a-mostly-empty');
    const neverPasses = report.candidates.find((c) => c.label === 'z-never-passes');
    if (!mostlyEmpty || !neverPasses) throw new Error('missing candidate reports');

    expect(mostlyEmpty.passCount).toBe(1);
    expect(mostlyEmpty.substanceFailedTurnCount).toBe(5);
    expect(neverPasses.passCount).toBe(0);
    expect(neverPasses.substanceFailedTurnCount).toBe(0);

    // passCount stays primary: 1 real pass beats 0, five empty turns
    // notwithstanding.
    expect(report.ranking).toEqual(['a-mostly-empty', 'z-never-passes']);
  });
});
