/**
 * TASK D — score every paired run, on BOTH the raw model text and the SIMULATED FINAL VISIBLE REPLY,
 * then write RESULTS.md and the blinded reviewer pack.
 *
 *   npx tsx tools/agent-reply-eval/paired/score-paired.ts
 *
 * No network, no provider call, no src/ edit. Reads only:
 *   Docs/evals/agent-reply/paired/57f903c/runs/<case>/<arm>/rep-<k>.{request,response,meta}.json + .text.txt
 *   Docs/evals/agent-reply/paired/57f903c/shapes/<case>/<turn>/route-response.json (the state each reply was written against)
 * Writes (append-only; an existing file with different content is never overwritten):
 *   Docs/evals/agent-reply/paired/57f903c/scores/<stamp>-scores.json
 *   Docs/evals/agent-reply/paired/57f903c/RESULTS.md
 *   Docs/evals/agent-reply/paired/57f903c/blind/PACK.md and blind/KEY.json
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHECK_NAMES, type CheckName, type CheckResult } from '../src/checks.js';
import type { Domain, UserAction } from '../src/classify.js';
import { scoreView, type TurnScore } from '../src/score.js';
import { countsOf, splitServerText } from '../src/text.js';
import { viewOf } from '../src/wire.js';
import {
  checkLeaderHonestySplit,
  checkNextMove,
  checkProposalFigures,
  checkQuestionLimit,
  checkStructure,
  checkToolAction,
  checkUngroundedFigures,
  checkWinPctWhileWithheld,
  numbersOfJson,
  type ExtraCheck,
  type ExtraContext,
  type NextMove,
  type ProposedFigure,
} from './extra-checks.js';
import {
  ROUTE_LINES_MIRRORED,
  SERVED_HEAD,
  conversationToolsFromInput,
  fp3ToolsFromInput,
  functionCallsOf,
  simulateVisible,
  textOfOutput,
  type TurnTools,
} from './simulate-visible.js';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const sha256 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex');

export const REPO = fileURLToPath(new URL('../../..', import.meta.url));
export const BASE = join(REPO, 'Docs/evals/agent-reply/paired/57f903c');
const rel = (p: string): string => relative(REPO, p);
const readJson = (p: string): Rec => JSON.parse(readFileSync(p, 'utf8')) as Rec;

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

export type TurnType = 'construction' | 'fp3' | 'discussion';

export interface CaseSpec {
  readonly turn: TurnType;
  readonly domain: Domain;
  readonly userAction: UserAction;
  readonly nextApprovalRan: boolean | null;
  readonly nextApprovalBasis: string;
}

const APPROVE_WITNESS = (c: string) =>
  `witnessed: served 57f903c-${c} approve turn → _diagnostic_trace.fast_path 'approve', tool_calls [authorise_change], blocks [], analysis_state.run_state never_run, _provider_calls 0`;

export const CASES: Readonly<Record<string, CaseSpec>> = {
  'hiring-construction': { turn: 'construction', domain: 'hiring', userAction: 'brief', nextApprovalRan: false, nextApprovalBasis: APPROVE_WITNESS('hiring') },
  'pricing-construction': { turn: 'construction', domain: 'pricing', userAction: 'brief', nextApprovalRan: false, nextApprovalBasis: APPROVE_WITNESS('pricing') },
  'heldout-ed-triage-construction': {
    turn: 'construction', domain: 'heldout', userAction: 'brief', nextApprovalRan: false,
    nextApprovalBasis: 'INFERRED, not witnessed for this case: the same typed-approval fast path (agent-v1-turn.ts fast path 2) ran nothing on both served approvals (hiring, pricing)',
  },
  'pricing-run-complete': { turn: 'fp3', domain: 'pricing', userAction: 'run', nextApprovalRan: null, nextApprovalBasis: 'n/a (explicit Run)' },
  'hiring-run-blocked': { turn: 'fp3', domain: 'hiring', userAction: 'run', nextApprovalRan: null, nextApprovalBasis: 'n/a (explicit Run)' },
  'pricing-discussion-card': { turn: 'discussion', domain: 'pricing', userAction: 'other', nextApprovalRan: null, nextApprovalBasis: 'n/a (discussion card)' },
};

export const ARM_ORDER = ['M', 'C1', 'C2'] as const;

// ---------------------------------------------------------------------------
// One rep
// ---------------------------------------------------------------------------

export interface RepFiles { readonly dir: string; readonly rep: number }

export interface Scored {
  readonly words: number;
  readonly sentences: number;
  readonly bullets: number;
  readonly questions: number;
  readonly modelWords: number;
  readonly modelQuestions: number;
  readonly modelBullets: number;
  readonly cls: string;
  readonly checks: Record<CheckName, CheckResult>;
  readonly extras: readonly ExtraCheck[];
  readonly nextMoves: readonly NextMove[];
  readonly nextMoveTypes: readonly string[];
  /** Hard / soft violations whose finding sits in the MODEL's words (ranked). */
  readonly hardViolations: readonly string[];
  readonly softViolations: readonly string[];
  /** Scorer FAILs whose every finding sits in the SERVER's words (identical across arms; not ranked). */
  readonly serverOwnedFails: readonly string[];
  readonly proxyFails: readonly string[];
}

