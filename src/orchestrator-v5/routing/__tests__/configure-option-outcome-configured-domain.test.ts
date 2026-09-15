/**
 * ⭐⭐⭐ ⚠ READ THIS FIRST — THE DEFECT THIS FILE DIAGNOSED IS CLOSED (15 Sep
 * 2026, the deliberate-edit lane). Everything below the next rule is the
 * DIAGNOSIS that led to the fix, and it is kept verbatim because it names the
 * mechanism and the instrument failure that found it. **The assertions have
 * been inverted; the prose describing the old behaviour has NOT been rewritten
 * to match, because it is a record of what the product did on a dated build.**
 *
 * WHAT CHANGED: `configure-option-outcome.ts` now resolves the target with
 * `resolveConfigureOptionTarget` — `readiness.options` WHOLE, no
 * outstanding-slot bound, no sole-unconfigured fallback — and emits a new
 * `not_honoured_no_copy` verdict when the option is resolvable but the recovery
 * copy has no true sentence for it. The COPY domain bound is untouched. So a
 * REVISION is protected on the same terms as a first configuration, and the
 * product still says nothing untrue about it.
 *
 * ⚠ THE TWO ASSERTIONS THIS FILE WAS BUILT AROUND WENT RED, AND THAT IS WHAT
 * LANDING LOOKED LIKE. They now pin the new behaviour, each carrying the
 * superseded expectation beside it so the before/after is legible.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *
 * ⭐⭐ THE WRONG-ENTITY GUARD CAN ONLY SPEAK WHILE SOME OPTION×FACTOR SLOT IS
 * STILL UNSET — so it protects the FIRST configuration of a model and never a
 * REVISION, which is where the harm it was built for actually lives.
 *
 * `configure-option-outcome.ts` (ROADMAP 2.427) exists to stop this exact harm:
 * the user names an OPTION, the product writes an EDGE or a FACTOR baseline,
 * and reports success. `option-intervention-write-guard.ts` withholds the write
 * for the same case and takes BOTH its intent and its option identity from
 * `evaluateConfigureOptionOutcome` — so both guards are downstream of the one
 * verdict this file measures.
 *
 * ── THE BOUND, DERIVED AT THE BYTES ───────────────────────────────────────
 * `resolveConfigureOptionFacts` (configure-option-clarify.ts) builds its
 * candidate set from `outstandingSlotsByOption(readiness)`, which is a
 * projection of `deriveMissingEffectPairs` — the estate's owner of "which
 * option×factor slots are still unset". When every slot is filled the set is
 * empty and the resolver declines at:
 *
 *     const candidates = outstandingSlotsByOption(readiness);
 *     if (candidates.length === 0) return decline('no_unconfigured_option');
 *
 * A drafted graph arrives with its option effect values already populated, and
 * a successful configuration fills the rest. So on any graph a user is actually
 * editing, there is nothing outstanding, the resolver declines, and the guard
 * abstains — with the wrong-entity write sitting in the applied graph.
 *
 * ⚠ THE SKIP REASON DOES NOT NAME THIS. `evaluateConfigureOptionOutcome`
 * collapses EVERY resolver decline into one value:
 *
 *     if (!target.matched) return { status: 'not_applicable',
 *                                   reason: 'option_not_identified' };
 *
 * so `no_unconfigured_option`, `no_readiness`, `graph_unparseable` and
 * `no_candidate_factor` all surface as "option_not_identified" — a name that
 * says the option could not be resolved when in fact resolution was never
 * attempted. This spec pins the TRUE reason beside the flattened one so the
 * next reader is not misled by the enum, as the author of this spec was.
 *
 * ⚠ I HAD THIS WRONG FIRST, and only a mutant caught it. My first version of
 * this file blamed the `needs_encoding` DOMAIN BOUND further down
 * `buildConfigureOptionRecoveryCopy`. Deleting that bound outright left all
 * five tests GREEN — the bound is never reached, because the resolver has
 * already declined one function earlier. A characterisation spec that names
 * the wrong cause is worse than none: it aims the next lane's fix at code that
 * does not decide anything. The mutant pair below is what found that, not
 * review and not inspection.
 *
 * ── WHAT WAS MEASURED ─────────────────────────────────────────────────────
 * Driven live against deployed CEE staging `a606a99e` on 14 Sep 2026, 46 real
 * turns across four message phrasings, every one of which the shipped intent
 * detector MATCHED: `evaluateConfigureOptionOutcome` returned `not_applicable`
 * on **46 of 46** — 40 flattened `option_not_identified`, 6 `option_not_named`.
 * Not one reached a verdict. Six of those turns moved an edge's
 * `strength`/`exists_probability` or a factor's shared `observed_state` and
 * told the user it had worked.
 *
 * ⚠⚠ ~~THIS SPEC PINS CURRENT BEHAVIOUR. It is GREEN at pristine and is NOT a
 * fix — widening the candidate set changes which options the 2.427 TEXT guard
 * speaks about, which `option-intervention-write-guard.ts` explicitly calls a
 * bigger blast radius than one lane owns. That is re-briefed, not done here.~~
 * It WAS re-briefed and it IS done — and the blast radius that worried this
 * paragraph was handled not by widening the TEXT guard but by splitting the
 * verdict, so the text guard's domain never moved at all.
 * RED-first does not apply to a characterisation spec; the discipline that
 * replaces it is the DISCRIMINATING PAIR below — the same message, the same
 * wrong-entity write, differing only in whether a slot is outstanding. The
 * configured arm abstains; the unconfigured arm catches it and names the
 * option. One arm alone shows nothing: the first proves the bound decides the
 * verdict, the second proves the guard was never broken, only out of scope.
 *
 * ⚠ AND THE FIX THIS FILE EXISTS TO PREVENT: the gap is NOT in
 * `detectConfigureOptionIntent`. The detector matched every measured phrasing,
 * including the `effect_vocab` family the defect was first reported under. A
 * lane that "fixes" the detector will widen a predicate that was already
 * correct and leave the harm exactly where it is.
 */
