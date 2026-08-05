/**
 * ROADMAP 2.474 / A3 — THE REFUSAL THAT IS NOW A DISCLOSURE.
 *
 * The half of the witnessed defect Paul cared most about: "the current
 * behaviour discards a composed batch and explains nothing". Probe C's copy
 * named a limit ("limit: 4 node ops, 8 edge ops") and offered a chip that asked
 * the USER to work out the decomposition the server had already computed and
 * thrown away.
 *
 * What is under test here is therefore not "is there a sentence" but three
 * specific properties, each with the trap-13b question asked of it:
 *
 *  · EVERY remaining operation is named. A guard that only checked the notice
 *    was non-empty would pass on "…and 3 more changes" — the exact opaque
 *    collapse ROADMAP 1.134 removed. So the assertions bind to the LABEL of
 *    each remaining operation, by identity.
 *  · The remainder is described against the WHOLE batch. A remainder described
 *    in isolation renders "add a link" wherever it names a node the first step
 *    creates — still a sentence, still non-empty, and useless. The test builds
 *    exactly that case.
 *  · The copy is swept clean by the ESTATE'S OWN guards, imported, not by a
 *    hand-written list of things I happened to think of.
 */
import { describe, expect, it } from 'vitest';

import { buildStructuralEditSplitDisclosure } from '../structural-edit-split-disclosure.js';
import { describeChangeset, type ChangesetOpLike } from '../describe-changeset.js';
import {
  FORBIDDEN_USER_FACING_PHRASES,
  SUCCESS_CLAIM_PATTERNS,
} from '../../compose/forbidden-user-facing-phrases.js';
import { buildReadyGraph } from '../../graph-management/__tests__/fixtures.js';

const GRAPH = buildReadyGraph();

/**
 * Three new drivers, each linked to Profit. Part 1 proposes driver A and its
 * link; the remainder is drivers B and C with theirs.
 */
const WHOLE_BATCH: ChangesetOpLike[] = [
  { op: 'add_node', path: 'f-a', value: { id: 'f-a', kind: 'factor', label: 'Plan A cost driver' } },
  { op: 'add_edge', path: 'f-a::g-profit', value: { from: 'f-a', to: 'g-profit' } },
  { op: 'add_node', path: 'f-b', value: { id: 'f-b', kind: 'factor', label: 'Plan B cost driver' } },
  { op: 'add_edge', path: 'f-b::g-profit', value: { from: 'f-b', to: 'g-profit' } },
  { op: 'add_node', path: 'f-c', value: { id: 'f-c', kind: 'factor', label: 'Shared overhead' } },
  { op: 'add_edge', path: 'f-c::g-profit', value: { from: 'f-c', to: 'g-profit' } },
];

function description() {
  const d = describeChangeset(WHOLE_BATCH, GRAPH);
  if (d === null) throw new Error('fixture batch must describe');
  return d;
}

function disclose(proposedIndices: number[], partCount = 3, dependent = false) {
  return buildStructuralEditSplitDisclosure({
    wholeBatch: description(),
    proposedIndices,
    partCount,
    remainderDependsOnThisStep: dependent,
  });
}

describe('⭐ the disclosure NAMES every operation still to come', () => {
  it('names all four remaining operations by their labels — no count, no ellipsis', () => {
    const d = disclose([0, 1]);
    expect(d).not.toBeNull();
    // IDENTITY binding: each remaining item is named. A "3 more changes"
    // collapse satisfies neither.
    expect(d!.notice).toContain('Plan B cost driver');
    expect(d!.notice).toContain('Shared overhead');
    expect(d!.notice).not.toContain('more changes');
    expect(d!.notice).not.toContain('...');
    expect(d!.notice).not.toContain('…');
  });

  it('does NOT name what is already proposed — the remainder is the remainder', () => {
    const d = disclose([0, 1]);
    expect(d!.notice).not.toContain('Plan A cost driver');
  });

  it('says how many steps there are, and that this is the first', () => {
    expect(disclose([0, 1])!.notice).toContain('3 steps');
    expect(disclose([0, 1])!.notice).toContain('this is the first');
  });
});