export interface RepResult {
  readonly case: string;
  readonly arm: string;
  readonly rep: number;
  readonly control: boolean;
  readonly schedule_index: number | null;
  readonly files: Readonly<Record<string, string>>;
  readonly response_sha256: string;
  readonly model: string | null;
  readonly settings: unknown;
  readonly wall_ms: number | null;
  readonly usage: { input_tokens: number | null; cached_tokens: number | null; output_tokens: number | null; reasoning_tokens: number | null; total_tokens: number | null };
  readonly function_calls: readonly string[];
  readonly raw_text: string;
  readonly raw_text_equals_text_txt: boolean;
  readonly visible_text: string | null;
  readonly simulation: { stripped: readonly string[]; status: string | null; not_adopted: string | null; owed: readonly string[]; split_model_text_equals_narration: boolean | null } | null;
  readonly raw: Scored | null;
  readonly visible: Scored | null;
}

const HARD_SCORER: readonly CheckName[] = CHECK_NAMES;

function scoredOf(ts: TurnScore, text: string, extras: readonly ExtraCheck[], moves: readonly NextMove[], types: readonly string[], modelText: string): Scored {
  const model = countsOf(modelText);
  const hard: string[] = [];
  const serverOwned: string[] = [];
  for (const k of HARD_SCORER) {
    const c = ts.checks[k];
    if (c.verdict !== 'FAIL') continue;
    if (c.findings.length === 0 || c.findings.some((f) => f.where === 'model')) hard.push(k);
    else serverOwned.push(k);
  }
  for (const e of extras) if (e.tier === 'hard' && e.verdict === 'FAIL') hard.push(e.name);
  const soft = extras.filter((e) => e.tier === 'soft' && e.verdict === 'FAIL').map((e) => e.name);
  const proxy = extras.filter((e) => e.tier === 'proxy' && e.verdict === 'FAIL').map((e) => e.name);
  const all = countsOf(text);
  return {
    words: all.words,
    sentences: all.sentences,
    bullets: all.bullets,
    questions: all.questions,
    modelWords: model.words,
    modelQuestions: model.questions,
    modelBullets: model.bullets,
    cls: ts.cls,
    checks: ts.checks,
    extras,
    nextMoves: moves,
    nextMoveTypes: types,
    hardViolations: hard,
    softViolations: soft,
    serverOwnedFails: serverOwned,
    proxyFails: proxy,
  };
}

export interface CaseContext {
  readonly spec: CaseSpec;
  readonly routeBody: Rec;
  readonly routeResponsePath: string;
}

export function loadCaseContext(caseId: string, capturedRequest: string): CaseContext {
  const spec = CASES[caseId];
  if (spec === undefined) throw new Error(`unknown case ${caseId}`);
  const routeResponsePath = join(REPO, dirname(capturedRequest), 'route-response.json');
  const routeBody = rec(readJson(routeResponsePath).body);
  if (routeBody === null) throw new Error(`no body in ${routeResponsePath}`);
  return { spec, routeBody, routeResponsePath };
}

