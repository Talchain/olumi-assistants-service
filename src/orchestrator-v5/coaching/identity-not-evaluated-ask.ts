/**
 * THE IDENTITY ASK — ISL's blocked 422 `IDENTITY_NOT_EVALUATED` said as the one question that unblocks it, never as
 * "the analysis failed" (batch 7; R&C CLAIM #72 5860867216; AI Quality meaning spec #72 5860888736).
 *
 * ── WHY ───────────────────────────────────────────────────────────────────
 * ISL #187 evaluates a declared accounting identity (MRR = price × subscribers) in user units, or WITHHOLDS the
 * whole analysis rather than approximate it, when the decision depends on it. Before this module that honest
 * refusal reached the user as the generic blocked copy ("Try simplifying options or constraints"), which names
 * nothing the user can fix. What unblocks it is always one question about the figures that define the identity.
 *
 * ── WHAT IT READS (typed facts only — never the critique's prose message) ──
 *   · the critique's typed `identity` block (R&C → CLOUD-1 #72 5860893532): `withheld_reason` and, for
 *     `identity_inconsistent`, the `reconstructed` / `stated` figures ISL compared, in the target's user units;
 *   · without it, only `affected_node_ids` (`[target, ...participants]`, typed today): the ask then names the
 *     identity and makes NO numeric claim;
 *   · CEE's OWN graph for the words: each node's `label`, the target's `nonlinear_identity` declaration (which
 *     participants are operands; the rest are addends), whose figure the target's level is
 *     (`classifyValueSource`, the one authority), and each participant's own level/unit.
 * No figure is recomputed here: the only numbers said are the two ISL compared.
 */
import { classifyValueSource } from '../../cee/graph-readiness/obligation-provenance.js';
import { CURRENCY_SYMBOL_TO_CODE } from '../../utils/currency-alphabet.js';
import { sayLevel } from './bound-graph.js';
import { sayFigure as sayLaneFigure } from '../agent-lane/say-figure.js';

export const IDENTITY_NOT_EVALUATED_CODE = 'IDENTITY_NOT_EVALUATED';

export const IDENTITY_WITHHELD_REASONS = [
  'identity_inconsistent',
  'identity_operand_missing',
  'identity_zero_level',
  'identity_frame_missing',
] as const;
export type IdentityWithheldReason = (typeof IDENTITY_WITHHELD_REASONS)[number];
/** `unstated`: the critique carried no typed reason, so the ask names the identity and nothing more. */
export type IdentityAskReason = IdentityWithheldReason | 'unstated';

export interface IdentityAsk {
  readonly reason: IdentityAskReason;
  readonly node_id: string;
  readonly assistant_text: string;
  readonly chip_label: string;
  readonly chip_message: string;
}

interface Withheld {
  readonly nodeId: string;
  readonly participants: readonly string[];
  readonly reason: IdentityAskReason;
  readonly reconstructed: number | null;
  readonly stated: number | null;
}

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec | null => (v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Rec) : null);
const finite = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const ids = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string' && x.length > 0) ? (v as string[]) : null;

function readWithheld(critique: Rec): Withheld | null {
  const typed = rec(critique.identity);
  if (typed !== null) {
    const nodeId = typeof typed.node_id === 'string' && typed.node_id.length > 0 ? typed.node_id : null;
    const participants = ids(typed.participants);
    const reason = (IDENTITY_WITHHELD_REASONS as readonly unknown[]).includes(typed.withheld_reason)
      ? (typed.withheld_reason as IdentityWithheldReason)
      : null;
    if (nodeId !== null && participants !== null && reason !== null) {
      return { nodeId, participants, reason, reconstructed: finite(typed.reconstructed), stated: finite(typed.stated) };
    }
  }
  const affected = ids(critique.affected_node_ids);
  if (affected === null || affected.length < 2) return null;
  return { nodeId: affected[0]!, participants: affected.slice(1), reason: 'unstated', reconstructed: null, stated: null };
}

/** The prefix symbol for an ISO currency code, from the ONE currency alphabet (never a hand-written `£$€`). */
const CODE_TO_PREFIX_SYMBOL: ReadonlyMap<string, string> = (() => {
  const out = new Map<string, string>();
  for (const [symbol, code] of Object.entries(CURRENCY_SYMBOL_TO_CODE)) {
    if (!/^[a-z]+$/i.test(symbol) && !out.has(code.toUpperCase())) out.set(code.toUpperCase(), symbol);
  }
  return out;
})();

