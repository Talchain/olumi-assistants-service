import type { SessionStore } from '../session/store.js';

/** The Run/graph fast port cannot prove edit chronology. Request the canonical
 * reread (including durable edit facts) before reusing a narration's licence. */
export async function runExplanationCurrentness(
  _store: SessionStore, _scenarioId: string, _caller: string | null, _chip: unknown,
  _initial: { readonly graph: unknown; readonly briefText: string | null },
): Promise<boolean | 'wire_changed' | undefined> {
  return undefined;
}