/** Olumi's proposed figures: every ok propose_* result's assumptions and option levels. */
export function proposedFiguresOf(tools: TurnTools): ProposedFigure[] {
  const out: ProposedFigure[] = [];
  tools.toolCalls.forEach((c, i) => {
    if (!c.name.startsWith('propose_') || c.ok !== true) return;
    const r = rec(tools.toolResults[i]);
    for (const a of arr(r?.assumptions).map(rec)) {
      if (a === null || typeof a.value !== 'number') continue;
      out.push({ factor: String(a.factor ?? ''), option: null, value: a.value, unit: String(a.unit ?? '') });
    }
    for (const l of arr(r?.option_levels).map(rec)) {
      if (l === null || typeof l.value !== 'number') continue;
      out.push({ factor: String(l.factor ?? ''), option: String(l.option ?? ''), value: l.value, unit: String(l.unit ?? '') });
    }
  });
  return out.filter((p) => p.factor !== '');
}

export function winProbabilitiesOf(tools: TurnTools): Record<string, number> {
  if (tools.kind !== 'fp3') return {};
  const wp = rec(rec(rec(tools.toolResults[0])?.result)?.win_probabilities);
  if (wp === null) return {};
  return Object.fromEntries(Object.entries(wp).filter(([, v]) => typeof v === 'number')) as Record<string, number>;
}

function wireWith(routeBody: Rec, text: string, writeClaimsRemoved: number): Rec {
  const w = JSON.parse(JSON.stringify(routeBody)) as Rec;
  w.assistant_text = text;
  w._diagnostic_trace = { ...(rec(w._diagnostic_trace) ?? {}), write_claims_removed: writeClaimsRemoved };
  return w;
}

function scoreText(text: string, modelTextHint: string | null, cc: CaseContext, key: { case: string; arm: string; rep: number }, xctx: ExtraContext, functionCalls: readonly string[], writeClaimsRemoved: number): Scored {
  const v = viewOf(wireWith(cc.routeBody, text, writeClaimsRemoved), 200);
  const ts = scoreView(v, { capture: 'paired-57f903c', build: '57f903c', scenario: key.case, turn: `${key.arm}/rep-${key.rep}`, index: key.rep }, {
    userAction: cc.spec.userAction, domain: cc.spec.domain, rerunKind: null, nextApprovalRan: cc.spec.nextApprovalRan,
  });
  const modelText = modelTextHint ?? splitServerText(v).modelText;
  const nm = checkNextMove(modelText, xctx);
  const extras: ExtraCheck[] = [
    checkLeaderHonestySplit(modelText, xctx),
    checkWinPctWhileWithheld(modelText, xctx),
    ...checkProposalFigures(modelText, xctx),
    checkToolAction(functionCalls, xctx),
    checkQuestionLimit(modelText),
    checkStructure(modelText),
    nm.check,
    checkUngroundedFigures(modelText, xctx),
  ];
  return scoredOf(ts, text, extras, nm.moves, nm.distinctTypes, modelText);
}

