import { createHash } from 'node:crypto';
import type { DraftRecordSet } from './grammar.js';
import type { DraftRecordsSidecar } from './sidecar.js';
import type { RecordProjection } from './projector.js';

/** Admin-only diagnostic receipt. Never a graph writer or an analysis input. */
export interface DraftLineageReceipt {
  version: 1;
  boundary: 'records_projection_before_pipeline_repair';
  code_sha: string;
  prompt: {
    base_prompt_hash: string | null;
    base_prompt_version: string | null;
    instruction_sha256: string;
    grammar_sha256: string;
  };
  draft_request: DraftRequestIdentity;
  provider_output: {
    text_sha256: string;
    decoded_input: unknown;
    salvaged_from_truncation: boolean;
  };
  initial_records: DraftRecordSet;
  selected_records: DraftRecordSet;
  completion: {
    attempted: boolean;
    kept: boolean;
    request: DraftRequestIdentity | null;
    output_text: string | null;
  };
  projection: {
    graph: RecordProjection['graph'];
    bindings: DraftRecordsSidecar['bindings'];
    refusals: readonly unknown[];
    constraints: RecordProjection['goalConstraints'];
    constraint_carriage: 'diagnostic_only_not_forwarded_to_pipeline';
  };
}

export interface DraftRequestIdentity {
  provider: 'anthropic';
  model: string;
  /** Hash the actual body, including sampling, attachments and output grammar. */
  request_body_sha256: string;
  system_sha256: string;
  messages_sha256: string;
  output_config_sha256: string;
}

function sha256(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value) ?? 'null').digest('hex');
}

export function draftRequestIdentity(body: {
  model: string;
  system?: unknown;
  messages: unknown;
  output_config?: unknown;
}): DraftRequestIdentity {
  return {
    provider: 'anthropic',
    model: body.model,
    request_body_sha256: sha256(body),
    system_sha256: sha256(body.system ?? null),
    messages_sha256: sha256(body.messages),
    output_config_sha256: sha256(body.output_config ?? null),
  };
}

/** Detach evidence from the mutable graph that normalization and repair receive. */
export function captureDraftLineage(args: Omit<DraftLineageReceipt, 'version' | 'boundary' | 'provider_output'> & {
  providerText: string;
  decodedInput: unknown;
  salvagedFromTruncation: boolean;
}): DraftLineageReceipt {
  const { providerText, decodedInput, salvagedFromTruncation, ...receipt } = args;
  const captured: DraftLineageReceipt = {
    version: 1,
    boundary: 'records_projection_before_pipeline_repair',
    ...receipt,
    provider_output: {
      text_sha256: createHash('sha256').update(providerText).digest('hex'),
      decoded_input: decodedInput,
      salvaged_from_truncation: salvagedFromTruncation,
    },
  };
  return structuredClone(captured);
}
