/**
 * PAIRED EVAL — BUILD THE PROMPT ARMS FROM THEIR SOURCES, NEVER RETYPED.
 *
 *   M  = the served Agent instructions at CEE 57f903c (full mode), exactly as the route sends them.
 *   C1 = M with the AI-quality v2 copy corrections TRANSPOSED onto the served entries.
 *   C2 = C1, with Interpreter v0.3 (PR #1791 head 967d25f5) in place of v0.2 on fast path 3 only.
 *
 * How each text is obtained (no string in an arm is typed by hand):
 *   - M: the route source is read with `git show <SERVED_SHA>:src/routes/agent-v1-turn.ts`, the four
 *     declarations are located in its TypeScript AST, transpiled, and EVALUATED in a sandbox with
 *     `config.proxy.agentLanePreview = false` (the served full mode), so the real conditional picks the
 *     real MUTATION_INSTRUCTION and the real `.join(' ')` builds the string.
 *   - C1: each replacement sentence is the EVALUATED `+` string literal from the v2 patch
 *     (sources/ai-quality-copy-correction.v2.patch, sha256 pinned below), placed at the served entry
 *     that carries the same intent. Every v2 hunk is either transposed or explicitly listed as not
 *     transposed, with the reason — an unclaimed hunk throws.
 *   - v0.3: the `instructions` template literal of ANALYSIS_INTERPRETER_V03, evaluated from
 *     sources/analysis-interpreter-v03.ts, whose git blob id is pinned to the PR head's blob.
 *
 * Outputs are write-once: an existing file with different content is a hard error, never overwritten.
 *
 * Run:  npx tsx tools/agent-reply-eval/paired/build-arms.ts
 * No network, no provider calls.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

export const SERVED_SHA = '57f903c4652783a9de1a3778d6682a8e5f8414e1';
export const SERVED_ROUTE_PATH = 'src/routes/agent-v1-turn.ts';
export const V03_PR = 1791;
export const V03_HEAD = '967d25f553fb53327df430887a67d9276a7d5562';
export const V03_REPO_PATH = 'src/orchestrator-v5/agent-lane/prompt-profiles/analysis-interpreter-v03.ts';
export const V03_BLOB = 'cdcbd9b75862e2b17e84f9c84a51274a9821601b';
export const V2_PATCH_ORIGIN = '~/olumi-ai-quality-20260924/ai-quality-copy-correction.v2.patch (posted to Runtime on #63, comment 5820720737)';
export const V2_PATCH_SHA256 = '7bdce98711eb6bedcd96de1395d1dab5af1c652a76bdb9ed375da1235564ed58';
export const V02_SHA256_PREFIX = '3d979e84';

for (const [name, v] of [['SERVED_SHA', SERVED_SHA], ['V03_HEAD', V03_HEAD], ['V03_BLOB', V03_BLOB]] as const) {
  if (!/^[0-9a-f]{40}$/.test(v)) throw new Error(`${name} must be a 40-hex id, got ${v.length} chars`);
}
if (!/^[0-9a-f]{64}$/.test(V2_PATCH_SHA256)) throw new Error('V2_PATCH_SHA256 must be 64 hex');

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const ARMS_DIR = join(REPO_ROOT, 'Docs', 'evals', 'agent-reply', 'paired', '57f903c', 'arms');
export const SOURCES_DIR = join(ARMS_DIR, 'sources');

export const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');
export const gitBlobId = (buf: Buffer): string =>
  createHash('sha1').update(Buffer.concat([Buffer.from(`blob ${buf.length}\0`), buf])).digest('hex');

/** Transpile a TypeScript snippet and evaluate it in an empty sandbox; returns a plain (JSON) copy. */
function evaluateTs(snippet: string): unknown {
  const js = ts.transpileModule(snippet, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  const value = vm.runInNewContext(js, {}, { timeout: 5_000 });
  return JSON.parse(JSON.stringify(value));
}

// ─────────────────────────────────────────────────────────────── M: the served text

export type ServedEntry = { index: number; kind: 'literal' | 'MUTATION_INSTRUCTION'; text: string };
export type ServedPrompts = {
  mode: 'full' | 'preview';
  entries: ServedEntry[];
  agent: string;
  mutation: string;
  interpretOnly: string;
  v02: string;
};

const SERVED_DECLS = ['MUTATION_INSTRUCTION', 'AGENT_INSTRUCTIONS', 'INTERPRET_ONLY_CONSTRAINT', 'INTERPRETER_V02_BANKED'] as const;

/**
 * Evaluate the served instruction declarations from the route source. `mode` sets the ONE input the
 * source reads (`config.proxy.agentLanePreview`); the served staging route runs in full mode.
 */
export function evaluateServedPrompts(source: string, mode: 'full' | 'preview' = 'full'): ServedPrompts {
  const sf = ts.createSourceFile('agent-v1-turn.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  const found = new Map<string, { st: ts.VariableStatement; decl: ts.VariableDeclaration }>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const decl of st.declarationList.declarations) {
      if (!ts.isIdentifier(decl.name) || !(SERVED_DECLS as readonly string[]).includes(decl.name.text)) continue;
      if (found.has(decl.name.text)) throw new Error(`${decl.name.text} is declared more than once at top level`);
      if (st.declarationList.declarations.length !== 1) throw new Error(`${decl.name.text} shares its statement`);
      found.set(decl.name.text, { st, decl });
    }
  }
  for (const n of SERVED_DECLS) if (!found.has(n)) throw new Error(`${n} not found in ${SERVED_ROUTE_PATH}`);

  const mut = found.get('MUTATION_INSTRUCTION')!.decl.initializer;
  if (mut === undefined || !ts.isConditionalExpression(mut) || mut.condition.getText() !== 'config.proxy.agentLanePreview === true') {
    throw new Error('MUTATION_INSTRUCTION is no longer `config.proxy.agentLanePreview === true ? … : …` — the mode stub would not bind');
  }
  const agentInit = found.get('AGENT_INSTRUCTIONS')!.decl.initializer;
  if (agentInit === undefined || !ts.isCallExpression(agentInit) || !ts.isPropertyAccessExpression(agentInit.expression)
    || agentInit.expression.name.text !== 'join' || !ts.isArrayLiteralExpression(agentInit.expression.expression)
    || agentInit.arguments.length !== 1 || !ts.isStringLiteral(agentInit.arguments[0]!) || agentInit.arguments[0]!.text !== ' ') {
    throw new Error("AGENT_INSTRUCTIONS is no longer `[ … ].join(' ')`");
  }
  const array = agentInit.expression.expression;
  const kinds: ServedEntry['kind'][] = array.elements.map((el, i) => {
    if (ts.isStringLiteral(el) || ts.isNoSubstitutionTemplateLiteral(el)) return 'literal';
    if (ts.isIdentifier(el) && el.text === 'MUTATION_INSTRUCTION') return 'MUTATION_INSTRUCTION';
    throw new Error(`AGENT_INSTRUCTIONS element ${i} is neither a string literal nor MUTATION_INSTRUCTION: ${el.getText().slice(0, 80)}`);
  });

  const declText = (n: string): string => `${found.get(n)!.st.declarationList.getText()};`;
  const snippet = [
    `const config = { proxy: { agentLanePreview: ${mode === 'preview' ? 'true' : 'false'} } };`,
    declText('MUTATION_INSTRUCTION'),
    `const __ENTRIES = ${array.getText()};`,
    declText('AGENT_INSTRUCTIONS'),
    declText('INTERPRET_ONLY_CONSTRAINT'),
    declText('INTERPRETER_V02_BANKED'),
    '({ entries: __ENTRIES, agent: AGENT_INSTRUCTIONS, mutation: MUTATION_INSTRUCTION, interpretOnly: INTERPRET_ONLY_CONSTRAINT, v02: INTERPRETER_V02_BANKED })',
  ].join('\n');
  const v = evaluateTs(snippet) as { entries: string[]; agent: string; mutation: string; interpretOnly: string; v02: string };
  if (v.entries.length !== kinds.length) throw new Error('entry count changed in evaluation');
  if (v.entries.join(' ') !== v.agent) throw new Error("evaluated entries do not join to AGENT_INSTRUCTIONS");
  for (const k of ['agent', 'mutation', 'interpretOnly', 'v02'] as const) {
    if (typeof v[k] !== 'string' || v[k].length === 0) throw new Error(`${k} evaluated to an empty or non-string value`);
  }
  return {
    mode,
    entries: v.entries.map((text, index) => ({ index, kind: kinds[index]!, text })),
    agent: v.agent,
    mutation: v.mutation,
    interpretOnly: v.interpretOnly,
    v02: v.v02,
  };
}

