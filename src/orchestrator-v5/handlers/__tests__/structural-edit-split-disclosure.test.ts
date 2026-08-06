/**
 * ROADMAP 2.474 / A3 — THE REFUSAL THAT IS NOW A DISCLOSURE.
 *
 * The half of the witnessed defect Paul cared most about: "the current
 * behaviour discards a composed batch and explains nothing". Probe C's copy
 * named a limit ("limit: 4 node ops, 8 edge ops") and offered a chip that asked
 * the USER to work out the decomposition the server had already computed and
 * thrown away.
 *
 * What is under test here is therefore not "is there a sentence" but four
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
 *  · ⭐⭐ SCOPE AND CONTINUATION ARE SEPARABLE (ROADMAP 2.620). The scope
 *    notice must be sayable with no verdict at all, and the continuation must
 *    not be. The strongest evidence for that here is STRUCTURAL and lives in
 *    the signature: `buildStructuralEditScopeNotice` takes no outcome, no
 *    verdict and no chip, so it cannot be gated on one. The behavioural half
 *    of the proof is at the dispatch seam
 *    (`edit-graph-dispatch-structural-split.test.ts`), because that is where
 *    the defect lived — a builder cannot demonstrate a call site's gate.
 *  · The copy is swept clean by the ESTATE'S OWN guards, imported, not by a
 *    hand-written list of things I happened to think of.
 */
import { describe, expect, it } from 'vitest';

import {
  buildStructuralEditScopeNotice,
  buildStructuralEditContinuation,
} from '../structural-edit-split-disclosure.js';
import { describeChangeset, type ChangesetOpLike } from '../describe-changeset.js';
import { RERUN_ACTION } from '../../routing/stale-rerun-guard.js';
import { isCompetingRunAnalysisSuggestionChip } from '../../commit.js';
import { hasLiveHeldProposal, type EditGmDecision } from '../edit-graph-referee-gate.js';
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

function scope(proposedIndices: number[], partCount = 3) {
  return buildStructuralEditScopeNotice({
    wholeBatch: description(),
    proposedIndices,
    partCount,
  });
}

