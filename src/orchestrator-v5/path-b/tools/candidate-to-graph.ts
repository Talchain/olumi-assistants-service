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
 *    links come from the stored-graph sizing view (`magnitudeNodes` → `sizeLink`, never `user_stated`).
 *  · STRUCTURE AND AUTHORSHIP ARE THE DRAFT's, with NO C1/C2: every declared option, risk, outcome and link is kept; each
 *    figure keeps the origin the AI DECLARED, in the fields the one provenance authority reads (`cee/provenance/provenance-of.ts`):
 *    the user's = a type-less `brief_extraction` (human, by its stamp: declared, not attested); Olumi's = `cee_inference` +
 *    `inferred` / `cee_hypothesis`; an unknown speaker or a named third party = no stamp (unknown), or `user_material_unverified`
 *    on a setting. A computed total is Olumi's derived figure, said with its arithmetic (signed plan item 7). A link size the
 *    AI declared as a person's keeps Olumi's placeholder (DL ruling (a)). Origins GraphV3 cannot hold are `blocked_schema`.
 *  · The raw draft travels beside the graph verbatim (`declared`); C5's draft tool returns it, so the scenario's one
 *    Conversation keeps it. The draft is Olumi's provisional model. A is untouched: it still applies its gates.
 */
import type { RepairEntry } from '@talchain/schemas';
import {
  admitCandidateModel, admitOrdinaryCandidateModel, assignIds, breakLoops, canonicalLabel, checkDeclaredSums, declaredSumSentence,
  displayProvenanceFor, shortLabel, slugId,
  type AdmittedModel, type AdmittedNode, type CandidateIdentity, type CandidateModel, type CandidateNodeKind,
} from '../../agent-lane/admit-model.js';
import { prepareProvisionalCandidate } from '../../agent-lane/runtime/build-model.js';
import { admitCandidateLinks, type CandidateLink } from '../../agent-lane/admit-candidate.js';
import { sameUnit } from '../../agent-lane/same-unit.js';
import { oneRoutePerEffect } from '../../agent-lane/one-route-per-effect.js';
import { sayFigure } from '../../agent-lane/say-figure.js';
import { admitAccumulationIdentities, withAdmittedAccumulations } from '../../agent-lane/accumulation-identity.js';
import { clampForPersist, refitFramesForOlumiEstimates, refitFramesForStatedEffects } from '../../agent-lane/refit-frames.js';
import { resolveMagnitudeFrame, sizeLink, type LinkSizing } from '../../../cee/magnitude/link-effect.js';
import { magnitudeNodes, percentLevelIds } from '../../../cee/magnitude/frame-defaulted-links.js';
import { nodeProvenanceDisplay } from '../../../cee/provenance/provenance-of.js';
import { UNSIZED_OLUMI_RISK_REASON } from '../../agent-lane/unsized-risk.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';
import { REPAIR_AUTHORED_ORIGIN } from '../../../graph/repair-authored-edge.js';
import { GraphV3 } from '../../../schemas/cee-v3.js';

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
    const { candidate, readBack } = labelBlind(c);
    return { a: readBack(admitWithoutBrief(prepareProvisionalCandidate(candidate).candidate)) };
  } catch { return null; }
}

