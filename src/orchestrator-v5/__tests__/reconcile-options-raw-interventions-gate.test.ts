/**
 * THE SECOND STALE FIELD — `raw_interventions`, bound to the LIVE consumer.
 *
 * WHY THIS FILE EXISTS SEPARATELY. The propagation suite's fixtures were
 * hand-written and carried ZERO `raw_interventions` — the corpus shared the
 * code's blind spot, which is exactly how a fix can be correct, measured, and
 * still leave the user blocked. Everything here is bound to producer artefacts
 * rather than to my model of them:
 *   · the fixture is validated by the PRODUCER'S OWN CONTRACT (`OptionV3`), so
 *     a shape drift REDs rather than silently passing;
 *   · the verdict comes from the LIVE consumer
 *     (`transformOptionToAnalysisReady`), not from a re-implementation of its
 *     status rule.
 *
 * THE DEFECT. `raw_interventions` is an OPTION-ENTRY-ONLY pre-encoding carrier;
 * the NODE never carries it. So propagating `interventions` cannot refresh it —
 * the only correct refresh is REMOVAL of the keys the node has now encoded.
 * Left stale, `analysis-ready.ts:129-139` carries it into the payload, a
 * non-numeric raw sets `hasNonNumericRaw`, `computeAnalysisReadyStatusWithReason`
 * returns `needs_encoding`, and `analysis-ready-helper.ts:919` mints
 * `OPTION_NEEDS_ENCODING` — re-asking the exact question the user just answered.
 *
 * MUTATION-CHECK (revert → RED): remove the `clearEncodedRawInterventions` call
 * in the propagate limb and `the live consumer calls the option ready` fails
 * with `needs_encoding`.
 */
import { describe, expect, it } from 'vitest';

import { OptionV3 } from '../../schemas/cee-v3.js';
import { transformOptionToAnalysisReady } from '../../cee/transforms/analysis-ready.js';
import { reconcileTopLevelOptionsFromNodes } from '../reconcile-top-level-options.js';

/**
 * The shape the live categorical extractor emits
 * (`cee/extraction/intervention-extractor.ts:1008-1010` sets
 * `result.raw_interventions` on the OPTION), for the review's reproduction:
 * option "Migrate to HubSpot" against a factor labelled "Technology".
 */
function draftedEntryWithRawCarrier() {
  return {
    id: 'opt_hubspot',
    label: 'Migrate to HubSpot',
    status: 'needs_encoding',
    interventions: {},
    raw_interventions: { fac_technology: 'HubSpot' },
    provenance: { source: 'brief_extraction' },
  };
}

/** The user's answer, landed on the NODE by encode-option-interventions. */
function encodedOptionNode() {
  return {
    id: 'opt_hubspot',
    kind: 'option',
    label: 'Migrate to HubSpot',
    interventions: {
      fac_technology: {
        value: 0.75,
        source: 'user_specified',
        target_match: {
          node_id: 'fac_technology',
          match_type: 'exact_id',
          confidence: 'high',
        },
      },
    },
  };
}

function graphWithStaleRawCarrier() {
  return {
    nodes: [
      { id: 'goal', kind: 'goal', label: 'G' },
      { id: 'fac_technology', kind: 'factor', label: 'Technology' },
      encodedOptionNode(),
    ],
    edges: [{ from: 'opt_hubspot', to: 'fac_technology' }],
    options: [draftedEntryWithRawCarrier()],
  };
}

describe('raw_interventions — the second stale field on the same mirror entry', () => {
  it('FIXTURE CONFORMS to the live OptionV3 contract (so a shape drift REDs here, not silently)', () => {
    expect(() => OptionV3.parse(draftedEntryWithRawCarrier())).not.toThrow();
  });

  it('POSITIVE CONTROL: the stale carrier alone makes the LIVE consumer block', () => {
    // Reproduces the review's finding: propagating the encoded value is NOT
    // sufficient while this field survives. Proves the assertion below is a
    // real unblocking rather than a test that could never have failed.
    const blocked = transformOptionToAnalysisReady(
      OptionV3.parse(draftedEntryWithRawCarrier()),
      1,
    );
    expect(blocked.status).toBe('needs_encoding');
  });

  it('the LIVE consumer calls the option ready once the encoded key is cleared', () => {
    const out = reconcileTopLevelOptionsFromNodes(graphWithStaleRawCarrier());
    // BIND BY IDENTITY: (option_id, factor_id).
    const entry = out.options.find((o) => o.id === 'opt_hubspot');
    expect(entry).toBeDefined();

    // The encoded value propagated...
    const ivs = entry!.interventions as Record<string, { value: number }>;
    expect(ivs.fac_technology.value).toBe(0.75);
    // ...and the now-answered raw carrier is gone (field dropped when empty).
    expect(entry!.raw_interventions).toBeUndefined();

    // THE VERDICT COMES FROM THE LIVE CONSUMER, not from a restatement of its
    // rule — this is the assertion the whole gate turns on.
    const projected = transformOptionToAnalysisReady(OptionV3.parse(entry), 1);
    expect(projected.status).toBe('ready');
  });

  it('the cleared entry still satisfies the producer contract (no field left malformed)', () => {
    const out = reconcileTopLevelOptionsFromNodes(graphWithStaleRawCarrier());
    const entry = out.options.find((o) => o.id === 'opt_hubspot');
    expect(() => OptionV3.parse(entry)).not.toThrow();
  });

  it('THE DIGEST HALF, ISOLATED: clears the raw carrier even when interventions are ALREADY in sync', () => {
    // The load-bearing case for putting raw_interventions in the STALENESS
    // digest. Here `entry.interventions` already equals the node's, so the
    // interventions-only staleness test is FALSE — if the digest ignored
    // raw_interventions the pass would no-op BEFORE clearing, and the user
    // would stay blocked by a field that is provably answered. Every other
    // fixture in this file has stale interventions too, so none of them can
    // isolate this.
    const encoded = {
      value: 0.75,
      source: 'user_specified',
      target_match: {
        node_id: 'fac_technology',
        match_type: 'exact_id',
        confidence: 'high',
      },
    };
    const graph = {
      nodes: [
        { id: 'fac_technology', kind: 'factor', label: 'Technology' },
        {
          id: 'opt_hubspot',
          kind: 'option',
          label: 'Migrate to HubSpot',
          interventions: { fac_technology: { ...encoded } },
        },
      ],
      edges: [{ from: 'opt_hubspot', to: 'fac_technology' }],
      options: [
        {
          id: 'opt_hubspot',
          label: 'Migrate to HubSpot',
          status: 'needs_encoding',
          // ALREADY in sync with the node — only the raw carrier is stale.
          interventions: { fac_technology: { ...encoded } },
          raw_interventions: { fac_technology: 'HubSpot' },
        },
      ],
    };
    const out = reconcileTopLevelOptionsFromNodes(graph);
    const entry = out.options.find((o) => o.id === 'opt_hubspot');
    expect(entry!.raw_interventions).toBeUndefined();
    expect(transformOptionToAnalysisReady(OptionV3.parse(entry), 1).status).toBe('ready');
  });

  it('BYTE-IDENTICAL NO-OP: a graph with nothing left to clear returns the ORIGINAL reference', () => {
    // Idempotence by REFERENCE is what `projectGraphForPersistence` relies on;
    // it is why raw_interventions had to join the staleness digest rather than
    // be cleared unconditionally.
    const settled = reconcileTopLevelOptionsFromNodes(graphWithStaleRawCarrier());
    expect(reconcileTopLevelOptionsFromNodes(settled)).toBe(settled);
  });
});
