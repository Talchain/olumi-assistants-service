/**
 * A/B verdict (conversation-harness — ROADMAP 1.70 v1).
 *
 * Diffs a BASELINE run against a CANDIDATE run on the prompt-quality dims
 * (prompt-dims.ts) and emits an evidence artifact the orchestrator can promote
 * on: per-dim baseline vs candidate value + delta + improved/regressed/flat, and
 * an overall better / worse / mixed / no-change / inconclusive call.
 *
 * PURE diff — no src/ imports, no live calls. It reads the `prompt_dims` block
 * that score-run.ts already wrote into each run's scores.json, so the only src/
 * dependency (the production guards behind PQ5/PQ6) lives in score-run.ts.
 *
 * Flakiness handling (live-model nondeterminism):
 *   - Pass N>=3 run dirs per side (BASELINE_DIRS / CANDIDATE_DIRS). Flaky
 *     QUALITY dims (PQ1..PQ4) aggregate by MEDIAN across the side's runs; the
 *     SAFETY dims (PQ5 guard-cleanliness, PQ6 coherence) aggregate by WORST-run
 *     (any-hit / any-contradiction) so an intermittent leak or contradiction in
 *     even one rerun still gates — never averaged away. A single run per side is
 *     allowed but flagged low-confidence.
 *   - A dim is only called improved/regressed when |candidate - baseline| clears
 *     a per-dim NOISE threshold; smaller moves are "flat". Thresholds are chosen
 *     to sit above typical rerun spread and are recorded in the artifact.
 *   - GATING dims (PQ5 guard-cleanliness, PQ6 coherence): a regression caps the
 *     verdict at "worse" no matter how many other dims improved — introducing a
 *     forbidden phrase or a self-contradiction is disqualifying.
 *   - NEUTRAL dims (PQ2 question-asking) are reported but never scored good/bad.
 *
 * Usage (single run per side):
 *   BASELINE_DIR=runs/base CANDIDATE_DIR=runs/cand \
 *     pnpm exec tsx tools/conversation-harness/scorer/ab-verdict.ts
 * Usage (N>=3 reruns per side, recommended):
 *   BASELINE_DIRS=runs/base-a,runs/base-b,runs/base-c \
 *   CANDIDATE_DIRS=runs/cand-a,runs/cand-b,runs/cand-c \
 *     pnpm exec tsx tools/conversation-harness/scorer/ab-verdict.ts
 * Writes ab-verdict.json + ab-verdict.md into the (first) candidate dir, or AB_OUT.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PromptDimScore, PromptDimDirection } from './prompt-dims.js';

/** Above-noise deltas that count as a real move (chosen > typical rerun spread). */
export const NOISE_THRESHOLD: Record<string, number> = {
  'PQ1-brevity-density': 8, // words
  'PQ2-question-asking': 0.5, // questions/turn (neutral — informational)
  'PQ3-grounding': 0.15, // fraction
  'PQ4-chip-correctness': 0.15, // fraction
  'PQ5-guard-cleanliness': 0.5, // hits
  'PQ6-coherence': 0.5, // contradictions
  // OPS promotion criteria (the B1 experiment exposed these as missing from the
  // verdict): a prompt that wins on quality but doubles latency / token cost or
  // starts engaging fallbacks is NOT promotable unexamined.
  'OPS-latency-median': 2500, // ms per turn (median)
  'OPS-cost-tokens': 5000, // total LLM tokens per run (in+out)
  'OPS-fallback-rate': 0.15, // fraction of turns engaging a fallback
};

// ---------- OPS metrics (latency / cost / fallback-engagement) ----------

/** Per-run operational metrics, derived from the scores.json rows that
 * score-run.ts writes. All null-honest: a metric absent from the rows (old
 * artifacts, no diagnostic trace) is null and excluded — never treated as 0. */
export interface OpsMetrics {
  /** Median wall-clock ms across executed turns. */
  latencyMedianMs: number | null;
  /** Total LLM tokens (input+output) across the run — the cost proxy. */
  totalTokens: number | null;
  /** Fraction of measurable turns whose diagnostic trace shows fallback engagement. */
  fallbackRate: number | null;
}

/** Row fields consumed: wall_clock_ms, llm_tokens_in/out, fallback_engaged
 * (all written by score-run.ts at this base; absent on older scores.json). */
