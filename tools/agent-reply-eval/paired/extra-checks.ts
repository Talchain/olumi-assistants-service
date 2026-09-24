/**
 * Checks the deterministic scorer (tools/agent-reply-eval/src/checks.ts, copied unchanged) does not
 * make, because they need what a served capture never carries but a paired run does: the REQUEST
 * the reply was written against (the turn's tool results, the run's win probabilities, the
 * proposals) and the model's own output items (tool calls on a hop that should only talk).
 *
 * Two tiers, named in every report:
 *   HARD  — a rule from Paul's acceptance criteria that is settled by the inputs alone
 *           (win % quoted while the leader is withheld; an Olumi-proposed figure called the user's,
 *           left unattributed, or quoted without its unit; an acting tool on a talk-only turn).
 *   SOFT  — a deterministic PROXY for a rule that needs judgement (≤ 1 question, lead sentence +
 *           ≤ 3 bullets, one supported next move). Reported and ranked AFTER hard violations.
 *   PROXY — reported only, never ranked: figures in the reply found nowhere in the request input.
 *
 * Every check reads the MODEL's words (the server's paragraphs are identical across arms and are
 * owned by the server). NOT_DECIDABLE is returned whenever the inputs cannot settle it.
 */
import { leaderClaimsIn, unitPresent } from '../src/checks.js';
import { buildOptionMatchers, tokensOf, type OptionMatcher } from '../src/options.js';
import { countsOf, excerpt, sentencesOf, type Sentence } from '../src/text.js';

export type Verdict = 'PASS' | 'FAIL' | 'NOT_DECIDABLE';
export type Tier = 'hard' | 'soft' | 'proxy';

export interface ExtraFinding {
  readonly kind: string;
  readonly excerpt: string;
}

export interface ExtraCheck {
  readonly name: string;
  readonly tier: Tier;
  readonly verdict: Verdict;
  readonly vacuous: boolean;
  readonly reason: string;
  readonly findings: readonly ExtraFinding[];
}

const check = (name: string, tier: Tier, verdict: Verdict, reason: string, findings: readonly ExtraFinding[] = [], vacuous = false): ExtraCheck => ({
  name, tier, verdict, vacuous, reason, findings,
});

// ---------------------------------------------------------------------------
// Numbers and binding (same semantics as checks.ts numbersIn/boundTo, which are not exported;
// kept here rather than editing the copied scorer).
// ---------------------------------------------------------------------------

export interface NumberAt { readonly value: number; readonly text: string; readonly decimals: number; readonly index: number; readonly end: number; readonly currency: string | null }