export function scoreRep(caseId: string, arm: string, rep: number, repDir: string): RepResult {
  const stem = join(repDir, `rep-${rep}`);
  const meta = readJson(`${stem}.meta.json`);
  const request = readJson(`${stem}.request.json`);
  const responseRaw = readFileSync(`${stem}.response.json`, 'utf8');
  const response = JSON.parse(responseRaw) as Rec;
  const textTxt = readFileSync(`${stem}.text.txt`, 'utf8');
  const auth = rec(request.headers)?.authorization;
  if (auth !== undefined && auth !== '[REDACTED]') throw new Error(`${stem}: authorization header is not redacted`);
  const body = rec(request.body) ?? {};
  const cc = loadCaseContext(caseId, String(meta.captured_request));
  const output = response.output;
  const raw = textOfOutput(output);
  const fcallItems = functionCallsOf(output);
  const fcalls = fcallItems.map((f) => f.name);
  // run-paired.ts extractOutcome (:238-241) + textFileFor (:267-274): the text, then each function call as
  // "[function_call] name\n<args parsed, re-serialised with 2-space indent>", newline-terminated.
  const argsText = (a: string): string => { try { const v: unknown = JSON.parse(a); return typeof v === 'string' ? v : JSON.stringify(v, null, 2); } catch { return a; } };
  let expectTxt = raw;
  for (const f of fcallItems) expectTxt += `${expectTxt === '' ? '' : '\n\n'}[function_call] ${f.name}\n${argsText(f.arguments)}`;
  if (!expectTxt.endsWith('\n')) expectTxt += '\n';
  const usage = rec(meta.usage) ?? {};
  const num = (x: unknown): number | null => (typeof x === 'number' ? x : null);
  const tools: TurnTools = cc.spec.turn === 'fp3' ? fp3ToolsFromInput(body.input) : conversationToolsFromInput(body.input);
  const claim = rec(rec(cc.routeBody.analysis_state)?.leader_claim);
  const xctx: ExtraContext = {
    turn: cc.spec.turn,
    leaderPermitted: typeof claim?.permitted === 'boolean' ? claim.permitted : null,
    winProbabilities: winProbabilitiesOf(tools),
    proposedFigures: proposedFiguresOf(tools),
    optionLabels: arr(rec(cc.routeBody.draft_graph)?.nodes).map(rec).filter((n): n is Rec => n !== null && n.kind === 'option').map((n) => String(n.label)),
    otherLabels: arr(rec(cc.routeBody.draft_graph)?.nodes).map(rec).filter((n): n is Rec => n !== null && n.kind !== 'option' && typeof n.label === 'string').map((n) => String(n.label)),
    chips: arr(cc.routeBody.suggested_actions).map(rec).filter((c): c is Rec => c !== null).map((c) => ({ id: String(c.id ?? ''), label: String(c.label ?? ''), actionType: typeof c.action_type === 'string' ? c.action_type : null })),
    nextApprovalRan: cc.spec.nextApprovalRan,
    inputNumbers: numbersOfJson(body.input),
  };
  const key = { case: caseId, arm, rep };
  let visible: string | null = null;
  let simulation: RepResult['simulation'] = null;
  let rawScored: Scored | null = null;
  let visScored: Scored | null = null;
  const repliable = raw.trim() !== '' && fcalls.length === 0;
  if (repliable) {
    const sim = simulateVisible(raw, tools);
    visible = sim.visible;
    rawScored = scoreText(raw, raw, cc, key, xctx, fcalls, 0);
    visScored = scoreText(visible, null, cc, key, xctx, fcalls, sim.stripped.length);
    const split = splitServerText(viewOf(wireWith(cc.routeBody, visible, sim.stripped.length), 200));
    simulation = {
      stripped: sim.stripped, status: sim.status, not_adopted: sim.notAdopted, owed: sim.owed,
      split_model_text_equals_narration: sim.owed.length === 0 ? split.modelText === sim.modelShare : null,
    };
  } else {
    // No reply on this hop (a tool call, or empty text): only the tool-call outcome is scorable.
    const tool = checkToolAction(fcalls, xctx);
    const empty = scoreText('', '', cc, key, xctx, fcalls, 0);
    rawScored = { ...empty, extras: [tool], hardViolations: tool.verdict === 'FAIL' ? [tool.name] : [], softViolations: [], proxyFails: [], serverOwnedFails: [] };
  }
  return {
    case: caseId,
    arm,
    rep,
    control: meta.control === true,
    schedule_index: num(meta.schedule_index),
    files: { request: rel(`${stem}.request.json`), response: rel(`${stem}.response.json`), meta: rel(`${stem}.meta.json`), text: rel(`${stem}.text.txt`), route_response: rel(cc.routeResponsePath) },
    response_sha256: sha256(responseRaw),
    model: typeof meta.response_model === 'string' ? meta.response_model : null,
    settings: meta.settings ?? null,
    wall_ms: num(meta.wall_ms),
    usage: { input_tokens: num(usage.input_tokens), cached_tokens: num(usage.cached_tokens), output_tokens: num(usage.output_tokens), reasoning_tokens: num(usage.reasoning_tokens), total_tokens: num(usage.total_tokens) },
    function_calls: fcalls,
    raw_text: raw,
    raw_text_equals_text_txt: expectTxt === textTxt,
    visible_text: visible,
    simulation,
    raw: rawScored,
    visible: visScored,
  };
}

