/**
 * PROMOTION VERDICT (conversation-harness — Wave1-L3).
 *
 * The single entrypoint that answers: "may this candidate coach prompt ship?"
 * Candidate vs baseline, on the HOLDOUT partition, as per-dimension pass/fail
 * floors plus one overall promote / block call.
 *
 * THIS IS A FLOOR, NOT A RANKING
 * ------------------------------
 * `computePromotionVerdict` takes exactly ONE candidate. That is a deliberate
 * API constraint, not an oversight: an API that accepted K candidates would be
 * used to pick the best of K on the holdout, which IS tuning against the
 * holdout and destroys the floor's meaning (see holdout.ts doctrine). To
 * compare candidates, use ab-verdict.ts on the ITERATION partition; bring the
 * winner here, once.
 *
 * The baseline is present for exactly two jobs, neither of them ranking:
 *   1. NON-INFERIORITY on OPS dims (latency/cost), where no absolute floor is
 *      meaningful — "2400ms" is only good or bad relative to what we ship today.
 *   2. Evidence context in the artifact, so a human reading a BLOCK can see
 *      whether the floor was always failing or the candidate broke it.
 * A candidate that beats the baseline on every dimension and still misses a
 * floor is BLOCKED. Better-than-today is not the bar; good-enough-to-ship is.
 *
 * FAIL-CLOSED
 * -----------
 * Every path that is not an affirmative, fully-measured pass is a BLOCK:
 *   - any dim null (unmeasurable) on the candidate      -> BLOCK
 *   - the mode is not 'holdout'                          -> throws
 *   - the split is degenerate (holdout too small)        -> throws
 *   - a scenario is missing from either side             -> BLOCK
 *   - sides disagree on which scenarios they ran         -> BLOCK
 *   - zero scenarios                                     -> BLOCK
 * There is no "inconclusive ⇒ ship" edge. `promote` is only ever true when
 * every floor was affirmatively cleared on measured data.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { surfacesFromWire, type PromptDimScore } from './prompt-dims.js';
import { rowFromWire, attachMutationOutcomes, wireHasHeldProposal, type TurnRow, type L0Snap } from './dims.js';
import { opsFromRows, totalTokensFromRows, NOISE_THRESHOLD, type OpsMetrics } from './ab-verdict.js';
import { runGateDims, type GateTurn, type GateDimsOptions } from './gate-dims.js';
import { assertSplitIntegrity, openScenarioSet, type HarnessMode, type SplitIntegrity } from './holdout.js';
import { productionUnsupportedClaimChecker } from './unsupported-claim-adapter.js';

/** Absolute floors. A candidate must clear ALL of them on the holdout.
 * Direction comes from the dim itself (higher-better ⇒ value >= floor;
 * lower-better ⇒ value <= floor). */
export const GATE_FLOORS: Record<string, number> = {
  'G1-decision-advancement': 0.6,
  'G2-dispatch-accuracy': 0.9,
  'G3-entity-resolution': 0.9,
  'G4-canonical-state-use': 1.0, // every stated figure must be canonical — no tolerance for invented numbers
  'G5-unsupported-claim': 0, // a single fabricated claim blocks the ship
  'G6-dead-end': 0.1,
  'G7-correction-burden': 0.5,
};

/** OPS dims have no absolute floor — they are gated as NON-INFERIORITY vs the
 * baseline, using ab-verdict's existing per-dim noise thresholds so a candidate
 * is not blocked by rerun jitter. Regressing beyond noise blocks. */
export const OPS_GATE_DIMS = ['OPS-latency-median', 'OPS-cost-tokens'] as const;

export type GateStatus = 'pass' | 'fail' | 'unmeasurable';

export interface GateDimVerdict {
  dim: string;
  label: string;
  direction: string;
  unit: string;
  status: GateStatus;
  /** 'floor' = absolute; 'non-inferiority' = vs baseline within noise. */
  gateKind: 'floor' | 'non-inferiority';
  candidate: number | null;
  baseline: number | null;
  floor: number | null;
  threshold: number | null;
  reason: string;
}

export interface PromotionVerdict {
  generated_at: string;
  /** The only field a CI job needs. True ⇒ every floor affirmatively cleared. */
  promote: boolean;
  overall: 'PROMOTE' | 'BLOCK';
  reason: string;
  mode: HarnessMode;
  split_seed: string;
  holdout_scenarios: string[];
  baseline_run_count: number;
  candidate_run_count: number;
  dims: GateDimVerdict[];
  blocking_dims: string[];
}

