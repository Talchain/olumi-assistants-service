/**
 * CEE #1398 — the provider-free half of the coaching-capability evaluation, and
 * the guard tests the independent review of `cdb2cfb3` required.
 *
 * NOTHING HERE TOUCHES A NETWORK, A DATABASE, A PROMPT STORE OR A PROVIDER. That
 * is the point: the reviewer's P1 findings ("the 18-answer ceiling is not
 * enforced", "cleanup discards an uncommitted candidate") are both provable from
 * source and from exit codes, so neither may ever reach a paid call to be found.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ANSWER_CEILING,
  BASE_SHA,
  QUESTIONS,
  assembleArms,
  baselineInstruction,
  buildContract,
  commonAffixes,
} from '../coaching-request-contract.js';
import { COACHING_CONTEXT_INSTRUCTION } from '../../../src/orchestrator-v5/routing/route-with-tool-use.js';

const REPO = join(import.meta.dirname, '..', '..', '..');
const HELPER = join(REPO, 'tools', 'conversation-harness', 'coaching-capability-ab.sh');
const HELPER_SOURCE = readFileSync(HELPER, 'utf8');
/**
 * The helper with whole-line comments stripped. The "must not" assertions below
 * are about what the script DOES and what it TELLS the operator — the comments
 * legitimately quote the old broken behaviour in order to explain the repair, and
 * matching those quotations was a false positive in this file's first draft.
 */
const HELPER_CODE = HELPER_SOURCE.split('\n')
  .filter((l) => !l.trimStart().startsWith('#'))
  .join('\n');
const JOURNEY = join(REPO, 'tools', 'conversation-harness', 'journeys', 'coaching-capability-pre-analysis.json');

/** Run the helper and capture status + stderr. It must never reach a network. */
function runHelper(env: Record<string, string>): { status: number; err: string } {
  try {
    execFileSync('bash', [HELPER], {
      encoding: 'utf8',
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, err: '' };
  } catch (e) {
    const err = e as { status?: number; stderr?: string };
    return { status: err.status ?? -1, err: err.stderr ?? '' };
  }
}

const CLEARED = { COACHING_AB_SOURCE_CLEARANCE: 'test-only-not-a-real-clearance' };

describe('#1398 helper — the standing refusal (review: NOT CLEARED TO EXECUTE)', () => {
  it('refuses to run at all without a recorded source clearance', () => {
    const { status, err } = runHelper({ COACHING_AB_SOURCE_CLEARANCE: '' });
    expect(status).toBe(3);
    expect(err).toMatch(/REFUSED: coaching-capability-ab\.sh is not cleared to execute/);
    // And it points at the path that needs none of this.
    expect(err).toMatch(/coaching-request-contract\.ts/);
  });

  it('names the shared-database write as the reason, not a missing credential', () => {
    const { err } = runHelper({ COACHING_AB_SOURCE_CLEARANCE: '' });
    expect(err).toMatch(/SHARED staging database/);
    expect(err).toMatch(/a working credential would not supply one/i);
  });
});

/**
 * THE DISCRIMINATING PAIR the review asked for. A refusal test alone proves
 * nothing — a script that refused everything would pass it. The pair is: the
 * SAME invocation at REPEATS=3 must get PAST the ceiling check (failing later,
 * on a missing env file), and at REPEATS=4 must be stopped BY the ceiling.
 */
describe('#1398 helper — the 18-answer ceiling, enforced before any network work', () => {
  it('3 turns x 3 repeats x 2 arms = 18 passes the ceiling and fails later on env', () => {
    const { status, err } = runHelper({ ...CLEARED, REPEATS: '3' });
    expect(err).not.toMatch(/exceeds the authorised ceiling/);
    expect(err).toMatch(/ENV_FILE/);
    expect(status).toBe(1);
  });

  it('the SAME invocation at REPEATS=4 is stopped BY the ceiling, before any env work', () => {
    const { status, err } = runHelper({ ...CLEARED, REPEATS: '4' });
    expect(status).toBe(2);
    expect(err).toMatch(/3 turns x 4 repeats x 2 arms = 24 generated answers/);
    expect(err).toMatch(/exceeds the authorised ceiling of 18/);
    // It stopped BEFORE the env prerequisites — i.e. before anything paid.
    expect(err).not.toMatch(/ENV_FILE/);
  });

  it('rejects a non-integer repeat count', () => {
    // '' is NOT in this list on purpose: an unset or empty REPEATS falls through
    // to the documented default of 3, which is inside the ceiling.
    for (const bad of ['0', '-1', '2.5', 'three']) {
      const { status, err } = runHelper({ ...CLEARED, REPEATS: bad });
      expect(status, `REPEATS=${bad}`).toBe(2);
      expect(err, `REPEATS=${bad}`).toMatch(/REFUSED: REPEATS must be/);
    }
  });

  it('rejects a longer journey override even at the authorised repeat count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coachcap-'));
    const long = join(dir, 'six-turn.json');
    const base = JSON.parse(readFileSync(JOURNEY, 'utf8')) as { turns: unknown[] };
    writeFileSync(long, JSON.stringify({ ...base, turns: [...base.turns, ...base.turns] }));
    const { status, err } = runHelper({ ...CLEARED, REPEATS: '3', JOURNEY: long });
    expect(status).toBe(2);
    expect(err).toMatch(/6 turns x 3 repeats x 2 arms = 36 generated answers/);
    expect(err).toMatch(/exceeds the authorised ceiling of 18/);
  });

  it('the ceiling is a source constant, not an environment override', () => {
    expect(HELPER_SOURCE).toMatch(/^ANSWER_CEILING=18$/m);
    // No `${ANSWER_CEILING:-...}` form: it must not be raisable from the caller.
    expect(HELPER_SOURCE).not.toMatch(/ANSWER_CEILING:-/);
  });
});

