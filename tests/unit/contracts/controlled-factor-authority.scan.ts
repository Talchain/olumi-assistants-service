/**
 * Persisted-first contract guard — pure scan machinery (component 1).
 *
 * Data-authority doctrine: the controlled-factor set (which factors an option
 * already pins) must be derived from the SAVED model, never request-first from
 * the browser's copy. #309/#314/#316 each fixed one request-first call site of
 * `collectInterventionControlledFactorIds`; this guard closes the CLASS: every
 * production call site's argument must match a reviewed ALLOWLIST of
 * persisted-first / persisted-only / persisted-derived forms, and any NEW call
 * site fails by construction until the allowlist is consciously extended.
 *
 * Allowlist beats denylist: an alias (`graphStateForTurn`), an intermediate
 * rebinding (`const g = options.graphState ?? …`), or a brand-new call site is
 * a violation because it is NOT LISTED — no bad form needs enumerating, so the
 * guard cannot fail open (denylists fail open; that was a real defect class).
 *
 * Text handling is TOKENISER-BASED and length-preserving, not naive regex
 * stripping. The review mutation drills proved two fail-open holes in the
 * first regex design: (a) a `//` or unpaired `/*` INSIDE A STRING deleted the
 * rest of the code and hid call sites; (b) collapsing block comments destroyed
 * newlines so every reported line number was wrong by hundreds. The tokeniser
 * blanks comments (and, for the structural view, string contents) char-for-char
 * with newlines preserved, so offsets and line numbers in the views equal the
 * original source, braces/parens inside strings cannot mis-scope captures, and
 * nothing inside a string can hide code that follows it.
 *
 * Reference discipline (closes the laundering class found by the synthetic
 * mutation drill): the ONLY sanctioned appearances of the authority function
 * name in production code are (1) a direct call `name(…)` and (2) a direct
 * named import specifier. An `as`-alias, a namespace import, a dynamic
 * import/require of the module, a bare rebinding (`const f = name;`), or a
 * point-free reference (`xs.map(name)`) are all violations by construction.
 *
 * Two-layer defence: this structural scan + the behavioural seam-spy test
 * (`turn-executor-run-comparison-controlled-authority.test.ts`, landed with
 * #316) which asserts the RUNTIME authority value — covering the semantic
 * laundering a text scan cannot see (rebinding `context.persistedGraph`
 * upstream).
 *
 * Pure functions over source text (no I/O in the scanners) so the committed
 * RED cases in the guard test are permanent, and the historical RED (the
 * pre-#316 tip failing at the run-comparison site) is reproducible by feeding
 * `git show <sha>:<file>` output through the same code. Evidence transcripts:
 * `Docs/v5/persisted-first-guard-evidence.md`.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const AUTHORITY_FUNCTION = 'collectInterventionControlledFactorIds';

/** The defining module — its declaration is not a call site. */
export const DEFINING_MODULE = 'orchestrator-v5/context/intervention-controlled-drivers.ts';

export interface AuthorityCallSite {
  /** Path relative to the src root, posix separators. */
  readonly file: string;
  /** 1-based line of the callee name in the ORIGINAL source. */
  readonly line: number;
  /** The full argument text, comment-stripped, whitespace-collapsed. */
  readonly argText: string;
}

export interface ScanResult {
  readonly sites: readonly AuthorityCallSite[];
  readonly violations: readonly string[];
}

