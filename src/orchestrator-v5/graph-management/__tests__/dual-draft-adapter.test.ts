/**
 * Track 3 — Slice 5: dual-model → typed-mutation adapter.
 *
 * The real dual-draft `ProposalEnvelopeT` is imported TYPE-ONLY here to prove
 * structural compatibility with the production adapter's local mirror (enforced by
 * `pnpm typecheck`; the production adapter itself imports nothing from src/cee).
 */
import { describe, it, expect } from 'vitest';
import type { ProposalEnvelopeT } from '../../../cee/dual-draft/proposals.js';
import {
  DUAL_DRAFT_PROPOSAL_TYPES,
  mapProposalType,
  dualDraftToCandidateEnvelope,
  type DualDraftProposal,
  type DualDraftProposalType,
} from '../adapters/dual-draft.js';
import { parseEnvelope } from '../parse-envelope.js';
import { refereeMutation } from '../referee.js';
import { ADD_OPTION_APPLY_UNWIRED } from '../reason-codes.js';
import { buildReadyGraph, frameFor, hashOf } from './fixtures.js';
import type { CandidateKind } from '../types.js';

const CTX = { candidate_id: '11111111-1111-4111-8111-111111111111', base_graph_hash: 'h', scenario_id: 'scn', turn_id: 't1' };

// TYPE-LEVEL compat: the REAL producer envelope must be assignable to the local mirror.
// (Verified by `pnpm typecheck`; a no-op at runtime.)
const _compat = (real: ProposalEnvelopeT): DualDraftProposal => real;
void _compat;

describe('dual-draft adapter — exhaustive kind mapping', () => {
  const expected: Record<DualDraftProposalType, CandidateKind> = {
    added_option: 'add_option',
    added_risk: 'add_node',
    added_assumption: 'add_node',
    added_evidence_gap: 'add_node',
    added_causal_link: 'add_edge',
    uncertainty_flag: 'flag_uncertainty',
    clarification_proposal: 'clarification',
  };
  for (const t of DUAL_DRAFT_PROPOSAL_TYPES) {
    it(`${t} → ${expected[t]}`, () => {
      expect(mapProposalType(t)).toBe(expected[t]);
    });
  }
});

describe('dual-draft adapter — producer projection passes R1 for well-formed deltas', () => {
  const cases: Array<{ p: DualDraftProposal; kind: CandidateKind }> = [
    { p: { type: 'added_option', delta: { node: { id: 'o-c', label: 'Plan C' } }, evidence_pointer: 'brief:1' }, kind: 'add_option' },
    { p: { type: 'added_risk', delta: { node: { id: 'r-1', kind: 'risk', label: 'Risk' } }, evidence_pointer: 'brief:1' }, kind: 'add_node' },
    { p: { type: 'added_assumption', delta: { node: { id: 'a-1', kind: 'factor', label: 'Assumption' } }, evidence_pointer: 'brief:1' }, kind: 'add_node' },
    { p: { type: 'added_evidence_gap', delta: { node: { id: 'e-1', kind: 'factor', label: 'Gap' } }, evidence_pointer: 'brief:1' }, kind: 'add_node' },
    { p: { type: 'added_causal_link', delta: { edge: { from: 'f-spend', to: 'g-profit' } }, evidence_pointer: 'brief:1' }, kind: 'add_edge' },
    { p: { type: 'uncertainty_flag', delta: { node: { id: 'f-spend' }, question: 'Is this current?' }, evidence_pointer: 'brief:1' }, kind: 'flag_uncertainty' },
    { p: { type: 'clarification_proposal', delta: { node: { id: 'o-a' }, question: 'Which market?' }, evidence_pointer: 'brief:1' }, kind: 'clarification' },
  ];
  for (const c of cases) {
    it(`${c.p.type} projects to a valid ${c.kind} envelope (R1 ok)`, () => {
      const env = dualDraftToCandidateEnvelope(c.p, CTX);
      expect((env as { kind: string }).kind).toBe(c.kind);
      const r = parseEnvelope(env);
      expect(r.ok, JSON.stringify(r)).toBe(true);
    });
  }
});

describe('dual-draft adapter — fail-closed + end-to-end', () => {
  it('a malformed delta is REJECTED by R1 (adapter never asserts validity)', () => {
    const bad: DualDraftProposal = { type: 'added_causal_link', delta: { edge: {} }, evidence_pointer: 'brief:1' };
    const r = parseEnvelope(dualDraftToCandidateEnvelope(bad, CTX));
    expect(r.ok).toBe(false); // empty from/to fail the strict edge payload
  });

  it('added_assumption WITHOUT delta.node.kind is REJECTED by R1 (never silently mislabelled as risk)', () => {
    const p: DualDraftProposal = { type: 'added_assumption', delta: { node: { id: 'a-1', label: 'Assumption' } }, evidence_pointer: 'brief:1' };
    const env = dualDraftToCandidateEnvelope(p, CTX);
    // kind is left undefined (no blanket 'risk' default) → R1 rejects.
    expect(((env as { payload: { node: { kind?: unknown } } }).payload.node.kind)).toBeUndefined();
    expect(parseEnvelope(env).ok).toBe(false);
  });

  it('added_risk WITHOUT delta.node.kind defaults to a valid `risk` node (its canonical kind)', () => {
    const p: DualDraftProposal = { type: 'added_risk', delta: { node: { id: 'r-1', label: 'Risk' } }, evidence_pointer: 'brief:1' };
    const env = dualDraftToCandidateEnvelope(p, CTX);
    expect(((env as { payload: { node: { kind?: unknown } } }).payload.node.kind)).toBe('risk');
    expect(parseEnvelope(env).ok).toBe(true);
  });

  it('end-to-end: added_option → referee → held ADD_OPTION_APPLY_UNWIRED (nodes-only graph)', () => {
    const graph = buildReadyGraph();
    const proposal: DualDraftProposal = {
      type: 'added_option',
      delta: { node: { id: 'o-c', label: 'Plan C' } },
      evidence_pointer: 'brief:2',
      rationale: 'a third plan',
    };
    const env = dualDraftToCandidateEnvelope(proposal, { ...CTX, base_graph_hash: hashOf(graph) });
    const v = refereeMutation(env, graph, frameFor(graph));
    expect(v.verdict).toBe('held');
    expect(v.blocker?.code).toBe(ADD_OPTION_APPLY_UNWIRED);
  });

  it('preserves provenance.source = dual_model_m2 and evidence_pointer', () => {
    const env = dualDraftToCandidateEnvelope(
      { type: 'added_risk', delta: { node: { id: 'r-9', kind: 'risk', label: 'R' } }, evidence_pointer: 'brief:9', rationale: 'why' },
      { ...CTX, model_id: 'claude-opus-4-8' },
    );
    const prov = (env as { provenance: Record<string, unknown> }).provenance;
    expect(prov.source).toBe('dual_model_m2');
    expect(prov.evidence_pointer).toBe('brief:9');
    expect(prov.model_id).toBe('claude-opus-4-8');
  });
});
