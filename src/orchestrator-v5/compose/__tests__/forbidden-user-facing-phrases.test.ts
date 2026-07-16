/**
 * Unit tests for the shared FORBIDDEN_USER_FACING_PHRASES constant and
 * findForbiddenPhraseHit helper. Pure-function tests with no I/O.
 *
 * The constant is the single source of truth for "hard-fail prose" — any
 * regression here ripples to the runtime egress guard and the replay
 * harness assertions, so coverage is broad and explicit.
 */

import { describe, expect, it } from 'vitest';

import {
  FORBIDDEN_USER_FACING_PHRASES,
  findForbiddenPhraseHit,
  findSuccessClaimHit,
  SUCCESS_CLAIM_PATTERNS,
  EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT,
  applyEgressForbiddenPhraseGuard,
} from '../forbidden-user-facing-phrases.js';
import { RUN_ANALYSIS_LOCKED_TEMPLATES } from '../../coaching/analysis-result-headline.js';
import { composeEditClarifyResponse } from '../edit-clarify-response.js';

describe('FORBIDDEN_USER_FACING_PHRASES — phrase matches', () => {
  const positiveCases: ReadonlyArray<readonly [string, string]> = [
    // [phrase under test, label]
    ["I haven't applied any changes in this session yet.", "haven't applied any changes (straight apostrophe)"],
    ['I haven’t applied any changes in this session yet.', "haven't applied any changes (curly apostrophe)"],
    ['I have not applied any changes yet.', 'have not applied any changes'],
    // Codex round-3 denial variants — simple past, alternative verbs,
    // singular noun, "updates" instead of "changes".
    ["I didn't apply any changes.", "didn't apply any changes (simple past)"],
    ["I didn't make any changes.", "didn't make any changes (Codex round-4 missing variant)"],
    ['I did not apply any changes.', 'did not apply any changes (formal)'],
    ['I did not make any changes.', 'did not make any changes (alternative verb)'],
    ['No change was made.', 'singular "no change was made"'],
    ['No updates were made.', 'plural "no updates were made"'],
    ['No updates have been applied.', '"no updates have been applied"'],
    ['Nothing changed in the model after that edit.', 'nothing changed'],
    // "no changes" — contextual denial patterns (post-Codex P1 fix).
    // The bare `\bno\s+changes\b` regex was over-broad; replaced with
    // three narrower patterns covering: "no changes [were|are|have been]
    // [made|applied|necessary|needed|required]", "there [are|were|have
    // been] no changes", and "no changes [happened|occurred|emerged|
    // appeared|reflected|to report]". Negative coverage for legitimate
    // label-quote scenarios lives in the next describe block.
    ['No changes were made.', 'no changes were made'],
    ['No changes are applied.', 'no changes are applied'],
    ['No changes have been needed.', 'no changes have been needed'],
    ['There are no changes worth reporting.', 'there are no changes (existential)'],
    ['There were no changes in the model.', 'there were no changes (existential)'],
    ['No changes happened on the model.', 'no changes happened'],
    ['No changes occurred since the last analysis.', 'no changes occurred'],
    // Standalone denial (Codex P1 follow-up): the contextual patterns
    // above don't catch a terse LLM utterance like "No changes." on
    // its own. The line-anchored pattern restores brief coverage of
    // the bare "no changes" entry without re-introducing the label-
    // quote false-positive risk.
    ['No changes.', 'standalone "No changes." utterance'],
    ['No changes', 'standalone "No changes" without punctuation'],
    ['No changes!', 'standalone "No changes!" exclamation'],
    ['no changes', 'standalone lowercase'],
    [
      "Here's the summary:\n\nNo changes.\n\nLet me know if you'd like to try something.",
      'standalone "No changes." as a paragraph within multi-line prose',
    ],
    ['The wire reports unknown freshness.', 'unknown freshness'],
    ['This explanation was loaded from a prior run.', 'loaded from a prior run'],
    ['Showing a cached result for the same query.', 'cached result'],
    ['The previous analysis still holds.', 'previous analysis'],
    ['According to the prior analysis…', 'prior analysis'],
    // Case variants
    ['I HAVEN’T APPLIED ANY CHANGES.', 'shout-cased haven’t applied'],
    ['NOTHING CHANGED.', 'shout-cased nothing changed'],
    ['Previous Analysis Was Run.', 'title-cased previous analysis'],
    // V5 P0 stabilisation — prescriptive-language defence-in-depth.
    ['Here is the recommendation.', 'prescriptive "recommendation"'],
    ['These recommendations may shift.', 'plural "recommendations"'],
    ['Recommended next step: re-run the analysis.', 'leading "Recommended"'],
    ['The recommended option is X.', 'mid-sentence "recommended"'],
    ['The winner is Option A.', 'prescriptive "the winner"'],
    ['These are the winners after re-analysis.', 'plural "the winners"'],
    ['Option A has the winning probability.', '"winning probability"'],
    ['The winning option leads at 72%.', '"winning option"'],
    ['Robust analysis points to the winning side.', '"winning side"'],
  ];

  for (const [text, label] of positiveCases) {
    it(`flags ${label}`, () => {
      expect(findForbiddenPhraseHit(text)).not.toBeNull();
    });
  }
});

