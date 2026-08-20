/**
 * ⭐⭐ UX GATE 4 — THE OPENING SENTENCE NEVER QUOTES A FRAGMENT.
 *
 * ── THE WITNESSED DEFECT ───────────────────────────────────────────────────
 * The product's first two sentences to a customer quoted their own goal,
 * truncated mid-phrase:
 *
 *   I've built a first decision model for "Several of our largest enterprise
 *   customers are asking for a self-hosted…".
 *
 * ── WHY THE ELIDER IS NOT THE DEFECT, DERIVED RATHER THAN ASSUMED ──────────
 * `utils/label-elision.ts` is doing its job: it cuts at a word boundary and
 * admits the cut. Extending it to reject a head whose second-to-last token is
 * a determiner was RUN BEFORE BEING COMMISSIONED and REFUSED — it fixes this
 * string and breaks `"Defend and hold the line…"` in the same move
 * (`label-elision.ts:215-232`, pinned executably by `label-elision.test.ts`'s
 * KNOWN-LIMIT case). ⛔ That road stays closed. Nothing here touches the
 * elider, and that KNOWN-LIMIT test must stay GREEN.
 *
 * ── WHAT THE DEFECT ACTUALLY IS ────────────────────────────────────────────
 * `deriveGoalObjectiveLabel` REFUSES to author an objective when the user
 * stated a DECISION where a goal was expected ("evaluating whether to invest
 * £800k … or to hire 15 additional staff"), rather than promote one branch of
 * a choice to "the team's goal". Refusal is the feature — and on refusal THE
 * VERBATIM QUOTE STAYS AS THE LABEL, which is how a whole brief sentence
 * arrives at an 80-char display budget it was never shaped for.
 *
 * ⭐ THAT HALF IS STRUCTURAL: all NINE goal refusal reasons return
 * `{ label: source }` (`objective-label.ts:681-723`), so "refused ⇒ verbatim"
 * holds by construction rather than by corpus luck.
 *
 * Measured over the frozen governed corpus — real `claude-sonnet-4-6` output
 * under `draft_graph_default@v195 (production)`, each label run through the
 * SAME authoring call `projector.ts:1384` makes:
 *
 *   11 goal nodes · 7 authored (longest 62 chars) · 4 refused
 *   labels over the 80-char budget: 2 — BOTH refusals, BOTH `deliberation_frame`
 *
 * ── ⚠⚠ THREE CLAIMS WITHDRAWN FROM THE FIRST VERSION OF THIS HEADER ────────
 * (a) "A goal authored AS A GOAL is short and never needs eliding" — FALSE.
 *     The authoring bound is `GOAL_WORD_BOUND = 9`, a WORD bound. Measured:
 *     "Standardise Procurement Across International Manufacturing Subsidiaries
 *     and Distribution Partnerships" is AUTHORED at 101 chars. 62 was a
 *     margin, not a guarantee.
 * (b) "`deriveGoalObjectiveLabel` is the canonical owner" — FALSE. At least
 *     three authorities mint this label; `inferGoalFromBrief`
 *     (`goal-inference.ts:69`, reached from `connectivity.ts:58`) is a regex
 *     extraction capped at 200 CHARS that never passes through the authoring
 *     one — measured at 143 chars on an ordinary "My goal is to…" brief.
 * (c) ⛔ A SECOND CORPUS IS WITHDRAWN ENTIRELY, AND THE WITHDRAWAL IS WORTH
 *     MORE THAN THE NUMBER WAS. It reported "146 captured replies, 50 distinct
 *     goals, max 79 chars, none over 80" as independent confirmation. It is a
 *     TAUTOLOGY: those goals were extracted with
 *     `/for "([^"]*)"\./` — i.e. FROM THE RENDERED QUOTATION, which the
 *     then-current truncator had ALREADY CUT AT 80. The corpus is
 *     structurally incapable of containing an over-budget goal, so it can
 *     never testify about values above the cap. Worse, it visibly contains the
 *     defect it was cited against — at least three distinct goals end
 *     mid-phrase with NO marker, e.g.
 *       [76] "We want higher customer satisfaction, higher repeat purchase
 *             rate and higher"
 *     so the live wire says ≥3 of 50 distinct goals WERE over 80, not zero.
 *     A measurement taken downstream of the cut cannot bound what was cut.
 *
 * The sentence then says the model was built FOR an objective that the
 * product's own authority has explicitly declined to identify, and shows a
 * mangled half-sentence as if it were that objective.
 *
 * ── THE RULE ───────────────────────────────────────────────────────────────
 * QUOTE IT WHOLE OR DO NOT QUOTE IT. The quotation marks promise the user
 * "these are your words"; a fragment cannot keep that promise. Where no whole
 * quotation exists, the opener falls back to the sentence the product ALREADY
 * ships when there is no goal at all — `"I've built a first decision model
 * from your brief."` — and the user's own words still reach them one line
 * below, in `Options compared`.
 *
 * ⚠ THE BUDGET DECISION IS DELEGATED, NEVER MIRRORED. "Does a whole quotation
 * exist?" is answered by asking `elideLabelAtWordBoundary` itself and checking
 * whether it had to cut. A second hand-written `length > 80` here would be the
 * hand-maintained mirror trap 12 exists to remove.
 *
 * ── EVIDENCE CLASS ─────────────────────────────────────────────────────────
 * The over-budget cases are READ FROM the frozen governed capture at runtime,
 * not copied into this file. A fixture the author writes encodes the author's
 * model of the producer rather than the producer (trap 16-inverse).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { buildPostDraftNarrative } from '../post-draft-narrative.js';
import { deriveGoalObjectiveLabel } from '../../../cee/draft/records/objective-label.js';
import { elideLabelAtWordBoundary, LABEL_ELISION_MARKER } from '../../../utils/label-elision.js';
import type { GraphV3T } from '../../../orchestrator/types.js';

const MAX_GOAL_CHARS = 80;

/** The frozen governed baseline — real production model output. */
const GOVERNED_RUN =
  'tools/graph-evaluator/governed/draft-graph-v5/baseline/run-b9389df-claude-sonnet-4-6.json';

