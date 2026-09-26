/**
 * The eight reply checks. Each returns PASS / FAIL / NOT_DECIDABLE with a reason.
 *
 * ⛔ NOT_DECIDABLE IS MANDATORY WHEN THE CAPTURE CANNOT SETTLE IT. A capture holds
 * the final text, the chips, the tool NAMES with ok/mutated/refusal, and the
 * post-turn canonical state — never the model's inputs or the tool RESULTS. A
 * check that would need those says so instead of guessing.
 *
 * `vacuous: true` marks a PASS that checked nothing (no claim of that kind in
 * the text, or the rule did not apply) — so a report can separate "checked and
 * clean" from "nothing to check".
 *
 * All checks read the FINAL user-visible text (model words + the server's own
 * paragraphs). Each finding says whether it sat in the model's words or the
 * server's, because the two have different owners.
 */
import { WRITE_TOOLS, assertsCompletedWrite } from '../../../src/orchestrator-v5/agent-lane/write-outcome.js';
import { REPORTS_ANALYSIS, type CaseClass } from './classify.js';
import { PERSISTENT_RUN_CONTROL, knownChipLabels } from './controls.js';
import { buildOptionMatchers, maskOptions, optionsNamedIn, tokensOf, type OptionMatcher } from './options.js';
import {
  clausesOf,
  escapeRe,
  excerpt,
  norm,
  sentencesOfSplit,
  type Sentence,
  type TextSplit,
  type Where,
} from './text.js';
import { ranAnalysisThisTurn, runBlockedThisTurn, type ReplyView } from './wire.js';

export type Verdict = 'PASS' | 'FAIL' | 'NOT_DECIDABLE';

export const CHECK_NAMES = [
  'CONTROL_REFERENCE',
  'LEADER_HONESTY',
  'ACTION_TRUTH',
  'OPTION_NAME_FIDELITY',
  'UNITS',
  'PROVENANCE_WORDING',
  'CAVEAT',
  'INTERNAL_ID',
] as const;
export type CheckName = (typeof CHECK_NAMES)[number];

export interface Finding {
  readonly kind: string;
  readonly where: Where;
  readonly excerpt: string;
}

export interface CheckResult {
  readonly check: CheckName;
  readonly verdict: Verdict;
  readonly reason: string;
  readonly vacuous: boolean;
  readonly findings: readonly Finding[];
}

export interface CheckContext {
  readonly cls: CaseClass;
  /**
   * For a promise that approving will run the analysis: did the NEXT approval
   * captured in this conversation run it? `null` = no later approval captured,
   * so the promise cannot be checked against served behaviour.
   */
  readonly nextApprovalRan: boolean | null;
}

const result = (
  check: CheckName,
  verdict: Verdict,
  reason: string,
  findings: readonly Finding[] = [],
  vacuous = false,
): CheckResult => ({ check, verdict, reason, vacuous, findings });

// ======================================================================
// CONTROL_REFERENCE — the text names a control the response did not show
// ======================================================================

const QUOTE_OPEN = String.raw`(?:\*\*|["“‘])`;
const QUOTE_CLOSE = String.raw`(?:\*\*|["”’])`;
const VERB_REF = new RegExp(String.raw`\b(?:click|press|tap|hit)\s+(?:on\s+)?(?:the\s+)?${QUOTE_OPEN}([^"”’*\n]{2,48}?)${QUOTE_CLOSE}`, 'gi');
const BUTTON_REF = new RegExp(String.raw`${QUOTE_OPEN}([^"”’*\n]{2,48}?)${QUOTE_CLOSE}\s+(?:button|chip)\b`, 'gi');

export function controlReferencesIn(text: string): string[] {
  const refs = new Set<string>();
  for (const re of [VERB_REF, BUTTON_REF]) for (const m of text.matchAll(re)) refs.add(m[1]!.trim());
  for (const label of knownChipLabels()) {
    const re = new RegExp(String.raw`${QUOTE_OPEN}\s*${escapeRe(label)}\s*[.!]?${QUOTE_CLOSE}`, 'i');
    if (re.test(text)) refs.add(label);
  }
  return [...refs];
}

export function checkControlReference(v: ReplyView, split: TextSplit): CheckResult {
  const shown = new Set(v.chips.map((c) => norm(c.label)));
  const runShown = v.chips.some((c) => c.actionType === 'run_analysis');
  const findings: Finding[] = [];
  let undecidable = 0;
  const refs: { label: string; where: Where }[] = [
    ...controlReferencesIn(split.modelText).map((label) => ({ label, where: 'model' as const })),
    ...controlReferencesIn(split.serverText).map((label) => ({ label, where: 'server' as const })),
  ];
  for (const r of refs) {
    const n = norm(r.label).replace(/[.!:]+$/, '');
    if (shown.has(n)) continue;
    if (PERSISTENT_RUN_CONTROL.test(n)) {
      if (!runShown) undecidable += 1;
      continue;
    }
    findings.push({ kind: 'control_not_shown', where: r.where, excerpt: r.label });
  }
  const chipList = v.chips.map((c) => c.label).join(' | ') || 'none';
  if (findings.length > 0) return result('CONTROL_REFERENCE', 'FAIL', `names a control not among the chips shown (${chipList})`, findings);
  if (undecidable > 0) {
    return result(
      'CONTROL_REFERENCE',
      'NOT_DECIDABLE',
      'names the Run control with no Run chip shown; whether the persistent Run control was visible is not in the capture',
    );
  }
  if (refs.length === 0) return result('CONTROL_REFERENCE', 'PASS', 'no control named in the text', [], true);
  return result('CONTROL_REFERENCE', 'PASS', `every control named is a chip shown (${chipList})`);
}

