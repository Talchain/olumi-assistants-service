/**
 * G-CEE-1 — THE FIFTH CHANNEL: the ROLLING SUMMARY, at the real seam.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT #721, #723 AND #724 DID NOT CLOSE.
 *
 * The arc has now gated three model-input channels on a withheld turn: the wire
 * blocks (#721), the P6 decision-records projection (#723) and prior-turn
 * assistant prose (#724). The LAST channel with PROVEN leader content is
 * `scenarios.rolling_summary` — a haiku-written digest of the conversation that
 * `inject.ts` renders into `ContextPack.conversation_summary.text` and
 * `buildUserMessage` serialises into the routing prompt.
 *
 * A live read on historic scenario `f63ccb45` shows its `RESOLVED` slot
 * carrying, VERBATIM:
 *
 *   "Current analysis shows Double Down on SMB leading 52% vs Enterprise 35%,
 *    but result is fragile and sensitive to sales win rate assumptions."
 *
 * …three sentences above that same summary's own "No ranking can be put
 * forward…". THE STORED SUMMARY CONTRADICTS ITSELF, and both halves were being
 * handed to the model on a turn whose verdict withholds the ranking.
 *
 * ⚠ THE SHARED ALARM IS BLIND TO IT — measured, and it is why this gate reuses
 * #724's WIDER reader rather than the egress vocabulary. `\bleads\b` is
 * present-tense; the live string is the bare participle "leading 52%", which
 * `leading_option` and `leading_in` both require a following word for. Asserted
 * as an INSTRUMENT check below rather than left as prose.
 *
 * ⚠ THESE ARE NOT ASSERTIONS ABOUT MODEL OUTPUT. Target `c6` carries eight
 * leader-naming stored messages and leaked 0/5, so presence in the input is not
 * sufficiency and a leak rate is not pinnable in-repo. THE INPUT IS THE DEFECT.
 * Every assertion here is on the SERIALISED ROUTING USER MESSAGE — the exact
 * bytes handed to the LLM adapter — never on a value a function returned to its
 * own caller.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';

import type { MessageTurnPayload } from '@talchain/schemas/boundary';
import type { ChatWithToolsArgs, ChatWithToolsResult } from '../../adapters/llm/types.js';

import { setTestSink } from '../../utils/telemetry.js';
import { CONTEXT_PACK_RECENT_TURNS_CAP } from '../context/context-pack-assembler.js';
import type { RollingSummary } from '../rolling-summary/summary-types.js';
import { ROLLING_SUMMARY_SLOT_LABELS } from '../rolling-summary/summary-types.js';
// The production readers and marker, taken off the modules the gate itself
// calls, so this acceptance file and the gate cannot drift apart.
import { textNamesLeadingOption } from '../compose/leading-option-egress-guard.js';
import {
  WITHHELD_HISTORY_REDACTION_MARKER,
  historyAssertsLeaderClaim,
} from '../context/withheld-history-redaction.js';

const SCENARIO_ID = randomUUID();

/**
 * ⭐ THE LIVE BYTES. Transcribed verbatim from the `RESOLVED` slot of
 * `scenarios.rolling_summary` on historic scenario `f63ccb45`.
 *
 * Labels are deliberately NOT remapped onto a synthetic graph: these are the
 * live bytes, and the reader is label-independent by design (it triggers on the
 * ordering CLAIM, never on an option roster — deriving the roster here would be
 * a second derivation of "who is leading" beside the verdict).
 */
const LIVE_SUMMARY_LEADER_SENTENCE =
  'Current analysis shows Double Down on SMB leading 52% vs Enterprise 35%, but ' +
  'result is fragile and sensitive to sales win rate assumptions.';

/**
 * The summary's OWN contradicting sentence, three below the claim in the live
 * slot. Claim-free under both readers, so it is the surviving-sentence control:
 * it proves the redaction is SENTENCE-scoped and not slot-scoped.
 */
const LIVE_SUMMARY_NO_RANKING_SENTENCE =
  'No ranking can be put forward until the sales win rate link is verified.';

