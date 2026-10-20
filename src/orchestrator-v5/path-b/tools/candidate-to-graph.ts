/**
 * ⭐ STEP 8 (PLAN-TODAY 19 Oct): PATH-B's PURE draft conversion. The drafter's strict JSON becomes a GraphV3
 * `{nodes, edges, goal_constraints}`.
 *  · EVERY NUMBER IS A's (DL, 19 Oct, after four red rounds: "the converter must NOT re-implement number, frame or unit
 *    conversion"). The draft runs through A's own conversion — the build's preparation (`prepareProvisionalCandidate`) and
 *    A's admission through the ONE named path-B door (`admitWithoutBrief`; S7 lock, DL 19 Oct: brief pinned `undefined`) —
 *    so no reading of the brief runs, on a label-blind copy (`labelBlind`), so no reading of a name or a quote runs either
 *    (#3464 R2): what A decides from a name alone is not taken. Each value, level, frame, unit,
 *    goal threshold, limit and Olumi-sized link is copied from what A admitted for the same entity (A's `canonicalLabel`
 *    identity). A figure A did not convert is said and kept in `declared`, never computed here. A setting in another unit
 *    than its factor (`sameUnit`), or on something that is not a factor, is not used, and said. Placeholders for unsized
 *    links come from the stored-graph sizing view (`magnitudeNodes` → `sizeLink`, `user_stated` only for a record-backed person's size).
 *  · STRUCTURE AND AUTHORSHIP ARE THE DRAFT's, with NO C1/C2: every declared option, risk, outcome and link is kept; each
 *    figure keeps the origin the AI DECLARED, in the fields the one provenance authority reads (`cee/provenance/provenance-of.ts`):
 *    the user's (`explicit`) = a type-less `brief_extraction` (human, by its stamp: declared, not attested); Olumi's (`ai_proposed`,
 *    or a factor level the AI did not declare known) = `cee_inference` + `inferred` / `cee_hypothesis`; the drafter's `inferred`
 *    (its contract: a reformulation of supplied material, or unresolved), an unknown speaker or a named third party = no stamp
 *    (unknown), or `user_material_unverified` on a setting. A computed total is Olumi's derived figure, said with its arithmetic (signed plan item 7). A link size the
 *    AI declared as a person's keeps Olumi's placeholder (DL ruling (a)) unless the user's own recorded statement of that link backs
 *    it (K5 P0 ruling (a)): then it is sized as theirs, through A's sizing. Origins GraphV3 cannot hold are `blocked_schema`.
 *  · The raw draft travels beside the graph verbatim (`declared`); C5's draft tool returns it, so the scenario's one
 *    Conversation keeps it. The draft is Olumi's provisional model. A is untouched: it still applies its gates.
 *  · A "stay at or below" goal's level the AI declared known and the user's is carried on A's science (cap, unit, frame,
 *    `admitGoalBaseline`), since A reads that ceiling only from the brief (gap 3 ruling (c)).
 *  · A declared sum is judged on its operands, units, frames and today's arithmetic, never its quote, by A and by B alike; its
 *    parts' links are then A's exact definition through the existing identity (the AIE's mapping A), whoever the AI said sized them.
 *  · Given the user's words, the draft's declared statements are recorded on their subjects, as construction records them
 *    (`withDeclaredStatements`): data carried, never a reading of the words' meaning.
 */
import type { RepairEntry } from '@talchain/schemas';
import {
  admitCandidateModel, admitOrdinaryCandidateModel, assignIds, breakLoops, canonicalLabel, checkDeclaredSums, declaredSumSentence,
  displayProvenanceFor, shortLabel, slugId,
  type AdmittedModel, type AdmittedNode, type CandidateIdentity, type CandidateModel, type CandidateNodeKind,
} from '../../agent-lane/admit-model.js';
import { prepareProvisionalCandidate } from '../../agent-lane/runtime/build-model.js';
import { admitCandidateLinks, type CandidateLink } from '../../agent-lane/admit-candidate.js';
import { readUnitParts, sameUnit } from '../../agent-lane/same-unit.js';
import { oneRoutePerEffect } from '../../agent-lane/one-route-per-effect.js';
import { sayFigure } from '../../agent-lane/say-figure.js';
import { admitAccumulationIdentities, withAdmittedAccumulations } from '../../agent-lane/accumulation-identity.js';
import { clampForPersist, refitFramesForOlumiEstimates, refitFramesForStatedEffects } from '../../agent-lane/refit-frames.js';
import { naturalAmountUnitOf, resolveMagnitudeFrame, sizeLink, unitOf, type LinkSizing, type StatedRangeEnd } from '../../../cee/magnitude/link-effect.js';
import { linkDefaultAssumptionsOf } from '../../../cee/magnitude/link-default-assumptions.js';
import { magnitudeNodes, percentLevelIds } from '../../../cee/magnitude/frame-defaulted-links.js';
import { nodeProvenanceDisplay } from '../../../cee/provenance/provenance-of.js';
import { UNSIZED_OLUMI_RISK_REASON } from '../../agent-lane/unsized-risk.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';
import { REPAIR_AUTHORED_ORIGIN } from '../../../graph/repair-authored-edge.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';
import { admitGoalBaseline } from '../../../cee/factor-extraction/goal-baseline-admissibility.js';
import { ceilingTargetUnitMayBeALevel, targetTypedAsALevel } from '../../goal-target/goal-direction.js';
import { CONSTRUCTION_ATTEST, userStatementRecord, withUserStatement } from '../../statement-door/statements.js';
import { isStatementField, subjectKey, type DoorSubject } from '../../statement-door/subject.js';
import { userStatementOf, type UserStatement } from '../../agent-lane/user-statements.js';
import { verbatimSourceLine } from '../../agent-lane/quote-confirmation.js';
import { admitInterventionRange, interventionPoint, StoredInterventionRange } from '../../intervention-range.js';
import { quoteHoldsFigure } from './user-words.js';

type Rec = Record<string, any>;
/** Whose figure the AI declared it to be. */
type Who = 'user' | 'olumi' | 'other' | 'unknown';
/** An origin the AI declared that GraphV3 has no field for (DL 19 Oct: BLOCKED-SCHEMA, never a downgrade); `declared` keeps it. */
export interface BlockedSchema {
  readonly field_path: string;
  readonly declared: 'user' | 'other' | 'unknown';
  readonly missing: 'speaker_name' | 'link_origin' | 'link_size_origin' | 'target_origin';
}
type Converted = { readonly graph: Record<string, unknown>; readonly declared: unknown; readonly loss: readonly RepairEntry[];
  readonly blocked_schema: readonly BlockedSchema[] };
export type CandidateToGraphResult = Converted | { readonly refused: 'candidate_invalid' | 'not_convertible' | 'graph_invalid' };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
const KIND_WORD: Readonly<Record<string, string>> = { goal: 'the goal', option: 'an option', factor: 'a factor', risk: 'a risk', outcome: 'an outcome', decision: 'the question' };
const note = (field_path: string, before: unknown, reason: string, severity: 'info' | 'warn' = 'info'): RepairEntry =>
  ({ field_path, before, after: null, reason, severity }) as RepairEntry;
/** The existing value stamps for each declared origin (`valueProvenanceOf`); an unknown or third party's figure has none. */
const valueStamp = (who: Who): Rec => (who === 'user' ? { source: 'brief_extraction' }
  : who === 'olumi' ? { source: 'cee_inference', extractionType: 'inferred' } : {});
/** A's numbers without A's authorship stamps (A ran with no brief, so its stamps say nothing about who said what). */
const numbersOf = ({ source: _s, extractionType: _e, user_material_unverified: _u, ...numbers }: Rec): Rec => numbers;
const levelNumbersOf = ({ source: _s, user_material_unverified: _u, value_confidence: _c, target_match: _t, ...numbers }: Rec): Rec => numbers;
/**
 * ⭐ A DERIVED FIGURE IS OLUMI'S (signed plan, ARGUMENT-RECONCILED-20261018 item 7): "a derived figure is Olumi's derivation
 * from the user's operands, shown with its arithmetic; it is never credited as the user's." Each operand keeps its origin.
 */
