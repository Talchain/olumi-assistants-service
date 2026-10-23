/**
 * THE DISPLAY PROJECTION (spike S1): CanonicalModel → the GraphV3 node/edge shape the canvas reads, plus a manifest.
 *
 * The display shows EVERY record; the calculation is the compiled subset (PL correction 1: hiding meaningful uncalculated
 * content repeats today's error). Each record appears exactly once in `items`, saying where it is drawn, whether it is IN
 * the calculation (and why not), and who authored it:
 *  · quantities are cards (an input is a factor, a derived quantity an outcome), except a quantity whose only use is a
 *    coefficient (drawn on its link), a target, bound or window length (on its goal or limit card), an option's value (on
 *    its option card), or a risk's chance or severity (on its risk card);
 *  · relations and effect terms are links; goals, options and risks are their own cards; limits are `goal_constraints`;
 *  · qualitative records (claims, evidence, assumptions, dissent, conditions, left out) are display-only text cards
 *    (`action`, the canvas's text card), always `retained_excluded`. Their `concerns` stay in the manifest, never as links:
 *    a GraphV3 link is a causal claim, and a note is not one.
 *
 * Authorship is shown as stated: the person's (with their words), Olumi's (provisional), or UNVERIFIED (said to be the
 * person's but their words were not found), which is never shown as theirs.
 * The projection is derived, never read back: the canonical model is the one saved meaning.
 */
import { LLM_STRENGTH_STD_FLOOR } from '../../cee/constants.js';
import type { CanonicalModelT, CanonicalQuantityT, QualitativeFamilyT } from './canonical.js';
import { QUALITATIVE_FAMILIES } from './canonical.js';
import { compile, normalise, rangeDistOf, readRange, type CompileResult, type LawReading } from './compile.js';

type Rec = Record<string, unknown>;
/** structure: an exact constant the model's form needs; never drawn as anyone's estimate. */
export type DisplayAuthor = 'person' | 'olumi' | 'unverified' | 'structure';
export type ItemFamily = 'quantity' | 'relation' | 'term' | 'goal' | 'limit' | 'preference' | 'option' | 'risk' | QualitativeFamilyT;
export type ProjectedItem = {
  record_id: string;
  family: ItemFamily;
  /** Where it is drawn: its own card or link, or on another card or link. */
  shown_as: { node?: string; edge?: string; on_node?: string; on_edge?: string; constraint?: string };
  in_calculation: boolean;
  why_out: string | null;
  author: DisplayAuthor;
  approval: 'proposed' | 'approved';
  concerns?: string[];
  /** For a range: the ruled law Olumi reads it by, always Olumi's and provisional, never the person's calibration. */
  law?: { author: 'olumi'; provisional: true; range_kind: 'bounds' | 'plausible' | null; reading: LawReading };
};
export type Projection = {
  graph: { nodes: Rec[]; edges: Rec[]; goal_constraints: Rec[] };
  items: ProjectedItem[];
};

export const DECISION_NODE_ID = 'mp:decision';
const QUAL_PREFIX: Record<QualitativeFamilyT, string> = {
  claims: 'Claim', evidence: 'Evidence', assumptions: 'Assumption', dissent: 'Disagreement', conditions: 'Condition', left_out: 'Left out',
};
const has = <T>(x: T | null | undefined): x is T => x !== null && x !== undefined;
const fmt = (n: number) => (Number.isInteger(n) ? n.toLocaleString('en-GB') : String(Number(n.toPrecision(4))));

