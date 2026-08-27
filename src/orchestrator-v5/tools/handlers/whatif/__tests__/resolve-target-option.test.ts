/**
 * M1 — ingress: which option did the user NAME?
 *
 * Every case here is about identity discipline. The resolver may not guess, may
 * not fold two options into one label, and may not read a comparison question as
 * a targeted one.
 */
import { describe, it, expect } from 'vitest';

import {
  collectGraphOptionIdentities,
  resolveTargetOptionFromCanonicalContext,
  resolveTargetOptionFromMessage,
} from '../resolve-target-option.js';
import {
  selectContextGraphSnapshot,
  type ContextGraphSelection,
} from '../../../../context/context-graph-snapshot.js';
import type { TurnSelection } from '../../../../build-turn-context.js';

/** Production shape: options as a TOP-LEVEL array (staging fixture shape). */
const topLevelGraph = {
  nodes: [
    { id: 'fac_eng_capacity', kind: 'factor', label: 'Engineering Capacity' },
    { id: 'goal_1', kind: 'goal', label: 'Delivery Confidence' },
  ],
  options: [
    { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally' },
    { id: 'opt_offshore', label: 'Engage Offshore Partner' },
    { id: 'opt_status_quo', label: 'Maintain Current Team (Status Quo)' },
  ],
};

/** Canvas shape: options as option-kind NODES. */
const nodeGraph = {
  nodes: [
    { id: 'opt_hire_local', kind: 'option', label: 'Hire Two Senior Engineers Locally' },
    { id: 'opt_offshore', kind: 'option', label: 'Engage Offshore Partner' },
    { id: 'fac_eng_capacity', kind: 'factor', label: 'Engineering Capacity' },
  ],
};

describe('collectGraphOptionIdentities — both live graph shapes', () => {
  it('reads the top-level options[] array', () => {
    expect(collectGraphOptionIdentities(topLevelGraph)).toEqual([
      { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally' },
      { id: 'opt_offshore', label: 'Engage Offshore Partner' },
      { id: 'opt_status_quo', label: 'Maintain Current Team (Status Quo)' },
    ]);
  });

  it('reads option-KIND nodes, and does not mistake a factor for an option', () => {
    expect(collectGraphOptionIdentities(nodeGraph)).toEqual([
      { id: 'opt_hire_local', label: 'Hire Two Senior Engineers Locally' },
      { id: 'opt_offshore', label: 'Engage Offshore Partner' },
    ]);
  });

  it('tolerates the `option_id` spelling — BOTH are live in this estate', () => {
    // `OptionForAnalysis` declares `id`; the captured staging
    // `analysis_ready.options[]` carries `option_id`. Requiring one spelling
    // would silently read zero options off the other producer.
    expect(
      collectGraphOptionIdentities({ options: [{ option_id: 'opt_a', label: 'Option A' }] }),
    ).toEqual([{ id: 'opt_a', label: 'Option A' }]);
  });

  it('skips options with no id or no label — neither can be named or matched', () => {
    expect(
      collectGraphOptionIdentities({
        options: [
          { id: 'opt_a', label: '   ' },
          { label: 'No Identity' },
          { id: 'opt_b', label: 'Option B' },
        ],
      }),
    ).toEqual([{ id: 'opt_b', label: 'Option B' }]);
  });

  it('returns [] for junk rather than throwing', () => {
    for (const junk of [null, undefined, 42, 'graph', [], { nodes: 'x', options: 7 }]) {
      expect(collectGraphOptionIdentities(junk)).toEqual([]);
    }
  });
});

describe('resolveTargetOptionFromMessage — the user names ONE option', () => {
  it('resolves the named option to its graph IDENTITY', () => {
    expect(
      resolveTargetOptionFromMessage(
        'What would make Engage Offshore Partner win?',
        topLevelGraph,
      ),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'opt_offshore', label: 'Engage Offshore Partner' },
    });
  });

  it('is case-insensitive, like the sibling named-FACTOR read', () => {
    expect(
      resolveTargetOptionFromMessage('what would change this to engage offshore partner?', nodeGraph),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'opt_offshore', label: 'Engage Offshore Partner' },
    });
  });

  it('LONGEST label wins, even when the shorter one is a prefix of it', () => {
    // Without span-consumption this reads as "two options named" and refuses to
    // address a perfectly unambiguous question.
    const graph = {
      options: [
        { id: 'opt_short', label: 'Hire Two Senior Engineers' },
        { id: 'opt_long', label: 'Hire Two Senior Engineers Locally' },
      ],
    };
    expect(
      resolveTargetOptionFromMessage('What would make Hire Two Senior Engineers Locally win?', graph),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'opt_long', label: 'Hire Two Senior Engineers Locally' },
    });
  });

  it('a longer canonical non-option label owns its span over a nested option label', () => {
    const graph = {
      nodes: [
        { id: 'o1', kind: 'option', label: 'US expansion' },
        { id: 'f1', kind: 'factor', label: 'US expansion cost' },
      ],
      edges: [],
    };
    expect(
      resolveTargetOptionFromMessage(
        'What would change if US expansion cost increased?',
        graph,
      ),
    ).toEqual({ kind: 'none', reason: 'no_option_named' });

    // A separate, non-overlapping occurrence still explicitly names the option.
    expect(
      resolveTargetOptionFromMessage(
        'If US expansion cost increased, what would make US expansion win?',
        graph,
      ),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'o1', label: 'US expansion' },
    });

    expect(
      resolveTargetOptionFromMessage(
        'What would change if US expansion cost increased?',
        { ...graph, nodes: [...graph.nodes].reverse() },
      ),
    ).toEqual({ kind: 'none', reason: 'no_option_named' });
  });

  it('an exact label shared by an option and non-option is entity-ambiguous', () => {
    expect(
      resolveTargetOptionFromMessage('What would make Expansion win?', {
        nodes: [
          { id: 'o1', kind: 'option', label: 'Expansion' },
          { id: 'f1', kind: 'factor', label: 'Expansion' },
        ],
      }),
    ).toEqual({ kind: 'none', reason: 'label_collision' });
  });

  it('requires Unicode lexical boundaries instead of resolving short labels inside words', () => {
    const short = { nodes: [{ id: 'o1', kind: 'option', label: 'US' }] };
    for (const message of [
      'What would change for the business?',
      'How much trust would change the result?',
    ]) {
      expect(resolveTargetOptionFromMessage(message, short), message).toEqual({
        kind: 'none',
        reason: 'no_option_named',
      });
    }
    expect(resolveTargetOptionFromMessage('What would make (us) win?', short)).toEqual({
      kind: 'resolved',
      option: { id: 'o1', label: 'US' },
    });

    const unicode = {
      nodes: [{ id: 'o2', kind: 'option', label: 'Åland (EU)' }],
    };
    expect(
      resolveTargetOptionFromMessage('What would make åLAND (eu) win?', unicode),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'o2', label: 'Åland (EU)' },
    });
    expect(
      resolveTargetOptionFromMessage('What would make Måland (EU) win?', unicode),
    ).toEqual({ kind: 'none', reason: 'no_option_named' });
  });

  it('TWO distinct options named ⇒ a comparison, not a target', () => {
    expect(
      resolveTargetOptionFromMessage(
        'Would Engage Offshore Partner or Hire Two Senior Engineers Locally be better?',
        topLevelGraph,
      ),
    ).toEqual({ kind: 'none', reason: 'multiple_options_named' });
  });

  it('a label shared by TWO ids resolves to NOTHING — never picks one', () => {
    // The #738 lesson at ingress: a label-only reader folds two distinct targets
    // into one and addresses an option the user may not have meant.
    const collided = {
      options: [
        { id: 'opt_a', label: 'Expand The Team' },
        { id: 'opt_b', label: 'Expand The Team' },
      ],
    };
    expect(
      resolveTargetOptionFromMessage('What would make Expand The Team win?', collided),
    ).toEqual({ kind: 'none', reason: 'label_collision' });
  });

  it('names no option ⇒ untargeted, typed', () => {
    expect(
      resolveTargetOptionFromMessage('What would change this result?', topLevelGraph),
    ).toEqual({ kind: 'none', reason: 'no_option_named' });
  });

  it('empty message / no options ⇒ typed misses, never a throw', () => {
    expect(resolveTargetOptionFromMessage('', topLevelGraph)).toEqual({
      kind: 'none',
      reason: 'no_message',
    });
    expect(resolveTargetOptionFromMessage(null, topLevelGraph)).toEqual({
      kind: 'none',
      reason: 'no_message',
    });
    expect(resolveTargetOptionFromMessage('What about Engage Offshore Partner?', {})).toEqual({
      kind: 'none',
      reason: 'no_options',
    });
  });

  it('a regex-special label is matched literally, not compiled as a pattern', () => {
    const graph = { options: [{ id: 'opt_sq', label: 'Maintain Current Team (Status Quo)' }] };
    expect(
      resolveTargetOptionFromMessage(
        'what would make Maintain Current Team (Status Quo) win?',
        graph,
      ),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'opt_sq', label: 'Maintain Current Team (Status Quo)' },
    });
  });
});

