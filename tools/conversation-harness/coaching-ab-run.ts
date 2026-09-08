/**
 * coaching-ab-run — the cleared, bounded, instruction-only A/B for CEE #1398.
 *
 * Authorised by the independent APPROVE at head
 * `34c50a2cf64dd1b669df10e2591e2f2f4749cacf`: approved fixed context/arguments,
 * instruction-only arms, ONE declared model/client, an isolated evaluator, and
 * ONE cumulative maximum of 18 ACTUAL provider attempts across all arms, states,
 * repetitions, failures and retries — never reset after interruption.
 *
 * ── WHAT IT DOES AND DOES NOT DO ──────────────────────────────────────────────
 *  · Reuses the approved pieces unchanged: `captureBoundary` (production
 *    assembly over the frozen nonempty context), `baselineArgs` (instruction-only
 *    swap, every other field shared), `AttemptBudget`, `dispatchBounded` (charge
 *    before send, inside the existing single-attempt scope so one charge is one
 *    provider attempt).
 *  · Declares its model and client in the receipt. The historical baseline
 *    instruction and the LOCAL v40 prompt snapshot are NOT the served v121
 *    prompt, and the results file says so.
 *  · Tool proposals are OBSERVED and written down; no handler is invoked and no
 *    module that could invoke one is imported.
 *  · No shared database, prompt store, environment or config is read or written.
 *    The API key is read from the operator's existing env file into this process
 *    only, and is never printed or persisted.
 *
 * ── THE LEDGER ────────────────────────────────────────────────────────────────
 * `ledger.json` in the output directory is the cumulative record. On every start
 * it is loaded and the budget is PRE-CHARGED with everything already spent, so an
 * interrupted run resumes with less budget, never with a fresh 18. Deleting the
 * ledger to buy more attempts would be defeating the control, not using it.
 *
 * Run (one process, no workers):
 *   pnpm exec tsx tools/conversation-harness/coaching-ab-run.ts --out <dir>
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../src/adapters/llm/types.js';
import { chatWithToolsAnthropic } from '../../src/adapters/llm/anthropic.js';
import {
  AttemptBudget,
  ATTEMPT_CEILING,
  baselineArgs,
  captureBoundary,
  dispatchBounded,
  snapshotProvenance,
  type BoundaryCapture,
} from './coaching-request-boundary.js';
import { QUESTIONS, baselineInstruction } from './coaching-request-contract.js';

/** THE declared model for this comparison. Staging's routing turn serves this id. */
const MODEL = 'claude-sonnet-5';
/** The state the witnessed 16:47Z failure was actually in. One state only. */
const STATE = 'stale' as const;
const REPEATS = 3;

interface LedgerEntry {
  readonly seq: number;
  readonly at: string;
  readonly arm: 'baseline' | 'candidate';
  readonly question_index: number;
  readonly repeat: number;
  readonly ok: boolean;
  readonly error: string | null;
}
interface Ledger {
  readonly ceiling: number;
  readonly spent: number;
  readonly entries: LedgerEntry[];
}

function loadLedger(path: string): Ledger {
  if (!existsSync(path)) return { ceiling: ATTEMPT_CEILING, spent: 0, entries: [] };
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Ledger;
  return { ceiling: ATTEMPT_CEILING, spent: raw.spent ?? 0, entries: raw.entries ?? [] };
}

function argOut(): string {
  const i = process.argv.indexOf('--out');
  if (i > -1 && process.argv[i + 1]) return process.argv[i + 1]!;
  return join(import.meta.dirname, 'runs', 'ab-run');
}

/** Load the API key from the operator's existing env file into THIS process only. */
function loadApiKey(): void {
  if (process.env.ANTHROPIC_API_KEY) return;
  const envPath = process.env.COACHING_AB_ENV_FILE;
  if (!envPath || !existsSync(envPath)) {
    throw new Error(
      'BLOCKER: no ANTHROPIC_API_KEY in the environment and no readable COACHING_AB_ENV_FILE. ' +
        'This is an execution blocker to report, not a reason to change shared configuration.',
    );
  }
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#') || !t.includes('=')) continue;
    const [k, ...rest] = t.split('=');
    if (k === 'ANTHROPIC_API_KEY') {
      process.env.ANTHROPIC_API_KEY = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
      return;
    }
  }
  throw new Error('BLOCKER: ANTHROPIC_API_KEY not present in the supplied env file.');
}

