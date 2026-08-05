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

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  buildStructuralEditSplitDisclosure,
  STRUCTURAL_EDIT_RERUN_ACTION,
  shouldEmitSplitDisclosure,
} from '../structural-edit-split-disclosure.js';
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
    // The PRE-ANALYSIS case. Every test in this file used to run here
    // implicitly; it is now named, because it is the only state in which
    // "Propose the next step" can actually deliver.
    rerunRequiredBeforeNextStep: false,
  });
}

/** The already-analysed case, where the next step needs a re-run first. */
function discloseAnalysed(proposedIndices: number[], partCount = 3) {
  return buildStructuralEditSplitDisclosure({
    wholeBatch: description(),
    proposedIndices,
    partCount,
    remainderDependsOnThisStep: false,
    rerunRequiredBeforeNextStep: true,
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
      rerunRequiredBeforeNextStep: false,
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
        rerunRequiredBeforeNextStep: false,
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
        rerunRequiredBeforeNextStep: false,
      }),
    ).toBeNull();
  });
});

/**
 * ⭐⭐ THE ALREADY-ANALYSED BRANCH — a control that can deliver, or none.
 *
 * On a scenario carrying a successful `run_analysis` fact, confirming step 1
 * moves the graph hash, freshness flips to `stale`, and a STRUCTURAL candidate
 * does not trust `stale` (`frame-gate.ts`: the relaxation is tunable-only). So
 * "Propose the next step" is a control that CANNOT do what it says — the
 * estate's named dominant defect. The copy states the real order instead, and
 * the chip becomes the thing that unblocks it.
 */
describe('⭐⭐ already analysed — the copy states the real order and the chip is the re-run', () => {
  it('says the model has been analysed and names the confirm-then-re-run sequence', () => {
    const d = discloseAnalysed([0, 1]);
    expect(d!.notice).toContain('already analysed this model');
    expect(d!.notice).toContain('Re-run the analysis after confirming');
  });

  it('still names EVERY remaining operation — the disclosure is not traded for the warning', () => {
    const d = discloseAnalysed([0, 1]);
    expect(d!.notice).toContain('Plan B cost driver');
    expect(d!.notice).toContain('Shared overhead');
    expect(d!.notice).not.toContain('more changes');
  });

  it('offers the executable re-run chip, and NOT the next-step chip', () => {
    const d = discloseAnalysed([0, 1]);
    expect(d!.action.id).toBe('chip_action_rerun_analysis');
    expect(d!.action.actionType).toBe('run_analysis');
    expect(d!.action.id).not.toBe('structural_edit_next_step');
    // The remainder still rides on `detail`.
    expect(d!.action.detail).toContain('Shared overhead');
  });

  it('DISCRIMINATING PAIR — the same input with the flag off keeps the next-step chip', () => {
    // Neither reading alone shows the flag is bound to anything.
    expect(disclose([0, 1])!.action.id).toBe('structural_edit_next_step');
    expect(disclose([0, 1])!.action.actionType).toBeUndefined();
    expect(disclose([0, 1])!.notice).not.toContain('already analysed');
  });

  it('the re-run copy is swept clean by the estate`s own guards', () => {
    const d = discloseAnalysed([0, 1])!;
    for (const text of [d.notice, d.action.label, d.action.message, d.action.detail]) {
      for (const re of FORBIDDEN_USER_FACING_PHRASES) {
        expect(re.test(text), `${re} matched: ${text}`).toBe(false);
      }
      for (const re of SUCCESS_CLAIM_PATTERNS) {
        expect(re.test(text), `${re} matched: ${text}`).toBe(false);
      }
      expect(text).not.toContain('—');
    }
  });
});

/**
 * ⚠ MIRROR GUARD — this module carries a THIRD copy of the estate's canonical
 * re-run chip, because the two existing ones
 * (`routing/post-analysis-label-intercept.ts` RERUN_ANALYSIS_CHIP,
 * `routing/run-comparison-gate.ts` RERUN_ACTION) are module-private and
 * exporting a shared leaf would widen this PR. A hand-maintained copy is the
 * estate's dominant defect class, so it is not trusted: this reads BOTH
 * originals out of their source and fails loud if the triple drifts. Rowed for
 * extraction to one leaf.
 */
describe('the re-run chip does not drift from the estate`s existing definitions', () => {
  const ORIGINS = [
    '../../routing/post-analysis-label-intercept.ts',
    '../../routing/run-comparison-gate.ts',
  ];

  it('id, label, message and action_type match both existing definitions', () => {
    const here = dirname(fileURLToPath(import.meta.url));
    let checked = 0;
    for (const rel of ORIGINS) {
      const src = readFileSync(join(here, rel), 'utf8');
      // The block is whichever const carries the canonical id.
      const idx = src.indexOf(STRUCTURAL_EDIT_RERUN_ACTION.id);
      expect(idx, `${rel} must define ${STRUCTURAL_EDIT_RERUN_ACTION.id}`).toBeGreaterThan(-1);
      const block = src.slice(idx, idx + 260);
      expect(block, rel).toContain(`label: '${STRUCTURAL_EDIT_RERUN_ACTION.label}'`);
      expect(block, rel).toContain(`message: '${STRUCTURAL_EDIT_RERUN_ACTION.message}'`);
      expect(block, rel).toContain(`action_type: '${STRUCTURAL_EDIT_RERUN_ACTION.action_type}'`);
      checked += 1;
    }
    // Zero origins checked would make every assertion above vacuous.
    expect(checked).toBe(ORIGINS.length);
  });
});

/**
 * ⭐⭐ THE GATE ITSELF, as an object a test can bind to.
 *
 * ⚠ WHY THIS BLOCK EXISTS: a mutant that made the gate ignore
 * `pendingActionCount` SURVIVED the dispatch suite, because no dispatch fixture
 * produces `governing:'held'` with zero pendings and one cannot be built there
 * cheaply. Rather than assert that mutant equivalent — it is not; a hold that
 * mints no pending has no confirm control — the condition was extracted from an
 * inline boolean into this predicate, where every combination is reachable.
 * That is also the shape of the original defect: an inline condition at a call
 * site is invisible to every test.
 */
describe('⭐⭐ shouldEmitSplitDisclosure — the gate that stops a contradictory turn', () => {
  it('a held turn WITH a pending may disclose', () => {
    expect(shouldEmitSplitDisclosure({ governing: 'held', pendingActionCount: 1 })).toBe(true);
  });

  it('a held turn with NO pending may NOT — there is no confirm control to follow', () => {
    expect(shouldEmitSplitDisclosure({ governing: 'held', pendingActionCount: 0 })).toBe(false);
  });

  it('every non-held verdict may NOT disclose, pendings or not', () => {
    for (const governing of ['rejected', 'stale', 'clarify_required', 'proceed', null]) {
      expect(
        shouldEmitSplitDisclosure({ governing, pendingActionCount: 1 }),
        `${governing} must not disclose`,
      ).toBe(false);
      expect(shouldEmitSplitDisclosure({ governing, pendingActionCount: 0 })).toBe(false);
    }
  });

  it('`stale` in particular — the verdict an already-analysed scenario reaches', () => {
    // Finding 1 makes this reachable on turn 1, and it was one of the two
    // shapes that produced the contradictory turn.
    expect(shouldEmitSplitDisclosure({ governing: 'stale', pendingActionCount: 0 })).toBe(false);
  });
});
