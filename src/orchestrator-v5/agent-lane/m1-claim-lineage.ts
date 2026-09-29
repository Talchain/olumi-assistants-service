import { findStatedAmounts } from '../../cee/provenance/stated-amounts.js';
import { unitPhraseFamily } from './unit-conflict.js';
import { figureTheUserWrote, figureTheUserWroteFor } from './stated-by-user.js';

type Row = Record<string, unknown>;
type Role = 'current' | 'target' | 'change_abs' | 'change_rel' | 'intervention' | 'limit';
export interface M1ClaimBinding {
  readonly field_path: string;
  readonly role: Role;
  readonly source: { readonly quote: string; readonly start: number; readonly end: number; readonly number_start: number; readonly number_end: number };
}
const row = (value: unknown): Row => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const name = (n: Row): string => String(n.description ?? n.label ?? '');
const words = (text: string): string[] => (text.toLowerCase().match(/[a-z]+/g) ?? []).map((w) => w.replace(/s$/, ''));
const NAME_FILLER = new Set(['the', 'our', 'current', 'total', 'monthly', 'weekly', 'annual', 'rate', 'level', 'number', 'average', 'realised']);

/**
 * Bind an already retained number, entity and role to one source occurrence. This adds provenance only: it never
 * changes authorship, values, units, denominators, frames or definitions. Grammar outside these explicit role cues
 * remains unbound. The caller must not treat a quote as proof of any scientific interpretation or inferred unit.
 */
