import { z } from 'zod';

export const GOAL_SCOPE_UNRESOLVED_REASON = 'goal_scope_unresolved';

const Source = z.object({ quote: z.string().trim().min(1).max(1600), turn_id: z.string().max(128).optional() }).strict();

/** The construction scope declaration, extended only for an approved goal reading. */
export const GoalScopeSchema = z.object({
  modelled: z.string().trim().min(1).max(300),
  alternative: z.string().trim().min(1).max(300),
  extent: z.enum(['total', 'component']),
  stated_in_brief: z.literal(true),
  source: Source,
  component: z.object({
    label: z.string().trim().min(1).max(300),
    rate_id: z.string().min(1).max(128),
    count_id: z.string().min(1).max(128),
    share: z.number().finite().min(0).max(1).optional(),
    basis: z.enum(['unknown', 'same', 'different']),
    count_basis: z.string().trim().min(1).max(300).optional(),
    source: Source,
    basis_source: Source.optional(),
  }).strict().optional(),
}).strict();
export type GoalScope = z.infer<typeof GoalScopeSchema>;

export const GoalScopeReconciliationSchema = z.object({
  kind: z.literal('reconcile_goal_scope'),
  goal_id: z.string().min(1).max(128),
  goal_label: z.string().min(1).max(300),
  scope: GoalScopeSchema.optional(),
  declared_scope: z.object({ modelled: z.string().max(300), alternative: z.string().max(300), stated_in_brief: z.boolean() }).optional(),
  current_level: z.object({ value: z.number().finite(), unit: z.string().min(1).max(64), source: Source }).optional(),
  question: z.string().min(1).max(1600),
  expected: z.enum(['scope', 'component_share', 'billing_basis', 'approval']),
  operands: z.array(z.object({ id: z.string(), value: z.number().finite(), unit: z.string(), source: z.string() })).max(3),
  derivations: z.array(z.object({ kind: z.enum(['component_revenue', 'implied_count']), value: z.number().finite(), unit: z.string(),
    source: z.literal('deterministic_derivation'), conditional: z.literal(true) })).max(2),
}).strict();
export type GoalScopeReconciliation = z.infer<typeof GoalScopeReconciliationSchema>;

/** Quotes and source references warrant a reading, but do not change its numerical meaning. */
export function goalScopeMeaning(scope: unknown): unknown {
  const parsed = GoalScopeSchema.safeParse(scope);
  if (!parsed.success) return undefined;
  const { source: _source, component, ...meaning } = parsed.data;
  return { ...meaning, ...(component ? { component: (({ source: _s, basis_source: _b, ...c }) => c)(component) } : {}) };
}

/** Only the approved facts that affect input interpretation or claim permissions. */
export function goalScopeAnalysisMeaning(scope: unknown): unknown {
  const parsed = GoalScopeSchema.safeParse(scope);
  if (!parsed.success) return undefined;
  const c = parsed.data.component;
  return { extent: parsed.data.extent, ...(c ? { component: { rate_id: c.rate_id, count_id: c.count_id,
    ...(c.share !== undefined ? { share: c.share } : {}), basis: c.basis, ...(c.count_basis ? { count_basis: c.count_basis } : {}) } } : {}) };
}