const derivation = (total: string, operands: readonly { readonly by: Who; readonly amount: string }[]): string =>
  `${total} = ${operands.map(({ by, amount }) => (by === 'olumi' ? `Olumi's ${amount} estimate` : by === 'user' ? `your ${amount}`
    : by === 'other' ? `another person's ${amount}` : `${amount} from an unclear source`)).join(' + ')}`;
/** A figure A did not convert: A's own reason when it gave one for that field, else said plainly. Never computed here. */
const notConverted = (a: AdmittedModel, path: string, label: string, what: string, value: unknown): RepairEntry => note(path, value,
  a.loss.find((l) => String(l.field_path).startsWith(path))?.reason
    ?? `${what} for "${label}" (${String(value)}) was drafted but is not in the model's numbers yet; Olumi kept it as drafted.`, 'warn');

function asCandidate(v: unknown): CandidateModel | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const c = v as Rec;
  if (c.goal === null || typeof c.goal !== 'object' || typeof c.goal.metric !== 'string' || c.goal.metric.trim() === '') return null;
  // Every reference to a declared entity is written with that entity's own label (A's `canonicalLabel` identity), so A's
  // conversion binds "ad spend" to "Ad spend" exactly as its admission reads them.
  const own = new Map([c.goal.metric, ...[...list<Rec>(c.factors), ...list<Rec>(c.options), ...list<Rec>(c.risks), ...list<Rec>(c.outcomes)]
    .map((n) => n?.label)].filter((l): l is string => typeof l === 'string').map((l) => [canonicalLabel(l), l] as const));
  const as = (label: unknown): unknown => (typeof label === 'string' ? own.get(canonicalLabel(label)) ?? label : label);
  const model: Rec = { ...c, constraints: list<Rec>(c.constraints).map((k) => ({ ...k, metric: as(k.metric) })),
    options: list<Rec>(c.options).map((o) => ({ ...o, ...(Array.isArray(o.changes) ? { changes: o.changes.map(as) } : {}),
      ...(Array.isArray(o.interventions) ? { interventions: o.interventions.map((iv: Rec) => ({ ...iv, factor_label: as(iv.factor_label) })) } : {}) })),
    factors: list(c.factors), risks: list(c.risks), outcomes: list(c.outcomes),
    links: list<Rec>(c.links).map((l) => ({ ...l, from: as(l.from), to: as(l.to) })),
    identities: list<Rec>(c.identities).map((d) => ({ ...d, outcome: as(d.outcome), factors: list(d.factors).map(as) })) };
  return model as CandidateModel;
}

/**
 * ⭐ S7 PATH-B DOOR (DL 19 Oct): the ONE admission outside the build's `admitForBuild`, and it never sees a brief. The S7
 * census (`one-admission-path.test.ts`) allows admission calls only inside this function, and only with the brief `undefined`.
 */
function admitWithoutBrief(prepared: CandidateModel): AdmittedModel {
  try { return admitCandidateModel(prepared, {}, undefined); } catch { return admitOrdinaryCandidateModel(prepared, {}, undefined); }
}

/**
 * ⛔ A READS NO LABEL AND NO QUOTE FOR B (#3464 R2, DL 19 Oct: "every A verdict B copies that reads a label or brief text →
 * declared field only"). A reads some names for their meaning: an option named like "carrying on" is the status quo (and is
 * exempt from the option-identity judge), an option named with a creation verb creates its part at 0, a factor named like a
 * rate or a price takes Olumi's convention range, a link's source named with the goal's quantity words is a definition. So A
 * converts a copy of the draft in which every name and every quoted or free-text field is a neutral token — one per distinct
 * name (`canonicalLabel`), so A binds entities exactly as before — and its model is read back through the same tokens. Every
 * verdict this converter takes from A then rests on the DECLARED fields only (structure, units, numbers, types, the declared
 * flags and origins), whatever A reads now or later. Measured on the 2,332 stored drafts: the same output with every name
 * renamed (`candidate-to-graph.test.ts`, label-blindness rows).
 */
function labelBlind(c: CandidateModel): { readonly candidate: CandidateModel; readonly readBack: <T>(v: T) => T } {
  const tokenOf = new Map<string, string>();
  const originalOf = new Map<string, string>();
  const token = (text: unknown): unknown => {
    if (typeof text !== 'string' || text.trim() === '') return text;
    const k = canonicalLabel(text);
    let t = tokenOf.get(k);
    if (t === undefined) {
      let letters = '';
      for (let i = 0, x = tokenOf.size; i < 5; i++, x = Math.floor(x / 26)) letters = String.fromCharCode(97 + (x % 26)) + letters;
      t = `Qzx${letters}`;
      tokenOf.set(k, t);
      originalOf.set(letters, text);
    }
    return t;
  };
  const tokens = (v: unknown): unknown => (Array.isArray(v) ? v.map(token) : v);
  /** `o` with each of `fields` that it HAS mapped (no key is added, so A reads the same shape). */
  const mapped = (o: unknown, fields: Readonly<Record<string, (v: unknown) => unknown>>): unknown => {
    if (o === null || typeof o !== 'object' || Array.isArray(o)) return o;
    const out: Rec = { ...(o as Rec) };
    for (const [k, f] of Object.entries(fields)) if (k in out) out[k] = f(out[k]);
    return out;
  };
  const each = (f: (v: unknown) => unknown) => (v: unknown): unknown => (Array.isArray(v) ? v.map(f) : v);
  const quoted = (e: unknown): unknown => mapped(e, { quote: token, option_quote: token });
  const x = c as Rec;
  // Names first, in declaration order, so each entity's token (and its id read back) is fixed before any other text.
  [x.goal.metric, ...[...list<Rec>(x.factors), ...list<Rec>(x.options), ...list<Rec>(x.risks), ...list<Rec>(x.outcomes)].map((n) => n?.label)].forEach(token);
  const blind = mapped(x, {
    goal: (g) => mapped(g, { metric: token, deliverable: token, source_quote: token, deadline_words: token,
      basis: (b) => mapped(b, { denominator: token, open_question: token, also_required: tokens }),
      scope: (sc) => mapped(sc, { modelled: token, alternative: token }) }),
    constraints: each((k) => mapped(k, { metric: token })),
    factors: each((f) => mapped(f, { label: token, baseline_evidence: quoted })),
    options: each((o) => mapped(o, { label: token, changes: tokens,
      interventions: each((iv) => mapped(iv, { factor_label: token, stated_evidence: quoted })) })),
    risks: each((r) => mapped(r, { label: token, already_true_evidence: quoted })),
    outcomes: each((o) => mapped(o, { label: token })),
    links: each((l) => mapped(l, { from: token, to: token, basis: token, source_quote: token })),
    identities: each((d) => mapped(d, { outcome: token, factors: tokens, evidence: quoted })),
    decision_question: token,
    unknowns: tokens,
    unknown_concerns: each((u) => mapped(u, { unknown: token, concerns: tokens })),
    statements: each((st) => mapped(st, { quote: token, conditions: token,
      subject: (sub) => mapped(sub, { label: token, to_label: token, factor_label: token }) })),
  });
  // One word per name, so no two names share a word A could read. A writes a name as given ("Qzxabcde") and its id as the slug
  // ("qzxabcde"); the id is read back as the name's own id (`assignIds`, names first, so two names sharing a slug stay apart).
  const ids = assignIds([...originalOf.values()]);
  const idOf = new Map([...originalOf].map(([letters, text]) => [letters, ids.get(text)!] as const));
  const back = (v: string): string => v.replace(/qzx([a-z]{5})/g, (m, l: string) => idOf.get(l) ?? m)
    .replace(/Qzx([a-z]{5})/g, (m, l: string) => originalOf.get(l) ?? m);
  const readBack = <T>(v: T): T => (typeof v === 'string' ? back(v) as T : Array.isArray(v) ? v.map(readBack) as T
    : v !== null && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, w]) => [back(k), readBack(w)])) as T : v);
  return { candidate: blind as CandidateModel, readBack };
}

