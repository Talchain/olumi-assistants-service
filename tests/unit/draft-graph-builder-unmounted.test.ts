/**
 * Guard: `buildDraftGraphSchema()` is unmounted, and stays unmounted.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────────
 *
 * `src/cee/draft/anthropic-graph-schema.ts` is the RETIRED draft grammar. The
 * adapter sends `buildDraftRecordsSchema()` (`src/cee/draft/records/grammar.ts`)
 * from `src/adapters/llm/anthropic.ts` instead.
 *
 * The retired file's original header was the most measurement-dense
 * documentation in this service — live-probed compile boundaries, serialized
 * byte counts, a 15-probe bisect, an output-token census. Because it was much
 * richer than the live records grammar's own documentation, readers who did not
 * think to ask who CALLS the builder repeatedly treated it as authoritative
 * about the current send path. Two separate investigations built diagnostic
 * chains on it in one day. Dead code with excellent documentation outranks live
 * code with thin documentation, in the mind of a reader who never checks the
 * call graph.
 *
 * A comment saying "this is retired" would be another sentence nothing pins —
 * which is exactly the artefact that misled those readers. So the deadness is
 * DERIVED here instead, and fails loud.
 *
 * ── WHAT THIS GUARD DOES AND DOES NOT COVER ───────────────────────────────
 *
 * COVERS: production TypeScript under `src/` — every `.ts`/`.tsx` file except
 * `__tests__/` directories and `*.test.ts` / `*.spec.ts` files.
 *
 * DOES NOT COVER, deliberately: `scripts/`, `tools/`, `tests/`. Several
 * measurement scripts (`scripts/measure-*.mjs`, `scripts/probe-grammar-compile
 * .mjs`) legitimately import the retired builder in order to re-run the
 * historical A/B probes, and several test files import it to pin its shape.
 * None of those is a mount. "Unmounted" here means precisely: NO PRODUCTION
 * CALL SITE UNDER `src/`.
 *
 * This guard prevents ONE instance — the re-mounting of this builder. It is not
 * a general mechanism against retired-but-authoritative-looking code.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));

const RETIRED_MODULE = join('src', 'cee', 'draft', 'anthropic-graph-schema.ts');
const RETIRED_BUILDER = 'buildDraftGraphSchema';
const LIVE_BUILDER = 'buildDraftRecordsSchema';
const LIVE_ADAPTER = join('src', 'adapters', 'llm', 'anthropic.ts');

/**
 * The production files that may import the retired module at all.
 *
 * The BUILDER is unmounted; the MODULE is not. `parse.ts` imports
 * `DRAFT_SOFT_NODE_CAP` / `DRAFT_SOFT_EDGE_CAP` from it, and those are live.
 * Pinning the exact set means neither direction can drift silently: a new
 * production importer REDs, and so does the disappearance of the known one
 * (at which point the module is fully unmounted and can be deleted).
 */
const EXPECTED_MODULE_IMPORTERS = [join('src', 'cee', 'unified-pipeline', 'stages', 'parse.ts')];

/**
 * Blank out comments and string-literal TEXT, preserving offsets and line
 * structure, so an identifier MENTIONED in prose is not counted as a call.
 *
 * This is load-bearing, not decoration: at the time of writing, two production
 * files mention `buildDraftGraphSchema` — one in a JSDoc block
 * (`src/adapters/llm/normalisation.ts`) and one inside a single-quoted string
 * (`src/adapters/llm/anthropic-model-capabilities.ts`). A naive substring sweep
 * reports both as call sites and this guard would be permanently and wrongly
 * red. The `strips prose but keeps code` test below pins that behaviour.
 *
 * Template-literal EXPRESSIONS (`${...}`) are kept as code — a call really can
 * live there. Their literal text is blanked, which also stops an apostrophe in
 * prose (`don't`) from opening a bogus string state and swallowing real code.
 */