/**
 * A figure in its node's unit, as a person says it: "GBP MRR" on "MRR" → "£75,000"; "GBP per month" → "£49 per
 * month"; "subscribers" → "1,500 subscribers". A currency code's remainder is dropped only when it repeats the
 * node's own name ("MRR" on "MRR").
 */
export function sayFigure(value: number, unit: unknown, label: string): string {
  const u = typeof unit === 'string' ? unit.trim() : '';
  // The leading token up to a space OR a "/" (AIQ 5887805333: "GBP/subscriber/month" read as "49 GBP/subscriber/month").
  const head = /^([^\s/]+)(.*)$/.exec(u);
  const lead = head?.[1] ?? '';
  const isMoney = CODE_TO_PREFIX_SYMBOL.has(lead.toUpperCase()) || [...CODE_TO_PREFIX_SYMBOL.values()].includes(lead);
  if (!isMoney) return sayLevel(Math.round(value * 100) / 100, u);
  const rest = (head?.[2] ?? '').trim();
  // Money is said in whole units here (a reconstructed total, never pence), through the lane's ONE figure formatter.
  return sayLaneFigure(Math.round(value), rest === '' || label.toLowerCase().includes(rest.toLowerCase()) ? lead : u);
}

const q = (label: string): string => `“${label}”`;

/**
 * ⭐ AN OPERAND AN OPTION CREATES IS 0 TODAY — NEVER "WHAT IS IT TODAY?" (Science d5 #87 6007736377; DL 6 Oct, rehearsal 14
 * on CEE 6ce136c: "I need ‘Starter-tier subscribers’: what is it today?" for a tier the brief says has not launched).
 * Creation evidence ONLY: a stored typed 0, or an option whose label carries a creation verb (launch / introduce / start /
 * new) and whose path reaches the operand. An option that merely targets it ("Offer a 10% discount") changes an existing
 * level nobody gave, so its operand is still asked about today.
 */
// The option's OWN action (Codex buddy r1 P1): its label opens with the verb or with "new" ("Launch starter tier", "New
// starter tier"). "Keep the new pricing" changes an existing level, so it is no creation evidence.
const CREATION_VERB = /^\s*(?:launch(?:es|ed|ing)?|introduc(?:e|es|ed|ing)|start(?:s|ed|ing)?|(?:an? )?new)\b/i;

interface Creator {
  /** Every option that would start it, in node order; the ones whose own level is missing are asked (none dropped). */
  readonly options: readonly string[];
  readonly missingLevel: readonly string[];
  readonly level: { readonly value: number; readonly unit: string } | null;
}

function creatorOf(graph: unknown, operandId: string, storedZero: boolean): Creator | null {
  const g = rec(graph);
  const nodes = (Array.isArray(g?.nodes) ? g.nodes : []).map(rec).filter((n): n is Rec => n !== null && typeof n.id === 'string');
  const edges = (Array.isArray(g?.edges) ? g.edges : []).map(rec)
    .filter((e): e is Rec => e !== null && typeof e.from === 'string' && typeof e.to === 'string');
  const reaches = (from: string): boolean => {
    const seen = new Set<string>([from]); const walk = [from];
    while (walk.length > 0) {
      const at = walk.pop()!;
      for (const e of edges) if (e.from === at && !seen.has(e.to as string)) {
        if (e.to === operandId) return true;
        seen.add(e.to as string); walk.push(e.to as string);
      }
    }
    return false;
  };
  const options: string[] = []; const missingLevel: string[] = [];
  let level: Creator['level'] = null;
  for (const o of nodes.filter((n) => n.kind === 'option' && n.is_baseline !== true && typeof n.label === 'string')) {
    const sets = rec(rec(o.interventions)?.[operandId]);
    if (!(sets !== null || reaches(o.id as string))) continue;
    if (!storedZero && !CREATION_VERB.test(o.label as string)) continue;
    // (ii) the option's own level, when the brief states it (its span: "about 150, between 80 and 250").
    const value = finite(sets?.raw_value) ?? finite(sets?.value);
    const label = (o.label as string).trim();
    options.push(label);
    if (value === null) missingLevel.push(label);
    else level ??= { value, unit: typeof sets?.unit === 'string' ? sets.unit : '' };
  }
  return options.length === 0 ? null : { options, missingLevel, level };
}