async function main(): Promise<void> {
  if (!process.argv.includes('--dry-run')) loadApiKey();
  const out = argOut();
  mkdirSync(out, { recursive: true });
  const ledgerPath = join(out, 'ledger.json');
  const ledger = loadLedger(ledgerPath);

  const budget = new AttemptBudget(ATTEMPT_CEILING);
  // NEVER RESET: everything already spent is re-charged before anything is sent.
  for (let i = 0; i < ledger.spent; i += 1) budget.charge();
  if (budget.remaining === 0) {
    process.stdout.write(`budget exhausted (${ledger.spent}/${ATTEMPT_CEILING}); nothing dispatched\n`);
    return;
  }

  const baseline = baselineInstruction();
  const captures: BoundaryCapture[] = [];
  for (const q of QUESTIONS) captures.push(await captureBoundary(q, STATE));

  // Arm-paired ordering: if the budget runs out mid-run the completed pairs are
  // still comparable, rather than one arm being systematically favoured.
  const plan: { arm: 'baseline' | 'candidate'; qi: number; repeat: number; args: ChatWithToolsArgs }[] = [];
  for (let r = 1; r <= REPEATS; r += 1) {
    for (let qi = 0; qi < captures.length; qi += 1) {
      const cap = captures[qi]!;
      plan.push({ arm: 'baseline', qi, repeat: r, args: baselineArgs(cap.args, baseline) });
      plan.push({ arm: 'candidate', qi, repeat: r, args: cap.args });
    }
  }
  const affordable = plan.slice(0, budget.remaining);

  // Side-channel OBSERVATION of each raw response. The approved dispatcher
  // deliberately records only a proposal count; the reviewer needs to read the
  // delivered answer, and a tool proposal's authored text is where a routing turn
  // puts it. Observed, written down, never executed.
  const observed: { blocks: { type: string; text?: string; input?: unknown }[]; model: string }[] = [];
  const issued: LedgerEntry[] = [];
  const dryRun = process.argv.includes('--dry-run');
  const send = async (args: ChatWithToolsArgs): Promise<ChatWithToolsResult> => {
    // ⚠ THE LEDGER IS WRITTEN AT THE MOMENT AN ATTEMPT IS ISSUED, not at the end
    // of the run. A crash between the charge and the final write would otherwise
    // lose the record of attempts that were really made — which is a silent
    // budget reset, the exact thing this control exists to prevent.
    const p = affordable[issued.length]!;
    issued.push({
      seq: ledger.spent + issued.length + 1,
      at: new Date().toISOString(),
      arm: p.arm,
      question_index: p.qi,
      repeat: p.repeat,
      ok: false,
      error: 'issued; outcome not yet recorded',
    });
    if (!dryRun) {
      writeFileSync(
        ledgerPath,
        `${JSON.stringify({ ceiling: ATTEMPT_CEILING, spent: ledger.spent + issued.length, entries: [...ledger.entries, ...issued] }, null, 2)}\n`,
      );
    }
    if (dryRun) {
      observed.push({ model: 'dry-run', blocks: [{ type: 'text', text: '[dry run: no provider call]' }] });
      return {
        content: [{ type: 'text', text: '[dry run: no provider call]' }],
        stop_reason: 'end_turn',
        usage: {},
        model: 'dry-run',
        latencyMs: 0,
      } as unknown as ChatWithToolsResult;
    }
    const result = await chatWithToolsAnthropic({ ...args, model: MODEL } as never);
    observed.push({
      model: result.model,
      blocks: result.content.map((b) =>
        b.type === 'text'
          ? { type: 'text', text: (b as { text: string }).text }
          : { type: b.type, input: (b as { input?: unknown }).input },
      ),
    });
    return result;
  };

  const started = new Date().toISOString();
  const records = await dispatchBounded(
    affordable.map((p, i) => ({
      arm: p.arm,
      capture: { ...captures[p.qi]!, question: captures[p.qi]!.question },
      args: p.args,
      _i: i,
    })) as never,
    send,
    budget,
  );

  const entries: LedgerEntry[] = [...ledger.entries];
  const results = records.map((rec, i) => {
    const p = affordable[i]!;
    entries.push({
      seq: ledger.spent + i + 1,
      at: new Date().toISOString(),
      arm: p.arm,
      question_index: p.qi,
      repeat: p.repeat,
      ok: rec.ok,
      error: rec.error,
    });
    const obs = rec.ok ? observed.shift() : undefined;
    return {
      seq: ledger.spent + i + 1,
      arm: p.arm,
      repeat: p.repeat,
      question: captures[p.qi]!.question,
      freshness: STATE,
      ok: rec.ok,
      error: rec.error,
      provider_model: obs?.model ?? null,
      answer_text: obs?.blocks.find((b) => b.type === 'text')?.text ?? null,
      tool_proposal_observed_not_executed: obs?.blocks.filter((b) => b.type === 'tool_use') ?? [],
    };
  });

  if (!dryRun) {
    writeFileSync(
      ledgerPath,
      `${JSON.stringify({ ceiling: ATTEMPT_CEILING, spent: budget.spent, entries }, null, 2)}\n`,
    );
  }
  writeFileSync(
    join(out, 'results.json'),
    `${JSON.stringify(
      {
        started,
        finished: new Date().toISOString(),
        declared_model: MODEL,
        declared_client: 'chatWithToolsAnthropic (non-streaming), single-attempt scope',
        state: STATE,
        repeats: REPEATS,
        attempts_this_run: records.length,
        attempts_cumulative: budget.spent,
        attempt_ceiling: ATTEMPT_CEILING,
        prompt_snapshot: await snapshotProvenance(),
        caveats: [
          'The baseline arm is the historical instruction at PR base 0828a530. It is NOT the served v121 prompt, and this is NOT a replay of the 2026-09-08 16:47Z native turn.',
          'Local prompt snapshot is the registered default (v40), declared synthetic.',
          'Prior conversation turns in the context are synthesised from the frozen brief.',
          'Tool proposals were observed only. No handler was invoked.',
        ],
        results,
      },
      null,
      2,
    )}\n`,
  );
  process.stdout.write(
    `attempts this run ${records.length}; cumulative ${budget.spent}/${ATTEMPT_CEILING}; ` +
      `ok ${records.filter((r) => r.ok).length}, failed ${records.filter((r) => !r.ok).length}\n` +
      `results: ${join(out, 'results.json')}\nledger: ${ledgerPath}\n`,
  );
}

await main();