describe('FORBIDDEN_USER_FACING_PHRASES — clean text passes', () => {
  const negativeCases: ReadonlyArray<readonly [string, string]> = [
    [
      'These results may be out of date because the model has changed since the last analysis.',
      'brief required stale copy',
    ],
    [
      "I don't have a record of recent edits in this conversation. If you'd like to make a change, tell me what to update and I'll do it directly.",
      'replacement no-recent-changes neutral copy',
    ],
    [
      'Strengthened the Incremental Hiring Cost to Budget Overrun Risk edge from 0.5 to 0.7.',
      'edit_graph safe_summary verbatim quote',
    ],
    [
      'Hire Two Senior Engineers Locally leads at 72% probability, 51 percentage points ahead of the runner-up.',
      'leader explanation prose (fresh path)',
    ],
    [
      'Would you like to re-run analysis to see how your changes affect the results?',
      'recovery offer (no forbidden phrase)',
    ],
    ['The analysis is ready to run on your current model.', 'forward-looking analysis copy'],
    ['Several innocuous changes occurred to the wording.', 'no changes word-boundary negative (NOT a state denial)'],
    ['That option produced no_changes_required (an internal status).', 'underscored token NOT matched'],
    // P1 regression guard (Codex review): the bare `\bno\s+changes\b`
    // regex used to false-positive on legitimate label-quotes that
    // appear in EditGraphHandlerFact.safe_summary and get quoted
    // verbatim by the state-query guard. The contextual denial
    // patterns must NOT trigger on these label-shaped strings.
    [
      "Updated the 'No Changes' factor from 0.5 to 0.7.",
      'safe_summary quoting a user-named "No Changes" factor',
    ],
    [
      "Strengthened the No Changes Required edge from 0.5 to 0.8.",
      'safe_summary quoting a "No Changes Required" label',
    ],
    [
      "Renamed 'No Changes Required' option to 'Status Quo'.",
      'safe_summary quoting a rename of a "No Changes" option',
    ],
    [
      "The No Changes Required factor now sits at 30%.",
      'analysis prose mentioning a "No Changes Required" factor',
    ],
    [
      "Hire Two Senior Engineers wins probability vs Status Quo (No Changes) baseline at 72%.",
      'leader prose comparing against a "No Changes" baseline option',
    ],
    // V5 P0 stabilisation — prescriptive-language negatives. The bare
    // "winner" / "winning" patterns are narrowed to prescriptive
    // phrasings only so user-authored option labels still pass.
    [
      "Strengthened the 'Winner Take All' edge from 0.5 to 0.7.",
      'safe_summary quoting a user-named "Winner Take All" option label',
    ],
    [
      "Renamed the option 'Big Winner' to 'Top Performer'.",
      'safe_summary quoting a user-named "Big Winner" label',
    ],
    [
      "The Winning Strategy factor now sits at 30%.",
      'analysis prose quoting a user-named "Winning Strategy" factor label',
    ],
  ];

  for (const [text, label] of negativeCases) {
    it(`does NOT flag ${label}`, () => {
      expect(findForbiddenPhraseHit(text)).toBeNull();
    });
  }
});

