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
import { PROPOSAL_TYPES } from './proposals.js';
import { ALLOWED_NODE_DELTA_FIELDS, ALLOWED_EDGE_DELTA_FIELDS, PROPOSAL_FIELD_CAPS } from './guards.js';

// Size caps mirrored from the single source of truth (guards.PROPOSAL_FIELD_CAPS)
// so the model-facing fence and the merge enforcement cannot drift. This schema
// is a FIRST FENCE only — the deterministic merge re-checks the same caps via
// findOversizedProposalField and is the authoritative gate (a model may ignore
// maxLength). Lockstep asserted by __tests__/serialise-and-schema.test.ts.
const NODE_DELTA_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['id', 'kind', 'label'],
  properties: {
    id: {
      type: 'string',
      maxLength: PROPOSAL_FIELD_CAPS.node_id,
      description: 'Canonical node id: lowercase alphanumeric, underscores, colons, hyphens.',
    },
    kind: { type: 'string', enum: ['option', 'risk', 'factor'] },
    label: { type: 'string', maxLength: PROPOSAL_FIELD_CAPS.label },
    description: { type: 'string', maxLength: PROPOSAL_FIELD_CAPS.description },
    category: { type: 'string', enum: ['controllable', 'observable', 'external'] },
    uncertainty_drivers: {
      type: 'array',
      // No maxItems: the structured-outputs compiler rejects it (see
      // UNSUPPORTED_KEYWORDS); the cap is enforced by findOversizedProposalField.
      items: { type: 'string', maxLength: PROPOSAL_FIELD_CAPS.uncertainty_driver_length },
    },
  },
} as const;

// Numeric bounds live in `description` hints only: the Anthropic structured-
// outputs compiler REJECTS `minimum`/`maximum`/`exclusiveMinimum` on numbers
// with a 400 — and the adapter passes this schema through verbatim. The keyword
// policy and its live-probe evidence live in UNSUPPORTED_KEYWORDS /
// ACCEPTED_KEYWORDS (src/adapters/llm/anthropic-schema-compliance.ts).
// Enforcement is unchanged: checkEdgeNumericSanity (G10) rejects out-of-bounds
// values in the deterministic merge, which is the authoritative gate.
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
        mean: { type: 'number', description: 'Effect strength in [-1, 1]; sign must match effect_direction.' },
        std: { type: 'number', description: 'Strength uncertainty; > 0 and <= max(0.5, 2*|mean|).' },
      },
    },
    exists_probability: { type: 'number', description: 'Probability the connection exists, in [0, 1].' },
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
      // No maxItems (API-rejected; see EDGE_DELTA_SCHEMA note). The cap is
      // enforced deterministically: G5 (merge.ts) rejects proposals at index
      // >= PROPOSAL_CAP, and the prompt instructs 0-8.
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
              question: { type: 'string', maxLength: PROPOSAL_FIELD_CAPS.question },
            },
          },
          evidence_pointer: { type: 'string', minLength: 1, maxLength: PROPOSAL_FIELD_CAPS.evidence_pointer },
          rationale: { type: 'string', maxLength: PROPOSAL_FIELD_CAPS.rationale },
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
