import { z } from 'zod';

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const NonEmpty = z.string().min(1);
const AuthoredBy = z.union([z.enum(['owner', 'assistant']), Uuid]);

const Actor = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('known'), authored_by: AuthoredBy }).strict(),
  z.object({ kind: z.literal('system') }).strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
]);

const creationMetadata = {
  mutation_id: Uuid.nullable(),
  source_turn_id: NonEmpty.nullable(),
} as const;

const Creation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('initial'), ...creationMetadata }).strict(),
  z.object({ kind: z.literal('committed_mutation'), ...creationMetadata }).strict(),
  z
    .object({ kind: z.literal('restore'), source_version_id: Uuid, ...creationMetadata })
    .strict(),
  z
    .object({ kind: z.literal('variant_creation'), source_version_id: Uuid, ...creationMetadata })
    .strict(),
  z
    .object({ kind: z.literal('variant_promotion'), source_version_id: Uuid, ...creationMetadata })
    .strict(),
  z.object({ kind: z.literal('unknown'), ...creationMetadata }).strict(),
]);

const Lineage = z.discriminatedUnion('kind', [
  z
    .object({
      kind: z.literal('known'),
      parent_version_id: Uuid.nullable(),
      root_version_id: Uuid,
    })
    .strict(),
  z.object({ kind: z.literal('unknown') }).strict(),
]);

const SummaryObject = z
  .object({
    version_id: Uuid,
    scenario_id: Uuid,
    sequence: z.number().int().min(1),
    label: z.string().nullable(),
    created_at: z.string().datetime({ offset: true }),
    actor: Actor,
    creation: Creation,
    lineage: Lineage,
    full_hash: Sha256,
    analysis_affecting_hash: Sha256,
  })
  .strict();

/** Exact temporary mirror of schemas commit 66229fe7. */
export const ModelVersionSummaryV2LocalSchema = SummaryObject.superRefine((data, ctx) => {
  if (data.lineage.kind === 'known' && data.lineage.parent_version_id === data.version_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['lineage', 'parent_version_id'],
      message: 'a model version cannot be its own parent',
    });
  }
  if ('source_version_id' in data.creation && data.creation.source_version_id === data.version_id) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['creation', 'source_version_id'],
      message: 'a model version cannot be created from itself',
    });
  }
});

const ListObject = z
  .object({
    schema: z.literal('model_versions_list.v2'),
    request_id: NonEmpty.nullable(),
    scenario_id: Uuid,
    current_version_id: Uuid.nullable(),
    versions: z.array(ModelVersionSummaryV2LocalSchema),
    next_cursor: NonEmpty.nullable(),
  })
  .strict();

/** Strict egress guard; replace with the released package contract after #48/#49. */
export const ModelVersionsListV2LocalSchema = ListObject.superRefine((data, ctx) => {
  if (data.current_version_id === null && data.versions.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['current_version_id'],
      message: 'a history page with versions must identify an authoritative current head',
    });
  }
  if (data.current_version_id === null && data.next_cursor !== null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['next_cursor'],
      message: 'a scenario with no persisted head cannot have another history page',
    });
  }

  const ids = new Set<string>();
  for (let index = 0; index < data.versions.length; index += 1) {
    const version = data.versions[index]!;
    if (version.scenario_id !== data.scenario_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['versions', index, 'scenario_id'],
        message: 'every version must belong to the list scenario_id',
      });
    }
    if (ids.has(version.version_id)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['versions', index, 'version_id'],
        message: 'version_id values must be unique within a history page',
      });
    }
    ids.add(version.version_id);
    const previous = data.versions[index - 1];
    if (previous !== undefined && previous.sequence <= version.sequence) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['versions', index, 'sequence'],
        message: 'versions must be strictly descending by sequence',
      });
    }
  }
});

export type ModelVersionSummaryV2Local = z.infer<typeof ModelVersionSummaryV2LocalSchema>;
export type ModelVersionsListV2Local = z.infer<typeof ModelVersionsListV2LocalSchema>;

const CURSOR_PREFIX = 'mv2.';

/** Opaque newest-first cursor. Only a positive server sequence is admitted. */
export function encodeModelVersionsCursor(beforeSequence: number): string {
  if (!Number.isInteger(beforeSequence) || beforeSequence < 1) {
    throw new Error('model-version cursor sequence must be a positive integer');
  }
  return `${CURSOR_PREFIX}${Buffer.from(String(beforeSequence), 'utf8').toString('base64url')}`;
}

export function decodeModelVersionsCursor(cursor: string): number | null {
  if (!cursor.startsWith(CURSOR_PREFIX)) return null;
  try {
    const raw = Buffer.from(cursor.slice(CURSOR_PREFIX.length), 'base64url').toString('utf8');
    if (!/^[1-9][0-9]*$/.test(raw)) return null;
    const sequence = Number(raw);
    return Number.isSafeInteger(sequence) ? sequence : null;
  } catch {
    return null;
  }
}