// ─────────────────────────────────────────────────────────────── the v2 patch

export type V2Hunk = { hunk: string; minus: string; plus: string };

/** Every changed line of the v2 patch, paired `-`/`+`, each EVALUATED as the string literal it is. */
export function parseV2Patch(patch: string): V2Hunk[] {
  const out: V2Hunk[] = [];
  let hunk = '';
  let minus: string | undefined;
  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) { hunk = line; continue; }
    if (line.startsWith('---') || line.startsWith('+++')) continue;
    if (!line.startsWith('-') && !line.startsWith('+')) continue;
    const m = /^([-+]) {2}('.*'),$/.exec(line);
    if (m === null) throw new Error(`v2 patch changes a line that is not one string-literal entry: ${line.slice(0, 100)}`);
    const text = evaluateTs(`(${m[2]})`);
    if (typeof text !== 'string') throw new Error('v2 literal did not evaluate to a string');
    if (m[1] === '-') {
      if (minus !== undefined) throw new Error('two `-` lines without a `+` between them');
      minus = text;
    } else {
      if (minus === undefined) throw new Error('`+` line without a preceding `-` line');
      out.push({ hunk, minus, plus: text });
      minus = undefined;
    }
  }
  if (minus !== undefined) throw new Error('trailing `-` line with no `+`');
  return out;
}