export function stripSource(source: string, opts: { stripStrings: boolean }): string {
  const { stripStrings } = opts;
  let out = '';
  let i = 0;
  const n = source.length;
  let state: 'code' | 'line' | 'block' | 'sq' | 'dq' | 'tpl' = 'code';
  let braceDepth = 0;
  const exprDepths: number[] = [];
  const blank = (ch: string): void => {
    out += ch === '\n' ? '\n' : ' ';
  };

  while (i < n) {
    const c = source[i] as string;
    const d = i + 1 < n ? (source[i + 1] as string) : '';

    if (state === 'code') {
      if (c === '/' && d === '/') {
        state = 'line';
        i += 2;
        continue;
      }
      if (c === '/' && d === '*') {
        state = 'block';
        i += 2;
        continue;
      }
      if (stripStrings && c === "'") {
        state = 'sq';
        blank(c);
        i++;
        continue;
      }
      if (stripStrings && c === '"') {
        state = 'dq';
        blank(c);
        i++;
        continue;
      }
      if (stripStrings && c === '`') {
        state = 'tpl';
        blank(c);
        i++;
        continue;
      }
      if (c === '{') {
        braceDepth++;
        out += c;
        i++;
        continue;
      }
      if (c === '}') {
        if (exprDepths.length > 0 && braceDepth === exprDepths[exprDepths.length - 1]) {
          exprDepths.pop();
          state = 'tpl';
          blank(c);
          i++;
          continue;
        }
        braceDepth--;
        out += c;
        i++;
        continue;
      }
      out += c;
      i++;
      continue;
    }

    if (state === 'line') {
      if (c === '\n') {
        state = 'code';
        out += '\n';
      }
      i++;
      continue;
    }

    if (state === 'block') {
      if (c === '*' && d === '/') {
        state = 'code';
        i += 2;
        continue;
      }
      blank(c);
      i++;
      continue;
    }

    // Inside a string or template literal.
    if (c === '\\') {
      blank(c);
      if (d) blank(d);
      i += 2;
      continue;
    }
    if (state === 'sq' && c === "'") {
      state = 'code';
      blank(c);
      i++;
      continue;
    }
    if (state === 'dq' && c === '"') {
      state = 'code';
      blank(c);
      i++;
      continue;
    }
    if (state === 'tpl') {
      if (c === '`') {
        state = 'code';
        blank(c);
        i++;
        continue;
      }
      if (c === '$' && d === '{') {
        exprDepths.push(braceDepth);
        state = 'code';
        blank(c);
        blank(d);
        i += 2;
        continue;
      }
    }
    blank(c);
    i++;
    continue;
  }
  return out;
}

/** Comments AND string text blanked — for identifier (call-site) sweeps. */
export function stripCommentsAndStringLiterals(source: string): string {
  return stripSource(source, { stripStrings: true });
}

/**
 * Comments blanked, STRING TEXT KEPT — for module-specifier sweeps.
 *
 * An import path IS a string literal (`from '../x.js'`), so the call-site
 * stripper above blanks the very thing an importer sweep is looking for. Using
 * it here returned "(none)" for a module with a real live importer — a
 * confident false ABSENCE. That is why these are two functions, not one.
 */
export function stripCommentsOnly(source: string): string {
  return stripSource(source, { stripStrings: false });
}

/** Every production `.ts`/`.tsx` file under `src/` — no tests, no node_modules. */
function listProductionSourceFiles(): string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const abs = join(dir, entry);
      if (statSync(abs).isDirectory()) {
        if (entry === 'node_modules' || entry === '__tests__') continue;
        walk(abs);
        continue;
      }
      if (!/\.tsx?$/.test(entry)) continue;
      if (/\.(test|spec)\.tsx?$/.test(entry)) continue;
      files.push(relative(REPO_ROOT, abs));
    }
  };
  walk(join(REPO_ROOT, 'src'));
  return files;
}

const PRODUCTION_FILES = listProductionSourceFiles();

