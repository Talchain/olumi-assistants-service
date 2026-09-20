/**
 * Replacement conversation layer — the wiring, and the one thing still missing.
 *
 * Everything below this file is pure and injected. This is where it meets the
 * provider, the flag and the route, and it is deliberately the ONLY file in
 * the layer that knows any of those exist.
 *
 * THE STORE HAS NO DEFAULT, ON PURPOSE
 * -------------------------------------
 * CEE has nowhere to persist this layer's state today. Measured at `3f238b11`:
 * the three JSONB columns are owned and typed, `pending_actions` is capped at
 * three rows by a DB CHECK, and `v5_handler_facts.payload` — the one that
 * looks like a free-form slot — is a `.strict()` discriminated union whose
 * read throws, called UNFILTERED, so a single unrecognised row breaks
 * prior-fact loading for the whole scenario on every subsequent turn.
 *
 * A process-local store was considered and rejected. This service runs more
 * than one instance, so a user's "yes, make that update now" would sometimes
 * land on an instance that had never heard of the offer. That is the exact
 * failure this layer exists to fix, reintroduced as a deployment artefact,
 * and it would be intermittent — the worst possible form.
 *
 * So {@link setReplacementStateStore} must be called at boot. Until it is,
 * the flag refuses the turn with a configuration error instead of quietly
 * doing half the job. The required storage is specified in
 * `output/session-analysis-20260920/CORE-PERSISTENCE-REQUEST.md`: one
 * additive table, no change to `append_turn_atomic_v2`, no contract change.
 */

import { createClient } from '@supabase/supabase-js';

import { chatWithToolsAnthropic } from '../../adapters/llm/anthropic.js';
import { SupabaseReplacementStateStore } from './supabase-state-store.js';
import type { ChatWithToolsLike } from './agent-loop.js';
import type { ReplacementStateStore } from './turn-entry.js';

let override: ReplacementStateStore | null = null;
let cached: ReplacementStateStore | null = null;

/**
 * Install a store explicitly. Tests and any future owner of storage use this;
 * production does not, because {@link getReplacementStateStore} builds the
 * real one lazily from the environment.
 *
 * `null` clears BOTH the override and the cached instance, so a test cannot
 * leave a live client behind for the next one.
 */
export function setReplacementStateStore(next: ReplacementStateStore | null): void {
  override = next;
  if (next === null) cached = null;
}

/**
 * The durable store, or `null` when the environment cannot supply one.
 *
 * A lazy singleton rather than boot wiring, matching the sibling adapters
 * (`rolling-summary`, `brief-provenance`, `decision-records`). A boot step is
 * something a deployment can forget; a lazy factory cannot be forgotten, only
 * left unconfigured — and unconfigured is visible, because the caller refuses
 * the turn by name instead of degrading quietly.
 */
export function getReplacementStateStore(): ReplacementStateStore | null {
  if (override !== null) return override;
  if (cached !== null) return cached;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design, mirroring rolling-summary/index.ts
  const url = process.env.SUPABASE_URL;
  // eslint-disable-next-line no-restricted-syntax -- call-time read by design, mirroring rolling-summary/index.ts
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceRoleKey) return null;
  cached = new SupabaseReplacementStateStore(
    createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  );
  return cached;
}

export class ReplacementNotConfiguredError extends Error {
  constructor() {
    super(
      'CEE_REPLACEMENT_COACH_ENABLED is on but no durable replacement-state store could be built: ' +
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set. ' +
        'This layer will not run on process-local state: on a multi-instance deployment a user\'s ' +
        'agreement would intermittently land on an instance that never saw the offer. ' +
        'Set them, or turn the flag off.',
    );
    this.name = 'ReplacementNotConfiguredError';
  }
}

/**
 * The model call.
 *
 * `temperature: 0` because this layer is evaluated by replay, and a
 * conversation you cannot replay is one you cannot measure a change to.
 * Thinking is off for the same reason plus latency; it is a dial to turn
 * later against a measured question, not a default to inherit.
 */
export function anthropicChatWithTools(model?: string): ChatWithToolsLike {
  return async ({ system, messages, tools }) => {
    const result = await chatWithToolsAnthropic({
      system,
      messages,
      tools,
      temperature: 0,
      ...(model === undefined || model.trim().length === 0 ? {} : { model }),
    });
    return { content: result.content, stop_reason: result.stop_reason };
  };
}
