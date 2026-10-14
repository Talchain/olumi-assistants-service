import { AsyncLocalStorage } from 'node:async_hooks';
import { isDeepStrictEqual } from 'node:util';
import type { InfluenceBand } from '../format/influence-bands.js';

/** Internal authority for the second write of ONE newly added, approved Olumi link. Never a wire field. */
interface DrawnLinkAdoption {
  readonly scenarioId: string;
  readonly from: string;
  readonly to: string;
  readonly band: InfluenceBand;
  readonly magnitude: number;
  readonly edge: unknown;
}
const store = new AsyncLocalStorage<DrawnLinkAdoption>();
export function withDrawnLinkAdoption<T>(value: DrawnLinkAdoption, write: () => Promise<T>): Promise<T> {
  return store.run({ ...value, edge: structuredClone(value.edge) }, write);
}
/** Every stored byte must still match the structural write's read-back, including provenance and review. */
export function drawnLinkAdoptionFor(scenarioId: string, from: string, to: string, magnitude: number, edge: unknown): DrawnLinkAdoption | undefined {
  const a = store.getStore();
  return a !== undefined && a.scenarioId === scenarioId && a.from === from && a.to === to && a.magnitude === magnitude
    && isDeepStrictEqual(a.edge, edge) ? a : undefined;
}