// ─────────────────────────────────────────────────────────────── C1: the transposition

/**
 * `same-entry`: the served entry is byte-identical to the entry v2 replaced in PR-B, so the v2 sentence
 * replaces it exactly as v2 does. `served-equivalent`: the served entry differs from PR-B's, so the v2
 * sentence is placed at the served entry that carries the same instruction.
 */
export const TRANSPOSITIONS = [
  {
    id: 'a-receipts',
    relation: 'same-entry',
    intent: 'The server states saved / refused / already-applied and the version beneath the reply, so the model does not restate it; already_applied → never re-offer; refused → say only what happens next.',
    servedStartsWith: 'When authorise_change returns `receipts`',
    v2PlusStartsWith: 'Olumi states beneath your reply whether authorise_change',
  },
  {
    id: 'b-no-run-after-authorise',
    relation: 'served-equivalent',
    intent: 'Do NOT run in the same turn as an approval and do not promise a run; say what the model still needs; Olumi offers the Run itself when possible; run only when asked.',
    servedStartsWith: 'After authorise_change applies values or option levels, call run_analysis in the SAME turn',
    v2PlusStartsWith: 'After authorise_change applies a change, do NOT call run_analysis in the same turn',
  },
  {
    id: 'c-reporting',
    relation: 'served-equivalent',
    intent: 'A finding, not a recommendation; never winner/best/recommended; a leader is named ONLY when the reported result carries claim_permissions.leader_may_be_named: true, never from get_canonical_state; otherwise no name, rank or win-% ranking, and say why; sensitivity only when reported, with provenance; fragile/near tie → the uncertainty is the finding.',
    servedStartsWith: 'When you report an analysis',
    v2PlusStartsWith: 'When you report an analysis',
  },
  {
    id: 'd-revision',
    relation: 'same-entry',
    intent: 'No restated save; the stale-analysis warning in a sentence of its own; stop; offer a re-run.',
    servedStartsWith: 'When the user asks to change an assumption after an analysis',
    v2PlusStartsWith: 'When the user asks to change an assumption after an analysis',
  },
  {
    id: 'e-style',
    relation: 'same-entry',
    intent: 'Lead sentence + up to three bullets; about 90 words by default; keep a decisive caveat; one supported next move; at most one question; no repetition; no unannounced control.',
    servedStartsWith: 'British English.',
    v2PlusStartsWith: 'British English.',
  },
] as const;

