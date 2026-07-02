/**
 * T4.0 — Candidate mutation envelope v1: EXECUTABLE SPEC (isolated, off-path).
 *
 * This file is the machine-checkable form of
 * `Docs/t4/dual-model-typed-mutation-handoff-contract.md` §1–§2 (schema gate).
 * It exists so the hand-off contract cannot silently rot before T4 opens: the
 * envelope's fail-closed properties (unknown version, unknown kind, extra
 * fields, missing provenance → reject) are asserted on every required CI run.
 *
 * DELIBERATELY ISOLATED: the schema is defined inline and imports nothing from
 * `src/` — no turn-executor, no context frame, no freshness, no persistence,
 * no dual-draft (T3) code. When the T4 typed-mutation slice opens, the real
 * module is cut from the contract doc and THIS spec is repointed at it (the
 * assertions must survive verbatim; only the import changes).
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Contract §1 — CandidateMutationEnvelope v1 (inline executable spec)
// ---------------------------------------------------------------------------

const CANDIDATE_KINDS = [
  'add_node',
  'add_edge',
  'update_node_field',
  'update_edge_field',
  'rename_node',
  'add_option',
  'remove_node',
  'remove_edge',
  'flag_uncertainty',
  'clarification',
] as const;

const ProvenanceSchema = z
  .object({
    source: z.enum(['dual_model_m2', 'edit_graph_llm', 'flip_proposal', 'user_direct']),
    evidence_pointer: z.string().min(1),
    rationale: z.string().optional(),
    model_id: z.string().optional(),
  })
  .strict();

const IdentitySchema = z
  .object({
    scenario_id: z.string().min(1),
    turn_id: z.string().min(1),
  })
  .strict();

/**
 * Per-kind payloads. v1 keeps them minimal but ALREADY `.strict()` — the
 * fail-closed property under test is structural (extra/unknown fields reject),
 * not the field inventory, which the T4 slice will widen per the contract.
 */
const PayloadByKind = {
  add_node: z.object({ node: z.record(z.unknown()) }).strict(),
  add_edge: z.object({ edge: z.record(z.unknown()) }).strict(),
  update_node_field: z
    .object({ node_id: z.string().min(1), field: z.string().min(1), from: z.unknown(), to: z.unknown() })
    .strict(),
  update_edge_field: z
    .object({ edge_id: z.string().min(1), field: z.string().min(1), from: z.unknown(), to: z.unknown() })
    .strict(),
  rename_node: z
    .object({ node_id: z.string().min(1), from_label: z.string().min(1), to_label: z.string().min(1) })
    .strict(),
  add_option: z.object({ option: z.record(z.unknown()) }).strict(),
  remove_node: z.object({ id: z.string().min(1), reason: z.string().min(1) }).strict(),
  remove_edge: z.object({ id: z.string().min(1), reason: z.string().min(1) }).strict(),
  flag_uncertainty: z.object({ target_ref: z.string().min(1), question: z.string().min(1) }).strict(),
  clarification: z.object({ target_ref: z.string().min(1), question: z.string().min(1) }).strict(),
} satisfies Record<(typeof CANDIDATE_KINDS)[number], z.ZodTypeAny>;

const CandidateMutationEnvelopeV1 = z
  .discriminatedUnion(
    'kind',
    CANDIDATE_KINDS.map((kind) =>
      z
        .object({
          envelope_version: z.literal(1),
          candidate_id: z.string().uuid(),
          kind: z.literal(kind),
          base_graph_hash: z.string().min(1), // null/absent FORBIDDEN — stale gate needs it
          payload: PayloadByKind[kind],
          provenance: ProvenanceSchema,
          identity: IdentitySchema,
        })
        .strict(),
    ) as never,
  );

// ---------------------------------------------------------------------------
// Fixtures — one VALID example per kind (contract §6.1)
// ---------------------------------------------------------------------------

const BASE = {
  envelope_version: 1,
  candidate_id: '7d9f3f6a-9d2c-4b6e-9f2a-1c0d2e3f4a5b',
  base_graph_hash: 'aag-1f2e3d4c',
  provenance: {
    source: 'dual_model_m2',
    evidence_pointer: 'brief: “retention depends on onboarding quality”',
  },
  identity: { scenario_id: 'scn-1', turn_id: 'turn-3' },
} as const;

