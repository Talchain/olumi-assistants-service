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
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../../src/adapters/llm/types.js';
import {
  ATTEMPT_CEILING,
  AttemptBudget,
  AttemptCeilingExceeded,
  InvalidAttemptCeiling,
  baselineArgs,
  captureBoundary,
  dispatchBounded,
  nonMessageArgs,
  snapshotProvenance,
} from '../coaching-request-boundary.js';
import { CONTEXT_SURVIVAL_MARKERS } from '../coaching-recorded-context.js';
import { isLiveEvalSingleAttempt } from '../../../src/adapters/llm/live-eval-retry-policy.js';

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

/**
 * Timeout for the tests that SPAWN BASH. Vitest's 5s default is fine when this
 * file runs alone (the review measured 793ms for all 17), but under the full
 * harness suite the spawns queue behind 21 other files and the first refusal
 * took 8.16s — a red that says nothing about the guard. Raised for the spawning
 * tests only; the pure-source and contract tests keep the default.
 */
const SPAWN_TIMEOUT_MS = 30_000;

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
  }, SPAWN_TIMEOUT_MS);

  it('names the shared-database write as the reason, not a missing credential', () => {
    const { err } = runHelper({ COACHING_AB_SOURCE_CLEARANCE: '' });
    expect(err).toMatch(/SHARED staging database/);
    expect(err).toMatch(/a working credential would not supply one/i);
  }, SPAWN_TIMEOUT_MS);
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
  }, SPAWN_TIMEOUT_MS);

  it('the SAME invocation at REPEATS=4 is stopped BY the ceiling, before any env work', () => {
    const { status, err } = runHelper({ ...CLEARED, REPEATS: '4' });
    expect(status).toBe(2);
    expect(err).toMatch(/3 turns x 4 repeats x 2 arms = 24 generated answers/);
    expect(err).toMatch(/exceeds the authorised ceiling of 18/);
    // It stopped BEFORE the env prerequisites — i.e. before anything paid.
    expect(err).not.toMatch(/ENV_FILE/);
  }, SPAWN_TIMEOUT_MS);

  it('rejects a non-integer repeat count', () => {
    // '' is NOT in this list on purpose: an unset or empty REPEATS falls through
    // to the documented default of 3, which is inside the ceiling.
    for (const bad of ['0', '-1', '2.5', 'three']) {
      const { status, err } = runHelper({ ...CLEARED, REPEATS: bad });
      expect(status, `REPEATS=${bad}`).toBe(2);
      expect(err, `REPEATS=${bad}`).toMatch(/REFUSED: REPEATS must be/);
    }
  }, SPAWN_TIMEOUT_MS);

  it('rejects a longer journey override even at the authorised repeat count', () => {
    const dir = mkdtempSync(join(tmpdir(), 'coachcap-'));
    const long = join(dir, 'six-turn.json');
    const base = JSON.parse(readFileSync(JOURNEY, 'utf8')) as { turns: unknown[] };
    writeFileSync(long, JSON.stringify({ ...base, turns: [...base.turns, ...base.turns] }));
    const { status, err } = runHelper({ ...CLEARED, REPEATS: '3', JOURNEY: long });
    expect(status).toBe(2);
    expect(err).toMatch(/6 turns x 3 repeats x 2 arms = 36 generated answers/);
    expect(err).toMatch(/exceeds the authorised ceiling of 18/);
  }, SPAWN_TIMEOUT_MS);

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

/**
 * Boundary captures are MEMOISED across this file. Each one runs the production
 * assembler over the frozen graph and history; recomputing six of them per test
 * pushed sibling harness files past Vitest's 5s default under full-suite
 * parallelism (measured: 20/20 green without this file, three unrelated files
 * red with it). The captures are pure, so caching changes no assertion.
 */
const CAPTURE_CACHE = new Map<string, Promise<Awaited<ReturnType<typeof captureBoundary>>>>();
function boundary(q: string, freshness: 'none' | 'stale') {
  const key = `${freshness}::${q}`;
  let hit = CAPTURE_CACHE.get(key);
  if (!hit) {
    hit = captureBoundary(q, freshness);
    CAPTURE_CACHE.set(key, hit);
  }
  return hit;
}

/** Assembly-bearing tests are slower than the 5s default under parallel load. */
const ASSEMBLY_TIMEOUT_MS = 30_000;

