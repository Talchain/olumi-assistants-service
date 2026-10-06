import type { SuggestedAction } from '../compose/types.js';

/** The migration's narrow envelope: no execution or approval metadata. */
export function parseAnswerOffers(value: unknown): SuggestedAction[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8) return null;
  const actions: SuggestedAction[] = [];
  for (const item of value) {
    if (item === null || typeof item !== 'object' || Array.isArray(item)
      || Object.keys(item).sort().join(',') !== 'id,label,message'
      || typeof item.id !== 'string' || /^agent-[a-z0-9-]{1,80}$/.exec(item.id)?.[0] !== item.id
      || typeof item.label !== 'string' || [...item.label].length < 1 || [...item.label].length > 80
      || typeof item.message !== 'string' || [...item.message].length < 1 || [...item.message].length > 400) return null;
    actions.push({ id: item.id, label: item.label, message: item.message });
  }
  return actions;
}
