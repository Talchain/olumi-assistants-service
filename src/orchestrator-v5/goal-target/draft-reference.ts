import { todayInLondon } from './deadline-date.js';

/**
 * ⭐ THE ONE REFERENCE-DATE RESOLVER for a deadline card (DL github-6d, #2953): the model-facing door (`propose_goal_deadline`) and the
 * route's automatic offer both call it, so the same draft can never be given two different reference days.
 *
 *   a date the user stated ("as of 2026-10-10", already checked by the caller)
 *   > the construction VERSION's `created_at` (a signed-in draft)
 *   > the SCENARIO's server-recorded creation (`scenarios.created_at`, server default `now()`, carried beside `brief_text` on the
 *     internal /graph read: #2941). A GUEST has no version history, so this is the only server-recorded draft moment it has.
 *   > nothing (the card is date-only and does not count months).
 * Never the clock, never a client-supplied time.
 *
 * Why the scenario stamp and not the registration row: it is already on the `GraphRead` both issuers hold (the door has no turn rows,
 * so a row stamp could not be shared without a new store read), it is a server default, and a guest's scenario and draft are created
 * in the same first turn. Where the scenario is older than the draft the card still says which day it counts from
 * ("10 months from 10 October 2026") and the human Yes gates the write. Served 10 Oct, staging 1bf67f90, guest 5d5122d1: the automatic
 * offer alone refused this source, had no reference for a guest, and stayed silent on every guest draft.
 */
export function draftReferenceDate(sources: {
  readonly asOf?: string;
  readonly versionCreatedAt?: string | null;
  readonly scenarioCreatedAt?: string | null;
}): string | undefined {
  if (typeof sources.asOf === 'string') return sources.asOf;
  for (const stamp of [sources.versionCreatedAt, sources.scenarioCreatedAt]) {
    if (typeof stamp === 'string' && Number.isFinite(Date.parse(stamp))) return todayInLondon(new Date(stamp));
  }
  return undefined;
}
