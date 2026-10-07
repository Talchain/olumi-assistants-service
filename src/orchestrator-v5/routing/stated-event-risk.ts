/** event_risk.v1 slice 2a: deterministic user occurrence, held outside producer operations. */
import { z } from 'zod';
import { parseNumericValue } from '../../cee/extraction/numeric-parser.js';
import { EventRiskV1, type EventRiskV1T } from '../../schemas/event-risk.js';
import { attestHorizon } from '../agent-lane/horizon-attestation.js';
import type { PatchOperation } from '../../orchestrator/types.js';

const SPACE = String.raw`[ \t]{0,8}`;
const GAP = String.raw`[ \t]{1,8}`;
const NUMBER = String.raw`[+-]?\d{1,6}(?:\.\d{1,6})?`;
const PERCENT = String.raw`(?:%|percent\b)`;
const PROBABILITY = new RegExp(
  String.raw`(?<![\w.,+\-])(?:between${GAP}${NUMBER}${SPACE}(?:${PERCENT}${SPACE})?and${GAP}${NUMBER}${SPACE}${PERCENT}|${NUMBER}${SPACE}(?:${PERCENT}${SPACE})?(?:[-–]|${GAP}to${GAP})${SPACE}${NUMBER}${SPACE}${PERCENT}|(?:about${GAP})?${NUMBER}${SPACE}${PERCENT})`, 'gi',
);
const HORIZON = new RegExp(
  String.raw`\b(?:within|in|over|during)${GAP}(?:(?:the${GAP})?(?:next|coming|following)${GAP})?(\d{1,6}(?:\.\d{1,6})?|a|an|one)?${SPACE}(months?|years?|weeks?)\b`, 'gi',
);

export function readStatedEventRisk(userText: string): { event_risk: EventRiskV1T; quote: string } | undefined {
  if (typeof userText !== 'string') return undefined;
  const probabilities = [...userText.matchAll(PROBABILITY)];
  const horizons = [...userText.matchAll(HORIZON)];
  if (probabilities.length !== 1 || horizons.length !== 1) return undefined;
  const probability = probabilities[0]!;
  const horizon = horizons[0]!;
  // A bounded token reaches the existing numeric parser; never scan the whole hostile input there.
  // The shared range parser reads unsigned bounds; refuse signed negative endpoints before it.
  if (/^(?:(?:between|about)[ \t]{1,8})?-|(?:[-–]|\b(?:to|and))[ \t]{0,8}-/.test(probability[0])) return undefined;
  const number = parseNumericValue(probability[0].replace(/percent\b/gi, '%'));
  if (number === null || number.unit !== 'percent') return undefined;
  const low = number.rangeMin ?? number.value;
  const high = number.rangeMax ?? number.value;
  if (low < 0 || high > 100 || low > high) return undefined;
  if (horizon[1] === undefined && !/\b(?:next|coming|following)\b/i.test(horizon[0])) return undefined;
  const count = horizon[1] === undefined || ['a', 'an', 'one'].includes(horizon[1].toLowerCase()) ? 1 : Number(horizon[1]);
  if (count <= 0) return undefined;
  const unit = horizon[2]!.toLowerCase();
  const months = unit.startsWith('week') ? Math.max(0.1, Math.round(count / 4.345 * 10) / 10)
    : count * (unit.startsWith('year') ? 12 : 1);
  // Reuse the goal's attestation on the bounded original span for supported whole-month durations.
  if (!unit.startsWith('week') && Number.isInteger(count)
    && attestHorizon(horizon[0], { horizon_months: months }).status !== 'attested') return undefined;
  const parsed = EventRiskV1.safeParse({ version: 1,
    occurrence: { p_low: low / 100, p_high: high / 100, basis: 'user', meaning: 'at_least_once_within_horizon' },
    horizon: { months: Math.max(0.1, months) },
  });
  if (!parsed.success) return undefined;
  const start = Math.min(probability.index!, horizon.index!);
  const end = Math.max(probability.index! + probability[0].length, horizon.index! + horizon[0].length);
  return { event_risk: parsed.data, quote: userText.slice(start, end) };
}

export const GM_HELD_USER_EVENT_RISK_KEY = 'user_event_risk';
const UserEventRiskMember = z.object({ risk_id: z.string().min(1), event_risk: EventRiskV1, quote: z.string().min(1).refine((quote) => quote.trim() !== '') }).strict()
  .refine((m) => m.event_risk.occurrence.basis === 'user' && m.event_risk.occurrence.meaning === 'at_least_once_within_horizon' && m.event_risk.mitigations === undefined);
export type UserEventRisk = z.infer<typeof UserEventRiskMember>;
export function readUserEventRiskMember(raw: unknown): UserEventRisk | undefined {
  const parsed = UserEventRiskMember.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/** Fail closed by identity; stamp only after the re-referee, in the same atomic apply. */
export function stampUserEventRisk(operations: PatchOperation[], raw: unknown, graph: unknown): PatchOperation[] | undefined {
  if (raw === undefined) return operations;
  const member = readUserEventRiskMember(raw);
  if (member === undefined) return undefined;
  const { risk_id: id, event_risk } = member;
  const adds = operations.filter((o) => o.op === 'add_node' && o.path === id);
  const node = adds[0]?.value as Record<string, unknown> | undefined;
  const existing = graph as { nodes?: { id?: string }[]; edges?: { to?: string }[] };
  if (adds.length !== 1 || node?.id !== id || node.kind !== 'risk' || node.event_risk !== undefined
    || existing.nodes?.some((n) => n.id === id) || existing.edges?.some((e) => e.to === id)
    || operations.some((o) => o.op === 'add_edge' && (o.value as Record<string, unknown>)?.to === id)) return undefined;
  return operations.map((o) => {
    if (o === adds[0]) return { ...o, value: { ...node, event_risk } };
    if (o.op !== 'add_edge' || (o.value as Record<string, unknown>)?.from !== id) return o;
    // Science Q7: an event's stated impact is not a doubted mechanism, so existence is 1.0. The SIZE is still
    // Olumi's placeholder, so `defaulted: true` ("default strength was applied", EdgeV3) and its provenance stay:
    // the placeholder-parts and link-sizing readers must keep treating the impact as unsized.
    return { ...o, value: { ...(o.value as Record<string, unknown>), exists_probability: 1 } };
  });
}