export function project(input: CanonicalModelT, compiled: CompileResult = compile(input)): Projection {
  const model = normalise(input); // an option's inline value is a named quantity, drawn on its option card
  const x = compiled.executable;
  const xq = new Set(x?.quantities.map((q) => q.id) ?? []);
  const xg = new Set(x?.goals.map((g) => g.id) ?? []);
  const xl = new Set(x?.limits.map((l) => l.id) ?? []);
  const xo = new Set(x?.options.map((o) => o.id) ?? []);
  const xr = new Set(x?.risks.map((r) => r.id) ?? []);
  const unverified = new Set(compiled.unverified.map((u) => u.id));
  const notCompiling = compiled.errors.length > 0;
  const whoOf = (rec: { author: string }, id: string): DisplayAuthor => (rec.author === 'olumi' ? 'olumi' : rec.author === 'structure' ? 'structure' : unverified.has(id) ? 'unverified' : 'person');
  /** The canvas's origin vocabulary; a structural constant has none (it is nobody's figure, never "AI inferred"). */
  const provenanceOf = (who: DisplayAuthor) => (who === 'structure' ? {} : { provenance: who === 'person' ? 'from_brief' : who === 'unverified' ? 'unverified_brief' : 'ai_inferred' });
  const quoteOf = (rec: { author: string; quote: string | null }, id: string) => (whoOf(rec, id) === 'person' && has(rec.quote) ? { source_quote: rec.quote } : {});
  const participation = (inCalc: boolean) => ({ analysis_participation: inCalc ? 'included' : 'retained_excluded' });
  const Q = new Map(model.quantities.map((q) => [q.id, q] as const));
  const why = (inCalc: boolean, reason: string) => (inCalc ? null : notCompiling ? 'The model does not compile yet.' : reason);

  const nodes: Rec[] = [];
  const edges: Rec[] = [];
  const goal_constraints: Rec[] = [];
  const items: ProjectedItem[] = [];

  // ── how each quantity is used, to decide where it is drawn ─────────────────────────────────────────────────────────
  const uses = new Map<string, Set<string>>();
  const use = (id: string, how: string) => { if (Q.has(id)) uses.set(id, new Set([...(uses.get(id) ?? []), how])); };
  const hostOf = new Map<string, { node?: string; edge?: string }>();
  /** A window's length or origin timing is consumed into its window, so it is in the calculation exactly when its owner is. */
  const windowOwner = new Map<string, string>();
  for (const r of model.relations) {
    if (r.form === 'definition') r.parts.forEach((p) => use(p.id, 'node'));
    else if (r.form === 'effect') { use(r.base, 'node'); for (const t of r.terms) { use(t.driver, 'node'); use(t.coefficient, 'coefficient'); hostOf.set(t.coefficient, { edge: `${t.driver}__${r.defines}` }); } }
    else [r.start, ...r.inflows, ...r.outflows].forEach((p) => use(p, 'node'));
    use(r.defines, 'node');
  }
  for (const g of model.goals) if (g.measure) {
    use(g.measure.quantity, 'node');
    if (has(g.measure.per)) use(g.measure.per, 'node');
    for (const t of [g.measure.target, g.measure.window?.periods, g.measure.window?.origin_offset]) if (has(t)) { use(t, 'on_goal'); hostOf.set(t, { node: g.id }); }
    for (const t of [g.measure.window?.periods, g.measure.window?.origin_offset]) if (has(t)) windowOwner.set(t, g.id);
  }
  for (const l of model.limits) if (l.measure) {
    const lm = l.measure;
    use(lm.quantity, 'node');
    if (has(lm.per)) use(lm.per, 'node');
    for (const t of [lm.bound, lm.window?.periods, lm.window?.origin_offset]) if (has(t)) { use(t, 'on_limit'); hostOf.set(t, { node: lm.quantity }); }
    for (const t of [lm.window?.periods, lm.window?.origin_offset]) if (has(t)) windowOwner.set(t, l.id);
  }
  for (const o of model.options) for (const s of o.sets) { use(s.quantity, 'node'); if (has(s.to)) { use(s.to, 'on_option'); hostOf.set(s.to, { node: o.id }); } }
  for (const k of model.risks) { use(k.effect_on, 'node'); for (const t of [k.occurrence, k.severity]) { use(t, 'on_risk'); hostOf.set(t, { node: k.id }); } }
  const folded = (id: string) => { const u = uses.get(id); return u !== undefined && u.size === 1 && !u.has('node') && hostOf.has(id); };

  const chances = new Set(model.risks.map((k) => k.occurrence));
  /** The shared law's reading: the compiler's disclosure (with the domain) when the quantity is in the run, else the same law. */
  const lawFor = (q: CanonicalQuantityT): LawReading => {
    const c = compiled.conversions.find((x) => x.kind === 'range_law' && x.quantity === q.id);
    if (c && c.kind === 'range_law') return c.reading;
    const inside = !has(q.value) || (q.low! < q.value && q.value < q.high!);
    return inside ? readRange(rangeDistOf(q, 1, chances.has(q.id) ? { min: 0, max: 1 } : undefined)) : { kind: 'held', reason: 'its most likely figure is not inside its range' };
  };
  const lawOf = (q: CanonicalQuantityT) => (has(q.low) && has(q.high) && q.low < q.high && (q.status === 'known' || q.status === 'estimated')
    ? { law: { author: 'olumi' as const, provisional: true as const, range_kind: q.range_kind, reading: lawFor(q) } } : {});
  const display = (q: CanonicalQuantityT): string => {
    const unit = q.unit === '1' ? '' : ` ${q.unit}`;
    const owner = q.author === 'olumi' ? (q.status === 'estimated' ? ', Olumi\'s estimate' : ', Olumi\'s reading') : '';
    if (q.status === 'asked') return 'Not given yet';
    if (q.status === 'derived') return 'Worked out from its inputs';
    if (q.status === 'unknown' || q.status === 'unsupported' || q.status === 'not_applicable') return q.status.replace('_', ' ');
    if (has(q.low) && has(q.high) && q.low !== q.high) {
      // A range is not a law: the person's (or Olumi's) bounds, then Olumi's provisional reading of them, said as Olumi's.
      const r = lawFor(q);
      // The disclosure says the CONDITIONED moments (what the draws have) and where the spread is kept, as Olumi's.
      const kept = (lo: number, hi: number) => (Number.isFinite(lo) && Number.isFinite(hi) ? `, kept between ${fmt(lo)} and ${fmt(hi)}`
        : Number.isFinite(lo) ? `, never below ${fmt(lo)}` : Number.isFinite(hi) ? `, never above ${fmt(hi)}` : '');
      const law = q.author === 'person' && !has(q.range_kind) ? 'how to read it is asked'
        : r.kind === 'normal' ? `Olumi reads it as a spread around ${fmt(r.mean)} (sd ${fmt(r.sd_conditioned)})${kept(r.lower, r.upper)}, provisionally`
          : 'Olumi cannot use it as a spread yet';
      return `${has(q.value) ? `about ${fmt(q.value)}, ` : ''}${fmt(q.low)}–${fmt(q.high)}${unit}${owner}; ${law}`;
    }
    return `${fmt(q.value ?? q.low!)}${unit}${owner}`;
  };

  // ── the question, goals, options ───────────────────────────────────────────────────────────────────────────────────
  nodes.push({ id: DECISION_NODE_ID, kind: 'decision', label: model.question });
  for (const g of model.goals) {
    const per = compiled.perGoal.find((p) => p.goal_id === g.id);
    const inCalc = xg.has(g.id);
    const who = whoOf(g, g.id);
    const target = g.measure ? Q.get(g.measure.target) : undefined;
    const point = target && has(target.value) && !has(target.low) ? target.value : null;
    nodes.push({
      id: g.id, kind: 'goal', label: g.label, ...provenanceOf(who), ...quoteOf(g, g.id), ...participation(inCalc),
      ...(g.measure ? { goal_direction: g.measure.cmp, ...(point !== null ? { goal_threshold_raw: point } : {}), ...(target ? { goal_threshold_unit: target.unit, display_value: `${g.measure.cmp} ${display(target)}` } : {}) } : {}),
      ...(has(g.question) ? { user_questions: [g.question] } : {}),
    });
    items.push({ record_id: g.id, family: 'goal', shown_as: { node: g.id }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: g.approval });
    if (g.measure && Q.has(g.measure.quantity)) {
      edges.push(link(g.measure.quantity, g.id, 1, who, inCalc, { definitional: true }));
    }
  }
  for (const o of model.options) {
    const inCalc = xo.has(o.id);
    const who = whoOf(o, o.id);
    const per = compiled.perOption.find((p) => p.option_id === o.id);
    const interventions: Rec = {};
    for (const s of o.sets) { const to = has(s.to) ? Q.get(s.to) : undefined; if (to) interventions[s.quantity] = { value: to.value, unit: to.unit, display: display(to), from_period: s.from_period }; }
    nodes.push({
      id: o.id, kind: 'option', label: o.label, ...provenanceOf(who), ...quoteOf(o, o.id), ...participation(inCalc),
      ...(o.sets.length === 0 ? { is_baseline: true } : {}), ...(Object.keys(interventions).length ? { interventions } : {}),
      ...(o.author === 'olumi' ? { proposed_by: 'olumi' } : {}),
    });
    items.push({ record_id: o.id, family: 'option', shown_as: { node: o.id }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: o.approval });
    edges.push(link(DECISION_NODE_ID, o.id, 1, who, inCalc, {}));
    for (const s of o.sets) if (Q.has(s.quantity)) edges.push(link(o.id, s.quantity, 1, who, inCalc, {}));
  }

  // ── quantities ─────────────────────────────────────────────────────────────────────────────────────────────────────
  const controlled = new Set(model.options.flatMap((o) => o.sets.map((s) => s.quantity)));
  for (const q of model.quantities) {
    const owner = windowOwner.get(q.id);
    const inCalc = xq.has(q.id) || (owner !== undefined && (xg.has(owner) || xl.has(owner)));
    const who = whoOf(q, q.id);
    const reason = q.status === 'asked' ? `Asked: ${q.question}` : q.status === 'derived' || q.status === 'known' || q.status === 'estimated'
      ? 'Nothing that can be worked out yet uses it.' : `${q.status.replace('_', ' ')}: ${q.basis}`;
    if (folded(q.id)) {
      const host = hostOf.get(q.id)!;
      items.push({ record_id: q.id, family: 'quantity', shown_as: host.edge ? { on_edge: host.edge } : { on_node: host.node }, in_calculation: inCalc, why_out: why(inCalc, reason), author: who, approval: q.approval, ...lawOf(q) });
      continue;
    }
    const point = has(q.value) && !(has(q.low) && q.low !== q.high);
    nodes.push({
      id: q.id, kind: q.status === 'derived' ? 'outcome' : 'factor', label: q.label, ...provenanceOf(who), ...quoteOf(q, q.id), ...participation(inCalc),
      ...(q.status !== 'derived' ? { category: controlled.has(q.id) ? 'controllable' : 'observable' } : {}),
      ...(point ? { observed_state: { value: q.value, unit: q.unit } } : {}),
      display_value: display(q),
      ...(has(q.basis) ? { description: q.basis } : {}),
      ...(q.status === 'asked' && has(q.question) ? { user_questions: [q.question] } : {}),
    });
    items.push({ record_id: q.id, family: 'quantity', shown_as: { node: q.id }, in_calculation: inCalc, why_out: why(inCalc, reason), author: who, approval: q.approval, ...lawOf(q) });
  }

  // ── relations and effect terms: links ──────────────────────────────────────────────────────────────────────────────
  for (const r of model.relations) {
    const inCalc = xq.has(r.defines);
    const who = whoOf(r, r.id);
    const reason = 'What it works out is not used by anything that can be worked out yet.';
    const drawn: string[] = [];
    const push = (e: Rec) => { edges.push(e); drawn.push(String(e.id)); };
    if (r.form === 'definition') {
      for (const p of r.parts) {
        const sign = 'sign' in p ? p.sign : p.power;
        push(link(p.id, r.defines, sign, who, inCalc, { definitional: true, reasoning: r.op === 'sum' ? (sign > 0 ? 'added' : 'subtracted') : sign > 0 ? 'multiplied' : 'divided by' }));
      }
    } else if (r.form === 'stock') {
      push(link(r.start, r.defines, 1, who, inCalc, { definitional: true, reasoning: 'starting level' }));
      for (const f of r.inflows) push(link(f, r.defines, 1, who, inCalc, { definitional: true, reasoning: `inflow per ${model.period}` }));
      for (const f of r.outflows) push(link(f, r.defines, -1, who, inCalc, { definitional: true, reasoning: `outflow per ${model.period}` }));
    } else {
      push(link(r.base, r.defines, 1, who, inCalc, { definitional: true, reasoning: 'base level' }));
      for (const t of r.terms) {
        const c = Q.get(t.coefficient);
        const termWho = whoOf(t, `${r.id}:${t.driver}`);
        const mid = c ? (c.value ?? (has(c.low) && has(c.high) ? (c.low + c.high) / 2 : null)) : null;
        const straddles = c && has(c.low) && has(c.high) && c.low < 0 && c.high > 0;
        const sign = mid !== null && mid < 0 ? -1 : 1;
        const driverUnit = Q.get(t.driver)?.unit ?? '';
        const definedUnit = Q.get(r.defines)?.unit ?? '';
        const natural = c && has(c.value)
          ? { natural_effect: { amount: c.value, amount_unit: definedUnit, per_source_change: 1, per_source_change_unit: driverUnit, strength_mean: sign, strength_mean_frame: 'edge_strength',
            ...(has(c.low) && has(c.high) && c.low !== c.high ? { stated_range: { low: c.low, high: c.high, text: `${fmt(c.low)}–${fmt(c.high)}`, end: 'centre' } } : {}) } }
          : {};
        const reasoning = c ? `${display(c)} per ${driverUnit || 'unit'}${straddles ? '; its direction is not settled' : ''}${mid === null ? '; its size is not given yet' : ''}` : '';
        const e = link(t.driver, r.defines, sign, termWho, inCalc, { ...natural, reasoning, ...(c ? { magnitude: c.author === 'olumi' ? 'olumi_estimate' : 'user_stated' } : {}) });
        push(e);
        items.push({ record_id: `${r.id}:${t.driver}`, family: 'term', shown_as: { edge: String(e.id) }, in_calculation: inCalc, why_out: why(inCalc, reason), author: termWho, approval: t.approval });
      }
    }
    items.push({ record_id: r.id, family: 'relation', shown_as: { edge: drawn.join(' ') }, in_calculation: inCalc, why_out: why(inCalc, reason), author: who, approval: r.approval });
  }

  // ── limits: the canvas's goal constraints ──────────────────────────────────────────────────────────────────────────
  for (const l of model.limits) {
    const inCalc = xl.has(l.id);
    const who = whoOf(l, l.id);
    const lm = l.measure;
    const bound = lm ? Q.get(lm.bound) : undefined;
    const per = compiled.perLimit.find((p) => p.limit_id === l.id);
    const point = bound && has(bound.value) && !(has(bound.low) && bound.low !== bound.high) ? bound.value : null;
    if (lm && point !== null && !has(lm.per)) {
      goal_constraints.push({
        constraint_id: l.id, node_id: lm.quantity, operator: lm.cmp.startsWith('>') ? '>=' : '<=', ...(lm.cmp === '<' || lm.cmp === '>' ? { operator_as_stated: lm.cmp } : {}),
        value: point, label: l.label, unit: bound!.unit, ...(who === 'person' && has(l.quote) ? { source_quote: l.quote.slice(0, 200) } : {}),
        provenance: who === 'olumi' ? 'inferred' : 'explicit',
      });
      items.push({ record_id: l.id, family: 'limit', shown_as: { constraint: l.id, on_node: lm.quantity }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: l.approval });
    } else {
      // A guardrail with no measure yet, or one whose figure is not given: a text card, never an invented scale.
      const id = `mp:limit:${l.id}`;
      nodes.push({ id, kind: 'action', label: `Limit: ${l.label}`, description: lm ? `${l.label} (its figure is not given yet).` : `${l.label} (no measure yet, so the result does not cover it).`, ...provenanceOf(who), ...quoteOf(l, l.id), ...participation(inCalc) });
      items.push({ record_id: l.id, family: 'limit', shown_as: { node: id }, in_calculation: inCalc, why_out: why(inCalc, per?.reasons.join(' ') ?? ''), author: who, approval: l.approval });
    }
  }

  // ── preferences: wishes without a threshold, drawn as text cards ─────────────────────────────────────────────────────
  for (const p of model.preferences) {
    const who = whoOf(p, p.id);
    const q = Q.get(p.quantity);
    nodes.push({ id: p.id, kind: 'action', label: `Preference: ${p.direction} ${q?.label ?? p.quantity}`, description: `Would like ${q?.label ?? p.quantity} ${p.direction}. Shown beside the result; not a goal or a limit.`, ...provenanceOf(who), ...quoteOf(p, p.id), ...participation(false) });
    items.push({ record_id: p.id, family: 'preference', shown_as: { node: p.id }, in_calculation: false, why_out: 'A preference: shown and reported, never calculated as a goal or a limit.', author: who, approval: p.approval, concerns: [p.quantity] });
  }

  // ── risks ──────────────────────────────────────────────────────────────────────────────────────────────────────────
  for (const k of model.risks) {
    const inCalc = xr.has(k.id);
    const who = whoOf(k, k.id);
    const occ = Q.get(k.occurrence);
    const sev = Q.get(k.severity);
    nodes.push({
      id: k.id, kind: 'risk', label: k.label, ...provenanceOf(who), ...quoteOf(k, k.id), ...participation(inCalc),
      description: `Chance: ${occ ? display(occ) : 'not given'}. If it happens: ${k.mode === 'add' ? 'adds' : 'multiplies by'} ${sev ? display(sev) : 'not given'}, from ${typeof k.from_period === 'number' ? `period ${k.from_period}` : `"${Q.get(k.from_period)?.label ?? k.from_period}"`}.`,
    });
    items.push({ record_id: k.id, family: 'risk', shown_as: { node: k.id }, in_calculation: inCalc, why_out: why(inCalc, 'What it affects is not used by anything that can be worked out yet.'), author: who, approval: k.approval });
    if (Q.has(k.effect_on)) edges.push(link(k.id, k.effect_on, k.mode === 'add' && sev && (sev.value ?? sev.high ?? 0) < 0 ? -1 : 1, who, inCalc, { reasoning: 'if it happens' }));
  }

  // ── qualitative records: display-only text cards ───────────────────────────────────────────────────────────────────
  for (const f of QUALITATIVE_FAMILIES) for (const rec of model[f] as readonly (Rec & { id: string; author: string; quote: string | null; approval: 'proposed' | 'approved'; concerns: string[] })[]) {
    const who = whoOf(rec, rec.id);
    const text = f === 'dissent' ? `${String(rec.holder)}: ${String(rec.position)}` : String(rec.text);
    const extra = f === 'left_out' ? ` Why: ${String(rec.why)}` : f === 'evidence' && has(rec.source) ? ` Source: ${String(rec.source)}` : '';
    nodes.push({ id: rec.id, kind: 'action', label: `${QUAL_PREFIX[f]}: ${text.length > 80 ? `${text.slice(0, 79)}…` : text}`, description: `${text}${extra}`, ...provenanceOf(who), ...quoteOf(rec, rec.id), ...participation(false) });
    items.push({ record_id: rec.id, family: f, shown_as: { node: rec.id }, in_calculation: false, why_out: 'A note: shown beside the model, never calculated.', author: who, approval: rec.approval, concerns: [...rec.concerns] });
  }

  return { graph: { nodes, edges, goal_constraints }, items };
}

function link(from: string, to: string, sign: 1 | -1, who: DisplayAuthor, inCalc: boolean, extra: Rec): Rec {
  const { reasoning, magnitude, definitional, ...rest } = extra;
  const provenance = who === 'unverified' ? undefined : {
    source: who === 'person' ? 'brief_extraction' : 'cee_hypothesis',
    ...(has(reasoning) ? { reasoning } : {}), ...(has(magnitude) ? { magnitude } : {}), ...(definitional === true ? { definitional: true } : {}), ...rest,
  };
  return {
    id: `${from}__${to}`, from, to, strength: { mean: sign, std: LLM_STRENGTH_STD_FLOOR }, exists_probability: 1, effect_direction: sign > 0 ? 'positive' : 'negative',
    ...(provenance ? { provenance } : {}), origin: inCalc ? 'model_program:calculation' : who === 'unverified' ? 'model_program:unverified' : 'model_program:display',
  };
}
