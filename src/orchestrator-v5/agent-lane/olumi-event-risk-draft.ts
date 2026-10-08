/** Science's discrete-event admission: occurrence is never a continuous goal driver. */
import type { RepairEntry } from '@talchain/schemas';
import { EventRiskV1, type EventRiskV1T } from '../../schemas/event-risk.js';
import type { AdmittedModel, CandidateModel, WidenerAdditions } from './admit-model.js';
import { holdStatedEventRisks, eventRiskCardLine } from './stated-event-risk-draft.js';
import { readStatedEventRiskWithBindingSpan, splitStatedLikelihoodClauses } from '../routing/stated-event-risk.js';

export interface DraftEventOccurrence {
  readonly p_low_pct: number;
  readonly p_high_pct: number;
  readonly horizon_months: number;
  readonly basis_text: string;
}
const key = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
const PROBABILITY_END = /\s+(?:probability|likelihood|chance)\s*$/i;
const eventWords = (s: string): string[] => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(w => {
  if (/^(?:leave|leaves|leaving|left|depart|departs|departure)$/.test(w)) return 'leave';
  if (/^(?:cancel|cancels|cancelled|canceled|cancelling|canceling|cancellation)$/.test(w)) return 'cancel';
  return w.replace(/s$/, '');
});

/** Midpoint odds ÷2…×2. Preserve any drafted endpoint wider than that minimum. */
export function admitOlumiOccurrence(o: DraftEventOccurrence | null | undefined): EventRiskV1T | undefined {
  if (!o || typeof o.basis_text !== 'string' || o.basis_text.trim() === '') return undefined;
  const { p_low_pct: lo, p_high_pct: hi, horizon_months: months } = o;
  if (![lo, hi, months].every(Number.isFinite) || lo < 0 || hi > 100 || lo > hi || months <= 0 || months > 600) return undefined;
  const p = (lo + hi) / 200;
  const low = p / (2 - p);
  const high = 2 * p / (1 + p);
  return { version: 1, occurrence: {
    p_low: Math.min(lo / 100, low), p_high: Math.max(hi / 100, high),
    basis: 'olumi', meaning: 'at_least_once_within_horizon',
  }, horizon: { months } };
}