export function opsFromRows(rows: Record<string, unknown>[]): OpsMetrics {
  const active = (rows ?? []).filter((r) => !r.skipped);
  const wall = active.map((r) => r.wall_clock_ms).filter((v): v is number => typeof v === 'number');
  const tokens = active
    .map((r) => {
      const tin = r.llm_tokens_in;
      const tout = r.llm_tokens_out;
      if (typeof tin !== 'number' && typeof tout !== 'number') return null;
      return (typeof tin === 'number' ? tin : 0) + (typeof tout === 'number' ? tout : 0);
    })
    .filter((v): v is number => v != null);
  const fallbackKnown = active.map((r) => r.fallback_engaged).filter((v): v is boolean => typeof v === 'boolean');
  return {
    latencyMedianMs: wall.length ? Number(median(wall).toFixed(0)) : null,
    totalTokens: tokens.length ? tokens.reduce((a, b) => a + b, 0) : null,
    fallbackRate: fallbackKnown.length
      ? Number((fallbackKnown.filter(Boolean).length / fallbackKnown.length).toFixed(3))
      : null,
  };
}

/** Synthesize the OPS dims for one run so they flow through the SAME delta /
 * threshold / aggregation machinery as the PQ dims. Lower-better, non-gating,
 * flaky (live-model + infra variance -> median across reruns). */
export function opsDimsForRun(ops: OpsMetrics | null | undefined): PromptDimScore[] {
  const mk = (dim: string, label: string, value: number | null, unit: string): PromptDimScore => ({
    dim,
    label,
    direction: 'lower-better',
    gating: false,
    flaky: true,
    value,
    unit,
    details: {},
    notes: [],
  });
  return [
    mk('OPS-latency-median', 'Latency (median wall-clock per turn)', ops?.latencyMedianMs ?? null, 'ms'),
    mk('OPS-cost-tokens', 'Cost (total LLM tokens, in+out)', ops?.totalTokens ?? null, 'tokens'),
    mk('OPS-fallback-rate', 'Fallback engagement (fraction of turns)', ops?.fallbackRate ?? null, 'fraction'),
  ];
}

export type AbOverall = 'better' | 'worse' | 'mixed' | 'no-change' | 'inconclusive';

export interface AbDimDelta {
  dim: string;
  label: string;
  direction: PromptDimDirection;
  gating: boolean;
  flaky: boolean;
  unit: string;
  baseline: number | null;
  candidate: number | null;
  delta: number | null;
  measurable: boolean;
  improved: boolean;
  regressed: boolean;
  flat: boolean;
  threshold: number;
  baselineRuns: (number | null)[];
  candidateRuns: (number | null)[];
  note: string;
}

export interface AbVerdict {
  generated_at: string;
  overall: AbOverall;
  reason: string;
  baseline_run_count: number;
  candidate_run_count: number;
  low_confidence: boolean;
  dims: AbDimDelta[];
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

type AggMode = 'median' | 'mean' | 'worst';

/** Aggregation mode for a dim across a side's reruns.
 *   - SAFETY dims (PQ5 guard-cleanliness, PQ6 coherence) -> 'worst' (any-hit /
 *     any-contradiction): a hit in even ONE rerun is disqualifying and must NOT
 *     be averaged below the gating threshold. Detected by the explicit `safety`
 *     flag, falling back to the `gating && !flaky` property for older
 *     scores.json that predate the flag (covers PQ5 only — pre-fix PQ6
 *     artifacts lack the flag and should be re-scored).
 *   - other flaky dims (PQ1–PQ4, OPS-*) -> 'median' (robust to a single outlier rerun)
 *   - other stable dims -> 'mean' */
function aggModeFor(meta: PromptDimScore): AggMode {
  const isSafety = meta.safety === true || (meta.gating && !meta.flaky);
  if (isSafety) return 'worst';
  return meta.flaky ? 'median' : 'mean';
}

/** Aggregate a dim's value across a side's runs per `mode`; null if every run was
 * non-measurable. Rounded to 3 dp. For 'worst', the direction picks the losing
 * extreme — max for a lower-better guard (more hits = worse), min for higher-better. */
function aggregate(values: (number | null)[], mode: AggMode, direction: PromptDimDirection): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  let v: number;
  if (mode === 'worst') v = direction === 'higher-better' ? Math.min(...present) : Math.max(...present);
  else if (mode === 'median') v = median(present);
  else v = mean(present);
  return Number(v.toFixed(3));
}

/** Given per-side arrays of PromptDimScore[] (one per run), produce the verdict.
 * `opts.baselineOps` / `opts.candidateOps` (one OpsMetrics per run, same order)
 * fold latency / cost / fallback-engagement into the verdict as scored
 * lower-better dims — the promotion criteria PQ-dims alone were missing. */
