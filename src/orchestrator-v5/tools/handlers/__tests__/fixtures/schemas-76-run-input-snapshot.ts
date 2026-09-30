// TEST-ONLY COPY of the SC-24 contract module — @talchain/schemas PR #76 @ 5a59530912c12bf865c49bbeb280f911c88edbb4,
// src/orchestrator/run-input-snapshot.ts (git blob 4a6c4f52e5a2f97b2d7e6c5881e4144c60c2745f), byte-for-byte below this header. It exists only so the
// capture spec parses with the contract's OWN zod before CEE vendors the release. DELETE on the vendor bump and import
// RunInputSnapshotSchema from '@talchain/schemas' instead.
import { z } from 'zod';

// ============================================================================
// 0.67.0 — SC-24: THE INPUT A RUN WAS SENT, recorded on the Run fact.
//
// Design: SC-24 v2 (programme-docs #84 5913851822 / 5913873645 / 5914416431; lease DL #75 5914474485).
// One Run-unit carrier: AIQ 5912905493 + 5914731075, P0 SHARED DATA 5914750268 — `goal` below IS the Run-attested goal
// unit the currentness gate reads; there is no second snapshot.
//
// WHY A SNAPSHOT AND NOT A MODEL VERSION. `graph_hash_at_run` hashes the canonicalised persisted read, not what was
// sent: CEE transforms a copy about ten ways before PLoT (option gating, Olumi-proposed filter, participation guard,
// wire-scale interventions, carried baselines/caps/spreads, derived goal direction). A version id names a graph; this
// names the Run's actual input. "What changed between Run A and Run B" is then a diff of two recorded inputs — never a
// UI graph diff, never a reconstruction of an old Run from today's graph.
//
// CAPTURED BY CEE between building the PLoT request and dispatching it (`run-analysis.ts`), from the request's own
// values. RULES (AIQ 5914731075, P0 SHARED DATA 5914750268):
//   - every member copies what the Run was SENT; a member the Run was not sent is ABSENT, never inferred or defaulted
//     (a missing unit never becomes GBP; a missing direction stays absent);
//   - `raw` + `unit` are the AUTHORED user-unit figure (the same authored unit as the node's own field, e.g. the goal's
//     `goal_threshold_unit`), never a normalised score; `encoded` is the number PLoT was actually sent.
//
// Bounded: ids and labels only, no graph bytes, no free text beyond labels.
// ============================================================================

const Id = z.string().min(1).max(200);
const Label = z.string().max(200);
const Unit = z.string().min(1).max(64);
/** An authored figure: a number, or a category / boolean as the user stated it. */
const Raw = z.union([z.number().finite(), z.string().min(1).max(200), z.boolean()]);

/** The goal the Run was sent. Each member mirrors the goal node's own field, as sent. */
export const RunInputGoalSchema = z.object({
  node_id: Id,
  label: Label.optional(),
  /** `goal_threshold_raw`: the target in the authored unit. */
  target_raw: z.number().finite().optional(),
  /** `goal_threshold_unit`, exactly as authored. The Run-attested goal unit (AIQ 5912905493). */
  unit: Unit.optional(),
  /** The node's held comparator (`goal_direction` on the goal node). */
  operator: z.enum(['>=', '<=', '>', '<']).optional(),
  /** The request's top-level `goal_direction` flag, only when it was sent. */
  direction: z.enum(['maximise', 'minimise']).optional(),
  /** `goal_threshold_frame`, when sent. */
  frame: z.string().min(1).max(32).optional(),
}).strict();
export type RunInputGoal = z.infer<typeof RunInputGoalSchema>;