export function sourceOfM1Claim(brief: string, claim: { entity: string; others: readonly string[]; value: number; unit: unknown; role: Role; option_quote?: string }): M1ClaimBinding['source'] | null {
  const amounts = findStatedAmounts(brief);
  const ownWords = words(claim.entity).filter((w) => w.length >= 3 && !NAME_FILLER.has(w));
  const otherWords = new Set(claim.others.flatMap(words));
  const distinct = ownWords.filter((w) => !otherWords.has(w));
  if (distinct.length === 0) return null;
  const matches = amounts.flatMap((amount): M1ClaimBinding['source'][] => {
    const family = unitPhraseFamily(claim.unit);
    const statedKind = family === 'currency' ? 'currency' : family === 'percent' ? 'percent' : 'plain';
    if (amount.kind !== statedKind || !figureTheUserWrote(claim.value, claim.unit, amount.matchedText)) return [];
    const end = amount.index + amount.matchedText.length;
    const left = [...brief.slice(0, amount.index).matchAll(/[.!?](?=\s)|\n/g)].at(-1);
    const start = left === undefined ? 0 : left.index! + left[0].length;
    const stop = /[.!?](?=\s|$)|\n/.exec(brief.slice(end));
    const finish = stop === null ? brief.length : end + stop.index;
    const context = brief.slice(start, finish);
    if (!words(context).some((w) => distinct.includes(w))) return [];
    // Isolate THIS occurrence before reusing MG's entity attribution. Otherwise a repeated £75k on another
    // entity could make the boolean matcher true for the wrong occurrence. Preserve character positions.
    const masked = context.split('');
    for (const other of amounts) if (other !== amount && other.index >= start && other.index < finish) {
      for (let i = other.index; i < other.index + other.matchedText.length; i += 1) masked[i - start] = ' ';
    }
    const separators = [...context.matchAll(/;|,\s+(?!\d)|\b(?:and|or|while|without|handling)\b/gi)];
    const localStart = Math.max(0, ...separators.filter((m) => m.index! < amount.index - start).map((m) => m.index! + (/^without$/i.test(m[0]) ? 0 : m[0].length)));
    const localEnd = Math.min(context.length, ...separators.filter((m) => m.index! >= end - start).map((m) => m.index!));
    const local = masked.join('').slice(localStart, localEnd);
    const scopeText = words(local).some((w) => distinct.includes(w)) ? local : masked.join('').replace(/;/g, ' ');
    const namedCount = distinct.includes(words(brief.slice(end))[0] ?? '') && amount.kind === 'plain';
    if (!namedCount && !figureTheUserWroteFor(claim.value, claim.unit, scopeText, { target: [claim.entity], others: claim.others, strict: true })) return [];
    const before = brief.slice(start, amount.index);
    const cues = [...before.matchAll(/\b(current(?:ly)?|today|now|have|has|from|target|want|aim|reach|goal|must|limit|ceiling|under|below|above|without|keep(?:ing)?|cut|reduce|increase|raise|grow|change|by|to)\b/gi)];
    const at = (pattern: RegExp) => cues.filter((m) => pattern.test(m[0])).at(-1)?.index ?? -1;
    const current = at(/^(?:current(?:ly)?|today|now|have|has|from)$/i);
    const target = at(/^(?:target|want|aim|reach|goal)$/i);
    const limit = at(/^(?:must|limit|ceiling|without|keep(?:ing)?)$/i);
    const by = at(/^by$/i);
    const change = at(/^(?:cut|reduce|increase|raise|grow|change)$/i);
    const to = at(/^to$/i);
    const bound = at(/^(?:under|below|above)$/i);
    const isChange = by >= 0 && change >= 0 && change < by && by > current && by > limit;
    const isLimit = limit >= 0 && limit > current && limit > target && !isChange;
    const isTarget = target >= 0 && target > current && target > limit && !isChange;
    const isCurrent = !isChange && !isLimit && !isTarget && current >= 0 && bound < current && (to < current || /\bfrom\s*$/i.test(before));
    // A plain statement such as "our CSAT is 82%" also states a current level; a target/limit's "is" does not.
    const plainCurrent = current < 0 && target < 0 && limit < 0 && change < 0 && bound < 0 && /\b(?:is|are)\s*(?:about\s*)?$/i.test(before);
    let roleAt = -1;
    if (claim.role === 'current' && (isCurrent || plainCurrent)) roleAt = current;
    else if (claim.role === 'target' && isTarget) roleAt = target;
    else if (claim.role === 'change_rel' && isChange && amount.kind === 'percent') roleAt = change;
    else if (claim.role === 'change_abs' && isChange && amount.kind !== 'percent') roleAt = change;
    else if (claim.role === 'limit' && isLimit) roleAt = limit;
    else if (claim.role === 'intervention' && claim.option_quote !== undefined) {
      const q = claim.option_quote;
      const qAt = brief.indexOf(q);
      // A setting belongs to the user's option clause, never another matching current/target figure. A bare
      // quoted amount has no action semantics. An addition cannot be quoted as an absolute intervention here.
      if (qAt < 0 || brief.indexOf(q, qAt + 1) >= 0 || amount.index < qAt || end > qAt + q.length
        || !/\b(?:raise|reduce|set|keep|move|switch|change)\b/i.test(q) || isChange || to < 0 || to <= current) return [];
      roleAt = to;
    } else return [];

    // Quote the local phrase, with its role cue and entity where present; retain exact original whitespace.
    let quoteEnd = Math.min(context.length, ...separators.filter((m) => m.index! >= end - start).map((m) => m.index!));
    const next = amounts.find((a) => a.index >= end && a.index < start + quoteEnd);
    if (next !== undefined) {
      const bridge = brief.slice(end, next.index);
      const marker = [...bridge.matchAll(/\b(?:to|from|by|within|above|below|under)\b/gi)].at(-1);
      quoteEnd = marker === undefined ? next.index - start : end - start + marker.index!;
    }
    const entityAt = [...before.slice(localStart).matchAll(/[a-z]+/gi)].filter((m) => ownWords.includes(m[0].toLowerCase().replace(/s$/, ''))).at(-1)?.index;
    let quoteStart = entityAt === undefined ? amount.index - start : localStart + entityAt;
    if (roleAt >= localStart) quoteStart = Math.min(quoteStart, roleAt);
    while (/\s/.test(context[quoteStart] ?? '') && quoteStart < quoteEnd) quoteStart += 1;
    while (/\s/.test(context[quoteEnd - 1] ?? '') && quoteEnd > quoteStart) quoteEnd -= 1;
    const quote = brief.slice(start + quoteStart, start + quoteEnd);
    if (quote.length < 5 || quote.length > 200) return [];
    return [{ quote, start: start + quoteStart, end: start + quoteEnd, number_start: amount.index, number_end: end }];
  });
  return matches.length === 1 ? matches[0]! : null;
}