/** A's own conversion of the draft, with no brief and no names (`labelBlind`): the numbers and structure science this converter copies. */
function convertedByA(c: CandidateModel): { a: AdmittedModel } | null {
  try {
    // A declared sum is judged as B judges it (`checkDeclaredSums` below): on its operands, units, frames and today's arithmetic, as
    // Olumi's reading, so no quote reaches A's check either (A takes no sum from a quote, and B has no brief to find one in).
    const unquoted = { ...c, identities: (c.identities ?? []).map((d) => (d?.operation === 'sum' ? { ...d, evidence: null } : d)) };
    const { candidate, readBack } = labelBlind(unquoted);
    const prepared = prepareProvisionalCandidate(candidate).candidate;
    const admitted = admitWithoutBrief(prepared);
    const goal = admitted.nodes.find(n => n.kind === 'goal');
    const view = magnitudeNodes(admitted.nodes.map(n => ({ ...n })), percentLevelIds({ goal_constraints: admitted.goal_constraints }));
    const total = goal === undefined ? undefined : view.get(goal.id);
    const frame = total === undefined ? undefined : resolveMagnitudeFrame(total);
    // A zero has no recoverable raw/value ratio. An accepted same-unit sum supplies a shared coordinate mapping,
    // not a bound or an uncertainty estimate. Reuse A's conversion so EVERY affected level and link uses that mapping.
    const unframed = new Set(goal?.nonlinear_identity?.operation !== 'sum' || !finite(frame) || frame <= 1 ? []
      : goal.nonlinear_identity.factor_ids.filter(id => {
        const part = view.get(id);
        return part !== undefined && part.scale_frame === undefined && part.observed_state?.cap === undefined
          && sameUnit(unitOf(part), unitOf(total!));
      }).map(id => canonicalLabel(admitted.nodes.find(n => n.id === id)!.label)));
    return { a: readBack(unframed.size === 0 ? admitted : admitWithoutBrief({ ...prepared,
      factors: prepared.factors.map(f => unframed.has(canonicalLabel(f.label)) ? { ...f, plausible_max: frame } : f),
    })) };
  } catch { return null; }
}

