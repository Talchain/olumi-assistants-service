/**
 * ⛔ SYSTEM 2 retirement (DL ruling 15 Oct ~02:4xZ): the retired drafter carriers (`baseline_evidence`, `stated_evidence`) are
 * no longer sent, so only recordings made before SYSTEM 2 hold them, and they are read ONLY through the one recorded-raw reader
 * (`recordedRawLevelQuote` / `recordedRawSettingQuote`, verified-option-setting.ts). This list names every tracked file that
 * still mentions them, with its occurrence count. It may only SHRINK: a new file, or a rise in a listed file, fails; a file that
 * migrated to a fresh served raw must leave the list in the same PR. Regenerate with RECORDED_RAW_CARRIERS_WRITE=1.
 */
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { BUILD_INSTRUCTIONS, buildCandidateSchema, strictForTheDrafter } from '../../src/orchestrator-v5/agent-lane/runtime/build-model.js';

const LIST = 'scripts/ci/recorded-raw-carriers.json';
const TOKEN = /\b(?:baseline_evidence|stated_evidence)\b/g;
const CONTROL = /\bfactor_label\b/g;
/**
 * Every draft a JSON fixture holds (an object with a `goal` and `factors` or `options`, also inside a JSON string such as a captured answer's
 * text). A capture whose every draft carries `statements[]` is statement-era: it never reaches the recorded-raw reader, so it is
 * not a recording the list tracks (AIE 6183705670's D3r1/D5r1 captures). Unparseable JSON counts, conservatively.
 */
function drafts(v: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (typeof v === 'string' && /^\s*\{/.test(v)) { try { drafts(JSON.parse(v), out); } catch { /* not JSON */ } return out; }
  if (Array.isArray(v)) { for (const x of v) drafts(x, out); return out; }
  if (v !== null && typeof v === 'object') {
    const r = v as Record<string, unknown>;
    if (r.goal !== undefined && (Array.isArray(r.factors) || Array.isArray(r.options))) out.push(r);
    for (const x of Object.values(r)) drafts(x, out);
  }
  return out;
}
export function statementEra(text: string): boolean {
  try { const all = drafts(JSON.parse(text)); return all.length > 0 && all.every((d) => Array.isArray(d.statements)); } catch { return false; }
}
function census(pattern: RegExp): Record<string, number> {
  const files = execFileSync('git', ['ls-files', 'src', 'tests', 'scripts'], { encoding: 'utf8' }).split('\n')
    .filter((f) => /\.(ts|mts|js|mjs|json)$/.test(f) && f !== LIST && f !== 'tests/contract/recorded-raw-carriers.guard.test.ts');
  const out: Record<string, number> = {};
  for (const f of files) {
    // A pending deletion is still indexed; retain fail-closed reads for every extant entry.
    try { lstatSync(f); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue; throw error; }
    const text = readFileSync(f, 'utf8');
    if (f.endsWith('.json') && statementEra(text)) continue;
    const n = (text.match(pattern) ?? []).length; if (n > 0) out[f] = n;
  }
  return out;
}

describe('recorded-raw carriers: shrink-only', () => {
  const now = census(TOKEN);
  if (process.env.RECORDED_RAW_CARRIERS_WRITE === '1') writeFileSync(LIST, `${JSON.stringify({ files: now }, null, 1)}\n`);
  const listed = (JSON.parse(readFileSync(LIST, 'utf8')) as { files: Record<string, number> }).files;

  it('no new file and no rise; a migrated file leaves the list in the same PR', () => {
    const problems = [
      ...Object.entries(now).filter(([f, n]) => n > (listed[f] ?? 0)).map(([f, n]) => `new or rising: ${f} (${listed[f] ?? 0} → ${n})`),
      ...Object.entries(listed).filter(([f, n]) => (now[f] ?? 0) < n).map(([f, n]) => `stale (shrink the list): ${f} (${n} → ${now[f] ?? 0})`),
    ];
    expect(problems.join('\n')).toBe('');
  });

  it('is non-vacuous (contrast): the census sees the carriers and a same-family field', () => {
    expect(Object.keys(now).length).toBeGreaterThan(0);
    expect(Object.keys(census(CONTROL)).length).toBeGreaterThan(Object.keys(now).length);
    expect(now['src/orchestrator-v5/agent-lane/verified-option-setting.ts']).toBeGreaterThan(0);
  });

  it('a statement-era capture is not a recording: exempt only when EVERY draft in it carries statements[] (contrast: one without)', () => {
    const era = readFileSync('tests/fixtures/sys2/pre-h0h1-d3r1.json', 'utf8');
    expect(era.match(TOKEN)?.length ?? 0).toBeGreaterThan(0);
    expect(statementEra(era)).toBe(true);
    const d = JSON.parse(era) as Record<string, string>;
    const one = JSON.parse(d.call1_text!) as Record<string, unknown>; delete one.statements;
    expect(statementEra(JSON.stringify({ ...d, call1_text: JSON.stringify(one) }))).toBe(false);
    expect(statementEra(readFileSync('tests/fixtures/introduction-stamp/served-hiring-post3007-draft.json', 'utf8'))).toBe(false);
  });

  it('the drafter is never sent them: the strict provider schema and the instructions name neither carrier', () => {
    expect(JSON.stringify(strictForTheDrafter(buildCandidateSchema()))).not.toMatch(TOKEN);
    expect(String(BUILD_INSTRUCTIONS)).not.toMatch(TOKEN);
  });
});
