/**
 * T4.0 — Candidate mutation envelope v1: EXECUTABLE SPEC.
 *
 * REPOINTED (ISSUE-9026, lane 8, 2026-07-07): this spec now asserts against
 * the SHARED module export — `CandidateMutationEnvelopeV1` from
 * src/orchestrator-v5/graph-management — instead of the pre-ratification
 * inline shape. The inline schema is RETIRED (both shapes must never stay
 * alive); the module schema is the single executable form of
 * `Docs/t4/dual-model-typed-mutation-handoff-contract.md` §1–§2.
 *
 * PARITY VERIFICATION (the deferred ISSUE-9026 check, reconciled
 * assertion-by-assertion — every delta below is a deliberate round-3
 * contract alignment where the RATIFIED module shape supersedes the
 * pre-ratification inline sketch; full log in
 * Docs/lanes/lane8-gm-mm-live-integration-evidence.md):
 *   1. add_node payload — inline permissive `{ node: record }` → module
 *      STRICT `{ node: { id, kind∈NodeKind, label } }`; fixture gains
 *      `kind: 'factor'` (strictness increased, fail-closed direction).
 *   2. add_option payload — inline `{ option: record }` → module strict
 *      option shape; fixture gains the REQUIRED `edges: []` array.
 *   3. update_edge_field — inline `{ edge_id, … }` → module names the edge
 *      by its endpoints `{ from_node, to_node, field, from, to }` (edges
 *      have no standalone id in GraphV3).
 *   4. remove_node — inline `{ id, reason }` → module `{ node_id, reason }`.
 *   5. remove_edge — inline `{ id, reason }` → module
 *      `{ from_node, to_node, reason }` (same endpoint-naming rationale).
 *   6. rename_node — inline REQUIRED `from_label` → module makes it
 *      OPTIONAL (`to_label` stays required); the fixture keeps supplying it,
 *      so the assertion body survives verbatim.
 *   All rejection assertions (unknown version / unknown kind / extra
 *   top-level fields / extra payload fields per kind / missing provenance /
 *   empty evidence_pointer / missing + null base_graph_hash) survive
 *   VERBATIM. The former "no imports from src/" isolation guard is RETIRED
 *   per the hook's own conversion instructions — importing the shared
 *   export is now the point (enforced by future-hooks-registry.test.ts).
 */
import { describe, expect, it } from 'vitest';

import {
  CANDIDATE_KINDS,
  CandidateMutationEnvelopeV1,
} from '../../../src/orchestrator-v5/graph-management/index.js';

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
  // Delta 1 (ratified strictness): node requires id + kind + label.
  add_node: {
    ...BASE,
    kind: 'add_node',
    payload: { node: { id: 'n-risk-1', kind: 'risk', label: 'Churn risk' } },
  },
  add_edge: { ...BASE, kind: 'add_edge', payload: { edge: { from: 'n-1', to: 'n-2' } } },
  update_node_field: {
    ...BASE,
    kind: 'update_node_field',
    payload: { node_id: 'n-1', field: 'label', from: 'Old', to: 'New' },
  },
  // Delta 3 (ratified naming): edges are addressed by endpoints, not edge_id.
  update_edge_field: {
    ...BASE,
    kind: 'update_edge_field',
    payload: { from_node: 'n-1', to_node: 'n-2', field: 'strength', from: 'weak', to: 'strong' },
  },
  // Delta 6: from_label is OPTIONAL in the ratified shape; supplying it stays valid.
  rename_node: { ...BASE, kind: 'rename_node', payload: { node_id: 'n-1', from_label: 'A', to_label: 'B' } },
  // Delta 2 (ratified strictness): option requires its edges[] linkage array.
  add_option: {
    ...BASE,
    kind: 'add_option',
    payload: { option: { id: 'opt-3', label: 'Hybrid', edges: [] } },
  },
  // Delta 4: node_id, not id.
  remove_node: { ...BASE, kind: 'remove_node', payload: { node_id: 'n-9', reason: 'duplicate of n-2' } },
  // Delta 5: endpoint naming, not id.
  remove_edge: {
    ...BASE,
    kind: 'remove_edge',
    payload: { from_node: 'n-1', to_node: 'n-9', reason: 'no causal support' },
  },
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

describe('T4.0 candidate mutation envelope v1 — executable spec (module export)', () => {
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

    // EVERY kind is exercised: a single sampled kind would let `.strict()`
    // silently drop from another kind's payload schema (review finding).
    for (const kind of CANDIDATE_KINDS) {
      it(`rejects extra payload fields on ${kind} (strict per-kind payloads)`, () => {
        const valid = VALID_BY_KIND[kind] as { payload: object };
        const bad = { ...valid, payload: { ...valid.payload, elasticity: 0.4 } };
        expect(CandidateMutationEnvelopeV1.safeParse(bad).success).toBe(false);
      });
    }

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
});
