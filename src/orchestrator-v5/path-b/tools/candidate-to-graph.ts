/**
 * ⭐ STEP 8 (PLAN-TODAY 19 Oct; DL ruling (S), buddy r2 AMEND adopted): PATH-B's PURE draft conversion. The drafter's strict
 * JSON becomes a GraphV3 `{nodes, edges, goal_constraints}` through the product's existing science, and nothing else:
 *  · units and frames (`framedObservedState`, `defaultFrameFor`, `constructedLevel`); an addition is the factor's level plus
 *    the increment, in one unit; link sizes (`olumiSignedSize`, `sizeLink`, `admitCandidateLinks`); the goal's cap, its level's
 *    scale and direction (`resolveGoalThresholdCapWithProvenance`, `admitStatedGoalLevel` with the DECLARED comparator, so its
 *    label reader never runs), change targets (`admitStatedGoalChange`) and basis (`admitGoalTargetBasis`); limits
 *    (`admitCandidateConstraints`); declared sums' units, operands, frames and arithmetic (`checkDeclaredSums` with no brief
 *    and no quote, so neither its denial reader nor its quote refusal runs); the declared status quo held
 *    (as `wireInertStatusQuo` holds a declared one, with no label fallback); loops (`breakLoops`); declared accumulations; then the build's refit
 *    chain (stated `{goalOwnRows}` → Olumi → `clampForPersist`).
 *  · NO C1/C2: no unattested-goal refusal, no authorship binding, no range eligibility, no demotion. Each figure keeps the
 *    origin the AI DECLARED, in the existing fields the one provenance authority reads (`cee/provenance/provenance-of.ts`):
 *    the user's = a type-less `brief_extraction` (human, by its stamp: declared, not attested); Olumi's = `cee_inference` +
 *    `inferred` / `cee_hypothesis`; an unknown speaker or a named third party = no stamp (unknown), or `user_material_unverified`
 *    on a setting (read as unknown). The raw draft travels beside the graph verbatim (`declared`): C5's draft tool returns it
 *    in its result, so the scenario's one Conversation keeps it (DL, 19 Oct). The draft is Olumi's provisional model.
 * A (`admitCandidateModel`) is untouched: it still applies its gates.
 */
import type { RepairEntry } from '@talchain/schemas';
import {
  admitStatedGoalChange, admitStatedGoalLevel, assignIds, canonicalLabel, slugId, checkDeclaredSums, constructedLevel, defaultFrameFor,
  displayProvenanceFor, framedObservedState, shortLabel, breakLoops,
  type AdmittedNode, type CandidateIdentity, type CandidateModel, type CandidateNodeKind, type ConstructedLevel,
} from '../../agent-lane/admit-model.js';
import { admitCandidateLinks, type CandidateLink } from '../../agent-lane/admit-candidate.js';
import { admitCandidateConstraints } from '../../agent-lane/admit-constraint.js';
import { olumiSignedSize } from '../../agent-lane/convention-frame.js';
import { admitAccumulationIdentities, withAdmittedAccumulations } from '../../agent-lane/accumulation-identity.js';
import { clampForPersist, refitFramesForOlumiEstimates, refitFramesForStatedEffects } from '../../agent-lane/refit-frames.js';
import { resolveMagnitudeFrame, sizeLink, type LinkSizing, type MagnitudeNode } from '../../../cee/magnitude/link-effect.js';
import { CEE_GOAL_THRESHOLD_FRAME, resolveGoalThresholdCapWithProvenance } from '../../../utils/goal-threshold-cap.js';
import { admitGoalTargetBasis } from '../../goal-target/goal-target-basis.js';
import { isRelativeChangePercentUnit } from '../../agent-lane/same-unit.js';
import { nodeProvenanceDisplay } from '../../../cee/provenance/provenance-of.js';
import { STRUCTURAL_EDGE_DEFAULTS } from '../../../orchestrator/context/constants.js';
import { REPAIR_AUTHORED_ORIGIN } from '../../../graph/repair-authored-edge.js';
import { CONNECTIVITY_REPAIR_WIRING_REASON } from '../../../cee/unified-pipeline/stages/repair/status-quo-fix.js';
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
export type CandidateToGraphResult =
  | { readonly graph: Record<string, unknown>; readonly declared: unknown; readonly loss: readonly RepairEntry[];
    readonly blocked_schema: readonly BlockedSchema[] }
  | { readonly refused: 'candidate_invalid' | 'graph_invalid' };

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const list = <T>(v: unknown): T[] => (Array.isArray(v) ? v as T[] : []);
const note = (field_path: string, before: unknown, reason: string, severity: 'info' | 'warn' = 'info'): RepairEntry =>
  ({ field_path, before, after: null, reason, severity }) as RepairEntry;
