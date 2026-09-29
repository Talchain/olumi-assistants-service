/**
 * ProposalEnvelope contract tests (ported bake-off arm-C schema).
 *
 * Locks the M2 output envelope: the seven proposal types, the required
 * non-empty evidence_pointer, and the deliberate `delta.node`/`delta.edge`
 * = unknown boundary (real NodeV3/EdgeV3 validation happens in the Phase-3
 * merge, never here). Provenance: tools/bakeoff-v6/src/merge/proposals.ts
 * @ 5af022c87 (sha256 e13e3956…), see proposals.ts header.
 */
import { describe, it, expect } from 'vitest';
import {
  ProposalEnvelope,
  MUTATING_PROPOSAL_TYPES,
  ARTIFACT_PROPOSAL_TYPES,
  PROPOSAL_TYPES,
  isArtifactType,
  PROPOSAL_CAP,
} from '../proposals.js';

describe('ProposalEnvelope — acceptance', () => {
  it('accepts a mutating proposal with a node delta + evidence_pointer', () => {
    const p = {
      type: 'added_risk',
      delta: { node: { id: 'r_reg', kind: 'risk', label: 'Regulatory delay' } },
      evidence_pointer: 'brief: regulatory approval mentioned',
    };
    expect(ProposalEnvelope.safeParse(p).success).toBe(true);
  });

  it('accepts an artifact proposal with a question delta and no node/edge', () => {
    const p = {
      type: 'added_evidence_gap',
      delta: { question: 'What is the current churn baseline?' },
      evidence_pointer: 'draft: fac_churn present but unquantified',
    };
    expect(ProposalEnvelope.safeParse(p).success).toBe(true);
  });

  it('accepts an optional rationale', () => {
    const p = {
      type: 'uncertainty_flag',
      delta: { question: 'Is the market-size prior supported?' },
      evidence_pointer: 'draft: fac_market',
      rationale: 'The prior looks like a default, not a grounded estimate.',
    };
    expect(ProposalEnvelope.safeParse(p).success).toBe(true);
  });

  it('leaves delta.node/delta.edge as unknown — envelope does not validate graph shape', () => {
    // Garbage node still parses at the envelope layer; real NodeV3 validation
    // is deferred to the deterministic merge (Phase 3).
    const p = {
      type: 'added_option',
      delta: { node: { total: 'garbage', not: 'a node' } },
      evidence_pointer: 'x',
    };
    expect(ProposalEnvelope.safeParse(p).success).toBe(true);
  });
});

describe('ProposalEnvelope — rejection', () => {
  it('rejects an unknown proposal type', () => {
    const p = { type: 'added_llm_hallucination', delta: {}, evidence_pointer: 'x' };
    expect(ProposalEnvelope.safeParse(p).success).toBe(false);
  });

  it('rejects a missing evidence_pointer', () => {
    const p = { type: 'added_risk', delta: { node: { id: 'r1' } } };
    expect(ProposalEnvelope.safeParse(p).success).toBe(false);
  });

  it('rejects an empty evidence_pointer', () => {
    const p = { type: 'added_risk', delta: { node: { id: 'r1' } }, evidence_pointer: '' };
    expect(ProposalEnvelope.safeParse(p).success).toBe(false);
  });

  it('rejects a non-string question', () => {
    const p = { type: 'added_evidence_gap', delta: { question: 42 }, evidence_pointer: 'x' };
    expect(ProposalEnvelope.safeParse(p).success).toBe(false);
  });

  it('rejects a missing delta', () => {
    const p = { type: 'added_risk', evidence_pointer: 'x' };
    expect(ProposalEnvelope.safeParse(p).success).toBe(false);
  });
});

describe('proposal type taxonomy', () => {
  it('PROPOSAL_TYPES is exactly mutating ++ artifact, with no overlap', () => {
    expect([...PROPOSAL_TYPES]).toEqual([...MUTATING_PROPOSAL_TYPES, ...ARTIFACT_PROPOSAL_TYPES]);
    const overlap = MUTATING_PROPOSAL_TYPES.filter((t) =>
      (ARTIFACT_PROPOSAL_TYPES as readonly string[]).includes(t),
    );
    expect(overlap).toEqual([]);
  });

  it('isArtifactType classifies artifact vs mutating vs unknown types', () => {
    expect(isArtifactType('added_evidence_gap')).toBe(true);
    expect(isArtifactType('clarification_proposal')).toBe(true);
    expect(isArtifactType('added_risk')).toBe(false);
    expect(isArtifactType('added_causal_link')).toBe(false);
    expect(isArtifactType('nonsense')).toBe(false);
  });

  it('PROPOSAL_CAP is a positive integer bound', () => {
    expect(Number.isInteger(PROPOSAL_CAP)).toBe(true);
    expect(PROPOSAL_CAP).toBeGreaterThan(0);
  });
});
