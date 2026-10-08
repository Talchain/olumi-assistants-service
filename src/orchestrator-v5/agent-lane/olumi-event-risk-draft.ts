/** Science's discrete-event admission: occurrence is never a continuous goal driver. */
import type { RepairEntry } from '@talchain/schemas';
import { EventRiskV1, type EventRiskV1T } from '../../schemas/event-risk.js';
import type { AdmittedModel, CandidateModel, WidenerAdditions } from './admit-model.js';
import { holdStatedEventRisks, eventRiskCardLine } from './stated-event-risk-draft.js';
import { readStatedEventRiskWithBindingSpan, splitEventRiskFigureSpans } from '../routing/stated-event-risk.js';

export interface DraftEventOccurrence {
  readonly p_low_pct: number;
  readonly p_high_pct: number;
  readonly horizon_months: number;
  readonly basis_text: string;
}
const key = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');
const LIKELIHOOD_WORD = /\b(?:probability|likelihood|chance|odds)\b/i;
/** Classify the drafter's label before any label separation can rename it. */
export const isDraftLikelihoodFactorLabel = (label: string): boolean => LIKELIHOOD_WORD.test(label);
const eventWords = (s: string): string[] => (s.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).map(w => {
  if (/^(?:leave|leaves|leaving|left|depart|departs|departure)$/.test(w)) return 'leave';
  if (/^(?:cancel|cancels|cancelled|canceled|cancelling|canceling|cancellation)$/.test(w)) return 'cancel';
  return w.replace(/s$/, '');
});

type UserEventFigure = { span: string; user?: EventRiskV1T };
/** One quotation predicate for every risk and likelihood factor; only the shared reader can admit a figure. */
function userEventFigures(label: string, eventLabels: readonly string[], scopes: ReturnType<typeof splitEventRiskFigureSpans>): UserEventFigure[] {
  const names = eventWords(label);
  if (names.length === 0) return [];
  const namesEvent = (text: string, words = names): boolean => {
    const named = new Set(eventWords(text));
    return words.length > 0 && words.every(w => named.has(w));
  };
  return scopes.flatMap(({ span, clause_text }) => {
    const localMatches = eventLabels.filter(other => namesEvent(span, eventWords(other)));
    if (!namesEvent(span)) {
      // An unfamiliar refused phrase after a comma cannot license an estimate. Borrow the clause
      // for quotation only when no modelled event names the figure fragment; ambiguity under-claims.
      return localMatches.length === 0 && namesEvent(clause_text) ? [{ span: clause_text.trim() }] : [];
    }
    const stated = readStatedEventRiskWithBindingSpan(span);
    return [{ span: span.trim(), ...(localMatches.length === 1 && stated && namesEvent(stated.binding_span)
      ? { user: stated.event_risk } : {}) }];
  });
}

/** Midpoint odds ÷2…×2. Preserve any drafted endpoint wider than that minimum. */
export function admitOlumiOccurrence(o: DraftEventOccurrence | null | undefined, goalHorizonMonths: number | null = null): EventRiskV1T | undefined {
  if (!o || typeof o.basis_text !== 'string' || o.basis_text.trim() === '') return undefined;
  const { p_low_pct: lo, p_high_pct: hi, horizon_months: months } = o;
  if (![lo, hi, months].every(Number.isFinite) || lo < 0 || hi > 100 || lo > hi || months <= 0 || months > 600) return undefined;
  if (typeof goalHorizonMonths === 'number' && Number.isFinite(goalHorizonMonths) && goalHorizonMonths > 0
    && months !== goalHorizonMonths) return undefined;
  const p = (lo + hi) / 200;
  const low = p / (2 - p);
  const high = 2 * p / (1 + p);
  return { version: 1, occurrence: {
    p_low: Math.min(lo / 100, low), p_high: Math.max(hi / 100, high),
    basis: 'olumi', meaning: 'at_least_once_within_horizon',
  }, horizon: { months } };
}