export function computeAbVerdict(
  baselineRuns: PromptDimScore[][],
  candidateRuns: PromptDimScore[][],
  opts: { baselineOps?: (OpsMetrics | null)[]; candidateOps?: (OpsMetrics | null)[] } = {},
): AbVerdict {
  const withOps = (runs: PromptDimScore[][], ops?: (OpsMetrics | null)[]): PromptDimScore[][] =>
    ops == null ? runs : runs.map((run, i) => [...run, ...opsDimsForRun(ops[i])]);
  baselineRuns = withOps(baselineRuns, opts.baselineOps);
  candidateRuns = withOps(candidateRuns, opts.candidateOps);
  // Dim order/metadata from the first run that has any dims.
  const template = (baselineRuns.find((r) => r.length) ?? candidateRuns.find((r) => r.length) ?? []) as PromptDimScore[];
  const dims: AbDimDelta[] = template.map((meta) => {
    const bVals = baselineRuns.map((run) => run.find((d) => d.dim === meta.dim)?.value ?? null);
    const cVals = candidateRuns.map((run) => run.find((d) => d.dim === meta.dim)?.value ?? null);
    const mode = aggModeFor(meta);
    const baseline = aggregate(bVals, mode, meta.direction);
    const candidate = aggregate(cVals, mode, meta.direction);
    const threshold = NOISE_THRESHOLD[meta.dim] ?? 0;
    const measurable = baseline != null && candidate != null;
    const delta = measurable ? Number((candidate! - baseline!).toFixed(3)) : null;

    let improved = false;
    let regressed = false;
    if (measurable && meta.direction !== 'neutral' && Math.abs(delta!) > threshold) {
      const candidateBetter = meta.direction === 'higher-better' ? delta! > 0 : delta! < 0;
      improved = candidateBetter;
      regressed = !candidateBetter;
    }
    const flat = measurable && !improved && !regressed;
    const note = !measurable
      ? 'not measurable in one or both sides — excluded from the overall call'
      : meta.direction === 'neutral'
        ? 'neutral dim — delta reported, not scored'
        : improved
          ? 'candidate better (beyond noise)'
          : regressed
            ? `candidate WORSE (beyond noise)${meta.gating ? ' — GATING' : ''}`
            : 'within noise (flat)';
    return {
      dim: meta.dim,
      label: meta.label,
      direction: meta.direction,
      gating: meta.gating,
      flaky: meta.flaky,
      unit: meta.unit,
      baseline,
      candidate,
      delta,
      measurable,
      improved,
      regressed,
      flat,
      threshold,
      baselineRuns: bVals,
      candidateRuns: cVals,
      note,
    };
  });

  const scored = dims.filter((d) => d.measurable && d.direction !== 'neutral');
  const improvedCount = scored.filter((d) => d.improved).length;
  const regressedCount = scored.filter((d) => d.regressed).length;
  const gatingRegression = dims.find((d) => d.gating && d.regressed);

  let overall: AbOverall;
  let reason: string;
  if (scored.length === 0) {
    overall = 'inconclusive';
    reason = 'no scored dim was measurable on both sides (need coach turns / guardHits / question turns)';
  } else if (gatingRegression) {
    overall = 'worse';
    reason = `gating regression on ${gatingRegression.dim} (Δ${gatingRegression.delta}) — disqualifying regardless of other gains`;
  } else if (improvedCount > 0 && regressedCount === 0) {
    overall = 'better';
    reason = `${improvedCount} dim(s) improved, none regressed`;
  } else if (regressedCount > 0 && improvedCount === 0) {
    overall = 'worse';
    reason = `${regressedCount} dim(s) regressed, none improved`;
  } else if (improvedCount > 0 && regressedCount > 0) {
    overall = 'mixed';
    reason = `${improvedCount} improved, ${regressedCount} regressed — no clean win`;
  } else {
    overall = 'no-change';
    reason = 'all scored dims within noise';
  }

  const baseline_run_count = baselineRuns.length;
  const candidate_run_count = candidateRuns.length;
  return {
    generated_at: new Date().toISOString(),
    overall,
    reason,
    baseline_run_count,
    candidate_run_count,
    low_confidence: baseline_run_count < 3 || candidate_run_count < 3,
    dims,
  };
}

// ---------- I/O ----------

