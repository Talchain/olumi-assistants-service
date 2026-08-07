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
  resolveTargetOptionFromMessage,
} from '../resolve-target-option.js';

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