/** A third claim-free sentence from the same slot — the blocker the coach needs. */
const LIVE_SUMMARY_BLOCKER_SENTENCE =
  'The blocker is the unverified link from sales win rate to revenue growth.';

/** The whole `RESOLVED` slot as stored: claim first, then the two that survive. */
const RESOLVED_SLOT_TEXT =
  `${LIVE_SUMMARY_LEADER_SENTENCE} ${LIVE_SUMMARY_BLOCKER_SENTENCE} ` +
  `${LIVE_SUMMARY_NO_RANKING_SENTENCE}`;

/** Claim-free slot content — the byte-identity control's fixture. */
const LEADER_FREE_RESOLVED_TEXT =
  'The team agreed to keep the existing headcount. Pipeline data was requested from sales.';

const CONSTRAINTS_SLOT_TEXT = 'Keep the existing team; no redundancies.';
const FRAME_SLOT_TEXT = 'Whether to double down on SMB or move upmarket to enterprise.';
const OPEN_SLOT_TEXT = 'Is the sales win rate link verified against real pipeline numbers?';

interface MockTurn {
  turn_id: string;
  turn_class: string;
  handler_id: null;
  created_at: string;
  user_message: string;
  assistant_message: string;
}

/** turns 1..n (oldest..newest), returned NEWEST-FIRST as `readRecent` does. */
function turnsNewestFirst(n: number): MockTurn[] {
  const out: MockTurn[] = [];
  for (let i = 1; i <= n; i++) {
    out.push({
      turn_id: `tttttttt-0000-4000-8000-${String(i).padStart(12, '0')}`,
      turn_class: 'coach',
      handler_id: null,
      created_at: new Date(Date.UTC(2026, 6, 10, 10, i, 0)).toISOString(),
      user_message: `Question ${i}`,
      // Deliberately claim-free: #724's channel must not be able to supply the
      // strings this file measures (see CHANNEL ISOLATION below).
      assistant_message: `Noted, and logged for step ${i}.`,
    });
  }
  return out.reverse();
}

// cap+1 turns → exactly ONE falls off the verbatim window, which is the
// injector's activation condition (derive-don't-mirror off the real cap).
const BEYOND_WINDOW_TURNS = turnsNewestFirst(CONTEXT_PACK_RECENT_TURNS_CAP + 1);
const NEWEST_TURN = BEYOND_WINDOW_TURNS[0]!;
const OLDEST_TURN = BEYOND_WINDOW_TURNS[BEYOND_WINDOW_TURNS.length - 1]!;

/** A stored summary in the live four-slot shape, with `resolvedText` in RESOLVED. */
function storedSummary(resolvedText: string): RollingSummary {
  return {
    // `text` is the STORED render; the injector re-renders from `slots` (so the
    // R3 provenance stamps ride along) and never reads this field. Kept
    // consistent anyway so the fixture is a faithful row.
    text: [
      `${ROLLING_SUMMARY_SLOT_LABELS.FRAME}: ${FRAME_SLOT_TEXT}`,
      `${ROLLING_SUMMARY_SLOT_LABELS.CONSTRAINTS}: ${CONSTRAINTS_SLOT_TEXT}`,
      `${ROLLING_SUMMARY_SLOT_LABELS.RESOLVED}: ${resolvedText}`,
      `${ROLLING_SUMMARY_SLOT_LABELS.OPEN}: ${OPEN_SLOT_TEXT}`,
    ].join('\n'),
    slots: [
      { slot: 'FRAME', entries: [{ text: FRAME_SLOT_TEXT, source_turn_ids: [] }] },
      {
        slot: 'CONSTRAINTS',
        entries: [{ text: CONSTRAINTS_SLOT_TEXT, source_turn_ids: [OLDEST_TURN.turn_id] }],
      },
      {
        slot: 'RESOLVED',
        entries: [{ text: resolvedText, source_turn_ids: [OLDEST_TURN.turn_id] }],
      },
      { slot: 'OPEN', entries: [{ text: OPEN_SLOT_TEXT, source_turn_ids: [] }] },
    ],
    // Watermark = the newest window turn ⇒ lag 0 and provably covered, so the
    // memory-hole guard renders the four-slot block rather than refusing it.
    updated_turn_id: NEWEST_TURN.turn_id,
    updated_turn_created_at: NEWEST_TURN.created_at,
    version: 2,
    generator: 'incremental',
    schema_version: 1,
  };
}