/** The existing value stamps for each declared origin (`valueProvenanceOf`); an unknown or third party's figure has none. */
const valueStamp = (who: Who): Rec => (who === 'user' ? { source: 'brief_extraction' }
  : who === 'olumi' ? { source: 'cee_inference', extractionType: 'inferred' } : {});
const unstamped = ({ source: _s, extractionType: _e, ...numbers }: Rec): Rec => numbers;
/**
 * ⭐ ONE RULE FOR EVERY DERIVED FIGURE (DL, 19 Oct; Codex #3462 R2): a figure computed from declared inputs (an addition's
 * total; a checked definition's size) inherits an origin ONLY when every input has that same origin. Otherwise it is
 * Olumi's derived reading, and its inputs keep their own origins in `declared` and in the notes. Never a person's stamp on
 * a mixed result.
 */
const derivedOrigin = (inputs: readonly Who[]): Who => (inputs.length > 0 && inputs.every((w) => w === inputs[0]) ? inputs[0]! : 'olumi');

function asCandidate(v: unknown): CandidateModel | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const c = v as Rec;
  if (c.goal === null || typeof c.goal !== 'object' || typeof c.goal.metric !== 'string' || c.goal.metric.trim() === '') return null;
  const model: Rec = { ...c, constraints: list(c.constraints), options: list(c.options), factors: list(c.factors), risks: list(c.risks),
    outcomes: list(c.outcomes), links: list(c.links), identities: list(c.identities) };
  return model as CandidateModel;
}