import { describe, expect, it } from 'vitest';
import {
  detectConfigureOptionIntent,
  projectOptionLabels,
} from '../configure-option-intent.js';
import { buildConfigureOptionRecoveryCopy } from '../configure-option-clarify.js';
import { evaluateConfigureOptionOutcome } from '../configure-option-outcome.js';
import { WRONG_ENTITY_WRITE_CAPTURE } from './wrong-entity-write-capture.fixture.js';

const CAPTURE = WRONG_ENTITY_WRITE_CAPTURE;
const { option_id: OPTION_ID, factor_id: FACTOR_ID, turn_message: MESSAGE } =
  CAPTURE.provenance;

type Graph = { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> };

/** The capture with the NAMED option's effect values removed — nothing else. */
function asNeedsEncoding(graph: unknown): Graph {
  const clone = JSON.parse(JSON.stringify(graph)) as Graph;
  for (const node of clone.nodes) {
    if (node.id === OPTION_ID) {
      delete node.interventions;
      delete node.data;
    }
  }
  return clone;
}

function optionInterventionValue(graph: unknown, optionId: string, factorId: string): unknown {
  const node = (graph as Graph).nodes.find((n) => n.id === optionId);
  const bundle = node?.interventions as Record<string, { value?: unknown }> | undefined;
  return bundle?.[factorId]?.value;
}

function edgeField(graph: unknown, from: string, to: string, field: string): unknown {
  return (graph as Graph).edges.find((e) => e.from === from && e.to === to)?.[field];
}

