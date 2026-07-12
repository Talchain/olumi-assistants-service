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
  type TurnRow,
  type L0Snap,
  type DimResult,
} from './dims.js';

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

/** Draft-graph labels ground `labels_named` against THIS run's own captures
 * (Monte-Carlo/draft variance — proven-scorer behaviour, kept). Frozen runs
 * have no draft turn; grounding is skipped, not crashed. */
function draftLabels(wires: any[]): string[] {
  const draft = wires.find((w) => Array.isArray(w?.draft_graph?.nodes));
  return (draft?.draft_graph?.nodes ?? [])
    .map((n: any) => String(n.label ?? ''))
    .filter((s: string) => s.length > 2);
}

function metricsFor(turnId: string, wire: any, message: string, row: TurnRow, labels: string[]): ScoredRow {
  const text: string = wire?.assistant_text ?? '';
  const dt = wire?._diagnostic_trace ?? {};
  const llmCalls: any[] = dt.llm_calls ?? [];
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
    chips: row.chips.map((c) => c.label),
    chip_count: row.chips.length,
    wall_clock_ms: row.wallClockMs,
    llm_latency_ms: llmCalls.reduce((a: number, c: any) => a + (c.latency_ms ?? 0), 0) || null,
    draft_display_values: draftDisplayValues(wire),
    text,
  };
}

function loadNewLayout(runDir: string): { rows: TurnRow[]; scored: ScoredRow[] } {
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
  for (const { id, meta, wire } of loaded) {
    const row = rowFromWire(id, wire, meta);
    // Attach the production-guard hits to the dim row too — dimD11 aggregates
    // them; without this D11 is (honestly) UNMEASURABLE.
    row.guardHits = guardHitsFor(row.assistantText);
    rows.push(row);
    scored.push(metricsFor(id, wire, meta.message ?? '', row, labels));
  }
  return { rows, scored };
}

function loadLegacyLayout(runDir: string): { rows: TurnRow[]; scored: ScoredRow[] } {
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
  for (const { turn, wire } of loaded) {
    if (wire == null) {
      scored.push({ turn, message: msgByTurn[turn] ?? '', http_ok: false });
      continue;
    }
    const row = rowFromWire(turn, wire, { http_status: 200 });
    row.guardHits = guardHitsFor(row.assistantText);
    rows.push(row);
    scored.push(metricsFor(turn, wire, msgByTurn[turn] ?? '', row, labels));
  }
  return { rows, scored };
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

function scoreRun(runDir: string): { scored: ScoredRow[]; dims: DimResult[] } {
  const isNew = existsSync(join(runDir, 'turns'));
  const { rows, scored } = isNew ? loadNewLayout(runDir) : loadLegacyLayout(runDir);
  const dims = runAllDims(rows, loadL0(runDir));

  writeFileSync(
    join(runDir, 'scores.json'),
    JSON.stringify({ generated_at: new Date().toISOString(), layout: isNew ? 'v0' : 'legacy', rows: scored, dims }, null, 2),
  );

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
  ].join('\n');
  writeFileSync(join(runDir, 'scores.md'), md);
  console.log(md);
  console.log(`\nrows: ${scored.length}  (${runDir})`);
  return { scored, dims };
}

// ---- entrypoint ----
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