function userText(args: ChatWithToolsArgs): string {
  const first = args.messages[0];
  if (!first || typeof first.content !== 'string') throw new Error('expected a string user message');
  return first.content;
}



describe('#1398 boundary — the COMPLETE assembled arguments, not just the user message', () => {
  it('captures the fields production sets around the adapter call', async () => {
    const { args } = await boundary(QUESTIONS[0]!, 'stale');
    // The review named these exactly: system representation, tools, tool_choice,
    // temperature, output budget, thinking. A user-message contract proved none.
    expect(typeof args.system).toBe('string');
    expect(args.system.length).toBeGreaterThan(1000);
    expect(args.tools).toHaveLength(1);
    expect(args.tools[0]!.name).toBe('olumi_action');
    expect(args.tool_choice).toEqual({ type: 'auto' });
    expect(args.temperature).toBe(0);
    expect(args.maxTokens).toBeGreaterThan(0);
    expect(args.messages).toHaveLength(1);
    expect(args.messages[0]!.role).toBe('user');
  }, ASSEMBLY_TIMEOUT_MS);

  it('records explicit snapshot provenance, declared synthetic rather than a v121 replay', async () => {
    const prov = (await snapshotProvenance()) as {
      prompt_version: string;
      prompt_sent_hash: string;
      declared_synthetic: boolean;
      note: string;
    };
    expect(prov.prompt_version).toBeTruthy();
    expect(prov.prompt_sent_hash).toMatch(/^[0-9a-f]{8,}$/);
    expect(prov.declared_synthetic).toBe(true);
    expect(prov.note).toMatch(/v121/);
  }, ASSEMBLY_TIMEOUT_MS);

  it('the two arms differ in the user message and in NOTHING else', async () => {
    const baseline = baselineInstruction(REPO);
    for (const q of QUESTIONS) {
      for (const state of ['none', 'stale'] as const) {
        const cap = await boundary(q, state);
        const other = baselineArgs(cap.args, baseline);
        expect(nonMessageArgs(other)).toEqual(nonMessageArgs(cap.args));
        expect(userText(other)).not.toBe(userText(cap.args));
        // ...and the difference is exactly the instruction swap, round-trip.
        expect(userText(other).replace(baseline, COACHING_CONTEXT_INSTRUCTION)).toBe(
          userText(cap.args),
        );
      }
    }
  }, ASSEMBLY_TIMEOUT_MS);

  it('refuses to build a baseline arm if the instruction is not uniquely locatable', () => {
    const fake = {
      system: 's',
      messages: [{ role: 'user' as const, content: 'no instruction here' }],
      tools: [],
    } as unknown as ChatWithToolsArgs;
    expect(() => baselineArgs(fake, 'x')).toThrow(/appears 0 times/);
  });
});

describe('#1398 boundary — the nonempty recorded context actually survives assembly', () => {
  it('every question in every state carries the model, the constraint and the history', async () => {
    for (const q of QUESTIONS) {
      for (const state of ['none', 'stale'] as const) {
        const text = userText((await boundary(q, state)).args);
        for (const marker of CONTEXT_SURVIVAL_MARKERS) {
          expect(text, `${state} / ${q.slice(0, 32)}… / ${marker}`).toContain(marker);
        }
        expect(text).toContain('"status": "canonical"');
        expect(text).toContain('"recent_turns"');
      }
    }
  }, ASSEMBLY_TIMEOUT_MS);

  it('DISCRIMINATION — the markers are not trivially present in the question text alone', () => {
    // Q2 and Q3 never mention the budget, the goal or the constraint. If the
    // context were empty again, the survival test above would go red rather than
    // passing on the question's own words — which is how the first version passed
    // while carrying an empty pack.
    for (const marker of ['£200k', 'Ship AI Features Within 6 Months', 'externally committed']) {
      expect(QUESTIONS[1]).not.toContain(marker);
      expect(QUESTIONS[2]).not.toContain(marker);
    }
  });
});

