/**
 * DRAFT BY RECORDS — the model states what the user said and what it is itself
 * adding; a deterministic projector builds the graph.
 *
 * Three files, one contract (derive any two from the third):
 *   `instruction.ts` — what the model is asked for
 *   `grammar.ts`     — the shape it must emit (structured-outputs json_schema)
 *   `projector.ts`   — the pure function that turns a record set into GraphV3
 * plus `seam.ts`, which owns the post-LLM validate-and-project step and its
 * honest-failure semantics.
 *
 * NOTHING HERE CROSSES A PUBLISHED WIRE. Records are CEE-internal;
 * `@talchain/schemas` is untouched; PLoT and ISL continue to receive the GRAPH
 * only, byte-compatibly.
 */
export {
  DRAFT_RECORD_STATED_KINDS,
  DRAFT_RECORD_ROLES,
  DRAFT_RECORD_DIRECTIONS,
  DRAFT_RECORD_CLAIM_KINDS,
  DRAFT_RECORD_CLAIM_DISCRIMINATOR,
  DRAFT_RECORDS_CLAIM_PROGRESS_RE,
  DRAFT_RECORD_STATED_DISCRIMINATOR,
  DRAFT_RECORDS_STATED_PROGRESS_RE,
  DRAFT_RECORD_REF_FIELDS,
  DRAFT_RECORD_REF_FIELD_NAMES,
  DRAFT_RECORD_CATEGORIES,
  DRAFT_RECORD_EFFECTS,
  buildDraftRecordsSchema,
  buildDraftClaimItemSchema,
  draftClaimSchemaKeys,
  draftStatedItemSchemaKeys,
  draftRecordsGrammarHash,
  measureDraftRecordsSchemaBudget,
  countOptionalParams,
  countUnionParams,
  countObjectSchemas,
  collectMinItemsValues,
  findForbiddenKeywords,
  findObjectsMissingAdditionalPropertiesFalse,
  ANTHROPIC_OPTIONAL_PARAM_LIMIT,
  ANTHROPIC_UNION_PARAM_LIMIT,
  SERIALIZED_BYTES_BUDGET,
  MIN_ITEMS_ALLOWED_VALUES,
  FORBIDDEN_SCHEMA_KEYWORDS,
} from "./grammar.js";
export type {
  DraftRecordStatedKind,
  DraftRecordRole,
  DraftRecordDirection,
  DraftRecordClaimKind,
  DraftRecordCategory,
  DraftRecordEffect,
  DraftStatedItem,
  DraftInferenceClaim,
  DraftRecordSet,
  DraftRecordsBudgetReport,
} from "./grammar.js";

export {
  DRAFT_RECORDS_INSTRUCTION,
  DRAFT_RECORDS_SHAPE_INSTRUCTION,
  DRAFT_RECORDS_CONNECT_INSTRUCTION,
  draftRecordsInstructionHash,
} from "./instruction.js";

export {
  projectRecordsToGraph,
  projectionFingerprint,
  canonicalText,
  canonicalSerialise,
  sha8,
  directionToOperator,
} from "./projector.js";
export type {
  RecordProvenanceClass,
  RecordProvenance,
  DroppedRecordRef,
  RecordProjection,
  ProjectedNode,
  ProjectedEdge,
  ProjectedGraph,
} from "./projector.js";

export {
  projectDraftRecords,
  isGraphShapedResponse,
  isSalvageableRecordSet,
  findGrammarFieldsDroppedBySeam,
  DraftRecordSetWire,
} from "./seam.js";
export type { DraftRecordsSeamResult, DraftRecordsSeamFailure } from "./seam.js";

export {
  enumerateCompletionAsk,
  countBlockingAskItems,
  isBlockingAskItem,
  shouldKeepCompletion,
  completionRegressesProtectedContent,
  askItemIdentity,
  buildRecordsCompletionSchema,
  buildRecordsCompletionPrompt,
  mergeCompletionClaims,
  RECORDS_COMPLETION_MAX_TOKENS,
  RECORDS_COMPLETION_WALL_MS,
} from "./completion.js";
export type { CompletionAsk, CompletionAskItem, CompletionMergeResult } from "./completion.js";

export { buildDraftRecordsSidecar, DRAFT_RECORDS_SIDECAR_VERSION } from "./sidecar.js";
export type { DraftRecordsSidecar, RecordBinding, BindingClass } from "./sidecar.js";
