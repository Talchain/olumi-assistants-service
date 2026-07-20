#!/usr/bin/env node
/**
 * Literal-aware comment stripping for source-scanning guards.
 *
 * WHY THIS EXISTS (the source-scanning-guard footgun, A2's finding, UI PR
 * #386's fix template): a guard that regexes RAW source text fires on a
 * comment that accurately documents the very anti-pattern it polices — so an
 * honest design note becomes a CI failure, and the natural "fix" is to weaken
 * the comment or the guard. A 2026-07-20 audit positive-controlled SIXTEEN
 * CEE guards into that failure (every shell guard in validate-prepush.sh that
 * greps src/, plus eight static vitest guard specs). This module is the one
 * shared remedy: guards match against the COMMENT-STRIPPED view of a file, so
 * comments can say anything truthfully, while string literals stay intact
 * (real violations often live in strings: `.rpc('append_turn_atomic')`,
 * `'text/event-stream'`, `|| "claude-3-5-haiku-20241022"`).
 *
 * The tokeniser is a deliberate PORT of the ratified length-preserving state
 * machine in tests/unit/contracts/controlled-factor-authority.scan.ts
 * (comments, single/double/template strings with escapes, template-
 * interpolation nesting, regex literals via the preceding-token heuristic).
 * Parity between the two implementations is asserted mechanically by
 * tests/unit/ci/strip-source-comments.test.ts — if they ever drift, that spec
 * goes red (derive-don't-mirror: the sync is CHECKED, not remembered).
 *
 * Plain `.mjs` on purpose (repo precedent: staging-journey-smoke.mjs): the
 * shell guards run it with bare `node`, no transpile step. TypeScript
 * consumers import it via strip-source-comments.d.mts.
 *
 * CLI:
 *   node scripts/ci/strip-source-comments.mjs --self-test
 *   node scripts/ci/strip-source-comments.mjs --scan '<JS regex>' <path>...
 *
 * `--scan` walks each <path> (file, or directory scanned recursively for
 * *.ts — skipping node_modules and *.d.ts) and, for every line whose
 * COMMENT-STRIPPED text matches the pattern, prints `path:line:original text`
 * exactly like `grep -rnH`, so existing shell pipelines (path filters,
 * exemption markers on the ORIGINAL line) keep working unchanged. Exit code:
 * 0 with matches, 1 with none (grep convention), 2 on usage/read errors.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/** Chars after which a `/` starts a regex literal rather than division. */
const REGEX_PRECEDING = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>',
]);

function blank(ch) {
  return ch === '\n' ? '\n' : ' ';
}

/** The last non-whitespace-suffixed word before index i (for `return /regex/`). */
function lastCodeSuffix(source, i) {
  return source.slice(Math.max(0, i - 8), i).trimEnd();
}

/**
 * Tokenise TypeScript source into two length-preserving views:
 *   noComments — comments blanked (newline-preserving); string literals intact.
 *   structural — comments AND string/regex-literal contents blanked; template
 *                interpolations (`${…}`) remain visible as code.
 * Offsets equal the original source, so line numbers survive.
 */