/**
 * Read and lex every production file ONCE.
 *
 * Re-reading and re-lexing ~1,000 files per sweep blew vitest's 5s default
 * timeout on a loaded machine, and a timed-out guard is a guard that reports
 * nothing while looking like a failure of the thing it guards.
 */
const SOURCES: ReadonlyArray<{ rel: string; codeOnly: string; codeWithStrings: string }> =
  PRODUCTION_FILES.map((rel) => {
    const raw = readFileSync(join(REPO_ROOT, rel), 'utf-8');
    return {
      rel,
      codeOnly: stripCommentsAndStringLiterals(raw),
      codeWithStrings: stripCommentsOnly(raw),
    };
  });

/** Production sites where `identifier` appears as CODE (not in prose). */
function findProductionSites(identifier: string, excluded: string[]): string[] {
  const re = new RegExp(`(?<![\\w$])${identifier}(?![\\w$])`);
  const hits: string[] = [];
  for (const { rel, codeOnly } of SOURCES) {
    if (excluded.includes(rel)) continue;
    codeOnly.split('\n').forEach((line, idx) => {
      if (re.test(line)) hits.push(`${rel}:${idx + 1}`);
    });
  }
  return hits;
}

/**
 * Production files that really `import`/`require` the retired module.
 *
 * Uses the comments-only strip: a module specifier IS a string literal, so the
 * call-site stripper would blank it and this would return a false "(none)".
 */