describe('#1398 budget — every attempt is charged BEFORE dispatch, retries and failures included', () => {
  const capture = { question: 'q', freshness: 'none' as const, args: {} as ChatWithToolsArgs };
  const req = (n: number) => ({
    arm: 'candidate' as const,
    capture,
    args: { system: `s${n}`, messages: [], tools: [] } as unknown as ChatWithToolsArgs,
  });
  const ok = async (): Promise<ChatWithToolsResult> =>
    ({ content: [{ type: 'text', text: 'x' }], stop_reason: 'end_turn' }) as unknown as ChatWithToolsResult;

  it('the ceiling is 18 and the counter starts empty', () => {
    const b = new AttemptBudget();
    expect(b.ceiling).toBe(ATTEMPT_CEILING);
    expect(ATTEMPT_CEILING).toBe(18);
    expect(b.spent).toBe(0);
    expect(b.remaining).toBe(18);
  });

  it('18 dispatches succeed and the 19th is refused before the sender is reached', async () => {
    const budget = new AttemptBudget();
    let sends = 0;
    const send = async (): Promise<ChatWithToolsResult> => {
      sends += 1;
      return ok();
    };
    const records = await dispatchBounded(
      Array.from({ length: 18 }, (_, i) => req(i)),
      send,
      budget,
    );
    expect(records).toHaveLength(18);
    expect(sends).toBe(18);
    expect(budget.remaining).toBe(0);

    await expect(dispatchBounded([req(99)], send, budget)).rejects.toBeInstanceOf(
      AttemptCeilingExceeded,
    );
    // THE LOAD-BEARING ASSERTION: the sender was never reached on the 19th.
    expect(sends).toBe(18);
  });

  it('a FAILED attempt is still charged — no free retries', async () => {
    const budget = new AttemptBudget(2);
    let sends = 0;
    const boom = async (): Promise<ChatWithToolsResult> => {
      sends += 1;
      throw new Error('provider exploded');
    };
    const records = await dispatchBounded([req(1), req(2)], boom, budget);
    expect(records.every((r) => !r.ok)).toBe(true);
    expect(records[0]!.error).toMatch(/provider exploded/);
    expect(budget.remaining).toBe(0);
    // A third try — the "just retry the two that failed" reflex — is refused.
    await expect(dispatchBounded([req(3)], boom, budget)).rejects.toThrow(
      /would exceed the authorised total of 2/,
    );
    expect(sends).toBe(2);
  });

  it('the budget is not reset between arms or runs', async () => {
    const budget = new AttemptBudget(3);
    await dispatchBounded([req(1), req(2)], ok, budget);
    await dispatchBounded([req(3)], ok, budget);
    expect(budget.spent).toBe(3);
    await expect(dispatchBounded([req(4)], ok, budget)).rejects.toBeInstanceOf(
      AttemptCeilingExceeded,
    );
  });

  it('a tool proposal is COUNTED as evidence and never executed', async () => {
    const budget = new AttemptBudget();
    const withTool = async (): Promise<ChatWithToolsResult> =>
      ({
        content: [
          { type: 'text', text: 'here is what I would do' },
          { type: 'tool_use', id: 't1', name: 'olumi_action', input: { intent: 'execute' } },
        ],
        stop_reason: 'tool_use',
      }) as unknown as ChatWithToolsResult;
    const [record] = await dispatchBounded([req(1)], withTool, budget);
    expect(record!.toolProposalsSeen).toBe(1);
    expect(record!.text).toBe('here is what I would do');
    // The record carries no handler, no proposal object and no applied change:
    // there is nothing here for a caller to execute even by mistake.
    expect(Object.keys(record!).sort()).toEqual(
      [
        'argsSha256_16',
        'arm',
        'attempt',
        'error',
        'freshness',
        'ok',
        'question',
        'text',
        'toolProposalsSeen',
      ].sort(),
    );
  });

  it('nothing in this repository hands dispatchBounded a real model client', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = join(REPO, 'tools', 'conversation-harness');
    const callers = readdirSync(dir)
      .filter((f) => f.endsWith('.ts'))
      .filter((f) => readFileSync(join(dir, f), 'utf8').includes('dispatchBounded('));
    // Only the module that defines it. A future caller must be reviewed.
    expect(callers).toEqual(['coaching-request-boundary.ts']);
  });
});

/**
 * The two budget defects the `3de784a3` review found. Both are source-derived
 * counterexamples the previous controls could not discriminate: they only ever
 * built budgets of 18, 3 and 2, all of them valid, and their senders were mocks
 * that make exactly one call, so nothing could reveal either hole.
 */