/**
 * The reviewed allowlist: file → exact normalised argument forms + expected
 * site count. Extending this table is a conscious, reviewed act — that is the
 * guard working as designed, not an inconvenience.
 *
 * Verified on origin/staging @ 3e4b86115 (post-#316: every production site is
 * persisted-first / persisted-only / persisted-derived):
 *   - turn-executor.ts:1208 context-pack projection (persisted-first)
 *   - turn-executor.ts:3283 run-comparison gate (persisted-first; the #316 fix)
 *   - turn-executor.ts:4515 routed flip filter (persisted-first)
 *   - chip-click-dispatch.ts:1247 chip-click flip (persisted-only)
 *   - run-analysis.ts:662 snapshot projection (persisted-derived: the snapshot
 *     is loaded via the scenario reader, so both alternatives come from the
 *     saved model)
 *
 * Extended for D-U F2 (#444, critique-lever display filter):
 *   - compose.ts:595 Phase 3 lever-union rebuild (persisted-derived: the shared
 *     `rebuildPhase3BlocksFresh` helper reads the lever union from its
 *     `rawPersistedGraphForLevers` parameter, which BOTH production callers
 *     thread from the saved model — the hash-gated persisted snapshot on the
 *     current-turn branch (`fallbackForFact`, fails closed to `undefined` on
 *     hash divergence) and the FRESH-verdict persisted graph on the prior-fact
 *     branch. Display/copy-only: an empty set ⇒ no suppression, byte-identical)
 */
export const AUTHORITY_ALLOWLIST: Readonly<
  Record<string, { readonly count: number; readonly allowedArgs: readonly string[] }>
> = {
  'orchestrator-v5/turn-executor.ts': {
    // 4th site (ROADMAP 2.73): STEP-5 applyCoachingSignal threads the
    // controlled set into the rerun-delta comparator — same persisted-first
    // form as the other three sites.
    //
    // 5th site (F1-flip lane, 2026-07-22): the bounded routing-failure fallback
    // for a FORCED what_would_flip pill filters the prior-fact flip summary
    // through the controlled set before composing the deterministic flip answer
    // — the SAME persisted-first authority the routed happy-path fallback uses,
    // so the pill's degrade-honestly answer suppresses option-pinned levers
    // identically. No request-graph leg.
    count: 5,
    allowedArgs: ['context.persistedGraph ?? options.graphState'],
  },
  'orchestrator-v5/handlers/chip-click-dispatch.ts': {
    // 2nd site (ROADMAP 2.73): the run_analysis chip path threads the
    // controlled set into applyCoachingSignal. Persisted-derived on both
    // legs: the pre-loaded scenario snapshot's raw persisted graph
    // (production) with the turn-context persisted graph as the
    // injected-registry test-path fallback. No request-graph leg.
    count: 2,
    allowedArgs: [
      'context.persistedGraph',
      'cachedSnapshot?.rawPersistedGraph ?? context.persistedGraph',
    ],
  },
  'orchestrator-v5/tools/handlers/run-analysis.ts': {
    count: 1,
    allowedArgs: ['snapshot.rawPersistedGraph ?? { options: snapshot.options }'],
  },
  'orchestrator-v5/compose.ts': {
    count: 1,
    allowedArgs: ['rawPersistedGraphForLevers'],
  },
};

/**
 * Anti-rot floor, DERIVED from the allowlist (a hand-maintained duplicate can
 * drift): a vacuous scan (function renamed, files moved) must fail loudly, so
 * the repository test requires at least this many total sites.
 */
export const MIN_TOTAL_SITES = Object.values(AUTHORITY_ALLOWLIST).reduce(
  (n, entry) => n + entry.count,
  0,
);

// ---------------------------------------------------------------------------
// Length-preserving tokeniser
// ---------------------------------------------------------------------------

export interface TokenisedViews {
  /** Comments blanked (newline-preserving); string literals intact. */
  readonly noComments: string;
  /**
   * Comments AND string/regex-literal contents blanked (newline-preserving).
   * Template interpolations (`${…}`) remain visible as code. Use this view for
   * ALL structural work: name matching, paren/brace capture, import scanning,
   * line numbers. Offsets equal the original source.
   */
  readonly structural: string;
}

type TokState =
  | 'code'
  | 'line_comment'
  | 'block_comment'
  | 'sq'
  | 'dq'
  | 'template'
  | 'regex'
  | 'regex_class';

/** Chars after which a `/` starts a regex literal rather than division. */
const REGEX_PRECEDING = new Set([
  '(', ',', '=', ':', '[', '!', '&', '|', '?', '{', '}', ';', '+', '-', '*', '%', '~', '^', '<', '>',
]);

