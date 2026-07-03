/**
 * Phase 2 tests (RED-first): compact graph serialisation for the M2 prompt +
 * structural agreement between the structured-outputs JSON schema and the
 * ProposalEnvelope zod contract / guard allowlists.
 *
 * No JSON-schema validator dependency exists in the repo, so agreement is
 * asserted structurally: closed objects everywhere, property sets exactly
 * matching the guard allowlists, enum matching PROPOSAL_TYPES, maxItems
 * matching PROPOSAL_CAP. The JSON schema is deliberately STRICTER than the
 * zod envelope (which leaves delta.node/edge unknown for the merge to
 * validate) — schema-accepted output must always parse through the envelope.
 */
import { describe, it, expect } from 'vitest';
import type { GraphV3T } from '../../../schemas/cee-v3.js';
import { serialiseGraphForReview } from '../serialise-graph-for-review.js';
import { PROPOSALS_JSON_SCHEMA } from '../proposal-json-schema.js';
import { ProposalEnvelope, PROPOSAL_TYPES, PROPOSAL_CAP } from '../proposals.js';
import {
  ALLOWED_NODE_DELTA_FIELDS,
  ALLOWED_EDGE_DELTA_FIELDS,
  PROPOSAL_FIELD_CAPS,
} from '../guards.js';

const GRAPH: GraphV3T = {
  nodes: [
    { id: 'goal_revenue', kind: 'goal', label: 'Revenue' },
    { id: 'opt_launch', kind: 'option', label: 'Launch now', interventions: { fac_price: 0.8 } },
    { id: 'fac_price', kind: 'factor', label: 'Price point' },
    { id: 'risk_churn', kind: 'risk', label: 'Customer churn' },
  ],
  edges: [
    {
      from: 'fac_price',
      to: 'goal_revenue',
      strength: { mean: 0.6, std: 0.1 },
      exists_probability: 0.9,
      effect_direction: 'positive',
    },
  ],
} as GraphV3T;

describe('serialiseGraphForReview', () => {
  it('includes every node id, kind and label', () => {
    const s = serialiseGraphForReview(GRAPH);
    for (const n of GRAPH.nodes) {
      expect(s).toContain(n.id);
      expect(s).toContain(n.kind);
      expect(s).toContain(n.label);
    }
  });

  it('includes edge endpoints and strength parameters', () => {
    const s = serialiseGraphForReview(GRAPH);
    expect(s).toContain('fac_price');
    expect(s).toContain('goal_revenue');
    expect(s).toContain('0.6');
    expect(s).toContain('0.1');
    expect(s).toContain('0.9');
  });

  it('is deterministic', () => {
    expect(serialiseGraphForReview(GRAPH)).toBe(serialiseGraphForReview(structuredClone(GRAPH)));
  });

  it('is much smaller than the pretty-printed JSON dump', () => {
    const s = serialiseGraphForReview(GRAPH);
    expect(s.length).toBeLessThan(JSON.stringify(GRAPH, null, 2).length);
  });

  it('does not leak value-bearing node internals (interventions payload)', () => {
    const s = serialiseGraphForReview(GRAPH);
    expect(s).not.toContain('interventions');
  });
});

type JsonSchema = {
  type?: string;
  additionalProperties?: boolean;
  properties?: Record<string, JsonSchema>;
  items?: JsonSchema;
  required?: string[];
  enum?: string[];
  maxItems?: number;
  maxLength?: number;
  minLength?: number;
};

function collectObjectSchemas(schema: JsonSchema, acc: JsonSchema[] = []): JsonSchema[] {
  if (schema.type === 'object') acc.push(schema);
  for (const sub of Object.values(schema.properties ?? {})) collectObjectSchemas(sub, acc);
  if (schema.items) collectObjectSchemas(schema.items, acc);
  return acc;
}

describe('PROPOSALS_JSON_SCHEMA — structural agreement with the contract', () => {
  const root = PROPOSALS_JSON_SCHEMA as unknown as JsonSchema;
  const proposals = root.properties!.proposals;
  const envelope = proposals.items!;
  const delta = envelope.properties!.delta;

  it('root is a closed object requiring exactly `proposals`', () => {
    expect(root.type).toBe('object');
    expect(root.additionalProperties).toBe(false);
    expect(root.required).toEqual(['proposals']);
  });

  it('every object in the schema is closed (additionalProperties: false)', () => {
    for (const obj of collectObjectSchemas(root)) {
      expect(obj.additionalProperties).toBe(false);
    }
  });

  it('caps the proposal list at PROPOSAL_CAP', () => {
    expect(proposals.maxItems).toBe(PROPOSAL_CAP);
  });

  it('type enum matches PROPOSAL_TYPES exactly', () => {
    expect(envelope.properties!.type.enum).toEqual([...PROPOSAL_TYPES]);
  });

  it('envelope requires type, delta and evidence_pointer (matching the zod contract)', () => {
    expect(envelope.required).toEqual(expect.arrayContaining(['type', 'delta', 'evidence_pointer']));
  });

  it('delta.node properties are exactly the guard node allowlist (G10 enforced at the API layer)', () => {
    const nodeProps = Object.keys(delta.properties!.node.properties!);
    expect(nodeProps.sort()).toEqual([...ALLOWED_NODE_DELTA_FIELDS].sort());
  });

  it('delta.edge properties are exactly the guard edge allowlist', () => {
    const edgeProps = Object.keys(delta.properties!.edge.properties!);
    expect(edgeProps.sort()).toEqual([...ALLOWED_EDGE_DELTA_FIELDS].sort());
  });

  it('size caps mirror PROPOSAL_FIELD_CAPS exactly (first fence == merge enforcement)', () => {
    const node = delta.properties!.node.properties!;
    expect(node.id.maxLength).toBe(PROPOSAL_FIELD_CAPS.node_id);
    expect(node.label.maxLength).toBe(PROPOSAL_FIELD_CAPS.label);
    expect(node.description.maxLength).toBe(PROPOSAL_FIELD_CAPS.description);
    expect(node.uncertainty_drivers.maxItems).toBe(PROPOSAL_FIELD_CAPS.uncertainty_drivers_items);
    expect(node.uncertainty_drivers.items!.maxLength).toBe(PROPOSAL_FIELD_CAPS.uncertainty_driver_length);
    expect(delta.properties!.question.maxLength).toBe(PROPOSAL_FIELD_CAPS.question);
    expect(envelope.properties!.evidence_pointer.minLength).toBe(1);
    expect(envelope.properties!.evidence_pointer.maxLength).toBe(PROPOSAL_FIELD_CAPS.evidence_pointer);
    expect(envelope.properties!.rationale.maxLength).toBe(PROPOSAL_FIELD_CAPS.rationale);
  });

  it('schema-shaped proposals parse through the zod envelope (agreement fixtures)', () => {
    const fixtures = [
      {
        type: 'added_risk',
        delta: { node: { id: 'risk_x', kind: 'risk', label: 'X' } },
        evidence_pointer: 'e',
      },
      {
        type: 'added_causal_link',
        delta: {
          edge: {
            from: 'a',
            to: 'b',
            strength: { mean: 0.2, std: 0.1 },
            exists_probability: 0.5,
            effect_direction: 'positive',
          },
        },
        evidence_pointer: 'e',
        rationale: 'r',
      },
      { type: 'added_evidence_gap', delta: { question: 'q' }, evidence_pointer: 'e' },
    ];
    for (const f of fixtures) {
      expect(ProposalEnvelope.safeParse(f).success).toBe(true);
    }
  });
});