/**
 * The persisted analysis. The two arms flip EXACTLY ONE thing — whether the
 * `constraint_verdict` is present and permitting — so every difference between
 * them is attributable to the verdict and to nothing in the fixture.
 *
 * `mayName === null` reproduces the HISTORIC, UNSTAMPED shape (`f63ccb45`'s own
 * class): no `constraint_verdict` at all ⇒ withheld by the fail-closed default.
 * There is no data migration, so that class is live.
 */
function priorRunAnalysisFact(mayName: boolean | null): Record<string, unknown> {
  return {
    fact_type: 'run_analysis',
    fact_version: 1,
    noop: false,
    result: {
      scenario_id: SCENARIO_ID,
      leading_option_id: 'opt_smb',
      summary: 'Prior analysis result',
      computed_at: new Date(Date.UTC(2026, 6, 10, 10, 1, 0)).toISOString(),
      ...(mayName === null
        ? {}
        : {
            constraint_verdict: {
              may_name_leading_option: mayName,
              constraint_verdict_state: mayName ? 'evaluated_feasible' : 'unevaluated',
            },
          }),
      enrichment: { analysis_status: 'completed' },
    },
  };
}

// Mutable per-test behaviour (the mocks below close over these).
let loadSummaryImpl: () => Promise<RollingSummary | null> = async () =>
  storedSummary(RESOLVED_SLOT_TEXT);
let readRecentTurns: MockTurn[] = BEYOND_WINDOW_TURNS;
let priorFacts: Array<Record<string, unknown>> = [];

vi.mock('../rolling-summary/index.js', () => ({
  getRollingSummaryStore: () => ({
    loadSummary: () => loadSummaryImpl(),
    upsertSummary: async () => ({ applied: true, regressed: false, current_watermark: null }),
  }),
  // The commit-seam maintainer (unconditional) must never hit a real model.
  getRollingSummaryModel: () => ({
    summarise: async () => ({ text: 'DECISION FRAME: noop.' }),
  }),
  resetRollingSummaryForTests: () => undefined,
}));

vi.mock('../session/index.js', () => ({
  getSessionStore: () => ({
    append: async () => ({ id: `row-${randomUUID()}` }),
    readRecent: async () => readRecentTurns,
    readFactsFor: async () => priorFacts,
    readFactsWithTurnFor: async () => [],
    invalidateScoped: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    invalidateAll: async () => ({ caches_invalidated: 0, scoped_to: 'session' }),
    storeDraftGraph: async () => undefined,
    loadGraph: async () => null,
    loadGraphAndBriefText: async () => ({ graph: null, briefText: null }),
    ensureScenarioExists: async () => ({ user_id: null }),
    readMostRecentPendingActions: async () => [],
  }),
  resetSessionStoreForTests: () => undefined,
}));

const { runTurnExecutor } = await import('../turn-executor.js');

function payload(message: string): MessageTurnPayload {
  return {
    kind: 'message',
    source: 'composer',
    turn_id: `t-${randomUUID()}`,
    scenario_id: SCENARIO_ID,
    message,
    turn_class: 'decide',
    stage: 'analyse',
  };
}

function textOnlyAdapter(): {
  adapter: { chatWithTools: (a: ChatWithToolsArgs) => Promise<ChatWithToolsResult> };
  calls: ChatWithToolsArgs[];
} {
  const calls: ChatWithToolsArgs[] = [];
  return {
    calls,
    adapter: {
      chatWithTools: async (args: ChatWithToolsArgs) => {
        calls.push(args);
        return {
          content: [{ type: 'text', text: 'Here is what I would focus on.' }],
          stop_reason: 'end_turn',
          usage: { input_tokens: 500, output_tokens: 40 } as ChatWithToolsResult['usage'],
          model: 'claude-sonnet-4-6',
          latencyMs: 25,
        };
      },
    },
  };
}

