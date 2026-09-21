/**
 * ROADMAP 1.77 (B1) — fallback diagnostic.
 *
 * `measure.ts` reports THAT the composed review fell back and how often;
 * this reports WHY, at the level of the fragment text. It fires the R1
 * HEADLINE sub-call once over the same frozen input, then prints the produced
 * `narrative_summary` verbatim beside the authoritative winner label and the
 * verdict of each individual consistency rule.
 *
 * The question it exists to answer: when
 * `narrative_summary does not name the winning option` fires, did the model
 * (a) genuinely crown a different option — the check working as designed — or
 * (b) merely PARAPHRASE the winner's label ("raising prices by 8%" for the
 * label "Raise prices by 8 percent"), in which case the check is too strict for
 * natural prose and is manufacturing fallbacks on coherent reviews. Those two
 * have opposite remedies, and the fallback rate is meaningless until they are
 * told apart.
 *
 * Usage: NODE_ENV=test tsx tools/b1-measure/diagnose.ts [--n 3]
 * Makes REAL, BILLED LLM calls (1 per run — R1 only, not the full fan-out).
 */

import { chatWithAnthropic } from '../../src/adapters/llm/anthropic.js';
import { extractJsonFromResponse } from '../../src/utils/json-extractor.js';
import { buildSlices, resolveDecomposeModel } from '../../src/cee/decision-review/decompose.js';
import {
  DECOMPOSE_R1_HEADLINE_PROMPT,
  DECOMPOSE_R2_DRIVER_PROMPT,
  DECOMPOSE_R3_FRAGILITY_PROMPT,
  DECOMPOSE_R4_CALIBRATION_PROMPT,
} from '../../src/cee/decision-review/decompose-prompts.js';
import { buildFrozenInput } from './frozen-input.js';

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const n = Number(argv[argv.indexOf('--n') + 1] ?? 3);
  const input = buildFrozenInput();
  const { slices, ctx } = buildSlices(input);
  const model = resolveDecomposeModel();

  console.log(`winner label (authoritative): ${JSON.stringify(ctx.winnerLabel)}`);
  console.log(`option labels in corpus: ${JSON.stringify(ctx.optionLabels)}`);
  console.log('');

  for (let i = 0; i < n; i += 1) {
    const res = await chatWithAnthropic({
      system: DECOMPOSE_R1_HEADLINE_PROMPT,
      userMessage: slices.r1,
      model,
      temperature: 0,
      maxTokens: 1500,
      timeoutMs: 60_000,
      requestId: `b1-diagnose-${i}`,
    });
    const extraction = extractJsonFromResponse(res.content, { task: 'decision_review', model: res.model, correlationId: `b1-diagnose-${i}` });
    const json = (extraction.json ?? {}) as Record<string, unknown>;
    const narrative = typeof json.narrative_summary === 'string' ? json.narrative_summary : '';

    const namesWinnerExactly = narrative.toLowerCase().includes(ctx.winnerLabel.toLowerCase());
    // Which other option labels DOES it name exactly?
    const namesOthers = ctx.optionLabels.filter(
      (l) => l.toLowerCase() !== ctx.winnerLabel.toLowerCase() && narrative.toLowerCase().includes(l.toLowerCase()),
    );

    console.log(`--- run ${i} (${res.latencyMs}ms, ${res.usage.output_tokens} out-tok) ---`);
    console.log(`names winner label EXACTLY: ${namesWinnerExactly}`);
    console.log(`names other option labels exactly: ${JSON.stringify(namesOthers)}`);
    console.log(`story_headlines keys: ${JSON.stringify(Object.keys((json.story_headlines ?? {}) as object))}`);
    console.log(`narrative_summary:\n${narrative}\n`);
  }

  // ---------------------------------------------------------------------------
  // Per-fragment profile. "Max not sum" holds only if the four slices are
  // comparably sized; the design assumed ~250 output tokens EACH. If one
  // fragment decodes far more than the others it alone sets the fan-out wall,
  // and the parallelism win is capped by it. This prints which one.
  // ---------------------------------------------------------------------------
  console.log('=== per-fragment profile (one parallel fan-out) ===');
  const specs = [
    ['R1 headline', DECOMPOSE_R1_HEADLINE_PROMPT, slices.r1],
    ['R2 driver', DECOMPOSE_R2_DRIVER_PROMPT, slices.r2],
    ['R3 fragility', DECOMPOSE_R3_FRAGILITY_PROMPT, slices.r3],
    ['R4 calibration', DECOMPOSE_R4_CALIBRATION_PROMPT, slices.r4],
  ] as const;

  const t0 = Date.now();
  const profiled = await Promise.all(
    specs.map(async ([name, system, userMessage]) => {
      const started = Date.now();
      const r = await chatWithAnthropic({
        system, userMessage, model, temperature: 0, maxTokens: 1500,
        timeoutMs: 60_000, requestId: `b1-profile-${name.split(' ')[0]}`,
      });
      return { name, wall_ms: Date.now() - started, in_tok: r.usage.input_tokens, out_tok: r.usage.output_tokens };
    }),
  );
  const fanoutWall = Date.now() - t0;

  for (const p of profiled) {
    console.log(`${p.name.padEnd(16)} wall=${String(p.wall_ms).padStart(6)}ms  in=${String(p.in_tok).padStart(5)}  out=${String(p.out_tok).padStart(5)}`);
  }
  const slowest = profiled.reduce((a, b) => (a.wall_ms > b.wall_ms ? a : b));
  console.log(`fan-out wall = ${fanoutWall}ms; slowest fragment = ${slowest.name} (${slowest.wall_ms}ms, ${slowest.out_tok} out-tok)`);
  console.log(`sum of fragment walls = ${profiled.reduce((s, p) => s + p.wall_ms, 0)}ms (parallelism saved ${profiled.reduce((s, p) => s + p.wall_ms, 0) - fanoutWall}ms)`);
  console.log(`total fan-out tokens: in=${profiled.reduce((s, p) => s + p.in_tok, 0)} out=${profiled.reduce((s, p) => s + p.out_tok, 0)}`);
  console.log(`design assumed: ~1300 in / ~250 out PER CALL`);
}

void main();