type Prepared = { candidate: CandidateModel; widened: WidenerAdditions; loss: RepairEntry[] };
export function prepareDraftEventRisks(input: CandidateModel, widened: WidenerAdditions, brief: string): Prepared {
  const loss: RepairEntry[] = [];
  const removed = new Set<string>();
  const probability = new Map<number, { label: string; value: number }>();
  for (const f of input.factors) {
    if (!PROBABILITY_END.test(f.label)) continue;
    removed.add(key(f.label));
    if (typeof f.baseline_value !== 'number' || !Number.isFinite(f.baseline_value)) {
      loss.push({ field_path: `factors[${f.label}].event_risk`, before: f.baseline_value, after: null,
        reason: `Olumi had proposed ‘${f.label}’ as a factor, so it isn't used. Its likelihood belongs on an event risk.`, severity: 'warn' } as RepairEntry);
      continue;
    }
    const percent = typeof f.unit === 'string' && /%|\bpercent(?:age)?\b/i.test(f.unit);
    const value = percent ? f.baseline_value : f.baseline_value * 100;
    if (value < 0 || value > 100) {
      loss.push({ field_path: `factors[${f.label}].event_risk`, before: value, after: null,
        reason: `Olumi had drafted ‘${f.label}’ = ${value}%, outside the probability range 0–100%, so it isn't used.`, severity: 'warn' } as RepairEntry);
      continue;
    }
    const event = key(f.label.replace(PROBABILITY_END, ''));
    const matches = input.risks.map((r, i) => ({ r, i })).filter(({ r }) => key(r.label) === event);
    if (matches.length === 1 && !probability.has(matches[0]!.i)) probability.set(matches[0]!.i, { label: f.label, value });
    else loss.push({ field_path: `factors[${f.label}].event_risk`, before: f.baseline_value, after: null,
      reason: `Olumi had drafted ‘${f.label}’ = ${value}%, but it doesn't unambiguously name an event in the model, so it isn't used.`, severity: 'warn' } as RepairEntry);
  }
  // A widener has no occurrence basis/level carrier. Do not let it restore a removed probability factor.
  for (const f of widened.proposed_factors ?? []) {
    if (!PROBABILITY_END.test(f.label)) continue;
    removed.add(key(f.label));
    loss.push({ field_path: `factors[${f.label}].event_risk`, before: f.label, after: null,
      reason: `Olumi had proposed ‘${f.label}’ as a factor, so it isn't used. Its likelihood belongs on an event risk.`, severity: 'warn' } as RepairEntry);
  }
  const survives = (l: { from: string; to: string }): boolean => !removed.has(key(l.from)) && !removed.has(key(l.to));
  const candidate: CandidateModel = { ...input,
    factors: input.factors.filter(f => !removed.has(key(f.label))), links: input.links.filter(survives),
    options: input.options.map(o => ({ ...o,
      ...(o.changes ? { changes: o.changes.filter(f => !removed.has(key(f))) } : {}),
      ...(o.interventions ? { interventions: o.interventions.filter(iv => !removed.has(key(iv.factor_label))) } : {}),
    })),
    ...(input.identities ? { identities: input.identities.filter(d => !d.factors.some(f => removed.has(key(f)))) } : {}),
  };
  const riskNodes = candidate.risks.map((r, i) => ({ id: `event_risk_${i}`, kind: 'risk', label: r.label,
    ...(r.event_risk ? { event_risk: r.event_risk } : {}) }));
  const eventLinks = [...candidate.links, ...(widened.proposed_links ?? []).filter(survives),
    ...candidate.options.flatMap(o => [...new Set([...(o.changes ?? []), ...(o.interventions ?? []).map(iv => iv.factor_label)])]
      .map(to => ({ from: o.label, to }))),
  ];
  const incoming = new Set(eventLinks.map(l => key(l.to)));
  const held = holdStatedEventRisks(riskNodes, eventLinks.map(l => ({ from: l.from,
    to: riskNodes.find(r => key(r.label) === key(l.to))?.id ?? l.to })), brief);
  const briefClauses = splitStatedLikelihoodClauses(brief);
  const clauses = briefClauses.flatMap(c => {
    const s = readStatedEventRiskWithBindingSpan(c); return s ? [s] : [];
  });
  // This is quotation, NOT another likelihood reader: only the existing reader may admit a user occurrence.
  // Keep the complete risk-naming clause sliced by that reader's boundaries, including hedges and spacing.
  const refusedUserSpan = (i: number, values: readonly number[]): string | undefined => {
    const names = eventWords(candidate.risks[i]!.label);
    const matches = briefClauses.filter(clause => {
      if (readStatedEventRiskWithBindingSpan(clause) !== undefined) return false;
      const named = new Set(eventWords(clause));
      if (names.length === 0 || !names.every(w => named.has(w))
        || candidate.risks.filter(other => {
          const words = eventWords(other.label);
          return words.length > 0 && words.every(w => named.has(w));
        }).length !== 1) return false;
      // Exact written percentage tokens, not substrings (15%, 110%, 10.5% cannot stand for drafted 10%).
      return [...clause.matchAll(/(?<![\p{L}\p{N}.,+\-−])(\d+(?:\.\d+)?)%/gu)]
        .some(m => values.some(value => m[1] === String(value)));
    });
    // Repetition still belongs to the user. This path cannot apply a figure, so one exact span suffices.
    return matches[0]?.trim();
  };
  const risks = candidate.risks.map((r, i) => {
    const conversion = probability.get(i);
    // Existing user door/hold authority always wins. Read the same explicit-word reader for conversion.
    const block = EventRiskV1.safeParse(held.nodes[i]?.event_risk);
    let user = block.success && block.data.occurrence.basis === 'user' ? block.data : undefined;
    if (!user && conversion && !incoming.has(key(r.label))) {
      const names = eventWords(r.label);
      const statements = clauses.filter(s => {
        const named = new Set(eventWords(s.binding_span));
        const inClause = new Set(eventWords(s.clause_text));
        return names.length > 0 && names.every(w => named.has(w))
          && candidate.risks.filter(other => eventWords(other.label).every(w => inClause.has(w))).length === 1;
      });
      if (statements.length === 1) user = statements[0]!.event_risk;
    }
    const quoted = !user ? refusedUserSpan(i, [
      ...(conversion ? [conversion.value] : []),
      ...(r.occurrence ? [r.occurrence.p_low_pct, r.occurrence.p_high_pct] : []),
    ]) : undefined;
    // DL (C): a refused user figure must neither be applied nor attributed to Olumi, even beside a draft basis.
    const olumi = !quoted && !incoming.has(key(r.label)) ? admitOlumiOccurrence(r.occurrence) : undefined;
    const occurrence = user ?? olumi;
    if (quoted) {
      loss.push({ field_path: conversion ? `factors[${conversion.label}].event_risk` : `nodes[${r.label}].event_risk`,
        before: quoted, after: null, severity: 'warn',
        reason: `You said ‘${quoted}’ for ‘${r.label}’; it isn't used as its likelihood yet.` } as RepairEntry);
    } else if (conversion) {
      const conflicting = !user && olumi && r.occurrence
        && Math.abs((r.occurrence.p_low_pct + r.occurrence.p_high_pct) / 2 - conversion.value) > 1e-9;
      loss.push({ field_path: `factors[${conversion.label}].event_risk`, before: conversion.value,
        after: conflicting ? null : occurrence ?? null, severity: occurrence && !conflicting ? 'info' : 'warn', reason: conflicting
          ? `Olumi had drafted ‘${conversion.label}’ = ${conversion.value}%, but ‘${r.label}’ already carries a different likelihood estimate, so the separate factor isn't used.`
          : occurrence
          ? `Converted ‘${conversion.label}’ into the likelihood on ‘${r.label}’: ${eventRiskCardLine(occurrence, user ? undefined : r.occurrence?.basis_text)}`
          : `Olumi had drafted ‘${conversion.label}’ = ${conversion.value}% without a basis, so it isn't used.` } as RepairEntry);
    }
    const { event_risk: _previous, event_risk_basis_text: _previousBasis, ...rest } = r;
    return occurrence ? { ...rest, event_risk: occurrence,
      // Conditional effect is per event switching on, not per pound/percentage of occurrence.
      unit: 'event', plausible_max: 1,
      ...(!user ? { event_risk_basis_text: r.occurrence!.basis_text.trim() } : {}) } : rest;
  });
  return { candidate: { ...candidate, risks }, widened: { ...widened,
    ...(widened.proposed_factors ? { proposed_factors: widened.proposed_factors.filter(f => !removed.has(key(f.label))) } : {}),
    ...(widened.proposed_links ? { proposed_links: widened.proposed_links.filter(survives) } : {}),
  }, loss };
}

