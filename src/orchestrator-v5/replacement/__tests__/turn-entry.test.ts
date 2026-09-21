/**
 * The entry point: state in, a reply out, and the ordering that makes
 * "Yes, make that update now" work on the turn after the offer.
 */

import { describe, expect, it, vi } from 'vitest';

import { log } from '../../../utils/telemetry.js';
import { EMPTY_CONVERSATION_MEMORY, recordItem } from '../conversation-memory.js';
import { EMPTY_PROPOSAL_STORE, type Proposal } from '../proposal-store.js';
import { ACCEPT_TOOL_NAME, type ApplyOperations } from '../run-replacement-turn.js';
import type { ChatWithToolsLike } from '../agent-loop.js';
import type { ToolResponseBlock } from '../../../adapters/llm/types.js';
import type { AgentTool } from '../agent-loop.js';
import {
  EMPTY_REPLACEMENT_STATE,
  ReplacementStateConflictError,
  buildReplacementTools,
  ReplacementTurnFailure,
  decodeReplacementState,
  handleReplacementTurn,
  summariseWorkspace,
  type ReplacementState,
  type ReplacementStateStore,
} from '../turn-entry.js';

const T = '2026-09-20T12:00:00.000Z';

function scripted(replies: { content: ToolResponseBlock[]; stop_reason: 'end_turn' | 'tool_use' | 'max_tokens' }[]): ChatWithToolsLike {
  let i = 0;
  return async () => replies[Math.min(i++, replies.length - 1)]!;
}
const say = (text: string) => ({ content: [{ type: 'text' as const, text }], stop_reason: 'end_turn' as const });

/**
 * A store that ENFORCES the token, so a turn that mismanaged its own
 * revision would fail here rather than pass by accident. A permissive fake
 * would let the checkpoint-then-final pair "work" even if the entry point
 * never advanced the token it holds.
 */
function memoryStore(
  initial: ReplacementState = EMPTY_REPLACEMENT_STATE,
): ReplacementStateStore & { saved: ReplacementState[]; readonly revision: string } {
  const saved: ReplacementState[] = [];
  let current = initial;
  let revision = 'rev-0';
  let minted = 0;
  return {
    saved,
    get revision() { return revision; },
    load: async () => ({ state: current, revision }),
    save: async (id, s, expected) => {
      if (expected !== revision) throw new ReplacementStateConflictError(id, expected);
      current = s;
      saved.push(s);
      revision = `rev-${(minted += 1)}`;
      return revision;
    },
  };
}

/** Loads fine; every write loses the race. Records what token each attempt
 *  carried, so "did the turn stop writing?" is answerable by count. */
function losingStore(
  initial: ReplacementState = EMPTY_REPLACEMENT_STATE,
): ReplacementStateStore & { attempts: Array<string | null> } {
  const attempts: Array<string | null> = [];
  return {
    attempts,
    load: async () => ({ state: initial, revision: 'rev-0' }),
    save: async (id, _s, expected) => {
      attempts.push(expected);
      throw new ReplacementStateConflictError(id, expected);
    },
  };
}

const GRAPH = {
  nodes: [
    { id: 'd1', kind: 'decision', label: 'Pricing' },
    { id: 'o1', kind: 'option', label: 'Full Parity' },
    { id: 'o2', kind: 'option', label: 'Hold' },
    { id: 'f1', kind: 'factor', label: 'Monthly Churn Rate' },
  ],
  edges: [],
} as never;

function entryInput(over: Record<string, unknown> = {}) {
  return {
    scenarioId: 'sc-1',
    message: 'What should I be worried about here?',
    history: [],
    getGraph: () => GRAPH,
    getAnalysis: () => null,
    modelRevision: 'rev-1',
    turnId: 'turn-1',
    requestId: 'req-1',
    now: T,
    ...over,
  } as Parameters<typeof handleReplacementTurn>[0];
}

