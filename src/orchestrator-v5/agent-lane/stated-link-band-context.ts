/**
 * ⭐ THE BAND THE USER NAMED FOR A LINK, CARRIED TO THE LINK WRITER WITHOUT A WIRE FIELD (A6e; AIQ #70 5855345225,
 * 5855430153).
 *
 * WHY. A named band states a RANGE of |β|, so the link writer stores the band's own spread as the link's std
 * (`edgeBandStd`). An exact FIGURE states no range, so the spread stays Olumi's (rescaled to the new mean and flagged
 * `std_defaulted`, A6). Both reach the
 * writer as the same `edge_strength_edit` event, and the event cannot say which: the UI sends it from a band pill, a
 * 0.01-step slider, a β number field and "Confirm this estimate" (DecisionGuideAI staging `507d8ef8`,
 * `buildEdgeStrengthEditEvent` / `buildEdgeStrengthConfirmEvent`), and the event is `.strict()` with no band member.
 * A magnitude that equals a band midpoint is no proof either — the slider lands on 0.85 as easily as the pill does.
 *
 * The one producer CEE can PROVE is band-origin is the Agent's `propose_link_strength`: it runs only when the user
 * named the band in their own words (`bandTheUserWrote`), and it chooses `confirm_current` exactly when the link
 * already sits in that band (keep the figure, record it as theirs) or `set` to the band's midpoint otherwise.
 *
 * HOW — the approved-adoption precedent (`approved-adoption-context.ts`): the capability applies a VERIFIED,
 * server-held proposal (`proposals.authorise` has checked scenario, user and base revision) and dispatches the write
 * in-process through `app.inject()`, which `AsyncLocalStorage` survives. A header would be a forgeable token on a
 * public route; this store is unreachable from outside the process by construction.
 *
 * The writer reads the band ONLY when this context names the SAME scenario and the SAME link, and the write lands IN
 * that band. Anything else — no context (every UI write), another link, a figure outside the band — is a figure.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

import { edgeBandFromMagnitude } from '../format/edge-strength-bands.js';
import type { InfluenceBand } from '../format/influence-bands.js';

export interface StatedLinkBand {
  readonly scenarioId: string;
  readonly proposalId: string;
  readonly from: string;
  readonly to: string;
  /** The band the user named, in the tool's words. */
  readonly band: InfluenceBand;
}

const store = new AsyncLocalStorage<StatedLinkBand>();

/** Run ONE verified approved link write inside the band the user named. */
export function runWithStatedLinkBand<T>(stated: StatedLinkBand, fn: () => Promise<T>): Promise<T> {
  return store.run(stated, fn);
}

/**
 * The band the user named for THIS write if — and only if — the context names this scenario and this exact
 * `(from, to)` link, and `magnitude` (the |β| the write lands on) falls in that band. Otherwise `undefined`: the
 * write is an exact figure and its spread stays Olumi's.
 */
export function statedLinkBandFor(
  scenarioId: string,
  from: string,
  to: string,
  magnitude: unknown,
): InfluenceBand | undefined {
  const s = store.getStore();
  if (s === undefined) return undefined;
  if (s.scenarioId !== scenarioId || s.from !== from || s.to !== to) return undefined;
  if (typeof magnitude !== 'number' || !Number.isFinite(magnitude)) return undefined;
  return edgeBandFromMagnitude(Math.abs(magnitude)) === s.band ? s.band : undefined;
}
