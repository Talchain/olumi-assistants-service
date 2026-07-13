/**
 * Per-run scorer (conversation-harness v0) — evolved from the proven
 * orchestrator-prompt-workstream/candidates/score-run.ts.
 *
 * GUARDS ARE THE PRODUCTION MODULES, IMPORTED FROM src/ — never copied
 * (the workstream's scoring/ dir held extracted copies; copies drift). If these
 * imports break, the production guard surface moved: update the import, do not
 * inline the pattern.
 *
 * Reads either run-dir layout:
 *   new    — runner.mjs: turns/<id>/{request,wire,trace,meta}.json + l0/*.json
 *            + journey.json + manifest.json
 *   legacy — run-arm.sh / run-frozen-arm.sh: flat <ID>.json + run-log.txt
 * Writes scores.json (rows + dims) and scores.md into the run dir.
 *
 * Usage:  RUN_DIR=runs/<arm> pnpm exec tsx tools/conversation-harness/scorer/score-run.ts
 * Reruns: RERUN_DIRS=runs/a,runs/b,runs/c aggregates flaky dims (majority) into
 *         scores-aggregate.json of the FIRST dir.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
  HELD_SCIENCE_VOCABULARY_PATTERN,
} from '../../../src/orchestrator-v5/compose/forbidden-user-facing-phrases.js';
import {
  containsMutationLanguage,
  containsStructuralSuccessClaim,
} from '../../../src/orchestrator-v5/routing/mutation-language.js';
import {
  rowFromWire,
  runAllDims,
  aggregateFlakyDims,
  attachMutationOutcomes,
  type TurnRow,
  type L0Snap,
  type DimResult,
} from './dims.js';
import {
  runPromptDims,
  surfacesFromWire,
  type PromptDimScore,
  type TurnSurfaces,
} from './prompt-dims.js';

const GENERIC_MARKERS = [
  /\bconsider your assumptions\b/i,
  /\bevaluate the risks\b/i,
  /\bit depends\b/i,
  /\bmany factors\b/i,
  /\bin general\b/i,
  /\bbest practice\b/i,
];

function readJson(path: string): any | null {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return null;
  }
}

function guardHitsFor(text: string) {
  return {
    forbidden: findForbiddenPhraseHit(text),
    successClaim: findSuccessClaimHit(text),
    heldScience: HELD_SCIENCE_VOCABULARY_PATTERN.test(text),
    mutationLanguage: containsMutationLanguage(text),
    structuralSuccessClaim: containsStructuralSuccessClaim(text),
  };
}

/** Draft display-value presence (S4): count nodes carrying any display-value
 * shaped key. Defensive on purpose — records what IS there, asserts nothing. */
function draftDisplayValues(wire: any): { nodes: number; withDisplayValue: number } | null {
  const nodes = wire?.draft_graph?.nodes;
  if (!Array.isArray(nodes)) return null;
  const withDv = nodes.filter(
    (n: any) => n && (n.display_value != null || n.display_values != null || n.displayValue != null),
  ).length;
  return { nodes: nodes.length, withDisplayValue: withDv };
}

interface ScoredRow extends Record<string, unknown> {
  turn: string;
}

/** Null-honest per-turn LLM token totals for the OPS cost dim (FIX-2).
 *
 * A turn's llm_calls can EXIST but carry no usage object — an aborted / streamed
 * fragment (#441), or a synthetic routing call whose trace entry has no token
 * fields. Summing `input_tokens ?? 0` over those yields 0 (a NUMBER), which
 * opsFromRows then counts as a real measurement: an arm with MISSING token data
 * ranks "cheaper" and can spuriously flip the verdict to promote.
 *
 * Fix: a token direction is null unless AT LEAST ONE call carries a usage figure
 * for it (a numeric `input_tokens`/`output_tokens`, flat or under `usage`). This
 * distinguishes "no usage present" (null → excluded from the cost comparison)
 * from "usage present and zero" (a real 0 → kept). Only usage-bearing calls are
 * summed, so a mix of usage-bearing + usageless calls still totals honestly. */
