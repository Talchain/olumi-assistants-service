import { z } from 'zod';

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const NonEmpty = z.string().min(1);
const JsonPointer = z.string().regex(
  /^(?:\/(?:[^~/]|~0|~1)*)+$/,
  'path must be a non-empty RFC 6901 JSON Pointer',
);

const DiffItem = z
  .object({
    path: JsonPointer,
    change_kind: z.enum(['added', 'removed', 'changed']),
    entity_kind: z.enum(['model', 'node', 'edge', 'option', 'constraint']),
    entity_id: NonEmpty.nullable(),
    label: z.string().nullable(),
    before_display: z.string().nullable(),
    after_display: z.string().nullable(),
    summary: NonEmpty,
    why_it_matters: NonEmpty,
  })
  .strict();

type DiffItemValue = z.infer<typeof DiffItem>;

function itemKey(item: DiffItemValue): string {
  return JSON.stringify([item.path, item.change_kind, item.entity_kind, item.entity_id]);
}

const DeterministicItems = z.array(DiffItem).superRefine((items, ctx) => {
  for (let index = 1; index < items.length; index += 1) {
    if (itemKey(items[index - 1]!) >= itemKey(items[index]!)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: 'diff items must be unique and strictly ascending',
      });
    }
  }
});

const DeterministicStrings = z.array(NonEmpty).superRefine((items, ctx) => {
  for (let index = 1; index < items.length; index += 1) {
    if (items[index - 1]! >= items[index]!) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: 'entries must be unique and strictly ascending',
      });
    }
  }
});

const CATEGORY_KEYS = [
  'structure',
  'relationships',
  'values_uncertainty',
  'evidence_provenance',
  'goals_constraints_options',
  'assumptions_claims',
  'presentation',
  'other_model_fields',
] as const;

const Categories = z
  .object({
    structure: DeterministicItems,
    relationships: DeterministicItems,
    values_uncertainty: DeterministicItems,
    evidence_provenance: DeterministicItems,
    goals_constraints_options: DeterministicItems,
    assumptions_claims: DeterministicItems,
    presentation: DeterministicItems,
    other_model_fields: DeterministicItems,
  })
  .strict();

const ModelVersionDiffV1Object = z
  .object({
    schema: z.literal('model_version_diff.v1'),
    request_id: NonEmpty.nullable(),
    scenario_id: Uuid,
    from_version_id: Uuid,
    to_version_id: Uuid,
    relation: z.enum(['identical', 'different']),
    from_full_hash: Sha256,
    to_full_hash: Sha256,
    analysis_equivalent: z.boolean(),
    categories: Categories,
    coverage: z
      .object({
        known_undetectable: DeterministicStrings,
        known_uninterpreted_paths: DeterministicStrings,
      })
      .strict(),
  })
  .strict();

/** Exact local egress mirror of schemas ModelVersionDiffV1Schema. */
export const ModelVersionDiffV1LocalSchema = ModelVersionDiffV1Object.superRefine(
  (data, ctx) => {
    if (data.relation === 'identical' && data.from_full_hash !== data.to_full_hash) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relation'],
        message: 'an identical relation requires equal full hashes',
      });
    }
    if (data.from_version_id === data.to_version_id && data.relation !== 'identical') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['relation'],
        message: 'the same version_id cannot compare as different',
      });
    }

    const entries = CATEGORY_KEYS.flatMap((category) =>
      data.categories[category].map((item, index) => ({ category, item, index })),
    );
    if (data.relation === 'identical') {
      if (!data.analysis_equivalent) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['analysis_equivalent'],
          message: 'identical full models must be analysis-equivalent',
        });
      }
      if (entries.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categories'],
          message: 'an identical comparison cannot carry changes',
        });
      }
    }
    if (
      data.relation === 'different' &&
      entries.length === 0 &&
      data.coverage.known_undetectable.length === 0 &&
      data.coverage.known_uninterpreted_paths.length === 0
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coverage'],
        message: 'a change with no categories must disclose a coverage limitation',
      });
    }

    const seen = new Map<string, string>();
    for (const { category, item, index } of entries) {
      const key = itemKey(item);
      const prior = seen.get(key);
      if (prior !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categories', category, index],
          message: `the same diff item is already classified under ${prior}`,
        });
      } else {
        seen.set(key, category);
      }
      if (
        category !== 'other_model_fields' &&
        data.coverage.known_uninterpreted_paths.includes(item.path)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['categories', category, index, 'path'],
          message: 'an interpreted path cannot also be declared uninterpreted',
        });
      }
    }

    const otherPaths = [
      ...new Set(data.categories.other_model_fields.map((item) => item.path)),
    ].sort();
    if (
      otherPaths.length !== data.coverage.known_uninterpreted_paths.length ||
      otherPaths.some(
        (path, index) => path !== data.coverage.known_uninterpreted_paths[index],
      )
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['coverage', 'known_uninterpreted_paths'],
        message: 'the uninterpreted ledger must exactly match other_model_fields paths',
      });
    }
  },
);