/** One side (baseline or candidate) of the comparison: its per-scenario runs. */
export interface PromotionSide {
  /** Keyed by scenario id. Each value is that scenario's executed turns. */
  scenarios: Record<string, GateTurn[]>;
  /** Raw scores.json rows per scenario, for the OPS metrics (latency/cost).
   * Same keys as `scenarios`. Absent ⇒ OPS dims are unmeasurable ⇒ BLOCK. */
  rows?: Record<string, Record<string, unknown>[]>;
}

export interface PromotionOptions extends GateDimsOptions {
  mode: HarnessMode;
  split: SplitIntegrity;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Aggregate one dim across the holdout's scenarios into a single value.
 *
 * WORST-scenario, not mean. A candidate that fabricates numbers in one
 * scenario and is spotless in four has a fabrication problem; averaging it to
 * 0.8 and comparing against a 1.0 floor would be arithmetically true and
 * substantively wrong. The holdout is a floor: it asks "does this ever fail?",
 * and the honest aggregator for that question is the worst case.
 *
 * ANTI-GAMING: this also removes the incentive to pad the holdout with easy
 * scenarios — under a mean, adding easy scenarios lifts a failing candidate
 * over the floor; under worst-case it cannot. (The split is hash-stable anyway,
 * so padding is already hard — this is the second lock on the same door.)
 *
 * NULL PROPAGATES. If ANY scenario could not measure the dim, the dim is
 * unmeasurable for the whole side. Not "measure the ones we can" — a floor
 * computed over an unknown subset is not a floor.
 */
export function aggregateWorst(values: (number | null)[], direction: string): number | null {
  if (values.length === 0) return null;
  if (values.some((v) => v == null)) return null;
  const present = values as number[];
  return direction === 'higher-better' ? Math.min(...present) : Math.max(...present);
}

/** OPS dims for one side: median across the side's scenarios, cost via the
 * EXISTING F14 accounting (ab-verdict.totalTokensFromRows) — never a second
 * implementation. A side whose cost is unmeasurable in ANY scenario has an
 * unmeasurable cost overall, exactly as F14 requires within a run. */
export function opsDimsForSide(rows: Record<string, Record<string, unknown>[]> | undefined, scenarioIds: string[]): PromptDimScore[] {
  const mk = (dimId: string, label: string, value: number | null, unit: string, notes: string[]): PromptDimScore => ({
    dim: dimId, label, direction: 'lower-better', gating: true, flaky: true, safety: false, value, unit, details: {}, notes,
  });
  if (!rows) {
    return [
      mk('OPS-latency-median', 'Latency (median wall-clock per turn)', null, 'ms', ['UNMEASURABLE: no rows supplied']),
      mk('OPS-cost-tokens', 'Cost (total LLM tokens, in+out)', null, 'tokens', ['UNMEASURABLE: no rows supplied']),
    ];
  }
  const perScenario: OpsMetrics[] = [];
  let costUnmeasurable = false;
  for (const id of scenarioIds) {
    const r = rows[id];
    if (!r) {
      costUnmeasurable = true;
      perScenario.push({ latencyMedianMs: null, totalTokens: null, fallbackRate: null });
      continue;
    }
    const ops = opsFromRows(r);
    // Re-derive cost through the F14 function directly so the "any cost-bearing
    // turn incomplete ⇒ run unmeasurable" rule is the SAME rule, not a copy.
    const cost = totalTokensFromRows(r.filter((row) => !row.skipped));
    if (cost == null) costUnmeasurable = true;
    perScenario.push({ ...ops, totalTokens: cost });
  }
  const lat = perScenario.map((o) => o.latencyMedianMs).filter((v): v is number => v != null);
  const latencyValue = lat.length === scenarioIds.length && lat.length > 0 ? Number(median(lat).toFixed(0)) : null;
  const costs = perScenario.map((o) => o.totalTokens);
  const costValue = costUnmeasurable || costs.length === 0 ? null : (costs as number[]).reduce((a, b) => a + b, 0);
  return [
    mk('OPS-latency-median', 'Latency (median wall-clock per turn)', latencyValue, 'ms',
      latencyValue == null ? ['UNMEASURABLE: at least one holdout scenario has no wall-clock timing'] : []),
    mk('OPS-cost-tokens', 'Cost (total LLM tokens, in+out)', costValue, 'tokens',
      costValue == null ? ['UNMEASURABLE: a cost-bearing turn is incomplete in at least one holdout scenario (F14 rule) — a partial total is not a comparable total'] : []),
  ];
}

/** Score one side's holdout scenarios into aggregated gate dims. */
function sideDims(side: PromotionSide, scenarioIds: string[], opts: GateDimsOptions): PromptDimScore[] {
  const perScenario = scenarioIds.map((id) => runGateDims(side.scenarios[id] ?? [], opts));
  const template = perScenario[0] ?? runGateDims([], opts);
  const gate = template.map((meta) => {
    const values = perScenario.map((run) => run.find((d) => d.dim === meta.dim)?.value ?? null);
    return { ...meta, value: aggregateWorst(values, meta.direction) };
  });
  return [...gate, ...opsDimsForSide(side.rows, scenarioIds)];
}

/**
 * THE promotion entrypoint. Fails closed on every ambiguity.
 */
export function computePromotionVerdict(
  baseline: PromotionSide,
  candidate: PromotionSide,
  opts: PromotionOptions,
): PromotionVerdict {
  // A promotion verdict is only meaningful on the holdout. 'iterate' and
  // 'full' are rejected outright rather than "warned about": a verdict computed
  // over scenarios the prompt was tuned on is not weak evidence, it is wrong
  // evidence, and it would carry the same PROMOTE banner.
  if (opts.mode !== 'holdout') {
    throw new Error(
      `promotion verdict requires mode "holdout", got "${opts.mode}" — a floor computed on tuned-against scenarios is not a floor`,
    );
  }
  assertSplitIntegrity(opts.split);

  const holdoutIds = [...opts.split.holdout].sort();
  const blocking: string[] = [];
  const problems: string[] = [];

  // Both sides must have run the SAME holdout scenarios. A side missing a
  // scenario is not "score what we have" — a floor over an unknown subset is
  // not a floor, and the missing scenario is precisely the one most likely to
  // have crashed on the candidate.
  const missingBase = holdoutIds.filter((id) => !baseline.scenarios[id]);
  const missingCand = holdoutIds.filter((id) => !candidate.scenarios[id]);
  if (missingBase.length) problems.push(`baseline missing holdout scenario(s): ${missingBase.join(', ')}`);
  if (missingCand.length) problems.push(`candidate missing holdout scenario(s): ${missingCand.join(', ')}`);
  const extraCand = Object.keys(candidate.scenarios).filter((id) => !holdoutIds.includes(id));
  if (extraCand.length) {
    problems.push(
      `candidate supplied non-holdout scenario(s): ${extraCand.join(', ')} — a promotion run must not mix in tuned-against scenarios`,
    );
  }

  const baseDims = sideDims(baseline, holdoutIds, opts);
  const candDims = sideDims(candidate, holdoutIds, opts);
  const baseByDim = new Map(baseDims.map((d) => [d.dim, d]));

  const dims: GateDimVerdict[] = candDims.map((c) => {
    const b = baseByDim.get(c.dim) ?? null;
    const isOps = (OPS_GATE_DIMS as readonly string[]).includes(c.dim);
    const floor = isOps ? null : (GATE_FLOORS[c.dim] ?? null);
    const threshold = isOps ? (NOISE_THRESHOLD[c.dim] ?? 0) : null;
    const base: GateDimVerdict = {
      dim: c.dim,
      label: c.label,
      direction: c.direction,
      unit: c.unit,
      status: 'unmeasurable',
      gateKind: isOps ? 'non-inferiority' : 'floor',
      candidate: c.value,
      baseline: b?.value ?? null,
      floor,
      threshold,
      reason: '',
    };
    if (c.value == null) {
      return {
        ...base,
        status: 'unmeasurable',
        reason: c.notes[0] ?? 'candidate value unmeasurable on the holdout — cannot certify a floor on data we do not have',
      };
    }
    if (isOps) {
      if (b?.value == null) {
        return { ...base, status: 'unmeasurable', reason: 'baseline value unmeasurable — non-inferiority needs both sides' };
      }
      const delta = c.value - b.value;
      const regressed = delta > (threshold ?? 0);
      return {
        ...base,
        status: regressed ? 'fail' : 'pass',
        reason: regressed
          ? `regressed vs baseline by ${delta.toFixed(0)} ${c.unit} (> noise ${threshold}) — a quality win does not buy a cost/latency regression`
          : `within noise of baseline (Δ ${delta.toFixed(0)} ${c.unit}, threshold ${threshold})`,
      };
    }
    if (floor == null) {
      return { ...base, status: 'unmeasurable', reason: `no floor defined for ${c.dim} — refusing to pass an ungated dimension` };
    }
    const ok = c.direction === 'higher-better' ? c.value >= floor : c.value <= floor;
    return {
      ...base,
      status: ok ? 'pass' : 'fail',
      reason: ok
        ? `${c.value} clears floor ${floor}`
        : `${c.value} misses floor ${floor} (worst holdout scenario)`,
    };
  });

  for (const d of dims) if (d.status !== 'pass') blocking.push(d.dim);
  if (holdoutIds.length === 0) problems.push('holdout is empty');

  const promote = problems.length === 0 && blocking.length === 0 && dims.length > 0;
  const reason = promote
    ? `all ${dims.length} gate dimensions cleared their floors on ${holdoutIds.length} holdout scenario(s)`
    : [
        ...problems,
        ...(blocking.length ? [`blocking dimension(s): ${blocking.join(', ')}`] : []),
        ...(dims.length === 0 ? ['no gate dimensions were computed'] : []),
      ].join('; ');

  return {
    generated_at: new Date().toISOString(),
    promote,
    overall: promote ? 'PROMOTE' : 'BLOCK',
    reason,
    mode: opts.mode,
    split_seed: opts.split.seed,
    holdout_scenarios: holdoutIds,
    baseline_run_count: Object.keys(baseline.scenarios).length,
    candidate_run_count: Object.keys(candidate.scenarios).length,
    dims,
    blocking_dims: [...new Set([...blocking, ...(problems.length ? ['_data_integrity'] : [])])],
  };
}

export function renderPromotionMd(v: PromotionVerdict): string {
  const f = (x: number | null) => (x == null ? '—' : String(x));
  const icon = (s: GateStatus) => (s === 'pass' ? '✅ pass' : s === 'fail' ? '❌ FAIL' : '⛔ UNMEASURABLE');
  return (
    [
      `# Promotion verdict: ${v.overall}`,
      '',
      `**${v.reason}.**`,
      '',
      `- holdout scenarios (seed \`${v.split_seed}\`): ${v.holdout_scenarios.join(', ') || '(none)'}`,
      `- doctrine: the holdout is a pass/fail FLOOR, never a ranking. A BLOCK is not a signal to iterate against — read the dimension name and fix the problem class on the ITERATION partition.`,
      '',
      '| Dim | gate | candidate | baseline | floor/thr | status | why |',
      '|---|---|---|---|---|---|---|',
      ...v.dims.map(
        (d) =>
          `| ${d.dim} | ${d.gateKind} | ${f(d.candidate)} | ${f(d.baseline)} | ${f(d.floor ?? d.threshold)} | ${icon(d.status)} | ${d.reason} |`,
      ),
      '',
      '_Aggregation across holdout scenarios is WORST-case, not mean: the holdout asks "does this ever fail?". UNMEASURABLE blocks — a floor cannot be certified on data we do not have._',
    ].join('\n') + '\n'
  );
}

// ---------- run-dir loading ----------

/**
 * Build one scenario's GateTurns from a run dir produced by runner.mjs
 * (turns/<id>/{wire,meta}.json + l0/*.json + journey.json).
 *
 * Reuses the SAME primitives score-run.ts uses (rowFromWire, surfacesFromWire,
 * attachMutationOutcomes) rather than reimplementing capture parsing — a second
 * parser would disagree with the scorer about what a turn WAS, and the gate
 * would then be certifying a different run than the one on disk.
 */
export function loadGateTurns(runDir: string): GateTurn[] {
  const journey = readJsonOrNull(join(runDir, 'journey.json'));
  const turnsDir = join(runDir, 'turns');
  if (!existsSync(turnsDir)) return [];
  const onDisk = new Set(readdirSync(turnsDir));
  const ordered: string[] = [];
  for (const t of (journey?.turns ?? []) as { id: string }[]) {
    if (onDisk.has(t.id)) ordered.push(t.id);
    if (onDisk.has(`${t.id}-dup`)) ordered.push(`${t.id}-dup`);
  }
  for (const d of [...onDisk].sort()) if (!ordered.includes(d)) ordered.push(d);

  const turns: GateTurn[] = [];
  const rows: TurnRow[] = [];
  for (const id of ordered) {
    const tdir = join(turnsDir, id);
    const wire = readJsonOrNull(join(tdir, 'wire.json'));
    const meta = readJsonOrNull(join(tdir, 'meta.json')) ?? {};
    const row = rowFromWire(id, wire, meta);
    row.heldProposal = wireHasHeldProposal(wire);
    rows.push(row);
    turns.push({ row, surfaces: surfacesFromWire(wire), userMessage: String(meta.message ?? '') });
  }
  // The L0 oracle is what makes G1/G2 measurable at all — without it they are
  // null and the promotion BLOCKS, which is the correct outcome for a run with
  // no DB ground truth.
  const l0Dir = join(runDir, 'l0');
  const snaps: L0Snap[] = existsSync(l0Dir)
    ? readdirSync(l0Dir)
        .filter((f) => f.endsWith('.json'))
        .sort()
        .map((f) => readJsonOrNull(join(l0Dir, f)))
        .filter((s): s is L0Snap => s != null)
    : [];
  attachMutationOutcomes(rows, snaps);
  return turns;
}

function readJsonOrNull(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

/** Rows for the OPS metrics: scores.json must already exist (score-run.ts). */
export function loadRunRows(runDir: string): Record<string, unknown>[] | null {
  const parsed = readJsonOrNull(join(runDir, 'scores.json'));
  return Array.isArray(parsed?.rows) ? parsed.rows : null;
}

/**
 * Assemble one side from a directory of per-scenario run dirs:
 *   <sideDir>/<scenario-id>/{turns,l0,journey.json,scores.json}
 * Only the ids given are read — the caller passes the HOLDOUT ids, so a
 * scenario outside the holdout is never opened here either.
 */
export function loadSide(sideDir: string, scenarioIds: string[]): PromotionSide {
  const scenarios: Record<string, GateTurn[]> = {};
  const rows: Record<string, Record<string, unknown>[]> = {};
  for (const id of scenarioIds) {
    const dir = join(sideDir, id);
    if (!existsSync(dir)) continue; // absent => BLOCK downstream, never a silent pass
    scenarios[id] = loadGateTurns(dir);
    const r = loadRunRows(dir);
    if (r) rows[id] = r;
  }
  return { scenarios, rows };
}

// ---------- CLI ----------

/**
 * The single promotion entrypoint.
 *
 *   BASELINE_RUNS=runs/base CANDIDATE_RUNS=runs/cand \
 *     pnpm exec tsx tools/conversation-harness/scorer/promotion-verdict.ts
 *
 * Writes promotion-verdict.json + .md to PROMOTION_OUT (default: CANDIDATE_RUNS).
 * Exits 0 only on PROMOTE; exits 1 on BLOCK so CI cannot ignore it.
 *
 * The holdout ids come from the split over the real journeys/ dir opened in
 * 'holdout' mode — the CLI has no flag to widen that, by design.
 */
const isPromotionMain = process.argv[1] && process.argv[1].endsWith('promotion-verdict.ts');
if (isPromotionMain) {
  const baseDir = process.env.BASELINE_RUNS;
  const candDir = process.env.CANDIDATE_RUNS;
  if (!baseDir || !candDir) throw new Error('set BASELINE_RUNS and CANDIDATE_RUNS (dirs of per-scenario run dirs)');
  const set = openScenarioSet('holdout');
  const holdoutIds = set.ids();
  const verdict = computePromotionVerdict(loadSide(baseDir, holdoutIds), loadSide(candDir, holdoutIds), {
    mode: 'holdout',
    split: set.split,
    unsupportedClaimChecker: productionUnsupportedClaimChecker,
  });
  const outDir = process.env.PROMOTION_OUT ?? candDir;
  writeFileSync(join(outDir, 'promotion-verdict.json'), JSON.stringify(verdict, null, 2));
  const md = renderPromotionMd(verdict);
  writeFileSync(join(outDir, 'promotion-verdict.md'), md);
  console.log(md);
  console.log(`\npromotion-verdict -> ${join(outDir, 'promotion-verdict.json')}`);
  if (!verdict.promote) process.exit(1);
}