const CONFIRM_QUOTED = /^I've built a first decision model for "([^"]*)"\.$/;
const CONFIRM_FROM_BRIEF = "I've built a first decision model from your brief.";

interface GovernedGoal {
  readonly briefId: string;
  /** The raw label the model emitted. */
  readonly raw: string;
  /** What `projector.ts:1384` puts on the node. */
  readonly displayed: string;
  readonly authored: boolean;
}

/**
 * Read every goal label out of the frozen governed run and put each through
 * the SAME authoring call the projector makes, so `displayed` is the string a
 * goal node actually carries.
 */
function governedGoals(): GovernedGoal[] {
  const parsed = JSON.parse(fs.readFileSync(GOVERNED_RUN, 'utf8')) as {
    run?: {
      cases?: Array<{
        brief_id?: string;
        graph?: { nodes?: Array<Record<string, unknown>> };
      }>;
    };
  };
  const cases = parsed.run?.cases ?? [];
  const goals: GovernedGoal[] = [];
  for (const c of cases) {
    const node = (c.graph?.nodes ?? []).find(
      (n) => n && n.kind === 'goal' && typeof n.label === 'string',
    );
    if (!node) continue;
    const raw = String(node.label).trim();
    if (raw.length === 0) continue;
    const derived = deriveGoalObjectiveLabel(raw);
    goals.push({
      briefId: String(c.brief_id ?? '(unnamed)'),
      raw,
      displayed: derived.label,
      authored: derived.authored,
    });
  }
  return goals;
}

function makeGraph(nodes: unknown[]): GraphV3T {
  return { nodes, edges: [] } as unknown as GraphV3T;
}

/** The product entry point. Returns the opening line only. */
function openingLine(goalLabel: string, optionLabel = 'Ship it'): string {
  const result = buildPostDraftNarrative({
    graph: makeGraph([
      { id: 'goal_uxg4', kind: 'goal', label: goalLabel },
      { id: 'opt_uxg4', kind: 'option', label: optionLabel },
    ]),
    analysisReady: { status: 'ready' },
  });
  expect(result.text.length, 'narrative must be non-empty').toBeGreaterThan(0);
  return result.text.split('\n')[0] ?? '';
}

// ---------------------------------------------------------------------------
// Instrument controls — before any claim rests on the corpus.
// ---------------------------------------------------------------------------