/** The serialised routing user message from the FIRST adapter call — the bytes. */
function routingUserMessage(calls: ChatWithToolsArgs[]): string {
  expect(
    calls.length,
    'the routing adapter was never called, so there are no model bytes to inspect — ' +
      'the fixture reached the wrong branch',
  ).toBeGreaterThan(0);
  const messages = calls[0]!.messages as Array<{ role: string; content: unknown }>;
  const user = messages.find((m) => m.role === 'user');
  expect(user).toBeDefined();
  return typeof user!.content === 'string' ? user!.content : JSON.stringify(user!.content);
}

async function runTurn(): Promise<string> {
  const { adapter, calls } = textOnlyAdapter();
  await runTurnExecutor(payload('So where does this leave things?'), `req-${randomUUID()}`, {
    routingAdapter: adapter,
  });
  return routingUserMessage(calls);
}

/**
 * The rendered four-slot BLOCK as the model receives it — i.e.
 * `conversation_summary.text`, decoded out of the serialised prompt.
 *
 * ⚠ SCOPED, AND THE SCOPE IS LOAD-BEARING. A first cut of this helper sliced
 * from `"conversation_summary":` to the next `\n  },` — but this section is the
 * LAST key of the pack object, so that slice ran off the end of the JSON and
 * swallowed the prompt's own instruction blocks, which legitimately contain
 * "do not recommend one option over another" and "win probabilities show how
 * often each option leads". The reader then flagged the PROMPT'S OWN GUARDRAIL
 * COPY and the absence assertion failed for a reason that had nothing to do
 * with the gate. Extracting the field precisely is what keeps these assertions
 * about THIS channel.
 */
function summaryBlockFromBytes(bytes: string): string {
  const at = bytes.indexOf('"conversation_summary":');
  expect(at, 'the conversation_summary section is absent from the model bytes').toBeGreaterThan(-1);
  const textKey = bytes.indexOf('"text":', at);
  expect(textKey, 'the conversation_summary section carries no text field').toBeGreaterThan(-1);
  const open = bytes.indexOf('"', textKey + '"text":'.length);
  // Walk to the closing quote, respecting backslash escapes — the rendered
  // block contains `\n` between slots, so a naive indexOf('"') would stop early
  // only if the content itself carried a quote, and this is cheap insurance.
  let i = open + 1;
  for (; i < bytes.length; i += 1) {
    if (bytes[i] === '\\') {
      i += 1;
      continue;
    }
    if (bytes[i] === '"') break;
  }
  return JSON.parse(bytes.slice(open, i + 1)) as string;
}