export function candidateToGraph(input: unknown): CandidateToGraphResult {
  const c = asCandidate(input);
  if (c === null) return { refused: 'candidate_invalid' };
  const loss: RepairEntry[] = [];
  const blocked: BlockedSchema[] = [];
  const g = c.goal;
  // The AI's own reading of whose words each statement is, by the subject it declared.
  const statements = list<Rec>((input as Rec).statements);
  const speakerOf = (kind: string, label: string, extra: (s: Rec) => boolean = () => true): unknown =>
    statements.find((s) => s?.subject?.kind === kind && canonicalLabel(String(s.subject.label ?? '')) === canonicalLabel(label) && extra(s))?.speaker;
  const whoOf = (provenance: unknown, speaker: unknown): Who => (speaker === 'other' ? 'other' : speaker === 'unknown' ? 'unknown'
    : provenance === 'explicit' ? 'user' : 'olumi');

  // Frames: the frame the AI declared (`plausible_max`), else the convention frame of the largest figure drafted for it.
  const largest = new Map<string, number>();
  const seeFigure = (label: string, v: unknown): void => { if (finite(v)) largest.set(label, Math.max(largest.get(label) ?? 0, Math.abs(v))); };
  for (const f of c.factors) seeFigure(f.label, f.baseline_value);
  const todayOf = (label: string): unknown => c.factors.find((f) => canonicalLabel(f.label) === canonicalLabel(label))?.baseline_value;
  for (const o of c.options) for (const iv of o.interventions ?? []) {
    const today = todayOf(iv.factor_label);
    seeFigure(iv.factor_label, (iv as Rec).value_kind === 'additional' && finite(today) && finite(iv.value) ? today + iv.value : iv.value);
  }
  const frameFor = (label: string, declared: unknown): { cap?: number; convention?: true } => {
    const big = largest.get(label) ?? 0;
    if (finite(declared) && declared > 1 && declared >= big) return { cap: declared };
    return big > 1 ? { cap: defaultFrameFor(big), convention: true } : {};
  };

  const factorWho = new Map<string, Who>();
  const entities: { label: string; kind: CandidateNodeKind; provenance: string; node: Rec }[] = [
    { label: g.metric, kind: 'goal', provenance: g.provenance, node: goalFields(c, speakerOf, whoOf, loss, blocked) },
    ...c.options.map((o) => ({ label: o.label, kind: 'option' as const, provenance: o.provenance, node: {} })),
    ...c.factors.map((f) => {
      const { cap, convention } = frameFor(f.label, f.plausible_max);
      const who = whoOf(f.provenance, speakerOf('factor', f.label, (s) => s.field === 'level'));
      factorWho.set(f.label, who);
      if (who === 'other' && finite(f.baseline_value)) blocked.push({ field_path: `nodes[${slugId(f.label)}].observed_state`, declared: 'other', missing: 'speaker_name' });
      const quote = typeof f.baseline_evidence?.quote === 'string' ? { source_quote: f.baseline_evidence.quote } : {};
      return { label: f.label, kind: 'factor' as const, provenance: f.provenance, node: {
        category: f.role, ...(cap !== undefined ? { scale_frame: cap } : {}), ...(finite(f.baseline_value) ? quote : {}),
        ...(finite(f.baseline_value) ? { observed_state: { ...unstamped(framedObservedState({ ...f, plausible_max: cap })), ...valueStamp(who),
          ...(convention ? { frame_source: 'olumi_convention' } : {}) } } : {}),
      } };
    }),
    ...[...c.risks.map((r) => ({ ...r, kind: 'risk' as const })), ...c.outcomes.map((o) => ({ ...o, kind: 'outcome' as const }))].map((n) => ({
      label: n.label, kind: n.kind, provenance: n.provenance,
      node: finite(n.plausible_max) && n.plausible_max > 1 ? { scale_frame: n.plausible_max } : {},
    })),
  ];
  const question = typeof c.decision_question === 'string' && c.decision_question.trim() !== '' ? c.decision_question.trim() : null;
  entities.unshift({ label: question ?? `Decision: ${g.metric}`, kind: 'decision', provenance: question ? 'explicit' : 'inferred', node: {} });

  const ids = assignIds(entities.map((e) => e.label));
  const nodes: (AdmittedNode & Rec)[] = [];
  for (const e of entities) {
    const id = ids.get(e.label)!;
    if (nodes.some((n) => n.id === id)) continue;
    const label = shortLabel(e.label);
    const os = e.node.observed_state;
    nodes.push({ id, kind: e.kind, label, ...(label !== e.label ? { description: e.label } : {}),
      provenance: os !== undefined && e.kind !== 'goal' ? nodeProvenanceDisplay(undefined, os) : displayProvenanceFor(e.provenance), ...e.node });
  }
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const));
  const kindOf = (id: string): string | undefined => nodeById.get(id)?.kind;
  const idFor = (label: string): string | undefined => ids.get(label)
    ?? [...ids].find(([l]) => canonicalLabel(l) === canonicalLabel(label))?.[1];

  // Option settings: one level per factor, on the factor's frame; an addition is the factor's level plus it, in one unit.
  const interventionsByOption = new Map<string, Record<string, ConstructedLevel>>();
  const actsOn = new Map<string, Set<string>>();
  for (const o of c.options) {
    const oid = idFor(o.label)!;
    const acts = new Set<string>();
    const bundle: Record<string, ConstructedLevel & Rec> = {};
    for (const label of o.changes ?? []) { const fid = idFor(label); if (fid !== undefined && kindOf(fid) === 'factor') acts.add(fid); }
    for (const iv of o.interventions ?? []) {
      const fid = idFor(iv.factor_label);
      if (fid === undefined || kindOf(fid) !== 'factor' || !finite(iv.value)) continue;
      acts.add(fid);
      const factor = nodeById.get(fid)!;
      const declaredFactor = c.factors.find((f) => idFor(f.label) === fid);
      const kind = (iv as Rec).value_kind ?? 'absolute';
      const additional = kind === 'additional';
      const sameUnit = !!iv.unit && !!declaredFactor?.unit && iv.unit.trim().toLowerCase() === declaredFactor.unit.trim().toLowerCase();
      if ((kind !== 'absolute' && !additional) || (additional && (!finite(declaredFactor?.baseline_value) || !sameUnit))) {
        loss.push(note(`nodes[${oid}].interventions.${fid}.addition_without_total`, iv.value,
          `"${o.label}" changes "${iv.factor_label}" by ${iv.value}${iv.unit ? ` ${iv.unit}` : ''}, but no level of "${iv.factor_label}" in the same unit is drafted to add it to, so it is kept as what the option changes, with no level of its own.`, 'warn'));
        continue;
      }
      const level = additional ? declaredFactor!.baseline_value! + iv.value : iv.value;
      if (level < 0) {
        loss.push(note(`nodes[${oid}].interventions.${fid}.signed_level_withheld`, level,
          `"${o.label}" puts "${iv.factor_label}" at ${level}, and a level below zero cannot be analysed beside the others, so it is kept as what the option changes, with no level of its own.`, 'warn'));
        continue;
      }
      const setBy = whoOf(iv.provenance, speakerOf('option', o.label, (s) => s.field === 'level'
        && canonicalLabel(String(s.subject.factor_label ?? '')) === canonicalLabel(iv.factor_label)));
      // An addition's total is derived from today's level and the increment: one origin only when both share it.
      const todayBy = additional ? factorWho.get(declaredFactor!.label)! : setBy;
      const who = derivedOrigin([todayBy, setBy]);
      if (who !== todayBy || who !== setBy) {
        const unit = iv.unit ?? '';
        const say = (v: number): string => (/^[£$€]$/.test(unit) ? `${unit}${v.toLocaleString('en-GB')}` : `${v.toLocaleString('en-GB')}${unit ? ` ${unit}` : ''}`);
        const part = (by: Who, v: number): string => (by === 'olumi' ? `Olumi's ${say(v)} estimate` : by === 'user' ? `your ${say(v)}`
          : by === 'other' ? `another person's ${say(v)}` : `${say(v)} from an unclear source`);
        loss.push(note(`nodes[${oid}].interventions.${fid}.derived_total`, { today: declaredFactor!.baseline_value, added: iv.value },
          `"${o.label}" sets "${iv.factor_label}" to ${say(level)}, Olumi's derived reading: ${part(todayBy, declaredFactor!.baseline_value!)} + ${part(setBy, iv.value)}.`));
      }
      if (bundle[fid] !== undefined && !(who === 'user' && bundle[fid]!.source !== 'brief_extraction')) continue;
      if (who === 'other') blocked.push({ field_path: `nodes[${oid}].interventions.${fid}`, declared: 'other', missing: 'speaker_name' });
      bundle[fid] = { ...constructedLevel(fid, level, factor.scale_frame, who === 'olumi' ? 'cee_hypothesis' : 'brief_extraction', factor,
        iv.unit ?? declaredFactor?.unit ?? undefined, additional),
        ...(who === 'other' || who === 'unknown' ? { user_material_unverified: true as const } : {}),
        ...(iv.estimate === true ? { estimate: true } : {}), ...(typeof iv.basis === 'string' ? { basis: iv.basis } : {}) };
    }
    if (Object.keys(bundle).length > 0) { interventionsByOption.set(oid, bundle); nodeById.get(oid)!.interventions = bundle; }
    actsOn.set(oid, acts);
  }

  // Links: an option's link to a factor is the option acting on it; every other link is sized on both ends' frames.
  const causal: CandidateLink[] = [];
  const sizeWho = new Map<CandidateLink, Who>();
  for (const l of c.links) {
    const from = idFor(l.from), to = idFor(l.to);
    if (from === undefined || to === undefined || from === to) {
      loss.push(note(`edges[${l.from}::${l.to}]`, { from: l.from, to: l.to }, `The link from "${l.from}" to "${l.to}" names something not in the model, so it is not drawn.`, 'warn'));
      continue;
    }
    if (kindOf(from) === 'option' && kindOf(to) === 'factor') { actsOn.get(from)?.add(to); continue; }
    const said = (field: string) => (st: Rec): boolean => st.field === field && canonicalLabel(String(st.subject.to_label ?? '')) === canonicalLabel(l.to);
    const drawnBy = whoOf(l.provenance, speakerOf('link', l.from, said('relation')));
    if (drawnBy === 'other' || drawnBy === 'unknown') blocked.push({ field_path: `edges[${from}::${to}]`, declared: drawnBy, missing: 'link_origin' });
    // A drafted `strength_mean` (a legacy contract) is never read as an authored size: sizes come only from the natural effect.
    const { strength_mean: _mean, strength_std: _std, ...drafted } = l;
    const link: CandidateLink = { ...drafted, from, to };
    sizeWho.set(link, whoOf(l.effect_provenance ?? l.provenance, speakerOf('link', l.from, said('effect'))));
    causal.push(link);
  }
  const optionLevels = new Map<string, number[]>();
  for (const b of interventionsByOption.values()) for (const [fid, lv] of Object.entries(b)) optionLevels.set(fid, [...(optionLevels.get(fid) ?? []), lv.value]);
  const unitOf = new Map<string, string>();
  for (const n of [...c.factors, ...c.risks, ...c.outcomes]) if (typeof n.unit === 'string' && n.unit.trim() !== '') unitOf.set(idFor(n.label)!, n.unit);
  const magnitude = (n: AdmittedNode): MagnitudeNode => {
    const raw = n.goal_threshold_raw, today = n.observed_state?.raw_value;
    const gap = n.kind !== 'goal' || !finite(raw) ? undefined
      : n.goal_threshold_frame === 'change_abs' ? Math.abs(raw) : !finite(today) ? undefined
        : n.goal_threshold_frame === 'change_rel' ? Math.abs(raw * today) : Math.abs(raw - today);
    return { label: n.label, kind: n.kind, scale_frame: n.scale_frame, observed_state: n.observed_state as MagnitudeNode['observed_state'],
      goal_threshold_cap: n.goal_threshold_cap, goal_threshold_unit: n.goal_threshold_unit, ...(n.quantity_frame !== undefined ? { quantity_frame: n.quantity_frame } : {}),
      unit: unitOf.get(n.id) ?? null, option_levels: optionLevels.get(n.id) ?? [], ...(gap !== undefined ? { goal_gap: gap } : {}) };
  };
  // Link sizes (DL ruling, 19 Oct): only sizes Olumi declared are sized, as Olumi's (a checked one-for-one definition too:
  // its size derives from its declaration, `derivedOrigin`). A size the AI declared as a person's keeps Olumi's placeholder,
  // said in their words, kept in `declared` and listed: a link has no "declared, not attested" state, and `user_stated`
  // means attested (Science Fi). This site never passes it true.
  const sizing = new Map<string, LinkSizing>();
  for (const l of causal) {
    if (l.direction === 'unknown') continue;
    const amount = l.effect_amount, per = l.effect_per_source_change;
    const stated = finite(amount) && finite(per) && per !== 0;
    const definition = stated && l.definitional === true && Math.abs(amount / per) === 1;
    const who = derivedOrigin([sizeWho.get(l)!]);
    const used = stated && who === 'olumi';
    if (stated && !used) {
      const quoted = (l as Rec).source_quote;
      const words = typeof quoted === 'string' && quoted.trim() !== '' ? quoted.trim() : `${amount} per ${per}`;
      loss.push(note(`edges[${l.from}::${l.to}].link_size_not_used`, { effect_amount: amount, effect_per_source_change: per },
        `${who === 'user' ? 'You said' : 'Your brief says'} "${words}"; this path doesn't use ${who === 'user' ? 'your link sizes' : 'link sizes from your brief'} in the calculation yet, so the link `
        + `from "${nodeById.get(l.from)?.label}" to "${nodeById.get(l.to)?.label}" keeps Olumi's placeholder size.`, 'warn'));
      blocked.push({ field_path: `edges[${l.from}::${l.to}]`, declared: who as BlockedSchema['declared'], missing: 'link_size_origin' });
    }
    const signed = used ? olumiSignedSize(l, false) : { amount: null, per: null, resolved: false };
    sizing.set(`${l.from}::${l.to}`, sizeLink({ definitional: definition && !signed.resolved, direction: l.direction,
      effect_amount: signed.amount, effect_per_source_change: signed.per, user_stated: false },
    magnitude(nodeById.get(l.from)!), magnitude(nodeById.get(l.to)!)));
  }
  const links = admitCandidateLinks(causal, sizing);
  loss.push(...links.loss, ...links.withheld.map((w) => note(`edges[${w.from}::${w.to}]`, { from: w.from, to: w.to }, w.detail, 'warn')));
  for (const e of links.edges) {
    const quote = (causal.find((l) => l.from === e.from && l.to === e.to) as Rec | undefined)?.source_quote;
    if (typeof quote === 'string' && quote.trim() !== '' && e.provenance !== undefined) e.provenance.source_quote = quote;
  }

  const topo = (from: string, to: string): { from: string; to: string } & Rec => ({ from, to, strength: { ...STRUCTURAL_EDGE_DEFAULTS.strength },
    exists_probability: STRUCTURAL_EDGE_DEFAULTS.exists_probability, effect_direction: STRUCTURAL_EDGE_DEFAULTS.effect_direction,
    provenance: { source: 'cee_hypothesis' } });
  const decisionId = nodes.find((n) => n.kind === 'decision')!.id;
  const options = nodes.filter((n) => n.kind === 'option');
  const topology = options.flatMap((o) => [topo(decisionId, o.id), ...[...(actsOn.get(o.id) ?? [])].map((fid) => topo(o.id, fid))]);
  // The ONE status quo the AI declared, if it acts on nothing, is held at today's level of what the others set (as
  // `wireInertStatusQuo` holds a declared one; its label fallback is never reached here).
  const declaredStatusQuo = [...new Set(c.options.filter((o) => o.is_status_quo === true).map((o) => idFor(o.label)!))];
  const sq = declaredStatusQuo.length === 1 && (actsOn.get(declaredStatusQuo[0]!)?.size ?? 0) === 0 ? declaredStatusQuo[0]! : undefined;
  const basis = new Set<string>();
  for (const [oid, b] of interventionsByOption) if (oid !== sq) for (const fid of Object.keys(b)) basis.add(fid);
  if (basis.size === 0) for (const [oid, acts] of actsOn) if (oid !== sq) for (const fid of acts) basis.add(fid);
  const heldEdges = sq === undefined ? [] : [...basis].map((fid) => ({ ...topo(sq, fid),
    origin: REPAIR_AUTHORED_ORIGIN, provenance: { source: 'cee_hypothesis', reasoning: CONNECTIVITY_REPAIR_WIRING_REASON } }));
  if (heldEdges.length > 0) nodeById.get(sq!)!.is_baseline = true;

  const goalId = nodes.find((n) => n.kind === 'goal')!.id;
  const loops = breakLoops([...topology, ...heldEdges, ...links.edges] as { from: string; to: string }[], {
    mayWithhold: (e) => kindOf(e.from) !== 'option' && kindOf(e.from) !== 'decision', goalId, kindOf });
  loss.push(...loops.withheld.map(({ edge }) => note(`edges[${edge.from}::${edge.to}].loop_withheld`, { from: edge.from, to: edge.to },
    `The link from "${nodeById.get(edge.from)?.label}" to "${nodeById.get(edge.to)?.label}" closes a loop, which the analysis cannot run, so it is left out.`, 'warn')));
  let edges = loops.edges as Rec[];

  const constraints = admitCandidateConstraints(c.constraints, idFor, (id) => {
    const n = nodeById.get(id);
    return n === undefined ? undefined : { ...(n.observed_state ?? {}), ...(n.scale_frame !== undefined ? { scale_frame: n.scale_frame } : {}), label: n.label };
  });
  loss.push(...constraints.loss);

  // Declared sums: operands, units, frames and today's arithmetic only (no brief and no quote reach the check).
  const sums = checkDeclaredSums(list<CandidateIdentity>(c.identities).map(({ evidence: _evidence, ...d }) => d as CandidateIdentity), idFor,
    nodes, edges as never, (id) => { const n = nodeById.get(id); return n === undefined ? undefined : resolveMagnitudeFrame(magnitude(n)); }, undefined);
  loss.push(...sums.loss);
  // A sum is a relation, not a figure: Olumi's reading of the draft (`stated_in_brief: false`); its parts keep their own origins.
  for (const s of sums.accepted) nodeById.get(s.outcome_id)!.nonlinear_identity = { operation: 'sum', factor_ids: [...s.factor_ids], stated_in_brief: false };

  // What the draft declares that this conversion does not carry yet is said (and kept, verbatim, in `declared`).
  const notCarried = [...(g.kind === 'event_by_date' ? [`a forecast for the deadline of "${g.deliverable ?? g.metric}"`] : []),
    ...list<Rec>(c.identities).filter((d) => d?.operation === 'product' || (d?.operation === 'accumulation' && !finite(g.horizon_months)))
      .map((d) => `how "${d.outcome}" is made up`), ...(g.scope ? [`whether "${g.metric}" is one part or the whole`] : [])];
  if (notCarried.length > 0) {
    loss.push(note(`nodes[${goalId}].not_carried`, null, `This draft does not include ${notCarried.join(', or ')} yet; Olumi kept it as drafted.`));
  }
  // A declared accumulation over a declared horizon, before the refits.
  let graphNodes: Rec[] = nodes;
  if (finite(g.horizon_months)) {
    const accumulation = admitAccumulationIdentities(nodes as never, edges as never, c.identities);
    loss.push(...(accumulation.loss as RepairEntry[]));
    const accumulated = withAdmittedAccumulations(nodes as never, edges as never, accumulation);
    graphNodes = accumulated.nodes as Rec[]; edges = accumulated.edges as Rec[];
  }
  const stated = refitFramesForStatedEffects({ nodes: graphNodes, edges,
    ...(constraints.constraints.length > 0 ? { goal_constraints: constraints.constraints } : {}) } as Rec, { goalOwnRows: true }).graph;
  const graph = clampForPersist(refitFramesForOlumiEstimates(stated as never).graph as never) as Record<string, unknown>;
  if (!GraphV3.safeParse(graph).success) return { refused: 'graph_invalid' };
  return { graph, declared: structuredClone(input), loss, blocked_schema: blocked };
}

