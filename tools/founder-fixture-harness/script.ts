/**
 * THE ELEVEN TURNS — fixed, in order, verbatim.
 *
 * Source of truth: `artefacts/founder-fixture/SCRIPT.md` on branch
 * `primary/founder-fixture-2026-09-04` of `Talchain/olumi-programme-docs`.
 * The strings below are that file's table, character for character (straight
 * apostrophes, UTF-8 `£`). They are NOT to be reworded, "improved", or
 * localised: README.md's rule is "Do not help the product. Ordinary
 * conversational phrasing only."
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ⚠ THE OFF-BY-ONE IS IN THE FIXTURE, AND IT IS NAMED HERE RATHER THAN
 * SILENTLY RESOLVED.
 *
 * SCRIPT.md says "Turn 1 is the verbatim brief ... Then:" and its table then
 * numbers rows 1..11. So "turn 4" means the £80 question under the table's
 * numbering and the brief under the prose's. Twelve things go on the wire
 * either way.
 *
 * THIS FILE USES THE TABLE NUMBERING (1..11), because that is what every
 * downstream artefact already uses: `compose/process-narration.ts` cites the
 * lived leaks at the fixture's turn 7 (the misroute) and turn 8 (the flat 50%
 * strengths), and ACCEPTANCE.md's C5/C6 name "turn 5", "turn 6", "turn 7" from
 * the table. The brief is `BRIEF_TURN_INDEX = 0`.
 *
 * A later comparison that silently used the other numbering would be comparing
 * different turns and would look like a behaviour change.
 * ═══════════════════════════════════════════════════════════════════════════
 */

/** The brief's own index. Not one of the eleven; sent first. */
export const BRIEF_TURN_INDEX = 0;

export interface ScriptedTurn {
  /** Table numbering, 1..11. */
  readonly index: number;
  /** Verbatim. `undefined` for turn 11, whose text is `RELOAD_TURN_MESSAGE`. */
  readonly message: string;
  /** SCRIPT.md's own "what it probes" column, verbatim. */
  readonly probes: string;
  /**
   * Turn 11 discards every client-side handle before sending.
   * See `RELOAD_SEMANTICS` for what that does and does not prove.
   */
  readonly reloadFirst?: boolean;
  /**
   * SCRIPT.md: "Turns 8 and 9 are MEASUREMENT ONLY for now: no fix is in
   * flight for either, and neither gates a wave." A measurement-only turn is
   * still SENT and still scanned by the universal criteria (C3's narration
   * scan applies to every turn) — what it must never do is FAIL THE RUN on its
   * own subject matter.
   */
  readonly measurementOnly?: boolean;
}

export const SCRIPTED_TURNS: readonly ScriptedTurn[] = Object.freeze([
  { index: 1, message: "What do you think I'm missing?", probes: 'does it know its own model’s gaps' },
  { index: 2, message: 'Run analysis.', probes: "admission on the USER's first click" },
  { index: 3, message: 'Explain the result.', probes: 'can it explain what it just computed' },
  {
    index: 4,
    message: "Why is the sales headcount investment £80? That doesn't seem right.",
    probes: 'does it recognise its own scale defect',
  },
  { index: 5, message: 'Can you update it with the correct range?', probes: 'correction reaches the right object' },
  { index: 6, message: 'Rerun.', probes: 'the correction does not break the run' },
  { index: 7, message: 'How has the update changed the analysis?', probes: 'before/after attribution, not a misroute' },
  {
    index: 8,
    message: 'Why are all of the outcome and risk strengths 50%?',
    probes: 'can it see its own flat goal layer',
    measurementOnly: true,
  },
  { index: 9, message: 'Run a pre-mortem.', probes: 'a named method, on demand', measurementOnly: true },
  { index: 10, message: 'What would you do next?', probes: 'a justified next move' },
  {
    index: 11,
    message: 'Where did we get to?',
    probes: 'continuity without loss or contradiction',
    reloadFirst: true,
  },
]);

/**
 * ⚠ WHAT TURN 11 MEASURES ON THE WIRE IS NOT WHAT IT MEASURES IN A BROWSER.
 * Name them apart (CLAUDE.md trap 21) rather than letting one PASS stand in
 * for the other.
 *
 * The browser's continuity is held in localStorage — the transcript at
 * `olumi-canvas-transcript` and the graph at `olumi-canvas-autosave` — and
 * staging runs `VITE_AUTH_MODE=guest`, so server-side persistence of the
 * CLIENT's view is off. A wire harness never had localStorage to lose. Its
 * "reload" is: discard every client-side handle except the scenario id, then
 * send. That measures CEE-SIDE continuity, which is strictly MORE than the
 * browser has.
 *
 * So a PASS here does NOT license any claim about the user's reload
 * experience. That half is DOM-only and is reported NOT ASSESSED.
 */
export const RELOAD_SEMANTICS =
  'turn 11 discarded every client-side handle except the scenario id and re-sent. ' +
  'This measures CEE-SIDE continuity only. The browser holds its transcript and graph in ' +
  'localStorage, which a wire harness never had, so a PASS here is NOT evidence about the ' +
  "user's reload experience — that half is DOM-only and reported NOT ASSESSED.";

/**
 * The scope C3 is decided over, stated because it is WIDER than the
 * criterion's literal wording and a later comparison must not silently differ.
 *
 * ACCEPTANCE.md C3 says "on any of the 11 turns". This harness scans all
 * TWELVE sends — the brief's own response included — because narration in the
 * draft reply reaches the user exactly as narration in turn 7 does, and
 * excluding it would be a scope narrowing chosen for the harness's
 * convenience.
 */
export const C3_SCOPE_NOTE =
  'C3 is decided over all 12 sends (the brief plus the eleven scripted turns). ' +
  "ACCEPTANCE.md says 'the 11 turns'; the brief's own response is included because narration " +
  'there reaches the user identically. Scope widened deliberately and stated, never narrowed silently.';

/**
 * The tokens that resolve C5's named object — "the sales headcount investment"
 * — to ONE node id in the drafted graph.
 *
 * ⚠ BIND BY IDENTITY, NOT BY VALUE (CLAUDE.md trap 19). The obvious binding is
 * "the factor whose value is 80" and it is WRONG: the founder brief contains
 * £80k-120k hire cost, £20k tooling, £40k SDR, £8k MRR, 120 customers, 12%,
 * 4%, £200k runway and 60% founder time. Several of those can present as 80,
 * 0.8 or 120. A value predicate would let a DIFFERENT factor satisfy the test
 * while the extractor under test was deleted.
 *
 * So the harness resolves a NODE ID from the draft by label, requires the match
 * to be UNIQUE, and reports the resolved id + label + value in the evidence. If
 * zero or several nodes match, C5's limb is NOT_ASSESSED with the candidates
 * listed — never a guess, and never a PASS.
 */
export const C5_TARGET_LABEL_TOKENS: readonly string[] = Object.freeze([
  'headcount',
  'sales',
  'hire',
  'hiring',
  'investment',
]);

/** A label must hit at least this many tokens to be a candidate. */
export const C5_TARGET_MIN_TOKEN_HITS = 2;