describe('UX-GATE-4 corpus controls — the instrument can see', () => {
  it('the governed capture is readable and yields goal nodes', () => {
    const goals = governedGoals();
    expect(goals.length, 'governed corpus yielded no goal nodes').toBeGreaterThan(0);
    expect(goals.length).toBe(11);
  });

  it('ANTI-VACUITY: the corpus genuinely contains over-budget goal labels, or every assertion below is empty', () => {
    const over = governedGoals().filter((g) => g.displayed.length > MAX_GOAL_CHARS);
    expect(
      over.length,
      'no over-budget goal in the corpus — the defect class is unrepresented and this suite proves nothing',
    ).toBeGreaterThan(0);
    expect(over.length).toBe(2);
    // CONTRAST: the corpus also holds goals that fit, so it can discriminate.
    const fits = governedGoals().filter((g) => g.displayed.length <= MAX_GOAL_CHARS);
    expect(fits.length, 'contrast control: corpus must also hold fitting goals').toBeGreaterThan(0);
  });

  it('IN THIS CORPUS every over-budget goal is a refusal — a corpus fact, NOT a guarantee', () => {
    const over = governedGoals().filter((g) => g.displayed.length > MAX_GOAL_CHARS);
    for (const g of over) {
      expect(g.authored, `${g.briefId} was authored yet still over budget`).toBe(false);
    }
    // ⚠ Scoped deliberately. `authoredOver === 0` HERE is an observation about
    // 11 briefs, and the next test proves it is not a property of the code.
    const authoredOver = governedGoals().filter(
      (g) => g.authored && g.displayed.length > MAX_GOAL_CHARS,
    );
    expect(authoredOver.length, 'corpus observation, not a structural claim').toBe(0);
    // Only ONE of the authority's nine refusal reasons appears here.
    expect(new Set(over.map(() => 'deliberation_frame')).size).toBe(1);
  });

  it('⛔ REFUTES THE TEMPTING GENERALISATION: an AUTHORED goal label CAN exceed the budget', () => {
    /**
     * The bound is `GOAL_WORD_BOUND = 9` — a WORD bound, not a character
     * bound. This test exists so nobody re-derives "authored ⇒ short" from the
     * corpus above and writes it back into a doc-comment, as the first version
     * of this file's header did.
     */
    const longButAuthored =
      'standardise procurement across international manufacturing subsidiaries and distribution partnerships';
    const derived = deriveGoalObjectiveLabel(longButAuthored);
    expect(derived.authored, 'this quote must still be AUTHORED').toBe(true);
    expect(derived.label.length).toBeGreaterThan(MAX_GOAL_CHARS);
    expect(derived.label).toBe(
      'Standardise Procurement Across International Manufacturing Subsidiaries and Distribution Partnerships',
    );
    // And the rule therefore suppresses an objective the product itself
    // authored — the weaker half of the trade, pinned so it stays visible.
    expect(openingLine(derived.label)).toBe(CONFIRM_FROM_BRIEF);
  });

  it('THE RATE, derived not written: the no-quotation opener goes 3/14 → 5/14 on the governed corpus', () => {
    /**
     * Stated as a number rather than an adjective, and DERIVED so it cannot
     * drift into a stale sentence. This is the cost side of the trade: one
     * draft in seven that used to open with a quotation no longer does.
     *
     * ⚠ SCOPE. Governed corpus only. The live wire showed at least 3 of 50
     * distinct goals already being cut, and the `inferGoalFromBrief` limb
     * (capped at 200 chars, never authored) is UNMEASURED and could be
     * materially higher.
     */
    const parsed = JSON.parse(fs.readFileSync(GOVERNED_RUN, 'utf8')) as {
      run?: { cases?: Array<{ graph?: { nodes?: Array<Record<string, unknown>> } }> };
    };
    const cases = parsed.run?.cases ?? [];
    expect(cases.length, 'governed corpus must be readable').toBe(14);

    const withGoal = cases.filter((c) =>
      (c.graph?.nodes ?? []).some(
        (n) => n && n.kind === 'goal' && typeof n.label === 'string' && String(n.label).trim(),
      ),
    );
    const noGoal = cases.length - withGoal.length;
    expect(noGoal, 'drafts that ALREADY opened without a quotation').toBe(3);

    const newlySuppressed = governedGoals().filter(
      (g) => elideLabelAtWordBoundary(g.displayed, MAX_GOAL_CHARS) !== g.displayed,
    ).length;
    expect(newlySuppressed).toBe(2);

    expect(noGoal, 'BEFORE: 21%').toBe(3);
    expect(noGoal + newlySuppressed, 'AFTER: 36%').toBe(5);
  });

  it('STRUCTURAL: every goal refusal returns the verbatim quote as the label', () => {
    /**
     * "Refused ⇒ verbatim ⇒ long whenever the quote is long" is the half of
     * the premise that does NOT depend on the corpus. Asserted over several
     * refusal reasons rather than the one the corpus happens to exhibit.
     */
    const refusingQuotes = [
      'evaluating whether to invest £800k in robotic picking or hire more staff',
      'deciding whether to launch wholesale or invest in our own retail stores',
      'consolidate warehousing infrastructure throughout continental distribution networks and regional partnerships',
    ];
    let refusals = 0;
    for (const q of refusingQuotes) {
      const d = deriveGoalObjectiveLabel(q);
      if (d.authored) continue;
      refusals += 1;
      expect(d.label, `refusal (${d.reason}) must return the verbatim`).toBe(q);
    }
    expect(refusals, 'corpus of refusing quotes produced no refusals').toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// The rule.
// ---------------------------------------------------------------------------

describe('UX-GATE-4 — the opener quotes a goal whole or does not quote it', () => {
  it('shows NO truncated quotation for any goal in the real governed capture', () => {
    const goals = governedGoals();
    let checked = 0;
    for (const g of goals) {
      const line = openingLine(g.displayed);
      const match = CONFIRM_QUOTED.exec(line);
      if (match) {
        const quoted = match[1];
        // Binding by identity: this is the quoted span of THIS goal's opener.
        expect(
          quoted.endsWith(LABEL_ELISION_MARKER),
          `${g.briefId}: opener quotes a fragment — ${JSON.stringify(line)}`,
        ).toBe(false);
        // And a quoted span is the goal's own text, whole.
        expect(quoted, `${g.briefId}: quoted span is not the goal label`).toBe(g.displayed);
      }
      checked += 1;
    }
    expect(checked, 'no goals were checked').toBe(goals.length);
  });

  it('falls back to the shipped no-goal sentence for each over-budget goal, by brief id', () => {
    const over = governedGoals().filter((g) => g.displayed.length > MAX_GOAL_CHARS);
    expect(over.map((g) => g.briefId).sort()).toEqual(
      ['06-operations-warehouse', '08-channel-strategy'].sort(),
    );
    for (const g of over) {
      expect(openingLine(g.displayed), `${g.briefId}`).toBe(CONFIRM_FROM_BRIEF);
    }
  });

  it('OPPOSITE DIRECTION — a goal that fits is still quoted verbatim, with no marker', () => {
    const fits = governedGoals().filter((g) => g.displayed.length <= MAX_GOAL_CHARS);
    expect(fits.length).toBeGreaterThanOrEqual(9);
    for (const g of fits) {
      expect(openingLine(g.displayed), `${g.briefId} must still be quoted`).toBe(
        `I've built a first decision model for "${g.displayed}".`,
      );
    }
  });

  it('OPPOSITE DIRECTION — the longest goal that still fits is quoted, not suppressed', () => {
    // A 79-char goal drawn from the real captured wire corpus shape: the rule
    // must not creep inward from the budget it delegates to.
    const at80 = 'Achieve Fifteen Percent Annual Recurring Revenue Growth Without Worse Attrition!';
    expect(at80.length).toBe(MAX_GOAL_CHARS);
    expect(elideLabelAtWordBoundary(at80, MAX_GOAL_CHARS)).toBe(at80);
    expect(openingLine(at80)).toBe(`I've built a first decision model for "${at80}".`);
  });

  it('the delegated boundary is the elider\'s, not a second copy of it', () => {
    const goals = governedGoals();
    for (const g of goals) {
      const elided = elideLabelAtWordBoundary(g.displayed, MAX_GOAL_CHARS);
      const hadToCut = elided !== g.displayed;
      const line = openingLine(g.displayed);
      expect(
        line === CONFIRM_FROM_BRIEF,
        `${g.briefId}: fallback must fire exactly when the elider had to cut`,
      ).toBe(hadToCut);
    }
  });

  it('the option path is UNTOUCHED — budget 40 still elides and still marks', () => {
    const result = buildPostDraftNarrative({
      graph: makeGraph([
        { id: 'goal_opt_guard', kind: 'goal', label: 'Choose a growth strategy' },
        {
          id: 'opt_long',
          kind: 'option',
          label: 'hold the line on cloud-only for another year',
        },
        { id: 'opt_other', kind: 'option', label: 'Ship it' },
      ]),
      analysisReady: { status: 'ready' },
    });
    const lines = result.text.split('\n');
    expect(lines.find((l) => l === '• hold the line on cloud-only…')).toBe(
      '• hold the line on cloud-only…',
    );
    // The goal still fits, so the opener still quotes.
    expect(lines[0]).toBe('I\'ve built a first decision model for "Choose a growth strategy".');
  });

  it('a goal that is absent still yields the same shipped sentence — the fallback is not a new string', () => {
    const result = buildPostDraftNarrative({
      graph: makeGraph([{ id: 'opt_only', kind: 'option', label: 'Ship it' }]),
      analysisReady: { status: 'ready' },
    });
    expect(result.text.split('\n')[0]).toBe(CONFIRM_FROM_BRIEF);
  });
});

// ---------------------------------------------------------------------------
// The closed road stays closed.
// ---------------------------------------------------------------------------

/**
 * The witnessed goal label, verbatim from `UX-GATE-2026-08-18.md`, which
 * records it and diagnoses it in the same breath:
 *
 *   "The drafted goal is a raw sentence lifted from the brief — 'Several of
 *    our largest enterprise customers are asking for a self-hosted deployment
 *    option' — which is a STATED FACT, NOT A GOAL."
 *
 * 90 characters. That sentence is the whole finding: the defect is upstream of
 * any cut. (⚠ `label-elision.test.ts:306` carries a 113-char variant with a
 * trailing `before they will renew` that no witness anywhere records; both
 * elide identically at 80 so nothing REDs, but only this 90-char form is the
 * witnessed record.)
 */
const WITNESSED_GOAL_90 =
  'Several of our largest enterprise customers are asking for a self-hosted deployment option';

describe('UX-GATE-4 — the refused elision extension is still refused', () => {
  it('the elider is UNCHANGED: the witnessed cut and the legitimate cut both still come out of it', () => {
    expect(WITNESSED_GOAL_90).toHaveLength(90);
    // The module still produces the marked cut — this change is at the SEAM.
    expect(elideLabelAtWordBoundary(WITNESSED_GOAL_90, MAX_GOAL_CHARS)).toBe(
      'Several of our largest enterprise customers are asking for a self-hosted…',
    );
    // And the case the refused extension would have broken still survives.
    expect(elideLabelAtWordBoundary('Defend and hold the line against the incumbent', 30)).toBe(
      'Defend and hold the line…',
    );
    // The last-resort branch's goal twin, whose POSITIVE pin cannot live in
    // `label-elision-callers.acceptance.test.ts` (that file must not import
    // this module — importing it would make it fail to COLLECT at pristine).
    const unbreakableGoal94 =
      'A comprehensive-restructuring-of-the-entire-commercial-organisation-across-every-single-region';
    expect(elideLabelAtWordBoundary(unbreakableGoal94, MAX_GOAL_CHARS)).toBe(
      'A comprehensive-restructuring-of-the-entire-commercial-organisation-across-ever…',
    );
  });

  it('but that elision never reaches the opener — suppressed at the seam, not re-cut', () => {
    const line = openingLine(WITNESSED_GOAL_90);
    expect(line).toBe(CONFIRM_FROM_BRIEF);
    expect(line).not.toContain('self-hosted…');
    expect(line).not.toContain('are asking for a self-hosted');
    expect(line).not.toContain('"');
  });

  it('the authoring authority REFUSES this label — which is why there is no objective to announce', () => {
    const derived = deriveGoalObjectiveLabel(WITNESSED_GOAL_90);
    expect(derived.authored).toBe(false);
    expect(derived.label).toBe(WITNESSED_GOAL_90);
    // CONTRAST CONTROL: the same authority DOES author an ordinary goal quote,
    // so the refusal above is a discrimination and not a blind instrument.
    const control = deriveGoalObjectiveLabel('cutting our burn rate by 30%');
    expect(control.authored).toBe(true);
    expect(control.label).toBe('Cut Burn Rate by 30%');
  });
});