export function listReps(): { caseId: string; arm: string; rep: number; dir: string }[] {
  const runs = join(BASE, 'runs');
  const out: { caseId: string; arm: string; rep: number; dir: string }[] = [];
  for (const caseId of readdirSync(runs).filter((d) => !d.startsWith('_')).sort()) {
    for (const arm of readdirSync(join(runs, caseId)).sort()) {
      const dir = join(runs, caseId, arm);
      for (const f of readdirSync(dir).filter((x) => /^rep-\d+\.meta\.json$/.test(x))) out.push({ caseId, arm, rep: Number(/\d+/.exec(f)![0]), dir });
    }
  }
  return out.sort((a, b) => a.caseId.localeCompare(b.caseId) || ARM_ORDER.indexOf(a.arm as never) - ARM_ORDER.indexOf(b.arm as never) || a.rep - b.rep);
}

// ---------------------------------------------------------------------------
// Aggregation
// ---------------------------------------------------------------------------

const median = (xs: readonly number[]): number | null => {
  const s = [...xs].sort((a, b) => a - b);
  if (s.length === 0) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mmm = (xs: readonly number[]): string => (xs.length === 0 ? '—' : `${median(xs)} (${Math.min(...xs)}–${Math.max(...xs)})`);

export interface ArmAgg {
  readonly case: string;
  readonly arm: string;
  readonly n: number;
  readonly reps: readonly number[];
  readonly rawWords: readonly number[];
  readonly visWords: readonly number[];
  readonly modelWords: readonly number[];
  readonly hard: number;
  readonly soft: number;
  readonly hardByCheck: Readonly<Record<string, number>>;
  readonly softByCheck: Readonly<Record<string, number>>;
  readonly ndByCheck: Readonly<Record<string, number>>;
  readonly serverOwned: Readonly<Record<string, number>>;
  readonly proxy: number;
  readonly rawVsVisibleDiffer: number;
  readonly wallMs: number | null;
  readonly usage: Readonly<Record<string, number | null>>;
  readonly toolOutcomes: Readonly<Record<string, number>>;
  readonly repsWithHard: number;
}

export function aggregate(results: readonly RepResult[], caseId: string, arm: string, reps: readonly number[]): ArmAgg {
  const rs = results.filter((r) => r.case === caseId && r.arm === arm && reps.includes(r.rep));
  const count = (pick: (s: Scored) => readonly string[]): Record<string, number> => {
    const m: Record<string, number> = {};
    for (const r of rs) {
      const s = r.visible ?? r.raw;
      if (s === null) continue;
      for (const k of new Set(pick(s))) m[k] = (m[k] ?? 0) + 1;
    }
    return m;
  };
  const nd: Record<string, number> = {};
  for (const r of rs) {
    const s = r.visible;
    if (s === null) continue;
    for (const k of CHECK_NAMES) if (s.checks[k].verdict === 'NOT_DECIDABLE') nd[k] = (nd[k] ?? 0) + 1;
    for (const e of s.extras) if (e.verdict === 'NOT_DECIDABLE') nd[e.name] = (nd[e.name] ?? 0) + 1;
  }
  const hardByCheck = count((s) => s.hardViolations);
  const softByCheck = count((s) => s.softViolations);
  const tools: Record<string, number> = {};
  for (const r of rs) {
    const k = r.function_calls.length === 0 ? 'text reply, no tool call' : `tool call: ${r.function_calls.join(', ')}`;
    tools[k] = (tools[k] ?? 0) + 1;
  }
  const u = (k: keyof RepResult['usage']): number | null => median(rs.map((r) => r.usage[k]).filter((x): x is number => x !== null));
  return {
    case: caseId,
    arm,
    n: rs.length,
    reps: rs.map((r) => r.rep),
    rawWords: rs.filter((r) => r.raw !== null && r.visible !== null).map((r) => r.raw!.words),
    visWords: rs.filter((r) => r.visible !== null).map((r) => r.visible!.words),
    modelWords: rs.filter((r) => r.visible !== null).map((r) => r.visible!.modelWords),
    hard: Object.values(hardByCheck).reduce((a, b) => a + b, 0),
    soft: Object.values(softByCheck).reduce((a, b) => a + b, 0),
    hardByCheck,
    softByCheck,
    ndByCheck: nd,
    serverOwned: count((s) => s.serverOwnedFails),
    proxy: rs.filter((r) => (r.visible ?? r.raw)?.proxyFails.length).length,
    rawVsVisibleDiffer: rs.filter((r) => r.raw !== null && r.visible !== null && (r.raw.hardViolations.join() !== r.visible.hardViolations.join() || r.raw.softViolations.join() !== r.visible.softViolations.join())).length,
    wallMs: median(rs.map((r) => r.wall_ms).filter((x): x is number => x !== null)),
    usage: { input: u('input_tokens'), cached: u('cached_tokens'), output: u('output_tokens'), reasoning: u('reasoning_tokens'), total: u('total_tokens') },
    toolOutcomes: tools,
    repsWithHard: rs.filter((r) => ((r.visible ?? r.raw)?.hardViolations.length ?? 0) > 0).length,
  };
}

/** "Up to about 90 words": a median of up to 99 (90 + 10%) is within the target; above it, fewer words rank higher. */
export const WORDS_TARGET = 90;
export const WORDS_WITHIN = 99;
export const wordsOver = (a: ArmAgg): number => Math.max(0, (median(a.modelWords) ?? 0) - WORDS_WITHIN);

/** Violations first (hard, then soft), then median model words above ~90 (≤ 99 = within). Returns groups of tied arms, best first. */
export function rankArms(aggs: readonly ArmAgg[]): ArmAgg[][] {
  const excess = wordsOver;
  const keyOf = (a: ArmAgg): [number, number, number] => [a.hard, a.soft, excess(a)];
  const sorted = [...aggs].sort((a, b) => {
    const [x, y] = [keyOf(a), keyOf(b)];
    return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
  });
  const groups: ArmAgg[][] = [];
  for (const a of sorted) {
    const last = groups[groups.length - 1];
    if (last !== undefined && JSON.stringify(keyOf(last[0]!)) === JSON.stringify(keyOf(a))) last.push(a);
    else groups.push([a]);
  }
  return groups;
}

// ---------------------------------------------------------------------------
// Word-set Jaccard (noise control, lexical only)
// ---------------------------------------------------------------------------

const wordSet = (s: string): Set<string> => new Set(s.toLowerCase().replace(/[^a-z0-9£%\s]/g, ' ').split(/\s+/).filter((w) => w.length > 2));
export function jaccard(a: string, b: string): number {
  const x = wordSet(a);
  const y = wordSet(b);
  const inter = [...x].filter((w) => y.has(w)).length;
  return inter / new Set([...x, ...y]).size;
}

// ---------------------------------------------------------------------------
// Blinding
// ---------------------------------------------------------------------------

export const BLIND_SEED = 924_026;

/** mulberry32 — a small, well-known 32-bit PRNG; deterministic for a seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(xs: readonly T[], rnd: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

export const LEAK_TOKENS = ['M_', 'C1', 'C2', 'v0.2', 'v0.3', 'candidate', 'baseline', 'arm'] as const;

export function leakHits(text: string): { token: string; line: number; excerpt: string }[] {
  const out: { token: string; line: number; excerpt: string }[] = [];
  text.split('\n').forEach((l, i) => {
    for (const t of LEAK_TOKENS) {
      let at = l.toLowerCase().indexOf(t.toLowerCase());
      while (at >= 0) {
        out.push({ token: t, line: i + 1, excerpt: l.slice(Math.max(0, at - 30), at + t.length + 30) });
        at = l.toLowerCase().indexOf(t.toLowerCase(), at + 1);
      }
    }
  });
  return out;
}

/** PACK.md text outside the verbatim reply fences (~~~~text … ~~~~). */
export function outsideReplies(pack: string): string {
  return pack.replace(/^~~~~text\n[\s\S]*?\n~~~~$/gm, '~~~~text\n[reply]\n~~~~');
}

// ---------------------------------------------------------------------------
// Write-once
// ---------------------------------------------------------------------------

export function writeOnce(path: string, content: string): 'written' | 'unchanged' {
  if (existsSync(path)) {
    if (readFileSync(path, 'utf8') === content) return 'unchanged';
    throw new Error(`refusing to overwrite ${rel(path)} with different content (append-only); move it aside first`);
  }
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  return 'written';
}

export { ROUTE_LINES_MIRRORED, SERVED_HEAD, mmm, median };