describe('a stored blob is data from outside the process', () => {
  it('reads anything unrecognised as empty rather than throwing', () => {
    // Deliberately the opposite of `v5_handler_facts.payload`, whose strict
    // parse on an unfiltered read takes the whole scenario down when one row
    // is not recognised.
    for (const junk of [null, undefined, 42, 'text', [], {}, { version: 2 }, { version: 1 }]) {
      expect(() => decodeReplacementState(junk)).not.toThrow();
      expect(decodeReplacementState(junk)).toEqual(EMPTY_REPLACEMENT_STATE);
    }
  });

  it('round-trips real state through JSON', () => {
    const state: ReplacementState = {
      version: 1,
      memory: recordItem(EMPTY_CONVERSATION_MEMORY, {
        id: 'i1', kind: 'user_fact', text: 'Churn is 3%', source_turn_id: 't1', recorded_at: T,
      }),
      proposals: EMPTY_PROPOSAL_STORE,
    };
    const back = decodeReplacementState(JSON.parse(JSON.stringify(state)));
    expect(back.memory.items).toHaveLength(1);
    expect(back.memory.items[0]?.text).toBe('Churn is 3%');
  });

  it('rejects a blob whose shape is right but whose version is not — the field exists so a migration can', () => {
    expect(decodeReplacementState({ version: 99, memory: { items: [] }, proposals: { proposals: [] } }))
      .toEqual(EMPTY_REPLACEMENT_STATE);
  });
});

describe('the standing workspace line is thin on purpose', () => {
  it('counts what is there and sends the model to the tool for detail', () => {
    const s = summariseWorkspace(GRAPH);
    expect(s).toContain('1 decision, 1 factor, 2 options');
    expect(s).toContain('read_workspace');
    expect(s).toContain('do not guess at labels or values');
  });

  it('is null when there is no model, so the prompt says so rather than describing an empty one', () => {
    expect(summariseWorkspace(null)).toBeNull();
    expect(summariseWorkspace({ nodes: [], edges: [] } as never)).toBeNull();
  });
});

describe('state is saved before the reply is returned', () => {
  it('persists the post-turn state, not the state it loaded', async () => {
    const store = memoryStore();
    const r = await handleReplacementTurn(entryInput(), {
      chatWithTools: scripted([say('The churn assumption is doing all the work here.')]),
      state: store,
    });
    expect(r.assistantText).toContain('churn assumption');
    expect(store.saved).toHaveLength(1);
    expect(store.saved[0]?.version).toBe(1);
  });

  it('a failed save is a hard failure, not a silently unsaved turn', async () => {
    const store: ReplacementStateStore = {
      load: async () => ({ state: EMPTY_REPLACEMENT_STATE, revision: null }),
      save: async () => { throw new Error('connection reset'); },
    };
    await expect(
      handleReplacementTurn(entryInput(), { chatWithTools: scripted([say('x')]), state: store }),
    ).rejects.toThrow(ReplacementTurnFailure);
  });

  it('a failed save after a write reports that a write may have landed', async () => {
    const store: ReplacementStateStore = {
      load: async () => ({ state: EMPTY_REPLACEMENT_STATE, revision: null }),
      save: async () => { throw new Error('connection reset'); },
    };
    // No write happened on this turn, so the flag is false — the contrast
    // that proves the flag tracks the write rather than the failure.
    let err: unknown;
    try {
      await handleReplacementTurn(entryInput(), { chatWithTools: scripted([say('x')]), state: store });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReplacementTurnFailure);
    // Narrowed by the assertion above, not by a cast — a cast here would let
    // the field disappear from the type without this test noticing.
    if (!(err instanceof ReplacementTurnFailure)) throw new Error('expected the typed failure');
    expect(err.mayHaveWritten).toBe(false);
    // A transport failure is not a conflict. Named apart because they lead
    // to different words: "the store is broken" vs "another turn won".
    expect(err.stateConflict).toBe(false);
  });

});

// ── optimistic concurrency ──────────────────────────────────────────────