/** The converted graph BEFORE the build's refit chain (what the differential compares with A's admission). */
export function candidateToAdmittedGraph(input: unknown, usersWords?: string): Converted | { readonly refused: 'candidate_invalid' | 'not_convertible' } {
  const c = asCandidate(input);
  if (c === null) return { refused: 'candidate_invalid' };
  const byA = convertedByA(c);
  if (byA === null) return { refused: 'not_convertible' };
  const { a } = byA;
  const loss: RepairEntry[] = [];
  const blocked: BlockedSchema[] = [];
  const g = c.goal;
  const key = (n: { label: string; description?: string }): string => canonicalLabel(n.description ?? n.label);
  const aNodeOf = new Map(a.nodes.filter((n) => n.kind !== 'decision').map((n) => [key(n), n] as const));
  // A's node for a declared entity: by its label, else by its id (A restates some labels, e.g. a later ambition, and keeps the id).
  const aFor = (label: string): AdmittedNode | undefined => aNodeOf.get(canonicalLabel(label))
    ?? a.nodes.find((n) => n.kind !== 'decision' && n.id === slugId(label));
  // The AI's own reading of whose words each statement is, by the subject it declared.
  const statements = list<Rec>((input as Rec).statements);
  /**
   * ⭐ K5 P0 (DL ruling (a) + #3485 R1, 19 Oct): the user's own statement of exactly this link's effect that backs a person's
   * declared size: speaker user; its quote a byte substring of the user's words that WRITES the figure with its sign (#3475's literal
   * check, `quoteHoldsFigure`); its point that figure; its unit the target's natural unit or a rate with that numerator and the driver's
   * unit as denominator (the existing unit grammar: a weekly figure never sizes a daily link). A stated range rides on A's
   * existing carrier (`stated_range`, the point inside, both ends written); a range with no stated point backs nothing (no invented midpoint). `undefined` when nothing backs it.
   */
  const userRecordOf = (l: CandidateLink, naturalUnit: string, sourceUnit: string | undefined): { readonly range?: StatedRangeEnd } | undefined => {
    const amount = l.effect_amount;
    if (usersWords === undefined || !finite(amount)) return undefined;
    for (const st of statements) {
      const rate = readUnitParts(st?.unit);
      const rateAgrees = rate?.per != null && sameUnit(rate.per.join(' '), sourceUnit)
        && JSON.stringify({ ...rate, per: null }) === JSON.stringify(readUnitParts(naturalUnit));
      if (st?.subject?.kind !== 'link' || st.field !== 'effect' || st.speaker !== 'user' || typeof st.quote !== 'string' || !usersWords.includes(st.quote)
        || canonicalLabel(String(st.subject.label ?? '')) !== canonicalLabel(l.from) || canonicalLabel(String(st.subject.to_label ?? '')) !== canonicalLabel(l.to)
        || st.value !== amount || !quoteHoldsFigure(st.quote, amount) || !(sameUnit(st.unit, naturalUnit) || rateAgrees)) continue;
      if (!finite(st.low) && !finite(st.high)) return {};
      if (finite(st.low) && finite(st.high) && st.low < Math.abs(amount) && Math.abs(amount) < st.high
        && quoteHoldsFigure(st.quote, st.low) && quoteHoldsFigure(st.quote, st.high)) return { range: { low: st.low, high: st.high, text: st.quote, end: 'centre' } };
    }
    return undefined;
  };
  /**
   * ⭐ THE AI DECLARES WHO, PER FIGURE (B's ONE change, DL 20 Oct; Codex AMEND): each figure's `origin` (user | third_party | olumi |
   * unknown) is read as declared, with no host reading of whose words they are. The host keeps only the literal and unit check: a
   * person's figure is credited as theirs only where their own statement of that subject is a byte substring of their words that
   * writes the figure (sign included) in its unit; otherwise it is held as of unknown origin, never as the person's or Olumi's.
   */
  const unitAgrees = (said: unknown, unit: unknown): boolean => (typeof unit === 'string' && unit.trim() !== ''
    ? typeof said === 'string' && sameUnit(said, unit) : said === null || said === undefined || said === '');
  const writes = (subject: (st: Rec) => boolean, figure: unknown, unit: unknown): boolean => usersWords !== undefined && finite(figure)
    && statements.some((st) => st?.speaker === 'user' && typeof st.quote === 'string' && usersWords.includes(st.quote) && subject(st)
      && quoteHoldsFigure(st.quote, figure) && unitAgrees(st.unit, unit));
  const about = (kind: string, label: string, field: string) => (st: Rec): boolean => st.subject?.kind === kind && st.field === field
    && canonicalLabel(String(st.subject.label ?? '')) === canonicalLabel(label);
  const whoOf = (origin: unknown, figure?: unknown, unit?: unknown, subject?: (st: Rec) => boolean): Who => {
    const who: Who = origin === 'user' ? 'user' : origin === 'olumi' ? 'olumi' : origin === 'third_party' ? 'other' : 'unknown';
    return who === 'user' && (subject === undefined || !writes(subject, figure, unit)) ? 'unknown' : who;
  };
  /** A supposition or a target is never held as a current level (Codex AMEND): it stays in its record and `declared`, as said. */
  const notALevel = (stance: unknown): boolean => stance === 'hypothetical' || stance === 'target';
  const notALevelSaid = (path: string, label: string, value: unknown, stance: unknown): RepairEntry => note(path, value,
    `"${label}" at ${String(value)} is put forward as ${stance === 'target' ? 'a target' : 'a supposition'}, so it is kept as said, not as today's level.`, 'warn');
  // A's own sentences, by the field they are about: a science decision this converter takes from A is said in A's words.
  const aSaid = (path: string): RepairEntry[] => a.loss.filter((l) => l.field_path === path);
  // SCIENCE (structure: what each option sets and acts on): an Olumi option that sets nothing the model can hold that another
  // option does not is left out here too, said in A's words; it stays in `declared`. A judged it on the label-blind draft
  // (`labelBlind`), so the only status quo it exempts is the one the AI declared (`is_status_quo`), never one its label reads as.
  const options = c.options.filter((o) => aSaid(`nodes[${slugId(o.label)}].option_indistinct`).length === 0);
  for (const o of c.options) if (!options.includes(o)) loss.push(...aSaid(`nodes[${slugId(o.label)}].option_indistinct`));

  // The goal: A's threshold, cap, frame and today's level; the AI's declared comparator, horizon and words beside them.
  const aGoal = [aFor(g.metric)].find((n) => n?.kind === 'goal') ?? a.nodes.find((n) => n.kind === 'goal');
  const goalWho = whoOf((g as Rec).baseline_origin, g.baseline_value, g.unit, about('goal', g.metric, 'level'));
  const targetWho = whoOf((g as Rec).target_origin, g.value, g.unit, about('goal', g.metric, 'target'));
  const goalPath = `nodes[${slugId(g.metric)}]`;
  const threshold = finite(aGoal?.goal_threshold_raw);
  if (threshold && (targetWho === 'other' || targetWho === 'unknown')) blocked.push({ field_path: `${goalPath}.goal_threshold_raw`, declared: targetWho, missing: 'target_origin' });
  // ⭐ GAP 3 RULING (c) (DL 19 Oct): A admits a "stay at or below" goal's level today only beside a ceiling it reads from the brief
  // (`admit-model.ts` `ceilingRead`), and B reads no brief. So B carries the level the AI DECLARED, on the declared terms on which A
  // admits a ">=" goal's level with no brief (known and `explicit`), with A's science: the threshold's own cap, unit and typed level
  // frame, and A's normalisation and direction rule for a ceiling (`admitGoalBaseline`). Its author is the who-rule's.
  const ceilingLevel = ((): Rec | undefined => {
    const ag = aGoal as Rec | undefined;
    const target = ag?.goal_threshold_raw, cap = ag?.goal_threshold_cap, unit = ag?.goal_threshold_unit ?? g.unit;
    if (ag === undefined || ag.observed_state !== undefined || g.operator !== '<=' || g.baseline_known !== true
      || goalWho !== 'user' || !finite(g.baseline_value) || !finite(target) || !finite(cap)
      || !(ceilingTargetUnitMayBeALevel(unit) || targetTypedAsALevel(ag.goal_threshold_frame ?? (g as Rec).frame, unit))) return undefined;
    const level = admitGoalBaseline({ rawTarget: target, rawBaseline: g.baseline_value, cap, ceiling: true });
    return level.admitted ? { value: level.normalised, baseline: level.normalised, ...(typeof unit === 'string' && unit.trim() !== '' ? { unit } : {}),
      raw_value: g.baseline_value, cap } : undefined;
  })();
  const goalLevel = notALevel((g as Rec).baseline_stance) ? undefined : aGoal?.observed_state !== undefined ? numbersOf(aGoal.observed_state) : ceilingLevel;
  if (notALevel((g as Rec).baseline_stance) && finite(g.baseline_value)) loss.push(notALevelSaid(`${goalPath}.observed_state`, g.metric, g.baseline_value, (g as Rec).baseline_stance));
  if (goalWho === 'other' && goalLevel !== undefined) blocked.push({ field_path: `${goalPath}.observed_state`, declared: 'other', missing: 'speaker_name' });
  if (finite(g.baseline_value) && goalLevel === undefined && !notALevel((g as Rec).baseline_stance)) loss.push(notConverted(a, `${goalPath}.observed_state`, g.metric, "Today's level", g.baseline_value));
  if (g.target_stated !== false && finite(g.value) && !threshold) loss.push(notConverted(a, `${goalPath}.goal_threshold_raw`, g.metric, 'The target', g.value));
  const goalNumbers: Rec = Object.fromEntries(Object.entries(aGoal ?? {}).filter(([k]) => k.startsWith('goal_threshold') || k === 'quantity_frame'
    || k === 'scale_frame' || k === 'goal_target_basis' || k === 'goal_level_reading'));
  const goalNode: Rec = { ...goalNumbers,
    ...(goalLevel !== undefined ? { observed_state: { ...goalLevel, ...valueStamp(goalWho) } } : {}),
    ...(threshold && ['>=', '<=', '>', '<'].includes(g.operator) ? { goal_direction: g.operator } : {}),
    ...(finite(g.horizon_months) && g.horizon_months > 0 ? { goal_horizon_months: g.horizon_months } : {}),
    ...(typeof (g as Rec).deadline_words === 'string' ? { goal_deadline_as_stated: (g as Rec).deadline_words } : {}),
    ...(typeof (g as Rec).source_quote === 'string' ? { source_quote: (g as Rec).source_quote } : {}) };

  // SCIENCE with an authorship input, read by the DECLARED origin: A leaves out of the Run what has no size or is a later aim.
  // An unsized risk is left out only when the AI declared it Olumi's (A, with no brief, reads every risk as Olumi's: a gate,
  // not copied); a person's or an unclear source's unsized risk stays in, and readiness holds the result it would need.
  const outOfRun = (an: AdmittedNode | undefined, kind: string, who: Who): Rec => {
    if (an?.analysis_participation !== 'retained_excluded' || (kind === 'risk' && who !== 'olumi')) return {};
    if (kind === 'risk') loss.push(...aSaid(`nodes[${an.id}].left_out_of_analysis`));
    return { analysis_participation: 'retained_excluded', ...(an.analysis_participation_reason === UNSIZED_OLUMI_RISK_REASON
      ? { analysis_participation_reason: UNSIZED_OLUMI_RISK_REASON } : {}) };
  };
  const factorWho = new Map<string, Who>();
  const entities: { label: string; kind: CandidateNodeKind; provenance: string; node: Rec }[] = [
    { label: g.metric, kind: 'goal', provenance: g.provenance, node: goalNode },
    ...options.map((o) => ({ label: o.label, kind: 'option' as const, provenance: o.provenance, node: {} })),
    ...c.factors.map((f) => {
      const an = aFor(f.label);
      // A factor's `provenance` says who introduced the ITEM; its level's own author and stance are the AI's declaration.
      const who = whoOf((f as Rec).origin, f.baseline_value, f.unit, about('factor', f.label, 'level'));
      const level = notALevel((f as Rec).stance) ? undefined : an?.observed_state;
      factorWho.set(canonicalLabel(f.label), who);
      if (who === 'other' && level !== undefined) blocked.push({ field_path: `nodes[${slugId(f.label)}].observed_state`, declared: 'other', missing: 'speaker_name' });
      if (finite(f.baseline_value) && level === undefined) loss.push(notALevel((f as Rec).stance) ? notALevelSaid(`nodes[${slugId(f.label)}].observed_state`, f.label, f.baseline_value, (f as Rec).stance)
        : notConverted(a, `nodes[${slugId(f.label)}].observed_state`, f.label, "Today's level", f.baseline_value));
      // SCIENCE (structure): A's category — a lever no option reaches is held as context (`demoteUnreachedLevers`), which
      // readiness reads; said in A's words.
      if (an?.category !== undefined && an.category !== f.role) loss.push(...aSaid(`nodes[${an.label}].category`));
      return { label: f.label, kind: 'factor' as const, provenance: f.provenance, node: {
        category: an?.category ?? f.role, ...(an?.scale_frame !== undefined ? { scale_frame: an.scale_frame } : {}), ...outOfRun(an, 'factor', who),
        ...(level !== undefined ? { observed_state: { ...numbersOf(level), ...valueStamp(who) },
          ...(typeof f.baseline_evidence?.quote === 'string' ? { source_quote: f.baseline_evidence.quote } : {}) } : {}),
      } };
    }),
    ...[...c.risks.map((r) => ({ ...r, kind: 'risk' as const })), ...c.outcomes.map((o) => ({ ...o, kind: 'outcome' as const }))].map((n) => {
      const an = aFor(n.label);
      const who = whoOf((n as Rec).origin, (n as Rec).baseline_value, (n as Rec).unit, about(n.kind, n.label, 'level'));
      // SCIENCE (units, constraints): an outcome a limit holds at a percentage level is a factor that can hold it (A's re-kind).
      const kind = n.kind === 'outcome' && an?.kind === 'factor' ? 'factor' as const : n.kind;
      return { label: n.label, kind, provenance: n.provenance, node: { ...(an?.scale_frame !== undefined ? { scale_frame: an.scale_frame } : {}),
        ...(kind === 'factor' && an?.category !== undefined ? { category: an.category } : {}), ...outOfRun(an, n.kind, who),
        ...(an?.observed_state !== undefined ? { observed_state: { ...numbersOf(an.observed_state), ...valueStamp(who) } } : {}) } };
    }),
  ];
  const asked = typeof c.decision_question === 'string' && c.decision_question.trim() !== '' ? c.decision_question.trim() : null;
  const question = asked !== null && !entities.some((e) => canonicalLabel(e.label) === canonicalLabel(asked)) ? asked : null;
  entities.unshift({ label: question ?? `Decision: ${g.metric}`, kind: 'decision', provenance: question ? 'explicit' : 'inferred', node: {} });

  const ids = assignIds(entities.map((e) => e.label));
  const nodes: (AdmittedNode & Rec)[] = [];
  for (const e of entities) {
    const id = ids.get(e.label)!;
    const kept = nodes.find((n) => n.id === id);
    if (kept !== undefined) {
      if (kept.kind !== e.kind) loss.push(note(`nodes[${id}]`, e.label, `"${e.label}" is drafted both as ${KIND_WORD[kept.kind] ?? kept.kind} and as `
        + `${KIND_WORD[e.kind] ?? e.kind}; the model keeps it as ${KIND_WORD[kept.kind] ?? kept.kind}, and Olumi kept the other as drafted.`, 'warn'));
      continue;
    }
    const label = shortLabel(e.label);
    const os = e.node.observed_state;
    nodes.push({ id, kind: e.kind, label, ...(label !== e.label ? { description: e.label } : {}),
      provenance: os !== undefined && e.kind !== 'goal' ? nodeProvenanceDisplay(undefined, os) : displayProvenanceFor(e.provenance), ...e.node });
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const kindOf = (id: string): string | undefined => nodeById.get(id)?.kind;
  const idFor = (label: string): string | undefined => ids.get(label) ?? [...ids].find(([l]) => canonicalLabel(l) === canonicalLabel(label))?.[1];
  const aIdOf = new Map(nodes.map((n) => [n.id, n.kind === 'goal' ? aGoal?.id : n.kind === 'decision' ? undefined : aFor(String(n.description ?? n.label))?.id] as const));
  const bIdOfA = new Map([...aIdOf].flatMap(([b, x]) => (x === undefined ? [] : [[x, b] as const])));
  const aPair = (from: string, to: string): string => `${aIdOf.get(from)}::${aIdOf.get(to)}`;

  // Option settings: A's level for the same option and factor; the declared origin; a computed total is Olumi's.
  for (const o of options) {
    const oid = idFor(o.label)!;
    const bundle: Rec = {};
    const aOption = aFor(o.label);
    for (const iv of o.interventions ?? []) {
      const fid = idFor(iv.factor_label);
      if (fid === undefined || kindOf(fid) !== 'factor') {
        loss.push(note(`nodes[${oid}].interventions.${fid ?? slugId(iv.factor_label)}`, iv.value, `"${o.label}" sets "${iv.factor_label}" to ${iv.value}`
          + `${iv.unit ? ` ${iv.unit}` : ''}, but "${iv.factor_label}" is not a factor in this model, so that level is not used; Olumi kept it as drafted.`, 'warn'));
        continue;
      }
      const factorLabel = String(nodeById.get(fid)!.description ?? nodeById.get(fid)!.label);
      const declaredFactor = c.factors.find((f) => idFor(f.label) === fid);
      const aFactorId = aIdOf.get(fid);
      const aLevel = aFactorId === undefined ? undefined : (aOption?.interventions as Rec | undefined)?.[aFactorId] as Rec | undefined;
      const path = `nodes[${oid}].interventions.${fid}`;
      if (typeof iv.unit === 'string' && iv.unit.trim() !== '' && typeof declaredFactor?.unit === 'string' && declaredFactor.unit.trim() !== ''
        && !sameUnit(iv.unit, declaredFactor.unit)) {
        loss.push(note(path, iv.value, `"${o.label}" sets "${factorLabel}" to ${iv.value} ${iv.unit}, but "${factorLabel}" is measured in `
          + `${declaredFactor.unit}, so that level is not used; Olumi kept it as drafted.`, 'warn'));
        continue;
      }
      if (aLevel === undefined) { loss.push(notConverted(a, path, factorLabel, `The level "${o.label}" sets`, iv.value)); continue; }
      const setBy = whoOf((iv as Rec).origin, iv.value, iv.unit ?? declaredFactor?.unit, (st) => about('option', o.label, 'level')(st)
        && canonicalLabel(String(st.subject.factor_label ?? '')) === canonicalLabel(iv.factor_label));
      const computed = (iv as Rec).value_kind === 'additional';
      const who: Who = computed ? 'olumi' : setBy;
      if (computed) {
        const unit = iv.unit ?? '';
        const say = (v: unknown): string => (finite(v) ? sayFigure(v, unit) : String(v));
        loss.push(note(`${path}.derived_total`, { today: declaredFactor?.baseline_value, added: iv.value },
          `"${o.label}" sets "${factorLabel}" to ${say(aLevel.raw_value ?? aLevel.value)}, Olumi's derived figure: ${derivation(say(aLevel.raw_value ?? aLevel.value),
            [{ by: factorWho.get(canonicalLabel(factorLabel)) ?? 'unknown', amount: say(declaredFactor?.baseline_value) }, { by: setBy, amount: say(iv.value) }])}.`));
      }
      if (bundle[fid] !== undefined && !(who === 'user' && bundle[fid].source !== 'brief_extraction')) continue;
      if (who === 'other') blocked.push({ field_path: path, declared: 'other', missing: 'speaker_name' });
      bundle[fid] = { ...levelNumbersOf(aLevel), source: who === 'olumi' ? 'cee_hypothesis' : 'brief_extraction',
        target_match: { node_id: fid, match_type: 'exact_id', confidence: 'high' },
        ...(who === 'other' || who === 'unknown' ? { user_material_unverified: true as const } : {}) };
    }
    if (Object.keys(bundle).length > 0) nodeById.get(oid)!.interventions = bundle;
  }

  // Links: an option's links are A's (below). Every other link carries A's size for the same pair, except a size the AI
  // declared as a person's (DL ruling (a)): that keeps Olumi's placeholder, said, kept and listed, unless the link is a part of a
  // sum A holds (below), or the user's own recorded statement of that link backs it (`userRecordOf`): then it is sized as theirs.
  const aEdgeOf = new Map<string, Rec>(a.edges.map((e) => [`${e.from}::${e.to}`, e]));
  // ⭐ THE AIE'S MAPPING A, ON B (DL 19 Oct): a link that is a part of a sum A holds (one the AI declared, or A's limited tally) is
  // that sum's DEFINITION, never anyone's size estimate: each part linked one for one in the total's unit, every definitional part
  // named, today's parts adding up to today's total. It takes A's exact definition (existence 1, no estimate spread) beside the
  // identity the Run evaluates. A definitional flag or equal units alone never does this.
  const sumParts = new Set(a.nodes.flatMap((n) => (n.nonlinear_identity?.operation === 'sum'
    ? n.nonlinear_identity.factor_ids.map((f) => `${bIdOfA.get(f)}::${bIdOfA.get(n.id)}`) : [])));
  const causal: CandidateLink[] = [];
  const placeholder = new Set<CandidateLink>();
  const personSized = new Set<CandidateLink>();
  // The stored-graph sizing view of these nodes (A's numbers).
  const view = magnitudeNodes(nodes, percentLevelIds({ goal_constraints: [] }));
  const sizing = new Map<string, LinkSizing>();
  const drawnByPair = new Map<string, Who>();
  for (const l of c.links) {
    const from = idFor(l.from), to = idFor(l.to);
    if (from === undefined || to === undefined || from === to) {
      loss.push(note(`edges[${l.from}::${l.to}]`, { from: l.from, to: l.to }, `The link from "${l.from}" to "${l.to}" names something not in the model, so it is not drawn.`, 'warn'));
      continue;
    }
    if (kindOf(from) === 'option') continue;
    const drawnBy = whoOf((l as Rec).origin === 'user' ? 'unknown' : (l as Rec).origin);
    drawnByPair.set(`${from}::${to}`, drawnBy);
    if (drawnBy === 'other' || drawnBy === 'unknown') blocked.push({ field_path: `edges[${from}::${to}]`, declared: drawnBy, missing: 'link_origin' });
    const { strength_mean: _mean, strength_std: _std, ...drafted } = l;
    const link: CandidateLink = { ...drafted, from, to };
    const sizeBy: Who = (l as Rec).origin === 'user' ? 'user' : whoOf((l as Rec).origin);
    const sized = finite(l.effect_amount) && finite(l.effect_per_source_change) && l.effect_per_source_change !== 0 && sizeBy !== 'olumi';
    // The person's record-backed size, through A's own sizing as theirs (Science census exception, DL ruling (a)); used only
    // where A's sizing holds it as theirs, else it keeps the placeholder below, said and listed.
    const record = sized && sizeBy === 'user' ? userRecordOf(l, naturalAmountUnitOf(view.get(to)!), unitOf(view.get(from)!)) : undefined;
    const theirs = record === undefined || link.direction === 'unknown' ? undefined : sizeLink({ direction: link.direction, effect_amount: link.effect_amount,
      effect_per_source_change: link.effect_per_source_change, user_stated: true, ...(record.range !== undefined ? { stated_range: record.range } : {}) },
    view.get(from)!, view.get(to)!);
    if (sized && sumParts.has(`${from}::${to}`) && aEdgeOf.has(aPair(from, to))) {
      // The definition replaces the declared size; whose the AI said that size was is still listed (GraphV3 cannot hold it).
      blocked.push({ field_path: `edges[${from}::${to}]`, declared: sizeBy as BlockedSchema['declared'], missing: 'link_size_origin' });
    } else if (theirs?.outcome === 'user_stated') {
      personSized.add(link);
      sizing.set(`${from}::${to}`, theirs);
    } else if (sized) {
      const quoted = (l as Rec).source_quote;
      // ⛔ No words, no claim (K5 loop, DL 20 Oct): a size with no quote was never "said" by the user or the brief.
      const sizeWords = typeof quoted === 'string' && quoted.trim() !== ''
        ? `${sizeBy === 'user' ? 'You said' : 'Your brief says'} "${quoted.trim()}"; this path doesn't use ${sizeBy === 'user' ? 'your link sizes' : 'link sizes from your brief'}`
        : `This link was drafted at ${l.effect_amount} per ${l.effect_per_source_change}; this path doesn't use that size`;
      loss.push(note(`edges[${from}::${to}].link_size_not_used`, { effect_amount: l.effect_amount, effect_per_source_change: l.effect_per_source_change },
        `${sizeWords} in the calculation yet, so the link `
        + `from "${nodeById.get(from)?.label}" to "${nodeById.get(to)?.label}" keeps Olumi's placeholder size.`, 'warn'));
      blocked.push({ field_path: `edges[${from}::${to}]`, declared: sizeBy as BlockedSchema['declared'], missing: 'link_size_origin' });
      placeholder.add(link);
    } else if (!aEdgeOf.has(aPair(from, to))) placeholder.add(link);
    causal.push(link);
  }
  // Placeholders: direction only. This site never passes user_stated true (pinned by the Science Fi census).
  for (const l of placeholder) {
    if (l.direction === 'unknown') continue;
    sizing.set(`${l.from}::${l.to}`, sizeLink({ direction: l.direction, effect_amount: null, effect_per_source_change: null, user_stated: false },
      view.get(l.from)!, view.get(l.to)!));
  }
  const drawn = admitCandidateLinks(causal.map((l) => (placeholder.has(l) ? { ...l, effect_amount: null, effect_per_source_change: null } : l)), sizing);
  loss.push(...drawn.withheld.map((w) => note(`edges[${w.from}::${w.to}]`, { from: w.from, to: w.to }, w.detail, 'warn')));
  const linkEdges = drawn.edges.map((e): Rec => {
    const l = causal.find((x) => x.from === e.from && x.to === e.to)!;
    const aEdge = placeholder.has(l) || personSized.has(l) ? undefined : aEdgeOf.get(aPair(e.from, e.to));
    const quote = (l as Rec).source_quote;
    const sized: Rec = aEdge === undefined ? e : { ...aEdge, from: e.from, to: e.to };
    // The selected A edge keeps A's science; only this admission's selected edges carry its ledger.
    const sourcePath = aEdge === undefined ? `edges[${e.from}::${e.to}].` : `edges[${aPair(e.from, e.to)}].`;
    const linkLoss = (aEdge === undefined ? drawn.loss : a.loss).filter(row => row.field_path.startsWith(sourcePath))
      .map(row => ({ ...row, field_path: row.field_path.replace(sourcePath, `edges[${e.from}::${e.to}].`) }));
    loss.push(...linkLoss);
    const defaults = linkLoss.filter(row => (drawn.projected_fields[`${e.from}::${e.to}`] ?? [])
      .some(field => row.field_path === `edges[${e.from}::${e.to}].${field}`));
    return { ...sized, provenance: { ...(sized.provenance ?? {}),
      ...(defaults.length === 0 ? {} : { uncertainty_defaults: defaults }),
      ...(typeof quote === 'string' && quote.trim() !== '' ? { source_quote: quote } : {}) } };
  });

  const topo = (from: string, to: string): { from: string; to: string } & Rec => ({ from, to, strength: { ...STRUCTURAL_EDGE_DEFAULTS.strength },
    exists_probability: STRUCTURAL_EDGE_DEFAULTS.exists_probability, effect_direction: STRUCTURAL_EDGE_DEFAULTS.effect_direction,
    provenance: { source: 'cee_hypothesis' } });
  const decisionId = nodes.find((n) => n.kind === 'decision')!.id;
  // SCIENCE (structure): each option's links are A's — what it sets and acts on, with A's rules (a level on a quantity its own
  // levers make, a link with no direction, are not drawn). A status quo is held as A holds it (`wireInertStatusQuo`): on the
  // label-blind draft, only the ONE status quo the AI declared, when it acts on nothing — never one its name reads as.
  const held = (e: object): boolean => (e as Rec).origin === REPAIR_AUTHORED_ORIGIN;
  const optionEdges = a.edges.flatMap((e) => {
    const from = bIdOfA.get(e.from), to = bIdOfA.get(e.to);
    return from === undefined || to === undefined || kindOf(from) !== 'option' ? [] : [{ ...e, from, to }];
  });
  for (const from of new Set(optionEdges.filter(held).map((e) => e.from))) {
    nodeById.get(from)!.is_baseline = true;
    loss.push(...aSaid(`nodes[${aIdOf.get(from)}].status_quo_held`));
  }
  for (const w of a.withheld) {
    const from = bIdOfA.get(String(w.from)) ?? idFor(String(w.from));
    if (from !== undefined && kindOf(from) === 'option' && w.loop === undefined) loss.push(note(`edges[${from}::${w.to}]`, { from: w.from, to: w.to }, w.detail, 'warn'));
  }
  const topology = [...nodes.filter((n) => n.kind === 'option').map((o) => topo(decisionId, o.id)), ...optionEdges];

  const goalId = nodes.find((n) => n.kind === 'goal')!.id;
  // A loop is broken where A broke it (A's own withheld links), then by `breakLoops` for any loop only this draft has.
  const aLeftOut = new Set(a.withheld.filter((w) => w.loop !== undefined).map((w) => `${w.from}::${w.to}`));
  // SCIENCE (structure, signs), its authorship exemption read by the DECLARED origin: a factor → risk link that only re-draws
  // the factor's own direct links counts that effect twice, so it is left out (A's rule and words, `oneRoutePerEffect`); a link
  // the AI declared the user's is their claim and stays.
  const routes = oneRoutePerEffect(linkEdges.map((e) => ({ from: String(e.from), to: String(e.to), effect_direction: e.effect_direction as string | undefined,
    provenance: { source: drawnByPair.get(`${e.from}::${e.to}`) === 'user' ? 'user' : 'olumi' } })),
    new Map(nodes.map((n) => [n.id, n.kind] as const)), new Map(nodes.map((n) => [n.id, n.label] as const)), new Set(['user']));
  const routed = new Set(routes.edges.map((e) => `${e.from}::${e.to}`));
  const folded = linkEdges.map((e) => `edges[${e.from}::${e.to}]`).filter((p) => !routed.has(p.slice(6, -1)));
  const aboutFolded = (path: string): boolean => folded.some((p) => path === p || path.startsWith(`${p}.`));
  blocked.splice(0, blocked.length, ...blocked.filter((x) => !aboutFolded(x.field_path)));
  loss.splice(0, loss.length, ...loss.filter((x) => !aboutFolded(String(x.field_path))), ...routes.loss);
  const keptLinks = linkEdges.filter((e) => routed.has(`${e.from}::${e.to}`) && !aLeftOut.has(aPair(e.from, e.to)));
  loss.push(...linkEdges.filter((e) => routed.has(`${e.from}::${e.to}`) && !keptLinks.includes(e)).map((e) => note(`edges[${e.from}::${e.to}].loop_withheld`, { from: e.from, to: e.to },
    a.withheld.find((w) => `${w.from}::${w.to}` === aPair(e.from, e.to))?.detail ?? 'This link closes a loop, which the analysis cannot run, so it is left out.', 'warn')));
  const loops = breakLoops([...topology, ...keptLinks] as { from: string; to: string }[], {
    mayWithhold: (e) => kindOf(e.from) !== 'option' && kindOf(e.from) !== 'decision', goalId, kindOf });
  loss.push(...loops.withheld.map(({ edge }) => note(`edges[${edge.from}::${edge.to}].loop_withheld`, { from: edge.from, to: edge.to },
    `The link from "${nodeById.get(edge.from)?.label}" to "${nodeById.get(edge.to)?.label}" closes a loop, which the analysis cannot run, so it is left out.`, 'warn')));
  const edges = loops.edges as Rec[];

  // Limits: A's, on the same nodes.
  const goal_constraints = a.goal_constraints.flatMap((k) => { const id = bIdOfA.get(k.node_id); return id === undefined ? [] : [{ ...k, node_id: id }]; });

  // A declared sum: operands, units, frames and today's arithmetic only (no brief and no quote reach the check); Olumi's
  // derivation, said with the existing words and today's arithmetic; its parts keep their own origins.
  const frames = magnitudeNodes(nodes, percentLevelIds({ goal_constraints }));
  const sums = checkDeclaredSums(list<CandidateIdentity>(c.identities).map(({ evidence: _evidence, ...d }) => d as CandidateIdentity), idFor,
    nodes, edges as never, (id) => { const n = frames.get(id); return n === undefined ? undefined : resolveMagnitudeFrame(n); }, undefined);
  loss.push(...sums.loss);
  for (const s of sums.accepted) {
    nodeById.get(s.outcome_id)!.nonlinear_identity = { operation: 'sum', factor_ids: [...s.factor_ids], stated_in_brief: false };
    const named = (id: string): string => String(nodeById.get(id)?.description ?? nodeById.get(id)?.label ?? id);
    const today = (id: string): unknown => (nodeById.get(id)?.observed_state as Rec | undefined)?.raw_value;
    const arithmetic = [s.outcome_id, ...s.factor_ids].every((id) => finite(today(id)))
      ? ` Today: ${derivation(String(today(s.outcome_id)), s.factor_ids.map((id) => ({ by: factorWho.get(canonicalLabel(named(id))) ?? 'unknown', amount: String(today(id)) })))}.` : '';
    loss.push(note(`nodes[${s.outcome_id}].sum_identity`, null, declaredSumSentence(named(s.outcome_id), s.factor_ids.map(named), false) + arithmetic));
  }
  // SCIENCE (structure, units): A's identity carriers on the same nodes — a declared product A checked on the structure
  // (`markProductIdentities`; whose reading it is follows the declaration's own provenance) and a limited tally of same-unit
  // levers (`findSumTallies`) — said in A's words. A carrier over a part this draft does not declare is not taken (A's Route A
  // binds a definition by the goal's quantity words in a name, so label-blind it is never compiled).
  for (const an of a.nodes) {
    const id = bIdOfA.get(an.id);
    const carrier = an.nonlinear_identity;
    if (id === undefined || carrier === undefined || nodeById.get(id)!.nonlinear_identity !== undefined) continue;
    if (carrier.factor_ids.some((f) => !bIdOfA.has(f))) continue;
    nodeById.get(id)!.nonlinear_identity = { ...carrier, factor_ids: carrier.factor_ids.map((f) => bIdOfA.get(f)!) };
    loss.push(...aSaid(`nodes[${an.id}].nonlinear_identity`), ...aSaid(`nodes[${an.id}].sum_identity`));
  }
  // A's refusal of a declared identity, said where no carrier stands on that node here (a sum A refuses only for its quote is kept above).
  loss.push(...a.loss.filter((l) => {
    const m = /^nodes\[(.+)\]\.nonlinear_identity_rejected$/.exec(String(l.field_path));
    return m !== null && nodeById.get(bIdOfA.get(m[1]!) ?? m[1]!)?.nonlinear_identity === undefined;
  }));

  // What the draft declares that this conversion does not carry yet is said (and kept, verbatim, in `declared`).
  const notCarried = [...(g.kind === 'event_by_date' ? [`a forecast for the deadline of "${g.deliverable ?? g.metric}"`] : []),
    ...list<Rec>(c.identities).filter((d) => d?.operation === 'accumulation' && !finite(g.horizon_months))
      .map((d) => `how "${d.outcome}" is made up`), ...(g.scope ? [`whether "${g.metric}" is one part or the whole`] : [])];
  if (notCarried.length > 0) loss.push(note(`nodes[${goalId}].not_carried`, null, `This draft does not include ${notCarried.join(', or ')} yet; Olumi kept it as drafted.`));
  return { graph: { nodes, edges, ...(goal_constraints.length > 0 ? { goal_constraints } : {}) }, declared: structuredClone(input), loss, blocked_schema: blocked };
}

/** The user's own words the draft was made from, and when it is recorded: with them, the draft's statements are carried. */
export interface StatementCarry { readonly words: string; readonly recorded_at: string }

/**
 * ⭐ THE DRAFT'S STATEMENTS, CARRIED AS DATA (DL 19 Oct, after the gap 3 loss table: "a data carry, not a rule"). Each statement the
 * drafter declared is recorded on its declared subject by the ONE claim-record writer, as construction records them
 * (`withUserStatement`, `CONSTRUCTION_ATTEST`; C5's GAP 1 builds its claims the same way): the quote, the line of the user's words
 * that holds it, the form, figures, unit, qualifier and conditions, and who said it as the AI declared. A record is the user's
 * words, so only a quote their text holds verbatim is recorded (`verbatimSourceLine`). A declared other person has no name here: their
 * words are recorded as from an unclear source, and the name is listed (`speaker_name`). A risk's holds-now or chance stays with its
 * card, as in A. A subject not in the model records nothing. `declared` keeps every statement.
 */
function withDeclaredStatements(graph: Rec, input: unknown, carry: StatementCarry, blocked: BlockedSchema[]): Rec {
  const nodes = list<Rec>(graph.nodes);
  const idOf = (label: unknown, kinds: readonly string[]): string | undefined => {
    if (typeof label !== 'string') return undefined;
    const hits = nodes.filter((n) => kinds.includes(String(n.kind)) && canonicalLabel(String(n.description ?? n.label)) === canonicalLabel(label));
    return hits.length === 1 ? String(hits[0]!.id) : undefined;
  };
  const subjectOf = (s: Rec, field: DoorSubject['field']): DoorSubject | undefined => {
    if (s.kind === 'link') {
      const from = idOf(s.label, ['factor', 'risk', 'outcome', 'goal', 'option']), to = idOf(s.to_label, ['factor', 'risk', 'outcome', 'goal']);
      return from !== undefined && to !== undefined && list<Rec>(graph.edges).some((e) => e.from === from && e.to === to)
        ? { kind: 'link', id: from, to_id: to, field } : undefined;
    }
    if (s.kind === 'option' && typeof s.factor_label === 'string' && s.factor_label.trim() !== '') {
      const option = idOf(s.label, ['option']), factor = idOf(s.factor_label, ['factor']);
      return option !== undefined && factor !== undefined ? { kind: 'factor', id: factor, option_id: option, field } : undefined;
    }
    if (s.kind === 'risk' && (field === 'holds_now' || field === 'occurrence')) return undefined;
    const id = ['goal', 'factor', 'option', 'risk'].includes(String(s.kind)) ? idOf(s.label, [String(s.kind)]) : undefined;
    return id === undefined ? undefined : { kind: s.kind as DoorSubject['kind'], id, field };
  };
  const text = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() !== '' ? v : undefined);
  // Stance belongs to this declared figure, never a neighbouring statement or the item's introduction tag.
  const declaredStance = (st: Rec): unknown => {
    const draft = input as Rec, subject = st.subject;
    const named = (items: unknown, label: unknown): Rec | undefined => list<Rec>(items)
      .find((n) => canonicalLabel(String(n.label ?? '')) === canonicalLabel(String(label ?? '')));
    if (subject.kind === 'goal') return draft.goal?.[st.field === 'target' ? 'target_stance' : 'baseline_stance'];
    if (subject.kind === 'option') return list<Rec>(named(draft.options, subject.label)?.interventions)
      .find((iv) => canonicalLabel(String(iv.factor_label)) === canonicalLabel(String(subject.factor_label)))?.stance;
    if (subject.kind === 'link') return list<Rec>(draft.links).find((l) => canonicalLabel(String(l.from)) === canonicalLabel(String(subject.label))
      && canonicalLabel(String(l.to)) === canonicalLabel(String(subject.to_label)))?.stance;
    return named(draft[`${subject.kind}s`], subject.label)?.stance;
  };
  const groups = new Map<string, { subject: DoorSubject; statements: UserStatement[] }>();
  for (const st of list<Rec>((input as Rec).statements)) {
    const s = st?.subject;
    if (s === null || typeof s !== 'object' || !isStatementField(st.field) || typeof st.quote !== 'string') continue;
    const subject = subjectOf(s as Rec, st.field);
    const source = subject === undefined ? undefined : verbatimSourceLine({ now: carry.words }, st.quote);
    if (subject === undefined || source === undefined) continue;
    // The figures as the record holds them: a point's two ends equal, a bound's one end, a range's ends and its stated central figure.
    const one = finite(st.value) ? st.value : finite(st.low) && st.low === st.high ? st.low : undefined;
    const figures = st.form === 'point' ? (one === undefined ? undefined : { low: one, high: one })
      : st.form === 'range' ? (finite(st.low) && finite(st.high) ? { low: st.low, high: st.high, ...(finite(st.value) ? { value: st.value } : {}) } : undefined)
        : st.form === 'lower_bound' ? (finite(st.low) || finite(st.value) ? { low: finite(st.low) ? st.low : st.value } : undefined)
          : st.form === 'upper_bound' ? (finite(st.high) || finite(st.value) ? { high: finite(st.high) ? st.high : st.value } : undefined)
            : st.form === 'holds_now' || st.form === 'describes' ? {} : undefined;
    const statement = figures === undefined ? undefined : userStatementOf({ ...(st.speaker === 'user' ? { speaker: 'user' } : { said_by: 'unknown' }),
      quote: st.quote, source, subject: { quantity: subjectKey(subject), node_id: subject.id, ...(subject.option_id !== undefined ? { option_id: subject.option_id } : {}) },
      form: st.form, ...figures, ...(text(st.unit) !== undefined ? { unit: st.unit } : {}), ...(text(st.qualifier) !== undefined ? { qualifier: st.qualifier } : {}),
      ...(text(st.conditions) !== undefined ? { conditions: st.conditions } : {}), reading: 'olumi', stance: declaredStance(st) });
    if (statement === undefined) continue;
    if (st.speaker === 'other') blocked.push({ field_path: `nodes[${subject.id}].user_statements`, declared: 'other', missing: 'speaker_name' });
    const group = groups.get(subjectKey(subject)) ?? { subject, statements: [] };
    group.statements.push(statement);
    groups.set(subjectKey(subject), group);
  }
  let out = graph as Rec & { nodes: unknown[] };
  for (const { subject, statements } of groups.values()) {
    out = withUserStatement(out, userStatementRecord(subject, statements, carry.recorded_at, CONSTRUCTION_ATTEST), subject) ?? out;
  }
  return withRecordedRanges(out, input, carry.words, [...groups.values()]);
}