function blank(ch: string): string {
  return ch === '\n' ? '\n' : ' ';
}

/**
 * Tokenise TypeScript source into the two length-preserving views. A small
 * state machine (comments, single/double/template strings with escapes,
 * template-interpolation nesting, regex literals via the standard
 * preceding-token heuristic) — deliberately not a full parser, but proof
 * against every string/comment interaction the committed RED cases pin.
 */
export function tokenise(source: string): TokenisedViews {
  const noComments: string[] = new Array(source.length);
  const structural: string[] = new Array(source.length);
  let state: TokState = 'code';
  /** Template nesting: each entry is the brace depth of one `${` interpolation. */
  const templateStack: number[] = [];
  let lastCodeChar = '';

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]!;
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
          if (ch === '{') templateStack[templateStack.length - 1]! += 1;
          if (ch === '}') {
            templateStack[templateStack.length - 1]! -= 1;
            if (templateStack[templateStack.length - 1]! === 0) {
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
            noComments[i] = source[i]!;
            structural[i] = blank(source[i]!);
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
            noComments[i] = source[i]!;
            structural[i] = blank(source[i]!);
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
            noComments[i] = source[i]!;
            structural[i] = blank(source[i]!);
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
            noComments[i] = source[i]!;
            structural[i] = blank(source[i]!);
          }
          break;
        }
        if (ch === ']') state = 'regex';
        noComments[i] = ch;
        structural[i] = ch === '\n' ? '\n' : ' ';
        break;
      }
    }
  }
  return { noComments: noComments.join(''), structural: structural.join('') };
}

/** The last non-whitespace-suffixed word before index i (for `return /regex/`). */
function lastCodeSuffix(source: string, i: number): string {
  return source.slice(Math.max(0, i - 8), i).trimEnd();
}

/** Collapse whitespace runs and trim, for exact-match allowlisting. */
export function normaliseArg(raw: string): string {
  return raw.replace(/\s+/g, ' ').replace(/,\s*$/, '').trim();
}

/** 1-based line of an offset (valid for both views: newlines preserved). */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text[i] === '\n') line += 1;
  return line;
}

/**
 * Capture a balanced block from `text` starting at the first `open` delimiter
 * at/after `from`. Run this on the STRUCTURAL view only — string contents are
 * blanked there, so delimiters inside literals cannot mis-scope the capture.
 * Returns null when no opener exists or the block never balances.
 */
export function captureBalanced(
  text: string,
  from: number,
  open: string,
  close: string,
): { start: number; end: number } | null {
  const start = text.indexOf(open, from);
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === open) depth += 1;
    else if (text[i] === close) {
      depth -= 1;
      if (depth === 0) return { start, end: i };
    }
  }
  return null;
}

/**
 * Extract every CALL of the authority function from one file's source text.
 * Matching runs on the structural view (comments + string contents blanked),
 * so nothing inside a comment, string, or regex literal can produce or hide a
 * match; the argument text is sliced from the comment-only view at the same
 * offsets (length-preserving), so real argument content is preserved.
 */
export function extractAuthorityCallSites(source: string, file: string): AuthorityCallSite[] {
  const { noComments, structural } = tokenise(source);
  const sites: AuthorityCallSite[] = [];
  const namePattern = new RegExp(`${AUTHORITY_FUNCTION}\\s*\\(`, 'g');
  let match: RegExpExecArray | null;
  while ((match = namePattern.exec(structural)) !== null) {
    // Exclude the declaration itself (`function collect…(`).
    const before = structural.slice(Math.max(0, match.index - 20), match.index);
    if (/function\s+$/.test(before)) continue;

    const capture = captureBalanced(structural, match.index + match[0].length - 1, '(', ')');
    if (capture === null) continue; // unbalanced file tail; nothing to capture
    const argRaw = noComments.slice(capture.start + 1, capture.end);
    sites.push({ file, line: lineOf(structural, match.index), argText: normaliseArg(argRaw) });
  }
  return sites;
}