describe('findForbiddenPhraseHit — boundary cases', () => {
  it('returns null on empty string', () => {
    expect(findForbiddenPhraseHit('')).toBeNull();
  });

  it('returns the matched substring (not the source regex)', () => {
    const hit = findForbiddenPhraseHit('Earlier I said: previous analysis is still valid.');
    expect(hit).toMatch(/previous\s+analysis/i);
  });

  it('returns the FIRST hit in declaration order, not by position', () => {
    // Construct text that contains TWO forbidden phrases. The helper returns
    // the first match by regex-iteration order, mirroring how the egress
    // guard logs hits (first-wins keeps telemetry deterministic).
    const text =
      'I haven’t applied any changes yet, and the previous analysis is now stale.';
    const hit = findForbiddenPhraseHit(text);
    expect(hit).not.toBeNull();
    // Whichever phrase comes first in the regex array determines the hit;
    // the test asserts a stable choice across changes rather than a
    // specific position-in-text.
    expect(hit?.toLowerCase()).toMatch(/haven|previous\s+analysis/i);
  });

  it('exposes a non-empty regex array', () => {
    // After Codex P1 fix: the bare `\bno\s+changes\b` regex was replaced
    // with three contextual denial patterns, so the array grew. The
    // lower bound stays as a smoke check rather than an exact-count
    // pin so future additions don't trip this invariant.
    expect(FORBIDDEN_USER_FACING_PHRASES.length).toBeGreaterThanOrEqual(9);
  });
});

// ---------------------------------------------------------------------------
// V5 stale-aware explain recovery — Codex round-3 Improvement 4.
//
// Pin route-v2.ts's EDIT_GRAPH_RECOVERY_TEXT against the shared
// FORBIDDEN_USER_FACING_PHRASES list. The constant is audit-only
// today (it ships through sendFinalised200, which bypasses the
// per-dispatch egress hooks landed in this workstream); a follow-up
// task will fold this through the route-level chokepoint. Until
// then, this test is the contract that the recovery text contains
// no contradiction phrase, so a future edit to the constant cannot
// silently re-introduce one.
// ---------------------------------------------------------------------------

