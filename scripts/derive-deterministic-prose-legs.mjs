#!/usr/bin/env node
/**
 * DERIVE (never mirror) the deterministic prose legs — every place CEE can put
 * a sentence in front of a user WITHOUT an LLM authoring it.
 *
 * ── WHY THIS IS A SCRIPT AND NOT A DOCUMENT ────────────────────────────────
 * The 3 Sep 2026 manual capture (`olumi-programme-docs`
 * `artefacts/manual-test-2026-09-03/`) put four false or useless sentences in
 * front of the user in thirty minutes, and every one of them sat on a
 * deterministic leg. The obvious response is an inventory page. This estate's
 * dominant defect is the hand-maintained mirror: a list a human must remember
 * to sync WILL drift, and the drift always reads green (CLAUDE.md trap 12).
 * So the inventory is DERIVED on demand from the source tree and never
 * written down.
 *
 * ── WHAT IT CLAIMS, PRECISELY — AND IT IS WRONG IN BOTH DIRECTIONS ─────────
 * This is a SCAN, not an enumeration, and saying so is the point. "Is this
 * string user-facing prose?" is a predicate over natural language, and no
 * pattern-only rule settles such a question (CLAUDE.md trap 22f) — so the
 * honest report names both error directions rather than implying a floor:
 *
 *   OVER-counts  internal sentence-shaped strings that never reach a user
 *                (e.g. `option-effect-write.ts`'s `reason:` fields, which are
 *                English prose written for the NEXT ENGINEER).
 *   UNDER-counts prose assembled from fragments shorter than the sentence
 *                test, and anything a caller concatenates at a distance.
 *
 * What it DOES support: a re-derivable RANKING of which modules carry the
 * most deterministic sentence weight, and a stable way to ask "did this
 * module grow a new one?" without a human keeping a list. The total is a
 * scan figure; do not quote it as an inventory count.
 *
 * ── THE CONTROLS, AND WHY THERE ARE THREE ──────────────────────────────────
 * An absence/inventory probe with no positive control is vacuous (trap 13),
 * and a control that merely FIRES can still be lossy enough to manufacture a
 * wrong answer (trap 13e) — so the positive control asserts a MAGNITUDE, not
 * a sign, and a CONTRAST control asserts a same-family module reads ZERO.
 *
 *   POSITIVE   compose/validation-failure-responses.ts  >= 10 legs
 *              (the per-code refusal composer; it is nothing but prose)
 *   CONTRAST   compose/types.ts                          == 0 legs
 *              (same directory, same file extension, pure types — if this
 *               reads non-zero the prose predicate is over-firing)
 *   BLINDNESS  the extractor must NOT return a sentence that exists only
 *              inside a comment. Asserted against a known comment sentence.
 *
 * Any control failing exits 2. A green run with a failed control is exactly
 * the "instrument that cannot fail" this estate keeps shipping.
 *
 * Usage:
 *   node scripts/derive-deterministic-prose-legs.mjs            # summary
 *   node scripts/derive-deterministic-prose-legs.mjs --full     # every leg
 *   node scripts/derive-deterministic-prose-legs.mjs --json
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { tokenise } from './ci/strip-source-comments.mjs';

const ROOT = process.cwd();

/**
 * The roots that can reach `assistant_text` or a block's prose field.
 * `src/prompts/**` is deliberately EXCLUDED: its strings are model
 * directives, not user copy — a different question under a similar shape.
 */
const SCAN_ROOTS = [
  'src/orchestrator-v5/compose',
  'src/orchestrator-v5/routing',
  'src/orchestrator-v5/coaching',
  'src/orchestrator-v5/handlers',
  'src/orchestrator-v5/tools/handlers',
  'src/orchestrator-v5/system-events',
  'src/orchestrator-v5/clarify-v2',
  'src/orchestrator-v5/graph-management',
  'src/orchestrator-v5/model-management',
];