/** The converted graph BEFORE the build's refit chain (what the differential compares with A's admission). */
export function candidateToAdmittedGraph(input: unknown): Converted | { readonly refused: 'candidate_invalid' | 'not_convertible' } {
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
  const speakerOf = (kind: string, label: string, extra: (s: Rec) => boolean = () => true): unknown =>
    statements.find((s) => s?.subject?.kind === kind && canonicalLabel(String(s.subject.label ?? '')) === canonicalLabel(label) && extra(s))?.speaker;
  const whoOf = (provenance: unknown, speaker: unknown): Who => (speaker === 'other' ? 'other' : speaker === 'unknown' ? 'unknown'
    : provenance === 'explicit' ? 'user' : 'olumi');
  // A's own sentences, by the field they are about: a science decision this converter takes from A is said in A's words.
  const aSaid = (path: string): RepairEntry[] => a.loss.filter((l) => l.field_path === path);
  // SCIENCE (structure: what each option sets and acts on): an Olumi option that sets nothing the model can hold that another
  // option does not is left out here too, said in A's words; it stays in `declared`. A judged it on the label-blind draft
  // (`labelBlind`), so the only status quo it exempts is the one the AI declared (`is_status_quo`), never one its label reads as.
  const options = c.options.filter((o) => aSaid(`nodes[${slugId(o.label)}].option_indistinct`).length === 0);
  for (const o of c.options) if (!options.includes(o)) loss.push(...aSaid(`nodes[${slugId(o.label)}].option_indistinct`));

  // The goal: A's threshold, cap, frame and today's level; the AI's declared comparator, horizon and words beside them.
  const aGoal = [aFor(g.metric)].find((n) => n?.kind === 'goal') ?? a.nodes.find((n) => n.kind === 'goal');
  const goalWho = whoOf(g.baseline_provenance ?? g.provenance, speakerOf('goal', g.metric, (s) => s.field === 'level'));
  const targetWho = whoOf(g.provenance, speakerOf('goal', g.metric, (s) => s.field === 'target'));
  const goalPath = `nodes[${slugId(g.metric)}]`;
  const threshold = finite(aGoal?.goal_threshold_raw);
  if (threshold && (targetWho === 'other' || targetWho === 'unknown')) blocked.push({ field_path: `${goalPath}.goal_threshold_raw`, declared: targetWho, missing: 'target_origin' });
  if (goalWho === 'other' && aGoal?.observed_state !== undefined) blocked.push({ field_path: `${goalPath}.observed_state`, declared: 'other', missing: 'speaker_name' });
  if (finite(g.baseline_value) && aGoal?.observed_state === undefined) loss.push(notConverted(a, `${goalPath}.observed_state`, g.metric, "Today's level", g.baseline_value));
  if (g.target_stated !== false && finite(g.value) && !threshold) loss.push(notConverted(a, `${goalPath}.goal_threshold_raw`, g.metric, 'The target', g.value));
  const goalNumbers: Rec = Object.fromEntries(Object.entries(aGoal ?? {}).filter(([k]) => k.startsWith('goal_threshold') || k === 'quantity_frame'
    || k === 'scale_frame' || k === 'goal_target_basis' || k === 'goal_level_reading'));
  const goalNode: Rec = { ...goalNumbers,
    ...(aGoal?.observed_state !== undefined ? { observed_state: { ...numbersOf(aGoal.observed_state), ...valueStamp(goalWho) } } : {}),
    ...(threshold && ['>=', '<=', '>', '<'].includes(g.operator) ? { goal_direction: g.operator } : {}),
    ...(finite(g.horizon_months) && g.horizon_months > 0 ? { goal_horizon_months: g.horizon_months } : {}),
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
      const who = whoOf(f.provenance, speakerOf('factor', f.label, (s) => s.field === 'level'));
      factorWho.set(canonicalLabel(f.label), who);
      if (who === 'other' && an?.observed_state !== undefined) blocked.push({ field_path: `nodes[${slugId(f.label)}].observed_state`, declared: 'other', missing: 'speaker_name' });
      if (finite(f.baseline_value) && an?.observed_state === undefined) loss.push(notConverted(a, `nodes[${slugId(f.label)}].observed_state`, f.label, "Today's level", f.baseline_value));
      // SCIENCE (structure): A's category — a lever no option reaches is held as context (`demoteUnreachedLevers`), which
      // readiness reads; said in A's words.
      if (an?.category !== undefined && an.category !== f.role) loss.push(...aSaid(`nodes[${an.label}].category`));
      return { label: f.label, kind: 'factor' as const, provenance: f.provenance, node: {
        category: an?.category ?? f.role, ...(an?.scale_frame !== undefined ? { scale_frame: an.scale_frame } : {}), ...outOfRun(an, 'factor', who),
        ...(an?.observed_state !== undefined ? { observed_state: { ...numbersOf(an.observed_state), ...valueStamp(who) },
          ...(typeof f.baseline_evidence?.quote === 'string' ? { source_quote: f.baseline_evidence.quote } : {}) } : {}),
      } };
    }),
    ...[...c.risks.map((r) => ({ ...r, kind: 'risk' as const })), ...c.outcomes.map((o) => ({ ...o, kind: 'outcome' as const }))].map((n) => {
      const an = aFor(n.label);
      const who = whoOf(n.provenance, speakerOf(n.kind, n.label, (s) => s.field === 'level'));
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
      const setBy = whoOf(iv.provenance, speakerOf('option', o.label, (s) => s.field === 'level'
        && canonicalLabel(String(s.subject.factor_label ?? '')) === canonicalLabel(iv.factor_label)));
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
  // declared as a person's (DL ruling (a)): that keeps Olumi's placeholder, said, kept and listed.
  const aEdgeOf = new Map<string, Rec>(a.edges.map((e) => [`${e.from}::${e.to}`, e]));
  const causal: CandidateLink[] = [];
  const placeholder = new Set<CandidateLink>();
  const drawnByPair = new Map<string, Who>();
  for (const l of c.links) {
    const from = idFor(l.from), to = idFor(l.to);
    if (from === undefined || to === undefined || from === to) {
      loss.push(note(`edges[${l.from}::${l.to}]`, { from: l.from, to: l.to }, `The link from "${l.from}" to "${l.to}" names something not in the model, so it is not drawn.`, 'warn'));
      continue;
    }
    if (kindOf(from) === 'option') continue;
    const said = (field: string) => (st: Rec): boolean => st.field === field && canonicalLabel(String(st.subject.to_label ?? '')) === canonicalLabel(l.to);
    const drawnBy = whoOf(l.provenance, speakerOf('link', l.from, said('relation')));
    drawnByPair.set(`${from}::${to}`, drawnBy);
    if (drawnBy === 'other' || drawnBy === 'unknown') blocked.push({ field_path: `edges[${from}::${to}]`, declared: drawnBy, missing: 'link_origin' });
    const { strength_mean: _mean, strength_std: _std, ...drafted } = l;
    const link: CandidateLink = { ...drafted, from, to };
    const sizeBy = whoOf(l.effect_provenance ?? l.provenance, speakerOf('link', l.from, said('effect')));
    if (finite(l.effect_amount) && finite(l.effect_per_source_change) && l.effect_per_source_change !== 0 && sizeBy !== 'olumi') {
      const quoted = (l as Rec).source_quote;
      const words = typeof quoted === 'string' && quoted.trim() !== '' ? quoted.trim() : `${l.effect_amount} per ${l.effect_per_source_change}`;
      loss.push(note(`edges[${from}::${to}].link_size_not_used`, { effect_amount: l.effect_amount, effect_per_source_change: l.effect_per_source_change },
        `${sizeBy === 'user' ? 'You said' : 'Your brief says'} "${words}"; this path doesn't use ${sizeBy === 'user' ? 'your link sizes' : 'link sizes from your brief'} in the calculation yet, so the link `
        + `from "${nodeById.get(from)?.label}" to "${nodeById.get(to)?.label}" keeps Olumi's placeholder size.`, 'warn'));
      blocked.push({ field_path: `edges[${from}::${to}]`, declared: sizeBy as BlockedSchema['declared'], missing: 'link_size_origin' });
      placeholder.add(link);
    } else if (!aEdgeOf.has(aPair(from, to))) placeholder.add(link);
    causal.push(link);
  }
  // Placeholders: the stored-graph sizing view of these nodes (A's numbers), direction only. This site never passes
  // user_stated true (pinned by the Science Fi census).
  const view = magnitudeNodes(nodes, percentLevelIds({ goal_constraints: [] }));
  const sizing = new Map<string, LinkSizing>();
  for (const l of placeholder) {
    if (l.direction === 'unknown') continue;
    sizing.set(`${l.from}::${l.to}`, sizeLink({ direction: l.direction, effect_amount: null, effect_per_source_change: null, user_stated: false },
      view.get(l.from)!, view.get(l.to)!));
  }
  const drawn = admitCandidateLinks(causal.map((l) => (placeholder.has(l) ? { ...l, effect_amount: null, effect_per_source_change: null } : l)), sizing);
  loss.push(...drawn.withheld.map((w) => note(`edges[${w.from}::${w.to}]`, { from: w.from, to: w.to }, w.detail, 'warn')));
  const linkEdges = drawn.edges.map((e) => {
    const l = causal.find((x) => x.from === e.from && x.to === e.to)!;
    const aEdge = placeholder.has(l) ? undefined : aEdgeOf.get(aPair(e.from, e.to));
    const quote = (l as Rec).source_quote;
    const sized: Rec = aEdge === undefined ? e : { ...aEdge, from: e.from, to: e.to };
    return typeof quote === 'string' && quote.trim() !== '' ? { ...sized, provenance: { ...(sized.provenance ?? {}), source_quote: quote } } : sized;
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

/**
 * The draft as Olumi's provisional model: the converted graph through the build's own post-admission science — a declared
 * accumulation over a declared horizon, then the refit chain (stated `{goalOwnRows}` → Olumi → `clampForPersist`) — schema-checked.
 */
export function candidateToGraph(input: unknown): CandidateToGraphResult {
  const converted = candidateToAdmittedGraph(input);
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
  const graph = clampForPersist(refitFramesForOlumiEstimates(stated as never).graph as never) as Record<string, unknown>;
  return GraphV3.safeParse(graph).success ? { ...converted, graph, loss } : { refused: 'graph_invalid' };
}
