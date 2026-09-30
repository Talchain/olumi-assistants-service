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

// The second frozen case set travels through the Lab's existing read-only JSON endpoint.
// Check its original bytes and graph binding before either case reaches the UI.
export const REGIONS_SOURCE = Object.freeze({
  repository: 'Talchain/Inference-Service-Layer',
  commit: 'cef7f7c66f1653d5006194f297fbb1eda6c14392',
  path: 'experiments/sci_regions_v1/lab/cases.json',
  sha256: 'a7f7c785e85ce048c527dc25736baf837093c6082fcfb4e9cd11e8ff020bb0f7',
  graph_id: 'pj-20260927T180910Z-A',
  graph_sha256: '6b9a09e5f5da590ab42db6bd0a52d43669cbc5e8c9fe361e744a73e2cae31c5c',
  mapping_sha256: '235ef1db77ae8cdb816a203d49f06501c1f490d525c6219799c0a0211c96fc21',
  evaluator_sha256: '7082e94860d80ef4409aa7e4db7ebe9b9dd7ae3660d92db3faef200ff800cd13',
});

export async function readFrozenRegions(raw, binding = REGIONS_SOURCE) {
  if (typeof raw !== 'string') throw new Error('Pinned Regions source missing; cases withheld.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const sha256 = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  if (sha256 !== binding.sha256) throw new Error('Pinned Regions source changed; cases withheld.');
  const cases = JSON.parse(raw);
  if (!Array.isArray(cases) || cases.length !== 2 ||
      cases[0]?.case_id !== 'r3b-A-180910Z-net-churn-limit' ||
      cases[1]?.case_id !== 'r3b-A-180910Z-new-pro-grandfathering-unavailable') {
    throw new Error('Pinned Regions case set changed; cases withheld.');
  }
  for (const item of cases) {
    const p = item.provenance;
    if (p?.graph_id !== binding.graph_id || p?.graph_sha256 !== binding.graph_sha256 ||
        p?.mapping_sha256 !== binding.mapping_sha256 || p?.evaluator_sha256 !== binding.evaluator_sha256 ||
        p?.model_id !== 'X_net_reading' || p?.tier !== 'X' ||
        p?.source_kind !== 'PINNED_R3B_RESEARCH') {
      throw new Error('Pinned Regions graph or source binding changed; cases withheld.');
    }
  }
  const [threshold, unavailable] = cases;
  if (threshold.flip_thresholds_status !== 'computed' ||
      threshold.flip_kind !== 'HARD_CONSTRAINT_FEASIBILITY' ||
      threshold.crossing_rule !== 'GREATER_THAN' ||
      threshold.flip_threshold !== 1.5 || threshold.current_value !== 0.5 ||
      unavailable.flip_thresholds_status !== 'unavailable' ||
      unavailable.reason?.code !== 'OPTION_LEVELS_MISSING' ||
      unavailable.flip_threshold !== null || unavailable.current_value !== null ||
      unavailable.flip_kind !== null || unavailable.flip_meaning !== null) {
    throw new Error('Pinned Regions feasibility or unavailable control changed; cases withheld.');
  }
  return { status: 'FROZEN_R3B_RESEARCH', source: binding, cases };
}