/** An offer already on the books, bound to the revision the turn runs at. */
const OPEN_PROPOSAL: Proposal = {
  id: 'prop-open',
  status: 'open',
  operations: [
    { kind: 'set_option_effect', summary: 'Set what Full Parity does to Monthly Churn Rate to 0.4' },
  ],
  model_revision: 'rev-1',
  proposed_at: T,
  proposed_in_turn: 'turn-0',
};

/** A write whose outcome is UNKNOWN: no receipt, and it never enters
 *  `applied`. This is the state `mayHaveWritten` exists for. */
const IN_FLIGHT_PROPOSAL: Proposal = {
  ...OPEN_PROPOSAL,
  id: 'prop-in-flight',
  status: 'apply_in_flight',
  authorised_in_turn: 'turn-0',
  authorised_at: T,
  idempotency_key: 'idem-0',
  apply_started_at: T,
  apply_attempts: 1,
};

function withProposal(p: Proposal): ReplacementState {
  return { version: 1, memory: EMPTY_CONVERSATION_MEMORY, proposals: { proposals: [p] } };
}
const withOpenProposal = (): ReplacementState => withProposal(OPEN_PROPOSAL);

function acceptingInput() {
  return entryInput({ turnId: 'turn-1', message: 'Yes, go ahead and make that change.' });
}

/** Accepts the standing offer, then answers. The quote is the user's own
 *  words from `acceptingInput`, because consent is checked against the turn. */
function acceptingModel(): ChatWithToolsLike {
  return scripted([
    {
      content: [
        {
          type: 'tool_use',
          id: 'a1',
          name: ACCEPT_TOOL_NAME,
          input: { proposal_id: 'prop-open', user_agreement_quote: 'Yes, go ahead' },
        },
      ],
      stop_reason: 'tool_use',
    },
    say('Done.'),
  ]);
}

describe('a turn built from a stale read cannot dispatch a write', () => {
  it('a conflict at the PRE-DISPATCH CHECKPOINT sends nothing', async () => {
    // The harm: turn A and turn B both read; A moves the row; B then
    // authorises an offer that no longer exists as B saw it. The checkpoint
    // is where B finds out, and it finds out BEFORE the write leaves.
    const store = losingStore(withOpenProposal());
    const write = vi.fn<ApplyOperations>(async () => ({ ok: true, receiptId: 'receipt-1' }));

    await handleReplacementTurn(acceptingInput(), {
      chatWithTools: acceptingModel(),
      state: store,
      applyOperations: write,
    }).catch(() => undefined);

    // Bound to the dispatch itself, not to a downstream symptom.
    expect(write).not.toHaveBeenCalled();
    // And it tried — the refusal is the store's answer, not a turn that
    // never reached the barrier.
    expect(store.attempts.length).toBeGreaterThan(0);
  });

  it('CONTRAST: the SAME turn against a store that accepts the token DOES dispatch', async () => {
    // ⭐ The discriminating half. A store that refused every save would pass
    // the test above and be worthless; only this pair shows the refusal is
    // the TOKEN's doing. Everything is identical except the store.
    const write = vi.fn<ApplyOperations>(async () => ({ ok: true, receiptId: 'receipt-1' }));

    const r = await handleReplacementTurn(acceptingInput(), {
      chatWithTools: acceptingModel(),
      state: memoryStore(withOpenProposal()),
      applyOperations: write,
    });

    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.calls[0]?.[0]?.proposalId).toBe('prop-open');
    expect(r.applied.map((a) => a.receiptId)).toEqual(['receipt-1']);
  });

  it('saves twice in one turn without conflicting with ITSELF — the token chains', async () => {
    // The checkpoint-then-final pair is ordinary, and a turn that held its
    // ORIGINAL token for the second write would be refused by its own store,
    // so no write would ever complete. `memoryStore` enforces the token; a
    // permissive fake could not observe this.
    const store = memoryStore(withOpenProposal());

    const r = await handleReplacementTurn(acceptingInput(), {
      chatWithTools: acceptingModel(),
      state: store,
      applyOperations: async () => ({ ok: true, receiptId: 'receipt-1' }),
    });

    expect(r.applied.map((a) => a.proposalId)).toEqual(['prop-open']);
    // Checkpoint AND final, both accepted, in one turn.
    expect(store.saved).toHaveLength(2);
    expect(store.revision).toBe('rev-2');
  });
});