export function llmTokenTotals(llmCalls: unknown[]): { input: number | null; output: number | null } {
  const pick = (key: 'input_tokens' | 'output_tokens'): number | null => {
    const present = (llmCalls ?? [])
      .map((c) => {
        const call = (c ?? {}) as Record<string, unknown>;
        const flat = call[key];
        if (typeof flat === 'number') return flat;
        const usage = (call.usage ?? {}) as Record<string, unknown>;
        const nested = usage[key];
        return typeof nested === 'number' ? nested : null;
      })
      .filter((v): v is number => v != null);
    return present.length ? present.reduce((a, b) => a + b, 0) : null;
  };
  return { input: pick('input_tokens'), output: pick('output_tokens') };
}

/** Draft-graph labels ground `labels_named` against THIS run's own captures
 * (Monte-Carlo/draft variance — proven-scorer behaviour, kept). Frozen runs
 * have no draft turn; grounding is skipped, not crashed. */
function draftLabels(wires: any[]): string[] {
  const draft = wires.find((w) => Array.isArray(w?.draft_graph?.nodes));
  return (draft?.draft_graph?.nodes ?? [])
    .map((n: any) => String(n.label ?? ''))
    .filter((s: string) => s.length > 2);
}

export function buildScoredRow(turnId: string, wire: any, message: string, row: TurnRow, labels: string[]): ScoredRow {
  const text: string = wire?.assistant_text ?? '';
  const dt = wire?._diagnostic_trace ?? {};
  const llmCalls: any[] = dt.llm_calls ?? [];
  const tokens = llmTokenTotals(llmCalls);
  const lines = text.split('\n');
  return {
    turn: turnId,
    message,
    http_ok: row.httpStatus != null && row.httpStatus < 300,
    skipped: row.skipped,
    turn_class_hint: row.turnClassHint,
    exit_path: dt.exit_path ?? null,
    llm_roles: llmCalls.map((c: any) => `${c.role}:${c.model}@${c.latency_ms}ms`),
    prompt_ids: (dt.prompt_identity ?? []).map(
      (p: any) => `${p.prompt_id}@${p.version ?? '?'}#${p.hash ?? p.prompt_hash ?? '?'}`,
    ),
    words: text.split(/\s+/).filter(Boolean).length,
    sentences: (text.match(/[.!?](\s|$)/g) ?? []).length,
    questions: (text.match(/\?/g) ?? []).length,
    bullets: lines.filter((l) => /^\s*[-*] /.test(l)).length,
    bold_spans: (text.match(/\*\*[^*]+\*\*/g) ?? []).length,
    paragraphs: text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length,
    labels_named: labels.filter((l) => text.toLowerCase().includes(l.toLowerCase())),
    numbers_cited: (text.match(/\b\d+(?:\.\d+)?%?|\b£[\d,]+/g) ?? []).slice(0, 12),
    generic_marker: GENERIC_MARKERS.some((r) => r.test(text)),
    ...(row.guardHits ?? guardHitsFor(text)),
    // L0 mutation oracle for this turn (true/false/null) — the PQ5/D11
    // turn-aware guard conditioning reads TurnRow.mutationCommitted; surfaced
    // here so the evidence artifact shows WHY a receipt was excused.
    mutation_committed: row.mutationCommitted ?? null,
    chips: row.chips.map((c) => c.label),
    chip_count: row.chips.length,
    wall_clock_ms: row.wallClockMs,
    llm_latency_ms: llmCalls.reduce((a: number, c: any) => a + (c.latency_ms ?? 0), 0) || null,
    // OPS inputs for ab-verdict.ts (opsFromRows): token cost + fallback
    // engagement, null-honest when the diagnostic trace carries no usage figures
    // (FIX-2: usageless llm_calls -> null, NOT 0 — see llmTokenTotals).
    llm_tokens_in: tokens.input,
    llm_tokens_out: tokens.output,
    fallback_engaged: Array.isArray(dt.fallback_trace) ? dt.fallback_trace.length > 0 : null,
    draft_display_values: draftDisplayValues(wire),
    text,
  };
}