// ======================================================================
// LEADER_HONESTY — an option named as leading while the claim is withheld
// ======================================================================

/** A cue that the clause RANKS an option (tested after option and role nouns are masked). */
const LEADER_CUE = new RegExp(
  [
    String.raw`\b(?:leads?|leading)\b(?!\s+(?:to|by|into)\b)`,
    String.raw`\bahead\b`,
    String.raw`\b(?:wins?|winner|winning)\b`,
    String.raw`\bbest (?:option|choice|bet|path|performer)\b`,
    String.raw`\btop[- ](?:option|choice|ranked|rank)\b`,
    String.raw`\branks? (?:first|highest|top)\b|\branking first\b|\bfirst place\b`,
    String.raw`\b(?:comes?|came|coming) out (?:ahead|on top|best|in front)\b|\bin front\b|\bin the lead\b`,
    String.raw`\bedg(?:es?|ed|ing) (?:out|ahead)\b|\b(?:performs?|performed|does|did) (?:the )?best\b`,
    String.raw`\b(?:more|most) likely to (?:lead|win|come out)\b`,
    String.raw`\b(?:higher|highest|greater|greatest|better) (?:modelled |simulated )?(?:chance|probability|likelihood) of (?:leading|winning|coming out)\b`,
    String.raw`\bhighest\b(?:\s+[\w-]+){0,3}?\s+(?:chance|probability|likelihood|win|frequency|share|score|outcome|rate)\b`,
    String.raw`\bscor(?:es|ed|ing) (?:the )?highest\b|\bmost often\b`,
    String.raw`\b(?:the|current|clear|apparent) leader\b`,
    String.raw`\bof (?:the )?(?:model |simulated )?(?:runs|simulations|scenarios)\b`,
  ].join('|'),
  'i',
);
/**
 * Preference words that also carry ordinary reasoning ("if leadership is the bottleneck, this
 * favours a Tech Lead"). They count as a ranking only in a sentence about the MODEL's result.
 */
const WEAK_LEADER_CUE =
  /\bfavou?r(?:s|ed)?\b|\bpreferred\b|\boutperform(?:s|ed)?\b|\bstrongest\b|\bbest (?:option|choice|bet|path|performer)\b|\bstronger (?:option|choice|bet|path)\b/i;
const ANALYSIS_CONTEXT = /\b(?:model|analysis|result|run|simulat\w*|comparison|ranking|ordering|scenarios?)\b/i;
/**
 * Negation, condition or modality BEFORE the ranking cue: the clause does not ASSERT that the option
 * leads ("does not lead", "would only lead if"). After the cue it does not un-assert it
 * ("leads in 58% of runs, which could change"; "leads with no close rival") — review probe, 24 Sep.
 */