/** "How many" for a count, "How much" for money or a share (Science's words, (iii)). */
function howMuch(unit: unknown): string {
  const u = typeof unit === 'string' ? unit.trim() : '';
  const lead = /^([^\s/]+)/.exec(u)?.[1] ?? '';
  const money = CODE_TO_PREFIX_SYMBOL.has(lead.toUpperCase()) || [...CODE_TO_PREFIX_SYMBOL.values()].some((sym) => u.startsWith(sym));
  return money || /%|percent|share|rate/i.test(u) ? 'How much' : 'How many';
}

const quotedList = (xs: readonly string[]): string => andList(xs.map((x) => `‘${x}’`));

/**
 * Science's words, verbatim: said once, then the ONE question only for the options whose own level is missing — every
 * one of them (Codex buddy r1 P1: node order must never decide whether a needed question disappears).
 */
function createdOperandAsk(operand: string, creator: Creator, unit: unknown): { text: string; label: string; message: string } {
  const zero = `‘${operand}’ is 0 today, since ${quotedList(creator.options)} would start it.`;
  if (creator.missingLevel.length === 0) {
    return { text: zero, label: 'Use 0 today', message: `Set ‘${operand}’ to 0 today: ${quotedList(creator.options)} would start it.` };
  }
  const each = creator.missingLevel.length > 1 ? ' each' : '';
  const question = `${howMuch(unit)} ‘${operand}’ would ${quotedList(creator.missingLevel)}${each} lead to? A best guess and a range is fine.`;
  return { text: `${zero} ${question}`, label: 'Give your best guess', message: `${question} Ask me for it.` };
}
const andList = (xs: readonly string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * The ask for the first `IDENTITY_NOT_EVALUATED` critique, or null (no such critique; a node the graph does not
 * hold or label — the caller then keeps the code's generic copy, which still never says "failed").
 */
export function composeIdentityNotEvaluatedAsk(critiques: unknown, graph: unknown): IdentityAsk | null {
  const critique = (Array.isArray(critiques) ? critiques : []).map(rec).find((c) => c?.code === IDENTITY_NOT_EVALUATED_CODE);
  if (critique === undefined || critique === null) return null;
  const w = readWithheld(critique);
  const nodes = rec(graph)?.nodes;
  if (w === null || !Array.isArray(nodes)) return null;
  const byId = new Map<string, Rec>();
  for (const n of nodes.map(rec)) if (n !== null && typeof n.id === 'string') byId.set(n.id, n);
  const labelOf = (id: string): string | null => {
    const l = byId.get(id)?.label;
    return typeof l === 'string' && l.trim() !== '' ? l.trim() : null;
  };
  const target = byId.get(w.nodeId);
  const T = labelOf(w.nodeId);
  const partLabels = w.participants.map(labelOf);
  if (target === undefined || T === null || partLabels.some((l) => l === null)) return null;

  // The formula from CEE's OWN declaration: its operands joined by the operation, the other participants added.
  const declared = rec(target.nonlinear_identity);
  const operation = declared?.operation === 'product' || declared?.operation === 'sum' ? declared.operation : null;
  const declaredOperands = ids(declared?.factor_ids) ?? [];
  const operands = w.participants.filter((p) => declaredOperands.includes(p));
  const addends = w.participants.filter((p) => !operands.includes(p));
  const say = (xs: readonly string[]): string[] => xs.map((id) => q(labelOf(id)!));
  const formula = operation !== null && operands.length > 0
    ? `${say(operands).join(operation === 'product' ? ' × ' : ' + ')}${addends.length > 0 ? ` + ${say(addends).join(' + ')}` : ''}`
    : null;
  // "as “P” × “S”" when CEE's declaration gives the formula; "from “P” and “S”" when it does not.
  const asFormula = formula !== null ? `as ${formula}` : `from ${andList(say(w.participants))}`;
  const levelOf = (id: string): number | null => {
    const os = rec(byId.get(id)?.observed_state);
    return finite(os?.raw_value) ?? finite(os?.value);
  };

  const unstated = (): IdentityAsk => ({
    reason: 'unstated',
    node_id: w.nodeId,
    assistant_text:
      `${q(T)} is worked out ${asFormula}, and it could not be worked out exactly from `
      + 'the figures in the model, so Olumi held the analysis back rather than approximate it. '
      + 'Which of these figures needs correcting?',
    chip_label: 'Check the figures',
    chip_message: `Help me check the figures that make up ${q(T)}.`,
  });

  switch (w.reason) {
    case 'identity_inconsistent': {
      if (w.reconstructed === null || w.stated === null || formula === null) return unstated();
      const unit = rec(target.observed_state)?.unit;
      const R = sayFigure(w.reconstructed, unit, T);
      const S = sayFigure(w.stated, unit, T);
      const owner = classifyValueSource(rec(target.observed_state)?.source);
      const statedClause = owner === 'user_stated' || owner === 'user_ratified'
        ? `you said ${q(T)} is ${S}`
        : owner === 'ai_drafted' || owner === 'system_repaired'
          ? `Olumi's estimate of ${q(T)} is ${S}`
          : `the model has ${q(T)} at ${S}`;
      return {
        reason: w.reason,
        node_id: w.nodeId,
        assistant_text:
          `The figures don't add up: ${formula} gives ${R}, but ${statedClause}. Which is right? `
          + `Or is there more ${q(T)} from somewhere that isn't in the model?`,
        chip_label: 'Check the figures',
        chip_message: `The figures for ${q(T)} don't add up. Help me work out which one is right.`,
      };
    }
    case 'identity_operand_missing': {
      const missing = w.participants.filter((p) => levelOf(p) === null);
      if (missing.length === 0) return unstated();
      // Creation is judged PER operand (Codex buddy r1 P1): a created one is 0 today; any other is still asked about today.
      const asks = missing.flatMap((p) => {
        const created = creatorOf(graph, p, false);
        return created === null ? [] : [createdOperandAsk(labelOf(p)!, created, rec(byId.get(p)?.observed_state)?.unit ?? created.level?.unit)];
      });
      const notCreated = missing.filter((p) => creatorOf(graph, p, false) === null);
      if (asks.length > 0) {
        const rest = notCreated.length === 0 ? ''
          : ` I also need ${andList(say(notCreated))}: what ${notCreated.length === 1 ? 'is it' : 'are they'} today?`;
        const restOne = notCreated.length === 1;
        return { reason: w.reason, node_id: w.nodeId, assistant_text: `To work out ${q(T)} ${asFormula}: ${asks.map((a) => a.text).join(' ')}${rest}`,
          chip_label: notCreated.length > 0 ? (restOne ? 'Give its value' : 'Give the values') : asks[0]!.label,
          chip_message: notCreated.length > 0
            ? `What ${restOne ? 'is' : 'are'} ${andList(say(notCreated))} today? Ask me for ${restOne ? 'it' : 'them'}.` : asks[0]!.message };
      }
      const one = missing.length === 1;
      return {
        reason: w.reason,
        node_id: w.nodeId,
        assistant_text: `To work out ${q(T)} ${asFormula}, I need ${andList(say(missing))}: `
          + `what ${one ? 'is it' : 'are they'} today?`,
        chip_label: one ? 'Give its value' : 'Give the values',
        chip_message: `What ${one ? 'is' : 'are'} ${andList(say(missing))} today? Ask me for ${one ? 'it' : 'them'}.`,
      };
    }
    case 'identity_zero_level': {
      const zeros = w.participants.filter((p) => levelOf(p) === 0);
      const zeroTarget = zeros.length === 0 && (w.stated === 0 || levelOf(w.nodeId) === 0);
      if (zeros.length === 0 && !zeroTarget) return unstated();
      const created = !zeroTarget && zeros.length === 1 ? creatorOf(graph, zeros[0]!, true) : null;
      if (created !== null) {
        const unit = rec(byId.get(zeros[0]!)?.observed_state)?.unit ?? created.level?.unit;
        const ask = createdOperandAsk(labelOf(zeros[0]!)!, created, unit);
        return { reason: w.reason, node_id: w.nodeId, assistant_text: `To work out ${q(T)} ${asFormula}: ${ask.text}`,
          chip_label: ask.label, chip_message: ask.message };
      }
      const named = zeroTarget ? q(T) : andList(say(zeros));
      const one = zeroTarget || zeros.length === 1;
      return {
        reason: w.reason,
        node_id: w.nodeId,
        assistant_text: `${named} ${one ? 'is' : 'are'} 0 today, so ${q(T)} can't be worked out ${asFormula}. `
          + `Is 0 right, or what ${one ? 'is it' : 'are they'}?`,
        chip_label: 'Check the zero',
        chip_message: `Is 0 right for ${named}? Ask me what ${one ? 'it is' : 'they are'} today.`,
      };
    }
    case 'identity_frame_missing': {
      const hasUnit = (id: string): boolean => {
        const n = byId.get(id);
        const u = rec(n?.observed_state)?.unit ?? (id === w.nodeId ? n?.goal_threshold_unit : undefined);
        return typeof u === 'string' && u.trim() !== '';
      };
      const unitless = w.participants.filter((p) => !hasUnit(p));
      // ISL's rule 1 frames the identity NODE as well as its operands (R3 #72 5884883932, DL 5884896233). Every
      // operand in its unit and the target in none → ask for the TARGET's, never again for units the user gave.
      if (unitless.length === 0 && !hasUnit(w.nodeId)) {
        // Only a GOAL has a target of its own; an outcome's unit comes from today's figure alone (AIQ 5885470243).
        const aim = target.kind === 'goal' ? ' or what are you aiming for' : '';
        return {
          reason: w.reason,
          node_id: w.nodeId,
          assistant_text: `I can't work out ${q(T)} ${asFormula} without knowing what ${q(T)} is measured in: `
            + `what unit is it in, and roughly what is it today${aim}?`,
          chip_label: 'Give its unit',
          chip_message: `Ask me which unit ${q(T)} is in.`,
        };
      }
      const named = andList(say(unitless.length > 0 ? unitless : w.participants));
      const one = (unitless.length > 0 ? unitless : w.participants).length === 1;
      return {
        reason: w.reason,
        node_id: w.nodeId,
        assistant_text: `I can't put ${named} on the same scale as ${q(T)}: what unit ${one ? 'is it' : 'is each of them'} in?`,
        chip_label: 'Give the unit',
        chip_message: `Ask me which unit ${named} ${one ? 'is' : 'are'} in.`,
      };
    }
    default:
      return unstated();
  }
}

/** The composer's reader: a well-formed ask carried on a blocked failure's details, or null. */
export function readIdentityAsk(v: unknown): IdentityAsk | null {
  const r = rec(v);
  if (r === null) return null;
  const reasons: readonly unknown[] = [...IDENTITY_WITHHELD_REASONS, 'unstated'];
  const s = (k: string): string | null => (typeof r[k] === 'string' && (r[k] as string).trim() !== '' ? (r[k] as string) : null);
  const [text, label, message, nodeId] = [s('assistant_text'), s('chip_label'), s('chip_message'), s('node_id')];
  if (!reasons.includes(r.reason) || text === null || label === null || message === null || nodeId === null) return null;
  return { reason: r.reason as IdentityAskReason, node_id: nodeId, assistant_text: text, chip_label: label, chip_message: message };
}

/**
 * ⭐ MC D1 (c) (DL 6 Oct; Acceptance rehearsal 13 on CEE d40fd7b): PLoT #416 (`GOAL_PROBABILITY_IDENTITY_NOT_EVALUATED`) names
 * only the identity node it could not calculate, and the reply asked for nothing ("separation_unavailable", no invitation).
 * The one ask that would let it is CEE's, from its OWN graph: the first reason the declared operands show — a level the
 * model holds none of, a zero, then a missing unit — said by the same composer as ISL's typed reason. Null when the graph
 * shows none of them (no ask is invented).
 */
export function composeIdentityAskForNode(nodeId: string, graph: unknown): IdentityAsk | null {
  const nodes = rec(graph)?.nodes;
  if (!Array.isArray(nodes)) return null;
  const byId = new Map<string, Rec>();
  for (const n of nodes.map(rec)) if (n !== null && typeof n.id === 'string') byId.set(n.id, n);
  const operands = ids(rec(byId.get(nodeId)?.nonlinear_identity)?.factor_ids);
  if (operands === null) return null;
  const os = (id: string): Rec | null => rec(byId.get(id)?.observed_state);
  const level = (id: string): number | null => finite(os(id)?.raw_value) ?? finite(os(id)?.value);
  const unitless = (id: string): boolean => { const u = os(id)?.unit; return !(typeof u === 'string' && u.trim() !== ''); };
  const target = byId.get(nodeId);
  // The identity NODE is framed too (ISL rule 1; Codex buddy r1 P2): its own unit, or a goal's target unit.
  const targetUnitless = unitless(nodeId) && !(typeof target?.goal_threshold_unit === 'string' && target.goal_threshold_unit.trim() !== '');
  const reason: IdentityWithheldReason | null = operands.some((id) => level(id) === null) ? 'identity_operand_missing'
    : operands.some((id) => level(id) === 0) ? 'identity_zero_level'
      : operands.some(unitless) || targetUnitless ? 'identity_frame_missing' : null;
  return reason === null ? null
    : composeIdentityNotEvaluatedAsk([{ code: IDENTITY_NOT_EVALUATED_CODE, identity: { node_id: nodeId, participants: operands, withheld_reason: reason } }], graph);
}
