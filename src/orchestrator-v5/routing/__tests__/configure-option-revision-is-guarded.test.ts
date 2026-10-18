/**
 * Configure-option intent detector, on a revision to an already-configured
 * option (the captured wrong-entity-write turn).
 *
 * The outcome guard this file once specified (`configure-option-outcome.ts`)
 * had no production importer and was deleted (O2 orphan deletion), together
 * with the check that only mutated a test-local clone of the fixture. What
 * stays runs kept code: the detector recognises the revision message while the
 * named option already carries an effect value.
 */
import { describe, expect, it } from 'vitest';
import { detectConfigureOptionIntent, projectOptionLabels } from '../configure-option-intent.js';
import { WRONG_ENTITY_WRITE_CAPTURE } from './wrong-entity-write-capture.fixture.js';

const CAPTURE = WRONG_ENTITY_WRITE_CAPTURE;
const {
  option_id: OPTION_ID,
  factor_id: FACTOR_ID,
  turn_message: MESSAGE,
} = CAPTURE.provenance;

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

function optionInterventionValue(graph: unknown, optionId: string, factorId: string): unknown {
  const node = (graph as Graph).nodes.find((n) => n.id === optionId);
  const bundle = node?.interventions as Record<string, { value?: unknown }> | undefined;
  return bundle?.[factorId]?.value;
}

describe('configure-option intent detector — a revision to an already-configured option', () => {
  it('recognises the revision message while the named option already carries a value', () => {
    // Fixture precondition: the named option is already configured, so the
    // message is a revision, not a first configuration.
    expect(optionInterventionValue(CAPTURE.before, OPTION_ID, FACTOR_ID)).toBe(0.49);
    expect(detectConfigureOptionIntent(
      MESSAGE,
      projectOptionLabels(CAPTURE.before.nodes as never),
    ).matched).toBe(true);
  });
});