export function tokenise(source) {
  const noComments = new Array(source.length);
  const structural = new Array(source.length);
  let state = 'code';
  /** Template nesting: each entry is the brace depth of one `${` interpolation. */
  const templateStack = [];
  let lastCodeChar = '';

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1] ?? '';

    switch (state) {
      case 'code': {
        if (ch === '/' && next === '/') {
          state = 'line_comment';
          noComments[i] = blank(ch);
          structural[i] = blank(ch);
          break;
        }
        if (ch === '/' && next === '*') {
          state = 'block_comment';
          noComments[i] = blank(ch);
          structural[i] = blank(ch);
          break;
        }
        if (ch === '/' && (REGEX_PRECEDING.has(lastCodeChar) || lastCodeChar === '' || /\breturn$/.test(lastCodeSuffix(source, i)))) {
          state = 'regex';
          noComments[i] = ch;
          structural[i] = ' ';
          break;
        }
        if (ch === "'") {
          state = 'sq';
          noComments[i] = ch;
          structural[i] = ' ';
          break;
        }
        if (ch === '"') {
          state = 'dq';
          noComments[i] = ch;
          structural[i] = ' ';
          break;
        }
        if (ch === '`') {
          state = 'template';
          noComments[i] = ch;
          structural[i] = ' ';
          break;
        }
        if (templateStack.length > 0) {
          if (ch === '{') templateStack[templateStack.length - 1] += 1;
          if (ch === '}') {
            templateStack[templateStack.length - 1] -= 1;
            if (templateStack[templateStack.length - 1] === 0) {
              templateStack.pop();
              state = 'template';
              noComments[i] = ch;
              structural[i] = ' ';
              break;
            }
          }
        }
        noComments[i] = ch;
        structural[i] = ch;
        if (!/\s/.test(ch)) lastCodeChar = ch;
        break;
      }
      case 'line_comment': {
        if (ch === '\n') state = 'code';
        noComments[i] = blank(ch);
        structural[i] = blank(ch);
        break;
      }
      case 'block_comment': {
        if (ch === '/' && source[i - 1] === '*') state = 'code';
        noComments[i] = blank(ch);
        structural[i] = blank(ch);
        break;
      }
      case 'sq':
      case 'dq': {
        const quote = state === 'sq' ? "'" : '"';
        if (ch === '\\') {
          noComments[i] = ch;
          structural[i] = blank(ch);
          if (i + 1 < source.length) {
            i += 1;
            noComments[i] = source[i];
            structural[i] = blank(source[i]);
          }
          break;
        }
        if (ch === quote || ch === '\n') state = 'code';
        noComments[i] = ch;
        structural[i] = ch === '\n' ? '\n' : ' ';
        break;
      }
      case 'template': {
        if (ch === '\\') {
          noComments[i] = ch;
          structural[i] = blank(ch);
          if (i + 1 < source.length) {
            i += 1;
            noComments[i] = source[i];
            structural[i] = blank(source[i]);
          }
          break;
        }
        if (ch === '$' && next === '{') {
          templateStack.push(1);
          state = 'code';
          noComments[i] = ch;
          structural[i] = ' ';
          // consume the '{' as part of the interpolation opener
          i += 1;
          noComments[i] = '{';
          structural[i] = ' ';
          break;
        }
        if (ch === '`') state = 'code';
        noComments[i] = ch;
        structural[i] = blank(ch);
        break;
      }
      case 'regex': {
        if (ch === '\\') {
          noComments[i] = ch;
          structural[i] = blank(ch);
          if (i + 1 < source.length) {
            i += 1;
            noComments[i] = source[i];
            structural[i] = blank(source[i]);
          }
          break;
        }
        if (ch === '[') state = 'regex_class';
        if (ch === '/' || ch === '\n') {
          state = 'code';
          lastCodeChar = ch === '/' ? '/' : lastCodeChar;
        }
        noComments[i] = ch;
        structural[i] = ch === '\n' ? '\n' : ' ';
        break;
      }
      case 'regex_class': {
        if (ch === '\\') {
          noComments[i] = ch;
          structural[i] = blank(ch);
          if (i + 1 < source.length) {
            i += 1;
            noComments[i] = source[i];
            structural[i] = blank(source[i]);
          }
          break;
        }
        if (ch === ']') state = 'regex';
        noComments[i] = ch;
        structural[i] = ch === '\n' ? '\n' : ' ';
        break;
      }
      default:
        throw new Error(`unreachable tokeniser state: ${state}`);
    }
  }
  return { noComments: noComments.join(''), structural: structural.join('') };
}

/**
 * The comment-stripped view of `source` (string literals intact). Length- and
 * line-preserving: safe to split on '\n' and keep original line numbers.
 */
export function stripComments(source) {
  return tokenise(source).noComments;
}

// ── CLI: --scan ─────────────────────────────────────────────────────────────