/** One factor an option set, as sent. */
export const RunInputSettingSchema = z.object({
  factor_id: Id,
  label: Label.optional(),
  /** The authored user-unit figure (`raw_value` / `display_value`); absent when the option stated only an encoded value. */
  raw: Raw.optional(),
  unit: Unit.optional(),
  /** The number PLoT was sent for this factor. */
  encoded: z.number().finite(),
  /** True when CEE HELD this factor at its current value (the status-quo option), rather than the option setting it. */
  held: z.literal(true).optional(),
  /** MG's typed intervention reading (0.67.0), carried verbatim when sent; absent = today's absolute meaning. */
  kind: z.string().min(1).max(32).optional(),
}).strict();
export type RunInputSetting = z.infer<typeof RunInputSettingSchema>;

export const RunInputOptionSchema = z.object({
  option_id: Id,
  label: Label.optional(),
  is_baseline: z.literal(true).optional(),
  settings: z.array(RunInputSettingSchema).max(200).superRefine((rows, ctx) => {
    const ids = rows.map((r) => r.factor_id);
    ids.forEach((id, i) => {
      if (ids.indexOf(id) !== i) ctx.addIssue({ code: 'custom', path: [i, 'factor_id'], message: 'one setting per factor' });
    });
  }),
}).strict();
export type RunInputOption = z.infer<typeof RunInputOptionSchema>;

/** An option the user had that this Run did NOT compare, and why. */
export const RunInputOptionNotSentSchema = z.object({
  option_id: Id,
  label: Label.optional(),
  reason: z.enum(['not_analysable', 'olumi_proposed']),
}).strict();

/** A factor's own value, as sent. */
export const RunInputFactorSchema = z.object({
  factor_id: Id,
  label: Label.optional(),
  raw: Raw.optional(),
  unit: Unit.optional(),
  encoded: z.number().finite().optional(),
  /** `observed_state.source` (whose figure it is), when sent. */
  source: z.string().min(1).max(64).optional(),
}).strict();

/** A limit the Run was sent (`goal_constraints`). */
export const RunInputConstraintSchema = z.object({
  constraint_id: Id,
  node_id: Id,
  label: Label.optional(),
  operator: z.enum(['>=', '<=']),
  raw: z.number().finite(),
  unit: Unit.optional(),
  frame: z.string().min(1).max(32).optional(),
}).strict();

/** A link as sent. */
export const RunInputLinkSchema = z.object({
  from: Id,
  to: Id,
  mean: z.number().finite(),
  std: z.number().finite().optional(),
  exists_probability: z.number().min(0).max(1).optional(),
}).strict();

function uniqueBy<T>(key: (row: T) => string, message: string) {
  return (rows: T[], ctx: z.RefinementCtx) => {
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      const k = key(row);
      if (seen.has(k)) ctx.addIssue({ code: 'custom', path: [i], message });
      seen.add(k);
    });
  };
}

export const RunInputSnapshotSchema = z.object({
  snapshot_version: z.literal(1),
  /** sha256 (hex) of the request CEE sent PLoT, request id excluded — equal digests mean identical inputs. */
  sent_digest: z.string().regex(/^[0-9a-f]{64}$/),
  /** `null` = the Run was sent no goal. */
  goal: RunInputGoalSchema.nullable(),
  options: z.array(RunInputOptionSchema).max(50)
    .superRefine(uniqueBy((o) => o.option_id, 'one entry per option')),
  options_not_sent: z.array(RunInputOptionNotSentSchema).max(50)
    .superRefine(uniqueBy((o) => o.option_id, 'one entry per option')),
  factors: z.array(RunInputFactorSchema).max(500)
    .superRefine(uniqueBy((f) => f.factor_id, 'one entry per factor')),
  constraints: z.array(RunInputConstraintSchema).max(100)
    .superRefine(uniqueBy((c) => c.constraint_id, 'one entry per limit')),
  links: z.array(RunInputLinkSchema).max(2000)
    .superRefine(uniqueBy((l) => JSON.stringify([l.from, l.to]), 'one entry per link')),
}).strict();
export type RunInputSnapshot = z.infer<typeof RunInputSnapshotSchema>;