describe('configure-option outcome guard — the configured-option domain', () => {
  /**
   * ⭐ THE FIXTURE'S OWN PRECONDITION, PINNED IN-TEST (trap 13b).
   *
   * Every assertion below is only meaningful while this capture really is a
   * wrong-entity write. If a later edit to the fixture made the option's own
   * value move, the `not_applicable` pin would still pass — and would be
   * asserting nothing. So the harm is asserted directly, on the bytes, before
   * any predicate is consulted.
   */
  it('the capture is a wrong-entity write: the edge moved, the named option did not', () => {
    expect(optionInterventionValue(CAPTURE.before, OPTION_ID, FACTOR_ID)).toBe(0.49);
    expect(optionInterventionValue(CAPTURE.after, OPTION_ID, FACTOR_ID)).toBe(0.49);

    expect(edgeField(CAPTURE.before, OPTION_ID, FACTOR_ID, 'exists_probability')).toBe(1);
    expect(edgeField(CAPTURE.after, OPTION_ID, FACTOR_ID, 'exists_probability')).toBe(0.79);

    // And the product told the user it had worked.
    expect(CAPTURE.provenance.assistant_text).toBe(
      'Updated edge from Hold Price at £49 (Status Quo) to Pro Plan Monthly Price',
    );
    expect(CAPTURE.provenance.pre_graph_hash).not.toBe(CAPTURE.provenance.post_graph_hash);
  });

  /**
   * The detector is NOT the gap. Both live phrasing families reach the edit
   * lane and are recognised as configure-option intent.
   */
  it('the intent detector matches both measured phrasing families', () => {
    const labels = projectOptionLabels(CAPTURE.before.nodes as never);

    const captured = detectConfigureOptionIntent(MESSAGE, labels);
    expect(captured.matched).toBe(true);
    expect(captured.matched && captured.trigger).toBe('option_value_set');

    // The family the defect was first reported under, same graph.
    const effectPhrasing =
      "Set the Hold Price at £49 (Status Quo) option's effect on Pro Plan Monthly Price to 79%";
    const effect = detectConfigureOptionIntent(effectPhrasing, labels);
    expect(effect.matched).toBe(true);
    expect(effect.matched && effect.trigger).toBe('effect_vocab');
  });

  /**
   * ⭐⭐ THE MEASURED GAP — NOW CLOSED. THIS PIN GOING RED WAS THE FIX LANDING.
   *
   * ── WHAT THIS CASE ASSERTED AT `1690c1f3`, AND WHY IT WAS RIGHT THEN ─────
   * ~~`expect(verdict.status).toBe('not_applicable')`~~ with the true cause one
   * layer down, ~~`resolved.reason === 'no_unconfigured_option'`~~: nothing was
   * outstanding on this graph, so `resolveConfigureOptionFacts` declined before
   * resolution was ever attempted, and `evaluateConfigureOptionOutcome`
   * flattened that to `option_not_identified` — a name that says the option
   * could not be resolved when in fact nobody had looked.
   *
   * ── WHAT CHANGED ─────────────────────────────────────────────────────────
   * `resolveConfigureOptionTarget` now answers *which option did the user
   * name?* from `readiness.options` WHOLE, so a configured option is a
   * perfectly good answer and this revision is resolved by name. The COPY
   * predicate keeps its domain bound — the recovery sentence is still false of
   * this option — so the verdict is `not_honoured_no_copy`: the write is
   * protected and the product says nothing new.
   *
   * The FLATTENING is gone too: the verdict now carries the copy predicate's
   * own decline reason rather than a catch-all, which is the second defect this
   * file pinned.
   */
  it('reaches a write-protecting verdict for an already-configured option', () => {
    const verdict = evaluateConfigureOptionOutcome({
      message: MESSAGE,
      before: CAPTURE.before,
      after: CAPTURE.after,
    });

    expect(verdict.status).toBe('not_honoured_no_copy');
    // IDENTITY (trap 19) — about the option the user NAMED, never "an option".
    expect(verdict.status === 'not_honoured_no_copy' && verdict.optionId).toBe(OPTION_ID);
    expect(verdict.status === 'not_honoured_no_copy' && verdict.copyDeclineReason).toBe(
      'option_already_partially_configured',
    );

    // The copy bound, one layer down, asserted directly: the recovery predicate
    // still refuses this option, so the untrue sentence stays uncomposable.
    const resolved = buildConfigureOptionRecoveryCopy({
      message: MESSAGE,
      detection: detectConfigureOptionIntent(
        MESSAGE,
        projectOptionLabels(CAPTURE.before.nodes as never),
      ),
      graph: CAPTURE.before,
    });
    expect(resolved.matched).toBe(false);
    expect(!resolved.matched && resolved.reason).toBe('option_already_partially_configured');
  });

  /**
   * ⭐⭐ THE DISCRIMINATING TWIN. Identical message, identical graphs, identical
   * wrong-entity write — the ONLY difference is that the named option has no
   * effect values yet. The guard now sees the harm and names the option.
   *
   * This is what makes the pin above a statement about the CANDIDATE SET rather
   * than about a broken guard: the guard is fully capable, and is simply not
   * asked, because nothing on the configured graph is outstanding.
   *
   * Bound by IDENTITY (trap 19) — `optionId` is asserted to be the option the
   * user actually named, never merely "some option was reported".
   */
  it('reaches a not_honoured verdict for the SAME write when the option is unconfigured', () => {
    const verdict = evaluateConfigureOptionOutcome({
      message: MESSAGE,
      before: asNeedsEncoding(CAPTURE.before),
      after: asNeedsEncoding(CAPTURE.after),
    });

    expect(verdict.status).toBe('not_honoured');
    expect(verdict.status === 'not_honoured' && verdict.optionId).toBe(OPTION_ID);
    expect(verdict.status === 'not_honoured' && verdict.optionLabel).toBe(
      CAPTURE.provenance.option_label,
    );
  });

  /**
   * ⭐ THE SET THAT WAS KNOWN-UNPROTECTED, PINNED EXACTLY — NOW PROTECTED.
   *
   * ~~The skip reason observed across every configured-graph phrasing~~ was
   * `['option_not_identified']` for all four live phrasings at `1690c1f3`. It
   * was pinned so the suite would RED if the set GREW (a new way to abstain) or
   * SHRANK (the candidate set widened — the fix). **It shrank to empty, which
   * is the fix.**
   *
   * The pin stays, inverted: all four phrasings must now reach the SAME
   * write-protecting verdict about the SAME option. Kept as a set over four
   * real phrasings rather than one, because the original defect was uniform
   * across them and a regression would not be.
   */
  it('pins the verdict across every phrasing measured live on a configured graph', () => {
    const labels = projectOptionLabels(CAPTURE.before.nodes as never);
    const phrasings = [
      MESSAGE,
      "Set the Hold Price at £49 (Status Quo) option's effect on Pro Plan Monthly Price to 79%",
      "Set the Hold Price at £49 (Status Quo) option's effect on Pro Plan Monthly Price to 0.79",
      "Set the Hold Price at £49 (Status Quo) option's effect on Pro Plan Monthly Price to £79",
    ];

    const observed = new Set<string>();
    const optionIds = new Set<string>();
    for (const message of phrasings) {
      // Every phrasing must reach the edit lane, or this test is measuring the
      // detector rather than the domain bound.
      expect(detectConfigureOptionIntent(message, labels).matched).toBe(true);

      const verdict = evaluateConfigureOptionOutcome({
        message,
        before: CAPTURE.before,
        after: CAPTURE.after,
      });
      observed.add(
        verdict.status === 'not_applicable' ? `not_applicable:${verdict.reason}` : verdict.status,
      );
      if (verdict.status === 'not_honoured_no_copy') optionIds.add(verdict.optionId);
    }

    expect([...observed].sort()).toEqual(['not_honoured_no_copy']);
    // IDENTITY, not merely "a verdict was reached" (trap 19).
    expect([...optionIds]).toEqual([OPTION_ID]);
  });
});
