/**
 * coaching-request-contract — the PROVIDER-FREE evaluation path for the
 * code-owned `COACHING_CONTEXT_INSTRUCTION` candidate on CEE #1398.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────────
 * The full-stack helper (`coaching-capability-ab.sh`) boots a CEE and writes rows
 * to the SHARED staging database, and is refused. None of that is needed to
 * establish the thing that must be established FIRST: that the two arms differ in
 * the instruction bytes and in NOTHING ELSE, and that the request actually carries
 * the candidate wording. This builds both arms' EXACT assembled request through
 * the PRODUCTION assembler (`buildUserMessage`) and banks the contract for review.
 *
 * Zero network, zero database, zero PMS, zero provider, zero server. Nothing here
 * mutates a source file.
 *
 * ── HOW THE TWO ARMS ARE BUILT, AND WHY NOT BY SWAPPING THE FILE ───────────────
 * The shell helper swaps the whole source file, which forced a dirty-tree hazard
 * and made "one changed variable" a property of the procedure rather than of the
 * artefact. Here the candidate message is assembled once by the real assembler,
 * and the BASELINE message is that same message with the candidate instruction
 * block replaced by the baseline block read out of git at the PR base. The
 * substitution is asserted to match EXACTLY ONCE, and the banked contract records
 * both hashes plus the byte length of the common prefix and suffix — so a reader
 * can verify from the artefact alone that nothing outside the instruction moved.
 *
 * ⚠ WHAT THIS DOES NOT DO. It generates no answer and proves no coaching quality.
 * It is the request contract only. Paid execution against the existing model
 * client is a SEPARATE step that needs independent source clearance, is capped at
 * 18 answers in total, and does not restart that budget after a failure.
 *
 * Run:  pnpm exec tsx tools/conversation-harness/coaching-request-contract.ts
 */

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  buildUserMessage,
  COACHING_CONTEXT_INSTRUCTION,
  ROUTING_SYSTEM_PROMPT,
} from '../../src/orchestrator-v5/routing/route-with-tool-use.js';
import { assembleContextPack } from '../../src/orchestrator-v5/context/context-pack-assembler.js';
// The EXISTING production-shaped payload fixture. Hand-building the payload here
// produced `context_pack_schema_drift` ("stage: Required") on every turn — an
// invalid pack would have made the whole contract worthless, so the fixture that
// the routing tests already use is single-sourced instead of re-specified.
import { makeMessagePayload } from '../../src/orchestrator-v5/__tests__/fixtures.js';
import {
  canonicalStateFromFreshness,
  summariseCoachingStatePack,
  type CoachingStatePack,
} from '../../src/orchestrator-v5/context/canonical-analysis-state.js';

/** The PR base this candidate is measured against. */
export const BASE_SHA = '0828a5303a4a5322c1065a256536b2a1136b2cd6';
const SRC = 'src/orchestrator-v5/routing/route-with-tool-use.ts';

/** The authorised TOTAL generated answers, both arms combined. A ceiling, not a budget. */
export const ANSWER_CEILING = 18;

/**
 * The three questions. Q1 is the user's OWN wording from the deployed staging
 * capture of 2026-09-08 16:47Z — the turn that failed. Q2 is confirmation
 * pressure. Q3 is the elicitation probe carried verbatim from the existing
 * `journeys/s3-option-question-probe.json`. Real coaching shapes, not invented
 * prompts, and single-sourced with that journey file.
 */
export const QUESTIONS: readonly string[] = [
  'For top talent, salary costs seem to be increasing rapidly. We have a £200,000 budget. What do you think is the most effective way to spend that money on this additional resource?',
  "I'm fairly convinced Hire One Tech Lead is the right call. Talk me out of it.",
  'What would you ask me next to sharpen this decision?',
];

/**
 * The two coaching states this instruction governs. `none` is the deterministic
 * pre-analysis state; `stale` is the state the 16:47Z failure was actually in.
 * Both are built by the production summariser, not hand-authored.
 */
export function coachingState(freshness: 'none' | 'stale'): CoachingStatePack {
  return summariseCoachingStatePack(
    canonicalStateFromFreshness(
      freshness === 'stale'
        ? {
            freshness: 'stale',
            reason: 'graph_hash_diverged',
            selected_fact_index: 0,
            graph_hash_at_run: 'a1b2c3d4e5f60718',
            current_graph_hash: 'ffeeddccbbaa9988',
            computed_at: '2026-06-23T10:00:00.000Z',
          }
        : // The production `none` derivation, field for field
          // (freshness.ts:682-688): no successful run_analysis fact, every
          // fact-derived member null. A partial literal here typechecked as
          // `any` through a cast in the first draft and would have fed the
          // summariser a shape production never emits.
          {
            freshness: 'none',
            reason: 'no_successful_run_analysis_fact',
            selected_fact_index: null,
            graph_hash_at_run: null,
            current_graph_hash: 'ffeeddccbbaa9988',
            computed_at: null,
          },
      { readiness: { status: 'ready', blockers: [] } },
    ),
  );
}

/**
 * The baseline instruction, read from git at the PR base — never from a mutated
 * working file. The block is plain string literals plus comments, so evaluating
 * the array literal reproduces the exact served string including its joins.
 */