export const NOT_TRANSPOSED = [
  {
    id: 'first-analysis',
    v2MinusStartsWith: 'After build_model_from_brief, never call run_analysis on the same turn: Olumi runs the first analysis itself',
    reason: 'Served 57f903c has no first_analysis: the build turn runs no analysis, and the served build entry says so ("After build_model_from_brief, do NOT call run_analysis on the same turn. A newly built model has no values yet …"). The v2 change to this entry only governs how a first_analysis result is narrated, so it has no served equivalent. The served build entry is kept unchanged in C1 and C2.',
  },
] as const;

export type TranspositionRecord = {
  id: string;
  relation: 'same-entry' | 'served-equivalent';
  intent: string;
  served_index: number;
  before_served: string;
  before_pr_b: string;
  after: string;
  v2_hunk: string;
};

export function buildC1(served: ServedPrompts, hunks: V2Hunk[]): { entries: ServedEntry[]; records: TranspositionRecord[] } {
  const claimed = new Set<number>();
  const entries = served.entries.map((e) => ({ ...e }));
  const records: TranspositionRecord[] = [];
  for (const t of TRANSPOSITIONS) {
    const at = served.entries.filter((e) => e.text.startsWith(t.servedStartsWith));
    if (at.length !== 1) throw new Error(`${t.id}: ${at.length} served entries start with ${JSON.stringify(t.servedStartsWith)} (need exactly 1)`);
    const hs = hunks.map((h, i) => ({ h, i })).filter(({ h }) => h.plus.startsWith(t.v2PlusStartsWith));
    if (hs.length !== 1) throw new Error(`${t.id}: ${hs.length} v2 '+' lines start with ${JSON.stringify(t.v2PlusStartsWith)} (need exactly 1)`);
    const { h, i } = hs[0]!;
    if (claimed.has(i)) throw new Error(`${t.id}: v2 hunk ${i} claimed twice`);
    claimed.add(i);
    const e = at[0]!;
    if (e.kind !== 'literal') throw new Error(`${t.id}: would replace a non-literal entry`);
    if (t.relation === 'same-entry' && e.text !== h.minus) throw new Error(`${t.id}: declared same-entry but the served entry differs from PR-B's`);
    if (t.relation === 'served-equivalent' && e.text === h.minus) throw new Error(`${t.id}: declared served-equivalent but the served entry IS PR-B's — reclassify`);
    if (records.some((r) => r.served_index === e.index)) throw new Error(`${t.id}: served entry ${e.index} replaced twice`);
    entries[e.index] = { index: e.index, kind: 'literal', text: h.plus };
    records.push({ id: t.id, relation: t.relation, intent: t.intent, served_index: e.index, before_served: e.text, before_pr_b: h.minus, after: h.plus, v2_hunk: h.hunk });
  }
  for (const n of NOT_TRANSPOSED) {
    const hs = hunks.map((h, i) => ({ h, i })).filter(({ h }) => h.minus.startsWith(n.v2MinusStartsWith));
    if (hs.length !== 1) throw new Error(`${n.id}: ${hs.length} v2 '-' lines match (need exactly 1)`);
    if (claimed.has(hs[0]!.i)) throw new Error(`${n.id}: hunk already transposed`);
    claimed.add(hs[0]!.i);
    if (served.entries.some((e) => e.text === hs[0]!.h.minus)) throw new Error(`${n.id}: PR-B's entry IS served — it should be transposed`);
  }
  if (claimed.size !== hunks.length) throw new Error(`v2 has ${hunks.length} hunks but only ${claimed.size} are transposed or explained`);
  const c1 = entries.map((e) => e.text).join(' ');
  for (const banned of ['how firmly', 'call run_analysis in the SAME turn']) {
    if (c1.includes(banned)) throw new Error(`C1 still contains ${JSON.stringify(banned)}`);
  }
  return { entries, records: records.sort((a, b) => a.served_index - b.served_index) };
}

