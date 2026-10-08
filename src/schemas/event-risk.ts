/**
 * event_risk.v1: CEE's ONE owner of the opt-in event-risk block on a risk node.
 *
 * Science 393023 (science-richness-P0-20261007.md ruling (a) + §4 PILOT; rulings Q1–Q9 in
 * lane-event-risk-SCIENCE-RULING.md). A risk is an EVENT that may happen within a horizon.
 * Three uncertainties are never merged:
 *
 * - OCCURRENCE: this block;
 * - mechanism EXISTENCE: each link's `exists_probability`;
 * - EFFECT SIZE: each risk→child link's strength, read as the severity CONDITIONAL on occurrence.
 *
 * What CEE does with it:
 *
 * - DECLARES it on CEE's `NodeV3` (cee-v3.ts). That schema is a plain `z.object` that STRIPS
 *   undeclared keys, so without the declaration every model writer, and the Run loader, silently
 *   deleted the block.
 * - VALIDATES it at the write door (`eventRiskIngressIssues`, used by graph registration): a
 *   malformed block, or one on a non-risk node, is REFUSED (422, details.code EVENT_RISK_INVALID) and nothing is written.
 * - FORWARDS it: the Run payload spreads parsed nodes, so the block reaches PLoT unchanged. PLoT
 *   forwards it verbatim to ISL, which owns the semantics and refuses with a typed 422 what v1
 *   cannot evaluate (a driver parent, a non-root preventer, …).
 *
 * Absent ⇒ the node is today's risk node, byte-identically. `stableStringify` drops undefined
 * keys, so a legacy Run's `sent_digest` is unchanged.
 *
 * NOT AI-EDITABLE in v1: the root is absent from `aiEditableFieldRoots('node')`, so field-safety
 * refuses an `update_node` naming it. Writers are the user's graph registration today. The drafter
 * (`likelihood` → event_risk) and the add-risk door are slice 2.
 */
import { z } from "zod";
import { CANONICAL_ID_REGEX } from "../cee/utils/id-normalizer.js";

/** P(the event happens at least once within the horizon), as a stated range. */
export const EventRiskOccurrenceV1 = z
  .object({
    p_low: z.number().min(0).max(1),
    p_high: z.number().min(0).max(1),
    meaning: z.literal("at_least_once_within_horizon").optional(),
    /** Whose range it is: the user's, Olumi's estimate, or a reference figure. The range's warrant. */
    basis: z.enum(["user", "olumi", "reference"]),
  })
  .strict()
  .refine((o) => o.p_low <= o.p_high, { message: "p_low must not exceed p_high", path: ["p_low"] });

export const EventRiskV1 = z
  .object({
    version: z.literal(1),
    occurrence: EventRiskOccurrenceV1,
    /** The window the occurrence is stated over, in months. */
    horizon: z.object({ months: z.number().positive().max(600) }).strict(),
    /**
     * Preventers: each a ROOT factor an option sets (0 = not in place, 1 = in place), linked to
     * this risk. While it is in place, occurrence is scaled by (1 − occurrence_reduction).
     * Several multiply (independent preventions).
     */
    mitigations: z
      .array(
        z
          .object({
            factor_id: z.string().min(1).max(100).regex(CANONICAL_ID_REGEX),
            occurrence_reduction: z.number().min(0).max(1),
          })
          .strict(),
      )
      .min(1)
      .max(8)
      .optional(),
  })
  .strict()
  .refine(
    (risk) => !risk.mitigations || new Set(risk.mitigations.map((m) => m.factor_id)).size === risk.mitigations.length,
    {
      message: "event_risk.mitigations must name each factor at most once",
      path: ["mitigations"],
    },
  );
export type EventRiskV1T = z.infer<typeof EventRiskV1>;

/** A readable warrant belongs only to a valid Olumi occurrence on a risk node. */
export function readOlumiEventRiskBasisText(node: {
  readonly kind?: unknown;
  readonly event_risk?: unknown;
  readonly event_risk_basis_text?: unknown;
}): string | undefined {
  if (node.kind !== 'risk' || typeof node.event_risk_basis_text !== 'string') return undefined;
  const occurrence = EventRiskV1.safeParse(node.event_risk);
  if (!occurrence.success || occurrence.data.occurrence.basis !== 'olumi') return undefined;
  const text = node.event_risk_basis_text.trim();
  return text === '' ? undefined : text;
}

export interface EventRiskIssue {
  readonly node_id: string;
  readonly path: string;
  readonly message: string;
}

/**
 * The write door's check: every `event_risk` is a valid v1 block, and only on a `kind: "risk"`
 * node. Returns the issues (capped at 10). Empty means the graph may be written. A graph with no
 * block returns `[]` without looking further, so a legacy registration is unaffected.
 */
export function eventRiskIngressIssues(
  nodes: ReadonlyArray<Record<string, unknown>>,
): EventRiskIssue[] {
  const issues: EventRiskIssue[] = [];
  for (const node of nodes) {
    if (node.event_risk === undefined) continue;
    const nodeId = typeof node.id === "string" ? node.id : "";
    if (node.kind !== "risk") {
      issues.push({
        node_id: nodeId,
        path: "event_risk",
        message: `event_risk is only valid on a risk node (kind ${JSON.stringify(node.kind)})`,
      });
      continue;
    }
    const parsed = EventRiskV1.safeParse(node.event_risk);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.push({
          node_id: nodeId,
          path: ["event_risk", ...issue.path].join("."),
          message: issue.message,
        });
      }
    }
  }
  return issues.slice(0, 10);
}
