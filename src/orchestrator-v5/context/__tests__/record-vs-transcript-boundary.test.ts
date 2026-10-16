/**
 * THE RECORD-VS-TRANSCRIPT BOUNDARY.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * Fresh-guest journey on deployed staging (UI `5113f5a0` · CEE `cd3d6ae` ·
 * PLoT `22dcfe3` · ISL `28fe0c9`): the user named a success measure IN
 * CONVERSATION. It was never persisted. Asked to quote it back "or say it is
 * unset", the assistant quoted it AS RECORDED STATE, with provenance — while
 * six independent structural statements on the same page said no success
 * target was set.
 *
 * ── THE MECHANISM, DERIVED AT THE BYTES (not inferred from the symptom) ────
 * The success target is not in the model's context AT ALL — set or unset:
 *
 *   1. `compactGraph` (orchestrator/context/graph-compact.ts:223) documents
 *      `goal_threshold` in its "Dropped per node" list. `CompactNode`
 *      (:34-58) has no threshold field. Measured: `goal_threshold` appears
 *      ZERO times in the code of the five model-facing modules (positive
 *      control `label`: 17/3/26/92/11).
 *   2. `formatGraphForContext` additionally strips `value`/`raw_value`/`cap`.
 *   3. The one readiness kind that could name it — `goal_threshold_missing`
 *      — has NO producer (`readiness-summary.ts:28` says so; the
 *      `recoveryKindToOpenItemKind` switch cannot return it).
 *
 * Meanwhile `ContextPack.conversation.recent_turns[].user_message` carries the
 * user's VERBATIM sentence, and `buildUserMessage` serialises the whole pack
 * as ONE JSON document under ONE header (`## ContextPack`), with
 * `conversation` and `graph` as sibling keys.
 *
 * So when the model is asked "quote it or say it is unset", the ONLY place in
 * its entire context where an answer exists is the transcript. It is not
 * hallucinating; it is reading the one source it was given.
 *
 * ── THE DISCRIMINATING CONTROL, AND WHY IT MATTERS ─────────────────────────
 * A field the user NEVER mentioned (time horizon) was reported unset,
 * correctly. That is not the record authority working — it is the SAME code
 * path with an empty transcript. Both fields are absent from the pack
 * identically; they differ only in what the conversation contained. The
 * control isolates the transcript as the sole causal input, and it is carried
 * into this suite so a fix is proven to have repaired the MECHANISM rather
 * than suppressed an output.
 *
 * ── WHY AN INSTRUCTION-ONLY FIX WOULD BE WRONG ─────────────────────────────
 * Telling the model "answer from the record, not the transcript" without
 * putting the record in the pack would make it answer "unset" ALWAYS —
 * including when the target IS set — because the record it receives has no
 * threshold field at all. That is over-suppression (the J-F5 dead end). Hence
 * the opposite-direction twin below: a genuinely-recorded target must still be
 * quotable, with its real value and unit.
 *
 * ── BUILT FROM THE REAL PRODUCER ───────────────────────────────────────────
 * Every test here drives the PRODUCTION chain —
 * `compactGraphForContextPack` → `assembleContextPackWithSummary` →
 * `buildUserMessage` — never a hand-written pack literal. A fixture the author
 * writes encodes the author's model of the producer rather than the producer,
 * which is exactly how a sibling kit certified a payload shape no producer
 * emits.
 */

import { describe,expect,it } from 'vitest';

import type { GraphStateIngress } from '../../boundary/request-extensions.js';

import { projectGoalTargetRecord } from '../goal-target-record.js';

import { decideGoalTargetReceipt } from '../../compose/goal-target-receipt-guard.js';

// ---------------------------------------------------------------------------
// The witnessed inputs. IDENTITIES, not value predicates.
// ---------------------------------------------------------------------------

/** The goal node's id — every assertion binds to the record by THIS, never by
 *  finding "some node with 85 on it" (trap 19: another object could satisfy
 *  a value predicate). */
const GOAL_NODE_ID = 'goal_csat';

/** The value the user SAID, in conversation, and never recorded. */
const MENTIONED_ONLY_VALUE = 85;