const canonicalGraph = {
  nodes: [
    { id: 'opt_a', kind: 'option' as const, label: 'Expand in Europe' },
    { id: 'opt_b', kind: 'option' as const, label: 'Expand in the US' },
    { id: 'fac_cost', kind: 'factor' as const, label: 'Acquisition cost' },
  ],
  edges: [],
};

function canonicalSnapshot(
  graph: unknown = canonicalGraph,
  requestGraph: unknown = null,
): ContextGraphSelection {
  return selectContextGraphSnapshot({
    canonicalRead: { status: 'ok_present', graph },
    requestGraph,
  });
}

function selected(
  id: string,
  label: string,
  over: Partial<TurnSelection> = {},
): TurnSelection {
  return {
    requested_ids: [id],
    elements: [{ id, kind: 'option', label }],
    unresolved_ids: [],
    unreadable_ref_ids: [],
    graph_read: 'ok_present',
    ...over,
  };
}

describe('resolveTargetOptionFromCanonicalContext — canonical selected referents', () => {
  it('resolves a deictic question from one fully resolved canonical option selection', () => {
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would make it win?',
        canonicalSnapshot(),
        selected('opt_a', 'Expand in Europe'),
      ),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'opt_a', label: 'Expand in Europe' },
    });
  });

  it('requires option-outcome deictic evidence before selection can supply a target', () => {
    const focus = selected('opt_a', 'Expand in Europe');
    for (const message of [
      'What would change the result?',
      'What would change in the model?',
      'What would change if Acquisition cost increased?',
      'What would change if it increased?',
      'Would it lead to lower acquisition cost?',
      'Could it win support from customers?',
      'Could it win over customers?',
      'Could it win, over customers?',
      'What would make it win with enterprise buyers?',
      'What would make it win, with enterprise buyers?',
      'What would make it become the top factor?',
    ]) {
      expect(
        resolveTargetOptionFromCanonicalContext(
          message,
          canonicalSnapshot(),
          focus,
        ),
        message,
      ).toEqual({ kind: 'none', reason: 'no_option_named' });
    }
  });

  it.each([
    'What would make it win?',
    'What would make it win if demand improved?',
    'What would make it win, given current demand?',
    'What would make it the leading option?',
    'What would make it become top?',
    'What would need to change for this option to come out ahead?',
    'Could the selected alternative become the leading option?',
  ])('accepts a closed option-outcome deictic: %s', (message) => {
    expect(
      resolveTargetOptionFromCanonicalContext(
        message,
        canonicalSnapshot(),
        selected('opt_a', 'Expand in Europe'),
      ),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'opt_a', label: 'Expand in Europe' },
    });
  });

  it('current explicit words outrank a different selected option', () => {
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would make Expand in the US win?',
        canonicalSnapshot(),
        selected('opt_a', 'Expand in Europe'),
      ),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'opt_b', label: 'Expand in the US' },
    });
  });

  it('does not use selection after an explicit comparison or ambiguous label', () => {
    expect(
      resolveTargetOptionFromCanonicalContext(
        'Would Expand in Europe or Expand in the US win?',
        canonicalSnapshot(),
        selected('opt_a', 'Expand in Europe'),
      ),
    ).toEqual({ kind: 'none', reason: 'multiple_options_named' });

    const collided = {
      nodes: [
        { id: 'opt_a', kind: 'option', label: 'Expand now' },
        { id: 'opt_b', kind: 'option', label: 'Expand now' },
      ],
      edges: [],
    };
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would make Expand now win?',
        canonicalSnapshot(collided),
        selected('opt_a', 'Expand now'),
      ),
    ).toEqual({ kind: 'none', reason: 'label_collision' });
  });

  it.each([
    ['multiple requested ids', selected('opt_a', 'Expand in Europe', { requested_ids: ['opt_a', 'opt_b'] })],
    ['multiple resolved elements', selected('opt_a', 'Expand in Europe', {
      elements: [
        { id: 'opt_a', kind: 'option', label: 'Expand in Europe' },
        { id: 'opt_b', kind: 'option', label: 'Expand in the US' },
      ],
    })],
    ['unresolved id', selected('opt_a', 'Expand in Europe', { unresolved_ids: ['missing'] })],
    ['unreadable ref', selected('opt_a', 'Expand in Europe', { unreadable_ref_ids: ['edge-token'] })],
    ['degraded selection read', selected('opt_a', 'Expand in Europe', { graph_read: 'degraded' })],
    ['selected factor', selected('fac_cost', 'Acquisition cost', {
      elements: [{ id: 'fac_cost', kind: 'factor', label: 'Acquisition cost' }],
    })],
  ])('fails weak for %s', (_name, focus) => {
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would make it win?',
        canonicalSnapshot(),
        focus,
      ),
    ).toEqual({ kind: 'none', reason: 'selection_not_unique' });
  });

  it('keeps canonical state authoritative when request state disagrees', () => {
    const requestGraph = {
      nodes: [{ id: 'opt_a', kind: 'option', label: 'Forged request label' }],
      edges: [],
    };
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would make it win?',
        canonicalSnapshot(canonicalGraph, requestGraph),
        selected('opt_a', 'Expand in Europe'),
      ),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'opt_a', label: 'Expand in Europe' },
    });
  });

  it.each(['provisional', 'absent', 'unavailable'] as const)(
    '%s state cannot license a selected or explicitly named target',
    (status) => {
      const snapshot =
        status === 'provisional'
          ? selectContextGraphSnapshot({
              canonicalRead: { status: 'ok_absent' },
              requestGraph: canonicalGraph,
            })
          : status === 'absent'
            ? selectContextGraphSnapshot({
                canonicalRead: { status: 'ok_absent' },
                requestGraph: null,
              })
          : selectContextGraphSnapshot({
              canonicalRead: { status: 'degraded', errorCode: 'read_failed' },
              requestGraph: canonicalGraph,
            });
      expect(
        resolveTargetOptionFromCanonicalContext(
          'What would make Expand in Europe win?',
          snapshot,
          selected('opt_a', 'Expand in Europe'),
        ),
      ).toEqual({ kind: 'none', reason: 'selection_not_canonical' });
    },
  );

  it('rejects a hand-built canonical lookalike that lacks selector attestation', () => {
    const forged = {
      status: 'canonical',
      graph: canonicalGraph,
      reason: 'persisted_valid',
    } as ContextGraphSelection;
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would make it win?',
        forged,
        selected('opt_a', 'Expand in Europe'),
      ),
    ).toEqual({ kind: 'none', reason: 'selection_not_canonical' });
  });

  it('allows identical duplicate representations but rejects conflicting identity bytes', () => {
    const identical = {
      nodes: [{ id: 'opt_a', kind: 'option', label: 'Expand in Europe' }],
      options: [{ id: 'opt_a', label: 'Expand in Europe' }],
      edges: [],
    };
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would make it win?',
        canonicalSnapshot(identical),
        selected('opt_a', 'Expand in Europe'),
      ),
    ).toEqual({
      kind: 'resolved',
      option: { id: 'opt_a', label: 'Expand in Europe' },
    });

    const conflicting = {
      nodes: [{ id: 'opt_a', kind: 'option', label: 'Expand in Europe' }],
      options: [{ id: 'opt_a', label: 'Expand elsewhere' }],
      edges: [],
    };
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would make it win?',
        canonicalSnapshot(conflicting),
        selected('opt_a', 'Expand in Europe'),
      ),
    ).toEqual({ kind: 'none', reason: 'identity_collision' });
  });

  it('rejects one identity asserted across option and factor kinds', () => {
    const crossKind = {
      options: [{ id: 'opt_a', label: 'Expand in Europe' }],
      nodes: [
        { id: 'opt_a', kind: 'factor', label: 'Acquisition cost' },
        { id: 'opt_b', kind: 'option', label: 'Expand in the US' },
      ],
      edges: [],
    };
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would make it win?',
        canonicalSnapshot(crossKind),
        selected('opt_a', 'Expand in Europe'),
      ),
    ).toEqual({ kind: 'none', reason: 'identity_collision' });
  });

  it('is invariant to canonical graph order and preserves no-evidence behaviour', () => {
    const reversed = {
      ...canonicalGraph,
      nodes: [...canonicalGraph.nodes].reverse(),
    };
    const focus = selected('opt_b', 'Expand in the US');
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would make it win?',
        canonicalSnapshot(reversed),
        focus,
      ),
    ).toEqual(
      resolveTargetOptionFromCanonicalContext(
        'What would make it win?',
        canonicalSnapshot(canonicalGraph),
        focus,
      ),
    );
    expect(
      resolveTargetOptionFromCanonicalContext(
        'What would change the result?',
        canonicalSnapshot(),
        null,
      ),
    ).toEqual({ kind: 'none', reason: 'no_option_named' });
  });
});