/**
 * ⭐ K2 ON B (the AIE's mapping B; DL 19 Oct: B only): an option's setting carries the range the user's recorded statement gives for
 * exactly that option and factor, through the existing setting-range input (`interventions[f].range`, `likely_range`, admitted by
 * `admitInterventionRange` against the setting's own figure), never a reading of the brief. Exactly what registration accepts as
 * that record's range (`onlyRecordedSettingRanges`): one user range, its quote byte for byte in the user's words. A range of a
 * declared ADDITION on the total Olumi computed is not carried (the setting is the total), nor one that brackets both readings.
 * Another person's or an unclear range stays in the record, since the range cannot say whose it is. The range is an interval; how
 * the analysis reads it is its existing, disclosed law (an equal-tail approximation the person adopts before any chance is shown).
 * ⭐ A FACTOR'S OWN LEVEL TODAY, the same way (DL 19 Oct): the user's recorded range rides the existing level carrier
 * (`observed_state.range`, `min_max`: the ends as written, read as bounds and nothing more), only where it contains the stored
 * figure. Nothing samples it, so the analysis is unchanged (`withoutStatedLevelRanges`).
 */
function withRecordedRanges(graph: Rec & { nodes: unknown[] }, input: unknown, words: string,
  said: readonly { subject: DoorSubject; statements: UserStatement[] }[]): Rec & { nodes: unknown[] } {
  const nodes = list<Rec>(graph.nodes).map((n) => ({ ...n }));
  const nameOf = (id: string | undefined): string => canonicalLabel(String(nodes.find((n) => n.id === id)?.description ?? nodes.find((n) => n.id === id)?.label ?? ''));
  for (const { subject, statements } of said) {
    const ranges = statements.filter((st) => st.speaker === 'user' && st.form === 'range' && finite(st.low) && finite(st.high));
    if (subject.kind === 'factor' && subject.field === 'level' && subject.option_id === undefined) {
      const factor = nodes.find((n) => n.id === subject.id && n.kind === 'factor');
      const os = factor?.observed_state as Rec | undefined;
      const figure: unknown = finite(os?.raw_value) ? os!.raw_value : os?.value;
      const r = ranges.length === 1 ? ranges[0]! : undefined;
      const range = r === undefined ? undefined : { low: r.low, high: r.high, meaning: 'min_max', source: 'brief_extraction', source_quote: r.quote };
      if (range !== undefined && os !== undefined && finite(figure) && r!.low! <= figure && figure <= r!.high! && StoredInterventionRange.safeParse(range).success
        && !(typeof r!.unit === 'string' && typeof os.unit === 'string' && !sameUnit(r!.unit, os.unit))) factor!.observed_state = { ...os, range };
      continue;
    }
    const option = nodes.find((n) => n.id === subject.option_id && n.kind === 'option');
    const cell = (option?.interventions as Rec | undefined)?.[subject.id] as Rec | undefined;
    const point = interventionPoint(cell);
    if (subject.kind !== 'factor' || subject.field !== 'level' || ranges.length !== 1 || cell === undefined || point === undefined) continue;
    const { low, high, quote, unit } = ranges[0]!;
    if (!words.includes(quote) || (typeof unit === 'string' && typeof cell.unit === 'string' && !sameUnit(unit, cell.unit))) continue;
    const declared = list<Rec>((input as Rec).options).find((o) => canonicalLabel(String(o?.label)) === nameOf(option!.id as string));
    const addition = list<Rec>(declared?.interventions).find((iv) => canonicalLabel(String(iv?.factor_label)) === nameOf(subject.id) && iv.value_kind === 'additional');
    const today = addition === undefined ? undefined : list<Rec>((input as Rec).factors).find((f) => canonicalLabel(String(f?.label)) === nameOf(subject.id))?.baseline_value;
    const within = (at: number): boolean => low! <= at && at <= high!;
    if (!within(point) || (finite(today) && today !== 0 && within(point - today))) continue;
    const range = { low, high, meaning: 'likely_range', source: 'brief_extraction', source_quote: quote };
    const admitted = admitInterventionRange({ ...cell, range });
    if (admitted !== undefined && 'range' in admitted) option!.interventions = { ...(option!.interventions as Rec), [subject.id]: { ...cell, range: admitted.range } };
  }
  return { ...graph, nodes };
}

