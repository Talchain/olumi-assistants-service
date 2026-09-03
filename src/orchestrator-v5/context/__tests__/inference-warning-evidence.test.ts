/**
 * The engine's warning channel, and the count floor it puts under the
 * defaulted-value disclosure.
 *
 * The live capture is read from the decision-review fixtures directory rather
 * than copied here ON PURPOSE. It is a HISTORIC RECORD of what one build
 * actually emitted (CLAUDE.md trap 14b); a second copy is a second thing to
 * drift, and the drift would be silent in the worst direction — two fixtures
 * disagreeing about what the producer shipped.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { readDefaultedRootEvidence } from '../inference-warning-evidence.js';
import {
  buildDefaultedAssumptionsDisclosure,
  readDefaultedAssumptionsFromEnrichment,
} from '../../coaching/pick-defaulted-assumptions.js';

const CAPTURE = JSON.parse(
  readFileSync(
    join(
      __dirname,
      '..',
      '..',
      '..',
      'cee',
      'decision-review',
      '__tests__',
      'fixtures',
      'live-decision-review-2026-09-03.json',
    ),
    'utf8',
  ),
) as { enrichment: Record<string, unknown> };

function capture(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(CAPTURE.enrichment)) as Record<string, unknown>;
}

describe('readDefaultedRootEvidence — the live capture', () => {
  it('finds three defaulted roots where the disclosure list named one', () => {
    const enrichment = capture();

    // The producer's OWN disclosure list, read the way the existing selector
    // reads it: ONE entry, and its factor_label is null.
    const disclosed = (
      (enrichment.decision_brief as Record<string, unknown>)
        .defaulted_assumptions as ReadonlyArray<Record<string, unknown>>
    );
    expect(disclosed).toHaveLength(1);
    expect(disclosed[0].factor_label).toBeNull();

    // The engine's own warning channel, in the same payload.
    const evidence = readDefaultedRootEvidence(enrichment);
    expect([...evidence.rootNodeIds].sort()).toEqual(['16ec3d64', '422ceee7', '7dc44ba7']);
    expect(evidence.unattributedCount).toBe(0);
    expect(evidence.defaultedRootFloor).toBe(3);
  });

  it('sees the goal-level data gap the disclosure never mentions', () => {
    expect(readDefaultedRootEvidence(capture()).goalAncestorDataGap).toBe(true);
  });

  it('reads BOTH warning arrays, which are not copies of each other', () => {
    // CONTRAST CONTROL for the two-source read. `inference_warnings` carries
    // the ROOT_NODE_DEFAULT_VALUE rows; `decision_brief.warnings` carries
    // none of them but does carry GOAL_ANCESTOR_DATA_GAP. A reader that took
    // only one array would silently under-report, and would look identical to
    // a reader that looked at both and found nothing.
    const enrichment = capture();
    const brief = enrichment.decision_brief as Record<string, unknown>;

    const inferenceOnly = readDefaultedRootEvidence({
      inference_warnings: enrichment.inference_warnings,
    });
    const briefOnly = readDefaultedRootEvidence({ decision_brief: brief });

    expect(inferenceOnly.defaultedRootFloor).toBe(3);
    expect(briefOnly.defaultedRootFloor).toBe(0);
    expect(briefOnly.goalAncestorDataGap).toBe(true);
  });
});

describe('readDefaultedRootEvidence — shape tolerance', () => {
  it('is total on unreadable input and claims nothing', () => {
    for (const bad of [null, undefined, 7, 'x', [], {}, { inference_warnings: 'no' }]) {
      const e = readDefaultedRootEvidence(bad);
      expect(e.defaultedRootFloor).toBe(0);
      expect(e.goalAncestorDataGap).toBe(false);
    }
  });

  it('counts a warning whose node id cannot be read, rather than dropping it', () => {
    const e = readDefaultedRootEvidence({
      inference_warnings: [
        { code: 'ROOT_NODE_DEFAULT_VALUE', field: 'nodes[a].observed_state.value' },
        { code: 'ROOT_NODE_DEFAULT_VALUE' },
        { code: 'ROOT_NODE_DEFAULT_VALUE', field: 'something_else' },
      ],
    });
    expect([...e.rootNodeIds]).toEqual(['a']);
    expect(e.unattributedCount).toBe(2);
    expect(e.defaultedRootFloor).toBe(3);
  });

  it('does not double-count the same node warned about twice', () => {
    const e = readDefaultedRootEvidence({
      inference_warnings: [
        { code: 'ROOT_NODE_DEFAULT_VALUE', field: 'nodes[a].observed_state.value' },
        { code: 'ROOT_NODE_DEFAULT_VALUE', field: 'nodes[a].observed_state.value' },
      ],
    });
    expect(e.defaultedRootFloor).toBe(1);
  });

  it('ignores every other warning code', () => {
    const e = readDefaultedRootEvidence({
      inference_warnings: [
        { code: 'ANCHORING_RISK' },
        { code: 'MARGINAL_SWITCH_TRUNCATED' },
        { code: 'EDGE_E_VALUE_NON_FINITE_DROPPED' },
      ],
    });
    expect(e.defaultedRootFloor).toBe(0);
    expect(e.goalAncestorDataGap).toBe(false);
  });

  it('never reads a node id out of the human-readable message', () => {
    // The message says "root node '16ec3d64'". Parsing prose the producer may
    // reword at will is how a reader goes silently blind after a copy change;
    // only the structured `field` is trusted.
    const e = readDefaultedRootEvidence({
      inference_warnings: [
        {
          code: 'ROOT_NODE_DEFAULT_VALUE',
          message: "No observed value provided for root node '16ec3d64'; defaulted to 0.0.",
        },
      ],
    });
    expect(e.rootNodeIds.size).toBe(0);
    expect(e.unattributedCount).toBe(1);
  });
});

describe('the disclosure count floor', () => {
  it('raises the live capture from "one of the factors" to three', () => {
    const signal = readDefaultedAssumptionsFromEnrichment(capture());
    expect(signal?.count).toBe(3);
    const sentence = buildDefaultedAssumptionsDisclosure(signal!);
    expect(sentence).toContain('3 of the factors in your model');
    // The sentence the founder actually saw on 2026-09-03.
    expect(sentence).not.toContain('one of the factors in your model');
  });

  it('leaves a disclosure alone when the producer already counted at least as high', () => {
    // The twin. Without it, "the floor raises the count" is satisfied by a
    // change that raises every count unconditionally.
    const signal = readDefaultedAssumptionsFromEnrichment({
      decision_brief: {
        defaulted_assumptions: [
          { factor_label: 'A' },
          { factor_label: 'B' },
          { factor_label: 'C' },
          { factor_label: 'D' },
        ],
      },
      inference_warnings: [
        { code: 'ROOT_NODE_DEFAULT_VALUE', field: 'nodes[a].observed_state.value' },
      ],
    });
    expect(signal?.count).toBe(4);
    expect(signal?.named).toEqual(['A', 'B', 'C']);
  });

  it('discloses at all when the producer listed nothing but warned anyway', () => {
    const signal = readDefaultedAssumptionsFromEnrichment({
      decision_brief: { defaulted_assumptions: [] },
      inference_warnings: [
        { code: 'ROOT_NODE_DEFAULT_VALUE', field: 'nodes[a].observed_state.value' },
        { code: 'ROOT_NODE_DEFAULT_VALUE', field: 'nodes[b].observed_state.value' },
      ],
    });
    expect(signal).toEqual({ count: 2, named: [] });
  });

  it('still returns null when neither channel has anything — unchanged behaviour', () => {
    expect(readDefaultedAssumptionsFromEnrichment({ decision_brief: {} })).toBeNull();
    expect(readDefaultedAssumptionsFromEnrichment({})).toBeNull();
    expect(readDefaultedAssumptionsFromEnrichment(null)).toBeNull();
  });

  it('does not name a raw node id at a user-facing surface', () => {
    // The warning channel carries ids, not labels. Trading an
    // under-disclosure for an id leak would be a worse bargain.
    const signal = readDefaultedAssumptionsFromEnrichment(capture());
    const sentence = buildDefaultedAssumptionsDisclosure(signal!);
    for (const id of ['16ec3d64', '422ceee7', '7dc44ba7']) {
      expect(sentence).not.toContain(id);
    }
  });
});