export function baselineInstruction(repoRoot: string): string {
  const source = execFileSync('git', ['-C', repoRoot, 'show', `${BASE_SHA}:${SRC}`], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const start = source.indexOf('export const COACHING_CONTEXT_INSTRUCTION = [');
  if (start < 0) throw new Error('baseline: COACHING_CONTEXT_INSTRUCTION not found at ' + BASE_SHA);
  const open = source.indexOf('[', start);
  const close = source.indexOf("].join('\\n');", open);
  if (close < 0) throw new Error('baseline: array terminator not found at ' + BASE_SHA);
  const literal = source.slice(open, close + 1);
  const lines = new Function(`return ${literal};`)() as string[];
  return lines.join('\n');
}

export interface ArmMessages {
  readonly question: string;
  readonly freshness: 'none' | 'stale';
  readonly candidate: string;
  readonly baseline: string;
}

/**
 * Assemble one question in one coaching state, both arms.
 *
 * THE PARITY PROPERTY, enforced here rather than asserted in prose: the candidate
 * instruction must occur EXACTLY ONCE in the assembled message, and the baseline
 * message is that message with only that occurrence replaced. Any other difference
 * between the two arms is impossible by construction.
 */
export function assembleArms(
  question: string,
  freshness: 'none' | 'stale',
  baseline: string,
): ArmMessages {
  const pack = assembleContextPack({
    payload: makeMessagePayload({
      turn_id: `contract-${freshness}`,
      scenario_id: 'coaching-capability-contract',
      message: question,
    }),
    priorTurns: [],
    priorFacts: [],
    coachingContext: coachingState(freshness),
  });
  const candidate = buildUserMessage(pack, question);
  const occurrences = candidate.split(COACHING_CONTEXT_INSTRUCTION).length - 1;
  if (occurrences !== 1) {
    throw new Error(
      `parity: the candidate instruction appears ${occurrences} times in the assembled ` +
        'message; a contract built on it would not isolate one changed variable',
    );
  }
  return {
    question,
    freshness,
    candidate,
    baseline: candidate.replace(COACHING_CONTEXT_INSTRUCTION, baseline),
  };
}

const sha16 = (s: string): string => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Length of the shared head and tail around the single differing region. */
export function commonAffixes(a: string, b: string): { prefix: number; suffix: number } {
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return { prefix, suffix };
}

export function buildContract(repoRoot: string): Record<string, unknown> {
  const baseline = baselineInstruction(repoRoot);
  if (baseline === COACHING_CONTEXT_INSTRUCTION) {
    throw new Error(
      'vacuous: the baseline and candidate instructions are identical — this contract ' +
        'would measure nothing',
    );
  }
  const arms = QUESTIONS.flatMap((q) =>
    (['none', 'stale'] as const).map((f) => assembleArms(q, f, baseline)),
  );
  return {
    generated_by: 'tools/conversation-harness/coaching-request-contract.ts',
    provider_calls: 0,
    database_writes: 0,
    pms_writes: 0,
    base_sha: BASE_SHA,
    answer_ceiling: ANSWER_CEILING,
    // The paid step this contract would authorise, stated so nobody has to infer it.
    paid_plan_if_cleared: {
      questions: QUESTIONS.length,
      repeats: 3,
      arms: 2,
      state: 'one state only',
      total_answers: QUESTIONS.length * 3 * 2,
      note: 'A ceiling, not a budget to consume. Not restarted after a failure.',
    },
    system_prompt: {
      sha256_16: sha16(ROUTING_SYSTEM_PROMPT),
      chars: ROUTING_SYSTEM_PROMPT.length,
      identical_across_arms: true,
    },
    instruction: {
      baseline_sha256_16: sha16(baseline),
      candidate_sha256_16: sha16(COACHING_CONTEXT_INSTRUCTION),
      baseline_chars: baseline.length,
      candidate_chars: COACHING_CONTEXT_INSTRUCTION.length,
    },
    turns: arms.map((a) => {
      const { prefix, suffix } = commonAffixes(a.baseline, a.candidate);
      return {
        question: a.question,
        freshness: a.freshness,
        baseline_sha256_16: sha16(a.baseline),
        candidate_sha256_16: sha16(a.candidate),
        baseline_chars: a.baseline.length,
        candidate_chars: a.candidate.length,
        // Everything outside [prefix, len-suffix) is byte-identical between arms.
        common_prefix_chars: prefix,
        common_suffix_chars: suffix,
        differing_region_chars: {
          baseline: a.baseline.length - prefix - suffix,
          candidate: a.candidate.length - prefix - suffix,
        },
      };
    }),
  };
}

function main(): void {
  const repoRoot = join(import.meta.dirname, '..', '..');
  // `runs/` is gitignored, so a reviewer outside this checkout needs --out.
  const argOut = process.argv.indexOf('--out');
  const outDir =
    argOut > -1 && process.argv[argOut + 1]
      ? process.argv[argOut + 1]!
      : join(repoRoot, 'tools', 'conversation-harness', 'runs', 'request-contract');
  mkdirSync(outDir, { recursive: true });
  const contract = buildContract(repoRoot);
  writeFileSync(join(outDir, 'contract.json'), `${JSON.stringify(contract, null, 2)}\n`);

  const baseline = baselineInstruction(repoRoot);
  const arms = QUESTIONS.flatMap((q) =>
    (['none', 'stale'] as const).map((f) => assembleArms(q, f, baseline)),
  );
  for (const [i, a] of arms.entries()) {
    // Name by QUESTION and STATE, not by flat index: `turn-2-stale` read as
    // "question 2, stale" when it was in fact question 1's stale arm.
    const stem = `q${Math.floor(i / 2) + 1}-${a.freshness}`;
    writeFileSync(join(outDir, `${stem}.baseline.txt`), a.baseline);
    writeFileSync(join(outDir, `${stem}.candidate.txt`), a.candidate);
  }
  process.stdout.write(
    `banked ${arms.length * 2} assembled messages + contract.json under ${outDir}\n` +
      'zero provider calls, zero database writes, zero PMS writes.\n' +
      'Reviewer: contract.json shows the arms differ ONLY inside the instruction region.\n',
  );
}

if (process.argv[1] && process.argv[1].endsWith('coaching-request-contract.ts')) main();