// ─────────────────────────────────────────────────────────────── v0.3

export function evaluateV03Profile(source: string): { id: string; version: string; instructions: string } {
  const sf = ts.createSourceFile('analysis-interpreter-v03.ts', source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS);
  let obj: ts.ObjectLiteralExpression | undefined;
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st)) continue;
    for (const d of st.declarationList.declarations) {
      if (!ts.isIdentifier(d.name) || d.name.text !== 'ANALYSIS_INTERPRETER_V03') continue;
      const init = d.initializer;
      if (init === undefined || !ts.isCallExpression(init) || init.expression.getText() !== 'Object.freeze'
        || init.arguments.length !== 1 || !ts.isObjectLiteralExpression(init.arguments[0]!)) {
        throw new Error('ANALYSIS_INTERPRETER_V03 is no longer Object.freeze({ … })');
      }
      obj = init.arguments[0] as ts.ObjectLiteralExpression;
    }
  }
  if (obj === undefined) throw new Error('ANALYSIS_INTERPRETER_V03 not found');
  const prop = (name: string): ts.Expression => {
    const p = obj!.properties.find((x) => ts.isPropertyAssignment(x) && ts.isIdentifier(x.name) && x.name.text === name);
    if (p === undefined || !ts.isPropertyAssignment(p)) throw new Error(`ANALYSIS_INTERPRETER_V03.${name} missing`);
    return p.initializer;
  };
  const ins = prop('instructions');
  if (!ts.isNoSubstitutionTemplateLiteral(ins)) throw new Error('v0.3 instructions is not a substitution-free template literal');
  const v = evaluateTs(`({ id: ${prop('id').getText()}, version: ${prop('version').getText()}, instructions: ${ins.getText()} })`) as {
    id: string; version: string; instructions: string;
  };
  return v;
}

// ─────────────────────────────────────────────────────────────── stacks and outputs

/** Fast path 3's instructions exactly as the served route composes them (agent-v1-turn.ts, the Run call). */
export const fp3Stack = (agent: string, interpretOnly: string, profile: string): string =>
  `${agent}\n\n${interpretOnly}\n\n${profile}`;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

/** Files and total occurrences of `term` under src/ at the served commit (git grep; exit 1 = none). */
function servedGrep(term: string): { term: string; files: number; occurrences: number } {
  let out = '';
  try { out = git(['grep', '-a', '-c', '-F', term, SERVED_SHA, '--', 'src']); }
  catch (err) { if ((err as { status?: number }).status !== 1) throw err; }
  const rows = out.split('\n').filter((l) => l.length > 0);
  return { term, files: rows.length, occurrences: rows.reduce((s, l) => s + Number(l.slice(l.lastIndexOf(':') + 1)), 0) };
}

type Written = { file: string; sha256: string; bytes: number; status: 'written' | 'unchanged' };

