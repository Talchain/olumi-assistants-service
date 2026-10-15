import type { PolicyId } from './types.js';

/**
 * ⛔ THE GUIDANCE ROWS THE SHARED STORE CAN HOLD (Lane A A3(a), 15 Oct). The live `append_agent_answer_with_guidance`
 * (migration 20261010010000; read-only dump 15 Oct) admits only these entry keys and refuses the WHOLE answer for any
 * other ("invalid content-free guidance event"). #3052 offered RC-OUTSIDE-VIEW with no migration, so every answer that
 * showed it was lost (Paul's pricing turn b5a28fad: `durability: not_recorded`). One list, read by the writer, the reader
 * and the selector: a row whose showing cannot be recorded is never offered, because only a recorded showing cools it
 * (E6: a row is said once per state). RC-OUTSIDE-VIEW returns with the additive migration (an ask to Paul after Monday).
 */
export const HELD_POLICY_IDS: ReadonlySet<PolicyId> = new Set<PolicyId>(['RC-WIDEN', 'RC-WHAT-CHANGES', 'RC-PREMORTEM', 'RC-COACH-EDITS', 'RC-STRENGTHEN-ITEM']);

/** An entry key the store holds: a held policy id, or for the per-item row the id + ':' + a 12-hex item hash. */
export function isHeldEntryKey(key: string): boolean {
  const [id, item, ...rest] = key.split(':');
  if (rest.length > 0 || !HELD_POLICY_IDS.has(id as PolicyId)) return false;
  return id === 'RC-STRENGTHEN-ITEM' ? /^[0-9a-f]{12}$/.test(item ?? '') : item === undefined;
}

/**
 * The store's own refusals of guidance metadata. Each is raised by `append_agent_answer_with_guidance` BEFORE its lock and
 * its `append_turn_atomic_v2` call, inside the one RPC transaction, so the row was DEFINITELY not written: the route may
 * append the same answer once more without the guidance. Any other failure has an unknown outcome and is never retried.
 */
export const GUIDANCE_ENTRY_REFUSALS = ['invalid content-free guidance event', 'invalid guidance envelope', 'guidance event cap exceeded'] as const;