describe('audited recovery constants — no forbidden phrase', () => {
  // Known slow (pre-existing): the dynamic import pulls in route-v2's
  // full module graph (fastify route + orchestrator + adapters), which
  // can exceed the 5s default test timeout on a cold transform cache.
  // The assertion itself is trivial — the budget only covers the import.
  it('route-v2.ts EDIT_GRAPH_RECOVERY_TEXT is clean', { timeout: 30_000 }, async () => {
    const { EDIT_GRAPH_RECOVERY_TEXT } = await import(
      '../../../orchestrator/route-v2.js'
    );
    expect(findForbiddenPhraseHit(EDIT_GRAPH_RECOVERY_TEXT)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// V5 H5 — internal-jargon defence (forbidden phrases additions).
//
// `validator` was observed leaking through user-facing prose on the
// dl7-staleness staging replay (the edit_graph LLM coaching summary
// includes the term because the system prompts teach it). The V4 Mode
// B fix drops `coaching.summary` from the no-op path, but Mode C
// success copy can still include LLM-authored prose; this wire-level
// defence is the backstop. Each new entry was false-positive-swept
// against existing user-facing test fixtures before adding.
// ---------------------------------------------------------------------------

describe('FORBIDDEN_USER_FACING_PHRASES — jargon defence (H5)', () => {
  const jargonPositive: ReadonlyArray<readonly [string, string]> = [
    ['The validator rejected this edge.', 'bare validator (the observed dl7-staleness leak)'],
    ['Multiple validators ran on the model.', 'plural validators'],
    ['Zod parsed the response.', 'Zod (library name)'],
    ['The dispatcher routed this turn.', 'bare dispatcher'],
    ['A tool call returned an error.', 'tool call (singular)'],
    ['Three tool calls were retried.', 'tool calls (plural)'],
    ['The response envelope was malformed.', 'response envelope (narrowed)'],
    ['The wire envelope contained the payload.', 'wire envelope (narrowed)'],
    ['The XML envelope was parsed.', 'XML envelope (narrowed)'],
    ['A code validator runs after generation.', 'code validator (prompt-lifted)'],
    // Case variants
    ['The VALIDATOR rejected this.', 'shout-cased validator'],
    ['The Dispatcher routed this.', 'title-cased dispatcher'],
  ];

  for (const [text, label] of jargonPositive) {
    it(`flags ${label}`, () => {
      expect(findForbiddenPhraseHit(text)).not.toBeNull();
    });
  }
});

describe('FORBIDDEN_USER_FACING_PHRASES — jargon defence does NOT false-positive', () => {
  const jargonNegative: ReadonlyArray<readonly [string, string]> = [
    // Bare `envelope` is intentionally NOT in the list — business prose
    // can legitimately reference "envelope of options" or similar.
    ['Hire Two Senior Engineers fits within the envelope of options.', 'business "envelope of options" not flagged'],
    ['The marketing envelope was sent yesterday.', 'business "marketing envelope" not flagged'],
    // "zod" (lowercase) is case-sensitive in the regex — if a user names
    // a label "Zod" the case-sensitive match would still hit, which is
    // acceptable (extremely unlikely user label) but lowercase common-
    // language must pass.
    ['The zoo had unusual exhibits.', 'lowercase "zoo" near-miss does not match Zod'],
    // Coverage that the existing user-named "No Changes" patterns still pass
    [
      "Updated the 'No Changes' factor from 0.5 to 0.7.",
      'pre-existing safe_summary still passes (regression guard)',
    ],
  ];

  for (const [text, label] of jargonNegative) {
    it(`does NOT flag ${label}`, () => {
      expect(findForbiddenPhraseHit(text)).toBeNull();
    });
  }
});

// ---------------------------------------------------------------------------
// V5 deterministic-copy hardening (Area A) — internal implementation
// vocabulary defence. CONSERVATIVE runtime set (multi-word internal phrases +
// clearly-internal single words) is enforced by the egress guard; wider single
// words (handler, debug) are enforced by the deterministic-copy sweep only,
// since the egress guard REPLACES the whole response and those words have
// legitimate user-domain uses.
// ---------------------------------------------------------------------------

describe('FORBIDDEN_USER_FACING_PHRASES — internal-vocabulary defence (runtime)', () => {
  const internalPositive: ReadonlyArray<readonly [string, string]> = [
    ['I assembled the context pack for this turn.', 'context pack (spaced)'],
    ['The context_pack was truncated.', 'context_pack (snake_case)'],
    ['This turn class is converse.', 'turn class (spaced)'],
    ['Routed with turn_class converse.', 'turn_class (snake_case)'],
    // NOTE: spaced "direct answer" is NOT runtime-blocked (legitimate English);
    // only the snake_case identifier is. See the negative cases below.
    ['Classified as direct_answer.', 'direct_answer (snake_case)'],
    ['The graph hash changed since last run.', 'graph hash (spaced)'],
    ['Compared graph_hash values.', 'graph_hash (snake_case)'],
    ['The node id is missing.', 'node id (spaced)'],
    ['Resolved the node_id.', 'node_id (snake_case)'],
    ['Dropped the _meta field before emit.', '_meta field'],
    ['The orchestrator selected this path.', 'orchestrator'],
    ['The ORCHESTRATOR ran first.', 'shout-cased orchestrator'],
  ];

  for (const [text, label] of internalPositive) {
    it(`flags ${label}`, () => {
      expect(findForbiddenPhraseHit(text)).not.toBeNull();
    });
  }
});

describe('FORBIDDEN_USER_FACING_PHRASES — internal-vocabulary defence does NOT false-positive', () => {
  const internalNegative: ReadonlyArray<readonly [string, string]> = [
    ['Here is some helpful context for your decision.', 'bare "context" not flagged'],
    ['I will answer this directly.', '"answer ... directly" is not "direct answer"'],
    ["Here's a direct answer to your question.", 'spaced "direct answer" is legitimate prose — runtime-allowed (only snake_case direct_answer is blocked)'],
    ['This is a strong class of options.', 'bare "class" not flagged'],
    ['Add a node to represent supplier risk.', 'bare "node" not flagged'],
    ['We can hash out the trade-offs together.', '"hash out" not flagged'],
    ['Pack your assumptions into one option.', 'bare "pack" not flagged'],
    ['It is now your turn to decide.', 'bare "turn" not flagged'],
    ['The metadata you provided looks complete.', '"metadata" is not "_meta"'],
    // Wider terms are INTENTIONALLY not runtime-blocked (deterministic-copy
    // tests only) — they must not nuke legitimate user-facing prose.
    ['I can handle that for you.', '"handle" not runtime-flagged'],
    ['The event handler pattern is common.', '"handler" intentionally not runtime-blocked'],
    ['Let us debug your assumptions together.', '"debug" intentionally not runtime-blocked'],
  ];

  for (const [text, label] of internalNegative) {
    it(`does NOT flag ${label}`, () => {
      expect(findForbiddenPhraseHit(text)).toBeNull();
    });
  }
});

describe('deterministic copy is free of internal vocabulary (wider set, composer-level)', () => {
  // Wider set: conservative runtime terms PLUS handler/debug — which are NOT
  // runtime-blocked but must never appear in deterministic composer copy.
  const WIDER_INTERNAL_TERMS: ReadonlyArray<readonly [RegExp, string]> = [
    [/\bcontext[\s_]packs?\b/i, 'context pack'],
    [/\bturn[\s_]class(?:es)?\b/i, 'turn class'],
    [/\bdirect[\s_]answers?\b/i, 'direct answer'],
    [/\bgraph[\s_]hash(?:es)?\b/i, 'graph hash'],
    [/\bnode[\s_]ids?\b/i, 'node id'],
    [/\b_meta\b/i, '_meta'],
    [/\borchestrator\b/i, 'orchestrator'],
    [/\bhandlers?\b/i, 'handler'],
    [/\bdebug\b/i, 'debug'],
  ];

  function assertClean(text: string, where: string): void {
    for (const [re, term] of WIDER_INTERNAL_TERMS) {
      expect(
        re.test(text),
        `${where} must not contain internal term "${term}": ${JSON.stringify(text)}`,
      ).toBe(false);
    }
  }

  it('run_analysis locked templates contain no internal vocabulary', () => {
    for (const tpl of RUN_ANALYSIS_LOCKED_TEMPLATES) {
      assertClean(tpl, 'RUN_ANALYSIS_LOCKED_TEMPLATES');
    }
  });

  it('edit-clarify deterministic copy contains no internal vocabulary', () => {
    const res = composeEditClarifyResponse({
      reason: 'vague_edit',
      stage: 'decide',
      nodes: [
        { id: 'fac_cost', kind: 'factor', label: 'Operating Cost' },
        { id: 'opt_a', kind: 'option', label: 'Hire Contractor' },
      ],
      priorAnalysisIsFresh: true,
    });
    assertClean(res.assistant_text ?? '', 'composeEditClarifyResponse.assistant_text');
  });
});

describe('EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT — graceful generic recovery (Area A amendment 7)', () => {
  it('is a non-blank, non-trivial generic recovery message', () => {
    const t = EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT;
    expect(t.trim().length).toBeGreaterThan(0);
    // Not jarring / not a dead-end — long enough to read as a real invitation.
    expect(t.length).toBeGreaterThan(15);
  });

  it('itself trips no forbidden phrase or internal term (idempotent + clean)', () => {
    // The replacement must not itself trip the guard (idempotency) nor leak an
    // internal term — otherwise the "graceful" fallback would be re-nuked or
    // would itself read as internal jargon.
    expect(findForbiddenPhraseHit(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// V5 H5 — success-claim language detector (counterpart to the denial
// regex set). Used by the V5 edit_graph dispatcher's false-success
// invariant: when `handleEditGraph` returns wasRejected=false + zero
// operations + no applied graph, any success-claim language in
// `assistantText` is by definition false.
// ---------------------------------------------------------------------------

describe('SUCCESS_CLAIM_PATTERNS — false-success detector', () => {
  const successPositive: ReadonlyArray<readonly [string, string]> = [
    ["I've successfully applied the change.", "I've successfully applied"],
    ["I have successfully updated the model.", 'I have successfully updated'],
    ["Successfully set Staffing Cost to 120k.", 'Successfully set'],
    ["Successfully added the new factor.", 'Successfully added'],
    ["Successfully removed the constraint.", 'Successfully removed'],
    ["I've updated the Staffing Cost factor.", "I've updated"],
    ["I have applied your change.", 'I have applied'],
    ["I've added a new factor.", "I've added"],
    ["The change has been applied to the model.", 'the change has been applied'],
    ["The edit is now applied.", 'the edit is now applied'],
    ["The update was applied successfully.", 'the update was applied'],
    ["The mutation has been saved.", 'the mutation has been saved'],
    ["The adjustment was committed.", 'the adjustment was committed'],
    ["Has been updated to reflect your change.", 'has been updated'],
    ["The factor has been added.", 'has been added'],
    ['I’ve applied the change.', "curly-apostrophe I've applied"],
    // Codex round-1 P1 — terse commit acknowledgements (defence-in-
    // depth; the V4 source fix already drops warnings/coaching on
    // no-op paths so these mostly back-stop future regressions).
    ['Done.', 'standalone "Done." commit acknowledgement'],
    ['Done!', 'standalone "Done!" exclamation'],
    ['Done — Price is now 120k.', '"Done —" prefix with detail'],
    ['Done - value set.', '"Done -" prefix with hyphen'],
    ['All set.', '"All set." standalone'],
    ['All set to 0.7.', '"All set" with target value'],
    ['Updated Price.', 'bare past-tense "Updated X" sentence'],
    ['Added a new constraint.', 'bare past-tense "Added X" sentence'],
    ['Set Staffing Cost to 120k.', 'bare past-tense "Set X to N" sentence'],
    ['Removed Outdated Factor.', 'bare past-tense "Removed X" sentence'],
    ['Changed Cost.', 'bare past-tense "Changed X" sentence'],
    [
      "Here's what I did:\n\nUpdated Price.\n\nLet me know if you need more.",
      'bare past-tense "Updated X" as a paragraph within multi-line prose',
    ],
  ];

  for (const [text, label] of successPositive) {
    it(`flags ${label}`, () => {
      expect(findSuccessClaimHit(text)).not.toBeNull();
    });
  }
});

describe('SUCCESS_CLAIM_PATTERNS — does NOT flag legitimate non-commit prose', () => {
  const successNegative: ReadonlyArray<readonly [string, string]> = [
    ["I can apply this change if you confirm.", 'conditional offer (not commit claim)'],
    ["I'd like to apply this once you specify a value.", 'desire to apply (not commit claim)'],
    ["I'll update the value when you tell me what to use.", 'future commitment (not done)'],
    ["Would you like me to apply this change?", 'question (not commit claim)'],
    [
      "I have a change in mind for **Staffing Cost**, but I need the specifics to apply it directly.",
      'Mode A copy (must not false-positive)',
    ],
    [
      'No changes were needed for this request.',
      'Mode B deterministic copy (must not false-positive)',
    ],
    [
      "Let me know what you'd like me to do next, and I'll take it from there.",
      'EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT (idempotent neutral)',
    ],
    [
      'Strengthened the Incremental Hiring Cost to Budget Overrun Risk edge from 0.5 to 0.7.',
      'edit_graph safe_summary (verb without success qualifier)',
    ],
    // Codex round-1 P1 — negative coverage for the new terse-commit
    // regexes. These must NOT fire on:
    //   1. "Done" as a non-leading word ("I am done", "almost done").
    //   2. Mid-sentence verb forms ("I've already updated this").
    //   3. Question-phrased commit verbs ("Should I update this?").
    //   4. The Mode A copy itself (contains "I have a change in mind…",
    //      not a sentence-leading "Updated/Added/Set X").
    ['I am done reviewing the options.', '"done" as non-leading word'],
    ['Almost done analyzing the data.', '"done" mid-clause'],
    ['Should I update this factor?', 'question framing (not a commit)'],
    ['Tell me if I should add a constraint.', 'conditional advice (not a commit)'],
    ['The leader leads by a wide margin.', 'unrelated factor-comparison prose'],
    [
      "I have a change in mind for **Staffing Cost**, but I need the specifics to apply it directly. Tell me the specific value or direction (e.g. \"set to N\" or \"lower by N\") and I'll make it.",
      'Mode A v2 builder output (concrete + abstract example)',
    ],
  ];

  for (const [text, label] of successNegative) {
    it(`does NOT flag ${label}`, () => {
      expect(findSuccessClaimHit(text)).toBeNull();
    });
  }
});

describe('findSuccessClaimHit — boundary cases', () => {
  it('returns null on empty string', () => {
    expect(findSuccessClaimHit('')).toBeNull();
  });

  it('returns the matched substring', () => {
    const hit = findSuccessClaimHit("Done — I've successfully applied the change to Staffing Cost.");
    expect(hit).toMatch(/successfully\s+applied/i);
  });

  it('exposes a non-empty pattern array', () => {
    expect(SUCCESS_CLAIM_PATTERNS.length).toBeGreaterThanOrEqual(3);
  });
});

// =========================================================================
// V5 coaching — copy safety for the post-run_analysis validation prompt
// chip + the enrichment-grounded composeEvidenceGap output. Pure-string
// checks; the gate is exercised end-to-end in
// `src/orchestrator-v5/routing/__tests__/post-analysis-advice-gate.test.ts`.
// =========================================================================
describe('V5 coaching — validation chip + composer copy passes forbidden-phrase guards', () => {
  // Hard-coded mirror of the strings emitted from
  // `src/orchestrator-v5/compose/chip-generator.ts` post-run_analysis
  // branch. Mirrored here (rather than imported) so a regression that
  // changes the chip copy without updating this test fires a clear
  // assertion miss rather than passing silently.
  const VALIDATION_CHIP_LABEL = 'What should we validate?';
  const VALIDATION_CHIP_MESSAGE =
    'What should we validate or research to build confidence in this decision?';

  // Representative composer outputs from `composeEvidenceGap`'s
  // enrichment-grounded branch (PR #190) and its projection-only
  // fall-through. The full corpus stays under the same guards so
  // future refactors of the composer can re-check it quickly.
  const COMPOSER_OPENER = 'To build confidence in this analysis, the most useful things to check are:';
  const COMPOSER_ASSUMPTION_LEAD = 'One assumption worth testing alongside this:';
  const COMPOSER_ASSUMPTION_SOLO = 'One assumption worth testing first:';
  const COMPOSER_FALLBACK_GAP = 'The biggest open gap right now is:';

  const samples: ReadonlyArray<readonly [string, string]> = [
    [VALIDATION_CHIP_LABEL, 'validation chip label'],
    [VALIDATION_CHIP_MESSAGE, 'validation chip message'],
    [COMPOSER_OPENER, 'enrichment-grounded opener'],
    [COMPOSER_ASSUMPTION_LEAD, 'assumption follow-up lead'],
    [COMPOSER_ASSUMPTION_SOLO, 'assumption-only lead'],
    [COMPOSER_FALLBACK_GAP, 'projection-only fallback opener'],
    [
      `${COMPOSER_OPENER}\n• Pull on-time delivery rates from the last two releases and check the variance.\n${COMPOSER_ASSUMPTION_LEAD} The local senior hiring market will remain as competitive as it is today.`,
      'full enrichment-grounded response',
    ],
  ];

  for (const [text, label] of samples) {
    it(`forbidden-phrase clean: ${label}`, () => {
      expect(findForbiddenPhraseHit(text)).toBeNull();
    });
    it(`success-claim clean: ${label}`, () => {
      // The composer is post-analysis prose, not a commit receipt — it
      // must not trip the sentence-leading commit-verb guard either.
      expect(findSuccessClaimHit(text)).toBeNull();
    });
  }

  it('does not leak entity-id-shaped tokens in the validation corpus', () => {
    // Entity-id leak detection mirrors the egress scrub (shared regex
    // family `fac_/opt_/con_/out_/edg_` etc.). The chip strings and
    // composer prose are user-facing copy and must not carry raw IDs.
    const corpus = samples.map(([s]) => s).join('\n');
    expect(corpus).not.toMatch(/\b(?:fac|opt|con|out|edg|nod)_\w+\b/);
  });

  it('chip label respects the ≤30-character cap', () => {
    expect(VALIDATION_CHIP_LABEL.length).toBeLessThanOrEqual(30);
  });

  it('does not embed raw decimals in deterministic composer wrappers', () => {
    // The deterministic wrapper strings (openers, follow-ups, fallbacks)
    // must never interpolate raw floats. LLM-passthrough strings
    // (specific_action, key_assumptions) are sanitised by the
    // decision_review enricher's own egress filter, but the wrapper
    // shell here is purely deterministic.
    const wrappers = [
      VALIDATION_CHIP_LABEL,
      VALIDATION_CHIP_MESSAGE,
      COMPOSER_OPENER,
      COMPOSER_ASSUMPTION_LEAD,
      COMPOSER_ASSUMPTION_SOLO,
      COMPOSER_FALLBACK_GAP,
    ].join('\n');
    expect(wrappers).not.toMatch(/(?:^|[\s(=,])(?:0\.\d|\.\d)/);
  });
});

// ============================================================================
// RC4 proportionate remedies — the egress guard is REWRITE-FIRST for the
// prescriptive lexicon ("recommendation"/"winner" class, per the prompt
// TERMINOLOGY map) and FALLBACK-REPLACEMENT for everything else (denial,
// false-success, staleness, internal jargon — the fatal classes). The
// 2026-07-15 session RCA (RC4) evidenced whole-block/response nuking as the
// only remedy; a rewritable offence must now cost the user nothing.
// ============================================================================

describe('applyEgressForbiddenPhraseGuard — proportionate remedies (RC4)', () => {
  it('rewrites a rewritable lexicon hit in place, preserving the content', () => {
    const guarded = applyEgressForbiddenPhraseGuard(
      'The recommendation is to expand into the enterprise segment first.',
    );
    expect(guarded.rewritten).toBe(true);
    expect(guarded.remedy).toBe('terminology_rewrite');
    expect(guarded.text).toBe(
      'The leading option is to expand into the enterprise segment first.',
    );
    expect(guarded.hit).toMatch(/recommendation/i);
    expect(findForbiddenPhraseHit(guarded.text)).toBeNull();
  });

  it('rewrites "the winner" / "winning option" prescriptions in place', () => {
    const a = applyEgressForbiddenPhraseGuard('The winner is Hire a tech lead.');
    expect(a.remedy).toBe('terminology_rewrite');
    expect(a.text).toBe('The leading option is Hire a tech lead.');
    const b = applyEgressForbiddenPhraseGuard('The winning option leads at 72%.');
    expect(b.remedy).toBe('terminology_rewrite');
    expect(b.text).toBe('The leading option leads at 72%.');
  });

  it('still REPLACES the whole response for a fatal-class denial phrase', () => {
    const guarded = applyEgressForbiddenPhraseGuard(
      "I haven't applied any changes in this session yet. Tell me more.",
    );
    expect(guarded.rewritten).toBe(true);
    expect(guarded.remedy).toBe('fallback_replacement');
    expect(guarded.text).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
  });

  it('still REPLACES when a fatal-class phrase accompanies a rewritable one', () => {
    const guarded = applyEgressForbiddenPhraseGuard(
      'Nothing changed on the model, so the recommendation stands.',
    );
    expect(guarded.rewritten).toBe(true);
    expect(guarded.remedy).toBe('fallback_replacement');
    expect(guarded.text).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
  });

  it('still REPLACES internal jargon (no safe rewrite exists)', () => {
    for (const text of [
      'The validator rejected that change.',
      'The orchestrator returned an error envelope.',
      'The wire currently shows unknown freshness.',
    ]) {
      const guarded = applyEgressForbiddenPhraseGuard(text);
      expect(guarded.remedy, text).toBe('fallback_replacement');
      expect(guarded.text, text).toBe(EGRESS_FORBIDDEN_PHRASE_FALLBACK_TEXT);
    }
  });

  it('reports remedy "none" and returns the text unchanged when clean', () => {
    const clean = 'Hire a tech lead leads at 72% probability, per the analysis.';
    const guarded = applyEgressForbiddenPhraseGuard(clean);
    expect(guarded.rewritten).toBe(false);
    expect(guarded.remedy).toBe('none');
    expect(guarded.text).toBe(clean);
  });

  it('is idempotent across both remedies', () => {
    const rewritten = applyEgressForbiddenPhraseGuard(
      'The recommendation is to expand.',
    );
    expect(applyEgressForbiddenPhraseGuard(rewritten.text).rewritten).toBe(false);
    const replaced = applyEgressForbiddenPhraseGuard('Nothing changed.');
    expect(applyEgressForbiddenPhraseGuard(replaced.text).rewritten).toBe(false);
  });
});