describe('#1398 budget repair — an unusable ceiling is refused before any send', () => {
  it('rejects 19 — one above the authorised total', () => {
    expect(() => new AttemptBudget(19)).toThrow(InvalidAttemptCeiling);
    expect(() => new AttemptBudget(19)).toThrow(/between 1 and the authorised total of 18/);
  });

  it('rejects NaN, which made every over-ceiling comparison false', () => {
    expect(() => new AttemptBudget(Number.NaN)).toThrow(InvalidAttemptCeiling);
    // The exact hole: `attempted > NaN` is false, so an unvalidated NaN budget
    // charged for ever. Prove the refusal happens at construction, so no send
    // can be reached with one.
    expect(() => new AttemptBudget(Number.POSITIVE_INFINITY)).toThrow(InvalidAttemptCeiling);
  });

  it('rejects non-integer, zero and negative ceilings', () => {
    for (const bad of [2.5, 0, -1, -18]) {
      expect(() => new AttemptBudget(bad), `ceiling ${bad}`).toThrow(InvalidAttemptCeiling);
    }
  });

  it('THE COUNTERPARTS — 18 and the smaller focused budgets still work', () => {
    expect(new AttemptBudget().ceiling).toBe(18);
    expect(new AttemptBudget(18).ceiling).toBe(18);
    expect(new AttemptBudget(3).ceiling).toBe(3);
    expect(new AttemptBudget(1).ceiling).toBe(1);
  });

  it('a refused ceiling cannot reach a sender at all', async () => {
    let sends = 0;
    const send = async (): Promise<ChatWithToolsResult> => {
      sends += 1;
      return { content: [], stop_reason: 'end_turn' } as unknown as ChatWithToolsResult;
    };
    expect(() => {
      const budget = new AttemptBudget(19);
      void dispatchBounded([], send, budget);
    }).toThrow(InvalidAttemptCeiling);
    expect(sends).toBe(0);
  });
});

describe('#1398 budget repair — one charge is one provider attempt, not one caller call', () => {
  const capture = { question: 'q', freshness: 'none' as const, args: {} as ChatWithToolsArgs };
  const req = () => ({
    arm: 'candidate' as const,
    capture,
    args: { system: 's', messages: [], tools: [] } as unknown as ChatWithToolsArgs,
  });

  it('the single-attempt evaluator scope is OPEN during the send', async () => {
    // Charging before `send` bounds caller retries only; the real tool-use client
    // retries internally (repository withRetry + SDK retries), so one charge could
    // cover several paid HTTP attempts. This asserts the existing evaluator scope
    // is active at the exact moment a real client would issue its request.
    expect(isLiveEvalSingleAttempt()).toBe(false);
    let observedInside: boolean | null = null;
    const send = async (): Promise<ChatWithToolsResult> => {
      observedInside = isLiveEvalSingleAttempt();
      return { content: [], stop_reason: 'end_turn' } as unknown as ChatWithToolsResult;
    };
    await dispatchBounded([req()], send, new AttemptBudget(1));
    expect(observedInside).toBe(true);
    expect(isLiveEvalSingleAttempt()).toBe(false);
  });

  it('the scope is released even when the send throws', async () => {
    let observedInside: boolean | null = null;
    const boom = async (): Promise<ChatWithToolsResult> => {
      // Observed BEFORE throwing, so this case discriminates a missing scope too
      // rather than passing trivially on the post-condition alone.
      observedInside = isLiveEvalSingleAttempt();
      throw new Error('provider exploded');
    };
    const records = await dispatchBounded([req()], boom, new AttemptBudget(1));
    expect(records[0]!.ok).toBe(false);
    expect(observedInside).toBe(true);
    expect(isLiveEvalSingleAttempt()).toBe(false);
  });

  it('the scope is released even when the CEILING throws mid-batch', async () => {
    let observedInside: boolean | null = null;
    const send = async (): Promise<ChatWithToolsResult> => {
      observedInside = isLiveEvalSingleAttempt();
      return { content: [], stop_reason: 'end_turn' } as unknown as ChatWithToolsResult;
    };
    await expect(
      dispatchBounded([req(), req()], send, new AttemptBudget(1)),
    ).rejects.toBeInstanceOf(AttemptCeilingExceeded);
    expect(observedInside).toBe(true);
    // A leaked scope would silently disable retries for everything later in the
    // process — the opposite failure, and just as much a defect.
    expect(isLiveEvalSingleAttempt()).toBe(false);
  });
});