interface LoadedRun {
  rows: TurnRow[];
  scored: ScoredRow[];
  surfacesByTurn: Record<string, TurnSurfaces>;
  graphLabels: string[];
}

function loadNewLayout(runDir: string): LoadedRun {
  const journey = readJson(join(runDir, 'journey.json'));
  const turnsDir = join(runDir, 'turns');
  const onDisk = new Set(readdirSync(turnsDir));
  // Journey order is authoritative; -dup dirs follow their primary; any extra
  // dirs (defensive) are appended in lexical order.
  const orderedIds: string[] = [];
  for (const t of journey?.turns ?? []) {
    if (onDisk.has(t.id)) orderedIds.push(t.id);
    if (onDisk.has(`${t.id}-dup`)) orderedIds.push(`${t.id}-dup`);
  }
  for (const d of [...onDisk].sort()) if (!orderedIds.includes(d)) orderedIds.push(d);

  const loaded = orderedIds.map((id) => {
    const tdir = join(turnsDir, id);
    return { id, meta: readJson(join(tdir, 'meta.json')) ?? {}, wire: readJson(join(tdir, 'wire.json')) };
  });
  const labels = draftLabels(loaded.map((t) => t.wire));
  const rows: TurnRow[] = [];
  const scored: ScoredRow[] = [];
  const surfacesByTurn: Record<string, TurnSurfaces> = {};
  for (const { id, meta, wire } of loaded) {
    const row = rowFromWire(id, wire, meta);
    // Attach the production-guard hits to the dim row too — dimD11 aggregates
    // them; without this D11 is (honestly) UNMEASURABLE.
    row.guardHits = guardHitsFor(row.assistantText);
    rows.push(row);
    surfacesByTurn[id] = surfacesFromWire(wire);
    scored.push(buildScoredRow(id, wire, meta.message ?? '', row, labels));
  }
  return { rows, scored, surfacesByTurn, graphLabels: labels };
}

function loadLegacyLayout(runDir: string): LoadedRun {
  const msgByTurn: Record<string, string> = {};
  try {
    for (const l of readFileSync(join(runDir, 'run-log.txt'), 'utf-8').split('\n')) {
      const m = l.match(/^([A-Z][A-Za-z0-9]*) \|.*\| msg=(.*)$/);
      if (m) msgByTurn[m[1]] = m[2];
    }
  } catch {
    /* run-log optional */
  }
  const files = readdirSync(runDir)
    .filter((f) => /^[A-Z][A-Za-z0-9]*\.json$/.test(f))
    .sort();
  const loaded = files.map((f) => ({ turn: f.replace('.json', ''), wire: readJson(join(runDir, f)) }));
  const labels = draftLabels(loaded.map((t) => t.wire));
  const rows: TurnRow[] = [];
  const scored: ScoredRow[] = [];
  const surfacesByTurn: Record<string, TurnSurfaces> = {};
  for (const { turn, wire } of loaded) {
    if (wire == null) {
      scored.push({ turn, message: msgByTurn[turn] ?? '', http_ok: false });
      continue;
    }
    const row = rowFromWire(turn, wire, { http_status: 200 });
    row.guardHits = guardHitsFor(row.assistantText);
    rows.push(row);
    surfacesByTurn[turn] = surfacesFromWire(wire);
    scored.push(buildScoredRow(turn, wire, msgByTurn[turn] ?? '', row, labels));
  }
  return { rows, scored, surfacesByTurn, graphLabels: labels };
}

function loadL0(runDir: string): L0Snap[] {
  const dir = join(runDir, 'l0');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => readJson(join(dir, f)))
    .filter((s): s is L0Snap => s != null);
}

