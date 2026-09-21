/**
 * Per-run scorer for local A/B arms — parameterised port of scoring/score-baseline.ts.
 * RUN_DIR must contain T*.json + run-log.txt (run-arm.sh layout). Labels and
 * messages ground against THIS run's own captures (Monte-Carlo/draft variance).
 * Adds shape metrics (bullets/bold/paragraphs) the baseline scored manually.
 * Writes scores.json + scores.md INTO the run dir. Guards = production modules.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  findForbiddenPhraseHit,
  findSuccessClaimHit,
  HELD_SCIENCE_VOCABULARY_PATTERN,
} from '../scoring/forbidden-user-facing-phrases.js';
import {
  containsMutationLanguage,
  containsStructuralSuccessClaim,
} from '../scoring/mutation-language.js';

const RUN = process.env.RUN_DIR;
if (!RUN) throw new Error('set RUN_DIR=<runs/armX dir>');

// Draft-graph labels ground the `labels_named` metric. Fixed-graph/frozen runs have no
// T01 draft turn (they start from a pre-seeded graph) — tolerate its absence rather than
// crash (ENOENT) as the whole scorer did before the 2026-07-10 fix.
let draft: any = {};
try {
  draft = JSON.parse(readFileSync(join(RUN, 'T01.json'), 'utf-8'));
} catch {
  console.warn('score-run: no T01.json (frozen/pre-seeded run?) — labels_named grounding skipped');
}
const labels: string[] = (draft.draft_graph?.nodes ?? [])
  .map((n: any) => String(n.label ?? ''))
  .filter((s: string) => s.length > 2);

const GENERIC_MARKERS = [
  /\bconsider your assumptions\b/i,
  /\bevaluate the risks\b/i,
  /\bit depends\b/i,
  /\bmany factors\b/i,
  /\bin general\b/i,
  /\bbest practice\b/i,
];

const runLog = readFileSync(join(RUN, 'run-log.txt'), 'utf-8')
  .split('\n')
  .filter((l) => / \| /.test(l));
const msgByTurn: Record<string, string> = {};
for (const l of runLog) {
  // Match ANY turn id, not just T##/P## — journeys also use E*/C*/A0/FT*/FP* ids.
  // (Old `^[TP]\d+` silently skipped every E/C/A0 turn, scoring only a subset — see review 2026-07-10.)
  const m = l.match(/^([A-Z][A-Za-z0-9]*) \|.*\| msg=(.*)$/);
  if (m) msgByTurn[m[1]] = m[2];
}

const rows: any[] = [];
// Any uppercase-prefixed <id>.json is a turn capture (excludes scores.json / scenario-id.txt).
for (const f of readdirSync(RUN).filter((f) => /^[A-Z][A-Za-z0-9]*\.json$/.test(f)).sort()) {
  const turn = f.replace('.json', '');
  let d: any;
  try {
    d = JSON.parse(readFileSync(join(RUN, f), 'utf-8'));
  } catch {
    rows.push({ turn, message: msgByTurn[turn] ?? '', http_ok: false });
    continue;
  }
  const text: string = d.assistant_text ?? '';
  const dt = d._diagnostic_trace ?? {};
  const llmCalls: any[] = dt.llm_calls ?? [];
  const words = text.split(/\s+/).filter(Boolean).length;
  const lines = text.split('\n');
  const bullets = lines.filter((l) => /^\s*[-*] /.test(l)).length;
  const boldSpans = (text.match(/\*\*[^*]+\*\*/g) ?? []).length;
  const paragraphs = text.split(/\n\s*\n/).filter((p) => p.trim().length > 0).length;
  const named = labels.filter((l) => text.toLowerCase().includes(l.toLowerCase()));
  rows.push({
    turn,
    message: msgByTurn[turn] ?? '',
    http_ok: true,
    exit_path: dt.exit_path ?? null,
    llm_roles: llmCalls.map((c: any) => `${c.role}:${c.model}@${c.latency_ms}ms`),
    prompt_ids: (dt.prompt_identity ?? []).map((p: any) => `${p.prompt_id}@${p.version ?? '?'}#${p.hash ?? p.prompt_hash ?? '?'}`),
    words,
    sentences: (text.match(/[.!?](\s|$)/g) ?? []).length,
    questions: (text.match(/\?/g) ?? []).length,
    bullets,
    bold_spans: boldSpans,
    paragraphs,
    labels_named: named,
    numbers_cited: (text.match(/\b\d+(?:\.\d+)?%?|\b£[\d,]+/g) ?? []).slice(0, 12),
    generic_marker: GENERIC_MARKERS.some((r) => r.test(text)),
    forbidden_hit: findForbiddenPhraseHit(text),
    success_claim_hit: findSuccessClaimHit(text),
    held_science_hit: HELD_SCIENCE_VOCABULARY_PATTERN.test(text),
    mutation_language: containsMutationLanguage(text),
    structural_success_claim: containsStructuralSuccessClaim(text),
    chips: (d.suggested_actions ?? []).map((c: any) => c.label),
    chip_count: (d.suggested_actions ?? []).length,
    latency_ms: llmCalls.reduce((a: number, c: any) => a + (c.latency_ms ?? 0), 0) || null,
    text,
  });
}

writeFileSync(join(RUN, 'scores.json'), JSON.stringify(rows, null, 2));

const md = [
  '| Turn | exit_path | LLM? | words | bullets | bold | paras | ? | labels | forbidden | mut-lang | chips |',
  '|---|---|---|---|---|---|---|---|---|---|---|---|',
  ...rows.map((r) =>
    `| ${r.turn} | ${r.exit_path ?? 'n/a'} | ${r.llm_roles?.length ? 'Y' : 'no'} | ${r.words} | ${r.bullets} | ${r.bold_spans} | ${r.paragraphs} | ${r.questions} | ${r.labels_named?.length ?? 0} | ${r.forbidden_hit ?? '—'} | ${r.mutation_language ? 'HIT' : '—'} | ${r.chip_count} |`,
  ),
].join('\n');
writeFileSync(join(RUN, 'scores.md'), md);
console.log(md);
console.log('\nrows:', rows.length);