/** The user's verbatim sentence from the witnessed journey. */


/** The question that triggered the fabrication, verbatim in shape. */


function goalNode(extra: Record<string, unknown> = {}) {
  return { id: GOAL_NODE_ID, kind: 'goal', label: 'Maintain customer satisfaction', ...extra };
}

/** A realistic two-option graph. `goalExtra` is the ONLY thing that varies
 *  between the defect case and its opposite-direction twin. */
function makeGraph(goalExtra: Record<string, unknown> = {}): GraphStateIngress {
  return {
    nodes: [
      goalNode(goalExtra),
      { id: 'opt_a', kind: 'option', label: 'Four-day week' },
      { id: 'opt_b', kind: 'option', label: 'Status quo' },
      { id: 'f_load', kind: 'factor', label: 'Workload' },
    ],
    edges: [{ from: 'f_load', to: GOAL_NODE_ID }],
  } as unknown as GraphStateIngress;
}



/**
 * Drive the REAL production chain and return both the rendered prompt and the
 * pack the model actually receives.
 */


// ---------------------------------------------------------------------------

describe('record-vs-transcript boundary: the success target', () => {






  describe('UNKNOWN REMAINS UNKNOWN — no graph read means no claim either way', () => {


    /**
     * ⚠ THE TEST ABOVE PASSED FOR THE WRONG REASON AND A MUTANT CAUGHT IT.
     *
     * It omits `goalTarget` from the assembler input entirely, so the key is
     * absent whatever `projectGoalTargetRecord` does — a mutant that downgraded
     * UNKNOWN to `{status:'unset'}` at the projector left the whole suite GREEN
     * (M4, survivor). The assertion was about the ASSEMBLER's conditional
     * spread, not about the projector's null branch, while its name claimed the
     * latter. A guard whose evidence comes from itself.
     *
     * These two close it at the projector, where the decision is actually made.
     */
    it('the projector itself returns UNDEFINED for a missing graph (not "unset")', () => {
      expect(projectGoalTargetRecord(null)).toBeUndefined();
      expect(projectGoalTargetRecord(undefined)).toBeUndefined();
    });

    it('DISCRIMINATION — a graph that IS present and bare returns unset, not undefined', () => {
      // Without this pair the test above would pass on a projector that
      // returned `undefined` for everything, which would be the J-F5 dead end
      // wearing the honest answer's clothes.
      expect(projectGoalTargetRecord(makeGraph())).toEqual({ status: 'unset' });
    });
  });

  describe("WHY THE EXISTING RECEIPT GUARD DID NOT FIRE — its domain, pinned", () => {
    const bareGraph = { nodes: [goalNode()], edges: [] };

    it('the guard is blind to a QUOTATION of state (it polices registration CLAIMS)', () => {
      // The witnessed sentence describes recorded state; it does not claim a
      // registration, and the user's noun was "success measure", not the
      // literal bigram "success target" the guard's arms require.
      const witnessed = `Your success measure is ${MENTIONED_ONLY_VALUE}% CSAT.`;
      const decision = decideGoalTargetReceipt({
        assistantText: witnessed,
        commitGraph: null,
        persistedGraph: bareGraph,
      });

      // Characterisation of the CURRENT domain — this documents the gap the
      // pack-side fix closes. It is deliberately NOT a wish that the guard
      // widen: widening a natural-language predicate is the oscillation trap.
      expect(decision).toEqual({ verdict: 'pass', reason: 'no_claim', consequences: { withholdGraphWrite: false, withholdReceiptFacts: false } });
    });

    it('the guard DOES fire on a registration claim it was built for (positive control)', () => {
      const decision = decideGoalTargetReceipt({
        assistantText: 'Success target set: Maintain customer satisfaction at least 85%.',
        commitGraph: null,
        persistedGraph: bareGraph,
      });

      // Without this control the test above would pass just as happily if
      // `decideGoalTargetReceipt` were broken and returned 'pass' for
      // everything — an absence proof needs a presence proof beside it.
      expect(decision).toEqual({ verdict: 'swap', reason: 'unbacked_claim', consequences: { withholdGraphWrite: true, withholdReceiptFacts: true } });
    });
  });
});