describe('⭐ the remainder is described against the WHOLE batch, not the part', () => {
  it('a link whose endpoint is created by the FIRST step still renders as a named link', () => {
    // Part 1 = the create of 'f-a'. The remainder = the link f-a -> g-profit.
    // Described in isolation the link renders the generic "add a link" (the id
    // is not a node in the graph yet, and internal ids must never leak as
    // labels). Described against the whole batch it renders the real labels.
    const d = buildStructuralEditSplitDisclosure({
      wholeBatch: description(),
      proposedIndices: [0],
      partCount: 2,
      remainderDependsOnThisStep: true,
    });
    expect(d!.notice).toContain("link 'Plan A cost driver' to 'Profit'");
    expect(d!.notice).not.toContain('add a link');
    // Control: describing the remainder ALONE really does lose the label, so
    // the assertion above is testing the mechanism and not a tautology.
    const isolated = describeChangeset([WHOLE_BATCH[1]!], GRAPH);
    expect(isolated!.subject).toBe('add a link');
  });

  it('a dependent remainder says the confirm order matters; an independent one does not', () => {
    expect(disclose([0], 2, true)!.notice).toContain('Confirm this step first');
    expect(disclose([0, 1], 3, false)!.notice).not.toContain('Confirm this step first');
  });
});

describe('⭐ the next step is offered as a chip the user can take without rephrasing', () => {
  it('the chip message names the remaining work, so the next turn has something to compose from', () => {
    const d = disclose([0, 1]);
    expect(d!.action.label).toBe('Propose the next step');
    expect(d!.action.message).toContain('Plan B cost driver');
    expect(d!.action.message).toContain('Shared overhead');
    // The full sentence rides on `detail` behind the short label — the same
    // shape the held-confirm chip uses (wave-2 ask #20).
    expect(d!.action.detail).toContain('Plan B cost driver');
  });
});

describe('the copy is swept by the estate`s OWN guards', () => {
  const surfaces = () => {
    const d = disclose([0, 1], 3, true)!;
    return [d.notice, d.action.label, d.action.message, d.action.detail];
  };

  it('carries no denial-of-change phrase', () => {
    for (const text of surfaces()) {
      for (const re of FORBIDDEN_USER_FACING_PHRASES) {
        expect(re.test(text), `${re} matched: ${text}`).toBe(false);
      }
    }
  });

  it('carries no success claim — nothing here says a change was made', () => {
    for (const text of surfaces()) {
      for (const re of SUCCESS_CLAIM_PATTERNS) {
        expect(re.test(text), `${re} matched: ${text}`).toBe(false);
      }
    }
  });

  it('carries no em dash and no internal id', () => {
    for (const text of surfaces()) {
      expect(text).not.toContain('—');
      for (const id of ['f-a', 'f-b', 'f-c', 'g-profit', 'add_node', 'add_edge']) {
        expect(text).not.toContain(id);
      }
    }
  });
});

describe('⭐ POSITIVE CONTROL (trap 13) — no disclosure on the ordinary path', () => {
  it('a single-part request produces NO notice at all', () => {
    expect(
      buildStructuralEditSplitDisclosure({
        wholeBatch: description(),
        proposedIndices: [0, 1, 2, 3, 4, 5],
        partCount: 1,
        remainderDependsOnThisStep: false,
      }),
    ).toBeNull();
  });

  it('and a part count of 2 with nothing actually left over also stays silent', () => {
    // Guards against a disclosure that fires off the COUNT alone and then
    // renders an empty list — a sentence that promises work and names none.
    expect(
      buildStructuralEditSplitDisclosure({
        wholeBatch: description(),
        proposedIndices: [0, 1, 2, 3, 4, 5],
        partCount: 2,
        remainderDependsOnThisStep: false,
      }),
    ).toBeNull();
  });
});