type Prepared = {
  candidate: CandidateModel; widened: WidenerAdditions; loss: RepairEntry[];
  horizonMismatches: { label: string; drafted_months: number; goal_months: number }[];
};
export function prepareDraftEventRisks(input: CandidateModel, widened: WidenerAdditions, brief: string): Prepared {
  const loss: RepairEntry[] = [];
  const horizonMismatches: Prepared['horizonMismatches'] = [];
  const removed = new Set<string>();
  const probability = new Map<number, { label: string; value: number }>();
  const eventLabels = input.risks.map(r => r.label);
  const scopes = splitEventRiskFigureSpans(brief);
  const statements = eventLabels.map(label => userEventFigures(label, eventLabels, scopes));
  const interim = (field: string, label: string, quote: string): void => {
    const reason = `You said ‘${quote}’ for ‘${label}’; it isn't used as its likelihood yet.`;
    if (!loss.some(l => l.reason === reason)) loss.push({ field_path: field, before: quote, after: null,
      severity: 'warn', reason } as RepairEntry);
  };
  for (const f of input.factors) {
    if (!isDraftLikelihoodFactorLabel(f.label)) continue;
    removed.add(key(f.label));
    const eventLabel = key(f.label.replace(/\b(?:probability|likelihood|chance|odds)\b/gi, ''));
    const event = new Set(eventWords(eventLabel));
    const matches = input.risks.map((r, i) => ({ r, i })).filter(({ r }) => {
      const names = eventWords(r.label);
      return names.length > 0 && names.every(w => event.has(w));
    });
    const claims = matches.length === 1 ? statements[matches[0]!.i]!
      : userEventFigures(eventLabel, [...eventLabels, eventLabel], scopes);
    const percent = typeof f.unit === 'string' && /%|\bpercent(?:age)?\b/i.test(f.unit);
    const value = typeof f.baseline_value === 'number' ? (percent ? f.baseline_value : f.baseline_value * 100) : Number.NaN;
    // Orphan/ambiguous and invalid factors still belong to this predicate: never call a user's figure Olumi-drafted.
    if (claims.length > 0 && (matches.length !== 1 || !Number.isFinite(value) || value < 0 || value > 100)) {
      interim(`factors[${f.label}].event_risk`, matches.length === 1 ? matches[0]!.r.label : eventLabel, claims[0]!.span);
      continue;
    }
    if (!Number.isFinite(value)) {
      loss.push({ field_path: `factors[${f.label}].event_risk`, before: f.baseline_value, after: null,
        reason: `Olumi had proposed ‘${f.label}’ as a factor, so it isn't used. Its likelihood belongs on an event risk.`, severity: 'warn' } as RepairEntry);
      continue;
    }
    if (value < 0 || value > 100) {
      loss.push({ field_path: `factors[${f.label}].event_risk`, before: value, after: null,
        reason: `Olumi had drafted ‘${f.label}’ = ${value}%, outside the probability range 0–100%, so it isn't used.`, severity: 'warn' } as RepairEntry);
      continue;
    }
    if (matches.length === 1 && probability.has(matches[0]!.i) && claims.length > 0) {
      const label = matches[0]!.r.label;
      if (claims.length === 1 && claims[0]!.user) loss.push({ field_path: `factors[${f.label}].event_risk`,
        before: f.baseline_value, after: null, severity: 'info',
        reason: `Removed ‘${f.label}’ as a separate likelihood factor; its likelihood belongs on ‘${label}’.` } as RepairEntry);
      else interim(`factors[${f.label}].event_risk`, label, claims[0]!.span);
      continue;
    }
    if (matches.length === 1 && !probability.has(matches[0]!.i)) probability.set(matches[0]!.i, { label: f.label, value });
    else loss.push({ field_path: `factors[${f.label}].event_risk`, before: f.baseline_value, after: null,
      reason: `Olumi had drafted ‘${f.label}’ = ${value}%, but it doesn't unambiguously name an event in the model, so it isn't used.`, severity: 'warn' } as RepairEntry);
  }
  // A widener has no occurrence basis/level carrier. Do not let it restore a removed probability factor.
  for (const f of widened.proposed_factors ?? []) {
    if (!isDraftLikelihoodFactorLabel(f.label)) continue;
    removed.add(key(f.label));
    const eventLabel = key(f.label.replace(/\b(?:probability|likelihood|chance|odds)\b/gi, ''));
    const claims = userEventFigures(eventLabel, [...eventLabels, eventLabel], scopes);
    if (claims.length > 0) { interim(`factors[${f.label}].event_risk`, eventLabel, claims[0]!.span); continue; }
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
  const risks = candidate.risks.map((r, i) => {
    const conversion = probability.get(i);
    const claims = statements[i]!;
    const block = EventRiskV1.safeParse(held.nodes[i]?.event_risk);
    // Bounded lexical equivalents apply with or without a probability factor. Multiple/ambiguous
    // figures remain refused even if an earlier whole-clause hold could read one of them.
    const user = !incoming.has(key(r.label)) && claims.length === 1 ? claims[0]!.user
      : claims.length === 0 && block.success && block.data.occurrence.basis === 'user' ? block.data : undefined;
    const quoted = !user ? claims[0]?.span : undefined;
    // DL (C): any refused user figure prevents Olumi authorship, irrespective of the draft's value/basis.
    const horizonMismatch = r.occurrence && typeof candidate.goal.horizon_months === 'number'
      && Number.isFinite(candidate.goal.horizon_months) && candidate.goal.horizon_months > 0
      && r.occurrence.horizon_months !== candidate.goal.horizon_months;
    const olumi = !quoted && !incoming.has(key(r.label))
      ? admitOlumiOccurrence(r.occurrence, candidate.goal.horizon_months) : undefined;
    if (!user && !quoted && !incoming.has(key(r.label)) && horizonMismatch) {
      loss.push({ field_path: `nodes[${r.label}].event_risk`, before: r.occurrence!.horizon_months, after: null,
        severity: 'warn', reason: `${r.label}: the drafted occurrence is for ${r.occurrence!.horizon_months} months, but the goal's horizon is ${candidate.goal.horizon_months} months, so its likelihood isn't used.` } as RepairEntry);
      horizonMismatches.push({ label: r.label, drafted_months: r.occurrence!.horizon_months,
        goal_months: candidate.goal.horizon_months! });
    }
    const occurrence = user ?? olumi;
    if (quoted) {
      interim(conversion ? `factors[${conversion.label}].event_risk` : `nodes[${r.label}].event_risk`, r.label, quoted);
    } else if (conversion) {
      const conflicting = !user && olumi && r.occurrence
        && Math.abs((r.occurrence.p_low_pct + r.occurrence.p_high_pct) / 2 - conversion.value) > 1e-9;
      loss.push({ field_path: `factors[${conversion.label}].event_risk`, before: conversion.value,
        after: conflicting ? null : occurrence ?? null, severity: occurrence && !conflicting ? 'info' : 'warn', reason: conflicting
          ? `Olumi had drafted ‘${conversion.label}’ = ${conversion.value}%, but ‘${r.label}’ already carries a different likelihood estimate, so the separate factor isn't used.`
          : occurrence
          ? `Converted ‘${conversion.label}’ into the likelihood on ‘${r.label}’: ${eventRiskCardLine(occurrence, user ? undefined : r.occurrence?.basis_text)}`
          : horizonMismatch
          ? `Olumi had drafted ‘${conversion.label}’ = ${conversion.value}% for a different horizon from the goal, so it isn't used.`
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
  }, loss, horizonMismatches };
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