/** Write-once: identical content is left alone; different content is refused. Adds `<file>.sha256`. */
function writeOnce(file: string, content: string): Written {
  const path = join(ARMS_DIR, file);
  const buf = Buffer.from(content, 'utf8');
  const hex = sha256(buf);
  const shaLine = `${hex}  ${file}\n`;
  let status: Written['status'] = 'written';
  for (const [p, body] of [[path, buf], [`${path}.sha256`, Buffer.from(shaLine, 'utf8')]] as const) {
    if (existsSync(p)) {
      if (!readFileSync(p).equals(body)) throw new Error(`refusing to overwrite ${p}: existing content differs (outputs are write-once)`);
      status = 'unchanged';
    } else {
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, body, { flag: 'wx' });
    }
  }
  return { file, sha256: hex, bytes: buf.length, status };
}

export type BuiltArms = {
  served: ServedPrompts;
  c1: { entries: ServedEntry[]; records: TranspositionRecord[]; agent: string };
  v03: { id: string; version: string; instructions: string };
  texts: Record<string, string>;
  sources: Record<string, unknown>;
};

/** Everything, computed in memory from the pinned sources. No writes. */
export function computeArms(): BuiltArms {
  git(['cat-file', '-e', `${SERVED_SHA}^{commit}`]);
  const routeSource = git(['show', `${SERVED_SHA}:${SERVED_ROUTE_PATH}`]);
  const routeBlob = git(['rev-parse', `${SERVED_SHA}:${SERVED_ROUTE_PATH}`]).trim();

  const patchBuf = readFileSync(join(SOURCES_DIR, 'ai-quality-copy-correction.v2.patch'));
  if (sha256(patchBuf) !== V2_PATCH_SHA256) throw new Error('sources/ai-quality-copy-correction.v2.patch does not match its pinned sha256');
  const v03Buf = readFileSync(join(SOURCES_DIR, 'analysis-interpreter-v03.ts'));
  if (gitBlobId(v03Buf) !== V03_BLOB) throw new Error('sources/analysis-interpreter-v03.ts is not the PR head blob');

  const served = evaluateServedPrompts(routeSource, 'full');
  if (!sha256(served.v02).startsWith(V02_SHA256_PREFIX)) throw new Error(`v0.2 sha256 does not start ${V02_SHA256_PREFIX}`);
  const hunks = parseV2Patch(patchBuf.toString('utf8'));
  const c1 = buildC1(served, hunks);
  const c1Agent = c1.entries.map((e) => e.text).join(' ');
  const v03 = evaluateV03Profile(v03Buf.toString('utf8'));

  const texts: Record<string, string> = {
    'M_agent.txt': served.agent,
    'M_interpret_only.txt': served.interpretOnly,
    'M_v02.txt': served.v02,
    'C1_agent.txt': c1Agent,
    'C2_v03.txt': v03.instructions,
    'M_fp3_stack.txt': fp3Stack(served.agent, served.interpretOnly, served.v02),
    'C1_fp3_stack.txt': fp3Stack(c1Agent, served.interpretOnly, served.v02),
    'C2_fp3_stack.txt': fp3Stack(c1Agent, served.interpretOnly, v03.instructions),
  };
  return {
    served,
    c1: { ...c1, agent: c1Agent },
    v03,
    texts,
    sources: {
      served_route: { repo: 'Talchain/olumi-assistants-service', commit: SERVED_SHA, path: SERVED_ROUTE_PATH, git_blob: routeBlob, mode: 'full (config.proxy.agentLanePreview=false)' },
      v2_patch: { file: 'sources/ai-quality-copy-correction.v2.patch', origin: V2_PATCH_ORIGIN, sha256: V2_PATCH_SHA256, against: 'Runtime PR-B text of src/routes/agent-v1-turn.ts (index 97c5039..937b192); PR-B is NOT served' },
      v03_profile: { file: 'sources/analysis-interpreter-v03.ts', repo: 'Talchain/olumi-assistants-service', pr: V03_PR, head: V03_HEAD, path: V03_REPO_PATH, git_blob: V03_BLOB, sha256: sha256(v03Buf), profile_id: v03.id, profile_version: v03.version },
    },
  };
}