function walkTsFiles(path, out) {
  const st = statSync(path);
  if (st.isFile()) {
    out.push(path);
    return out;
  }
  for (const entry of readdirSync(path).sort()) {
    if (entry === 'node_modules') continue;
    const full = join(path, entry);
    const child = statSync(full);
    if (child.isDirectory()) {
      walkTsFiles(full, out);
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

function runScan(pattern, paths) {
  let re;
  try {
    re = new RegExp(pattern);
  } catch (err) {
    process.stderr.write(`strip-source-comments: invalid pattern ${JSON.stringify(pattern)}: ${err.message}\n`);
    process.exit(2);
  }
  if (paths.length === 0) {
    process.stderr.write('strip-source-comments: --scan needs at least one path\n');
    process.exit(2);
  }
  let matched = false;
  for (const root of paths) {
    let files;
    try {
      files = walkTsFiles(root, []);
    } catch (err) {
      process.stderr.write(`strip-source-comments: cannot read ${root}: ${err.message}\n`);
      process.exit(2);
    }
    for (const file of files) {
      const original = readFileSync(file, 'utf8');
      const strippedLines = stripComments(original).split('\n');
      const originalLines = original.split('\n');
      for (let i = 0; i < strippedLines.length; i++) {
        if (re.test(strippedLines[i])) {
          matched = true;
          process.stdout.write(`${file}:${i + 1}:${originalLines[i]}\n`);
        }
      }
    }
  }
  process.exit(matched ? 0 : 1);
}

// ── CLI: --self-test (positive + negative controls) ─────────────────────────

function runSelfTest() {
  const failures = [];
  const check = (name, actual, expected) => {
    if (actual === expected) {
      process.stdout.write(`  OK   ${name}\n`);
    } else {
      process.stdout.write(`  FAIL ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}\n`);
      failures.push(name);
    }
  };
  const matches = (src, ere) => new RegExp(ere).test(stripComments(src));

  // Negative controls — accurate comments must NOT match.
  check('trailing comment stripped', matches('const ok = 1; // never cast via as unknown as here', 'as unknown as'), false);
  check('unstarred block-comment body stripped', matches('/*\nthe as unknown as pattern is banned\n*/', 'as unknown as'), false);
  check('full-line comment stripped', matches('// reply.raw.write is forbidden', 'reply\\.raw\\.write'), false);
  check('JSDoc body stripped', matches('/**\n * DecisionGuideAI renders this.\n */', 'DecisionGuideAI'), false);

  // Positive controls — real code and string literals MUST still match.
  check('real code still matches', matches('const meta = input as unknown as Meta;', 'as unknown as'), true);
  check('string literal contents kept', matches("reply.type('text/event-stream');", 'text/event-stream'), true);
  check('string-literal exploit still counted', matches('export const x = v as unknown as R; const s = "https://x.invalid// marker";', 'as unknown as'), true);
  check('code after a //-bearing string kept', matches('const u = "https://a//b"; const y = q as unknown as Z;', 'as unknown as'), true);
  check('template interpolation code kept', matches('const t = `x ${v as unknown as W} y`;', 'as unknown as'), true);
  check('regex literal does not open a comment', matches('const r = /https:\\/\\//; const z = a as unknown as B;', 'as unknown as'), true);

  // Line-number preservation.
  const multi = 'line1\n/* c1\nc2 */\nconst hit = a as unknown as B;\n';
  const strippedLineIndex = stripComments(multi).split('\n').findIndex((l) => /as unknown as/.test(l));
  check('line numbers preserved across block comments', strippedLineIndex, 3);

  if (failures.length > 0) {
    process.stdout.write(`SELF-TEST FAILED: ${failures.length} check(s)\n`);
    process.exit(1);
  }
  process.stdout.write('SELF-TEST PASSED: comments blanked, literals kept, line numbers stable.\n');
  process.exit(0);
}

// ── entrypoint ──────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (isMain) {
  const [mode, ...rest] = process.argv.slice(2);
  if (mode === '--self-test') {
    runSelfTest();
  } else if (mode === '--scan') {
    const [pattern, ...paths] = rest;
    if (pattern === undefined) {
      process.stderr.write('strip-source-comments: --scan needs a pattern\n');
      process.exit(2);
    }
    runScan(pattern, paths);
  } else if (mode !== undefined) {
    process.stderr.write(`strip-source-comments: unknown mode ${JSON.stringify(mode)} (use --scan or --self-test)\n`);
    process.exit(2);
  }
  // No mode: imported-as-module fallthrough (nothing to do).
}
