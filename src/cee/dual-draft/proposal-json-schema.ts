/**
 * Anthropic structured-outputs JSON schema for the M2 review call
 * (analogue of src/cee/draft/anthropic-graph-schema.ts).
 *
 * Wire shape: { "proposals": ProposalEnvelope[] } — structured outputs
 * require an object root. Every object is closed (additionalProperties:
 * false, an API requirement) which makes this schema deliberately STRICTER
 * than the zod ProposalEnvelope (whose delta.node/edge stay `unknown`):
 * the node/edge property sets are exactly the G10 guard allowlists, so the
 * API layer physically prevents M2 from emitting value-bearing fields
 * (thresholds, priors, interventions, …). The deterministic merge still
 * re-validates everything against the REAL NodeV3/EdgeV3 schemas + guards —
 * this schema is a first fence, not the enforcement point.
 *
 * Structural agreement with the zod contract and guard allowlists is pinned
 * by __tests__/serialise-and-schema.test.ts.
 */
import { PROPOSAL_TYPES, PROPOSAL_CAP } from './proposals.js';
import { ALLOWED_NODE_DELTA_FIELDS, ALLOWED_EDGE_DELTA_FIELDS } from './guards.js';

const NODE_DELTA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'label'],
  properties: {
    id: {
      type: 'string',
      description: 'Canonical node id: lowercase alphanumeric, underscores, colons, hyphens.',
    },
    kind: { type: 'string', enum: ['option', 'risk', 'factor'] },
    label: { type: 'string' },
    description: { type: 'string' },
    category: { type: 'string', enum: ['controllable', 'observable', 'external'] },
    uncertainty_drivers: { type: 'array', items: { type: 'string' } },
  },
} as const;

const EDGE_DELTA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to', 'strength', 'exists_probability', 'effect_direction'],
  properties: {
    from: { type: 'string' },
    to: { type: 'string' },
    strength: {
      type: 'object',
      additionalProperties: false,
      required: ['mean', 'std'],
      properties: {
        mean: { type: 'number', minimum: -1, maximum: 1 },
        std: { type: 'number', exclusiveMinimum: 0 },
      },
    },
    exists_probability: { type: 'number', minimum: 0, maximum: 1 },
    effect_direction: { type: 'string', enum: ['positive', 'negative'] },
  },
} as const;

// Typed as Record<string, unknown> (the ChatArgs.outputSchema shape) rather
// than `as const` so consumers need no cast — the inner NODE/EDGE_DELTA_SCHEMA
// keep `as const` for the compile-time lockstep guards below, which read those
// consts, not this export.
export const PROPOSALS_JSON_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  required: ['proposals'],
  properties: {
    proposals: {
      type: 'array',
      maxItems: PROPOSAL_CAP,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['type', 'delta', 'evidence_pointer'],
        properties: {
          type: { type: 'string', enum: [...PROPOSAL_TYPES] },
          delta: {
            type: 'object',
            additionalProperties: false,
            properties: {
              node: NODE_DELTA_SCHEMA,
              edge: EDGE_DELTA_SCHEMA,
              question: { type: 'string' },
            },
          },
          evidence_pointer: { type: 'string', minLength: 1 },
          rationale: { type: 'string' },
        },
      },
    },
  },
};

// Compile-time drift guards: the schema property sets must stay in lockstep
// with the guard allowlists (also asserted at runtime by the test suite).
type NodeSchemaKeys = keyof typeof NODE_DELTA_SCHEMA.properties;
type EdgeSchemaKeys = keyof typeof EDGE_DELTA_SCHEMA.properties;
type _AssertNode = NodeSchemaKeys extends (typeof ALLOWED_NODE_DELTA_FIELDS)[number]
  ? ((typeof ALLOWED_NODE_DELTA_FIELDS)[number] extends NodeSchemaKeys ? true : never)
  : never;
type _AssertEdge = EdgeSchemaKeys extends (typeof ALLOWED_EDGE_DELTA_FIELDS)[number]
  ? ((typeof ALLOWED_EDGE_DELTA_FIELDS)[number] extends EdgeSchemaKeys ? true : never)
  : never;
const _nodeFieldsInLockstep: _AssertNode = true;
const _edgeFieldsInLockstep: _AssertEdge = true;
void _nodeFieldsInLockstep;
void _edgeFieldsInLockstep;