function findModuleImporters(excluded: string[]): string[] {
  const re = /(?:from|require\s*\()\s*['"][^'"]*anthropic-graph-schema(?:\.js|\.ts)?['"]/;
  return SOURCES.filter(({ rel, codeWithStrings }) => {
    if (excluded.includes(rel)) return false;
    return re.test(codeWithStrings);
  }).map(({ rel }) => rel);
}

describe('retired draft grammar — buildDraftGraphSchema() stays unmounted', () => {
  it('preconditions: the sweep is pointed at a real tree it can actually read', () => {
    // An absence claim from a sweep that scanned nothing is worthless. Pin the
    // three things that would make the EMPTY result below meaningless.
    expect(existsSync(join(REPO_ROOT, 'package.json'))).toBe(true);
    expect(existsSync(join(REPO_ROOT, RETIRED_MODULE))).toBe(true);
    expect(PRODUCTION_FILES.length).toBeGreaterThan(500);
    expect(PRODUCTION_FILES).toContain(LIVE_ADAPTER);
  });

  it('strips prose but keeps code — the sweep can tell a mention from a call', () => {
    // The check that licenses the EMPTY verdict below, validated FIRST with a
    // discriminating pair. Without this, a stripper that blanked everything
    // would make the guard pass while seeing nothing at all.
    const strip = (s: string): string => stripCommentsAndStringLiterals(s);

    // NOT code — must be blanked.
    expect(strip(`// calls ${RETIRED_BUILDER}() here`)).not.toContain(RETIRED_BUILDER);
    expect(strip(`/* calls ${RETIRED_BUILDER}() here */`)).not.toContain(RETIRED_BUILDER);
    expect(strip(`const a = 'see ${RETIRED_BUILDER} docs';`)).not.toContain(RETIRED_BUILDER);
    expect(strip(`const a = "see ${RETIRED_BUILDER} docs";`)).not.toContain(RETIRED_BUILDER);
    expect(strip('const a = `see ' + RETIRED_BUILDER + ' docs`;')).not.toContain(RETIRED_BUILDER);

    // IS code — must survive.
    expect(strip(`const s = ${RETIRED_BUILDER}();`)).toContain(RETIRED_BUILDER);
    expect(strip(`import { ${RETIRED_BUILDER} } from './x.js';`)).toContain(RETIRED_BUILDER);
    expect(strip('const s = `${' + RETIRED_BUILDER + '()}`;')).toContain(RETIRED_BUILDER);

    // Regression pin for the lexer: an apostrophe inside template prose must
    // not open a string state and swallow the code that follows it.
    expect(strip("const t = `don't`; const s = " + RETIRED_BUILDER + '();')).toContain(
      RETIRED_BUILDER,
    );

    // And the stripper must not simply blank the world.
    expect(strip('const x = 1;')).toContain('const x = 1;');
  });

  it('has ZERO production call sites, while the live builder still has one', () => {
    const retiredSites = findProductionSites(RETIRED_BUILDER, [RETIRED_MODULE]);

    // CONTRAST CONTROL, in this same test. An empty result above is only
    // evidence of absence if the identical sweep can still SEE a live symbol.
    // If this ever reads zero, the sweep is broken and the assertion above is
    // vacuous — not proof that the retired builder is unmounted.
    const liveSites = findProductionSites(LIVE_BUILDER, []);
    expect(
      liveSites.length,
      `CONTRAST CONTROL FAILED: the sweep found no production site for ` +
        `${LIVE_BUILDER}(), which is the grammar the adapter actually sends. ` +
        `The sweep is blind, so the "zero call sites" result below proves nothing. ` +
        `Fix the sweep before trusting this file.`,
    ).toBeGreaterThan(0);
    expect(
      liveSites.some((s) => s.startsWith(`${LIVE_ADAPTER}:`)),
      `CONTRAST CONTROL FAILED: ${LIVE_BUILDER}() has no call site in ` +
        `${LIVE_ADAPTER}. Either the adapter stopped sending the records ` +
        `grammar, or the sweep is broken. Both need a human.`,
    ).toBe(true);

    expect(
      retiredSites,
      `${RETIRED_BUILDER}() IS RETIRED AND MUST NOT BE CALLED FROM PRODUCTION.\n` +
        `Found ${retiredSites.length} production call site(s):\n` +
        retiredSites.map((s) => `  - ${s}`).join('\n') +
        `\n\nThe grammar CEE sends is ${LIVE_BUILDER}() from ` +
        `src/cee/draft/records/grammar.ts, called from ${LIVE_ADAPTER}.\n` +
        `${RETIRED_MODULE} is kept only as the revert target; its historical ` +
        `measurements live in Docs/draft-graph-grammar-measurements-2026-09-04.md ` +
        `and were taken against the GRAPH grammar, not the records grammar.\n` +
        `If you are deliberately reverting to the graph grammar, delete this ` +
        `guard in the same change — do not weaken it.`,
    ).toEqual([]);
  }, 30_000);

  it('pins the exact set of production files importing the retired module', () => {
    const importers = findModuleImporters([RETIRED_MODULE]);
    expect(
      importers.slice().sort(),
      `The production importers of ${RETIRED_MODULE} have changed.\n` +
        `Expected exactly: ${EXPECTED_MODULE_IMPORTERS.join(', ')}\n` +
        `Found:            ${importers.join(', ') || '(none)'}\n\n` +
        `MORE importers: something new depends on the retired module — check it ` +
        `is not the grammar builder coming back.\n` +
        `FEWER importers: the module may now be fully unmounted and deletable. ` +
        `Update the header of ${RETIRED_MODULE}, which currently states that ` +
        `DRAFT_SOFT_NODE_CAP / DRAFT_SOFT_EDGE_CAP are still live.`,
    ).toEqual(EXPECTED_MODULE_IMPORTERS.slice().sort());
  }, 30_000);

  it('the retired file points a reader at its own pin, not at a bare assurance', () => {
    // The header claims the builder is unmounted. That claim must name the
    // artefact that enforces it, or it is just another sentence nothing checks
    // — which is the exact failure this guard was written for.
    const header = readFileSync(join(REPO_ROOT, RETIRED_MODULE), 'utf-8').slice(0, 4000);
    expect(header).toContain(relative(REPO_ROOT, fileURLToPath(import.meta.url)).split(sep).join('/'));
    expect(header).toContain(LIVE_BUILDER);
    expect(header).toContain('Docs/draft-graph-grammar-measurements-2026-09-04.md');
  });
});