describe('what the caller is told differs at the two save points', () => {
  it('an END-OF-TURN conflict with nothing in flight: the turn is lost, nothing is uncertain', async () => {
    // Read-only turn — the route's current posture. Nothing was dispatched,
    // so the honest thing is "say that again", not "I cannot tell you".
    let err: unknown;
    try {
      await handleReplacementTurn(entryInput(), {
        chatWithTools: scripted([say('The churn assumption is doing all the work here.')]),
        state: losingStore(),
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReplacementTurnFailure);
    if (!(err instanceof ReplacementTurnFailure)) throw new Error('expected the typed failure');
    expect(err.stateConflict).toBe(true);
    expect(err.mayHaveWritten).toBe(false);
    expect(err.message).toContain('another turn');
  });

  it('an END-OF-TURN conflict with a write IN FLIGHT: may have written, and says so', async () => {
    // ⛔ The case the old code got wrong. `applied` holds writes WITH
    // RECEIPTS; a write whose outcome is unknown has none and never enters
    // it. Reading only `applied` reported `mayHaveWritten: false` on the one
    // state that exists to mean "we do not know".
    //
    // No `applyOperations` here, so nothing is retried and the in-flight
    // proposal is carried straight through — the read-only route's shape.
    let err: unknown;
    try {
      await handleReplacementTurn(entryInput(), {
        chatWithTools: scripted([say('ok')]),
        state: losingStore(withProposal(IN_FLIGHT_PROPOSAL)),
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(ReplacementTurnFailure);
    if (!(err instanceof ReplacementTurnFailure)) throw new Error('expected the typed failure');
    expect(err.mayHaveWritten).toBe(true);
    expect(err.stateConflict).toBe(true);
  });

  it('CONTRAST: the same in-flight state saves cleanly when the token is current', async () => {
    // Pins the precondition rather than trusting the outcome: the in-flight
    // proposal is what made the flag true above, and on its own it does NOT
    // make the turn fail. Without this, a turn that failed for any reason at
    // all would satisfy the test above.
    const store = memoryStore(withProposal(IN_FLIGHT_PROPOSAL));
    const r = await handleReplacementTurn(entryInput(), {
      chatWithTools: scripted([say('ok')]),
      state: store,
    });
    expect(r.mustReconcile.map((p) => p.id)).toEqual(['prop-in-flight']);
    expect(store.saved).toHaveLength(1);
  });
});

describe('the read tools are always present', () => {
  it('offers read_workspace and read_results on every turn', async () => {
    const seen: string[][] = [];
    const spy: ChatWithToolsLike = async ({ tools }) => {
      seen.push(tools.map((t) => t.name));
      return say('ok');
    };
    await handleReplacementTurn(entryInput(), { chatWithTools: spy, state: memoryStore() });
    expect(seen[0]).toContain('read_workspace');
    expect(seen[0]).toContain('read_results');
    // Not optional. Its absence is what ended a live session, so no call site
    // can forget to pass it.
    expect(seen[0]).toContain('set_option_effect');
    expect(seen[0]).toContain('run_analysis');
    expect(seen[0]).toContain('remember');
    // Also not optional. A model that can read the workspace but cannot add
    // the node the user just named has to refuse the most ordinary request
    // there is.
    expect(seen[0]).toContain('add_factor');
    expect(seen[0]).toContain('add_option');
    expect(seen[0]).toContain('add_link');
  });

  it('carries prior state into the prompt so the conversation does not restart each turn', async () => {
    const store = memoryStore({
      version: 1,
      memory: recordItem(EMPTY_CONVERSATION_MEMORY, {
        id: 'i1', kind: 'user_fact', text: 'We cannot discount below 78% margin',
        source_turn_id: 't0', recorded_at: T,
      }),
      proposals: EMPTY_PROPOSAL_STORE,
    });
    let system = '';
    const spy: ChatWithToolsLike = async (a) => { system = a.system; return say('ok'); };
    await handleReplacementTurn(entryInput(), { chatWithTools: spy, state: store });
    expect(system).toContain('THE USER STATED AS FACT');
    expect(system).toContain('We cannot discount below 78% margin');
  });
});

describe('without a write path the turn says so', () => {
  it('declares saving unavailable rather than letting the model discover it', async () => {
    let system = '';
    const spy: ChatWithToolsLike = async (a) => { system = a.system; return say('ok'); };
    await handleReplacementTurn(entryInput(), { chatWithTools: spy, state: memoryStore() });
    expect(system).toContain('saving a change to the model on this turn');
  });

  it('does not declare it unavailable when a write path is present', async () => {
    let system = '';
    const spy: ChatWithToolsLike = async (a) => { system = a.system; return say('ok'); };
    await handleReplacementTurn(entryInput(), {
      chatWithTools: spy, state: memoryStore(),
      applyOperations: async () => ({ ok: true, receiptId: 'r1' }),
    });
    expect(system).not.toContain('saving a change to the model on this turn');
  });
});

/**
 * The end-to-end path for the thing the first increment actually promises:
 * what the user establishes survives into the next turn's prompt.
 */
describe('what the user establishes reaches the record and the next prompt', () => {
  it('a remembered fact is stored, and is rendered as THEIRS on the following turn', async () => {
    const store = memoryStore();
    const remembering: ChatWithToolsLike = async ({ messages }) => {
      const alreadyCalled = JSON.stringify(messages).includes('tool_result');
      if (alreadyCalled) return say('Noted.');
      return {
        content: [{
          type: 'tool_use', id: 'r1', name: 'remember',
          input: { items: [{ kind: 'user_fact', text: 'Churn is 3% a month' }] },
        }],
        stop_reason: 'tool_use',
      };
    };
    const first = await handleReplacementTurn(
      entryInput({ message: 'Churn is 3% a month, for what it is worth.' }),
      { chatWithTools: remembering, state: store },
    );
    expect(first.state.memory.items.some((i) => i.text === 'Churn is 3% a month')).toBe(true);

    let system = '';
    const spy: ChatWithToolsLike = async (a) => { system = a.system; return say('ok'); };
    await handleReplacementTurn(entryInput({ turnId: 'turn-2', message: 'and now?' }), {
      chatWithTools: spy, state: store,
    });
    expect(system).toContain('THE USER STATED AS FACT');
    expect(system).toContain('Churn is 3% a month');
    // And it is NOT filed as something the assistant merely suggested.
    expect(system).not.toContain('YOU SUGGESTED (not agreed, not applied):\n- Churn is 3% a month');
  });
});

/**
 * ⛔ THE SECOND COPY OF THIS LIST WAS ALREADY WRONG WHEN IT WAS FOUND.
 *
 * The live harness hand-listed the tools and was missing FOUR of the eight then-current tools —
 * `run_analysis` and all three structure tools — so every live judgement about
 * what the model does with them was a judgement about tools it was never
 * offered. Its own comment records an earlier instance of the same drift with
 * `remember`. Both callers now call `buildReplacementTools`, so there is no
 * mirror left to keep in step.
 *
 * This pins the SET by name, because the extraction removes the drift between
 * copies and cannot notice a tool quietly dropped from the one remaining list.
 * Deriving the expectation from the function under test would be the same
 * function agreeing with itself.
 */
describe('the tool list is built in ONE place, and every tool is offered', () => {
  const NAMES = [
    'read_workspace',
    'read_results',
    'remember',
    'set_option_effect',
    'run_analysis',
    // Added 21 Sep with the bounded repair set. `propose_repairs` puts the
    // whole gap set forward at once; `resolve_blocked_link` carries the only
    // repairs that can clear an option blocked by a link to a risk (no effect
    // value can — see `RepairBlockedLink`). This list going red when they
    // landed is the guard working, not a nuisance.
    'propose_repairs',
    'resolve_blocked_link',
    'add_factor',
    'add_option',
    'add_link',
  ];

  function build(proposeTools?: AgentTool[]) {
    return buildReplacementTools({
      getGraph: () => null,
      getAnalysis: () => null,
      getMemory: () => EMPTY_CONVERSATION_MEMORY,
      requestId: 'req-1',
      ...(proposeTools === undefined ? {} : { proposeTools }),
    });
  }

  it('offers exactly the ten tools, by name and in order', () => {
    expect(build().map((t) => t.definition.name)).toEqual(NAMES);
  });

  it('appends caller-supplied propose tools AFTER the standing set, without displacing any', () => {
    const extra: AgentTool = {
      kind: 'propose',
      definition: { name: 'extra_tool', description: 'x', input_schema: { type: 'object', properties: {} } },
      execute: () => ({ type: 'proposed', summary: 's', operations: [] }),
    };
    expect(build([extra]).map((t) => t.definition.name)).toEqual([...NAMES, 'extra_tool']);
  });
});

/**
 * ⭐⭐ THE RECORD MUST ACTUALLY LEAVE THE PROCESS.
 *
 * A trace that is computed, returned, and consumed by nobody is this estate's
 * chronic failure #1 wearing an observability badge — and writing one was how
 * this block came to exist. The controller deliberately owns no sink, so the
 * emit lives here, at the integration boundary, and these tests are what stop
 * it being quietly removed or never wired at all.
 */
describe('the turn record reaches the log, and survives the turn that needs it most', () => {
  function traceEvents(spy: { mock: { calls: unknown[][] } }) {
    return spy.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .filter((o) => o !== null && typeof o === 'object' && o.event === 'v5.replacement.turn');
  }

  it('emits the decision chain, keyed on the correlation id the caller supplied', async () => {
    const spy = vi.spyOn(log, 'info').mockImplementation(() => undefined as never);
    try {
      const store = memoryStore();
      const r = await handleReplacementTurn(entryInput({ turnId: 'turn-xyz' }), {
        chatWithTools: scripted([say('A plain answer.')]),
        state: store,
      });
      const events = traceEvents(spy as never);
      expect(events, 'exactly one record per turn').toHaveLength(1);
      // ⭐ ONE ID SPANNING UI -> CONTROLLER -> WRITE: the value the caller sent.
      expect(events[0]!.correlation_id).toBe('turn-xyz');
      expect(events[0]!.correlation_id).toBe(r.trace.correlation_id);
      expect(events[0]!.scenario_id).toBe('sc-1');
      expect(events[0]!.controller).toBe('replacement');
      expect(events[0]!.outcome).toBe('completed');
      expect(events[0]!.write_attempted).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  /**
   * ⛔ THE ORDERING CLAIM, PINNED RATHER THAN ASSERTED IN A COMMENT.
   *
   * The emit sits BEFORE the final state save because a save that fails throws
   * out of the entry — and that is precisely the turn whose record is hardest
   * to reconstruct afterwards. Emitting after the save would lose it exactly
   * when it is needed. Nothing in the trace depends on the save landing: it
   * describes what the turn DID, which is already settled by that point.
   */
  it('still emits when the final save throws — the turn hardest to reconstruct', async () => {
    const spy = vi.spyOn(log, 'info').mockImplementation(() => undefined as never);
    try {
      const store: ReplacementStateStore = {
        load: async () => ({ state: EMPTY_REPLACEMENT_STATE, revision: null }),
        save: async () => { throw new Error('connection reset'); },
      };
      await expect(
        handleReplacementTurn(entryInput(), { chatWithTools: scripted([say('x')]), state: store }),
      ).rejects.toThrow();
      expect(traceEvents(spy as never), 'the record survives the failure').toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
