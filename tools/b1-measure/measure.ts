/**
 * ROADMAP 1.77 (B1) — measurement rig for the decomposed-vs-monolith
 * `decision_review` A/B, honouring 07-REVIEW revision **R6** ("re-pin the
 * arithmetic against live staging before booking any latency or cost number").
 *
 * WHAT THIS IS. The design pack booked two numbers as headline claims:
 * ~4x faster (13-16s -> 3-4s) and ~3x cheaper (~$0.030 -> ~$0.010). Both were
 * ESTIMATES derived from assumed decode rates and an assumed ~1.3k-input
 * per-slice size. This rig replaces the estimate with a MEASUREMENT: it drives
 * the REAL `invokeDecisionReview` (gpt-4.1 monolith) and the REAL
 * `invokeDecomposedDecisionReview` (4x claude-haiku-4-5 fan-out) over the SAME
 * frozen input, N paired times, and reports observed medians.
 *
 * WHAT IT IS NOT. It is not the conversation-harness A/B (that scores prompt
 * QUALITY dims and is the promotion gate's other half, 07-REVIEW R2/R3). This
 * rig measures ONLY latency + tokens + cost — the two claims R6 governs.
 *
 * POSITIVE CONTROL (CLAUDE.md trap 13 — an absence/perf assertion is vacuous
 * unless it can see a presence). Every run records the PROVIDER-RESOLVED model
 * id and the real token counts returned by the API. A stubbed or short-circuited
 * call would surface as a zero-token / sub-100ms row and is reported, never
 * silently averaged in. `--verify-live` probes both providers first and refuses
 * to run if either model is not live-callable (the 1.79 retired-haiku class:
 * registry presence != live-callable).
 *
 * FALLBACK ACCOUNTING (the honest-cost point). When the composed review fails
 * its consistency check the decomposed path FALLS BACK to the monolith — so the
 * turn pays the haiku fan-out AND the gpt-4.1 monolith. Reporting only the
 * composed-arm cost would flatter the arm. This rig therefore reports THREE
 * figures per arm: `composed_only` (runs that shipped decomposed), `fallback`
 * (runs that degraded), and `effective` (all runs, fan-out + monolith where it
 * fired) — `effective` is the number that decides the promotion criterion.
 *
 * Usage:
 *   NODE_ENV=test tsx tools/b1-measure/measure.ts --n 5 [--verify-live] [--out FILE]
 *
 * Requires ANTHROPIC_API_KEY + OPENAI_API_KEY. Makes REAL, BILLED LLM calls
 * (2 x N of them). Reads nothing from and writes nothing to PMS or staging.
 */

import { setTestSink } from '../../src/utils/telemetry.js';
import { invokeDecisionReview } from '../../src/cee/decision-review/invoke.js';
import { invokeDecomposedDecisionReview, resolveDecomposeModel } from '../../src/cee/decision-review/decompose.js';
import { buildFrozenInput } from './frozen-input.js';

// ---------------------------------------------------------------------------
// Pricing — mirrored from src/utils/telemetry.ts (USD per 1k tokens).
// Kept as an explicit local constant so a silent upstream pricing edit cannot
// retroactively rewrite a booked measurement; the values are asserted against
// the design pack's own assumptions in the report header.
// ---------------------------------------------------------------------------
const PRICING: Record<string, { in: number; out: number }> = {
  'gpt-4.1': { in: 0.002, out: 0.008 },
  'gpt-4.1-2025-04-14': { in: 0.002, out: 0.008 },
  'claude-haiku-4-5': { in: 0.001, out: 0.005 },
  'claude-haiku-4-5-20251001': { in: 0.001, out: 0.005 },
};

function costUsd(model: string, inTok: number, outTok: number): number {
  const p = PRICING[model];
  if (!p) return Number.NaN;
  return (inTok / 1000) * p.in + (outTok / 1000) * p.out;
}

function median(xs: readonly number[]): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