/**
 * Modules inside the scan roots whose sentence-shaped literals are addressed
 * to the MODEL, not the user. Named individually with the reason, because a
 * blanket "skip anything that looks like a prompt" would silently hide real
 * user copy.
 */
const MODEL_DIRECTIVE_MODULES = new Map([
  [
    'src/orchestrator-v5/coaching/typed-intent-directive.ts',
    'method directives appended to the routing turn; never user-facing',
  ],
]);

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir).sort();
  } catch {
    // FAIL LOUD: a scan root that cannot be read must not read as "clean".
    console.error(`FATAL: scan root unreadable: ${dir}`);
    process.exit(2);
  }
  for (const entry of entries) {
    if (entry === 'node_modules' || entry === '__tests__' || entry === '__fixtures__') continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts') && !entry.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * String-literal contents of a file, DERIVED from the repo's own ratified
 * tokeniser rather than a second regex: a position that survives in
 * `noComments` (comments blanked) but is blanked in `structural` (strings
 * blanked too) is inside a string literal. Template interpolations stay
 * visible as code in `structural`, so `${…}` cuts a template into segments —
 * which is what we want, because each segment is separately assertable prose.
 */
function stringLiteralSegments(source) {
  const { noComments, structural } = tokenise(source);
  const segments = [];
  let current = '';
  let startLine = 1;
  let line = 1;
  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    // A position holds STRING (or regex) content when the tokeniser blanked it
    // out of the `structural` view but kept it verbatim in `noComments`.
    // Comment bodies are blanked in BOTH views, so they can never satisfy this.
    const isContent = structural[i] !== ch && noComments[i] === ch;
    // Whitespace is blanked to itself in every view, so it is indistinguishable
    // on its own. It CONTINUES a run that content already opened, and starts
    // nothing — which is exactly the semantics a sentence needs.
    const isFiller = ch === ' ' || ch === '\t';
    if (isContent || (isFiller && current !== '')) {
      if (current === '') startLine = line;
      current += ch;
    } else if (current !== '') {
      segments.push({ text: current, line: startLine });
      current = '';
    }
    if (ch === '\n') line++;
  }
  if (current !== '') segments.push({ text: current, line: startLine });
  return segments;
}

