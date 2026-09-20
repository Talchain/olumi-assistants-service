/**
 * MANUAL LIVE HARNESS — SPENDS REAL MONEY. Not part of any suite.
 *
 *   OLUMI_LIVE_HARNESS=1 npx tsx scripts/manual/replacement-live-harness.ts
 *
 * Refuses to run without that variable, so it cannot fire by accident in CI
 * or from a stray `tsx scripts/**`. Roughly eight model calls per run.
 *
 * Synthetic data only — this repository is public. Do not paste a real brief,
 * a real graph or real figures into it.
 *
 * WHY IT EXISTS. Every unit test in this layer runs against a scripted fake,
 * which is correct: it makes them fast, free and deterministic. But a
 * scripted fake cannot tell you whether the SYSTEM PROMPT works. The first
 * run of this harness found a defect no test could have: at temperature 0,
 * two identical four-turn conversations diverged — one asked the user for the
 * factor's range, the other silently converted "churn went from 3% to 4.4%"
 * into 0.47 and offered it as the user's own number. The prompt forbids
 * exactly that, and was obeyed once out of twice.
 *
 * The fix was not a firmer prompt. `set_option_effect` now refuses a factor
 * with no range. Both arms then behaved correctly, varying only in how they
 * asked.
 *
 * THE GENERAL LESSON, worth keeping: temperature 0 is not determinism. A
 * property that must hold EVERY time belongs in a tool's refusal. A property
 * measured over a distribution of runs belongs here, stated as a rate.
 *
 * The four turns are the four measured failures of 20 Sep, in order:
 *   1. an observation, which the retired path read as an edit request
 *   2. a stated fact with a number, which must be held as the user's
 *   3. a genuine change request, which must propose and not claim
 *   4. agreement, which must reach a receipt before anything says "done"
 */
if (process.env.OLUMI_LIVE_HARNESS !== '1') {
  console.error('Refusing to run: set OLUMI_LIVE_HARNESS=1. This harness makes real, paid model calls.');
  process.exit(2);
}

import { runReplacementTurn } from '../../src/orchestrator-v5/replacement/run-replacement-turn.js';
import { anthropicChatWithTools } from '../../src/orchestrator-v5/replacement/wiring.js';
import { createReadWorkspaceTool, createReadResultsTool } from '../../src/orchestrator-v5/replacement/read-tools.js';
import { createSetOptionEffectTool } from '../../src/orchestrator-v5/replacement/propose-tools.js';
import { EMPTY_CONVERSATION_MEMORY } from '../../src/orchestrator-v5/replacement/conversation-memory.js';
import { EMPTY_PROPOSAL_STORE } from '../../src/orchestrator-v5/replacement/proposal-store.js';
import { summariseWorkspace } from '../../src/orchestrator-v5/replacement/turn-entry.js';

const GRAPH = {
  nodes: [
    { id: 'dec-1', kind: 'decision', label: 'How should we price the new tier?' },
    { id: 'opt-hold', kind: 'option', label: 'Hold current pricing' },
    { id: 'opt-raise-new', kind: 'option', label: 'Raise prices for new customers only' },
    { id: 'opt-raise-all', kind: 'option', label: 'Raise prices for everyone' },
    { id: 'fac-churn', kind: 'factor', label: 'Monthly churn rate', value: 0.03, unit: 'ratio' },
    { id: 'fac-arpu', kind: 'factor', label: 'Average revenue per user', value: 42, unit: 'currency' },
    { id: 'out-rev', kind: 'outcome', label: 'Annual recurring revenue' },
  ],
  edges: [
    { from: 'opt-raise-new', to: 'fac-arpu' },
    { from: 'opt-raise-all', to: 'fac-arpu' },
    { from: 'opt-raise-all', to: 'fac-churn' },
    { from: 'fac-arpu', to: 'out-rev' },
    { from: 'fac-churn', to: 'out-rev' },
  ],
} as never;

const applied: unknown[] = [];
const TURNS = [
  // 1. An OBSERVATION. The measured failure: 9 of 26 turns treated this as an
  //    edit request and answered with a request for mutation parameters.
  "I'm worried the whole model assumes churn stays flat if we raise prices. That feels wrong to me.",
  // 2. A stated FACT with a number. Must be held as the user's, not re-estimated.
  'For what it&apos;s worth, when we raised prices in 2024 churn went from 3% to 4.4% within two months.',
  // 3. A genuine CHANGE request.
  'Can you set what raising prices for everyone does to churn, to reflect that?',
  // 4. Agreement. Must reach accept_proposal with a real quote, not a claim.
  'Yes, go ahead and make that change.',
];

async function main(): Promise<void> {
  let memory = EMPTY_CONVERSATION_MEMORY;
  let proposals = EMPTY_PROPOSAL_STORE;
  const history: Parameters<typeof runReplacementTurn>[0]['history'] = [];

  for (let i = 0; i < TURNS.length; i += 1) {
    const message = TURNS[i]!.replace(/&apos;/g, "'");
    const r = await runReplacementTurn(
      {
        message,
        history: [...history],
        memory,
        proposals,
        modelRevision: 'rev-1',
        workspaceSummary: summariseWorkspace(GRAPH),
        tools: [
          createReadWorkspaceTool({ getGraph: () => GRAPH, requestId: 'live' }),
          createReadResultsTool({ getAnalysis: () => null }),
          createSetOptionEffectTool({ getGraph: () => GRAPH }),
        ],
        turnId: `turn-${i + 1}`,
        now: new Date().toISOString(),
        idFor: (p, n) => `${p}-t${i + 1}-${n}`,
      },
      {
        chatWithTools: anthropicChatWithTools(),
        applyOperations: async (a) => { applied.push(a); return { ok: true, receiptId: `receipt-${i}` }; },
      },
    );
    memory = r.memory;
    proposals = r.proposals;
    history.push({ role: 'user', content: message }, { role: 'assistant', content: r.text });

    console.log(`\n${'='.repeat(78)}\nTURN ${i + 1}  ·  tools: [${r.toolsCalled.join(', ') || 'none'}]  ·  iterations: ${r.iterations}  ·  applied: ${r.applied.length}`);
    console.log(`USER: ${message}`);
    console.log(`\nOLUMI: ${r.text}\n`);
  }
  console.log(`${'='.repeat(78)}\nWRITES SENT TO THE MUTATION PATH: ${applied.length}`);
  console.log(JSON.stringify(applied, null, 2).slice(0, 900));
}
main().catch((e: unknown) => { console.error('HARNESS FAILED:', e); process.exit(1); });