// ---------------------------------------------------------------------------
// Live-callability probe (1.79 class). Registry presence != live-callable.
// ---------------------------------------------------------------------------
async function verifyLive(haikuModel: string): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  const a = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: haikuModel, max_tokens: 4, messages: [{ role: 'user', content: 'ok' }] }),
  });
  const ab = (await a.json()) as { model?: string };
  out.push({ model: haikuModel, provider: 'anthropic', status: a.status, resolved: ab.model ?? null });

  const o = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ''}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'gpt-4.1', max_tokens: 4, messages: [{ role: 'user', content: 'ok' }] }),
  });
  const ob = (await o.json()) as { model?: string };
  out.push({ model: 'gpt-4.1', provider: 'openai', status: o.status, resolved: ob.model ?? null });

  const dead = out.filter((r) => r.status !== 200);
  if (dead.length > 0) {
    throw new Error(`live-callability probe FAILED for: ${dead.map((d) => d.model).join(', ')} — refusing to measure against a dead model (1.79 class)`);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
interface RunRow {
  readonly arm: 'monolith' | 'decomposed';
  readonly i: number;
  readonly wall_ms: number;
  readonly model: string;
  readonly prompt_version: string | undefined;
  readonly input_tokens: number;
  readonly output_tokens: number;
  readonly cost_usd: number;
  /** decomposed only: did the composed review ship, or did it fall back? */
  readonly outcome?: string;
  readonly fallback_reason?: string | null;
  readonly violation_count?: number;
  readonly fanout_input_tokens?: number;
  readonly fanout_output_tokens?: number;
  /** effective cost incl. the fan-out already paid for before a fallback */
  readonly effective_cost_usd?: number;
  /**
   * Fan-out wall-clock ONLY (from telemetry), excluding any monolith fallback
   * that followed. This is the number the "~4x faster" claim is really about;
   * `wall_ms` is what the USER waits, which on a fallback is fan-out + monolith.
   */
  readonly fanout_wall_ms?: number;
  /** The consistency violations that forced a fallback (why, not just that). */
  readonly violations?: readonly string[];
  readonly error?: string;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const n = Number(argv[argv.indexOf('--n') + 1] ?? 5);
  const doVerify = argv.includes('--verify-live');
  const outIdx = argv.indexOf('--out');
  const outFile = outIdx >= 0 ? argv[outIdx + 1] : null;

  const haikuModel = resolveDecomposeModel();
  const input = buildFrozenInput();

  const probe = doVerify ? await verifyLive(haikuModel) : [];

  // Telemetry sink — the decomposed path discloses its fan-out spend and its
  // outcome here even when it degrades to the monolith.
  let lastDecomposed: Record<string, unknown> | null = null;
  setTestSink((event, data) => {
    if (event === 'v5.decision_review.decomposed') lastDecomposed = data;
  });

  const rows: RunRow[] = [];

  for (let i = 0; i < n; i += 1) {
    // --- Arm A: the gpt-4.1 monolith (what serves today) ---
    {
      const t0 = Date.now();
      try {
        const r = await invokeDecisionReview(input, { requestId: `b1-measure-mono-${i}`, timeoutMs: 60_000 });
        rows.push({
          arm: 'monolith', i, wall_ms: Date.now() - t0, model: r.model, prompt_version: r.prompt_version,
          input_tokens: r.input_tokens, output_tokens: r.output_tokens,
          cost_usd: costUsd(r.model, r.input_tokens, r.output_tokens),
        });
      } catch (e) {
        rows.push({ arm: 'monolith', i, wall_ms: Date.now() - t0, model: 'n/a', prompt_version: undefined, input_tokens: 0, output_tokens: 0, cost_usd: Number.NaN, error: String(e).slice(0, 200) });
      }
    }

    // --- Arm B: the 4x haiku decomposed fan-out ---
    {
      lastDecomposed = null;
      const t0 = Date.now();
      try {
        const r = await invokeDecomposedDecisionReview(input, { requestId: `b1-measure-dec-${i}`, timeoutMs: 60_000 });
        const tel = (lastDecomposed ?? {}) as Record<string, unknown>;
        const fanIn = Number(tel.input_tokens ?? 0);
        const fanOut = Number(tel.output_tokens ?? 0);
        const outcome = String(tel.outcome ?? 'unknown');
        // On fallback the returned result IS the monolith's; the fan-out was
        // still billed, so effective = fan-out + monolith.
        const fellBack = outcome === 'fell_back';
        const effective = fellBack
          ? costUsd(haikuModel, fanIn, fanOut) + costUsd(r.model, r.input_tokens, r.output_tokens)
          : costUsd(r.model, r.input_tokens, r.output_tokens);
        rows.push({
          arm: 'decomposed', i, wall_ms: Date.now() - t0, model: r.model, prompt_version: r.prompt_version,
          input_tokens: r.input_tokens, output_tokens: r.output_tokens,
          cost_usd: costUsd(r.model, r.input_tokens, r.output_tokens),
          outcome, fallback_reason: (tel.fallback_reason as string | null) ?? null,
          violation_count: Number(tel.violation_count ?? 0),
          fanout_input_tokens: fanIn, fanout_output_tokens: fanOut,
          fanout_wall_ms: Number(tel.wall_clock_ms ?? Number.NaN),
          effective_cost_usd: effective,
        });
      } catch (e) {
        rows.push({ arm: 'decomposed', i, wall_ms: Date.now() - t0, model: 'n/a', prompt_version: undefined, input_tokens: 0, output_tokens: 0, cost_usd: Number.NaN, error: String(e).slice(0, 200) });
      }
    }
  }

  const mono = rows.filter((r) => r.arm === 'monolith' && !r.error);
  const dec = rows.filter((r) => r.arm === 'decomposed' && !r.error);
  const decComposed = dec.filter((r) => r.outcome === 'composed');
  const decFellBack = dec.filter((r) => r.outcome === 'fell_back');

  const summary = {
    generated_at: new Date().toISOString(),
    n_requested: n,
    haiku_model: haikuModel,
    live_probe: probe,
    positive_control: {
      note: 'A stubbed call would show ~0 tokens or sub-100ms wall. Both arms must show real token counts and second-scale latency for the measurement to mean anything.',
      monolith_min_wall_ms: Math.min(...mono.map((r) => r.wall_ms)),
      monolith_min_input_tokens: Math.min(...mono.map((r) => r.input_tokens)),
      decomposed_min_wall_ms: Math.min(...dec.map((r) => r.wall_ms)),
      decomposed_min_fanout_input_tokens: Math.min(...dec.map((r) => r.fanout_input_tokens ?? 0)),
    },
    monolith: {
      runs: mono.length,
      median_wall_ms: median(mono.map((r) => r.wall_ms)),
      median_input_tokens: median(mono.map((r) => r.input_tokens)),
      median_output_tokens: median(mono.map((r) => r.output_tokens)),
      median_cost_usd: median(mono.map((r) => r.cost_usd)),
      models: [...new Set(mono.map((r) => r.model))],
      prompt_versions: [...new Set(mono.map((r) => r.prompt_version))],
    },
    decomposed: {
      runs: dec.length,
      composed: decComposed.length,
      fell_back: decFellBack.length,
      fallback_rate: dec.length > 0 ? decFellBack.length / dec.length : Number.NaN,
      fallback_reasons: decFellBack.map((r) => r.fallback_reason),
      median_wall_ms_all: median(dec.map((r) => r.wall_ms)),
      median_wall_ms_composed_only: median(decComposed.map((r) => r.wall_ms)),
      // Fan-out alone, excluding any monolith fallback that followed. This is
      // the figure the design's "~4x faster" claim actually describes; the
      // user-felt figure on a fallback run is `wall_ms` (fan-out + monolith).
      median_fanout_wall_ms: median(dec.map((r) => r.fanout_wall_ms ?? Number.NaN)),
      median_fanout_input_tokens: median(dec.map((r) => r.fanout_input_tokens ?? 0)),
      median_fanout_output_tokens: median(dec.map((r) => r.fanout_output_tokens ?? 0)),
      median_effective_cost_usd: median(dec.map((r) => r.effective_cost_usd ?? Number.NaN)),
      median_composed_only_cost_usd: median(decComposed.map((r) => r.effective_cost_usd ?? Number.NaN)),
    },
    verdict_inputs: {
      note: 'ROADMAP rerun criteria: faster median AND fallback <10% AND quality >= baseline (quality is NOT measured here — see 07-REVIEW R2/R3).',
      latency_ratio_all: median(mono.map((r) => r.wall_ms)) / median(dec.map((r) => r.wall_ms)),
      latency_ratio_composed_only: median(mono.map((r) => r.wall_ms)) / median(decComposed.map((r) => r.wall_ms)),
      cost_ratio_effective: median(mono.map((r) => r.cost_usd)) / median(dec.map((r) => r.effective_cost_usd ?? Number.NaN)),
      design_claim_latency: '~4x faster (13-16s -> 3-4s)',
      design_claim_cost: '~3x cheaper (~$0.030 -> ~$0.010)',
    },
    rows,
  };

  const json = JSON.stringify(summary, null, 2);
  if (outFile) {
    const fs = await import('node:fs');
    fs.writeFileSync(outFile, json);
  }
  process.stdout.write(json + '\n');
}

void main();