export function bindM1ClaimSources<G extends { nodes: readonly unknown[]; goal_constraints?: readonly unknown[] }>(graph: G, brief: string): { graph: G; bindings: M1ClaimBinding[]; unbound: { field_path: string; role: Role }[] } {
  const bindings: M1ClaimBinding[] = [];
  const unbound: { field_path: string; role: Role }[] = [];
  const rawNodes = graph.nodes.map(row);
  const quantities = rawNodes.filter((n) => n.kind !== 'option' && n.kind !== 'decision');
  const attach = (field_path: string, role: Role, n: Row, value: unknown, unit: unknown, option_quote?: string): Row => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return {};
    const source = sourceOfM1Claim(brief, { entity: name(n), others: quantities.filter((other) => other.id !== n.id).map(name), value, unit, role, option_quote });
    if (source === null) { unbound.push({ field_path, role }); return {}; }
    bindings.push({ field_path, role, source });
    return { source_quote: source.quote, source_span: { start: source.start, end: source.end, number_start: source.number_start, number_end: source.number_end } };
  };
  const nodes = rawNodes.map((n) => {
    const bound = { ...n };
    const os = row(n.observed_state);
    if (os.source === 'brief_extraction') {
      const source = attach(`nodes[${n.id}].observed_state`, 'current', n, os.raw_value ?? os.value, os.unit);
      bound.observed_state = { ...os, ...source };
      if (n.kind === 'factor' && source.source_quote !== undefined) bound.source_quote = source.source_quote;
    }
    if (n.threshold_source === 'brief_extraction') {
      const role = n.goal_threshold_frame === 'change_rel' ? 'change_rel' : n.goal_threshold_frame === 'change_abs' ? 'change_abs' : 'target';
      const raw = n.goal_threshold_raw;
      const value = typeof raw === 'number' && role !== 'target' ? Math.abs(raw) * (role === 'change_rel' ? 100 : 1) : raw;
      const source = attach(`nodes[${n.id}].goal_threshold_raw`, role, n, value, role === 'change_rel' ? '%' : n.goal_threshold_unit);
      if (source.source_quote !== undefined) bound.source_quote = source.source_quote; // Node schema owns the target quote; current quote stays nested.
    }
    if (n.kind === 'option' && n.provenance === 'from_brief' && n.proposed_by !== 'olumi' && n.interventions !== undefined) {
      const interventions = row(n.interventions);
      bound.interventions = Object.fromEntries(Object.entries(interventions).map(([id, value]) => {
        const iv = row(value); const target = quantities.find((q) => q.id === id);
        const source = iv.source === 'brief_extraction' && target !== undefined
          ? attach(`nodes[${n.id}].interventions[${id}]`, 'intervention', target, iv.raw_value ?? iv.value, iv.unit, typeof n.source_quote === 'string' ? n.source_quote : undefined) : {};
        return [id, { ...iv, ...source }];
      }));
    }
    return bound;
  });
  const constraints = graph.goal_constraints?.map((value) => {
    const c = row(value); const target = quantities.find((n) => n.id === c.node_id);
    if (c.provenance !== 'explicit' || target === undefined) return c;
    const source = attach(`goal_constraints[${c.node_id}]`, 'limit', target, c.value, c.unit);
    return source.source_quote === undefined ? c : { ...c, source_quote: source.source_quote };
  });
  return { graph: { ...graph, nodes, ...(constraints === undefined ? {} : { goal_constraints: constraints }) } as G, bindings, unbound };
}