const NUMBER = /(?:([£$€])\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g;

export function numbersIn(s: string): NumberAt[] {
  const out: NumberAt[] = [];
  for (const m of s.matchAll(NUMBER)) {
    const index = m.index ?? 0;
    const end = index + m[0].length;
    const before = s[index - 1];
    if (before !== undefined && /[\w.]/.test(before)) continue;
    if (/^[a-z]/i.test(s.slice(end, end + 1))) continue;
    const text = `${m[2]!.replace(/,/g, '')}${m[3] ? `.${m[3]}` : ''}`;
    out.push({ value: Number(text), text, decimals: m[3]?.length ?? 0, index, end, currency: m[1] ?? null });
  }
  return out;
}

const flat = (s: string): string => s.replace(/\*\*/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();
const BIND_WINDOW = 40;

/** Numbers bound to a phrase: the nearest number within 40 characters of an occurrence, numbers inside the phrase excluded. */
export function boundTo(f: string, phrases: readonly string[]): NumberAt[] {
  const spans: [number, number][] = [];
  for (const p of phrases) {
    const needle = p.toLowerCase();
    if (needle.length < 3) continue;
    for (let i = f.indexOf(needle); i >= 0; i = f.indexOf(needle, i + 1)) spans.push([i, i + needle.length]);
  }
  if (spans.length === 0) return [];
  const nums = numbersIn(f).filter((n) => !spans.some(([a, b]) => n.index >= a && n.end <= b));
  const out = new Map<number, NumberAt>();
  for (const [a, b] of spans) {
    let best: { n: NumberAt; d: number } | null = null;
    for (const n of nums) {
      const d = n.index >= b ? n.index - b : a >= n.end ? a - n.end : Infinity;
      if (d <= BIND_WINDOW && (best === null || d < best.d)) best = { n, d };
    }
    if (best !== null) out.set(best.n.index, best.n);
  }
  return [...out.values()];
}

/** v, as written with `decimals` places, equals p at that precision. */
export const sameAtPrecision = (v: NumberAt, p: number): boolean => Number(p.toFixed(v.decimals)) === v.value;

const clauses = (s: string): string[] => s.split(/[;—–]|,\s*(?=(?:but|while|whereas|although|though|not|so|yet)\b)/i).map((c) => c.trim()).filter((c) => c !== '');

// ---------------------------------------------------------------------------
// Case context the checks need
// ---------------------------------------------------------------------------

export interface ProposedFigure {
  readonly factor: string;
  readonly option: string | null;
  readonly value: number;
  readonly unit: string;
}

export interface ChipLite { readonly id: string; readonly label: string; readonly actionType: string | null }

export interface ExtraContext {
  readonly turn: 'construction' | 'fp3' | 'discussion';
  readonly leaderPermitted: boolean | null;
  /** Win probabilities the run returned (0..1), keyed by option label; empty when no run result. */
  readonly winProbabilities: Readonly<Record<string, number>>;
  readonly proposedFigures: readonly ProposedFigure[];
  readonly optionLabels: readonly string[];
  /** Labels of every non-option node (masked by the scorer so "Tech LEAD" is not a ranking cue). */
  readonly otherLabels: readonly string[];
  readonly chips: readonly ChipLite[];
  /** Did the next approval run the analysis? false = witnessed/inferred it runs nothing. */
  readonly nextApprovalRan: boolean | null;
  /** Every number that appears anywhere in the request input (JSON numbers and numbers inside strings). */
  readonly inputNumbers: readonly number[];
}

// ---------------------------------------------------------------------------
// HARD
// ---------------------------------------------------------------------------

const PCT_AFTER = /^\s?(?:%|per ?cent|percent)|^\s+of (?:the )?(?:model |simulated )?(?:runs|simulations|draws|scenarios)\b/i;

/** A win probability quoted (as a %, or "N of runs") while leader_claim.permitted is false. */
export function checkWinPctWhileWithheld(modelText: string, ctx: ExtraContext): ExtraCheck {
  const probs = Object.entries(ctx.winProbabilities);
  if (probs.length === 0) return check('WIN_PCT_WHILE_WITHHELD', 'hard', 'PASS', 'no win probabilities in this turn’s inputs', [], true);
  if (ctx.leaderPermitted === null) return check('WIN_PCT_WHILE_WITHHELD', 'hard', 'NOT_DECIDABLE', 'no leader_claim.permitted in the inputs');
  if (ctx.leaderPermitted === true) return check('WIN_PCT_WHILE_WITHHELD', 'hard', 'PASS', 'leader permitted: win % may be quoted', [], true);
  const findings: ExtraFinding[] = [];
  const f = flat(modelText);
  for (const n of numbersIn(f)) {
    if (!PCT_AFTER.test(f.slice(n.end, n.end + 40))) continue;
    const hit = probs.find(([, p]) => sameAtPrecision(n, p * 100));
    if (hit !== undefined) findings.push({ kind: 'win_pct_quoted_while_withheld', excerpt: `${n.text}% = win probability of “${hit[0]}” — ${excerpt(f.slice(Math.max(0, n.index - 70), n.end + 30), 140)}` });
  }
  if (findings.length > 0) return check('WIN_PCT_WHILE_WITHHELD', 'hard', 'FAIL', 'quotes an option’s win probability while leader_claim.permitted=false', findings);
  return check('WIN_PCT_WHILE_WITHHELD', 'hard', 'PASS', 'no win probability quoted');
}

/** A hyphen joining two word characters ("£59-at-release"), which the scorer's tokeniser keeps inside one token. */
const INNER_HYPHEN = /(?<=[\p{L}\p{N}£$€%])-(?=[\p{L}\p{N}£$€])/gu;

/**
 * The scorer's own LEADER_HONESTY rule (leaderClaimsIn, unchanged) on each sentence with inner hyphens split,
 * counting ONLY sentences where the unsplit sentence had no claim — so it adds exactly the claims the scorer
 * missed because an option was written as a hyphenated compound ("the £59-at-release path leads").
 */
export function checkLeaderHonestySplit(modelText: string, ctx: ExtraContext): ExtraCheck {
  if (ctx.leaderPermitted === null) return check('LEADER_HONESTY_SPLIT', 'hard', 'NOT_DECIDABLE', 'no leader_claim.permitted in the inputs');
  if (ctx.leaderPermitted === true) return check('LEADER_HONESTY_SPLIT', 'hard', 'PASS', 'leader permitted', [], true);
  if (ctx.optionLabels.length === 0) return check('LEADER_HONESTY_SPLIT', 'hard', 'NOT_DECIDABLE', 'no option labels');
  const matchers = buildOptionMatchers(ctx.optionLabels);
  const findings: ExtraFinding[] = [];
  let split = 0;
  for (const s of sentencesOf(modelText, 'model')) {
    const t = s.text.replace(INNER_HYPHEN, ' ');
    if (t === s.text) continue;
    split += 1;
    if (leaderClaimsIn(s.text, matchers, ctx.otherLabels).length > 0) continue;
    for (const c of leaderClaimsIn(t, matchers, ctx.otherLabels)) findings.push({ kind: 'names_leader_while_withheld_hyphenated', excerpt: excerpt(c, 160) });
  }
  if (findings.length > 0) return check('LEADER_HONESTY_SPLIT', 'hard', 'FAIL', 'names an option as leading (written as a hyphenated compound) while leader_claim.permitted=false', findings);
  return check('LEADER_HONESTY_SPLIT', 'hard', 'PASS', `${split} sentence(s) with inner hyphens re-read; no additional leader claim`, [], split === 0);
}

const USER_CUE = /\byour (?:own )?(?:figure|number|value|estimate|input|data)\b|\byou (?:said|stated|gave|set|entered|told|specified|provided|reported)\b|\bfrom your brief\b|\bas you (?:said|stated)\b|\byour brief (?:says|states|gives)\b/i;
const OLUMI_CUE = /\bassum\w*|\bestimat\w*|\bplaceholder\w*|\bprovisional\b|\bstarting (?:values?|points?|assumptions?|figures?|levels?)\b|\bnot (?:a |as )?measure\w*|\billustrative\b|\bworking (?:figures?|values?|assumptions?|baseline)\b|\bI (?:propose|suggest|assumed|estimated|picked|chose)\b|\bmy (?:proposal|suggestion|proposed)\b|\bproposed?\b|\bOlumi['’]s\b|\bto (?:adopt|test) or correct\b|\bto (?:adopt|correct)\b/i;

/** Every content token of the unit is in the factor label (plural-folded, as options.ts tokensOf). */
export function unitInLabel(unit: string, label: string): boolean {
  const want = tokensOf(unit).filter((t) => !/^\d+$/.test(t));
  if (want.length === 0) return false;
  const have = new Set(tokensOf(label));
  return want.every((t) => have.has(t));
}

/** The phrases a proposed figure may be quoted next to: the factor label, and for a level its option. */
function proposalPhrases(p: ProposedFigure, matchers: ReadonlyMap<string, OptionMatcher>): string[] {
  const base = [p.factor];
  if (p.option !== null) base.push(...(matchers.get(p.option)?.phrases ?? [p.option]));
  return base;
}

/**
 * Olumi's proposed figures (this turn's propose_* results): never called the user's; attributed as
 * Olumi's assumptions somewhere in the reply when quoted; quoted with their unit.
 */
export function checkProposalFigures(modelText: string, ctx: ExtraContext): ExtraCheck[] {
  if (ctx.proposedFigures.length === 0) {
    return [
      check('PROPOSAL_PROVENANCE', 'hard', 'PASS', 'no Olumi-proposed figure in this turn', [], true),
      check('PROPOSAL_UNITS', 'hard', 'PASS', 'no Olumi-proposed figure in this turn', [], true),
    ];
  }
  const matchers = new Map(buildOptionMatchers(ctx.optionLabels).map((m) => [m.label, m]));
  const sentences = sentencesOf(modelText, 'model');
  const prov: ExtraFinding[] = [];
  const units: ExtraFinding[] = [];
  let quoted = 0;
  let unitBound = 0;
  for (const s of sentences) {
    for (const clause of clauses(s.text)) {
      const f = flat(clause);
      for (const p of ctx.proposedFigures) {
        const hits = boundTo(f, proposalPhrases(p, matchers)).filter((n) => Math.abs(n.value - p.value) < 1e-9);
        if (hits.length === 0) continue;
        quoted += 1;
        if (USER_CUE.test(clause)) prov.push({ kind: 'olumi_figure_called_users', excerpt: `${p.factor}${p.option ? ` (${p.option})` : ''} = ${p.value} — ${excerpt(clause, 120)}` });
        // A zero needs no unit (none of anything is none); a unit the factor's own label already names
        // ("Tech lead hires" / unit "hires") is carried by the label quoted beside the figure.
        if (p.unit.trim() !== '' && p.value !== 0 && !unitInLabel(p.unit, p.factor)) {
          for (const n of hits) {
            unitBound += 1;
            if (!unitPresent(p.unit, f, n)) units.push({ kind: 'proposal_figure_without_unit', excerpt: `${p.factor} = ${p.value} (unit “${p.unit}”) — ${excerpt(clause, 120)}` });
          }
        }
      }
    }
  }
  const attributed = sentences.some((s: Sentence) => OLUMI_CUE.test(s.text));
  if (quoted > 0 && !attributed) prov.push({ kind: 'olumi_figures_unattributed', excerpt: `${quoted} proposed figure(s) quoted; no sentence marks them as Olumi’s assumptions/estimates` });
  const provCheck = prov.length > 0
    ? check('PROPOSAL_PROVENANCE', 'hard', 'FAIL', 'an Olumi-proposed figure is called the user’s, or quoted with no attribution', prov)
    : quoted === 0
      ? check('PROPOSAL_PROVENANCE', 'hard', 'PASS', 'no proposed figure quoted next to its factor/option', [], true)
      : check('PROPOSAL_PROVENANCE', 'hard', 'PASS', `${quoted} proposed figure(s) quoted, attributed as Olumi’s, none called the user’s`);
  const unitCheck = units.length > 0
    ? check('PROPOSAL_UNITS', 'hard', 'FAIL', 'a proposed figure is quoted without its unit', units)
    : unitBound === 0
      ? check('PROPOSAL_UNITS', 'hard', 'PASS', 'no unit-bearing proposed figure quoted', [], true)
      : check('PROPOSAL_UNITS', 'hard', 'PASS', `${unitBound} unit-bearing proposed figure(s) quoted, all with their unit`);
  return [provCheck, unitCheck];
}

/** Tools that act on the model or run the analysis. On a talk-only turn any of these is a FAIL. */
export const ACTING_TOOLS = new Set(['run_analysis', 'authorise_change', 'build_model_from_brief']);

export function checkToolAction(functionCalls: readonly string[], ctx: ExtraContext): ExtraCheck {
  if (ctx.turn === 'fp3') {
    return functionCalls.length === 0
      ? check('TOOL_ACTION', 'hard', 'PASS', 'explicit-Run interpretation made no tool call (tools [] / tool_choice none)', [], true)
      : check('TOOL_ACTION', 'hard', 'FAIL', 'a tool call on a tool-less call', functionCalls.map((n) => ({ kind: 'tool_call_on_interpret_only', excerpt: n })));
  }
  const acting = functionCalls.filter((n) => ACTING_TOOLS.has(n));
  if (ctx.turn === 'discussion' && acting.length > 0) {
    return check('TOOL_ACTION', 'hard', 'FAIL', 'an acting tool on a “don’t change or re-run” discussion turn', acting.map((n) => ({ kind: 'acting_tool_on_discussion', excerpt: n })));
  }
  if (ctx.turn === 'construction' && acting.length > 0) {
    return check('TOOL_ACTION', 'hard', 'FAIL', 'an acting tool on the construction turn’s final hop', acting.map((n) => ({ kind: 'acting_tool_on_final_hop', excerpt: n })));
  }
  if (functionCalls.length === 0) return check('TOOL_ACTION', 'hard', 'PASS', 'no tool call on this hop', [], true);
  return check('TOOL_ACTION', 'hard', 'PASS', `read-only tool call(s) only: ${functionCalls.join(', ')}`);
}

// ---------------------------------------------------------------------------
// SOFT (deterministic proxies)
// ---------------------------------------------------------------------------

export function checkQuestionLimit(modelText: string): ExtraCheck {
  const q = countsOf(modelText).questions;
  if (q <= 1) return check('QUESTION_LIMIT', 'soft', 'PASS', `${q} question mark(s) in the model's words`, [], q === 0);
  const qs = sentencesOf(modelText, 'model').filter((s) => s.text.includes('?')).map((s) => ({ kind: 'question', excerpt: excerpt(s.text, 120) }));
  return check('QUESTION_LIMIT', 'soft', 'FAIL', `${q} question marks in the model's words (at most one question)`, qs);
}

const BULLET_LINE = /^\s*(?:[-*•]|\d+[.)])\s+/;
const HEADING_LINE = /^\s*(?:#{1,6}\s+|\*\*[^*\n]{1,80}\*\*:?\s*$)/;

export function checkStructure(modelText: string): ExtraCheck {
  const lines = modelText.split('\n').filter((l) => l.trim() !== '');
  const bullets = lines.filter((l) => BULLET_LINE.test(l)).length;
  const first = lines[0] ?? '';
  const findings: ExtraFinding[] = [];
  if (first !== '' && (BULLET_LINE.test(first) || HEADING_LINE.test(first))) findings.push({ kind: 'no_lead_sentence', excerpt: excerpt(first, 100) });
  if (bullets > 3) findings.push({ kind: 'more_than_3_bullets', excerpt: `${bullets} bullet lines` });
  const headings = lines.filter((l) => HEADING_LINE.test(l) && !BULLET_LINE.test(l)).length;
  if (findings.length > 0) return check('STRUCTURE', 'soft', 'FAIL', `lead sentence + at most 3 bullets (bullets ${bullets}, heading lines ${headings})`, findings);
  return check('STRUCTURE', 'soft', 'PASS', `opens with a sentence; ${bullets} bullet line(s); ${headings} heading line(s)`);
}

export type MoveType = 'approve' | 'run' | 'provide_info' | 'change_model' | 'other';

const IMPERATIVE = /^(?:(?:then|now|next|so|and|finally|first|afterwards),?\s+)?(?:please\s+)?(?:tell|give|share|send|confirm|provide|define|specify|add|set|say|choose|decide|check|review|approve|adopt|run|press|use|click|ask|let|consider|clarify|state|replace|correct|update|change|edit|enter|pick|select)\b/i;
const INVITATION = /\bif you (?:approve|adopt|agree|want|confirm|accept|prefer|can|say|tell|give|share|provide|choose|decide)\b|\bonce you (?:approve|adopt|confirm|provide|share|define|specify)\b|\b(?:you|we) (?:could|can|should|may want to|might want to) (?:now |next |then |first |also )?(?:approve|adopt|run|re-?run|tell|give|share|provide|define|specify|add|set|say|choose|decide|check|review|confirm|change|edit|replace|correct|clarify|state|compare|test|use)\b|\bwould you like\b|\bdo you (?:want|approve|agree|accept)\b|\bshall I\b|\bwant me to\b|\blet me know\b|\b(?:the )?next (?:useful |best |sensible |practical )?(?:reasoning )?(?:step|move)\b|\bI (?:suggest|recommend|would suggest|['’]d suggest|would recommend)\b|\bto (?:include|test|compare|assess|make|get|run|allow|enable) [^.?!]{0,100}?,\s*(?:say|tell|give|define|provide|set|add|specify|confirm|state|choose)\b/i;

const MOVE_TYPES: [MoveType, RegExp][] = [
  ['approve', /\bapprov|\badopt\b|\buse (?:these|those|them|as starting)\b|\bsay ["“]?(?:\*\*)?yes\b|\bapply (?:this|these|them|it|the)\b/i],
  ['run', /\b(?:re-?)?run\b|\brunning\b/i],
  ['change_model', /\b(?:change|edit|add|remove|adjust|replace|correct|update|set)\b/i],
  ['provide_info', /\b(?:tell|give|share|provide|confirm|specify|define|say|state|clarify|let me know|which|what|how (?:much|many|strong)|whether)\b|\?/i],
];

export interface NextMove { readonly excerpt: string; readonly types: readonly MoveType[]; readonly supported: boolean | null; readonly why: string }

function supportOf(types: readonly MoveType[], sentence: string, ctx: ExtraContext): { supported: boolean | null; why: string } {
  const approveShown = ctx.chips.some((c) => c.id.startsWith('agent-approve-proposal'));
  const runShown = ctx.chips.some((c) => c.actionType === 'run_analysis');
  const reasons: string[] = [];
  let supported: boolean | null = true;
  if (types.includes('approve')) {
    if (!approveShown) { supported = false; reasons.push('approval invited but no approval chip shown'); } else reasons.push('approval chip shown');
  }
  if (types.includes('run')) {
    const onApproval = types.includes('approve') && /\b(?:and|then|I['’]ll|I will|will)\b[^.?!]{0,60}\b(?:re-?)?run\b/i.test(sentence);
    if (onApproval && ctx.nextApprovalRan === false) { supported = false; reasons.push('promises a run on approval; approval runs nothing'); }
    else if (runShown) reasons.push('Run chip shown');
    else if (supported !== false) { supported = null; reasons.push('Run named with no Run chip; the persistent Run control is not in the inputs'); }
  }
  if (reasons.length === 0) reasons.push('asks for information or a change the user can give');
  return { supported, why: reasons.join('; ') };
}

export function nextMovesIn(modelText: string, ctx: ExtraContext): NextMove[] {
  const out: NextMove[] = [];
  for (const s of sentencesOf(modelText, 'model')) {
    const t = s.text.replace(/\*\*/g, '').replace(/^[\s>*_-]+/, '');
    if (!(IMPERATIVE.test(t) || INVITATION.test(t))) continue;
    const types = MOVE_TYPES.filter(([, re]) => re.test(t)).map(([k]) => k);
    const ts: MoveType[] = types.length > 0 ? types : ['other'];
    const { supported, why } = supportOf(ts, t, ctx);
    out.push({ excerpt: excerpt(t, 140), types: ts, supported, why });
  }
  return out;
}

/** One next move, and only a supported one. The count is DISTINCT move types across next-move sentences. */
export function checkNextMove(modelText: string, ctx: ExtraContext): { check: ExtraCheck; moves: NextMove[]; distinctTypes: MoveType[] } {
  const moves = nextMovesIn(modelText, ctx);
  const primary = (m: NextMove): MoveType => m.types[0]!;
  const distinctTypes = [...new Set(moves.map(primary))];
  const findings: ExtraFinding[] = [];
  if (distinctTypes.length > 1) findings.push({ kind: 'more_than_one_next_move', excerpt: `${distinctTypes.join(' + ')} — ${moves.map((m) => m.excerpt).join(' | ').slice(0, 220)}` });
  for (const m of moves) if (m.supported === false) findings.push({ kind: 'unsupported_next_move', excerpt: `${m.why} — ${m.excerpt}` });
  if (findings.length > 0) return { check: check('NEXT_MOVE', 'soft', 'FAIL', `${distinctTypes.length} distinct next move(s); ${moves.filter((m) => m.supported === false).length} unsupported`, findings), moves, distinctTypes };
  if (moves.some((m) => m.supported === null)) return { check: check('NEXT_MOVE', 'soft', 'NOT_DECIDABLE', 'a next move names the Run control with no Run chip shown'), moves, distinctTypes };
  if (moves.length === 0) return { check: check('NEXT_MOVE', 'soft', 'PASS', 'no next move offered (allowed: one only when supported)', [], true), moves, distinctTypes };
  return { check: check('NEXT_MOVE', 'soft', 'PASS', `one next move (${distinctTypes[0]}), supported`), moves, distinctTypes };
}

// ---------------------------------------------------------------------------
// PROXY (reported, never ranked)
// ---------------------------------------------------------------------------

/** Numbers in the reply found nowhere in the request input, at the precision written (as given, or ×100 for a percentage). Integers 0–12 are exempt (counts, months). */
export function checkUngroundedFigures(modelText: string, ctx: ExtraContext): ExtraCheck {
  const f = flat(modelText);
  const findings: ExtraFinding[] = [];
  let seen = 0;
  for (const n of numbersIn(f)) {
    if (Number.isInteger(n.value) && n.decimals === 0 && n.value <= 12) continue;
    seen += 1;
    const grounded = ctx.inputNumbers.some((p) => sameAtPrecision(n, p) || sameAtPrecision(n, p * 100));
    if (!grounded) findings.push({ kind: 'figure_not_in_inputs', excerpt: `${n.currency ?? ''}${n.text} — ${excerpt(f.slice(Math.max(0, n.index - 60), n.end + 40), 130)}` });
  }
  if (findings.length > 0) return check('UNGROUNDED_FIGURE', 'proxy', 'FAIL', `${findings.length} of ${seen} figure(s) not found in the request input (as written or ×100)`, findings);
  return check('UNGROUNDED_FIGURE', 'proxy', 'PASS', `${seen} figure(s) > 12, all found in the request input`, [], seen === 0);
}

/** Every number in a JSON value: JSON numbers, and numbers written inside strings (recursing into JSON-in-strings). */
export function numbersOfJson(v: unknown, out: number[] = []): number[] {
  if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  else if (typeof v === 'string') {
    const t = v.trim();
    if ((t.startsWith('{') && t.endsWith('}')) || (t.startsWith('[') && t.endsWith(']'))) {
      try { numbersOfJson(JSON.parse(t), out); return out; } catch { /* plain text */ }
    }
    for (const n of numbersIn(v)) out.push(n.value);
  } else if (Array.isArray(v)) for (const x of v) numbersOfJson(x, out);
  else if (v !== null && typeof v === 'object') for (const x of Object.values(v)) numbersOfJson(x, out);
  return out;
}