const NOT_ASSERTED_BEFORE_CUE = /\b(?:not|no|never|cannot|without|if|unless|none|could|might|may|would|can)\b|n['’]t\b/i;
/** Framing that un-asserts the whole clause wherever it sits. */
const NOT_ASSERTED_ANYWHERE = /\b(?:neither|nor|whether)\b|\brather than\b|\binstead of\b/i;
/** Nouns that contain "lead" but are not a ranking ("Tech Lead", "a lead", "lead times"). */
const ROLE_LEAD =
  /\b(?:tech(?:nical)?|team|engineering|squad|project|product|design|delivery|dev(?:elopment)?)[\s-]+leads?(?:ership)?\b|(?<!\bin\s)\b(?:a|an|the|one|new|another|dedicated|senior)\s+lead\b|\blead[\s-]?times?\b|\blead(?:ership)? (?:capacity|coverage|role|hire)s?\b/gi;

/**
 * A hyphenated compound hides the option from the tokeniser ("the £59-at-release path"). Every clause is
 * read twice — as written and with inner hyphens split — and a claim found either way counts once.
 * Corpus v4 (65 real withheld replies, blind-labelled): the split alone took recall from 12 to 24 of 34.
 */
const splitInnerHyphens = (t: string): string => t.replace(/(\w)-(\w)/g, '$1 $2');

export function leaderClaimsIn(text: string, matchers: readonly OptionMatcher[], otherLabels: readonly string[]): string[] {
  const out: string[] = [];
  const analysisSentence = ANALYSIS_CONTEXT.test(text);
  const asWritten = clausesOf(text);
  const split = clausesOf(splitInnerHyphens(text));
  for (const [i, clause] of [...asWritten, ...split].entries()) {
    if (i >= asWritten.length && out.includes(asWritten[i - asWritten.length] ?? '')) continue;
    if (optionsNamedIn(clause, matchers).length === 0) continue;
    const masked = maskOptions(clause, matchers, otherLabels).replace(ROLE_LEAD, ' role ');
    if (NOT_ASSERTED_ANYWHERE.test(masked)) continue;
    const cues = [LEADER_CUE.exec(masked), analysisSentence ? WEAK_LEADER_CUE.exec(masked) : null].filter((m) => m !== null);
    if (cues.length === 0) continue;
    const at = Math.min(...cues.map((m) => m.index));
    if (NOT_ASSERTED_BEFORE_CUE.test(masked.slice(0, at))) continue;
    out.push(clause);
  }
  return out;
}

const nonOptionLabels = (v: ReplyView): string[] => v.nodes.filter((n) => n.kind !== 'option').map((n) => n.label);

export function checkLeaderHonesty(v: ReplyView, sentences: readonly Sentence[]): CheckResult {
  const claim = v.leaderClaim;
  if (claim === null || claim.permitted === null) {
    return result('LEADER_HONESTY', 'NOT_DECIDABLE', 'no analysis_state.leader_claim.permitted on this response');
  }
  if (claim.permitted === true) {
    return result('LEADER_HONESTY', 'PASS', 'leader_claim.permitted is true — naming a leader is allowed', [], true);
  }
  if (v.optionLabels.length === 0) {
    return result('LEADER_HONESTY', 'NOT_DECIDABLE', 'leader withheld, but the response carries no option labels to recognise');
  }
  const matchers = buildOptionMatchers(v.optionLabels);
  const others = nonOptionLabels(v);
  const findings: Finding[] = [];
  for (const s of sentences) {
    for (const c of leaderClaimsIn(s.text, matchers, others)) findings.push({ kind: 'names_leader_while_withheld', where: s.where, excerpt: excerpt(c) });
  }
  const why = `leader_claim.permitted=false (${claim.withheldReason ?? 'no reason given'}${claim.separation ? `, separation ${claim.separation}` : ''})`;
  if (findings.length > 0) return result('LEADER_HONESTY', 'FAIL', `names an option as leading while ${why}`, findings);
  return result('LEADER_HONESTY', 'PASS', `no option named as leading; ${why}`);
}

// ======================================================================
// ACTION_TRUTH — a save / run / proposal claim the tool calls do not support
// ======================================================================

const EXTRA_SAVE = /\bI(?:['’]ve| have)\s+(?:built|created|set up|changed|removed|deleted|connected)\b|\b(?:is|are) now (?:in the model|saved|linked|connected)\b|\bhas been (?:saved|added|applied|updated|changed|recorded)\b|\b(?:is|are) saved\b|^Updated\b.*\bfrom\b.*\bto\b|\bis in the model\b/i;
const SAVE_NEGATION = /\b(?:not|no|nothing|never|yet|cannot|if|once|until|when|before|unless)\b|n['’]t\b/i;
const RUN_CLAIM = /\bI(?:['’]ve| have)?\s+(?:re-?run|ran|run)\s+(?:the\s+)?(?:analysis|comparison|model)\b|\bre-?run (?:is )?complete\b|\b(?:the\s+)?(?:re-?run|analysis) (?:has )?(?:now )?(?:finished|completed)\b|\bthe re-?run (?:shows|finds)\b|\bthis (?:re-?)?run (?:shows|finds|puts|gives)\b|\bran the (?:analysis|comparison)\b|\b(?:has|have) been (?:re-?)?run\b/i;
const RUN_NEGATION = /\b(?:not|no|never|cannot|if|once|until|when|before|unless)\b|n['’]t\b/i;
const PROPOSAL_CLAIM = /\bI(?:['’]ve| have)?\s+propose[ds]?\b|\bI(?:['’]m| am) proposing\b|\bhere(?: is|['’]s) (?:a|the|my) (?:proposal|proposed|starting point)\b|\bif you approve\b|\bonce you approve\b|\bapprove (?:these|this|it|adding|the (?:proposal|change|assumptions?))\b|\bawaiting your approval\b|\bpending (?:your )?approval\b|\b(?:ready )?for your approval\b|\bI can (?:save|add|apply) (?:the following|these|this|it)\b/i;
const PROPOSAL_NEGATION = /\b(?:cannot|can['’]t|won['’]t|not|never|no longer)\b/i;
const PROMISE_RUN = /\b(?:I['’]ll|I will|we['’]ll|Olumi will|it will|and|so (?:that )?I can|then I can)\s+(?:then\s+)?(?:save\b[^.]{0,60}?\band\s+)?(?:run|re-?run) (?:the |a |your )?(?:first )?(?:comparison|analysis)\b|\b(?:comparison|analysis) will (?:then |automatically |now )?(?:re-?)?run\b/i;
const APPROVAL_CONTEXT = /\bapprov|\badopt|\buse (?:these|those|them)\b|\bsay ["“]?yes\b/i;

const PROPOSERS = new Set(['propose_starting_point', 'propose_assumptions', 'propose_option_interventions', 'propose_model_change', 'propose_new_option']);

export function checkActionTruth(v: ReplyView, sentences: readonly Sentence[], ctx: CheckContext): CheckResult {
  if (v.replayed) {
    return result('ACTION_TRUTH', 'NOT_DECIDABLE', 'replayed reply: it carries no tool calls of its own, and the original turn’s are not attached');
  }
  const wrote = v.toolCalls.some((t) => WRITE_TOOLS.includes(t.name) && t.mutated === true) || (v.exitPath === 'agent_lane_forwarded' && v.hasGraphPatch);
  const ran = ranAnalysisThisTurn(v);
  const offered = v.chips.some((c) => c.id.startsWith('agent-approve-proposal')) || v.toolCalls.some((t) => PROPOSERS.has(t.name) && t.ok === true);
  const findings: Finding[] = [];
  let claims = 0;
  let undecidable = 0;
  for (const s of sentences) {
    const t = s.text.replace(/\*\*/g, '');
    if (assertsCompletedWrite(t) || (EXTRA_SAVE.test(t) && !SAVE_NEGATION.test(t))) {
      claims += 1;
      if (!wrote) findings.push({ kind: 'save_claim_without_write', where: s.where, excerpt: excerpt(t) });
    }
    if (RUN_CLAIM.test(t) && !RUN_NEGATION.test(t)) {
      claims += 1;
      if (!ran) findings.push({ kind: 'run_claim_without_run', where: s.where, excerpt: excerpt(t) });
    }
    if (PROPOSAL_CLAIM.test(t) && !PROPOSAL_NEGATION.test(t)) {
      claims += 1;
      if (!offered) findings.push({ kind: 'proposal_claim_without_proposal', where: s.where, excerpt: excerpt(t) });
    }
    if (PROMISE_RUN.test(t) && APPROVAL_CONTEXT.test(t)) {
      claims += 1;
      if (ctx.nextApprovalRan === false) findings.push({ kind: 'promises_run_after_approval', where: s.where, excerpt: excerpt(t) });
      else if (ctx.nextApprovalRan === null) undecidable += 1;
    }
  }
  const support = `write=${wrote} run=${ran} proposal_offered=${offered}`;
  if (findings.length > 0) return result('ACTION_TRUTH', 'FAIL', `claim not supported by this turn's tool calls/chips (${support})`, findings);
  if (undecidable > 0) {
    return result(
      'ACTION_TRUTH',
      'NOT_DECIDABLE',
      `promises the analysis will run on approval; no later approval in this conversation was captured to test it (${support})`,
    );
  }
  if (claims === 0) return result('ACTION_TRUTH', 'PASS', 'no save/run/proposal claim in the text', [], true);
  return result('ACTION_TRUTH', 'PASS', `${claims} action claim(s), all supported (${support})`);
}

// ======================================================================
// OPTION_NAME_FIDELITY — an option quoted under a name the model does not hold
// ======================================================================

const SPAN = /\*\*([^*\n]{2,80}?)\*\*|“([^”\n]{2,80}?)”|"([^"\n]{2,80}?)"/g;

const orderedTokens = (s: string): string[] => tokensOf(s).filter((t) => !['a', 'an', 'the'].includes(t));

/** "hiring" / "hire", "raising" / "raise", "running" / "run": the same verb, inflected — not a rename. */
function sameVerb(a: string, b: string): boolean {
  if (a === b) return true;
  const bases = (t: string): string[] => (t.endsWith('ing') ? [t.slice(0, -3), `${t.slice(0, -3)}e`, t.slice(0, -4)] : [t]);
  return bases(a).includes(b) || bases(b).includes(a);
}

/** The span IS the option: same ordered content tokens (the leading verb may be inflected), or it contains them contiguously. */
function spanNamesOption(span: string, o: OptionMatcher): boolean {
  if (o.phrases.includes(span)) return true;
  const s = orderedTokens(span);
  // The short form (leading verb dropped) counts only when it STARTS the span ("Tech Lead
  // leads"): anything before it could be a swapped verb ("Keep £49 …" ⊃ "£49 with release").
  if (o.phrases.some((p) => { const l = orderedTokens(p); return l.length > 0 && l.every((t, k) => s[k] === t); })) return true;
  const full = orderedTokens(o.label);
  if (full.length === 0) return false;
  for (let i = 0; i + full.length <= s.length; i += 1) {
    if (full.every((t, k) => (k === 0 ? sameVerb(s[i]!, t) : s[i + k] === t))) return true;
  }
  return false;
}

const NUMBER_WORD = /\b(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/;

export function checkOptionNameFidelity(v: ReplyView, split: TextSplit): CheckResult {
  if (v.optionLabels.length === 0) return result('OPTION_NAME_FIDELITY', 'NOT_DECIDABLE', 'the response carries no option labels');
  const matchers = buildOptionMatchers(v.optionLabels);
  const others = v.nodes.filter((n) => n.kind !== 'option').map((n) => norm(n.label));
  const findings: Finding[] = [];
  let exact = 0;
  for (const [where, text] of [['model', split.modelText], ['server', split.serverText]] as const) {
    for (const m of text.matchAll(SPAN)) {
      const raw = (m[1] ?? m[2] ?? m[3] ?? '').trim().replace(/[:.,;]+$/, '');
      const span = norm(raw).replace(/^(?:a|an|the)\s+/, '');
      if (span === '' || span.split(' ').length > 8) continue;
      if (matchers.some((o) => spanNamesOption(span, o))) {
        exact += 1;
        continue;
      }
      if (others.some((l) => span === l || span.includes(l))) continue;
      const st = new Set(tokensOf(span));
      if (st.size === 0) continue;
      // A quantity phrase ("1 full-time Tech Lead", "one Tech lead") is a figure, not an option name.
      const quantity = NUMBER_WORD.test(span);
      let best: { label: string; jac: number; shared: number } | null = null;
      for (const o of matchers) {
        if (quantity && !NUMBER_WORD.test(norm(o.label))) continue;
        const ot = new Set(tokensOf(o.phrases[o.phrases.length - 1]!));
        const shared = [...st].filter((t) => ot.has(t)).length;
        const jac = shared / new Set([...st, ...ot]).size;
        if (best === null || jac > best.jac) best = { label: o.label, jac, shared };
      }
      const text = `“${raw}” ≠ option “${best?.label ?? ''}”`;
      if (best !== null && best.jac >= 0.5 && best.shared >= 2 && !findings.some((f) => f.excerpt === text)) {
        findings.push({ kind: 'option_renamed', where, excerpt: text });
      }
    }
  }
  if (findings.length > 0) return result('OPTION_NAME_FIDELITY', 'FAIL', 'quotes an option under a name that is not its label', findings);
  if (exact === 0) return result('OPTION_NAME_FIDELITY', 'PASS', 'no quoted option name', [], true);
  return result('OPTION_NAME_FIDELITY', 'PASS', `${exact} quoted option name(s), all matching labels`);
}

// ======================================================================
// Figure binding (shared by UNITS and PROVENANCE_WORDING)
// ======================================================================

interface NumberAt {
  readonly value: number;
  readonly index: number;
  readonly end: number;
  readonly currency: string | null;
}

const NUMBER = /(?:([£$€])\s?)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?/g;

/** Numbers in a string, with positions. A number glued to a letter ("£70k", "3m", "2x") is a different magnitude and is skipped. */
function numbersIn(s: string): NumberAt[] {
  const out: NumberAt[] = [];
  for (const m of s.matchAll(NUMBER)) {
    const index = m.index ?? 0;
    const end = index + m[0].length;
    const before = s[index - 1];
    if (before !== undefined && /[\w.]/.test(before)) continue;
    if (/^[a-z]/i.test(s.slice(end, end + 1))) continue;
    const value = Number(`${m[2]!.replace(/,/g, '')}${m[3] ? `.${m[3]}` : ''}`);
    out.push({ value, index, end, currency: m[1] ?? null });
  }
  return out;
}

/** The clause as matched text: emphasis removed, curly quotes straightened, lower-cased (positions preserved 1:1 after the first step). */
const flat = (clause: string): string => clause.replace(/\*\*/g, '').replace(/[“”]/g, '"').replace(/[‘’]/g, "'").toLowerCase();

/** A figure is BOUND to a label only when it is the nearest number to an occurrence of that label, within this many characters. */
const BIND_WINDOW = 40;

/**
 * The numbers bound to any of `phrases` in `f` (a flattened clause). Numbers INSIDE a phrase occurrence
 * (an option named "Pilot £59 at Release") belong to the label, not to a value.
 */
function boundTo(f: string, phrases: readonly string[]): NumberAt[] {
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

// ======================================================================
// UNITS — a model figure quoted without its unit (or as its normalised value)
// ======================================================================

/** Binary indicators (1 = yes) carry no unit a reader needs. */
const INDICATOR_UNIT = /1\s*=\s*yes|yes\s*\/\s*no|binary|boolean|true\s*\/\s*false/i;

export function unitPresent(unit: string, s: string, at: { index: number; end: number; currency: string | null }): boolean {
  const after = s.slice(at.end, at.end + 48).replace(/\*\*/g, '');
  const u = unit.toLowerCase();
  if (/%|percent|per ?cent/.test(u)) return /^[\s-]?(?:%|per ?cent|percent|percentage[\s-]points?)/i.test(after);
  if (/gbp|£|pound/.test(u)) return at.currency === '£' || /^\s?(?:gbp|pounds?)\b/i.test(after);
  if (/usd|\$|dollar/.test(u)) return at.currency === '$' || /^\s?(?:usd|dollars?)\b/i.test(after);
  if (/eur|€|euro/.test(u)) return at.currency === '€' || /^\s?(?:eur|euros?)\b/i.test(after);
  const scale = /out of (\d+)/i.exec(unit);
  if (scale !== null && new RegExp(String.raw`^\s?(?:/\s?|out of\s)${scale[1]}\b`, 'i').test(after)) return true;
  const want = tokensOf(unit).filter((t) => !/^\d+$/.test(t));
  if (want.length === 0) return true;
  const got = new Set(tokensOf(after.split(/\s+/).slice(0, 6).join(' ')));
  return want.some((t) => got.has(t));
}

interface UnitFigure {
  readonly label: string;
  readonly phrases: readonly string[];
  readonly raw: number;
  readonly unit: string;
  readonly normalised: number | null;
}

function unitFigures(v: ReplyView): UnitFigure[] {
  const matchers = new Map(buildOptionMatchers(v.optionLabels).map((m) => [m.label, m]));
  const factors = v.nodes
    .filter((n) => n.kind === 'factor' && n.observed?.rawValue != null && (n.observed?.unit ?? '') !== '' && !INDICATOR_UNIT.test(n.observed!.unit!))
    .map((n) => ({ label: n.label, phrases: [n.label], raw: n.observed!.rawValue!, unit: n.observed!.unit!, normalised: n.observed!.value }));
  const levels = v.optionLevels
    .filter((l) => l.rawValue !== null && (l.unit ?? '') !== '' && !INDICATOR_UNIT.test(l.unit!))
    .map((l) => ({
      label: `${l.optionLabel} → ${l.factorLabel ?? l.factorId}`,
      phrases: matchers.get(l.optionLabel)?.phrases ?? [l.optionLabel],
      raw: l.rawValue!,
      unit: l.unit!,
      normalised: null,
    }));
  return [...factors, ...levels];
}

export function checkUnits(v: ReplyView, sentences: readonly Sentence[]): CheckResult {
  const figs = unitFigures(v);
  if (figs.length === 0) {
    return result('UNITS', 'NOT_DECIDABLE', 'no unit-bearing value on the response’s draft_graph/analysis_ready to bind a figure to');
  }
  const findings: Finding[] = [];
  const seen = new Set<string>();
  let bound = 0;
  for (const s of sentences) {
    for (const clause of clausesOf(s.text, { colon: false })) {
      const f = flat(clause);
      for (const c of figs) {
        for (const at of boundTo(f, c.phrases)) {
          const key = `${s.where}|${clause}|${at.index}`;
          const isRaw = Math.abs(at.value - c.raw) < 1e-9;
          const nv = c.normalised;
          const isNormalised = nv !== null && nv > 0 && nv < 1 && Math.abs(nv - c.raw) > 1e-9 && at.value < 1 && Math.abs(at.value - nv) < 1e-9;
          if ((!isRaw && !isNormalised) || seen.has(key)) continue;
          seen.add(key);
          bound += 1;
          if (isNormalised) {
            findings.push({ kind: 'normalised_value_quoted', where: s.where, excerpt: `${c.label}: normalised ${nv} quoted — ${excerpt(clause, 120)}` });
          } else if (!unitPresent(c.unit, f, at)) {
            findings.push({ kind: 'figure_without_unit', where: s.where, excerpt: `${c.label}: ${c.raw} (unit “${c.unit}”) — ${excerpt(clause, 120)}` });
          }
        }
      }
    }
  }
  if (findings.length > 0) return result('UNITS', 'FAIL', 'a model figure is quoted without its unit, or as its normalised value', findings);
  if (bound === 0) return result('UNITS', 'PASS', 'no model figure quoted next to its factor or option', [], true);
  return result('UNITS', 'PASS', `${bound} model figure(s) quoted, all with their unit`);
}

// ======================================================================
// PROVENANCE_WORDING — a user's figure called Olumi's, or Olumi's the user's
// ======================================================================

const AI_CUE = /\b(?:my|Olumi['’]s|machine[- ](?:authored|proposed|generated)|AI|model[- ]proposed)\s+(?:own\s+)?(?:estimates?|assumptions?|guess(?:es)?|placeholders?|figures?|numbers?|values?)\b|\bI (?:assumed|estimated|guessed|proposed|chose|picked)\b|\bplaceholders?\b|\bnot (?:a )?measurements?\b|\b(?:starting|working|illustrative) assumptions?\b|\bmachine[- ](?:authored|proposed)\b|\billustrative\b/i;
const USER_CUE = /\byour (?:own )?(?:figure|number|value|estimate|input)\b|\byou (?:said|stated|gave|set|entered|told|specified|provided)\b|\bfrom your brief\b|\bas you (?:said|stated)\b/i;

interface ProvFigure {
  readonly phrases: readonly string[];
  readonly raw: number;
  readonly origin: 'user_brief' | 'ai';
  readonly label: string;
}

export function checkProvenanceWording(v: ReplyView, sentences: readonly Sentence[]): CheckResult {
  const matchers = new Map(buildOptionMatchers(v.optionLabels).map((m) => [m.label, m]));
  const figures: ProvFigure[] = [];
  let userOverride = 0;
  for (const n of v.nodes) {
    if (n.kind !== 'factor' || n.observed?.rawValue == null) continue;
    if (n.observed.source === 'brief_extraction') figures.push({ phrases: [n.label], raw: n.observed.rawValue, origin: 'user_brief', label: n.label });
    else if (n.provenance === 'ai_inferred' && n.observed.source === null) figures.push({ phrases: [n.label], raw: n.observed.rawValue, origin: 'ai', label: n.label });
    else userOverride += 1;
  }
  for (const l of v.optionLevels) {
    if (l.source === 'brief_extraction' && l.rawValue !== null) {
      figures.push({
        phrases: matchers.get(l.optionLabel)?.phrases ?? [l.optionLabel],
        raw: l.rawValue,
        origin: 'user_brief',
        label: `${l.optionLabel} → ${l.factorLabel ?? l.factorId}`,
      });
    }
  }
  const briefValues = new Set(figures.filter((f) => f.origin === 'user_brief').map((f) => f.raw));
  const findings: Finding[] = [];
  let decided = 0;
  for (const s of sentences) {
    const sentenceNums = numbersIn(flat(s.text)).map((x) => x.value);
    for (const clause of clausesOf(s.text, { colon: false })) {
      const f = flat(clause);
      for (const fig of figures) {
        if (!boundTo(f, fig.phrases).some((x) => Math.abs(x.value - fig.raw) < 1e-9)) continue;
        decided += 1;
        if (fig.origin === 'user_brief') {
          // A list headed "my assumptions:" labels its bullets — but only a bullet that proposes nothing new.
          const inHeader = s.isBullet && s.header !== null && AI_CUE.test(s.header) && sentenceNums.every((x) => briefValues.has(x));
          if (AI_CUE.test(clause) || inHeader) {
            findings.push({
              kind: 'user_figure_called_ai',
              where: s.where,
              excerpt: `${fig.label} = ${fig.raw} (from the brief) — ${excerpt(inHeader ? `${s.header} … ${clause}` : clause, 140)}`,
            });
          }
        } else if (USER_CUE.test(clause)) {
          findings.push({ kind: 'ai_figure_called_users', where: s.where, excerpt: `${fig.label} = ${fig.raw} (machine-inferred) — ${excerpt(clause, 140)}` });
        }
      }
    }
  }
  if (findings.length > 0) return result('PROVENANCE_WORDING', 'FAIL', 'a figure’s origin is misattributed', findings);
  if (decided === 0) {
    return result(
      'PROVENANCE_WORDING',
      'NOT_DECIDABLE',
      `no figure with decidable value-level provenance is quoted (brief_extraction / unattributed ai_inferred); ${userOverride} value(s) are user_override, which covers both a user's own entry and an adopted Olumi proposal`,
    );
  }
  return result('PROVENANCE_WORDING', 'PASS', `${decided} figure(s) with decidable provenance quoted, none misattributed`);
}

// ======================================================================
// CAVEAT — a fragile / tied / withheld / blocked result carries a caveat
// ======================================================================

const FRAGILITY_CUE = /fragile|near[- ]tie|close call|too close|effectively tied|\btied\b|uncertain(?:ty)?|not (?:yet )?(?:robust|settled|decisive|established|separated|a (?:settled|firm|reliable))|(?:does|do|did) not (?:yet )?(?:separate|establish|settle|answer|distinguish)|cannot (?:yet )?(?:answer|establish|settle|distinguish|separate|compare|name|be put forward|verify|validate)|no option can|provisional|sensitive to|small changes|(?:could|can|may|might) (?:flip|change|reverse|switch)|low (?:confidence|certainty)|certainty is (?:low|moderate)|not (?:actually )?(?:assessed|tested|evaluated|validated|verified|scored)|could not (?:be )?(?:assess|test|score|evaluate|validate|verify|align)|tentative|within (?:the )?noise|caveat|depends (?:heavily |partly )?on/i;
const BLOCKED_CUE = /did(?: not|n['’]t) run|not run|could(?: not|n['’]t) run|cannot (?:yet )?run|can['’]t (?:yet )?run|blocked|still needs|needs? (?:a|an|the|to|more)\b|missing|before (?:it|the analysis|all options|a (?:fresh )?comparison) can/i;

/**
 * Why a caveat is owed on this turn — empty when none is (or when the turn reports no analysis,
 * `applicable: false`). Shared by the check and the fixture's `expect.caveat_reasons`.
 */
export function caveatReasons(v: ReplyView, cls: CaseClass): { applicable: boolean; blocked: boolean; reasons: string[] } {
  const applicable = REPORTS_ANALYSIS.has(cls) || (v.hasAnalysisResult && ranAnalysisThisTurn(v));
  const blocked = cls === 'run_blocked' || runBlockedThisTurn(v);
  const reasons: string[] = [];
  if (!applicable) return { applicable, blocked, reasons };
  if (blocked) reasons.push('blocked');
  if (v.hasAnalysisResult && (v.robustnessLevel === 'low' || v.robustnessLevel === 'very_low')) reasons.push(`robustness ${v.robustnessLevel}`);
  if (v.nearTie === true || v.leaderClaim?.separation === 'near_tie') reasons.push('near tie');
  if (v.hasAnalysisResult && v.leaderClaim?.permitted === false) reasons.push(`leader withheld: ${v.leaderClaim.withheldReason ?? 'no reason given'}`);
  return { applicable, blocked, reasons };
}

export function checkCaveat(v: ReplyView, sentences: readonly Sentence[], ctx: CheckContext): CheckResult {
  const { applicable, blocked, reasons } = caveatReasons(v, ctx.cls);
  if (!applicable) return result('CAVEAT', 'PASS', 'this turn does not report an analysis', [], true);
  if (reasons.length === 0) {
    if (v.leaderClaim === null && v.robustnessLevel === null && !blocked) {
      return result('CAVEAT', 'NOT_DECIDABLE', 'no robustness / leader_claim / run outcome on the response to decide whether a caveat is owed');
    }
    return result('CAVEAT', 'PASS', 'no caveat owed (robust, separated, permitted, not blocked)', [], true);
  }
  const cue = blocked ? BLOCKED_CUE : FRAGILITY_CUE;
  const hit = sentences.find((s) => cue.test(s.text));
  if (hit === undefined) {
    return result('CAVEAT', 'FAIL', `caveat owed (${reasons.join('; ')}) but none stated`, [
      { kind: 'caveat_missing', where: 'model', excerpt: excerpt(sentences[0]?.text ?? '', 120) },
    ]);
  }
  return result('CAVEAT', 'PASS', `caveat owed (${reasons.join('; ')}) and stated: “${excerpt(hit.text, 100)}”`);
}

// ======================================================================
// 8. INTERNAL_ID — an identifier the user cannot act on, shown in the reply.
//
// Witnessed on served 9b7767b (typed approval): "the model moved from revision `d438351b509a4c56` to
// `212fc69c44d1732a`". A revision/graph hash, a proposal id or a UUID tells the user nothing and
// leaks internal state. A hex run counts only when it mixes letters and digits and is 12+ long, so
// figures (£20,000, 2026, 52%) are never mistaken for one.

const INTERNAL_ID_PATTERNS: readonly (readonly [string, RegExp])[] = [
  ['proposal_id', /\bprop_[0-9a-f]{6,}\b/gi],
  ['uuid', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi],
  ['hex_hash', /(?<![0-9a-z_-])(?=[0-9a-f]*[a-f])(?=[0-9a-f]*[0-9])[0-9a-f]{12,64}(?![0-9a-z_-])/gi],
];

export function internalIdsIn(text: string): { kind: string; id: string }[] {
  const out: { kind: string; id: string }[] = [];
  const seen = new Set<string>();
  for (const [kind, re] of INTERNAL_ID_PATTERNS) {
    for (const m of text.matchAll(re)) {
      const id = m[0];
      if ([...seen].some((x) => x.includes(id))) continue; // a UUID's own hex runs are not a second finding
      seen.add(id);
      out.push({ kind, id });
    }
  }
  return out;
}

export function checkInternalId(split: TextSplit): CheckResult {
  const findings: Finding[] = [];
  for (const [where, text] of [['model', split.modelText], ['server', split.serverText]] as const) {
    for (const f of internalIdsIn(text)) findings.push({ kind: f.kind, where, excerpt: f.id });
  }
  return findings.length > 0
    ? result('INTERNAL_ID', 'FAIL', `the reply shows ${findings.length} internal identifier(s) the user cannot act on`, findings)
    : result('INTERNAL_ID', 'PASS', 'no revision hash, proposal id or UUID in the reply');
}

// ======================================================================

export function runChecks(v: ReplyView, split: TextSplit, ctx: CheckContext): Record<CheckName, CheckResult> {
  const sentences = sentencesOfSplit(split);
  return {
    CONTROL_REFERENCE: checkControlReference(v, split),
    LEADER_HONESTY: checkLeaderHonesty(v, sentences),
    ACTION_TRUTH: checkActionTruth(v, sentences, ctx),
    OPTION_NAME_FIDELITY: checkOptionNameFidelity(v, split),
    UNITS: checkUnits(v, sentences),
    PROVENANCE_WORDING: checkProvenanceWording(v, sentences),
    CAVEAT: checkCaveat(v, sentences, ctx),
    INTERNAL_ID: checkInternalId(split),
  };
}
