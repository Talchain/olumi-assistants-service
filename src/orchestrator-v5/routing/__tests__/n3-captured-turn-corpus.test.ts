/**
 * ⭐ N-3 RE-MEASUREMENT, PINNED — the analysis-election gate against REAL
 * CAPTURED USER TURNS.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WHY THIS FILE EXISTS (and why it is not a second predicate test)
 * ─────────────────────────────────────────────────────────────────────────
 * ISSUE-LEDGER row N-3 states: *"~44% of turn-2 follow-ups become unrequested
 * `run_analysis`"*. That figure was measured on deployed staging BEFORE the
 * analysis-election gate (#1027) existed. Re-measured at this tip against the
 * captured turns in {@link CORPUS_PATH}, the rate at which a non-request turn
 * would be HONOURED as `run_analysis` is **zero**.
 *
 * The sibling `analysis-election-gate.test.ts` proves the predicate is correct
 * against the PRODUCER (the served routing prompt's own DO-NOT-ROUTE list) and
 * against the product's own chip copy. It cannot notice the rate moving on real
 * traffic, because neither corpus is real traffic. This file pins that separate
 * claim, so the re-measurement cannot rot silently — CLAUDE.md's chronic-failure
 * #2: the estate loses schedulers and measurements, not records.
 *
 * ⚠ THIS IS A MEASUREMENT PIN, NOT A FIX. It asserts what the gate does today
 * on turns users really sent. If a future change moves any verdict, that is a
 * finding to re-derive and re-report, NOT a fixture to update quietly.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THE CORPUS IS FROM OUTSIDE THE AUTHOR'S HEAD (trap 22), AND IS APPEND-ONLY
 * (trap 14b)
 * ─────────────────────────────────────────────────────────────────────────
 * Every message is a VERBATIM wire turn recorded in dated journey-witness
 * evidence under `olumi-docs/`, carried here with its file-level provenance in
 * the `origin` field. Not one sentence was composed by this lane. They are
 * records of what users actually sent on dated builds, so they are APPEND-ONLY:
 * add rows, never edit a message to keep it current.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ⚠ WHAT THIS FILE DOES **NOT** MEASURE — state the exclusions (trap 20)
 * ─────────────────────────────────────────────────────────────────────────
 * 1. **The LLM's ELECTION RATE.** #1027 changed no prompt, so the rate at which
 *    the router *elects* `run_analysis` on a non-request turn is unchanged from
 *    the historical ~43.8%. This file measures only whether such an election is
 *    HONOURED. Deriving the election rate needs live model calls.
 * 2. **The DEMOTION's answer quality.** A demoted turn is answered with
 *    `ANALYSIS_ELECTION_DEMOTION_TEXT` and no further model call, so the user's
 *    actual message goes unanswered. That residual is real, is NOT closed by the
 *    gate, and is deliberately out of this file's scope.
 * 3. **Turn classes that never reach the gate.** Turns claimed by a
 *    deterministic pre-route (e.g. `Go ahead and draft the model.` exits at
 *    `draft_graph`) never produce a `routingResult.proposal` and so are scored
 *    here only hypothetically — the row's verdict says what the gate WOULD do if
 *    the router had elected `run_analysis`, not that it ever does.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  evaluateAnalysisElection,
  GATED_ANALYSIS_HANDLER_ID,
} from '../analysis-election-gate.js';

const CORPUS_PATH = resolve(__dirname, 'fixtures/n3-captured-turns.json');

interface CapturedTurn {
  readonly id: string;
  readonly origin: string;
  readonly source: string | null;
  readonly expect: 'admitted' | 'demoted';
  readonly message: string;
}

const CORPUS: readonly CapturedTurn[] = (
  JSON.parse(readFileSync(CORPUS_PATH, 'utf8')) as { turns: CapturedTurn[] }
).turns;

const outcomeOf = (message: string): string =>
  evaluateAnalysisElection({
    electedHandlerId: GATED_ANALYSIS_HANDLER_ID,
    message,
  }).kind;

describe('N-3 re-measurement — the captured corpus is non-vacuous (trap 13)', () => {
  it('loaded a corpus of the expected size, with both verdict classes present', () => {
    // An absence claim ("no unrequested analysis is honoured") is worthless if
    // the corpus could be empty or single-class. Assert BOTH before believing
    // any count below.
    expect(CORPUS.length).toBeGreaterThanOrEqual(20);
    expect(CORPUS.filter((t) => t.expect === 'demoted').length).toBeGreaterThanOrEqual(15);
    expect(CORPUS.filter((t) => t.expect === 'admitted').length).toBeGreaterThanOrEqual(2);
  });

  it('every row carries file-level provenance and a non-empty message', () => {
    for (const turn of CORPUS) {
      expect(turn.message.trim().length, `${turn.id} has an empty message`).toBeGreaterThan(0);
      expect(turn.origin, `${turn.id} has no origin`).toMatch(/^olumi-docs\//);
    }
  });

  it('POSITIVE CONTROL — the probe can return `admitted`, so a zero is a real zero', () => {
    // Without this, "nothing was admitted" is equally consistent with a gate
    // that admits nothing at all. Bound to the product's own chip sentence.
    expect(outcomeOf('Run analysis.')).toBe('admitted');
    expect(outcomeOf('Please rerun the simulation.')).toBe('admitted');
  });

  it('CONTRAST CONTROL — the gate is inert on a non-analysis election', () => {
    // Proves the outcome is decided by the handler id as well as the message,
    // so an `admitted`/`demoted` reading is about `run_analysis` specifically.
    expect(
      evaluateAnalysisElection({ electedHandlerId: 'edit_graph', message: 'Run analysis.' }).kind,
    ).toBe('not_analysis_election');
  });
});

describe('N-3 re-measurement — verdict per captured turn', () => {
  it.each(CORPUS.map((t) => [t.id, t] as const))(
    '%s',
    (_id, turn) => {
      // Bound by IDENTITY (the row's own id + origin), never by a value
      // predicate another row could satisfy (CLAUDE.md trap 19).
      expect(outcomeOf(turn.message), `${turn.id} (${turn.origin})`).toBe(turn.expect);
    },
  );

  it('⭐ THE HEADLINE: zero non-request turns are honoured as an analysis', () => {
    const wronglyHonoured = CORPUS.filter(
      (t) => t.expect === 'demoted' && outcomeOf(t.message) === 'admitted',
    );
    expect(
      wronglyHonoured.map((t) => `${t.id}: ${t.message}`),
      'a captured non-request turn would now RUN an analysis — N-3 has reopened',
    ).toEqual([]);
  });

  it('⭐ THE MIRROR: zero genuine requests are refused (the opposite-direction twin)', () => {
    // Trap 22b — a predicate guarding two opposite harms needs its cases in
    // BOTH directions. Suppressing a real request is the inverse harm of
    // substituting an unrequested analysis, and a fix for one must not open
    // the other.
    const wronglyRefused = CORPUS.filter(
      (t) => t.expect === 'admitted' && outcomeOf(t.message) !== 'admitted',
    );
    expect(
      wronglyRefused.map((t) => `${t.id}: ${t.message}`),
      'a captured genuine analysis request is no longer honoured — the mirror harm',
    ).toEqual([]);
  });
});