function armsMarkdown(b: BuiltArms, files: Record<string, Written>, facts: ReturnType<typeof servedGrep>[]): string {
  const f = (n: string): string => `\`${n}\` (sha256 \`${files[n]!.sha256}\`, ${files[n]!.bytes} bytes)`;
  const block = (s: string): string => ['```text', s, '```'].join('\n');
  const L: string[] = [];
  L.push('# Paired eval — prompt arms at served CEE 57f903c', '');
  L.push('Generated by `tools/agent-reply-eval/paired/build-arms.ts` from pinned sources; no arm text is typed by hand.',
    'Regenerate: `npx tsx tools/agent-reply-eval/paired/build-arms.ts` (write-once: a differing existing file is refused).',
    'Proof: `tools/agent-reply-eval/paired/__tests__/build-arms.test.ts`.', '');
  L.push('## Arms', '', '| Arm | Ordinary Agent turn (construction, conversation) | Explicit Run (fast path 3, one call, `tool_choice: none`) |', '|---|---|---|');
  L.push(`| **M** (served) | ${f('M_agent.txt')} | ${f('M_fp3_stack.txt')} |`);
  L.push(`| **C1** (v2 copy corrections, transposed) | ${f('C1_agent.txt')} | ${f('C1_fp3_stack.txt')} (Interpreter v0.2) |`);
  L.push(`| **C2** (C1 + Interpreter v0.3) | ${f('C1_agent.txt')} — identical to C1 | ${f('C2_fp3_stack.txt')} |`, '');
  L.push('Parts: ' + ['M_interpret_only.txt', 'M_v02.txt', 'C2_v03.txt'].map(f).join(' · ') + '.', '');
  L.push('Stack rule (served route, fast path 3): `agent + "\\n\\n" + INTERPRET_ONLY_CONSTRAINT + "\\n\\n" + profile`, profile = v0.2 (M, C1) or v0.3 (C2).', '');
  L.push('A typed approval chip takes fast path 2 (`fast_path: "approve"` in both served captures), which composes its reply from the write result and makes no model call — no arm can change it.', '');
  L.push('Not varied by any arm: the construction call\'s `BUILD_INSTRUCTIONS` (`runtime/build-model.ts`), tools, model, `max_output_tokens`, and all server post-processing (write-outcome narration, disclosures, id stripping). An arm changes only the `instructions` string of the Agent conversation call and of the fast-path-3 call.', '');
  L.push('## Sources', '', '```json', JSON.stringify(b.sources, null, 2), '```', '');
  L.push('## Transpositions (C1 = M with exactly these entries replaced)', '');
  L.push(`M has ${b.served.entries.length} entries; C1 differs from M at served entry indices ${b.c1.records.map((r) => r.served_index).join(', ')} and nowhere else.`, '');
  for (const r of b.c1.records) {
    L.push(`### ${r.id} — served entry ${r.served_index} (${r.relation})`, '', `Intent: ${r.intent}`, '', `v2 hunk: \`${r.v2_hunk}\``, '');
    L.push('**Before (served 57f903c):**', '', block(r.before_served), '');
    if (r.relation === 'served-equivalent') L.push('**What v2 replaced in PR-B (differs from served; not used):**', '', block(r.before_pr_b), '');
    else L.push('_The served entry is byte-identical to the PR-B entry v2 replaced._', '');
    L.push('**After (C1, the v2 sentence verbatim):**', '', block(r.after), '');
  }
  L.push('## v2 hunks deliberately NOT transposed', '');
  for (const n of NOT_TRANSPOSED) L.push(`- **${n.id}** — ${n.reason}`);
  L.push('');
  L.push('## Known properties of the arms', '');
  const cp = facts.find((x) => x.term === 'claim_permissions')!;
  const lm = facts.find((x) => x.term === 'leader_may_be_named')!;
  const lc = facts.find((x) => x.term === 'leader_claim')!;
  L.push(`- **C1/C2 will never name a leader on served 57f903c inputs.** The C1 reporting entry names a leading option only when the reported result carries \`claim_permissions.leader_may_be_named: true\`. At the served commit, \`git grep -c -F\` over \`src/\` finds \`claim_permissions\` in ${cp.files} files (${cp.occurrences} occurrences) and \`leader_may_be_named\` in ${lm.files} files (${lm.occurrences}); contrast control \`leader_claim\` in ${lc.files} files (${lc.occurrences}). CEE therefore never composes the permission. ⚠ This grep does not exclude a field passed through untyped from PLoT (the \`z.record\` enrichment); the evidence that served results do not carry it is the served route captures themselves (measured 24 Sep on \`57f903c-hiring\` and \`57f903c-pricing\`: \`rg -a -c -F\` finds no line with \`claim_permissions\` or \`leader_may_be_named\` in any of the six construction/approve/explicit-run responses, and the contrast \`leader_claim\` on 1 line of each). On inputs of that shape C1 withholds a leader every time — including on a run whose \`leader_claim.permitted\` is true. This is a property of the arm, not a scoring outcome.`);
  L.push('- **C2 differs from C1 only on the explicit-Run call.** Construction, approval and conversation turns use `C1_agent.txt` in both.');
  L.push('- **The v2 sentences state server behaviour that exists at 57f903c:** the write-status line is composed by the server (`narrateWriteOutcome` / `withWriteOutcome` in `agent-v1-turn.ts`, `agent-lane/write-outcome.ts`), and the Run is offered by the server (`RUN_OFFER_CHIP`, `offerRun`).');
  L.push('- **M is the full-mode text.** The preview-mode `MUTATION_INSTRUCTION` gives a different string; the test proves the served route sends the full-mode one.', '');
  return L.join('\n');
}