/**
 * The draft as Olumi's provisional model: the converted graph through the build's own post-admission science — a declared
 * accumulation over a declared horizon, then the refit chain (stated `{goalOwnRows}` → Olumi → `clampForPersist`) — schema-checked.
 * With the user's words (`carry`), the draft's statements are recorded on their subjects (`withDeclaredStatements`).
 */
export function candidateToGraph(input: unknown, carry?: StatementCarry): CandidateToGraphResult {
  const converted = candidateToAdmittedGraph(input, carry?.words);
  if ('refused' in converted) return converted;
  const c = asCandidate(input)!;
  let graph0 = converted.graph as Rec;
  const loss = [...converted.loss];
  if (finite(c.goal.horizon_months)) {
    const accumulation = admitAccumulationIdentities(graph0.nodes as never, graph0.edges as never, c.identities);
    loss.push(...(accumulation.loss as RepairEntry[]));
    const accumulated = withAdmittedAccumulations(graph0.nodes as never, graph0.edges as never, accumulation);
    graph0 = { ...graph0, nodes: accumulated.nodes, edges: accumulated.edges };
  }
  const stated = refitFramesForStatedEffects(graph0, { goalOwnRows: true }).graph;
  const refit = clampForPersist(refitFramesForOlumiEstimates(stated as never).graph as never) as Record<string, unknown>;
  // A frame change rescales the admitted default; carry its existing attribution, never infer one from its new number.
  for (const edge of list<Rec>(graph0.edges)) {
    const fitted = list<Rec>(refit.edges).find(e => e.from === edge.from && e.to === edge.to);
    const defaults = linkDefaultAssumptionsOf(edge);
    if (fitted === undefined || defaults.length === 0) continue;
    fitted.provenance.uncertainty_defaults = list<RepairEntry>(edge.provenance.uncertainty_defaults).map(row => {
      if (!defaults.some(d => d.field_path === row.field_path) || !row.field_path.endsWith('.strength.std')) return row;
      const carried = { ...row, after: fitted.strength.std };
      const at = loss.findIndex(d => d.field_path === row.field_path && d.after === row.after);
      if (at !== -1) loss[at] = carried;
      return carried;
    });
  }
  const blocked_schema = [...converted.blocked_schema];
  const graph = carry === undefined ? refit : withDeclaredStatements(refit, input, carry, blocked_schema);
  return GraphV3.safeParse(graph).success ? { ...converted, graph, loss, blocked_schema } : { refused: 'graph_invalid' };
}
