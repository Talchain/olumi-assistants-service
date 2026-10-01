/**
 * ⭐ AI HARNESS G1 — a pressed next step does not come back until the state it was pressed in changes (Paul's 1 Oct
 * test: "Strengthen the model" reappeared on the reply to its own press). Deterministic, over the durable record
 * (`coaching/agent-guidance-snapshot.ts`), so a restart remembers it.
 *
 * INTERIM: the three static next steps (`NEXT_STEP_CHIPS`) are keyed by the Reasoning Coach contract's policy ids
 * (programme-docs `rc/reasoning-coach-20261001` @6c4fbffd). The Coach selector (`selectGuidance`) replaces WHICH rows
 * are offered; the record, the press and the re-entry rule here stay.
 *
 * Re-entry rule: an entry pressed / completed / dismissed in state S suppresses its row while the state is S. The
 * state is the model and the Run the step acts on (graph hash, run kind, the Run's computed_at): an edit or a new Run
 * makes every row eligible again. Pure.
 */
import {
  guidanceKey,
  stateKeyHash,
  withEntry,
  type AgentGuidanceRecord,
} from '../../coaching/agent-guidance-snapshot.js';

/** The static next steps, by the contract's policy ids. */
export const NEXT_STEP_POLICY: Readonly<Record<string, string>> = Object.freeze({
  'agent-next-pre-mortem': 'RC-PREMORTEM',
  'agent-next-what-would-change': 'RC-WHAT-CHANGES',
  'agent-next-strengthen': 'RC-STRENGTHEN-ITEM',
});

function policyKeyOf(chipId: unknown): string | undefined {
  return typeof chipId === 'string' && Object.prototype.hasOwnProperty.call(NEXT_STEP_POLICY, chipId) ? guidanceKey(NEXT_STEP_POLICY[chipId]!) : undefined;
}

/** The state a next step is judged in: the saved model and the Run it would act on. */
export function nextStepStateKey(s: { readonly graphHash?: string | null; readonly analysisState?: unknown }): string {
  const run = (s.analysisState as { run_state?: { kind?: unknown; computed_at?: unknown } } | null | undefined)?.run_state;
  return stateKeyHash({
    graph_hash: typeof s.graphHash === 'string' ? s.graphHash : null,
    run_kind: typeof run?.kind === 'string' ? run.kind : null,
    computed_at: typeof run?.computed_at === 'string' ? run.computed_at : null,
  });
}

/** The inbound chip, if it is a next step: recorded as pressed in the state the user is now looking at. */
export function recordPress(record: AgentGuidanceRecord, pressedChipId: unknown, stateKey: string, turnId: string | null): AgentGuidanceRecord {
  const key = policyKeyOf(pressedChipId);
  return key === undefined ? record : withEntry(record, key, { status: 'pressed', state_key_hash: stateKey, turn_id: turnId });
}

function settledIn(record: AgentGuidanceRecord, key: string, stateKey: string): boolean {
  const e = record.entries[key];
  return e !== undefined && e.status !== 'offered' && e.state_key_hash === stateKey;
}

/** The candidates without any next step settled (pressed / completed / dismissed) in THIS state, order kept. */
export function withoutSettledNextSteps<T extends { readonly id: string }>(candidates: readonly T[], record: AgentGuidanceRecord, stateKey: string): T[] {
  return candidates.filter((c) => {
    const key = policyKeyOf(c.id);
    return key === undefined || !settledIn(record, key, stateKey);
  });
}

/** Each next step actually offered, recorded as offered in this state. Other chips are not guidance and are skipped. */
export function recordOffers(record: AgentGuidanceRecord, offered: readonly { readonly id: string }[], stateKey: string, turnId: string | null): AgentGuidanceRecord {
  let out = record;
  for (const c of offered) {
    const key = policyKeyOf(c.id);
    if (key === undefined || settledIn(out, key, stateKey)) continue;
    const prior = out.entries[key];
    if (prior?.status === 'offered' && prior.state_key_hash === stateKey) continue;
    out = withEntry(out, key, { status: 'offered', state_key_hash: stateKey, turn_id: turnId });
  }
  return out;
}