export function main(): void {
  const b = computeArms();
  const files: Record<string, Written> = {};
  for (const [name, text] of Object.entries(b.texts)) files[name] = writeOnce(name, text);
  files['M_agent.entries.json'] = writeOnce('M_agent.entries.json', `${JSON.stringify(b.served.entries, null, 2)}\n`);
  files['C1_agent.entries.json'] = writeOnce('C1_agent.entries.json', `${JSON.stringify(b.c1.entries, null, 2)}\n`);
  files['TRANSPOSITIONS.json'] = writeOnce('TRANSPOSITIONS.json', `${JSON.stringify({ transposed: b.c1.records, not_transposed: NOT_TRANSPOSED }, null, 2)}\n`);
  const facts = ['claim_permissions', 'leader_may_be_named', 'leader_claim'].map(servedGrep);
  const manifest = {
    generated_by: 'tools/agent-reply-eval/paired/build-arms.ts',
    served_sha: SERVED_SHA,
    sources: b.sources,
    arms: {
      M: { agent: 'M_agent.txt', fp3: 'M_fp3_stack.txt', profile: 'M_v02.txt' },
      C1: { agent: 'C1_agent.txt', fp3: 'C1_fp3_stack.txt', profile: 'M_v02.txt' },
      C2: { agent: 'C1_agent.txt', fp3: 'C2_fp3_stack.txt', profile: 'C2_v03.txt' },
    },
    files: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, { sha256: v.sha256, bytes: v.bytes }])),
    served_grep_at_served_sha: facts,
  };
  files['arms.json'] = writeOnce('arms.json', `${JSON.stringify(manifest, null, 2)}\n`);
  const md = armsMarkdown(b, files, facts);
  const mdPath = join(ARMS_DIR, 'ARMS.md');
  if (existsSync(mdPath) && readFileSync(mdPath, 'utf8') !== md) throw new Error(`refusing to overwrite ${mdPath}: content differs`);
  if (!existsSync(mdPath)) writeFileSync(mdPath, md, { flag: 'wx' });
  for (const w of Object.values(files)) process.stdout.write(`${w.status.padEnd(9)} ${w.sha256}  ${w.bytes.toString().padStart(6)}  ${basename(w.file)}\n`);
  process.stdout.write(`ARMS.md   ${sha256(md)}\n`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