export function finishDraftEventRisks(model: AdmittedModel, prepared: Prepared): AdmittedModel {
  const risks = new Map(prepared.candidate.risks.map(r => [key(r.label), r]));
  const byId = new Map(model.nodes.map(n => [n.id, n]));
  const held = new Map(model.nodes.filter(n => n.event_risk).map(n => [n.id, n]));
  const loss = [...model.loss, ...prepared.loss];
  for (const node of held.values()) {
    if (node.event_risk!.occurrence.basis !== 'olumi') continue;
    loss.push({ field_path: `nodes[${node.id}].event_risk`, before: null, after: node.event_risk!,
      reason: `${node.label}: ${eventRiskCardLine(node.event_risk!, node.event_risk_basis_text)}`, severity: 'info' } as RepairEntry);
  }
  const edges = model.edges.map(e => {
    const node = held.get(e.from);
    if (!node) return e;
    if (node.event_risk!.occurrence.basis === 'user') return { ...e, exists_probability: 1 };
    const r = risks.get(key(node.description ?? node.label));
    const target = byId.get(e.to);
    const targetWords = target ? eventWords(target.description ?? target.label) : [];
    const named = targetWords.length > 0 && targetWords.every(w => eventWords(r?.label ?? node.label).includes(w));
    const marked = r && prepared.candidate.links.some(l => key(l.from) === key(r.label)
      && key(l.to) === key(target?.description ?? target?.label ?? '') && l.definitional === true);
    return { ...e, exists_probability: named || marked ? 1 : 0.8 };
  });
  return { ...model, edges, loss };
}
