import type { SuggestedAction } from '../compose/types.js';

/**
 * The pre-mortem plan pick's live id is `agent-premortem-plan:<12 hex>` (method-turn.ts PLAN_PICK_PREFIX); the migration's
 * id check refuses ':', so it is stored as `agent-premortem-plan-<12 hex>` and restored as the live id (P48 probe5, 8 Oct).
 */
const PLAN_PICK_LIVE = 'agent-premortem-plan:';
const PLAN_PICK_STORED = 'agent-premortem-plan-';
export const storedOfferId = (id: string): string => (/^agent-premortem-plan:[0-9a-f]{12}$/.test(id) ? PLAN_PICK_STORED + id.slice(PLAN_PICK_LIVE.length) : id);
export const liveOfferId = (id: string): string => (/^agent-premortem-plan-[0-9a-f]{12}$/.test(id) ? PLAN_PICK_LIVE + id.slice(PLAN_PICK_STORED.length) : id);

/** The migration's narrow envelope: no execution or approval metadata. */
export function parseAnswerOffers(value: unknown): SuggestedAction[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const actions: SuggestedAction[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'id,label,message'
      || typeof item.id !== 'string' || /^agent-[a-z0-9-]{1,80}$/.exec(item.id)?.[0] !== item.id
      || item.id === 'agent-run-analysis' // the Run offer keeps its own carrier; the migration refuses it too
      || typeof item.label !== 'string' || [...item.label].length < 1 || [...item.label].length > 80
      || typeof item.message !== 'string' || [...item.message].length < 1 || [...item.message].length > 400) return null;
    actions.push({ id: item.id, label: item.label, message: item.message });
  }
  return actions;
}