/** The goal as declared: an open aim gets no threshold; a target is read on its own cap, with the existing level rules. */
function goalFields(c: CandidateModel, speakerOf: (kind: string, label: string, extra?: (s: Rec) => boolean) => unknown,
  whoOf: (provenance: unknown, speaker: unknown) => Who, loss: RepairEntry[], blocked: BlockedSchema[]): Rec {
  const g = c.goal;
  const raw = g.value;
  const unit = g.unit ? { goal_threshold_unit: g.unit } : {};
  const horizon = finite(g.horizon_months) && g.horizon_months > 0 ? { goal_horizon_months: g.horizon_months } : {};
  const quote = typeof (g as Rec).source_quote === 'string' ? { source_quote: (g as Rec).source_quote } : {};
  if (g.target_stated === false || !finite(raw)) {
    if (finite(g.baseline_value)) {
      loss.push(note(`nodes[${slugId(g.metric)}].observed_state.baseline`, g.baseline_value, `Today's level of "${g.metric}" (${g.baseline_value}) `
        + 'was drafted, but with no target there is no scale to place it on yet, so it is not used; Olumi kept it as drafted.', 'warn'));
    }
    return { ...unit, goal_threshold_frame: CEE_GOAL_THRESHOLD_FRAME, ...horizon, ...quote };
  }
  const direction = g.operator === '>=' || g.operator === '<=' || g.operator === '>' || g.operator === '<' ? { goal_direction: g.operator } : {};
  const base = g.baseline_value;
  const baseWho = whoOf(g.baseline_provenance ?? g.provenance, speakerOf('goal', g.metric, (s) => s.field === 'level'));
  const targetWho = whoOf(g.provenance, speakerOf('goal', g.metric, (s) => s.field === 'target'));
  const goalPath = `nodes[${slugId(g.metric)}]`;
  if (targetWho === 'other' || targetWho === 'unknown') blocked.push({ field_path: `${goalPath}.goal_threshold_raw`, declared: targetWho, missing: 'target_origin' });
  if (baseWho === 'other' && finite(base)) blocked.push({ field_path: `${goalPath}.observed_state`, declared: 'other', missing: 'speaker_name' });
  const baselineStamp = (os: Rec | undefined): Rec => (os === undefined ? {} : { observed_state: { ...unstamped(os), ...valueStamp(baseWho) } });
  const withheld = (reason: string): void => { loss.push(note(`nodes[${slugId(c.goal.metric)}].observed_state.baseline`, base ?? null, reason, 'warn')); };
  if (g.frame === 'change_rel' && isRelativeChangePercentUnit(g.unit, raw)) {
    // Whether this "%" is the change's own or the metric's is not declared, and only a label reader could guess it.
    loss.push(note(`${goalPath}.not_carried`, raw, `This draft does not include the target for "${g.metric}" (a change of ${raw}${g.unit}) yet: `
      + `it does not say whether "${g.metric}" is itself measured in ${g.unit}. Olumi kept it as drafted.`, 'warn'));
    return { goal_threshold_frame: CEE_GOAL_THRESHOLD_FRAME, ...horizon, ...quote };
  }
  if (g.frame === 'change_abs' || g.frame === 'change_rel') {
    // The level is the one the AI declared, whoever's it is: the rule runs as for a stated level, and the stamp says whose.
    const change = admitStatedGoalChange({ ...g, baseline_known: true, baseline_provenance: 'explicit' }, raw, () => true, null);
    if (change.withheld !== undefined) withheld(change.withheld);
    return { ...change.node, ...baselineStamp(change.node.observed_state as Rec | undefined), ...direction, ...horizon, ...quote };
  }
  const signedScale = finite(base) && base < 0 && raw >= base && (g.operator === '>=' || g.operator === '>') ? -base : undefined;
  const fromTarget = resolveGoalThresholdCapWithProvenance(undefined, raw, g.unit, undefined);
  const ceilingScale = (g.operator === '<=' || g.operator === '<') && fromTarget?.provenance === 'target_derived_headroom' && finite(base) && base > raw
    ? { cap: Math.max(base, raw) * 1.25, provenance: 'level_frame' as const } : undefined;
  const resolved = ceilingScale ?? fromTarget ?? (signedScale !== undefined ? { cap: signedScale, provenance: 'level_frame' as const } : null);
  let observed_state: Rec | undefined;
  if (resolved !== null && finite(base)) {
    // The declared comparator is held as the level rule's comparator; a strict floor is never passed, so no label is read.
    // A strict floor's level is read on the floor rule (`>` and `>=` differ only at the target, which the held `goal_direction`
    // scores); a ceiling's comparator is held as declared. No strict comparator is passed, so no label is ever read.
    const verdict = admitStatedGoalLevel({ metric: g.metric, operator: g.operator === '>' ? '>=' : g.operator, rawTarget: raw, rawBaseline: base, cap: resolved.cap,
      targetUnit: g.unit, ...(g.operator === '<=' || g.operator === '<' ? { heldComparator: g.operator } : {}),
      ...((g.frame ?? 'level') === 'level' ? { targetFrame: 'level' } : {}),
      ...(signedScale !== undefined && resolved.provenance === 'level_frame' ? { signedLevel: true as const } : {}) });
    if (verdict.admitted) {
      observed_state = { value: verdict.normalised, baseline: verdict.normalised, ...(g.unit ? { unit: g.unit } : {}), raw_value: base, cap: resolved.cap };
    } else withheld(verdict.reason);
  }
  const basis = admitGoalTargetBasis({ drafted: g.basis, quantityFrame: g.quantity_frame === 'change' ? 'change' : 'level',
    targetFrame: 'level', targetRaw: raw, horizonMonths: g.horizon_months });
  return {
    ...unit, goal_threshold_frame: CEE_GOAL_THRESHOLD_FRAME, goal_threshold_raw: raw,
    ...(resolved !== null ? { goal_threshold_cap: resolved.cap, goal_threshold_cap_provenance: resolved.provenance, goal_threshold: raw / resolved.cap } : {}),
    ...baselineStamp(observed_state), ...('basis' in basis && basis.basis !== null ? { goal_target_basis: basis.basis } : {}),
    ...direction, ...horizon, ...quote,
  };
}