function loadScores(runDir: string): { promptDims: PromptDimScore[]; ops: OpsMetrics | null } {
  const path = join(runDir, 'scores.json');
  let parsed: { prompt_dims?: PromptDimScore[]; rows?: Record<string, unknown>[] };
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`cannot read ${path} — run score-run.ts on ${runDir} first (${String(err).slice(0, 120)})`);
  }
  if (!Array.isArray(parsed.prompt_dims)) {
    throw new Error(`${path} has no prompt_dims block — re-run score-run.ts (this build emits it)`);
  }
  // OPS metrics from the same artifact's rows; null-honest on older layouts.
  const ops = Array.isArray(parsed.rows) ? opsFromRows(parsed.rows) : null;
  return { promptDims: parsed.prompt_dims, ops };
}

function arrow(d: AbDimDelta): string {
  if (!d.measurable) return '·';
  if (d.direction === 'neutral') return '~';
  if (d.improved) return '↑ better';
  if (d.regressed) return `↓ WORSE${d.gating ? ' (gating)' : ''}`;
  return '= flat';
}

export function renderMd(v: AbVerdict, baselineDirs: string[], candidateDirs: string[]): string {
  const fmt = (x: number | null) => (x == null ? '—' : String(x));
  const lines = [
    `# A/B verdict: ${v.overall.toUpperCase()}`,
    '',
    `**${v.reason}.**`,
    '',
    `- baseline: ${baselineDirs.join(', ')} (${v.baseline_run_count} run${v.baseline_run_count === 1 ? '' : 's'})`,
    `- candidate: ${candidateDirs.join(', ')} (${v.candidate_run_count} run${v.candidate_run_count === 1 ? '' : 's'})`,
    v.low_confidence ? '- ⚠️ LOW CONFIDENCE: fewer than 3 runs per side — flaky dims (PQ1–PQ4, OPS-*) need N≥3 for a stable median.' : '',
    '',
    '| Dim | dir | baseline | candidate | Δ | thr | call |',
    '|---|---|---|---|---|---|---|',
    ...v.dims.map(
      (d) =>
        `| ${d.dim} | ${d.direction === 'higher-better' ? '↑' : d.direction === 'lower-better' ? '↓' : '~'} | ${fmt(d.baseline)} | ${fmt(d.candidate)} | ${fmt(d.delta)} | ${d.threshold} | ${arrow(d)} |`,
    ),
    '',
    '_↑ dir = higher is better; ↓ dir = lower is better; ~ = neutral (reported, not scored). Gating dims (PQ5, PQ6): a regression caps the verdict at worse. OPS dims (latency median / token cost / fallback rate) are scored lower-better from the runs\' own rows — promotion criteria, not quality dims._',
  ];
  return lines.filter((l) => l !== '').join('\n') + '\n';
}

// ---------- entrypoint ----------

const isMain = process.argv[1] && process.argv[1].endsWith('ab-verdict.ts');
if (isMain) {
  const dirsFrom = (single?: string, multi?: string): string[] => {
    if (multi) return multi.split(',').map((s) => s.trim()).filter(Boolean);
    if (single) return [single.trim()];
    return [];
  };
  const baselineDirs = dirsFrom(process.env.BASELINE_DIR, process.env.BASELINE_DIRS);
  const candidateDirs = dirsFrom(process.env.CANDIDATE_DIR, process.env.CANDIDATE_DIRS);
  if (baselineDirs.length === 0 || candidateDirs.length === 0) {
    throw new Error('set BASELINE_DIR(S) and CANDIDATE_DIR(S) — comma-separated for N>=3 reruns per side');
  }
  const baselineScores = baselineDirs.map(loadScores);
  const candidateScores = candidateDirs.map(loadScores);
  const verdict = computeAbVerdict(
    baselineScores.map((s) => s.promptDims),
    candidateScores.map((s) => s.promptDims),
    { baselineOps: baselineScores.map((s) => s.ops), candidateOps: candidateScores.map((s) => s.ops) },
  );
  const outDir = process.env.AB_OUT ?? candidateDirs[0];
  writeFileSync(join(outDir, 'ab-verdict.json'), JSON.stringify({ ...verdict, baseline_dirs: baselineDirs, candidate_dirs: candidateDirs }, null, 2));
  const md = renderMd(verdict, baselineDirs, candidateDirs);
  writeFileSync(join(outDir, 'ab-verdict.md'), md);
  console.log(md);
  console.log(`\nab-verdict -> ${join(outDir, 'ab-verdict.json')}`);
}