describe('#1398 helper — source repairs for review findings P1(2) and P2', () => {
  it('never uses `git checkout --` as cleanup (it discards uncommitted work)', () => {
    expect(HELPER_CODE).not.toMatch(/git\s+(-C\s+\S+\s+)?checkout\s+--/);
  });

  it('refuses a dirty source file rather than overwriting it', () => {
    expect(HELPER_SOURCE).toMatch(/REFUSED: \$SRC has uncommitted changes/);
    expect(HELPER_SOURCE).toMatch(/git -C "\$WT" diff --quiet -- "\$SRC"/);
  });

  it('records a NAMED backup and restores those exact bytes on every exit path', () => {
    expect(HELPER_SOURCE).toMatch(/BACKUP="\$OUT\/route-with-tool-use\.ts\.PRE-RUN-BACKUP"/);
    expect(HELPER_SOURCE).toMatch(/exact pre-run bytes of \$SRC saved to/);
    expect(HELPER_SOURCE).toMatch(/cp "\$BACKUP" "\$WT\/\$SRC"/);
    expect(HELPER_SOURCE).toMatch(/trap cleanup EXIT INT TERM/);
  });

  it('stops the runner-owned child unconditionally, from module scope', () => {
    expect(HELPER_SOURCE).toMatch(/^ARM_PID=""$/m);
    expect(HELPER_SOURCE).toMatch(/if \[ -n "\$ARM_PID" \]; then/);
  });

  it('makes no claim that it deletes shared scenarios, and deletes none', () => {
    expect(HELPER_CODE).not.toMatch(/deleted at the end/);
    expect(HELPER_SOURCE).toMatch(/this helper deletes nothing/);
    expect(HELPER_SOURCE).toMatch(/seeded-scenarios\.owned-ids\.txt/);
    // It must not call the deletion tool on its own authority.
    expect(HELPER_SOURCE).not.toMatch(/^\s*python3 staging\/delete-scenarios\.py/m);
  });
});

/**
 * THE REQUEST CONTRACT — candidate/baseline parity, proved provider-free.
 *
 * This is what may be banked for clearance: the two arms are the SAME assembled
 * request except inside the instruction, and the candidate wording genuinely
 * reaches the assembled bytes. It says nothing about answer quality.
 */
describe('#1398 request contract — one changed variable, proved without a provider', () => {
  const baseline = baselineInstruction(REPO);

  it('VACUITY GUARD — the baseline and candidate instructions actually differ', () => {
    expect(baseline.length).toBeGreaterThan(0);
    expect(baseline).not.toBe(COACHING_CONTEXT_INSTRUCTION);
  });

  it('the PR base blob is the one the reviewer verified', () => {
    const blob = execFileSync(
      'git',
      ['-C', REPO, 'rev-parse', `${BASE_SHA}:src/orchestrator-v5/routing/route-with-tool-use.ts`],
      { encoding: 'utf8' },
    ).trim();
    expect(blob).toBe('89b3437860527c0be6dadd2a6307cb3e2a6b00ff');
  });

  it('every arm pair is byte-identical outside the instruction region', () => {
    for (const q of QUESTIONS) {
      for (const state of ['none', 'stale'] as const) {
        const arms = assembleArms(q, state, baseline);
        const { prefix, suffix } = commonAffixes(arms.baseline, arms.candidate);
        expect(arms.baseline.slice(0, prefix)).toBe(arms.candidate.slice(0, prefix));
        expect(arms.baseline.slice(arms.baseline.length - suffix)).toBe(
          arms.candidate.slice(arms.candidate.length - suffix),
        );
        // The differing region is the instruction and only the instruction: put
        // the candidate wording back and the baseline message is reproduced.
        expect(arms.baseline.replace(baseline, COACHING_CONTEXT_INSTRUCTION)).toBe(arms.candidate);
      }
    }
  });

  it('DISCRIMINATION — the changed wording really is present in one arm and absent in the other', () => {
    const arms = assembleArms(QUESTIONS[0]!, 'stale', baseline);
    // The blanket prohibition that produced the 16:47Z answer: baseline only.
    expect(arms.baseline).toContain('before giving confident advice');
    expect(arms.candidate).not.toContain('before giving confident advice');
    // The positive obligation: candidate only.
    expect(arms.candidate).toContain('It never suspends coaching');
    expect(arms.baseline).not.toContain('It never suspends coaching');
    // Both arms still carry the currentness floor — this is not a safety trade.
    for (const msg of [arms.baseline, arms.candidate]) {
      expect(msg).toContain('do not present the results as current');
      expect(msg).toContain('"freshness": "stale"');
    }
  });

  it('the banked contract records zero spend and a ceiling it does not consume', () => {
    const contract = buildContract(REPO) as {
      provider_calls: number;
      database_writes: number;
      pms_writes: number;
      answer_ceiling: number;
      paid_plan_if_cleared: { total_answers: number };
      turns: unknown[];
    };
    expect(contract.provider_calls).toBe(0);
    expect(contract.database_writes).toBe(0);
    expect(contract.pms_writes).toBe(0);
    expect(contract.answer_ceiling).toBe(ANSWER_CEILING);
    expect(contract.paid_plan_if_cleared.total_answers).toBeLessThanOrEqual(ANSWER_CEILING);
    expect(contract.turns).toHaveLength(QUESTIONS.length * 2);
  });
});
