/**
 * ⭐ PATH-B TOOL ADAPTERS: ONE TYPED OUTCOME (C5, 19 Oct 2026; outbox/PATH-B-DESIGN.md). Every adapter returns exactly one of:
 *  · `ok`          — the primitive did what was asked. `mutated` is true only when a write was read back; `ran` only with a new
 *                    Run on record.
 *  · `refused`     — the primitive declined, with its own stable reason code. Nothing changed.
 *  · `unavailable` — it could not be done or could not be measured. `write: 'unknown'` when a write was attempted and the
 *                    readback did not confirm it: neither "saved" nor "not saved" may be said.
 * An outcome is evidence of what happened, never of what the adapter attempted. `traceRow` is the row the runner records in
 * `_agent.tool_calls`, the shape the VERIFIER kit reads (`redteam/core-accept/check-core.mjs`).
 */
import { z } from 'zod-v4';

const reason = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const ToolOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ok'), mutated: z.boolean(), ran: z.boolean(), data: z.record(z.string(), z.unknown()) }),
  z.object({ status: z.literal('refused'), reason, detail: z.string().optional(), data: z.record(z.string(), z.unknown()).optional() }),
  z.object({ status: z.literal('unavailable'), reason, write: z.enum(['none', 'unknown']), detail: z.string().optional(), data: z.record(z.string(), z.unknown()).optional() }),
]);
export type ToolOutcome = z.infer<typeof ToolOutcomeSchema>;

export const ok = (data: Record<string, unknown>, effect: { readonly mutated?: boolean; readonly ran?: boolean } = {}): ToolOutcome =>
  ({ status: 'ok', mutated: effect.mutated === true, ran: effect.ran === true, data });
/** `data`: the typed facts the refusal rests on (e.g. readiness codes), never words composed for the user. */
export const refused = (code: string, detail?: string, data?: Record<string, unknown>): ToolOutcome =>
  ({ status: 'refused', reason: code, ...(detail === undefined ? {} : { detail }), ...(data === undefined ? {} : { data }) });
/** `data`: the typed facts of what could not be done (e.g. the figure a carrier could not take), never words for the user. */
export const unavailable = (code: string, write: 'none' | 'unknown' = 'none', detail?: string, data?: Record<string, unknown>): ToolOutcome =>
  ({ status: 'unavailable', reason: code, write, ...(detail === undefined ? {} : { detail }), ...(data === undefined ? {} : { data }) });

/** The kit's `_agent.tool_calls` row. `mutated: null` is an UNKNOWN write (never a claimed one); `ran: null` is no Run. */
export interface TraceRow {
  readonly args?: Readonly<Record<string, unknown>>;
  readonly name: string;
  readonly ok: boolean;
  readonly mutated: boolean | null;
  readonly outcome: ToolOutcome['status'];
  readonly refusal: string | null;
  readonly ran: true | null;
}

export function traceRow(name: string, outcome: ToolOutcome): TraceRow {
  return {
    name,
    ok: outcome.status === 'ok',
    mutated: outcome.status === 'ok' ? outcome.mutated : outcome.status === 'unavailable' && outcome.write === 'unknown' ? null : false,
    outcome: outcome.status,
    refusal: outcome.status === 'ok' ? null : outcome.reason,
    ran: outcome.status === 'ok' && outcome.ran ? true : null,
  };
}
