/** Small UI state for a recorded rehearsal. It performs no model writes or calculations. */
export const initialRehearsal = () => ({ phase: 'before', choice: 'offered', explored: false, approvalPending: false });

export function transition(state, event) {
  if (event === 'reset') return initialRehearsal();
  if (event === 'explore' && state.choice !== 'dismissed') return { ...state, explored: true };
  if (event === 'add' && state.choice !== 'dismissed') return { ...state, choice: 'added' };
  if (event === 'dismiss' && state.phase === 'before') return { ...state, choice: 'dismissed', approvalPending: false };
  if (event === 'propose_change' && state.phase === 'before' && state.choice === 'added') {
    return { ...state, approvalPending: true };
  }
  if (event === 'cancel_change') return { ...state, approvalPending: false };
  if (event === 'approve_change' && state.phase === 'before' && state.approvalPending && state.choice === 'added') {
    return { ...state, phase: 'stale', approvalPending: false };
  }
  if (event === 'replay_rerun' && state.phase === 'stale') return { ...state, phase: 'after' };
  return state;
}

/** Currentness is the owner's precomputed verdict, on these exact recorded identities only. */
export function evidenceFor(data, state) {
  const selected = data.states[state.phase];
  const allowed = data.card_currentness[state.phase]?.[state.phase]?.[0] === true;
  return allowed && selected.card.no_card === null ? selected.card.lines : [];
}