/**
 * Reference-discipline scan (the laundering rules). Runs on the structural
 * view. Violations:
 *   - `name as alias` (import/export aliasing);
 *   - namespace import of the defining module;
 *   - dynamic import()/require() of the defining module;
 *   - ANY other appearance of the name that is neither a direct call nor a
 *     direct named-import specifier — i.e. bare rebinding (`const f = name;`)
 *     or point-free passing (`xs.map(name)`). Found by the mutation drill:
 *     an alias-imported rogue call sailed past the first name-only scan.
 */
export function findImportLaundering(source: string, file: string): string[] {
  const { noComments, structural } = tokenise(source);
  const violations: string[] = [];

  // `\s+as\b` (NOT `as \w+`): flag ANY alias regardless of the alias
  // identifier. A `$`- or Unicode-prefixed alias (`… as $ids`) has no leading
  // \w, so the old `as \w+` form matched nothing and the alias sailed through
  // (review blocker). The only legitimate appearance of the name followed by
  // `as` is an alias import/export, which is exactly what we forbid.
  if (new RegExp(`${AUTHORITY_FUNCTION}\\s+as\\b`).test(structural)) {
    violations.push(
      `${file} — aliases ${AUTHORITY_FUNCTION} (\`… as <alias>\`), which would launder authority calls past ` +
        `the call-site scan. Import and call it by its real name only.`,
    );
  }
  // Module-path rules match on the noComments view: string contents are
  // blanked in the structural view, so the import path itself lives only in
  // noComments (where comments are gone, so a commented-out import cannot fire).
  if (/import\s*\*\s*as\s+\w+\s+from\s+['"][^'"]*intervention-controlled-drivers(?:\.js)?['"]/.test(noComments)) {
    violations.push(
      `${file} — namespace-imports the authority module, which would hide authority calls behind a namespace. ` +
        `Use a direct named import of ${AUTHORITY_FUNCTION}.`,
    );
  }
  // All quote forms INCLUDING BACKTICK: a dynamic import can take a template
  // literal (`import(`…`)`) — the string-only class missed it, and a backtick
  // dynamic import plus computed access (`mod[`collect…`](g)`) then bypassed
  // every rule (review blocker). Static `import * as … from` cannot use a
  // template literal per spec, so the namespace rule above stays string-only.
  if (/(?:\bimport\s*\(|\brequire\s*\()\s*[`'"][^`'"]*intervention-controlled-drivers/.test(noComments)) {
    violations.push(
      `${file} — dynamically imports the authority module, which the static scan cannot follow. ` +
        `Use a direct named import of ${AUTHORITY_FUNCTION}.`,
    );
  }

  // Bare-reference rule: every structural occurrence of the name must be a
  // direct call or sit inside a static named-import clause.
  const importRanges: Array<{ start: number; end: number }> = [];
  const importPattern = /import\s+(?:type\s+)?{[^}]*}\s*from\s*[^;\n]+;?/g;
  let im: RegExpExecArray | null;
  while ((im = importPattern.exec(structural)) !== null) {
    importRanges.push({ start: im.index, end: im.index + im[0].length });
  }
  const namePattern = new RegExp(`\\b${AUTHORITY_FUNCTION}\\b`, 'g');
  let nm: RegExpExecArray | null;
  while ((nm = namePattern.exec(structural)) !== null) {
    const after = structural.slice(nm.index + AUTHORITY_FUNCTION.length);
    if (/^\s*\(/.test(after)) continue; // direct call — the call-site scan owns it
    const inImport = importRanges.some((r) => nm!.index >= r.start && nm!.index < r.end);
    if (inImport) continue; // sanctioned direct named import
    const declBefore = structural.slice(Math.max(0, nm.index - 20), nm.index);
    if (/function\s+$/.test(declBefore)) continue; // the defining declaration
    violations.push(
      `${file}:${lineOf(structural, nm.index)} — bare reference to ${AUTHORITY_FUNCTION} (rebinding or ` +
        `point-free use), which would launder authority calls past the call-site scan. Call it directly.`,
    );
  }
  return violations;
}

/**
 * Production filename filter. Excludes tests, declaration files, and the
 * editor/sync duplicate junk this repo actively defends against elsewhere
 * (the .gitignore "star space 2 dot star" rule and the matching tsconfig
 * exclude) — a stray `turn-executor 2.ts` on a developer machine must not
 * RED the gate as a rogue site.
 */
export function isScannableFile(name: string): boolean {
  if (!/\.(?:ts|tsx|mts|cts)$/.test(name)) return false;
  if (/\.(?:test|spec)\.(?:ts|tsx|mts|cts)$/.test(name)) return false;
  if (name.endsWith('.d.ts')) return false;
  if (/ \d+\.(?:ts|tsx|mts|cts)$/.test(name)) return false; // sync junk
  return true;
}

/** Recursively list production TS files under src (tests + the defining module excluded). */
export function walkProductionFiles(srcRoot: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      const st = statSync(full);
      if (st.isDirectory()) {
        if (entry === '__tests__' || entry === '__mocks__' || entry === 'node_modules') continue;
        walk(full);
        continue;
      }
      if (!isScannableFile(entry)) continue;
      const rel = relative(srcRoot, full).split(sep).join('/');
      if (rel === DEFINING_MODULE) continue;
      out.push(full);
    }
  };
  walk(srcRoot);
  return out;
}

/** Classify one file's sites against the allowlist. Pure. */
export function classifySites(sites: readonly AuthorityCallSite[]): string[] {
  const violations: string[] = [];
  for (const site of sites) {
    const entry = AUTHORITY_ALLOWLIST[site.file];
    if (entry === undefined) {
      violations.push(
        `${site.file}:${site.line} — NEW call site of ${AUTHORITY_FUNCTION} in a file not on the allowlist ` +
          `(arg: \`${site.argText}\`). Derive the controlled-factor set from the saved model and extend the ` +
          `reviewed allowlist in controlled-factor-authority.scan.ts.`,
      );
      continue;
    }
    if (!entry.allowedArgs.includes(site.argText)) {
      violations.push(
        `${site.file}:${site.line} — authority argument \`${site.argText}\` is not an allowlisted ` +
          `persisted-first form for this file. Allowed: ${entry.allowedArgs.map((a) => `\`${a}\``).join(' | ')}.`,
      );
    }
  }
  return violations;
}

/** Scan the whole src tree: extract, classify, and enforce per-file counts. */
export function scanRepository(srcRoot: string): ScanResult {
  const sites: AuthorityCallSite[] = [];
  const violations: string[] = [];
  for (const file of walkProductionFiles(srcRoot)) {
    const rel = relative(srcRoot, file).split(sep).join('/');
    const source = readFileSync(file, 'utf-8');
    // Cheap pre-filter: the scanners can only ever flag content that literally
    // names the function or the defining module (measured: halves the gate's
    // regex cost across ~740 files; 6 files survive the filter today).
    if (!source.includes(AUTHORITY_FUNCTION) && !source.includes('intervention-controlled-drivers')) {
      continue;
    }
    sites.push(...extractAuthorityCallSites(source, rel));
    violations.push(...findImportLaundering(source, rel));
  }
  violations.push(...classifySites(sites));

  const perFile = new Map<string, number>();
  for (const s of sites) perFile.set(s.file, (perFile.get(s.file) ?? 0) + 1);
  for (const [file, entry] of Object.entries(AUTHORITY_ALLOWLIST)) {
    const found = perFile.get(file) ?? 0;
    if (found !== entry.count) {
      violations.push(
        `${file} — expected exactly ${entry.count} authority call site(s), found ${found}. A site was added, ` +
          `removed, or moved: re-verify the persisted-first posture and update the reviewed allowlist.`,
      );
    }
  }
  return { sites, violations };
}