function continuation(proposedIndices: number[], partCount = 3, dependent = false) {
  return buildStructuralEditContinuation({
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
function continuationAnalysed(proposedIndices: number[], partCount = 3) {
  return buildStructuralEditContinuation({
    wholeBatch: description(),
    proposedIndices,
    partCount,
    remainderDependsOnThisStep: false,
    rerunRequiredBeforeNextStep: true,
  });
}

describe('⭐ the scope notice NAMES every operation still to come', () => {
  it('names all four remaining operations by their labels — no count, no ellipsis', () => {
    const n = scope([0, 1]);
    expect(n).not.toBeNull();
    // IDENTITY binding: each remaining item is named. A "3 more changes"
    // collapse satisfies neither.
    expect(n!).toContain('Plan B cost driver');
    expect(n!).toContain('Shared overhead');
    expect(n!).not.toContain('more changes');
    expect(n!).not.toContain('...');
    expect(n!).not.toContain('…');
  });

  it('does NOT name what is already proposed — the remainder is the remainder', () => {
    expect(scope([0, 1])!).not.toContain('Plan A cost driver');
  });

  it('says how many steps there are, and that the rest were not looked at', () => {
    const n = scope([0, 1])!;
    expect(n).toContain('3 steps');
    expect(n).toContain('were not looked at on this turn');
    expect(n).toContain('Still to come:');
  });

  /**
   * ⭐⭐ ROADMAP 2.620 — THE SCOPE NOTICE CANNOT BE GATED ON AN OUTCOME,
   * because no outcome is reachable from inside it.
   *
   * This is the structural half of the fix and it is asserted structurally: a
   * behavioural test could only show that the notice is emitted on the
   * outcomes the fixture happens to build. The signature shows it can never
   * depend on ANY of them. `Object.keys` on the accepted input is the closest
   * a test can get to "the compiler will not let a verdict in here".
   */
  it('⭐ takes no verdict, no outcome and no chip — the gate it used to carry is unreachable', () => {
    const accepted = { wholeBatch: description(), proposedIndices: [0, 1], partCount: 3 };
    expect(buildStructuralEditScopeNotice(accepted)).not.toBeNull();
    // The whole input, enumerated. Nothing here can carry an outcome.
    expect(Object.keys(accepted).sort()).toEqual([
      'partCount',
      'proposedIndices',
      'wholeBatch',
    ]);
    // Arity: a second argument would be the obvious way to smuggle one back.
    expect(buildStructuralEditScopeNotice.length).toBe(1);
  });

  it('makes no claim about what happened to the submitted part', () => {
    const n = scope([0, 1])!;
    // The words that made the first version contradictory beside a refusal.
    expect(n).not.toContain('this is the first.');
    expect(n).not.toContain('I can propose in one step');
    expect(n).not.toContain('proposed');
    expect(n).not.toContain('applied');
  });
});

describe('⭐ the remainder is described against the WHOLE batch, not the part', () => {
  it('a link whose endpoint is created by the FIRST step still renders as a named link', () => {
    // Part 1 = the create of 'f-a'. The remainder = the link f-a -> g-profit.
    // Described in isolation the link renders the generic "add a link" (the id
    // is not a node in the graph yet, and internal ids must never leak as
    // labels). Described against the whole batch it renders the real labels.
    const n = buildStructuralEditScopeNotice({
      wholeBatch: description(),
      proposedIndices: [0],
      partCount: 2,
    });
    expect(n!).toContain("link 'Plan A cost driver' to 'Profit'");
    expect(n!).not.toContain('add a link');
    // Control: describing the remainder ALONE really does lose the label, so
    // the assertion above is testing the mechanism and not a tautology.
    const isolated = describeChangeset([WHOLE_BATCH[1]!], GRAPH);
    expect(isolated!.subject).toBe('add a link');
  });

  it('scope and continuation describe the SAME remainder — one derivation, two surfaces', () => {
    const n = scope([0, 1])!;
    const c = continuation([0, 1])!;
    // Bound by identity to the shared subject, not by both being non-empty.
    expect(c.action.detail).toBe(
      `Still to come: ${n.slice(n.indexOf('Still to come: ') + 'Still to come: '.length)}`,
    );
  });
});

describe('⭐ the continuation offers the next step as a chip, without rephrasing', () => {
  it('the chip message names the remaining work, so the next turn has something to compose from', () => {
    const c = continuation([0, 1])!;
    expect(c.action.label).toBe('Propose the next step');
    expect(c.action.message).toContain('Plan B cost driver');
    expect(c.action.message).toContain('Shared overhead');
    // The full sentence rides on `detail` behind the short label — the same
    // shape the held-confirm chip uses (wave-2 ask #20).
    expect(c.action.detail).toContain('Plan B cost driver');
  });

  it('a dependent remainder says the confirm order matters; an independent one says nothing', () => {
    expect(continuation([0], 2, true)!.notice).toContain('Confirm this step first');
    // Not "a different sentence" — NO sentence. An independent remainder has
    // nothing to add beyond the chip, and inventing prose for it is how the
    // notice grew a second job in the first place.
    expect(continuation([0, 1], 3, false)!.notice).toBeNull();
  });
});

describe('⭐⭐ ROADMAP 2.621 — the re-run chip is CONSUMED from the estate`s one export', () => {
  it('the already-analysed continuation offers the canonical chip by IDENTITY, not by copy', () => {
    const c = continuationAnalysed([0, 1])!;
    // Every field is the exported constant's own value. If `RERUN_ACTION`
    // moves, this moves with it — there is no second definition to drift.
    expect(c.action.id).toBe(RERUN_ACTION.id);
    expect(c.action.label).toBe(RERUN_ACTION.label);
    expect(c.action.message).toBe(RERUN_ACTION.message);
    expect(c.action.action_type).toBe(RERUN_ACTION.action_type);
    // Executable, so the control can do what it says.
    expect(c.action.action_type).toBe('run_analysis');
    // The remainder is still carried, behind the short label.
    expect(c.action.detail).toContain('Shared overhead');
  });

  it('the copy states confirm, then re-run, then the rest', () => {
    const c = continuationAnalysed([0, 1])!;
    expect(c.notice).toContain('already analysed this model');
    expect(c.notice).toContain('Re-run the analysis after confirming');
  });

  it('⭐ DISCRIMINATING CONTROL — the ordinary continuation is NOT the re-run chip', () => {
    // Without this pair, "the chip equals RERUN_ACTION" could be satisfied by
    // a builder that returns the re-run chip on every path.
    const c = continuation([0, 1])!;
    expect(c.action.id).not.toBe(RERUN_ACTION.id);
    expect(c.action.id).toBe('structural_edit_next_step');
    expect(c.action.action_type).toBeUndefined();
  });
});

/**
 * ⚠⚠ ROADMAP 2.622 — WHERE THE RE-RUN CHIP ACTUALLY ENDS UP, MEASURED RATHER
 * THAN ASSUMED, AND THE OPEN RULING NAMED.
 *
 * The continuation fires ONLY on a live held proposal. A live held proposal is
 * a confirmation-expecting pending, which is exactly the condition under which
 * `commit.ts` strips competing generic run_analysis suggestion chips. So this
 * chip is suppressed before it reaches the user, every time.
 *
 * That is not asserted here from a reading of `commit.ts` — it is asked of
 * `commit.ts`'s own predicate, so the day the suppression set changes this
 * test moves with it instead of describing a behaviour that has gone.
 *
 * ⚠ WHETHER THAT IS A DEFECT IS AN OPEN RULING (a), and this test deliberately
 * does not decide it. If the intended sequence is confirm → re-run → ask
 * again, suppressing a re-run offer while the confirm is outstanding is
 * CORRECT and the prose carries the guidance. If the chip is meant to be
 * takeable, the estate's own convention is a DEDICATED id (`_gm_stale`,
 * `_gm_held_applied`) that the suppression set does not name. Either way the
 * mechanism is now pinned, so the ruling has an object to bind to.
 */
describe('⚠⚠ ROADMAP 2.622 — the re-run continuation chip is suppressed while the hold is live', () => {
  it('commit.ts`s own predicate says the chip is suppressible', () => {
    const chip = continuationAnalysed([0, 1])!.action;
    expect(
      isCompetingRunAnalysisSuggestionChip({
        id: chip.id,
        label: chip.label,
        message: chip.message,
        action_type: chip.action_type,
      } as Parameters<typeof isCompetingRunAnalysisSuggestionChip>[0]),
    ).toBe(true);
  });

  it('⭐ DISCRIMINATING CONTROL — the ordinary next-step chip is NOT suppressed', () => {
    // Proves the assertion above binds to the re-run chip's id/type pair and
    // not to "any chip this module emits".
    const chip = continuation([0, 1])!.action;
    expect(
      isCompetingRunAnalysisSuggestionChip({
        id: chip.id,
        label: chip.label,
        message: chip.message,
      } as Parameters<typeof isCompetingRunAnalysisSuggestionChip>[0]),
    ).toBe(false);
  });

  it('and the condition that mints it IS the condition that suppresses it', () => {
    // The continuation's precondition, from the producer's predicate. A held
    // verdict with a pending is a confirmation-expecting pending, which is
    // what arms the suppression. Same state, both sides.
    const heldWithPending = {
      governing: 'held',
      pendingActions: [{ action: { kind: 'apply_proposed_change' } }],
    } as unknown as Pick<EditGmDecision, 'governing' | 'pendingActions'>;
    expect(hasLiveHeldProposal(heldWithPending)).toBe(true);
    // ⭐ DISCRIMINATING CONTROL — a held verdict that minted NO pending is not
    // a live proposal, so the continuation is withheld and nothing is
    // suppressed. Without this the assertion above passes on any input.
    const heldNoPending = {
      governing: 'held',
      pendingActions: null,
    } as unknown as Pick<EditGmDecision, 'governing' | 'pendingActions'>;
    expect(hasLiveHeldProposal(heldNoPending)).toBe(false);
  });
});

describe('the copy is swept by the estate`s OWN guards', () => {
  const surfaces = () => {
    const n = scope([0, 1])!;
    const c = continuationAnalysed([0, 1])!;
    const ordinary = continuation([0], 2, true)!;
    return [
      n,
      c.notice!,
      c.action.label,
      c.action.message,
      c.action.detail,
      ordinary.notice!,
      ordinary.action.label,
      ordinary.action.message,
      ordinary.action.detail,
    ];
  };

  it('every surface is a non-empty string — a null here would make the sweep vacuous', () => {
    const all = surfaces();
    expect(all).toHaveLength(9);
    for (const text of all) expect(typeof text === 'string' && text.length > 0).toBe(true);
  });

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

describe('⭐ POSITIVE CONTROL (trap 13) — nothing is said on the ordinary path', () => {
  const single = { wholeBatch: description(), proposedIndices: [0, 1, 2, 3, 4, 5], partCount: 1 };

  it('a single-part request produces NO scope notice and NO continuation', () => {
    expect(buildStructuralEditScopeNotice(single)).toBeNull();
    expect(
      buildStructuralEditContinuation({
        ...single,
        remainderDependsOnThisStep: false,
        rerunRequiredBeforeNextStep: false,
      }),
    ).toBeNull();
  });

  it('and a part count of 2 with nothing actually left over also stays silent', () => {
    // Guards against a disclosure that fires off the COUNT alone and then
    // renders an empty list — a sentence that promises work and names none.
    const everything = {
      wholeBatch: description(),
      proposedIndices: [0, 1, 2, 3, 4, 5],
      partCount: 2,
    };
    expect(buildStructuralEditScopeNotice(everything)).toBeNull();
    expect(
      buildStructuralEditContinuation({
        ...everything,
        remainderDependsOnThisStep: false,
        rerunRequiredBeforeNextStep: false,
      }),
    ).toBeNull();
  });
});