/** Trim the run, then peel the surviving delimiters off both ends. */
function unquote(raw) {
  return raw.trim().replace(/^[`'"]+/, '').replace(/[`'"]+$/, '').trim();
}

const SENTENCE_END = /[.?!]\s*$/;
const HAS_LOWERCASE_WORD = /(^|\s)[a-z][a-z']{2,}(\s|[.,?!]|$)/;
const IDENTIFIER_ISH = /^[A-Za-z0-9_.\-/]+$/;
const CODE_MARKERS = /:\/\/|<\/?[a-z]+>|^\s*[#|]|\$\{?\s*$|^\s*[-*]\s*$/;

/**
 * Does this literal read as a sentence a user could be shown?
 *
 * DELIBERATELY CONSERVATIVE in the direction that under-counts. A
 * false POSITIVE here puts a non-sentence in an inventory (noise); a false
 * NEGATIVE hides a leg that can lie (harm). The script therefore reports the
 * result as a FLOOR and the contrast control catches over-firing.
 */
function looksLikeUserSentence(raw) {
  const s = unquote(raw);
  if (s.length < 20) return false;
  if (IDENTIFIER_ISH.test(s)) return false;
  if (CODE_MARKERS.test(s)) return false;
  if (s === s.toUpperCase()) return false;
  const words = s.split(/\s+/).filter(Boolean);
  if (words.length < 4) return false;
  if (!HAS_LOWERCASE_WORD.test(s)) return false;
  // A sentence either terminates, or is a leading clause that a later
  // concatenation terminates (`'I have not changed the model yet. Tell me '`).
  return SENTENCE_END.test(s) || words.length >= 6;
}

const files = SCAN_ROOTS.flatMap((r) => walk(join(ROOT, r)));

const legs = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, 'utf8');
  for (const { text, line } of stringLiteralSegments(source)) {
    if (!looksLikeUserSentence(text)) continue;
    const body = text.replace(/^['"`]|['"`]$/g, '');
    legs.push({
      file: rel,
      line,
      // A leg that INTERPOLATES binds its claim to a value it was handed: it
      // can be true of the wrong thing (trap 19). A leg that asserts a bare
      // state can be true of no thing at all. Different failure modes, so the
      // inventory keeps them apart rather than counting one total.
      shape: /\$\{|['"`]\s*\+|`$/.test(text) ? 'bound' : 'state',
      model_directive: MODEL_DIRECTIVE_MODULES.has(rel),
      text: body.length > 160 ? `${body.slice(0, 157)}...` : body,
    });
  }
}

const userFacing = legs.filter((l) => !l.model_directive);

// ── CONTROLS ───────────────────────────────────────────────────────────────
const POSITIVE = 'src/orchestrator-v5/compose/validation-failure-responses.ts';
const CONTRAST = 'src/orchestrator-v5/compose/types.ts';
const positiveCount = legs.filter((l) => l.file === POSITIVE).length;
const contrastCount = legs.filter((l) => l.file === CONTRAST).length;

// BLINDNESS control: this sentence exists ONLY inside a comment in the
// positive-control file. If the extractor returns it, comments are leaking in
// and every count above is inflated by prose that never reaches a user.
const COMMENT_ONLY_PHRASE = 'Entity IDs never appear in output';
const commentLeak = legs.some((l) => l.text.includes(COMMENT_ONLY_PHRASE));

const controls = [
  { name: 'POSITIVE  validation-failure-responses.ts >= 10', ok: positiveCount >= 10, measured: positiveCount },
  { name: 'CONTRAST  compose/types.ts == 0', ok: contrastCount === 0, measured: contrastCount },
  { name: 'BLINDNESS no comment-only sentence extracted', ok: !commentLeak, measured: commentLeak ? 'LEAKED' : 'clean' },
];

const byFile = new Map();
for (const leg of userFacing) {
  const e = byFile.get(leg.file) ?? { file: leg.file, state: 0, bound: 0 };
  e[leg.shape] += 1;
  byFile.set(leg.file, e);
}
const ranked = [...byFile.values()].sort((a, b) => b.state + b.bound - (a.state + a.bound));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ controls, legs: userFacing }, null, 2));
} else {
  console.log('DETERMINISTIC PROSE LEGS — derived scan (over- AND under-counts; see the docblock)');
  console.log(`scan roots      : ${SCAN_ROOTS.length}`);
  console.log(`files scanned   : ${files.length}`);
  console.log(`modules with legs: ${ranked.length}`);
  console.log(`sentence-shaped : ${userFacing.length}  [state-assertion ${userFacing.filter((l) => l.shape === 'state').length} | value-bound ${userFacing.filter((l) => l.shape === 'bound').length}]`);
  console.log(`excluded as model-directive modules: ${legs.length - userFacing.length} legs in ${MODEL_DIRECTIVE_MODULES.size} module(s)`);
  console.log('');
  console.log('CONTROLS');
  for (const c of controls) console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name}  (measured: ${c.measured})`);
  console.log('');
  const limit = process.argv.includes('--full') ? ranked.length : 25;
  console.log(`TOP ${Math.min(limit, ranked.length)} MODULES BY LEG COUNT`);
  for (const r of ranked.slice(0, limit)) {
    console.log(`  ${String(r.state + r.bound).padStart(4)}  (state ${String(r.state).padStart(3)} / bound ${String(r.bound).padStart(3)})  ${r.file}`);
  }
  if (process.argv.includes('--full')) {
    console.log('');
    console.log('EVERY LEG');
    for (const l of userFacing) console.log(`  ${l.file}:${l.line}  [${l.shape}]  ${l.text}`);
  }
}

if (controls.some((c) => !c.ok)) {
  console.error('\nFATAL: a control failed. The counts above are NOT evidence.');
  process.exit(2);
}
