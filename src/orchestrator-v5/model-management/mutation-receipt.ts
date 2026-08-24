import { OlumiResponseSchema, type OlumiResponse } from "@talchain/schemas/boundary";
import { z } from "zod";

import { GraphV3 } from "../../schemas/cee-v3.js";

const Uuid = z.string().uuid();
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);
const AuthoredBy = z.union([z.enum(["owner", "assistant"]), Uuid]);
const Actor = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("known"), authored_by: AuthoredBy }).strict(),
  z.object({ kind: z.literal("system") }).strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);
const Creation = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("initial") }).strict(),
  z.object({ kind: z.literal("committed_mutation") }).strict(),
  z.object({ kind: z.literal("restore"), source_version_id: Uuid }).strict(),
]);
const Lineage = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("known"),
      parent_version_id: Uuid.nullable(),
      root_version_id: Uuid,
    })
    .strict(),
  z.object({ kind: z.literal("unknown") }).strict(),
]);

/**
 * Temporary exact mirror of schemas commit 91e610dc. Remove only after the
 * ordered schemas changes publish under an honest version newer than 0.48.0.
 */
export const ModelVersionMutationReceiptV1LocalSchema = z
  .object({
    schema: z.literal("model_version_mutation_receipt.v1"),
    scenario_id: Uuid,
    mutation_id: Uuid,
    version_id: Uuid,
    sequence: z.number().int().min(1),
    graph: GraphV3.passthrough(),
    full_hash: Sha256,
    hash_algorithm: z.string().min(1),
    identity_projection_version: z.string().min(1),
    identity_normaliser_version: z.string().min(1),
    graph_schema_version: z.string().min(1),
    analysis_affecting_hash: Sha256,
    actor: Actor,
    creation: Creation,
    source_turn_id: z.string().min(1).nullable(),
    lineage: Lineage,
    undo_version_id: Uuid.nullable(),
    event_id: z.string().min(1),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (
      data.lineage.kind === "known" &&
      data.lineage.parent_version_id === data.version_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lineage", "parent_version_id"],
        message: "a model version cannot be its own parent",
      });
    }
    if (
      data.creation.kind === "restore" &&
      data.creation.source_version_id === data.version_id
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["creation", "source_version_id"],
        message: "a restored model version cannot source itself",
      });
    }
    if (data.undo_version_id === data.version_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["undo_version_id"],
        message: "a model version cannot be its own undo version",
      });
    }
  });

export type ModelVersionMutationReceiptV1Local = z.infer<
  typeof ModelVersionMutationReceiptV1LocalSchema
>;

export const OlumiResponseWithModelVersionReceiptLocalSchema =
  OlumiResponseSchema.extend({
    model_version_receipt: ModelVersionMutationReceiptV1LocalSchema.optional(),
  }).strict();

interface PersistedMutationReceiptCarrier {
  readonly mutation_id: string;
  readonly version_id: string;
  readonly version_number: number;
  readonly graph: unknown;
  readonly graph_identity_hash: string;
  readonly hash_algorithm: string;
  readonly identity_projection_version: string;
  readonly identity_normaliser_version: string;
  readonly graph_schema_version: string;
  readonly analysis_affecting_hash: string;
  readonly actor_kind: "known" | "system" | "unknown";
  readonly authored_by: string | null;
  readonly creation_kind: "initial" | "committed_mutation" | "restore";
  readonly source_version_id: string | null;
  readonly source_turn_id: string | null;
  readonly parent_version_id: string | null;
  readonly root_version_id: string | null;
  readonly undo_version_id: string | null;
  readonly event_id: string;
}

export function toModelVersionMutationReceiptV1(
  scenarioId: string,
  carrier: PersistedMutationReceiptCarrier
): ModelVersionMutationReceiptV1Local {
  const actor =
    carrier.actor_kind === "known"
      ? { kind: "known" as const, authored_by: carrier.authored_by }
      : { kind: carrier.actor_kind };
  const creation =
    carrier.creation_kind === "restore"
      ? {
          kind: "restore" as const,
          source_version_id: carrier.source_version_id,
        }
      : { kind: carrier.creation_kind };
  const lineage =
    carrier.root_version_id === null
      ? { kind: "unknown" as const }
      : {
          kind: "known" as const,
          parent_version_id: carrier.parent_version_id,
          root_version_id: carrier.root_version_id,
        };

  return ModelVersionMutationReceiptV1LocalSchema.parse({
    schema: "model_version_mutation_receipt.v1",
    scenario_id: scenarioId,
    mutation_id: carrier.mutation_id,
    version_id: carrier.version_id,
    sequence: carrier.version_number,
    graph: carrier.graph,
    full_hash: carrier.graph_identity_hash,
    hash_algorithm: carrier.hash_algorithm,
    identity_projection_version: carrier.identity_projection_version,
    identity_normaliser_version: carrier.identity_normaliser_version,
    graph_schema_version: carrier.graph_schema_version,
    analysis_affecting_hash: carrier.analysis_affecting_hash,
    actor,
    creation,
    source_turn_id: carrier.source_turn_id,
    lineage,
    undo_version_id: carrier.undo_version_id,
    event_id: carrier.event_id,
  });
}

export function attachModelVersionMutationReceipt(
  response: OlumiResponse,
  receipt: ModelVersionMutationReceiptV1Local
): OlumiResponse {
  return OlumiResponseWithModelVersionReceiptLocalSchema.parse({
    ...response,
    model_version_receipt: receipt,
  });
}

export function modelVersionMutationReceiptFromResponse(
  response: unknown
): ModelVersionMutationReceiptV1Local | null {
  if (response === null || typeof response !== "object") return null;
  const raw = (response as Record<string, unknown>).model_version_receipt;
  return raw === undefined
    ? null
    : ModelVersionMutationReceiptV1LocalSchema.parse(raw);
}