describe('G-CEE-1 — the ROLLING SUMMARY in the MODEL INPUT (conversation_summary)', () => {
  beforeEach(() => {
    setTestSink(() => {});
    loadSummaryImpl = async () => storedSummary(RESOLVED_SLOT_TEXT);
    readRecentTurns = BEYOND_WINDOW_TURNS;
    // The historic, unstamped shape ⇒ withheld by the fail-closed default.
    priorFacts = [priorRunAnalysisFact(null)];
  });

  afterEach(() => {
    setTestSink(null);
    vi.clearAllMocks();
  });

  // ── INSTRUMENT CHECKS, FIRST ───────────────────────────────────────────────

  it('INSTRUMENT: the live summary sentence is INVISIBLE to the shared alarm vocabulary', () => {
    // ⭐ THE MEASUREMENT THAT DICTATED THE DESIGN, asserted rather than asserted
    // about. If this ever stops being true (someone widens
    // LEADER_CLAIM_PATTERNS — good), this goes red and the "reuse #724's wider
    // reader" rationale must be re-derived rather than inherited.
    expect(textNamesLeadingOption(LIVE_SUMMARY_LEADER_SENTENCE)).toBe(false);
    // …and the redaction reader DOES see it. A gate that cannot see the string
    // sitting in the live summary is theatre (prove the instrument sees a
    // PRESENCE before asserting an ABSENCE).
    expect(historyAssertsLeaderClaim(LIVE_SUMMARY_LEADER_SENTENCE)).toBe(true);
  });

  it('INSTRUMENT: the control sentences are claim-free under BOTH readers', () => {
    // Or the survival assertions below would be measuring the leak arm again.
    for (const sentence of [LIVE_SUMMARY_NO_RANKING_SENTENCE, LIVE_SUMMARY_BLOCKER_SENTENCE]) {
      expect(textNamesLeadingOption(sentence)).toBe(false);
      expect(historyAssertsLeaderClaim(sentence)).toBe(false);
    }
    expect(historyAssertsLeaderClaim(LEADER_FREE_RESOLVED_TEXT)).toBe(false);
  });

  it('NON-VACUITY: the channel really is OPEN and carrying this summary', async () => {
    // Every absence assertion below is worthless if the section simply is not
    // there — and it would not be there if the store mock, the beyond-window
    // activation gate, the memory-hole guard or the pack key stopped working.
    const bytes = await runTurn();
    expect(bytes).toContain('"conversation_summary":');
    const section = summaryBlockFromBytes(bytes);
    // The four slot labels are all present: this is a rendered four-slot block,
    // not a memory-hole refusal (which ships `text: ''`).
    for (const label of Object.values(ROLLING_SUMMARY_SLOT_LABELS)) {
      expect(section).toContain(label);
    }
  });

  it('BRANCH DISCRIMINATOR: this turn really is withheld', async () => {
    // A fixture regression to a permitted verdict would make the leak arm below
    // pass for no reason at all. The 1.231 display_analysis gate is the
    // independent witness that the withheld branch was taken.
    const bytes = await runTurn();
    expect(bytes).toContain('Do not name or imply any option as the answer');
  });

  // ── THE LEAK ───────────────────────────────────────────────────────────────

  it('THE LEAK: the summary’s ordering claim must NOT reach the model bytes', async () => {
    const bytes = await runTurn();

    // The exact live sentence, and the fragments it would be recognised by.
    expect(bytes).not.toContain(LIVE_SUMMARY_LEADER_SENTENCE);
    expect(bytes).not.toContain('leading 52%');
    expect(bytes).not.toContain('52% vs Enterprise 35%');

    // And on the SECTION, read with the gate's own reader — so a future field
    // that re-exposes the same prose cannot make this pass by accident.
    const section = summaryBlockFromBytes(bytes);
    expect(historyAssertsLeaderClaim(section)).toBe(false);

    // NEVER SILENT: the marker says what is absent and why.
    expect(section).toContain(WITHHELD_HISTORY_REDACTION_MARKER);
  });

  // ── THE FOUR-SLOT CONTRACT ─────────────────────────────────────────────────

  it('FOUR-SLOT CONTRACT: every slot label survives, and no slot renders "(none)"', async () => {
    // The structural half, and the one a blanket gate would fail. Redaction is
    // applied to slot CONTENT only; the labels are split off first, so the block
    // the model reads is still a parseable four-slot block.
    const bytes = await runTurn();
    const section = summaryBlockFromBytes(bytes);
    for (const label of Object.values(ROLLING_SUMMARY_SLOT_LABELS)) {
      expect(section).toContain(`${label}:`);
    }
    // ⚠ AND THE SLOT MUST NOT HAVE BEEN EMPTIED. `inject.ts` documents a bare
    // "(none)" on a non-floor summary as "the summariser looked and found none"
    // — an AFFIRMATIVE claim that no settled history exists. A gate that emptied
    // RESOLVED would MINT that false claim while every absence assertion above
    // stayed green. The redacted slot must carry the marker instead.
    expect(section).not.toContain('(none)');
    expect(section).toContain(WITHHELD_HISTORY_REDACTION_MARKER);
  });

  // ── ANTI-OVER-SUPPRESSION ──────────────────────────────────────────────────

  it('ANTI-OVER-SUPPRESSION: the SURVIVING sentences of the redacted slot still reach the model', async () => {
    // The redaction is SENTENCE-scoped, not slot-scoped. A gate that blanked the
    // whole RESOLVED slot would pass every absence assertion above and destroy
    // the coach's memory of what the blocker is.
    const bytes = await runTurn();
    expect(bytes).toContain(LIVE_SUMMARY_BLOCKER_SENTENCE);
    expect(bytes).toContain(LIVE_SUMMARY_NO_RANKING_SENTENCE);
    // The OTHER THREE SLOTS are untouched — the claim was in RESOLVED only.
    expect(bytes).toContain(FRAME_SLOT_TEXT);
    expect(bytes).toContain(CONSTRAINTS_SLOT_TEXT);
    expect(bytes).toContain(OPEN_SLOT_TEXT);
  });

  it('POSITIVE CONTROL: a withheld turn with a LEADER-FREE summary is BYTE-IDENTICAL', async () => {
    // The over-suppression arm proper, and the one that fails if the gate ever
    // becomes unconditional. Same verdict, same path, claim-free content.
    loadSummaryImpl = async () => storedSummary(LEADER_FREE_RESOLVED_TEXT);

    const bytes = await runTurn();
    expect(bytes).toContain(LEADER_FREE_RESOLVED_TEXT);
    expect(bytes).not.toContain(WITHHELD_HISTORY_REDACTION_MARKER);
  });

  it('POSITIVE CONTROL: on a PERMITTED verdict the summary ships VERBATIM', async () => {
    // Same summary, same path, opposite verdict. Byte-identity with a world in
    // which this gate does not exist — and the branch-reached proof for the
    // withheld arms above, since only a fixture that really loaded the stored
    // summary can produce these bytes.
    priorFacts = [priorRunAnalysisFact(true)];

    const bytes = await runTurn();
    expect(bytes).toContain(LIVE_SUMMARY_LEADER_SENTENCE);
    expect(bytes).toContain('leading 52%');
    expect(bytes).not.toContain(WITHHELD_HISTORY_REDACTION_MARKER);
  });

  it('the INJECTED MARKER is inert under every reader, on the REAL prompt bytes', async () => {
    // An input gate that injected leader-vocabulary residue into every withheld
    // prompt would show up only as an alarm rate nobody had a reason to look at
    // — the trap `withheld-leader-projection.ts` records hitting with "out in
    // front". Checked on the real bytes, not on the constant alone.
    const bytes = await runTurn();
    expect(bytes).toContain(WITHHELD_HISTORY_REDACTION_MARKER);
    expect(textNamesLeadingOption(WITHHELD_HISTORY_REDACTION_MARKER)).toBe(false);
    expect(historyAssertsLeaderClaim(WITHHELD_HISTORY_REDACTION_MARKER)).toBe(false);
  });

  it('IDEMPOTENT: projecting a summary that already carries the marker changes nothing', async () => {
    // A pack can be projected twice (a retry, a future second consumer). If the
    // marker tripped the reader, the second pass would redact the marker into a
    // marker-of-a-marker and the block would degrade on every re-entry.
    loadSummaryImpl = async () =>
      storedSummary(`${WITHHELD_HISTORY_REDACTION_MARKER} ${LIVE_SUMMARY_NO_RANKING_SENTENCE}`);

    const bytes = await runTurn();
    const section = summaryBlockFromBytes(bytes);
    expect(section).toContain(WITHHELD_HISTORY_REDACTION_MARKER);
    expect(section).toContain(LIVE_SUMMARY_NO_RANKING_SENTENCE);
    // Exactly ONE marker — not a marker that has been re-redacted.
    const occurrences = section.split(WITHHELD_HISTORY_REDACTION_MARKER).length - 1;
    expect(occurrences).toBe(1);
  });
});