function scoreRun(runDir: string): { scored: ScoredRow[]; dims: DimResult[]; promptDims: PromptDimScore[] } {
  const isNew = existsSync(join(runDir, 'turns'));
  const { rows, scored, surfacesByTurn, graphLabels } = isNew ? loadNewLayout(runDir) : loadLegacyLayout(runDir);
  const l0 = loadL0(runDir);
  // L0 mutation oracle BEFORE any guard aggregation: PQ5/D11 condition the
  // mutation-language / structural-success-claim hits on it (C10).
  attachMutationOutcomes(rows, l0);
  for (const row of rows) {
    const s = scored.find((x) => x.turn === row.turn);
    if (s) s.mutation_committed = row.mutationCommitted ?? null;
  }
  const dims = runAllDims(rows, l0);
  // Prompt-quality dims (ROADMAP 1.70 v1): comparable scalars for A/B, consumed
  // by ab-verdict.ts. PQ5/PQ6 read the guardHits attached above (src/ guards).
  const promptDims = runPromptDims(rows, { surfacesByTurn, graphLabels });

  writeFileSync(
    join(runDir, 'scores.json'),
    JSON.stringify(
      { generated_at: new Date().toISOString(), layout: isNew ? 'v0' : 'legacy', rows: scored, dims, prompt_dims: promptDims },
      null,
      2,
    ),
  );

  const fmtVal = (v: number | null) => (v == null ? '—' : String(v));
  const md = [
    '| Turn | class | words | bullets | ? | forbidden | mut-lang | chips | wall-ms |',
    '|---|---|---|---|---|---|---|---|---|',
    ...scored.map(
      (r) =>
        `| ${r.turn} | ${r.turn_class_hint ?? '—'} | ${r.words ?? '—'} | ${r.bullets ?? '—'} | ${r.questions ?? '—'} | ${r.forbidden ?? '—'} | ${r.mutationLanguage ? 'HIT' : '—'} | ${r.chip_count ?? '—'} | ${r.wall_clock_ms ?? '—'} |`,
    ),
    '',
    '| Dim | verdict | note |',
    '|---|---|---|',
    ...dims.map((d) => `| ${d.dim} | ${d.verdict.toUpperCase()} | ${d.notes[0] ?? ''} |`),
    '',
    '| Prompt dim | dir | value | note |',
    '|---|---|---|---|',
    ...promptDims.map(
      (d) =>
        `| ${d.dim} | ${d.direction === 'higher-better' ? '↑' : d.direction === 'lower-better' ? '↓' : '~'} | ${fmtVal(d.value)} ${d.unit} | ${d.notes[0] ?? ''} |`,
    ),
  ].join('\n');
  writeFileSync(join(runDir, 'scores.md'), md);
  console.log(md);
  console.log(`\nrows: ${scored.length}  (${runDir})`);
  return { scored, dims, promptDims };
}

// ---- entrypoint ----
// Guarded so importing this module (e.g. the score-run.harness-test.ts self-test
// that exercises buildScoredRow / llmTokenTotals) does not run the CLI or throw
// on a missing RUN_DIR. Mirrors ab-verdict.ts's isMain guard.
const isMain = process.argv[1] != null && /score-run\.(ts|js|mjs)$/.test(process.argv[1]);
if (isMain) {
  const rerunDirs = (process.env.RERUN_DIRS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (rerunDirs.length > 1) {
    const perRun = rerunDirs.map((d) => scoreRun(d).dims);
    const aggregated = aggregateFlakyDims(perRun);
    writeFileSync(
      join(rerunDirs[0], 'scores-aggregate.json'),
      JSON.stringify({ generated_at: new Date().toISOString(), runs: rerunDirs, dims: aggregated }, null, 2),
    );
    console.log(`\naggregate over ${rerunDirs.length} runs -> ${join(rerunDirs[0], 'scores-aggregate.json')}`);
  } else {
    const RUN = process.env.RUN_DIR ?? rerunDirs[0];
    if (!RUN) throw new Error('set RUN_DIR=<runs/arm dir> (or RERUN_DIRS=a,b,c)');
    scoreRun(RUN);
  }
}