const VALID_BY_KIND: Record<(typeof CANDIDATE_KINDS)[number], unknown> = {
  add_node: { ...BASE, kind: 'add_node', payload: { node: { id: 'n-risk-1', label: 'Churn risk' } } },
  add_edge: { ...BASE, kind: 'add_edge', payload: { edge: { from: 'n-1', to: 'n-2' } } },
  update_node_field: {
    ...BASE,
    kind: 'update_node_field',
    payload: { node_id: 'n-1', field: 'label', from: 'Old', to: 'New' },
  },
  update_edge_field: {
    ...BASE,
    kind: 'update_edge_field',
    payload: { edge_id: 'e-1', field: 'strength', from: 'weak', to: 'strong' },
  },
  rename_node: { ...BASE, kind: 'rename_node', payload: { node_id: 'n-1', from_label: 'A', to_label: 'B' } },
  add_option: { ...BASE, kind: 'add_option', payload: { option: { id: 'opt-3', label: 'Hybrid' } } },
  remove_node: { ...BASE, kind: 'remove_node', payload: { id: 'n-9', reason: 'duplicate of n-2' } },
  remove_edge: { ...BASE, kind: 'remove_edge', payload: { id: 'e-9', reason: 'no causal support' } },
  flag_uncertainty: {
    ...BASE,
    kind: 'flag_uncertainty',
    payload: { target_ref: 'n-2', question: 'Is this factor within our control?' },
  },
  clarification: {
    ...BASE,
    kind: 'clarification',
    payload: { target_ref: 'e-1', question: 'Which direction does this influence run?' },
  },
};

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

describe('T4.0 candidate mutation envelope v1 — executable spec', () => {
  describe('accepts one valid example per kind (contract §6.1)', () => {
    for (const kind of CANDIDATE_KINDS) {
      it(`parses a valid ${kind} envelope`, () => {
        const result = CandidateMutationEnvelopeV1.safeParse(VALID_BY_KIND[kind]);
        expect(result.success).toBe(true);
      });
    }
  });

  describe('fail-closed rejections (contract R1)', () => {
    it('rejects an unknown envelope_version', () => {
      const bad = { ...(VALID_BY_KIND.rename_node as object), envelope_version: 2 };
      expect(CandidateMutationEnvelopeV1.safeParse(bad).success).toBe(false);
    });

    it('rejects an unknown kind (closed discriminator)', () => {
      const bad = { ...(VALID_BY_KIND.rename_node as object), kind: 'set_factor_weight' };
      expect(CandidateMutationEnvelopeV1.safeParse(bad).success).toBe(false);
    });

    it('rejects extra top-level fields (model-invented fields)', () => {
      const bad = { ...(VALID_BY_KIND.rename_node as object), confidence: 0.9 };
      expect(CandidateMutationEnvelopeV1.safeParse(bad).success).toBe(false);
    });

    it('rejects extra payload fields (strict per-kind payloads)', () => {
      const valid = VALID_BY_KIND.rename_node as { payload: object };
      const bad = { ...valid, payload: { ...valid.payload, elasticity: 0.4 } };
      expect(CandidateMutationEnvelopeV1.safeParse(bad).success).toBe(false);
    });

    it('rejects a missing provenance block', () => {
      const { provenance: _drop, ...bad } = VALID_BY_KIND.add_node as { provenance: unknown };
      expect(CandidateMutationEnvelopeV1.safeParse(bad).success).toBe(false);
    });

    it('rejects an empty evidence_pointer (dual-draft rule: evidence is mandatory)', () => {
      const valid = VALID_BY_KIND.add_node as { provenance: object };
      const bad = { ...valid, provenance: { ...valid.provenance, evidence_pointer: '' } };
      expect(CandidateMutationEnvelopeV1.safeParse(bad).success).toBe(false);
    });

    it('rejects a missing base_graph_hash (stale gate is non-optional)', () => {
      const { base_graph_hash: _drop, ...bad } = VALID_BY_KIND.add_edge as { base_graph_hash: unknown };
      expect(CandidateMutationEnvelopeV1.safeParse(bad).success).toBe(false);
    });

    it('rejects a null base_graph_hash', () => {
      const bad = { ...(VALID_BY_KIND.add_edge as object), base_graph_hash: null };
      expect(CandidateMutationEnvelopeV1.safeParse(bad).success).toBe(false);
    });
  });

  describe('isolation guard (contract §0 — off-path until T4 opens)', () => {
    it('this spec imports nothing from src/ (fail-closed against premature wiring)', async () => {
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(new URL(import.meta.url), 'utf-8');
      const importLines = source.split('\n').filter((l) => /^\s*import\s/.test(l));
      for (const line of importLines) {
        expect(line).not.toMatch(/from\s+['"][^'"]*(src\/|\.\.\/\.\.\/src)/);
      }
    });
  });
});
